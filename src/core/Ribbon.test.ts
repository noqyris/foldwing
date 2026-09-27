import { describe, expect, it } from 'vitest';
import {
  buildRibbon,
  DEFAULT_RIBBON,
  ribbonOutline,
  ribbonSlice,
  settledPoints,
  thinPath,
  widthProfile,
} from './Ribbon';
import { dist, distPointToSeg, vec2, type Vec2 } from './Geometry';
import { renderStroke, renderTailReach } from './StrokeRecorder';
import { METRICS, pt } from '../render/Theme';

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

describe('the house nib', () => {
  /* SPEC §3.3: a slow line swells more, a fast one no longer turns to a scratch. */
  it('swells to 1.5 and thins to 0.6, with the speed, taper and smoothing unchanged', () => {
    expect(DEFAULT_RIBBON).toEqual({
      baseWidth: 10,
      maxScale: 1.5,
      minScale: 0.6,
      fastSpeed: 2.2,
      taperPoints: 7,
      smoothPasses: 3,
    });
  });

  it('draws a crawl at 1.5 × the nib and a flick at 0.6 ×', () => {
    const half = DEFAULT_RIBBON.baseWidth / 2;
    const crawl = run(30, 0, 100); // a pen at rest
    const flick = run(30, 400, 1);
    const plain = { ...DEFAULT_RIBBON, taperPoints: 0 };
    expect(widthProfile(crawl.pts, crawl.times, plain)[15]).toBeCloseTo(half * 1.5, 6);
    expect(widthProfile(flick.pts, flick.times, plain)[15]).toBeCloseTo(half * 0.6, 6);
  });
});

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

/** Deterministic pseudo-random numbers, so a failure can be replayed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * A wandering hand: raw samples 3-40px apart with frame-ish timing, including
 * the things real input produces — a sample in the same millisecond as the last,
 * a near-duplicate like the exact contact point `pushExact` appends, and flicks.
 */
function wander(seed: number, n: number): { pts: Vec2[]; times: number[] } {
  const rand = rng(seed);
  const pts: Vec2[] = [vec2(200, 1100)];
  const times: number[] = [0];
  let heading = -Math.PI / 2;
  for (let i = 1; i < n; i++) {
    heading += (rand() - 0.5) * 1.6;
    const step = rand() < 0.1 ? 0.5 : rand() < 0.1 ? 40 : 3 + rand() * 12;
    const prev = pts[i - 1];
    pts.push(vec2(prev.x + Math.cos(heading) * step, prev.y + Math.sin(heading) * step));
    times.push(times[i - 1] + (rand() < 0.1 ? 0 : 8 + Math.floor(rand() * 20)));
  }
  return { pts, times };
}

describe('ribbonSlice', () => {
  /*
   * The live stroke paints [0, b) once and [b, n) every move. Between them they
   * have to be exactly the ribbon — a quad missing at the seam is a visible
   * notch in the ink, a quad painted twice is wasted work.
   */
  it('splits a ribbon into slices that add back up to it exactly', () => {
    const { pts, times } = wander(7, 60);
    const widths = widthProfile(pts, times, DEFAULT_RIBBON);
    const whole = buildRibbon(pts, times, DEFAULT_RIBBON);
    for (const b of [0, 1, 2, 17, 59, 60]) {
      const head = ribbonSlice(pts, widths, 0, b);
      const tail = ribbonSlice(pts, widths, b);
      expect([...head.quads, ...tail.quads]).toEqual(whole.quads);
      expect([...head.discs, ...tail.discs]).toEqual(whole.discs);
    }
  });
});

describe('settledPoints', () => {
  /*
   * The promise the live stroke's baking rests on: once a point is reported
   * settled, no later sample moves it or changes its width, so what was painted
   * once is still exactly right however long the stroke then gets. Checked
   * against the whole pipeline as the game runs it, sample by sample.
   */
  it('reports only points that no later sample changes', () => {
    const opts = { ...DEFAULT_RIBBON, baseWidth: pt(5) };
    const reach = renderTailReach(METRICS.smoothIterations);
    for (const seed of [1, 2, 3, 4, 5]) {
      const { pts, times } = wander(seed, 90);
      const frames = [];
      for (let k = 1; k <= pts.length; k++) {
        const drawn = renderStroke(
          pts.slice(0, k),
          times.slice(0, k),
          METRICS.renderMaxSpacing,
          METRICS.smoothIterations
        );
        frames.push({
          points: drawn.points,
          widths: widthProfile(drawn.points, drawn.times, opts),
        });
      }
      const final = frames[frames.length - 1];
      let settledSomething = false;
      for (const f of frames) {
        const s = settledPoints(f.points.length, opts, reach);
        if (s > 0) settledSomething = true;
        expect(final.points.slice(0, s)).toEqual(f.points.slice(0, s));
        expect(final.widths.slice(0, s)).toEqual(f.widths.slice(0, s));
      }
      expect(settledSomething).toBe(true);
    }
  });

  it('settles nothing while the start taper is still stretching', () => {
    expect(settledPoints(2 * DEFAULT_RIBBON.taperPoints, DEFAULT_RIBBON, 3)).toBe(0);
    expect(settledPoints(200, DEFAULT_RIBBON, 3)).toBeGreaterThan(180);
  });
});

describe('thinPath', () => {
  it('keeps both ends and every index in order', () => {
    const { pts } = wander(11, 80);
    const keep = thinPath(pts, 2, 0.1);
    expect(keep[0]).toBe(0);
    expect(keep[keep.length - 1]).toBe(pts.length - 1);
    for (let i = 1; i < keep.length; i++) expect(keep[i]).toBeGreaterThan(keep[i - 1]);
  });

  it('drops the samples a small card cannot tell apart', () => {
    // A gentle arc sampled every 0.25px — a card's line at thumbnail scale.
    const pts: Vec2[] = [];
    for (let i = 0; i <= 800; i++) {
      const a = (i / 800) * Math.PI;
      pts.push(vec2(100 + Math.cos(a) * 60, 100 + Math.sin(a) * 60));
    }
    const keep = thinPath(pts, 2, 0.1);
    expect(keep.length).toBeLessThan(pts.length / 5);
  });

  /*
   * What makes thinning safe to show: every sample it drops lies within the
   * tolerance of the line that replaced it, so a card whose smoothed line
   * cleared a wall still shows it clear, and no chord is longer than asked.
   */
  it('never strays further than the tolerance from the line it thins', () => {
    for (const seed of [21, 22, 23]) {
      const { pts } = wander(seed, 200);
      // Scale down to a card, where most samples fall within a pixel.
      const card = pts.map((p) => vec2(p.x * 0.27, p.y * 0.27));
      const keep = thinPath(card, 2, 0.1);
      for (let j = 1; j < keep.length; j++) {
        const a = card[keep[j - 1]];
        const b = card[keep[j]];
        if (keep[j] - keep[j - 1] > 1) expect(dist(a, b)).toBeLessThanOrEqual(2);
        for (let k = keep[j - 1] + 1; k < keep[j]; k++) {
          expect(distPointToSeg(card[k], a, b)).toBeLessThanOrEqual(0.1 + 1e-9);
        }
      }
    }
  });

  it('keeps a hairpin rather than cutting across it', () => {
    const pts = [vec2(0, 0), vec2(0.5, 0), vec2(1, 0), vec2(0.5, 0.05), vec2(0, 0.1)];
    expect(thinPath(pts, 2, 0.01)).toContain(2);
  });

  it('handles short paths', () => {
    expect(thinPath([], 2, 0.1)).toEqual([]);
    expect(thinPath([vec2(1, 1)], 2, 0.1)).toEqual([0]);
    expect(thinPath([vec2(1, 1), vec2(1, 1.1)], 2, 0.1)).toEqual([0, 1]);
  });
});
