/**
 * Streak — the Daily Fold run, its bookmarks, and what a run earns.
 *
 * Pure: sets of ISO local dates in, numbers and dates out. No clock, no save,
 * no Phaser, so every rule here is tested with the dates spelled out, DST and
 * all (Streak.test.ts, in Europe/Belgrade).
 *
 * Two kinds of day make a run:
 *  - DONE: the Daily was finished that day. Only these are COUNTED.
 *  - MARKED: a bookmark (or a repair) covered a missed day. These BRIDGE the
 *    run but never add to it — done Sat, done Sun, marked Mon, done Tue is a
 *    3-day streak, not 4. A streak is a count of days the player folded; a
 *    bookmark keeps that count alive, it does not fold for them.
 *
 * Game Center's week achievement reads the ledger of done days only
 * (GameCenter.ts, `last7`), so a bookmark can never earn it.
 */

import { daysBetween, ISO_DATE, shiftISO } from './CalendarDay';

export type Day = string; // ISO local date, YYYY-MM-DD

/** The slice of monetization.economy.streak these rules read. */
export interface StreakConfig {
  readonly bookmarkMax: number;
  readonly bookmarkAt: readonly number[];
  readonly bookmarkEvery: number;
  readonly guardMinRun: number;
  readonly overflowReveals: number;
  readonly milestones: Readonly<Record<number, number>>;
  readonly everyFiftyAfter100: number;
}

export interface RepairConfig {
  readonly maxGapDays: number;
  readonly cooldownDays: number;
  readonly minRun: number;
}

const kept = (done: ReadonlySet<Day>, marked: ReadonlySet<Day>, d: Day): boolean =>
  done.has(d) || marked.has(d);

/**
 * Done days in the run that ends on `end`, walking back over done ∪ marked.
 * Zero when `end` itself is not kept.
 */
function runEndingAt(done: ReadonlySet<Day>, marked: ReadonlySet<Day>, end: Day): number {
  let n = 0;
  for (let d = end; kept(done, marked, d); d = shiftISO(d, -1)) if (done.has(d)) n++;
  return n;
}

/**
 * The run alive today. Today counts once it is done, but an unfinished today
 * does not break anything — the streak survives until the day actually passes,
 * which is how every streak the player has ever kept works.
 */
export function streakFrom(done: ReadonlySet<Day>, marked: ReadonlySet<Day>, today: Day): number {
  return runEndingAt(done, marked, done.has(today) ? today : shiftISO(today, -1));
}

/**
 * The first day of the run alive today (null when there is none). The save
 * trims old history to a cap, and nothing from this day on may be trimmed —
 * see Progress `coerce`.
 */
export function currentRunStart(
  done: ReadonlySet<Day>,
  marked: ReadonlySet<Day>,
  today: Day
): Day | null {
  let d = kept(done, marked, today) ? today : shiftISO(today, -1);
  if (!kept(done, marked, d)) return null;
  while (kept(done, marked, shiftISO(d, -1))) d = shiftISO(d, -1);
  return d;
}

/** The best run ever kept, counting done days through bridges. */
export function longestFrom(done: ReadonlySet<Day>, marked: ReadonlySet<Day>): number {
  // Sorted strings are sorted dates; daysBetween on a malformed one is NaN,
  // which simply breaks the run instead of throwing out of a menu build.
  const days = [...new Set([...done, ...marked])].filter((d) => ISO_DATE.test(d)).sort();
  let best = 0;
  let run = 0;
  let prev = '';
  for (const d of days) {
    if (!(prev && daysBetween(prev, d) === 1)) run = 0;
    if (done.has(d)) run++;
    prev = d;
    if (run > best) best = run;
  }
  return best;
}

/** The latest kept day strictly before `today`, or null. */
function lastKeptBefore(done: ReadonlySet<Day>, marked: ReadonlySet<Day>, today: Day): Day | null {
  let last: Day | null = null;
  for (const d of [...done, ...marked]) {
    if (ISO_DATE.test(d) && d < today && (last === null || d > last)) last = d;
  }
  return last;
}

/**
 * What the automatic guard would bridge today.
 *
 * G is the number of days strictly between the last kept day and today. The
 * guard spends bookmarks only when it can cover ALL of them (1 ≤ G ≤ held):
 * half a bridge keeps nothing and would waste what the player holds. And only
 * for a run of at least `minRun` done days — a one-day "streak" is not worth a
 * bookmark the player may want next week.
 *
 * Idempotent by construction: once bridged, the last kept day is yesterday,
 * G is 0 and there is nothing left to plan. Days after today (a clock that was
 * wrong once) are ignored, so a future-dated ledger can never be bridged TO.
 */
export function guardPlan(
  done: ReadonlySet<Day>,
  marked: ReadonlySet<Day>,
  today: Day,
  bookmarks: number,
  minRun: number
): { bridge: Day[] } {
  const last = lastKeptBefore(done, marked, today);
  if (last === null) return { bridge: [] };
  const gap = daysBetween(last, today) - 1;
  if (!(gap >= 1 && gap <= bookmarks)) return { bridge: [] };
  if (runEndingAt(done, marked, last) < minRun) return { bridge: [] };
  const bridge: Day[] = [];
  for (let i = 1; i <= gap; i++) bridge.push(shiftISO(last, i));
  return { bridge };
}

/**
 * The missed days a repair would cover, oldest first, or none.
 *
 * The days strictly between the last kept day and today (with today already
 * done, still those), at most `maxGapDays` of them, uncovered, after a run of
 * at least `minRun`, with the cooldown since the last repair elapsed. And not
 * when the guard is about to cover them for free: offering an ad for what a
 * held bookmark does anyway would be selling the player their own bookmark.
 */
export function repairDays(
  done: ReadonlySet<Day>,
  marked: ReadonlySet<Day>,
  today: Day,
  lastRepair: Day | '',
  bookmarks: number,
  cfg: RepairConfig
): Day[] {
  if (lastRepair !== '' && !(daysBetween(lastRepair, today) >= cfg.cooldownDays)) return [];
  const last = lastKeptBefore(done, marked, today);
  if (last === null) return [];
  const gap = daysBetween(last, today) - 1;
  if (!(gap >= 1 && gap <= cfg.maxGapDays)) return [];
  if (runEndingAt(done, marked, last) < cfg.minRun) return [];
  if (guardPlan(done, marked, today, bookmarks, cfg.minRun).bridge.length > 0) return [];
  return Array.from({ length: gap }, (_, i) => shiftISO(last, i + 1));
}

/** The first day a repair would cover, or null. With `maxGapDays: 1`, the only one. */
export function repairable(
  done: ReadonlySet<Day>,
  marked: ReadonlySet<Day>,
  today: Day,
  lastRepair: Day | '',
  bookmarks: number,
  cfg: RepairConfig
): Day | null {
  return repairDays(done, marked, today, lastRepair, bookmarks, cfg)[0] ?? null;
}

/**
 * Done days in the run that ended the day before `day`: what that run had
 * reached, and been paid for, before `day` joined it.
 */
export function runBefore(done: ReadonlySet<Day>, marked: ReadonlySet<Day>, day: Day): number {
  return runEndingAt(done, marked, shiftISO(day, -1));
}

/** What reaching a streak day pays, already resolved against the bookmark cap. */
export interface Milestone {
  readonly day: number;
  readonly reveals: number;
  readonly bookmarks: number;
  readonly title: string;
  readonly body: string;
}

const plural = (n: number, one: string, many: string): string => `+${n} ${n === 1 ? one : many}`;

const TITLES: Readonly<Record<number, string>> = {
  7: 'A week of folds',
  14: 'Two weeks folded',
  30: 'A month of folds',
};

/**
 * The reward for reaching `streak` today, or null when the day pays nothing.
 *
 * Reveals come from the milestone table (then +N every fifty days past 100);
 * a bookmark comes on the configured days and every `bookmarkEvery`th. A
 * bookmark that would go over the cap pays `overflowReveals` instead, so a
 * player who never misses a day is never paid less for it.
 */
export function milestoneFor(
  streak: number,
  bookmarksHeld: number,
  cfg: StreakConfig
): Milestone | null {
  if (!Number.isInteger(streak) || streak <= 0) return null;
  const table =
    cfg.milestones[streak] ??
    (streak > 100 && streak % 50 === 0 ? cfg.everyFiftyAfter100 : 0);
  const earnsBookmark =
    cfg.bookmarkAt.includes(streak) || (cfg.bookmarkEvery > 0 && streak % cfg.bookmarkEvery === 0);
  if (table <= 0 && !earnsBookmark) return null;

  const full = earnsBookmark && bookmarksHeld >= cfg.bookmarkMax;
  const bookmarks = earnsBookmark && !full ? 1 : 0;
  const reveals = table + (full ? cfg.overflowReveals : 0);

  // The first bookmark of a run explains itself; the rest just say what came.
  if (table <= 0 && bookmarks > 0 && cfg.bookmarkAt.includes(streak)) {
    return {
      day: streak,
      reveals,
      bookmarks,
      title: 'Bookmark earned',
      body: 'it keeps your streak if you miss a day',
    };
  }
  const parts: string[] = [];
  if (table > 0) parts.push(plural(table, 'reveal', 'reveals') + (bookmarks ? ' and a bookmark' : ''));
  else if (bookmarks) parts.push('+1 bookmark');
  if (full) parts.push(`bookmarks full, ${plural(cfg.overflowReveals, 'reveal', 'reveals')} instead`);
  const title = TITLES[streak] ?? `${streak} days`;
  return { day: streak, reveals, bookmarks, title, body: parts.join(' · ') };
}

/**
 * Every paying streak day in (from, to], in order, each resolved against the
 * bookmarks held by then: a bookmark one of them pays counts toward the cap
 * for the next.
 *
 * A Daily almost always moves the streak by one, so this is one day or none.
 * But a bridge or a Daily finished after midnight can join two runs and move
 * it by several, and a day it jumps over is never reached again: the next
 * Daily reaches the day after. Paying the range, from what the run had
 * already reached, pays each day once and skips none.
 */
export function milestonesBetween(
  from: number,
  to: number,
  bookmarksHeld: number,
  cfg: StreakConfig
): Milestone[] {
  const out: Milestone[] = [];
  let held = bookmarksHeld;
  for (let d = Math.max(0, Math.trunc(from)) + 1; d <= to; d++) {
    const m = milestoneFor(d, held, cfg);
    if (!m) continue;
    out.push(m);
    held = Math.min(cfg.bookmarkMax, held + m.bookmarks);
  }
  return out;
}

/** The next streak day after `streak` that pays anything — for the Streak sheet. */
export function nextMilestone(streak: number, bookmarksHeld: number, cfg: StreakConfig): Milestone {
  // Every `bookmarkEvery`th day pays, so this ends within a week.
  for (let d = Math.max(0, Math.trunc(streak)) + 1; ; d++) {
    const m = milestoneFor(d, bookmarksHeld, cfg);
    if (m) return m;
  }
}

export type WeekDot = 'done' | 'marked' | 'missed' | 'today-open' | 'today-done';

/** The last seven days, oldest first, as the week strip draws them. */
export function weekStrip(done: ReadonlySet<Day>, marked: ReadonlySet<Day>, today: Day): WeekDot[] {
  const out: WeekDot[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = shiftISO(today, -i);
    if (i === 0) out.push(done.has(d) ? 'today-done' : 'today-open');
    else out.push(done.has(d) ? 'done' : marked.has(d) ? 'marked' : 'missed');
  }
  return out;
}
