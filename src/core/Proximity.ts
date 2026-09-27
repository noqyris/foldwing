/**
 * Proximity — how much room the stroke has left, on both halves at once.
 *
 * The danger heat, the rumble and the "close" call all read one number: the
 * slack between the pen (or its reflection) and the nearest wall, measured the
 * way CollisionSystem kills. That is the whole contract, and it is tested as a
 * property over every level: `slack(p) ≤ 0` exactly when CollisionSystem says
 * a stroke may not sit at p. A heat that glowed where nothing can hit, or
 * stayed dark one pixel before a death, would teach the wrong wall.
 *
 * WHY THE DISTANCE IS SQUARE. A stroke dies when its centre enters a wall
 * grown by `hitRadius` — `Geometry.inflate`, a RECTANGLE grown on each side,
 * with square corners, not the rounded shape a true distance would give. So
 * the room left is the Chebyshev (L∞) distance to that grown rectangle, and it
 * is computed from the very expressions `inflate` and `pointInRect` use, so
 * the two agree to the last bit at the boundary, not merely to a tolerance.
 *
 * WHICH WALL. A tight reflection names the REAL wall on the far half, exactly
 * as `CollisionSystem.firstHit` reports a mirror death. The heat lights that
 * wall where it is. It never projects a far wall onto the drawing half: that
 * picture is what a Reveal sells.
 *
 * Numbers are base units (750-wide world). O(walls) per probe — about fifty
 * rectangles, twice — so a pointer move can afford it, once per frame.
 */

import { mirrorPoint, type Rect, type Vec2 } from './Geometry';

export interface Slack {
  /**
   * Room left before a hit, in base px: `edge distance − hitRadius` to the
   * nearest wall, on either half. ≤ 0 is a hit (negative inside a wall);
   * Infinity when there are no walls.
   */
  readonly slack: number;
  /** Index of that wall in the rects the Proximity was built with; -1 with none. */
  readonly wall: number;
  /** The reflection is the tight one: `wall` is then the real wall on the far half. */
  readonly mirror: boolean;
  /** The probe on the tight side: the pen itself, or its reflection. */
  readonly point: Vec2;
  /** The point of that wall's own rect nearest `point` — where to put a spark. */
  readonly at: Vec2;
}

/** Room from `q` to `r` grown by `pad`: the same arithmetic as inflate + pointInRect. */
function gap(q: Vec2, r: Rect, pad: number): number {
  const ex = r.x - pad;
  const ey = r.y - pad;
  const ew = r.w + pad * 2;
  const eh = r.h + pad * 2;
  const gx = Math.max(ex - q.x, q.x - (ex + ew));
  const gy = Math.max(ey - q.y, q.y - (ey + eh));
  return Math.max(gx, gy);
}

const nearestOn = (q: Vec2, r: Rect): Vec2 => ({
  x: Math.min(r.x + r.w, Math.max(r.x, q.x)),
  y: Math.min(r.y + r.h, Math.max(r.y, q.y)),
});

/**
 * The slack at `p`: min over every wall of the room left to `p` and to its
 * mirror image. On a tie the wall listed first wins, and within one wall the
 * pen's own side — the order `CollisionSystem.firstHit` breaks ties in, so a
 * reading at contact names the wall a death there would.
 */
export function slack(p: Vec2, walls: readonly Rect[], hitRadius: number, axisX: number): Slack {
  const m = mirrorPoint(p, axisX);
  let best = Infinity;
  let wall = -1;
  let mirror = false;
  for (let i = 0; i < walls.length; i++) {
    const own = gap(p, walls[i], hitRadius);
    if (own < best) {
      best = own;
      wall = i;
      mirror = false;
    }
    const ref = gap(m, walls[i], hitRadius);
    if (ref < best) {
      best = ref;
      wall = i;
      mirror = true;
    }
  }
  const point = mirror ? m : p;
  return { slack: best, wall, mirror, point, at: wall < 0 ? point : nearestOn(point, walls[wall]) };
}

/** `slack` bound to one level's walls, built beside its CollisionSystem. */
export class Proximity {
  constructor(
    private readonly walls: readonly Rect[],
    private readonly hitRadius: number,
    private readonly axisX: number
  ) {}

  slack(p: Vec2): Slack {
    return slack(p, this.walls, this.hitRadius, this.axisX);
  }
}

/* ------------------------------------------------ heat, rumble, "close" */

/** Base px (6 pt on the 402-pt phone): under this the nearest wall starts to glow. */
export const HEAT_SLACK = 11;
/** Heat alpha at zero slack. */
export const HEAT_ALPHA = 0.45;
/** Base px (1.5 pt): under this the heat turns fail-red, and a scrape arms "close". */
export const TIGHT_SLACK = 3;
/** Base px (3 pt): entering this fires the rumble (Haptics.select). */
export const RUMBLE_SLACK = 5.6;
/** At most one rumble per this many ms. */
export const RUMBLE_GAP_MS = 180;
/** Base px (24 pt) a stroke must travel alive after its last tight moment to earn "close". */
export const CLOSE_TRAVEL = 45;
/** At most one "close" per this many ms… */
export const CLOSE_GAP_MS = 400;
/** …and this many per stroke. */
export const CLOSE_PER_STROKE = 3;

export interface Heat {
  readonly wall: number;
  readonly mirror: boolean;
  /** 0..HEAT_ALPHA: the halo's alpha. */
  readonly amount: number;
  /** Under TIGHT_SLACK: tint it fail-red instead of tangerine. */
  readonly tight: boolean;
}

/** The heat a slack reading paints, or null when the stroke has room. */
export function heatOf(s: Slack): Heat | null {
  if (s.wall < 0 || !(s.slack < HEAT_SLACK)) return null;
  const room = Math.min(HEAT_SLACK, Math.max(0, s.slack));
  return { wall: s.wall, mirror: s.mirror, amount: HEAT_ALPHA * (1 - room / HEAT_SLACK), tight: s.slack < TIGHT_SLACK };
}

/** A survived scrape, reported where it was tightest. */
export interface CloseCall {
  readonly wall: number;
  readonly mirror: boolean;
  /** The probe at the tightest moment (the pen, or its reflection). */
  readonly point: Vec2;
  /** The wall's nearest point to it: the spark goes here. */
  readonly at: Vec2;
  /** The tightest slack of the scrape, base px. */
  readonly slack: number;
}

export interface DangerStep {
  readonly heat: Heat | null;
  /** Fire Haptics.select() now. */
  readonly rumble: boolean;
  /** A "close" landed on this move. */
  readonly close: CloseCall | null;
}

/**
 * One stroke's danger, move by move: the heat to paint, when to rumble and
 * when a scrape has been survived.
 *
 * "Close" is earned by LEAVING a tight spot alive: the stroke dipped under
 * TIGHT_SLACK and then travelled CLOSE_TRAVEL past the last tight moment. A
 * long squeeze therefore pays once, on the way out, not every few pixels of
 * the corridor, and never while the pen is still in danger. It changes no
 * score; the result card only counts it.
 *
 * The caller feeds the stroke's running length (the same raw-sample length
 * the win measures) and a clock, and calls `reset()` at every new stroke. A
 * death simply stops the feed, so a scrape the stroke died in never pays.
 */
export class DangerTracker {
  /** "Close" calls this stroke, for the result card. */
  count = 0;
  private prevSlack = Infinity;
  private lastRumble = -Infinity;
  private lastClose = -Infinity;
  private armed = false;
  private tightLen = 0;
  private tightest: CloseCall | null = null;

  reset(): void {
    this.count = 0;
    this.prevSlack = Infinity;
    this.armed = false;
    this.tightest = null;
  }

  step(s: Slack, lineLen: number, now: number): DangerStep {
    let rumble = false;
    if (s.slack < RUMBLE_SLACK && !(this.prevSlack < RUMBLE_SLACK) && now - this.lastRumble >= RUMBLE_GAP_MS) {
      rumble = true;
      this.lastRumble = now;
    }
    this.prevSlack = s.slack;

    let close: CloseCall | null = null;
    if (s.slack < TIGHT_SLACK && s.wall >= 0) {
      this.armed = true;
      this.tightLen = lineLen;
      if (this.tightest === null || s.slack < this.tightest.slack) {
        this.tightest = { wall: s.wall, mirror: s.mirror, point: s.point, at: s.at, slack: s.slack };
      }
    } else if (this.armed && lineLen - this.tightLen >= CLOSE_TRAVEL) {
      if (this.count < CLOSE_PER_STROKE && now - this.lastClose >= CLOSE_GAP_MS) {
        close = this.tightest;
        this.count += 1;
        this.lastClose = now;
      }
      this.armed = false;
      this.tightest = null;
    }
    return { heat: heatOf(s), rumble, close };
  }
}
