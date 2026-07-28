/**
 * StrokeRecorder — raw point sampling, plus the smoothing and mirroring the
 * renderer needs.
 *
 * The critical invariant: `points` holds the RAW samples and collision runs on
 * those. Smoothing is applied on the way to the screen only. Smoothing the
 * collision path would round off the player's corners and let them cut inside
 * walls they visibly clipped — the game would quietly lie about what happened.
 */

import { clonePoint, distSq, mirrorPath, type Vec2 } from './Geometry';

export class StrokeRecorder {
  private readonly raw: Vec2[] = [];
  /**
   * Arrival time of each sample, parallel to `raw`.
   *
   * Kept as a second array rather than fattening the point type, because `raw`
   * is handed straight to collision on every pointer move and must stay a plain
   * Vec2[] with no per-sample allocation. Timing is a rendering concern: it is
   * what lets the ink swell where the hand slowed.
   */
  private readonly stamps: number[] = [];
  private readonly minDistSq: number;

  constructor(minDist: number) {
    this.minDistSq = minDist * minDist;
  }

  /** Start a new stroke at p, discarding anything previous. */
  begin(p: Vec2, tMs = 0): void {
    this.raw.length = 0;
    this.stamps.length = 0;
    this.raw.push(clonePoint(p));
    this.stamps.push(tMs);
  }

  /**
   * Record p if it has travelled far enough from the last sample. Rejecting a
   * near-duplicate is safe: it sits within the hit radius of a point that has
   * already been tested, and every wall in the game is an order of magnitude
   * thicker than the sample threshold, so nothing can hide in the gap.
   */
  push(p: Vec2, tMs = 0): boolean {
    const last = this.last;
    if (last && distSq(last, p) < this.minDistSq) return false;
    this.raw.push(clonePoint(p));
    this.stamps.push(tMs);
    return true;
  }

  /**
   * Record p regardless of spacing. Used for the exact contact point of a
   * collision and the exact entry point of the goal, so the ink terminates
   * where the event actually happened rather than at the last sample.
   */
  pushExact(p: Vec2, tMs = 0): void {
    this.raw.push(clonePoint(p));
    this.stamps.push(tMs);
  }

  get points(): readonly Vec2[] {
    return this.raw;
  }

  /** Sample arrival times, parallel to `points`. */
  get times(): readonly number[] {
    return this.stamps;
  }

  get last(): Vec2 | undefined {
    return this.raw.length > 0 ? this.raw[this.raw.length - 1] : undefined;
  }

  get count(): number {
    return this.raw.length;
  }

  clear(): void {
    this.raw.length = 0;
    this.stamps.length = 0;
  }
}

/**
 * Resample the time series alongside a densified path.
 *
 * `densify` inserts points on the raw segments to bound Chaikin's corner cut;
 * the widths those points get have to come from somewhere, so the timestamps
 * are interpolated the same way. Without this the ink would be smooth in space
 * and stepped in thickness.
 */
export function densifyTimes(
  points: readonly Vec2[],
  times: readonly number[],
  maxSpacing: number
): number[] {
  if (points.length < 2 || maxSpacing <= 0) return [...times];

  const out: number[] = [times[0] ?? 0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const ta = times[i - 1] ?? 0;
    const tb = times[i] ?? 0;
    const steps = Math.ceil(Math.sqrt(distSq(a, b)) / maxSpacing);
    for (let s = 1; s < steps; s++) out.push(ta + (tb - ta) * (s / steps));
    out.push(tb);
  }
  return out;
}

/** Chaikin applied to a scalar series, so it stays aligned with `chaikin`. */
export function chaikinScalar(values: readonly number[], iterations: number): number[] {
  let current = [...values];
  for (let pass = 0; pass < iterations; pass++) {
    if (current.length < 3) break;
    const next: number[] = [current[0]];
    for (let i = 0; i < current.length - 1; i++) {
      next.push(current[i] * 0.75 + current[i + 1] * 0.25);
      next.push(current[i] * 0.25 + current[i + 1] * 0.75);
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
}

/**
 * Split any segment longer than `maxSpacing` into equal pieces.
 *
 * Every inserted point sits exactly on the original segment, so the polyline is
 * geometrically unchanged — this adds detail, never shape. It exists purely to
 * feed `chaikin` a bounded spacing: corner cutting is proportional to the gap
 * it is handed, and during a flick the raw samples are hundreds of pixels
 * apart. Without this the RENDERED line bows away from the raw path far enough
 * to cross a wall the raw path cleared, and the player sees a stroke pass
 * through an obstacle and survive.
 */
export function densify(points: readonly Vec2[], maxSpacing: number): Vec2[] {
  if (points.length < 2 || maxSpacing <= 0) return points.map(clonePoint);

  const out: Vec2[] = [clonePoint(points[0])];

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const steps = Math.ceil(Math.sqrt(distSq(a, b)) / maxSpacing);

    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    out.push(clonePoint(b));
  }

  return out;
}

/**
 * Chaikin corner cutting. Each pass replaces every segment with its 1/4 and 3/4
 * points, doubling the point count and shaving the corners; the endpoints are
 * kept so the stroke still starts on the start dot and ends on the goal.
 *
 * Two passes leave joins shallow enough that the renderer's mitred line joins
 * are indistinguishable from round ones.
 */
export function chaikin(points: readonly Vec2[], iterations: number): Vec2[] {
  let current: Vec2[] = points.map(clonePoint);

  for (let pass = 0; pass < iterations; pass++) {
    if (current.length < 3) break;

    const next: Vec2[] = [current[0]];
    for (let i = 0; i < current.length - 1; i++) {
      const p = current[i];
      const q = current[i + 1];
      next.push({ x: p.x * 0.75 + q.x * 0.25, y: p.y * 0.75 + q.y * 0.25 });
      next.push({ x: p.x * 0.25 + q.x * 0.75, y: p.y * 0.25 + q.y * 0.75 });
    }
    next.push(current[current.length - 1]);
    current = next;
  }

  return current;
}

/**
 * Raw samples -> the polyline actually drawn.
 *
 * Densify, then smooth. Collision never sees this path; it runs on the raw
 * samples. The one obligation is that the drawn line stays close enough to the
 * tested line that the player is never shown a stroke doing something the rules
 * did not allow — bounding the spacing before smoothing is what keeps that
 * promise at flick speed, and StrokeRecorder.test.ts asserts the bound.
 */
export function renderPath(
  raw: readonly Vec2[],
  maxSpacing: number,
  iterations: number
): Vec2[] {
  return chaikin(densify(raw, maxSpacing), iterations);
}

export interface DrawnStroke {
  readonly points: Vec2[];
  readonly times: number[];
}

/**
 * The drawn path and its timing, kept in lockstep.
 *
 * `densify` and `chaikin` each change the point count in a fixed way, so the
 * timestamps are put through the scalar twins of both. They have to stay
 * aligned index for index — a width profile shifted by even a few samples reads
 * as the ink swelling in the wrong places.
 */
export function renderStroke(
  raw: readonly Vec2[],
  times: readonly number[],
  maxSpacing: number,
  iterations: number
): DrawnStroke {
  return {
    points: chaikin(densify(raw, maxSpacing), iterations),
    times: chaikinScalar(densifyTimes(raw, times, maxSpacing), iterations),
  };
}

/**
 * The win figure: the stroke, then its mirror walked backwards, forming one
 * closed loop. Going backwards is what joins tip-to-tip and heel-to-heel
 * instead of crossing the middle — the difference between a butterfly and a
 * bowtie.
 */
export function closedFigure(points: readonly Vec2[], axisX: number): Vec2[] {
  return [...points.map(clonePoint), ...mirrorPath(points, axisX).reverse()];
}
