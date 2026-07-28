/**
 * Geometry — pure 2D math, unit-agnostic.
 *
 * Nothing here knows about Phaser, the playfield, or normalized level space.
 * Every function takes plain numbers, which is what lets the same code path
 * serve both the player's stroke and its mirror, and lets all of it be unit
 * tested without a browser.
 *
 * `segRect` is the most important function in the game. Collision is checked
 * CONTINUOUSLY along each segment — never by testing the sampled points alone —
 * because a fast swipe produces sample points tens or hundreds of pixels apart
 * and a point test would let the stroke tunnel clean through a wall.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Tolerance for treating a float as zero. All gameplay coordinates live in the
 * 0..1500 px range, so 1e-9 is many orders of magnitude below any distance the
 * game can express.
 */
const EPS = 1e-9;

export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

export function clonePoint(p: Vec2): Vec2 {
  return { x: p.x, y: p.y };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function distSq(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.sqrt(distSq(a, b));
}

/** Point at parameter t along a→b. t is not clamped. */
export function lerpPoint(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/* ------------------------------------------------------------------ mirror */

/** Reflect an x coordinate across a vertical axis. */
export function mirrorX(x: number, axisX: number): number {
  return 2 * axisX - x;
}

/**
 * Reflect a point across the vertical mirror axis. This is an involution —
 * mirror(mirror(p)) === p — and it preserves the parameterisation of a segment,
 * which is why a hit parameter t computed on a mirrored segment is directly
 * comparable to one computed on the original.
 */
export function mirrorPoint(p: Vec2, axisX: number): Vec2 {
  return { x: 2 * axisX - p.x, y: p.y };
}

export function mirrorPath(points: readonly Vec2[], axisX: number): Vec2[] {
  return points.map((p) => mirrorPoint(p, axisX));
}

/* ------------------------------------------------------------------- rects */

/** Grow a rect outward on all sides. Used to give the stroke its hit radius. */
export function inflate(r: Rect, pad: number): Rect {
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
}

/**
 * A rect with negative extent covers nothing. This only arises from a NEGATIVE
 * pad — shrinking a rect by more than half its size — which the game never does
 * with its always-positive hit radius, but a grid validator that wants to erode
 * cells rather than grow them would. Without this check the four-edge test
 * happily reports crossings of a region that has inverted itself and encloses
 * no points at all, so the predicate would disagree with `pointInRect`.
 */
export function isEmptyRect(r: Rect): boolean {
  return r.w < 0 || r.h < 0;
}

/** Inclusive on all four edges: a point exactly on the boundary is inside. */
export function pointInRect(p: Vec2, r: Rect, pad = 0): boolean {
  return (
    p.x >= r.x - pad &&
    p.x <= r.x + r.w + pad &&
    p.y >= r.y - pad &&
    p.y <= r.y + r.h + pad
  );
}

/* ---------------------------------------------------------------- segments */

/**
 * Twice the signed area of triangle abc. Positive when abc turns one way,
 * negative the other, exactly zero when the three points are collinear.
 */
function orient(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** Bounding-box containment. Only meaningful when p is collinear with a→b. */
function withinSegBounds(a: Vec2, b: Vec2, p: Vec2): boolean {
  return (
    p.x >= Math.min(a.x, b.x) &&
    p.x <= Math.max(a.x, b.x) &&
    p.y >= Math.min(a.y, b.y) &&
    p.y <= Math.max(a.y, b.y)
  );
}

/**
 * Segment/segment intersection via the CCW orientation test, including the
 * collinear and endpoint-touching cases. The textbook three-line version
 * silently reports "no hit" when a segment lies exactly along an edge — which
 * is precisely what happens when a player drags along the flat top of a wall,
 * so the degenerate branches are load-bearing, not pedantry.
 */
export function segSeg(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);

  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  ) {
    return true;
  }

  if (d1 === 0 && withinSegBounds(p3, p4, p1)) return true;
  if (d2 === 0 && withinSegBounds(p3, p4, p2)) return true;
  if (d3 === 0 && withinSegBounds(p1, p2, p3)) return true;
  if (d4 === 0 && withinSegBounds(p1, p2, p4)) return true;

  return false;
}

/**
 * Does the segment a→b touch the rect, expanded by `pad`?
 *
 * THE function. Expand the rect by the hit radius, accept immediately if either
 * endpoint is inside it, otherwise test the segment against all four edges. The
 * two cases together are exhaustive: a segment that meets the rect either
 * crosses its boundary or lies wholly within it.
 */
export function segRect(a: Vec2, b: Vec2, r: Rect, pad = 0): boolean {
  const e = inflate(r, pad);
  if (isEmptyRect(e)) return false;

  if (pointInRect(a, e) || pointInRect(b, e)) return true;

  // Cheap separating-axis reject on the two AABBs. Pure speed, no semantics:
  // a segment whose bounding box misses the rect cannot touch it.
  if (Math.max(a.x, b.x) < e.x || Math.min(a.x, b.x) > e.x + e.w) return false;
  if (Math.max(a.y, b.y) < e.y || Math.min(a.y, b.y) > e.y + e.h) return false;

  const x0 = e.x;
  const y0 = e.y;
  const x1 = e.x + e.w;
  const y1 = e.y + e.h;

  const tl = { x: x0, y: y0 };
  const tr = { x: x1, y: y0 };
  const br = { x: x1, y: y1 };
  const bl = { x: x0, y: y1 };

  return (
    segSeg(a, b, tl, tr) ||
    segSeg(a, b, tr, br) ||
    segSeg(a, b, br, bl) ||
    segSeg(a, b, bl, tl)
  );
}

/**
 * Parameter t ∈ [0,1] of the FIRST contact between segment a→b and the padded
 * rect, or null if they never meet. Slab (Liang–Barsky) clipping: for an
 * axis-aligned rect this is exact and branch-light.
 *
 * `segRect` answers "did it hit"; this answers "where". The boolean stays on
 * the hot path and this only runs once a hit is already known, to decide
 * whether a wall or the goal came first along a long segment, and to clip the
 * ink so it stops at the wall instead of poking through it.
 *
 * Returns 0 when a is already inside — the two functions agree by construction:
 * segRect(a,b,r,pad) === (segRectEntryT(a,b,r,pad) !== null).
 */
export function segRectEntryT(
  a: Vec2,
  b: Vec2,
  r: Rect,
  pad = 0
): number | null {
  const minX = r.x - pad;
  const maxX = r.x + r.w + pad;
  const minY = r.y - pad;
  const maxY = r.y + r.h + pad;

  // Same guard as segRect: an inverted rect encloses nothing, and the slab
  // clipping below would otherwise swap the reversed bounds back into a valid
  // interval and report an entry into empty space.
  if (minX > maxX || minY > maxY) return null;

  const dx = b.x - a.x;
  const dy = b.y - a.y;

  let t0 = 0;
  let t1 = 1;

  if (Math.abs(dx) < EPS) {
    // Segment is vertical (or a point): it can only hit if it already lies
    // inside the horizontal slab.
    if (a.x < minX || a.x > maxX) return null;
  } else {
    let ta = (minX - a.x) / dx;
    let tb = (maxX - a.x) / dx;
    if (ta > tb) {
      const swap = ta;
      ta = tb;
      tb = swap;
    }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }

  if (Math.abs(dy) < EPS) {
    if (a.y < minY || a.y > maxY) return null;
  } else {
    let ta = (minY - a.y) / dy;
    let tb = (maxY - a.y) / dy;
    if (ta > tb) {
      const swap = ta;
      ta = tb;
      tb = swap;
    }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }

  return t0;
}

/**
 * Parameter t ∈ [0,1] where segment a→b first comes within `radius` of centre
 * c, or null. Used for the goal: testing sampled points alone would let a fast
 * flick skip straight past the target, which is the same tunnelling bug as
 * walls, just with the sign flipped.
 */
export function segCircleEntryT(
  a: Vec2,
  b: Vec2,
  c: Vec2,
  radius: number
): number | null {
  const fx = a.x - c.x;
  const fy = a.y - c.y;

  const cc = fx * fx + fy * fy - radius * radius;
  if (cc <= 0) return 0; // already inside at t = 0

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const aa = dx * dx + dy * dy;
  if (aa < EPS) return null; // zero-length segment, and a is outside

  const bb = 2 * (fx * dx + fy * dy);
  const disc = bb * bb - 4 * aa * cc;
  if (disc < 0) return null;

  const root = Math.sqrt(disc);
  const tEnter = (-bb - root) / (2 * aa);
  return tEnter >= 0 && tEnter <= 1 ? tEnter : null;
}

/** Shortest distance from p to the segment a→b. */
export function distPointToSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < EPS) return dist(p, a);

  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Axis-aligned bounds of a point set. Returns null for an empty set. */
export function boundsOf(points: readonly Vec2[]): Rect | null {
  if (points.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
