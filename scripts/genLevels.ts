/**
 * Level generator — MAZES.
 *
 * Emits src/data/generatedLevels.ts: 295 labyrinth levels appended after the
 * five hand-authored tutorial levels, ordered easy to hard.
 *
 * The maze itself lives in src/core/MazeGen.ts — ONE definition, shared with
 * the runtime Daily Fold. This script is only the curator: it generates a
 * large pool, proves and measures every candidate against the shipped
 * playfield and collision system, and picks an even, cliff-free spread.
 *
 * Two rules it will not break:
 *  1. Every level is PROVED solvable by LevelValidator WITH ROOM for a hand.
 *  2. Difficulty is measured, not assumed: candidates are scored by the
 *     shared, absolute difficulty() and the shipped set is an even spread.
 *
 * Deterministic: a fixed seed regenerates the identical file.
 *
 *   npx vite-node scripts/genLevels.ts
 */

import { writeFileSync } from 'node:fs';
import { Playfield } from '../src/core/Playfield';
import { makeCandidate } from '../src/core/MazeGen';
import {
  clearance,
  difficulty,
  interlock,
  interlockBands,
  PLAYABLE_CLEARANCE,
  pressure,
  routeArc,
  validateLevel,
} from '../src/core/LevelValidator';
import { BASE_HEIGHT, BASE_WIDTH, METRICS } from '../src/render/Theme';
import type { Level } from '../src/data/types';

const TARGET = 295;
const POOL = 1200;
const MIN_INTERLOCK = 0.08;
/** The one route must genuinely wind. A 3×5 opener physically cannot wind
 *  like a 7×11 finisher, so the floor sits where the smallest grids still
 *  produce real mazes; the SORT puts the windiest ones last. */
const MIN_WINDING = 1.35;
/** Fraction of maze CELLS off the solve route — dead ends to explore and
 *  reject. Measured on the spanning tree, where the number is real. */
const MIN_DECOY = 0.3;

const pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset);

/* ------------------------------------------------------------------ names */

const ADJ_TIERS = [
  ['First', 'Soft', 'Quiet', 'Slow', 'Gentle', 'Small'],
  ['Open', 'Wide', 'Warm', 'Still', 'Pale', 'Plain'],
  ['Second', 'Long', 'Late', 'Early', 'Loose', 'Broad'],
  ['Narrow', 'Deep', 'Dark', 'Cold', 'Thin', 'Steep'],
  ['Sharp', 'Tight', 'Quick', 'Severe', 'Closed', 'Last'],
];
const NOUN = [
  'fold', 'crease', 'wing', 'mirror', 'hinge', 'seam', 'pleat', 'turn',
  'pass', 'gate', 'thread', 'knot', 'sweep', 'arc', 'bend', 'lean', 'drift',
  'reach', 'edge', 'span', 'trace', 'climb', 'weave', 'notch', 'stair',
];

/** Within a tier the (adjective, noun) pair cycles with period lcm(6,25)=150,
 *  so tiers of ceil(295/5)=59 never repeat; tiers cannot collide. */
function nameFor(i: number, total: number): string {
  const per = Math.ceil(total / ADJ_TIERS.length);
  const tier = Math.min(ADJ_TIERS.length - 1, Math.floor(i / per));
  const k = i - tier * per;
  const adj = ADJ_TIERS[tier][k % ADJ_TIERS[tier].length];
  const noun = NOUN[(k * 7 + tier * 3) % NOUN.length];
  return `${adj} ${noun}`;
}

/* -------------------------------------------------------------- measuring */

const VOPTS = {
  cell: 6,
  hitRadius: METRICS.hitRadius,
  goalRadius: METRICS.goalRadius,
};

interface Scored {
  level: Level;
  clear: number;
  bands: number;
  inter: number;
  walls: number;
  winding: number;
  decoy: number;
  press: number;
  score: number;
}

const pool: Scored[] = [];
const seen = new Set<string>();
let seed = 1;
let tried = 0;
let rejectedUnsolvable = 0;
let rejectedFlat = 0;
let rejectedStraight = 0;

while (pool.length < POOL && tried < 60000) {
  tried++;
  const t = (seed * 0.6180339887498949) % 1;
  const { level: cand, decoy } = makeCandidate(seed++, t);

  const key = JSON.stringify(cand.walls);
  if (seen.has(key)) continue;

  if (decoy < MIN_DECOY) {
    rejectedStraight++;
    continue;
  }
  const playable = validateLevel(cand, pf, {
    ...VOPTS,
    hitRadius: METRICS.hitRadius + PLAYABLE_CLEARANCE,
  }).solvable;
  if (!playable) {
    rejectedUnsolvable++;
    continue;
  }
  if (interlock(cand) < MIN_INTERLOCK) {
    rejectedFlat++;
    continue;
  }
  const route = routeArc(cand, pf, VOPTS);
  if (!route || route.arc / route.direct < MIN_WINDING) {
    rejectedStraight++;
    continue;
  }

  seen.add(key);
  pool.push({
    level: { ...cand, parPx: Math.round(route.arc) },
    clear: clearance(cand, pf, VOPTS),
    bands: interlockBands(cand),
    inter: interlock(cand),
    walls: cand.walls.length,
    winding: route.arc / route.direct,
    decoy,
    press: pressure(cand, pf),
    score: 0,
  });
}

pool.forEach((s) => {
  s.score = difficulty(s.level, pf);
});
pool.sort((a, b) => a.score - b.score);

/* Even spread across the sorted pool, gently skewed toward the hard end —
 * the opening third stays genuinely easy and the climb steepens through the
 * middle: the frustration curve that brings a player back. */
const SKEW = 0.8;
const out = Array.from({ length: TARGET }, (_, i) => {
  const f = Math.pow(i / (TARGET - 1), SKEW);
  const pick = pool[Math.round(f * (pool.length - 1))];
  return { ...pick.level, id: `l${i + 6}`, name: nameFor(i, TARGET) };
});

const body = out
  .map(
    (l) =>
      `  {\n    id: '${l.id}',\n    name: '${l.name}',\n    start: { x: ${l.start.x}, y: ${l.start.y} },\n    goal: { x: ${l.goal.x}, y: ${l.goal.y} },\n    parPx: ${l.parPx},\n    walls: [\n${l.walls
        .map((w) => `      { x: ${w.x}, y: ${w.y}, w: ${w.w}, h: ${w.h} },`)
        .join('\n')}\n    ],\n  },`
  )
  .join('\n');

const header = `/**
 * GENERATED — do not edit by hand. Run \`npx vite-node scripts/genLevels.ts\`.
 *
 * ${out.length} maze levels from src/core/MazeGen.ts: spanning-tree
 * labyrinths with a difficulty-growing fraction of walls emitted on the FAR
 * half, constraining the stroke only through the mirror. Every level is
 * proved solvable with room for a hand, forced to wind (route ≥
 * ${MIN_WINDING}× direct), carries real decoy mass, and the set is ordered by
 * the shared absolute difficulty(). parPx is the proved route's arc length —
 * the par a winning line is measured against.
 *
 * levels.test.ts re-proves all of them on every run.
 */
import type { Level } from './types';

export const GENERATED_LEVELS: readonly Level[] = [
${body}
];
`;

writeFileSync('src/data/generatedLevels.ts', header);

console.log(
  `tried ${tried} · unsolvable ${rejectedUnsolvable} · flat ${rejectedFlat}` +
    ` · straight ${rejectedStraight} · pool ${pool.length} · shipped ${out.length}`
);
const picked = Array.from({ length: TARGET }, (_, i) =>
  pool[Math.round(Math.pow(i / (TARGET - 1), SKEW) * (pool.length - 1))]
);
const band = (a: number, b: number, f: (s: Scored) => number): string =>
  (picked.slice(a, b).reduce((x, s) => x + f(s), 0) / (b - a)).toFixed(2);
console.log('band     score  clearance  bands  walls  winding  decoy');
const STEP = Math.ceil(TARGET / 10);
for (let a = 0; a < TARGET; a += STEP) {
  const b = Math.min(TARGET, a + STEP);
  console.log(
    `${String(a + 6).padStart(3)}-${String(b + 5).padStart(3)}  ` +
      `${band(a, b, (s) => s.score)}   ${band(a, b, (s) => s.clear).padStart(6)}     ` +
      `${band(a, b, (s) => s.bands)}   ${band(a, b, (s) => s.walls).padStart(5)}   ` +
      `${band(a, b, (s) => s.winding)}   ${band(a, b, (s) => s.decoy)}`
  );
}
