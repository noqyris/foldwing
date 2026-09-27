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
import type { MissionState } from '../core/Missions';
import { LEVELS } from '../data/levels';
import { ACHIEVEMENTS } from './GameCenter';
import {
  MIRROR_LABELS,
  Progress,
  type DailyResult,
  type GrantEvent,
  type SaveData,
  type SavedFigure,
  type WinOutcome,
} from './Progress';

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
    expect(s.version).toBe(3);
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
    expect(s.version).toBe(3);
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
    expect(s.version).toBe(3);
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

  it('leaves a save already on version 3 alone', async () => {
    const s = await readStored({ ...v1(), version: 3 });
    expect(s.cleared).toEqual(['l1', 'l6', 'l40']);
    expect(s.bestMs).toEqual({ l1: 1200, l6: 8800, l40: 9000 });
    expect(s.medals).toEqual(['l1', 'l6']);
    expect(Progress.hasCleared('l6')).toBe(true);
  });

  it('strips non-string ids out of a v2 cleared list', async () => {
    const s = await readStored({ version: 3, cleared: ['l1', 7, null, 'l2'] });
    expect(s.cleared).toEqual(['l1', 'l2']);
  });
});

describe('the v2 to v3 migration: the tutorial became mazes', () => {
  /** A player well past the tutorial on the v2 build. */
  const v2 = (): Record<string, unknown> => ({
    version: 2,
    unlockedIndex: 62,
    cleared: ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l10', 'l15', 'l50', 'l100', 'l199'],
    bestMs: { l1: 1200, l5: 2100, l6: 8800, l10: 9100, l100: 12000 },
    medals: ['l1', 'l4', 'l6', 'l19'],
    reveals: 7,
    lastTopUp: todayISO(),
    adsRemoved: true,
    totalWins: 71,
    winsSinceAd: 2,
    ratePrompted: true,
    figures: [
      { ...figure(1), walls: [{ x: 0, y: 0.44, w: 0.3, h: 0.06 }], start: { x: 0.14, y: 0.88 }, goal: { x: 0.14, y: 0.12 } },
      figure(6),
    ],
    daily: { '2026-08-07': { ms: 4200, deaths: 2, foldSense: 61 } },
    foldSense: 61,
  });

  it('forgets clears, times and medals for l1…l5 only', async () => {
    const s = await readStored(v2());
    expect(s.version).toBe(3);
    expect(s.cleared).toEqual(['l6', 'l10', 'l15', 'l50', 'l100', 'l199']);
    expect(s.bestMs).toEqual({ l6: 8800, l10: 9100, l100: 12000 });
    expect(s.medals).toEqual(['l6', 'l19']);
  });

  it('matches ids exactly, never by prefix', async () => {
    // startsWith('l1') would take l10…l19 and l100…l199 with it.
    const s = await readStored({ version: 2, cleared: ['l1', 'l10', 'l11', 'l100', 'l150', 'l5', 'l50', 'l55', 'l1 '] });
    expect(s.cleared).toEqual(['l10', 'l11', 'l100', 'l150', 'l50', 'l55', 'l1 ']);
  });

  it('never sends a player back: access is index-based and kept', async () => {
    const s = await readStored(v2());
    expect(s.unlockedIndex).toBe(62);
    for (let i = 0; i <= 62; i++) expect(Progress.isUnlocked(i)).toBe(true);
  });

  it('leaves a mid-tutorial player where they were, with nothing marked done', async () => {
    const s = await readStored({ version: 2, unlockedIndex: 3, cleared: ['l1', 'l2', 'l3'], bestMs: { l1: 900, l2: 1500, l3: 1700 }, totalWins: 3 });
    expect(s.unlockedIndex).toBe(3);
    expect(s.cleared).toEqual([]);
    expect(s.bestMs).toEqual({});
    expect(s.totalWins).toBe(3);
  });

  it('forgets l1 clears, medals and stale bests on the new mazes, and keeps l6 cleared', async () => {
    await readStored(v2());
    expect(Progress.hasCleared('l1')).toBe(false);
    expect(Progress.hasMedal('l1')).toBe(false);
    expect(Progress.data.bestMs.l1).toBeUndefined();
    // …and l6's Reveal hint stays silenced: l6 did not change.
    expect(Progress.hasCleared('l6')).toBe(true);
  });

  it('keeps every figure, drawn through the walls it was actually drawn through', async () => {
    const s = await readStored(v2());
    expect(s.figures.map((f) => f.levelId)).toEqual(['l1', 'l6']);
    expect(s.figures[0].walls).toEqual([{ x: 0, y: 0.44, w: 0.3, h: 0.06 }]);
  });

  it('keeps everything not keyed by a level id', async () => {
    const s = await readStored(v2());
    expect(s.adsRemoved).toBe(true);
    expect(s.reveals).toBe(7);
    expect(s.totalWins).toBe(71);
    expect(s.winsSinceAd).toBe(2);
    expect(s.ratePrompted).toBe(true);
    expect(s.foldSense).toBe(61);
    expect(s.daily['2026-08-07']).toEqual({ ms: 4200, deaths: 2, foldSense: 61 });
  });

  it('runs once: a new-maze clear survives the next launch', async () => {
    await readStored(v2());
    Progress.recordWin('l1', 0, 6400, 300);
    Progress.addMedal('l1');
    await Progress.flush();
    const s = await Progress.load();
    expect(s.version).toBe(3);
    expect(s.cleared).toContain('l1');
    expect(s.bestMs.l1).toBe(6400);
    expect(s.medals).toContain('l1');
  });

  it('migrates again on a relaunch that happened before anything was written', async () => {
    // load() does not write; a kill before the first flush re-reads the v2 bytes.
    const bytes = JSON.stringify(v2());
    disk.set(KEY, bytes);
    await Progress.load();
    disk.set(KEY, bytes);
    const s = await Progress.load();
    expect(s.cleared).toEqual(['l6', 'l10', 'l15', 'l50', 'l100', 'l199']);
  });

  it('leaves a save from a newer build alone', async () => {
    const s = await readStored({ ...v2(), version: 4 });
    expect(s.version).toBe(4);
    expect(s.cleared).toContain('l1');
    expect(s.bestMs.l1).toBe(1200);
  });

  it('still empties a v1 save completely, tutorial ids and all', async () => {
    const { version: _drop, ...v1 } = v2();
    const s = await readStored(v1);
    expect(s.cleared).toEqual([]);
    expect(s.bestMs).toEqual({});
    expect(s.medals).toEqual([]);
    expect(s.unlockedIndex).toBe(62);
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

describe('a daily ledger longer than the cap', () => {
  /*
   * The cap used to cut the streak itself. The streak walks back from today
   * to the first gap, so trimming the oldest entries of an unbroken run capped
   * every streak at 730 — "730 day streak" forever, however many more days the
   * player folded.
   */
  it('never trims the run that is still alive, however long it is', async () => {
    const today = todayISO();
    const daily: Record<string, DailyResult> = {};
    for (let i = 0; i < 1200; i++) daily[shiftISO(today, -i)] = played(1000);

    const s = await readStored({ version: 3, daily });

    expect(Object.keys(s.daily)).toHaveLength(1200);
    expect(Progress.dailyStreak(today)).toBe(1200);
  });

  it('keeps a run that ended yesterday whole, since today is not over', async () => {
    const today = todayISO();
    const daily: Record<string, DailyResult> = {};
    for (let i = 1; i <= 1000; i++) daily[shiftISO(today, -i)] = played(1000);

    const s = await readStored({ version: 3, daily });

    expect(Object.keys(s.daily)).toHaveLength(1000);
    expect(Progress.dailyStreak(today)).toBe(1000);
  });

  it('still forgets the history behind a gap', async () => {
    const today = todayISO();
    const daily: Record<string, DailyResult> = {};
    // A 900-day run ending today, one missed day, and 100 days before that.
    for (let i = 0; i < 900; i++) daily[shiftISO(today, -i)] = played(1000);
    for (let i = 901; i <= 1000; i++) daily[shiftISO(today, -i)] = played(1000);

    const s = await readStored({ version: 3, daily });

    expect(Object.keys(s.daily)).toHaveLength(900);
    expect(Progress.hasDaily(shiftISO(today, -899))).toBe(true);
    expect(Progress.hasDaily(shiftISO(today, -901))).toBe(false);
    expect(Progress.dailyStreak(today)).toBe(900);
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

/*
 * Until load() has come back, the store holds a placeholder: freshSave(), with
 * no levels, no gallery and no purchase. The lifecycle flush is bound BEFORE the
 * read, so an app backgrounded during the Preferences round trip wrote that
 * placeholder over the real save — and if iOS killed it before the next
 * debounced write, a 57-level player with Remove Ads relaunched on level 1
 * owning nothing.
 */
describe('before the save has been read', () => {
  /** A cold launch: a new store that has read nothing yet. */
  async function coldStart(): Promise<typeof Progress> {
    vi.resetModules();
    return (await import('./Progress')).Progress;
  }

  /*
   * Every test below seeds the disk and starts the read in ONE synchronous
   * block. An earlier test's debounced write is a real 250ms timer, and a
   * module import can take longer than that on a busy runner; a seed written
   * before the import could be overwritten before the read ever saw it.
   */

  const real = {
    version: 3,
    unlockedIndex: 57,
    adsRemoved: true,
    reveals: 9,
    lastTopUp: todayISO(),
  };

  it('never writes the empty placeholder over the save on disk', async () => {
    const cold = await coldStart();

    disk.set(KEY, JSON.stringify(real));
    const loading = cold.load();
    // The app backgrounds while the read is in flight: the lifecycle flush.
    await cold.flush();
    expect(JSON.parse(disk.get(KEY) as string)).toMatchObject({
      unlockedIndex: 57,
      adsRemoved: true,
      reveals: 9,
    });

    const s = await loading;
    expect(s.unlockedIndex).toBe(57);
    expect(s.adsRemoved).toBe(true);
  });

  it('writes as usual once the read is in', async () => {
    const cold = await coldStart();
    disk.set(KEY, JSON.stringify(real));
    await cold.load();

    cold.update({ unlockedIndex: 58 });
    await cold.flush();
    expect(JSON.parse(disk.get(KEY) as string).unlockedIndex).toBe(58);
  });

  it('still writes a first save for a player who has none', async () => {
    const cold = await coldStart();
    disk.delete(KEY);
    await cold.load();
    await cold.flush();
    expect(JSON.parse(disk.get(KEY) as string).unlockedIndex).toBe(0);
  });

  /*
   * main.ts tops up on every foreground, which can land during the boot read.
   * The placeholder is thrown away by load() anyway; what matters is that the
   * real save is topped up once, by load(), and not skipped because a stamp
   * went onto the placeholder first.
   */
  it('leaves the top-up to load() rather than paying it into the placeholder', async () => {
    const cold = await coldStart();

    disk.set(KEY, JSON.stringify({ ...real, lastTopUp: '2020-01-01' }));
    cold.applyDailyTopUp();
    expect(cold.data.lastTopUp).toBe('');

    const s = await cold.load();
    expect(s.lastTopUp).toBe(todayISO());
    expect(s.reveals).toBe(9 + monetization.reveals.freeDailyTopUp);
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

/* ================================================================== 1.4 */

const economy = monetization.economy;
/** Noon on Tuesday 22 September 2026, local. */
const NOW = new Date(2026, 8, 22, 12, 0);
const TODAY = '2026-09-22';
const ids = (from: number, to: number): string[] => LEVELS.slice(from, to).map((l) => l.id);

/** Every grant announced while `fn` runs, and the balance each listener saw. */
function heard(fn: () => void): { events: GrantEvent[]; balances: number[] } {
  const events: GrantEvent[] = [];
  const balances: number[] = [];
  const off = Progress.onGrant((g) => {
    events.push(g);
    balances.push(Progress.data.reveals);
  });
  try {
    fn();
  } finally {
    off();
  }
  return { events, balances };
}

/** A campaign win in the order GameScene.win() makes the calls. */
function winLevel(
  index: number,
  o: { ms?: number; medal?: boolean; deaths?: number } = {},
  now: Date = NOW
): WinOutcome {
  const id = LEVELS[index].id;
  const ms = o.ms ?? 5000;
  const before = Progress.snapshotForWin(id, index, now);
  Progress.recordWin(id, index, ms, LEVELS.length);
  if (o.medal) Progress.addMedal(id);
  return Progress.settleWin(
    before,
    {
      levelId: id,
      levelIndex: index,
      dailyDate: null,
      todayDailyFirst: false,
      medal: o.medal ?? false,
      deaths: o.deaths ?? 1,
      ms,
    },
    now
  );
}

/** A Daily win, likewise: first finish records it, a rerun only settles. */
function winDaily(date: string, now: Date = NOW): WinOutcome {
  const first = !Progress.hasDaily(date);
  const before = Progress.snapshotForWin(`daily-${date}`, 0, now);
  if (first) Progress.recordDaily(date, played(40_000));
  return Progress.settleWin(
    before,
    {
      levelId: `daily-${date}`,
      levelIndex: 0,
      dailyDate: date,
      todayDailyFirst: first && date === todayISO(now),
      medal: false,
      deaths: 0,
      ms: 40_000,
    },
    now
  );
}

const missionsOf = (ids3: MissionState['ids'], date = TODAY): MissionState => ({
  date,
  ids: ids3,
  progress: [0, 0, 0],
  paid: [false, false, false],
});

describe('grants', () => {
  it('refuses anything but a positive whole number, and says so', () => {
    const before = Progress.data.reveals;
    const { events } = heard(() => {
      for (const n of [0, -2, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(Progress.grantReveals(n, 'rewarded'), String(n)).toBe(false);
      }
    });
    expect(Progress.data.reveals).toBe(before);
    expect(events).toEqual([]);
  });

  it('are announced after the balance is written, with their reason', () => {
    const before = Progress.data.reveals;
    const { events, balances } = heard(() => expect(Progress.grantReveals(3, 'rewarded')).toBe(true));
    expect(events).toEqual([{ reveals: 3, bookmarks: 0, reason: 'rewarded' }]);
    expect(balances).toEqual([before + 3]);
  });

  it('stop reaching a listener once it unsubscribes', () => {
    const seen: GrantEvent[] = [];
    const off = Progress.onGrant((g) => void seen.push(g));
    Progress.grantReveals(1, 'mission');
    off();
    Progress.grantReveals(1, 'mission');
    expect(seen).toHaveLength(1);
  });

  it('survive a listener that throws: the others still hear, the grant still lands', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const offBad = Progress.onGrant(() => {
      throw new Error('scene gone');
    });
    const before = Progress.data.reveals;
    const { events } = heard(() => Progress.grantReveals(2, 'purchase'));
    offBad();
    expect(events).toHaveLength(1);
    expect(Progress.data.reveals).toBe(before + 2);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('announce Remove Ads changing hands, with nothing granted', () => {
    const { events } = heard(() => {
      Progress.setAdsRemoved(true);
      Progress.setAdsRemoved(true);
    });
    expect(events).toEqual([{ reveals: 0, bookmarks: 0, reason: 'purchase', adsRemoved: true }]);
  });

  /*
   * The daily reveal is paid by load(), before any scene exists to show it.
   * It waits for the Menu instead of vanishing — and only when nobody showed
   * it, so a level that toasted it does not get it toasted again on the menu.
   */
  it('keep the daily reveal nobody showed until the menu takes it', async () => {
    const s = await readStored({ version: 3, lastTopUp: '2020-01-01', reveals: 4 });
    expect(s.reveals).toBe(4 + monetization.reveals.freeDailyTopUp);
    expect(Progress.takeUnshownGrants()).toEqual([{ reveals: 1, bookmarks: 0, reason: 'daily' }]);
    expect(Progress.takeUnshownGrants()).toEqual([]);
  });

  it('do not keep a grant a listener showed, nor one its own flow presents', () => {
    const off = Progress.onGrant(() => true);
    Progress.applyDailyTopUp(NOW);
    off();
    Progress.grantReveals(10, 'purchase');
    Progress.grantReveals(1, 'rewarded');
    expect(Progress.takeUnshownGrants()).toEqual([]);

    // Heard but not shown (a listener that only rebuilds something): kept.
    const offQuiet = Progress.onGrant(() => undefined);
    Progress.grantReveals(10, 'late-purchase');
    offQuiet();
    expect(Progress.takeUnshownGrants()).toEqual([{ reveals: 10, bookmarks: 0, reason: 'late-purchase' }]);
  });
});

describe('the daily top-up, now visible', () => {
  it('says how many it granted, and announces them once', () => {
    const { events } = heard(() => {
      expect(Progress.applyDailyTopUp(NOW)).toBe(monetization.reveals.freeDailyTopUp);
      expect(Progress.applyDailyTopUp(NOW)).toBe(0);
    });
    expect(events).toEqual([{ reveals: 1, bookmarks: 0, reason: 'daily' }]);
  });

  it('grants nothing before the save is read', async () => {
    vi.resetModules();
    const cold = (await import('./Progress')).Progress;
    expect(cold.applyDailyTopUp(NOW)).toBe(0);
  });
});

describe('the rewarded cap', () => {
  const cap = economy.rewardedRevealsPerDay;

  it('allows five ad-paid reveals a local day, then none', () => {
    expect(Progress.adRevealsLeft(NOW)).toBe(cap);
    for (let i = 0; i < cap; i++) Progress.recordAdReveal(NOW);
    expect(Progress.adRevealsLeft(NOW)).toBe(0);
    Progress.recordAdReveal(NOW);
    expect(Progress.data.rewardedToday).toBe(cap);
  });

  it('counts the doubler as two', () => {
    Progress.recordAdReveal(NOW, 2);
    expect(Progress.adRevealsLeft(NOW)).toBe(cap - 2);
  });

  /*
   * The cap counts reveals across every placement, not ads. With one left, a
   * doubler that pays two would take the day to six — so it is not offered,
   * and nothing pays or counts past the cap even if it were.
   */
  it('offers the doubler only with two left, and never pays past the cap', () => {
    for (let i = 0; i < cap - 1; i++) expect(Progress.payAdReveals(1, NOW)).toBe(true);
    expect(Progress.adRevealsLeft(NOW)).toBe(1);
    expect(Progress.canAdPay(1, NOW)).toBe(true);
    expect(Progress.canAdPay(2, NOW)).toBe(false);

    const before = Progress.data.reveals;
    const { events } = heard(() => {
      expect(Progress.payAdReveals(2, NOW)).toBe(false);
      expect(Progress.recordAdReveal(NOW, 2)).toBe(false);
    });
    expect(events).toEqual([]);
    expect(Progress.data.reveals).toBe(before);
    expect(Progress.data.rewardedToday).toBe(cap - 1);

    expect(Progress.payAdReveals(1, NOW)).toBe(true);
    expect(Progress.data.rewardedToday).toBe(cap);
    expect(Progress.canAdPay(1, NOW)).toBe(false);
  });

  it('pays and counts in one step, announced as rewarded', () => {
    const before = Progress.data.reveals;
    const { events, balances } = heard(() => expect(Progress.payAdReveals(2, NOW)).toBe(true));
    expect(events).toEqual([{ reveals: 2, bookmarks: 0, reason: 'rewarded' }]);
    expect(balances).toEqual([before + 2]);
    expect(Progress.adRevealsLeft(NOW)).toBe(cap - 2);
    for (const n of [0, -1, 1.5, Number.NaN]) expect(Progress.payAdReveals(n, NOW), String(n)).toBe(false);
  });

  it('opens again on the next local day', () => {
    for (let i = 0; i < cap; i++) Progress.recordAdReveal(NOW);
    expect(Progress.adRevealsLeft(new Date(2026, 8, 23, 0, 5))).toBe(cap);
    Progress.recordAdReveal(new Date(2026, 8, 23, 0, 5));
    expect(Progress.data.rewardedToday).toBe(1);
  });

  /*
   * The clock-back rule, as for the top-up: watch five with the clock set to
   * tomorrow, set it back, and today's count is the one already spent — not a
   * fresh five. The stamp is repaired to today, so tomorrow resumes normally.
   */
  it('keeps a count stamped in the future, and repairs the stamp to today', () => {
    Progress.update({ rewardedDay: '2026-09-23', rewardedToday: cap });
    expect(Progress.adRevealsLeft(NOW)).toBe(0);
    Progress.applyDailyTopUp(NOW);
    expect(Progress.data.rewardedDay).toBe(TODAY);
    expect(Progress.adRevealsLeft(NOW)).toBe(0);
    expect(Progress.adRevealsLeft(new Date(2026, 8, 23, 9, 0))).toBe(cap);
  });
});

describe('the streak with bookmarks', () => {
  it('counts a bridged day as a bridge, not a day', () => {
    Progress.update({
      daily: { '2026-09-19': played(1), '2026-09-20': played(1), '2026-09-22': played(1) },
      bookmarked: ['2026-09-21'],
    });
    expect(Progress.dailyStreak(TODAY)).toBe(3);
    expect(Progress.longestStreak()).toBe(3);
  });

  it('spends a bookmark on a missed day, once', () => {
    Progress.update({ daily: { '2026-09-18': played(1), '2026-09-19': played(1) }, bookmarks: 1 });
    const monday = new Date(2026, 8, 21, 9, 0);

    expect(Progress.applyStreakGuard(monday)).toEqual({ bridged: ['2026-09-20'], streak: 2, left: 0, milestones: [] });
    expect(Progress.data.bookmarked).toEqual(['2026-09-20']);
    expect(Progress.bookmarks).toBe(0);
    expect(Progress.dailyStreak('2026-09-21')).toBe(2);

    // Idempotent: every foreground calls it.
    expect(Progress.applyStreakGuard(monday)).toBeNull();
    expect(Progress.applyStreakGuard(new Date(2026, 8, 21, 22, 0))).toBeNull();
  });

  it('hands the menu what the guard did, once', () => {
    Progress.update({ daily: { '2026-09-18': played(1), '2026-09-19': played(1) }, bookmarks: 2 });
    Progress.applyStreakGuard(new Date(2026, 8, 21, 9, 0));
    expect(Progress.takeStreakGuard()).toEqual({ bridged: ['2026-09-20'], streak: 2, left: 1, milestones: [] });
    expect(Progress.takeStreakGuard()).toBeNull();
  });

  it('keeps the bookmarks when they cannot cover the gap', () => {
    Progress.update({ daily: { '2026-09-18': played(1), '2026-09-19': played(1) }, bookmarks: 1 });
    expect(Progress.applyStreakGuard(new Date(2026, 8, 22, 9, 0))).toBeNull();
    expect(Progress.bookmarks).toBe(1);
    expect(Progress.dailyStreak(TODAY)).toBe(0);
  });

  it('never spends one on a one-day run', () => {
    Progress.update({ daily: { '2026-09-19': played(1) }, bookmarks: 2 });
    expect(Progress.applyStreakGuard(new Date(2026, 8, 21, 9, 0))).toBeNull();
    expect(Progress.bookmarks).toBe(2);
  });

  it('does nothing before the save is read', async () => {
    vi.resetModules();
    const cold = (await import('./Progress')).Progress;
    expect(cold.applyStreakGuard(NOW)).toBeNull();
  });

  it('bridges the night the clocks go back (Belgrade, 2026-10-25)', () => {
    Progress.update({ daily: { '2026-10-23': played(1), '2026-10-24': played(1) }, bookmarks: 1 });
    const justAfterMidnight = new Date(2026, 9, 26, 0, 30);
    expect(Progress.applyStreakGuard(justAfterMidnight)?.bridged).toEqual(['2026-10-25']);
    Progress.recordDaily('2026-10-26', played(1));
    expect(Progress.dailyStreak('2026-10-26')).toBe(3);
  });

  /*
   * Game Center's week achievement reads the ledger of folded days only. A
   * bookmark keeps the run alive; it cannot fold a week for the player.
   */
  it('never lets a bridged day earn the Game Center week', () => {
    const week = ACHIEVEMENTS.find((a) => a.id === 'foldwing.streak.week');
    if (!week) throw new Error('no week achievement');
    const today = todayISO();
    const days = [0, 1, 2, 4, 5, 6].map((i) => shiftISO(today, -i));
    Progress.update({
      daily: Object.fromEntries(days.map((d) => [d, played(1)])),
      bookmarked: [shiftISO(today, -3)],
    });
    expect(Progress.dailyStreak(today)).toBe(6);
    expect(week.earned(Progress.data)).toBe(false);

    Progress.recordDaily(shiftISO(today, -3), played(1));
    expect(week.earned(Progress.data)).toBe(true);
  });
});

describe('the streak repair', () => {
  const monday = '2026-09-21';

  it('covers exactly one missed day, and stamps the day it was used', () => {
    Progress.update({ daily: { '2026-09-18': played(1), '2026-09-19': played(1) } });
    expect(Progress.repairableDay(monday)).toBe('2026-09-20');

    const { events } = heard(() => expect(Progress.repairStreak(monday)).toBe(true));
    expect(events).toEqual([{ reveals: 0, bookmarks: 0, reason: 'repair' }]);
    expect(Progress.data.bookmarked).toEqual(['2026-09-20']);
    expect(Progress.data.lastRepair).toBe(monday);
    expect(Progress.dailyStreak(monday)).toBe(2);

    // Nothing left to repair.
    expect(Progress.repairStreak(monday)).toBe(false);
  });

  it('refuses two missed days', () => {
    Progress.update({ daily: { '2026-09-18': played(1), '2026-09-19': played(1) } });
    expect(Progress.repairStreak('2026-09-22')).toBe(false);
    expect(Progress.data.bookmarked).toEqual([]);
  });

  it('respects the cooldown', () => {
    Progress.update({
      daily: { '2026-09-18': played(1), '2026-09-19': played(1) },
      lastRepair: shiftISO(monday, -(economy.repair.cooldownDays - 1)),
    });
    expect(Progress.repairStreak(monday)).toBe(false);
    Progress.update({ lastRepair: shiftISO(monday, -economy.repair.cooldownDays) });
    expect(Progress.repairStreak(monday)).toBe(true);
  });

  it('is not offered once a bookmark covered the day', () => {
    Progress.update({ daily: { '2026-09-18': played(1), '2026-09-19': played(1) }, bookmarks: 1 });
    // Before the guard runs, the held bookmark will cover it for free.
    expect(Progress.repairableDay(monday)).toBeNull();
    Progress.applyStreakGuard(new Date(2026, 8, 21, 9, 0));
    expect(Progress.repairableDay(monday)).toBeNull();
    expect(Progress.repairStreak(monday)).toBe(false);
  });
});

/*
 * Milestones pay for the day a streak REACHES, and a streak can jump: a repair
 * or a bookmark covering yesterday after today was folded, or yesterday's
 * Daily finished after midnight. The day jumped over is never reached again —
 * the next Daily reaches the one after — so the jump itself has to pay it,
 * and only it: what the old run reached was paid on its own day.
 */
describe('milestones a jump would skip', () => {
  // Six folded (15th–20th), the 21st missed, today the 22nd.
  const six = ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'];
  const tomorrowNoon = new Date(2026, 8, 23, 12, 0);

  it('are paid by a repair made after the Daily, once', () => {
    seedDaily(six);
    expect(winDaily(TODAY).streak).toEqual({ before: 0, after: 1, milestone: null });

    const pays = Progress.repairPays(TODAY);
    expect(pays.map((m) => m.day)).toEqual([7]);
    const start = Progress.data.reveals;
    const { events } = heard(() => expect(Progress.repairStreak(TODAY)).toBe(true));
    expect(events).toEqual([{ reveals: 2, bookmarks: 1, reason: 'repair' }]);
    expect(Progress.dailyStreak(TODAY)).toBe(7);
    expect(Progress.data.reveals).toBe(start + 2);
    // Day three was paid when the old run reached it; it is not paid again.
    expect(Progress.bookmarks).toBe(1);

    const next = winDaily('2026-09-23', tomorrowNoon);
    expect(next.streak).toEqual({ before: 7, after: 8, milestone: null });
    expect(next.reveals).toBe(0);
  });

  it('are left to the Daily when the repair comes first', () => {
    seedDaily(six);
    expect(Progress.repairPays(TODAY)).toEqual([]);
    const { events } = heard(() => Progress.repairStreak(TODAY));
    expect(events).toEqual([{ reveals: 0, bookmarks: 0, reason: 'repair' }]);
    expect(winDaily(TODAY).streak).toMatchObject({ before: 6, after: 7, milestone: { day: 7 } });
  });

  it('are paid by the bookmark a 1.3 save brings, on the day 1.4 arrives', async () => {
    const today = todayISO();
    const days = [2, 3, 4, 5, 6, 7].map((i) => shiftISO(today, -i));
    const s = await readStored({
      version: 3,
      lastTopUp: today,
      reveals: 4,
      // Today already folded on 1.3; yesterday missed; no bookmark field yet.
      daily: Object.fromEntries([today, ...days].map((d) => [d, played(1)])),
    });
    expect(s.bookmarked).toEqual([shiftISO(today, -1)]);
    expect(s.reveals).toBe(4 + 2);
    const g = Progress.takeStreakGuard();
    expect(g).toMatchObject({ bridged: [shiftISO(today, -1)], streak: 7, left: 1 });
    expect(g?.milestones.map((m) => `${m.title} · ${m.body}`)).toEqual(['A week of folds · +2 reveals and a bookmark']);
  });

  it("are paid by yesterday's Daily finished after midnight", () => {
    seedDaily(six);
    const late = new Date(2026, 8, 22, 0, 2);
    const out = winDaily('2026-09-21', late);
    expect(out.streak).toMatchObject({ before: 6, after: 7, milestone: { day: 7 } });
    expect(out.lines.map((l) => l.text)).toEqual(['A week of folds · +2 reveals and a bookmark']);
    // Today's Daily then reaches eight, which pays nothing.
    expect(winDaily(TODAY).streak).toEqual({ before: 7, after: 8, milestone: null });
  });

  /*
   * The same late finish with a bookmark held: at 00:02 the guard sees
   * yesterday missed and covers it — then the finish lands on that very day.
   * It was folded, not missed, so the bookmark comes back.
   */
  it('give back a bookmark spent on a day then folded after midnight', () => {
    seedDaily(six.slice(1));
    Progress.update({ bookmarks: 1 });
    const out = winDaily('2026-09-21', new Date(2026, 8, 22, 0, 2));
    expect(out.streak).toMatchObject({ before: 5, after: 6 });
    expect(Progress.bookmarks).toBe(1);
    expect(Progress.data.bookmarked).toEqual([]);
    expect(Progress.takeStreakGuard()).toBeNull();
  });
});

describe('a future-dated save', () => {
  it('is repaired, not rewarded', async () => {
    const today = todayISO();
    const s = await readStored({
      version: 3,
      lastTopUp: today,
      daily: { [shiftISO(today, -1)]: played(1), [shiftISO(today, -2)]: played(1) },
      bookmarks: 0,
      bookmarked: [shiftISO(today, 3), shiftISO(today, -5)],
      lastRepair: shiftISO(today, 40),
      rewardedDay: shiftISO(today, 2),
      rewardedToday: economy.rewardedRevealsPerDay,
    });
    // No bookmark for a day that has not happened; the cooldown restarts today.
    expect(s.bookmarked).toEqual([shiftISO(today, -5)]);
    expect(Progress.data.lastRepair).toBe(today);
    // The cap stays spent, stamped back to today.
    expect(Progress.data.rewardedDay).toBe(today);
    expect(Progress.adRevealsLeft()).toBe(0);
  });

  it('keeps missions stamped ahead as today, so they cannot pay twice', () => {
    Progress.update({
      unlockedIndex: 30,
      cleared: ids(0, 30),
      missions: { ...missionsOf(['daily', 'wins3', 'clean'], '2026-09-25'), progress: [1, 3, 1], paid: [true, true, true] },
    });
    const m = Progress.missionsToday(NOW);
    expect(m?.date).toBe(TODAY);
    expect(m?.paid).toEqual([true, true, true]);
  });

  it('samples no session minute for a day already sampled', () => {
    Progress.update({ lastSeen: '2026-09-30', sessionMinutes: [600] });
    Progress.markSeen(NOW);
    expect(Progress.data.lastSeen).toBe(TODAY);
    expect(Progress.data.sessionMinutes).toEqual([600]);
  });
});

describe('the bookmark gift to existing streakers', () => {
  const today = todayISO();

  it('gives one to a save with Daily history and no bookmark field', async () => {
    const s = await readStored({
      version: 3,
      lastTopUp: today,
      daily: { [shiftISO(today, -1)]: played(1), [shiftISO(today, -2)]: played(1) },
    });
    expect(s.bookmarks).toBe(1);
  });

  it('gives none without Daily history, and never refills a spent one', async () => {
    expect((await readStored({ version: 3, lastTopUp: today })).bookmarks).toBe(0);
    const spent = await readStored({
      version: 3,
      lastTopUp: today,
      bookmarks: 0,
      daily: { [shiftISO(today, -1)]: played(1) },
    });
    expect(spent.bookmarks).toBe(0);
  });

  it('is spent by the guard at load when a day was missed', async () => {
    const s = await readStored({
      version: 3,
      lastTopUp: today,
      daily: { [shiftISO(today, -2)]: played(1), [shiftISO(today, -3)]: played(1) },
    });
    expect(s.bookmarks).toBe(0);
    expect(s.bookmarked).toEqual([shiftISO(today, -1)]);
    expect(Progress.takeStreakGuard()).toEqual({
      bridged: [shiftISO(today, -1)],
      streak: 2,
      left: 0,
      milestones: [],
    });
  });
});

describe('missions', () => {
  it('stay closed until the tutorial is done', () => {
    Progress.update({ unlockedIndex: economy.missions.unlockAfterIndex - 1, cleared: ids(0, 4) });
    expect(Progress.missionsToday(NOW)).toBeNull();
    Progress.update({ unlockedIndex: economy.missions.unlockAfterIndex, cleared: ids(0, 5) });
    expect(Progress.missionsToday(NOW)?.ids[0]).toBe('daily');
  });

  /*
   * Slot one is always the Daily, and the Daily stays locked for a new player
   * until l5 is cleared. Skipping l5 gives the access (unlockedIndex 5) but
   * not the Daily, so missions wait too: a mission that cannot be started
   * would hold "all three done" out of reach every day.
   */
  it('stay closed, with the Daily, for a player who skipped the last tutorial fold', () => {
    Progress.update({ unlockedIndex: 5, cleared: ids(0, 4) });
    expect(Progress.dailyUnlocked()).toBe(false);
    expect(Progress.missionsToday(NOW)).toBeNull();

    // Clearing a fold past the tutorial opens both — as it does for a save
    // migrated to v3, which forgot its l1…l5 clears on level 57.
    Progress.update({ unlockedIndex: 6, cleared: [...ids(0, 4), ids(5, 6)[0]] });
    expect(Progress.dailyUnlocked()).toBe(true);
    expect(Progress.missionsToday(NOW)).not.toBeNull();
  });

  it('open for anyone who has ever folded a Daily, tutorial or not', () => {
    Progress.update({ unlockedIndex: 5, cleared: [], daily: { '2026-09-01': played(1) } });
    expect(Progress.dailyUnlocked()).toBe(true);
    expect(Progress.missionsToday(NOW)).not.toBeNull();
    // Access still comes first: missions open at unlockedIndex 5.
    Progress.update({ unlockedIndex: 2 });
    expect(Progress.missionsToday(NOW)).toBeNull();
  });

  /*
   * A day's record is built on its first read. On the day 1.4 arrives, that
   * read can come after the Daily was folded — and a first finish happens
   * once, so the Daily slot could never finish that day.
   */
  it("start with the Daily done, and paid once, when it was folded before they were built", () => {
    Progress.update({ unlockedIndex: 30, cleared: ids(0, 30), daily: { [TODAY]: played(1) } });
    const start = Progress.data.reveals;
    const { events } = heard(() => {
      const m = Progress.missionsToday(NOW);
      expect(m?.progress[0]).toBe(1);
      expect(m?.paid[0]).toBe(true);
      Progress.missionsToday(NOW);
    });
    expect(events).toEqual([{ reveals: 1, bookmarks: 0, reason: 'mission' }]);
    expect(Progress.data.reveals).toBe(start + 1);
  });

  it('pay a Daily folded before the record on the win that builds it', () => {
    // Yesterday's record, today's Daily already folded, then a replay.
    Progress.update({
      unlockedIndex: 30,
      cleared: ids(0, 30),
      daily: { [TODAY]: played(1) },
      missions: missionsOf(['daily', 'wins3', 'clean'], '2026-09-21'),
      chapterMarks: ['0:10', '0:20', '1:10'],
    });
    const out = winLevel(3, { deaths: 1 });
    expect(out.missions?.paid[0]).toBe(true);
    expect(out.lines).toContainEqual({ kind: 'mission', text: 'Mission done · +1 reveal', reveals: 1, bookmarks: 0 });
    expect(winLevel(3, { deaths: 1 }).lines.filter((l) => l.kind === 'mission')).toEqual([]);
  });

  it('roll over at local midnight', () => {
    Progress.update({ unlockedIndex: 30, cleared: ids(0, 30) });
    Progress.update({ missions: { ...missionsOf(['daily', 'wins3', 'clean']), progress: [1, 2, 1], paid: [true, false, true] } });
    expect(Progress.missionsToday(new Date(2026, 8, 22, 23, 59))?.progress).toEqual([1, 2, 1]);
    const tomorrow = Progress.missionsToday(new Date(2026, 8, 23, 0, 1));
    expect(tomorrow?.date).toBe('2026-09-23');
    expect(tomorrow?.progress).toEqual([0, 0, 0]);
    expect(Progress.data.missions?.date).toBe('2026-09-23');
  });

  it('do not count the win that opens them', () => {
    Progress.update({ unlockedIndex: 4, cleared: ids(0, 4) });
    const out = winLevel(4, { deaths: 0 });
    expect(out.missions).toBeNull();
    expect(out.lines.filter((l) => l.kind === 'mission')).toEqual([]);
    expect(Progress.missionsToday(NOW)?.progress).toEqual([0, 0, 0]);
  });

  it('pay each one exactly once, however many wins follow', () => {
    // The backlog of both chapters already paid, so only missions are in play.
    Progress.update({
      unlockedIndex: 40,
      cleared: ids(0, 40),
      chapterMarks: ['0:10', '0:20', '1:10', '1:20'],
      missions: missionsOf(['daily', 'wins3', 'clean']),
    });
    const before = Progress.data.reveals;
    const paid = [0, 1, 2, 3, 4].map((i) => winLevel(i, { deaths: 0 }).lines.filter((l) => l.kind === 'mission'));
    expect(paid.map((l) => l.length)).toEqual([1, 0, 1, 0, 0]);
    expect(Progress.data.reveals).toBe(before + 2);
    expect(Progress.data.missions?.paid).toEqual([false, true, true]);
  });

  it('null a saved record with an id nobody knows', async () => {
    const s = await readStored({
      version: 3,
      unlockedIndex: 30,
      lastTopUp: todayISO(),
      missions: { ...missionsOf(['daily', 'wins3', 'clean'], todayISO()), ids: ['daily', 'wins3', 'fly'] },
    });
    expect(s.missions).toBeNull();
  });
});

describe('chapter marks', () => {
  it('pay a 1.3 player the backlog once, on entering the menu', async () => {
    // Four whole chapters and half of a fifth (with one level skipped in it).
    await readStored({
      version: 3,
      lastTopUp: todayISO(),
      unlockedIndex: 92,
      cleared: [...ids(0, 80), ...ids(80, 91)].filter((id) => id !== 'l85'),
    });
    const before = Progress.data.reveals;
    const { events } = heard(() => {
      const paid = Progress.settleChapterMarks('backlog');
      expect(paid.marks).toEqual(['0:10', '0:20', '1:10', '1:20', '2:10', '2:20', '3:10', '3:20', '4:10']);
      expect(paid.reveals).toBe(4 * 3 + 1);
    });
    expect(events).toEqual([{ reveals: 13, bookmarks: 0, reason: 'backlog' }]);
    expect(Progress.data.reveals).toBe(before + 13);
    expect(Progress.settleChapterMarks('backlog')).toEqual({ marks: [], reveals: 0 });
  });

  it('pay nothing before the save is read', async () => {
    vi.resetModules();
    const cold = (await import('./Progress')).Progress;
    expect(cold.settleChapterMarks('backlog')).toEqual({ marks: [], reveals: 0 });
  });
});

describe('settling a win', () => {
  it('pays a first clear its missions and moves the chapter bar', () => {
    Progress.update({ unlockedIndex: 7, cleared: ids(0, 7), missions: missionsOf(['daily', 'new2', 'clean']) });
    const before = Progress.data.reveals;
    const out = winLevel(7, { deaths: 0 });
    expect(out.lines).toEqual([{ kind: 'mission', text: 'Mission done · +1 reveal', reveals: 1, bookmarks: 0 }]);
    expect(out.reveals).toBe(1);
    expect(out.chapter).toEqual({ index: 0, cleared: 8, medals: 0, stars: 8, skipped: [], crossed: [] });
    expect(out.streak).toBeNull();
    expect(out.missions?.progress).toEqual([0, 1, 1]);
    expect(Progress.data.reveals).toBe(before + 1);
  });

  it('pays a replay nothing new', () => {
    Progress.update({ unlockedIndex: 12, cleared: ids(0, 12), chapterMarks: ['0:10'], missions: missionsOf(['daily', 'new2', 'medal']) });
    const out = winLevel(3);
    expect(out.reveals).toBe(0);
    expect(out.lines).toEqual([]);
    expect(out.chapter?.crossed).toEqual([]);
    expect(out.missions?.progress).toEqual([0, 0, 0]);
  });

  it('pays the halfway mark on the tenth clear, once', () => {
    Progress.update({ unlockedIndex: 9, cleared: ids(0, 9) });
    const out = winLevel(9);
    expect(out.chapter?.crossed).toEqual([10]);
    expect(out.lines).toEqual([{ kind: 'chapter-half', text: 'Halfway through chapter 1 · +1 reveal', reveals: 1, bookmarks: 0 }]);
    expect(Progress.data.chapterMarks).toEqual(['0:10']);
    expect(winLevel(9).lines).toEqual([]);
  });

  it('pays the full mark on the twentieth', () => {
    Progress.update({ unlockedIndex: 19, cleared: ids(0, 19), chapterMarks: ['0:10'] });
    const out = winLevel(19);
    expect(out.chapter).toMatchObject({ index: 0, cleared: 20, crossed: [20] });
    expect(out.lines).toEqual([{ kind: 'chapter-full', text: 'Chapter 1 complete · +2 reveals', reveals: 2, bookmarks: 0 }]);
    expect(out.reveals).toBe(2);
  });

  it('does not count a skipped level toward the chapter', () => {
    // l19 skipped (unlocked past, never folded), then l20 won.
    Progress.update({ unlockedIndex: 18, cleared: ids(0, 18), chapterMarks: ['0:10'] });
    Progress.unlockThrough(18, LEVELS.length);
    const out = winLevel(19);
    expect(out.chapter).toMatchObject({ cleared: 19, skipped: [18], crossed: [] });
    expect(out.reveals).toBe(0);
  });

  it('counts a medal, a clean run and a best time beaten', () => {
    Progress.update({ unlockedIndex: 30, cleared: ids(0, 30), bestMs: { l4: 9000 }, missions: missionsOf(['daily', 'wins3', 'medal']) });
    expect(winLevel(3, { medal: true, ms: 8000 }).missions?.progress).toEqual([0, 1, 1]);

    Progress.update({ missions: missionsOf(['daily', 'wins3', 'best']) });
    expect(winLevel(3, { ms: 9500 }).missions?.progress[2]).toBe(0); // slower than the best of 8000
    expect(winLevel(3, { ms: 7000 }).missions?.progress[2]).toBe(1);
  });

  it('pays the seven-day milestone on the Daily that reaches it', () => {
    const days = [1, 2, 3, 4, 5, 6].map((i) => shiftISO(TODAY, -i));
    Progress.update({ daily: Object.fromEntries(days.map((d) => [d, played(1)])) });
    const before = Progress.data.reveals;

    const { events } = heard(() => {
      const out = winDaily(TODAY);
      expect(out.streak).toMatchObject({ before: 6, after: 7, milestone: { day: 7, reveals: 2, bookmarks: 1 } });
      expect(out.lines).toEqual([
        { kind: 'streak', text: 'A week of folds · +2 reveals and a bookmark', reveals: 2, bookmarks: 1 },
      ]);
      expect(out.chapter).toBeNull();
    });
    expect(events).toEqual([{ reveals: 2, bookmarks: 1, reason: 'streak' }]);
    expect(Progress.data.reveals).toBe(before + 2);
    expect(Progress.bookmarks).toBe(1);
  });

  it('pays the first bookmark on day three, and a reveal instead at the cap', () => {
    Progress.update({ daily: { [shiftISO(TODAY, -1)]: played(1), [shiftISO(TODAY, -2)]: played(1) } });
    expect(winDaily(TODAY).lines).toEqual([
      { kind: 'bookmark', text: 'Bookmark earned · it keeps your streak if you miss a day', reveals: 0, bookmarks: 1 },
    ]);

    Progress.update({
      daily: { [shiftISO(TODAY, -1)]: played(1), [shiftISO(TODAY, -2)]: played(1) },
      bookmarks: economy.streak.bookmarkMax,
    });
    const full = winDaily(TODAY);
    expect(full.lines[0]).toMatchObject({ kind: 'streak', reveals: 1, bookmarks: 0 });
    expect(Progress.bookmarks).toBe(economy.streak.bookmarkMax);
  });

  it("moves the Daily mission, and never the campaign's, on a Daily", () => {
    Progress.update({ unlockedIndex: 30, cleared: ids(0, 30), missions: missionsOf(['daily', 'wins3', 'clean']) });
    const out = winDaily(TODAY);
    expect(out.missions?.progress).toEqual([1, 0, 0]);
    expect(out.lines).toContainEqual({ kind: 'mission', text: 'Mission done · +1 reveal', reveals: 1, bookmarks: 0 });
  });

  it('pays nothing for a Daily already folded today', () => {
    Progress.update({ unlockedIndex: 30, missions: missionsOf(['daily', 'wins3', 'clean']) });
    winDaily(TODAY);
    const before = Progress.data.reveals;
    const rerun = winDaily(TODAY);
    expect(rerun).toMatchObject({ reveals: 0, bookmarks: 0, lines: [], streak: null });
    expect(Progress.data.reveals).toBe(before);
  });

  it('pays an owner in the stored balance, with lines that say ✓', () => {
    Progress.update({ adsRemoved: true, unlockedIndex: 9, cleared: ids(0, 9), missions: missionsOf(['daily', 'wins3', 'clean']) });
    const before = Progress.data.reveals;
    const out = winLevel(9, { deaths: 0 });
    expect(out.lines.map((l) => l.text)).toEqual(['Halfway through chapter 1 ✓', 'Mission done ✓']);
    expect(Progress.data.reveals).toBe(before + 2);
  });

  it('pays nothing the second time the same win is settled', () => {
    Progress.update({ unlockedIndex: 9, cleared: ids(0, 9), missions: missionsOf(['daily', 'wins3', 'clean']) });
    const id = LEVELS[9].id;
    const before = Progress.snapshotForWin(id, 9, NOW);
    Progress.recordWin(id, 9, 5000, LEVELS.length);
    const facts = { levelId: id, levelIndex: 9, dailyDate: null, todayDailyFirst: false, medal: false, deaths: 0, ms: 5000 };
    expect(Progress.settleWin(before, facts, NOW).reveals).toBe(2);
    expect(Progress.settleWin(before, facts, NOW)).toMatchObject({ reveals: 0, lines: [] });
  });

  it('writes once, then announces, each grant with its reason', () => {
    Progress.update({ unlockedIndex: 9, cleared: ids(0, 9), missions: missionsOf(['daily', 'wins3', 'clean']) });
    const start = Progress.data.reveals;
    const { events, balances } = heard(() => winLevel(9, { deaths: 0 }));
    expect(events.map((e) => e.reason)).toEqual(['chapter', 'mission']);
    // Every listener, even the first, reads the balance after the whole settle.
    expect(balances).toEqual([start + 2, start + 2]);
  });
});

describe('sessions', () => {
  it('samples the first minute of each day, the last seven', () => {
    Progress.markSeen(new Date(2026, 8, 22, 19, 5));
    Progress.markSeen(new Date(2026, 8, 22, 21, 0));
    expect(Progress.data.lastSeen).toBe(TODAY);
    expect(Progress.data.sessionMinutes).toEqual([19 * 60 + 5]);

    for (let d = 23; d <= 30; d++) Progress.markSeen(new Date(2026, 8, d, 8, 30));
    expect(Progress.data.sessionMinutes).toHaveLength(7);
    expect(Progress.data.sessionMinutes.every((m) => m === 510)).toBe(true);
  });

  it('are stamped by load', async () => {
    const s = await readStored({ version: 3, lastTopUp: todayISO() });
    expect(s.lastSeen).toBe(todayISO());
    expect(s.sessionMinutes).toHaveLength(1);
  });
});

describe('store transactions', () => {
  it('credit each transaction once, across relaunches', async () => {
    const start = Progress.data.reveals;
    expect(Progress.creditTransaction('1000000912345678', 10)).toBe(true);
    expect(Progress.creditTransaction('1000000912345678', 10)).toBe(false);
    expect(Progress.data.reveals).toBe(start + 10);
    expect(Progress.hasGrantedTx('1000000912345678')).toBe(true);

    await Progress.flush();
    await Progress.load();
    expect(Progress.creditTransaction('1000000912345678', 10)).toBe(false);
  });

  it('keep an over-long id by its tail, so the next load does not forget it', async () => {
    const long = `GPA.${'7'.repeat(80)}-${'x'.repeat(10)}`;
    expect(Progress.creditTransaction(long, 10, 'late-purchase')).toBe(true);
    await Progress.flush();
    await Progress.load();
    expect(Progress.hasGrantedTx(long)).toBe(true);
  });

  /*
   * A grant into the placeholder would be reported as paid and then replaced
   * by load(). For a purchase that is worse than a lost reveal: the caller
   * would finish the transaction and StoreKit would never deliver it again.
   * Refused instead, and the id is not recorded, so the caller leaves it
   * unfinished and the redelivery after load pays it.
   */
  it('credit nothing before the save is read, so the purchase is redelivered', async () => {
    vi.resetModules();
    const cold = (await import('./Progress')).Progress;
    expect(cold.creditTransaction('2000000111', 10)).toBe(false);
    expect(cold.grantReveals(3, 'purchase')).toBe(false);
    expect(cold.payAdReveals(1, NOW)).toBe(false);
    cold.recordGrantedTx('2000000111');
    expect(cold.hasGrantedTx('2000000111')).toBe(false);

    disk.set(KEY, JSON.stringify({ version: 3, lastTopUp: todayISO(), reveals: 5 }));
    await cold.load();
    expect(cold.creditTransaction('2000000111', 10)).toBe(true);
    expect(cold.hasGrantedTx('2000000111')).toBe(true);
    expect(cold.data.reveals).toBe(15);
  });

  it('refuse a transaction with no id or no reveals', () => {
    expect(Progress.creditTransaction('', 10)).toBe(false);
    expect(Progress.creditTransaction('t', 0)).toBe(false);
    expect(Progress.data.grantedTx).toEqual([]);
  });

  it('remember the newest hundred', () => {
    for (let i = 0; i < 105; i++) Progress.recordGrantedTx(`tx${i}`);
    expect(Progress.data.grantedTx).toHaveLength(100);
    expect(Progress.hasGrantedTx('tx4')).toBe(false);
    expect(Progress.hasGrantedTx('tx104')).toBe(true);
  });
});

describe('small flags', () => {
  it('teaches each lesson once', () => {
    expect(Progress.teach('mirror')).toBe(true);
    expect(Progress.teach('mirror')).toBe(false);
    expect(Progress.isTaught('mirror')).toBe(true);
    expect(Progress.isTaught('reveal')).toBe(false);
  });

  it('keeps the reminders switch, the ask count and the starter flags', () => {
    expect(Progress.data.reminders).toBe(true);
    Progress.setReminders(false);
    expect(Progress.data.reminders).toBe(false);

    for (let i = 0; i < 5; i++) Progress.recordNudgeAsk(TODAY);
    expect(Progress.data.nudgeAsks).toBe(3);
    expect(Progress.data.nudgeAskedOn).toBe(TODAY);

    Progress.markStarterSeen();
    Progress.markStarterBought();
    expect(Progress.data.starterSeen).toBe(true);
    expect(Progress.data.starterBought).toBe(true);
  });

  it('survive a save and reload, with everything else new', async () => {
    const today = todayISO();
    Progress.update({
      bookmarks: 2,
      chapterMarks: ['0:10', '3:20'],
      starterBought: true,
      starterSeen: true,
      rewardedDay: today,
      rewardedToday: 3,
      grantedTx: ['a', 'b'],
      taught: ['reveal'],
      reminders: false,
      nudgeAsks: 2,
      nudgeAskedOn: shiftISO(today, -8),
      sessionMinutes: [600, 1140],
      lastSeen: today,
      lastTopUp: today,
      lastRepair: shiftISO(today, -3),
      unlockedIndex: 20,
      missions: missionsOf(['daily', 'new2', 'best'], today),
    });
    await Progress.flush();
    const s = await Progress.load();
    expect(s).toMatchObject({
      bookmarks: 2,
      chapterMarks: ['0:10', '3:20'],
      starterBought: true,
      starterSeen: true,
      rewardedDay: today,
      rewardedToday: 3,
      grantedTx: ['a', 'b'],
      taught: ['reveal'],
      reminders: false,
      nudgeAsks: 2,
      nudgeAskedOn: shiftISO(today, -8),
      sessionMinutes: [600, 1140],
      lastRepair: shiftISO(today, -3),
      missions: missionsOf(['daily', 'new2', 'best'], today),
    });
  });
});

/*
 * Every 1.4 field, one hostile shape at a time. Same reasoning as the block at
 * the top: a saved value is untrusted input, and each of these reaches a menu
 * or a win card that does arithmetic or date stepping on it.
 */
describe('reading hostile 1.4 fields', () => {
  const today = todayISO();
  /** Read a save carrying `extra`, pinned so load()'s own top-up/stamps stay out of the way. */
  const read = (extra: Record<string, unknown>) =>
    readStored({ version: 3, lastTopUp: today, lastSeen: today, ...extra });

  it('bookmarks: clamps to 0..cap and drops what is not a number', async () => {
    expect((await read({ bookmarks: -3 })).bookmarks).toBe(0);
    expect((await read({ bookmarks: 7 })).bookmarks).toBe(economy.streak.bookmarkMax);
    expect((await read({ bookmarks: 1.7 })).bookmarks).toBe(1);
    expect((await read({ bookmarks: 'two' })).bookmarks).toBe(0);
    disk.set(KEY, JSON.stringify({ version: 3, lastTopUp: today, lastSeen: today, bookmarks: Number.NaN }));
    expect((await Progress.load()).bookmarks).toBe(0);
  });

  it('bookmarked: real past dates only, sorted, once each', async () => {
    const s = await read({
      bookmarked: ['2026-02-30', 'x', 5, null, shiftISO(today, -9), shiftISO(today, -9), shiftISO(today, -20), shiftISO(today, 1)],
    });
    expect(s.bookmarked).toEqual([shiftISO(today, -20), shiftISO(today, -9)]);
    expect((await read({ bookmarked: 'yesterday' })).bookmarked).toEqual([]);
  });

  it('bookmarked: caps old history, but never inside the live run', async () => {
    // A hundred bridged days long ago: the newest sixty are kept.
    const old = Array.from({ length: 100 }, (_, i) => shiftISO(today, -400 - i * 2));
    expect((await read({ bookmarked: old })).bookmarked).toHaveLength(60);

    // A 160-day run ending today, every other day bridged: all eighty kept.
    const daily: Record<string, DailyResult> = {};
    const marked: string[] = [];
    for (let i = 0; i < 160; i++) (i % 2 ? marked.push(shiftISO(today, -i)) : (daily[shiftISO(today, -i)] = played(1)));
    const s = await read({ daily, bookmarked: marked, bookmarks: 0 });
    expect(s.bookmarked).toHaveLength(80);
    expect(Progress.dailyStreak(today)).toBe(80);
  });

  it('ignores a daily entry under a date that does not exist', async () => {
    const s = await read({ daily: { '2026-02-30': played(1), '2026-13-01': played(1), '2026-08-07': played(1) } });
    expect(Object.keys(s.daily)).toEqual(['2026-08-07']);
    expect(() => Progress.longestStreak()).not.toThrow();
  });

  it('dates: lastRepair, rewardedDay, nudgeAskedOn and lastSeen take a real date or nothing', async () => {
    const s = await read({ lastRepair: 'soon', rewardedDay: 7, nudgeAskedOn: '2026-99-01', lastSeen: 12 });
    expect(s.lastRepair).toBe('');
    expect(s.rewardedDay).toBe('');
    expect(s.nudgeAskedOn).toBe('');
    // lastSeen was garbage, then load() stamped today on it.
    expect(s.lastSeen).toBe(today);
  });

  it('missions: wrong shapes null the whole record, and progress is clamped', async () => {
    const good = missionsOf(['daily', 'wins3', 'clean'], today);
    const bad: unknown[] = [
      'missions',
      { ...good, date: 'today' },
      { ...good, ids: ['daily', 'wins3'] },
      { ...good, ids: ['wins3', 'daily', 'clean'] },
      { ...good, progress: [0, null, 0] },
      { ...good, progress: [0, 0] },
      { ...good, paid: [false, 'no', false] },
    ];
    for (const m of bad) expect((await read({ unlockedIndex: 30, missions: m })).missions, JSON.stringify(m)).toBeNull();

    const clamped = await read({ unlockedIndex: 30, missions: { ...good, progress: [-4, 99, 0.5], paid: [false, false, true] } });
    expect(clamped.missions).toEqual({ ...good, progress: [0, 3, 1], paid: [false, true, true] });
  });

  it('chapterMarks: named marks only, once each', async () => {
    expect((await read({ chapterMarks: ['0:10', '0:10', '15:10', 'x', 3, '14:20'] })).chapterMarks).toEqual(['0:10', '14:20']);
    expect((await read({ chapterMarks: { '0:10': true } })).chapterMarks).toEqual([]);
  });

  it('flags: only a real true is true, and reminders only a real false is off', async () => {
    const s = await read({ starterBought: 'true', starterSeen: 1, reminders: 'false' });
    expect(s.starterBought).toBe(false);
    expect(s.starterSeen).toBe(false);
    expect(s.reminders).toBe(true);
    expect((await read({ reminders: false })).reminders).toBe(false);
  });

  it('counts: rewardedToday and nudgeAsks clamp to their caps', async () => {
    const s = await read({ rewardedToday: 99, nudgeAsks: 9 });
    expect(s.rewardedToday).toBe(economy.rewardedRevealsPerDay);
    expect(s.nudgeAsks).toBe(3);
    const t = await read({ rewardedToday: -1, nudgeAsks: 'lots' });
    expect(t.rewardedToday).toBe(0);
    expect(t.nudgeAsks).toBe(0);
  });

  it('grantedTx: 1–64 characters, once each, newest hundred', async () => {
    const s = await read({ grantedTx: ['', 'a'.repeat(65), 7, 'tx1', 'tx2', 'tx1'] });
    expect(s.grantedTx).toEqual(['tx2', 'tx1']);
    const many = Array.from({ length: 150 }, (_, i) => `t${i}`);
    const t = await read({ grantedTx: many });
    expect(t.grantedTx).toHaveLength(100);
    expect(t.grantedTx[99]).toBe('t149');
  });

  it('taught: the known lessons, once each', async () => {
    expect((await read({ taught: ['mirror', 'mirror', 'dance', 1, 'reveal'] })).taught).toEqual(['mirror', 'reveal']);
  });

  it('sessionMinutes: whole minutes of a day, the last seven', async () => {
    const s = await read({ sessionMinutes: [1440, -1, 3.5, 'x', 600, 1, 2, 3, 4, 5, 6, 7] });
    expect(s.sessionMinutes).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect((await read({ sessionMinutes: { 0: 600 } })).sessionMinutes).toEqual([]);
  });

  it('fills every 1.4 field on a 1.3 save', async () => {
    const s = await readStored({ version: 3, unlockedIndex: 12, lastTopUp: today });
    expect(s).toMatchObject({
      bookmarks: 0,
      bookmarked: [],
      lastRepair: '',
      missions: null,
      chapterMarks: [],
      starterBought: false,
      starterSeen: false,
      rewardedDay: '',
      rewardedToday: 0,
      grantedTx: [],
      taught: [],
      reminders: true,
      nudgeAsks: 0,
      nudgeAskedOn: '',
    });
    expect(s.version).toBe(3);
  });
});

/*
 * What the review prompt reads (see Rate): the distinct days the game has been
 * played on, and the version its one ask was spent on. Both arrived after 1.3,
 * so both have to read sensibly off a save that lacks them — a 1.3 veteran must
 * not be made to wait a day for an ask their history already earned — and off
 * one that holds garbage.
 */
describe('play days and the review prompt', () => {
  const today = todayISO();
  /** Noon on `iso`, local time: the moment a figure drawn that day carries. */
  const noon = (iso: string): number => Date.parse(`${iso}T12:00:00`);
  const drawnOn = (iso: string, n: number): SavedFigure => ({ ...figure(n), at: noon(iso) });

  it('start at nothing, with nothing spent', () => {
    expect(Progress.data.playDays).toBe(0);
    expect(Progress.data.ratePromptedVersion).toBe('');
  });

  it('counts the first launch as the first day', async () => {
    disk.clear();
    const s = await Progress.load();
    expect(s.playDays).toBe(1);
  });

  it('counts each distinct day once, and never a day the clock went back to', () => {
    Progress.markSeen(new Date(2026, 8, 22, 9, 0));
    Progress.markSeen(new Date(2026, 8, 22, 23, 59));
    expect(Progress.data.playDays).toBe(1);
    Progress.markSeen(new Date(2026, 8, 23, 0, 1));
    expect(Progress.data.playDays).toBe(2);
    // A clock set back a day: repaired, not counted.
    Progress.markSeen(new Date(2026, 8, 22, 12, 0));
    expect(Progress.data.playDays).toBe(2);
    Progress.markSeen(new Date(2026, 8, 25, 12, 0));
    expect(Progress.data.playDays).toBe(3);
  });

  it('reads a 1.3 save’s days off its ledger and its figures, today counted once', async () => {
    const s = await readStored({
      version: 3,
      lastTopUp: today,
      daily: {
        [shiftISO(today, -10)]: played(1),
        [shiftISO(today, -3)]: played(1),
        [today]: played(1),
      },
      figures: [drawnOn(shiftISO(today, -3), 1), drawnOn(shiftISO(today, -20), 2), drawnOn(today, 3)],
    });
    // -20, -10 and -3 from the save, and today from the launch.
    expect(s.playDays).toBe(4);
  });

  it('reads a save with session samples but no count off the samples', async () => {
    const s = await readStored({ version: 3, lastTopUp: today, lastSeen: today, sessionMinutes: [600, 700, 800] });
    // Three sampled days, today among them, so the launch adds none.
    expect(s.playDays).toBe(3);
  });

  it('starts a 1.3 save that dated nothing at its first day', async () => {
    const s = await readStored({ version: 3, lastTopUp: today, unlockedIndex: 0 });
    expect(s.playDays).toBe(1);
  });

  it('keeps a stored count over the evidence', async () => {
    const s = await readStored({
      version: 3,
      lastTopUp: today,
      lastSeen: today,
      playDays: 1,
      daily: { [shiftISO(today, -5)]: played(1), [shiftISO(today, -4)]: played(1) },
    });
    expect(s.playDays).toBe(1);
  });

  it('playDays: a whole count, and garbage falls back to the evidence', async () => {
    const read = (playDays: unknown) =>
      readStored({ version: 3, lastTopUp: today, lastSeen: today, playDays });
    expect((await read(-3)).playDays).toBe(0);
    expect((await read(2.7)).playDays).toBe(2);
    // The evidence here is lastSeen alone: one day.
    expect((await read('many')).playDays).toBe(1);
    expect((await read(null)).playDays).toBe(1);
    disk.set(KEY, `{"version":3,"lastTopUp":"${today}","lastSeen":"${today}","playDays":1e999}`);
    expect((await Progress.load()).playDays).toBe(1);
  });

  it('ratePromptedVersion: a short string or nothing', async () => {
    const read = (ratePromptedVersion: unknown) =>
      readStored({ version: 3, lastTopUp: today, lastSeen: today, ratePromptedVersion });
    expect((await read('1.3')).ratePromptedVersion).toBe('1.3');
    expect((await read(1.4)).ratePromptedVersion).toBe('');
    expect((await read(null)).ratePromptedVersion).toBe('');
    expect((await read('9'.repeat(33))).ratePromptedVersion).toBe('');
  });

  it('reads an ask spent before 1.4 as spent on no version this build can name', async () => {
    const s = await readStored({ version: 3, lastTopUp: today, ratePrompted: true });
    expect(s.ratePrompted).toBe(true);
    expect(s.ratePromptedVersion).toBe('');
  });

  it('survive a save and reload', async () => {
    Progress.update({ playDays: 12, ratePromptedVersion: '1.4', lastSeen: today, lastTopUp: today });
    await Progress.flush();
    const s = await Progress.load();
    expect(s.playDays).toBe(12);
    expect(s.ratePromptedVersion).toBe('1.4');
  });

  it('counts every skip this launch, saved nowhere', async () => {
    const before = Progress.skipsSinceLaunch;
    Progress.unlockThrough(40, LEVELS.length);
    // A skip over a level already behind the frontier is still a skip.
    Progress.unlockThrough(3, LEVELS.length);
    expect(Progress.skipsSinceLaunch).toBe(before + 2);
    await Progress.flush();
    const saved = Object.keys(JSON.parse(disk.get(KEY) ?? '{}') as object);
    expect(saved.some((k) => /skip/i.test(k))).toBe(false);
  });
});

/*
 * 1.5 (§7 of the redesign): stars are DERIVED from a stored measurement, the
 * best line ÷ par, so a threshold can move without a migration and without
 * taking a star back. What is tested here is the save's half of that promise:
 * what is kept, what is refused, and that a 1.4 player opens 1.5 with every
 * medal already worth two stars and nothing written to make it so.
 */
describe('stars: the measurement kept, the stars derived', () => {
  const today = todayISO();

  /** A save exactly as 1.4 wrote it: no bestRatio, no teachMirrorN. */
  const SAVE_1_4 = {
    version: 3,
    unlockedIndex: 9,
    bestMs: { l1: 4100, l2: 5200, l3: 6100, l6: 9000 },
    cleared: ['l1', 'l2', 'l3', 'l6'],
    reveals: 4,
    lastTopUp: today,
    lastSeen: today,
    adsRemoved: false,
    totalWins: 7,
    winsSinceAd: 1,
    attemptsSinceAd: 0,
    ratePrompted: false,
    figures: [],
    daily: {},
    medals: ['l1', 'l6'],
    foldSense: 61,
    sound: true,
    music: true,
    haptics: true,
    reducedMotion: false,
    capability: 'mp4',
    bookmarks: 0,
    bookmarked: [],
    lastRepair: '',
    missions: null,
    chapterMarks: [],
    starterBought: false,
    starterSeen: true,
    rewardedDay: '',
    rewardedToday: 0,
    grantedTx: [],
    taught: ['mirror'],
    reminders: true,
    nudgeAsks: 0,
    nudgeAskedOn: '',
    sessionMinutes: [600],
    playDays: 3,
    ratePromptedVersion: '',
  };

  it('reads a 1.4 save with every medal already two stars, and writes nothing to do it', async () => {
    const s = await readStored(SAVE_1_4);
    expect(s.bestRatio).toEqual({});
    expect(Progress.stars('l1')).toBe(2);
    expect(Progress.stars('l6')).toBe(2);
    expect(Progress.stars('l2')).toBe(1);
    expect(Progress.stars('l4')).toBe(0);
    expect(Progress.totalStars()).toBe(2 + 1 + 1 + 2);
    // The medal list is exactly what 1.4 left: two stars are derived, not granted.
    expect(s.medals).toEqual(['l1', 'l6']);
  });

  it('keeps the best line only ever falling, at three decimals', () => {
    Progress.recordWin('l7', 6, 5000, LEVELS.length);
    expect(Progress.recordRatio('l7', 1.23456)).toEqual({ line: 2, stars: 2, best: 1.235, newBest: true });
    expect(Progress.recordRatio('l7', 1.4)).toEqual({ line: 1, stars: 2, best: 1.235, newBest: false });
    expect(Progress.data.bestRatio.l7).toBe(1.235);
    expect(Progress.recordRatio('l7', 1.0904)).toEqual({ line: 3, stars: 3, best: 1.09, newBest: true });
    expect(Progress.recordRatio('l7', 1.2)).toMatchObject({ line: 2, stars: 3, best: 1.09 });
    expect(Progress.data.bestRatio.l7).toBe(1.09);
  });

  it('still writes the medal for a two-star line, so a 1.4 build keeps showing it', () => {
    Progress.recordWin('l8', 7, 5000, LEVELS.length);
    Progress.recordRatio('l8', 1.31);
    expect(Progress.hasMedal('l8')).toBe(false);
    Progress.recordRatio('l8', 1.25);
    expect(Progress.hasMedal('l8')).toBe(true);
    Progress.recordRatio('l8', 1.02);
    expect(Progress.data.medals.filter((m) => m === 'l8')).toHaveLength(1);
  });

  it('never makes a third star out of a medal: only a line does', async () => {
    await readStored(SAVE_1_4);
    expect(Progress.stars('l1')).toBe(2);
    Progress.recordRatio('l1', 1.3); // a worse line takes nothing
    expect(Progress.stars('l1')).toBe(2);
    Progress.recordRatio('l1', 1.1);
    expect(Progress.stars('l1')).toBe(3);
  });

  it('keeps nothing for a Daily, and reports its line alone', () => {
    const before = Progress.data;
    expect(Progress.recordRatio('daily-2026-09-27', 1.02)).toEqual({ line: 3, stars: 0, best: null, newBest: false });
    expect(Progress.data.bestRatio).toEqual({});
    expect(Progress.data.medals).toEqual([]);
    expect(Progress.data).toBe(before);
  });

  it('counts a win with no par as a clear, and measures nothing', () => {
    Progress.recordWin('l9', 8, 5000, LEVELS.length);
    expect(Progress.recordRatio('l9', null)).toEqual({ line: 1, stars: 1, best: null, newBest: false });
    expect(Progress.data.bestRatio).toEqual({});
  });

  it('reports the stars a level held before the win, for the card', () => {
    const first = Progress.snapshotForWin('l10', 9);
    expect(first).toMatchObject({ starsBefore: 0, bestRatioBefore: null });
    Progress.recordWin('l10', 9, 5000, LEVELS.length);
    Progress.recordRatio('l10', 1.18);
    expect(Progress.snapshotForWin('l10', 9)).toMatchObject({ starsBefore: 2, bestRatioBefore: 1.18 });
  });

  it('counts this win in the chapter stars the card shows', () => {
    Progress.update({ unlockedIndex: 3, cleared: ids(0, 3), medals: ['l1'] });
    const id = LEVELS[3].id;
    const before = Progress.snapshotForWin(id, 3, NOW);
    Progress.recordWin(id, 3, 5000, LEVELS.length);
    Progress.recordRatio(id, 1.05);
    const out = Progress.settleWin(
      before,
      { levelId: id, levelIndex: 3, dailyDate: null, todayDailyFirst: false, medal: true, deaths: 0, ms: 5000 },
      NOW
    );
    // l1 medal ★★, l2 and l3 ★, this line ★★★.
    expect(out.chapter?.stars).toBe(2 + 1 + 1 + 3);
  });

  it('survives a save and reload', async () => {
    Progress.recordWin('l12', 11, 5000, LEVELS.length);
    Progress.recordRatio('l12', 1.07);
    Progress.update({ lastSeen: today, lastTopUp: today });
    await Progress.flush();
    const s = await Progress.load();
    expect(s.bestRatio).toEqual({ l12: 1.07 });
    expect(Progress.stars('l12')).toBe(3);
  });

  it('refuses a ratio that is not a positive number, an id outside the campaign, and a reauthored id', async () => {
    const s = await readStored({
      version: 2,
      lastTopUp: today,
      lastSeen: today,
      cleared: ['l1', 'l6', 'l7', 'l8', 'l9', 'l10'],
      bestRatio: {
        l1: 1.01, // a v2 tutorial id: it named another maze
        l6: 1.123456,
        l7: 'fast',
        l8: -1,
        l9: 0,
        l10: Number.MAX_VALUE * 2, // JSON writes Infinity as null
        l999: 1.1,
        'daily-2026-09-01': 1.0,
        constructor: 1.0,
      },
    });
    expect(s.bestRatio).toEqual({ l6: 1.123 });
    expect(Progress.stars('l6')).toBe(2);
    expect(Progress.stars('l7')).toBe(1);
    // A prototype key is never a level, and never a star.
    expect(Progress.bestRatioOf('constructor')).toBeNull();
    expect(Progress.bestRatioOf('toString')).toBeNull();
  });

  it('reads a bestRatio that is not a table as none', async () => {
    expect((await readStored({ version: 3, lastTopUp: today, bestRatio: [1.1, 1.2] })).bestRatio).toEqual({});
    expect((await readStored({ version: 3, lastTopUp: today, bestRatio: 'x' })).bestRatio).toEqual({});
    expect((await readStored({ version: 3, lastTopUp: today, bestRatio: null })).bestRatio).toEqual({});
  });

  /*
   * The medal achievements count `medals`, which a two-star line still
   * writes: Game Center keeps paying for the second star under its old name.
   */
  it('keeps the medal achievements earned by two-star lines', () => {
    const ten = ACHIEVEMENTS.find((a) => a.id === 'foldwing.medal.ten')!;
    for (let i = 0; i < 10; i++) {
      Progress.recordWin(LEVELS[i].id, i, 5000, LEVELS.length);
      Progress.recordRatio(LEVELS[i].id, i < 9 ? 1.2 : 1.3);
    }
    expect(ten.earned(Progress.data)).toBe(false);
    Progress.recordRatio(LEVELS[9].id, 1.09);
    expect(ten.earned(Progress.data)).toBe(true);
  });

  it('stays inside the +20 KB budget with a measurement on every level', () => {
    const empty = JSON.stringify(Progress.data).length;
    for (let i = 0; i < LEVELS.length; i++) {
      Progress.recordWin(LEVELS[i].id, i, 5000, LEVELS.length);
      Progress.recordRatio(LEVELS[i].id, 1.123456 + i / 1000);
    }
    const bytes = JSON.stringify({ ...Progress.data, cleared: [], medals: [], bestMs: {} }).length - empty;
    expect(bytes).toBeLessThan(20_000);
    expect(bytes).toBeGreaterThan(0);
  });
});

describe('the reflection label', () => {
  const today = todayISO();
  const read = (extra: Record<string, unknown>) => readStored({ version: 3, lastTopUp: today, lastSeen: today, ...extra });

  it('labels the first three mirror deaths of a save, then goes plain', () => {
    expect([1, 2, 3, 4, 5].map(() => Progress.mirrorLabel())).toEqual([true, true, true, false, false]);
    expect(Progress.data.teachMirrorN).toBe(MIRROR_LABELS);
  });

  it('owes a player the old lesson already reached two more, not three', async () => {
    expect((await read({ taught: ['mirror'] })).teachMirrorN).toBe(1);
    expect((await read({ taught: ['reveal'] })).teachMirrorN).toBe(0);
    expect((await read({ taught: ['mirror'], teachMirrorN: 3 })).teachMirrorN).toBe(3);
    expect((await read({ taught: ['mirror'], teachMirrorN: 0 })).teachMirrorN).toBe(0);
  });

  it('clamps a hostile count to 0..3', async () => {
    expect((await read({ teachMirrorN: 99 })).teachMirrorN).toBe(3);
    expect((await read({ teachMirrorN: -4 })).teachMirrorN).toBe(0);
    expect((await read({ teachMirrorN: 1.9 })).teachMirrorN).toBe(1);
    expect((await read({ teachMirrorN: 'twice', taught: ['mirror'] })).teachMirrorN).toBe(1);
  });

  it('survives a save and reload', async () => {
    Progress.mirrorLabel();
    Progress.mirrorLabel();
    Progress.update({ lastSeen: today, lastTopUp: today });
    await Progress.flush();
    expect((await Progress.load()).teachMirrorN).toBe(2);
    expect(Progress.mirrorLabel()).toBe(true);
    expect(Progress.mirrorLabel()).toBe(false);
  });
});

/*
 * A save written by a NEWER build used to lose its new fields the moment an
 * older build opened it: coerce() rebuilds the object from the keys it knows.
 * The owner switches TestFlight builds, so from 1.5 on an unknown top-level
 * key rides through untouched.
 */
describe('fields from a newer build', () => {
  const today = todayISO();

  it('survive a round trip through this build', async () => {
    const future = { ink: 'indigo', inksSeen: ['sepia', 'indigo'], chain: 4, folio: { tiers: [1, 2] } };
    await readStored({ version: 3, lastTopUp: today, lastSeen: today, reveals: 2, ...future });
    Progress.grantReveals(1, 'purchase');
    await Progress.flush();
    const written = JSON.parse(disk.get(KEY) ?? '{}') as Record<string, unknown>;
    expect(written).toMatchObject(future);
    expect(written.reveals).toBe(3);
    // And again, through a second load.
    await Progress.load();
    await Progress.flush();
    expect(JSON.parse(disk.get(KEY) ?? '{}')).toMatchObject(future);
  });

  it('never override a field this build knows', async () => {
    const s = await readStored({ version: 3, lastTopUp: today, reveals: 'lots', cleared: 'all' });
    expect(s.reveals).toBe(monetization.reveals.startingStash);
    expect(s.cleared).toEqual([]);
  });

  it('cannot reach the object prototype through a __proto__ key', async () => {
    const s = await readRaw(`{"version":3,"lastTopUp":"${today}","__proto__":{"adsRemoved":true,"reveals":999}}`);
    expect(Object.getPrototypeOf(s)).toBe(Object.prototype);
    expect(s.adsRemoved).toBe(false);
    expect(({} as Record<string, unknown>).reveals).toBeUndefined();
  });

  it('never come from a save that is an array', async () => {
    const s = await readStored([1, 2, 3]);
    expect(Object.keys(s)).not.toContain('0');
  });

  it('are dropped by a dev reset, like everything else', async () => {
    await readStored({ version: 3, lastTopUp: today, chain: 4 });
    await Progress.reset();
    expect(JSON.parse(disk.get(KEY) ?? '{}')).not.toHaveProperty('chain');
  });
});
