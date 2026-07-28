/**
 * ScrollView — a vertically draggable list with tap/drag discrimination.
 *
 * All input is handled at the SCENE level and hit-tested by hand rather than
 * giving each row its own interactive object. That is deliberate:
 *
 *  - A per-row `pointerup` cancels itself the instant the finger slides,
 *    because Phaser fires `pointerout` on a few pixels of drift. Rows would
 *    need two or three stabs each, which is the same bug that made the menu
 *    buttons feel dead.
 *  - Scrolling and tapping are the SAME gesture until the finger has moved far
 *    enough to be one or the other. Only one place can make that call, and it
 *    has to be the thing that owns the drag.
 *
 * So: press arms a row, movement past the slop turns the gesture into a scroll
 * and disarms it, release inside the slop activates whatever the finger is
 * still on.
 */

import Phaser from 'phaser';
import { TAP_SLOP } from './UI';

/** One frame at the 60Hz the motion constants are tuned against. */
const FRAME_MS = 1000 / 60;
/** Per-frame velocity retained after a frame of glide. */
const DECAY = 0.92;
/** Fraction of the remaining overshoot removed per frame while settling. */
const SETTLE = 0.25;
/** How much of the newest sample enters the smoothed throw speed. */
const FLICK_MIX = 0.35;
/** Ceiling on a single sample, in px per frame — a jitter spike is not a flick. */
const MAX_FLICK = 120;
/**
 * Above this speed the list counts as still gliding, so a touch is read as
 * "stop" rather than "choose". Comfortably above the 0.1 px/frame at which the
 * glide is considered finished, so a list that has visually settled still
 * accepts a tap.
 */
const GLIDE_STOP = 0.6;

export interface ScrollRow {
  /** Vertical centre of the row in CONTENT space (0 = top of the content). */
  readonly y: number;
  readonly height: number;
  /** Horizontal band, so a grid can put several rows side by side. */
  readonly x: number;
  readonly width: number;
  /**
   * The object drawn for this row, hidden while it is off-screen.
   *
   * Phaser does not cull inside a Container, so all 100 level cards were being
   * submitted every frame — 202 Graphics and 103 Texts, about 300 draw calls,
   * for the ~15 rows a phone can actually show. Measured: the grid ran at 5fps
   * while the menu and the game held 60 in the same browser. That is the whole
   * of "the scroll stutters".
   */
  readonly view?: Phaser.GameObjects.GameObject;
  /** Absent for a row that is drawn but not selectable, e.g. a locked level. */
  readonly onTap?: () => void;
  /** Visual feedback while the finger is down on this item. */
  readonly onArm?: (armed: boolean) => void;
}

export interface ScrollViewOptions {
  /** Visible window in screen space. */
  readonly top: number;
  readonly bottom: number;
  readonly contentHeight: number;
  readonly items: readonly ScrollRow[];
}

export class ScrollView {
  private offset = 0;
  private velocity = 0;
  private dragging = false;
  private armedIndex = -1;
  private downX = 0;
  private downY = 0;
  private lastY = 0;
  private lastMoveAt = 0;
  private readonly maxOffset: number;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly content: Phaser.GameObjects.Container,
    private readonly opts: ScrollViewOptions
  ) {
    const windowH = opts.bottom - opts.top;
    this.maxOffset = Math.max(0, opts.contentHeight - windowH);
    this.cull();

    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.onUpdate, this);

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
      scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
      scene.input.off(Phaser.Input.Events.POINTER_UP, this.onUp, this);
      scene.events.off(Phaser.Scenes.Events.UPDATE, this.onUpdate, this);
    });
  }

  get scrollable(): boolean {
    return this.maxOffset > 0;
  }

  /** 0..1, or 0 when everything already fits. */
  get progress(): number {
    return this.maxOffset === 0 ? 0 : this.offset / this.maxOffset;
  }

  /** Jump the view, clamped. Used to open the list where the player left off. */
  scrollTo(offset: number): void {
    this.velocity = 0;
    this.applyOffset(offset, false);
  }

  private inWindow(y: number): boolean {
    return y >= this.opts.top && y <= this.opts.bottom;
  }

  /** Which selectable row is under this screen point, or -1. */
  private hit(x: number, y: number): number {
    if (!this.inWindow(y)) return -1;
    const contentY = y - this.opts.top + this.offset;
    for (let i = 0; i < this.opts.items.length; i++) {
      const it = this.opts.items[i];
      if (!it.onTap) continue;
      if (
        contentY >= it.y - it.height / 2 &&
        contentY <= it.y + it.height / 2 &&
        x >= it.x - it.width / 2 &&
        x <= it.x + it.width / 2
      ) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Hide the rows that are not on screen.
   *
   * One row of slack either side, so a card is already painted by the time it
   * slides into view — popping in at the edge would trade a frame-rate problem
   * for a worse-looking one.
   */
  private cull(): void {
    const windowH = this.opts.bottom - this.opts.top;
    for (const it of this.opts.items) {
      if (!it.view) continue;
      const slack = it.height;
      const show =
        it.y + it.height / 2 >= this.offset - slack &&
        it.y - it.height / 2 <= this.offset + windowH + slack;
      const v = it.view as unknown as Phaser.GameObjects.Components.Visible;
      if (v.visible !== show) v.setVisible(show);
    }
  }

  private setArmed(index: number): void {
    if (this.armedIndex === index) return;
    if (this.armedIndex >= 0) this.opts.items[this.armedIndex].onArm?.(false);
    this.armedIndex = index;
    if (index >= 0) this.opts.items[index].onArm?.(true);
  }

  private onDown(p: Phaser.Input.Pointer): void {
    if (!this.inWindow(p.y)) return;
    /*
     * A touch that lands while the list is still gliding STOPS it, and nothing
     * else. Arming the row under the finger meant a flick followed by a grab —
     * the ordinary way to halt a fling — opened whatever card happened to be
     * sliding past. Both UIScrollView and RecyclerView swallow this gesture,
     * and a list that launches a level when you tried to stop it feels broken
     * in exactly the way "scrolling opens levels" described.
     */
    const gliding = Math.abs(this.velocity) > GLIDE_STOP;
    this.dragging = true;
    this.velocity = 0;
    this.downX = p.x;
    this.downY = p.y;
    this.lastY = p.y;
    this.lastMoveAt = this.scene.time.now;
    this.setArmed(gliding ? -1 : this.hit(p.x, p.y));
  }

  private onMove(p: Phaser.Input.Pointer): void {
    if (!this.dragging) return;

    const travelled = Phaser.Math.Distance.Between(this.downX, this.downY, p.x, p.y);
    // Past the slop the gesture is a scroll, so whatever was armed is no longer
    // being tapped.
    if (travelled > TAP_SLOP) this.setArmed(-1);
    if (!this.scrollable) return;

    const dy = p.y - this.lastY;
    const now = this.scene.time.now;
    /*
     * Smooth the throw speed instead of trusting the last move alone. Pointer
     * deltas are noisy, and two moves can share a frame — `now` would not have
     * advanced, so a one-millisecond floor turned a 20px delta into 320px per
     * frame and the list jumped. An average over the recent moves is both
     * stabler and closer to what the hand actually did.
     */
    const dt = Math.max(FRAME_MS / 4, now - this.lastMoveAt);
    const instant = Phaser.Math.Clamp((dy / dt) * FRAME_MS, -MAX_FLICK, MAX_FLICK);
    this.velocity = this.velocity * (1 - FLICK_MIX) + instant * FLICK_MIX;
    this.lastY = p.y;
    this.lastMoveAt = now;

    this.applyOffset(this.offset - dy, true);
  }

  private onUp(p: Phaser.Input.Pointer): void {
    if (!this.dragging) return;
    this.dragging = false;

    const travelled = Phaser.Math.Distance.Between(this.downX, this.downY, p.x, p.y);
    const armed = this.armedIndex;
    this.setArmed(-1);

    if (travelled <= TAP_SLOP && armed >= 0 && this.hit(p.x, p.y) === armed) {
      this.velocity = 0;
      // `hit` only ever returns selectable rows, so this is always present.
      this.opts.items[armed].onTap?.();
    }
  }

  private onUpdate(_time: number, delta: number): void {
    if (this.dragging || !this.scrollable) return;

    /*
     * Decay and settle per unit of TIME, not per frame. A fixed per-frame
     * factor makes the glide length depend on the frame rate, so the same flick
     * travels twice as far on a 120Hz phone as on a 60Hz one — and stutters
     * translate straight into uneven deceleration.
     */
    const steps = Phaser.Math.Clamp(delta, 1, 50) / FRAME_MS;

    if (Math.abs(this.velocity) > 0.1) {
      this.applyOffset(this.offset - this.velocity * steps, true);
      this.velocity *= Math.pow(DECAY, steps);
    } else if (this.velocity !== 0) {
      this.velocity = 0;
    }

    // Rubber-band back into range if a flick overshot the ends.
    const target =
      this.offset < 0 ? 0 : this.offset > this.maxOffset ? this.maxOffset : null;
    if (target !== null) {
      const k = 1 - Math.pow(1 - SETTLE, steps);
      const next = this.offset + (target - this.offset) * k;
      this.applyOffset(Math.abs(target - next) < 0.5 ? target : next, false);
    }
  }

  /**
   * @param rubber allow a little travel past the ends while the finger is
   *               down, so hitting the end feels elastic rather than dead.
   */
  private applyOffset(next: number, rubber: boolean): void {
    const slack = rubber ? 90 : 0;
    this.offset = Phaser.Math.Clamp(next, -slack, this.maxOffset + slack);
    // Round to whole pixels: a container on a fractional offset resamples every
    // glyph and hairline every frame, which reads as shimmer while scrolling.
    this.content.y = Math.round(this.opts.top - this.offset);
    this.cull();
  }
}
