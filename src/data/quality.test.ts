/**
 * Level quality — the things that make a generated set feel machine-made.
 *
 * Difficulty and solvability are covered in `levels.test.ts`. This file is
 * about craft: no wall that does nothing, no level that repeats another, no
 * geometry that reads as a mistake.
 */
import { describe, expect, it } from 'vitest';
import { LEVELS } from './levels';
import type { Level } from './types';
import { Playfield } from '../core/Playfield';
import { validateLevel } from '../core/LevelValidator';
import { BASE_HEIGHT, BASE_WIDTH, METRICS } from '../render/Theme';

const pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset);
const OPTS = { cell: 6, hitRadius: METRICS.hitRadius, goalRadius: METRICS.goalRadius };

describe('no wall is decoration', () => {
  /*
   * Random placement produces obstacles whose constraint is already covered by
   * something else — most often a far-half wall whose reflection lands inside a
   * near wall. The player studies it, folds it in their head, and finds it
   * changes nothing. That is worse than an absent wall: the level promises a
   * problem that does not exist. 34 of them shipped across 30 levels before the
   * generator started stripping them.
   *
   * The bar is strict on purpose — a wall counts as inert only when the player
   * can reach EXACTLY as much ground without it, so a wall that merely narrows
   * a corridor is never flagged.
   */
  it.each(LEVELS.map((l, i) => [i + 1, l.id] as const))(
    'level %i (%s) has no wall that changes nothing',
    (_i, id) => {
      const level = LEVELS.find((l) => l.id === id)!;
      const base = validateLevel(level, pf, OPTS);
      expect(base.solvable).toBe(true);

      for (let k = 0; k < level.walls.length; k++) {
        const without: Level = { ...level, walls: level.walls.filter((_, j) => j !== k) };
        const r = validateLevel(without, pf, OPTS);
        expect(
          r.solvable && r.reachable === base.reachable,
          `${id} wall ${k} is inert — removing it changes nothing the player can reach`
        ).toBe(false);
      }
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
  it('never overlaps two walls into a single blob', () => {
    for (const l of LEVELS) {
      for (let i = 0; i < l.walls.length; i++) {
        for (let k = i + 1; k < l.walls.length; k++) {
          const a = l.walls[i];
          const b = l.walls[k];
          const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          expect(ox > 1e-6 && oy > 1e-6, `${l.id} walls ${i} and ${k} overlap`).toBe(false);
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
