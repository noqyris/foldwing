/**
 * Chapter marks — the reward on the way through each twenty levels.
 *
 * Every chapter pays twice: a small mark at ten cleared and a bigger one at all
 * twenty. A win then always moves a visible bar toward a visible reward, which
 * is the whole point (goal gradient); a campaign of three hundred levels with a
 * finish line only at the end is a climb nobody sees the top of.
 *
 * CLEARED, not unlocked: a skipped level is open but not folded, so it counts
 * toward neither mark. That is also the one reason the game gives a player to
 * go back to a level they skipped.
 *
 * Marks are recorded by name ("2:10", "2:20") rather than recomputed from
 * counts, so each is paid exactly once however the counts got there — and a
 * player who finished chapters before marks existed is paid the backlog once,
 * by the same rule (Progress.settleChapterMarks).
 */

import { CHAPTER_SIZE, LEVELS } from '../data/levels';

export const CHAPTER_COUNT = Math.ceil(LEVELS.length / CHAPTER_SIZE);

/** The two marks per chapter, in the order a player reaches them. */
export const MARK_AT = [10, 20] as const;
export type MarkAt = (typeof MARK_AT)[number];

export const MARK_PATTERN = /^(\d|1[0-4]):(10|20)$/;

export function chapterOf(levelIndex: number): number {
  const i = Number.isFinite(levelIndex) ? Math.trunc(levelIndex) : 0;
  return Math.min(CHAPTER_COUNT - 1, Math.max(0, Math.floor(i / CHAPTER_SIZE)));
}

/** Level indices of chapter `c`, in order. */
export function chapterIndices(c: number): number[] {
  const a = c * CHAPTER_SIZE;
  const b = Math.min(LEVELS.length, a + CHAPTER_SIZE);
  const out: number[] = [];
  for (let i = a; i < b; i++) out.push(i);
  return out;
}

/**
 * Where a save stands in chapter `c`.
 *
 * `skipped` is the levels the player has been let past without clearing: every
 * uncleared level below the frontier. Pass `unlockedIndex` (the save's); when
 * it is left out the frontier is inferred as one past the furthest clear,
 * which agrees with it everywhere but on a skip that has not been followed by
 * a clear yet.
 */
export function chapterStats(
  cleared: ReadonlySet<string>,
  medals: ReadonlySet<string>,
  c: number,
  unlockedIndex?: number
): { cleared: number; medals: number; skipped: number[] } {
  let frontier = unlockedIndex;
  if (frontier === undefined) {
    frontier = 0;
    LEVELS.forEach((l, i) => {
      if (cleared.has(l.id)) frontier = Math.max(frontier as number, i + 1);
    });
  }
  let n = 0;
  let m = 0;
  const skipped: number[] = [];
  for (const i of chapterIndices(c)) {
    const id = LEVELS[i].id;
    if (cleared.has(id)) n++;
    else if (i < frontier) skipped.push(i);
    if (medals.has(id)) m++;
  }
  return { cleared: n, medals: m, skipped };
}

/** "c:10" / "c:20" for every chapter at ≥10 / 20 cleared that is not yet paid. */
export function dueMarks(cleared: ReadonlySet<string>, paid: ReadonlySet<string>): string[] {
  const due: string[] = [];
  for (let c = 0; c < CHAPTER_COUNT; c++) {
    const n = chapterIndices(c).filter((i) => cleared.has(LEVELS[i].id)).length;
    for (const at of MARK_AT) {
      const mark = `${c}:${at}`;
      if (n >= Math.min(at, chapterIndices(c).length) && !paid.has(mark)) due.push(mark);
    }
  }
  return due;
}

/** The chapter a mark belongs to, and which of its two marks it is. */
export function parseMark(mark: string): { chapter: number; at: MarkAt } | null {
  const m = MARK_PATTERN.exec(mark);
  return m ? { chapter: Number(m[1]), at: Number(m[2]) as MarkAt } : null;
}

export function markReward(mark: string, cfg: { halfReward: number; fullReward: number }): number {
  return parseMark(mark)?.at === 20 ? cfg.fullReward : cfg.halfReward;
}
