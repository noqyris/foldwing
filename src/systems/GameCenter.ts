/**
 * Game Center — the Daily Fold leaderboard and the achievements.
 *
 * The Daily Fold is the one thing in this game worth ranking: a single maze
 * generated from the date, already played by people who want to know how they
 * did. Everything else here is a private campaign against a par line.
 *
 * So the board is `foldwing.daily.time` — recurring daily, best score, sorted
 * ascending because it holds times.
 *
 * WHAT THE BOARD ACTUALLY RANKS. The maze is a function of the player's LOCAL
 * date (core/CalendarDay: local wins), so it is the same for everyone on the
 * same date, not for everyone at the same moment — at 20:00 UTC Los Angeles and
 * Belgrade are folding the 22nd while Tokyo is already on the 23rd. The board
 * is one board with one reset instant, set in App Store Connect, and a score
 * carries no date (the plugin submits context 0). So an occurrence of the board
 * holds times from two neighbouring dated mazes for whatever part of the day
 * the players' local dates straddle its reset. It does NOT reset when the
 * maze does, except in the one time zone its reset is set to. Scores are only
 * submitted for the player's own today (GameScene.win), which keeps an old
 * date off the board but does not line the dates up. Whether to key scores by
 * date, or move the Daily to a UTC day, is a product decision still open.
 *
 * NOTHING HERE IS LOAD-BEARING. The game has no account, works offline and does
 * not need Game Center to be complete. A player who is signed out, underage,
 * offline or simply uninterested loses the leaderboard and nothing else, so
 * every call resolves and every failure is a `false` rather than a throw.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { todayISO } from '../core/CalendarDay';
import { Progress } from './Progress';

/** Matches the vendorIdentifier configured in App Store Connect. */
export const DAILY_LEADERBOARD = 'foldwing.daily.time';

interface Result {
  ok: boolean;
  reason?: string;
}

interface GameCenterPlugin {
  authenticate(): Promise<Result>;
  submitScore(o: { leaderboardID: string; score: number }): Promise<Result>;
  showLeaderboard(o: { leaderboardID: string }): Promise<Result>;
  reportAchievement(o: { identifier: string; percent?: number }): Promise<Result>;
  showAchievements(): Promise<Result>;
}

/**
 * Every achievement, and the condition that earns it.
 *
 * Kept as DATA, and as a pure predicate over the save, for two reasons. It can
 * be tested without a device — GameKit exists on neither the web build nor the
 * test runner — and reporting is stateless: the game reports whatever currently
 * holds, and GameKit is the thing that knows what was already earned. Reporting
 * an earned achievement again is a no-op, so nothing here has to remember.
 *
 * The ids match the vendorIdentifiers configured in App Store Connect. A typo
 * on either side is silent: GameKit accepts an unknown id and drops it.
 */
export interface Achievement {
  readonly id: string;
  readonly earned: (save: {
    cleared: readonly string[];
    medals: readonly string[];
    daily: Readonly<Record<string, unknown>>;
  }, run?: { deaths: number }) => boolean;
}

/** Seven ISO dates ending `today`, in order. */
function last7(today: string): string[] {
  const out: string[] = [];
  const [y, m, d] = today.split('-').map(Number);
  for (let i = 6; i >= 0; i--) {
    const t = new Date(Date.UTC(y, m - 1, d - i));
    out.push(t.toISOString().slice(0, 10));
  }
  return out;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'foldwing.first', earned: (s) => s.cleared.length >= 1 },
  { id: 'foldwing.ten', earned: (s) => s.cleared.length >= 10 },
  { id: 'foldwing.fifty', earned: (s) => s.cleared.length >= 50 },
  { id: 'foldwing.hundred', earned: (s) => s.cleared.length >= 100 },
  { id: 'foldwing.medal.ten', earned: (s) => s.medals.length >= 10 },
  { id: 'foldwing.medal.fifty', earned: (s) => s.medals.length >= 50 },
  /*
   * Only the run just finished can earn this, which is why it takes `run`: the
   * save records that a level was cleared, never how cleanly, so a flawless run
   * is knowable at exactly one moment and never again.
   */
  { id: 'foldwing.flawless', earned: (_s, run) => run !== undefined && run.deaths === 0 },
  /*
   * Seven LOCAL days, the same calendar the ledger is keyed by (CalendarDay).
   * This asked for the UTC date, so from 17:00 in California — 20:00 in New
   * York — it wanted a Daily dated tomorrow that cannot exist yet, and east of
   * Greenwich it dropped today's for the first hours after midnight. It is only
   * checked on a win, and the reminder goes out at 19:00 local, so a player who
   * always folds when reminded could never earn it.
   */
  {
    id: 'foldwing.streak.week',
    earned: (s) => last7(todayISO()).every((d) => d in s.daily),
  },
];

const native = registerPlugin<GameCenterPlugin>('GameCenter');

/**
 * Reasons `authenticate` gives when GameKit wanted to show its sign-in sheet
 * and the plugin could not put it up (GameCenterPlugin.swift). Before, the
 * present failed silently — UIKit refuses to present from a view controller
 * that is already presenting, the ad consent alert for one — the call never
 * settled, and the process's one sign-in attempt was spent on a sheet nobody
 * saw: the board and achievements then answered "not signed in" until relaunch.
 */
const NOT_ASKED: ReadonlySet<string> = new Set(['presenter-busy', 'no-view-controller']);

/**
 * Milliseconds to the unit the board actually stores.
 *
 * App Store Connect has no millisecond formatter — the finest time it offers is
 * ELAPSED_TIME_CENTISECOND — so the board is configured in hundredths and the
 * score is divided here. If this and the board's formatter ever disagree every
 * time is displayed off by a factor of ten, and there is nothing inside the app
 * that would reveal it.
 */
export const toCentiseconds = (ms: number): number => Math.max(1, Math.round(ms / 10));

class GameCenterService {
  private authed = false;
  private tried = false;

  /** Only where GameKit exists. The web Daily has no Game Center at all. */
  get available(): boolean {
    return Capacitor.isNativePlatform();
  }

  get signedIn(): boolean {
    return this.authed;
  }

  /**
   * Sign in, once per process, and never make anybody wait for it.
   *
   * Per process, not per session (SessionLifecycle): a suspended WebView can
   * keep one process alive for days, and that is fine — GameKit re-presents its
   * own authentication handler on foreground, so nothing here resets on a new
   * session.
   *
   * GameKit may put its own sign-in sheet on screen, which is why this is fired
   * from the menu rather than during a level: a system modal over a stroke in
   * progress would cost the player the attempt.
   */
  async signIn(): Promise<boolean> {
    if (!this.available || this.tried) return this.authed;
    this.tried = true;
    try {
      const r = await native.authenticate();
      this.authed = r.ok;
      // The sheet never reached the screen, so the player was never asked:
      // leave the door open for the next menu visit or board tap. A player
      // who saw the sheet and cancelled it is not asked again by this process.
      if (!r.ok && r.reason !== undefined && NOT_ASKED.has(r.reason)) this.tried = false;
    } catch {
      this.authed = false;
    }
    return this.authed;
  }

  /** Post today's time. Silent about every way it can fail to land. */
  async submitDaily(ms: number): Promise<boolean> {
    if (!this.available || !this.authed) return false;
    try {
      const r = await native.submitScore({
        leaderboardID: DAILY_LEADERBOARD,
        score: toCentiseconds(ms),
      });
      return r.ok;
    } catch {
      return false;
    }
  }

  /**
   * Report everything currently true.
   *
   * Deliberately not "report what just changed": the game holds no record of
   * what has been sent, GameKit does, and re-reporting an earned achievement
   * costs nothing. That keeps this correct across reinstalls and across a
   * player who signs in halfway through the campaign.
   */
  async reportAchievements(run?: { deaths: number }): Promise<void> {
    if (!this.available || !this.authed) return;
    const save = {
      cleared: Progress.data.cleared,
      medals: Progress.data.medals,
      daily: Progress.data.daily,
    };
    for (const a of ACHIEVEMENTS) {
      if (!a.earned(save, run)) continue;
      try {
        await native.reportAchievement({ identifier: a.id, percent: 100 });
      } catch {
        /* a lost achievement is not worth a broken win screen */
      }
    }
  }

  /** Game Center's achievements screen. */
  async showAchievements(): Promise<boolean> {
    if (!this.available) return false;
    if (!this.authed && !(await this.signIn())) return false;
    try {
      return (await native.showAchievements()).ok;
    } catch {
      return false;
    }
  }

  /** Open Game Center's own board. @returns false if it could not be shown. */
  async show(): Promise<boolean> {
    if (!this.available) return false;
    if (!this.authed && !(await this.signIn())) return false;
    try {
      const r = await native.showLeaderboard({ leaderboardID: DAILY_LEADERBOARD });
      return r.ok;
    } catch {
      return false;
    }
  }
}

export const GameCenter = new GameCenterService();
