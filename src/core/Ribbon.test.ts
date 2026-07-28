import { describe, expect, it } from 'vitest';
import { buildRibbon, DEFAULT_RIBBON, ribbonOutline, widthProfile } from './Ribbon';
import { dist, vec2, type Vec2 } from './Geometry';

const OPTS = { ...DEFAULT_RIBBON, taperPoints: 0, smoothPasses: 0 };

/** A straight run of n points spaced `gap` apart, one sample every `dt` ms. */
function run(n: number, gap: number, dt: number): { pts: Vec2[]; times: number[] } {
  const pts: Vec2[] = [];
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    pts.push(vec2(i * gap, 0));
    times.push(i * dt);
  }
  return { pts, times };
}

describe('widthProfile', () => {
  it('handles degenerate input', () => {
    expect(widthProfile([], [], OPTS)).toEqual([]);
    expect(widthProfile([vec2(0, 0)], [0], OPTS)).toEqual([OPTS.baseWidth / 2]);
  });

  it('returns one half-width per point', () => {
    const { pts, times } = run(12, 6, 16);
    expect(widthProfile(pts, times, OPTS).length).toBe(12);
  });

  /*
   * The whole point of the ribbon: the ink records how the hand moved. A hand
   * that hurried leaves a thinner line than one that lingered, which is what
   * makes two players' saved figures look like two different drawings.
   */
  it('draws a slow hand thicker than a fast one', () => {
    const slow = run(12, 3, 32); // 0.094 px/ms
    const fast = run(12, 40, 8); // 5.0 px/ms
    const ws = widthProfile(slow.pts, slow.times, OPTS);
    const wf = widthProfile(fast.pts, fast.times, OPTS);
    expect(ws[6]).toBeGreaterThan(wf[6]);
  });

  it('clamps to the configured scale range', () => {
    const crawl = run(10, 0.01, 100);
    const flick = run(10, 900, 1);
    const half = OPTS.baseWidth / 2;
    for (const w of widthProfile(crawl.pts, crawl.times, OPTS)) {
      expect(w).toBeLessThanOrEqual(half * OPTS.maxScale + 1e-9);
    }
    for (const w of widthProfile(flick.pts, flick.times, OPTS)) {
      expect(w).toBeGreaterThanOrEqual(half * OPTS.minScale - 1e-9);
    }
  });

  it('never returns a negative or NaN width', () => {
    const { pts, times } = run(20, 7, 16);
    // Duplicate timestamps would divide by zero without the dt floor.
    const stuck = times.map(() => 5);
    for (const w of widthProfile(pts, stuck, DEFAULT_RIBBON)) {
      expect(Number.isFinite(w)).toBe(true);
      expect(w).toBeGreaterThanOrEqual(0);
    }
  });

  it('tapers both ends toward nothing', () => {
    const { pts, times } = run(30, 6, 16);
    const w = widthProfile(pts, times, { ...DEFAULT_RIBBON, smoothPasses: 0 });
    expect(w[0]).toBeLessThan(w[15]);
    expect(w[29]).toBeLessThan(w[15]);
    // Symmetric taper on a uniform-speed stroke.
    expect(w[0]).toBeCloseTo(w[29], 6);
  });

  it('smoothing removes a single-sample spike', () => {
    const pts: Vec2[] = [];
    const times: number[] = [];
    for (let i = 0; i < 21; i++) {
      pts.push(vec2(i * 6, 0));
      // One frame stalls, which without smoothing would blister the stroke.
      times.push(i * 16 + (i === 10 ? 120 : 0));
    }
    const rough = widthProfile(pts, times, { ...DEFAULT_RIBBON, smoothPasses: 0, taperPoints: 0 });
    const smooth = widthProfile(pts, times, { ...DEFAULT_RIBBON, smoothPasses: 4, taperPoints: 0 });

    const spread = (a: number[]): number => Math.max(...a) - Math.min(...a);
    expect(spread(smooth)).toBeLessThan(spread(rough));
  });
});

describe('buildRibbon', () => {
  it('emits a quad per segment and a disc per point', () => {
    const { pts, times } = run(8, 10, 16);
    const r = buildRibbon(pts, times, OPTS);
    expect(r.quads.length).toBe(7);
    expect(r.discs.length).toBe(8);
  });

  it('skips zero-length segments instead of emitting NaN', () => {
    const pts = [vec2(0, 0), vec2(0, 0), vec2(10, 0)];
    const times = [0, 16, 32];
    const r = buildRibbon(pts, times, OPTS);
    expect(r.quads.length).toBe(1);
    for (const q of r.quads) {
      for (const p of [q.a, q.b, q.c, q.d]) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }
    }
  });

  it('offsets the quad corners perpendicular to the segment', () => {
    // Horizontal run, so the offsets must be purely vertical.
    const { pts, times } = run(3, 10, 16);
    const r = buildRibbon(pts, times, OPTS);
    const q = r.quads[0];
    expect(q.a.x).toBeCloseTo(pts[0].x, 9);
    expect(q.d.x).toBeCloseTo(pts[0].x, 9);
    expect(q.a.y).toBeGreaterThan(0);
    expect(q.d.y).toBeLessThan(0);
    expect(q.a.y).toBeCloseTo(-q.d.y, 9);
  });

  it('keeps every disc centred on its own sample', () => {
    const { pts, times } = run(6, 9, 16);
    const r = buildRibbon(pts, times, OPTS);
    r.discs.forEach((d, i) => expect(dist(d.p, pts[i])).toBeCloseTo(0, 9));
  });

  it('handles a single point without throwing', () => {
    const r = buildRibbon([vec2(5, 5)], [0], OPTS);
    expect(r.quads).toEqual([]);
    expect(r.discs.length).toBe(1);
  });

  it('handles an empty path', () => {
    const r = buildRibbon([], [], OPTS);
    expect(r.quads).toEqual([]);
    expect(r.discs).toEqual([]);
  });

  /*
   * A hairpin is where a single offset polygon would fold through itself and a
   * triangulator would punch a hole in the ink. Quads and discs cannot: they
   * only ever overlap, which at full opacity is invisible.
   */
  it('survives a hairpin turn', () => {
    const pts = [vec2(0, 0), vec2(50, 0), vec2(100, 0), vec2(50, 1), vec2(0, 1)];
    const times = [0, 16, 32, 48, 64];
    const r = buildRibbon(pts, times, OPTS);
    expect(r.quads.length).toBe(4);
    for (const q of r.quads) {
      for (const p of [q.a, q.b, q.c, q.d]) expect(Number.isFinite(p.x)).toBe(true);
    }
  });
});

describe('ribbonOutline', () => {
  it('walks down one side and back up the other', () => {
    const { pts, times } = run(6, 10, 16);
    expect(ribbonOutline(pts, times, OPTS).length).toBe(12);
  });

  it('stays finite on a path with duplicate points', () => {
    const pts = [vec2(0, 0), vec2(0, 0), vec2(0, 0)];
    for (const p of ribbonOutline(pts, [0, 16, 32], OPTS)) {
      expect(Number.isFinite(p.x)).toBe(true);
    }
  });
});
