/**
 * Chapter marks pay reveals by name, once each. These pin the chapter maths the
 * level select and the win card both draw from, and the one-time backlog.
 */

import { describe, expect, it } from 'vitest';
import { monetization } from '../config/monetization';
import { CHAPTER_SIZE, LEVELS } from '../data/levels';
import {
  CHAPTER_COUNT,
  chapterIndices,
  chapterOf,
  chapterStats,
  dueMarks,
  MARK_PATTERN,
  markReward,
  parseMark,
} from './Rewards';

const cfg = monetization.economy.chapter;
const ids = (from: number, to: number): string[] => LEVELS.slice(from, to).map((l) => l.id);
const set = (a: string[]): Set<string> => new Set(a);

describe('chapters', () => {
  it('are twenty levels each, fifteen of them, in one agreed size', () => {
    expect(CHAPTER_SIZE).toBe(20);
    expect(cfg.size).toBe(CHAPTER_SIZE);
    expect(CHAPTER_COUNT).toBe(15);
    expect(chapterIndices(14)).toHaveLength(20);
  });

  it('place every level', () => {
    for (let i = 0; i < 20; i++) expect(chapterOf(i)).toBe(0);
    expect(chapterOf(20)).toBe(1);
    expect(chapterOf(299)).toBe(14);
  });

  it('never place a level outside the book', () => {
    expect(chapterOf(-1)).toBe(0);
    expect(chapterOf(Number.NaN)).toBe(0);
    expect(chapterOf(1e9)).toBe(14);
  });
});

describe('where a chapter stands', () => {
  it('counts clears and medals, and lists what was skipped', () => {
    // Chapter 2 (levels 21–40): 21–28 cleared, 29 skipped, 30 cleared, 31 is the frontier.
    const cleared = set([...ids(0, 28), 'l30']);
    const medals = set(['l21', 'l22', 'l5']);
    expect(chapterStats(cleared, medals, 1, 30)).toEqual({ cleared: 9, medals: 2, skipped: [28] });
  });

  it('infers the frontier from the furthest clear when not told', () => {
    const cleared = set([...ids(0, 28), 'l30']);
    expect(chapterStats(cleared, set([]), 1).skipped).toEqual([28]);
  });

  it('does not call the frontier itself skipped', () => {
    expect(chapterStats(set(ids(0, 5)), set([]), 0, 5).skipped).toEqual([]);
  });
});

describe('marks', () => {
  it('fall due at ten and at twenty cleared, and not before', () => {
    expect(dueMarks(set(ids(0, 9)), set([]))).toEqual([]);
    expect(dueMarks(set(ids(0, 10)), set([]))).toEqual(['0:10']);
    expect(dueMarks(set(ids(0, 19)), set([]))).toEqual(['0:10']);
    expect(dueMarks(set(ids(0, 20)), set([]))).toEqual(['0:10', '0:20']);
  });

  it('are paid once: a paid mark is never due again', () => {
    expect(dueMarks(set(ids(0, 20)), set(['0:10']))).toEqual(['0:20']);
    expect(dueMarks(set(ids(0, 20)), set(['0:10', '0:20']))).toEqual([]);
  });

  it('count clears only: a skipped level blocks the full mark', () => {
    // Nineteen cleared and the twentieth skipped (unlocked, never folded).
    const cleared = set(ids(0, 19));
    expect(dueMarks(cleared, set(['0:10']))).toEqual([]);
  });

  it('pay one at halfway and two at complete, no more than five a chapter', () => {
    expect(markReward('3:10', cfg)).toBe(1);
    expect(markReward('3:20', cfg)).toBe(2);
    expect(cfg.halfReward + cfg.fullReward).toBeLessThanOrEqual(5);
  });

  it('come to 45 at the very most, the whole book folded', () => {
    const all = dueMarks(set(LEVELS.map((l) => l.id)), set([]));
    expect(all).toHaveLength(30);
    expect(all.reduce((s, m) => s + markReward(m, cfg), 0)).toBe(45);
  });

  it('are named so the save can check them', () => {
    for (const m of dueMarks(set(LEVELS.map((l) => l.id)), set([]))) expect(MARK_PATTERN.test(m)).toBe(true);
    for (const bad of ['15:10', '1:15', '01:10', '-1:10', '1:10 ', '']) expect(MARK_PATTERN.test(bad)).toBe(false);
    expect(parseMark('14:20')).toEqual({ chapter: 14, at: 20 });
    expect(parseMark('x')).toBeNull();
  });
});
