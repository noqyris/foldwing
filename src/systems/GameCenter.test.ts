/*
 * The achievement conditions are the only part of Game Center that can be
 * wrong quietly. GameKit accepts an unknown identifier and drops it, and a
 * predicate that never fires looks exactly like a player who has not got there
 * yet — so both are pinned here, where neither needs a device.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { ACHIEVEMENTS, toCentiseconds } from './GameCenter';

const ids = ACHIEVEMENTS.map((a) => a.id);
const by = (id: string) => {
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  if (!a) throw new Error(`no achievement ${id}`);
  return a;
};
const save = (o: Partial<{ cleared: string[]; medals: string[]; daily: Record<string, unknown> }>) => ({
  cleared: o.cleared ?? [],
  medals: o.medals ?? [],
  daily: o.daily ?? {},
});
const levels = (n: number) => Array.from({ length: n }, (_, i) => `l${i + 1}`);

afterEach(() => vi.useRealTimers());

describe('the achievement ids', () => {
  /*
   * These strings are the contract with App Store Connect. A typo here is
   * silent in both directions: GameKit drops an unknown id without an error,
   * and the console shows an achievement nobody can earn.
   */
  it('are exactly the eight configured in App Store Connect', () => {
    expect([...ids].sort()).toEqual([
      'foldwing.first',
      'foldwing.flawless',
      'foldwing.fifty',
      'foldwing.hundred',
      'foldwing.medal.fifty',
      'foldwing.medal.ten',
      'foldwing.streak.week',
      'foldwing.ten',
    ].sort());
  });

  it('are unique', () => {
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('what earns them', () => {
  it('counts cleared levels at each threshold, and not one short', () => {
    for (const [id, n] of [
      ['foldwing.first', 1],
      ['foldwing.ten', 10],
      ['foldwing.fifty', 50],
      ['foldwing.hundred', 100],
    ] as const) {
      expect(by(id).earned(save({ cleared: levels(n - 1) })), `${id} at ${n - 1}`).toBe(false);
      expect(by(id).earned(save({ cleared: levels(n) })), `${id} at ${n}`).toBe(true);
    }
  });

  it('counts medals separately from clears', () => {
    // A hundred levels beaten the slow way earns no medal achievement.
    expect(by('foldwing.medal.ten').earned(save({ cleared: levels(100) }))).toBe(false);
    expect(by('foldwing.medal.ten').earned(save({ medals: levels(10) }))).toBe(true);
    expect(by('foldwing.medal.fifty').earned(save({ medals: levels(49) }))).toBe(false);
    expect(by('foldwing.medal.fifty').earned(save({ medals: levels(50) }))).toBe(true);
  });

  /*
   * Flawless is the one that cannot be recomputed later: the save records that
   * a level was cleared, never how cleanly. Without a run it must stay false
   * rather than quietly awarding itself on the next win.
   */
  it('awards flawless only for the run just finished, and only with no deaths', () => {
    const a = by('foldwing.flawless');
    expect(a.earned(save({}), { deaths: 0 })).toBe(true);
    expect(a.earned(save({}), { deaths: 1 })).toBe(false);
    expect(a.earned(save({}))).toBe(false);
  });

  it('wants seven CONSECUTIVE days of the Daily Fold', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-17T12:00:00Z'));
    const a = by('foldwing.streak.week');

    const week = (days: string[]) => save({ daily: Object.fromEntries(days.map((d) => [d, {}])) });
    const run = [
      '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14',
      '2026-08-15', '2026-08-16', '2026-08-17',
    ];
    expect(a.earned(week(run))).toBe(true);

    // Same seven entries, one of them a gap filled from further back.
    const gapped = ['2026-08-10', ...run.slice(0, 3), ...run.slice(4)];
    expect(a.earned(week(gapped))).toBe(false);

    // Six in a row is six in a row.
    expect(a.earned(week(run.slice(1)))).toBe(false);
  });
});

/*
 * The board is configured ELAPSED_TIME_CENTISECOND because App Store Connect
 * offers no finer time unit. If this conversion and that setting ever disagree,
 * every time renders ten times too large and nothing in the app would show it.
 */
describe('the score sent to the board', () => {
  it('is hundredths of a second', () => {
    expect(toCentiseconds(1000)).toBe(100);
    expect(toCentiseconds(8240)).toBe(824);
  });

  it('rounds rather than truncating', () => {
    expect(toCentiseconds(1005)).toBe(101);
    expect(toCentiseconds(1004)).toBe(100);
  });

  /* Game Center treats 0 as no score at all, so a very fast run must survive. */
  it('never sends a zero', () => {
    expect(toCentiseconds(1)).toBe(1);
    expect(toCentiseconds(0)).toBe(1);
  });
});
