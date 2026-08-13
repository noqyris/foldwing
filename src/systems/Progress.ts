/**
 * Progress — everything the player keeps between sessions.
 *
 * Backed by Capacitor Preferences, which is native UserDefaults / SharedPrefs
 * on device and localStorage on the web, so the same code path serves both.
 *
 * Two rules the rest of the game relies on:
 *  - Reads never throw. A corrupt or absent save yields a fresh one, because
 *    losing progress is bad but refusing to launch is worse.
 *  - Writes are fire-and-forget and debounced. Nothing in the game loop ever
 *    waits on the disk.
 */

import { Preferences } from '@capacitor/preferences';
import { monetization } from '../config/monetization';
import { ISO_DATE, shiftISO, todayISO } from '../core/CalendarDay';
import type { Rect, Vec2 } from '../core/Geometry';

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
 */
const SCHEMA = 2;

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
  /** True once the native review prompt has been spent. */
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
 * Two years of history is far more than the streak needs (it only ever walks
 * backwards from today until it finds a gap) and more than any calendar view
 * would scroll.
 */
const MAX_DAILY = 730;

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
      if (!ISO_DATE.test(k)) continue;
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
  const daily: Record<string, DailyResult> = Object.fromEntries(
    allDaily.slice(0, MAX_DAILY)
  );

  const version = count(r.version, 1, 1);

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
  const stale = version < SCHEMA;

  /*
   * Entry-level coercion, not just container-level.
   *
   * `daily` validates every value it keeps; `bestMs` used to check only that
   * the map was an object, so a stored `{ l1: 'fast' }` or `{ l1: NaN }` went
   * straight through to the code that formats it as a time. Untrusted input is
   * untrusted all the way down.
   */
  const bestMs: Record<string, number> = {};
  if (!stale && typeof r.bestMs === 'object' && r.bestMs !== null) {
    for (const [id, v] of Object.entries(r.bestMs as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) bestMs[id] = v;
    }
  }

  return {
    /*
     * Never stamped DOWN. A save written by a newer build carries level ids
     * that mean whatever that build meant by them; rewriting the number to
     * SCHEMA would make a future v2→v3 migration silently skip this player,
     * which is the same class of bug the v1→v2 migration exists to fix.
     */
    version: Math.max(version, SCHEMA),
    unlockedIndex: count(r.unlockedIndex, base.unlockedIndex),
    bestMs,
    cleared:
      !stale && Array.isArray(r.cleared)
        ? r.cleared.filter((c) => typeof c === 'string')
        : base.cleared,
    reveals: count(r.reveals, base.reveals),
    lastTopUp: typeof r.lastTopUp === 'string' ? r.lastTopUp : base.lastTopUp,
    adsRemoved: r.adsRemoved === true,
    totalWins: count(r.totalWins, base.totalWins),
    winsSinceAd: count(r.winsSinceAd, base.winsSinceAd),
    attemptsSinceAd: count(r.attemptsSinceAd, base.attemptsSinceAd),
    ratePrompted: r.ratePrompted === true,
    figures,
    daily,
    medals:
      !stale && Array.isArray(r.medals)
        ? r.medals.filter((m) => typeof m === 'string')
        : base.medals,
    foldSense: Math.min(100, count(r.foldSense, base.foldSense)),
    // A missing flag means a save written before settings existed, so it takes
    // the default rather than reading `undefined !== false` as "off".
    sound: r.sound !== false,
    music: r.music !== false,
    haptics: r.haptics !== false,
    reducedMotion: typeof r.reducedMotion === 'boolean' ? r.reducedMotion : base.reducedMotion,
    capability: typeof r.capability === 'string' ? r.capability : '',
  };
}

class ProgressStore {
  private state: SaveData = freshSave();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lifecycleBound = false;

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
    this.applyDailyTopUp();
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
    this.update({
      unlockedIndex: Math.min(
        Math.max(this.state.unlockedIndex, levelIndex + 1),
        totalLevels - 1
      ),
    });
  }

  get reveals(): number {
    // Owning Remove Ads makes reveals unlimited — the bundled perk that roughly
    // doubles what the purchase is worth at no marginal cost.
    return this.state.adsRemoved ? Number.POSITIVE_INFINITY : this.state.reveals;
  }

  grantReveals(n: number): void {
    this.update({ reveals: this.state.reveals + n });
  }

  /** False when the player has none left, so the caller can upsell instead. */
  spendReveal(): boolean {
    if (this.state.adsRemoved) return true;
    if (this.state.reveals <= 0) return false;
    this.update({ reveals: this.state.reveals - 1 });
    return true;
  }

  setAdsRemoved(owned: boolean): void {
    if (this.state.adsRemoved === owned) return;
    this.update({ adsRemoved: owned });
  }

  /* ---------------------------------------------------------- daily fold */

  /** Record today's Daily Fold. First finish wins; replays don't overwrite. */
  recordDaily(dateISO: string, result: DailyResult): void {
    if (this.state.daily[dateISO]) return;
    this.update({ daily: { ...this.state.daily, [dateISO]: result } });
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
   * the player has ever kept works.
   */
  dailyStreak(today: string): number {
    const done = this.state.daily;
    let day = done[today] ? today : shiftISO(today, -1);
    let streak = 0;
    while (done[day]) {
      streak++;
      day = shiftISO(day, -1);
    }
    return streak;
  }

  /** The best run the player has ever kept, for the streak-loss moment. */
  longestStreak(): number {
    const days = Object.keys(this.state.daily).sort();
    let best = 0;
    let run = 0;
    let prev = '';
    for (const d of days) {
      run = prev && shiftISO(prev, 1) === d ? run + 1 : 1;
      prev = d;
      if (run > best) best = run;
    }
    return best;
  }

  /* -------------------------------------------------------------- medals */

  addMedal(levelId: string): void {
    if (this.state.medals.includes(levelId)) return;
    this.update({ medals: [...this.state.medals, levelId] });
  }

  hasMedal(levelId: string): boolean {
    return this.state.medals.includes(levelId);
  }

  /**
   * A cheap reason to open the app tomorrow.
   *
   * LOCAL date, via the same helper the Daily Fold uses. This ran on UTC while
   * the fold rolled over locally, so west of Greenwich the pill's own promise —
   * "one more lands tomorrow" — pointed at a different day than the fold it was
   * offered on.
   */
  applyDailyTopUp(now: Date = new Date()): void {
    const today = todayISO(now);
    if (this.state.lastTopUp === today) return;

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
      return;
    }

    this.update({
      lastTopUp: today,
      reveals: this.state.reveals + monetization.reveals.freeDailyTopUp,
    });
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

  async flush(): Promise<void> {
    try {
      await Preferences.set({ key: KEY, value: JSON.stringify(this.state) });
    } catch {
      /* a failed write must never surface as a crash mid-game */
    }
  }

  /** Dev only. */
  async reset(): Promise<void> {
    this.state = freshSave();
    await this.flush();
  }
}

export const Progress = new ProgressStore();
