/**
 * MazeGen — the maze itself, as a pure function of a seed.
 *
 * One spanning-tree labyrinth over the drawable half, with a
 * difficulty-growing fraction of its walls emitted on the FAR half, where
 * they constrain the stroke only through the mirror. Mirroring makes that a
 * pure visibility choice: a wall at [a, a+w] and a far wall at [1-a-w, 1-a]
 * impose the same constraint on the stroke+reflection pair.
 *
 * This lives in src (not in the generator script) because the DAILY FOLD
 * needs it at runtime: the same seed must produce the same maze on every
 * phone, so seed = date gives the whole world the same puzzle with zero
 * server. The build-time generators import this same module — there is
 * exactly one definition of what a foldwing maze is.
 *
 * The maze is built in three stages that anyone may drive: `carveMaze` (the
 * tree, its entry and exit, and every closed edge as an unfolded segment),
 * a fold decision per segment, and `emitMaze` (segments -> wall rects).
 * `makeCandidate` is the ladder's and the Daily's driver — random folds at a
 * t-dependent fraction. The tutorial generator drives the same stages with
 * folds CHOSEN, because a first maze has to put its one folded wall where it
 * teaches something. The stages consume the rng in exactly the order the
 * single function did, so every seed still produces the identical maze.
 *
 * Everything here is deterministic and side-effect free. No Phaser, no DOM,
 * no clock.
 */

import type { Level, Rect } from '../data/types';

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const round = (n: number): number => Math.round(n * 10000) / 10000;

/** Vertical extent of the maze body. Below `MAZE_BOTTOM` is the start
 *  runway — wall-free for longer than the cursor's whole offset ramp. */
export const MAZE_TOP = 0.14;
export const MAZE_BOTTOM = 0.78;

export interface MazeSeg {
  dir: 'h' | 'v';
  /** Grid-line coordinate: y for 'h', x for 'v' (normalized). */
  line: number;
  /** Extent along the line: [a, b) in x for 'h', in y for 'v'. */
  a: number;
  b: number;
  /** Emitted on the far half (visible only as a reflection)? */
  folded: boolean;
  /**
   * The two cells this closed edge separates, as indices `row * cols + c`.
   * `-1` is the start runway below the maze, `-2` the goal band above it.
   */
  cells: readonly [number, number];
}

export interface MazeParams {
  cols: number;
  rows: number;
  foldFraction: number;
}

/**
 * The dial the ramp turns. t=0 is a 3×5 maze with barely anything folded —
 * a labyrinth a child reads at a glance; t=1 is 7×11 with well over half of
 * it invisible where the player draws.
 */
export function paramsFor(t: number, r: () => number): MazeParams {
  return {
    cols: Math.max(3, Math.min(7, 3 + Math.round(t * 4 + (r() - 0.5) * 0.9))),
    rows: Math.max(5, Math.min(11, 5 + Math.round(t * 6 + (r() - 0.5) * 1.2))),
    foldFraction: 0.1 + t * 0.5 + (r() - 0.5) * 0.06,
  };
}

export interface MazeCandidate {
  level: Level;
  /** Fraction of maze cells OFF the one true route — dead-end mass. */
  decoy: number;
}

/** A carved spanning tree and every wall it leaves standing, none folded yet. */
export interface CarvedMaze {
  cols: number;
  rows: number;
  /** Cell index -> passage open to the right / downward. */
  openRight: ReadonlySet<number>;
  openDown: ReadonlySet<number>;
  /** Bottom-row column the start sits under; top-row column the goal sits over. */
  entry: number;
  exit: number;
  /** Fraction of maze cells OFF the one true route — dead-end mass. */
  decoy: number;
  /** Closed edges in emission order. Fold decisions are the caller's. */
  segs: MazeSeg[];
}

export function makeCandidate(seed: number, t: number): MazeCandidate {
  const r = rng(seed);
  const { cols, rows, foldFraction } = paramsFor(t, r);
  const maze = carveMaze(r, cols, rows);
  for (const s of maze.segs) s.folded = r() < foldFraction;

  // The asymmetry invariant needs at least one wall on the far half.
  if (!maze.segs.some((s) => s.folded)) maze.segs[Math.floor(r() * maze.segs.length)].folded = true;

  // Wall thickness per axis; the 0.021 floor keeps walls readable at
  // level-card scale (the quality suite rejects under 0.02 either way).
  return {
    level: emitMaze(`g${seed}`, maze, round(0.027 - t * 0.005), 0.021),
    decoy: maze.decoy,
  };
}

/**
 * The tree, its entry and exit, and its closed edges as unfolded segments.
 * Consumes `r` for the carve and the entry, nothing else.
 */
export function carveMaze(r: () => number, C: number, R: number): CarvedMaze {
  const px = 0.5 / C;
  const py = (MAZE_BOTTOM - MAZE_TOP) / R;

  /* Recursive backtracker: a spanning tree with long, deep corridors —
   * exactly one path between any two cells. */
  const idx = (c: number, row: number): number => row * C + c;
  const openRight = new Set<number>();
  const openDown = new Set<number>();
  const visited = new Uint8Array(C * R);
  const stack: Array<[number, number]> = [];
  let cur: [number, number] = [Math.floor(r() * C), Math.floor(r() * R)];
  visited[idx(cur[0], cur[1])] = 1;
  let unvisited = C * R - 1;

  while (unvisited > 0) {
    const [c, row] = cur;
    const options: Array<[number, number, 'r' | 'l' | 'd' | 'u']> = [];
    if (c + 1 < C && !visited[idx(c + 1, row)]) options.push([c + 1, row, 'r']);
    if (c - 1 >= 0 && !visited[idx(c - 1, row)]) options.push([c - 1, row, 'l']);
    if (row + 1 < R && !visited[idx(c, row + 1)]) options.push([c, row + 1, 'd']);
    if (row - 1 >= 0 && !visited[idx(c, row - 1)]) options.push([c, row - 1, 'u']);

    if (options.length === 0) {
      cur = stack.pop()!;
      continue;
    }
    stack.push(cur);
    const [nc, nr, dir] = options[Math.floor(r() * options.length)];
    if (dir === 'r') openRight.add(idx(c, row));
    if (dir === 'l') openRight.add(idx(nc, nr));
    if (dir === 'd') openDown.add(idx(c, row));
    if (dir === 'u') openDown.add(idx(nc, nr));
    visited[idx(nc, nr)] = 1;
    unvisited--;
    cur = [nc, nr];
  }

  /* Entry on the bottom row; exit is the top cell FARTHEST through the tree,
   * so the one true route is as long as this maze allows. */
  const entry = Math.floor(r() * C);
  const dist = (() => {
    const d = new Int32Array(C * R).fill(-1);
    const q = [idx(entry, R - 1)];
    d[q[0]] = 0;
    for (let head = 0; head < q.length; head++) {
      const n = q[head];
      const c = n % C;
      const row = Math.floor(n / C);
      const step = (m: number): void => {
        if (d[m] === -1) {
          d[m] = d[n] + 1;
          q.push(m);
        }
      };
      if (openRight.has(n)) step(idx(c + 1, row));
      if (c > 0 && openRight.has(idx(c - 1, row))) step(idx(c - 1, row));
      if (openDown.has(n)) step(idx(c, row + 1));
      if (row > 0 && openDown.has(idx(c, row - 1))) step(idx(c, row - 1));
    }
    return d;
  })();
  let exit = 0;
  for (let c = 1; c < C; c++) if (dist[idx(c, 0)] > dist[idx(exit, 0)]) exit = c;
  const decoy = 1 - (dist[idx(exit, 0)] + 1) / (C * R);

  /* Closed edges -> unit wall segments on grid lines. */
  const segs: MazeSeg[] = [];
  const seg = (s: Omit<MazeSeg, 'folded'>): void => {
    segs.push({ ...s, folded: false });
  };
  for (let row = 0; row < R; row++) {
    for (let c = 0; c < C - 1; c++) {
      if (!openRight.has(idx(c, row))) {
        seg({
          dir: 'v',
          line: round(px * (c + 1)),
          a: round(MAZE_TOP + py * row),
          b: round(MAZE_TOP + py * (row + 1)),
          cells: [idx(c, row), idx(c + 1, row)],
        });
      }
    }
  }
  for (let row = 0; row < R - 1; row++) {
    for (let c = 0; c < C; c++) {
      if (!openDown.has(idx(c, row))) {
        seg({
          dir: 'h',
          line: round(MAZE_TOP + py * (row + 1)),
          a: round(px * c),
          b: round(px * (c + 1)),
          cells: [idx(c, row), idx(c, row + 1)],
        });
      }
    }
  }
  // Boundary: one opening at the entry (bottom) and one at the exit (top).
  for (let c = 0; c < C; c++) {
    if (c !== entry)
      seg({ dir: 'h', line: MAZE_BOTTOM, a: round(px * c), b: round(px * (c + 1)), cells: [idx(c, R - 1), -1] });
    if (c !== exit)
      seg({ dir: 'h', line: MAZE_TOP, a: round(px * c), b: round(px * (c + 1)), cells: [idx(c, 0), -2] });
  }

  return { cols: C, rows: R, openRight, openDown, entry, exit, decoy, segs };
}

/** A carved maze with its folds decided -> the Level it plays as. */
export function emitMaze(id: string, maze: CarvedMaze, tx: number, ty: number): Level {
  const px = 0.5 / maze.cols;
  return {
    id,
    name: '',
    start: { x: round(px * (maze.entry + 0.5)), y: 0.92 },
    goal: { x: round(px * (maze.exit + 0.5)), y: 0.07 },
    walls: emit(maze.segs, tx, ty),
  };
}

/**
 * Line segments -> wall rects, per side, with OVERLAPPED joints.
 *
 * Where runs meet, both are EXTENDED half a thickness into each other, so
 * every junction is covered twice. The walls render opaque, so overlap is
 * invisible — while flush abutment showed a seam at every joint (each wall's
 * rounded end-corners curve away from the neighbour). Every legitimate
 * overlap fits inside one joint patch of about tx × ty.
 */
function emit(segs: readonly MazeSeg[], tx: number, ty: number): Rect[] {
  const walls: Rect[] = [];

  for (const folded of [false, true]) {
    const own = segs.filter((s) => s.folded === folded);

    interface Run {
      dir: 'h' | 'v';
      line: number;
      a: number;
      b: number;
    }
    const runs: Run[] = [];
    for (const dir of ['h', 'v'] as const) {
      const lines = new Map<number, MazeSeg[]>();
      for (const s of own) {
        if (s.dir !== dir) continue;
        if (!lines.has(s.line)) lines.set(s.line, []);
        lines.get(s.line)!.push(s);
      }
      for (const [line, list] of lines) {
        list.sort((s1, s2) => s1.a - s2.a);
        let cur: Run | null = null;
        for (const s of list) {
          if (cur && Math.abs(cur.b - s.a) < 1e-6) cur.b = s.b;
          else {
            cur = { dir, line, a: s.a, b: s.b };
            runs.push(cur);
          }
        }
      }
    }

    const hRuns = runs.filter((r) => r.dir === 'h');
    const vRuns = runs.filter((r) => r.dir === 'v');

    const hAt = (x: number, y: number): boolean =>
      hRuns.some((h) => Math.abs(h.line - y) < 1e-6 && x > h.a - 1e-6 && x < h.b + 1e-6);
    const vAt = (x: number, y: number): boolean =>
      vRuns.some((v) => Math.abs(v.line - x) < 1e-6 && y > v.a - 1e-6 && y < v.b + 1e-6);

    for (const h of hRuns) {
      const extendL = vAt(h.a, h.line) ? tx / 2 : 0;
      const extendR = vAt(h.b, h.line) ? tx / 2 : 0;
      walls.push(
        side(folded, {
          x: round(h.a - extendL),
          y: round(h.line - ty / 2),
          w: round(h.b - h.a + extendL + extendR),
          h: ty,
        })
      );
    }
    for (const v of vRuns) {
      const extT = hAt(v.line, v.a) ? ty / 2 : 0;
      const extB = hAt(v.line, v.b) ? ty / 2 : 0;
      walls.push(
        side(folded, {
          x: round(v.line - tx / 2),
          y: round(v.a - extT),
          w: tx,
          h: round(v.b - v.a + extT + extB),
        })
      );
    }
  }

  return walls;
}

/** Place a rect on its half: as-is, or mirrored to the far side. */
function side(folded: boolean, rect: Rect): Rect {
  if (!folded) return rect;
  return { ...rect, x: round(1 - rect.x - rect.w) };
}
