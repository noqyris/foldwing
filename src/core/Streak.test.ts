/**
 * The streak is the one number a lapsed player comes back for, so its rules are
 * pinned day by day. Dates are spelled out; the suite runs in Europe/Belgrade
 * (vite.config.ts), which has a DST change on 2026-10-25.
 */

import { describe, expect, it } from 'vitest';
import { monetization } from '../config/monetization';
import { shiftISO, todayISO } from './CalendarDay';
import {
  currentRunStart,
  guardPlan,
  longestFrom,
  milestoneFor,
  milestonesBetween,
  nextMilestone,
  repairable,
  repairDays,
  runBefore,
  streakFrom,
  weekStrip,
} from './Streak';

const cfg = monetization.economy.streak;
const repairCfg = monetization.economy.repair;
const set = (...d: string[]): Set<string> => new Set(d);
const none = set();

describe('a bookmarked day', () => {
  // Sat 19, Sun 20, Mon 21 (bookmarked), Tue 22 September 2026.
  const done = set('2026-09-19', '2026-09-20', '2026-09-22');
  const marked = set('2026-09-21');

  it('bridges the run but does not add to it', () => {
    expect(streakFrom(done, marked, '2026-09-22')).toBe(3);
    // Without the bookmark the run is only today.
    expect(streakFrom(done, none, '2026-09-22')).toBe(1);
  });

  it('keeps the run alive through an unfinished today', () => {
    expect(streakFrom(set('2026-09-19', '2026-09-20'), set('2026-09-21'), '2026-09-22')).toBe(2);
  });

  it('is never a streak on its own', () => {
    expect(streakFrom(none, set('2026-09-21'), '2026-09-22')).toBe(0);
    expect(longestFrom(none, set('2026-09-20', '2026-09-21'))).toBe(0);
  });

  it('counts through bridges for the longest run, and breaks at a real gap', () => {
    const d = set('2026-09-01', '2026-09-02', '2026-09-04', '2026-09-05', '2026-09-10');
    expect(longestFrom(d, set('2026-09-03'))).toBe(4);
    expect(longestFrom(d, none)).toBe(2);
  });

  it('shrugs off a malformed date instead of throwing', () => {
    expect(longestFrom(set('2026-09-01', 'nope', '2026-02-30'), none)).toBe(1);
  });

  it('marks where the live run starts, bridges included', () => {
    expect(currentRunStart(done, marked, '2026-09-22')).toBe('2026-09-19');
    expect(currentRunStart(set('2026-09-01'), none, '2026-09-22')).toBeNull();
  });
});

describe('the automatic guard', () => {
  const run = set('2026-09-18', '2026-09-19');

  it('spends a bookmark on one missed day after a run of two', () => {
    expect(guardPlan(run, none, '2026-09-21', 1, 2).bridge).toEqual(['2026-09-20']);
  });

  it('spends two on two missed days when two are held', () => {
    expect(guardPlan(run, none, '2026-09-22', 2, 2).bridge).toEqual(['2026-09-20', '2026-09-21']);
  });

  it('spends nothing when the gap is wider than what is held, and keeps them', () => {
    // Half a bridge keeps nothing and would waste what the player holds.
    expect(guardPlan(run, none, '2026-09-22', 1, 2).bridge).toEqual([]);
    expect(guardPlan(run, none, '2026-09-25', 2, 2).bridge).toEqual([]);
  });

  it('never bridges a one-day run', () => {
    expect(guardPlan(set('2026-09-19'), none, '2026-09-21', 2, 2).bridge).toEqual([]);
  });

  it('has nothing to do when yesterday is kept, or there is no history', () => {
    expect(guardPlan(run, none, '2026-09-20', 2, 2).bridge).toEqual([]);
    expect(guardPlan(none, none, '2026-09-20', 2, 2).bridge).toEqual([]);
  });

  it('is idempotent: once bridged there is nothing left to plan', () => {
    const first = guardPlan(run, none, '2026-09-21', 1, 2).bridge;
    expect(guardPlan(run, new Set(first), '2026-09-21', 0, 2).bridge).toEqual([]);
    expect(guardPlan(run, new Set(first), '2026-09-21', 5, 2).bridge).toEqual([]);
  });

  it('still bridges when today is already folded', () => {
    expect(guardPlan(set('2026-09-18', '2026-09-19', '2026-09-21'), none, '2026-09-21', 1, 2).bridge).toEqual([
      '2026-09-20',
    ]);
  });

  it('ignores days after today, so a clock set back cannot be bridged to', () => {
    // A Daily "played" on the 25th by a phone whose clock was ahead.
    const withFuture = set('2026-09-18', '2026-09-19', '2026-09-25');
    expect(guardPlan(withFuture, none, '2026-09-21', 1, 2).bridge).toEqual(['2026-09-20']);
    expect(guardPlan(set('2026-09-25'), none, '2026-09-21', 2, 2).bridge).toEqual([]);
  });

  it('bridges across the DST change on 2026-10-25 in Belgrade', () => {
    // The clocks go back at 03:00 that Sunday; the day is still one day.
    expect(todayISO(new Date(2026, 9, 25, 2, 30))).toBe('2026-10-25');
    expect(todayISO(new Date(2026, 9, 25, 23, 59))).toBe('2026-10-25');
    const today = todayISO(new Date(2026, 9, 26, 0, 30));
    expect(today).toBe('2026-10-26');
    expect(guardPlan(set('2026-10-23', '2026-10-24'), none, today, 1, 2).bridge).toEqual(['2026-10-25']);
    expect(streakFrom(set('2026-10-24', '2026-10-25', '2026-10-26'), none, '2026-10-26')).toBe(3);
  });
});

describe('the repair window', () => {
  const run = set('2026-09-18', '2026-09-19');

  it('is exactly one missed day after a run worth keeping', () => {
    expect(repairable(run, none, '2026-09-21', '', 0, repairCfg)).toBe('2026-09-20');
    // Two missed days: nothing.
    expect(repairable(run, none, '2026-09-22', '', 0, repairCfg)).toBeNull();
    // Nothing missed: nothing.
    expect(repairable(run, none, '2026-09-20', '', 0, repairCfg)).toBeNull();
    // A one-day run is not worth an ad.
    expect(repairable(set('2026-09-19'), none, '2026-09-21', '', 0, repairCfg)).toBeNull();
  });

  it('still opens when today is already folded, and then counts today on top', () => {
    const withToday = set('2026-09-18', '2026-09-19', '2026-09-21');
    const day = repairable(withToday, none, '2026-09-21', '', 0, repairCfg);
    expect(day).toBe('2026-09-20');
    expect(streakFrom(withToday, set(day as string), '2026-09-21')).toBe(3);
  });

  it('respects the cooldown, to the day', () => {
    const today = '2026-09-21';
    expect(repairable(run, none, today, shiftISO(today, -13), 0, repairCfg)).toBeNull();
    expect(repairable(run, none, today, shiftISO(today, -14), 0, repairCfg)).toBe('2026-09-20');
    // A repair stamped in the future (a clock set back) holds the window shut.
    expect(repairable(run, none, today, '2026-12-01', 0, repairCfg)).toBeNull();
  });

  it('is refused when a bookmark already covered the day', () => {
    expect(repairable(run, set('2026-09-20'), '2026-09-21', '', 0, repairCfg)).toBeNull();
  });

  it('is not offered for what a held bookmark is about to cover for free', () => {
    expect(repairable(run, none, '2026-09-21', '', 1, repairCfg)).toBeNull();
  });

  it('honours a wider window when the config names one, covering every missed day', () => {
    const wide = { ...repairCfg, maxGapDays: 2 };
    expect(repairDays(run, none, '2026-09-22', '', 0, repairCfg)).toEqual([]);
    expect(repairDays(run, none, '2026-09-22', '', 0, wide)).toEqual(['2026-09-20', '2026-09-21']);
    expect(repairable(run, none, '2026-09-22', '', 0, wide)).toBe('2026-09-20');
    expect(repairDays(run, none, '2026-09-23', '', 0, wide)).toEqual([]);
    expect(repairDays(run, none, '2026-09-21', '', 0, { ...repairCfg, maxGapDays: 0 })).toEqual([]);
  });
});

describe('what a joined run has already reached', () => {
  it('is the run that ended the day before', () => {
    const run = set('2026-09-18', '2026-09-19');
    expect(runBefore(run, none, '2026-09-20')).toBe(2);
    expect(runBefore(run, none, '2026-09-21')).toBe(0);
    expect(runBefore(run, set('2026-09-20'), '2026-09-21')).toBe(2);
  });
});

describe('milestones', () => {
  it('pays nothing on ordinary days', () => {
    for (const d of [0, 1, 2, 4, 5, 6, 8, 13, 15, 29, 31, 48, 99, 101, 125, -3, 2.5]) {
      expect(milestoneFor(d, 0, cfg), `day ${d}`).toBeNull();
    }
  });

  it('follows the table', () => {
    const at = (d: number) => {
      const m = milestoneFor(d, 0, cfg);
      return m && [m.reveals, m.bookmarks];
    };
    expect(at(3)).toEqual([0, 1]);
    expect(at(7)).toEqual([2, 1]);
    expect(at(14)).toEqual([3, 1]);
    expect(at(21)).toEqual([0, 1]);
    expect(at(28)).toEqual([0, 1]);
    expect(at(30)).toEqual([5, 0]);
    expect(at(35)).toEqual([0, 1]);
    expect(at(50)).toEqual([5, 0]);
    expect(at(100)).toEqual([10, 0]);
    expect(at(150)).toEqual([5, 0]);
    expect(at(200)).toEqual([5, 0]);
    // 350 is a fiftieth past 100 AND a seventh.
    expect(at(350)).toEqual([5, 1]);
  });

  it('says it the way the win card does', () => {
    const line = (d: number, held = 0) => {
      const m = milestoneFor(d, held, cfg);
      return m && `${m.title} · ${m.body}`;
    };
    expect(line(3)).toBe('Bookmark earned · it keeps your streak if you miss a day');
    expect(line(7)).toBe('A week of folds · +2 reveals and a bookmark');
    expect(line(14)).toBe('Two weeks folded · +3 reveals and a bookmark');
    expect(line(30)).toBe('A month of folds · +5 reveals');
    expect(line(50)).toBe('50 days · +5 reveals');
    expect(line(100)).toBe('100 days · +10 reveals');
    expect(line(21)).toBe('21 days · +1 bookmark');
  });

  it('pays a reveal instead of a bookmark over the cap', () => {
    const m7 = milestoneFor(7, cfg.bookmarkMax, cfg);
    expect(m7).toMatchObject({ reveals: 2 + cfg.overflowReveals, bookmarks: 0 });
    expect(m7?.body).toBe('+2 reveals · bookmarks full, +1 reveal instead');

    const m3 = milestoneFor(3, cfg.bookmarkMax, cfg);
    expect(m3).toMatchObject({ reveals: 1, bookmarks: 0 });
    expect(m3?.body).toBe('bookmarks full, +1 reveal instead');

    // One below the cap still takes the bookmark.
    expect(milestoneFor(21, cfg.bookmarkMax - 1, cfg)).toMatchObject({ reveals: 0, bookmarks: 1 });
  });

  it('pays every day a jump reaches, once, and none it had already reached', () => {
    expect(milestonesBetween(6, 7, 0, cfg).map((m) => m.day)).toEqual([7]);
    expect(milestonesBetween(7, 7, 0, cfg)).toEqual([]);
    expect(milestonesBetween(8, 7, 0, cfg)).toEqual([]);
    expect(milestonesBetween(4, 6, 0, cfg)).toEqual([]);
  });

  it('counts each bookmark toward the cap for the next day in the range', () => {
    // One held: day 3 takes the second, so days 7 and 14 overflow to a reveal.
    const got = milestonesBetween(0, 14, cfg.bookmarkMax - 1, cfg).map((m) => [m.day, m.reveals, m.bookmarks]);
    expect(got).toEqual([
      [3, 0, 1],
      [7, 2 + cfg.overflowReveals, 0],
      [14, 3 + cfg.overflowReveals, 0],
    ]);
  });

  it('names the next one for the Streak sheet', () => {
    expect(nextMilestone(12, 0, cfg).day).toBe(14);
    expect(nextMilestone(0, 0, cfg).day).toBe(3);
    expect(nextMilestone(30, 0, cfg).day).toBe(35);
  });
});

describe('the week strip', () => {
  it('reads the last seven days, oldest first', () => {
    const done = set('2026-09-16', '2026-09-17', '2026-09-19', '2026-09-20');
    const marked = set('2026-09-18');
    expect(weekStrip(done, marked, '2026-09-22')).toEqual([
      'done', // 16
      'done', // 17
      'marked', // 18
      'done', // 19
      'done', // 20
      'missed', // 21
      'today-open', // 22
    ]);
    expect(weekStrip(set('2026-09-22'), none, '2026-09-22')[6]).toBe('today-done');
  });

  it('holds seven distinct days across the DST change', () => {
    const strip = weekStrip(set('2026-10-25'), none, '2026-10-28');
    expect(strip).toHaveLength(7);
    expect(strip.indexOf('done')).toBe(3);
  });
});
