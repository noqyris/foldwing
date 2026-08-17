/**
 * Game Center — the Daily Fold leaderboard, and nothing else.
 *
 * The Daily Fold is the one thing in this game worth ranking: a single maze
 * generated from the date, the same one for everyone in the world, already
 * played by people who want to know how they did. Everything else here is a
 * private campaign against a par line.
 *
 * So the board is `foldwing.daily.time` — recurring daily, best score, sorted
 * ascending because it holds times. It resets when the maze does.
 *
 * NOTHING HERE IS LOAD-BEARING. The game has no account, works offline and does
 * not need Game Center to be complete. A player who is signed out, underage,
 * offline or simply uninterested loses the leaderboard and nothing else, so
 * every call resolves and every failure is a `false` rather than a throw.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

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
}

const native = registerPlugin<GameCenterPlugin>('GameCenter');

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
   * Sign in, once per session, and never make anybody wait for it.
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
