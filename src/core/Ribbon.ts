/**
 * Ribbon — turning a path into ink that looks drawn rather than extruded.
 *
 * A uniform-width line is a tube. Real ink swells where the hand slows and
 * thins where it hurries, and it tapers off at both ends as the nib lifts. That
 * difference is the whole reason two players' saved figures look like two
 * different drawings instead of the same clipart at different angles — which is
 * the only thing that makes a shared image worth looking at.
 *
 * IMPORTANT: this is rendering only. Collision runs on the raw samples at a
 * fixed hit radius (LOCKED), so how thick the ink happens to look never changes
 * what kills you. A slow, fat stroke is exactly as safe as a fast, thin one.
 */

import { clamp, dist, distPointToSeg, type Vec2 } from './Geometry';

export interface RibbonOptions {
  /** Nib width at normal drawing speed, in pixels. */
  readonly baseWidth: number;
  /** Multiplier at the slowest end. */
  readonly maxScale: number;
  /** Multiplier at the fastest end. */
  readonly minScale: number;
  /** Speed, in px/ms, treated as "hurrying". */
  readonly fastSpeed: number;
  /** How many samples the taper at each end spans. */
  readonly taperPoints: number;
  /** Passes of width smoothing. Raw per-sample speed is far too jittery. */
  readonly smoothPasses: number;
}

/**
 * The house nib. The slow end swells to 1.5 and the fast end holds 0.6
 * (SPEC §3.3, from 1.35 / 0.45): a line that lingered reads as pooled ink or
 * gathered light, and one that hurried no longer thins to a scratch — at
 * 0.45 a quick stroke's glow had almost nothing to glow round. The speed that
 * counts as hurrying, the taper and the smoothing are unchanged, and none of
 * it reaches collision.
 */
export const DEFAULT_RIBBON: RibbonOptions = {
  baseWidth: 10,
  maxScale: 1.5,
  minScale: 0.6,
  fastSpeed: 2.2,
  taperPoints: 7,
  smoothPasses: 3,
};

/**
 * Half-width at every point of the path.
 *
 * Speed is measured between consecutive samples and then heavily smoothed: a
 * single slow frame is a jitter, not an intention, and un-smoothed widths make
 * the stroke look like it has a rash.
 */
export function widthProfile(
  points: readonly Vec2[],
  times: readonly number[],
  opts: RibbonOptions
): number[] {
  const n = points.length;
  if (n === 0) return [];

  const half = opts.baseWidth / 2;
  if (n === 1) return [half];

  // Per-sample speed, in px/ms.
  const speed = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    const dt = Math.max(1, (times[i] ?? 0) - (times[i - 1] ?? 0));
    speed[i] = dist(points[i - 1], points[i]) / dt;
  }
  speed[0] = speed[1] ?? 0;

  // Fast -> thin, slow -> thick.
  const widths = speed.map((s) => {
    const k = clamp(s / opts.fastSpeed, 0, 1);
    return half * (opts.maxScale + (opts.minScale - opts.maxScale) * k);
  });

  for (let pass = 0; pass < opts.smoothPasses; pass++) {
    const next = widths.slice();
    for (let i = 1; i < n - 1; i++) {
      next[i] = widths[i - 1] * 0.25 + widths[i] * 0.5 + widths[i + 1] * 0.25;
    }
    for (let i = 0; i < n; i++) widths[i] = next[i];
  }

  // Lift the nib at both ends. Squared falloff reads as a pen leaving paper;
  // linear reads as a cut-off.
  const taper = Math.min(opts.taperPoints, Math.floor(n / 2));
  for (let i = 0; i < taper; i++) {
    const k = (i + 1) / (taper + 1);
    const f = k * k * (3 - 2 * k);
    widths[i] *= f;
    widths[n - 1 - i] *= f;
  }

  return widths;
}

export interface RibbonQuad {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly c: Vec2;
  readonly d: Vec2;
}

export interface Ribbon {
  /** One quad per segment, in order. */
  readonly quads: RibbonQuad[];
  /** A disc at every sample, which is what rounds the joins and the caps. */
  readonly discs: { readonly p: Vec2; readonly r: number }[];
}

/**
 * Build the ink as quads plus discs rather than one closed polygon.
 *
 * A single outline polygon is tempting and wrong: at a sharp turn the two
 * offset sides cross over each other, and any triangulator will then fill the
 * knot inside-out and punch a hole through the stroke. Overlapping quads with a
 * disc at every joint cannot self-intersect into an error — they just overlap,
 * which at full opacity is invisible, and it gives genuinely round joins and
 * caps instead of the mitres Phaser's line renderer would produce.
 */
export function buildRibbon(
  points: readonly Vec2[],
  times: readonly number[],
  opts: RibbonOptions = DEFAULT_RIBBON
): Ribbon {
  return ribbonSlice(points, widthProfile(points, times, opts));
}

/**
 * The quads and discs of points [from, to), for a path whose half-widths are
 * already known.
 *
 * Every segment belongs to the slice holding its END point, so two slices that
 * meet — [0, b) and [b, n) — paint every quad and every disc of the whole
 * ribbon exactly once between them. That is what lets the live stroke paint its
 * settled start once and redraw only the end that is still moving.
 */
export function ribbonSlice(
  points: readonly Vec2[],
  widths: readonly number[],
  from = 0,
  to = points.length
): Ribbon {
  const start = Math.max(0, from);
  const end = Math.min(points.length, to);
  const quads: RibbonQuad[] = [];
  const discs: { p: Vec2; r: number }[] = [];

  for (let i = start; i < end; i++) {
    discs.push({ p: points[i], r: Math.max(0, widths[i]) });
  }

  for (let i = Math.max(0, start - 1); i < end - 1; i++) {
    const p = points[i];
    const q = points[i + 1];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;

    // Unit normal to the segment.
    const nx = -dy / len;
    const ny = dx / len;
    const wp = widths[i];
    const wq = widths[i + 1];

    quads.push({
      a: { x: p.x + nx * wp, y: p.y + ny * wp },
      b: { x: q.x + nx * wq, y: q.y + ny * wq },
      c: { x: q.x - nx * wq, y: q.y - ny * wq },
      d: { x: p.x - nx * wp, y: p.y - ny * wp },
    });
  }

  return { quads, discs };
}

/**
 * How many leading points of a path that is still GROWING already have their
 * final ribbon — the prefix no later sample can change.
 *
 * A new sample reaches back only so far. The render smoothing moves the last
 * `movingTail` points of the drawn path (see `renderTailReach`), the width
 * smoothing spreads that change `smoothPasses` further, and the end taper thins
 * the last `taperPoints`, which un-thin once the pen moves on. The START taper
 * is settled only once the path is long enough that it stops stretching with
 * every sample. Everything before that reach is final, so the renderer can
 * paint it once instead of on every frame. One extra point of margin.
 */
export function settledPoints(n: number, opts: RibbonOptions, movingTail: number): number {
  if (n < 2 * opts.taperPoints + 2) return 0;
  const reach = Math.max(opts.taperPoints, movingTail + opts.smoothPasses) + 1;
  return Math.max(0, n - reach);
}

/**
 * The samples a painter at this scale can tell apart: indices into `points`,
 * first and last always kept.
 *
 * The drawn path carries a sample every couple of pixels of the PLAYFIELD, and a
 * gallery card shrinks that to a fraction of a pixel — tens of thousands of
 * shapes per card that land on the same few pixels. A sample is dropped only
 * while the chord that replaces it stays shorter than `maxSpan` AND passes
 * within `tolerance` of every sample it skips, so the thinned line never wanders
 * further than that from the smoothed one: a card that showed the line clear of
 * a wall still shows it clear. Widths are the caller's to carry across by index —
 * computed on the full path first, because the taper and the swell are counted
 * in samples and thinning first would stretch them.
 */
export function thinPath(
  points: readonly Vec2[],
  maxSpan: number,
  tolerance: number
): number[] {
  const n = points.length;
  if (n <= 2) return points.map((_, i) => i);

  const keep = [0];
  let anchor = 0;
  for (let i = 1; i < n - 1; i++) {
    // Could the chord from the anchor reach one sample further and still
    // stand in for everything it would skip?
    const next = i + 1;
    let holds = dist(points[anchor], points[next]) <= maxSpan;
    for (let k = anchor + 1; holds && k < next; k++) {
      holds = distPointToSeg(points[k], points[anchor], points[next]) <= tolerance;
    }
    if (!holds) {
      keep.push(i);
      anchor = i;
    }
  }
  keep.push(n - 1);
  return keep;
}

/**
 * The outline of the ribbon, as one closed loop: down one side and back up the
 * other. Used for the win figure's fill, where a single path is what gives a
 * clean silhouette rather than a stack of overlapping shapes.
 */
export function ribbonOutline(
  points: readonly Vec2[],
  times: readonly number[],
  opts: RibbonOptions = DEFAULT_RIBBON
): Vec2[] {
  const widths = widthProfile(points, times, opts);
  const left: Vec2[] = [];
  const right: Vec2[] = [];

  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;

    const nx = (-dy / len) * widths[i];
    const ny = (dx / len) * widths[i];
    left.push({ x: points[i].x + nx, y: points[i].y + ny });
    right.push({ x: points[i].x - nx, y: points[i].y - ny });
  }

  return [...left, ...right.reverse()];
}
