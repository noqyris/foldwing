import { describe, expect, it } from 'vitest';
import { dailyLevel, dailySeed, dailyT, todayISO } from './Daily';
import { Playfield } from '../core/Playfield';
import { PLAYABLE_CLEARANCE, validateLevel } from '../core/LevelValidator';
import { BASE_HEIGHT, BASE_WIDTH, METRICS } from '../render/Theme';
import { Progress } from './Progress';

const pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset);
const OPTS = { cell: 6, hitRadius: METRICS.hitRadius, goalRadius: METRICS.goalRadius };

describe('the daily fold', () => {
  /*
   * Determinism IS the feature: there is no server, so "everyone plays the
   * same maze today" holds only if the same date computes the same level on
   * every device, every time.
   */
  it('computes the identical level for the same date', () => {
    const a = dailyLevel('2026-08-07');
    const b = dailyLevel('2026-08-07');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.id).toBe('d2026-08-07');
    expect(a.name).toBe('Daily fold');
  });

  it('computes different mazes on different days', () => {
    const a = dailyLevel('2026-08-07');
    const b = dailyLevel('2026-08-08');
    expect(JSON.stringify(a.walls)).not.toBe(JSON.stringify(b.walls));
  });

  it('is proved playable with room for a hand, like every shipped level', () => {
    for (const date of ['2026-08-07', '2026-08-08', '2026-12-25']) {
      const level = dailyLevel(date);
      const r = validateLevel(level, pf, {
        ...OPTS,
        hitRadius: METRICS.hitRadius + PLAYABLE_CLEARANCE,
      });
      expect(r.solvable, `${date} shipped an unplayable daily`).toBe(true);
    }
  });

  it('carries a par for the win verdict', () => {
    const level = dailyLevel('2026-08-07');
    expect(level.parPx).toBeGreaterThan(0);
  });

  it('keeps the difficulty dial mid-to-hard', () => {
    for (const date of ['2026-01-01', '2026-06-15', '2027-03-09']) {
      const t = dailyT(date);
      expect(t).toBeGreaterThanOrEqual(0.5);
      expect(t).toBeLessThanOrEqual(0.8);
    }
  });

  it('derives the seed from the date alone', () => {
    expect(dailySeed('2026-08-07')).toBe(20260807);
  });

  it('formats today as a local ISO date', () => {
    expect(todayISO(new Date(2026, 7, 7, 23, 59))).toBe('2026-08-07');
    expect(todayISO(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });
});

describe('the daily streak', () => {
  const seed = (dates: string[]): void => {
    Progress.update({
      daily: Object.fromEntries(
        dates.map((d) => [d, { ms: 1000, deaths: 0, foldSense: 50 }])
      ),
    });
  };

  it('counts consecutive finished days ending today', () => {
    seed(['2026-08-05', '2026-08-06', '2026-08-07']);
    expect(Progress.dailyStreak('2026-08-07')).toBe(3);
  });

  it('does not break the run before today is over', () => {
    // Today unfinished: the streak the player is protecting is still alive.
    seed(['2026-08-05', '2026-08-06']);
    expect(Progress.dailyStreak('2026-08-07')).toBe(2);
  });

  it('a gap ends the streak', () => {
    seed(['2026-08-03', '2026-08-05', '2026-08-06', '2026-08-07']);
    expect(Progress.dailyStreak('2026-08-07')).toBe(3);
  });

  it('no dailies, no streak', () => {
    seed([]);
    expect(Progress.dailyStreak('2026-08-07')).toBe(0);
  });

  it('spans a month boundary', () => {
    seed(['2026-07-30', '2026-07-31', '2026-08-01']);
    expect(Progress.dailyStreak('2026-08-01')).toBe(3);
  });
});
