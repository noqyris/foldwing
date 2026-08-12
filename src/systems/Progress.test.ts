/**
 * Progress is the only module in the game that owns something the player cannot
 * get back: the purchase, the gallery, the reveal stash, the streak, and every
 * level they have cleared. Nine other modules read it, none of them defensively.
 *
 * So the two guarantees in its header are tested here as guarantees, not as
 * implementation details:
 *
 *  - Reads never throw, whatever is on disk. The concrete failure this protects
 *    against is a bad `unlockedIndex` reaching LEVELS[i].name in MenuScene and
 *    throwing inside create(), which leaves NO scene running: a blank canvas
 *    with nothing to press, and a save that is never rewritten, so every
 *    relaunch dies identically. One bad integer bricks the install permanently.
 *  - The v1 → v2 migration holds. Level ids l6…l100 named bar levels in v1 and
 *    name mazes in v2, so carrying them over credits an upgrading player with
 *    95 mazes they have never seen.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { monetization } from '../config/monetization';
import { shiftISO, todayISO } from '../core/CalendarDay';
import { Progress, type DailyResult, type SaveData, type SavedFigure } from './Progress';

/**
 * The in-memory stand-in for UserDefaults / localStorage.
 *
 * Declared through vi.hoisted rather than as a plain const because vitest lifts
 * vi.mock above the import block: the factory runs while Progress is still
 * being imported, when an ordinary top-level const is still in its temporal
 * dead zone.
 *
 * It is a real Map and the mock is a real round trip — a stub that returned a
 * canned object would let a broken JSON.stringify or a wrong key pass.
 */
const { disk } = vi.hoisted(() => ({ disk: new Map<string, string>() }));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: ({ key }: { key: string }): Promise<{ value: string | null }> =>
      Promise.resolve({ value: disk.get(key) ?? null }),
    set: ({ key, value }: { key: string; value: string }): Promise<void> => {
      disk.set(key, value);
      return Promise.resolve();
    },
    remove: ({ key }: { key: string }): Promise<void> => {
      disk.delete(key);
      return Promise.resolve();
    },
    clear: (): Promise<void> => {
      disk.clear();
      return Promise.resolve();
    },
  },
}));

/**
 * The key Progress writes under, spelled out again on purpose.
 *
 * It is private to the module, and a test that imported it could not notice the
 * module renaming it — which would silently orphan every save already installed
 * on a device rather than fail anything.
 */
const KEY = 'foldwing.save.v1';

/** Leave a save on disk exactly as some build would have written it, then read it. */
async function readStored(raw: unknown): Promise<Readonly<SaveData>> {
  disk.set(KEY, JSON.stringify(raw));
  return Progress.load();
}

/** Leave arbitrary bytes on disk — what devtools or a truncated write leaves. */
async function readRaw(text: string): Promise<Readonly<SaveData>> {
  disk.set(KEY, text);
  return Progress.load();
}

/** A figure that passes the drawability filter, distinguishable by number. */
function figure(n: number): SavedFigure {
  return {
    levelId: `l${n}`,
    levelName: `Level ${n}`,
    points: [
      { x: 0.1, y: 0.2 },
      { x: 0.3, y: 0.4 },
    ],
    times: [0, 40],
    ms: 1000 + n,
    at: 1_700_000_000_000 + n,
  };
}

const played = (ms: number): DailyResult => ({ ms, deaths: 1, foldSense: 50 });

/** Fill the ledger directly; update() does not coerce, so this seeds verbatim. */
function seedDaily(dates: readonly string[]): void {
  Progress.update({
    daily: Object.fromEntries(dates.map((d) => [d, played(1000)])),
  });
}

beforeEach(async () => {
  disk.clear();
  // reset() rebuilds a fresh save without running the daily top-up, so every
  // test starts from the documented defaults rather than from defaults plus one
  // free reveal.
  await Progress.reset();
});

describe('reading a hostile save', () => {
  /*
   * `typeof x === 'number'` accepts NaN, Infinity, -5 and 1.5, and every one of
   * those reaches the level table as an array index. These four cases are the
   * bricked-app bug, one shape at a time.
   */
  it('clamps a negative unlocked index back to the first level', async () => {
    const s = await readStored({ version: 2, unlockedIndex: -5 });
    expect(s.unlockedIndex).toBe(0);
    expect(Progress.isUnlocked(0)).toBe(true);
    expect(Progress.isUnlocked(1)).toBe(false);
  });

  it('truncates a fractional unlocked index to a whole one', async () => {
    const s = await readStored({ version: 2, unlockedIndex: 3.7 });
    expect(s.unlockedIndex).toBe(3);
    expect(Number.isInteger(s.unlockedIndex)).toBe(true);
  });

  it('discards a NaN unlocked index', async () => {
    /*
     * JSON has no NaN: a build that computed one and saved it wrote the literal
     * `null`, which is the shape that actually reaches coerce. Both are checked
     * here — the raw NaN because coerce takes `unknown` and is also called on
     * in-memory objects, the null because that is what a device really holds.
     */
    disk.set(KEY, '{"version":2,"unlockedIndex":null}');
    expect((await Progress.load()).unlockedIndex).toBe(0);

    expect(JSON.stringify({ v: Number.NaN })).toBe('{"v":null}');
    const s = await readStored({ version: 2, unlockedIndex: Number.NaN });
    expect(s.unlockedIndex).toBe(0);
  });

  it('discards an infinite unlocked index', async () => {
    // 1e999 is how Infinity survives a JSON round trip, so this is the literal
    // an overflowing save leaves on disk.
    disk.set(KEY, '{"version":2,"unlockedIndex":1e999}');
    const s = await Progress.load();
    expect(Number.isFinite(s.unlockedIndex)).toBe(true);
    expect(s.unlockedIndex).toBe(0);
  });

  it('ignores a best-time table that is not a table', async () => {
    // Version 2, or the migration would empty bestMs anyway and the test would
    // prove nothing about the type check.
    const s = await readStored({ version: 2, bestMs: 'fast' });
    expect(s.bestMs).toEqual({});
  });

  it('clamps a negative reveal balance to nothing owed', async () => {
    const s = await readStored({
      version: 2,
      reveals: -40,
      // Pinned to today so load()'s own top-up does not move the number under
      // the assertion.
      lastTopUp: todayISO(),
    });
    expect(s.reveals).toBe(0);
    expect(Progress.spendReveal()).toBe(false);
  });

  it('drops a figure with no drawable points and keeps the rest', async () => {
    const s = await readStored({
      version: 2,
      figures: [
        figure(1),
        { levelId: 'l2', levelName: 'Two', points: null, times: [], ms: 1, at: 2 },
        { levelId: 'l3', levelName: 'Three', points: [], times: [], ms: 1, at: 3 },
        { levelId: 'l4', levelName: 'Four', points: [{ x: null, y: 0.2 }], times: [0], ms: 1, at: 4 },
        figure(5),
      ],
    });
    expect(s.figures.map((f) => f.levelId)).toEqual(['l1', 'l5']);
  });

  it('ignores a daily entry filed under something that is not a date', async () => {
    const s = await readStored({
      version: 2,
      daily: { garbage: played(1000), '2026-08-07': played(4200) },
    });
    expect(Object.keys(s.daily)).toEqual(['2026-08-07']);
    expect(Progress.hasDaily('garbage')).toBe(false);
  });

  it('ignores a daily entry with no time on it', async () => {
    const s = await readStored({
      version: 2,
      daily: {
        '2026-08-06': { deaths: 3, foldSense: 20 },
        '2026-08-07': { ms: 'quick', deaths: 3, foldSense: 20 },
        '2026-08-08': played(4200),
      },
    });
    expect(Object.keys(s.daily)).toEqual(['2026-08-08']);
  });

  it('coerces the fields hanging off a daily entry rather than dropping it', async () => {
    const s = await readStored({
      version: 2,
      daily: { '2026-08-07': { ms: 4200, deaths: 'lots', foldSense: 4000 } },
    });
    expect(s.daily['2026-08-07']).toEqual({ ms: 4200, deaths: 0, foldSense: 100 });
  });

  it('reads corrupt bytes as a fresh save instead of refusing to launch', async () => {
    const s = await readRaw('{"unlockedIndex":4,,,');
    expect(s.version).toBe(2);
    expect(s.unlockedIndex).toBe(0);
    expect(s.cleared).toEqual([]);
    expect(s.figures).toEqual([]);
  });

  it('reads a bare JSON null as a fresh save', async () => {
    const s = await readRaw('null');
    expect(s.unlockedIndex).toBe(0);
    expect(s.adsRemoved).toBe(false);
  });

  it('reads an absent save as a fresh one, with the settings defaulted on', async () => {
    disk.clear();
    const s = await Progress.load();
    expect(s.version).toBe(2);
    expect(s.unlockedIndex).toBe(0);
    expect(s.totalWins).toBe(0);
    // Missing means "written before settings existed", not "switched off".
    expect(s.sound).toBe(true);
    expect(s.haptics).toBe(true);
  });

  it('takes the settings defaults for a save written before settings existed', async () => {
    const s = await readStored({ version: 2, unlockedIndex: 9 });
    expect(s.sound).toBe(true);
    expect(s.haptics).toBe(true);
  });
});

describe('the v1 to v2 migration', () => {
  /** A save from the bar-obstacle build: no `version` field at all. */
  const v1 = (): Record<string, unknown> => ({
    unlockedIndex: 40,
    cleared: ['l1', 'l6', 'l40'],
    bestMs: { l1: 1200, l6: 8800, l40: 9000 },
    medals: ['l1', 'l6'],
    reveals: 7,
    lastTopUp: todayISO(),
    adsRemoved: true,
    totalWins: 33,
    figures: [figure(1), figure(2)],
    daily: { '2026-08-07': { ms: 4200, deaths: 2, foldSense: 61 } },
    foldSense: 61,
  });

  it('drops every field keyed by a level id', async () => {
    const s = await readStored(v1());
    expect(s.version).toBe(2);
    expect(s.cleared).toEqual([]);
    expect(s.bestMs).toEqual({});
    expect(s.medals).toEqual([]);
  });

  it('keeps the access the player already had', async () => {
    // Uncleared-but-unlocked is a state level select already renders, and taking
    // access back would be the one unkind way to handle the id reuse.
    const s = await readStored(v1());
    expect(s.unlockedIndex).toBe(40);
    expect(Progress.isUnlocked(40)).toBe(true);
  });

  it('keeps everything the player earned that is not tied to a level id', async () => {
    const s = await readStored(v1());
    expect(s.adsRemoved).toBe(true);
    expect(s.reveals).toBe(7);
    expect(s.totalWins).toBe(33);
    expect(s.foldSense).toBe(61);
    expect(s.figures.map((f) => f.levelId)).toEqual(['l1', 'l2']);
    expect(s.daily['2026-08-07']).toEqual({ ms: 4200, deaths: 2, foldSense: 61 });
  });

  it('lets the level-6 Reveal hint fire again for an upgrading player', async () => {
    // The hint fires only for a player who has not cleared l6, and it is the
    // only place in the entire game that explains what Reveal is for. Carrying
    // the old l6 over silences it for exactly the player who needs it.
    await readStored(v1());
    expect(Progress.hasCleared('l6')).toBe(false);
    expect(Progress.hasMedal('l6')).toBe(false);
  });

  it('leaves a save already on version 2 alone', async () => {
    const s = await readStored({ ...v1(), version: 2 });
    expect(s.cleared).toEqual(['l1', 'l6', 'l40']);
    expect(s.bestMs).toEqual({ l1: 1200, l6: 8800, l40: 9000 });
    expect(s.medals).toEqual(['l1', 'l6']);
    expect(Progress.hasCleared('l6')).toBe(true);
  });

  it('strips non-string ids out of a v2 cleared list', async () => {
    const s = await readStored({ version: 2, cleared: ['l1', 7, null, 'l2'] });
    expect(s.cleared).toEqual(['l1', 'l2']);
  });
});

describe('bounded storage', () => {
  /*
   * Preferences is UserDefaults, not a database: the whole blob is parsed at
   * every launch, so an unbounded array is a launch-time cost that only grows.
   */
  it('keeps the newest 120 figures and drops the oldest', () => {
    for (let i = 0; i < 130; i++) Progress.addFigure(figure(i));

    const kept = Progress.data.figures;
    expect(kept).toHaveLength(120);
    expect(kept[0].levelId).toBe('l10');
    expect(kept[119].levelId).toBe('l129');
  });

  it('hands the gallery its figures newest first', () => {
    Progress.addFigure(figure(1));
    Progress.addFigure(figure(2));
    expect(Progress.figures.map((f) => f.levelId)).toEqual(['l2', 'l1']);
  });

  /*
   * Adding the maze to every figure grew the save, so the coordinates it was
   * already storing were rounded to pay for it. Normalized points arrive as raw
   * doubles and JSON.stringify writes every digit — a single point cost about
   * forty characters — so this is where most of the file was going.
   */
  it('rounds stored geometry instead of writing seventeen digits of it', () => {
    Progress.addFigure({
      ...figure(1),
      points: [{ x: 1 / 3, y: 2 / 3 }],
      times: [16.666666],
      walls: [{ x: 1 / 3, y: 1 / 7, w: 1 / 9, h: 1 / 11 }],
      start: { x: 1 / 3, y: 1 / 3 },
    });

    const kept = Progress.data.figures[0];
    expect(kept.points[0]).toEqual({ x: 0.3333, y: 0.6667 });
    expect(kept.times[0]).toBe(17);
    expect(kept.walls?.[0]).toEqual({ x: 0.3333, y: 0.1429, w: 0.1111, h: 0.0909 });
    expect(kept.start).toEqual({ x: 0.3333, y: 0.3333 });

    // Four places is 0.07 base pixels across the playfield — a thirtieth of the
    // nib. What must not happen is the rounding being coarse enough to see.
    expect(Math.abs(kept.points[0].x - 1 / 3)).toBeLessThan(1e-4);
  });
});

describe('the maze kept with a figure', () => {
  const walls = [{ x: 0.1, y: 0.2, w: 0.3, h: 0.02 }];

  it('survives a save and reload, so a card can be redrawn from it', async () => {
    const s = await readStored({
      version: 2,
      figures: [{ ...figure(1), walls, start: { x: 0.4, y: 0.9 }, goal: { x: 0.4, y: 0.1 } }],
    });
    expect(s.figures[0].walls).toEqual(walls);
    expect(s.figures[0].start).toEqual({ x: 0.4, y: 0.9 });
    expect(s.figures[0].goal).toEqual({ x: 0.4, y: 0.1 });
  });

  /*
   * A figure with a broken maze is still a perfectly good figure, and it has a
   * render path that needs no maze at all — the one every figure earned before
   * this field existed already takes. Dropping the drawing over its background
   * would lose the part the player actually made.
   */
  it('drops a malformed maze without dropping the drawing', async () => {
    const s = await readStored({
      version: 2,
      figures: [
        { ...figure(1), walls: 'no' },
        { ...figure(2), walls: [{ x: 0.1, y: null, w: 0.3, h: 0.02 }] },
        { ...figure(3), walls: [], start: { x: 'left', y: 0.9 } },
        { ...figure(4), walls },
      ],
    });

    expect(s.figures.map((f) => f.levelId)).toEqual(['l1', 'l2', 'l3', 'l4']);
    expect(s.figures[0].walls).toBeUndefined();
    expect(s.figures[1].walls).toBeUndefined();
    expect(s.figures[2].walls).toBeUndefined();
    expect(s.figures[2].start).toBeUndefined();
    expect(s.figures[3].walls).toEqual(walls);
  });

  it('reads a figure saved before mazes were kept', async () => {
    const s = await readStored({ version: 2, figures: [figure(7)] });
    expect(s.figures[0].levelId).toBe('l7');
    expect(s.figures[0].walls).toBeUndefined();
  });

  it('keeps the newest 730 daily results and forgets the rest', async () => {
    const first = '2024-01-01';
    const daily: Record<string, DailyResult> = {};
    for (let i = 0; i < 800; i++) daily[shiftISO(first, i)] = played(1000 + i);

    const s = await readStored({ version: 2, daily });

    expect(Object.keys(s.daily)).toHaveLength(730);
    expect(Progress.hasDaily(shiftISO(first, 799))).toBe(true);
    expect(Progress.hasDaily(shiftISO(first, 70))).toBe(true);
    expect(Progress.hasDaily(shiftISO(first, 69))).toBe(false);
    expect(Progress.hasDaily(first)).toBe(false);
  });
});

/**
 * A moment whose local calendar date and UTC calendar date disagree, derived
 * from the runtime's own offset so the test does not assume a time zone. Null
 * on a machine actually running UTC, where no such moment exists.
 */
function crossesUtcMidnight(): { at: Date; local: string; utc: string } | null {
  const offset = new Date(2026, 4, 17, 12, 0).getTimezoneOffset();
  if (offset === 0) return null;
  // West of Greenwich late evening is already tomorrow in UTC; east of it,
  // just after midnight is still yesterday.
  const at = offset > 0 ? new Date(2026, 4, 17, 23, 30) : new Date(2026, 4, 17, 0, 30);
  const local = '2026-05-17';
  const utc = at.toISOString().slice(0, 10);
  return utc === local ? null : { at, local, utc };
}

const cross = crossesUtcMidnight();

describe('the free daily top-up', () => {
  const stash = monetization.reveals.startingStash;
  const grant = monetization.reveals.freeDailyTopUp;
  const morning = new Date(2026, 4, 17, 9, 0);

  it('grants one reveal the first time it runs on a day', () => {
    Progress.applyDailyTopUp(morning);
    expect(Progress.data.reveals).toBe(stash + grant);
    expect(Progress.data.lastTopUp).toBe('2026-05-17');
  });

  it('cannot be claimed twice in the same day', () => {
    Progress.applyDailyTopUp(morning);
    Progress.applyDailyTopUp(new Date(2026, 4, 17, 21, 45));
    Progress.applyDailyTopUp(morning);
    expect(Progress.data.reveals).toBe(stash + grant);
  });

  it('grants again once the day has rolled over', () => {
    Progress.applyDailyTopUp(morning);
    Progress.applyDailyTopUp(new Date(2026, 4, 18, 9, 0));
    expect(Progress.data.reveals).toBe(stash + grant * 2);
    expect(Progress.data.lastTopUp).toBe('2026-05-18');
  });

  /*
   * A `lastTopUp` in the FUTURE was a faucet.
   *
   * The check was "not equal to today", and a future date is never equal to
   * today — so it paid out on every single launch, forever. Getting one there
   * takes no cleverness: move the clock forward, open the app, move it back.
   * It also fires on the innocent version, a phone whose wrong clock was later
   * corrected.
   *
   * Reveals are the only currency in the game, so an unbounded supply of them
   * is the whole rewarded loop switched off.
   */
  it('pays nothing when the stamp is in the future, however often it runs', () => {
    Progress.update({ lastTopUp: '2099-01-01' });
    const before = Progress.data.reveals;

    // Every launch of that day — which is what the faucet was: relaunching
    // paid out again and again because a future stamp is never "today".
    Progress.applyDailyTopUp(morning);
    Progress.applyDailyTopUp(new Date(2026, 4, 17, 13, 20));
    Progress.applyDailyTopUp(new Date(2026, 4, 17, 21, 45));

    expect(Progress.data.reveals).toBe(before);
  });

  it('repairs a future stamp rather than leaving it to misfire tomorrow', () => {
    Progress.update({ lastTopUp: '2099-01-01' });
    const before = Progress.data.reveals;

    Progress.applyDailyTopUp(morning);
    expect(Progress.data.lastTopUp).toBe('2026-05-17');
    expect(Progress.data.reveals).toBe(before);

    // And the ordinary schedule resumes from there.
    Progress.applyDailyTopUp(new Date(2026, 4, 18, 9, 0));
    expect(Progress.data.reveals).toBe(before + grant);
  });

  /*
   * This ran on UTC while the Daily Fold rolled over locally, so west of
   * Greenwich the pill's own promise — "one more lands tomorrow" — named a
   * different day than the fold it was offered alongside.
   */
  it.skipIf(cross === null)(
    'rolls over on the players own midnight, not Greenwich',
    () => {
      if (!cross) return;

      // Last claimed on what UTC calls today. On the UTC reading that is a
      // no-op; on the local reading a new day has begun and one is owed.
      Progress.update({ lastTopUp: cross.utc, reveals: 0 });
      Progress.applyDailyTopUp(cross.at);
      expect(Progress.data.lastTopUp).toBe(cross.local);
      expect(Progress.data.reveals).toBe(grant);

      // And the converse, so this is not just "always grants": already claimed
      // on the local day means nothing further is owed.
      Progress.update({ lastTopUp: cross.local, reveals: 0 });
      Progress.applyDailyTopUp(cross.at);
      expect(Progress.data.reveals).toBe(0);
    }
  );
});

describe('the reveal economy', () => {
  it('opens with the starting stash', () => {
    expect(Progress.reveals).toBe(monetization.reveals.startingStash);
  });

  it('adds granted reveals to the stash', () => {
    Progress.grantReveals(monetization.products.revealPacks[0].count);
    expect(Progress.reveals).toBe(
      monetization.reveals.startingStash + monetization.products.revealPacks[0].count
    );
  });

  it('draws the stash down one reveal at a time', () => {
    Progress.update({ reveals: 2 });
    expect(Progress.spendReveal()).toBe(true);
    expect(Progress.reveals).toBe(1);
    expect(Progress.spendReveal()).toBe(true);
    expect(Progress.reveals).toBe(0);
  });

  it('refuses to spend an empty stash so the caller can upsell instead', () => {
    Progress.update({ reveals: 0 });
    expect(Progress.spendReveal()).toBe(false);
    expect(Progress.data.reveals).toBe(0);
  });

  it('makes reveals unlimited once Remove Ads is owned', () => {
    Progress.update({ reveals: 0 });
    Progress.setAdsRemoved(true);

    expect(Progress.reveals).toBe(Number.POSITIVE_INFINITY);
    expect(Progress.spendReveal()).toBe(true);
    // Short-circuited, not decremented: the stored balance is untouched, so the
    // number is still there if the entitlement is ever lost.
    expect(Progress.data.reveals).toBe(0);
  });
});

describe('the daily ledger', () => {
  it('keeps the first finish of a day and ignores replays', () => {
    Progress.recordDaily('2026-08-07', { ms: 4200, deaths: 2, foldSense: 61 });
    Progress.recordDaily('2026-08-07', { ms: 900, deaths: 0, foldSense: 99 });
    expect(Progress.dailyResult('2026-08-07')).toEqual({
      ms: 4200,
      deaths: 2,
      foldSense: 61,
    });
  });

  it('reports no result for a day never played', () => {
    expect(Progress.dailyResult('2026-08-07')).toBeNull();
    expect(Progress.hasDaily('2026-08-07')).toBe(false);
  });
});

describe('the streak', () => {
  it('counts consecutive finished days ending today', () => {
    seedDaily(['2026-08-05', '2026-08-06', '2026-08-07']);
    expect(Progress.dailyStreak('2026-08-07')).toBe(3);
  });

  it('does not break before today is actually over', () => {
    // Today unfinished is not today missed; the run the player is protecting
    // survives until the day passes.
    seedDaily(['2026-08-05', '2026-08-06']);
    expect(Progress.dailyStreak('2026-08-07')).toBe(2);
  });

  it('ends the current run at the first gap', () => {
    seedDaily(['2026-08-01', '2026-08-02', '2026-08-05', '2026-08-06', '2026-08-07']);
    expect(Progress.dailyStreak('2026-08-07')).toBe(3);
  });

  it('spans a month boundary', () => {
    seedDaily(['2026-07-30', '2026-07-31', '2026-08-01']);
    expect(Progress.dailyStreak('2026-08-01')).toBe(3);
  });

  it('remembers the best run the player ever kept, behind a gap', () => {
    seedDaily([
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
      '2026-08-06',
      '2026-08-07',
    ]);
    expect(Progress.dailyStreak('2026-08-07')).toBe(2);
    expect(Progress.longestStreak()).toBe(4);
  });

  it('measures the longest run across a month boundary', () => {
    seedDaily(['2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-03']);
    expect(Progress.longestStreak()).toBe(4);
  });

  it('counts a single finished day as a run of one', () => {
    seedDaily(['2026-08-07']);
    expect(Progress.longestStreak()).toBe(1);
  });

  it('has no streak at all before the first daily', () => {
    expect(Progress.dailyStreak('2026-08-07')).toBe(0);
    expect(Progress.longestStreak()).toBe(0);
  });
});

describe('recording a win', () => {
  const TOTAL = 300;

  it('unlocks the next level and banks the time', () => {
    Progress.recordWin('l1', 0, 5000, TOTAL);

    expect(Progress.data.unlockedIndex).toBe(1);
    expect(Progress.hasCleared('l1')).toBe(true);
    expect(Progress.data.bestMs.l1).toBe(5000);
    expect(Progress.data.totalWins).toBe(1);
    expect(Progress.data.winsSinceAd).toBe(1);
  });

  it('keeps the best time, not the latest', () => {
    Progress.recordWin('l1', 0, 5000, TOTAL);
    Progress.recordWin('l1', 0, 9000, TOTAL);
    expect(Progress.data.bestMs.l1).toBe(5000);

    Progress.recordWin('l1', 0, 3100, TOTAL);
    expect(Progress.data.bestMs.l1).toBe(3100);
  });

  it('never lists the same level as cleared twice', () => {
    Progress.recordWin('l1', 0, 5000, TOTAL);
    Progress.recordWin('l1', 0, 4000, TOTAL);
    expect(Progress.data.cleared).toEqual(['l1']);
    // Replays still count as wins: ad cadence and the rating prompt run off
    // this counter, not off distinct levels.
    expect(Progress.data.totalWins).toBe(2);
  });

  it('never walks the unlock backwards when an old level is replayed', () => {
    Progress.update({ unlockedIndex: 50 });
    Progress.recordWin('l3', 2, 4000, TOTAL);
    expect(Progress.data.unlockedIndex).toBe(50);
  });

  it('never unlocks past the end of the level set', () => {
    // Beating the last level would otherwise point unlockedIndex one past the
    // table, which is the same undefined-index crash by another route.
    Progress.recordWin('l300', TOTAL - 1, 4000, TOTAL);
    expect(Progress.data.unlockedIndex).toBe(TOTAL - 1);
    expect(Progress.isUnlocked(TOTAL)).toBe(false);
  });

  it('opens the next level without clearing it when a skip is bought', () => {
    Progress.unlockThrough(4, TOTAL);
    expect(Progress.data.unlockedIndex).toBe(5);
    expect(Progress.hasCleared('l5')).toBe(false);
    expect(Progress.data.totalWins).toBe(0);
  });
});

describe('persistence', () => {
  it('reads back what an earlier session wrote', async () => {
    Progress.update({ unlockedIndex: 12, adsRemoved: true, foldSense: 77 });
    Progress.addFigure(figure(9));
    Progress.recordDaily('2026-08-07', { ms: 4200, deaths: 2, foldSense: 61 });
    await Progress.flush();

    // A later launch, reading the same bytes off the same key.
    const s = await Progress.load();
    expect(s.unlockedIndex).toBe(12);
    expect(s.adsRemoved).toBe(true);
    expect(s.foldSense).toBe(77);
    expect(s.figures.map((f) => f.levelId)).toEqual(['l9']);
    expect(s.daily['2026-08-07'].ms).toBe(4200);
  });

  it('tops up the free reveal as part of the load', async () => {
    // Nine callers rely on load() being the whole of start-up; the top-up has to
    // happen there or the pill never refills for anyone who does not open the
    // Daily Fold.
    Progress.update({ lastTopUp: '2020-01-01', reveals: 0 });
    await Progress.flush();

    const s = await Progress.load();
    expect(s.lastTopUp).toBe(todayISO());
    expect(s.reveals).toBe(monetization.reveals.freeDailyTopUp);
  });
});
