/**
 * Gates — the obstacle ROWS of a level, which is what the game makes a sound
 * about.
 *
 * One note per row crossed alive, climbing, so a clean run plays a rising
 * phrase and the player hears how far up they got before they look. The rows
 * are the walls facing the player TOGETHER WITH the bands their reflection has
 * to clear, because clearing a row means clearing both halves of it.
 *
 * This lived inside GameScene until the replay video needed to sound like the
 * game. Two copies of "where the rows are" would mean a clip whose notes fall
 * somewhere other than where the player heard them, which is a subtler lie than
 * a wrong picture and just as bad.
 */

import type { Rect, Vec2 } from './Geometry';

/**
 * Rows closer together than this are one row.
 *
 * Deduping on the exact rounded midpoint is not enough: measured across the
 * shipped set, 1044 pairs of walls sit within 10px of each other, on 272 of the
 * 300 levels, some as close as 1px. Each pair fired two notes and two haptic
 * ticks in the same frame — a chord and a double-buzz where the player crossed
 * one row.
 */
export const ROW_MERGE_PX = 16;

/**
 * Reflect every wall across the axis and keep the ones that land back on the
 * drawable half.
 *
 * A left wall mirrors into the right half and drops out; a right wall mirrors
 * onto the player and is exactly the constraint they cannot see.
 */
export function mirrorBands(
  walls: readonly Rect[],
  axisX: number,
  leftEdge: number
): Rect[] {
  return walls
    .map((w) => ({ x: 2 * axisX - (w.x + w.w), y: w.y, w: w.w, h: w.h }))
    .filter((w) => w.x < axisX && w.x + w.w > leftEdge);
}

/**
 * The rows of a level, top of the screen first, in pixel space.
 *
 * Sorted descending by y — bottom of the board first — because that is the
 * order a stroke drawn upward meets them, which is the order the phrase climbs
 * in.
 */
export function obstacleRows(
  walls: readonly Rect[],
  bands: readonly Rect[],
  mergePx: number = ROW_MERGE_PX
): number[] {
  const mids = new Set<number>();
  for (const w of [...walls, ...bands]) mids.add(Math.round(w.y + w.h / 2));

  const rows: number[] = [];
  for (const mid of [...mids].sort((a, b) => b - a)) {
    const prev = rows[rows.length - 1];
    if (prev !== undefined && Math.abs(prev - mid) < mergePx) continue;
    rows.push(mid);
  }
  return rows;
}

/** One row crossed by a stroke, and when. */
export interface RowCrossing {
  /** Index into the rows array — which note of the phrase this is. */
  readonly row: number;
  /** Milliseconds from the start of the stroke. */
  readonly atMs: number;
}

/**
 * When a stroke crosses each row, in the order it crosses them.
 *
 * The same test the live game runs per segment — `from.y > mid !== to.y > mid`,
 * once per row, never twice — walked over a finished stroke instead of a
 * cursor. A row already crossed is not counted again, so a line that wanders
 * back down and up through the same gap plays one note, exactly as it does in
 * the hand.
 */
export function rowCrossings(
  points: readonly Vec2[],
  times: readonly number[],
  rows: readonly number[]
): RowCrossing[] {
  const crossings: RowCrossing[] = [];
  const passed = new Set<number>();

  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    for (let r = 0; r < rows.length; r++) {
      if (passed.has(r)) continue;
      const mid = rows[r];
      if (from.y > mid === to.y > mid) continue;
      passed.add(r);
      crossings.push({ row: r, atMs: times[i] ?? times[times.length - 1] ?? 0 });
    }
  }
  return crossings;
}
