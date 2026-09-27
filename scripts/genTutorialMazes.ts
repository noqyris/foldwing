/**
 * Tutorial generator — the first five levels, as MAZES.
 *
 * Emits src/data/tutorialLevels.ts: five small labyrinths carved by the same
 * src/core/MazeGen.ts that carves the 295 after them and the Daily Fold, so
 * the game is a labyrinth from its first screen and looks like one level to
 * the next. scripts/genLevels.ts and its output are untouched.
 *
 * What makes these a TUTORIAL rather than five more generated levels is where
 * the folds go. The ladder folds walls at random; here every folded wall is
 * CHOSEN, and a maze is kept only when scripts/tutorialLessons.ts, measuring
 * the line a hand can actually draw, says two things:
 *
 *   it is a maze   the line goes THROUGH the corridors — it turns, changes
 *                  column, uses the middle column, never runs straight — and
 *                  the near half reads as joined walls, with no open band and
 *                  no lane up the undrawn left edge (MAZE_RULES);
 *   it teaches     its folds lengthen that line by a clear margin at the
 *                  game's hit radius AND with room for a hand, on the drawn
 *                  line AND on the validator's grid, and the level's own
 *                  lesson shows in the route (LESSONS):
 *
 *   l1 First reflection  one folded wall, and it is the lie: the near half's
 *                        best line runs through it; the real one turns at it.
 *   l2 Zigzag            three turns in a row alternate between a wall drawn
 *                        here and a reflection.
 *   l3 Gate              the line threads a gap bounded by a drawn wall and a
 *                        reflection, which the near half shows 1.8× as wide.
 *   l4 Sacrifice         the way the near half offers is a whole corridor
 *                        away from the way that works.
 *   l5 Tangle            two or more folds, the sacrifice, and a zigzag or a
 *                        gate on the way.
 *
 * An earlier version judged all of this by counting CELLS on the maze grid.
 * The stroke cuts corners, uses the open runway and hugs the undrawn edge, so
 * cell detours cost it nothing: l1's "lie" measured 0%, l4's and l5's folds
 * barely moved the line, and l1 played as a straight stroke up an open field.
 *
 * Every level is PROVED playable by LevelValidator with room for a hand, and
 * the five are chosen so difficulty() rises strictly into level 6, the line's
 * winding rises with them, and the grid never shrinks — measured with the
 * functions the test suite uses, not assumed. levels.test.ts re-measures the
 * lessons on the shipped file.
 *
 * Deterministic: fixed seeds regenerate the identical file.
 *
 *   npx vite-node scripts/genTutorialMazes.ts
 */

import { writeFileSync } from 'node:fs';
import { Playfield } from '../src/core/Playfield';
import { carveMaze, emitMaze, MAZE_BOTTOM, MAZE_TOP, rng, type CarvedMaze } from '../src/core/MazeGen';
import {
  difficulty,
  interlock,
  interlockBands,
  PLAYABLE_CLEARANCE,
  routeArc,
  validateLevel,
} from '../src/core/LevelValidator';
import { BASE_HEIGHT, BASE_WIDTH, METRICS } from '../src/render/Theme';
import { GENERATED_LEVELS } from '../src/data/generatedLevels';
import type { Level } from '../src/data/types';
import {
  connectivity,
  drawnRoute,
  edgeLane,
  edgeShare,
  gridFoldCosts,
  gridRoute,
  judge,
  LESSONS,
  MAZE_RULES,
  measureTutorial,
  nearHalf,
  openBand,
  RADII,
  shapeOf,
  type TutorialMeasure,
} from './tutorialLessons';

const pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset);
const VOPTS = { cell: 6, hitRadius: METRICS.hitRadius, goalRadius: METRICS.goalRadius };

/** Wall thickness of the ladder's own opener (MazeGen at t = 0), so level 5
 *  and level 6 are drawn with the same pen. */
const TX = 0.027;
const TY = 0.021;

/** Grids searched, [cols, rows]. Three columns: a fourth narrows every
 *  corridor enough that clearance alone lifts a maze past level 6. Never
 *  larger than level 6's 3×5. */
const GRIDS: Array<[number, number]> = [
  [3, 4],
  [3, 5],
];
/** Seeds carved per grid. The whole search is a pure function of it. */
const SEEDS = 5000;
/** Folded walls per candidate, at most. */
const MAX_FOLDS = 3;
/** A segment is worth folding only if folding it alone lengthens the line by
 *  this much at both radii (MAZE_RULES then demands 3% per folded wall). */
const SEG_FLOOR = 0.02;
/** How far the cheap difficulty estimate may overshoot difficulty(). */
const ESTIMATE_SLACK = 0.01;

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const minCost = Math.min(...LESSONS.map((l) => l.minFoldCost));
const minTurns = Math.min(...LESSONS.map((l) => l.minTurns));

/** difficulty() of level 6: the tutorial must hand over below it. */
const ceiling = difficulty(GENERATED_LEVELS[0], pf);
const layouts = new Set(GENERATED_LEVELS.map((l) => JSON.stringify(l.walls)));

/* ---------------------------------------------------------------- the search */

interface Candidate {
  C: number;
  R: number;
  seed: number;
  /** Folded segment indices into carveMaze's segs. */
  set: number[];
  level: Level;
  m: TutorialMeasure;
  difficulty: number;
  /** Fold cost on the validator's grid, per radius; filled for pool members. */
  grid: number[];
  /** Lesson indices this candidate passes on the drawn line. */
  lessons: number[];
}

const combos = (xs: readonly number[], k: number): number[][] => {
  const out: number[][] = [];
  const pick = (from: number, acc: number[]): void => {
    if (acc.length === k) out.push(acc);
    else for (let i = from; i < xs.length; i++) pick(i + 1, [...acc, xs[i]]);
  };
  pick(0, []);
  return out;
};

const candidates: Candidate[] = [];
const fullGrid = new Map<string, number[]>();
let carved = 0;
let mazes = 0;

for (const [C, R] of GRIDS) {
  const rowPx = ((MAZE_BOTTOM - MAZE_TOP) * pf.h) / R;
  for (let seed = 1; seed <= SEEDS; seed++) {
    // A seed namespace per grid, so adding a grid never reshuffles another.
    const carve = (): CarvedMaze => carveMaze(rng(seed * 100 + C * 10 + R), C, R);
    const emit = (set: readonly number[]): Level => {
      const m = carve(); // fresh segs: fold flags never leak between candidates
      for (const i of set) m.segs[i].folded = true;
      return emitMaze('t', m, TX, TY);
    };
    carved++;

    /*
     * Folding is a visibility choice, so everything about the TRUE line is a
     * property of the maze, not of its folds: judge it once, on the maze with
     * every wall drawn, before trying a single fold. Folds only take walls off
     * the near half, so an open band or edge lane there already dooms them all.
     */
    const base = emit([]);
    const truth = RADII.map((r) => drawnRoute(base, pf, r));
    if (truth.some((t) => !t)) continue;
    const shapes = truth.map((t) => shapeOf(t!, pf, C));
    if (
      shapes.some(
        (s) =>
          s.crossings < MAZE_RULES.minCrossings ||
          s.interior < MAZE_RULES.minInterior ||
          s.longestLeg > MAZE_RULES.maxLongestLeg
      )
    ) continue;
    if (edgeLane(base, pf) > MAZE_RULES.maxEdgeLane || openBand(base, pf) > MAZE_RULES.maxOpenBandRows * rowPx) continue;

    const proof = validateLevel(base, pf, VOPTS);
    if (!proof.solvable) continue;
    const validatorEdge = edgeShare(proof.path, pf, C);
    if (validatorEdge > MAZE_RULES.maxValidatorEdge) continue;
    /*
     * difficulty() = tight + mirror + plan. Plan barely moves with folds, and
     * tight is at least its value at clearance()'s cap of 34 px: a lower bound
     * that prunes without paying for the clearance search. difficulty() itself
     * decides for everything that survives.
     */
    let arc = 0;
    for (let i = 1; i < proof.path.length; i++) {
      arc += Math.hypot(proof.path[i].x - proof.path[i - 1].x, proof.path[i].y - proof.path[i - 1].y);
    }
    const tightPlan = 0.35 * clamp01(1 - 34 / 40) + 0.35 * clamp01((arc / truth[0]!.direct - 1) / 2.5);
    if (tightPlan >= ceiling + ESTIMATE_SLACK) continue;
    mazes++;

    // Segments whose fold alone makes the near half lie by enough to matter.
    const segs = carve().segs.map((_, i) => i);
    const worth = segs.filter((i) => {
      const near = nearHalf(emit([i]));
      return RADII.every((r, k) => {
        const lie = drawnRoute(near, pf, r);
        return lie !== null && truth[k]!.length / lie.length - 1 >= SEG_FLOOR;
      });
    });

    for (let k = 1; k <= MAX_FOLDS; k++) {
      for (const set of combos(worth, k)) {
        const level = emit(set);
        if (layouts.has(JSON.stringify(level.walls))) continue;
        // Cheapest first: the picture, then the mirror term, then the routes.
        if (edgeLane(level, pf) > MAZE_RULES.maxEdgeLane) continue;
        if (openBand(level, pf) > MAZE_RULES.maxOpenBandRows * rowPx) continue;
        if (connectivity(level, pf).joined < MAZE_RULES.minJoined) continue;
        // Still an estimate: a folded wall loses its joint patches, which can
        // move the validator's path by a few px.
        const mirror = 0.3 * (0.5 * clamp01(interlockBands(level) / 7) + 0.5 * clamp01(interlock(level) / 0.6));
        if (tightPlan + mirror >= ceiling + ESTIMATE_SLACK) continue;
        const near = nearHalf(level);
        if (!RADII.every((r, j) => truth[j]!.length / (drawnRoute(near, pf, r)?.length ?? Infinity) - 1 >= minCost)) {
          continue;
        }
        const m = measureTutorial(level, pf, validatorEdge);
        if (!m || m.routes.some((r) => r.turns.length < minTurns)) continue;
        if (m.grid.cols !== C || m.grid.rows !== R) throw new Error(`read ${C}x${R} seed ${seed} as ${m.grid.cols}x${m.grid.rows}`);
        const lessons = LESSONS.map((l, i) => (judge(l, m).length === 0 ? i : -1)).filter((i) => i >= 0);
        if (lessons.length === 0) continue;
        candidates.push({ C, R, seed, set, level, m, difficulty: NaN, grid: [], lessons });
      }
    }
  }
}

/*
 * The slow two, only for what passed everything else: the validator-grid
 * ruler, then difficulty() itself — the suite's own number, not an estimate.
 */
const pools: Candidate[][] = LESSONS.map(() => []);
for (const c of candidates) {
  const key = `${c.C}x${c.R}:${c.seed}`;
  if (!fullGrid.has(key)) fullGrid.set(key, RADII.map((r) => gridRoute(c.level, pf, r)));
  c.grid = gridFoldCosts(c.level, pf, fullGrid.get(key));
  const passes = c.lessons.filter((i) => judge(LESSONS[i], c.m, c.grid).length === 0);
  if (passes.length === 0) continue;
  c.difficulty = difficulty(c.level, pf);
  if (!(c.difficulty < ceiling)) continue;
  for (const i of passes) pools[i].push(c);
}
console.log(`carved ${carved} · ${mazes} read and route as mazes · ${candidates.length} fold sets teach on the drawn line`);
LESSONS.forEach((l, i) =>
  console.log(`${l.id} ${l.name.padEnd(16)} ${String(pools[i].length).padStart(5)} candidates on ${new Set(pools[i].map((c) => `${c.R}:${c.seed}`)).size} mazes`)
);

/* ----------------------------------------------------------------- choosing */

/*
 * Five levels and level 6 make six points on the difficulty axis. Choose the
 * five that maximise the SMALLEST step between neighbours — an even ramp into
 * level 6, no flat spot — with the line's winding rising at both radii, the
 * grid never shrinking, and no maze used twice. Feasibility of a step is a
 * backward pass over the pools; the largest feasible step is found by
 * bisection; the chain itself takes the lowest feasible difficulty at each
 * level, ties to the costlier lie, then to the smaller seed.
 */
const cost = (c: Candidate): number => Math.min(...c.m.routes.map((r) => r.foldCost), ...c.grid);
const winding = (c: Candidate, k: number): number => c.m.routes[k].shape.winding;
const sameMaze = (a: Candidate, b: Candidate): boolean => a.C === b.C && a.R === b.R && a.seed === b.seed;
const follows = (p: Candidate, n: Candidate, step: number): boolean =>
  n.difficulty >= p.difficulty + step &&
  RADII.every((_, k) => winding(n, k) > winding(p, k)) &&
  n.C * n.R >= p.C * p.R &&
  !sameMaze(p, n);

for (const pool of pools) {
  pool.sort(
    (a, b) =>
      a.difficulty - b.difficulty || cost(b) - cost(a) || a.C * a.R - b.C * b.R || a.seed - b.seed || String(a.set).localeCompare(String(b.set))
  );
}

function chain(step: number): Candidate[] | null {
  const K = pools.length;
  const feasible: Candidate[][] = new Array(K);
  feasible[K - 1] = pools[K - 1].filter((c) => c.difficulty + step <= ceiling);
  for (let k = K - 2; k >= 0; k--) {
    feasible[k] = pools[k].filter((c) => feasible[k + 1].some((n) => follows(c, n, step)));
  }
  const walk = (k: number, acc: Candidate[]): Candidate[] | null => {
    if (k === K) return acc;
    for (const c of feasible[k]) {
      if (k > 0 && !follows(acc[k - 1], c, step)) continue;
      if (acc.some((a) => sameMaze(a, c))) continue;
      const rest = walk(k + 1, [...acc, c]);
      if (rest) return rest;
    }
    return null;
  };
  return walk(0, []);
}

let lo = 0;
let hi = ceiling;
if (!chain(0)) throw new Error('no rising tutorial below level 6 exists in this pool');
for (let i = 0; i < 40; i++) {
  const mid = (lo + hi) / 2;
  if (chain(mid)) lo = mid;
  else hi = mid;
}
const chosen = chain(lo)!;

/* Re-prove what is about to ship with the suite's own definitions. */
const shipped = chosen.map((c, i) => {
  const level: Level = { ...emitMaze(LESSONS[i].id, (() => {
    const m = carveMaze(rng(c.seed * 100 + c.C * 10 + c.R), c.C, c.R);
    for (const s of c.set) m.segs[s].folded = true;
    return m;
  })(), TX, TY), name: LESSONS[i].name };
  const exact = difficulty(level, pf);
  if (exact !== c.difficulty) throw new Error(`${level.id}: searched at difficulty ${c.difficulty}, ships at ${exact}`);
  if (!validateLevel(level, pf, VOPTS).solvable) throw new Error(`${level.id} is unsolvable`);
  if (!validateLevel(level, pf, { ...VOPTS, hitRadius: METRICS.hitRadius + PLAYABLE_CLEARANCE }).solvable) {
    throw new Error(`${level.id} leaves no room for a hand`);
  }
  const m = measureTutorial(level, pf)!;
  const grid = gridFoldCosts(level, pf);
  const why = judge(LESSONS[i], m, grid);
  if (why.length) throw new Error(`${level.id} fails its own lesson: ${why.join('; ')}`);
  return { c, level, m, grid, difficulty: exact, arc: routeArc(level, pf, VOPTS)!.arc };
});

/* ------------------------------------------------------------------ writing */

const body = shipped
  .map(({ level: l, arc }) =>
    [
      '  {',
      `    id: '${l.id}',`,
      `    name: '${l.name}',`,
      `    start: { x: ${l.start.x}, y: ${l.start.y} },`,
      `    goal: { x: ${l.goal.x}, y: ${l.goal.y} },`,
      `    parPx: ${Math.round(arc)},`,
      '    walls: [',
      ...l.walls.map((w) => `      { x: ${w.x}, y: ${w.y}, w: ${w.w}, h: ${w.h} },`),
      '    ],',
      '  },',
    ].join('\n')
  )
  .join('\n');

writeFileSync(
  'src/data/tutorialLevels.ts',
  `/**
 * GENERATED — do not edit by hand. Run \`npx vite-node scripts/genTutorialMazes.ts\`.
 *
 * The tutorial arc, as five small mazes from src/core/MazeGen.ts. Each folds
 * only walls chosen to teach its one thing, measured on the line a hand can
 * draw (scripts/tutorialLessons.ts):
 *
 *   l1 First reflection — one folded wall, and it is the lie: the near half's
 *                         best line runs through it; the real one turns at it.
 *   l2 Zigzag           — three turns in a row alternate between a wall drawn
 *                         here and a reflection.
 *   l3 Gate             — the line threads a gap bounded by a drawn wall and a
 *                         reflection, which the near half shows 1.8× as wide.
 *   l4 Sacrifice        — the way the near half offers is a whole corridor away
 *                         from the way that works.
 *   l5 Tangle           — two or more folds, the sacrifice, and a zigzag or a
 *                         gate on the way.
 *
 * In every one the folds lengthen the best line by a clear margin, and that
 * line goes through the maze's corridors. Proved playable with room for a
 * hand; difficulty() strictly rising and below level 6. levels.test.ts
 * re-proves and re-measures them on every run.
 *
 * They live apart from \`levels.ts\` so that importing a tutorial level does
 * not drag in \`generatedLevels.ts\` with it: that file is 600 KB of maze
 * tables, and the Daily Fold — which needs a proved level to fall back on, and
 * nothing else from the shipped ladder — is also the whole of the web build.
 */
import type { Level } from './types';

export const TUTORIAL_LEVELS: readonly Level[] = [
${body}
];
`
);

const pct = (n: number): string => `${(100 * n).toFixed(1)}%`;
console.log(`level 6 difficulty ${ceiling.toFixed(4)} · smallest step ${lo.toFixed(4)}`);
console.log(
  'id  maze          folds difficulty winding(G/H)  turns(G)  cross interior longest vEdge | cost line G/H   cost grid G/H  | sep(G)  zig gate | joined bars'
);
for (const { c, level, m, grid, difficulty: d } of shipped) {
  const [g, h] = m.routes;
  console.log(
    [
      level.id.padEnd(3),
      `${c.C}x${c.R} s${c.seed} [${c.set}]`.padEnd(13),
      String(m.folds).padEnd(5),
      d.toFixed(4).padEnd(10),
      `${g.shape.winding.toFixed(3)}/${h.shape.winding.toFixed(3)}`.padEnd(13),
      `${g.turns.length} ${g.turns.join('')}`.padEnd(9),
      String(g.shape.crossings).padEnd(5),
      g.shape.interior.toFixed(2).padEnd(8),
      g.shape.longestLeg.toFixed(2).padEnd(7),
      m.validatorEdge.toFixed(2).padEnd(5),
      '|',
      `${pct(g.foldCost)}/${pct(h.foldCost)}`.padEnd(14),
      `${pct(grid[0])}/${pct(grid[1])}`.padEnd(14),
      '|',
      g.separation.toFixed(0).padEnd(7),
      String(g.zigzag).padEnd(3),
      (g.gates.some(Boolean) ? 'yes' : 'no').padEnd(4),
      '|',
      m.connectivity.joined.toFixed(2),
      String(m.connectivity.bars),
    ].join(' ')
  );
}
