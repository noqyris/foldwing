/**
 * Tutorial lessons, measured on the line a hand actually draws.
 *
 * scripts/genTutorialMazes.ts keeps a tutorial maze only when these say it is a
 * maze and teaches its lesson, and src/data/levels.test.ts re-measures the
 * shipped five with the same functions and the same thresholds. One
 * definition, so the generator cannot keep what the suite then refuses, and a
 * regeneration cannot quietly lose a lesson.
 *
 * WHY NOT COUNT CELLS. The first tutorial mazes were judged on the maze grid:
 * "the fold makes the route two cells longer". The stroke does not live on that
 * grid. It cuts corners, runs straight down a corridor three cells long, and a
 * two-cell detour in a corridor 117 px wide can cost nothing. Measured, the
 * fold that was meant to teach l1 cost 0 px, and l1's line was the straight
 * one from the start dot to the goal ring.
 *
 * WHY NOT routeArc EITHER. `validateLevel` is a breadth-first search on an
 * 8-neighbour grid: it minimises STEPS, and a diagonal step costs what a
 * straight one does. On a playfield 1102 px tall and 351 px wide, a sideways
 * detour that does not outrun the climb is free in steps, and the arc of the
 * one min-step path it happens to return depends on the neighbour order.
 * Measured on the previous tutorial, it said l4's fold cost 0% at the game's
 * radius and 3.6% at the hand's; the shortest line it forces is 13% and 15%
 * longer. The BFS is the right PROOF and a fine par; it is noise as a ruler.
 *
 * So the ruler is the SHORTEST DRAWABLE LINE: a visibility graph over the
 * corners of every constraint the stroke meets on the near half — each wall,
 * and each far wall's reflection, inflated by the hit radius — with every leg
 * checked by the game's own CollisionSystem, so it cannot be more permissive
 * than the game. `gridRoute` is the same question asked on the validator's own
 * grid (same cells, same collision-gated edges, weighted by length instead of
 * counted), and levels.test.ts pins that the two rulers agree.
 *
 * Everything is in playfield pixels and a pure function of the level.
 */

import { CollisionSystem } from '../src/core/CollisionSystem';
import { distPointToSeg, type Rect, type Vec2 } from '../src/core/Geometry';
import { PLAYABLE_CLEARANCE, validateLevel } from '../src/core/LevelValidator';
import { MAZE_BOTTOM, MAZE_TOP } from '../src/core/MazeGen';
import type { Playfield } from '../src/core/Playfield';
import type { Level } from '../src/data/types';
import { METRICS } from '../src/render/Theme';

/**
 * Every lesson must hold at both: the stroke the game tests, and the stroke
 * fattened by the margin every shipped level must leave the hand. A lesson
 * that exists only for a pixel-perfect line is not one a player meets.
 */
export const RADII = [METRICS.hitRadius, METRICS.hitRadius + PLAYABLE_CLEARANCE] as const;

/* ------------------------------------------------------------------ routes */

export interface DrawnRoute {
  /** Start, every bend, goal — playfield pixels. */
  points: Vec2[];
  length: number;
  /** Straight-line distance start -> goal, as routeArc measures it. */
  direct: number;
}

/** A wall authored on the far half — a folded wall. */
export const isFar = (w: Rect): boolean => w.x + w.w > 0.5 + 1e-9;

/** The constraint wall `i` puts on the near half, in px: the wall itself, or
 *  its reflection. */
export function feltRect(level: Level, pf: Playfield, i: number): Rect {
  const r = pf.toScreenRect(level.walls[i]);
  return isFar(level.walls[i]) ? { ...r, x: 2 * pf.axisX - (r.x + r.w) } : r;
}

/** How far a corner node sits outside its inflated rect, so a leg that grazes
 *  the corner is not refused by the very wall it bends around. */
const CORNER_OFFSET = 0.5;

/**
 * The shortest line from the start dot to the goal ring's centre that the game
 * lets a stroke of `hitRadius` draw, or null if there is none.
 */
export function drawnRoute(level: Level, pf: Playfield, hitRadius: number): DrawnRoute | null {
  const rects = level.walls.map((w) => pf.toScreenRect(w));
  const collision = new CollisionSystem(rects, hitRadius, pf.axisX);
  const start = pf.toScreen(level.start);
  const goal = pf.toScreen(level.goal);

  const nodes: Vec2[] = [start, goal];
  level.walls.forEach((_, i) => {
    const r = feltRect(level, pf, i);
    for (const [cx, dx] of [
      [r.x - hitRadius, -1],
      [r.x + r.w + hitRadius, 1],
    ] as const) {
      for (const [cy, dy] of [
        [r.y - hitRadius, -1],
        [r.y + r.h + hitRadius, 1],
      ] as const) {
        const corner = { x: cx + dx * CORNER_OFFSET, y: cy + dy * CORNER_OFFSET };
        // A corner past the edge or the axis still bounds a gap there.
        const clamped = { x: Math.min(pf.axisX, Math.max(pf.x, corner.x)), y: corner.y };
        for (const p of corner.x === clamped.x ? [corner] : [corner, clamped]) {
          if (p.x < pf.x || p.x > pf.axisX || p.y < pf.y || p.y > pf.bottom) continue;
          if (collision.blocks(p, p)) continue;
          nodes.push(p);
        }
      }
    }
  });

  // Dijkstra over the visibility graph; visibility is computed lazily, once.
  const n = nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const seen = new Int8Array(n * n); // 0 unknown, 1 visible, -1 blocked
  dist[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u === -1 || dist[i] < dist[u])) u = i;
    if (u === -1 || u === 1) break;
    done[u] = 1;
    for (let v = 0; v < n; v++) {
      if (done[v]) continue;
      const d = dist[u] + Math.hypot(nodes[v].x - nodes[u].x, nodes[v].y - nodes[u].y);
      if (d >= dist[v]) continue;
      const k = u < v ? u * n + v : v * n + u;
      if (seen[k] === 0) seen[k] = collision.blocks(nodes[u], nodes[v]) ? -1 : 1;
      if (seen[k] < 0) continue;
      dist[v] = d;
      prev[v] = u;
    }
  }
  if (dist[1] === Infinity) return null;

  const order: number[] = [];
  for (let v = 1; v !== -1; v = prev[v]) order.push(v);
  order.reverse();
  return {
    points: order.map((i) => nodes[i]),
    length: dist[1],
    direct: Math.max(1, Math.hypot(goal.x - start.x, goal.y - start.y)),
  };
}

/**
 * The same question on the validator's own grid: its cell size, its free-cell
 * test, its collision-gated 8-neighbour edges and its start and goal cells —
 * weighted by length instead of counted. Length in px, NaN if unsolvable.
 * Lattice-bound, so it reads a few percent longer than `drawnRoute`.
 */
export function gridRoute(level: Level, pf: Playfield, hitRadius: number, cell = 6): number {
  const collision = new CollisionSystem(level.walls.map((w) => pf.toScreenRect(w)), hitRadius, pf.axisX);
  const cols = Math.floor((pf.axisX - pf.x) / cell) + 1;
  const rows = Math.floor(pf.h / cell) + 1;
  const at = (c: number, r: number): Vec2 => ({ x: pf.x + c * cell, y: pf.y + r * cell });
  const free = new Uint8Array(cols * rows);
  const startPx = pf.toScreen(level.start);
  const goalPx = pf.toScreen(level.goal);
  let s = -1;
  let g = -1;
  let sd = Infinity;
  let gd = Infinity;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const p = at(c, r);
      if (collision.blocks(p, p)) continue;
      free[c * rows + r] = 1;
      const ds = Math.hypot(p.x - startPx.x, p.y - startPx.y);
      const dg = Math.hypot(p.x - goalPx.x, p.y - goalPx.y);
      if (ds < sd) [sd, s] = [ds, c * rows + r];
      if (dg < gd) [gd, g] = [dg, c * rows + r];
    }
  }
  if (s < 0 || g < 0 || sd > cell * 2 || gd > METRICS.goalRadius) return NaN;

  const dist = new Float64Array(cols * rows).fill(Infinity);
  const heap: number[] = []; // node ids, ordered by dist
  const up = (i: number): void => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (dist[heap[p]] <= dist[heap[i]]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const down = (i: number): void => {
    for (;;) {
      const l = 2 * i + 1;
      let m = i;
      if (l < heap.length && dist[heap[l]] < dist[heap[m]]) m = l;
      if (l + 1 < heap.length && dist[heap[l + 1]] < dist[heap[m]]) m = l + 1;
      if (m === i) return;
      [heap[m], heap[i]] = [heap[i], heap[m]];
      i = m;
    }
  };
  const done = new Uint8Array(cols * rows);
  dist[s] = 0;
  heap.push(s);
  while (heap.length) {
    const u = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      down(0);
    }
    if (done[u]) continue;
    done[u] = 1;
    if (u === g) return dist[u];
    const c = Math.floor(u / rows);
    const r = u % rows;
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (dc === 0 && dr === 0) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const v = nc * rows + nr;
        if (!free[v] || done[v]) continue;
        const d = dist[u] + cell * Math.hypot(dc, dr);
        if (d >= dist[v]) continue;
        if (collision.blocks(at(c, r), at(nc, nr))) continue;
        dist[v] = d;
        heap.push(v);
        up(heap.length - 1);
      }
    }
  }
  return NaN;
}

/** The level as the near half shows it: every folded wall gone. */
export const nearHalf = (level: Level): Level => ({ ...level, walls: level.walls.filter((w) => !isFar(w)) });

/** The level with its folded walls moved onto the near half. Folding is a
 *  visibility choice, so this must play exactly like `level`. */
export const unfolded = (level: Level): Level => ({
  ...level,
  walls: level.walls.map((w) => (isFar(w) ? { ...w, x: Math.round((1 - w.x - w.w) * 1e4) / 1e4 } : w)),
});

export const withoutWall = (level: Level, i: number): Level => ({
  ...level,
  walls: level.walls.filter((_, j) => j !== i),
});

/* ------------------------------------------------------------ route shape */

/** What a turn bends around: a wall drawn here, a reflection, or both at once
 *  (a joint where the two halves meet). */
export type TurnTag = 'n' | 'F' | 'x';

/** Bends closer than this are one turn (both corners of one wall end, or the
 *  two rects of one joint). */
const TURN_JOIN_PX = 24;
/** A change of heading smaller than this is a nudge, not a turn. */
export const TURN_MIN_DEG = 30;

/** The route's real turns, each tagged by the constraint it bends around. */
export function turnsOf(level: Level, pf: Playfield, route: DrawnRoute, r: number): TurnTag[] {
  const felt = level.walls.map((w, i) => ({ rect: feltRect(level, pf, i), far: isFar(w) }));
  // A bend node sits diagonally off an inflated corner: sqrt(2)·(r + 0.5) away.
  const reach = 1.5 * (r + 1);
  const p = route.points;
  const out: Array<{ angle: number; near: boolean; far: boolean; at: Vec2 }> = [];
  for (let i = 1; i < p.length - 1; i++) {
    const a = Math.atan2(p[i].y - p[i - 1].y, p[i].x - p[i - 1].x);
    const b = Math.atan2(p[i + 1].y - p[i].y, p[i + 1].x - p[i].x);
    let d = ((b - a) * 180) / Math.PI;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    let near = false;
    let far = false;
    for (const { rect, far: isReflection } of felt) {
      const dx = Math.max(rect.x - p[i].x, 0, p[i].x - (rect.x + rect.w));
      const dy = Math.max(rect.y - p[i].y, 0, p[i].y - (rect.y + rect.h));
      if (Math.hypot(dx, dy) > reach) continue;
      if (isReflection) far = true;
      else near = true;
    }
    const last = out[out.length - 1];
    if (last && Math.hypot(p[i].x - last.at.x, p[i].y - last.at.y) < TURN_JOIN_PX) {
      last.angle += d;
      last.near ||= near;
      last.far ||= far;
      last.at = p[i];
    } else {
      out.push({ angle: d, near, far, at: p[i] });
    }
  }
  return out
    .filter((t) => Math.abs(t.angle) >= TURN_MIN_DEG)
    .map((t) => (t.near && t.far ? 'x' : t.far ? 'F' : 'n'));
}

/** Longest run of consecutive turns that alternate strictly between a wall
 *  drawn here and a reflection. Any run of two or more contains a reflection. */
export function zigzag(tags: readonly TurnTag[]): number {
  let best = 0;
  let len = 0;
  for (let i = 0; i < tags.length; i++) {
    if (tags[i] === 'x') len = 0;
    else len = len > 0 && tags[i - 1] !== tags[i] ? len + 1 : 1;
    if (len >= 2) best = Math.max(best, len);
  }
  return best;
}

/** Points along the polyline, `step` px apart, ends included. */
function sample(points: readonly Vec2[], step: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let j = 0; j < k; j++) out.push({ x: a.x + ((b.x - a.x) * j) / k, y: a.y + ((b.y - a.y) * j) / k });
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Share of a polyline's length that runs within a quarter column of the
 * playfield's left edge. The edge is not drawn, so a line there reads as going
 * AROUND the maze.
 */
export function edgeShare(points: readonly Vec2[], pf: Playfield, cols: number): number {
  const px = (pf.w * 0.5) / cols / 4;
  const s = sample(points, 2);
  let total = 0;
  let edge = 0;
  for (let i = 1; i < s.length; i++) {
    const len = Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y);
    total += len;
    if (s[i].x - pf.x < px && s[i - 1].x - pf.x < px) edge += len;
  }
  return total > 0 ? edge / total : 0;
}

export interface RouteShape {
  /** Line length / straight distance. */
  winding: number;
  /** Times the line moves into another maze column inside the maze body. */
  crossings: number;
  /** Share of the in-maze line inside an interior column (not the edge
   *  column, not the axis column). */
  interior: number;
  /** Longest straight leg as a share of the line. */
  longestLeg: number;
  /** Share of the line hugging the undrawn left edge. */
  edge: number;
}

export function shapeOf(route: DrawnRoute, pf: Playfield, cols: number): RouteShape {
  const colPx = (pf.w * 0.5) / cols;
  const top = pf.y + MAZE_TOP * pf.h;
  const bottom = pf.y + MAZE_BOTTOM * pf.h;
  // Must be this far into a column to count as having entered it.
  const settle = 12;

  const s = sample(route.points, 2);
  let body = 0;
  let interior = 0;
  let crossings = 0;
  let col = -1;
  for (let i = 1; i < s.length; i++) {
    const len = Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y);
    const x = s[i].x - pf.x;
    if (s[i].y <= top || s[i].y >= bottom) continue;
    body += len;
    const c = Math.min(cols - 1, Math.max(0, Math.floor(x / colPx)));
    if (c > 0 && c < cols - 1) interior += len;
    if (x - c * colPx > settle && (c + 1) * colPx - x > settle) {
      if (col !== -1 && c !== col) crossings += Math.abs(c - col);
      col = c;
    }
  }
  let longest = 0;
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1];
    const b = route.points[i];
    longest = Math.max(longest, Math.hypot(b.x - a.x, b.y - a.y));
  }
  return {
    winding: route.length / route.direct,
    crossings,
    interior: body > 0 ? interior / body : 0,
    longestLeg: route.length > 0 ? longest / route.length : 1,
    edge: edgeShare(route.points, pf, cols),
  };
}

/**
 * The farthest the line `a` ever strays from the line `b`, or `b` from `a`
 * (Hausdorff distance), in px. A detour worth the name is a corridor away.
 */
export function separation(a: DrawnRoute, b: DrawnRoute): number {
  const far = (p: readonly Vec2[], q: readonly Vec2[]): number => {
    let worst = 0;
    for (const s of sample(p, 4)) {
      let best = Infinity;
      for (let i = 1; i < q.length; i++) best = Math.min(best, distPointToSeg(s, q[i - 1], q[i]));
      worst = Math.max(worst, best);
    }
    return worst;
  };
  return Math.max(far(a.points, b.points), far(b.points, a.points));
}

/**
 * Does the true line thread a GATE that folded wall `f` makes — a gap bounded
 * by a wall drawn here on one side and `f`'s reflection on the other, which the
 * near half shows at least 1.8× as wide? The near half's own best line must go
 * through where the reflection stands: that is the gap it believes in.
 */
export function threadsGate(
  level: Level,
  pf: Playfield,
  route: DrawnRoute,
  lie: DrawnRoute,
  f: number,
  r: number
): boolean {
  const M = feltRect(level, pf, f);
  const horiz = M.w >= M.h;
  const along = (p: Vec2): number => (horiz ? p.x : p.y);
  const across = (p: Vec2): number => (horiz ? p.y : p.x);
  const line = horiz ? M.y + M.h / 2 : M.x + M.w / 2;
  const lo = horiz ? M.x : M.y;
  const hi = lo + (horiz ? M.w : M.h);
  const crossings = (rt: DrawnRoute): number[] => {
    const out: number[] = [];
    for (let i = 1; i < rt.points.length; i++) {
      const a = rt.points[i - 1];
      const b = rt.points[i];
      const da = across(a) - line;
      const db = across(b) - line;
      if (da * db > 0 || da === db) continue;
      out.push(along(a) + (along(b) - along(a)) * (da / (da - db)));
    }
    return out;
  };
  const parallel = level.walls
    .map((w, i) => ({ w, R: feltRect(level, pf, i) }))
    .filter(({ w, R }) => !isFar(w) && (horiz ? R.w >= R.h : R.h > R.w))
    .filter(({ R }) => Math.abs((horiz ? R.y + R.h / 2 : R.x + R.w / 2) - line) < 2)
    .map(({ R }) => [horiz ? R.x : R.y, horiz ? R.x + R.w : R.y + R.h] as const);

  if (!crossings(lie).some((x) => x >= lo - r && x <= hi + r)) return false;
  for (const x of crossings(route)) {
    if (x > lo && x < hi) continue;
    const towardM = x <= lo ? 1 : -1;
    const dM = x <= lo ? lo - x : x - hi;
    let dN = Infinity;
    let dBeyond = towardM === 1 ? (horiz ? pf.axisX : pf.bottom) - x : x - (horiz ? pf.x : pf.y);
    for (const [a, b] of parallel) {
      if (towardM === 1) {
        if (b <= x) dN = Math.min(dN, x - b);
        if (a >= x) dBeyond = Math.min(dBeyond, a - x);
      } else {
        if (a >= x) dN = Math.min(dN, a - x);
        if (b <= x) dBeyond = Math.min(dBeyond, x - b);
      }
    }
    if (dN === Infinity) continue;
    if (dN + dBeyond >= 1.8 * (dM + dN)) return true;
  }
  return false;
}

/* ------------------------------------------------------------ the picture */

/** Columns and rows of the maze a level was emitted from, read off its wall
 *  lines (every wall sits on a grid line, ends extended by a joint patch). */
export function mazeGridOf(level: Level): { cols: number; rows: number } {
  const fits = (values: readonly number[], origin: number, span: number, n: number, slack: number): boolean =>
    values.every((v) => {
      const k = ((v - origin) / span) * n;
      return Math.abs(k - Math.round(k)) * (span / n) <= slack && Math.round(k) >= 0 && Math.round(k) <= n;
    });
  const xs: number[] = [];
  const ys: number[] = [];
  for (const w0 of level.walls) {
    const w = isFar(w0) ? { ...w0, x: 1 - w0.x - w0.w } : w0;
    if (w.w >= w.h) {
      ys.push(w.y + w.h / 2);
      xs.push(w.x, w.x + w.w);
    } else {
      xs.push(w.x + w.w / 2);
      ys.push(w.y, w.y + w.h);
    }
  }
  const slack = 0.015; // half a wall thickness, plus rounding
  let cols = 1;
  while (cols < 12 && !fits(xs, 0, 0.5, cols, slack)) cols++;
  let rows = 1;
  while (rows < 16 && !fits(ys, MAZE_TOP, MAZE_BOTTOM - MAZE_TOP, rows, slack)) rows++;
  return { cols, rows };
}

export interface Connectivity {
  /** Share of the near half's wall length that is joined to another wall —
   *  part of an L, T or U — rather than a lone bar. */
  joined: number;
  /** Near-half walls touching no other wall. */
  bars: number;
}

/**
 * Does the near half read as a maze or as a comb of bars? Measured on what
 * the player sees where they draw: near-half wall rects, joined when they
 * touch. (The playfield's left edge is not drawn, so a bar from it is a bar.)
 */
export function connectivity(level: Level, pf: Playfield): Connectivity {
  const near = level.walls.filter((w) => !isFar(w));
  const parent = near.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const eps = 1e-4;
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      const a = near[i];
      const b = near[j];
      if (a.x <= b.x + b.w + eps && b.x <= a.x + a.w + eps && a.y <= b.y + b.h + eps && b.y <= a.y + a.h + eps) {
        parent[find(i)] = find(j);
      }
    }
  }
  const size = new Map<number, number>();
  for (let i = 0; i < near.length; i++) size.set(find(i), (size.get(find(i)) ?? 0) + 1);
  let all = 0;
  let joined = 0;
  let bars = 0;
  near.forEach((w, i) => {
    const len = Math.max(w.w * pf.w, w.h * pf.h);
    all += len;
    if (size.get(find(i))! > 1) joined += len;
    else bars++;
  });
  return { joined: all > 0 ? joined / all : 0, bars };
}

/**
 * The tallest strip of the maze body, in px, with nothing drawn on the near
 * half. One row's corridor is a maze; more than a row of nothing is a field.
 */
export function openBand(level: Level, pf: Playfield): number {
  const near = level.walls.filter((w) => !isFar(w));
  const span = (MAZE_BOTTOM - MAZE_TOP) * pf.h;
  let best = 0;
  let run = 0;
  for (let px = 0; px <= span; px++) {
    const y = MAZE_TOP + px / pf.h;
    run = near.some((w) => y >= w.y && y <= w.y + w.h) ? 0 : run + 1;
    best = Math.max(best, run);
  }
  return best;
}

/**
 * Width in px of the straight lane that runs up the playfield's LEFT EDGE
 * through the whole maze body without meeting a near-half wall: 0 when the
 * edge column is closed somewhere. The edge is not drawn, so such a lane reads
 * as a way AROUND the labyrinth, not through it.
 */
export function edgeLane(level: Level, pf: Playfield): number {
  const near = level.walls.filter((w) => !isFar(w));
  const y0 = MAZE_TOP + 0.03;
  const y1 = MAZE_BOTTOM - 0.03;
  let px = 0;
  for (; px <= pf.w / 2; px++) {
    const x = px / pf.w;
    if (near.some((w) => x >= w.x && x <= w.x + w.w && w.y <= y1 && w.y + w.h >= y0)) break;
  }
  return px;
}

/* ------------------------------------------------------------- measuring */

export interface RouteMeasure {
  radius: number;
  /** The true line, and the one the near half alone promises. */
  length: number;
  nearLength: number;
  /** How much longer the folds make the line: 0.1 = a tenth. */
  foldCost: number;
  /** How far the promised line strays from the true one, px. */
  separation: number;
  shape: RouteShape;
  turns: TurnTag[];
  zigzag: number;
  /** Per far wall, in wall order: does the line thread its gate? */
  gates: boolean[];
}

export interface TutorialMeasure {
  grid: { cols: number; rows: number };
  /** Walls on the far half. */
  folds: number;
  /** One per radius, RADII order. */
  routes: RouteMeasure[];
  /** Per far wall: the smaller, over both radii, of how much longer the line
   *  is with that wall than without it. A fold that costs nothing teaches
   *  nothing. */
  wallCosts: number[];
  /** Share of the validator's own proved path hugging the undrawn left edge. */
  validatorEdge: number;
  lane: number;
  band: number;
  rowPx: number;
  columnPx: number;
  connectivity: Connectivity;
}

/**
 * Everything the tutorial's rules read, for one level. `validatorEdge` may be
 * passed in when the caller already has it: it is the one fold-independent,
 * expensive number here (a full BFS), and folding never changes it.
 */
export function measureTutorial(level: Level, pf: Playfield, validatorEdge?: number): TutorialMeasure | null {
  const grid = mazeGridOf(level);
  const near = nearHalf(level);
  const far = level.walls.map((w, i) => (isFar(w) ? i : -1)).filter((i) => i >= 0);
  const routes: RouteMeasure[] = [];
  const wallCosts = far.map(() => Infinity);
  for (const r of RADII) {
    const truth = drawnRoute(level, pf, r);
    const lie = drawnRoute(near, pf, r);
    if (!truth || !lie) return null;
    const turns = turnsOf(level, pf, truth, r);
    far.forEach((f, k) => {
      const without = drawnRoute(withoutWall(level, f), pf, r);
      wallCosts[k] = Math.min(wallCosts[k], without ? truth.length / without.length - 1 : 0);
    });
    routes.push({
      radius: r,
      length: truth.length,
      nearLength: lie.length,
      foldCost: truth.length / lie.length - 1,
      separation: separation(truth, lie),
      shape: shapeOf(truth, pf, grid.cols),
      turns,
      zigzag: zigzag(turns),
      gates: far.map((f) => threadsGate(level, pf, truth, lie, f, r)),
    });
  }
  if (validatorEdge === undefined) {
    const proof = validateLevel(level, pf, { cell: 6, hitRadius: RADII[0], goalRadius: METRICS.goalRadius });
    if (!proof.solvable) return null;
    validatorEdge = edgeShare(proof.path, pf, grid.cols);
  }
  return {
    grid,
    folds: far.length,
    routes,
    wallCosts,
    validatorEdge,
    lane: edgeLane(level, pf),
    band: openBand(level, pf),
    rowPx: ((MAZE_BOTTOM - MAZE_TOP) * pf.h) / grid.rows,
    columnPx: (pf.w * 0.5) / grid.cols,
    connectivity: connectivity(level, pf),
  };
}

/**
 * The fold cost read on the validator's grid instead of the drawn line, one
 * per radius. `full` may pass the level's own grid lengths when the caller
 * already has them for the same maze folded another way: folding moves them
 * only by a joint patch, which is close enough to search by. What ships is
 * re-measured without it.
 */
export function gridFoldCosts(level: Level, pf: Playfield, full?: readonly number[]): number[] {
  const near = nearHalf(level);
  return RADII.map((r, k) => (full?.[k] ?? gridRoute(level, pf, r)) / gridRoute(near, pf, r) - 1);
}

/* ------------------------------------------------------------------ rules */

/**
 * What every tutorial maze must be, whatever it teaches. Each number is where
 * the old tutorial failed and levels 6+ pass:
 *
 *   maxEdgeLane 0       the undrawn left edge never offers a straight lane
 *                       through the maze body (old l1–l5: a 108 px lane each).
 *   maxOpenBandRows 1   no strip of the maze body taller than one row has
 *                       nothing drawn across it on the near half.
 *   minJoined 0.6       60% of the drawn wall length is part of an L, T or U,
 *                       not a lone bar — levels 6–45 have a median of 0.66,
 *                       old l2 had 0.39 and read as three bars.
 *   minTurns 2          the line bends round at least two corners, and
 *   minCrossings 2      changes maze column at least twice, and
 *   minInterior 0.25    spends a quarter of its in-maze length in the middle
 *                       column, and
 *   maxLongestLeg 0.45  no straight leg is almost half of it. (Old l1: 0
 *                       turns, one crossing, a 59% leg — a straight line.)
 *   maxValidatorEdge    the validator's own proved path hugs the undrawn left
 *     0.25              edge for at most a quarter of its length (old l1:
 *                       0.62, l2 and l3: 0.34).
 *   minWallCost 0.03    every folded wall lengthens the line by 3% on its own:
 *                       no decorative folds, which would add mirror difficulty
 *                       and teach nothing.
 *
 * Route rules hold at BOTH radii.
 */
export const MAZE_RULES = {
  maxEdgeLane: 0,
  maxOpenBandRows: 1,
  minJoined: 0.6,
  minTurns: 2,
  minCrossings: 2,
  minInterior: 0.25,
  maxLongestLeg: 0.45,
  maxValidatorEdge: 0.25,
  minWallCost: 0.03,
} as const;

export interface Lesson {
  id: string;
  name: string;
  /**
   * The least the folds must lengthen the line, as a fraction, at both radii
   * and on both rulers (the drawn line and the validator's grid). A tenth of a
   * ~1000 px line is ~100 px, most of a 117 px column: a detour the eye can
   * see. Under ~5% the two rulers disagree by more than the effect.
   */
  minFoldCost: number;
  minTurns: number;
  /** The lesson itself, beyond the fold cost: null when taught, else why not. */
  teaches: (m: TutorialMeasure) => string | null;
}

const atBoth = (m: TutorialMeasure, f: (r: RouteMeasure) => boolean): boolean => m.routes.every(f);

export const LESSONS: readonly Lesson[] = [
  {
    id: 'l1',
    name: 'First reflection',
    minFoldCost: 0.1,
    minTurns: 2,
    // One folded wall, and it is the lie: the near half's best line runs
    // through its reflection (a fold that costs 10% must be in its way), and
    // the real line turns at it — alone, or where it meets a drawn wall.
    teaches: (m) =>
      m.folds !== 1
        ? `${m.folds} folded walls, not one`
        : !atBoth(m, (r) => r.turns.some((t) => t !== 'n'))
          ? 'the line never turns at the reflection'
          : null,
  },
  {
    id: 'l2',
    name: 'Zigzag',
    minFoldCost: 0.08,
    minTurns: 2,
    // Three turns in a row alternate between a wall drawn here and a
    // reflection: read this half, then that one, then this one.
    teaches: (m) => (atBoth(m, (r) => r.zigzag >= 3) ? null : 'no three turns alternate between the halves'),
  },
  {
    id: 'l3',
    name: 'Gate',
    minFoldCost: 0.08,
    minTurns: 2,
    // The line threads a gap with a drawn wall on one side and a reflection
    // on the other, which the near half shows at least 1.8× as wide.
    teaches: (m) =>
      m.routes[0].gates.some((g, i) => g && m.routes.every((r) => r.gates[i])) ? null : 'no gate is only half a gap',
  },
  {
    id: 'l4',
    name: 'Sacrifice',
    minFoldCost: 0.1,
    minTurns: 2,
    // The way the near half offers is a whole corridor away from the way
    // that works: the obvious route has to be given up, not adjusted.
    teaches: (m) =>
      atBoth(m, (r) => r.separation >= m.columnPx) ? null : 'the promised line is less than a column from the real one',
  },
  {
    id: 'l5',
    name: 'Tangle',
    minFoldCost: 0.12,
    minTurns: 3,
    // Everything at once: more than one fold, a corridor-away detour, and a
    // zigzag or a gate on the way.
    teaches: (m) =>
      m.folds < 2
        ? 'fewer than two folded walls'
        : !atBoth(m, (r) => r.separation >= m.columnPx)
          ? 'the promised line is less than a column from the real one'
          : !(
                atBoth(m, (r) => r.zigzag >= 3) ||
                m.routes[0].gates.some((g, i) => g && m.routes.every((r) => r.gates[i]))
              )
            ? 'neither a zigzag nor a gate'
            : null,
  },
];

/**
 * Every rule `lesson` breaks, as readable reasons; [] means the level is a
 * maze and teaches. `gridCosts` (from gridFoldCosts) adds the validator-grid
 * ruler; without it only the drawn line is judged.
 */
export function judge(lesson: Lesson, m: TutorialMeasure, gridCosts?: readonly number[]): string[] {
  const R = MAZE_RULES;
  const out: string[] = [];
  if (m.lane > R.maxEdgeLane) out.push(`a ${m.lane}px lane runs up the undrawn left edge`);
  if (m.band > R.maxOpenBandRows * m.rowPx) out.push(`a ${m.band}px band of the maze has nothing drawn across it`);
  if (m.connectivity.joined < R.minJoined) out.push(`only ${m.connectivity.joined.toFixed(2)} of the drawn walls are joined`);
  if (m.validatorEdge > R.maxValidatorEdge) out.push(`the validator's path hugs the left edge for ${m.validatorEdge.toFixed(2)}`);
  if (m.wallCosts.some((c) => c < R.minWallCost)) out.push(`a folded wall costs only ${Math.min(...m.wallCosts).toFixed(3)}`);
  for (const r of m.routes) {
    const at = `at r=${r.radius}`;
    if (r.turns.length < Math.max(R.minTurns, lesson.minTurns)) out.push(`${r.turns.length} turns ${at}`);
    if (r.shape.crossings < R.minCrossings) out.push(`${r.shape.crossings} column crossings ${at}`);
    if (r.shape.interior < R.minInterior) out.push(`interior share ${r.shape.interior.toFixed(2)} ${at}`);
    if (r.shape.longestLeg > R.maxLongestLeg) out.push(`a straight leg of ${r.shape.longestLeg.toFixed(2)} ${at}`);
    if (r.foldCost < lesson.minFoldCost) out.push(`folds cost ${(100 * r.foldCost).toFixed(1)}% ${at}`);
  }
  gridCosts?.forEach((c, k) => {
    if (!(c >= lesson.minFoldCost)) out.push(`folds cost ${(100 * c).toFixed(1)}% on the validator grid at r=${RADII[k]}`);
  });
  const why = lesson.teaches(m);
  if (why) out.push(why);
  return out;
}
