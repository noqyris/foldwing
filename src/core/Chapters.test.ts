import { describe, expect, it } from 'vitest';
import { monetization } from '../config/monetization';
import { CHAPTER_SIZE, LEVELS } from '../data/levels';
import {
  CHAPTER_NAMES,
  chapterBeads,
  chapterFolds,
  chapterName,
  chapterNumeral,
  chapterOfId,
  chapterTiles,
  chapterTitle,
  countWord,
  foldInChapter,
  foldsLabel,
  frontierIndex,
  nextMark,
  nextMarkLine,
  roman,
} from './Chapters';
import { CHAPTER_COUNT, dueMarks, MARK_AT } from './Rewards';

const ids = (from: number, to: number): string[] => LEVELS.slice(from, to).map((l) => l.id);

describe('chapter names', () => {
  it('names every chapter, once, climbing from the first fold to the wing', () => {
    expect(CHAPTER_NAMES).toHaveLength(CHAPTER_COUNT);
    expect(CHAPTER_COUNT).toBe(15);
    expect(new Set(CHAPTER_NAMES).size).toBe(CHAPTER_NAMES.length);
    expect(CHAPTER_NAMES[0]).toBe('First Fold');
    expect(CHAPTER_NAMES[2]).toBe('Hinge');
    expect(CHAPTER_NAMES[14]).toBe('The Wing');
    expect([...CHAPTER_NAMES]).toEqual([
      'First Fold', 'Crease', 'Hinge', 'Pleat', 'Seam',
      'Gate', 'Span', 'Knot', 'Weave', 'Lattice',
      'Tangle', 'Labyrinth', 'Tessellate', 'Origami', 'The Wing',
    ]);
  });

  it('writes the numerals the way the chapter cards print them', () => {
    expect([1, 2, 3, 4, 5, 9, 14, 15].map(roman)).toEqual(['I', 'II', 'III', 'IV', 'V', 'IX', 'XIV', 'XV']);
    expect(roman(0)).toBe('0');
    expect(roman(2.5)).toBe('2.5');
    expect(chapterNumeral(2)).toBe('III');
    expect(chapterTitle(2)).toBe('Chapter III · Hinge');
    expect(chapterTitle(14)).toBe('Chapter XV · The Wing');
  });

  it('clamps a chapter it cannot have to the ladder, never throwing', () => {
    expect(chapterName(-3)).toBe('First Fold');
    expect(chapterName(99)).toBe('The Wing');
    expect(chapterName(Number.NaN)).toBe('First Fold');
    expect(chapterNumeral(1.7)).toBe('II');
  });

  it('spans twenty folds a chapter, numbered as the cards number them', () => {
    expect(chapterFolds(0)).toEqual({ first: 1, last: 20 });
    expect(chapterFolds(2)).toEqual({ first: 41, last: 60 });
    expect(foldsLabel(2)).toBe('Folds 41–60');
    expect(chapterFolds(14)).toEqual({ first: 281, last: 300 });
    expect(foldInChapter(46)).toBe(7);
    expect(foldInChapter(40)).toBe(1);
    expect(chapterOfId('l47')).toBe(2);
    expect(chapterOfId('daily-2026-09-27')).toBeNull();
  });
});

describe('the next chapter mark', () => {
  it('promises the mark ahead and how many clears it wants', () => {
    expect(nextMark(0)).toEqual({ at: 10, toGo: 10 });
    expect(nextMark(8)).toEqual({ at: 10, toGo: 2 });
    expect(nextMark(10)).toEqual({ at: 20, toGo: 10 });
    expect(nextMark(19)).toEqual({ at: 20, toGo: 1 });
    expect(nextMark(20)).toBeNull();
    expect(nextMark(Number.NaN)).toEqual({ at: 10, toGo: 10 });
  });

  it('says it the way the chapter row does, at the economy’s prices', () => {
    const cfg = monetization.economy.chapter;
    expect(nextMarkLine(8, cfg)).toBe(`+${cfg.halfReward} at 10 — two to go`);
    expect(nextMarkLine(19, cfg)).toBe(`+${cfg.fullReward} at 20 — one to go`);
    expect(nextMarkLine(0, { halfReward: 1, fullReward: 2 })).toBe('+1 at 10 — ten to go');
    expect(nextMarkLine(20, cfg)).toBeNull();
    expect(countWord(12)).toBe('12');
  });

  /*
   * The promise and the payment must agree: a mark the row says is "one to
   * go" is due after exactly one more clear, by the rule that pays it.
   */
  it('agrees with the rule that pays the marks', () => {
    for (let n = 0; n < CHAPTER_SIZE; n++) {
      const m = nextMark(n)!;
      const cleared = new Set(ids(0, n + m.toGo));
      const before = new Set(ids(0, n + m.toGo - 1));
      expect(dueMarks(cleared, new Set()), `at ${n}`).toContain(`0:${m.at}`);
      expect(dueMarks(before, new Set()), `at ${n}`).not.toContain(`0:${m.at}`);
    }
    expect(MARK_AT).toEqual([10, 20]);
  });
});

describe('beads and tiles', () => {
  it('draws the twenty beads of a chapter: gold, cleared, current, skipped, open', () => {
    const save = {
      cleared: ids(40, 46),
      medals: [LEVELS[41].id],
      bestRatio: { [LEVELS[42].id]: 1.04 },
      unlockedIndex: 48,
    };
    const beads = chapterBeads(save, 2, 48);
    expect(beads).toHaveLength(20);
    expect(beads.slice(0, 6)).toEqual(['cleared', 'cleared', 'gold', 'cleared', 'cleared', 'cleared']);
    // l47 and l48 were let past without clearing: open, below the frontier.
    expect(beads.slice(6, 9)).toEqual(['skipped', 'skipped', 'current']);
    expect(beads.slice(9).every((b) => b === 'open')).toBe(true);
    // A replay of a cleared level shows where the player is.
    expect(chapterBeads(save, 2, 42)[2]).toBe('current');
  });

  it('keeps the frontier on the ladder whatever the save says', () => {
    expect(frontierIndex({ unlockedIndex: 7 })).toBe(7);
    expect(frontierIndex({ unlockedIndex: 999 })).toBe(LEVELS.length - 1);
    expect(frontierIndex({ unlockedIndex: -4 })).toBe(0);
    expect(frontierIndex({})).toBe(0);
  });

  it('marks every chapter done, current, open or locked', () => {
    const save = {
      cleared: [...ids(0, 20), ...ids(20, 38), ...ids(40, 47)],
      medals: ids(0, 20),
      bestRatio: Object.fromEntries(ids(20, 40).map((i) => [i, 1.02])),
      unlockedIndex: 47,
    };
    const tiles = chapterTiles(save);
    expect(tiles).toHaveLength(15);
    expect(tiles[0]).toMatchObject({ status: 'done', cleared: 20, stars: 40, max: 60, three: 0, gilt: false, first: 1 });
    // Two folds of chapter II skipped: reached, not finished, not where Continue leads.
    expect(tiles[1]).toMatchObject({ status: 'open', cleared: 18, stars: 54, three: 18, gilt: false });
    expect(tiles[2]).toMatchObject({ status: 'current', cleared: 7, first: 41 });
    expect(tiles[3]).toMatchObject({ status: 'locked', cleared: 0, stars: 0, first: 61 });
    expect(tiles.slice(3).every((t) => t.status === 'locked')).toBe(true);
  });

  it('gilds a chapter only when every star is in', () => {
    const all = ids(0, 20);
    const save = { cleared: all, medals: [], bestRatio: Object.fromEntries(all.map((i) => [i, 1.0])), unlockedIndex: 20 };
    expect(chapterTiles(save)[0]).toMatchObject({ status: 'done', stars: 60, gilt: true });
    const one = { ...save, bestRatio: { ...save.bestRatio, [all[5]]: 1.2 } };
    expect(chapterTiles(one)[0]).toMatchObject({ stars: 59, gilt: false });
  });
});
