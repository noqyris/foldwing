/**
 * RouteProgress — how far along a maze a point is, measured the way the maze
 * makes you travel.
 *
 * "attempt 4 · furthest yet 74%" is only honest if 74% means distance along
 * the route, not across the page. In a maze the two part company everywhere:
 * a dead end can sit one wall away from the corridor just before the goal, and
 * a straight-line measure would credit the player who wandered into it with a
 * near miss they never had.
 *
 * So the field is the validator's own graph: the same 6px grid over the
 * drawable half, a cell usable only where the real CollisionSystem lets a
 * stroke sit, an edge only where it lets the stroke move — mirror walls
 * included. A breadth-first search from the goal gives every reachable cell
 * its number of steps to the goal, and progress is how much of the start's
 * count a point has used up. The validator's proved route is a shortest path
 * in that same graph, so progress climbs strictly along it.
 *
 * A point is read through the grid nodes around it that it can reach in a
 * straight, clear line. That keeps a point in a dead end from borrowing a
 * number from the corridor on the other side of the wall.
 *
 * THE DISTANCE STILL TO GO (`remaining`), for the live star meter. Steps are
 * the right unit for "how far along", and the wrong one for "how much more
 * line": a diagonal step is √2 cells long, so steps × cell under-reads a
 * winding route by up to a third, and the meter would promise ★★★ to a line
 * that could not keep it. So the same graph is searched a second time,
 * weighted by length (Dijkstra), from the goal RING rather than its centre —
 * a win ends the moment the line enters the ring, so that is where the
 * remaining line ends too. On the proved route the projection it gives never
 * reads worse than the finished line will, and at the ring it is the win's own
 * ratio (Stars.projectRatio).
 *
 * THE BUILD IS SLICED. The field costs one pass over about ten thousand cells
 * and two searches — 20–40 ms on a desktop, several frames on an older phone.
 * The meter wants it right after a level is installed, while the maze prints
 * in, so `routeFieldJob` hands the work out a slice at a time (`step(ms)`
 * once a frame) and `finish()` completes it at once when it is needed now (a
 * death). `routeField` is the one-shot form.
 */

import { CollisionSystem } from './CollisionSystem';
import { dist, type Vec2 } from './Geometry';
import type { Playfield } from './Playfield';
import type { Level } from '../data/types';

export interface RouteFieldOptions {
  /** Grid spacing in pixels — the validator's. */
  readonly cell?: number;
  readonly hitRadius?: number;
  readonly goalRadius?: number;
}

export interface RouteField {
  /** 0 at the start, 1 at the goal; null where no reachable cell can be seen. */
  progressAt(p: Vec2): number | null;
  /** The furthest along any of `points` got, 0..1 (0 for none). */
  furthest(points: readonly Vec2[]): number;
  /**
   * Pixels of line still needed from `p` to the goal ring by the shortest
   * clear route; 0 inside the ring; null where no reachable cell can be seen.
   */
  remaining(p: Vec2): number | null;
}

/** A field being built a slice at a time. */
export interface RouteFieldJob {
  /** Do up to about `budgetMs` of work (always at least one slice). True once done. */
  step(budgetMs: number): boolean;
  /** Complete whatever is left now, and return the field. */
  finish(): RouteField | null;
  readonly done: boolean;
  /** The field once done; null before then, or when the start cannot reach the goal. */
  readonly field: RouteField | null;
}

/** Cells per slice of each phase: small enough to stop near the budget, big enough to cost nothing. */
const SLICE = 256;

/** The eight neighbour steps; direction d's opposite is 7 − d. */
const DIRS: readonly (readonly [number, number])[] = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
];

/**
 * The progress field for `level`, or null when the start cannot reach the goal
 * (which no shipped level does — the validator proves every one). One shot:
 * see `routeFieldJob` for the sliced build.
 */
export function routeField(
  level: Level,
  pf: Playfield,
  opts: RouteFieldOptions = {}
): RouteField | null {
  return routeFieldJob(level, pf, opts).finish();
}

/** Build the field for `level` in slices. Nothing runs until `step` or `finish`. */
export function routeFieldJob(
  level: Level,
  pf: Playfield,
  opts: RouteFieldOptions = {}
): RouteFieldJob {
  const work = build(level, pf, opts);
  let done = false;
  let field: RouteField | null = null;
  const advance = (): void => {
    const r = work.next();
    if (r.done) {
      done = true;
      field = r.value;
    }
  };
  return {
    step(budgetMs: number): boolean {
      if (done) return true;
      const t0 = performance.now();
      do advance();
      while (!done && performance.now() - t0 < budgetMs);
      return done;
    },
    finish(): RouteField | null {
      while (!done) advance();
      return field;
    },
    get done(): boolean {
      return done;
    },
    get field(): RouteField | null {
      return field;
    },
  };
}

function* build(level: Level, pf: Playfield, opts: RouteFieldOptions): Generator<void, RouteField | null> {
  // The validator's defaults, so the graph is the graph it proved.
  const cell = opts.cell ?? 6;
  const hitRadius = opts.hitRadius ?? 5.2;
  const goalRadius = opts.goalRadius ?? 30;

  const walls = level.walls.map((w) => pf.toScreenRect(w));
  const collision = new CollisionSystem(walls, hitRadius, pf.axisX);

  const cols = Math.floor((pf.axisX - pf.x) / cell) + 1;
  const rows = Math.floor(pf.h / cell) + 1;
  const n = cols * rows;
  const idx = (c: number, r: number): number => c * rows + r;
  const at = (c: number, r: number): Vec2 => ({ x: pf.x + c * cell, y: pf.y + r * cell });

  const free = new Uint8Array(n);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const p = at(c, r);
      if (!collision.blocks(p, p)) free[idx(c, r)] = 1;
    }
    yield;
  }

  // Nearest free cell, scanned in the validator's order so ties land alike.
  const nearest = (target: Vec2, within: number): number | null => {
    let best: number | null = null;
    let bestD = Infinity;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (!free[idx(c, r)]) continue;
        const d = dist(at(c, r), target);
        if (d < bestD) {
          bestD = d;
          best = idx(c, r);
        }
      }
    }
    return bestD <= within ? best : null;
  };

  const goalPx = pf.toScreen(level.goal);
  const start = nearest(pf.toScreen(level.start), cell * 2);
  yield;
  const goal = nearest(goalPx, goalRadius);
  if (start === null || goal === null) return null;
  yield;

  /*
   * Every edge the collision test has answered, both ways (the test is
   * symmetric in its endpoints), so the second search never asks twice:
   * bit d = asked, bit 8 + d = clear.
   *
   * A STRAIGHT edge between two free cells needs no asking when a wall grown
   * by the hit radius is wider than a cell: to cross it the segment would
   * have to span it, and one endpoint would be inside. So only diagonals — the
   * ones that can clip a grown corner — are tested, and the answers are the
   * ones the test would have given (RouteProgress.test holds the step counts
   * to the validator's route).
   */
  const straightIsClear = hitRadius * 2 > cell;
  const edges = new Uint16Array(n);
  const clear = (i: number, c: number, r: number, d: number): boolean => {
    const e = edges[i];
    if (e & (1 << d)) return (e & (1 << (8 + d))) !== 0;
    const [dc, dr] = DIRS[d];
    const ok = (straightIsClear && (dc === 0 || dr === 0)) || !collision.blocks(at(c, r), at(c + dc, r + dr));
    const j = idx(c + dc, r + dr);
    const back = 7 - d;
    edges[i] |= (1 << d) | (ok ? 1 << (8 + d) : 0);
    edges[j] |= (1 << back) | (ok ? 1 << (8 + back) : 0);
    return ok;
  };

  // Steps to the goal, 8-neighbour, every edge gated by the real collision
  // test. -1 is "not reachable".
  const steps = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let tail = 0;
  steps[goal] = 0;
  queue[tail++] = goal;
  for (let head = 0; head < tail; head++) {
    const cur = queue[head];
    const c = Math.floor(cur / rows);
    const r = cur % rows;
    for (let d = 0; d < 8; d++) {
      const nc = c + DIRS[d][0];
      const nr = r + DIRS[d][1];
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = idx(nc, nr);
      if (steps[ni] >= 0 || !free[ni]) continue;
      if (!clear(cur, c, r, d)) continue;
      steps[ni] = steps[cur] + 1;
      queue[tail++] = ni;
    }
    if (head % SLICE === SLICE - 1) yield;
  }

  const total = steps[start];
  if (total <= 0) return null;

  /*
   * Length still to go, by Dijkstra over the same graph. Seeded from every
   * reachable node near the goal with its straight distance to the RING (0
   * inside it), because the line stops where it enters the ring. Only the
   * goal's component is searched: nothing else can be read (see readNode).
   */
  const toRing = new Float64Array(n).fill(Infinity);
  const heap = new MinHeap(n);
  const seedReach = goalRadius + cell * Math.SQRT2;
  for (let i = 0; i < n; i++) {
    if (steps[i] < 0) continue;
    const d = dist(at(Math.floor(i / rows), i % rows), goalPx);
    if (d > seedReach) continue;
    toRing[i] = Math.max(0, d - goalRadius);
    heap.push(toRing[i], i);
  }
  yield;
  let pops = 0;
  while (heap.size > 0) {
    const key = heap.peekKey();
    const cur = heap.pop();
    if (key > toRing[cur]) continue; // a stale entry: already settled shorter
    const c = Math.floor(cur / rows);
    const r = cur % rows;
    for (let d = 0; d < 8; d++) {
      const [dc, dr] = DIRS[d];
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = idx(nc, nr);
      if (steps[ni] < 0) continue;
      const via = key + (dc !== 0 && dr !== 0 ? cell * Math.SQRT2 : cell);
      if (via >= toRing[ni]) continue;
      if (!clear(cur, c, r, d)) continue;
      toRing[ni] = via;
      heap.push(via, ni);
    }
    if (++pops % SLICE === 0) yield;
  }

  /*
   * The grid node `p` reads through: among the four corners of its own cell
   * first, then the ring around them, the nearest one `valid` accepts that a
   * stroke could reach from `p` in a straight, clear line.
   */
  const readNode = (p: Vec2, valid: (i: number) => boolean): number => {
    const c0 = Math.floor((p.x - pf.x) / cell);
    const r0 = Math.floor((p.y - pf.y) / cell);
    let best = -1;
    let bestD = Infinity;
    for (const span of [0, 1]) {
      for (let c = c0 - span; c <= c0 + 1 + span; c++) {
        for (let r = r0 - span; r <= r0 + 1 + span; r++) {
          if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
          const i = idx(c, r);
          if (!valid(i)) continue;
          const node = at(c, r);
          const d = dist(node, p);
          if (d >= bestD) continue;
          if (collision.blocks(p, node)) continue;
          best = i;
          bestD = d;
        }
      }
      if (best >= 0) break;
    }
    return best;
  };

  const reachable = (i: number): boolean => steps[i] >= 0;
  const measured = (i: number): boolean => toRing[i] < Infinity;

  const progressAt = (p: Vec2): number | null => {
    const best = readNode(p, reachable);
    if (best < 0) return null;
    return Math.min(1, Math.max(0, 1 - steps[best] / total));
  };

  return {
    progressAt,
    furthest(points: readonly Vec2[]): number {
      let most = 0;
      for (const p of points) {
        const v = progressAt(p);
        if (v !== null && v > most) most = v;
      }
      return most;
    },
    remaining(p: Vec2): number | null {
      if (dist(p, goalPx) <= goalRadius) return 0;
      const best = readNode(p, measured);
      if (best < 0) return null;
      return dist(p, at(Math.floor(best / rows), best % rows)) + toRing[best];
    },
  };
}

/** A binary min-heap of (key, node) pairs, allowing duplicates (lazy deletion). */
class MinHeap {
  private keys: Float64Array;
  private nodes: Int32Array;
  size = 0;

  constructor(capacity: number) {
    this.keys = new Float64Array(Math.max(16, capacity));
    this.nodes = new Int32Array(Math.max(16, capacity));
  }

  push(key: number, node: number): void {
    if (this.size === this.keys.length) {
      const k = new Float64Array(this.size * 2);
      const v = new Int32Array(this.size * 2);
      k.set(this.keys);
      v.set(this.nodes);
      this.keys = k;
      this.nodes = v;
    }
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= key) break;
      this.keys[i] = this.keys[parent];
      this.nodes[i] = this.nodes[parent];
      i = parent;
    }
    this.keys[i] = key;
    this.nodes[i] = node;
  }

  peekKey(): number {
    return this.keys[0];
  }

  pop(): number {
    const top = this.nodes[0];
    const last = --this.size;
    const key = this.keys[last];
    const node = this.nodes[last];
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= last) break;
      if (child + 1 < last && this.keys[child + 1] < this.keys[child]) child++;
      if (this.keys[child] >= key) break;
      this.keys[i] = this.keys[child];
      this.nodes[i] = this.nodes[child];
      i = child;
    }
    this.keys[i] = key;
    this.nodes[i] = node;
    return top;
  }
}

/** Below this a "furthest yet" is noise: the first rows of any maze. */
export const NEAR_MISS_FLOOR = 0.2;

/**
 * The attempt line after a death, or null when there is nothing worth saying:
 * only a NEW best for this visit — new in the number shown, so "74%" is never
 * announced twice — only from 20%, and never 100%: a stroke that died did not
 * finish, whatever the rounding says.
 */
export function nearMissLine(attempt: number, reached: number, bestBefore: number): string | null {
  if (!(reached >= NEAR_MISS_FLOOR)) return null;
  const pct = (v: number): number => Math.min(99, Math.round(v * 100));
  if (!(pct(reached) > (bestBefore > 0 ? pct(bestBefore) : 0))) return null;
  return `attempt ${attempt} · furthest yet ${pct(reached)}%`;
}
