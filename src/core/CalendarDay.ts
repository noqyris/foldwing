/**
 * CalendarDay — the one definition of "what day is it" in the game.
 *
 * This exists because two systems disagreed about it. The Daily Fold rolled
 * over at the player's LOCAL midnight while the free reveal top-up rolled over
 * at UTC midnight, so for up to eleven hours a day the message "one more lands
 * tomorrow" and the fold it applied to were talking about different days.
 *
 * Local wins. A daily puzzle is a ritual attached to the player's own evening,
 * not to Greenwich, and a player in Belgrade should not get Tuesday's fold at
 * 02:00 on Tuesday. Everything that asks "which day is this" comes here.
 *
 * Pure and clock-injectable so it is testable, with no Phaser and no storage.
 */

/** Local calendar date as YYYY-MM-DD. */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Step an ISO date by whole days.
 *
 * Done in UTC on purpose: the input is already a calendar date with no time of
 * day, so stepping it in local time would let a DST jump land the result on the
 * wrong date. UTC has no such discontinuity, and the result is a date string
 * either way.
 */
export function shiftISO(dateISO: string, days: number): string {
  const t = Date.parse(`${dateISO}T00:00:00Z`);
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b`, negative when `b` is earlier. */
export function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000
  );
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
