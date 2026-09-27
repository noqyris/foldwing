/**
 * ScrollView — a draggable list with tap/drag discrimination: down the page
 * (the Levels journey, the Gallery), or across it (the chapter strip).
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
 *
 * A vertical list can also hand a SIDEWAYS gesture to its owner (`onSwipe`):
 * the Levels page turns chapters that way. The first move past the slop
 * decides which of the two the gesture is, once, so a swipe never nudges the
 * list and a scroll never turns the page.
 *
 * Pointer positions go through `worldPoint` (HitArea), the one place the
 * sharp-rendering stage converts them.
 */

import Phaser from 'phaser';
import { worldPoint } from './HitArea';
import { BASE_WIDTH, dp } from './Theme';
import { TAP_SLOP } from './UI';

/** How deep a list window's soft edges are: the mock's ~28 pt. */
export const LIST_FADE = dp(28);

/** The Sky scene's bake (Paper.ts), which a list's soft edges are cut from. */
const SKY_KEY = 'fw-sky';

/**
 * A list window's soft edge: a strip of the sky itself — cut from the Sky
 * scene's own bake at exactly this place, stars and all — faded from nothing
 * to whole toward `edge`, to lie over the list's content there. The window
 * used to end in a hard horizontal cut through a row (QA). Baked once per
 * place; the caller keeps it on the list's camera only, over the content.
 * Null before the sky exists (a test, a canvas without it).
 */
export function listFade(
  scene: Phaser.Scene,
  top: number,
  bottom: number,
  edge: 'top' | 'bottom',
  h: number = LIST_FADE
): Phaser.GameObjects.Image | null {
  const tm = scene.textures;
  if (!tm?.exists(SKY_KEY)) return null;
  const src = tm.get(SKY_KEY).getSourceImage() as HTMLCanvasElement;
  if (!src || !(src.height > 0)) return null;
  const fh = Math.max(1, Math.round(Math.min(h, (bottom - top) / 3)));
  const y0 = Math.round(edge === 'bottom' ? bottom - fh : top);
  const key = `fw-list-fade-${edge}-${y0}-${fh}-${src.width}x${src.height}`;
  if (!tm.exists(key)) {
    const tex = tm.createCanvas(key, BASE_WIDTH, fh);
    if (!tex) return null;
    const ctx = tex.getContext();
    ctx.drawImage(src, 0, y0, Math.min(BASE_WIDTH, src.width), fh, 0, 0, Math.min(BASE_WIDTH, src.width), fh);
    ctx.globalCompositeOperation = 'destination-in';
    const g = ctx.createLinearGradient(0, 0, 0, fh);
    // Smoothstep, sampled: whole at the window's edge, nothing inward.
    for (let i = 0; i <= 6; i++) {
      const u = i / 6;
      const a = u * u * (3 - 2 * u);
      g.addColorStop(edge === 'bottom' ? u : 1 - u, `rgba(0,0,0,${a})`);
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, BASE_WIDTH, fh);
    tex.refresh();
  }
  return scene.add.image(0, y0, key).setOrigin(0, 0);
}

/** One frame at the 60Hz the motion constants are tuned against. */
const FRAME_MS = 1000 / 60;
/**
 * Per-frame velocity retained after a frame of glide.
 *
 * Close to UIScrollView's normal deceleration (0.998 per ms, which is 0.967
 * per 60Hz frame). At 0.92 a flick glided about 12 times its speed — less than
 * half as far as the same flick on a native list — and going from level 300
 * back to level 1 took eleven of the hardest flicks the list would accept.
 */
const DECAY = 0.96;
/** Fraction of the remaining overshoot removed per frame while settling. */
const SETTLE = 0.25;
/** How much of the newest sample enters the smoothed throw speed. */
const FLICK_MIX = 0.35;
/**
 * Ceiling on a single sample, in px per frame — a jitter spike is not a flick.
 *
 * Still a ceiling, just no longer the one a real flick hits: a hard thumb
 * flick measures well past 200px a frame, and the old 120 capped every glide
 * at about a window and a half. FLICK_MIX is what filters jitter — one spiky
 * sample moves the smoothed speed by only a third of itself.
 */
const MAX_FLICK = 200;
/**
 * Above this speed the list counts as still gliding, so a touch is read as
 * "stop" rather than "choose". Comfortably above the 0.1 px/frame at which the
 * glide is considered finished, so a list that has visually settled still
 * accepts a tap.
 */
const GLIDE_STOP = 0.6;
/**
 * How long a new list ignores presses. A list arrives on the release of the
 * tap that opened its screen, so the second tap of a double tap on "Gallery"
 * landed on the brand-new grid and opened the share sheet of whatever card was
 * under the finger. The screen is still sliding in for longer than this.
 */
const ARM_DELAY_MS = 300;
/**
 * A sideways swipe must travel this far, in base units, and mostly sideways
 * (SWIPE_RATIO): a thumb scrolling down a list drifts sideways by a
 * centimetre without meaning to turn anything.
 */
export const SWIPE_MIN = 56;
export const SWIPE_RATIO = 1.4;

/**
 * Which of the two gestures a drag is, from its first move past the slop:
 * sideways only for a list that takes swipes and a move mostly across.
 */
export function gestureAxis(dx: number, dy: number, takesSwipes: boolean): 'swipe' | 'scroll' {
  return takesSwipes && Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'scroll';
}

/** A released swipe's direction — +1 on to the next page (a leftward swipe), −1 back — or 0 if it was not one. */
export function swipeDirection(dx: number, dy: number): 1 | -1 | 0 {
  if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return 0;
  return dx < 0 ? 1 : -1;
}

export interface ScrollRow {
  /**
   * Centre of the row in CONTENT space: y from the top of the content (x as
   * on screen) for a vertical list; x from the content's left edge (y as the
   * content sits) for a horizontal one.
   */
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
  /**
   * Absent for a row that is drawn but not selectable, e.g. a chapter heading.
   * A locked level HAS one: it answers with a refusal, not with silence.
   */
  readonly onTap?: () => void;
  /** Visual feedback while the finger is down on this item. */
  readonly onArm?: (armed: boolean) => void;
}

export interface ScrollViewOptions {
  /**
   * Visible window in screen space. For a horizontal list these still bound
   * where a press is taken; the scrolling window is `horizontal`'s.
   */
  readonly top: number;
  readonly bottom: number;
  /** How tall the content is (ignored by a horizontal list). */
  readonly contentHeight: number;
  readonly items: readonly ScrollRow[];
  /**
   * Scroll ACROSS instead: the content moves in x between `left` and
   * `right` (screen space), `contentWidth` wide. The container's y is the
   * caller's; the list only ever moves its x.
   */
  readonly horizontal?: { readonly left: number; readonly right: number; readonly contentWidth: number };
  /**
   * A vertical list's sideways swipe: +1 for a leftward swipe (on to the
   * next page), −1 for a rightward one. Without it every drag scrolls.
   */
  readonly onSwipe?: (dir: 1 | -1) => void;
  /**
   * True while something modal owns the screen — a sheet, say — so the list
   * must neither scroll nor arm a row. The list also stands aside for any
   * interactive object the press lands on (see `onDown`); this covers a modal
   * whose own parts are not interactive.
   */
  readonly blocked?: () => boolean;
  /**
   * The window's soft edges (listFade), shown as the list has content past
   * them: the head once scrolled, the foot while there is more below.
   */
  readonly fades?: {
    readonly top?: Phaser.GameObjects.Image | null;
    readonly bottom?: Phaser.GameObjects.Image | null;
  };
}

export class ScrollView {
  private offset = 0;
  private velocity = 0;
  private dragging = false;
  private armedIndex = -1;
  private downX = 0;
  private downY = 0;
  /** The last pointer position along the scroll axis. */
  private last = 0;
  private lastMoveAt = 0;
  /** What the drag in progress turned out to be; null until it passes the slop. */
  private axis: 'swipe' | 'scroll' | null = null;
  private readonly maxOffset: number;
  private readonly bornAt = performance.now();
  /** The lowest screen y a press can land on the list at: the window's bottom, until `clip`. */
  private reach: number;
  /** The window along the scroll axis, screen space. */
  private readonly start: number;
  private readonly end: number;
  private readonly across: boolean;
  private alive = true;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly content: Phaser.GameObjects.Container,
    private readonly opts: ScrollViewOptions
  ) {
    const h = opts.horizontal;
    this.across = !!h;
    this.start = h ? h.left : opts.top;
    this.end = h ? h.right : opts.bottom;
    const extent = h ? h.contentWidth : opts.contentHeight;
    this.maxOffset = Math.max(0, extent - (this.end - this.start));
    this.reach = opts.bottom;
    this.cull();
    this.syncFades();

    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.onUpdate, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  /**
   * Stop listening. For a list replaced while its scene lives on — a Levels
   * page turned to the next chapter; the scene's shutdown calls it too.
   */
  destroy(): void {
    if (!this.alive) return;
    this.alive = false;
    this.setArmed(-1);
    const scene = this.scene;
    scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    scene.input.off(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    scene.events.off(Phaser.Scenes.Events.UPDATE, this.onUpdate, this);
    scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  get scrollable(): boolean {
    return this.maxOffset > 0;
  }

  /** 0..1, or 0 when everything already fits. */
  get progress(): number {
    return this.maxOffset === 0 ? 0 : this.offset / this.maxOffset;
  }

  /** The farthest the content scrolls, base units. */
  get range(): number {
    return this.maxOffset;
  }

  /** How far the content is scrolled, base units — for a rebuilt screen to open where this one was. */
  get scrolled(): number {
    return this.offset;
  }

  /** Jump the view, clamped. Used to open the list where the player left off. */
  scrollTo(offset: number): void {
    this.velocity = 0;
    this.applyOffset(offset, false);
  }

  /**
   * Take no press below `bottom` — never below the window it was built with.
   * The world got shorter under the list and the banner's reserve now reaches
   * over its last rows until the screen rebuilds (UI.holdListWindow); a row
   * there is under the native banner, where it can be seen but a thumb aimed
   * at it presses the ad.
   */
  clip(bottom: number): void {
    this.reach = Math.min(this.opts.bottom, bottom);
  }

  private inWindow(x: number, y: number): boolean {
    if (y < this.opts.top || y > this.reach) return false;
    return !this.across || (x >= this.start && x <= this.end);
  }

  /** Which selectable row is under this screen point, or -1. */
  private hit(x: number, y: number): number {
    if (!this.inWindow(x, y)) return -1;
    // Into content space: the scroll axis through the offset, the other as it sits.
    const cx = this.across ? x - this.start + this.offset : x;
    const cy = this.across ? y - this.content.y : y - this.opts.top + this.offset;
    for (let i = 0; i < this.opts.items.length; i++) {
      const it = this.opts.items[i];
      if (!it.onTap) continue;
      if (
        cy >= it.y - it.height / 2 &&
        cy <= it.y + it.height / 2 &&
        cx >= it.x - it.width / 2 &&
        cx <= it.x + it.width / 2
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
    const windowLen = this.end - this.start;
    for (const it of this.opts.items) {
      if (!it.view) continue;
      const at = this.across ? it.x : it.y;
      const size = this.across ? it.width : it.height;
      const slack = size;
      const show =
        at + size / 2 >= this.offset - slack &&
        at - size / 2 <= this.offset + windowLen + slack;
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

  private onDown(p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[] = []): void {
    const at = worldPoint(p);
    if (!this.inWindow(at.x, at.y)) return;
    /*
     * The list listens at SCENE level, so it hears every press — including
     * ones an object above it has already taken. With the Gallery's share
     * sheet open, a tap on the backdrop closed the sheet AND armed the card
     * under the finger, which then opened a new sheet on the release; a swipe
     * on the sheet scrolled the grid behind it. A press that landed on
     * anything interactive belongs to that thing, never to the list.
     */
    if (over.length > 0 || this.opts.blocked?.()) return;
    if (performance.now() - this.bornAt < ARM_DELAY_MS) return;
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
    this.axis = null;
    this.velocity = 0;
    this.downX = at.x;
    this.downY = at.y;
    this.last = this.across ? at.x : at.y;
    this.lastMoveAt = this.scene.time.now;
    this.setArmed(gliding ? -1 : this.hit(at.x, at.y));
  }

  private onMove(p: Phaser.Input.Pointer): void {
    if (!this.dragging) return;

    const at = worldPoint(p);
    const travelled = Phaser.Math.Distance.Between(this.downX, this.downY, at.x, at.y);
    // Past the slop the gesture is a scroll (or a swipe), so whatever was
    // armed is no longer being tapped — and which of the two it is gets
    // decided now, once.
    if (travelled > TAP_SLOP) {
      this.setArmed(-1);
      this.axis ??= gestureAxis(at.x - this.downX, at.y - this.downY, !!this.opts.onSwipe && !this.across);
    }
    // A swipe is its owner's; the list stays exactly where it was.
    if (this.axis === 'swipe' || !this.scrollable) {
      this.last = this.across ? at.x : at.y;
      return;
    }

    const pos = this.across ? at.x : at.y;
    const dy = pos - this.last;
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
    this.last = pos;
    this.lastMoveAt = now;

    this.applyOffset(this.offset - dy, true);
  }

  private onUp(p: Phaser.Input.Pointer): void {
    if (!this.dragging) return;
    this.dragging = false;

    const at = worldPoint(p);
    const travelled = Phaser.Math.Distance.Between(this.downX, this.downY, at.x, at.y);
    const armed = this.armedIndex;
    const axis = this.axis;
    this.axis = null;
    this.setArmed(-1);

    // A touch the system cancelled (a fold, an alert) is neither a tap nor a swipe.
    if (this.opts.blocked?.() || p.wasCanceled) return;
    if (axis === 'swipe') {
      const dir = swipeDirection(at.x - this.downX, at.y - this.downY);
      // Last: the owner may replace this list from inside the callback.
      if (dir !== 0) this.opts.onSwipe?.(dir);
      return;
    }
    if (travelled <= TAP_SLOP && armed >= 0 && this.hit(at.x, at.y) === armed) {
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
    const place = Math.round(this.start - this.offset);
    if (this.across) this.content.x = place;
    else this.content.y = place;
    this.cull();
    this.syncFades();
  }

  /** The soft edges follow what is past them: none at the top of the list, none past its end. */
  private syncFades(): void {
    const f = this.opts.fades;
    if (!f) return;
    const k = (d: number): number => Phaser.Math.Clamp(d / LIST_FADE, 0, 1);
    if (f.top?.scene) f.top.setAlpha(k(this.offset));
    if (f.bottom?.scene) f.bottom.setAlpha(k(this.maxOffset - this.offset));
  }
}
