import { describe, expect, it } from 'vitest';
import {
  chaikin,
  closedFigure,
  densify,
  renderPath,
  StrokeRecorder,
} from './StrokeRecorder';
import { dist, distPointToSeg, vec2, type Vec2 } from './Geometry';
import { METRICS } from '../render/Theme';

describe('StrokeRecorder', () => {
  it('starts empty', () => {
    const r = new StrokeRecorder(10);
    expect(r.count).toBe(0);
    expect(r.last).toBeUndefined();
    expect(r.points).toEqual([]);
  });

  it('begin seeds the stroke with exactly one point', () => {
    const r = new StrokeRecorder(10);
    r.begin(vec2(5, 5));
    expect(r.count).toBe(1);
    expect(r.last).toEqual({ x: 5, y: 5 });
  });

  it('begin discards a previous stroke', () => {
    const r = new StrokeRecorder(10);
    r.begin(vec2(0, 0));
    r.push(vec2(100, 0));
    r.begin(vec2(7, 7));
    expect(r.points).toEqual([{ x: 7, y: 7 }]);
  });

  it('rejects samples closer than the threshold', () => {
    const r = new StrokeRecorder(10);
    r.begin(vec2(0, 0));
    expect(r.push(vec2(5, 0))).toBe(false);
    expect(r.push(vec2(9.99, 0))).toBe(false);
    expect(r.count).toBe(1);
  });

  it('accepts samples at or beyond the threshold', () => {
    const r = new StrokeRecorder(10);
    r.begin(vec2(0, 0));
    expect(r.push(vec2(10, 0))).toBe(true);
    expect(r.count).toBe(2);
  });

  it('measures spacing from the last ACCEPTED sample, not the last offered', () => {
    const r = new StrokeRecorder(10);
    r.begin(vec2(0, 0));
    r.push(vec2(6, 0)); // rejected
    r.push(vec2(12, 0)); // accepted: 12 from the origin, not 6 from the reject
    expect(r.points).toEqual([
      { x: 0, y: 0 },
      { x: 12, y: 0 },
    ]);
  });

  it('pushExact bypasses the spacing rule', () => {
    const r = new StrokeRecorder(10);
    r.begin(vec2(0, 0));
    r.pushExact(vec2(1, 0));
    expect(r.count).toBe(2);
    expect(r.last).toEqual({ x: 1, y: 0 });
  });

  it('copies points instead of aliasing the caller', () => {
    const r = new StrokeRecorder(10);
    const p: Vec2 = vec2(1, 2);
    r.begin(p);
    p.x = 999;
    expect(r.last).toEqual({ x: 1, y: 2 });
  });

  it('clear empties the stroke', () => {
    const r = new StrokeRecorder(10);
    r.begin(vec2(0, 0));
    r.push(vec2(50, 0));
    r.clear();
    expect(r.count).toBe(0);
    expect(r.last).toBeUndefined();
  });

  it('keeps every accepted sample at least the threshold apart', () => {
    const r = new StrokeRecorder(10);
    r.begin(vec2(0, 0));
    let s = 4242 >>> 0;
    const rand = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < 3000; i++) r.push(vec2(rand() * 400, rand() * 400));

    const pts = r.points;
    for (let i = 1; i < pts.length; i++) {
      expect(dist(pts[i - 1], pts[i])).toBeGreaterThanOrEqual(10 - 1e-9);
    }
  });
});

describe('chaikin', () => {
  it('preserves both endpoints', () => {
    const src = [vec2(0, 0), vec2(50, 100), vec2(100, 0)];
    const out = chaikin(src, 2);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ x: 100, y: 0 });
  });

  it('passes short paths through untouched', () => {
    expect(chaikin([], 2)).toEqual([]);
    expect(chaikin([vec2(1, 2)], 2)).toEqual([{ x: 1, y: 2 }]);
    expect(chaikin([vec2(1, 2), vec2(3, 4)], 2)).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
  });

  it('is a no-op at zero iterations', () => {
    const src = [vec2(0, 0), vec2(50, 100), vec2(100, 0)];
    expect(chaikin(src, 0)).toEqual(src);
  });

  it('does not mutate the source', () => {
    const src = [vec2(0, 0), vec2(50, 100), vec2(100, 0)];
    chaikin(src, 3);
    expect(src).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 100 },
      { x: 100, y: 0 },
    ]);
  });

  it('leaves a straight line straight', () => {
    const src = [vec2(0, 0), vec2(50, 0), vec2(100, 0)];
    for (const p of chaikin(src, 3)) expect(p.y).toBeCloseTo(0, 12);
  });

  it('cuts the corner — the smoothed path never leaves the convex hull', () => {
    const src = [vec2(0, 0), vec2(50, 100), vec2(100, 0)];
    const out = chaikin(src, 3);
    // The apex is pulled down; nothing is pushed beyond the source extremes.
    for (const p of out) {
      expect(p.y).toBeLessThanOrEqual(100);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(100);
    }
    const apex = Math.max(...out.map((p) => p.y));
    expect(apex).toBeLessThan(100);
  });

  it('roughly doubles the point count per pass', () => {
    const src = Array.from({ length: 10 }, (_, i) => vec2(i * 10, i % 2 === 0 ? 0 : 10));
    expect(chaikin(src, 1).length).toBe(20);
    expect(chaikin(src, 2).length).toBe(40);
  });
});

describe('densify', () => {
  it('splits a long segment into pieces no longer than the cap', () => {
    const out = densify([vec2(0, 0), vec2(100, 0)], 10);
    expect(out.length).toBe(11);
    for (let i = 1; i < out.length; i++) {
      expect(dist(out[i - 1], out[i])).toBeLessThanOrEqual(10 + 1e-9);
    }
  });

  it('leaves an already-dense path alone', () => {
    const src = [vec2(0, 0), vec2(4, 0), vec2(8, 0)];
    expect(densify(src, 10)).toEqual(src);
  });

  it('keeps the endpoints', () => {
    const out = densify([vec2(3, 7), vec2(303, 407)], 10);
    expect(out[0]).toEqual({ x: 3, y: 7 });
    expect(out[out.length - 1]).toEqual({ x: 303, y: 407 });
  });

  it('adds detail but never shape — every inserted point is ON the segment', () => {
    const a = vec2(10, 20);
    const b = vec2(310, 420);
    for (const p of densify([a, b], 7)) {
      expect(distPointToSeg(p, a, b)).toBeCloseTo(0, 9);
    }
  });

  it('passes degenerate input through', () => {
    expect(densify([], 10)).toEqual([]);
    expect(densify([vec2(1, 2)], 10)).toEqual([{ x: 1, y: 2 }]);
    expect(densify([vec2(1, 2), vec2(3, 4)], 0)).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
  });

  it('does not mutate the source', () => {
    const src = [vec2(0, 0), vec2(100, 0)];
    densify(src, 10);
    expect(src).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
  });
});

/** Distance from p to the nearest point of the polyline. */
function distToPath(p: Vec2, path: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const d = distPointToSeg(p, path[i - 1], path[i]);
    if (d < best) best = d;
  }
  return best;
}

/*
 * The renderer smooths; collision does not. That split is deliberate and LOCKED
 * — smoothing the collision path would let the player cheat corners. But it
 * creates an obligation in the other direction: the line the player WATCHES
 * must not wander away from the line the game TESTED, or they will see their
 * stroke sail through a wall and live, which reads as the game being broken.
 */
describe('renderPath — the drawn line must not lie about the tested line', () => {
  const rawFlick = [
    vec2(160.2, 532.9),
    vec2(240.2, 612.9),
    vec2(240.2, 692.9),
    vec2(120.0, 812.9),
  ];

  it('keeps the drawn path within the hit radius of the raw path at flick speed', () => {
    // 80-170px between samples: roughly 2400pt/s on a 375pt screen at 60fps.
    const drawn = renderPath(
      rawFlick,
      METRICS.renderMaxSpacing,
      METRICS.smoothIterations
    );
    const worst = Math.max(...drawn.map((p) => distToPath(p, rawFlick)));
    expect(worst).toBeLessThan(METRICS.hitRadius);
  });

  it('is the densify step that earns that — raw Chaikin alone blows the bound', () => {
    const naive = chaikin(rawFlick, METRICS.smoothIterations);
    const worst = Math.max(...naive.map((p) => distToPath(p, rawFlick)));
    expect(worst).toBeGreaterThan(METRICS.hitRadius);
  });

  it('holds the bound over random strokes at every speed', () => {
    let s = 777 >>> 0;
    const rand = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };

    for (let trial = 0; trial < 300; trial++) {
      // Spacing from a slow deliberate drag up to a full-screen flick.
      const spacing = 4 + rand() * 300;
      const raw: Vec2[] = [vec2(rand() * 300, rand() * 300)];
      for (let i = 0; i < 8; i++) {
        const angle = rand() * Math.PI * 2;
        const prev = raw[raw.length - 1];
        raw.push(
          vec2(prev.x + Math.cos(angle) * spacing, prev.y + Math.sin(angle) * spacing)
        );
      }

      const drawn = renderPath(raw, METRICS.renderMaxSpacing, METRICS.smoothIterations);
      for (const p of drawn) {
        expect(distToPath(p, raw)).toBeLessThan(METRICS.hitRadius);
      }
    }
  });

  it('still keeps the endpoints pinned to the start dot and the goal', () => {
    const drawn = renderPath(rawFlick, METRICS.renderMaxSpacing, METRICS.smoothIterations);
    expect(drawn[0]).toEqual(rawFlick[0]);
    expect(drawn[drawn.length - 1]).toEqual(rawFlick[rawFlick.length - 1]);
  });
});

describe('closedFigure', () => {
  const axis = 100;

  it('walks out along the stroke and back along its mirror', () => {
    const path = [vec2(10, 0), vec2(20, 50)];
    expect(closedFigure(path, axis)).toEqual([
      { x: 10, y: 0 },
      { x: 20, y: 50 },
      { x: 180, y: 50 },
      { x: 190, y: 0 },
    ]);
  });

  it('produces twice as many points as the stroke', () => {
    const path = Array.from({ length: 25 }, (_, i) => vec2(i, i * 2));
    expect(closedFigure(path, axis).length).toBe(50);
  });

  it('is left/right symmetric about the axis', () => {
    const path = [vec2(10, 0), vec2(40, 30), vec2(25, 60)];
    const fig = closedFigure(path, axis);
    for (let i = 0; i < fig.length; i++) {
      const opposite = fig[fig.length - 1 - i];
      expect(opposite.x).toBeCloseTo(2 * axis - fig[i].x, 12);
      expect(opposite.y).toBeCloseTo(fig[i].y, 12);
    }
  });

  it('does not mutate the source path', () => {
    const path = [vec2(10, 0), vec2(20, 50)];
    closedFigure(path, axis);
    expect(path).toEqual([
      { x: 10, y: 0 },
      { x: 20, y: 50 },
    ]);
  });

  it('degenerates gracefully on a stroke that rides the axis', () => {
    const path = [vec2(axis, 0), vec2(axis, 40)];
    expect(closedFigure(path, axis)).toEqual([
      { x: 100, y: 0 },
      { x: 100, y: 40 },
      { x: 100, y: 40 },
      { x: 100, y: 0 },
    ]);
  });
});
