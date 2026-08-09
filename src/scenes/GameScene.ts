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
import { foldExposure, nextProfileScore, winScore } from '../core/FoldSense';
import { routeArc } from '../core/LevelValidator';
import { StrokeRecorder } from '../core/StrokeRecorder';
import { LEVELS, levelAt } from '../data/levels';
import type { Level } from '../data/types';
import { monetization } from '../config/monetization';
import { Ads } from '../systems/Ads';
import { dailyLevel } from '../systems/Daily';
import { Iap } from '../systems/Iap';
import { APP_STORE_URL, WEB_DAILY } from '../systems/WebDaily';
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
  softShadow,
  tappable,
  TAP_SLOP,
  TYPE,
} from '../render/UI';

type Phase = 'idle' | 'drawing' | 'failed' | 'won';

/**
 * A winning line at or under this multiple of the proved route's length
 * earns the level's medal. 1.25 leaves room for human corners — the validator
 * route hugs walls a finger cannot — while still demanding a planned line
 * rather than a survived one.
 */
const MEDAL_RATIO = 1.25;

export interface GameSceneData {
  levelIndex?: number;
  /** ISO date (YYYY-MM-DD): play that day's Daily Fold instead of a level. */
  daily?: string;
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
  /**
   * Finger travel as accumulated ARC LENGTH, not straight-line distance from
   * the anchor. Maze routes wind back toward where they started; a
   * straight-line measure would shrink again on the way back, dropping the
   * cursor's lift mid-stroke and sagging live, collision-tested ink downward
   * through whatever is beneath it. Arc length only ever grows.
   */
  private fingerTravel = 0;
  private lastFinger: Vec2 = { x: 0, y: 0 };
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
  /** Set when playing the Daily Fold: the ISO date being played. */
  private dailyDate: string | null = null;
  /** Winning line length over par, set at win; null when par is unknown. */
  private winRatio: number | null = null;
  private winMedal = false;
  /** Fold Sense signals, accumulated per level. */
  private levelReveals = 0;
  private mirrorDeaths = 0;
  private totalDeaths = 0;
  private winSense = 0;
  /** The previous failed attempt, redrawn as a ghost on the next try. */
  private lastAttempt: Vec2[] | null = null;
  private revealOfferPill: Phaser.GameObjects.Container | null = null;
  private refillSheet: Phaser.GameObjects.Container | null = null;
  private webDailyEnd: Phaser.GameObjects.Container | null = null;

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

    this.dailyDate = data.daily ?? null;
    if (this.dailyDate) this.loadDaily(this.dailyDate);
    else this.loadLevel(data.levelIndex ?? 0);

    // The banner is always on now. The playfield inset already reserves its
    // strip, so it covers paper margin rather than anything you can touch.
    void Ads.showBanner();
  }

  /* --------------------------------------------------------------- levels */

  private loadLevel(index: number): void {
    this.levelIndex = ((index % LEVELS.length) + LEVELS.length) % LEVELS.length;
    this.installLevel(levelAt(this.levelIndex));
  }

  /** The Daily Fold: computed from the date, not looked up in LEVELS. */
  private loadDaily(dateISO: string): void {
    // For everything keyed off a level INDEX — ad gating, nothing else — the
    // daily counts as mid-game: past the tutorial grace, nothing special.
    this.levelIndex = Math.floor(LEVELS.length / 2);
    this.installLevel(dailyLevel(dateISO));
  }

  private installLevel(level: Level): void {
    this.level = level;

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
    this.lastAttempt = null;
    this.winRatio = null;
    this.winMedal = false;
    this.levelReveals = 0;
    this.mirrorDeaths = 0;
    this.totalDeaths = 0;
    this.winSense = 0;
    Audio.resetScale();
    this.ink.clearReveal();
    this.ink.clearGhost();
    this.resetToIdle();
    this.ink.drawLevel(walls, this.startPx, this.goalPx);
    this.clearSkipOffer();
    this.clearRevealOffer();
    this.closeRefillSheet();
    this.clearShareOffer();
    this.refreshHud();

    /*
     * The one deliberate tutorial line outside the tutorial. Level 6 is the
     * first generated maze — the first time walls are hidden in the fold —
     * and the Reveal button is the tool for exactly that. Say so, once, at
     * the moment it becomes true, and stop once the level is beaten.
     */
    if (this.levelIndex === 5 && !this.dailyDate && !Progress.hasCleared('l6')) {
      this.showHint('stuck? Reveal shows the walls folded from the far half', 900);
      this.time.delayedCall(7000, () => {
        if (this.phase !== 'won') this.hideHint();
      });
    }

    // A web visitor who already folded today lands on their result, not on a
    // replay they did not ask for.
    if (WEB_DAILY && this.dailyDate && Progress.hasDaily(this.dailyDate)) {
      this.showWebDailyEnd();
    } else if (WEB_DAILY && this.dailyDate) {
      this.showHint('one maze a day · the same for everyone', 900);
      this.time.delayedCall(6000, () => {
        if (this.phase !== 'won') this.hideHint();
      });
    }
  }

  /* ---------------------------------------------------------------- input */

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    Audio.unlock();

    // A modal sheet owns the screen; the board underneath must not react.
    if (this.refillSheet || this.webDailyEnd) return;

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
    this.fingerTravel = 0;
    this.lastFinger = touch;
    this.strokeStartedAt = this.time.now;
    this.attempts += 1;
    this.phase = 'drawing';

    // The stroke is anchored on the dot rather than under the finger, so the
    // ink always begins exactly where the level says it does.
    for (const gate of this.gates) gate.passed = false;
    this.ink.clearGhost();
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
      const hit = this.collision.firstHit(prev, cursor);
      const hitT = hit?.t ?? 0;
      // One long segment can reach both a wall and the goal. Whichever the
      // gesture arrived at first is what actually happened.
      if (goalT !== null && goalT < hitT) this.win(lerpPoint(prev, cursor, goalT));
      else this.fail(lerpPoint(prev, cursor, hitT), hit?.mirror ?? false);
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
    // Travel, not elapsed time. A finger resting on the glass must not drag
    // the cursor — and therefore the collision-tested stroke — with it.
    this.fingerTravel += dist(raw, this.lastFinger);
    this.lastFinger = raw;
    return this.pf.clampToDrawable(
      drawCursor(raw, {
        touch: this.touchInput,
        travelPx: this.fingerTravel,
        offsetY: METRICS.touchOffsetY,
        rampPx: METRICS.touchOffsetRampPx,
      })
    );
  }

  /* -------------------------------------------------------- state changes */

  private fail(contact: Vec2, mirrorDeath = false): void {
    this.recorder.pushExact(contact, this.time.now);
    this.phase = 'failed';
    this.activePointer = null;

    this.totalDeaths += 1;
    if (mirrorDeath) this.mirrorDeaths += 1;

    // Keep the corpse: the next idle board draws it as a ghost, so a death
    // teaches instead of just taxing. Frustration that informs brings the
    // player back; frustration that withholds sends them away.
    this.lastAttempt = [...this.recorder.points];

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

    /*
     * Escalating help, one offer at a time. Three deaths: point at the thing
     * they cannot see (the fold) — the reveal pill. Six: offer the way past —
     * the skip replaces the reveal offer. Never both; a stack of rescue
     * buttons reads as the game giving up on them.
     */
    if (
      this.attempts >= monetization.reveals.offerSkipAfterAttempts &&
      !this.skipPill &&
      !this.dailyDate // there is nothing to skip TO on the daily
    ) {
      this.clearRevealOffer();
      this.showSkipOffer();
    } else if (
      this.attempts >= monetization.reveals.offerRevealAfterAttempts &&
      !this.revealOfferPill &&
      !this.skipPill
    ) {
      this.showRevealOffer();
    }
  }

  private win(entry: Vec2): void {
    this.recorder.pushExact(entry, this.time.now);
    this.phase = 'won';
    this.activePointer = null;

    const elapsed = this.time.now - this.strokeStartedAt;
    if (this.dailyDate) {
      // The daily records its own ledger and unlocks nothing.
      Progress.recordDaily(this.dailyDate, elapsed, this.attempts);
      Progress.update({
        totalWins: Progress.data.totalWins + 1,
        winsSinceAd: Progress.data.winsSinceAd + 1,
      });
    } else {
      Progress.recordWin(this.level.id, this.levelIndex, elapsed, LEVELS.length);
    }

    /*
     * Par: the winning line measured against the validator's proved route.
     * Every completed level becomes a score to beat at zero content cost —
     * "1.83× par" is an invitation, "1.12× par" a brag. Generated levels
     * carry parPx precomputed; the five tutorials compute it on first win.
     */
    let lineLen = 0;
    for (let i = 1; i < this.recorder.points.length; i++) {
      lineLen += dist(this.recorder.points[i], this.recorder.points[i - 1]);
    }
    const par =
      this.level.parPx ??
      routeArc(this.level, this.pf, {
        cell: 6,
        hitRadius: METRICS.hitRadius,
        goalRadius: METRICS.goalRadius,
      })?.arc;
    this.winRatio = par && par > 0 ? lineLen / par : null;
    this.winMedal = this.winRatio !== null && this.winRatio <= MEDAL_RATIO;
    if (this.winMedal && !this.dailyDate) Progress.addMedal(this.level.id);

    // Fold Sense: score this win from real play signals, fold the profile
    // rating toward it.
    this.winSense = winScore({
      parRatio: this.winRatio,
      attempts: this.attempts,
      revealsUsed: this.levelReveals,
      mirrorDeathShare: this.totalDeaths === 0 ? 0 : this.mirrorDeaths / this.totalDeaths,
      foldExposure: foldExposure(this.level),
    });
    Progress.update({
      foldSense: nextProfileScore(Progress.data.foldSense, this.winSense),
    });

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
    this.showHint(
      WEB_DAILY && this.dailyDate ? 'tap to finish · come back tomorrow' : 'tap for the next fold',
      readyIn
    );
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
    // The previous attempt lingers as a ghost until the next stroke begins:
    // where it died is the one fact the player needs for the next plan.
    if (this.lastAttempt) this.ink.showGhost(this.lastAttempt);
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

    // One fold per day: leaving the daily goes home, tomorrow brings another.
    if (this.dailyDate) {
      if (WEB_DAILY) {
        // There is no home on the web — the end card is the destination.
        this.advancing = false;
        this.showWebDailyEnd();
        return;
      }
      this.scene.start('Menu');
      return;
    }
    if (next >= LEVELS.length) {
      this.scene.start('LevelSelect');
      return;
    }
    this.loadLevel(next);
  }

  /* --------------------------------------------------------------- reveal */

  /** Spend a reveal, or open the refill sheet when the stash is empty. */
  private async doReveal(): Promise<void> {
    if (this.phase === 'won') return;
    Haptics.tap();

    if (Progress.spendReveal()) {
      this.levelReveals += 1;
      this.ink.showReveal(this.mirrorBands, monetization.reveals.durationMs);
      this.refreshHud();
      return;
    }

    this.showRefillSheet();
  }

  /**
   * Out of reveals: the one contextual store moment in the game. Wherever the
   * rewarded unit exists it comes FIRST and is the only primary — reveals must
   * stay earnable, or watching the next ad stops being a fair deal — and the
   * pack sits beside it for whoever values their time differently. The pack
   * stays 'secondary' even when it is the only row: the purchase never gets
   * promoted just because the free path happens to be missing.
   */
  private showRefillSheet(): void {
    if (this.refillSheet) return;

    /*
     * Build the rows FIRST, and only rows that can actually do something.
     *
     * The rewarded row used to be unconditional, which put a dead primary
     * button in front of anyone the rewarded unit is not available to — the
     * whole web Daily build, where there is no AdMob at all. And when nothing
     * at all can be offered, a card whose only live control is "Not now" is
     * worse than saying the plain truth.
     */
    const pack = Iap.available ? Iap.revealPackProduct() : null;
    const offers: Array<{
      text: string;
      variant: 'primary' | 'secondary';
      press: () => void;
    }> = [];

    if (Ads.rewardedAvailable) {
      offers.push({
        text: 'Watch an ad · +1',
        variant: 'primary',
        press: () => void this.earnReveal(),
      });
    }
    if (pack) {
      const price = pack.priceString ? ` · ${pack.priceString}` : '';
      offers.push({
        text: `20 reveals${price}`,
        variant: 'secondary',
        press: () =>
          void (async () => {
            await Iap.buyRevealPack();
            this.refreshHud();
          })(),
      });
    }

    if (offers.length === 0) {
      this.flashHint('out of reveals — one more lands tomorrow');
      return;
    }

    const t = theme();
    const sheet = this.add.container(0, 0).setDepth(90);

    const dim = this.add
      .rectangle(BASE_WIDTH / 2, BASE_HEIGHT / 2, BASE_WIDTH, BASE_HEIGHT, t.ink, 0.22)
      .setInteractive();
    dim.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => this.closeRefillSheet());
    sheet.add(dim);

    const cw = pt(280);
    /*
     * Height derived from the row count rather than a literal per case — the
     * same lesson the menu stack learned when a hand-placed row got drawn off
     * the bottom of the canvas. Title gap, one gap per extra offer, the tail
     * gap to "Not now", its half height, and the bottom pad.
     */
    const ch = pt(58) + pt(48) * (offers.length - 1) + pt(46) + pt(16) + pt(28);
    const cy = BASE_HEIGHT / 2;
    const card = this.add.graphics();
    softShadow(card, BASE_WIDTH / 2 - cw / 2, cy - ch / 2, cw, ch, RADIUS.md, 0.8);
    card.fillStyle(t.paper, 1);
    roundRect(card, BASE_WIDTH / 2 - cw / 2, cy - ch / 2, cw, ch, RADIUS.md);
    sheet.add(card);

    sheet.add(
      label(this, BASE_WIDTH / 2, cy - ch / 2 + pt(24), 'Out of reveals', {
        size: TYPE.body,
        font: FONT.display,
        alpha: 0.8,
      }).setOrigin(0.5)
    );

    let rowY = cy - ch / 2 + pt(58);
    offers.forEach((offer, i) => {
      if (i > 0) rowY += pt(48);
      sheet.add(
        button(this, BASE_WIDTH / 2, rowY, offer.text, {
          width: cw - pt(32),
          height: pt(40),
          variant: offer.variant,
          size: TYPE.label,
          onPress: () => {
            this.closeRefillSheet();
            offer.press();
          },
        })
      );
    });

    rowY += pt(46);
    sheet.add(
      button(this, BASE_WIDTH / 2, rowY, 'Not now', {
        width: cw - pt(32),
        height: pt(32),
        variant: 'ghost',
        size: TYPE.label,
        onPress: () => this.closeRefillSheet(),
      })
    );

    this.refillSheet = sheet;
  }

  /**
   * The rewarded refill. The reveal is granted ONLY when the ad was actually
   * watched to the reward.
   *
   * This used to grant on anything that was not 'declined', which meant
   * 'unavailable' paid out too — and 'unavailable' covers no-fill, offline,
   * and every non-native build. On the web Daily that made this button an
   * infinite reveal dispenser that never showed an ad: the limit was not
   * generous, it was switched off. Reveals are the game's one currency, so
   * the payout has to cost what it claims to cost.
   *
   * The instinct behind the old code is still right — a control that visibly
   * does nothing reads as broken — so a missing ad now SAYS it is missing
   * rather than quietly paying. (`doSkip` keeps granting on 'unavailable' on
   * purpose: a skip spends no currency, so letting it through costs nothing.)
   */
  private async earnReveal(): Promise<void> {
    const result = await Ads.showRewarded('reveal');
    if (result === 'earned') {
      Progress.grantReveals(monetization.reveals.grantedPerRewarded);
      this.refreshHud();
      return;
    }
    // 'declined' means they closed the ad early and know why nothing arrived.
    if (result === 'unavailable') {
      this.flashHint('no ad ready just now — try again in a moment');
    }
  }

  private closeRefillSheet(): void {
    this.refillSheet?.destroy(true);
    this.refillSheet = null;
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

    // pt(62) up, NOT pt(34): the "tap for the next fold" hint is bottom-anchored
    // at the banner line right below, and at pt(34) the pill's lower half sat
    // on top of the hint's first line — two messages through each other.
    const pill = button(this, BASE_WIDTH / 2, BASE_HEIGHT - METRICS.bannerReserve - pt(62), 'Share this fold', {
      width: pt(190),
      height: pt(40),
      variant: 'secondary',
      size: TYPE.label,
      onPress: () => void this.shareCurrent(),
    });
    // An opaque paper backing under the translucent face, and a depth ABOVE
    // the win layer (30) and its wash (40): without the depth the figure was
    // drawn straight over the pill, dots through the label text.
    const backing = this.add.graphics();
    backing.fillStyle(theme().paper, 1);
    roundRect(backing, -pt(95), -pt(20), pt(190), pt(40), RADIUS.md);
    pill.addAt(backing, 0);
    pill.setDepth(50);
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
    if (this.sharing) return;
    this.sharing = true;
    Haptics.tap();

    try {
      /*
       * The DAILY shares a spoiler-safe TEXT result, Wordle-style. Everyone
       * plays the same maze today, and our drawn line IS the solution — so
       * the daily result carries the score of the run, never its geometry.
       * Text also pastes natively into the group chats where most puzzle
       * sharing actually happens; an image can't.
       */
      if (this.dailyDate) {
        await Share.shareText('Foldwing', this.dailyResultText());
        return;
      }

      const figure = Progress.figures[0];
      if (!figure) return;
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

  /** `Foldwing Daily #7 · ✕✕✅ · ⊙1 · 47s · Fold Sense 74 · 🔥3` */
  private dailyResultText(): string {
    const date = this.dailyDate!;
    const day =
      Math.round((Date.parse(date) - Date.parse('2026-08-01')) / 86400000) + 1;
    const result = Progress.data.daily[date];
    const seconds = Math.round((result?.ms ?? 0) / 1000);
    const time =
      seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : `${seconds}s`;

    const parts = [`Foldwing Daily #${day}`];
    // Tries and Fold Sense describe THIS session's run; on a revisit (played
    // earlier, reopened later) only the recorded time and streak are honest.
    if (this.phase === 'won') {
      const shownDeaths = Math.min(this.totalDeaths, 9);
      parts.push(`${'✕'.repeat(shownDeaths)}${this.totalDeaths > 9 ? '⋯' : ''}✅`);
      if (this.levelReveals > 0) parts.push(`⊙${this.levelReveals}`);
      parts.push(time, `Fold Sense ${this.winSense}`);
    } else {
      parts.push('✅', time);
    }
    const streak = Progress.dailyStreak(date);
    if (streak > 1) parts.push(`🔥${streak}`);
    return `${parts.join(' · ')}\n${APP_STORE_URL}`;
  }

  /* ---------------------------------------------------------- web daily */

  /**
   * The web daily's terminal screen: today is folded, here is your result,
   * here is where the other 300 folds live. 'Fold again' stays a ghost —
   * replaying is allowed (the recorded result never overwrites), it is just
   * not the point.
   */
  private showWebDailyEnd(): void {
    if (this.webDailyEnd) return;
    const t = theme();
    const sheet = this.add.container(0, 0).setDepth(90);

    const dim = this.add
      .rectangle(BASE_WIDTH / 2, BASE_HEIGHT / 2, BASE_WIDTH, BASE_HEIGHT, t.ink, 0.22)
      .setInteractive();
    sheet.add(dim);

    const cw = pt(300);
    const ch = pt(210);
    const cy = BASE_HEIGHT / 2 - pt(20);
    const card = this.add.graphics();
    softShadow(card, BASE_WIDTH / 2 - cw / 2, cy - ch / 2, cw, ch, RADIUS.md, 0.8);
    card.fillStyle(t.paper, 1);
    roundRect(card, BASE_WIDTH / 2 - cw / 2, cy - ch / 2, cw, ch, RADIUS.md);
    sheet.add(card);

    sheet.add(
      label(this, BASE_WIDTH / 2, cy - ch / 2 + pt(26), 'Folded for today', {
        size: TYPE.body,
        font: FONT.display,
        alpha: 0.85,
      }).setOrigin(0.5)
    );
    sheet.add(
      label(this, BASE_WIDTH / 2, cy - ch / 2 + pt(48), this.dailyResultText().split('\n')[0], {
        size: TYPE.label,
        alpha: 0.5,
      }).setOrigin(0.5)
    );

    let rowY = cy - ch / 2 + pt(82);
    sheet.add(
      button(this, BASE_WIDTH / 2, rowY, 'Share result', {
        width: cw - pt(32),
        height: pt(40),
        variant: 'secondary',
        size: TYPE.label,
        onPress: () => void Share.shareText('Foldwing', this.dailyResultText()),
      })
    );

    rowY += pt(48);
    sheet.add(
      button(this, BASE_WIDTH / 2, rowY, 'Get the app · 300 more folds', {
        width: cw - pt(32),
        height: pt(44),
        variant: 'primary',
        size: TYPE.label,
        onPress: () => window.open(APP_STORE_URL, '_blank'),
      })
    );

    rowY += pt(48);
    sheet.add(
      button(this, BASE_WIDTH / 2, rowY, 'Fold again', {
        width: cw - pt(32),
        height: pt(32),
        variant: 'ghost',
        size: TYPE.label,
        onPress: () => {
          this.closeWebDailyEnd();
          this.resetToIdle();
        },
      })
    );

    this.webDailyEnd = sheet;
  }

  private closeWebDailyEnd(): void {
    this.webDailyEnd?.destroy(true);
    this.webDailyEnd = null;
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

  /**
   * The contextual reveal: after a few deaths, point at the mechanic the
   * player is losing to. The eye button is passive; this is the game saying
   * "the walls you keep hitting are on the other side" at the exact moment
   * that sentence means something.
   */
  private showRevealOffer(): void {
    const y = BASE_HEIGHT - METRICS.bannerReserve - pt(34);
    this.revealOfferPill = button(this, BASE_WIDTH / 2, y, 'See the folded walls?', {
      width: pt(230),
      height: pt(40),
      variant: 'secondary',
      size: TYPE.label,
      onPress: () => {
        this.clearRevealOffer();
        void this.doReveal();
      },
    });
    this.revealOfferPill.setAlpha(0);
    this.tweens.add({ targets: this.revealOfferPill, alpha: 1, duration: 300 });
  }

  private clearRevealOffer(): void {
    if (!this.revealOfferPill) return;
    this.tweens.killTweensOf(this.revealOfferPill);
    this.revealOfferPill.destroy(true);
    this.revealOfferPill = null;
  }

  private async doSkip(): Promise<void> {
    Haptics.tap();
    // 'unavailable' skips anyway — this button used to swallow the tap
    // whenever no ad could load, which on a pre-review AdMob app is always,
    // and a control that visibly does nothing reads as a broken game.
    if ((await Ads.showRewarded('skip')) === 'declined') return;

    Progress.unlockThrough(this.levelIndex, LEVELS.length);
    this.clearSkipOffer();
    const next = this.levelIndex + 1;
    if (next >= LEVELS.length) this.scene.start('LevelSelect');
    else this.loadLevel(next);
  }

  /* ------------------------------------------------------------------ hud */

  private buildHud(): void {
    const t = theme();

    // On the web daily the page IS the game — there is no menu behind the
    // back button, so there is no back button.
    if (!WEB_DAILY) {
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
    }

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
    // Wide enough to SAY what it does. The original was an eye and a number —
    // legible as "some counter", not as the game's most valuable button. The
    // word costs pt(22) of width and buys the whole feature its discovery.
    const w = pt(96);
    const h = pt(34);
    const c = this.add.container(BASE_WIDTH - METRICS.inset.right - w / 2, pt(26));
    c.setDepth(50);

    const g = this.add.graphics();
    g.fillStyle(t.ink, 0.055);
    roundRect(g, -w / 2, -h / 2, w, h, RADIUS.pill);
    c.add(g);

    const eye = this.add.graphics();
    eye.lineStyle(pt(1.4), t.accent, 0.85);
    eye.strokeCircle(-pt(33), 0, pt(5));
    eye.fillStyle(t.accent, 0.85);
    eye.fillCircle(-pt(33), 0, pt(1.8));
    c.add(eye);

    c.add(
      label(this, -pt(6), 0, 'Reveal', {
        size: TYPE.label,
        alpha: 0.75,
      }).setOrigin(0.5)
    );

    this.revealCount = label(this, pt(33), 0, '', {
      size: TYPE.label,
      alpha: 0.55,
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
    this.titleText.setText(
      this.dailyDate ? this.level.name : `${this.levelIndex + 1}. ${this.level.name}`
    );

    // On a win the attempt counter's slot becomes the par verdict — one
    // number that turns every finished level into a score to come back for.
    // It steps up a type size for the moment, and turns gold with the medal.
    if (this.phase === 'won' && this.winRatio !== null) {
      const medal = this.winMedal ? ' · ◆' : '';
      this.attemptText
        .setText(`your line ${this.winRatio.toFixed(2)}× par${medal} · Fold Sense ${this.winSense}`)
        .setFontSize(`${TYPE.label}px`)
        .setColor(this.winMedal ? 'rgba(176,138,32,0.9)' : 'rgba(22,50,60,0.5)');
    } else {
      this.attemptText
        .setText(this.attempts > 0 ? `attempt ${this.attempts}` : '')
        .setFontSize(`${TYPE.micro}px`)
        .setColor('rgba(22,50,60,0.32)');
    }

    const n = Progress.reveals;
    this.revealCount.setText(n === Number.POSITIVE_INFINITY ? '∞' : `${n}`);
    // Dim only when the stash is empty AND there is no way to fill it — the
    // pack counts, so an empty stash still reads as live wherever it is buyable.
    const refillable = Ads.rewardedAvailable || Iap.available;
    this.revealPill.setAlpha(n > 0 || refillable ? 1 : 0.35);
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

  /**
   * A hint that answers a tap, so it appears at once and takes itself away.
   * `resetToIdle` would clear it eventually, but only on the next stroke —
   * a reply to a button press should not outlive the player's interest in it.
   */
  private flashHint(message: string): void {
    this.showHint(message, 0);
    this.time.delayedCall(3200, () => {
      if (this.phase !== 'won') this.hideHint();
    });
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
