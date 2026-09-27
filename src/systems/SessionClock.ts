/**
 * SessionClock — how long the player has been PLAYING this session.
 *
 * Pure: timestamps in, seconds out. No clock of its own, no document, no
 * config import; Ads.ts feeds it Date.now() and the page's visibility.
 *
 * FOREGROUND TIME ONLY. The session ladder's warm-up exists to protect the
 * first minutes of play. Measured on the wall clock, a player who played one
 * minute, locked the phone for twenty and came back read as twenty-one minutes
 * in: warm-up skipped, and already past the long-session mark, so the tighter
 * floor applied — the heaviest ad pacing handed to someone who had barely
 * started. Here time spent hidden simply does not accumulate: a return resumes
 * the session at the age it had when it was hidden.
 *
 * WHETHER A RETURN IS A NEW SESSION IS NOT DECIDED HERE. That is the app's one
 * rule (core/Session, driven by systems/SessionLifecycle): 30 minutes away, or a
 * new day. This clock used to carry a private copy of it, without the day;
 * now Ads hears the decision and calls `start()`, which puts the age back at
 * zero.
 *
 * What this clock does NOT measure is the gap between two ads, the mute after
 * a rewarded view or the daily rewarded cap. Those are floors on real elapsed
 * time, and time spent away counts toward them just the same — Ads keeps them
 * on the wall clock on purpose.
 *
 * Every interval is clamped at zero: a clock set back never makes the banked
 * age shrink. At worst the current on-screen stretch reads as zero until the
 * clock catches up — which only makes the session look younger, the direction
 * that shows fewer ads.
 */

export class SessionClock {
  /** Foreground ms accumulated before the current visible stretch. */
  private banked = 0;
  /** Start of the current visible stretch; null while hidden, and before a start. */
  private visibleSince: number | null = null;

  /**
   * Begin a session at age zero — at construction, when the ad SDK settles
   * (see Ads.init), and on every new session (see Ads.newSession).
   *
   * `visible` is the page's state right now. The SDK can settle while the app
   * is in the background, and a cold launch can start there too; in both
   * cases the age stays at zero until the player actually comes back.
   */
  start(now: number, visible: boolean): void {
    this.banked = 0;
    this.visibleSince = visible ? now : null;
  }

  /**
   * The page went to the background. Banks the stretch that just ended. A
   * second hide in a row is a no-op: it must not bank the stretch twice.
   */
  hide(now: number): void {
    if (this.visibleSince === null) return;
    this.banked += Math.max(0, now - this.visibleSince);
    this.visibleSince = null;
  }

  /**
   * The page came back: a new stretch begins. A second show in a row is a
   * no-op — restarting the stretch would throw away the time it holds.
   */
  show(now: number): void {
    if (this.visibleSince !== null) return;
    this.visibleSince = now;
  }

  /** Foreground seconds in the current session. Reads; never changes anything. */
  ageSeconds(now: number): number {
    const current = this.visibleSince === null ? 0 : Math.max(0, now - this.visibleSince);
    return (this.banked + current) / 1000;
  }
}
