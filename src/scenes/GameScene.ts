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
 * pattern ad networks disable ad serving for. Two axes must both agree (see
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
import { routeArc, validateLevel } from '../core/LevelValidator';
import {
  ghostHeadLow,
  rescueOffer,
  rescueSpot,
  skipDrawnFree,
  type RescueSpot,
  type RevealOfferKind,
} from '../core/Rescue';
import { nearMissLine, routeFieldJob, type RouteField, type RouteFieldJob } from '../core/RouteProgress';
import { StrokeRecorder } from '../core/StrokeRecorder';
import { DangerTracker, Proximity } from '../core/Proximity';
import { lineLength, lineRatio, nextStarLine, PaceMeter, starsFor } from '../core/Stars';
import { weekStrip } from '../core/Streak';
import { chapterBeads, chapterName, nextMark, type Bead } from '../core/Chapters';
import { CHAPTER_SIZE, LEVELS, levelAt, TUTORIAL_LEVELS } from '../data/levels';
import type { Level } from '../data/types';
import { monetization } from '../config/monetization';
import { Ads } from '../systems/Ads';
import { dailyLevel, todayISO } from '../systems/Daily';
import { GameCenter } from '../systems/GameCenter';
import { Nudges, type NudgePermission } from '../systems/Nudges';
import { Iap } from '../systems/Iap';
import { grantNotice, showStoreSheet, type StoreHooks } from '../render/StoreSheet';
import { APP_STORE_URL, WEB_DAILY } from '../systems/WebDaily';
import { Audio } from '../systems/Audio';
import { Haptics } from '../systems/Haptics';
import { Music } from '../systems/Music';
import {
  type GrantEvent,
  Progress,
  streakSets,
  type WinBefore,
  type WinOutcome,
} from '../systems/Progress';
import { clock } from '../systems/NudgePlan';
import { Rate } from '../systems/Rate';
import { MENU_STREAK_FROM } from './MenuScene';
import {
  settlesWithin,
  Share,
  SHARE_DISMISS_WAIT_MS,
  SHARE_QUIET_MS,
  shareFileName,
} from '../systems/Share';
import { afterFrames, InkRenderer, PRINT_MS } from '../render/InkRenderer';
import { warmLevels } from './LevelSelectScene';
import {
  dailyNo,
  deathTagText,
  furthestPct,
  meterIdle,
  PLAY_HUD,
  PlayHud,
  titleWords,
  trayWords,
  type PlayHudLayout,
} from '../render/PlayHud';
import { icon } from '../render/Icons';
import { bakedPanel, paintPanel } from '../render/Baked';
import { canvasInsets, NO_INSETS, type Insets } from '../render/SafeArea';
import { CHALLENGE, renderShareCard, shareCardOptions, shareText } from '../render/ShareCard';
import {
  MAX_REPLAY_ATTEMPTS,
  REPLAY_CANCEL_AFTER_MS,
  REPLAY_CEILING_MS,
  renderReplayVideo,
  replayVideoSupported,
  type RunAttempt,
} from '../render/ReplayVideo';
import {
  fitCaption,
  flyOut,
  onControl,
  RESULT_BEAT,
  resultChapter,
  resultFrameScale,
  resultRows,
  showResult,
  TURN_ABOVE,
  type CardPlace,
  type ResultChip,
  type ResultNext,
  type ResultRows,
  type ResultSpec,
  type ResultSquare,
  type TapBox,
  type WinCard,
} from '../render/ResultCard';
import {
  bannerLine,
  BASE_HEIGHT,
  BASE_WIDTH,
  boardInset,
  dp,
  METRICS,
  motionReduced,
  ms,
  pt,
  theme,
  ui,
  veiledInk,
  viewHeight,
} from '../render/Theme';
import {
  bookmarkGlyph,
  button,
  cardBlocker,
  countText,
  countUp,
  dismissOnScrim,
  eyeGlyph,
  flyReward,
  FONT,
  glassPanel,
  type Glyph,
  keepCentred,
  label,
  minTap,
  pulse,
  RADIUS,
  roundRect,
  progressCard,
  scrim,
  setButtonText,
  setRestScale,
  shieldInput,
  sheetPanel,
  strokeRoundRect,
  tappable,
  TAP_SLOP,
  toast,
  TOAST_H,
  type Tone,
  TYPE,
  videoGlyph,
} from '../render/UI';

type Phase = 'idle' | 'drawing' | 'failed' | 'won';

/*
 * The stars a line earns — ★ cleared, ★★ at or under 1.25× par, ★★★ at or
 * under 1.10× — are core/Stars' to decide and Progress's to keep (bestRatio);
 * this scene measures the line with the one function they share
 * (Stars.lineRatio) and says what it earned. MEDAL_RATIO lived here and in
 * ResultCard; one rule in one place is what keeps the meter, the card and the
 * save from disagreeing about a star.
 */

/**
 * The header row, B · Night Fold (SPEC §5.2): a round glass ‹, the kicker
 * and the title on the fold, the Reveal pill at the right — where it has
 * always been, so no control ever comes near the banner.
 *
 * Apple's floor is 44pt. The Reveal pill and the back button are drawn
 * smaller than that on purpose — a 44pt pill would crowd a header this quiet —
 * so their TAP areas are grown to it instead, and only the painting stays
 * small. The floor is `minTap`: 44pt on the glass, at whatever scale the
 * canvas is drawn, which in base units is not always pt(44).
 */
const HUD_Y = PLAY_HUD.headerY;
const REVEAL_H = PLAY_HUD.revealH;
const BACK_D = PLAY_HUD.back;

/**
 * The live meter reads at most this often, base ms (SPEC §4): a star is a
 * promise about length, and a readout that flickers at 120 Hz reads as noise.
 */
const METER_EVERY_MS = 100;

/** The route field is built a slice a frame, this many ms at most (RouteProgress.routeFieldJob). */
const FIELD_SLICE_MS = 2;

/**
 * The fingertip's shadow teaches why the ink draws above the thumb; by the
 * fifth win the lesson is learnt, and it goes (SPEC §3.3).
 */
const FINGERTIP_UNTIL_WINS = 5;

/**
 * The death, from the contact (SPEC §3.6): "87% · furthest yet" from 120 ms,
 * the tock at 400 — which is `failFlashMs`, when the board clears.
 */
const DEATH_BEAT = { tag: 120 } as const;

/**
 * The win's beats this scene keeps, in base ms from the moment the line
 * closes (all through `ms()`). The card keeps its own — the rise at 620, the
 * stars at 700 / 880 / 1060, the chapter at 1200 (ResultCard.RESULT_BEAT) —
 * on the same clock. The tap gate opens at readyIn, about 780, as it always
 * has — see win().
 */
const WIN_BEAT = {
  /** The figure has settled: droplets, the land haptic, the board steps back. */
  settle: 530,
  /** How long the board takes to step back. */
  frame: 380,
} as const;

/**
 * The chapter doubler pays what the chapter's completion paid, again — and
 * its offer names the ad and the reward, as every rewarded offer must.
 */
const DOUBLER_REVEALS = monetization.economy.chapter.fullReward;
const DOUBLER_TEXT = `Watch an ad → +${DOUBLER_REVEALS} more reveals`;

/** "+1 reveal", "+10 reveals" — as every reward line says it. */
const plusReveals = (n: number): string => `+${n} ${n === 1 ? 'reveal' : 'reveals'}`;

/**
 * The level-1 ghost hand: how far along the proved route it travels, how
 * long that takes, how often it comes round, and how many times at most.
 */
const GHOST_HAND = { reach: pt(90), travel: 1100, every: 2600, loops: 6 } as const;

/**
 * The rescue ladder, in the strokes the offers have always counted: the
 * reveal offer at three, the skip at six — at nine for a player who still
 * holds a reveal and has not used one here (see core/Rescue).
 */
const LADDER = {
  revealAfter: monetization.reveals.offerRevealAfterAttempts,
  skipAfter: monetization.reveals.offerSkipAfterAttempts,
  skipAnywayAfter: 9,
} as const;

/**
 * A rescue pill's face: designed at pt(40), no shorter than pt(24) (its label
 * still reads), pt(4) of paper from the dot above and the banner line below.
 * How far of the last attempt it keeps clear of: its first pt(30).
 */
const RESCUE = { faceH: pt(40), minFaceH: pt(24), gap: pt(4), ghostReach: pt(30) } as const;

/** The registry key for the fold the session's last campaign win was on (Missions: `repeat`). */
const LAST_WIN_KEY = 'foldwing.lastWinLevel';

/** The result card's face, edge to edge at most: the B sheet, dp(380) of the 402-pt phone. */
const CARD_W = dp(380);

/** How long the Reveal pill's number takes to run to a new balance, base ms. */
const COUNT_MS = 360;

export interface GameSceneData {
  levelIndex?: number;
  /** ISO date (YYYY-MM-DD): play that day's Daily Fold instead of a level. */
  daily?: string;
  /** Where the level was picked, when that is not the Menu — see `leave`. */
  from?: 'LevelSelect';
}

/** How a level is put on the board: a Retry prints faster, over its last line. */
interface InstallOptions {
  /** The print-in's length, base ms; 520 for a new level (SPEC §3.2), 250 for a Retry (§5.3). */
  readonly printMs?: number;
  /** A line to leave as the ghost, normalized: the Retry's own winning line. */
  readonly ghost?: readonly Vec2[];
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

/** Rewrite a pill's caption and fit it to `maxW` — a rescue pill whose words change in place. */
function relabel(b: Phaser.GameObjects.Container | null, text: string, maxW: number): void {
  setButtonText(b, text);
  fitCaption(b, maxW);
}

/**
 * Set `text` to `line`, broken onto as many lines as `maxWidth` needs — and
 * only ever at `sep`, which is dropped at the break, so no part of the line is
 * split. Measured with the text's own style. A single part wider than the room
 * on its own (none is, today) is scaled down rather than left to overflow.
 */
function wrapAtSeparators(
  text: Phaser.GameObjects.Text,
  line: string,
  sep: string,
  maxWidth: number
): void {
  const lines: string[] = [];
  let current = '';
  for (const part of line.split(sep)) {
    const trial = current ? `${current}${sep}${part}` : part;
    text.setText(trial);
    if (current && text.width > maxWidth) {
      lines.push(current);
      current = part;
    } else {
      current = trial;
    }
  }
  lines.push(current);
  text.setText(lines.join('\n'));
  text.setScale(text.width > maxWidth ? maxWidth / text.width : 1);
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
  /** Where the canvas sat on the page when last checked — see onCanvasMoved. */
  private canvasKey = '';
  private failTimer: Phaser.Time.TimerEvent | null = null;
  private advanceReadyAt = 0;
  private attempts = 0;
  private advancing = false;

  /** The header's words, the thread row, the tray, the hint and the tags — see PlayHud. */
  private hud!: PlayHud;
  /** The layout the HUD was last placed by. */
  private hudLayout: PlayHudLayout | null = null;
  /** The hint line: the HUD's, tweened here (showHint / hideHint). */
  private hintText!: Phaser.GameObjects.Text;
  private revealPill!: Phaser.GameObjects.Container;
  /** A win's result card is on its way (built a few frames after the goal; see presentResult). */
  private cardPending = false;
  /** The Reveal pill's painted width: it is measured from its words. */
  private revealW: number = PLAY_HUD.revealW;
  /** Where the eye sits on the pill, from its centre — where a reveal token lands. */
  private revealEyeX = 0;
  private revealCount!: Phaser.GameObjects.Text;
  /** The accent "+" that stands in for a count of zero. */
  private revealPlus!: Phaser.GameObjects.Image;
  /** The accent ring of the one-time Reveal lesson. */
  private revealRing!: Phaser.GameObjects.Graphics;
  /** The accent underline that drains while a reveal is up — see startRevealDrain. */
  private revealDrain!: Phaser.GameObjects.Graphics;
  /** What the drain's tween runs on, while it runs. */
  private revealDrainState: { f: number } | null = null;
  /** The Reveal pill's tap height as it is now: it follows the canvas scale. */
  private revealTapH: () => number = () => REVEAL_H;
  /**
   * The number the pill's count shows, or is running to — null until the pill
   * is first painted. A repaint that changes nothing leaves a running count
   * alone; see paintRevealCount.
   */
  private revealShown: number | null = null;
  private skipPill: Phaser.GameObjects.Container | null = null;
  private sharePill: Phaser.GameObjects.Container | null = null;
  /**
   * The band the share row occupies, kept because the row is a container of
   * absolutely-placed pills and so reports no size of its own.
   */
  private shareRowRect: { left: number; right: number; y: number; h: number } | null = null;
  /**
   * A share is up: its sheet, or the replay being folded for it. The tap that
   * closes an iOS 26 share sheet also reaches the page — see SHARE_QUIET_MS.
   */
  private sharing = false;
  /** The share in flight, settled when its sheet goes — see `pressBack`. */
  private shareSettled: Promise<void> | null = null;
  /**
   * Bumped by every share and by every create(): a share that outlives the
   * screen it was started on must not write its end into the next one.
   */
  private shareRun = 0;
  /** Where ‹ goes: the grid the level was picked from, or the Menu. */
  private cameFrom: 'LevelSelect' | null = null;
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
  /** It died on its reflection: the ghost marks the reflected point too. */
  private lastAttemptMirror = false;
  /** It was the death that teaches the mirror: the ghost draws the reflected line as well. */
  private lastAttemptReflected = false;
  /** The ghost is the line that WON (a Retry for ★★★): it carries no death mark. */
  private lastAttemptWon = false;
  /**
   * The press under way began a stroke. The rescue pills are placed clear of
   * the start's grab zone (see rescueSpot), but one that could only be moved
   * while its ad loads keeps the tap height it was built with; should that
   * reach the zone, a press there is the player reaching for the dot, and its
   * release must not also press the pill.
   */
  private downWasStroke = false;
  /**
   * How far along the maze a death got — see core/RouteProgress. The field is
   * built on the first death of a level (undefined until then; null for a
   * maze it cannot measure), and `furthest` is the best this visit.
   */
  private routeProgress: RouteField | null | undefined = undefined;
  private furthest = 0;
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
  /**
   * The route field for THIS board, built a slice a frame from the level's
   * install (routeFieldJob): the live meter reads `remaining` from it, and a
   * death reads `furthest`. Rebuilt when the board moves.
   */
  private routeJob: RouteFieldJob | null = null;
  /** The live star meter for the stroke under way — see Stars.PaceMeter. */
  private meter: PaceMeter = new PaceMeter(null);
  /** When the meter last read, scene ms. */
  private meterAt = Number.NEGATIVE_INFINITY;
  /** The running line length of the stroke: the raw samples, exactly what a win measures. */
  private strokeLen = 0;
  /** The danger heat, rumble and "close": one level's walls, the same rects collision tests. */
  private prox: Proximity | null = null;
  private readonly danger = new DangerTracker();
  /** The frame the heat was last measured on: at most once a frame (SPEC §3.5). */
  private heatFrame = -1;
  /** The stars the winning line earned, for the card; 0 before a win. */
  private winStars: 0 | 1 | 2 | 3 = 0;
  /** "Close" calls on the winning stroke, for the card's chip. */
  private winCloseCalls = 0;
  /** The level was cleared before this visit's win: "Folded", not "new figure". */
  private winWasCleared = false;
  /** A teaching line that outlives a failed or abandoned attempt. */
  private hintSticky = false;
  /**
   * Bumped by everything that says or clears a hint, so a flash's timer can
   * tell whether the line on screen is still ITS line — see `flashHint`.
   */
  private hintSeq = 0;
  private revealOfferPill: Phaser.GameObjects.Container | null = null;
  /** Which row of the three-death table the reveal offer was drawn as — see revealOfferKind. */
  private revealOfferKind: RevealOfferKind | null = null;
  /** The reveal offer's rewarded ad is loading or up. */
  private revealAdPending = false;
  /**
   * The level (its token) on which the refill sheet was opened from an empty
   * stash — the player asked to see the folded walls there, and a purchase
   * approved later still answers that ask (see onGrant).
   */
  private refillAskedOn: number | null = null;
  private refillSheet: Phaser.GameObjects.Container | null = null;
  private webDailyEnd: Phaser.GameObjects.Container | null = null;
  private backButton: Phaser.GameObjects.Container | null = null;
  /** "Share the replay" or "Share this fold" — the win card's Share, where both exist. */
  private shareSheet: Phaser.GameObjects.Container | null = null;

  /** The win's result card (WP-R's WinCard); null everywhere but a win screen. */
  private resultCard: WinCard | null = null;
  /** How far the board steps back for it; 1 is not at all. */
  private frameScale = 1;
  /** The board has started to step back (WIN_BEAT.settle) — a resize re-aims it from then on. */
  private framed = false;
  /** The scale the win asked for — the configured one for this kind of fold. */
  private frameWant = 1;
  /** The doubler's rewarded ad is loading or up. */
  private doubling = false;
  /**
   * The win card already asks for something — [Remind me], or the chapter
   * doubler's ad. One interruption per moment: the interstitial on the way
   * out and the review prompt both stand down.
   */
  private winQuiet = false;
  /** Bumped by every win, so a timer from one win never acts on another. */
  private winSeq = 0;
  /**
   * The Reveal pill's number held back while reveals are in the air: a win,
   * the daily gift or a refill flies them in, and the count moves as they
   * land rather than before they leave. Null when the pill shows the balance.
   */
  private revealHold: number | null = null;
  /** Reveal flights launched and not yet landed — the hold lets go once none is left. */
  private flightsInAir = 0;
  /** The notification permission, as last asked — the soft ask needs it synchronously. */
  private notifPermission: NudgePermission | null = null;
  /** The level-1 ghost hand's drawing, while it plays. */
  private ghostHand: Phaser.GameObjects.Graphics | null = null;

  /**
   * Which level is on screen, as a number that only ever goes up.
   *
   * Bumped by every level install, by the back button and at shutdown. Anything
   * that awaits an ad takes a copy first and compares after: the scene object
   * is reused from level to level, so `this.levelIndex` after an await is
   * whatever is on screen NOW — which is how a skip watched for level 15 was
   * paid out to level 12, and how a continuation ran on a scene that had
   * already been torn down.
   */
  private levelToken = 0;
  /** The walls on screen, in canvas space — what the rescue pills keep clear of. */
  private wallRects: Rect[] = [];
  /** Where each rescue pill was built for — its face and tap height are fixed at build. */
  private readonly rescueSpots = new WeakMap<Phaser.GameObjects.Container, RescueSpot>();
  /** Until when a reveal's bands are still up — see doReveal. */
  private revealHoldUntil = 0;
  /** What the skip pill promised when it was drawn — see showSkipOffer. */
  private skipIsFree = false;
  private skipLabel = '';
  /** A skip's rewarded ad is loading: further taps on the pill are the same request. */
  private skipping = false;
  /**
   * This Daily win is the day's FIRST finish — the one the ledger records, the
   * board ranks and the share describes. A replay of a solved day is practice.
   */
  private dailyFirstFinish = true;
  /** Win-screen taps are ignored until then — see SHARE_QUIET_MS. */
  private shareQuietUntil = 0;
  /** A ‹ tap is waiting to learn whether it closed a share — see `pressBack`. */
  private backPending = false;
  /** The safe area the canvas does not already clear, in base units — see layoutHud. */
  private safe: Insets = NO_INSETS;

  constructor() {
    super('Game');
  }

  /**
   * The route field is built here, a slice a frame (≤ FIELD_SLICE_MS), from
   * the moment the level is installed: the meter shows three outlines until
   * it is done — on level 300, about fifteen frames — and nothing ever waits
   * on it.
   */
  override update(): void {
    const job = this.routeJob;
    if (job && !job.done) {
      job.step(FIELD_SLICE_MS);
      // The first reading of a stroke already under way, now that it can be made.
      if (job.done && this.phase === 'drawing') this.readMeter(true);
    }
  }

  create(data: GameSceneData): void {
    this.cameras.main.setBackgroundColor(theme().paper);

    this.pf = this.boardFor();
    this.recorder = new StrokeRecorder(METRICS.sampleMinDist);
    this.ink = new InkRenderer(this, this.pf);

    this.buildHud();

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    /*
     * A mouse released OFF the canvas never produces POINTER_UP — Phaser emits
     * this instead — and the stroke stayed live: hovering back over the board
     * kept drawing with no button held, straight into a wall. A touch always
     * ends on the canvas it began on; this is the desktop Daily's case.
     */
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);

    // The header follows the safe area on every viewport change — a rotation,
    // a fold, a status bar that settles after launch — and so does everything
    // placed against it: the rescue pills and a win's result card. The board
    // first: a new world height moves it, in place (followHeight).
    const relayout = (): void => {
      this.followHeight();
      this.layoutHud();
      this.relayoutRescuePills();
      this.relayoutResultCard();
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, relayout);
    this.canvasKey = this.canvasPlacement();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onCanvasMoved, this);

    /*
     * A return to the foreground can land the day's free reveal: main.ts tops
     * it up on every return, and its listener was registered first, so it has
     * already run. The pill must say so — it read "0" until something else
     * repainted it, beside a stash that already held one.
     *
     * The notification permission is re-read too: it can be changed in iOS
     * Settings while the app is away, and the win card's soft ask needs it
     * without waiting (see winAsk).
     */
    const onVisible = (): void => {
      if (document.hidden) return;
      this.refreshHud();
      this.readNotifPermission();
    };
    document.addEventListener('visibilitychange', onVisible);
    this.readNotifPermission();

    /*
     * Grants nobody on this screen asked for: the day's free reveal landing on
     * a foreground mid-level, and a purchase approved late. Everything else a
     * grant can be — a mission, a chapter, a streak, a refill — is shown by the
     * flow that caused it (the win card, the store sheet), so it is left alone.
     */
    const offGrant = Progress.onGrant((g) => this.onGrant(g));

    if (import.meta.env.DEV) this.bindDevKeys();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // Every await still out there now belongs to a level nobody is playing.
      this.levelToken += 1;
      offGrant();
      // A pen bed or a ducked bus must not outlive the board they were for.
      Audio.penStop();
      Music.duck(false);
      this.routeJob = null;
      // The scene object outlives its display list: the next run's create()
      // must not reach for pills that were destroyed with this one.
      this.revealOfferPill = null;
      this.skipPill = null;
      this.refillSheet = null;
      this.shareSheet = null;
      this.resultCard = null;
      this.ghostHand = null;
      // The ScaleManager outlives every scene; a listener left on it would
      // call into a dead scene on the next rotation.
      this.scale.off(Phaser.Scale.Events.RESIZE, relayout);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onCanvasMoved, this);
      document.removeEventListener('visibilitychange', onVisible);
      this.failTimer?.remove();
      this.ink.destroy();
    });

    /*
     * The scene object is reused, so its fields are last visit's. A share that
     * never settled — a web share sheet left open, a stuck one — used to leave
     * `sharing` set for good: every later win screen ignored the tap for the
     * next fold, and the share buttons did nothing.
     */
    this.shareRun += 1;
    this.sharing = false;
    this.shareSettled = null;
    this.shareQuietUntil = 0;
    this.backPending = false;
    this.cameFrom = data.from === 'LevelSelect' && !data.daily ? 'LevelSelect' : null;

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

  private loadLevel(index: number, opts: InstallOptions = {}): void {
    this.levelIndex = ((index % LEVELS.length) + LEVELS.length) % LEVELS.length;
    this.installLevel(levelAt(this.levelIndex), opts);
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

  private installLevel(level: Level, opts: InstallOptions = {}): void {
    this.level = level;
    this.levelToken += 1;
    this.parCache = undefined;

    // The board for the world as it is now. A height that changed on a win
    // screen — where the figure keeps its place — lands here.
    const board = this.boardFor();
    if (board.y !== this.pf.y) this.adoptBoard(board);
    this.placeLevel();
    const walls = this.wallRects;

    this.attempts = 0;
    this.advancing = false;
    this.lastAttempt = null;
    this.lastAttemptMirror = false;
    this.lastAttemptReflected = false;
    this.lastAttemptWon = false;
    this.routeProgress = undefined;
    this.furthest = 0;
    this.runAttempts = [];
    this.winRatio = null;
    this.winMedal = false;
    this.winStars = 0;
    this.winCloseCalls = 0;
    this.winQuiet = false;
    this.levelReveals = 0;
    this.mirrorDeaths = 0;
    this.totalDeaths = 0;
    this.winSense = 0;
    this.revealHoldUntil = 0;
    this.revealHold = null;
    this.flightsInAir = 0;
    this.skipping = false;
    this.revealAdPending = false;
    this.dailyFirstFinish = true;
    Audio.resetScale();
    this.ink.clearReveal();
    this.stopRevealDrain();
    this.ink.clearGhost();
    this.hud.clearTags();
    this.meter = new PaceMeter(this.par);
    this.startRouteJob();
    this.resetToIdle();
    /*
     * The maze prints in, row by row from the start up (SPEC §3.2): collision
     * has the final walls from the first frame, and a touch finishes the
     * print. A Retry prints faster, over the ghost of the line it retries.
     * Under reduced motion the board is simply there.
     */
    this.ink.drawLevel(walls, this.startPx, this.goalPx, { printIn: opts.printMs ?? PRINT_MS });
    if (opts.ghost && opts.ghost.length > 1) {
      this.lastAttempt = opts.ghost.map((p) => this.pf.toScreen(p));
      this.lastAttemptWon = true;
      this.ink.showGhost(this.lastAttempt, false, false, { mark: false });
    }
    /*
     * The win frame scales what the player SEES, never what collision tests.
     * clearWin and drawLevel both put it back; this says so loudly in
     * development if a path into a level ever skips them — a board left framed
     * draws its walls away from where they kill.
     */
    if (import.meta.env.DEV && !this.ink.frameIsIdentity) console.error('board left framed');
    this.clearSkipOffer();
    this.clearRevealOffer();
    this.closeRefillSheet();
    this.clearShareOffer();
    this.stopGhostHand();
    // The thread row's floor is this maze's goal ring — see layoutHud.
    this.layoutHud();
    this.refreshHud();

    /*
     * Two deliberate lines, each said once at the moment it becomes true.
     *
     * Level 1 is the whole of first-run onboarding: the game asks for a gesture
     * nobody has made in another game, and until this line existed it asked for
     * it silently. A player who does not discover that they must press the DOT
     * — not anywhere on the paper — has no way in at all.
     *
     * Level 6 is the first generated maze, where folds stop being one chosen
     * lesson per level and become the maze itself — the tutorial mazes each
     * fold only the wall that teaches their one thing — and Reveal is the tool
     * for exactly that.
     *
     * The level-1 line keys on "has never won", not on `l1` being cleared. The
     * tutorial was re-authored as mazes in save schema 3, which drops old l1…l5
     * clears; keyed on the id, every upgraded player would be taught to press
     * the dot again.
     */
    if (!this.dailyDate && this.levelIndex === 0 && Progress.data.totalWins === 0) {
      this.showHint('press the dot and draw to the ring', 900, true);
      // Only this line: a newer one (a flash) ends on its own timer.
      const mine = this.hintSeq;
      this.time.delayedCall(8000, () => {
        if (this.phase === 'idle' && this.hintSeq === mine) this.hideHint();
      });
      if (!WEB_DAILY) this.startGhostHand();
    }

    if (this.levelIndex === 5 && !this.dailyDate && !Progress.hasCleared('l6')) {
      this.showHint('stuck? Reveal shows the walls folded from the far half', 900, true);
      const mine = this.hintSeq;
      this.time.delayedCall(7000, () => {
        if (this.phase !== 'won' && this.hintSeq === mine) this.hideHint();
      });
      // And the pill the line is about points itself out — once per save.
      if (!WEB_DAILY && !Progress.isTaught('reveal')) this.teachRevealPill();
    }

    // A web visitor who already folded today lands on their result, not on a
    // replay they did not ask for.
    if (WEB_DAILY && this.dailyDate && Progress.hasDaily(this.dailyDate)) {
      this.showWebDailyEnd();
    } else if (WEB_DAILY && this.dailyDate) {
      this.showHint('one maze a day · the same for everyone', 900);
      const mine = this.hintSeq;
      this.time.delayedCall(6000, () => {
        if (this.phase !== 'won' && this.hintSeq === mine) this.hideHint();
      });
    }
  }

  /* ---------------------------------------------------------------- board */

  /**
   * The board for the world as tall as it is now: the proved 702×1102
   * playfield — the geometry every level, its collision and its proof are in —
   * `boardDrop` below its designed place (Theme.boardInset), so on a tall
   * phone it sits centred between the HUD it hangs under and the hint band
   * over the banner. Moved, never stretched.
   */
  private boardFor(): Playfield {
    return new Playfield(BASE_WIDTH, viewHeight(), boardInset());
  }

  /**
   * The level's par: the proved route's length, which every shipped level
   * carries and the Daily computes. The validator's routeArc is the fallback
   * for a level that somehow has none, measured once per level.
   */
  private parCache: number | null | undefined = undefined;

  private get par(): number | null {
    if (this.parCache !== undefined) return this.parCache;
    const par =
      this.level.parPx ??
      routeArc(this.level, this.pf, {
        cell: 6,
        hitRadius: METRICS.hitRadius,
        goalRadius: METRICS.goalRadius,
      })?.arc ??
      null;
    this.parCache = par !== null && par > 0 ? par : null;
    return this.parCache;
  }

  /**
   * Start building the route field for the board as it is now. It is in board
   * pixels, so a board that moves builds it again; `remaining` and `furthest`
   * are the same numbers wherever the board sits (it only translates).
   */
  private startRouteJob(): void {
    this.routeProgress = undefined;
    this.routeJob = routeFieldJob(this.level, this.pf, {
      cell: 6,
      hitRadius: METRICS.hitRadius,
      goalRadius: METRICS.goalRadius,
    });
  }

  /** The field, finished now if it is not yet: a death needs it this frame. */
  private routeFieldNow(): RouteField | null {
    if (this.routeProgress === undefined) this.routeProgress = this.routeJob?.finish() ?? null;
    return this.routeProgress;
  }

  /** Swap in `board`, and a renderer drawn for it: the ink layers are sized to the board's place. */
  private adoptBoard(board: Playfield): void {
    this.pf = board;
    this.ink.destroy();
    this.ink = new InkRenderer(this, board);
  }

  /**
   * The level in board pixels: the walls, the start and the goal, collision,
   * the mirror's bands and the gates. Pure placement — nothing about the
   * attempt in progress — so a board that moves is placed again with it.
   */
  private placeLevel(): void {
    const walls: Rect[] = this.level.walls.map((w) => this.pf.toScreenRect(w));
    this.wallRects = walls;
    this.startPx = this.pf.toScreen(this.level.start);
    this.goalPx = this.pf.toScreen(this.level.goal);
    this.collision = new CollisionSystem(walls, METRICS.hitRadius, this.pf.axisX);
    // The danger heat reads the very rects collision tests (core/Proximity's contract).
    this.prox = new Proximity(walls, METRICS.hitRadius, this.pf.axisX);

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
  }

  /**
   * The world's height changed under the level (main.ts: a fold, Split View,
   * a rotation — never a phone held still). The HUD and the bottom band follow
   * the canvas's edges by themselves (layoutHud); the board has to move to
   * stay centred between them, and it moves IN PLACE — never a restart, so the
   * level keeps everything it has: its attempts, its ghost, the rescue ladder,
   * a reveal on screen, the run the replay is made of.
   *
   * - drawing: the stroke is abandoned exactly as a lift would be (the rule
   *   onCanvasMoved keeps for any canvas move) — no death, no flash;
   * - failed: the 400ms flash finishes where it is; the reset after it moves
   *   the board (resetToIdle);
   * - won: the figure and its card keep their place — the card re-fits to the
   *   new banner line (relayoutResultCard) — and the next level is installed
   *   on the new board.
   */
  private followHeight(): void {
    if (!this.level || this.boardFor().y === this.pf.y) return;
    if (this.phase === 'drawing') this.resetToIdle();
    else this.moveBoardIfStale();
  }

  /**
   * Move an idle board to where the world's height puts it. The board only
   * translates (boardInset keeps its size), so everything the level holds in
   * board pixels moves by the same `dy` and nothing is re-proved: the level is
   * placed again, the ghost of the last attempt is carried down with it, and
   * the renderer is rebuilt for the new place and repainted — the ghost, and
   * the folded walls for whatever is left of a reveal. The near-miss field is
   * in board pixels too, and is built again at the next death; the best
   * reached (`furthest`) is a fraction, and stays.
   */
  private moveBoardIfStale(): void {
    if (this.phase !== 'idle' || !this.level) return;
    const board = this.boardFor();
    const dy = board.y - this.pf.y;
    if (dy === 0) return;
    this.adoptBoard(board);
    this.placeLevel();
    this.lastAttempt = this.lastAttempt?.map((p) => ({ x: p.x, y: p.y + dy })) ?? null;
    this.startRouteJob();
    // The maze was already on screen: it moves whole, with no print-in.
    this.ink.drawLevel(this.wallRects, this.startPx, this.goalPx);
    if (this.lastAttempt) {
      this.ink.showGhost(this.lastAttempt, this.lastAttemptMirror, this.lastAttemptReflected, {
        mark: !this.lastAttemptWon,
      });
    }
    // The bands ease in again, quickly, and end when the reveal was going to.
    const left = this.revealHoldUntil - this.time.now;
    if (left > 0) this.ink.showReveal(this.mirrorBands, Math.max(0, left - ms(220)));
    // Level 1's ghost hand walks the route from the dot, wherever it is now.
    if (this.ghostHand) this.startGhostHand();
    this.layoutHud();
    this.relayoutRescuePills();
  }

  /* ---------------------------------------------------------------- input */

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    Audio.unlock();
    this.downWasStroke = false;

    // A modal sheet owns the screen; the board underneath must not react.
    if (this.refillSheet || this.webDailyEnd || this.shareSheet) return;

    if (this.phase === 'won') {
      // A share is up, or has only just gone: this tap is the one that closed
      // it, not a request for the next fold — see SHARE_QUIET_MS. The same
      // holds for a board tap under the replay's progress card.
      if (this.shareHoldsTaps) return;
      // A tap anywhere means "next", so the card's buttons have to carve
      // themselves out — otherwise reaching for Share or [Remind me] would skip
      // past the figure instead. (The web Daily keeps its share row.)
      if (this.resultCard ? this.resultCard.hitsControl(pointer.x, pointer.y) : this.overSharePill(pointer)) {
        return;
      }
      // Nor do the header's two controls. A tap that means "leave" or "spend a
      // reveal" was also being read as "next level" — so backing out flashed
      // the next maze first, and tapping the counter advanced AND then spent a
      // reveal on the new level. Only they are carved out, by their own tap
      // areas: the rest of the header band — the title, the paper around it —
      // is "anywhere", and advances like the rest of the screen.
      if (onControl(pointer.x, pointer.y, this.headerControls())) return;
      if (this.time.now >= this.advanceReadyAt) void this.advance();
      // Before the gate a tap never advances: it jumps the card to its end
      // state instead (SPEC §2.5.1 — nothing waits for an animation).
      else this.resultCard?.finish();
      return;
    }

    // Reaching for the start again abandons the flash immediately. Making the
    // player sit out an animation they have already reacted to is the tax the
    // whole design exists to avoid.
    if (this.phase === 'failed') this.resetToIdle();
    if (this.phase !== 'idle') return;
    // Any touch finishes the print-in: the maze is never in the way of a start.
    this.ink.completePrintIn();

    const touch: Vec2 = { x: pointer.x, y: pointer.y };
    const grab = METRICS.startRadius * METRICS.startGrabFactor;

    // The grab is tested against the FINGER, not the offset cursor: the player
    // aims at the dot they can see. The offset only exists once drawing begins.
    if (dist(touch, this.startPx) > grab) return;

    this.activePointer = pointer.id;
    this.downWasStroke = true;
    this.touchInput = isTouchPointer(pointer);
    this.fingerTravel = 0;
    this.lastFinger = touch;
    this.recorder.clear();
    const at = this.inputTime(pointer.downTime);
    this.strokeStartedAt = at;
    this.attempts += 1;
    this.phase = 'drawing';
    // The ghost hand has done its job: they found the dot.
    this.stopGhostHand();
    // The rescue offers sit in the runway every stroke crosses — see
    // setRescueOffersLive.
    this.setRescueOffersLive(false);

    // The stroke is anchored on the dot rather than under the finger, so the
    // ink always begins exactly where the level says it does.
    for (const gate of this.gates) gate.passed = false;
    this.ink.clearGhost();
    Audio.resetScale();
    this.recorder.begin(this.startPx, at);
    this.ink.drawStroke(this.recorder.points, this.recorder.times);

    // The stroke's feel: the pen bed, the music out of its way, a fresh meter
    // and a fresh danger count. The renderer lights the fold's notches and
    // moves the nib from the samples it draws, by the row notes' own test.
    this.strokeLen = 0;
    this.danger.reset();
    this.ink.setHeat(null);
    this.heatFrame = -1;
    this.meter.reset();
    this.meterAt = Number.NEGATIVE_INFINITY;
    this.hud.clearTags();
    this.ink.fingertip(this.fingertipAt(touch));
    Audio.penStart();
    Music.duck(true);
    this.readMeter(true);
    this.refreshHud();
  }

  /**
   * When the input happened, on the scene clock's timebase.
   *
   * The event's own timestamp, not the frame's. Phaser hands input over as the
   * events arrive, but `time.now` only moves once a frame — so two moves in one
   * frame (WebKit delivers them that way, and so does any phone falling behind
   * on a long stroke) were stamped with the same instant, the ribbon read the
   * zero gap as infinite speed, and the ink pinched to its thinnest at every
   * one: a line drawn as a string of beads. Saved figures kept the stamps, so
   * the share card and the replay inherited the beads.
   *
   * Every current engine stamps events from the same origin as the frame clock
   * (performance.now). A stamp from any other origin, or none, falls back to
   * the frame time; and a stroke's stamps never run backwards.
   */
  private inputTime(stamp: number): number {
    const frame = this.time.now;
    const t = Number.isFinite(stamp) && stamp > 0 && Math.abs(stamp - frame) < 1000 ? stamp : frame;
    const times = this.recorder.times;
    const last = times.length > 0 ? times[times.length - 1] : -Infinity;
    return Math.max(t, last);
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.phase !== 'drawing' || pointer.id !== this.activePointer) return;

    // A mouse whose button came up somewhere no event reached us — belt and
    // braces for POINTER_UP_OUTSIDE. Hovering is not drawing.
    if (!pointer.isDown) {
      this.resetToIdle();
      return;
    }

    const prev = this.recorder.last;
    if (!prev) return;

    const at = this.inputTime(pointer.moveTime);
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
      if (goalT !== null && goalT < hitT) this.win(lerpPoint(prev, cursor, goalT), at);
      else this.fail(lerpPoint(prev, cursor, hitT), hit?.mirror ?? false, at, hit?.wall ?? null);
      return;
    }

    if (goalT !== null) {
      this.win(lerpPoint(prev, cursor, goalT), at);
      return;
    }

    const before = this.recorder.times[this.recorder.times.length - 1] ?? at;
    if (this.recorder.push(cursor, at)) {
      this.ink.drawStroke(this.recorder.points, this.recorder.times);
      this.ringGates(prev, cursor);
      const step = dist(prev, cursor);
      this.strokeLen += step;
      // The pen bed follows the speed the recorder saw (base px per ms).
      Audio.penSpeed(step / Math.max(1, at - before));
      this.ink.fingertip(this.fingertipAt({ x: pointer.x, y: pointer.y }));
      this.feelDanger(cursor);
      this.readMeter(false);
    }
  }

  /**
   * The fingertip's shadow, under the finger: only for a touch (a mouse has no
   * thumb lift to explain), and only until the lesson is learnt.
   */
  private fingertipAt(finger: Vec2): Vec2 | null {
    if (!this.touchInput || Progress.data.totalWins >= FINGERTIP_UNTIL_WINS) return null;
    return finger;
  }

  /**
   * The danger heat, the rumble and "close" (SPEC §3.5), from one reading of
   * the slack at the pen and its reflection — measured the way collision
   * kills (core/Proximity), at most once a frame. None of it changes what
   * kills a line.
   */
  private feelDanger(cursor: Vec2): void {
    const prox = this.prox;
    if (!prox) return;
    const frame = this.game.loop.frame;
    if (frame === this.heatFrame) return;
    this.heatFrame = frame;
    const step = this.danger.step(prox.slack(cursor), this.strokeLen, this.time.now);
    // Rebuilt only when the wall changes (InkRenderer.setHeat); null puts it out.
    this.ink.setHeat(step.heat);
    if (step.rumble) Haptics.rumble();
    const close = step.close;
    if (close) {
      this.ink.spark(close.at);
      this.hud.flicker(cursor);
      this.hud.closeTag(close.at, this.pf.axisX, this.pf.y, {
        head: cursor,
        walls: this.wallRects,
        line: this.recorder.points,
        bottom: this.pf.bottom,
      });
      Audio.ting();
      Haptics.close();
    }
  }

  /**
   * The live star meter (SPEC §4): the line so far plus the shortest way
   * left to the ring, over par — the same function the win's ratio comes
   * from, so the promise and the result agree. At most every
   * METER_EVERY_MS; `now` for the first reading of a stroke. Stars only ever
   * drop within a stroke, and quietly.
   */
  private readMeter(now: boolean): void {
    if (this.phase !== 'drawing' || (this.dailyDate && WEB_DAILY)) return;
    const t = this.time.now;
    if (!now && t - this.meterAt < METER_EVERY_MS) return;
    this.meterAt = t;
    const field = this.routeJob?.done ? this.routeJob.field : null;
    const head = this.recorder.last;
    const reading = field && head ? this.meter.read(this.strokeLen, field.remaining(head)) : this.meter.current();
    const daily = this.dailyDate !== null;
    if (this.meterHidden) return;
    this.hud.setMeter(
      {
        stars: daily ? null : (reading.stars ?? 0),
        text: reading.text ?? '',
      },
      !now
    );
  }

  /**
   * The pen is off the paper — a lift, a death, a win: the bed stops, the
   * music comes back, the heat goes out and the fingertip's shadow with it.
   * The nib and the wet head are the renderer's (clearStroke, flashFail,
   * presentWin each end them their own way).
   */
  private endPen(): void {
    Audio.penStop();
    Music.duck(false);
    this.ink.setHeat(null);
    this.ink.fingertip(null);
  }

  /**
   * Sound a note for every obstacle row this segment just crossed alive. The
   * renderer lights the row's notch on the fold from the same samples by the
   * same test (InkRenderer.crossRows), so sight, sound and touch are the one
   * event (SPEC §3.4). The rows run from the start up: the note is the row's.
   */
  private ringGates(from: Vec2, to: Vec2): void {
    this.gates.forEach((gate, k) => {
      if (gate.passed) return;
      const crossed = from.y > gate.mid !== to.y > gate.mid;
      if (!crossed) return;
      gate.passed = true;
      Audio.rowNote(k);
      Haptics.tick();
    });
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    if (this.phase !== 'drawing' || pointer.id !== this.activePointer) return;
    // Lifted short of the goal. Not a failure — just an attempt that ended.
    this.resetToIdle();
  }

  private canvasPlacement(): string {
    const b = this.scale.canvasBounds;
    return [b.x, b.y, b.width, b.height].map((v) => Math.round(v)).join(',');
  }

  /**
   * The canvas moved or changed size under a live stroke: a rotation, a fold,
   * Split View. The finger is where it was on the glass, but the board is not,
   * so the next move would map to a different board point and join the two
   * with one straight segment — through whatever wall lies between. That is a
   * death the player did not cause (or, across open paper, a jump they did not
   * draw). Abandon the attempt exactly as a lift would: no death, no flash.
   *
   * Only a real change counts. RESIZE also fires for refreshes that move
   * nothing (the boot timers, visualViewport scrolls), and cancelling on those
   * would drop strokes at random.
   */
  private onCanvasMoved(): void {
    const key = this.canvasPlacement();
    if (key === this.canvasKey) return;
    this.canvasKey = key;
    if (this.phase === 'drawing') this.resetToIdle();
  }

  /** Pointer position -> ink position: the thumb lift, then the drawable clamp. */
  private cursorFor(pointer: Phaser.Input.Pointer): Vec2 {
    const raw: Vec2 = { x: pointer.x, y: pointer.y };
    // Travel, not elapsed time. A finger resting on the glass must not drag
    // the cursor — and therefore the collision-tested stroke — with it.
    this.fingerTravel += dist(raw, this.lastFinger);
    this.lastFinger = raw;
    /*
     * The lift is for a thumb, and a thumb is measured on the glass. In base
     * units METRICS' pt(42) is 42 points only on a canvas drawn at 0.5; in a
     * Split View pane drawn at 0.317 it came to 27 points, and the ink sat
     * under the fingertip it exists to clear. So it is at least 42 points on
     * the glass, whatever the scale — unchanged on every phone (0.5 and up).
     * The ramp keeps its length in points the same way. `hitRadius` is not
     * touched: that is what kills, and it stays in board units.
     */
    const perPoint = this.scale.displayScale.y;
    const onGlass = Number.isFinite(perPoint) && perPoint > 0 ? perPoint : 0;
    return this.pf.clampToDrawable(
      drawCursor(raw, {
        touch: this.touchInput,
        travelPx: this.fingerTravel,
        offsetY: Math.max(METRICS.touchOffsetY, 42 * onGlass),
        rampPx: Math.max(METRICS.touchOffsetRampPx, 60 * onGlass),
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

  private fail(contact: Vec2, mirrorDeath: boolean, at: number, wall: number | null = null): void {
    this.recorder.pushExact(contact, at);
    this.phase = 'failed';
    this.activePointer = null;
    this.endPen();

    this.totalDeaths += 1;
    if (mirrorDeath) this.mirrorDeaths += 1;

    // Keep the corpse: the next idle board draws it as a ghost, so a death
    // teaches instead of just taxing. Frustration that informs brings the
    // player back; frustration that withholds sends them away.
    this.lastAttempt = [...this.recorder.points];
    this.lastAttemptMirror = mirrorDeath;
    this.lastAttemptWon = false;
    this.recordAttempt(true);

    // THUD — and for the reflection a second, lighter knock 70 ms after:
    // "the other side", in the hand before the eye has found it (SPEC §3.6).
    Haptics.pair(mirrorDeath ? 'mirror' : 'wall');
    Audio.thud();
    Audio.tear();
    /*
     * Where, and against what: a ring where the line met the wall — for a
     * mirror death at the REFLECTED point, the renderer's job, so `contact`
     * stays on the player's own stroke — and that wall outlined.
     *
     * The first mirror death of a save is the moment the whole game is about
     * and the one the player least understands: their own line was clear.
     * It gets the wall twice, and its ghost keeps the reflected line.
     */
    const teach = mirrorDeath && !WEB_DAILY && Progress.teach('mirror');
    this.lastAttemptReflected = teach;
    /*
     * And it reads (SPEC §3.6): the splat on the side that hit, thrown the
     * way the line was going; the wall hot; for a mirror death the dashed arc
     * over the fold from the pen to where its reflection hit — labelled "your
     * reflection" for the first three of a save (Progress.mirrorLabel counts
     * them), the arrow alone after that. It replaces the one sentence the
     * first mirror death used to get.
     */
    const labelled = mirrorDeath && !WEB_DAILY && Progress.mirrorLabel();
    this.ink.flashFail(this.recorder.points, this.recorder.times, {
      at: contact,
      mirror: mirrorDeath,
      wall,
      flashes: teach ? 2 : 1,
      arrow: labelled ? 'your reflection' : null,
    });

    Progress.update({ attemptsSinceAd: Progress.data.attemptsSinceAd + 1 });

    // Measured now so the best of the visit is always right; the tray says
    // "beat 87%" once the flash has cleared, and the tag says it here — only
    // for an attempt that beat the visit's best (RouteProgress.nearMissLine).
    const note = WEB_DAILY ? null : this.measureNearMiss(this.recorder.points);
    const pct = note !== null ? furthestPct(this.furthest) : null;
    if (pct !== null) {
      const token = this.levelToken;
      const board = { x: this.pf.x, y: this.pf.y, axisX: this.pf.axisX, right: this.pf.right, bottom: this.pf.bottom };
      this.time.delayedCall(DEATH_BEAT.tag, () => {
        if (token !== this.levelToken || this.phase === 'drawing' || this.phase === 'won') return;
        // Clear of the arc arrow and its label, then of the walls (QA: it cut
        // "your reflection" in half).
        this.hud.deathTag(deathTagText(pct), contact, board, this.startPx, {
          arrow: this.ink.arrowRects(),
          walls: this.wallRects,
        });
      });
    }

    this.failTimer?.remove();
    this.failTimer = this.time.delayedCall(METRICS.failFlashMs, () => {
      this.failTimer = null;
      this.resetToIdle();
      // THUD … tock: the board is clear and the next try is open.
      Audio.tock();
      Haptics.ready();
      // Board is clear: this is the transition, not the failure itself.
      void this.maybeAdOnRetry();
    });

    /*
     * Escalating help, one offer at a time. Three deaths: point at the thing
     * they cannot see (the fold) — the reveal pill. Six: offer the way past —
     * the skip replaces the reveal offer, unless the player still holds a
     * reveal and has not looked yet (then from nine; see core/Rescue). Never
     * both; a stack of rescue buttons reads as the game giving up on them.
     *
     * The reveal offer is only one that can be kept: with the stash empty and
     * no ad or pack to refill it — the web, the web Daily — tapping it could
     * only say "out of reveals", and a rescue that rescues nothing is worse
     * than none. `currentRevealOffer` is null then.
     *
     * The stroke is over, so offers already up come back into view first.
     */
    this.setRescueOffersLive(true);
    const offer = rescueOffer(
      {
        attempts: this.attempts,
        revealsUsed: this.levelReveals,
        revealOffer: this.currentRevealOffer(),
        daily: this.dailyDate !== null, // there is nothing to skip TO on the daily
      },
      LADDER
    );
    if (offer === 'skip' && !this.skipPill) {
      this.clearRevealOffer();
      this.showSkipOffer();
    } else if (offer === 'reveal' && !this.revealOfferPill && !this.skipPill) {
      this.showRevealOffer();
    }
  }

  /**
   * How far this dead stroke got along the maze, against the best of the
   * visit; the near-miss line when this was a new best, or null. The field has
   * been building since the level was installed (startRouteJob); a death that
   * comes before it is done finishes it here, under the red flash.
   */
  private measureNearMiss(points: readonly Vec2[]): string | null {
    const field = this.routeFieldNow();
    if (!field) return null;
    const reached = field.furthest(points);
    const line = nearMissLine(this.attempts, reached, this.furthest);
    this.furthest = Math.max(this.furthest, reached);
    return line;
  }

  private win(entry: Vec2, at: number): void {
    this.recorder.pushExact(entry, at);
    this.phase = 'won';
    this.activePointer = null;
    this.winSeq += 1;
    this.stopGhostHand();
    // The ring catches the pen: the bed cuts and the hand feels it click in
    // (SPEC §3.7; the owner's call, 2026-09-27).
    this.winCloseCalls = this.danger.count;
    this.endPen();
    Haptics.goal();

    const elapsed = at - this.strokeStartedAt;
    /*
     * A replay of a Daily already in the ledger is practice, not a result. The
     * ledger has always kept the first finish only; now nothing else counts a
     * replay either — not the Game Center board, which keeps each player's
     * BEST and would rank a maze whose route they already knew; not the
     * reminder prompt; not the win count or the ad cadence it feeds; and not
     * the share, which describes the recorded run (see dailyResultText).
     */
    const firstFinish = !this.dailyDate || !Progress.hasDaily(this.dailyDate);
    this.dailyFirstFinish = firstFinish;

    /*
     * Everything this win will call NEW is read before any of it is written:
     * after recordWin every clear looks old and every best is this one, and
     * after recordDaily today's Daily is already done. So one snapshot here,
     * the writes below as they always were, and one settle after them —
     * missions, chapter marks and the streak paid in a single update (see
     * Progress.settleWin). The web Daily has none of those surfaces and
     * settles nothing.
     */
    const before = WEB_DAILY ? null : Progress.snapshotForWin(this.level.id, this.levelIndex);
    this.winWasCleared = this.dailyDate ? !firstFinish : Progress.hasCleared(this.level.id);
    const dailyWasOpen = Progress.dailyUnlocked();
    const firstEverDaily = this.dailyDate !== null && Object.keys(Progress.data.daily).length === 0;

    if (this.dailyDate) {
      // The daily unlocks nothing; its ledger is written below, once the score
      // that belongs in it exists.
      if (firstFinish) {
        Progress.update({
          totalWins: Progress.data.totalWins + 1,
          winsSinceAd: Progress.data.winsSinceAd + 1,
        });
      }
    } else {
      Progress.recordWin(this.level.id, this.levelIndex, elapsed, LEVELS.length);
    }

    /*
     * Par: the winning line measured against the validator's proved route.
     * Every completed level becomes a score to beat at zero content cost —
     * "1.83× par" is an invitation, "1.12× par" a brag — and the stars are
     * what it earns: ★ cleared, ★★ at 1.25× par, ★★★ at 1.10×.
     *
     * Stars.lineRatio over the raw samples: THE function, the one the live
     * meter projected and the card prints. Progress keeps the measurement
     * (bestRatio) and still writes the medal for a two-star line, so a 1.4
     * build opened later keeps showing it; the stars are derived from it.
     * After recordWin, before settleWin, so the chapter's stars on the card
     * include this win.
     */
    this.winRatio = lineRatio(lineLength(this.recorder.points), this.par);
    const line = starsFor(this.winRatio);
    // The daily keeps no stars — no list to keep them in, no card to carry
    // them — so it does not claim any. The HUD reads the same.
    this.winStars = this.dailyDate ? 0 : line;
    if (!this.dailyDate && !WEB_DAILY) this.winStars = Progress.recordRatio(this.level.id, this.winRatio).line;
    this.winMedal = this.winStars >= 2;

    // Fold Sense: score this win from real play signals, fold the profile
    // rating toward it.
    this.winSense = winScore({
      parRatio: this.winRatio,
      attempts: this.attempts,
      revealsUsed: this.levelReveals,
      mirrorDeathShare: this.totalDeaths === 0 ? 0 : this.mirrorDeaths / this.totalDeaths,
      foldExposure: foldExposure(this.level),
    });
    const senseBefore = Progress.data.foldSense;
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
      /*
       * And to the world. Fire and forget: the board is a nice-to-have on top
       * of a game with no account, so a signed-out or offline player loses the
       * ranking and never learns that anything was attempted.
       *
       * Submitted for TODAY only. Game Center's board resets daily, so posting
       * a time for a fold played from an older date would rank it against the
       * wrong maze. And for the first finish only — see firstFinish above.
       */
      if (firstFinish && this.dailyDate === todayISO()) {
        void GameCenter.submitDaily(elapsed);
        /*
         * Today's fold is done, so every reminder moves: today's no longer
         * apply, and tomorrow's may name a longer streak. REBUILT, never asked
         * for — rebuild() does nothing unless permission was already granted.
         * The asking is the win card's [Remind me] (see winAsk), a tap the
         * player makes; nothing else in the game may put the system alert up.
         */
        void Nudges.rebuild();
      }
    }

    const outcome = before
      ? Progress.settleWin(before, {
          levelId: this.level.id,
          levelIndex: this.levelIndex,
          dailyDate: this.dailyDate,
          todayDailyFirst: firstFinish && this.dailyDate === todayISO(),
          // The "Two stars" mission: this line earned ★★ or better.
          medal: this.winMedal,
          deaths: this.totalDeaths,
          ms: elapsed,
          // The same fold as the session's last win: not one more fold.
          repeat: !this.dailyDate && this.registry.get(LAST_WIN_KEY) === this.level.id,
        })
      : null;
    if (!this.dailyDate) this.registry.set(LAST_WIN_KEY, this.level.id);
    // The win that opens the Daily opens its reminders too: a player who
    // allowed them in the tutorial gets a plan now, not at the next foreground.
    if (!dailyWasOpen && Progress.dailyUnlocked()) void Nudges.rebuild();

    /*
     * Achievements, reported on every win rather than tracked.
     *
     * `totalDeaths` is passed because a flawless run is knowable at exactly one
     * moment: the save records that a level was cleared, never how cleanly.
     */
    void GameCenter.reportAchievements({ deaths: this.totalDeaths });

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

    // The figure blooms out of the fold (InkRenderer.presentWin — the spec's `bloom`).
    this.ink.presentWin(this.recorder.points, this.recorder.times);
    // The header says what happened; the thread row and the tray make way
    // for the lifted figure and the card.
    this.hud.setThreadShown(false);
    this.hud.holdTray('won', true);
    this.hud.clearTags();
    // The arrival. Always the plain run now: the stars announce what the line
    // earned with their own notes as they punch in (C6, D6, G6 — the card's),
    // and the medal run would say ★★★ twice.
    Audio.celebrate(false);
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

    if (outcome && before) {
      // The result card: the verdict, the time, the chapter, what arrived,
      // and the way on — with the board stepping back to make room.
      this.winQuiet = this.presentResult(outcome, before, elapsed, readyIn, {
        dailyWasOpen,
        firstEverDaily,
        senseBefore,
      });
    } else {
      // The web Daily keeps the win screen it has always had.
      this.winQuiet = false;
      this.refreshHud();
      this.showHint(this.winPrompt, readyIn);
      this.showShareOffer(readyIn);
    }

    /*
     * At most one interruption per moment. If an ad is queued for the way
     * out, or the card already asks for something, the rating prompt stands
     * down rather than stacking on top of it. And it asks only at a peak —
     * which wins those are is Rate's call, from the facts passed here.
     */
    const quiet = this.winQuiet;
    const adWillShow =
      !quiet && Ads.wouldShowInterstitial(this.onboardingIndex, Progress.data.winsSinceAd);
    const rateWin = {
      levelIndex: this.dailyDate ? null : this.levelIndex,
      medal: this.winMedal,
      todayDailyFirst: firstFinish && this.dailyDate === todayISO(),
      streakAfter: outcome?.streak?.after ?? 0,
      attempts: this.attempts,
    };
    if (Rate.shouldAsk({ adWillShow, quiet, win: rateWin })) {
      const token = this.levelToken;
      const seq = this.winSeq;
      this.time.delayedCall(readyIn + 400, () => {
        // Still on the win screen, and no ad on the way. loadLevel puts the
        // phase back to 'idle' and advance() sets `advancing` synchronously, so
        // between them these two cover "they already tapped through". The app
        // gets ONE automatic prompt a version (the OS throttles to three a
        // year); spending it on top of the next maze or an interstitial wastes
        // it. Skipping simply asks at the next peak.
        if (token !== this.levelToken || seq !== this.winSeq) return;
        if (this.phase !== 'won' || this.advancing || this.shareSheet || this.sharing) return;
        void Rate.ask();
      });
    }
  }

  /* ---------------------------------------------------------- result card */

  /**
   * The win, in card form (WP-R's `showResult`): what the line earned, what
   * arrived, and the way on — with the board stepping back to make room. On
   * the win's clock (SPEC §3.7):
   *
   *     0     the ring catches the pen (win), the crease lights, the bloom
   *     530   droplets, land, the board steps back
   *     620   the card rises              700 / 880 / 1060  the stars punch in
   *     780   the card's buttons go live  1200  the chapter lights; what the
   *                                             win paid flies to the pill
   *
   * The card plays its own beats (the rise, the stars with their notes and
   * haptics, the chapter row); this scene keeps the board's and the flights.
   * Every beat checks it is still this win on this level: a fast player is on
   * the next maze by 800ms, and nothing of this one may land there.
   *
   * Returns whether the card asks for something — [Remind me] or the chapter
   * doubler — which makes this moment's one interruption.
   */
  private presentResult(
    outcome: WinOutcome,
    before: WinBefore,
    elapsed: number,
    readyIn: number,
    ctx: { dailyWasOpen: boolean; firstEverDaily: boolean; senseBefore: number }
  ): boolean {
    const token = this.levelToken;
    const seq = this.winSeq;
    const live = (): boolean =>
      this.sys.isActive() && token === this.levelToken && seq === this.winSeq && this.phase === 'won';

    // The pill keeps the balance from before the win until what the win paid
    // has flown in (see flyWinRewards).
    if (!Progress.data.adsRemoved && outcome.reveals > 0) {
      this.revealHold = Math.max(0, Progress.data.reveals - outcome.reveals);
    }

    // The Menu ticks its streak chip up from where this run was, not from
    // where its last build happened to be.
    const moved = outcome.streak;
    if (moved && moved.after > moved.before) this.registry.set(MENU_STREAK_FROM, moved.before);

    const ask = this.winAsk(outcome, ctx.firstEverDaily);
    const doubler = ask === null && this.offersDoubler(outcome);
    if (ask) Progress.recordNudgeAsk(todayISO());
    const spec = this.dailyDate
      ? this.dailySpec(outcome, elapsed, ask)
      : this.campaignSpec(outcome, before, elapsed, ask, doubler, ctx);

    // The verdict moves into the card, and the prompt with it.
    this.hideHint();
    this.ink.creaseSweep(this.pf.axisX, this.goalPx.y, this.startPx.y);

    this.frameWant = this.dailyDate
      ? monetization.ui.winFrameScaleDaily
      : monetization.ui.winFrameScale;
    this.framed = false;
    this.frameScale = this.fitFrameScale(resultRows(spec));

    /*
     * The card is built three frames on, told how late it is (`at`), so its
     * beats keep the win's clock: building it (60 ms at the 4× CPU proxy) on
     * the goal's frame, with the figure, froze the click the hand had just
     * felt (QA). The card rises at 620 ms; nothing is lost by the wait.
     */
    // Timed on the scene clock's own timer, like every other beat of the win
    // (a delayedCall counts from the step after it is made, as this does).
    const since = this.time.delayedCall(60_000, () => {});
    this.cardPending = true;
    afterFrames(this, 3, () => {
      const elapsed = since.getElapsed();
      since.remove();
      if (!live() || !this.cardPending) return;
      this.cardPending = false;
      const at = elapsed / (ms(1000) / 1000);
      const card = showResult(this, spec, this.cardPlace(), { at });
      card.onNext = () => this.pressNext();
      card.onRetry = () => this.pressRetry();
      card.onShare = () => this.pressShare();
      card.onBoard = () => this.pressLeaderboard();
      if (ask) card.onOffer = () => void this.pressRemindMe();
      else if (doubler) card.onOffer = () => void this.doDouble();
      this.resultCard = card;
      this.refreshHud();
    });

    this.time.delayedCall(ms(WIN_BEAT.settle), () => {
      if (!live()) return;
      this.ink.droplets(this.goalPx);
      // The figure has settled. The stars bring their own taps from 700;
      // this one ends the figure's beat, half a second after the pen clicked
      // into the ring — never on top of it. Under reduced motion the settle
      // comes 60 ms after the goal's own click, a double knock: the goal
      // haptic is the one kept (OWNER-DECISIONS 2).
      if (!motionReduced()) Haptics.land();
      if (this.frameScale < 1) {
        this.framed = true;
        this.ink.frameBoard(this.frameScale, this.framePivot, WIN_BEAT.frame);
      }
    });
    // Live with the tap gate: before it the card is under half faded in, and a
    // reach for a button that is not there yet must not press it.
    this.time.delayedCall(readyIn, () => {
      if (live() && !this.advancing) this.resultCard?.setLive(true);
    });
    this.time.delayedCall(ms(RESULT_BEAT.chapter), () => {
      if (!live()) return;
      // The card lights the bead and flips the streak; the sounds are the win's.
      if (outcome.chapter?.crossed.includes(20)) {
        Audio.reward();
        Haptics.success();
      }
      const s = outcome.streak;
      if (s && s.after > s.before) {
        Audio.streakUp();
        Haptics.success();
      }
      const card = this.resultCard;
      if (card) this.flyWinRewards(card, outcome);
    });
    // The Levels page's kit and chapter strip, painted while the player reads
    // the card: opened cold from here it was the one Levels open over its
    // 50 ms budget (QA, 59 ms at 4× CPU). A win changes one chapter tile, and
    // the strip repaints only then. Harmless when the Menu already did it.
    this.time.delayedCall(ms(RESULT_BEAT.chapter) + 900, () => {
      if (live()) warmLevels(this);
    });

    return ask !== null || doubler;
  }

  /** Where the board is framed about: the top of the playfield, on the fold. */
  private get framePivot(): Vec2 {
    return { x: this.pf.axisX, y: this.pf.y };
  }

  /** The scale the board steps back to for a card of `rows`, as the screen is now. */
  private fitFrameScale(rows: ResultRows): number {
    const place = this.cardPlace(1);
    return resultFrameScale({
      want: this.frameWant,
      pivotY: this.pf.y,
      boardBottom: this.pf.bottom,
      bannerTop: place.bannerTop,
      floor: place.floor,
      rows,
    });
  }

  /**
   * Where the card may go: under the board framed at `scale`, over the banner
   * line — or, where no banner can ever show, over the canvas's foot — inside
   * the safe area, nearly edge to edge (the B sheet).
   */
  private cardPlace(scale = this.frameScale): CardPlace {
    const s = this.safe;
    const foot = Ads.enabled ? bannerLine() : viewHeight();
    return {
      // The board steps back about its top (framePivot): its foot comes up by that much.
      boardBottom: this.pf.y + (this.pf.bottom - this.pf.y) * scale,
      bannerTop: foot - s.bottom,
      floor: minTap(this),
      cx: BASE_WIDTH / 2 + (s.left - s.right) / 2,
      width: Math.min(CARD_W, BASE_WIDTH - s.left - s.right - 2 * dp(11)),
    };
  }

  /**
   * A resize with the card up: the floor, the safe area and the banner line
   * may all have moved. The board steps back further (or less) if the card
   * needs it to, and the card is laid out again from the same numbers.
   */
  private relayoutResultCard(): void {
    const card = this.resultCard;
    if (!card) return;
    const s = this.fitFrameScale(card.rows);
    if (Math.abs(s - this.frameScale) > 1e-3) {
      this.frameScale = s;
      if (this.framed && s < 1) this.ink.frameBoard(s, this.framePivot, 200);
    }
    card.relayout(this.cardPlace());
  }

  private clearResultCard(): void {
    this.cardPending = false;
    this.closeShareSheet();
    this.resultCard?.destroy();
    this.resultCard = null;
    this.frameScale = 1;
    this.framed = false;
    this.doubling = false;
  }

  /**
   * The soft ask for reminders, if this card is one of its three moments:
   * the first Daily ever finished, the Daily that takes a streak to three,
   * and the card that completes chapter 1 for a player never asked. Never
   * once the permission is decided, at most three times, a week apart
   * (Nudges.shouldSoftAsk) — and never with a reward attached.
   */
  private winAsk(outcome: WinOutcome, firstEverDaily: boolean): { text: string } | null {
    const permission = this.notifPermission;
    if (!permission || !Nudges.shouldSoftAsk(Progress.data, todayISO(), permission)) return null;
    if (this.dailyDate) {
      const s = outcome.streak;
      const reachesThree = s !== null && s.before < 3 && s.after >= 3;
      if (!(firstEverDaily && this.dailyFirstFinish) && !reachesThree) return null;
      return { text: 'Tomorrow’s fold lands at midnight.' };
    }
    const c = outcome.chapter;
    if (c && c.index === 0 && c.crossed.includes(20) && Progress.data.nudgeAsks === 0) {
      return { text: 'Want a nudge when the Daily fold is ready?' };
    }
    return null;
  }

  /**
   * The chapter doubler: on the card that completes a chapter, an ad for two
   * more reveals. Only where one can play and today's cap still has two, never
   * for owners (their reveals are unlimited), and never inside the onboarding
   * ad grace — the same levels no interstitial may touch.
   */
  private offersDoubler(outcome: WinOutcome): boolean {
    const c = outcome.chapter;
    return (
      !this.dailyDate &&
      c !== null &&
      c.crossed.includes(20) &&
      !Progress.data.adsRemoved &&
      Ads.rewardedAvailable &&
      Progress.canAdPay(DOUBLER_REVEALS) &&
      this.onboardingIndex >= monetization.ads.interstitialFromLevel
    );
  }

  /**
   * The campaign card (SPEC §5.3): the stars this LINE earned, its verdict
   * against par, what the line is short of, the chips of what arrived, the
   * chapter's row, and Next with the next maze in miniature.
   */
  private campaignSpec(
    outcome: WinOutcome,
    before: WinBefore,
    elapsed: number,
    ask: { text: string } | null,
    doubler: boolean,
    ctx: { dailyWasOpen: boolean; senseBefore: number }
  ): ResultSpec {
    const d = Progress.data;
    const owner = d.adsRemoved;
    const c = outcome.chapter;
    const chips = this.rewardChips(outcome, owner);
    // The fifth fold opens the Daily. Said on the card that did it.
    if (!ctx.dailyWasOpen && Progress.dailyUnlocked()) {
      chips.push({ key: 'daily', text: 'Daily fold unlocked', icon: 'calendar' });
    }
    // Fold Sense moving is something that arrived too — only when it rose.
    // The first scored win has nothing to rise FROM (an unset profile is 0,
    // and the first win simply becomes it — FoldSense.nextProfileScore), so
    // it says "new" rather than "+81" (QA).
    const sense = Math.round(d.foldSense);
    const fresh = !(ctx.senseBefore > 0);
    const gain = sense - Math.round(ctx.senseBefore);
    if (fresh && sense > 0) chips.push({ key: 'sense', text: `Fold Sense ${sense}`, icon: 'sense', tone: 'quiet', gain: 'new' });
    else if (gain > 0) chips.push({ key: 'sense', text: `Fold Sense ${sense}`, icon: 'sense', tone: 'quiet', gain: `+${gain}` });
    // A scrape survived on the winning line: counted, never scored.
    const close = this.winCloseCalls;
    if (close > 0) chips.push({ key: 'close', text: `${close} close ${close === 1 ? 'call' : 'calls'}`, tone: 'quiet' });

    const nextIndex = this.levelIndex + 1;
    const nextLevel = nextIndex < LEVELS.length ? LEVELS[nextIndex] : null;
    const completes = c !== null && c.crossed.includes(20);
    const next: ResultNext | null = nextLevel
      ? completes
        ? { level: nextLevel, caps: 'Chapter complete', name: `Into ${chapterName(Math.floor(nextIndex / CHAPTER_SIZE))}` }
        : { level: nextLevel, caps: `Next · ${nextIndex + 1}`, name: nextLevel.name }
      : null;

    const time = `${(elapsed / 1000).toFixed(1)} s`;
    const best = before.prevBestMs !== null && elapsed < before.prevBestMs ? ' · new best' : '';
    const tries = this.attempts <= 1 ? 'first try' : `try ${this.attempts}`;

    /*
     * The first three folds have one verb: next. A figure from level 1 is not
     * something anybody shares yet, and a second button splits the thumb at
     * the moment the loop is being learned.
     */
    const squares: ResultSquare[] | undefined = this.levelIndex <= 2 ? [] : undefined;
    return {
      stars: this.winStars === 0 ? 1 : this.winStars,
      ratio: this.winRatio,
      missing: nextStarLine(this.winStars),
      sub: `${time}${best} · ${tries}`,
      chips,
      chapter: c
        ? resultChapter({
            save: d,
            levelIndex: this.levelIndex,
            wasCleared: before.wasCleared,
            owner,
            crossed: c.crossed,
            economy: monetization.economy.chapter,
          })
        : null,
      next,
      daily: null,
      squares,
      offer: ask ? { text: ask.text, button: 'Remind me' } : doubler ? { button: DOUBLER_TEXT } : null,
    };
  }

  /**
   * What the win paid, one chip each: "+1 reveal · halfway", "mission done ·
   * +1 reveal", a milestone's reveals and bookmark. Each chip's key is how its
   * flight finds where to leave from (WinCard.chipEnd).
   */
  private rewardChips(outcome: WinOutcome, owner: boolean): ResultChip[] {
    const chips: ResultChip[] = [];
    outcome.lines.forEach((l, i) => {
      const paid = owner ? ' ✓' : '';
      const reveals = owner ? '' : ` · ${plusReveals(l.reveals)}`;
      switch (l.kind) {
        case 'chapter-half':
          chips.push({ key: `reveal-${i}`, text: `halfway${reveals || paid}`, icon: 'gift' });
          break;
        case 'chapter-full':
          chips.push({ key: `reveal-${i}`, text: `chapter done${reveals || paid}`, icon: 'gift' });
          break;
        case 'mission': {
          // "Mission done" / "2 missions done", from the line Progress wrote.
          const what = l.text.replace(/ ✓$/, '').split(' · ')[0].toLowerCase();
          chips.push({ key: `reveal-${i}`, text: `${what}${reveals || paid}`, icon: 'check' });
          break;
        }
        default:
          // A streak milestone: its reveals, and its bookmark, each where it flies.
          if (l.reveals > 0 && !owner) chips.push({ key: `reveal-${i}`, text: plusReveals(l.reveals), icon: 'eye' });
          if (l.bookmarks > 0) {
            chips.push({
              key: `bookmark-${i}`,
              text: `+${l.bookmarks} ${l.bookmarks === 1 ? 'bookmark' : 'bookmarks'}`,
              icon: 'bookmark',
              tone: 'gold',
            });
          }
      }
    });
    return chips;
  }

  /**
   * The Daily's card: no stars (the Daily keeps none) and no Next — the run
   * as the headline, flipping up; the week; "Back to today", Share and, where
   * Game Center is, the leaderboard.
   */
  private dailySpec(outcome: WinOutcome, elapsed: number, ask: { text: string } | null): ResultSpec {
    const date = this.dailyDate ?? todayISO();
    const today = todayISO();
    const s = outcome.streak;
    const n = s ? s.after : Progress.dailyStreak(today);
    const m = s?.milestone ?? null;
    const titled = m !== null && m.day === n;
    const deaths = this.totalDeaths;
    const run = this.dailyFirstFinish
      ? `${clock(elapsed)} · ${deaths <= 0 ? 'first try' : deaths === 1 ? '1 retry' : `${deaths} retries`}`
      : `replayed · ${clock(elapsed)}`;
    const { done, marked } = streakSets(Progress.data);
    return {
      stars: 0,
      ratio: this.winRatio,
      missing: null,
      // A milestone's title takes the headline; the run is then said here.
      sub: titled && n > 0 ? `${n}-day streak · ${run}` : `Daily #${dailyNo(date)} · ${run}`,
      chips: this.rewardChips(outcome, Progress.data.adsRemoved),
      chapter: null,
      next: null,
      daily: {
        streak: { from: s && s.before > 0 ? s.before : n, to: n },
        title: titled ? m.title : null,
        week: weekStrip(done, marked, today),
        today,
        fresh: this.dailyFirstFinish && date === today,
        button: 'Back to today',
      },
      squares: this.offersLeaderboard ? ['board', 'share'] : ['share'],
      offer: ask ? { text: ask.text, button: 'Remind me' } : null,
    };
  }

  /**
   * What the win paid, flown in chip by chip: reveals to the Reveal pill,
   * whose number moves as each arrives, and bookmarks to the card's flame.
   * Owners see no reveal flights — theirs never run out.
   *
   * Every flight leaves from the end of its own chip and climbs beside the
   * card, never across it (see ResultCard.outwardPoint): reveals on the
   * right, toward the pill; bookmarks on the left, into the headline.
   */
  private flyWinRewards(card: WinCard, outcome: WinOutcome): void {
    const token = this.levelToken;
    const still = (): boolean => token === this.levelToken && this.resultCard === card;
    const lines = card.spec.chips;
    let delay = 0;
    // The reward lines, in order: each chip's reveals and bookmarks.
    outcome.lines.forEach((l, i) => {
      if (l.reveals > 0 && lines.some((c) => c.key === `reveal-${i}`)) {
        const n = l.reveals;
        this.time.delayedCall(delay, () => {
          if (!still()) return;
          const from = card.chipEnd(`reveal-${i}`, 'right') ?? card.headPoint();
          this.flyToPill(n, from, undefined, { card, side: 'right' });
        });
        delay += ms(160);
      }
      if (l.bookmarks > 0 && lines.some((c) => c.key === `bookmark-${i}`)) {
        const n = l.bookmarks;
        this.time.delayedCall(delay, () => {
          if (!still()) return;
          flyOut(this, {
            from: card.chipEnd(`bookmark-${i}`, 'left') ?? card.headPoint(),
            to: () => card.headPoint(),
            gutterX: card.gutter('left'),
            // Over the crown, then down onto the flame: never across the headline.
            turnY: card.turnY,
            count: n,
            glyph: bookmarkGlyph,
            target: card.headTarget,
          });
        });
        delay += ms(160);
      }
    });
  }

  /**
   * `n` reveals fly from `from` into the Reveal pill, and its number moves as
   * they land — see revealHold. Several flights may be in the air at once (a
   * chapter mark and a mission): each adds its own on landing, and the pill
   * lets go of the hold once the last has landed and its count has run.
   * Owners have no count to move, and see no flight. `out` sends a flight
   * that leaves from inside the result card out beside it (see flyOut).
   */
  private flyToPill(
    n: number,
    from: Vec2,
    then?: () => void,
    out?: { readonly card: WinCard; readonly side: 'left' | 'right' }
  ): void {
    const token = this.levelToken;
    if (Progress.data.adsRemoved || !(n > 0)) {
      this.revealHold = null;
      this.refreshHud();
      then?.();
      return;
    }
    if (this.revealHold === null) this.revealHold = Math.max(0, Progress.data.reveals - n);
    this.flightsInAir += 1;
    this.refreshHud();
    const onLand = (): void => {
      if (!this.sys.isActive() || token !== this.levelToken) return;
      this.flightsInAir = Math.max(0, this.flightsInAir - 1);
      const balance = Progress.data.reveals;
      const was = Math.min(this.revealHold ?? balance, balance);
      const now = Math.min(balance, was + n);
      /*
       * The count runs to what landed (see paintRevealCount) and is held
       * there until it has arrived — even when the landing is spent at once,
       * as a refill's auto-use spends it. The spend used to repaint the pill
       * on the same frame and cut the count dead: a pack read "+" then "19",
       * and a rewarded reveal never read "1" at all. Now it counts up to 20,
       * or to 1, and then down to what is left.
       */
      this.revealHold = now;
      this.refreshHud();
      then?.();
      this.time.delayedCall(ms(COUNT_MS) + ms(240), () => {
        if (!this.sys.isActive() || token !== this.levelToken || this.revealHold !== now) return;
        // Caught up. Another flight still in the air keeps the hold; it moves it when it lands.
        this.revealHold = this.flightsInAir > 0 ? now : null;
        this.refreshHud();
      });
    };
    if (out) {
      // From inside the result card: out beside it, never across its lines.
      flyOut(this, {
        from,
        to: () => this.pillPoint(),
        gutterX: out.card.gutter(out.side),
        turnY: out.card.top - TURN_ABOVE,
        count: n,
        glyph: eyeGlyph,
        target: this.revealPill,
        onLand,
      });
      return;
    }
    flyReward(this, {
      from,
      to: () => this.pillPoint(),
      count: n,
      glyph: eyeGlyph,
      target: this.revealPill,
      onLand,
    });
  }

  /** Where a reveal token lands: the eye on the Reveal pill, wherever the pill is now. */
  private pillPoint(): Vec2 {
    return { x: this.revealPill.x + this.revealEyeX, y: this.revealPill.y };
  }

  private pressNext(): void {
    // The tap that closed a share sheet reaches the page too — see SHARE_QUIET_MS.
    if (this.shareHoldsTaps) return;
    void this.advance();
  }

  /**
   * "↻ Retry for ★★★": the same fold again, at once — a quick print-in over
   * the ghost of the line just drawn (SPEC §5.3). Never an interstitial: an
   * ad may follow only an explicit Next, and this is not one.
   */
  private pressRetry(): void {
    if (this.shareHoldsTaps || this.advancing || Ads.busy || this.dailyDate) return;
    Haptics.tap();
    // Normalized, so it lands right if the board moves as the level reloads.
    const ghost = this.recorder.points.map((p) => this.pf.toNormalized(p));
    this.loadLevel(this.levelIndex, { printMs: 250, ghost });
  }

  /** [Share]: the two-option chooser where a replay can be made, the figure itself otherwise. */
  private pressShare(): void {
    // Once Next is pressed the card is on its way out — see advance().
    if (this.shareHoldsTaps || this.advancing) return;
    const canReplay = !this.dailyDate && replayVideoSupported() && this.runAttempts.length > 0;
    if (canReplay) this.chooseShare();
    else void this.shareCurrent();
  }

  /**
   * [Remind me]: the one thing in the game that may put up the system's
   * notification alert, and only because the player just asked. Whatever the
   * answer, the row says what happens now, in place.
   */
  private async pressRemindMe(): Promise<void> {
    const card = this.resultCard;
    if (!card || this.shareHoldsTaps || this.advancing) return;
    Haptics.tap();
    card.setOfferEnabled(false);
    const token = this.levelToken;
    const on = await Nudges.request();
    if (on) {
      Progress.setReminders(true);
      void Nudges.rebuild();
    }
    this.readNotifPermission();
    if (token !== this.levelToken || this.resultCard !== card) return;
    card.answerOffer(
      on
        ? `Reminders on · around ${Nudges.reminderTimeLabel()}`
        : 'No reminders · change it in Settings anytime'
    );
  }

  /**
   * The chapter doubler's ad. Pays on the reward event and nothing else — a
   * closed ad, a missing one, an ad for a card that has gone all pay nothing
   * but what was watched — and counts against the day's cap in the same write.
   */
  private async doDouble(): Promise<void> {
    const card = this.resultCard;
    if (!card || this.doubling || this.shareHoldsTaps || this.advancing) return;
    this.doubling = true;
    Haptics.tap();
    const token = this.levelToken;
    const seq = this.winSeq;
    const here = (): boolean =>
      this.sys.isActive() && token === this.levelToken && seq === this.winSeq && this.resultCard === card;
    card.setOffer('loading the ad…', false);
    const result = await Ads.showRewarded(
      'chapter-double',
      () => here() && this.phase === 'won' && !this.advancing && !this.shareSheet
    );
    this.doubling = false;
    if (result === 'earned') {
      // Watched is watched: paid even if the card has gone meanwhile.
      const paid = Progress.payAdReveals(DOUBLER_REVEALS);
      if (!here()) return;
      if (!paid) {
        card.setOffer(DOUBLER_TEXT, false);
        this.notify('free reveals are back tomorrow', 'plain', true);
        return;
      }
      card.setOffer(`✓ +${DOUBLER_REVEALS} more`, false);
      // The doubler is the offer row: out past its left end, and up the left
      // side of the card.
      this.flyToPill(DOUBLER_REVEALS, card.controlEnd('offer', 'left'), undefined, { card, side: 'left' });
      return;
    }
    if (!here()) return;
    card.setOffer(DOUBLER_TEXT, true);
    if (result === 'unavailable') this.notify('no ad ready just now — try again in a moment', 'warn', true);
  }

  /**
   * What the win screen's tap does, in the words the hint uses for it.
   *
   * "Next fold" only where there is one. The Daily's tap goes home — one fold a
   * day — and so does the last level's, and both used to promise a next fold
   * the tap then did not deliver.
   */
  private get winPrompt(): string {
    if (this.dailyDate) return 'tap to finish · come back tomorrow';
    if (this.levelIndex + 1 >= LEVELS.length) return 'tap to finish';
    return 'tap for the next fold';
  }

  private resetToIdle(): void {
    this.failTimer?.remove();
    this.failTimer = null;
    this.endPen();

    this.recorder.clear();
    this.ink.clearStroke();
    this.ink.clearWin();

    this.phase = 'idle';
    this.activePointer = null;
    this.setRescueOffersLive(true);
    this.clearShareOffer();
    // The card belongs to the win it was built for, and so does the frame
    // (clearWin above has already put the board back).
    this.clearResultCard();
    if (!this.hintSticky) this.hideHint();
    // The previous attempt lingers as a ghost until the next stroke begins:
    // where it died is the one fact the player needs for the next plan.
    if (this.lastAttempt) {
      this.ink.showGhost(this.lastAttempt, this.lastAttemptMirror, this.lastAttemptReflected, {
        mark: !this.lastAttemptWon,
      });
      // A new ghost may have dipped under the dot, where the pills stand.
      this.relayoutRescuePills();
    }
    this.refreshHud();
    // A world height that changed during the stroke, the flash or the win:
    // the board goes where it now belongs (followHeight).
    this.moveBoardIfStale();
  }

  /**
   * Leaving a win. This is the ONE place an interstitial may fire, and it fires
   * only after the figure has been seen and dismissed — never over it.
   */
  private async advance(): Promise<void> {
    if (this.advancing) return;
    // A full-screen ad is loading or up — the doubler's, most likely. A tap
    // that reached the page meanwhile is not "next"; the ad has the moment.
    if (Ads.busy) return;
    this.advancing = true;
    // Next is pressed: the card has had its moment. Its other buttons would
    // open a share or an alert that the interstitial then lands on top of.
    this.resultCard?.setLive(false);

    const next = this.levelIndex + 1;

    /*
     * One interruption per moment. A card that asked for something — the
     * doubler's ad, [Remind me] — has had this one, so the interstitial waits
     * for the next natural break, with `winsSinceAd` still armed for it.
     */
    if (
      !this.winQuiet &&
      Ads.wouldShowInterstitial(this.onboardingIndex, Progress.data.winsSinceAd)
    ) {
      // Still on this win screen, or the ad is not wanted: ‹ during the load
      // used to put the interstitial over the Menu, and the level load below
      // then ran on a scene that had already been torn down.
      const token = this.levelToken;
      const here = (): boolean => this.sys.isActive() && token === this.levelToken;
      // Never over a share, the chooser or the system's own sheet.
      const shown = await Ads.showInterstitial(() => here() && !this.shareSheet && !this.sharing);
      // Only spend the counter when an ad actually rendered; on no-fill it
      // stays armed so the next natural break retries.
      if (shown) Progress.update({ winsSinceAd: 0, attemptsSinceAd: 0 });
      if (!here()) return;
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
    /*
     * One reveal at a time. A second tap while the bands are still up used to
     * spend another reveal — sold in packs, earned by watching ads — only to
     * restart the timer on the same bands. Pale bands invite exactly that tap,
     * so it gets an answer rather than a charge.
     */
    if (this.time.now < this.revealHoldUntil) {
      this.flashHint('the folded walls are showing');
      return;
    }
    // An ad for a refill is loading or up: a second sheet would open under it.
    if (Ads.busy) return;
    Haptics.tap();

    if (Progress.spendReveal()) {
      this.levelReveals += 1;
      // Whatever the refill sheet was opened for, the player is looking now.
      this.refillAskedOn = null;
      const hold = monetization.reveals.durationMs;
      this.ink.showReveal(this.mirrorBands, hold);
      // Until the bands start to fade: InkRenderer.showReveal eases them in
      // over ms(220), holds for `hold`, then fades them out.
      this.revealHoldUntil = this.time.now + ms(220) + hold;
      this.startRevealDrain(ms(220) + hold);
      this.refreshHud();
      return;
    }

    this.showRefillSheet();
  }

  /**
   * Whether a reveal can be delivered right now: one in the stash, or a way to
   * get one — the rewarded ad, or a pack. The same rule dims the Reveal pill.
   */
  private get revealDeliverable(): boolean {
    return Progress.reveals > 0 || Ads.rewardedAvailable || Iap.available;
  }

  /**
   * Out of reveals: the one contextual store moment in the game. Wherever the
   * rewarded unit exists it comes FIRST and is the only primary — reveals must
   * stay earnable, or watching the next ad stops being a fair deal — and the
   * pack sits beside it for whoever values their time differently. The pack
   * stays 'secondary' even when it is the only row: the purchase never gets
   * promoted just because the free path happens to be missing.
   */
  /**
   * Out of reveals: the highest-intent moment in the game.
   *
   * The rows themselves live in StoreSheet, shared with the menu, so the two
   * shops cannot drift. What belongs to this scene is the framing — the title
   * says why the card opened — and what to do afterwards.
   */
  private showRefillSheet(): void {
    if (this.refillSheet) return;

    /*
     * The store answers late — a purchase, a restore, a rewarded ad — and by
     * then the player may have left. Painting the HUD of a scene that has shut
     * down throws from inside Phaser's text renderer; the reveal is already
     * stored by Progress, so dropping the repaint loses nothing.
     */
    const token = this.levelToken;
    const hooks: StoreHooks = {
      // Everything the sheet says answers a tap on it — a purchase, an ad, a
      // restore — so it goes ahead of any news waiting (see UI.toast).
      onChange: (notice, landed) => {
        if (!this.sys.isActive()) return;
        const here = token === this.levelToken;
        /*
         * The sheet opened because they asked to see the folded walls. If what
         * landed was reveals and they are still waiting on this level, give
         * them what they asked for: the reveal flies in and is spent at once,
         * rather than leaving them to find the pill and tap it again.
         */
        if (landed?.kind === 'reveals' && landed.reveals > 0 && here && this.phase === 'idle') {
          this.refillAndReveal(landed.reveals, true);
          return;
        }
        if (notice) this.notify(notice, 'reward', true);
        if (here && landed?.kind === 'reveals' && landed.reveals > 0) {
          this.flyToPill(landed.reveals, { x: BASE_WIDTH / 2, y: viewHeight() / 2 });
        } else {
          this.refreshHud();
        }
      },
      onNotice: (m, tone) => {
        if (this.sys.isActive()) this.notify(m, tone ?? 'plain', true);
      },
      /**
       * For the rewarded refill: still on this level, and not mid-stroke or on
       * a win. Read by StoreSheet when it passes it on to Ads.showRewarded.
       */
      stillWanted: () =>
        this.sys.isActive() &&
        token === this.levelToken &&
        this.phase !== 'drawing' &&
        this.phase !== 'won' &&
        !this.shareSheet,
    };

    /*
     * The sheet builds its own rows and says itself what it cannot sell —
     * "free reveals are back tomorrow", "the store isn't reachable". Only
     * where there is no store here at all does it decline to open.
     */
    const sheet = showStoreSheet(this, {
      title: 'Out of reveals',
      kind: 'refill',
      hooks,
      onClose: () => this.closeRefillSheet(),
      stillOpen: (s) => this.refillSheet === s,
    });
    if (!sheet) {
      this.flashHint('out of reveals — one more lands tomorrow');
      return;
    }
    this.refillSheet = sheet;
    this.refillAskedOn = this.levelToken;
  }

  /**
   * Refill auto-use: `n` reveals fly into the pill and one is spent the moment
   * they land, if the board is still waiting for it — a stroke begun in the
   * meantime keeps its reveal for when the player wants it. `urgent` when it
   * answers a tap on the sheet just now; not for a purchase approved later.
   */
  private refillAndReveal(n: number, urgent: boolean): void {
    const token = this.levelToken;
    this.flyToPill(n, { x: BASE_WIDTH / 2, y: viewHeight() / 2 }, () => {
      if (!this.sys.isActive() || token !== this.levelToken || this.phase !== 'idle') return;
      void this.doReveal();
      this.notify(`${plusReveals(n)} · showing the folded walls`, 'reward', urgent);
    });
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
     * That is also the exact geometry ad networks disable serving over.
     */
    if (this.refillSheet || this.webDailyEnd || this.shareSheet) return;
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

    /*
     * And all of the above again, with the ad in hand. The load is quick but
     * not instant, and a player who reaches for the dot the moment the board
     * clears — the whole point of a fast retry — had the ad land on the stroke
     * they had already started; one who jabbed Reveal had it land on the sheet.
     */
    const token = this.levelToken;
    const stillClear = (): boolean =>
      this.sys.isActive() &&
      token === this.levelToken &&
      this.phase === 'idle' &&
      this.activePointer === null &&
      !this.advancing &&
      !this.refillSheet &&
      !this.webDailyEnd &&
      !this.shareSheet &&
      !this.revealOfferPill &&
      !this.skipPill;
    const shown = await Ads.showInterstitial(stillClear);
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
   * playfield — 62% of the way down the designed 9:16 world, measured on the
   * board wherever a taller world has put it.
   */
  private pillY(lift: number): number {
    const anchored = bannerLine() - lift;
    const clear = this.startPx.y - METRICS.startRadius * 2.4 - pt(28);
    const floor = this.pf.y - METRICS.inset.top + BASE_HEIGHT * 0.62;
    return Math.max(floor, Math.min(anchored, clear));
  }

  /* ---------------------------------------------------------------- share */

  /**
   * The growth loop, offered at the only moment it can work: the player is
   * looking at something they just made and are pleased with.
   */
  /**
   * The Daily Fold's board, offered at the only moment anyone wants it: they
   * have just finished today's maze and know their time.
   *
   * Only on the Daily, only where GameKit exists, and it opens Game Center's
   * own screen rather than anything of ours — the ranking belongs to the
   * platform, and a board we drew ourselves would be a second source of truth.
   *
   * IN the share row, as its first pill, and not a row of its own. It used to be
   * placed through pillY with a larger lift, but every maze starts at the same
   * height, so pillY's "clear of the start" term won for both lifts and the two
   * rows landed on the same line: "Share the replayLeaderboard Share this fold",
   * with the Leaderboard's tap area over the inner half of both share pills.
   * Above the row there is only the maze, so the row is where it fits — and on
   * the Daily the replay slot is free anyway (see showShareOffer).
   */
  private get offersLeaderboard(): boolean {
    return !!this.dailyDate && GameCenter.available;
  }

  private pressLeaderboard(): void {
    // Game Center's screen must not open from the tap that closed a share, nor
    // under an interstitial that Next has already asked for.
    if (this.shareHoldsTaps || this.advancing) return;
    Haptics.tap();
    void GameCenter.show().then((shown) => {
      if (!shown && this.sys.isActive()) this.flashHint('game center is not signed in');
    });
  }

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
     * Never on the Daily. Everyone plays the same maze today and the line IS
     * the solution, so the Daily shares a spoiler-safe score and never its
     * geometry (see shareCurrent) — and a clip of the winning line, one pill
     * over, was exactly that geometry.
     *
     * Side by side rather than stacked: the pill row already sits above the
     * start marker (see pillY) and a second row would either cover it or push
     * into the hint at the banner line.
     */
    const canReplay = !this.dailyDate && replayVideoSupported() && this.runAttempts.length > 0;
    const withBoard = this.offersLeaderboard;
    const pair = canReplay || withBoard;
    const w = pair ? pt(146) : pt(190);
    const h = pt(40);
    const gap = pt(8);
    const y = this.pillY(pt(62));
    const xs = pair
      ? [BASE_WIDTH / 2 - (w + gap) / 2, BASE_WIDTH / 2 + (w + gap) / 2]
      : [BASE_WIDTH / 2];

    const row = this.add.container(0, 0).setDepth(50);
    /*
     * The face is painted at the row's height; the tap area is `minTap` tall
     * wherever the face is shorter than that. A ghost button is the tap area
     * — it paints nothing until pressed — and the face goes under it.
     */
    const make = (x: number, text: string, press: () => void, quiet = false): void => {
      const pill = button(this, x, y, text, {
        width: w,
        height: h,
        minTap: true,
        variant: 'ghost',
        size: TYPE.label,
        onPress: press,
      });
      // An opaque paper backing under the translucent face: without it the win
      // figure is drawn straight through the pill, dots through the label.
      const face = this.add.graphics();
      face.fillStyle(theme().paper, 1);
      roundRect(face, -w / 2, -h / 2, w, h, RADIUS.md);
      // The Leaderboard stays the quieter of the two, as it always was: paper
      // only, where a share pill carries the secondary tint.
      if (!quiet) {
        face.fillStyle(theme().ink, 0.055);
        roundRect(face, -w / 2, -h / 2, w, h, RADIUS.md);
      }
      pill.addAt(face, 0);
      row.add(pill);
    };

    if (canReplay) {
      make(xs[0], 'Share the replay', () => void this.shareReplay());
      make(xs[1], 'Share this fold', () => void this.shareCurrent());
    } else if (withBoard) {
      make(xs[0], 'Leaderboard', () => this.pressLeaderboard(), true);
      make(xs[1], 'Share this fold', () => void this.shareCurrent());
    } else {
      make(xs[0], 'Share this fold', () => void this.shareCurrent());
    }

    row.setAlpha(0);
    this.sharePill = row;
    this.shareRowRect = {
      left: xs[0] - w / 2,
      right: xs[xs.length - 1] + w / 2,
      y,
      h,
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
    // The leaderboard pill lives and dies with this row — it is one of its
    // pills. Leaving it behind is exactly how the reveal offer once survived
    // into the next level and painted over the share pill's backing.
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
    // The pills' own tap height, measured now: it follows the canvas scale.
    const half = Math.max(rect.h, minTap(this)) / 2;
    return (
      pointer.x >= rect.left &&
      pointer.x <= rect.right &&
      pointer.y >= rect.y - half &&
      pointer.y <= rect.y + half
    );
  }

  /**
   * The win card's [Share], where both shares exist: the Gallery's chooser —
   * the replay, the picture, or not now.
   *
   * TWO shares, because they are two different things to send. The replay is
   * the growth loop: a clip of the run — the misses, then the line that
   * worked — shows the mechanic to somebody who has never opened the game.
   * The picture is the personal one, and it pastes into a chat as an image.
   * They used to be two pills side by side on the win screen; on the card
   * they are one button, and this is what it opens.
   */
  private chooseShare(): void {
    if (this.shareSheet || this.shareHoldsTaps) return;
    const figure = Progress.figures[0];
    if (!figure) return;
    Haptics.tap();

    // Centred on the world as it is, and kept there if it changes (keepCentred).
    const sheet = keepCentred(this.add.container(0, 0).setDepth(90));
    this.shareSheet = sheet;
    const cy = viewHeight() / 2;
    // A tap that closes the sheet raises a short shield: the win screen under
    // it takes a tap as "next", and the second tap of a double tap would be one.
    const close = (): void => {
      shieldInput(this);
      this.closeShareSheet();
    };
    // The night scrim, and the page's bands dimmed with it (UI.scrim): a
    // cream wash would fog the night grey.
    const dim = scrim(this, BASE_WIDTH / 2, cy);
    dismissOnScrim(dim, close);
    sheet.add(dim);

    const rows: [string, () => void][] = [
      ['Share the replay', () => void this.shareReplay()],
      ['Share this fold', () => void this.shareCurrent()],
    ];
    const cw = pt(272);
    const ROW = pt(44);
    const GAP = pt(9);
    // Rows spaced for the thumb's floor wherever it is more than the design
    // (see GalleryScene.chooseShare, which this is), and capped to that room.
    const floor = minTap(this);
    const pitch = Math.max(ROW + GAP, floor + pt(1));
    const toNotNow = Math.max(ROW + pt(16), floor + pt(1));
    const underNotNow = Math.max(pt(28), floor / 2 + pt(1));
    const ch = pt(72) + ROW / 2 + (rows.length - 1) * pitch + toNotNow + underNotNow;
    const top = cy - ch / 2;

    // An opaque sheet over the scrim, baked (G2).
    sheet.add(sheetPanel(this, BASE_WIDTH / 2, cy, cw, ch, RADIUS.lg));
    sheet.add(cardBlocker(this, BASE_WIDTH / 2, cy, cw, ch));
    sheet.add(
      label(this, BASE_WIDTH / 2, top + pt(36), `${figure.levelName} · ${(figure.ms / 1000).toFixed(1)}s`, {
        size: TYPE.body,
        font: FONT.display,
        color: ui().text2,
      }).setOrigin(0.5)
    );

    let rowY = top + pt(72) + ROW / 2;
    for (const [text, press] of rows) {
      sheet.add(
        button(this, BASE_WIDTH / 2, rowY, text, {
          width: cw - pt(30),
          height: ROW,
          minTap: true,
          maxTap: pitch - pt(1),
          variant: 'secondary',
          size: TYPE.label,
          onPress: () => {
            close();
            press();
          },
        })
      );
      rowY += pitch;
    }
    rowY += toNotNow - pitch;
    sheet.add(
      button(this, BASE_WIDTH / 2, rowY, 'Not now', {
        width: cw - pt(30),
        height: pt(30),
        minTap: true,
        maxTap: Math.min(toNotNow - pt(1), 2 * underNotNow - pt(1)),
        variant: 'ghost',
        size: TYPE.label,
        onPress: close,
      })
    );
  }

  private closeShareSheet(): void {
    this.shareSheet?.destroy(true);
    this.shareSheet = null;
  }

  /**
   * A share is up, or has only just gone: a tap now is most likely the one
   * that closed its sheet — see SHARE_QUIET_MS — and means nothing else.
   */
  private get shareHoldsTaps(): boolean {
    return this.sharing || performance.now() < this.shareQuietUntil;
  }

  /**
   * Run a share with the screen's taps held for it: `sharing` while it is up,
   * the quiet window once it settles, and a promise ‹ can wait on.
   */
  private async runShare(share: () => Promise<void>): Promise<void> {
    if (this.shareHoldsTaps) return;
    const run = ++this.shareRun;
    this.sharing = true;
    let settle = (): void => undefined;
    this.shareSettled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    try {
      await share();
    } finally {
      settle();
      // A share that outlived its screen leaves the next one alone.
      if (run === this.shareRun) {
        this.sharing = false;
        this.shareSettled = null;
        this.shareQuietUntil = performance.now() + SHARE_QUIET_MS;
      }
    }
  }

  private shareCurrent(): Promise<void> {
    return this.runShare(async () => {
      Haptics.tap();
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
        fileName: shareFileName(figure.levelName, 'png'),
      });
    });
  }

  /**
   * Send the run as a video: the misses, then the line that worked.
   *
   * Rendering is not instant — a few hundred frames go through the hardware
   * encoder — so the button says what it is doing rather than appearing to
   * hang. Anything that goes wrong falls back to nothing rather than to a
   * silent failure: `sharing` is cleared and the hint says so.
   *
   * And the card always comes down. It is modal — its scrim sits over the back
   * button — so a render that never finished (iOS 26's audio encoder never
   * settles its flush) left a player with no way out but killing the app. The
   * render bounds its own steps; on top of that the card offers Cancel after a
   * moment, and gives up by itself at REPLAY_CEILING_MS. Either way "Share this
   * fold" is free again the moment it is gone.
   */
  private shareReplay(): Promise<void> {
    return this.runShare(async () => {
      Haptics.tap();

      const figure = Progress.figures[0];
      const attempts = this.runAttempts;
      if (!figure || attempts.length === 0) return;

      const progress = progressCard(this, 'Folding your replay');
      const stop = new AbortController();
      let cancelled = false;
      const offerCancel = this.time.delayedCall(REPLAY_CANCEL_AFTER_MS, () =>
        progress.offerCancel(() => {
          cancelled = true;
          stop.abort();
        })
      );
      const ceiling = this.time.delayedCall(REPLAY_CEILING_MS, () => stop.abort());
      const takeDown = (): void => {
        offerCancel.remove();
        ceiling.remove();
        progress.destroy();
      };
      try {
        const blob = await renderReplayVideo(
          {
            figure,
            attempts,
            caption: `${figure.levelName} · ${(figure.ms / 1000).toFixed(1)}s`,
            challenge: CHALLENGE,
          },
          (p) => progress.setProgress(p),
          { signal: stop.signal }
        );
        takeDown();
        if (!this.sys.isActive()) return;

        if (!blob) {
          // The player's own Cancel needs no explaining.
          if (!cancelled) this.flashHint('could not build the replay — the picture still works');
          return;
        }

        await Share.shareVideo({
          blob,
          title: 'My foldwing',
          text: shareText(figure),
          fileName: shareFileName(figure.levelName, 'mp4'),
        });
      } finally {
        takeDown();
      }
    });
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
    // A replay won today is a revisit too: the time is the recorded first
    // finish's, and pairing it with the replay's tries described two runs.
    if (this.phase === 'won' && this.dailyFirstFinish) {
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
    const sheet = keepCentred(this.add.container(0, 0).setDepth(90));

    // The night scrim, which dims the page around the canvas with it: a
    // desktop browser window is mostly that page (UI.scrim).
    sheet.add(scrim(this, BASE_WIDTH / 2, viewHeight() / 2));

    const cw = pt(300);
    const cy = viewHeight() / 2 - pt(20);

    /*
     * The result line, kept inside the card. An ordinary hard day — nine
     * misses, a reveal, a long streak — made it wider than the whole canvas:
     * it ran past both edges of the card and off both edges of the screen. It
     * breaks onto a second line where it has to, only ever at a " · ", so
     * every part stays whole, and the card grows by the line it added.
     */
    const result = label(this, BASE_WIDTH / 2, 0, 'Ag', {
      size: TYPE.label,
      color: ui().text2,
      align: 'center',
    }).setOrigin(0.5, 0);
    const lineH = result.height;
    wrapAtSeparators(result, this.dailyResultText().split('\n')[0], ' · ', cw - pt(24));
    const extra = Math.max(0, result.height * result.scaleY - lineH);

    const ch = pt(210) + extra;
    const top = cy - ch / 2;
    sheet.add(sheetPanel(this, BASE_WIDTH / 2, cy, cw, ch, RADIUS.lg));

    sheet.add(
      label(this, BASE_WIDTH / 2, top + pt(26), 'Folded for today', {
        size: TYPE.body,
        font: FONT.display,
      }).setOrigin(0.5)
    );
    // Its first line where the single line always sat; any second one below.
    sheet.add(result.setY(top + pt(48) - lineH / 2));

    let rowY = top + pt(82) + extra;
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
      // Counted rather than typed: this is a promise about what is in the app,
      // and a stale number here is a promise the store build does not keep.
      button(this, BASE_WIDTH / 2, rowY, `Get the app · ${LEVELS.length} more folds`, {
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

  private showSkipOffer(drawn: boolean | null = null): void {
    /*
     * The label promises an ad only where one can play. Where none can — the
     * web, an ads-off build, a player who declined ad consent — the tap skips
     * for free anyway (see doSkip), so "Watch ad" would be a promise the button
     * then quietly breaks.
     *
     * And the promise is KEPT as drawn. The ad SDK can come up after the pill
     * does (an offline launch, a consent answered late), and doSkip used to ask
     * again at the tap — so "Skip this fold" played an ad nobody was promised,
     * and closing it early skipped nothing.
     */
    //
    // Free for Remove Ads owners too: they paid not to be asked to watch one,
    // and "& skips" is on the product they bought. A pill built again only to
    // fit a new place is handed what it was drawn saying (`drawn`, from
    // relayoutRescuePills) and keeps it — see skipDrawnFree.
    this.skipIsFree = skipDrawnFree(drawn, Ads.rewardedAvailable, Progress.data.adsRemoved);
    this.skipLabel = this.skipIsFree ? 'Skip this fold' : 'Watch an ad → skip this fold';
    this.skipPill = this.rescuePill(
      this.skipIsFree ? pt(210) : pt(270),
      this.skipLabel,
      () => void this.doSkip(),
      this.skipIsFree ? undefined : videoGlyph
    );
  }

  /**
   * Remove Ads bought with the skip pill up — from the refill sheet the Reveal
   * pill opens, or an Ask to Buy approved late: the pill that promised an ad
   * is drawn again as the free skip the owner has now paid for.
   */
  private syncSkipOffer(): void {
    const pill = this.skipPill;
    if (!pill || !pill.scene || this.skipping || this.phase === 'drawing') return;
    if (this.skipIsFree || !Progress.data.adsRemoved) return;
    this.clearSkipOffer();
    this.showSkipOffer();
  }

  private clearSkipOffer(): void {
    if (!this.skipPill) return;
    this.tweens.killTweensOf(this.skipPill);
    this.skipPill.destroy(true);
    this.skipPill = null;
    this.syncRescueHold();
  }

  /** The tray gives way to a rescue pill for exactly as long as one is on the board. */
  private syncRescueHold(): void {
    const shown = [this.revealOfferPill, this.skipPill].some((p) => p?.scene && p.input?.enabled !== false);
    this.hud?.holdTray('rescue', shown);
  }

  /**
   * The contextual reveal: after a few deaths, point at the mechanic the
   * player is losing to. The eye button is passive; this is the game saying
   * "the walls you keep hitting are on the other side" at the exact moment
   * that sentence means something.
   *
   * It says what the tap costs, every time: one of their reveals ("1 of 7"),
   * nothing (an owner's are unlimited), an ad for one, or the refill sheet.
   * A currency offer is never drawn free — with no reveal, no ad and no store,
   * there is no pill (see currentRevealOffer).
   */
  private showRevealOffer(): void {
    const kind = this.currentRevealOffer();
    if (!kind) return;
    const { text, icon } = this.revealOfferCopy(kind);
    this.revealOfferKind = kind;
    this.revealOfferPill = this.rescuePill(
      icon ? pt(270) : pt(230),
      text,
      () => {
        if (kind === 'ad') {
          void this.revealByAd();
          return;
        }
        this.clearRevealOffer();
        void this.doReveal();
      },
      icon
    );
  }

  /** Which row of the three-death table applies right now, or null for no pill. */
  private currentRevealOffer(): RevealOfferKind | null {
    if (Progress.data.adsRemoved) return 'owner';
    if (Progress.reveals > 0) return 'spend';
    // An ad for a reveal only while one can play and today's cap has one left.
    if (Ads.rewardedAvailable && Progress.canAdPay(1)) return 'ad';
    if (Iap.available && !WEB_DAILY) return 'store';
    return null;
  }

  private revealOfferCopy(kind: RevealOfferKind): { text: string; icon?: Glyph } {
    switch (kind) {
      case 'spend':
        return { text: `Show the folded walls · 1 of ${Progress.reveals}`, icon: eyeGlyph };
      case 'owner':
        return { text: 'Show the folded walls', icon: eyeGlyph };
      case 'ad':
        return { text: 'Watch an ad → see the folded walls', icon: videoGlyph };
      case 'store':
        return { text: 'See the folded walls?' };
    }
  }

  /**
   * Keep the offer true to the balance: a reveal spent from the header makes
   * "1 of 7" read "1 of 6", and one that empties the stash turns the pill
   * into what can be done instead. Not mid-stroke — the pill is off the board
   * then — and not while its ad is loading.
   */
  private syncRevealOffer(): void {
    const pill = this.revealOfferPill;
    if (!pill || !pill.scene || this.revealAdPending || this.phase === 'drawing') return;
    const kind = this.currentRevealOffer();
    if (kind === null) {
      this.clearRevealOffer();
    } else if (kind !== this.revealOfferKind) {
      this.clearRevealOffer();
      this.showRevealOffer();
    } else if (kind === 'spend') {
      relabel(pill, this.revealOfferCopy(kind).text, pill.width - 2 * pt(36));
    }
  }

  private clearRevealOffer(): void {
    this.revealOfferKind = null;
    if (!this.revealOfferPill) return;
    this.tweens.killTweensOf(this.revealOfferPill);
    this.revealOfferPill.destroy(true);
    this.revealOfferPill = null;
    this.syncRescueHold();
  }

  /**
   * The three-death offer's ad ('reveal-offer'). Pays on the reward event only
   * — one reveal, counted against the day's cap in the same write — and then
   * spends it at once: the tap was a request to see the folded walls, not to
   * collect a reveal. Nothing arrives on a closed or missing ad.
   */
  private async revealByAd(): Promise<void> {
    if (this.revealAdPending) return;
    Haptics.tap();
    const token = this.levelToken;
    const here = (): boolean => this.sys.isActive() && token === this.levelToken;
    const pill = this.revealOfferPill;
    const from: Vec2 = pill ? { x: pill.x, y: pill.y } : { x: BASE_WIDTH / 2, y: viewHeight() / 2 };
    this.revealAdPending = true;
    relabel(pill, 'loading the ad…', (pill?.width ?? 0) - 2 * pt(36));
    const result = await Ads.showRewarded(
      'reveal-offer',
      () =>
        here() &&
        this.phase !== 'drawing' &&
        this.phase !== 'won' &&
        !this.refillSheet &&
        !this.shareSheet
    );
    this.revealAdPending = false;
    if (result === 'earned') {
      // Watched is watched: paid even if the level has gone meanwhile.
      const paid = Progress.payAdReveals(1);
      if (!here()) return;
      this.clearRevealOffer();
      if (!paid) {
        this.notify('free reveals are back tomorrow', 'plain', true);
        this.refreshHud();
        return;
      }
      this.flyToPill(1, from, () => {
        if (here() && this.phase !== 'won') void this.doReveal();
      });
      return;
    }
    if (!here()) return;
    if (this.revealOfferPill === pill) {
      relabel(pill, this.revealOfferCopy('ad').text, (pill?.width ?? 0) - 2 * pt(36));
    }
    if (result === 'unavailable') this.notify('no ad ready just now — try again in a moment', 'warn', true);
    this.refreshHud();
  }

  /**
   * A rescue offer: under the start dot, in the band the hint line has over
   * the banner — see core/Rescue.
   *
   * They used to sit in the runway above the start, off the lowest wall row.
   * Every route leaves the dot upward through that band, so the last attempt's
   * ghost — the one thing a death leaves to plan the next stroke by — ran
   * under the pill from the dot up, and on a Split View pane the pill covered
   * the lowest wall row outright. Under the dot — under its grab zone, so a
   * press on the pill is never taken for a reach for the dot — there is
   * nothing a maze draws. Where that band is too short for the face it
   * shrinks, and its tap area gives way to the band; where there is no band
   * at all (a Duo shape whose home-indicator inset lifts the banner line to
   * the grab zone) it keeps the runway.
   *
   * The pill paints on an opaque backing, and setRescueOffersLive takes it off
   * the board for exactly as long as a line is being drawn. While one is up
   * the hint line — whose band this is — speaks as a toast (see showHint).
   */
  private rescuePill(
    w: number,
    text: string,
    press: () => void,
    icon?: Glyph
  ): Phaser.GameObjects.Container {
    const spot = this.rescuePlace(w);
    const h = spot.h;
    const pill = button(this, BASE_WIDTH / 2, spot.y, text, {
      width: w,
      height: h,
      // Tapped at `minTap` like the other pills, as far as the band lets it.
      minTap: true,
      maxTap: spot.tap,
      variant: 'secondary',
      size: TYPE.label,
      // What the tap costs, as a mark: an eye for a reveal, a screen for an ad.
      icon,
      onPress: () => {
        // A press that started a stroke was a reach for the dot; its release
        // is not a tap here.
        if (this.downWasStroke) return;
        press();
      },
    });
    this.rescueSpots.set(pill, spot);
    // The caption is centred on the whole pill, so with a mark on the left it
    // keeps clear of the mark on both sides.
    fitCaption(pill, icon ? w - 2 * pt(36) : w - pt(24));
    const backing = this.add.graphics();
    backing.fillStyle(theme().paper, 1);
    roundRect(backing, -w / 2, -h / 2, w, h, Math.min(RADIUS.md, h / 2));
    pill.addAt(backing, 0);
    // Above the ink (stroke 20) and the ghost, below the HUD and the sheets.
    pill.setDepth(45).setAlpha(0);
    this.tweens.add({ targets: pill, alpha: 1, duration: ms(300) });
    this.handHintToToast();
    // The pill stands in the tray's band: the tray's row stands aside, and its
    // attempt line moves up to the thread row (PlayHud.holdTray).
    this.hud.holdTray('rescue', true);
    return pill;
  }

  /** Where a rescue pill `w` wide goes now: the band under the dot, or the runway above it. */
  private rescuePlace(w: number): RescueSpot {
    const left = BASE_WIDTH / 2 - w / 2;
    const right = BASE_WIDTH / 2 + w / 2;
    const spot = rescueSpot({
      startY: this.startPx.y,
      grabRadius: METRICS.startRadius * METRICS.startGrabFactor,
      // The banner line where one can show; the canvas foot where none can.
      bannerTop: (Ads.enabled ? bannerLine() : viewHeight()) - this.safe.bottom,
      // Wholly under the board sheet where that band holds the face.
      sheetBottom: this.hudLayout?.sheetBottom ?? null,
      floor: minTap(this),
      faceH: RESCUE.faceH,
      minFaceH: RESCUE.minFaceH,
      gap: RESCUE.gap,
      ghostLow: this.lastAttempt ? ghostHeadLow(this.lastAttempt, RESCUE.ghostReach, left, right) : null,
    });
    if (spot) return spot;
    const h = RESCUE.faceH;
    return { y: this.runwayY(w, h), h, tap: Math.max(h, minTap(this)) };
  }

  /**
   * Place the pills again: a resize moves the thumb's floor and the banner
   * line, and a new death leaves a new ghost to keep clear of. A pill whose
   * face or tap height changes is built again (the kit fixes both when it
   * builds a button) — unless its ad is loading, or a stroke has taken it off
   * the board, when it only moves.
   */
  private relayoutRescuePills(): void {
    for (const pill of [this.revealOfferPill, this.skipPill]) {
      if (!pill || !pill.scene) continue;
      const spot = this.rescuePlace(pill.width);
      const built = this.rescueSpots.get(pill);
      const changed =
        this.phase !== 'drawing' &&
        (!built || Math.abs(built.h - spot.h) > 0.5 || Math.abs(built.tap - spot.tap) > 0.5);
      if (changed && pill === this.revealOfferPill && !this.revealAdPending) {
        this.clearRevealOffer();
        this.showRevealOffer();
      } else if (changed && pill === this.skipPill && !this.skipping) {
        // Built again saying what it was drawn saying.
        const drawn = this.skipIsFree;
        this.clearSkipOffer();
        this.showSkipOffer(drawn);
      } else {
        pill.setY(spot.y);
      }
    }
  }

  /**
   * The runway place, for a shape with no band under the dot: pillY's lift,
   * then down below the lowest wall row it would otherwise touch — every
   * maze's ends a pixel into the pill's top edge — but never into the start
   * dot's grab zone, where a press would start a stroke and tap the pill at
   * once.
   */
  private runwayY(w: number, h: number): number {
    const y = this.pillY(pt(34));
    const left = BASE_WIDTH / 2 - w / 2;
    const right = BASE_WIDTH / 2 + w / 2;
    let wallsEnd = -Infinity;
    for (const r of this.wallRects) {
      if (r.x >= right || r.x + r.w <= left) continue; // beside the pill
      if (r.y >= y + h / 2) continue; // below it, beside the start
      wallsEnd = Math.max(wallsEnd, r.y + r.h);
    }
    const offWalls = wallsEnd + pt(2) + h / 2;
    if (y >= offWalls) return y;
    const grabTop = this.startPx.y - METRICS.startRadius * METRICS.startGrabFactor;
    return Math.min(offWalls, grabTop - pt(2) - Math.max(h, minTap(this)) / 2);
  }

  /** A rescue pill is up: the hint band is its. */
  private get rescueUp(): boolean {
    return !!(this.revealOfferPill?.scene || this.skipPill?.scene);
  }

  /**
   * A pill is arriving in the hint band: a line already there — a lesson
   * said at this same death, the level-6 line — goes on as a toast.
   */
  private handHintToToast(): void {
    const hint = this.hintText;
    if (!hint.text || (hint.alpha <= 0 && !this.tweens.isTweening(hint))) return;
    const text = hint.text;
    this.hideHint();
    this.notify(text);
  }

  /**
   * Show or hide the rescue offers for the stroke. Hidden at once — the ink
   * must never be drawn over a visible label — and untappable while hidden;
   * back, and live, the moment the stroke ends however it ends.
   */
  private setRescueOffersLive(live: boolean): void {
    for (const pill of [this.revealOfferPill, this.skipPill]) {
      if (!pill || !pill.scene) continue;
      this.tweens.killTweensOf(pill);
      if (live) {
        pill.setInteractive();
        this.tweens.add({ targets: pill, alpha: 1, duration: ms(180) });
      } else {
        pill.disableInteractive();
        pill.setAlpha(0);
      }
    }
    // While a stroke is drawn the pills are off the board and the tray is back.
    this.syncRescueHold();
  }

  private async doSkip(): Promise<void> {
    if (this.skipping) return;
    Haptics.tap();

    // The level the player asked to skip, fixed now: the scene object is reused
    // from level to level, and `levelIndex` after an await is whatever is on
    // screen by then.
    const index = this.levelIndex;
    const token = this.levelToken;
    const here = (): boolean => this.sys.isActive() && token === this.levelToken;

    // An owner's skip is free whatever the pill was drawn saying.
    if (!this.skipIsFree && !Progress.data.adsRemoved) {
      this.skipping = true;
      // An uncached rewarded ad is a real fetch at the tap. Say so, rather than
      // leave a pill that looks as if it did nothing.
      setButtonText(this.skipPill, 'loading the ad…');
      // Wanted only while the player is still here and still waiting: not on
      // another level or scene, not over a stroke they started meanwhile, not
      // over a win they drew instead.
      const result = await Ads.showRewarded(
        'skip',
        () => here() && this.phase !== 'drawing' && this.phase !== 'won' && !this.shareSheet
      );
      if (!here()) {
        // Gone. An ad that WAS watched still pays for the level it was watched
        // for — the player earned it — but nobody is moved anywhere.
        if (result === 'earned') Progress.unlockThrough(index, LEVELS.length);
        return;
      }
      this.skipping = false;
      setButtonText(this.skipPill, this.skipLabel);
      // Closed early, or no longer wanted: nothing skipped. 'unavailable'
      // still skips — this button used to swallow the tap whenever no ad
      // could load, which for a new ad unit with no fill yet is always, and a
      // control that visibly does nothing reads as a broken game.
      if (result === 'declined' || result === 'abandoned') return;
    }

    Progress.unlockThrough(index, LEVELS.length);
    this.clearSkipOffer();
    const next = index + 1;
    if (next >= LEVELS.length) this.scene.start('LevelSelect');
    else this.loadLevel(next);
  }

  /* ----------------------------------------------------------------- back */

  /**
   * ‹, which has to tell a way out from the tap that closed a share sheet.
   *
   * On iOS 26 the tap that dismisses the share sheet by touching the page
   * above it reaches the page too, and it reaches it BEFORE the share settles:
   * the sheet reports its dismissal only once it has animated away. The quiet
   * window after a share covers taps that land later; this one landed while
   * `sharing` was still set, so a tap on ‹ closed the sheet AND left the win
   * screen for the Menu. Ignoring ‹ while a share is up is no answer either —
   * a share that never settles must never take the way out with it. So the
   * tap waits: if the share settles within SHARE_DISMISS_WAIT_MS, it was the
   * tap that closed the sheet and does nothing else; if not, the share is stuck
   * and the player gets out, a moment late.
   */
  private pressBack(): void {
    if (this.backPending || performance.now() < this.shareQuietUntil) return;
    const share = this.sharing ? this.shareSettled : null;
    if (!share) {
      this.leave();
      return;
    }
    this.backPending = true;
    const token = this.levelToken;
    void settlesWithin(share, SHARE_DISMISS_WAIT_MS).then((settled) => {
      this.backPending = false;
      if (settled || !this.sys.isActive() || token !== this.levelToken) return;
      this.leave();
    });
  }

  /**
   * Back to where the level was picked: the grid, on that level's card, or the
   * Menu. Replaying old folds from the grid used to land on the Menu after
   * every one, and Levels then reopened at the frontier.
   */
  private leave(): void {
    Haptics.tap();
    void Progress.flush();
    // Leaving now, not at the next frame when the scene actually stops: an ad
    // still loading for this level is no longer wanted.
    this.levelToken += 1;
    if (this.cameFrom === 'LevelSelect') {
      this.scene.start('LevelSelect', { focus: this.levelIndex });
    } else {
      this.scene.start('Menu');
    }
  }

  /* ------------------------------------------------------------------ hud */

  private buildHud(): void {
    // The HUD's text, the thread row, the tray and the hint (PlayHud).
    this.hud = new PlayHud(this, { web: WEB_DAILY });
    this.hintText = this.hud.hint;

    // On the web daily the page IS the game — there is no menu behind the
    // back button, so there is no back button.
    this.backButton = null;
    if (!WEB_DAILY) {
      // A round glass ‹ (SPEC §2.4: round buttons are full circles — the
      // kit's glass face at dp(40) is one, its radius being half of it),
      // tapped at the thumb's floor however small it is painted.
      const back = button(this, METRICS.inset.left + BACK_D / 2, HUD_Y, '', {
        width: BACK_D,
        height: BACK_D,
        minTap: true,
        variant: 'secondary',
        onPress: () => this.pressBack(),
      });
      back.add(icon(this, -dp(1), 0, 'back', { size: dp(24), color: ui().text }));
      this.backButton = back.setDepth(50);
    }

    this.revealPill = this.buildRevealPill();
    this.layoutHud();
  }

  /**
   * Put the header, the thread row, the tray and the hint where the screen
   * lets them be — PlayHud.layout, the pure function tested at every shape.
   *
   * The canvas is FIT into the screen and the page runs under the status bar.
   * On a 9:16 iPhone (the SE) the header row drawn at HUD_Y would sit under
   * the clock, so it drops by just enough that its tap areas (`minTap` around
   * its centre) clear the inset the letterbox leaves over; the side insets
   * push the back button and the Reveal pill inward. The thread row takes the
   * paper between the header and the board, and the tray the paper under it,
   * where there is room; the hint hangs over the banner line otherwise.
   * Re-run on every resize and every level (the thread row's floor is this
   * maze's goal ring).
   */
  private layoutHud(): void {
    if (!this.hud) return;
    this.safe = canvasInsets(this.game.canvas, BASE_WIDTH, viewHeight());
    const l = PlayHud.layout(viewHeight(), Ads.enabled, {
      safeTop: this.safe.top,
      safeBottom: this.safe.bottom,
      safeLeft: this.safe.left,
      safeRight: this.safe.right,
      tap: minTap(this),
      revealW: this.revealW,
      ringTop: this.level ? this.goalPx.y - METRICS.goalRadius : undefined,
      web: WEB_DAILY,
    });
    this.hudLayout = l;
    if (l.backX !== null) this.backButton?.setPosition(l.backX, l.headerY);
    this.revealPill.setPosition(l.revealX, l.headerY);
    this.hud.place(l);
  }

  /**
   * The header's two controls as tap areas, where they are now: ‹ and the
   * Reveal pill — carved out of "a tap anywhere is the next fold" on a win.
   */
  private headerControls(): TapBox[] {
    const boxes: TapBox[] = [
      { x: this.revealPill.x, y: this.revealPill.y, w: this.revealW, tap: this.revealTapH() },
    ];
    const back = this.backButton;
    if (back?.scene) boxes.push({ x: back.x, y: back.y, w: BACK_D, tap: Math.max(BACK_D, minTap(this)) });
    return boxes;
  }

  /**
   * "Show me where my reflection dies" — the reward, as a one-tap control:
   * smoked glass, the eye in ember, the word, and the balance on a tangerine
   * disc (B · Night Fold, SPEC §5.2).
   */
  private buildRevealPill(): Phaser.GameObjects.Container {
    const t = theme();
    const u = ui();
    const h = REVEAL_H;
    // Wide enough to SAY what it does. The original was an eye and a number —
    // legible as "some counter", not as the game's most valuable button. The
    // word costs its width and buys the whole feature its discovery; the
    // pill is measured from it, so nothing is clipped at any font.
    // Set a step tighter than the B mock's tray pill: in the header it shares
    // the row with the centred title, and every point it gives back is room
    // for the title to stay on the axis at full size (PlayHud.fitCentred).
    const word = label(this, 0, 0, 'Reveal', { size: dp(14), weight: 600, color: u.text }).setOrigin(0, 0.5);
    const eyeS = dp(20);
    const disc = dp(24);
    const padL = dp(10);
    const padR = dp(5);
    const w = Math.ceil(padL + eyeS + dp(6) + word.width + dp(8) + disc + padR);
    this.revealW = w;
    const c = this.add.container(BASE_WIDTH - METRICS.inset.right - w / 2, HUD_Y);
    c.setDepth(50);

    c.add(glassPanel(this, 0, 0, w, h, 'e2', h / 2));

    // The same eye the store rows, the balance chip and the flying tokens wear:
    // what the store sells has to look like the thing it buys.
    this.revealEyeX = -w / 2 + padL + eyeS / 2;
    c.add(icon(this, this.revealEyeX, 0, 'eye', { size: eyeS, color: t.accentText }));
    word.setX(-w / 2 + padL + eyeS + dp(6));
    c.add(word);

    // The balance, on a tangerine disc — the currency's own colour, on every
    // count. At zero the disc carries a "+": the pill is still the way to see
    // the folded walls, and a tap on it opens the refill.
    const bx = w / 2 - padR - disc / 2;
    const spec = { radius: disc / 2, face: { kind: 'solid' as const, color: t.accent } };
    c.add(
      bakedPanel(this, 'reveal-disc', disc, disc, (ctx, px, py, pw, ph) => paintPanel(ctx, px, py, pw, ph, spec), {
        exact: true,
      }).setPosition(bx, 0)
    );
    this.revealCount = label(this, bx, 0, '', { size: dp(13.5), weight: 700, color: u.onAccent }).setOrigin(0.5);
    c.add(this.revealCount);
    // A new pill has painted nothing yet (the scene object is reused).
    this.revealShown = null;

    const plus = icon(this, bx, 0, 'plus', { size: dp(17), color: u.onAccent });
    plus.setVisible(false);
    c.add(plus);
    this.revealPlus = plus;

    // The teaching ring (see teachRevealPill): drawn once, shown once.
    const ring = this.add.graphics();
    ring.lineStyle(pt(1.5), t.accent, 1);
    strokeRoundRect(ring, -w / 2 - dp(3), -h / 2 - dp(3), w + dp(6), h + dp(6), h / 2 + dp(3));
    ring.setAlpha(0);
    c.add(ring);
    this.revealRing = ring;

    // The reveal's time, as a line that drains (see startRevealDrain).
    const drain = this.add.graphics();
    c.add(drain);
    this.revealDrain = drain;

    // setSize, not only the hit rectangle: the size sets the display origin the
    // hit test is measured from (see HitArea). Painted at dp(36), tapped at
    // `minTap` — the growth is split above and below, centred on the pill.
    c.setSize(w, h);
    const tapH = tappable(c, w, h, true);
    this.revealTapH = tapH;

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
      // A touch the system cancelled — a fold, a rotation, an alert — arrives
      // as a pointer-up too. It is not a tap.
      if (p.wasCanceled) return;
      if (Phaser.Math.Distance.Between(downX, downY, p.x, p.y) > TAP_SLOP) return;
      const hitH = tapH();
      if (
        p.x < c.x - w / 2 || p.x > c.x + w / 2 ||
        p.y < c.y - hitH / 2 || p.y > c.y + hitH / 2
      ) return;
      void this.doReveal();
    };
    this.input.on(Phaser.Input.Events.POINTER_UP, onUp);
    c.once('destroy', () => this.input.off(Phaser.Input.Events.POINTER_UP, onUp));
    // It dips while pressed: a token landing mid-press must settle it at 1,
    // not at the dip (see UI.setRestScale).
    setRestScale(c, 1);

    return c;
  }

  private refreshHud(): void {
    const won = this.phase === 'won';
    const card = won && (this.resultCard !== null || this.cardPending);

    // The header names the fold it is about; on a win its kicker says so, in
    // ember: "Folded · new figure", or "Folded" for a fold already made.
    this.hud.setTitle(
      titleWords({
        levelIndex: this.levelIndex,
        name: this.level.name,
        daily: this.dailyDate,
        won,
        firstClear: !this.winWasCleared,
      })
    );

    if (won) {
      /*
       * The web Daily keeps the win screen it has always had: the verdict on
       * the line in the thread row's place, gold with the medal. Everywhere
       * else the result card says it, with everything else the win earned.
       *
       * Written in words, because the version that was not could not be
       * read: "your line 1.12× par ◆" asked the player to know what par is.
       * Par is the validator's proved route, and a human CAN come in under
       * it: at or under par the line simply is the best one.
       */
      if (!card && this.winRatio !== null) {
        const over = Math.round((this.winRatio - 1) * 100);
        const verdict = over <= 0 ? 'the best line there is' : `${over}% over the best line`;
        this.hud.setVerdict(this.winMedal ? `❖ medal · ${verdict}` : verdict, this.winMedal);
      }
    } else {
      this.hud.setVerdict('', false);
      this.hud.setThreadShown(true);
      this.hud.holdTray('won', false);
      // The meter between strokes: what this level holds and what the next
      // star asks. While drawing, the live reading has it (readMeter).
      if (this.phase !== 'drawing') {
        const id = this.level.id;
        this.hud.setMeter(
          this.meterHidden
            ? { stars: null, text: '' }
            : meterIdle({
                daily: this.dailyDate !== null,
                stars: this.dailyDate ? 0 : Progress.stars(id),
                best: this.dailyDate ? null : Progress.bestRatioOf(id),
              })
        );
      }
      /*
       * The tray: the attempt, and what to beat — "Attempt 4 · beat 74%" once
       * a death has got somewhere — or, before the first stroke on a fold
       * already beaten, the time to beat. `bestMs` was written on every win
       * and read by nothing; a personal best there turns a replay into a race
       * against the only opponent the game has.
       */
      const words = trayWords({
        attempts: this.attempts,
        furthest: this.furthest,
        bestMs: this.dailyDate ? null : (Progress.data.bestMs[this.level.id] ?? null),
      });
      this.hud.setTray({ ...words, ...this.chapterThread(), note: this.dailyNote() });
    }

    this.paintRevealCount();
    this.syncRevealOffer();
    this.syncSkipOffer();
  }

  /**
   * No star meter on the tutorial's five folds: "☆☆☆ all three at 1.10× par"
   * on the very first screen asked a player who had never drawn a line to
   * know what par is (QA). The first result card teaches the word; the meter
   * starts on the first generated maze, where stars begin to mean something.
   */
  private get meterHidden(): boolean {
    return !this.dailyDate && this.levelIndex < TUTORIAL_LEVELS.length;
  }

  /**
   * The Daily's line in the tray, where a level has its chapter's beads —
   * without it the board stood over an empty band (QA): today's fold says
   * the streak it keeps, a solved one the time it took, an older day its
   * number. None on the web Daily, whose tray shows the time alone.
   */
  private dailyNote(): string | undefined {
    const date = this.dailyDate;
    if (!date || WEB_DAILY) return undefined;
    const solved = Progress.dailyResult(date);
    if (solved) return `solved · ${clock(solved.ms)}`;
    if (date !== todayISO()) return `Daily #${dailyNo(date)}`;
    const streak = Progress.dailyStreak(date);
    return streak > 0 ? `${streak}-day streak · today keeps it` : 'today starts a streak';
  }

  /** The chapter's twenty beads for the tray, and its count; none on a Daily. */
  private chapterThread(): { beads: Bead[] | null; count: string; marksAhead: number[] } {
    if (this.dailyDate) return { beads: null, count: '', marksAhead: [] };
    const c = Math.floor(this.levelIndex / CHAPTER_SIZE);
    const beads = chapterBeads(Progress.data, c, this.levelIndex);
    const first = c * CHAPTER_SIZE;
    const cleared = LEVELS.slice(first, first + CHAPTER_SIZE).filter((l) => Progress.hasCleared(l.id)).length;
    // A mark still to come is outlined in tangerine on its bead — not for
    // owners, for whom "+2" of something unlimited promises nothing.
    const marksAhead: number[] = [];
    if (!Progress.data.adsRemoved) {
      const m = nextMark(cleared);
      if (m) marksAhead.push(m.at);
      if (m && m.at === 10) marksAhead.push(20);
    }
    return { beads, count: `${this.levelIndex - c * CHAPTER_SIZE + 1}/${CHAPTER_SIZE}`, marksAhead };
  }

  /**
   * The Reveal pill's count, in its states: ∞ for an owner; a plain number
   * from three up; one or two in the accent — running low, never alarm red;
   * and at zero an accent "+" at full strength, because the tap still does
   * something — it opens the refill. Only where nothing could refill it (a
   * web build with no store and no ad) does an empty pill fade, as it always
   * has. While reveals are flying in, the count is the one they left behind.
   */
  private paintRevealCount(): void {
    const owner = Progress.reveals === Number.POSITIVE_INFINITY;
    const n = owner ? Number.POSITIVE_INFINITY : Math.max(0, this.revealHold ?? Progress.reveals);
    const refillable = this.revealDeliverable && !WEB_DAILY;
    const plus = !owner && n <= 0 && refillable;
    this.revealPlus.setVisible(plus);
    /*
     * The number runs to every new value on screen — a spend, a refill, a
     * pack, a rewarded ad, what a win's marks and missions paid — and a
     * repaint that changes nothing leaves a running count alone. Every repaint
     * used to restart it from where it stood to where it stood, which is how a
     * refill's auto-use, spending on the landing's own frame, stopped the count
     * of what had just landed dead. A new target takes over from the number
     * showing (countUp does), so it never jumps back to start again.
     */
    const was = this.revealShown;
    if (was !== n) {
      this.revealShown = n;
      if (was === null) {
        countUp(this, this.revealCount, 0, 0, () => countText(n));
      } else {
        const showing = Number(this.revealCount.text);
        countUp(this, this.revealCount, Number.isFinite(showing) ? showing : was, n, undefined, COUNT_MS);
      }
    }
    // The count is the balance, the money line on the pill: the dark ink on
    // the tangerine disc, 7:1 and more (Theme: onAccent on accent).
    this.revealCount.setVisible(!plus);
    this.revealPill.setAlpha(owner || n > 0 || refillable ? 1 : 0.35);
  }

  /**
   * The reveal's time, without a number: a thin accent line along the foot of
   * the Reveal pill that drains, right to left, over exactly as long as the
   * folded walls stand — so the player knows to look now. Under reduced
   * motion it does not move: it is there while they stand, and gone after.
   * In real ms: the hold is never scaled, only its ease-in is.
   */
  private startRevealDrain(total: number): void {
    const g = this.revealDrain;
    const color = theme().accent;
    const x0 = -this.revealW / 2 + REVEAL_H / 2;
    const len = this.revealW - REVEAL_H;
    const y = REVEAL_H / 2 - dp(3);
    const draw = (f: number): void => {
      g.clear();
      if (!(f > 0)) return;
      g.lineStyle(pt(1.5), color, 0.9);
      g.lineBetween(x0, y, x0 + len * Math.min(1, f), y);
    };
    this.stopRevealDrain();
    draw(1);
    const left = { f: 1 };
    this.tweens.add({
      targets: left,
      f: motionReduced() ? 1 : 0,
      duration: total,
      onUpdate: () => draw(left.f),
      onComplete: () => draw(0),
    });
    this.revealDrainState = left;
  }

  private stopRevealDrain(): void {
    if (this.revealDrainState) this.tweens.killTweensOf(this.revealDrainState);
    this.revealDrainState = null;
    this.revealDrain?.clear();
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
    // A rescue pill stands in the hint band: the line is said as a toast.
    if (this.rescueUp && this.phase !== 'won') {
      this.hideHint();
      this.notify(message);
      return;
    }
    this.hintSeq++;
    this.hintSticky = sticky;
    this.hintText.setText(message);
    // Said in the tray's place, where there is a tray: its row stands aside.
    this.hud.holdTray('hint', true);
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
    this.hintSeq++;
    this.hintSticky = false;
    this.tweens.killTweensOf(this.hintText);
    this.hintText.setAlpha(0);
    this.hud.holdTray('hint', false);
  }

  /**
   * A hint that answers a tap, so it appears at once and takes itself away.
   * `resetToIdle` would clear it eventually, but only on the next stroke —
   * a reply to a button press should not outlive the player's interest in it.
   */
  private flashHint(message: string): void {
    // Under a result card the hint line is where the card's buttons are, and
    // with a rescue pill up it is where the pill is; a reply to a tap there
    // ("game center is not signed in", "the folded walls are showing") is a
    // toast instead — shown now, ahead of any news waiting.
    if ((this.phase === 'won' && this.resultCard) || this.rescueUp) {
      this.notify(message, 'plain', true);
      return;
    }
    this.showHint(message, 0);
    const mine = this.hintSeq;
    this.time.delayedCall(3200, () => {
      /*
       * Something newer has said its piece; this timer is not its to end.
       * Judged by the flash, not by its text: the same line flashed again —
       * a second Leaderboard tap two seconds after the first — was taken down
       * by the FIRST flash's timer, a second into its own 3.2.
       */
      if (this.hintSeq !== mine) return;
      if (this.phase !== 'won') this.hideHint();
      // On a win the slot belongs to the win prompt, and it comes back. A
      // flash there ("game center is not signed in") used to replace "tap
      // for the next fold" for good.
      else if (!this.webDailyEnd) this.showHint(this.winPrompt, 0);
    });
  }

  /* ------------------------------------------------------ notices, grants */

  /**
   * A one-line notice that comes and goes by itself — a toast, never
   * interactive, so it can never take a tap meant for the board. Over the
   * thread row while playing (the band between the header and the maze),
   * and over the result card on a win.
   *
   * `urgent` for the answer to the player's own tap — a refusal, an ad that
   * is not there, what a purchase just brought: it is shown now, and news
   * already waiting (the day's gift, a late purchase) resumes after it.
   */
  private notify(text: string, tone: Tone = 'plain', urgent = false): void {
    toast(this, text, {
      y: this.toastY(),
      tone,
      icon: tone === 'reward' ? eyeGlyph : undefined,
      urgent,
    });
  }

  private toastY(): number {
    if (this.phase === 'won' && this.resultCard) return this.resultCard.top - pt(26);
    /*
     * While the folded walls are showing, the player is studying the top of
     * the board and the foot of the Reveal pill, where its drain runs: the
     * toast hangs just under the pill instead, clear of the drain.
     */
    if (this.time.now < this.revealHoldUntil) {
      return this.revealPill.y + REVEAL_H / 2 + pt(3) + TOAST_H / 2;
    }
    // Over the thread row: the band between the header and the maze.
    return this.hudLayout?.threadY ?? this.revealPill.y + REVEAL_H / 2 + pt(3) + TOAST_H / 2;
  }

  /**
   * A grant nobody on this screen asked for, told where it happened. True when
   * it was shown here — see Progress.onGrant: the daily reveal a foreground
   * lands mid-level, and a purchase approved late (Ask to Buy, a transaction
   * redelivered). Everything else is the win card's or the store sheet's to
   * show, and is left to them.
   */
  private onGrant(g: GrantEvent): boolean {
    if (WEB_DAILY || !this.sys.isActive()) return false;
    const owner = Progress.data.adsRemoved;
    if (g.reason === 'daily') {
      // An owner's reveals never run out: one more is not news. The Menu
      // decides what to do with it (it stays in takeUnshownGrants).
      if (owner || g.reveals <= 0) return false;
      const n = g.reveals;
      this.notify(`+${n} free ${n === 1 ? 'reveal' : 'reveals'} for today`, 'reward');
      this.flyToPill(n, { x: BASE_WIDTH / 2, y: this.toastY() });
      return true;
    }
    if (g.reason === 'late-purchase') {
      const text = grantNotice(g);
      if (!text) return false;
      /*
       * An Ask to Buy approved while the player still waits where they asked:
       * the refill sheet was opened from an empty stash on this level, the
       * board is idle, nothing is showing, and this is all they have. The
       * sheet has gone (a pending purchase closes it), but the ask stands —
       * it is answered like a purchase that landed at once: in it flies, and
       * the walls show.
       */
      if (
        g.reveals > 0 &&
        !owner &&
        this.refillAskedOn === this.levelToken &&
        this.phase === 'idle' &&
        !this.refillSheet &&
        this.time.now >= this.revealHoldUntil &&
        Progress.reveals - g.reveals <= 0
      ) {
        this.refillAskedOn = null;
        this.refillAndReveal(g.reveals, false);
        return true;
      }
      this.notify(text, 'reward');
      if (g.reveals > 0 && !owner) this.flyToPill(g.reveals, { x: BASE_WIDTH / 2, y: this.toastY() });
      else this.refreshHud();
      return true;
    }
    // Remove Ads changing hands however it happened: the pill reads ∞ (or
    // stops reading it) now.
    if (g.adsRemoved !== undefined) this.refreshHud();
    return false;
  }

  /**
   * Ask the plugin, never the player: the soft ask on the win card must know
   * synchronously whether permission is still undecided. Re-read on every
   * foreground and after [Remind me]; unknown (null) means no ask.
   */
  private readNotifPermission(): void {
    if (WEB_DAILY) return;
    Nudges.permission()
      .then((p) => {
        this.notifPermission = p;
      })
      .catch(() => {
        this.notifPermission = null;
      });
  }

  /* -------------------------------------------------------------- lessons */

  /**
   * Level 6's lesson, once per save: as the line about Reveal appears, the
   * pill it is about pulses three times inside an accent ring. Taught when it
   * is SHOWN — a player who leaves inside the 900ms has not seen it, and gets
   * it on the next visit.
   */
  private teachRevealPill(): void {
    const token = this.levelToken;
    const ring = this.revealRing;
    this.time.delayedCall(ms(900), () => {
      if (!this.sys.isActive() || token !== this.levelToken || this.phase === 'won') return;
      if (!Progress.teach('reveal')) return;
      this.tweens.killTweensOf(ring);
      ring.setAlpha(0);
      this.tweens.add({ targets: ring, alpha: 1, duration: ms(200) });
      for (let i = 0; i < 3; i++) {
        this.time.delayedCall(ms(260) * i, () => {
          if (token === this.levelToken) pulse(this, this.revealPill, 0.1);
        });
      }
      this.tweens.add({ targets: ring, alpha: 0, delay: ms(260) * 3 + ms(1200), duration: ms(400) });
    });
  }

  /**
   * Level 1, before the first stroke: a disc of ink sets off from the start
   * dot along the first pt(90) of the proved route, and an accent disc
   * mirrors it on the far half, each leaving a dotted line — the gesture
   * shown, not described. It comes round every 2.6s, six times at most, and is
   * gone at the first press. Under reduced motion nothing travels: one still
   * dotted arrow, and its reflection.
   */
  private startGhostHand(): void {
    this.stopGhostHand();
    const route = validateLevel(this.level, this.pf, {
      hitRadius: METRICS.hitRadius,
      goalRadius: METRICS.goalRadius,
    }).path;
    if (route.length < 2) return;

    // The route from the dot itself, cut at `reach`.
    const pts = [this.startPx, ...route.slice(1)];
    const path: Vec2[] = [pts[0]];
    let len = 0;
    for (let i = 1; i < pts.length && len < GHOST_HAND.reach; i++) {
      const d = dist(pts[i - 1], pts[i]);
      if (d <= 0) continue;
      if (len + d >= GHOST_HAND.reach) {
        path.push(lerpPoint(pts[i - 1], pts[i], (GHOST_HAND.reach - len) / d));
        len = GHOST_HAND.reach;
        break;
      }
      path.push(pts[i]);
      len += d;
    }
    if (len <= 0) return;
    const pointAt = (s: number): Vec2 => {
      let left = Math.max(0, Math.min(len, s));
      for (let i = 1; i < path.length; i++) {
        const d = dist(path[i - 1], path[i]);
        if (left <= d) return lerpPoint(path[i - 1], path[i], d > 0 ? left / d : 0);
        left -= d;
      }
      return path[path.length - 1];
    };

    const t = theme();
    // In the line's own colours: the pen's tangerine, and its reflection's
    // moonlight — the two things a new player has to see move together.
    const pen = t.line;
    const moon = veiledInk(t.line, t);
    const g = this.add.graphics().setDepth(44);
    this.ghostHand = g;
    const dots = (to: number): void => {
      for (let d = pt(4); d <= to; d += pt(7)) {
        const p = pointAt(d);
        const m = this.pf.mirror(p);
        g.fillStyle(pen, 0.45);
        g.fillCircle(p.x, p.y, pt(1.3));
        g.fillStyle(moon, 0.45);
        g.fillCircle(m.x, m.y, pt(1.3));
      }
    };

    if (motionReduced()) {
      dots(len);
      // An arrowhead on the end, along the last step — and on its reflection,
      // in the accent: the two lines are the whole idea.
      const tip = pointAt(len);
      const back = pointAt(len - pt(6));
      const a = Math.atan2(tip.y - back.y, tip.x - back.x);
      const mTip = this.pf.mirror(tip);
      g.lineStyle(pt(1.4), pen, 0.55);
      for (const turn of [2.5, -2.5]) {
        g.lineBetween(tip.x, tip.y, tip.x + Math.cos(a + turn) * pt(6), tip.y + Math.sin(a + turn) * pt(6));
      }
      g.lineStyle(pt(1.4), moon, 0.55);
      for (const turn of [2.5, -2.5]) {
        const m = Math.PI - a;
        g.lineBetween(mTip.x, mTip.y, mTip.x + Math.cos(m - turn) * pt(6), mTip.y + Math.sin(m - turn) * pt(6));
      }
      return;
    }

    const token = this.levelToken;
    let loops = 0;
    const run = (): void => {
      if (token !== this.levelToken || this.ghostHand !== g || this.phase !== 'idle') return;
      loops += 1;
      g.setAlpha(1);
      const s = { v: 0 };
      this.tweens.add({
        targets: s,
        v: len,
        duration: ms(GHOST_HAND.travel),
        ease: 'Sine.easeInOut',
        onUpdate: () => {
          if (this.ghostHand !== g) return;
          g.clear();
          dots(s.v);
          // Two discs, the finger and its reflection: the mirror trail is
          // the hook, and a new player has to see two things move.
          const p = pointAt(s.v);
          const m = this.pf.mirror(p);
          g.fillStyle(pen, 0.5);
          g.fillCircle(p.x, p.y, pt(9));
          g.fillStyle(moon, 0.35);
          g.fillCircle(m.x, m.y, pt(9));
        },
        onComplete: () => {
          if (this.ghostHand !== g) return;
          this.tweens.add({ targets: g, alpha: 0, delay: ms(300), duration: ms(500) });
        },
      });
      if (loops < GHOST_HAND.loops) this.time.delayedCall(ms(GHOST_HAND.every), run);
    };
    // After the line that says what to do has arrived.
    this.time.delayedCall(ms(1200), run);
  }

  private stopGhostHand(): void {
    const g = this.ghostHand;
    this.ghostHand = null;
    if (!g) return;
    this.tweens.killTweensOf(g);
    g.destroy();
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
