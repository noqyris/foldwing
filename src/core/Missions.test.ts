/**
 * Missions pay reveals, so the two ways they can go wrong both cost something:
 * a mission that pays twice is a faucet, and a mission the player cannot do is
 * a broken promise on the menu every day. Both are pinned here.
 */

import { describe, expect, it } from 'vitest';
import { shiftISO } from './CalendarDay';
import {
  advanceMissions,
  allMissionsDone,
  MISSION_SLOTS,
  MISSION_TARGET,
  missionCopy,
  missionsFor,
  type MissionId,
  type MissionState,
  type WinEvent,
} from './Missions';

const mid = { unclearedCount: 200, clearedCount: 100 };
const year = Array.from({ length: 365 }, (_, i) => shiftISO('2026-09-22', i));

const win = (o: Partial<WinEvent> = {}): WinEvent => ({
  daily: false,
  todayDailyFirst: false,
  firstClear: false,
  medal: false,
  deaths: 2,
  beatBest: false,
  skipped: false,
  ...o,
});

/** A record with chosen ids, for exercising one mission at a time. */
const state = (ids: [MissionId, MissionId, MissionId]): MissionState => ({
  date: '2026-09-22',
  ids,
  progress: [0, 0, 0],
  paid: [false, false, false],
});

describe("today's three", () => {
  it('are the same every time for the same date', () => {
    for (const d of year.slice(0, 30)) expect(missionsFor(d, mid)).toEqual(missionsFor(d, mid));
  });

  it('always lead with the Daily and fill each slot from its own pool', () => {
    for (const d of year) {
      const s = missionsFor(d, mid);
      expect(s.ids[0]).toBe('daily');
      s.ids.forEach((id, i) => expect(MISSION_SLOTS[i]).toContain(id));
      expect(s.progress).toEqual([0, 0, 0]);
      expect(s.paid).toEqual([false, false, false]);
    }
  });

  it('reach every mission in the pool over a year', () => {
    const seen = new Set(year.flatMap((d) => missionsFor(d, mid).ids));
    expect([...seen].sort()).toEqual(['best', 'clean', 'daily', 'medal', 'new2', 'wins3']);
  });

  it('never ask for two new folds near the end of the campaign', () => {
    for (const d of year) expect(missionsFor(d, { unclearedCount: 1, clearedCount: 299 }).ids[1]).toBe('wins3');
  });

  it('never ask to beat a best time with fewer than three to beat', () => {
    for (const d of year) expect(missionsFor(d, { unclearedCount: 298, clearedCount: 2 }).ids[2]).not.toBe('best');
  });

  it('start fresh on a new date', () => {
    const today = advanceMissions(state(['daily', 'wins3', 'clean']), win({ deaths: 0 })).state;
    expect(today.progress).toEqual([0, 1, 1]);
    expect(missionsFor('2026-09-23', mid).progress).toEqual([0, 0, 0]);
  });
});

describe('a win', () => {
  it('moves the Daily slot only on the first finish of today', () => {
    const s = state(['daily', 'wins3', 'clean']);
    expect(advanceMissions(s, win({ daily: true, todayDailyFirst: true, deaths: 0 })).completed).toEqual([0]);
    // A rerun of a Daily already folded, or an older date: nothing.
    expect(advanceMissions(s, win({ daily: true, todayDailyFirst: false, deaths: 0 })).completed).toEqual([]);
  });

  it('never moves the pool slots when it is a Daily', () => {
    const s = state(['daily', 'wins3', 'medal']);
    const { state: next } = advanceMissions(
      s,
      win({ daily: true, todayDailyFirst: true, firstClear: true, medal: true, deaths: 0, beatBest: true })
    );
    expect(next.progress).toEqual([1, 0, 0]);
  });

  it('counts a replay toward wins and medals, but not toward new folds', () => {
    const replay = win({ firstClear: false, medal: true });
    expect(advanceMissions(state(['daily', 'wins3', 'medal']), replay).state.progress).toEqual([0, 1, 1]);
    expect(advanceMissions(state(['daily', 'new2', 'medal']), replay).state.progress).toEqual([0, 0, 1]);
  });

  it('counts a clean run, and a best time beaten', () => {
    expect(advanceMissions(state(['daily', 'wins3', 'clean']), win({ deaths: 1 })).state.progress[2]).toBe(0);
    expect(advanceMissions(state(['daily', 'wins3', 'clean']), win({ deaths: 0 })).state.progress[2]).toBe(1);
    expect(advanceMissions(state(['daily', 'wins3', 'best']), win({ beatBest: true })).state.progress[2]).toBe(1);
  });

  it('pays each mission exactly once', () => {
    let s = state(['daily', 'wins3', 'clean']);
    const completedAt: number[][] = [];
    for (let i = 0; i < 5; i++) {
      const r = advanceMissions(s, win({ deaths: 0 }));
      completedAt.push(r.completed);
      s = r.state;
    }
    expect(completedAt).toEqual([[2], [], [1], [], []]);
    expect(s.progress).toEqual([0, 3, 1]);
    expect(s.paid).toEqual([false, true, true]);
  });

  it('moves nothing for a skip', () => {
    const s = state(['daily', 'wins3', 'clean']);
    expect(advanceMissions(s, { ...win({ deaths: 0 }), skipped: true as false })).toEqual({ state: s, completed: [] });
  });

  it('knows when all three are done', () => {
    let s = state(['daily', 'new2', 'medal']);
    expect(allMissionsDone(s)).toBe(false);
    s = advanceMissions(s, win({ daily: true, todayDailyFirst: true })).state;
    s = advanceMissions(s, win({ firstClear: true, medal: true })).state;
    s = advanceMissions(s, win({ firstClear: true })).state;
    expect(allMissionsDone(s)).toBe(true);
  });
});

describe('copy', () => {
  it('has a full line and a strip label for every mission, with a target', () => {
    for (const id of Object.keys(MISSION_TARGET) as MissionId[]) {
      const c = missionCopy(id);
      expect(c.full.length).toBeGreaterThan(c.short.length);
      expect(c.short.length).toBeLessThanOrEqual(10);
      expect(MISSION_TARGET[id]).toBeGreaterThanOrEqual(1);
    }
    expect(missionCopy('daily').full).toBe("Fold today's Daily");
    expect(missionCopy('wins3')).toEqual({ full: 'Clear 3 folds', short: '3 folds' });
  });

  it('asks for two stars where it used to ask for a medal: the same line, ≤ 1.25× par', () => {
    // The id stays 'medal': saved mission records name it.
    expect(missionCopy('medal')).toEqual({ full: 'Earn two stars on any fold', short: 'Two stars' });
    expect(MISSION_SLOTS[2]).toContain('medal');
  });
});

describe('Clear 3 folds is three folds', () => {
  it('does not count the same fold won again (Retry)', () => {
    const e = { daily: false, todayDailyFirst: false, firstClear: false, medal: false, deaths: 0, beatBest: false, skipped: false } as const;
    let s: MissionState = { date: '2026-09-27', ids: ['daily', 'wins3', 'clean'], progress: [0, 0, 0], paid: [false, false, false] };
    s = advanceMissions(s, e).state;
    s = advanceMissions(s, { ...e, repeat: true }).state;
    s = advanceMissions(s, { ...e, repeat: true }).state;
    expect(s.progress[1]).toBe(1);
    s = advanceMissions(s, e).state;
    expect(s.progress[1]).toBe(2);
  });
});
