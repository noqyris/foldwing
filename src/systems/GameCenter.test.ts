/*
 * The achievement conditions are the only part of Game Center that can be
 * wrong quietly. GameKit accepts an unknown identifier and drops it, and a
 * predicate that never fires looks exactly like a player who has not got there
 * yet — so both are pinned here, where neither needs a device.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';

/*
 * The native plugin, for the sign-in tests at the bottom. Everything above them
 * is pure and never reaches it.
 */
const gc = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
  registerPlugin: () => gc,
}));

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

/*
 * Run a block with the process pinned to a named time zone, then put the real
 * one back — the same helper as CalendarDay.test.ts. The restore matters: a
 * worker is reused across test files, so a leaked TZ re-times every later suite.
 */
function inZone<T>(tz: string, body: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    return body();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

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

  /*
   * The ledger is keyed by LOCAL date and the week used to be counted in UTC.
   * From 17:00 in California it asked for a Daily dated tomorrow, which cannot
   * exist yet; east of Greenwich it dropped today's for the first hours after
   * midnight. Only checked on a win, and the reminder fires at 19:00 local, so
   * a player who folds when reminded never earned it. Pinned in named zones,
   * because at offset zero the two readings are the same sentence.
   */
  const days7 = (endISO: string) => {
    const end = Date.parse(`${endISO}T00:00:00Z`);
    return save({
      daily: Object.fromEntries(
        Array.from({ length: 7 }, (_, i) => [
          new Date(end - i * 86_400_000).toISOString().slice(0, 10),
          {},
        ])
      ),
    });
  };

  it('counts the local week in the evening west of Greenwich', () => {
    inZone('America/Los_Angeles', () => {
      vi.useFakeTimers();
      // 19:05 on the 22nd in Los Angeles is already 02:05 on the 23rd in UTC.
      vi.setSystemTime(new Date('2026-09-22T19:05:00-07:00'));
      const a = by('foldwing.streak.week');
      expect(a.earned(days7('2026-09-22'))).toBe(true);
      // And not the UTC week, which ends on a day that has not begun here.
      expect(a.earned(days7('2026-09-23'))).toBe(false);
    });
  });

  it('counts the local week just after midnight east of Greenwich', () => {
    inZone('Europe/Belgrade', () => {
      vi.useFakeTimers();
      // 00:30 on the 28th in Belgrade is still 22:30 on the 27th in UTC.
      vi.setSystemTime(new Date('2026-09-28T00:30:00+02:00'));
      const a = by('foldwing.streak.week');
      expect(a.earned(days7('2026-09-28'))).toBe(true);
    });
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

/*
 * One sign-in attempt per session — but only an attempt the player actually
 * SAW counts. GameKit's sheet is presented from the view controller the ad
 * consent alert also uses, and UIKit refuses to present over a controller that
 * is already presenting. The plugin now says so instead of failing silently,
 * and a sheet nobody saw must not use up the session's one attempt.
 */
describe('signing in', () => {
  async function freshGameCenter(): Promise<typeof import('./GameCenter').GameCenter> {
    gc.authenticate.mockReset();
    vi.resetModules();
    return (await import('./GameCenter')).GameCenter;
  }

  it('tries again later when the sheet could not be put on screen', async () => {
    const GameCenter = await freshGameCenter();
    gc.authenticate
      .mockResolvedValueOnce({ ok: false, reason: 'presenter-busy' })
      .mockResolvedValueOnce({ ok: true });
    expect(await GameCenter.signIn()).toBe(false);
    expect(await GameCenter.signIn()).toBe(true);
    expect(GameCenter.signedIn).toBe(true);
    expect(gc.authenticate).toHaveBeenCalledTimes(2);
  });

  it('tries again later when there was no view controller to present from', async () => {
    const GameCenter = await freshGameCenter();
    gc.authenticate
      .mockResolvedValueOnce({ ok: false, reason: 'no-view-controller' })
      .mockResolvedValueOnce({ ok: true });
    await GameCenter.signIn();
    expect(await GameCenter.signIn()).toBe(true);
  });

  it('does not ask again this session once the player has seen the sheet and said no', async () => {
    const GameCenter = await freshGameCenter();
    gc.authenticate.mockResolvedValue({ ok: false });
    expect(await GameCenter.signIn()).toBe(false);
    expect(await GameCenter.signIn()).toBe(false);
    expect(gc.authenticate).toHaveBeenCalledTimes(1);
  });

  it('does not ask again after a sign-in that worked', async () => {
    const GameCenter = await freshGameCenter();
    gc.authenticate.mockResolvedValue({ ok: true });
    await GameCenter.signIn();
    await GameCenter.signIn();
    expect(gc.authenticate).toHaveBeenCalledTimes(1);
  });
});
