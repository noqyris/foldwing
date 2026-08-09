/**
 * Level quality — the things that make a generated set feel machine-made.
 *
 * Difficulty and solvability are covered in `levels.test.ts`. This file is
 * about craft: no wall that does nothing, no level that repeats another, no
 * geometry that reads as a mistake.
 */
import { describe, expect, it } from 'vitest';
import { LEVELS } from './levels';
import { Playfield } from '../core/Playfield';
import { validateLevel } from '../core/LevelValidator';
import { BASE_HEIGHT, BASE_WIDTH, METRICS } from '../render/Theme';

const pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset);
const OPTS = { cell: 6, hitRadius: METRICS.hitRadius, goalRadius: METRICS.goalRadius };
const TUTORIAL_COUNT = 5;

describe('every maze earns its walls', () => {
  /*
   * The old criterion — a wall is inert when removing it changes nothing the
   * player can REACH — was written for bar levels, where walls take area
   * away. It is meaningless for a maze: a spanning tree already reaches every
   * cell, so no maze wall changes reachable area; a maze wall's job is to
   * make the route LONG and the wrong turns real. So the craft bar moves to
   * where the craft is:
   *
   *   - the one true route must genuinely wind — well past the straight line
   *   - most of the ground must be off that route: dead ends to reject
   *
   * The winding floor sits a hair under the generator's own gate (1.35 —
   * lowered when the ramp gained its genuinely gentle 3×5 openers, which
   * physically cannot wind like a 7×11), measured with the identical
   * validator configuration. Measured minimum across the shipped set: 1.353.
   */
  it.each(LEVELS.slice(TUTORIAL_COUNT).map((l, i) => [i + 6, l.id] as const))(
    'level %i (%s) forces a winding route with real decoys',
    (_i, id) => {
      const level = LEVELS.find((l) => l.id === id)!;
      const r = validateLevel(level, pf, OPTS);
      expect(r.solvable).toBe(true);

      let arc = 0;
      for (let k = 1; k < r.path.length; k++) {
        arc += Math.hypot(r.path[k].x - r.path[k - 1].x, r.path[k].y - r.path[k - 1].y);
      }
      const s = pf.toScreen(level.start);
      const g = pf.toScreen(level.goal);
      const winding = arc / Math.max(1, Math.hypot(g.x - s.x, g.y - s.y));
      expect(winding, `${id} plays as a near-straight corridor`).toBeGreaterThan(1.34);

      // The route must not have the run of the place: most free ground is
      // decoy corridors. (Line-over-area, so the bar is naturally high — the
      // assertion is that it stays high for EVERY level.)
      expect(1 - r.path.length / r.reachable, `${id} has nothing to explore`).toBeGreaterThan(0.85);
    }
  );
});

describe('the set does not repeat itself', () => {
  it('has no two levels with the same wall layout', () => {
    const seen = new Map<string, string>();
    for (const l of LEVELS) {
      const key = l.walls
        .map((w) => `${w.x.toFixed(2)},${w.y.toFixed(2)},${w.w.toFixed(2)}`)
        .sort()
        .join('|');
      expect(seen.has(key), `${l.id} repeats ${seen.get(key)}`).toBe(false);
      seen.set(key, l.id);
    }
  });

  it('gives every level its own name', () => {
    const names = LEVELS.map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('geometry reads as intentional', () => {
  it('never overlaps two walls beyond a deliberate joint patch', () => {
    /*
     * Maze walls EXTEND into each other at junctions — flush abutment left a
     * rounded-corner seam at every T-joint, visible as a hairline split in
     * the labyrinth. The walls render opaque, so the overlap is invisible;
     * what stays forbidden is any overlap LARGER than one joint patch
     * (roughly thickness × thickness), which would mean two walls lying
     * along each other — a generator bug, not a joint.
     */
    const JOINT_X = 0.034; // max wall thickness in x, plus margin
    const JOINT_Y = 0.028; // max wall thickness in y, plus margin
    for (const l of LEVELS) {
      for (let i = 0; i < l.walls.length; i++) {
        for (let k = i + 1; k < l.walls.length; k++) {
          const a = l.walls[i];
          const b = l.walls[k];
          const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          const overlapping = ox > 1e-6 && oy > 1e-6;
          expect(
            overlapping && (ox > JOINT_X || oy > JOINT_Y),
            `${l.id} walls ${i} and ${k} overlap beyond a joint (${ox.toFixed(3)}×${oy.toFixed(3)})`
          ).toBe(false);
        }
      }
    }
  });

  it('keeps every wall thick enough to read at card size', () => {
    // The level-select previews draw these a few pixels tall; a sliver there
    // looks like a rendering fault rather than an obstacle.
    for (const l of LEVELS) {
      for (const w of l.walls) {
        expect(w.h, `${l.id} has a hairline wall`).toBeGreaterThan(0.02);
        expect(w.w, `${l.id} has a sliver wall`).toBeGreaterThan(0.02);
      }
    }
  });
});
