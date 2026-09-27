/**
 * Progress — everything the player keeps between sessions.
 *
 * Backed by Capacitor Preferences, which is native UserDefaults / SharedPrefs
 * on device and localStorage on the web, so the same code path serves both.
 *
 * Three rules the rest of the game relies on:
 *  - Reads never throw. A corrupt or absent save yields a fresh one, because
 *    losing progress is bad but refusing to launch is worse.
 *  - Writes are fire-and-forget and debounced. Nothing in the game loop ever
 *    waits on the disk.
 *  - Every reveal that arrives goes through one path and is announced
 *    (`onGrant`), AFTER the balance is written. A scene never has to know where
 *    a grant came from to show it, and a listener that reads the balance while
 *    handling one reads the new number.
 */

import { Preferences } from '@capacitor/preferences';
import { monetization } from '../config/monetization';
import { ISO_DATE, todayISO } from '../core/CalendarDay';
import type { Rect, Vec2 } from '../core/Geometry';
import {
  advanceMissions,
  MISSION_SLOTS,
  MISSION_TARGET,
  missionsFor,
  type MissionId,
  type MissionState,
  type WinEvent,
} from '../core/Missions';
import {
  chapterOf,
  chapterStats,
  dueMarks,
  MARK_PATTERN,
  markReward,
  parseMark,
  type MarkAt,
} from '../core/Rewards';
import {
  currentRunStart,
  guardPlan,
  longestFrom,
  milestonesBetween,
  repairDays,
  runBefore,
  streakFrom,
  type Day,
  type Milestone,
} from '../core/Streak';
import { chapterStars, roundRatio, starsFor, starsOf, totalStars, type StarCount } from '../core/Stars';
import { LEVELS, TUTORIAL_LEVELS } from '../data/levels';

const economy = monetization.economy;

const KEY = 'foldwing.save.v1';

/**
 * Schema version of the save, and specifically of what the level ids in it
 * MEAN.
 *
 * 1 — the bar-obstacle set: 5 tutorial levels plus l6…l100 of generated bars.
 * 2 — the maze set: the same ids l6…l100 now name completely different mazes,
 *     and the set runs to l300.
 *
 * That id reuse is the whole reason this number exists. Without it an upgrading
 * player opens the new game with 95 mazes they have never seen marked as
 * cleared, best times attached to levels that no longer exist, and — because
 * the level-6 hint fires only for a player who has not cleared l6 — no showing
 * of the one line in the entire game that explains what Reveal is for. The
 * player who most needs that explanation is exactly the one who cannot get it.
 *
 * 3 — the tutorial became mazes: l1…l5 name five new generated tutorial mazes
 *     (scripts/genTutorialMazes.ts).
 *     l6…l300 are byte-identical to v2, so ONLY l1…l5 lose their meaning.
 */
const SCHEMA = 3;

/**
 * Which level ids still mean what they meant when a save of `version` was
 * written. History, not configuration: each entry is the set of ids whose
 * content a schema step replaced, spelled out rather than derived from the
 * level tables, because the tables only know what the ids mean NOW.
 */
const REAUTHORED_IN_V3: ReadonlySet<string> = new Set(['l1', 'l2', 'l3', 'l4', 'l5']);

function idSurvives(version: number, id: string): boolean {
  if (version < 2) return false; // v1 → v2: every id changed meaning
  if (version < 3 && REAUTHORED_IN_V3.has(id)) return false; // v2 → v3: the tutorial
  return true;
}

/**
 * A figure the player earned, stored so it can be redrawn anywhere.
 *
 * Points are NORMALIZED, not pixels: the same figure has to redraw correctly on
 * a different phone and at 1080×1080 in a share card. Times ride along because
 * they are what gave the ink its weight — drop them and a shared figure comes
 * back as a uniform tube instead of the drawing the player actually made.
 */
export interface SavedFigure {
  readonly levelId: string;
  readonly levelName: string;
  /** Normalized playfield coordinates, x < 0.5. */
  readonly points: readonly { x: number; y: number }[];
  /** Milliseconds from the first sample, parallel to `points`. */
  readonly times: readonly number[];
  readonly ms: number;
  readonly at: number;
  /**
   * The maze the line was drawn through — normalized, full playfield, exactly
   * as `Level.walls` are authored. Carried WITH the figure rather than looked
   * up from `levelId` for two reasons, and each on its own would be enough.
   *
   * The daily fold is not in LEVELS at all: its geometry only exists as the
   * output of a generator that runs a validated candidate search, so drawing
   * yesterday's maze would mean re-running that search once per gallery card.
   * And ids are not stable across content: the v1 → v2 migration already made
   * `l6…l100` name completely different mazes, so a figure that outlived its
   * level would be drawn inside the wrong walls — a picture that is confidently
   * false is worse than one that is missing.
   *
   * Optional because figures earned before the gallery drew mazes have none;
   * those still render as the bare figure they always were.
   */
  readonly walls?: readonly Rect[];
  /** Normalized, x < 0.5. Absent on figures saved before mazes were kept. */
  readonly start?: Vec2;
  readonly goal?: Vec2;
}

/**
 * One finished Daily Fold.
 *
 * `deaths`, not attempts. This used to store the attempt counter, which
 * increments on every stroke STARTED — including the ones the player abandons
 * by lifting a finger, which the rest of the game explicitly does not treat as
 * a failure. It is written once and never recomputed, so a wrong number here is
 * wrong forever; the share card was already using deaths while the ledger kept
 * something else.
 */
export interface DailyResult {
  readonly ms: number;
  readonly deaths: number;
  /** Fold Sense earned that day, 0 when unrated. */
  readonly foldSense: number;
}

export interface SaveData {
  /** What the level ids in this save mean. See SCHEMA. */
  version: number;
  /** Highest level index the player has unlocked. 0 = only the first. */
  unlockedIndex: number;
  /** Best completion time per level id, in ms. */
  bestMs: Record<string, number>;
  /** Level ids the player has ever cleared. */
  cleared: string[];
  /** Banked reveals. Spent by choice, never auto-consumed. */
  reveals: number;
  /** ISO date (YYYY-MM-DD) of the last free daily top-up. */
  lastTopUp: string;
  /** True once Remove Ads is owned. Persisted so relaunch needs no store call. */
  adsRemoved: boolean;
  /** Total wins, for ad cadence and the rating prompt. */
  totalWins: number;
  /** Wins since the last interstitial actually rendered. */
  winsSinceAd: number;
  /** Failed attempts since the last interstitial actually rendered. */
  attemptsSinceAd: number;
  /**
   * True once the automatic review prompt has been spent, on any version.
   * Builds before 1.4 read it as spent for good; 1.4 on read
   * `ratePromptedVersion` instead, and keep writing this for the older ones.
   */
  ratePrompted: boolean;
  /** Every figure the player has ever drawn, newest last. */
  figures: SavedFigure[];
  /** Finished Daily Folds, keyed by ISO date (YYYY-MM-DD). */
  daily: Record<string, DailyResult>;
  /** Level ids beaten at or under the medal ratio of par. */
  medals: string[];
  /** Fold Sense: EMA of recent win scores, 0..100. 0 = not yet rated. */
  foldSense: number;
  /** Player settings. Default-on, because the game is better with them. */
  sound: boolean;
  /**
   * The background bed, separate from `sound` on purpose.
   *
   * They are two different questions. Effects mark something the player did and
   * most people want them; music plays continuously and is the first thing
   * someone turns off on a commute or with a podcast running. Every casual
   * puzzle game of this shape keeps them apart, and one switch for both means a
   * player who wants a quiet bed has to lose the feedback to get it.
   */
  music: boolean;
  haptics: boolean;
  /**
   * Reduced motion. The game leans on tweens for the win figure and the sheets;
   * this shortens them to near-instant rather than removing the feedback, so a
   * player who is motion-sensitive still sees WHAT happened, just not the
   * travel. Seeded from the OS setting on a fresh save.
   */
  reducedMotion: boolean;
  /**
   * What this build's webview can encode, stamped at boot.
   *
   * Diagnostic, not state: the replay button hides itself when the encoder is
   * missing, and from the outside that is indistinguishable from being on an
   * older build. Settings shows this so a tester can read the answer off the
   * screen instead of us inferring it from a screenshot.
   */
  capability: string;

  /*
   * Everything below arrived with 1.4, additively: no SCHEMA bump, because no
   * level id changed meaning. A save from 1.3 simply lacks these and coerce()
   * fills them in.
   */

  /** Streak bookmarks held, 0..bookmarkMax. Spent automatically by the guard. */
  bookmarks: number;
  /**
   * Missed days a bookmark or a repair covered, ascending. Kept apart from
   * `daily` on purpose: they bridge a run but were not folded, and everything
   * that reads the ledger (Game Center's week, the share text) must not see
   * them as played.
   */
  bookmarked: string[];
  /** ISO date of the last streak repair, '' for never. */
  lastRepair: string;
  /** Today's three missions; null until they unlock (or after a bad record). */
  missions: MissionState | null;
  /** Chapter marks already paid, "c:10" / "c:20". */
  chapterMarks: string[];
  /** The one-time starter pack: bought (never offered again) and seen (no NEW badge). */
  starterBought: boolean;
  starterSeen: boolean;
  /** The ad-paid reveal cap: the local day counted and how many were paid on it. */
  rewardedDay: string;
  rewardedToday: number;
  /** Store transaction ids already credited, newest last — a redelivery pays once. */
  grantedTx: string[];
  /** One-time lessons already shown. */
  taught: Lesson[];
  /** The player's Reminders switch. Permission is the OS's; this is theirs. */
  reminders: boolean;
  /** Soft asks for notification permission so far, and the day of the last one. */
  nudgeAsks: number;
  nudgeAskedOn: string;
  /** Minute of day (0..1439) of the first foreground of each of the last 7 days. */
  sessionMinutes: number[];
  /** ISO date of the latest foreground. */
  lastSeen: string;
  /**
   * Distinct local days the game has been in front of the player on, counted
   * by markSeen. The review prompt waits for the second (see Rate).
   */
  playDays: number;
  /**
   * The app version the automatic review prompt was spent on; '' for none this
   * save can name — never asked, or asked by a build before 1.4, which kept
   * only `ratePrompted`. At most one ask per version: see Rate.
   */
  ratePromptedVersion: string;

  /*
   * Everything below arrived with 1.5, additively, the same way (no SCHEMA
   * bump). Measurements are stored and rewards derived from them, so a
   * threshold can move without a migration and without taking anything back.
   */

  /**
   * The best line ÷ par each campaign level has seen, to three decimals.
   * Only ever falls. Stars are DERIVED from it at read time (core/Stars); a
   * level cleared before this field existed has no entry and derives from
   * `cleared` and `medals` instead. The Daily is never stored here.
   */
  bestRatio: Record<string, number>;
  /**
   * Mirror deaths so far whose arc arrow said "your reflection", 0..MIRROR_LABELS.
   * A save that had already been taught the mirror lesson starts at 1.
   */
  teachMirrorN: number;
}

/** Mirror deaths labelled "your reflection" before the arrow goes plain. */
export const MIRROR_LABELS = 3;

/**
 * Campaign ids: the only ones a measurement is kept for. The Daily's id is a
 * date's, and 730 of them would grow the save for a number nothing reads.
 */
const CAMPAIGN_IDS: ReadonlySet<string> = new Set(LEVELS.map((l) => l.id));

/** The one-time teaching moments (§ failure that teaches). */
export type Lesson = 'mirror' | 'reveal';
const LESSONS: readonly Lesson[] = ['mirror', 'reveal'];

/** Why reveals (or bookmarks) arrived. Scenes pick the moment from it. */
export type GrantReason =
  | 'daily'
  | 'mission'
  | 'chapter'
  | 'streak'
  | 'rewarded'
  | 'purchase'
  | 'late-purchase'
  | 'backlog'
  | 'repair';

/**
 * One announced grant. `reveals` and `bookmarks` are what arrived; an event
 * with both at zero announces a state change instead of currency — a repair,
 * or Remove Ads changing hands (`adsRemoved` set) — for listeners that rebuild
 * something from the save, like the reminder schedule.
 */
export interface GrantEvent {
  readonly reveals: number;
  readonly bookmarks: number;
  readonly reason: GrantReason;
  readonly adsRemoved?: boolean;
}

/**
 * A grant listener. Return true when this listener SHOWED the grant to the
 * player; see `takeUnshownGrants` for what happens to one nobody showed.
 */
export type GrantListener = (g: GrantEvent) => boolean | void;

/** What the automatic streak guard did. */
export interface StreakGuard {
  readonly bridged: Day[];
  readonly streak: number;
  /** Bookmarks held afterwards, counting any a milestone just paid. */
  readonly left: number;
  /**
   * Milestones the bridge reached, already paid (reason 'streak'). Empty
   * unless today's Daily was folded before the gap was covered — see
   * bridgePays.
   */
  readonly milestones: readonly Milestone[];
}

/** Read before a win is recorded: after it, every clear looks old. */
export interface WinBefore {
  readonly levelId: string;
  readonly levelIndex: number;
  readonly wasCleared: boolean;
  readonly hadMedal: boolean;
  /** Stars the level held before this win (0 on a first clear, and on a Daily). */
  readonly starsBefore: StarCount;
  /** Its best line ÷ par before this win, or null for none measured. */
  readonly bestRatioBefore: number | null;
  readonly prevBestMs: number | null;
  readonly streakBefore: number;
  /**
   * Missions were already open. The win that opens them (clearing level 5)
   * does not count toward them: the player has not seen them yet.
   */
  readonly missionsOpen: boolean;
}

export interface WinFacts {
  levelId: string;
  levelIndex: number;
  dailyDate: Day | null;
  todayDailyFirst: boolean;
  medal: boolean;
  deaths: number;
  ms: number;
  /** The fold the previous win was on, won again — see Missions.WinEvent.repeat. */
  repeat?: boolean;
}

export interface RewardLine {
  kind: 'mission' | 'chapter-half' | 'chapter-full' | 'streak' | 'bookmark';
  text: string;
  reveals: number;
  bookmarks: number;
}

export interface WinOutcome {
  reveals: number;
  bookmarks: number;
  lines: RewardLine[];
  /** Null on a Daily. `crossed` is the marks this card pays, in order. */
  chapter: {
    index: number;
    cleared: number;
    medals: number;
    /** Stars the chapter holds, this win's included when recordRatio ran first. */
    stars: number;
    skipped: number[];
    crossed: MarkAt[];
  } | null;
  /**
   * Only on a Daily that moved the streak: the first finish of today's, or of
   * yesterday's finished after midnight. `milestone` is the last day it paid.
   */
  streak: { before: number; after: number; milestone: Milestone | null } | null;
  missions: MissionState | null;
}

/** What `recordRatio` kept, and what the level now holds. */
export interface LineRecord {
  /** Stars this line earned on its own: what the result card punches in. */
  readonly line: 1 | 2 | 3;
  /** Stars the level holds now, its best and any legacy medal included; 0 for a Daily. */
  readonly stars: StarCount;
  /** The level's best ratio now, or null when none was ever measured. */
  readonly best: number | null;
  /** This line lowered the best (a first measurement counts). */
  readonly newBest: boolean;
}

const plusReveals = (n: number): string => `+${n} ${n === 1 ? 'reveal' : 'reveals'}`;

/** Today's Daily, folded before the day's missions were built, as the win it was. */
const DAILY_ALREADY_FOLDED: WinEvent = {
  daily: true,
  todayDailyFirst: true,
  firstClear: false,
  medal: false,
  deaths: 0,
  beatBest: false,
  skipped: false,
};

/**
 * A milestone as a win-card line. Owners have unlimited reveals, so a count
 * of them means nothing there: their line keeps the moment and any bookmark,
 * and says ✓.
 */
function milestoneText(m: Milestone, owner: boolean): string {
  if (!owner || m.reveals === 0) return `${m.title} · ${m.body}`;
  return m.bookmarks > 0 ? `${m.title} · +1 bookmark ✓` : `${m.title} ✓`;
}

/** The days a save's streak is made of: folded, and bridged. */
export function streakSets(save: Pick<Readonly<SaveData>, 'daily' | 'bookmarked'>): {
  done: Set<Day>;
  marked: Set<Day>;
} {
  return { done: new Set(Object.keys(save.daily)), marked: new Set(save.bookmarked) };
}

/**
 * How many figures to keep.
 *
 * Preferences is backed by UserDefaults, which is not a database — an unbounded
 * array of point lists would grow the plist without limit and slow every launch,
 * since the whole blob is parsed at boot. Old figures fall off the back.
 */
const MAX_FIGURES = 120;

/**
 * Decimal places kept for stored geometry.
 *
 * Normalized coordinates arrive as raw IEEE doubles, and `JSON.stringify`
 * writes every digit of them: a single point cost about forty characters as
 * `{"x":0.34188034188034189,"y":0.71751412429378536}`. Multiply by the few
 * hundred samples in a stroke and the hundred and twenty figures this file
 * keeps, and the save is megabytes of precision nobody can see — parsed in full
 * at every launch.
 *
 * Four places is 0.07 base pixels across the playfield, roughly a thirtieth of
 * the nib's width, and cuts the stored figure by about half. Nothing reads
 * these numbers except the code that redraws them; collision runs on live
 * pixels and never touches a saved figure.
 */
const PRECISION = 1e4;

const q = (n: number): number => Math.round(n * PRECISION) / PRECISION;
const qPoint = (p: Vec2): Vec2 => ({ x: q(p.x), y: q(p.y) });
const qRect = (r: Rect): Rect => ({ x: q(r.x), y: q(r.y), w: q(r.w), h: q(r.h) });

/** Shrink a figure to what actually has to survive a relaunch. */
function compact(f: SavedFigure): SavedFigure {
  return {
    ...f,
    points: f.points.map(qPoint),
    // Sample timestamps are sub-millisecond floats off the same clock. The
    // ribbon widens with the GAP between them, and no gap that matters is
    // shorter than a millisecond.
    times: f.times.map((t) => Math.round(t)),
    walls: f.walls?.map(qRect),
    start: f.start && qPoint(f.start),
    goal: f.goal && qPoint(f.goal),
  };
}

/**
 * How many finished Daily Folds to keep, for the same reason as MAX_FIGURES and
 * for a while the only field in this file that ignored it: `daily` grew without
 * limit, so a two-year streak meant ~730 records parsed at every launch and
 * re-serialised on every write.
 *
 * Two years of history is more than any calendar view would scroll. It is NOT
 * a bound on the streak, though, and for a while it was one: the streak walks
 * backwards from today until it finds a gap, so trimming the oldest entries of
 * an unbroken run cut the run itself, and every streak past two years read
 * "730 day streak" forever. The current run is therefore never trimmed — see
 * keptForCurrentRun — and the cap only ever drops history behind a gap.
 */
const MAX_DAILY = 730;

/** The same bound for bridged days, and the same exception for the live run. */
const MAX_BOOKMARKED = 60;

/** Transaction ids remembered: far more than any redelivery backlog. */
const MAX_GRANTED_TX = 100;

/**
 * A transaction id as the save keeps it. coerce() keeps ids of 1–64
 * characters, so a longer one is stored by its tail (where ids differ) —
 * storing it whole would have it dropped on the next load and paid again.
 */
function txKey(id: unknown): string {
  if (typeof id !== 'string' || id.length === 0) return '';
  return id.length > 64 ? id.slice(-64) : id;
}

/**
 * How many of the newest entries to keep so the run still alive today survives
 * whole: everything from today (or yesterday — an unfinished today does not
 * break a streak, see dailyStreak) back to the first day that is neither
 * folded nor bridged. A bookmark keeps the run alive, so the trim has to walk
 * through bridged days exactly as the streak does, or it would cut a run the
 * streak still counts.
 *
 * `newestFirst` is a sorted list of ISO dates. Anything dated after today — a
 * clock that was wrong once — sorts ahead of the run and is kept with it,
 * because a prefix is the only shape `slice` can keep.
 */
function keptForCurrentRun(newestFirst: readonly string[], runStart: Day | null): number {
  // Dates sort as strings, so every entry from the run's first day on is newer.
  return runStart === null ? 0 : newestFirst.filter((d) => d >= runStart).length;
}

/**
 * A real calendar date, not merely date-shaped. '2026-02-30' passes ISO_DATE,
 * and stepping it (shiftISO) throws a RangeError — out of the menu's create(),
 * which is the blank-screen brick again.
 */
function isDay(s: unknown): s is Day {
  if (typeof s !== 'string' || !ISO_DATE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** Sorted, de-duplicated bridged days, trimmed to the cap outside the live run. */
function trimMarked(days: Iterable<Day>, done: ReadonlySet<Day>, today: Day): Day[] {
  const newestFirst = [...new Set(days)].sort().reverse();
  const start = currentRunStart(done, new Set(newestFirst), today);
  const keep = Math.max(MAX_BOOKMARKED, keptForCurrentRun(newestFirst, start));
  return newestFirst.slice(0, keep).reverse();
}

/**
 * A saved mission record, strictly: anything unexpected nulls the whole thing
 * and the next read builds today's three afresh. A half-trusted record is how
 * a mission pays twice.
 */
function coerceMissions(v: unknown): MissionState | null {
  if (typeof v !== 'object' || v === null) return null;
  const m = v as Record<string, unknown>;
  const { date, ids, progress, paid } = m;
  if (!isDay(date)) return null;
  if (!Array.isArray(ids) || !Array.isArray(progress) || !Array.isArray(paid)) return null;
  if (ids.length !== 3 || progress.length !== 3 || paid.length !== 3) return null;
  const inSlot = (id: unknown, i: number): boolean =>
    typeof id === 'string' && (MISSION_SLOTS[i] as readonly string[]).includes(id);
  if (!ids.every(inSlot)) return null;
  if (!progress.every((p) => typeof p === 'number' && Number.isFinite(p))) return null;
  if (!paid.every((p) => typeof p === 'boolean')) return null;

  const slots = ids as MissionId[];
  const target = (i: number): number => MISSION_TARGET[slots[i]];
  // A finished slot is a paid slot: a record claiming otherwise would pay again.
  const done = paid.map((p, i) => p === true || (progress[i] as number) >= target(i));
  return {
    date,
    ids: [slots[0], slots[1], slots[2]],
    progress: [0, 1, 2].map((i) =>
      done[i] ? target(i) : Math.min(target(i), Math.max(0, Math.trunc(progress[i] as number)))
    ) as MissionState['progress'],
    paid: [done[0], done[1], done[2]],
  };
}

/**
 * The play days a save written before `playDays` shows: the days in its Daily
 * ledger, the days its figures were drawn on and its last foreground — or the
 * sampled session minutes, one per day, where those say more. Ledger and figure
 * days count only before today, because markSeen counts today itself when it
 * stamps it; `lastSeen` is a day markSeen will not count again. It can only
 * fall short, never over: a 1.3 player who finished nothing left no dates.
 */
function playDaysShown(
  daily: Readonly<Record<string, DailyResult>>,
  figures: readonly SavedFigure[],
  sessionDays: number,
  lastSeen: string,
  today: Day
): number {
  const days = new Set<string>();
  for (const d of Object.keys(daily)) if (d < today) days.add(d);
  for (const f of figures) {
    const d = Number.isFinite(f.at) ? todayISO(new Date(f.at)) : '';
    if (isDay(d) && d < today) days.add(d);
  }
  if (lastSeen !== '') days.add(lastSeen);
  return Math.max(days.size, sessionDays);
}

function freshSave(): SaveData {
  return {
    version: SCHEMA,
    unlockedIndex: 0,
    bestMs: {},
    cleared: [],
    reveals: monetization.reveals.startingStash,
    lastTopUp: '',
    adsRemoved: false,
    totalWins: 0,
    winsSinceAd: 0,
    attemptsSinceAd: 0,
    ratePrompted: false,
    figures: [],
    daily: {},
    medals: [],
    foldSense: 0,
    sound: true,
    music: true,
    haptics: true,
    reducedMotion: prefersReducedMotion(),
    capability: '',
    bookmarks: 0,
    bookmarked: [],
    lastRepair: '',
    missions: null,
    chapterMarks: [],
    starterBought: false,
    starterSeen: false,
    rewardedDay: '',
    rewardedToday: 0,
    grantedTx: [],
    taught: [],
    reminders: true,
    nudgeAsks: 0,
    nudgeAskedOn: '',
    sessionMinutes: [],
    lastSeen: '',
    playDays: 0,
    ratePromptedVersion: '',
    bestRatio: {},
    teachMirrorN: 0,
  };
}

/** The OS-level preference, when the platform exposes one. */
function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

/** Merge over a fresh save so a save written by an older build never has holes. */
function coerce(raw: unknown): SaveData {
  const base = freshSave();
  if (typeof raw !== 'object' || raw === null) return base;
  const r = raw as Partial<SaveData>;

  /*
   * A saved value is untrusted input, not just "our own data".
   *
   * It survives app updates, it can be written by an older or newer build, and
   * on the web it is one devtools line away from anything. `typeof === 'number'`
   * accepts NaN, Infinity, -5 and 1.5 — and a negative or fractional
   * `unlockedIndex` reached `LEVELS[i].name` in MenuScene and threw during
   * create(), which leaves NO scene running: a blank canvas with no button to
   * press, and the bad save is never rewritten, so every relaunch dies the same
   * way. A permanently bricked app from one bad integer.
   */
  const count = (n: unknown, fallback: number, min = 0): number =>
    typeof n === 'number' && Number.isFinite(n) ? Math.max(min, Math.trunc(n)) : fallback;

  const isPoint = (p: unknown): p is Vec2 => {
    const v = p as Partial<Vec2> | null;
    return (
      typeof v === 'object' &&
      v !== null &&
      Number.isFinite(v.x as number) &&
      Number.isFinite(v.y as number)
    );
  };

  /** Drop figures that cannot be drawn rather than letting one kill the scene. */
  const figures = Array.isArray(r.figures)
    ? (r.figures as unknown[])
        .filter((f): f is SavedFigure => {
          if (typeof f !== 'object' || f === null) return false;
          const g = f as Partial<SavedFigure>;
          return (
            Array.isArray(g.points) &&
            Array.isArray(g.times) &&
            g.points.length > 0 &&
            g.points.every(isPoint)
          );
        })
        /*
         * The maze is dropped independently of the figure it came with.
         *
         * A figure whose walls are malformed is still a perfectly good figure,
         * and it has a render path that needs no maze at all — the one every
         * figure saved before this field existed already takes. Throwing the
         * drawing away over its background would lose the part the player
         * actually made.
         */
        .map((f) => {
          const walls = Array.isArray(f.walls)
            ? f.walls.filter(
                (w): w is Rect =>
                  typeof w === 'object' &&
                  w !== null &&
                  ['x', 'y', 'w', 'h'].every((k) =>
                    Number.isFinite((w as unknown as Record<string, unknown>)[k] as number)
                  )
              )
            : undefined;
          return {
            ...f,
            walls: walls && walls.length > 0 ? walls : undefined,
            start: isPoint(f.start) ? f.start : undefined,
            goal: isPoint(f.goal) ? f.goal : undefined,
          };
        })
    : base.figures;

  /** Keep only well-formed daily entries under sane ISO-date keys. */
  const allDaily: [string, DailyResult][] = [];
  if (typeof r.daily === 'object' && r.daily !== null) {
    for (const [k, v] of Object.entries(r.daily as Record<string, unknown>)) {
      if (!isDay(k)) continue;
      if (typeof v !== 'object' || v === null) continue;
      const d = v as Partial<DailyResult>;
      if (typeof d.ms !== 'number' || !Number.isFinite(d.ms)) continue;
      allDaily.push([
        k,
        {
          ms: Math.max(0, d.ms),
          deaths: count(d.deaths, 0),
          foldSense: Math.min(100, count(d.foldSense, 0)),
        },
      ]);
    }
  }
  // Newest kept: the streak only ever walks backwards from today.
  allDaily.sort((a, b) => (a[0] < b[0] ? 1 : -1));

  /*
   * Bridged days are read before the ledger is trimmed, because they are part
   * of the run the trim must not cut. Future dates are dropped outright: a
   * bookmark covers a day that was MISSED, and a day that has not happened yet
   * has not been missed.
   */
  const today = todayISO();
  const doneAll = new Set(allDaily.map(([d]) => d));
  const markedAll = Array.isArray(r.bookmarked)
    ? (r.bookmarked as unknown[]).filter((d): d is Day => isDay(d) && d <= today)
    : [];
  const runStart = currentRunStart(doneAll, new Set(markedAll), today);
  const daily: Record<string, DailyResult> = Object.fromEntries(
    allDaily.slice(
      0,
      Math.max(MAX_DAILY, keptForCurrentRun(allDaily.map(([d]) => d), runStart))
    )
  );
  const bookmarked = trimMarked(markedAll, doneAll, today);

  /*
   * A future day on a stamp is repaired, not honoured — the same rule as the
   * daily top-up. A `lastRepair` from next month would otherwise hold the
   * cooldown shut for weeks after the clock came back.
   */
  const pastDay = (v: unknown): string => (isDay(v) ? (v > today ? today : v) : '');
  const day = (v: unknown): string => (isDay(v) ? v : '');
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? (v as unknown[]).filter((s): s is string => typeof s === 'string') : [];

  // Once each, at its newest position, then the newest hundred.
  const txs = strings(r.grantedTx).filter((s) => s.length >= 1 && s.length <= 64);
  const grantedTx = [...new Set(txs.reverse())].reverse().slice(-MAX_GRANTED_TX);

  const version = count(r.version, 1, 1);

  const sessionMinutes = Array.isArray(r.sessionMinutes)
    ? (r.sessionMinutes as unknown[])
        .filter((n): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 1439)
        .slice(-7)
    : [];
  const lastSeen = day(r.lastSeen);

  /*
   * The v1 → v2 content migration.
   *
   * Everything the player EARNED survives: the purchase, the gallery, the
   * reveal stash, the daily ledger and streak, lifetime wins. What is dropped
   * is everything keyed by a level id, because in v1 those ids named bar levels
   * and in v2 they name mazes — keeping them would credit the player with 95
   * mazes they have never seen and attach best times to levels that no longer
   * exist.
   *
   * `unlockedIndex` is deliberately NOT reset. Access is the one thing it would
   * be unkind to take back, and an unlocked-but-uncleared level is a coherent
   * state the level select already renders: you may play it, you have not
   * finished it.
   */
  const keeps = (id: unknown): id is string =>
    typeof id === 'string' && idSurvives(version, id);

  /*
   * Entry-level coercion, not just container-level.
   *
   * `daily` validates every value it keeps; `bestMs` used to check only that
   * the map was an object, so a stored `{ l1: 'fast' }` or `{ l1: NaN }` went
   * straight through to the code that formats it as a time. Untrusted input is
   * untrusted all the way down.
   */
  const bestMs: Record<string, number> = {};
  if (typeof r.bestMs === 'object' && r.bestMs !== null) {
    for (const [id, v] of Object.entries(r.bestMs as Record<string, unknown>)) {
      if (keeps(id) && typeof v === 'number' && Number.isFinite(v) && v >= 0) bestMs[id] = v;
    }
  }

  // Same rules, plus: a ratio is a positive length over a positive par, and
  // only campaign ids are measured (see CAMPAIGN_IDS).
  const bestRatio: Record<string, number> = {};
  if (typeof r.bestRatio === 'object' && r.bestRatio !== null) {
    for (const [id, v] of Object.entries(r.bestRatio as Record<string, unknown>)) {
      if (keeps(id) && CAMPAIGN_IDS.has(id) && typeof v === 'number' && Number.isFinite(v) && v > 0) {
        bestRatio[id] = roundRatio(v);
      }
    }
  }

  const taught = [...new Set(strings(r.taught).filter((t): t is Lesson => (LESSONS as string[]).includes(t)))];

  const known: SaveData = {
    /*
     * Never stamped DOWN. A save written by a newer build carries level ids
     * that mean whatever that build meant by them; rewriting the number to
     * SCHEMA would make a future v2→v3 migration silently skip this player,
     * which is the same class of bug the v1→v2 migration exists to fix.
     */
    version: Math.max(version, SCHEMA),
    unlockedIndex: count(r.unlockedIndex, base.unlockedIndex),
    bestMs,
    cleared: Array.isArray(r.cleared) ? r.cleared.filter(keeps) : base.cleared,
    reveals: count(r.reveals, base.reveals),
    lastTopUp: typeof r.lastTopUp === 'string' ? r.lastTopUp : base.lastTopUp,
    adsRemoved: r.adsRemoved === true,
    totalWins: count(r.totalWins, base.totalWins),
    winsSinceAd: count(r.winsSinceAd, base.winsSinceAd),
    attemptsSinceAd: count(r.attemptsSinceAd, base.attemptsSinceAd),
    ratePrompted: r.ratePrompted === true,
    figures,
    daily,
    medals: Array.isArray(r.medals) ? r.medals.filter(keeps) : base.medals,
    foldSense: Math.min(100, count(r.foldSense, base.foldSense)),
    // A missing flag means a save written before settings existed, so it takes
    // the default rather than reading `undefined !== false` as "off".
    sound: r.sound !== false,
    music: r.music !== false,
    haptics: r.haptics !== false,
    reducedMotion: typeof r.reducedMotion === 'boolean' ? r.reducedMotion : base.reducedMotion,
    capability: typeof r.capability === 'string' ? r.capability : '',
    /*
     * A save from before bookmarks, from a player who has folded at least one
     * Daily, starts with one: a gift to the people already keeping a streak,
     * and the rule explained by the thing itself the first time it saves them.
     * Only when the field is ABSENT — a present zero is a bookmark spent.
     */
    bookmarks:
      r.bookmarks === undefined
        ? Object.keys(daily).length > 0
          ? Math.min(1, economy.streak.bookmarkMax)
          : 0
        : Math.min(economy.streak.bookmarkMax, count(r.bookmarks, 0)),
    bookmarked,
    lastRepair: pastDay(r.lastRepair),
    missions: coerceMissions(r.missions),
    // Missing is fine: settleChapterMarks pays whatever is due, once.
    chapterMarks: [...new Set(strings(r.chapterMarks).filter((m) => MARK_PATTERN.test(m)))],
    starterBought: r.starterBought === true,
    starterSeen: r.starterSeen === true,
    rewardedDay: day(r.rewardedDay),
    rewardedToday: Math.min(economy.rewardedRevealsPerDay, count(r.rewardedToday, 0)),
    grantedTx,
    taught,
    reminders: r.reminders !== false,
    nudgeAsks: Math.min(3, count(r.nudgeAsks, 0)),
    nudgeAskedOn: day(r.nudgeAskedOn),
    sessionMinutes,
    lastSeen,
    /*
     * Absent on a save from before the count: estimated from what the save
     * does date (see playDaysShown), so a player who has been folding for
     * weeks is not made to wait another day for the one review ask.
     */
    playDays: count(
      r.playDays,
      playDaysShown(daily, figures, sessionMinutes.length, lastSeen, today)
    ),
    ratePromptedVersion:
      typeof r.ratePromptedVersion === 'string' && r.ratePromptedVersion.length <= 32
        ? r.ratePromptedVersion
        : '',
    bestRatio,
    /*
     * A player the one-time mirror lesson already reached has seen the idea
     * named once, so the labelled arrow owes them two more, not three.
     */
    teachMirrorN: Math.min(
      MIRROR_LABELS,
      count(r.teachMirrorN, taught.includes('mirror') ? 1 : 0)
    ),
  };

  /*
   * Carry through what this build does not know.
   *
   * Every field above is rebuilt from the keys this build knows, so without
   * this a save written by a NEWER build lost its new fields the moment an
   * older one opened it — the owner switching TestFlight builds was enough.
   * From here on an unknown top-level key rides along untouched: this build
   * cannot validate it, so it neither reads it nor rewrites it. `__proto__` is
   * the one key that must not be assigned: JSON.parse makes it an own key,
   * and an assignment would set the object's prototype instead. An array was
   * never a save, so its indices are not fields.
   */
  const out = known as unknown as Record<string, unknown>;
  for (const [k, v] of Array.isArray(raw) ? [] : Object.entries(raw as Record<string, unknown>)) {
    if (k === '__proto__' || Object.prototype.hasOwnProperty.call(out, k)) continue;
    out[k] = v;
  }
  return known;
}

class ProgressStore {
  private state: SaveData = freshSave();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lifecycleBound = false;
  /**
   * Whether `state` is the player's save yet, or still the placeholder it
   * starts as.
   *
   * Until load() has come back, `state` is freshSave(): no levels, no gallery,
   * no purchase. Writing THAT to disk is not a harmless early write, it is the
   * player's save replaced by an empty one — and the lifecycle flush is bound
   * before the read, so a backgrounding during the Preferences round trip did
   * exactly that. Reproduced: a 57-level save with Remove Ads read back as
   * level 1 with nothing owned after the app was killed in that window.
   */
  private loaded = false;

  private readonly grantListeners = new Set<GrantListener>();
  /** Grants that happened with nobody on screen to show them. See takeUnshownGrants. */
  private unshown: GrantEvent[] = [];
  /** The last guard that bridged a day, until the Menu takes it. See takeStreakGuard. */
  private pendingGuard: StreakGuard | null = null;
  /** Snapshots already settled: a second settle of the same win pays nothing. */
  private settled = new WeakSet<WinBefore>();
  /** Skips since launch. Never saved: see skipsSinceLaunch. */
  private skips = 0;

  get data(): Readonly<SaveData> {
    return this.state;
  }

  async load(): Promise<SaveData> {
    try {
      const { value } = await Preferences.get({ key: KEY });
      this.state = value ? coerce(JSON.parse(value) as unknown) : freshSave();
    } catch {
      this.state = freshSave();
    }
    this.loaded = true;
    // Moments from before the read belonged to the placeholder it replaced.
    this.unshown = [];
    this.pendingGuard = null;
    this.applyDailyTopUp();
    this.applyStreakGuard();
    this.markSeen();
    return this.state;
  }

  /** Mutate and schedule a write. Never awaited from the game loop. */
  update(patch: Partial<SaveData>): void {
    this.state = { ...this.state, ...patch };
    this.scheduleFlush();
  }

  isUnlocked(index: number): boolean {
    return index <= this.state.unlockedIndex;
  }

  hasCleared(id: string): boolean {
    return this.state.cleared.includes(id);
  }

  /** Record a win: unlock the next level, keep the best time, bump counters. */
  recordWin(levelId: string, levelIndex: number, elapsedMs: number, totalLevels: number): void {
    const best = this.state.bestMs[levelId];
    const bestMs = { ...this.state.bestMs };
    if (best === undefined || elapsedMs < best) bestMs[levelId] = elapsedMs;

    this.update({
      bestMs,
      cleared: this.state.cleared.includes(levelId)
        ? this.state.cleared
        : [...this.state.cleared, levelId],
      unlockedIndex: Math.min(
        Math.max(this.state.unlockedIndex, levelIndex + 1),
        totalLevels - 1
      ),
      totalWins: this.state.totalWins + 1,
      winsSinceAd: this.state.winsSinceAd + 1,
    });
  }

  /**
   * Keep the figure the player just drew.
   *
   * Every one is kept, not just the best per level: the point of the gallery is
   * that no two strokes are the same, so replacing yesterday's figure with a
   * faster one would throw away the only thing here worth showing anyone.
   */
  addFigure(figure: SavedFigure): void {
    const figures = [...this.state.figures, compact(figure)];
    this.update({
      figures: figures.length > MAX_FIGURES ? figures.slice(-MAX_FIGURES) : figures,
    });
  }

  /** Newest first, which is the order a gallery should read in. */
  get figures(): readonly SavedFigure[] {
    return [...this.state.figures].reverse();
  }

  /** Unlock without clearing — what a rewarded skip buys. */
  unlockThrough(levelIndex: number, totalLevels: number): void {
    this.skips += 1;
    this.update({
      unlockedIndex: Math.min(
        Math.max(this.state.unlockedIndex, levelIndex + 1),
        totalLevels - 1
      ),
    });
  }

  /**
   * How many skips this launch has seen, whether or not they moved the
   * frontier. Session state for the review prompt, which stays away from a
   * player who has just been let past a level (see Rate); nothing else in the
   * save cares how a level was left behind.
   */
  get skipsSinceLaunch(): number {
    return this.skips;
  }

  get reveals(): number {
    // Owning Remove Ads makes reveals unlimited — the bundled perk that roughly
    // doubles what the purchase is worth at no marginal cost.
    return this.state.adsRemoved ? Number.POSITIVE_INFINITY : this.state.reveals;
  }

  /**
   * THE way reveals arrive. Refuses anything but a positive whole number — a
   * NaN here would poison the balance for good, since count() clamps it to
   * zero on the next load — and returns whether it granted.
   *
   * `reason` defaults to 'purchase' only so the callers written before grant
   * reasons existed keep compiling; every new call names its reason.
   *
   * Also refused before the save is read: load() replaces the placeholder
   * wholesale, so a grant into it would be reported as paid and then vanish.
   */
  grantReveals(n: number, reason: GrantReason = 'purchase'): boolean {
    if (!this.loaded || !Number.isInteger(n) || n <= 0) return false;
    this.update({ reveals: this.state.reveals + n });
    this.emit({ reveals: n, bookmarks: 0, reason });
    return true;
  }

  /**
   * Hear every grant, wherever it came from — a mission, a chapter, a late
   * Ask to Buy approval. Scenes subscribe in create() and call the returned
   * function on SHUTDOWN. Called AFTER the balance is written.
   */
  onGrant(cb: GrantListener): () => void {
    this.grantListeners.add(cb);
    return () => {
      this.grantListeners.delete(cb);
    };
  }

  /**
   * Grants no listener SHOWED, oldest first, emptied by the call.
   *
   * The daily reveal is paid by load(), before any scene exists, and by a
   * foreground that may land on a scene with nothing to show it on; a late
   * purchase can land anywhere. Those two kinds are kept here until the Menu
   * takes them. Everything else is presented by the flow that caused it (the
   * win card, the store sheet) and is never kept.
   */
  takeUnshownGrants(): GrantEvent[] {
    const out = this.unshown;
    this.unshown = [];
    return out;
  }

  private emit(g: GrantEvent): void {
    let shown = false;
    for (const cb of [...this.grantListeners]) {
      try {
        if (cb(g) === true) shown = true;
      } catch (e) {
        // One broken listener must not cost the others their moment, nor the
        // caller its grant — the balance is already written.
        console.error(e);
      }
    }
    if (!shown && (g.reason === 'daily' || g.reason === 'late-purchase')) {
      this.unshown = [...this.unshown, g].slice(-20);
    }
  }

  /**
   * Credit a store transaction exactly once.
   *
   * StoreKit redelivers an approved transaction until it is finished — after a
   * crash between grant and finish, on every launch until then — so the id is
   * the receipt: seen before means paid before. The grant and the id land in
   * ONE update, so no state exists where one is written and the other is not.
   *
   * True means credited now; false means not credited now, which is two
   * different things to the caller: the id was already paid (finish it), or
   * the save is not read yet (leave it — StoreKit redelivers it, and a finish
   * now would lose the purchase, since load() drops the placeholder it went
   * into). So the caller finishes on `hasGrantedTx(id)`, never on this
   * result: credit, then if the id is recorded, await flush() and finish.
   */
  creditTransaction(txId: string, n: number, reason: GrantReason = 'purchase'): boolean {
    if (!this.loaded || !Number.isInteger(n) || n <= 0) return false;
    const id = txKey(txId);
    if (!id || this.state.grantedTx.includes(id)) return false;
    this.update({
      reveals: this.state.reveals + n,
      grantedTx: [...this.state.grantedTx, id].slice(-MAX_GRANTED_TX),
    });
    this.emit({ reveals: n, bookmarks: 0, reason });
    return true;
  }

  hasGrantedTx(txId: string): boolean {
    const id = txKey(txId);
    return id !== '' && this.state.grantedTx.includes(id);
  }

  recordGrantedTx(txId: string): void {
    const id = txKey(txId);
    if (!this.loaded || !id || this.state.grantedTx.includes(id)) return;
    this.update({ grantedTx: [...this.state.grantedTx, id].slice(-MAX_GRANTED_TX) });
  }

  /* ------------------------------------------------ the rewarded cap */

  /**
   * Ad-paid reveals still available today. A stamp from a later day than
   * today (a clock set back) counts as today — the count is kept, never reset
   * — and applyDailyTopUp stamps it back to today, so tomorrow is fresh.
   */
  adRevealsLeft(now: Date = new Date()): number {
    return Math.max(0, economy.rewardedRevealsPerDay - this.adRevealsUsed(now));
  }

  private adRevealsUsed(now: Date): number {
    const d = this.state.rewardedDay;
    return d !== '' && d >= todayISO(now) ? this.state.rewardedToday : 0;
  }

  /**
   * Whether a placement paying `n` reveals may be drawn at all. The cap is
   * across every placement and counts reveals, not ads: the chapter doubler
   * pays two, so it needs two left — with one left it would take the day to
   * six. Gate every currency row on this at draw time.
   */
  canAdPay(n = 1, now: Date = new Date()): boolean {
    return Number.isInteger(n) && n > 0 && this.adRevealsLeft(now) >= n;
  }

  /**
   * Pay `n` ad-earned reveals and count them against today's cap, in one
   * update: the way a rewarded placement pays, on 'earned' and nothing else.
   * False, paying nothing, when fewer than `n` are left — unreachable for a
   * row gated with canAdPay(n), and never a partial payment if it happens.
   */
  payAdReveals(n = 1, now: Date = new Date()): boolean {
    if (!this.loaded || !this.canAdPay(n, now)) return false;
    this.update({
      reveals: this.state.reveals + n,
      rewardedDay: todayISO(now),
      rewardedToday: this.adRevealsUsed(now) + n,
    });
    this.emit({ reveals: n, bookmarks: 0, reason: 'rewarded' });
    return true;
  }

  /**
   * Count `n` ad-paid reveals against today's cap, for a caller that granted
   * them itself. Refuses — false, nothing counted — rather than clamping when
   * fewer than `n` are left, so an over-cap payment is visible to the caller
   * instead of silently absorbed. Prefer payAdReveals, which cannot overpay.
   */
  recordAdReveal(now: Date = new Date(), n = 1): boolean {
    if (!this.loaded || !this.canAdPay(n, now)) return false;
    this.update({ rewardedDay: todayISO(now), rewardedToday: this.adRevealsUsed(now) + n });
    return true;
  }

  /** False when the player has none left, so the caller can upsell instead. */
  spendReveal(): boolean {
    if (this.state.adsRemoved) return true;
    if (this.state.reveals <= 0) return false;
    this.update({ reveals: this.state.reveals - 1 });
    return true;
  }

  setAdsRemoved(owned: boolean, reason: GrantReason = 'purchase'): void {
    if (this.state.adsRemoved === owned) return;
    this.update({ adsRemoved: owned });
    // Announced with nothing granted: the reminder copy and every balance
    // display change with ownership, bought or restored alike. An approval
    // nobody's button waited for comes as 'late-purchase', the one reason a
    // listener shows (and `takeUnshownGrants` keeps).
    this.emit({ reveals: 0, bookmarks: 0, reason, adsRemoved: owned });
  }

  /* ------------------------------------------------ the starter pack */

  /** Sold once per install: after this, the store never offers it again. */
  markStarterBought(): void {
    if (!this.state.starterBought) this.update({ starterBought: true });
  }

  /** The store has shown the starter; the NEW badge goes. */
  markStarterSeen(): void {
    if (!this.state.starterSeen) this.update({ starterSeen: true });
  }

  /* ---------------------------------------------------------- daily fold */

  /** Record today's Daily Fold. First finish wins; replays don't overwrite. */
  recordDaily(dateISO: string, result: DailyResult): void {
    if (this.state.daily[dateISO]) return;
    const patch: Partial<SaveData> = { daily: { ...this.state.daily, [dateISO]: result } };

    /*
     * A Daily opened before midnight and finished after it is filed under the
     * day it was opened — and by then the guard (a foreground, or the snapshot
     * this very win took) may have spent a bookmark covering that day as
     * missed. It was not missed: the bookmark comes back, and the Menu never
     * says it was spent. Only a bridge the Menu has not yet reported can be
     * this one; a repair is made from the Menu, with no Daily in progress.
     */
    const g = this.pendingGuard;
    if (g?.bridged.includes(dateISO)) {
      patch.bookmarked = this.state.bookmarked.filter((d) => d !== dateISO);
      patch.bookmarks = Math.min(economy.streak.bookmarkMax, this.state.bookmarks + 1);
    }
    this.update(patch);

    if (g && patch.bookmarks !== undefined) {
      const bridged = g.bridged.filter((d) => d !== dateISO);
      this.pendingGuard =
        bridged.length > 0
          ? { ...g, bridged, streak: this.dailyStreak(todayISO()), left: patch.bookmarks }
          : null;
    }
  }

  dailyResult(dateISO: string): DailyResult | null {
    return this.state.daily[dateISO] ?? null;
  }

  hasDaily(dateISO: string): boolean {
    return dateISO in this.state.daily;
  }

  /**
   * Consecutive finished days ending at `todayISO`. Today itself counts only
   * once finished, but an unfinished today does not BREAK the run — the
   * streak survives until the day actually passes, which is how every streak
   * the player has ever kept works. Bookmarked days bridge the run without
   * adding to it (core/Streak.ts).
   */
  dailyStreak(today: string): number {
    const { done, marked } = streakSets(this.state);
    return streakFrom(done, marked, today);
  }

  /** The best run the player has ever kept, for the streak-loss moment. */
  longestStreak(): number {
    const { done, marked } = streakSets(this.state);
    return longestFrom(done, marked);
  }

  get bookmarks(): number {
    return this.state.bookmarks;
  }

  /**
   * Spend bookmarks on days missed since the last kept one, if they cover
   * them all and the run is worth keeping (Streak.guardPlan). Runs wherever
   * the daily top-up does — load, every foreground, the menu — and is
   * idempotent, so every one of them can call it.
   *
   * The result is also kept for the Menu (takeStreakGuard), because the call
   * that spends the bookmark is usually load() or a foreground, with no scene
   * up to say so.
   */
  applyStreakGuard(now: Date = new Date()): StreakGuard | null {
    if (!this.loaded) return null;
    const today = todayISO(now);
    if (this.state.lastRepair > today) this.update({ lastRepair: today });
    const { done, marked } = streakSets(this.state);
    const { bridge } = guardPlan(done, marked, today, this.state.bookmarks, economy.streak.guardMinRun);
    if (bridge.length === 0) return null;

    const pay = this.bridgePays(bridge, today, this.state.bookmarks - bridge.length);
    this.update({
      bookmarked: pay.marked,
      bookmarks: pay.held,
      ...(pay.reveals > 0 ? { reveals: this.state.reveals + pay.reveals } : {}),
    });
    const prior = this.pendingGuard;
    const result: StreakGuard = {
      bridged: [...(prior?.bridged ?? []), ...bridge],
      streak: this.dailyStreak(today),
      left: pay.held,
      milestones: [...(prior?.milestones ?? []), ...pay.milestones],
    };
    this.pendingGuard = result;
    if (pay.reveals > 0 || pay.bookmarks > 0) {
      this.emit({ reveals: pay.reveals, bookmarks: pay.bookmarks, reason: 'streak' });
    }
    return result;
  }

  /** What the guard spent since the Menu last asked, emptied by the call. */
  takeStreakGuard(): StreakGuard | null {
    const g = this.pendingGuard;
    this.pendingGuard = null;
    return g;
  }

  /**
   * What covering `bridge` (missed days, oldest first) does to the streak and
   * pays, with `held` bookmarks left once any it costs are spent.
   *
   * Usually it pays nothing: the run it restores had already reached its
   * length, and was paid for each day of it. But with today already folded,
   * the bridge joins that run to today's and the streak reaches a day it
   * never reached — six folded, one missed, today folded is a seven the moment
   * the gap is covered — and nothing else would pay it: the next Daily
   * reaches eight. So the days paid are the ones past what either run had
   * reached (Streak.milestonesBetween), never one twice.
   */
  private bridgePays(
    bridge: readonly Day[],
    today: Day,
    held: number
  ): { marked: Day[]; milestones: Milestone[]; reveals: number; bookmarks: number; held: number } {
    const { done, marked } = streakSets(this.state);
    const from = Math.max(streakFrom(done, marked, today), runBefore(done, marked, bridge[0]));
    const next = trimMarked([...marked, ...bridge], done, today);
    const to = streakFrom(done, new Set(next), today);
    const milestones = milestonesBetween(from, to, held, economy.streak);
    const reveals = milestones.reduce((s, m) => s + m.reveals, 0);
    const bookmarks = milestones.reduce((s, m) => s + m.bookmarks, 0);
    return {
      marked: next,
      milestones,
      reveals,
      bookmarks,
      held: Math.min(economy.streak.bookmarkMax, held + bookmarks),
    };
  }

  /** The missed days a repair would cover today, oldest first (Streak.repairDays). */
  private repairPlan(today: Day): Day[] {
    const { done, marked } = streakSets(this.state);
    return repairDays(done, marked, today, this.state.lastRepair, this.state.bookmarks, economy.repair);
  }

  /** The missed day a repair would cover today, or null (the first, if several). */
  repairableDay(today: Day): Day | null {
    return this.repairPlan(today)[0] ?? null;
  }

  /**
   * The milestones a repair today would pay: none, unless today's Daily is
   * already folded and the repair joins the runs (see bridgePays). Read it
   * just before repairStreak to name them after the count-up — or on the row.
   */
  repairPays(today: Day): readonly Milestone[] {
    const days = this.repairPlan(today);
    return days.length === 0 ? [] : this.bridgePays(days, today, this.state.bookmarks).milestones;
  }

  /**
   * Cover the missed day, after the ad (or for free — see the rescue rule).
   * Returns false, changing nothing, when there is no longer a day to repair:
   * a sheet left open across midnight must not repair the wrong one.
   *
   * Announced once, reason 'repair', carrying whatever milestone the repair
   * reached (repairPays) — usually nothing. The milestone is the streak's
   * reward, not the ad's: the repair only lets the run count the days that
   * were folded.
   */
  repairStreak(today: Day): boolean {
    if (!this.loaded) return false;
    const days = this.repairPlan(today);
    if (days.length === 0) return false;
    const pay = this.bridgePays(days, today, this.state.bookmarks);
    this.update({
      bookmarked: pay.marked,
      lastRepair: today,
      bookmarks: pay.held,
      ...(pay.reveals > 0 ? { reveals: this.state.reveals + pay.reveals } : {}),
    });
    this.emit({ reveals: pay.reveals, bookmarks: pay.bookmarks, reason: 'repair' });
    return true;
  }

  /* -------------------------------------------------------------- medals */

  addMedal(levelId: string): void {
    if (this.state.medals.includes(levelId)) return;
    this.update({ medals: [...this.state.medals, levelId] });
  }

  hasMedal(levelId: string): boolean {
    return this.state.medals.includes(levelId);
  }

  /* --------------------------------------------------------------- stars */

  /**
   * Keep the measurement a campaign win made: its line ÷ par (Stars.lineRatio
   * — the one number the card prints and the meter promised).
   *
   * The best only ever falls, and the medal is still written for a two-star
   * line, so a 1.4 build opened later keeps showing it. Nothing is written for
   * a Daily or a win with no par; the line's own stars are still reported.
   * Call it after recordWin and before settleWin, so the chapter's stars on
   * the card include this win.
   */
  recordRatio(levelId: string, ratio: number | null): LineRecord {
    const line = starsFor(ratio);
    if (!CAMPAIGN_IDS.has(levelId)) return { line, stars: 0, best: null, newBest: false };
    const old = this.bestRatioOf(levelId);
    const r = ratio !== null && Number.isFinite(ratio) && ratio > 0 ? roundRatio(ratio) : null;
    const newBest = r !== null && (old === null || r < old);
    const patch: Partial<SaveData> = {};
    if (newBest) patch.bestRatio = { ...this.state.bestRatio, [levelId]: r };
    if (line >= 2 && !this.state.medals.includes(levelId)) patch.medals = [...this.state.medals, levelId];
    if (Object.keys(patch).length > 0) this.update(patch);
    // The line itself cleared the level, whatever order the caller recorded in.
    const stars = Math.max(line, this.stars(levelId)) as StarCount;
    return { line, stars, best: newBest ? r : old, newBest };
  }

  /** The level's best line ÷ par, or null for none measured. */
  bestRatioOf(levelId: string): number | null {
    const b = this.state.bestRatio;
    return Object.prototype.hasOwnProperty.call(b, levelId) ? b[levelId] : null;
  }

  /** Stars level `levelId` holds: derived, never stored (core/Stars). */
  stars(levelId: string): StarCount {
    return starsOf(this.state, levelId);
  }

  /** Stars across the campaign, of Stars.TOTAL_STARS. */
  totalStars(): number {
    return totalStars(this.state);
  }

  /**
   * Whether this mirror death's arc arrow says "your reflection": the first
   * MIRROR_LABELS of a save do, and each yes is counted. `if (mirrorLabel())`.
   */
  mirrorLabel(): boolean {
    if (this.state.teachMirrorN >= MIRROR_LABELS) return false;
    this.update({ teachMirrorN: this.state.teachMirrorN + 1 });
    return true;
  }

  /**
   * A cheap reason to open the app tomorrow.
   *
   * LOCAL date, via the same helper the Daily Fold uses. This ran on UTC while
   * the fold rolled over locally, so west of Greenwich the pill's own promise —
   * "one more lands tomorrow" — pointed at a different day than the fold it was
   * offered on.
   */
  applyDailyTopUp(now: Date = new Date()): number {
    // Before the read there is only the placeholder to top up, and load() runs
    // this itself the moment the real save is in. Every foreground calls it
    // (main.ts), including one that lands during the boot read.
    if (!this.loaded) return 0;
    const today = todayISO(now);
    // The rewarded cap's day follows the same clock-back rule, here because
    // this is what runs on every foreground: see adRevealsLeft.
    if (this.state.rewardedDay > today) this.update({ rewardedDay: today });
    if (this.state.lastTopUp === today) return 0;

    /*
     * STRICTLY BEFORE today, not merely "different from" today.
     *
     * The inequality version was a faucet. A `lastTopUp` in the FUTURE is never
     * equal to today, so it granted a reveal on every single launch, forever —
     * and getting one there takes no cleverness: set the clock forward, open
     * the app, set it back. It also fires on the honest version of that, a
     * phone whose clock was wrong and got corrected, and on any save a devtools
     * console has been near.
     *
     * A future date is repaired rather than rewarded: stamp it back to today
     * and hand out nothing, so tomorrow resumes the ordinary schedule.
     */
    if (this.state.lastTopUp > today) {
      this.update({ lastTopUp: today });
      return 0;
    }

    const n = monetization.reveals.freeDailyTopUp;
    this.update({ lastTopUp: today, reveals: this.state.reveals + n });
    // Now visible: the menu plays it as a gift, a level as a toast.
    if (n > 0) this.emit({ reveals: n, bookmarks: 0, reason: 'daily' });
    return n;
  }

  /* ------------------------------------------------------------ missions */

  /**
   * Whether the Daily is open to this player (§0: locked for a brand-new
   * player until the last tutorial fold is cleared; anyone who has ever folded
   * a Daily keeps it). Also open to anyone who has cleared a fold past the
   * tutorial: a save migrated to v3 forgot its l1…l5 clears but not the
   * player, who is on level 57 and will never replay the tutorial to earn
   * them back. One rule, here, so the Daily card, the reminder route and the
   * missions never disagree about it.
   */
  dailyUnlocked(): boolean {
    const s = this.state;
    if (Object.keys(s.daily).length > 0) return true;
    const tutorial = TUTORIAL_LEVELS.map((l) => l.id);
    return s.cleared.some((id) => id === tutorial[tutorial.length - 1] || !tutorial.includes(id));
  }

  /**
   * Missions open with the tutorial done AND the Daily open, because slot one
   * is always the Daily: a player who skipped the last tutorial fold has the
   * access (unlockedIndex) but not the Daily, and a mission they cannot even
   * start would hold "all three done" out of reach every day.
   */
  private missionsUnlocked(): boolean {
    return this.state.unlockedIndex >= economy.missions.unlockAfterIndex && this.dailyUnlocked();
  }

  /**
   * The mission record to use today, without writing it, and the slots it
   * starts with finished — which whoever writes it pays, in the same update.
   *
   * A day's record is built on its first read, and that can come after the
   * day's Daily was folded: on the day 1.4 is installed, or the day missions
   * open for a player who had already folded it. A first finish happens once,
   * so without this the Daily slot could never finish that day, beside a
   * Daily card saying done.
   */
  private currentMissions(today: Day): { state: MissionState; carried: number[] } | null {
    if (!this.missionsUnlocked()) return null;
    const m = this.state.missions;
    if (m && m.date === today) return { state: m, carried: [] };
    // A record from a later day is a clock set back: it becomes today's, so
    // the same three cannot be paid twice by moving the clock.
    if (m && m.date > today) return { state: { ...m, date: today }, carried: [] };
    const cleared = new Set(this.state.cleared);
    const clearedCount = LEVELS.filter((l) => cleared.has(l.id)).length;
    const fresh = missionsFor(today, { clearedCount, unclearedCount: LEVELS.length - clearedCount });
    if (!(today in this.state.daily)) return { state: fresh, carried: [] };
    const { state, completed } = advanceMissions(fresh, DAILY_ALREADY_FOLDED);
    return { state, carried: completed };
  }

  /**
   * Today's three, rolling over at local midnight; null until the tutorial is
   * done and the Daily is open (see missionsUnlocked). Writing a new day's
   * record pays a Daily already folded that day (reason 'mission').
   */
  missionsToday(now: Date = new Date()): MissionState | null {
    if (!this.loaded) return null;
    const cur = this.currentMissions(todayISO(now));
    if (!cur) return null;
    if (cur.state !== this.state.missions) {
      const r = cur.carried.length * economy.missions.reward;
      this.update(r > 0 ? { missions: cur.state, reveals: this.state.reveals + r } : { missions: cur.state });
      if (r > 0) this.emit({ reveals: r, bookmarks: 0, reason: 'mission' });
    }
    return cur.state;
  }

  /* ------------------------------------------------------ chapter marks */

  /**
   * Due marks and what they pay. A win passes its own chapter: the card can
   * only draw that chapter's bar, so a backlog elsewhere stays due for the
   * Menu's toast rather than arriving as reveals the card cannot explain.
   */
  private chapterDue(only?: number): { marks: string[]; reveals: number } {
    let marks = dueMarks(new Set(this.state.cleared), new Set(this.state.chapterMarks));
    if (only !== undefined) marks = marks.filter((m) => parseMark(m)?.chapter === only);
    const reveals = marks.reduce((s, m) => s + markReward(m, economy.chapter), 0);
    return { marks, reveals };
  }

  /**
   * Pay every chapter mark that is due, once, and say what was paid.
   *
   * Two callers: the win (reason 'chapter'), and the Menu on entering (reason
   * 'backlog'), which is how a player who finished chapters before marks
   * existed is paid for them — 45 reveals at the very most, once.
   */
  settleChapterMarks(reason: GrantReason = 'backlog'): { marks: string[]; reveals: number } {
    if (!this.loaded) return { marks: [], reveals: 0 };
    const due = this.chapterDue();
    if (due.marks.length === 0) return due;
    this.update({
      chapterMarks: [...this.state.chapterMarks, ...due.marks],
      reveals: this.state.reveals + due.reveals,
    });
    this.emit({ reveals: due.reveals, bookmarks: 0, reason });
    return due;
  }

  /* ------------------------------------------------------------ the win */

  /**
   * Everything a win's rewards need to know from BEFORE the win is recorded.
   * Call it first in win(), then the existing record* calls, then settleWin.
   *
   * It also runs the streak guard: a Daily finished after a missed day, with
   * no foreground in between (the app left open across midnight), must meet
   * the run the bookmark would have kept, not a broken one.
   */
  snapshotForWin(levelId: string, levelIndex: number, now: Date = new Date()): WinBefore {
    this.applyStreakGuard(now);
    return {
      levelId,
      levelIndex,
      wasCleared: this.hasCleared(levelId),
      hadMedal: this.hasMedal(levelId),
      starsBefore: this.stars(levelId),
      bestRatioBefore: this.bestRatioOf(levelId),
      prevBestMs: this.state.bestMs[levelId] ?? null,
      streakBefore: this.dailyStreak(todayISO(now)),
      missionsOpen: this.missionsUnlocked(),
    };
  }

  /**
   * Settle everything a win earned — missions, chapter marks, the streak
   * milestone and bookmark — in ONE update, then announce the grants. Runs
   * after recordWin / addMedal / recordDaily, against the snapshot taken
   * before them. Owners accrue reveals like anyone (the stored balance is what
   * they would keep if the entitlement were ever lost); their lines say ✓.
   *
   * Settling the same snapshot twice pays nothing the second time.
   */
  settleWin(before: WinBefore, facts: WinFacts, now: Date = new Date()): WinOutcome {
    const outcome: WinOutcome = {
      reveals: 0,
      bookmarks: 0,
      lines: [],
      chapter: null,
      streak: null,
      missions: null,
    };
    if (!this.loaded || this.settled.has(before)) return outcome;
    this.settled.add(before);

    const owner = this.state.adsRemoved;
    const isDaily = facts.dailyDate !== null;
    const patch: Partial<SaveData> = {};
    const grants: GrantEvent[] = [];

    // Lines in the card's order: the chapter bar (or the streak on a Daily), then missions.
    if (!isDaily) {
      const c = chapterOf(facts.levelIndex);
      const due = this.chapterDue(c);
      if (due.marks.length > 0) {
        patch.chapterMarks = [...this.state.chapterMarks, ...due.marks];
        for (const mark of due.marks) {
          const at = (parseMark(mark) as { at: MarkAt }).at;
          const r = markReward(mark, economy.chapter);
          const text = at === 10 ? `Halfway through chapter ${c + 1}` : `Chapter ${c + 1} complete`;
          outcome.lines.push({
            kind: at === 10 ? 'chapter-half' : 'chapter-full',
            text: owner ? `${text} ✓` : `${text} · ${plusReveals(r)}`,
            reveals: r,
            bookmarks: 0,
          });
        }
        outcome.reveals += due.reveals;
        grants.push({ reveals: due.reveals, bookmarks: 0, reason: 'chapter' });
      }
      const cleared = new Set(this.state.cleared);
      const medals = new Set(this.state.medals);
      outcome.chapter = {
        index: c,
        ...chapterStats(cleared, medals, c, this.state.unlockedIndex),
        stars: chapterStars(this.state, c),
        crossed: due.marks.map((m) => (parseMark(m) as { at: MarkAt }).at),
      };
    }

    /*
     * The streak moves when a Daily joins the run: the first finish of
     * today's, or of yesterday's finished after midnight (filed under the day
     * it was opened, so it lands in the run a day late). What the run had
     * reached before was paid on its own day, so only the days reached now
     * pay — never one twice, and never one jumped over. A replay adds no day
     * and moves nothing.
     */
    if (isDaily && facts.dailyDate) {
      const { done, marked } = streakSets(this.state);
      const from = Math.max(before.streakBefore, runBefore(done, marked, facts.dailyDate));
      const after = streakFrom(done, marked, todayISO(now));
      if (after > from) {
        const reached = milestonesBetween(from, after, this.state.bookmarks, economy.streak);
        let reveals = 0;
        let bookmarks = 0;
        for (const m of reached) {
          outcome.lines.push({
            kind: m.reveals === 0 && m.bookmarks > 0 ? 'bookmark' : 'streak',
            text: milestoneText(m, owner),
            reveals: m.reveals,
            bookmarks: m.bookmarks,
          });
          reveals += m.reveals;
          bookmarks += m.bookmarks;
        }
        if (reached.length > 0) {
          patch.bookmarks = Math.min(economy.streak.bookmarkMax, this.state.bookmarks + bookmarks);
          outcome.reveals += reveals;
          outcome.bookmarks += bookmarks;
          grants.push({ reveals, bookmarks, reason: 'streak' });
        }
        outcome.streak = { before: from, after, milestone: reached[reached.length - 1] ?? null };
      }
    }

    if (before.missionsOpen) {
      const cur = this.currentMissions(todayISO(now));
      if (cur) {
        const event: WinEvent = {
          daily: isDaily,
          todayDailyFirst: isDaily && facts.todayDailyFirst,
          firstClear: !isDaily && !before.wasCleared,
          medal: !isDaily && facts.medal,
          deaths: facts.deaths,
          beatBest:
            !isDaily && before.wasCleared && before.prevBestMs !== null && facts.ms < before.prevBestMs,
          repeat: !isDaily && before.wasCleared && facts.repeat === true,
          skipped: false,
        };
        const { state, completed: won } = advanceMissions(cur.state, event);
        // A day's record built here pays a Daily folded before it, too.
        const completed = [...cur.carried, ...won];
        patch.missions = state;
        outcome.missions = state;
        if (completed.length > 0) {
          const r = completed.length * economy.missions.reward;
          const done = completed.length === 1 ? 'Mission done' : `${completed.length} missions done`;
          outcome.lines.push({
            kind: 'mission',
            text: owner ? `${done} ✓` : `${done} · ${plusReveals(r)}`,
            reveals: r,
            bookmarks: 0,
          });
          outcome.reveals += r;
          grants.push({ reveals: r, bookmarks: 0, reason: 'mission' });
        }
      }
    }

    if (outcome.reveals > 0) patch.reveals = this.state.reveals + outcome.reveals;
    if (Object.keys(patch).length > 0) this.update(patch);
    for (const g of grants) if (g.reveals > 0 || g.bookmarks > 0) this.emit(g);
    return outcome;
  }

  /* ------------------------------------------------ sessions, reminders */

  /**
   * The app is in front of the player: stamp the day, and on the first
   * foreground of a new day remember the minute and count the day. The
   * reminder time is read from those minutes (NudgePlan.reminderMinute), so it
   * follows when this player actually opens the game, Daily or not; the review
   * prompt reads the count.
   */
  markSeen(now: Date = new Date()): void {
    if (!this.loaded) return;
    const today = todayISO(now);
    const last = this.state.lastSeen;
    if (last === today) return;
    // A later day is a clock set back: repaired, and no minute is sampled for
    // a day that already has one.
    if (last > today) {
      this.update({ lastSeen: today });
      return;
    }
    const minute = now.getHours() * 60 + now.getMinutes();
    this.update({
      lastSeen: today,
      sessionMinutes: [...this.state.sessionMinutes, minute].slice(-7),
      playDays: this.state.playDays + 1,
    });
  }

  setReminders(on: boolean): void {
    if (this.state.reminders !== on) this.update({ reminders: on });
  }

  /** A soft ask for notifications was shown today (at most 3, ever). */
  recordNudgeAsk(today: Day): void {
    this.update({ nudgeAsks: Math.min(3, this.state.nudgeAsks + 1), nudgeAskedOn: today });
  }

  /* ------------------------------------------------------- one-time lessons */

  /** Mark a lesson taught. True only the first time, so `if (teach(x)) show()`. */
  teach(lesson: Lesson): boolean {
    if (this.state.taught.includes(lesson)) return false;
    this.update({ taught: [...this.state.taught, lesson] });
    return true;
  }

  isTaught(lesson: Lesson): boolean {
    return this.state.taught.includes(lesson);
  }

  /**
   * Write when the app goes away, whatever the debounce timer thinks.
   *
   * Writes are coalesced 250ms so a burst of updates is one store round-trip,
   * which is right — but it opens a window where a win exists only in memory.
   * Measured: a clear landed on disk 394ms after it happened. Task-switch out
   * inside that window and iOS can kill the process with the win unsaved, and
   * the player replays a level they already beat. Costs nothing to close.
   */
  installLifecycleFlush(): void {
    if (this.lifecycleBound) return;
    this.lifecycleBound = true;
    const onHide = (): void => {
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      void this.flush();
    };
    // DOM events, not @capacitor/app: WKWebView fires visibilitychange when the
    // app backgrounds and pagehide when it is torn down, so this covers native
    // and web without adding a native dependency to sync and rebuild.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') onHide();
    });
    window.addEventListener('pagehide', onHide);
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, 250);
  }

  /**
   * Write the save now. True when it reached the disk — the store waits on
   * that before it finishes (consumes) a transaction; every other caller can
   * ignore it.
   */
  async flush(): Promise<boolean> {
    // Nothing to write before the read: see `loaded`. Whatever was on disk is
    // still there, which is the only correct thing for it to be.
    if (!this.loaded) return false;
    try {
      await Preferences.set({ key: KEY, value: JSON.stringify(this.state) });
      return true;
    } catch {
      /* a failed write must never surface as a crash mid-game */
      return false;
    }
  }

  /** Dev only. Deliberately overwrites whatever is on disk. */
  async reset(): Promise<void> {
    this.state = freshSave();
    this.loaded = true;
    this.unshown = [];
    this.pendingGuard = null;
    this.settled = new WeakSet();
    await this.flush();
  }
}

export const Progress = new ProgressStore();
