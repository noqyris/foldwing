import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LEVELS, TUTORIAL_LEVELS } from './levels';
import { dailyLevel } from '../systems/Daily';
import type { Level } from './types';
import { GENERATED_LEVELS } from './generatedLevels';
import { Playfield } from '../core/Playfield';
import {
  clearance,
  difficulty,
  interlock,
  PLAYABLE_CLEARANCE,
  routeArc,
  validateLevel,
} from '../core/LevelValidator';
import { BASE_HEIGHT, BASE_WIDTH, METRICS } from '../render/Theme';
import { CollisionSystem } from '../core/CollisionSystem';
import {
  drawnRoute,
  gridFoldCosts,
  gridRoute,
  judge,
  LESSONS,
  measureTutorial,
  RADII,
  unfolded,
} from '../../scripts/tutorialLessons';

const pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset);
const OPTS = {
  cell: 6,
  hitRadius: METRICS.hitRadius,
  goalRadius: METRICS.goalRadius,
};

/*
 * Memoized, because these two are the whole cost of this file.
 *
 * `clearance` is a seven-step binary search that runs a full BFS at each step,
 * and `difficulty` is not cheap either. Six tests below each mapped one of them
 * across all 300 levels, recomputing from scratch every time: measured, the
 * three ramp tests alone took 356 of the suite's 405 seconds, for numbers that
 * are a pure function of a level that never changes during a run.
 *
 * Keyed by level id, which the suite already proves unique.
 */
const clearanceCache = new Map<string, number>();
const difficultyCache = new Map<string, number>();

function slack(l: Level): number {
  let v = clearanceCache.get(l.id);
  if (v === undefined) {
    v = clearance(l, pf, OPTS);
    clearanceCache.set(l.id, v);
  }
  return v;
}

function hardness(l: Level): number {
  let v = difficultyCache.get(l.id);
  if (v === undefined) {
    v = difficulty(l, pf);
    difficultyCache.set(l.id, v);
  }
  return v;
}

describe('level set', () => {
  it('ships 300 levels, tutorial first', () => {
    expect(TUTORIAL_LEVELS.length).toBe(5);
    expect(GENERATED_LEVELS.length).toBe(295);
    expect(LEVELS.length).toBe(300);
    expect(LEVELS[0].id).toBe('l1');
  });

  it('keys every level by its position, because the save stores ids', () => {
    // cleared / bestMs / medals are keyed by id while unlockedIndex is a
    // position; the schema-3 migration relies on the two meaning the same.
    LEVELS.forEach((l, i) => expect(l.id).toBe(`l${i + 1}`));
  });

  /*
   * The tutorial was re-authored as mazes in September 2026, and MazeGen was
   * split into stages so the tutorial generator could choose its folds. Both
   * the 295 generated levels and every Daily Fold must come out identical to
   * what players already had: a changed level 6+ would move saved clears onto
   * different mazes, and a changed Daily would give two phones two different
   * puzzles on the same date. Fingerprints taken before the split.
   */
  it('keeps levels 6 to 300 byte-identical to the shipped set', () => {
    const hash = createHash('sha256').update(JSON.stringify(GENERATED_LEVELS)).digest('hex');
    expect(hash).toBe('dfce8f291248d209539536292499cd58ec4619f3524083d68aae47acd72d94ae');
    LEVELS.slice(5).forEach((l, i) => expect(l).toBe(GENERATED_LEVELS[i]));
  });

  it('keeps every Daily Fold identical to the one players already had', () => {
    const base = Date.UTC(2026, 8, 1);
    const days = Array.from({ length: 60 }, (_, i) =>
      dailyLevel(new Date(base + i * 86_400_000).toISOString().slice(0, 10))
    );
    const hash = createHash('sha256').update(JSON.stringify(days)).digest('hex');
    expect(hash).toBe('126ba82836071b38b847a545458a810e57414c3e31bf676c9b6f047223f3b954');
  });

  it('gives every level a unique id and a name', () => {
    const ids = LEVELS.map((l) => l.id);
    expect(new Set(ids).size).toBe(LEVELS.length);
    for (const l of LEVELS) expect(l.name.length).toBeGreaterThan(0);
  });

  it('keeps the tutorial mazes exactly as generated', () => {
    // scripts/genTutorialMazes.ts writes these from src/core/MazeGen.ts. A
    // change to MazeGen that would silently re-carve the player's first maze
    // fails here, not in a review of a 600-line diff nobody reads.
    expect(TUTORIAL_LEVELS[0]).toEqual({
      id: 'l1',
      name: 'First reflection',
      start: { x: 0.0833, y: 0.92 },
      goal: { x: 0.0833, y: 0.07 },
      parPx: 1209,
      walls: [
        { x: 0.1532, y: 0.3855, w: 0.1936, h: 0.021 },
        { x: 0, y: 0.5135, w: 0.1667, h: 0.021 },
        { x: 0.1667, y: 0.7695, w: 0.3333, h: 0.021 },
        { x: 0.1667, y: 0.1295, w: 0.3333, h: 0.021 },
        { x: 0.3198, y: 0.1295, w: 0.027, h: 0.1385 },
        { x: 0.3198, y: 0.3855, w: 0.027, h: 0.2665 },
        { x: 0.1532, y: 0.268, w: 0.027, h: 0.1385 },
        { x: 0.6667, y: 0.6415, w: 0.3333, h: 0.021 },
      ],
    });
    expect(TUTORIAL_LEVELS.map((l) => l.name)).toEqual([
      'First reflection',
      'Zigzag',
      'Gate',
      'Sacrifice',
      'Tangle',
    ]);
  });
});

/*
 * The tutorial has to be a LABYRINTH, and each level has to teach its lesson —
 * measured on the line a hand can draw, not on the maze grid.
 *
 * The first tutorial mazes were accepted by counting cells. Measured afterwards
 * on the drawn line, l1's folded wall cost 0% (its line ran straight up an open
 * left column), l4's and l5's folds barely moved the line, and the validator's
 * path hugged the undrawn left edge for 62% of l1. None of that was visible to
 * the cell count, so none of it failed a test. These pin the lessons with the
 * rules the generator selects by (scripts/tutorialLessons.ts), so a future
 * regeneration cannot quietly lose one.
 */
describe('the tutorial is a labyrinth that teaches', () => {
  it('measures on a ruler the game agrees with', () => {
    for (const l of TUTORIAL_LEVELS) {
      for (const r of RADII) {
        const line = drawnRoute(l, pf, r);
        expect(line, `${l.id} has no drawable line at r=${r}`).not.toBeNull();
        // Every leg is a stroke the game itself allows...
        const collision = new CollisionSystem(l.walls.map((w) => pf.toScreenRect(w)), r, pf.axisX);
        for (let i = 1; i < line!.points.length; i++) {
          expect(collision.blocks(line!.points[i - 1], line!.points[i]), `${l.id} leg ${i} at r=${r}`).toBe(false);
        }
        // ...it is the shortest: never longer than the validator's proved
        // path, and within the lattice's few percent of the validator's grid
        // weighted by length...
        const opts = { ...OPTS, hitRadius: r };
        expect(line!.length, l.id).toBeLessThanOrEqual(routeArc(l, pf, opts)!.arc);
        const grid = gridRoute(l, pf, r);
        expect(grid / line!.length, l.id).toBeGreaterThanOrEqual(1);
        expect(grid / line!.length, l.id).toBeLessThan(1.1);
        // ...and folding is a visibility choice: the same walls on the near
        // half give the same line, so a fold cost is the lie and nothing else.
        expect(Math.abs(drawnRoute(unfolded(l), pf, r)!.length - line!.length), l.id).toBeLessThan(1);
      }
    }
  });

  it.each(TUTORIAL_LEVELS.map((l, i) => [l.id, l.name, i] as const))(
    '%s "%s" goes through its maze and teaches its lesson at both radii, on both rulers',
    (id, name, i) => {
      expect(LESSONS[i].id).toBe(id);
      expect(LESSONS[i].name).toBe(name);
      const level = TUTORIAL_LEVELS[i];
      const m = measureTutorial(level, pf);
      expect(m, `${id} is unmeasurable`).not.toBeNull();
      expect(judge(LESSONS[i], m!, gridFoldCosts(level, pf))).toEqual([]);
    }
  );

  it('winds further at every step of the tutorial', () => {
    for (const r of RADII) {
      const winding = TUTORIAL_LEVELS.map((l) => {
        const line = drawnRoute(l, pf, r)!;
        return line.length / line.direct;
      });
      for (let i = 1; i < winding.length; i++) {
        expect(winding[i], `${TUTORIAL_LEVELS[i].id} winds no further than the one before at r=${r}`).toBeGreaterThan(
          winding[i - 1]
        );
      }
    }
  });

  it('would have refused the tutorial the review caught', () => {
    // Guards the guard: the l1 that shipped before these rules. Its folded wall
    // cost the line nothing, its line was straight, and the left column was an
    // open lane — every one of those has to be a failure, or the rules above
    // could pass anything.
    const reviewed: Level = {
      id: 'l1',
      name: 'First reflection',
      start: { x: 0.25, y: 0.92 },
      goal: { x: 0.0833, y: 0.07 },
      walls: [
        { x: 0.1532, y: 0.1295, w: 0.3468, h: 0.021 },
        { x: 0.3198, y: 0.7695, w: 0.1802, h: 0.021 },
        { x: 0.1532, y: 0.1295, w: 0.027, h: 0.4372 },
        { x: 0.3198, y: 0.3533, w: 0.027, h: 0.4372 },
        { x: 0.8333, y: 0.7695, w: 0.1667, h: 0.021 },
      ],
    };
    const why = judge(LESSONS[0], measureTutorial(reviewed, pf)!, gridFoldCosts(reviewed, pf)).join('\n');
    expect(why).toMatch(/lane runs up the undrawn left edge/);
    expect(why).toMatch(/folds cost 0\.0% at r=/);
    expect(why).toMatch(/folds cost 0\.0% on the validator grid/);
    expect(why).toMatch(/0 turns at r=/);
    expect(why).toMatch(/hugs the left edge/);
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
    //
    // `clearance` is a 7-step binary search and returns its LOWER bound, so it
    // understates the true slack by up to 34/2^7 ≈ 0.27px. The exact proof at
    // PLAYABLE_CLEARANCE is the per-level test above; this one only has to
    // agree with it to within the search's own resolution.
    const quantization = 34 / 2 ** 7;
    const tightest = LEVELS.map(slack).sort((a, b) => a - b)[0];
    expect(tightest).toBeGreaterThanOrEqual(PLAYABLE_CLEARANCE - quantization);
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
 * The tutorial is deliberately exempt from the FLOOR. Its mazes fold one or two
 * chosen walls where a generated maze folds a fraction at random, so both halves
 * do bite at once (a maze has walls at nearly every height) but gently — the
 * tutorial's own gate is that it rises strictly into level 6, below.
 */
describe('the mirror has to matter', () => {
  const GENERATED = LEVELS.slice(TUTORIAL_LEVELS.length);

  it('makes every generated level squeeze from both halves at once', () => {
    for (const l of GENERATED) {
      expect(interlock(l), `${l.id} "${l.name}" never constrains both halves at one height`)
        .toBeGreaterThan(0.05);
    }
  });

  it('keeps the set substantially interlocked, not just past a threshold', () => {
    // Guards against a regression that clears the bar on every level by a hair.
    const mean = GENERATED.reduce((a, l) => a + interlock(l), 0) / GENERATED.length;
    expect(mean).toBeGreaterThan(0.2);
  });
});

describe('difficulty ramp', () => {
  /*
   * These used to assert on `pressure`. Pressure is blocked AREA, and a maze
   * is thin walls around big rooms — the hardest maze in the set measures
   * ~0.29 where a mid-table bar level measured 0.4. The statistic stopped
   * describing the thing the assertions are about, so the assertions now use
   * `difficulty()` — the actual sort key — and pressure stays what the
   * validator says it is: a descriptive number.
   */
  it('rises overall from the first level to the last', () => {
    const mean = (ls: readonly Level[]): number =>
      ls.reduce((a, l) => a + hardness(l), 0) / ls.length;
    expect(mean(LEVELS.slice(-10))).toBeGreaterThan(mean(LEVELS.slice(0, 10)) * 1.5);
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
  it('never steps backwards, from level 1 to level 300', () => {
    // The tutorial used to be exempt, and it measured l1 0.096, l2 0.100,
    // l3 0.094, l5 0.200 against l6 0.148: two steps backwards, one of them
    // the hand-over into the generated set. The tutorial mazes are chosen to
    // rise STRICTLY into level 6, so the whole ladder now answers to one rule.
    const all = LEVELS.map(hardness);
    for (let i = 1; i < all.length; i++) {
      const strict = i <= TUTORIAL_LEVELS.length;
      expect(all[i], `${LEVELS[i].id} is easier than the one before`)
        .toBeGreaterThanOrEqual(all[i - 1] + (strict ? 1e-9 : -1e-9));
    }
  });

  it('ramps the two axes that matter, not just the wall count', () => {
    const first = GENERATED_LEVELS.slice(0, 20);
    const last = GENERATED_LEVELS.slice(-20);
    const mean = (ls: readonly Level[], f: (l: Level) => number) =>
      ls.reduce((a, l) => a + f(l), 0) / ls.length;

    // Precision demand rises: the tightest corridor gets tighter.
    expect(mean(last, slack)).toBeLessThan(mean(first, slack) * 0.6);
    // Planning demand rises: the one true route winds further past the
    // straight line. (Interlock BANDS do not ramp in a maze set — every maze
    // squeezes from both halves at most heights — so the count would be a
    // saturated, meaningless axis here.)
    const winding = (l: Level): number => {
      const r = validateLevel(l, pf, OPTS);
      let arc = 0;
      for (let k = 1; k < r.path.length; k++) {
        arc += Math.hypot(r.path[k].x - r.path[k - 1].x, r.path[k].y - r.path[k - 1].y);
      }
      const s = pf.toScreen(l.start);
      const g = pf.toScreen(l.goal);
      return arc / Math.max(1, Math.hypot(g.x - s.x, g.y - s.y));
    };
    expect(mean(last, winding)).toBeGreaterThan(mean(first, winding) * 1.25);
  });

  it('has no cliff — no ten-level band doubles the precision demand', () => {
    // A jump from 25px of slack to 13px in one step reads as the game breaking,
    // not as the game getting harder. That shipped once.
    const band = (a: number) =>
      LEVELS.slice(a, a + 10).reduce((x, l) => x + slack(l), 0) / 10;
    for (let a = 10; a + 10 <= LEVELS.length; a += 10) {
      const prev = band(a - 10);
      const cur = band(a);
      expect(cur, `levels ${a + 1}-${a + 10} tighten too abruptly`).toBeGreaterThan(prev * 0.55);
    }
  });

  it('opens gently and ends demanding', () => {
    expect(hardness(LEVELS[0])).toBeLessThan(0.35);
    expect(hardness(LEVELS[LEVELS.length - 1])).toBeGreaterThan(0.62);
  });
});
