/**
 * LevelValidator — proof that a level can actually be finished.
 *
 * A level is a claim: "there is a stroke from start to goal whose reflection
 * also survives". Nothing about the authored numbers makes that true, and the
 * failure is invisible — an impossible level looks exactly like a hard one
 * until a player has thrown twenty minutes at it. So every shipped level is
 * proved, and the test suite fails the build if any of them stops being
 * solvable.
 *
 * The proof is a coarse grid over the DRAWABLE half, with a cell usable only
 * when the real CollisionSystem says a stroke may sit there, and an edge only
 * when it says the move between two cells is clear. That means the validator
 * cannot be more permissive than the game: anything it calls reachable, the
 * player can actually draw.
 *
 * It is deliberately CONSERVATIVE. The grid is coarser than a finger, so a
 * gap it cannot thread might still be threadable by hand. A level it passes is
 * definitely solvable; a level it fails might merely be very tight.
 */

import { CollisionSystem } from './CollisionSystem';
import { dist, type Rect, type Vec2 } from './Geometry';
import { Playfield } from './Playfield';
import type { Level } from '../data/types';

export interface ValidationResult {
  readonly solvable: boolean;
  /** Cell path from start to goal, in pixels. Empty when unsolvable. */
  readonly path: Vec2[];
  /** Free cells reachable from the start — a rough measure of how open it is. */
  readonly reachable: number;
  /** Free cells in total. reachable/free near 1 means the level barely constrains. */
  readonly free: number;
  /** Why it failed, when it did. */
  readonly reason?: string;
}

export interface ValidatorOptions {
  /** Grid spacing in pixels. Smaller is slower and more permissive. */
  readonly cell?: number;
  readonly hitRadius?: number;
  readonly goalRadius?: number;
}

/**
 * Prove (or fail to prove) that `level` can be drawn.
 *
 * @param pf reference playfield — must be the one the game uses, or the
 *           geometry being proved is not the geometry being played.
 */
export function validateLevel(
  level: Level,
  pf: Playfield,
  opts: ValidatorOptions = {}
): ValidationResult {
  const cell = opts.cell ?? 6;
  const hitRadius = opts.hitRadius ?? 5.2;
  const goalRadius = opts.goalRadius ?? 30;

  const walls: Rect[] = level.walls.map((w) => pf.toScreenRect(w));
  const collision = new CollisionSystem(walls, hitRadius, pf.axisX);

  const cols = Math.floor((pf.axisX - pf.x) / cell) + 1;
  const rows = Math.floor(pf.h / cell) + 1;
  const at = (c: number, r: number): Vec2 => ({ x: pf.x + c * cell, y: pf.y + r * cell });

  // A zero-length segment is the same predicate the game uses for "may the
  // stroke be here", so the validator can never permit a cell the game forbids.
  const freeCell = (c: number, r: number): boolean => {
    const p = at(c, r);
    return !collision.blocks(p, p);
  };

  const startPx = pf.toScreen(level.start);
  const goalPx = pf.toScreen(level.goal);

  const nearest = (target: Vec2, within: number): [number, number] | null => {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (!freeCell(c, r)) continue;
        const d = dist(at(c, r), target);
        if (d < bestD) {
          bestD = d;
          best = [c, r];
        }
      }
    }
    return bestD <= within ? best : null;
  };

  const s = nearest(startPx, cell * 2);
  if (!s) {
    return { solvable: false, path: [], reachable: 0, free: 0, reason: 'start is inside a wall' };
  }
  const g = nearest(goalPx, goalRadius);
  if (!g) {
    return { solvable: false, path: [], reachable: 0, free: 0, reason: 'goal is unreachable ground' };
  }

  let free = 0;
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) if (freeCell(c, r)) free++;

  // BFS, 8-neighbour, with the real collision system gating every edge.
  const idx = (c: number, r: number): number => c * rows + r;
  const prev = new Int32Array(cols * rows).fill(-1);
  const seen = new Uint8Array(cols * rows);
  const queue: number[] = [idx(s[0], s[1])];
  seen[queue[0]] = 1;

  let reachable = 0;
  let found = false;
  const goalIdx = idx(g[0], g[1]);

  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    reachable++;
    if (cur === goalIdx) {
      found = true;
      break;
    }
    const c = Math.floor(cur / rows);
    const r = cur % rows;
    const from = at(c, r);

    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (dc === 0 && dr === 0) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const ni = idx(nc, nr);
        if (seen[ni] || !freeCell(nc, nr)) continue;
        if (collision.blocks(from, at(nc, nr))) continue;
        seen[ni] = 1;
        prev[ni] = cur;
        queue.push(ni);
      }
    }
  }

  if (!found) {
    return { solvable: false, path: [], reachable, free, reason: 'no path from start to goal' };
  }

  const path: Vec2[] = [];
  for (let node = goalIdx; node !== -1; node = prev[node]) {
    path.push(at(Math.floor(node / rows), node % rows));
  }
  path.reverse();

  return { solvable: true, path, reachable, free };
}

/**
 * The slack a level leaves the hand, in pixels.
 *
 * `validateLevel` answers "does a route exist", which is necessary and nowhere
 * near sufficient. A route can exist through a corridor two pixels wider than
 * the stroke: provably solvable, and impossible to draw with a finger. That is
 * not a hard level, it is a broken one, and it looks exactly like a hard level
 * from the outside — which is how ten of them shipped.
 *
 * So this asks the useful question instead: how much FATTER could the stroke
 * get and still fit through? The answer is the margin for hand error on either
 * side of the tightest point on the route.
 */
export function clearance(
  level: Level,
  pf: Playfield,
  opts: ValidatorOptions & { max?: number } = {}
): number {
  const base = opts.hitRadius ?? 5.2;
  const ok = (extra: number): boolean =>
    validateLevel(level, pf, { ...opts, hitRadius: base + extra }).solvable;

  if (!ok(0)) return -1;
  let lo = 0;
  let hi = opts.max ?? 34;
  if (ok(hi)) return hi;
  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * How much of the level makes the player read BOTH halves at once, 0..1.
 *
 * This is the difference between the game and an obstacle course. At a given
 * height the player is constrained by the walls in front of them and, at the
 * same time, by the reflections of the walls on the far half. When those two
 * sets of constraints sit at DIFFERENT heights, the level decomposes: clear the
 * near wall, then clear the far one, one thought at a time. When they sit at
 * the same height the corridor is bounded on one side by something visible and
 * on the other by something that has to be folded in the head — and that is the
 * only moment the mirror is actually the mechanic.
 *
 * Returns the fraction of constrained heights where both halves bite at once.
 * The set that shipped in build 5 measured 0.4% across 100 levels, with 98 of
 * them at exactly zero.
 */
export function interlock(level: Level, samples = 1000): number {
  let both = 0;
  let any = 0;

  for (let i = 0; i <= samples; i++) {
    const y = i / samples;
    let own = false;
    let reflected = false;

    for (const w of level.walls) {
      if (y < w.y || y > w.y + w.h) continue;
      // The wall as the player meets it, clipped to the half they may draw in.
      if (Math.min(0.5, w.x + w.w) > Math.max(0, w.x)) own = true;
      // The same wall as its reflection forbids: x -> 1 - x.
      if (Math.min(0.5, 1 - w.x) > Math.max(0, 1 - (w.x + w.w))) reflected = true;
      if (own && reflected) break;
    }

    if (!own && !reflected) continue;
    any++;
    if (own && reflected) both++;
  }

  return any === 0 ? 0 : both / any;
}

/** How many separate heights force the player to read both halves at once. */
export function interlockBands(level: Level, samples = 600): number {
  let bands = 0;
  let inside = false;
  for (let i = 0; i <= samples; i++) {
    const y = i / samples;
    let own = false;
    let ref = false;
    for (const w of level.walls) {
      if (y < w.y || y > w.y + w.h) continue;
      if (Math.min(0.5, w.x + w.w) > Math.max(0, w.x)) own = true;
      if (Math.min(0.5, 1 - w.x) > Math.max(0, 1 - (w.x + w.w))) ref = true;
    }
    const both = own && ref;
    if (both && !inside) bands++;
    inside = both;
  }
  return bands;
}

/**
 * How hard a level is, 0..1 — the ordering principle for the whole set.
 *
 * The set used to be sorted by `pressure`, the fraction of the drawable half
 * the walls take away. Measured against the order it produced, that tracked
 * wall count at rho 0.974 and tracked interlock at rho **-0.057**: the game was
 * sorted by how busy a level looked, while the demand that makes it this game
 * rather than an obstacle course stayed flat from level 6 to 100. Pressure is
 * kept as a descriptive statistic; it is no longer the sort key.
 *
 * Three axes the player actually feels, in the order they dominate:
 *
 *   tight   how narrow the tightest corridor on the route is. In a game whose
 *           whole verb is "draw accurately", this is the sharpest single knob.
 *   mirror  how often, and how much, both halves squeeze at the same height —
 *           the skill unique to this game.
 *   plan    how many decisions the route contains before you commit to it.
 *
 * Deliberately ABSOLUTE rather than normalised across a candidate pool, so the
 * generator and the test suite compute the same number and a shipped set can be
 * checked against the definition that produced it.
 */
export function difficulty(level: Level, pf: Playfield): number {
  const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

  // ~40px of slack is as open as this playfield gets; 0 is impossible.
  const tight = clamp01(1 - clearance(level, pf) / 40);

  const bands = clamp01(interlockBands(level) / 4);
  const mirror = 0.5 * bands + 0.5 * clamp01(interlock(level) / 0.6);

  const route = validateLevel(level, pf);
  let turns = 0;
  let dir = 0;
  for (let i = 1; i < route.path.length; i++) {
    const d = Math.sign(route.path[i].x - route.path[i - 1].x);
    if (d !== 0 && dir !== 0 && d !== dir) turns++;
    if (d !== 0) dir = d;
  }
  const plan = 0.5 * clamp01(level.walls.length / 14) + 0.5 * clamp01(turns / 10);

  return 0.4 * tight + 0.35 * mirror + 0.25 * plan;
}

/**
 * The least slack a level may ship with, in base pixels.
 *
 * At 0.52 css px per base px on a 390pt-wide phone, this is about 3 css px of
 * error margin on each side of the stroke — roughly a millimetre of glass.
 * Drawing slowly, with the cursor lifted clear of the fingertip, that is
 * demanding but real. Below it the level stops rewarding care and starts
 * rewarding luck: the levels this rule was written to catch left 0.3 css px,
 * which no hand can hold.
 *
 * Raising this makes the hard end gentler; it cannot make a level unsolvable,
 * because it only ever rejects.
 */
export const PLAYABLE_CLEARANCE = 6;

/**
 * How hard the level looks, 0..1 — the fraction of the drawable half that the
 * player is NOT allowed to use.
 *
 * A crude proxy, but a useful one for ordering a generated set: it counts the
 * squeeze from both the walls facing the player and the ones their reflection
 * has to clear, which is exactly what makes this game hard.
 */
export function pressure(level: Level, pf: Playfield, cell = 8): number {
  const walls = level.walls.map((w) => pf.toScreenRect(w));
  const collision = new CollisionSystem(walls, 5.2, pf.axisX);

  const cols = Math.floor((pf.axisX - pf.x) / cell) + 1;
  const rows = Math.floor(pf.h / cell) + 1;

  let blocked = 0;
  let total = 0;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const p = { x: pf.x + c * cell, y: pf.y + r * cell };
      total++;
      if (collision.blocks(p, p)) blocked++;
    }
  }
  return total === 0 ? 0 : blocked / total;
}
