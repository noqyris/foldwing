/**
 * The rows are shared by the thing that makes the sound and the thing that
 * records it. If they disagree, a shared clip plays its notes somewhere other
 * than where the player heard them — a lie that is quieter than a wrong picture
 * and no less wrong.
 */

import { describe, expect, it } from 'vitest';
import { mirrorBands, obstacleRows, rowCrossings, ROW_MERGE_PX } from './Gates';

const AXIS = 375;
const LEFT = 24;

describe('the bands a reflection has to clear', () => {
  it('keeps a right-hand wall, mirrored onto the drawable half', () => {
    const bands = mirrorBands([{ x: 500, y: 100, w: 120, h: 20 }], AXIS, LEFT);
    expect(bands).toHaveLength(1);
    // Mirrored about the axis: 2*375 - (500+120) = 130.
    expect(bands[0]).toEqual({ x: 130, y: 100, w: 120, h: 20 });
  });

  /*
   * A wall the player can already see mirrors AWAY from them, onto the half
   * they never draw on. Counting it would give the phrase a note for an
   * obstacle that is not there.
   */
  it('drops a left-hand wall, whose reflection lands off the drawable half', () => {
    expect(mirrorBands([{ x: 40, y: 100, w: 100, h: 20 }], AXIS, LEFT)).toEqual([]);
  });

  it('keeps a wall straddling the axis, which reflects back over itself', () => {
    expect(mirrorBands([{ x: 340, y: 100, w: 80, h: 20 }], AXIS, LEFT)).toHaveLength(1);
  });
});

describe('the obstacle rows of a level', () => {
  it('is one row per height, bottom of the board first', () => {
    const walls = [
      { x: 0, y: 100, w: 100, h: 20 },
      { x: 0, y: 300, w: 100, h: 20 },
      { x: 0, y: 200, w: 100, h: 20 },
    ];
    expect(obstacleRows(walls, [])).toEqual([310, 210, 110]);
  });

  it('counts a wall and the band its reflection makes as one row', () => {
    const wall = { x: 0, y: 200, w: 100, h: 20 };
    const band = { x: 200, y: 200, w: 100, h: 20 };
    expect(obstacleRows([wall], [band])).toEqual([210]);
  });

  /*
   * Measured across the shipped set: 1044 pairs of walls sit within 10px of
   * each other, on 272 of the 300 levels, some as close as 1px. Each pair fired
   * two notes and two haptic ticks in the same frame — a chord and a
   * double-buzz where the player crossed one row.
   */
  it('collapses rows the eye reads as one', () => {
    const walls = [
      { x: 0, y: 200, w: 100, h: 20 },
      { x: 300, y: 200 + ROW_MERGE_PX - 2, w: 100, h: 20 },
    ];
    expect(obstacleRows(walls, [])).toHaveLength(1);
  });

  it('keeps rows that are genuinely apart', () => {
    const walls = [
      { x: 0, y: 200, w: 100, h: 20 },
      { x: 300, y: 200 + ROW_MERGE_PX + 4, w: 100, h: 20 },
    ];
    expect(obstacleRows(walls, [])).toHaveLength(2);
  });

  it('has no rows on an empty board', () => {
    expect(obstacleRows([], [])).toEqual([]);
  });
});

describe('when a stroke crosses the rows', () => {
  const rows = [900, 600, 300];
  const up = (ys: number[], times: number[]) => ({
    points: ys.map((y) => ({ x: 100, y })),
    times,
  });

  it('reports one crossing per row, in the order they are met', () => {
    const { points, times } = up([1000, 800, 500, 200], [0, 100, 200, 300]);
    expect(rowCrossings(points, times, rows)).toEqual([
      { row: 0, atMs: 100 },
      { row: 1, atMs: 200 },
      { row: 2, atMs: 300 },
    ]);
  });

  /*
   * A line that wanders back down through a gap and up again plays ONE note —
   * exactly what it does in the hand, where a gate is marked passed and never
   * fires twice.
   */
  it('never sounds the same row twice', () => {
    const { points, times } = up([1000, 800, 1000, 800], [0, 100, 200, 300]);
    expect(rowCrossings(points, times, rows)).toEqual([{ row: 0, atMs: 100 }]);
  });

  it('crosses several rows inside one long segment', () => {
    const { points, times } = up([1000, 100], [0, 400]);
    expect(rowCrossings(points, times, rows).map((c) => c.row)).toEqual([0, 1, 2]);
  });

  it('reports nothing for a stroke that never leaves its own row', () => {
    const { points, times } = up([1000, 950, 1000], [0, 50, 100]);
    expect(rowCrossings(points, times, rows)).toEqual([]);
  });

  it('has nothing to report for a stroke of one point', () => {
    expect(rowCrossings([{ x: 0, y: 1000 }], [0], rows)).toEqual([]);
  });
});
