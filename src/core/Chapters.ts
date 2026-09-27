/**
 * Chapters — the names of the fifteen twenties, and what a chapter shows.
 *
 * A campaign of three hundred numbers is a climb nobody sees the top of; a
 * chapter with a name is a place. The names climb the way the mazes do, from
 * the first fold of a sheet to the wing it becomes, and they are told apart by
 * name and numeral only — never by a colour wash, so the one accent stays one.
 *
 * Chapter unlocking is NOT here and does not change: levels open by clearing,
 * skips allowed (Progress.unlockedIndex). Stars never gate anything.
 *
 * Pure: the words, the ranges, the twenty beads every chapter row draws (the
 * menu's Continue card, the thread row in play, the result card), the mark
 * still ahead ("+1 at 10 — two to go") and the Levels strip's tiles.
 */

import { CHAPTER_SIZE, LEVELS } from '../data/levels';
import { CHAPTER_COUNT, chapterIndices, chapterOf, MARK_AT, type MarkAt } from './Rewards';
import { MAX_STARS, starsAt, type StarSave } from './Stars';

/** In order, chapter 0 first. One per twenty levels; a test holds it to CHAPTER_COUNT. */
export const CHAPTER_NAMES: readonly string[] = [
  'First Fold',
  'Crease',
  'Hinge',
  'Pleat',
  'Seam',
  'Gate',
  'Span',
  'Knot',
  'Weave',
  'Lattice',
  'Tangle',
  'Labyrinth',
  'Tessellate',
  'Origami',
  'The Wing',
];

const clampChapter = (c: number): number =>
  Math.min(CHAPTER_COUNT - 1, Math.max(0, Number.isFinite(c) ? Math.trunc(c) : 0));

/** 1 → "I", 14 → "XIV". For the numbers a chapter can have; anything else is its digits. */
export function roman(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 3999) return String(n);
  const table: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  let rest = n;
  for (const [v, s] of table) {
    while (rest >= v) {
      out += s;
      rest -= v;
    }
  }
  return out;
}

/** "Hinge" for chapter 2 (0-based). */
export function chapterName(c: number): string {
  return CHAPTER_NAMES[clampChapter(c)];
}

/** "III" for chapter 2 (0-based). */
export function chapterNumeral(c: number): string {
  return roman(clampChapter(c) + 1);
}

/** "Chapter III · Hinge" — the kicker, in sentence case; the UI sets its own caps. */
export function chapterTitle(c: number): string {
  return `Chapter ${chapterNumeral(c)} · ${chapterName(c)}`;
}

/** The level NUMBERS (1-based, as every card prints them) chapter `c` spans. */
export function chapterFolds(c: number): { first: number; last: number } {
  const ix = chapterIndices(clampChapter(c));
  return { first: ix[0] + 1, last: ix[ix.length - 1] + 1 };
}

/** "Folds 41–60". */
export function foldsLabel(c: number): string {
  const { first, last } = chapterFolds(c);
  return `Folds ${first}–${last}`;
}

/** The chapter a level id belongs to, or null for an id outside the campaign (the Daily). */
export function chapterOfId(id: string): number | null {
  const i = LEVELS.findIndex((l) => l.id === id);
  return i < 0 ? null : chapterOf(i);
}

/** A level's place inside its chapter, 1..20: the "7" of "7 of 20". */
export function foldInChapter(levelIndex: number): number {
  const i = Math.max(0, Math.trunc(levelIndex));
  return (i % CHAPTER_SIZE) + 1;
}

/**
 * One chapter bead:
 *  - `gold`     cleared at ★★★
 *  - `cleared`  cleared (ink)
 *  - `current`  the level being played, or the one Continue leads to — this
 *               wins over the others, so a replay shows where the player is
 *  - `skipped`  let past without clearing: open, below the frontier
 *  - `open`     not reached yet (sunk)
 */
export type Bead = 'gold' | 'cleared' | 'current' | 'skipped' | 'open';

/**
 * The beads of chapter `c`, one per level in order. `current` is a level
 * INDEX (not a chapter slot); `unlockedIndex` is the save's frontier, which
 * tells a skip from a level not reached.
 */
export function chapterBeads(
  save: StarSave & { readonly unlockedIndex?: number },
  c: number,
  current?: number | null
): Bead[] {
  const indices = chapterIndices(clampChapter(c));
  const stars = starsAt(save, indices);
  const frontier = save.unlockedIndex ?? -1;
  return indices.map((i, k): Bead => {
    if (i === current) return 'current';
    if (stars[k] === 3) return 'gold';
    if (stars[k] > 0) return 'cleared';
    return i < frontier ? 'skipped' : 'open';
  });
}

/* ------------------------------------------------------ the next mark */

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** "two" for 2, "12" for 12: small counts read as words in running copy. */
export function countWord(n: number): string {
  return Number.isInteger(n) && n >= 0 && n < WORDS.length ? WORDS[n] : String(n);
}

/**
 * The chapter mark still ahead of `cleared` folds in a chapter of `size`, and
 * how many clears it wants; null once both are reached. The same rule the
 * marks are paid by (Rewards.dueMarks), so the promise and the payment agree.
 */
export function nextMark(cleared: number, size: number = CHAPTER_SIZE): { at: MarkAt; toGo: number } | null {
  const n = Number.isFinite(cleared) ? Math.max(0, Math.trunc(cleared)) : 0;
  for (const at of MARK_AT) {
    const need = Math.min(at, size);
    if (n < need) return { at, toGo: need - n };
  }
  return null;
}

/**
 * "+1 at 10 — two to go": the chapter row's promise, or null with both marks
 * reached. The reward comes from the caller's economy (monetization.economy
 * .chapter), exactly as Rewards.markReward reads it; this file keeps no prices.
 */
export function nextMarkLine(
  cleared: number,
  cfg: { readonly halfReward: number; readonly fullReward: number },
  size: number = CHAPTER_SIZE
): string | null {
  const m = nextMark(cleared, size);
  if (!m) return null;
  const reward = m.at === 20 ? cfg.fullReward : cfg.halfReward;
  return `+${reward} at ${m.at} — ${countWord(m.toGo)} to go`;
}

/* ------------------------------------------------------ the chapter strip */

/**
 * One chapter in the Levels strip:
 *  - `done`     all twenty cleared (a `gilt` badge when every star is in)
 *  - `current`  holds the frontier: where Continue leads
 *  - `open`     reached, not finished, and not where the frontier is (skips)
 *  - `locked`   its first fold is past the frontier — "61+"
 *
 * Locked is a picture of the frontier and nothing more: levels open by
 * clearing, exactly as before. Stars never open or close anything.
 */
export type ChapterStatus = 'done' | 'current' | 'open' | 'locked';

export interface ChapterTile {
  readonly chapter: number;
  readonly status: ChapterStatus;
  /** Folds cleared, of `size`. */
  readonly cleared: number;
  readonly size: number;
  /** Stars earned, of `max` (3 per fold). */
  readonly stars: number;
  readonly max: number;
  /** Folds at ★★★. */
  readonly three: number;
  /** Every star of the chapter is in. */
  readonly gilt: boolean;
  /** The first fold's number (1-based): the "61" of "61+". */
  readonly first: number;
}

/** The fold the frontier points at: the save's unlockedIndex, kept on the ladder. */
export function frontierIndex(save: { readonly unlockedIndex?: number }): number {
  const u = save.unlockedIndex;
  const i = typeof u === 'number' && Number.isFinite(u) ? Math.trunc(u) : 0;
  return Math.min(LEVELS.length - 1, Math.max(0, i));
}

/** Every chapter's tile, in order, from one read of the save. */
export function chapterTiles(save: StarSave & { readonly unlockedIndex?: number }): ChapterTile[] {
  const frontier = frontierIndex(save);
  const current = chapterOf(frontier);
  const tiles: ChapterTile[] = [];
  for (let c = 0; c < CHAPTER_COUNT; c++) {
    const indices = chapterIndices(c);
    const stars = starsAt(save, indices);
    const cleared = stars.filter((n) => n > 0).length;
    const earned = stars.reduce<number>((s, n) => s + n, 0);
    const max = indices.length * MAX_STARS;
    let status: ChapterStatus;
    if (indices[0] > frontier) status = 'locked';
    else if (cleared === indices.length) status = 'done';
    else if (c === current) status = 'current';
    else status = 'open';
    tiles.push({
      chapter: c,
      status,
      cleared,
      size: indices.length,
      stars: earned,
      max,
      three: stars.filter((n) => n === 3).length,
      gilt: earned === max,
      first: indices[0] + 1,
    });
  }
  return tiles;
}
