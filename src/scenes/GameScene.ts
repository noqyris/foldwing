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
import { mirrorBands, obstacleRows } from '../core/Gates';
import { foldExposure, nextProfileScore, winScore } from '../core/FoldSense';
import { routeArc } from '../core/LevelValidator';
import { StrokeRecorder } from '../core/StrokeRecorder';
import { LEVELS, levelAt } from '../data/levels';
import type { Level } from '../data/types';
import { monetization, packSaving } from '../config/monetization';
import { Ads } from '../systems/Ads';
import { dailyLevel } from '../systems/Daily';
import { applyEntitlement, Iap } from '../systems/Iap';
import { APP_STORE_URL, WEB_DAILY } from '../systems/WebDaily';
import { Audio } from '../systems/Audio';
import { Haptics } from '../systems/Haptics';
import { Progress } from '../systems/Progress';
import { Rate } from '../systems/Rate';
import { Share } from '../systems/Share';
import { InkRenderer } from '../render/InkRenderer';
import { CHALLENGE, renderShareCard, shareCardOptions, shareText } from '../render/ShareCard';
import {
  MAX_REPLAY_ATTEMPTS,
  renderReplayVideo,
  replayVideoSupported,
  type RunAttempt,
} from '../render/ReplayVideo';
import { BASE_HEIGHT, BASE_WIDTH, METRICS, ms, pt, theme } from '../render/Theme';
import {
  button,
  FONT,
  label,
  RADIUS,
  roundRect,
  progressCard,
  setButtonSub,
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
  /**
   * The band the share row occupies, kept because the row is a container of
   * absolutely-placed pills and so reports no size of its own.
   */
  private shareRowRect: { left: number; right: number; top: number; bottom: number } | null =
    null;
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
  /**
   * Every attempt on this level, in order — the material the replay video is
   * made of.
   *
   * Held in memory for the level being played and never saved. A run is a
   * dozen strokes where a figure is one, and `Progress` already keeps a hundred
   * and twenty figures in a plist that is parsed at every launch. The share
   * that wants this is on the win screen, one tap after the last attempt, so
   * memory is where it belongs.
   */
  private runAttempts: RunAttempt[] = [];
  /** A teaching line that outlives a failed or abandoned attempt. */
  private hintSticky = false;
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

    /*
     * Learn the pack's price now, while nobody is waiting on it.
     *
     * This scene owns the only surface that sells it — the out-of-reveals
     * sheet — and that sheet is built synchronously the instant the stash hits
     * zero. Fetching from here rather than at launch keeps StoreKit off the
     * cold path (see Iap.connect) while still leaving seconds of slack before
     * any price is read.
     */
    void Iap.warm();
  }

  /* --------------------------------------------------------------- levels */

  private loadLevel(index: number): void {
    this.levelIndex = ((index % LEVELS.length) + LEVELS.length) % LEVELS.length;
    this.installLevel(levelAt(this.levelIndex));
  }

  /** The Daily Fold: computed from the date, not looked up in LEVELS. */
  private loadDaily(dateISO: string): void {
    // Mid-ladder, so anything reading the index treats the daily as a real
    // level rather than a tutorial one. NOT what the ad gate reads — see
    // `onboardingIndex`.
    this.levelIndex = Math.floor(LEVELS.length / 2);
    this.installLevel(dailyLevel(dateISO));
  }

  /**
   * How far into the game the PLAYER is, which is what the onboarding ad grace
   * is actually about — not which level happens to be on screen.
   *
   * The daily used to hand the ad gate its own mid-ladder index of 150, sailing
   * straight past `interstitialFromLevel: 8`. On a fresh install that meant:
   * win level 1, win level 2, tap Daily fold, win it — and an interstitial
   * fired on the way out, about ninety seconds into someone's first session.
   * The grace exists precisely for the player who has not yet felt the hook,
   * and the Daily is the feature aimed at exactly that player.
   */
  private get onboardingIndex(): number {
    return this.dailyDate ? Progress.data.unlockedIndex : this.levelIndex;
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
    this.mirrorBands = mirrorBands(walls, this.pf.axisX, this.pf.x);

    /*
     * One gate per obstacle ROW — the walls facing the player and the bands its
     * reflection has to clear, deduped by height. Crossing a row without dying
     * is what earns a note, so a level plays as a rising phrase and the player
     * hears how far up they got before they look.
     *
     * The rows come from `core/Gates` rather than being computed here, because
     * the replay video has to sound like the game: two definitions of where a
     * row is would put the notes of a shared clip somewhere other than where
     * the player heard them.
     */
    this.gates = obstacleRows(walls, this.mirrorBands).map((mid) => ({
      mid,
      passed: false,
    }));

    this.attempts = 0;
    this.advancing = false;
    this.lastAttempt = null;
    this.runAttempts = [];
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
     * Two deliberate lines, each said once at the moment it becomes true.
     *
     * Level 1 is the whole of first-run onboarding: the game asks for a gesture
     * nobody has made in another game, and until this line existed it asked for
     * it silently. A player who does not discover that they must press the DOT
     * — not anywhere on the paper — has no way in at all.
     *
     * Level 6 is the first generated maze, the first time walls are hidden in
     * the fold, and Reveal is the tool for exactly that.
     */
    if (!this.dailyDate && this.levelIndex === 0 && !Progress.hasCleared('l1')) {
      this.showHint('press the dot and draw to the ring', 900, true);
      this.time.delayedCall(8000, () => {
        if (this.phase === 'idle') this.hideHint();
      });
    }

    if (this.levelIndex === 5 && !this.dailyDate && !Progress.hasCleared('l6')) {
      this.showHint('stuck? Reveal shows the walls folded from the far half', 900, true);
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
      // Nor does the header row. The back chevron and the reveal pill live up
      // there, and a tap that means "leave" or "spend a reveal" was also being
      // read as "next level" — so backing out flashed the next maze first, and
      // tapping the counter advanced AND then spent a reveal on the new level.
      if (pointer.y < METRICS.inset.top + pt(10)) return;
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

  /**
   * Keep the attempt that just ended, normalized, for the replay.
   *
   * Normalized rather than in pixels for the same reason saved figures are: the
   * video is rendered at 1080×1920, not at the playfield's size, and the two
   * have different proportions.
   *
   * Bounded. A level someone is stuck on can run to dozens of attempts and the
   * replay only shows the last few — keeping the rest would be memory held for
   * frames nobody will ever see.
   */
  private recordAttempt(died: boolean): void {
    if (this.recorder.points.length < 2) return;
    const t0 = this.recorder.times[0] ?? 0;
    this.runAttempts.push({
      points: this.recorder.points.map((p) => this.pf.toNormalized(p)),
      times: this.recorder.times.map((t) => t - t0),
      died,
    });
    if (this.runAttempts.length > MAX_REPLAY_ATTEMPTS) {
      this.runAttempts.splice(0, this.runAttempts.length - MAX_REPLAY_ATTEMPTS);
    }
  }

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
    this.recordAttempt(true);

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
      // The daily unlocks nothing; its ledger is written below, once the score
      // that belongs in it exists.
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
    // The daily has no card to carry a medal and no list to keep it in, so it
    // does not claim one. The HUD reads this same flag — showing a gold mark
    // that is discarded on the spot is worse than showing none.
    if (this.winMedal && this.dailyDate) this.winMedal = false;
    if (this.winMedal) Progress.addMedal(this.level.id);

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

    // Deaths, not attempts: an abandoned stroke is not a failure anywhere else
    // in this game, and this record is written once and never recomputed.
    if (this.dailyDate) {
      Progress.recordDaily(this.dailyDate, {
        ms: elapsed,
        deaths: this.totalDeaths,
        foldSense: this.winSense,
      });
    }

    // The winning stroke closes the run: the replay is every attempt in order,
    // and this is the one it ends on.
    this.recordAttempt(false);

    // Keep the figure. Normalized, with its timing and the maze it was drawn
    // through, so the whole picture can be redrawn on any device at any size —
    // including full size in someone else's feed.
    const t0 = this.recorder.times[0] ?? 0;
    Progress.addFigure({
      levelId: this.level.id,
      levelName: this.level.name,
      points: this.recorder.points.map((p) => this.pf.toNormalized(p)),
      times: this.recorder.times.map((t) => t - t0),
      ms: elapsed,
      at: Date.now(),
      walls: this.level.walls,
      start: this.level.start,
      goal: this.level.goal,
    });

    this.ink.presentWin(this.recorder.points, this.recorder.times);
    Audio.chime();
    this.clearSkipOffer();
    // The reveal offer has to go too. It sets no depth, so it paints over the
    // share pill's opaque backing, and it lies: tapping it reveals nothing —
    // clearRevealOffer is the only thing on the win path that removes it, and
    // resetToIdle (which does) does not run until the next level.
    this.clearRevealOffer();

    /*
     * One number for both: the tap gate and the prompt that invites the tap.
     * Derived rather than written twice, because when they drift the game shows
     * "tap for the next fold" during a window where taps are still being
     * dropped, and the player's first, obedient tap does nothing.
     */
    const readyIn = ms(METRICS.winHoldMs) + ms(METRICS.winSettleMs) + ms(250);
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
      this.onboardingIndex,
      Progress.data.winsSinceAd
    );
    if (Rate.shouldAsk(adWillShow)) {
      this.time.delayedCall(readyIn + 400, () => {
        // Still on the win screen, and no ad on the way. loadLevel puts the
        // phase back to 'idle' and advance() sets `advancing` synchronously, so
        // between them these two cover "they already tapped through". The app
        // gets ONE lifetime prompt (the OS throttles to about three a year);
        // spending it on top of the next maze or an interstitial wastes it
        // permanently. Skipping simply asks after the next win.
        if (this.phase !== 'won' || this.advancing) return;
        void Rate.ask();
      });
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
    if (!this.hintSticky) this.hideHint();
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

    if (Ads.wouldShowInterstitial(this.onboardingIndex, Progress.data.winsSinceAd)) {
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
    /*
     * The top of the ladder. Three hundred mazes is a real thing to have
     * finished, and silently returning someone to the grid says nothing
     * happened. The Menu is the right destination — it is where the Daily Fold
     * and the gallery live, which is what the game is for after the campaign.
     */
    if (next >= LEVELS.length) {
      this.registry.set('campaignComplete', true);
      this.scene.start('Menu');
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
    const packs = Iap.available ? Iap.revealPacks() : [];
    const base = packs[0];

    const offers: Array<{
      text: string;
      sub?: string;
      variant: 'primary' | 'secondary';
      /** Set on rows whose caption can still change — see the warm below. */
      priced?: string;
      press: () => void;
    }> = [];

    if (Ads.rewardedAvailable) {
      offers.push({
        // Say what lands. "+1" alone left the player to infer the unit from a
        // sheet whose whole subject is reveals, next to rows that spell theirs
        // out — the free option read as the vaguer of the two.
        text: 'Watch an ad',
        sub: '+1 reveal, free',
        variant: 'primary',
        press: () => void this.earnReveal(),
      });
    }

    /*
     * The ladder: count on the face, price and what it saves underneath.
     *
     * Two lines rather than one long caption. `30 reveals · $1.99 · save 33%`
     * is a run-on that the eye has to parse before it can compare rows, and
     * comparing rows is the only thing this sheet is for. Split, the counts
     * line up down the left of the card and the value story sits quietly under
     * each one.
     */
    for (const pack of packs) {
      const saving = base ? packSaving(base, pack) : null;
      offers.push({
        text: `${pack.count} reveals`,
        sub: [pack.priceString, saving === null ? '' : `save ${saving}%`]
          .filter(Boolean)
          .join(' · '),
        variant: 'secondary',
        priced: pack.id,
        press: () =>
          void (async () => {
            await Iap.buyRevealPack(pack.id);
            this.refreshHud();
          })(),
      });
    }

    /*
     * Remove Ads is the LAST rung, not a separate product on another screen.
     *
     * The ladder reads 10, 20, 30, then reveals that never run out — each rung
     * better value per reveal than the one above it, ending somewhere no pack
     * can reach. That makes the permanent unlock the obvious end of the row
     * rather than something the player has to go and find, and it is the
     * highest-value conversion in the game. This is also the one moment it
     * answers a question the player is actually asking: they are out of
     * reveals.
     *
     * Named "Remove ads", the SAME name it has on the menu and — this is the
     * part that decides it — the same name Apple prints in the purchase
     * confirmation. It read "Unlimited reveals" here for one build, which is a
     * better headline on a sheet about reveals and was still wrong: one product
     * wearing two names at one price looks like two products, and the player
     * finds out which it was in the system dialog, at the moment they pay. What
     * it gives goes on the second line, where there is room to say all of it.
     *
     * Owners never see it: unlimited reveals means `spendReveal` always
     * succeeds and this sheet never opens.
     */
    const removeAds = Iap.available ? Iap.removeAdsProduct() : null;
    if (removeAds && !Progress.data.adsRemoved) {
      offers.push({
        text: 'Remove ads',
        sub: [removeAds.priceString, 'unlimited reveals, no ads'].filter(Boolean).join(' · '),
        variant: 'secondary',
        priced: removeAds.id,
        press: () =>
          void (async () => {
            if (await Iap.buyRemoveAds()) applyEntitlement(true);
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

    /*
     * Laid out from a running cursor rather than a formula per case.
     *
     * The card grew from two rows to five when the packs became a ladder, and
     * every row now carries a second line. A single arithmetic expression for
     * the height stopped being checkable at that point — the menu stack learned
     * the same lesson when a hand-placed row got drawn off the bottom of the
     * canvas. Measure the rows, then draw the card around them.
     */
    const cw = pt(292);
    const ROW = pt(50);
    const GAP = pt(9);
    const TITLE_TO_ROWS = pt(30);
    const ROWS_TO_TAIL = pt(16);
    const TAIL = pt(30);
    const PAD_TOP = pt(26);
    const PAD_BOTTOM = pt(20);

    const rowsHeight = offers.length * ROW + (offers.length - 1) * GAP;
    const ch =
      PAD_TOP + pt(20) + TITLE_TO_ROWS + rowsHeight + ROWS_TO_TAIL + TAIL + PAD_BOTTOM;
    const cy = BASE_HEIGHT / 2;
    const top = cy - ch / 2;

    const card = this.add.graphics();
    softShadow(card, BASE_WIDTH / 2 - cw / 2, top, cw, ch, RADIUS.md, 0.8);
    card.fillStyle(t.paper, 1);
    roundRect(card, BASE_WIDTH / 2 - cw / 2, top, cw, ch, RADIUS.md);
    sheet.add(card);

    sheet.add(
      label(this, BASE_WIDTH / 2, top + PAD_TOP + pt(10), 'Out of reveals', {
        size: TYPE.body,
        font: FONT.display,
        alpha: 0.8,
      }).setOrigin(0.5)
    );

    const pricedRows = new Map<string, Phaser.GameObjects.Container>();
    let rowY = top + PAD_TOP + pt(20) + TITLE_TO_ROWS + ROW / 2;
    for (const offer of offers) {
      const row = button(this, BASE_WIDTH / 2, rowY, offer.text, {
        width: cw - pt(30),
        height: ROW,
        variant: offer.variant,
        size: TYPE.label,
        sub: offer.sub || undefined,
        onPress: () => {
          this.closeRefillSheet();
          offer.press();
        },
      });
      if (offer.priced) pricedRows.set(offer.priced, row);
      sheet.add(row);
      rowY += ROW + GAP;
    }

    rowY += ROWS_TO_TAIL - GAP;
    sheet.add(
      button(this, BASE_WIDTH / 2, rowY, 'Not now', {
        width: cw - pt(30),
        height: TAIL,
        variant: 'ghost',
        size: TYPE.label,
        onPress: () => this.closeRefillSheet(),
      })
    );

    this.refillSheet = sheet;

    /*
     * Fill the price in if the store has not answered yet.
     *
     * `Iap.warm()` is fired from create(), so by the time anyone has spent two
     * reveals the price is normally already known and this does nothing. It
     * covers the one case that is not: a player who empties the stash within a
     * second or two of the level opening, on a slow connection.
     */
    /*
     * Fill the prices in if the store has not answered yet.
     *
     * `Iap.warm()` is fired from create(), so by the time anyone has spent two
     * reveals the prices are normally already known and this does nothing. It
     * covers the one case that is not: a player who empties the stash within a
     * second or two of the level opening, on a slow connection.
     *
     * Rebuilt from the same expressions the rows were built from, so a caption
     * that changes here cannot drift from one that did not.
     */
    if (offers.some((o) => o.priced && !o.sub)) {
      void (async () => {
        await Iap.warm();
        if (this.refillSheet !== sheet) return; // they closed it meanwhile

        const fresh = Iap.revealPacks();
        const freshBase = fresh[0];
        for (const pack of fresh) {
          if (!pack.priceString) continue;
          const saving = freshBase ? packSaving(freshBase, pack) : null;
          setButtonSub(
            pricedRows.get(pack.id) ?? null,
            [pack.priceString, saving === null ? '' : `save ${saving}%`]
              .filter(Boolean)
              .join(' · ')
          );
        }

        const unlock = Iap.removeAdsProduct();
        if (unlock?.priceString) {
          setButtonSub(
            pricedRows.get(unlock.id) ?? null,
            `${unlock.priceString} · unlimited reveals, no ads`
          );
        }
      })();
    }
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
    /*
     * Never over an open sheet. The reveal pill answers its own pointer events,
     * so a player who jabs it during the 400ms fail flash opens the
     * out-of-reveals sheet a fraction of a second before this fires — and a
     * full-screen interstitial lands on top of a store sheet the player opened.
     * That is also the exact geometry AdMob disables serving over.
     */
    if (this.refillSheet || this.webDailyEnd) return;
    /*
     * Never over a live rescue offer, and the reason is money before manners.
     *
     * "See the folded walls?" and "Skip this fold" are rewarded-video asks, and
     * a rewarded impression is worth about three times an interstitial one —
     * roughly $15-25 eCPM against a single-digit interstitial, at near-total
     * fill. Burning the moment on the cheaper format does not just annoy
     * somebody who is already stuck; it converts the best-paying inventory in
     * the game into the worst-paying, and takes the retention lift that a
     * rewarded rescue at a difficulty spike is measured to give with it.
     *
     * The counts are arranged so this is the normal case, not the exception:
     * the reveal offer lands at three deaths and the skip at six, and the
     * interstitial cannot arm until eight.
     */
    if (this.revealOfferPill || this.skipPill) return;
    if (!Ads.wouldShowOnAttempt(this.onboardingIndex, Progress.data.attemptsSinceAd)) return;

    const shown = await Ads.showInterstitial();
    // Only spend the counter when an ad actually rendered; on no-fill it stays
    // armed so the next eligible retry tries again.
    if (shown) Progress.update({ attemptsSinceAd: 0 });
  }

  /**
   * Where a floating pill sits: `lift` above the banner line, but never on top
   * of the start marker.
   *
   * All three pills — reveal, skip, share — were anchored to the banner and
   * nothing else, and the start dot is at the bottom of almost every maze
   * because the player draws upward. So the two collided by default: "See the
   * folded walls?" was drawn through the dot, and the win screen's "Share this
   * fold" covered it outright. Not a cosmetic overlap either — the start is the
   * one thing on the board a player has to be able to find and touch.
   *
   * Lifting rather than dropping, because below the start there is only the
   * banner. Clamped so a maze that starts high cannot push a pill up into the
   * playfield.
   */
  private pillY(lift: number): number {
    const anchored = BASE_HEIGHT - METRICS.bannerReserve - lift;
    const clear = this.startPx.y - METRICS.startRadius * 2.4 - pt(28);
    return Math.max(BASE_HEIGHT * 0.62, Math.min(anchored, clear));
  }

  /* ---------------------------------------------------------------- share */

  /**
   * The growth loop, offered at the only moment it can work: the player is
   * looking at something they just made and are pleased with.
   */
  private showShareOffer(delay: number): void {
    this.clearShareOffer();

    /*
     * TWO shares, because they are two different things to send.
     *
     * The replay is the growth loop: a clip of the run — the misses, then the
     * line that worked — is legible to somebody who has never opened the game
     * and shows the mechanic in six seconds, which no still image can. The
     * picture is the personal one: a figure you made, sent to one friend, and
     * it pastes into a chat as an image rather than something to press play on.
     *
     * Side by side rather than stacked: the pill row already sits above the
     * start marker (see pillY) and a second row would either cover it or push
     * into the hint at the banner line.
     */
    const canReplay = replayVideoSupported() && this.runAttempts.length > 0;
    const w = canReplay ? pt(146) : pt(190);
    const gap = pt(8);
    const y = this.pillY(pt(62));
    const xs = canReplay
      ? [BASE_WIDTH / 2 - (w + gap) / 2, BASE_WIDTH / 2 + (w + gap) / 2]
      : [BASE_WIDTH / 2];

    const row = this.add.container(0, 0).setDepth(50);
    const make = (x: number, text: string, press: () => void): void => {
      const pill = button(this, x, y, text, {
        width: w,
        height: pt(40),
        variant: 'secondary',
        size: TYPE.label,
        onPress: press,
      });
      // An opaque paper backing under the translucent face: without it the win
      // figure is drawn straight through the pill, dots through the label.
      const backing = this.add.graphics();
      backing.fillStyle(theme().paper, 1);
      roundRect(backing, -w / 2, -pt(20), w, pt(40), RADIUS.md);
      pill.addAt(backing, 0);
      row.add(pill);
    };

    if (canReplay) {
      make(xs[0], 'Share the replay', () => void this.shareReplay());
      make(xs[1], 'Share this fold', () => void this.shareCurrent());
    } else {
      make(xs[0], 'Share this fold', () => void this.shareCurrent());
    }

    row.setAlpha(0);
    this.sharePill = row;
    this.shareRowRect = {
      left: xs[0] - w / 2,
      right: xs[xs.length - 1] + w / 2,
      top: y - pt(20),
      bottom: y + pt(20),
    };

    /*
     * Fully opaque BEFORE taps go live, not at the same moment.
     *
     * `overSharePill` deliberately ignores a row under half alpha, so an
     * invisible control cannot be pressed. But the fade used to start exactly
     * when the advance gate opened, so for the ~150ms it took to cross that
     * threshold a reach for the button was read as "next level" — and then the
     * button's own pointerup still fired, landing the player on the next maze
     * with a share sheet for the figure they had just left. Starting the fade
     * earlier closes the window from the other side, without loosening the
     * alpha rule that keeps an invisible pill untappable.
     */
    this.tweens.add({
      targets: row,
      alpha: 1,
      delay: Math.max(0, delay - ms(300)),
      duration: ms(300),
    });
  }

  private clearShareOffer(): void {
    this.shareRowRect = null;
    if (!this.sharePill) return;
    this.tweens.killTweensOf(this.sharePill);
    this.sharePill.destroy(true);
    this.sharePill = null;
  }

  private overSharePill(pointer: Phaser.Input.Pointer): boolean {
    const row = this.sharePill;
    const rect = this.shareRowRect;
    if (!row || !rect || row.alpha < 0.5) return false;
    return (
      pointer.x >= rect.left &&
      pointer.x <= rect.right &&
      pointer.y >= rect.top &&
      pointer.y <= rect.bottom
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
      const dataUrl = renderShareCard(figure, shareCardOptions(figure));
      if (!dataUrl) return;
      await Share.shareFigure({
        dataUrl,
        title: 'My foldwing',
        text: shareText(figure),
        fileName: `foldwing-${figure.levelId}-${figure.at}.png`,
      });
    } finally {
      this.sharing = false;
    }
  }

  /**
   * Send the run as a video: the misses, then the line that worked.
   *
   * Rendering is not instant — a few hundred frames go through the hardware
   * encoder — so the button says what it is doing rather than appearing to
   * hang. Anything that goes wrong falls back to nothing rather than to a
   * silent failure: `sharing` is cleared and the hint says so.
   */
  private async shareReplay(): Promise<void> {
    if (this.sharing) return;
    this.sharing = true;
    Haptics.tap();

    const figure = Progress.figures[0];
    const attempts = this.runAttempts;
    if (!figure || attempts.length === 0) {
      this.sharing = false;
      return;
    }

    const progress = progressCard(this, 'Folding your replay');
    try {
      const blob = await renderReplayVideo(
        {
          figure,
          attempts,
          caption: `${figure.levelName} · ${(figure.ms / 1000).toFixed(1)}s`,
          challenge: CHALLENGE,
        },
        (p) => progress.setProgress(p)
      );

      if (!blob) {
        progress.destroy();
        this.flashHint('could not build the replay — the picture still works');
        return;
      }

      progress.destroy();
      await Share.shareVideo({
        blob,
        title: 'My foldwing',
        text: shareText(figure),
        fileName: `foldwing-${figure.levelId}-${figure.at}.mp4`,
      });
    } finally {
      progress.destroy();
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
    /*
     * Clear the win furniture first. The end card dims the board to 22%, which
     * is not enough to hide anything: the "Share this fold" pill (depth 50) and
     * the "tap to finish" hint stayed perfectly readable under a sheet at depth
     * 90, offering a second, different share right next to the card's own.
     */
    this.clearShareOffer();
    this.clearRevealOffer();
    this.clearSkipOffer();
    this.hideHint();
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
          /*
           * A fresh run, not a continuation. resetToIdle alone left `attempts`,
           * `totalDeaths`, `mirrorDeaths` and `levelReveals` carrying the
           * finished run's totals, so a replay's Fold Sense was scored against
           * the previous attempt's history and the escalation ladder could open
           * with a rescue offer on the first stroke.
           */
          this.attempts = 0;
          this.totalDeaths = 0;
          this.mirrorDeaths = 0;
          this.levelReveals = 0;
          this.winRatio = null;
          this.winMedal = false;
          this.winSense = 0;
          this.lastAttempt = null;
          this.ink.clearGhost();
          Audio.resetScale();
          this.resetToIdle();
          this.refreshHud();
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
    this.skipPill = button(this, BASE_WIDTH / 2, this.pillY(pt(34)), 'Watch ad to skip this fold', {
      width: pt(210),
      height: pt(40),
      variant: 'secondary',
      size: TYPE.label,
      onPress: () => void this.doSkip(),
    });
    this.skipPill.setAlpha(0);
    this.tweens.add({ targets: this.skipPill, alpha: 1, duration: ms(300) });
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
    this.revealOfferPill = button(this, BASE_WIDTH / 2, this.pillY(pt(34)), 'See the folded walls?', {
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
    this.tweens.add({ targets: this.revealOfferPill, alpha: 1, duration: ms(300) });
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

    /*
     * pt(55), not pt(47).
     *
     * This slot was drawn for "attempt 3" — two words at micro size — and the
     * win verdict later moved in at a full type size up. At pt(47) that line
     * spans base y 79-109 while the Reveal pill occupies 18-86, so the two
     * genuinely collided: seven pixels of vertical overlap, and the verdict ran
     * 125px into the pill's column. Nothing was unreadable, which is why it read
     * as "cramped" rather than "broken".
     *
     * pt(55) puts it at 94-126. Clear of the pill above by 8px, and clear below
     * of everything a level can draw: measured across all 300 mazes, the
     * highest wall sits at base y 231 and the highest goal ring begins at 135.
     */
    this.attemptText = this.add
      .text(BASE_WIDTH / 2, pt(55), '', {
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
      this.tweens.add({ targets: c, scale: 0.93, duration: ms(90), ease: 'Quad.easeOut' });
    });

    const onUp = (p: Phaser.Input.Pointer): void => {
      if (!armed) return;
      armed = false;
      this.tweens.add({ targets: c, scale: 1, duration: ms(280), ease: 'Back.easeOut' });
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

    /*
     * On a win the attempt counter's slot becomes the verdict on the line —
     * what turns every finished level into a score to come back for. It steps
     * up a type size for the moment, and turns gold with the medal.
     *
     * Written in words, because the version that was not could not be read.
     * `your line 1.12× par ◆ · Fold Sense 48` asked the player to know that
     * "par" is the shortest proved route through the maze, to convert a bare
     * ratio into a sense of how well they did, to guess what a lone ◆ means,
     * and to guess what 48 is out of. Reported by the author of the line, who
     * did not recognise it either.
     *
     * TWO FACTS, NOT THREE, and the room decides it. The band this line lives
     * in runs from the playfield's top edge at base y 88 to the highest thing
     * any of the 300 mazes draws — a goal ring beginning at 135. Forty-seven
     * pixels: one line, once. Three facts filled 565px of a 702px field and
     * read as a ribbon of text rather than a verdict.
     *
     * Fold Sense is the one that leaves, and not only because it is longest.
     * It is a rating averaged over recent wins, so it barely moves from one
     * level to the next — low information at exactly the moment the player is
     * looking at something else. It belongs where a profile stat belongs, and
     * it is already there: the menu chip reads `Fold Sense 61/100` with the
     * whole width to itself.
     */
    if (this.phase === 'won' && this.winRatio !== null) {
      /*
       * ❖, a diamond fleuron — a printer's ornament, which is the right
       * family of mark for a game made of ink on paper. The ◆ it replaces is a
       * solid black diamond: at this size it out-weighed every word next to it
       * and read as a bullet rather than an award. Checked against the
       * alternatives rendered in the real UI font, where ● was rejected for
       * being the same shape as the start dot and the open forms for being too
       * light to read as something earned.
       */
      const medal = this.winMedal ? '❖ medal · ' : '';
      /*
       * Par is the validator's proved route, and a human CAN come in under it:
       * that route is planned on a 6px grid with clearance for a finger, and a
       * steady hand cuts corners tighter than it does. So a negative percentage
       * is reachable, and "-3% over the best line" is nonsense — at or under
       * par the line simply is the best one.
       */
      const over = Math.round((this.winRatio - 1) * 100);
      const verdict = over <= 0 ? 'the best line there is' : `${over}% over the best line`;
      this.attemptText
        .setText(`${medal}${verdict}`)
        .setFontSize(`${TYPE.label}px`)
        .setColor(this.winMedal ? 'rgba(176,138,32,0.9)' : 'rgba(22,50,60,0.5)');
    } else {
      /*
       * Idle on a level already beaten shows the time to beat. `bestMs` was
       * written on every win and read by nothing — a stored score with no
       * scoreboard. The attempt slot is empty at this moment anyway, and a
       * personal best sitting there turns a replay into a race against the only
       * opponent the game has.
       */
      const best = this.dailyDate ? undefined : Progress.data.bestMs[this.level.id];
      const idle =
        best !== undefined ? `best ${(best / 1000).toFixed(1)}s` : '';
      this.attemptText
        .setText(this.attempts > 0 ? `attempt ${this.attempts}` : idle)
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

  /**
   * @param sticky Survive `resetToIdle`. The two teaching lines need this: they
   *   were budgeted eight and seven seconds and got about three, because
   *   resetToIdle hides the hint and it runs at the end of EVERY abandoned
   *   stroke and every fail flash. A first-timer's first act is to lift a
   *   finger short of the ring, which deleted "press the dot and draw to the
   *   ring" before they had read it; level 6 deleted the line explaining Reveal
   *   at the first death, which is the moment it becomes true.
   */
  private showHint(message: string, delay: number, sticky = false): void {
    this.hintSticky = sticky;
    this.hintText.setText(message);
    this.tweens.killTweensOf(this.hintText);
    this.tweens.add({
      targets: this.hintText,
      alpha: 1,
      delay,
      duration: ms(300),
      ease: 'Quad.easeOut',
    });
  }

  private hideHint(): void {
    this.hintSticky = false;
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
