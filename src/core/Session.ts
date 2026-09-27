/**
 * Session — what counts as one (mobile-game-playbook, references/monetization.md
 * → "What counts as a session — not just a cold launch").
 *
 * A session is a cold launch, OR a return from the background after 30 minutes
 * or more, OR a return into a new local day. Counting only cold launches is
 * wrong on iOS: the OS keeps a suspended WKWebView alive for days, so a player
 * who never swipes the app away never cold-launches again — every per-session
 * cap stays spent and every per-session grace stays lifted, for days.
 *
 * Before this module Foldwing had two private copies of the rule, neither with
 * the midnight clause: the ad cadence's (SessionClock) and the review prompt's
 * (Rate), and Rate's measured an absence from the LAST hide. There is one now,
 * read by everything through systems/SessionLifecycle.
 *
 * A new session is NOT a new day. The daily gift, the streak, the missions and
 * the daily rewarded cap still roll over by the calendar, once a day, whatever
 * happens here; only a new day always makes a new session, never the reverse.
 *
 * Pure and clock-free: the caller passes the times and the LOCAL day keys —
 * core/CalendarDay's `todayISO`, the key the streak and the Daily already use.
 */

/** A return after this long in the background starts a new session. */
export const SESSION_GAP_MS = 30 * 60 * 1000;

export interface ReturnFromBackground {
  /** When the app went to the background — the FIRST hide of this pause. */
  readonly hiddenAtMs: number;
  /** The local day key (`todayISO`) at that moment. */
  readonly hiddenDay: string;
  /** Now. */
  readonly nowMs: number;
  /** The local day key now. */
  readonly today: string;
}

/**
 * Whether coming back to the foreground starts a new session.
 *
 * - A different day key is always one (the midnight clause), however short the
 *   pause.
 * - Otherwise, 30 minutes or more since the first hide.
 * - A clock set back within the same day is not a pause: the elapsed time is
 *   negative, which is never ≥ the gap.
 * - A stamp that is not a number is not a pause either.
 */
export function isNewSessionOnReturn(r: ReturnFromBackground): boolean {
  if (r.today !== r.hiddenDay) return true;
  if (!Number.isFinite(r.hiddenAtMs) || !Number.isFinite(r.nowMs)) return false;
  return r.nowMs - r.hiddenAtMs >= SESSION_GAP_MS;
}

/** What is kept while the app is in the background; null while it is visible. */
export interface HiddenStamp {
  readonly atMs: number;
  readonly day: string;
}

/**
 * The app went to the background. The FIRST hide of a pause is kept: iOS can
 * report one departure as several hides, and a second one without a return in
 * between must not move the stamp — that would measure a long absence from its
 * last few seconds. Returns `prev` itself when there is one.
 */
export function onHidden(prev: HiddenStamp | null, nowMs: number, day: string): HiddenStamp {
  return prev ?? { atMs: nowMs, day };
}

/**
 * The app came back. A visible event with no hide before it is not a pause (a
 * repeated visible, or one with nothing on record). Always clears the stamp.
 */
export function onVisible(
  prev: HiddenStamp | null,
  nowMs: number,
  today: string
): { readonly stamp: null; readonly newSession: boolean } {
  if (!prev) return { stamp: null, newSession: false };
  return {
    stamp: null,
    newSession: isNewSessionOnReturn({ hiddenAtMs: prev.atMs, hiddenDay: prev.day, nowMs, today }),
  };
}
