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

const KEY = 'foldwing.save.v1';

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
}

export interface SaveData {
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
}

/**
 * How many figures to keep.
 *
 * Preferences is backed by UserDefaults, which is not a database — an unbounded
 * array of point lists would grow the plist without limit and slow every launch,
 * since the whole blob is parsed at boot. Old figures fall off the back.
 */
const MAX_FIGURES = 120;

function freshSave(): SaveData {
  return {
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
  };
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

  /** Drop figures that cannot be drawn rather than letting one kill the scene. */
  const figures = Array.isArray(r.figures)
    ? (r.figures as unknown[]).filter((f): f is SavedFigure => {
        if (typeof f !== 'object' || f === null) return false;
        const g = f as Partial<SavedFigure>;
        return (
          Array.isArray(g.points) &&
          Array.isArray(g.times) &&
          g.points.length > 0 &&
          g.points.every((p) => typeof p?.x === 'number' && typeof p?.y === 'number')
        );
      })
    : base.figures;

  return {
    unlockedIndex: count(r.unlockedIndex, base.unlockedIndex),
    bestMs: typeof r.bestMs === 'object' && r.bestMs !== null ? r.bestMs : base.bestMs,
    cleared: Array.isArray(r.cleared) ? r.cleared.filter((c) => typeof c === 'string') : base.cleared,
    reveals: count(r.reveals, base.reveals),
    lastTopUp: typeof r.lastTopUp === 'string' ? r.lastTopUp : base.lastTopUp,
    adsRemoved: r.adsRemoved === true,
    totalWins: count(r.totalWins, base.totalWins),
    winsSinceAd: count(r.winsSinceAd, base.winsSinceAd),
    attemptsSinceAd: count(r.attemptsSinceAd, base.attemptsSinceAd),
    ratePrompted: r.ratePrompted === true,
    figures,
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
    const figures = [...this.state.figures, figure];
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

  /** A cheap reason to open the app tomorrow. */
  private applyDailyTopUp(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (this.state.lastTopUp === today) return;
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
