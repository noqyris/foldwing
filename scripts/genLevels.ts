/**
 * Level generator.
 *
 * Emits src/data/generatedLevels.ts: 95 levels appended after the five
 * hand-authored tutorial levels, ordered easy to hard.
 *
 * Two rules it will not break:
 *  1. Every level is PROVED solvable by LevelValidator, against the same
 *     playfield and the same CollisionSystem the game runs. A generator that
 *     emits an impossible level is worse than no generator, because the failure
 *     is invisible until a player has wasted an evening on it.
 *  2. Difficulty is measured, not assumed. Levels are generated at random and
 *     then SORTED by how much of the drawable half they take away, so the ramp
 *     reflects what the levels actually do rather than what the parameters
 *     intended.
 *
 * Deterministic: a fixed seed means regenerating produces the identical file,
 * so a diff shows real changes rather than reshuffled noise.
 *
 *   npx vite-node scripts/genLevels.ts
 */

import { writeFileSync } from 'node:fs';
import { Playfield } from '../src/core/Playfield';
import {
  clearance,
  difficulty,
  interlock,
  interlockBands,
  PLAYABLE_CLEARANCE,
  pressure,
  validateLevel,
} from '../src/core/LevelValidator';
import { BASE_HEIGHT, BASE_WIDTH, METRICS } from '../src/render/Theme';
import type { Level, Rect } from '../src/data/types';

const TARGET = 95;
/**
 * Candidates to measure before choosing. Bigger than TARGET on purpose: the 95
 * that ship are picked as an even spread across this pool's difficulty range,
 * which is what keeps the ramp free of cliffs.
 */
const POOL = 1100;
/**
 * Least fraction of a level's constrained heights that must be squeezed by BOTH
 * halves at once. Small on purpose: one genuine interlocked band in a level is
 * a real decision, and demanding many would make every level the same shape.
 */
const MIN_INTERLOCK = 0.08;
const pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset);

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * One obstacle row. The four shapes are the whole vocabulary of the game:
 * an edge wall you go around, an axis wall you go outside of, and the same two
 * mirrored onto the half you cannot see.
 */
type RowKind = 'leftEdge' | 'axisLeft' | 'axisRight' | 'rightEdge' | 'gate' | 'interlock';

function buildRow(
  kind: RowKind,
  y: number,
  h: number,
  w: number,
  r: () => number,
  t: number
): Rect[] {
  switch (kind) {
    case 'leftEdge':
      return [{ x: 0, y, w, h }];
    case 'axisLeft':
      return [{ x: round(0.5 - w), y, w, h }];
    case 'axisRight':
      return [{ x: 0.5, y, w, h }];
    case 'rightEdge':
      return [{ x: round(1 - w), y, w, h }];
    case 'gate': {
      // Two walls on the player's own half with a gap to thread between them.
      const gap = 0.1 + r() * 0.06;
      const left = round(Math.max(0.08, (0.5 - gap) * 0.55));
      return [
        { x: 0, y, w: left, h },
        { x: round(left + gap), y, w: round(0.5 - left - gap), h },
      ];
    }
    case 'interlock': {
      /*
       * The game itself, as one row — and the thing the generator was missing.
       *
       * Every other row kind puts its walls at a height nothing else occupies,
       * so the player meets one constraint, clears it, then meets the next.
       * The reflection never has to be held in mind at the same time as the
       * wall in front of you, which turns the whole game into an ordinary
       * obstacle course wearing a mirror as decoration. Measured on the
       * previous set: 98 of 100 levels had the two halves NEVER overlap in y.
       *
       * This row closes the corridor from BOTH sides at the same height. The
       * left edge of the gap is a wall the player can see; the right edge is
       * the reflection of a wall on the far half, which they can only find by
       * folding the screen in their head. Neither wall alone says where the
       * opening is.
       *
       *   own half     [0 ........ a]  gap  [a+gap ....... 0.5]
       *   drawn as      left wall           reflection of the right wall
       */
      /*
       * The corridor narrows with difficulty. Count alone gave only three
       * settings (one, two or three interlocked bands), which left levels 6-62
       * sitting at exactly two and the mirror demand flat across half the game.
       * Width is continuous, so the ramp can actually be a ramp.
       */
      const gap = 0.145 - t * 0.06 + r() * 0.03;
      const a = round(0.06 + r() * (0.5 - gap - 0.12));
      return [
        { x: 0, y, w: a, h },
        // Starts on the axis, so its reflection lands exactly at a + gap.
        { x: 0.5, y, w: round(0.5 - a - gap), h },
      ];
    }
  }
}

function makeCandidate(seed: number, t: number): Level {
  const r = rng(seed);
  // 3 rows at the easy end, 8 at the hard end.
  const rows = Math.round(3 + t * 5);
  const h = round(0.05 + r() * 0.012);

  const walls: Rect[] = [];
  const top = 0.16;
  const bottom = 0.8;

  /*
   * Reserve rows for interlock BEFORE rolling anything else.
   *
   * Left to chance, the two halves essentially never share a height and the
   * mirror stops mattering, so the count is decided up front and grows with
   * difficulty: one of these rows even in the gentlest generated level, three
   * by the hard end. Everything else fills in around them.
   */
  const want = Math.min(rows, 1 + Math.round(t * 3));
  const locked = new Set<number>();
  while (locked.size < want) locked.add(Math.floor(r() * rows));

  for (let i = 0; i < rows; i++) {
    const span = rows === 1 ? 0 : i / (rows - 1);
    const y = round(bottom - span * (bottom - top) + (r() - 0.5) * 0.02);

    let kind: RowKind;
    if (locked.has(i)) {
      kind = 'interlock';
    } else {
      // Mirror rows are what make the game itself; their share grows with
      // difficulty, and a gate needs room so it only appears once it fits.
      const roll = r();
      if (roll < 0.3) kind = 'leftEdge';
      else if (roll < 0.5) kind = 'axisRight';
      else if (roll < 0.68) kind = 'rightEdge';
      else if (roll < 0.85) kind = 'axisLeft';
      else kind = t > 0.35 ? 'gate' : 'leftEdge';
    }

    const w = round(0.2 + t * 0.18 + r() * 0.12);
    walls.push(...buildRow(kind, y, h, Math.min(w, 0.44), r, t));
  }

  /*
   * Guarantee at least one wall the REFLECTION has to clear.
   *
   * Left-only rows are a level the player can read entirely off the screen —
   * the mirror never bites, and the game degenerates into an ordinary
   * obstacle-avoider. Random row picking produces such a level often enough
   * that it has to be excluded by construction, not by luck.
   */
  if (!walls.some((w) => w.x + w.w > 0.5)) {
    const swap = Math.floor(r() * walls.length);
    const victim = walls[swap];
    walls[swap] = { x: 0.5, y: victim.y, w: victim.w, h: victim.h };
  }

  const sx = round(0.07 + r() * 0.08);
  const gx = round(0.07 + r() * 0.3);

  return {
    id: `g${seed}`,
    name: '',
    start: { x: sx, y: 0.92 },
    goal: { x: gx, y: 0.07 },
    walls,
  };
}

/* ------------------------------------------------------------------ names */

/*
 * Names carry tone, and tone should agree with the ramp.
 *
 * A flat list picked by a coprime stride reads as varied and lands wherever it
 * lands: the previous set called its hardest level "Soft bend" and a
 * mid-table one "Thin bend". Nobody files that as a bug, and everybody feels
 * it. The adjectives are therefore banded from gentle to severe, and a level
 * draws from the band its position sits in.
 */
const ADJ_TIERS = [
  ['First', 'Soft', 'Quiet', 'Slow', 'Gentle'],
  ['Open', 'Wide', 'Warm', 'Still', 'Pale'],
  ['Second', 'Long', 'Late', 'Early', 'Loose'],
  ['Narrow', 'Deep', 'Dark', 'Cold', 'Thin'],
  ['Sharp', 'Tight', 'Quick', 'Severe', 'Closed'],
];
const NOUN = [
  'fold', 'crease', 'wing', 'mirror', 'hinge', 'seam', 'pleat', 'turn',
  'pass', 'gate', 'thread', 'knot', 'sweep', 'arc', 'bend', 'lean', 'drift',
  'reach', 'edge', 'span',
];

/**
 * @param i zero-based position in the generated block.
 *
 * Within a tier the noun advances by a stride coprime to the list length, so a
 * tier never repeats a noun and adjacent levels never share a word. Different
 * tiers use different adjectives, which makes every name in the set unique
 * without needing to check.
 */
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

/**
 * Drop walls that provably change nothing.
 *
 * Random placement produces obstacles whose constraint is already covered by
 * another wall — most often a far-half wall whose reflection lands inside a
 * near wall. They cost the player nothing but a second look, which is worse
 * than useless: the level says "here is a thing to solve" and there is no
 * thing. The previous set shipped 34 of them across 30 levels.
 *
 * A wall counts as inert when the player can reach EXACTLY as much ground
 * without it. One pass, then the caller re-validates — anything the removal
 * disturbs is caught by the acceptance checks that follow.
 */
function stripInert(level: Level): Level {
  const base = validateLevel(level, pf, VOPTS);
  if (!base.solvable) return level;
  const keep = level.walls.filter((_, i) => {
    const without: Level = { ...level, walls: level.walls.filter((_, k) => k !== i) };
    const r = validateLevel(without, pf, VOPTS);
    return !(r.solvable && r.reachable === base.reachable);
  });
  return keep.length === level.walls.length || keep.length === 0
    ? level
    : { ...level, walls: keep };
}

/** How much the required route weaves — direction reversals along the BFS path. */
function turnsIn(level: Level): number {
  const r = validateLevel(level, pf, VOPTS);
  if (!r.solvable) return 0;
  let turns = 0;
  let dir = 0;
  for (let i = 1; i < r.path.length; i++) {
    const d = Math.sign(r.path[i].x - r.path[i - 1].x);
    if (d !== 0 && dir !== 0 && d !== dir) turns++;
    if (d !== 0) dir = d;
  }
  return turns;
}

/* ------------------------------------------------------------------- main */

interface Scored {
  level: Level;
  clear: number;
  bands: number;
  inter: number;
  walls: number;
  turns: number;
  press: number;
  score: number;
}

const pool: Scored[] = [];
const seen = new Set<string>();
let seed = 1;
let tried = 0;
let rejectedUnsolvable = 0;
let rejectedTrivial = 0;
let rejectedFlat = 0;

while (pool.length < POOL && tried < 400000) {
  tried++;
  /*
   * Spread the difficulty dial evenly instead of tying it to how many levels
   * have been accepted. The old scheme raised `t` as the set filled, so the
   * pool was densest wherever acceptance happened to be easy and the final
   * ramp inherited those gaps.
   */
  const t = (seed * 0.6180339887498949) % 1;
  let cand = makeCandidate(seed++, t);

  const key = JSON.stringify(cand.walls);
  if (seen.has(key)) continue;

  /*
   * Prove it is solvable WITH ROOM TO SPARE, not merely solvable.
   *
   * Asking only for solvability at the exact hit radius accepts corridors a
   * couple of pixels wider than the stroke. Those levels are provably
   * finishable and impossible to actually draw, and they all pile up at the
   * hard end where they are least likely to be questioned.
   */
  const playable = (l: Level): boolean =>
    validateLevel(l, pf, {
      ...VOPTS,
      hitRadius: METRICS.hitRadius + PLAYABLE_CLEARANCE,
    }).solvable;

  if (!playable(cand)) {
    rejectedUnsolvable++;
    continue;
  }
  if (interlock(cand) < MIN_INTERLOCK) {
    rejectedFlat++;
    continue;
  }

  // Clean the level, then re-prove everything about the cleaned version —
  // stripping a wall can move a corridor, so nothing may be assumed.
  cand = stripInert(cand);
  if (!playable(cand) || interlock(cand) < MIN_INTERLOCK) {
    rejectedFlat++;
    continue;
  }

  const press = pressure(cand, pf);
  // The floor sits just under where the hand-authored tutorial ENDS (Tangle is
  // 0.241), so level 6 is a small breather after the tutorial climax rather
  // than a step backwards into something easier than level 2.
  if (press < 0.205) {
    rejectedTrivial++;
    continue;
  }

  seen.add(JSON.stringify(cand.walls));
  pool.push({
    level: cand,
    clear: clearance(cand, pf, VOPTS),
    bands: interlockBands(cand),
    inter: interlock(cand),
    walls: cand.walls.length,
    turns: turnsIn(cand),
    press,
    score: 0,
  });
}

/*
 * Score with the SHARED definition in LevelValidator, not a private one.
 *
 * An earlier version rank-normalised each axis across this pool, which reads
 * well but cannot be reproduced from the shipped 95 — the ranks depend on the
 * candidates that happened to be generated, so no test could ever check the
 * order against the rule that produced it. `difficulty()` is absolute for
 * exactly that reason.
 */
pool.forEach((s) => {
  s.score = difficulty(s.level, pf);
});

pool.sort((a, b) => a.score - b.score);

/*
 * Take an even spread across the whole pool rather than the first 95.
 *
 * Slicing off one end packs the set into a narrow difficulty band and leaves
 * cliffs where the pool happens to be sparse — the previous set jumped from
 * 25.2 to 13.5 px of clearance between levels 60 and 61, doubling the required
 * precision in a single step.
 */
const out = Array.from({ length: TARGET }, (_, i) => {
  const pick = pool[Math.round((i * (pool.length - 1)) / (TARGET - 1))];
  return { ...pick.level, id: `l${i + 6}`, name: nameFor(i, TARGET) };
});

const body = out
  .map(
    (l) =>
      `  {\n    id: '${l.id}',\n    name: '${l.name}',\n    start: { x: ${l.start.x}, y: ${l.start.y} },\n    goal: { x: ${l.goal.x}, y: ${l.goal.y} },\n    walls: [\n${l.walls
        .map((w) => `      { x: ${w.x}, y: ${w.y}, w: ${w.w}, h: ${w.h} },`)
        .join('\n')}\n    ],\n  },`
  )
  .join('\n');

const header = `/**
 * GENERATED — do not edit by hand. Run \`npx vite-node scripts/genLevels.ts\`.
 *
 * ${out.length} levels, every one proved solvable by LevelValidator against the
 * shipped playfield and the shipped collision system, and ordered by measured
 * pressure (how much of the drawable half the walls and their reflections take
 * away) rather than by the parameters that happened to produce them.
 *
 * levels.test.ts re-proves all of them on every run, so a change to the
 * playfield, the hit radius or the geometry cannot silently strand a level.
 */
import type { Level } from './types';

export const GENERATED_LEVELS: readonly Level[] = [
${body}
];
`;

writeFileSync('src/data/generatedLevels.ts', header);

console.log(
  `tried ${tried} · unsolvable ${rejectedUnsolvable} · trivial ${rejectedTrivial}` +
    ` · no interlock ${rejectedFlat} · pool ${pool.length} · shipped ${out.length}`
);
const picked = Array.from({ length: TARGET }, (_, i) =>
  pool[Math.round((i * (pool.length - 1)) / (TARGET - 1))]
);
const band = (a: number, b: number, f: (s: Scored) => number): string =>
  (picked.slice(a, b).reduce((x, s) => x + f(s), 0) / (b - a)).toFixed(2);
console.log('band     score  clearance  bands  walls');
for (let a = 0; a < TARGET; a += 19) {
  const b = Math.min(TARGET, a + 19);
  console.log(
    `${String(a + 6).padStart(3)}-${String(b + 5).padStart(3)}  ` +
      `${band(a, b, (s) => s.score)}   ${band(a, b, (s) => s.clear).padStart(6)}     ` +
      `${band(a, b, (s) => s.bands)}   ${band(a, b, (s) => s.walls)}`
  );
}
