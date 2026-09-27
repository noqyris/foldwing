import { describe, expect, it } from 'vitest';
import { LEVELS } from '../data/levels';
import type { Level } from '../data/types';
import { dist, type Vec2 } from './Geometry';
import { validateLevel } from './LevelValidator';
import { Playfield } from './Playfield';
import { nearMissLine, routeField, routeFieldJob } from './RouteProgress';

// The game's playfield: 750×1334 with the Theme's insets.
const pf = new Playfield(750, 1334, { top: 88, right: 24, bottom: 144, left: 24 });
const px = (x: number, y: number) => pf.toScreen({ x, y });

/*
 * A maze with a cul-de-sac pressed up against the far side of a shelf.
 *
 *   goal ·                        the route: out of the start's room to the
 *   ─────────────────────  ·      right, up through the gap at the shelf's
 *   pocket │                      end, and back left to the goal.
 *          │   start room         The pocket runs up from the start's room and
 *   start ·                       ends right under the shelf, a wall away from
 *                                 the corridor the goal is on.
 */
const POCKET: Level = {
  id: 'pocket',
  name: 'Pocket',
  start: { x: 0.08, y: 0.92 },
  goal: { x: 0.08, y: 0.08 },
  walls: [
    { x: 0, y: 0.5, w: 0.4, h: 0.02 }, // the shelf, open on the right
    { x: 0.2, y: 0.52, w: 0.02, h: 0.28 }, // the pocket's inner wall
  ],
};

describe('routeField', () => {
  it('runs from 0 at the start to 1 at the goal', () => {
    const f = routeField(POCKET, pf)!;
    expect(f).not.toBeNull();
    expect(f.progressAt(pf.toScreen(POCKET.start))).toBeLessThan(0.02);
    expect(f.progressAt(pf.toScreen(POCKET.goal))).toBeGreaterThan(0.98);
  });

  /*
   * The case a straight-line measure gets wrong. The top of the pocket is
   * one shelf away from the corridor the goal is on — on the page it is
   * "almost there" — but to get anywhere from it the stroke has to come all
   * the way back out. It must not be credited with the corridor's number.
   */
  it('does not credit a dead end with the corridor on the other side of its wall', () => {
    const f = routeField(POCKET, pf)!;
    const pocketTop = px(0.1, 0.537); // a hair under the shelf
    const acrossShelf = px(0.1, 0.483); // a hair over it, on the route
    const pocketMouth = px(0.1, 0.84);
    const gap = px(0.45, 0.51);

    const top = f.progressAt(pocketTop)!;
    expect(top).not.toBeNull();
    expect(top).toBeLessThanOrEqual(f.progressAt(pocketMouth)!);
    expect(top).toBeLessThan(0.1);
    expect(f.progressAt(gap)!).toBeGreaterThan(top);
    expect(f.progressAt(acrossShelf)!).toBeGreaterThan(f.progressAt(gap)!);
    expect(f.progressAt(acrossShelf)!).toBeGreaterThan(0.4);

    // A stroke that died in the pocket got no further than its mouth.
    expect(f.furthest([pf.toScreen(POCKET.start), pocketMouth, pocketTop])).toBe(
      f.progressAt(pocketMouth)
    );
  });

  it('climbs at every step of the validator’s proved route', () => {
    const levels = [POCKET, LEVELS[0], LEVELS[5], LEVELS[57], LEVELS[LEVELS.length - 1]];
    for (const level of levels) {
      const route = validateLevel(level, pf);
      expect(route.solvable, level.id).toBe(true);
      const f = routeField(level, pf)!;
      const along = route.path.map((p) => f.progressAt(p)!);
      expect(along[0], level.id).toBe(0);
      expect(along[along.length - 1], level.id).toBe(1);
      for (let i = 1; i < along.length; i++) {
        expect(along[i], `${level.id} step ${i}`).toBeGreaterThan(along[i - 1]);
      }
    }
  });

  it('reads nothing inside a wall', () => {
    const f = routeField(POCKET, pf)!;
    expect(f.progressAt(px(0.2, 0.51))).toBeNull();
    expect(f.furthest([])).toBe(0);
  });

  it('refuses a maze the start cannot get out of', () => {
    const boxed: Level = {
      ...POCKET,
      id: 'boxed',
      walls: [{ x: 0, y: 0.5, w: 0.5, h: 0.03 }],
    };
    expect(routeField(boxed, pf)).toBeNull();
  });
});

/**
 * The validator's proved route as a stroke: from the start dot, cut where it
 * first enters the goal ring — a win ends there — with that last sample kept,
 * as the recorder keeps it.
 */
function provedStroke(level: Level): Vec2[] {
  const route = validateLevel(level, pf);
  const goal = pf.toScreen(level.goal);
  const out: Vec2[] = [pf.toScreen(level.start)];
  for (const p of route.path) {
    out.push(p);
    if (dist(p, goal) <= 30) break;
  }
  return out;
}

describe('the line still to go', () => {
  const GOAL_R = 30; // routeField's default, the validator's

  it('is zero inside the ring and nothing inside a wall', () => {
    const f = routeField(POCKET, pf)!;
    const goal = pf.toScreen(POCKET.goal);
    expect(f.remaining(goal)).toBe(0);
    expect(f.remaining({ x: goal.x + GOAL_R - 0.5, y: goal.y })).toBe(0);
    expect(f.remaining(px(0.2, 0.51))).toBeNull();
  });

  it('never reads shorter than the straight way to the ring', () => {
    for (const level of [POCKET, LEVELS[0], LEVELS[57], LEVELS[LEVELS.length - 1]]) {
      const f = routeField(level, pf)!;
      const goal = pf.toScreen(level.goal);
      for (let k = 0; k < 400; k++) {
        const p = { x: pf.x + ((k * 37) % 101) / 101 * (pf.axisX - pf.x), y: pf.y + ((k * 53) % 397) / 397 * pf.h };
        const r = f.remaining(p);
        if (r === null) continue;
        expect(r, `${level.id} ${JSON.stringify(p)}`).toBeGreaterThanOrEqual(Math.max(0, dist(p, goal) - GOAL_R) - 1e-9);
      }
    }
  });

  it('counts a dead end as the way back out of it', () => {
    const f = routeField(POCKET, pf)!;
    const top = f.remaining(px(0.1, 0.537))!;
    const mouth = f.remaining(px(0.1, 0.84))!;
    const acrossShelf = f.remaining(px(0.1, 0.483))!;
    expect(top).toBeGreaterThan(mouth);
    // One shelf away on the page, the whole detour away by the route.
    expect(top - acrossShelf).toBeGreaterThan(pf.h * 0.5);
  });

  /*
   * The live meter's promise: on the proved route, the line so far plus the
   * line still to go never falls as the stroke advances, and at the ring it
   * is exactly the finished line. So the meter never shows a star the best
   * line there is will not keep — the projection only ever rises to the truth.
   */
  it('makes a projection along the proved route that only rises, and lands on the finished line', () => {
    for (const level of [POCKET, LEVELS[0], LEVELS[5], LEVELS[57], LEVELS[LEVELS.length - 1]]) {
      const f = routeField(level, pf)!;
      const stroke = provedStroke(level);
      let len = 0;
      let last = -Infinity;
      for (let i = 0; i < stroke.length; i++) {
        if (i > 0) len += dist(stroke[i], stroke[i - 1]);
        const r = f.remaining(stroke[i]);
        expect(r, `${level.id} sample ${i}`).not.toBeNull();
        const projected = len + (r as number);
        expect(projected, `${level.id} sample ${i}`).toBeGreaterThanOrEqual(last - 1e-6);
        last = projected;
      }
      expect(f.remaining(stroke[stroke.length - 1])).toBe(0);
      expect(last).toBeCloseTo(len, 9);
    }
  });
});

describe('the sliced build', () => {
  it('builds the same field a slice at a time as in one shot', () => {
    const level = LEVELS[LEVELS.length - 1];
    const whole = routeField(level, pf)!;
    const job = routeFieldJob(level, pf);
    expect(job.done).toBe(false);
    expect(job.field).toBeNull();
    let slices = 0;
    while (!job.step(0)) slices++;
    // Budget 0 still does one slice a call, so it takes many calls.
    expect(slices).toBeGreaterThan(10);
    expect(job.done).toBe(true);
    const sliced = job.field!;
    for (let k = 0; k < 600; k++) {
      const p = { x: pf.x + ((k * 29) % 97) / 97 * (pf.axisX - pf.x), y: pf.y + ((k * 71) % 389) / 389 * pf.h };
      expect(sliced.progressAt(p)).toBe(whole.progressAt(p));
      expect(sliced.remaining(p)).toBe(whole.remaining(p));
    }
    // Stepping a finished job is free and changes nothing.
    expect(job.step(5)).toBe(true);
    expect(job.finish()).toBe(sliced);
  });

  it('finishes at once when a death needs it now, from wherever it got to', () => {
    const job = routeFieldJob(LEVELS[57], pf);
    job.step(0);
    job.step(0);
    const f = job.finish();
    expect(job.done).toBe(true);
    expect(f).not.toBeNull();
    expect(f!.progressAt(pf.toScreen(LEVELS[57].start))).toBe(0);
  });

  it('does nothing until asked', () => {
    const job = routeFieldJob(LEVELS[0], pf);
    expect(job.done).toBe(false);
    expect(job.field).toBeNull();
  });

  it('reports a boxed-in start as no field, sliced or not', () => {
    const boxed: Level = { ...POCKET, id: 'boxed', walls: [{ x: 0, y: 0.5, w: 0.5, h: 0.03 }] };
    const job = routeFieldJob(boxed, pf);
    while (!job.step(1));
    expect(job.field).toBeNull();
  });
});

describe('nearMissLine', () => {
  it('speaks only for a new best, from 20%', () => {
    expect(nearMissLine(4, 0.74, 0.5)).toBe('attempt 4 · furthest yet 74%');
    expect(nearMissLine(4, 0.19, 0)).toBeNull();
    expect(nearMissLine(4, 0.2, 0)).toBe('attempt 4 · furthest yet 20%');
    expect(nearMissLine(5, 0.6, 0.74)).toBeNull();
    expect(nearMissLine(5, 0.74, 0.74)).toBeNull();
  });

  it('never says the same number twice, and never 100%', () => {
    expect(nearMissLine(6, 0.742, 0.738)).toBeNull();
    expect(nearMissLine(6, 0.999, 0.5)).toBe('attempt 6 · furthest yet 99%');
    expect(nearMissLine(6, 1, 0.995)).toBeNull();
  });

  it('refuses numbers that are not numbers', () => {
    expect(nearMissLine(1, Number.NaN, 0)).toBeNull();
  });
});
