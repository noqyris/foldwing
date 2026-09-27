/**
 * The star rule, proved against every shipped level.
 *
 * Three stars go to a line at or under STAR3_RATIO × par, and par is the
 * validator's proved route. So the proved route, drawn as a stroke, must score
 * ★★★ on every one of the 300 levels — if it did not, the top tier would be
 * out of reach of the best line there is, and "Retry for ★★★" would be a lie.
 * And the live meter ("on pace · 1.04× par") must say so the whole way along
 * that route: a meter that dropped a star the finished line then gave back
 * would teach the player to distrust it.
 *
 * Here with the level proofs rather than beside Stars.ts because it runs the
 * validator and the route field over all 300 (about 25 s), which is what
 * `test:fast` leaves out `src/data/**` for.
 */

import { describe, expect, it } from 'vitest';
import { dist, type Vec2 } from '../core/Geometry';
import { routeArc, validateLevel } from '../core/LevelValidator';
import { Playfield } from '../core/Playfield';
import { routeField } from '../core/RouteProgress';
import { lineLength, lineRatio, PaceMeter, starsFor, STAR3_RATIO } from '../core/Stars';
import { BASE_HEIGHT, BASE_WIDTH, METRICS } from '../render/Theme';
import { LEVELS } from './levels';

const pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset);
const OPTS = { cell: 6, hitRadius: METRICS.hitRadius, goalRadius: METRICS.goalRadius };

/**
 * The proved route as the recorder would keep it: from the start dot, along
 * the route, up to and including the first sample inside the goal ring, where
 * a win ends. (The game clips the ink at the ring; the ratio is measured over
 * the raw samples, so keeping the whole last one is the stricter reading.)
 */
function provedStroke(path: readonly Vec2[], start: Vec2, goal: Vec2): Vec2[] {
  const out: Vec2[] = [start];
  for (const p of path) {
    out.push(p);
    if (dist(p, goal) <= METRICS.goalRadius) break;
  }
  return out;
}

describe('the proved route of every level scores three stars', () => {
  it.each(LEVELS.map((l, i) => [i + 1, l.id] as const))('level %i (%s)', (_n, id) => {
    const level = LEVELS.find((l) => l.id === id)!;
    const par = level.parPx;
    expect(par, `${id} carries its par`).toBeGreaterThan(0);

    // The par the card measures against is this very route's length.
    const route = validateLevel(level, pf, OPTS);
    expect(route.solvable, id).toBe(true);
    expect(Math.abs(routeArc(level, pf, OPTS)!.arc - (par as number)), `${id} par`).toBeLessThanOrEqual(1);

    const start = pf.toScreen(level.start);
    const goal = pf.toScreen(level.goal);
    const stroke = provedStroke(route.path, start, goal);
    const ratio = lineRatio(lineLength(stroke), par);
    expect(ratio, id).not.toBeNull();
    expect(ratio as number, `${id} line ÷ par`).toBeLessThanOrEqual(1);
    expect(starsFor(ratio), id).toBe(3);

    // The live meter along that stroke: ★★★ at every sample, and at the ring
    // it reads exactly the ratio the win is given.
    const field = routeField(level, pf, OPTS)!;
    expect(field, id).not.toBeNull();
    const meter = new PaceMeter(par);
    let len = 0;
    for (let i = 0; i < stroke.length; i++) {
      if (i > 0) len += dist(stroke[i], stroke[i - 1]);
      const reading = meter.read(len, field.remaining(stroke[i]));
      expect(reading.stars, `${id} sample ${i} of ${stroke.length}: ${reading.text}`).toBe(3);
      expect(reading.ratio as number).toBeLessThanOrEqual(STAR3_RATIO);
    }
    expect(meter.current().ratio, `${id} final reading`).toBe(ratio);
  });
});
