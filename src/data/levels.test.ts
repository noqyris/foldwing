import { describe, expect, it } from 'vitest';
import { LEVELS, TUTORIAL_LEVELS } from './levels';
import type { Level } from './types';
import { GENERATED_LEVELS } from './generatedLevels';
import { Playfield } from '../core/Playfield';
import {
  clearance,
  difficulty,
  interlock,
  interlockBands,
  PLAYABLE_CLEARANCE,
  pressure,
  validateLevel,
} from '../core/LevelValidator';
import { BASE_HEIGHT, BASE_WIDTH, METRICS } from '../render/Theme';

const pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset);
const OPTS = {
  cell: 6,
  hitRadius: METRICS.hitRadius,
  goalRadius: METRICS.goalRadius,
};

describe('level set', () => {
  it('ships 100 levels, tutorial first', () => {
    expect(TUTORIAL_LEVELS.length).toBe(5);
    expect(GENERATED_LEVELS.length).toBe(95);
    expect(LEVELS.length).toBe(100);
    expect(LEVELS[0].id).toBe('l1');
  });

  it('gives every level a unique id and a name', () => {
    const ids = LEVELS.map((l) => l.id);
    expect(new Set(ids).size).toBe(LEVELS.length);
    for (const l of LEVELS) expect(l.name.length).toBeGreaterThan(0);
  });

  it('keeps the hand-authored numbers exactly as tuned', () => {
    // LOCKED. The generator appends; it must never rewrite these.
    expect(TUTORIAL_LEVELS[0]).toEqual({
      id: 'l1',
      name: 'First reflection',
      start: { x: 0.14, y: 0.88 },
      goal: { x: 0.14, y: 0.12 },
      walls: [
        { x: 0, y: 0.44, w: 0.3, h: 0.06 },
        { x: 0.5, y: 0.64, w: 0.28, h: 0.06 },
      ],
    });
    expect(TUTORIAL_LEVELS[3].name).toBe('Sacrifice');
    expect(TUTORIAL_LEVELS[4].walls.length).toBe(7);
  });
});

describe('authoring invariants', () => {
  it('starts and goals are on the drawable half', () => {
    // LOCKED: the player may only draw where x < 0.5.
    for (const l of LEVELS) {
      expect(l.start.x, l.id).toBeLessThan(0.5);
      expect(l.goal.x, l.id).toBeLessThan(0.5);
    }
  });

  it('keeps every level inside the normalized playfield', () => {
    for (const l of LEVELS) {
      for (const p of [l.start, l.goal]) {
        expect(p.x, l.id).toBeGreaterThanOrEqual(0);
        expect(p.y, l.id).toBeGreaterThanOrEqual(0);
        expect(p.y, l.id).toBeLessThanOrEqual(1);
      }
      for (const w of l.walls) {
        expect(w.x, l.id).toBeGreaterThanOrEqual(0);
        expect(w.w, l.id).toBeGreaterThan(0);
        expect(w.h, l.id).toBeGreaterThan(0);
        expect(w.x + w.w, l.id).toBeLessThanOrEqual(1.0001);
        expect(w.y + w.h, l.id).toBeLessThanOrEqual(1.0001);
      }
    }
  });

  /*
   * LOCKED rule 1: obstacles must be asymmetric. If the right half mirrored the
   * left, the reflection would never constrain anything the player could not
   * already see, and the game would have no content at all.
   */
  it('every level is asymmetric about the mirror axis', () => {
    for (const l of LEVELS) {
      const key = (w: { x: number; y: number; w: number; h: number }): string =>
        `${w.x.toFixed(3)}|${w.y.toFixed(3)}|${w.w.toFixed(3)}|${w.h.toFixed(3)}`;
      const own = new Set(l.walls.map(key));
      const mirrored = l.walls.map((w) => key({ ...w, x: 1 - w.x - w.w }));
      const identical = mirrored.every((m) => own.has(m)) && own.size === mirrored.length;
      expect(identical, `${l.id} is mirror-symmetric and therefore contentless`).toBe(false);
    }
  });

  it('gives every level at least one wall the reflection has to clear', () => {
    for (const l of LEVELS) {
      const constrainsMirror = l.walls.some((w) => w.x + w.w > 0.5);
      expect(constrainsMirror, `${l.id} has nothing on the right half`).toBe(true);
    }
  });
});

/*
 * The build gate. An unsolvable level is invisible — it looks exactly like a
 * hard one until someone has wasted an evening on it — so every level is
 * re-proved on every run, against the shipped playfield and the shipped
 * collision system. Change the hit radius or the playfield inset and this is
 * what tells you a level just became impossible.
 */
describe('solvability', () => {
  it.each(LEVELS.map((l, i) => [i + 1, l.id, l.name] as const))(
    'level %i (%s "%s") is solvable',
    (_i, id) => {
      const level = LEVELS.find((l) => l.id === id);
      expect(level).toBeDefined();
      const result = validateLevel(level!, pf, OPTS);
      expect(result.solvable, `${id}: ${result.reason ?? ''}`).toBe(true);
      expect(result.path.length).toBeGreaterThan(1);
    }
  );
});

/*
 * Solvable is not the same as playable.
 *
 * The BFS proves a route exists for the stroke's centreline. It says nothing
 * about how wide that route is, and a corridor two pixels wider than the ink
 * passes it happily — provably finishable, impossible to draw with a finger.
 * Ten levels shipped that way, the worst leaving 0.3 css px of margin on a
 * phone, and they were all at the hard end where "I can't do it" reads as
 * intended rather than as broken.
 *
 * So every level must survive the same proof with the collision radius
 * inflated by PLAYABLE_CLEARANCE: the route has to be wide enough that a hand
 * can miss by a millimetre and live.
 */
describe('playability', () => {
  it.each(LEVELS.map((l, i) => [i + 1, l.id, l.name] as const))(
    'level %i (%s "%s") leaves room for the hand',
    (_i, id) => {
      const level = LEVELS.find((l) => l.id === id)!;
      const result = validateLevel(level, pf, {
        ...OPTS,
        hitRadius: METRICS.hitRadius + PLAYABLE_CLEARANCE,
      });
      expect(
        result.solvable,
        `${id} is solvable but only through a gap no finger can hold`
      ).toBe(true);
    }
  );

  it('measures real slack on the tightest level, not just a pass', () => {
    // Guards the guard: if `clearance` ever stopped discriminating, every
    // level would trivially "pass" the check above.
    const tightest = LEVELS.map((l) => clearance(l, pf, OPTS)).sort((a, b) => a - b)[0];
    expect(tightest).toBeGreaterThanOrEqual(PLAYABLE_CLEARANCE);
    // The set should still contain genuinely tight levels; if the minimum ran
    // away upwards the hard end has quietly gone soft.
    expect(tightest).toBeLessThan(PLAYABLE_CLEARANCE * 3);
  });
});

/*
 * The mirror has to be load-bearing.
 *
 * A level whose near walls and far reflections sit at different heights
 * decomposes into "clear this, then clear that" — the player reads one half,
 * passes it, reads the other. The reflection is decoration and the game is an
 * ordinary obstacle course. That is not a hypothetical: the set shipped in
 * build 5 had 98 of 100 levels with ZERO overlap between the two halves, and
 * the game played exactly as flat as that number predicts.
 *
 * The tutorial is deliberately exempt. Levels 1-4 teach one constraint at a
 * time, and level 5 is where both arrive together.
 */
describe('the mirror has to matter', () => {
  const GENERATED = LEVELS.slice(TUTORIAL_LEVELS.length);

  it('makes every generated level squeeze from both halves at once', () => {
    for (const l of GENERATED) {
      expect(interlock(l), `${l.id} "${l.name}" never constrains both halves at one height`)
        .toBeGreaterThan(0.05);
    }
  });

  it('teaches one half at a time first, then puts them together', () => {
    // 1-4 introduce the near wall and the far reflection separately.
    for (const l of TUTORIAL_LEVELS.slice(0, 4)) expect(interlock(l)).toBe(0);
    // 5 is the turn: both at once.
    expect(interlock(TUTORIAL_LEVELS[4])).toBeGreaterThan(0.1);
  });

  it('keeps the set substantially interlocked, not just past a threshold', () => {
    // Guards against a regression that clears the bar on every level by a hair.
    const mean = GENERATED.reduce((a, l) => a + interlock(l), 0) / GENERATED.length;
    expect(mean).toBeGreaterThan(0.2);
  });
});

describe('difficulty ramp', () => {
  const scores = LEVELS.map((l) => pressure(l, pf));

  it('rises overall from the first level to the last', () => {
    const firstTen = scores.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
    const lastTen = scores.slice(-10).reduce((a, b) => a + b, 0) / 10;
    expect(lastTen).toBeGreaterThan(firstTen * 1.8);
  });

  /*
   * Monotonic in DIFFICULTY, not in pressure.
   *
   * This assertion used to be about pressure, because pressure was the sort
   * key. It is not any more, and it should not be: sorting by how much of the
   * screen is covered ordered the set by how busy each level looked, and left
   * the mirror demand — the thing the game is actually about — uncorrelated
   * with position (rho -0.057). Pressure is still checked below as a
   * descriptive statistic, in aggregate, where it is honest.
   */
  it('never steps backwards within the generated set', () => {
    const gen = GENERATED_LEVELS.map((l) => difficulty(l, pf));
    for (let i = 1; i < gen.length; i++) {
      expect(gen[i], `${GENERATED_LEVELS[i].id} is easier than the one before`)
        .toBeGreaterThanOrEqual(gen[i - 1] - 1e-9);
    }
  });

  it('ramps the two axes that matter, not just the wall count', () => {
    const first = GENERATED_LEVELS.slice(0, 20);
    const last = GENERATED_LEVELS.slice(-20);
    const mean = (ls: readonly Level[], f: (l: Level) => number) =>
      ls.reduce((a, l) => a + f(l), 0) / ls.length;

    // Precision demand rises: the tightest corridor gets tighter.
    expect(mean(last, (l) => clearance(l, pf, OPTS))).toBeLessThan(
      mean(first, (l) => clearance(l, pf, OPTS)) * 0.6
    );
    // Mirror demand rises: more heights squeezed from both halves at once.
    expect(mean(last, (l) => interlockBands(l))).toBeGreaterThan(
      mean(first, (l) => interlockBands(l)) * 1.4
    );
  });

  it('has no cliff — no ten-level band doubles the precision demand', () => {
    // A jump from 25px of slack to 13px in one step reads as the game breaking,
    // not as the game getting harder. That shipped once.
    const band = (a: number) =>
      LEVELS.slice(a, a + 10).reduce((x, l) => x + clearance(l, pf, OPTS), 0) / 10;
    for (let a = 10; a + 10 <= LEVELS.length; a += 10) {
      const prev = band(a - 10);
      const cur = band(a);
      expect(cur, `levels ${a + 1}-${a + 10} tighten too abruptly`).toBeGreaterThan(prev * 0.55);
    }
  });

  it('opens gently and ends demanding', () => {
    expect(scores[0]).toBeLessThan(0.12);
    expect(scores[scores.length - 1]).toBeGreaterThan(0.4);
  });
});
