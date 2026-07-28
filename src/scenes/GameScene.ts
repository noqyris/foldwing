/**
 * GameScene — the core loop.
 *
 *   idle    → pointerdown within 2.4 × startRadius of start → drawing
 *   drawing → pointermove samples points
 *           → segment collides           → failed
 *           → pointerup before the goal  → idle (attempt reset, no penalty)
 *           → the path enters the goal   → won
 *   failed  → 400ms red flash, auto-reset to idle
 *   won     → the symmetric figure is drawn and held
 *
 * Failure is recoverable in well under a second: flash, clear, ready. No modal,
 * no defeat screen.
 *
 * An interstitial CAN now fire on a retry, at the author's direction. It is
 * gated hard, because a failed attempt here lasts three to eight seconds and an
 * attempt counter on its own would mean an ad every twenty seconds — the exact
 * pattern AdMob disables ad serving for. Two axes must both agree (see
 * Ads.wouldShowOnAttempt), and the ad fires only AFTER the flash has finished
 * and the board is clear, never over it.
 */

import Phaser from 'phaser';
import { CollisionSystem } from '../core/CollisionSystem';
import { drawCursor } from '../core/DrawCursor';
import {
  dist,
  lerpPoint,
  segCircleEntryT,
  type Rect,
  type Vec2,
} from '../core/Geometry';
import { Playfield } from '../core/Playfield';
import { StrokeRecorder } from '../core/StrokeRecorder';
import { LEVELS, levelAt } from '../data/levels';
import type { Level } from '../data/types';
import { monetization } from '../config/monetization';
import { Ads } from '../systems/Ads';
import { Audio } from '../systems/Audio';
import { Haptics } from '../systems/Haptics';
import { Progress } from '../systems/Progress';
import { Rate } from '../systems/Rate';
import { Share } from '../systems/Share';
import { InkRenderer } from '../render/InkRenderer';
import { renderShareCard } from '../render/ShareCard';
import { BASE_HEIGHT, BASE_WIDTH, METRICS, pt, theme } from '../render/Theme';
import {
  button,
  FONT,
  label,
  RADIUS,
  roundRect,
  tappable,
  TAP_SLOP,
  TYPE,
} from '../render/UI';

type Phase = 'idle' | 'drawing' | 'failed' | 'won';

export interface GameSceneData {
  levelIndex?: number;
}

/**
 * The spec asks for the raw pointerType. Phaser normalises touch and mouse into
 * one Pointer, so read the underlying event where the browser provides it and
 * fall back to Phaser's own classification where it does not.
 */
function isTouchPointer(pointer: Phaser.Input.Pointer): boolean {
  const native = pointer.event as { pointerType?: string } | undefined;
  if (native && typeof native.pointerType === 'string') {
    return native.pointerType !== 'mouse';
  }
  return pointer.wasTouch;
}

export class GameScene extends Phaser.Scene {
  private pf!: Playfield;
  private ink!: InkRenderer;
  private recorder!: StrokeRecorder;
  private collision!: CollisionSystem;

  private level!: Level;
  private levelIndex = 0;
  private startPx: Vec2 = { x: 0, y: 0 };
  private goalPx: Vec2 = { x: 0, y: 0 };
  /** Right-hand walls reflected onto the left half — what a reveal paints. */
  private mirrorBands: Rect[] = [];
  /** One per obstacle row; each rings once per attempt. */
  private gates: { mid: number; passed: boolean }[] = [];

  private phase: Phase = 'idle';
  private activePointer: number | null = null;
  private touchInput = false;
  private touchAnchor: Vec2 = { x: 0, y: 0 };
  private strokeStartedAt = 0;
  private failTimer: Phaser.Time.TimerEvent | null = null;
  private advanceReadyAt = 0;
  private attempts = 0;
  private advancing = false;

  private titleText!: Phaser.GameObjects.Text;
  private attemptText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private revealPill!: Phaser.GameObjects.Container;
  private revealCount!: Phaser.GameObjects.Text;
  private skipPill: Phaser.GameObjects.Container | null = null;
  private sharePill: Phaser.GameObjects.Container | null = null;
  private sharing = false;

  constructor() {
    super('Game');
  }

  create(data: GameSceneData): void {
    this.cameras.main.setBackgroundColor(theme().paper);

    this.pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset);
    this.recorder = new StrokeRecorder(METRICS.sampleMinDist);
    this.ink = new InkRenderer(this, this.pf);

    this.buildHud();

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);

    if (import.meta.env.DEV) this.bindDevKeys();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.failTimer?.remove();
      this.ink.destroy();
    });

    this.loadLevel(data.levelIndex ?? 0);

    // The banner is always on now. The playfield inset already reserves its
    // strip, so it covers paper margin rather than anything you can touch.
    void Ads.showBanner();
  }

  /* --------------------------------------------------------------- levels */

  private loadLevel(index: number): void {
    this.levelIndex = ((index % LEVELS.length) + LEVELS.length) % LEVELS.length;
    this.level = levelAt(this.levelIndex);

    const walls: Rect[] = this.level.walls.map((w) => this.pf.toScreenRect(w));
    this.startPx = this.pf.toScreen(this.level.start);
    this.goalPx = this.pf.toScreen(this.level.goal);
    this.collision = new CollisionSystem(walls, METRICS.hitRadius, this.pf.axisX);

    // Reflect every wall, keep the ones that land on the drawable half. A left
    // wall mirrors into the right half and drops out; a right wall mirrors onto
    // the player and is exactly the constraint they cannot see.
    const axis = this.pf.axisX;
    this.mirrorBands = walls
      .map((w) => ({ x: 2 * axis - (w.x + w.w), y: w.y, w: w.w, h: w.h }))
      .filter((w) => w.x < axis && w.x + w.w > this.pf.x);

    /*
     * One gate per obstacle ROW — the walls facing the player and the bands its
     * reflection has to clear, deduped by height. Crossing a row without dying
     * is what earns a note, so a level plays as a rising phrase and the player
     * hears how far up they got before they look.
     */
    const mids = new Set<number>();
    for (const w of [...walls, ...this.mirrorBands]) {
      mids.add(Math.round(w.y + w.h / 2));
    }
    this.gates = [...mids]
      .sort((a, b) => b - a)
      .map((mid) => ({ mid, passed: false }));

    this.attempts = 0;
    this.advancing = false;
    Audio.resetScale();
    this.ink.clearReveal();
    this.resetToIdle();
    this.ink.drawLevel(walls, this.startPx, this.goalPx);
    this.clearSkipOffer();
    this.clearShareOffer();
    this.refreshHud();
  }

  /* ---------------------------------------------------------------- input */

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    Audio.unlock();

    if (this.phase === 'won') {
      // A tap anywhere means "next", so the share button has to carve itself
      // out — otherwise reaching for it would skip past the figure instead.
      if (this.overSharePill(pointer)) return;
      if (this.time.now >= this.advanceReadyAt) void this.advance();
      return;
    }

    // Reaching for the start again abandons the flash immediately. Making the
    // player sit out an animation they have already reacted to is the tax the
    // whole design exists to avoid.
    if (this.phase === 'failed') this.resetToIdle();
    if (this.phase !== 'idle') return;

    const touch: Vec2 = { x: pointer.x, y: pointer.y };
    const grab = METRICS.startRadius * METRICS.startGrabFactor;

    // The grab is tested against the FINGER, not the offset cursor: the player
    // aims at the dot they can see. The offset only exists once drawing begins.
    if (dist(touch, this.startPx) > grab) return;

    this.activePointer = pointer.id;
    this.touchInput = isTouchPointer(pointer);
    this.touchAnchor = touch;
    this.strokeStartedAt = this.time.now;
    this.attempts += 1;
    this.phase = 'drawing';

    // The stroke is anchored on the dot rather than under the finger, so the
    // ink always begins exactly where the level says it does.
    for (const gate of this.gates) gate.passed = false;
    Audio.resetScale();
    this.recorder.begin(this.startPx, this.time.now);
    this.ink.drawStroke(this.recorder.points, this.recorder.times);
    this.refreshHud();
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.phase !== 'drawing' || pointer.id !== this.activePointer) return;

    const prev = this.recorder.last;
    if (!prev) return;

    const cursor = this.cursorFor(pointer);

    /*
     * Continuous, along the whole segment, against the walls AND the mirror's
     * walls — LOCKED. Pointer samples arrive about once per frame, so during a
     * flick `prev` and `cursor` can be hundreds of pixels apart and anything
     * that only inspected the endpoints would wave the stroke through a wall.
     */
    const blocked = this.collision.blocks(prev, cursor);
    const goalT = segCircleEntryT(prev, cursor, this.goalPx, METRICS.goalRadius);

    if (blocked) {
      const hitT = this.collision.firstHitT(prev, cursor) ?? 0;
      // One long segment can reach both a wall and the goal. Whichever the
      // gesture arrived at first is what actually happened.
      if (goalT !== null && goalT < hitT) this.win(lerpPoint(prev, cursor, goalT));
      else this.fail(lerpPoint(prev, cursor, hitT));
      return;
    }

    if (goalT !== null) {
      this.win(lerpPoint(prev, cursor, goalT));
      return;
    }

    if (this.recorder.push(cursor, this.time.now)) {
      this.ink.drawStroke(this.recorder.points, this.recorder.times);
      this.ringGates(prev, cursor);
    }
  }

  /** Sound a note for every obstacle row this segment just crossed alive. */
  private ringGates(from: Vec2, to: Vec2): void {
    for (const gate of this.gates) {
      if (gate.passed) continue;
      const crossed = from.y > gate.mid !== to.y > gate.mid;
      if (!crossed) continue;
      gate.passed = true;
      Audio.note();
      Haptics.tick();
    }
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    if (this.phase !== 'drawing' || pointer.id !== this.activePointer) return;
    // Lifted short of the goal. Not a failure — just an attempt that ended.
    this.resetToIdle();
  }

  /** Pointer position -> ink position: the thumb lift, then the drawable clamp. */
  private cursorFor(pointer: Phaser.Input.Pointer): Vec2 {
    const raw: Vec2 = { x: pointer.x, y: pointer.y };
    return this.pf.clampToDrawable(
      drawCursor(raw, {
        touch: this.touchInput,
        // Travel, not elapsed time. A finger resting on the glass must not
        // drag the cursor — and therefore the collision-tested stroke — with it.
        travelPx: dist(raw, this.touchAnchor),
        offsetY: METRICS.touchOffsetY,
        rampPx: METRICS.touchOffsetRampPx,
      })
    );
  }

  /* -------------------------------------------------------- state changes */

  private fail(contact: Vec2): void {
    this.recorder.pushExact(contact, this.time.now);
    this.phase = 'failed';
    this.activePointer = null;

    Haptics.thud();
    Audio.thud();
    this.ink.flashFail(this.recorder.points, this.recorder.times);

    Progress.update({ attemptsSinceAd: Progress.data.attemptsSinceAd + 1 });

    this.failTimer?.remove();
    this.failTimer = this.time.delayedCall(METRICS.failFlashMs, () => {
      this.failTimer = null;
      this.resetToIdle();
      // Board is clear: this is the transition, not the failure itself.
      void this.maybeAdOnRetry();
    });

    // A level that has genuinely resisted them earns the offer of a way past.
    if (
      this.attempts >= monetization.reveals.offerSkipAfterAttempts &&
      !this.skipPill &&
      Ads.rewardedAvailable
    ) {
      this.showSkipOffer();
    }
  }

  private win(entry: Vec2): void {
    this.recorder.pushExact(entry, this.time.now);
    this.phase = 'won';
    this.activePointer = null;

    const elapsed = this.time.now - this.strokeStartedAt;
    Progress.recordWin(this.level.id, this.levelIndex, elapsed, LEVELS.length);

    // Keep the figure. Normalized, with its timing, so it can be redrawn on any
    // device at any size — including 1080×1080 in someone else's feed.
    const t0 = this.recorder.times[0] ?? 0;
    Progress.addFigure({
      levelId: this.level.id,
      levelName: this.level.name,
      points: this.recorder.points.map((p) => this.pf.toNormalized(p)),
      times: this.recorder.times.map((t) => t - t0),
      ms: elapsed,
      at: Date.now(),
    });

    this.ink.presentWin(this.recorder.points, this.recorder.times);
    Audio.chime();
    this.clearSkipOffer();

    /*
     * One number for both: the tap gate and the prompt that invites the tap.
     * Derived rather than written twice, because when they drift the game shows
     * "tap for the next fold" during a window where taps are still being
     * dropped, and the player's first, obedient tap does nothing.
     */
    const readyIn = METRICS.winHoldMs + METRICS.winSettleMs + 250;
    this.advanceReadyAt = this.time.now + readyIn;

    this.refreshHud();
    this.showHint('tap for the next fold', readyIn);
    this.showShareOffer(readyIn);

    // At most one interruption per moment. If an ad is queued for the way out,
    // the rating prompt stands down rather than stacking on top of it.
    const adWillShow = Ads.wouldShowInterstitial(
      this.levelIndex,
      Progress.data.winsSinceAd
    );
    if (Rate.shouldAsk(adWillShow)) {
      this.time.delayedCall(readyIn + 400, () => void Rate.ask());
    }
  }

  private resetToIdle(): void {
    this.failTimer?.remove();
    this.failTimer = null;

    this.recorder.clear();
    this.ink.clearStroke();
    this.ink.clearWin();

    this.phase = 'idle';
    this.activePointer = null;
    this.clearShareOffer();
    this.hideHint();
    this.refreshHud();
  }

  /**
   * Leaving a win. This is the ONE place an interstitial may fire, and it fires
   * only after the figure has been seen and dismissed — never over it.
   */
  private async advance(): Promise<void> {
    if (this.advancing) return;
    this.advancing = true;

    const next = this.levelIndex + 1;

    if (Ads.wouldShowInterstitial(this.levelIndex, Progress.data.winsSinceAd)) {
      const shown = await Ads.showInterstitial();
      // Only spend the counter when an ad actually rendered; on no-fill it
      // stays armed so the next natural break retries.
      if (shown) Progress.update({ winsSinceAd: 0, attemptsSinceAd: 0 });
    }

    if (next >= LEVELS.length) {
      this.scene.start('LevelSelect');
      return;
    }
    this.loadLevel(next);
  }

  /* --------------------------------------------------------------- reveal */

  /** Spend a reveal, or offer a rewarded video when the stash is empty. */
  private async doReveal(): Promise<void> {
    if (this.phase === 'won') return;
    Haptics.tap();

    if (Progress.spendReveal()) {
      this.ink.showReveal(this.mirrorBands, monetization.reveals.durationMs);
      this.refreshHud();
      return;
    }

    if (!Ads.rewardedAvailable) return;
    const earned = await Ads.showRewarded('reveal');
    if (!earned) return;

    Progress.grantReveals(monetization.reveals.grantedPerRewarded);
    // Bank it rather than auto-spending: letting the player choose the moment
    // is what makes them watch the next one.
    this.refreshHud();
  }

  /**
   * The retry-path interstitial. Fires only when BOTH the attempt count and the
   * time floor allow, and only with the board already reset — so the player
   * closes the ad into a level ready to draw, not into a red flash.
   */
  private async maybeAdOnRetry(): Promise<void> {
    if (this.phase !== 'idle' || this.advancing) return;
    if (!Ads.wouldShowOnAttempt(this.levelIndex, Progress.data.attemptsSinceAd)) return;

    const shown = await Ads.showInterstitial();
    // Only spend the counter when an ad actually rendered; on no-fill it stays
    // armed so the next eligible retry tries again.
    if (shown) Progress.update({ attemptsSinceAd: 0 });
  }

  /* ---------------------------------------------------------------- share */

  /**
   * The growth loop, offered at the only moment it can work: the player is
   * looking at something they just made and are pleased with.
   */
  private showShareOffer(delay: number): void {
    this.clearShareOffer();

    const pill = button(this, BASE_WIDTH / 2, BASE_HEIGHT - METRICS.bannerReserve - pt(34), 'Share this fold', {
      width: pt(190),
      height: pt(40),
      variant: 'secondary',
      size: TYPE.label,
      onPress: () => void this.shareCurrent(),
    });
    pill.setAlpha(0);
    this.sharePill = pill;

    this.tweens.add({ targets: pill, alpha: 1, delay, duration: 300 });
  }

  private clearShareOffer(): void {
    if (!this.sharePill) return;
    this.tweens.killTweensOf(this.sharePill);
    this.sharePill.destroy(true);
    this.sharePill = null;
  }

  private overSharePill(pointer: Phaser.Input.Pointer): boolean {
    const pill = this.sharePill;
    if (!pill || pill.alpha < 0.5) return false;
    const w = pill.width / 2;
    const h = pill.height / 2;
    return (
      pointer.x >= pill.x - w &&
      pointer.x <= pill.x + w &&
      pointer.y >= pill.y - h &&
      pointer.y <= pill.y + h
    );
  }

  private async shareCurrent(): Promise<void> {
    const figure = Progress.figures[0];
    if (!figure || this.sharing) return;
    this.sharing = true;
    Haptics.tap();

    try {
      const dataUrl = renderShareCard(figure, {
        caption: `${figure.levelName} · ${(figure.ms / 1000).toFixed(1)}s`,
      });
      if (!dataUrl) return;
      await Share.shareFigure({
        dataUrl,
        title: 'My foldwing',
        text: `One line, mirrored. ${figure.levelName} in ${(figure.ms / 1000).toFixed(1)}s.`,
        fileName: `foldwing-${figure.levelId}-${figure.at}.png`,
      });
    } finally {
      this.sharing = false;
    }
  }

  private showSkipOffer(): void {
    const y = BASE_HEIGHT - METRICS.bannerReserve - pt(34);
    this.skipPill = button(this, BASE_WIDTH / 2, y, 'Skip this fold', {
      width: pt(210),
      height: pt(40),
      variant: 'secondary',
      size: TYPE.label,
      onPress: () => void this.doSkip(),
    });
    this.skipPill.setAlpha(0);
    this.tweens.add({ targets: this.skipPill, alpha: 1, duration: 300 });
  }

  private clearSkipOffer(): void {
    if (!this.skipPill) return;
    this.tweens.killTweensOf(this.skipPill);
    this.skipPill.destroy(true);
    this.skipPill = null;
  }

  private async doSkip(): Promise<void> {
    Haptics.tap();
    const earned = await Ads.showRewarded('skip');
    if (!earned) return;

    Progress.unlockThrough(this.levelIndex, LEVELS.length);
    this.clearSkipOffer();
    const next = this.levelIndex + 1;
    if (next >= LEVELS.length) this.scene.start('LevelSelect');
    else this.loadLevel(next);
  }

  /* ------------------------------------------------------------------ hud */

  private buildHud(): void {
    const t = theme();

    this.add
      .existing(
        button(this, METRICS.inset.left + pt(18), pt(26), '‹', {
          width: pt(46),
          height: pt(44),
          variant: 'ghost',
          size: TYPE.title,
          onPress: () => {
            Haptics.tap();
            void Progress.flush();
            this.scene.start('Menu');
          },
        })
      )
      .setDepth(50);

    this.titleText = this.add
      .text(BASE_WIDTH / 2, pt(26), '', {
        fontFamily: FONT.display,
        fontSize: `${TYPE.body}px`,
        color: `rgba(22,50,60,0.72)`,
      })
      .setOrigin(0.5, 0.5)
      .setDepth(50);

    this.revealPill = this.buildRevealPill();

    this.attemptText = this.add
      .text(BASE_WIDTH / 2, pt(47), '', {
        fontFamily: FONT.ui,
        fontSize: `${TYPE.micro}px`,
        color: `rgba(22,50,60,0.32)`,
      })
      .setOrigin(0.5, 0.5)
      .setDepth(50);

    this.hintText = this.add
      .text(BASE_WIDTH / 2, BASE_HEIGHT - METRICS.bannerReserve - pt(4), '', {
        fontFamily: FONT.display,
        fontSize: `${TYPE.label}px`,
        color: `rgba(22,50,60,0.45)`,
      })
      .setOrigin(0.5, 1)
      .setDepth(50)
      .setAlpha(0);

    void t;
  }

  /** "Show me where my reflection dies" — the reward, as a one-tap control. */
  private buildRevealPill(): Phaser.GameObjects.Container {
    const t = theme();
    const w = pt(74);
    const h = pt(34);
    const c = this.add.container(BASE_WIDTH - METRICS.inset.right - pt(42), pt(26));
    c.setDepth(50);

    const g = this.add.graphics();
    g.fillStyle(t.ink, 0.055);
    roundRect(g, -w / 2, -h / 2, w, h, RADIUS.pill);
    c.add(g);

    const eye = this.add.graphics();
    eye.lineStyle(pt(1.4), t.accent, 0.85);
    eye.strokeCircle(-pt(15), 0, pt(5));
    eye.fillStyle(t.accent, 0.85);
    eye.fillCircle(-pt(15), 0, pt(1.8));
    c.add(eye);

    this.revealCount = label(this, pt(6), 0, '', {
      size: TYPE.label,
      alpha: 0.6,
    }).setOrigin(0.5);
    c.add(this.revealCount);

    c.setSize(w, h);
    tappable(c, w, h);

    // Same slop rule as UI.button: judge the gesture by DISTANCE, not by
    // whether the finger stayed inside the hit rectangle. Phaser fires
    // `pointerout` on a few pixels of drift, and cancelling on that is what
    // made every button in this game need two or three stabs.
    let armed = false;
    let downX = 0;
    let downY = 0;

    c.on('pointerdown', (p: Phaser.Input.Pointer) => {
      armed = true;
      downX = p.x;
      downY = p.y;
      this.tweens.add({ targets: c, scale: 0.93, duration: 90, ease: 'Quad.easeOut' });
    });

    const onUp = (p: Phaser.Input.Pointer): void => {
      if (!armed) return;
      armed = false;
      this.tweens.add({ targets: c, scale: 1, duration: 280, ease: 'Back.easeOut' });
      if (Phaser.Math.Distance.Between(downX, downY, p.x, p.y) > TAP_SLOP) return;
      if (
        p.x < c.x - w / 2 || p.x > c.x + w / 2 ||
        p.y < c.y - h / 2 || p.y > c.y + h / 2
      ) return;
      void this.doReveal();
    };
    this.input.on(Phaser.Input.Events.POINTER_UP, onUp);
    c.once('destroy', () => this.input.off(Phaser.Input.Events.POINTER_UP, onUp));

    return c;
  }

  private refreshHud(): void {
    this.titleText.setText(`${this.levelIndex + 1}. ${this.level.name}`);
    this.attemptText.setText(this.attempts > 0 ? `attempt ${this.attempts}` : '');

    const n = Progress.reveals;
    this.revealCount.setText(n === Number.POSITIVE_INFINITY ? '∞' : `${n}`);
    this.revealPill.setAlpha(n > 0 || Ads.rewardedAvailable ? 1 : 0.35);
  }

  private showHint(message: string, delay: number): void {
    this.hintText.setText(message);
    this.tweens.killTweensOf(this.hintText);
    this.tweens.add({
      targets: this.hintText,
      alpha: 1,
      delay,
      duration: 300,
      ease: 'Quad.easeOut',
    });
  }

  private hideHint(): void {
    this.tweens.killTweensOf(this.hintText);
    this.hintText.setAlpha(0);
  }

  /* ------------------------------------------------------------------ dev */

  private bindDevKeys(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;

    keyboard.on('keydown', (event: KeyboardEvent) => {
      const n = Number.parseInt(event.key, 10);
      if (Number.isInteger(n) && n >= 1 && n <= LEVELS.length) {
        this.loadLevel(n - 1);
        return;
      }
      if (event.key === 'r' || event.key === 'R') this.loadLevel(this.levelIndex);
      if (event.key === 'm' || event.key === 'M') this.scene.start('Menu');
    });
  }
}
