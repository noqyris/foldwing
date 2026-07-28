import { describe, expect, it } from 'vitest';
import {
  boundsOf,
  clamp,
  dist,
  distPointToSeg,
  inflate,
  isEmptyRect,
  lerpPoint,
  mirrorPath,
  mirrorPoint,
  mirrorX,
  pointInRect,
  segCircleEntryT,
  segRect,
  segRectEntryT,
  segSeg,
  vec2,
  type Rect,
  type Vec2,
} from './Geometry';

/** Deterministic LCG — property tests must fail reproducibly or they are noise. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('clamp / lerpPoint / dist', () => {
  it('clamps to the closed interval', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it('interpolates along a segment', () => {
    expect(lerpPoint(vec2(0, 0), vec2(10, 20), 0)).toEqual({ x: 0, y: 0 });
    expect(lerpPoint(vec2(0, 0), vec2(10, 20), 1)).toEqual({ x: 10, y: 20 });
    expect(lerpPoint(vec2(0, 0), vec2(10, 20), 0.5)).toEqual({ x: 5, y: 10 });
  });

  it('measures euclidean distance', () => {
    expect(dist(vec2(0, 0), vec2(3, 4))).toBe(5);
    expect(dist(vec2(-1, -1), vec2(-1, -1))).toBe(0);
  });
});

describe('mirror', () => {
  const axis = 100;

  it('reflects across the axis', () => {
    expect(mirrorX(40, axis)).toBe(160);
    expect(mirrorX(160, axis)).toBe(40);
  });

  it('leaves points on the axis untouched', () => {
    expect(mirrorPoint(vec2(axis, 33), axis)).toEqual({ x: axis, y: 33 });
  });

  it('is an involution', () => {
    const r = rng(7);
    for (let i = 0; i < 500; i++) {
      const p = vec2(r() * 800 - 400, r() * 800 - 400);
      const back = mirrorPoint(mirrorPoint(p, axis), axis);
      expect(back.x).toBeCloseTo(p.x, 10);
      expect(back.y).toBe(p.y);
    }
  });

  it('never changes y', () => {
    expect(mirrorPoint(vec2(10, 55), axis).y).toBe(55);
  });

  it('mirrors a whole path without mutating the source', () => {
    const path = [vec2(10, 0), vec2(20, 5)];
    const out = mirrorPath(path, axis);
    expect(out).toEqual([
      { x: 190, y: 0 },
      { x: 180, y: 5 },
    ]);
    expect(path[0]).toEqual({ x: 10, y: 0 });
  });
});

describe('inflate / pointInRect', () => {
  const r: Rect = { x: 10, y: 20, w: 30, h: 40 };

  it('grows on all four sides', () => {
    expect(inflate(r, 5)).toEqual({ x: 5, y: 15, w: 40, h: 50 });
    expect(inflate(r, 0)).toEqual(r);
  });

  it('treats the boundary as inside', () => {
    expect(pointInRect(vec2(10, 20), r)).toBe(true);
    expect(pointInRect(vec2(40, 60), r)).toBe(true);
    expect(pointInRect(vec2(25, 40), r)).toBe(true);
  });

  it('rejects points outside', () => {
    expect(pointInRect(vec2(9.9, 40), r)).toBe(false);
    expect(pointInRect(vec2(40.1, 40), r)).toBe(false);
    expect(pointInRect(vec2(25, 19.9), r)).toBe(false);
    expect(pointInRect(vec2(25, 60.1), r)).toBe(false);
  });

  it('honours the pad argument', () => {
    expect(pointInRect(vec2(5, 40), r)).toBe(false);
    expect(pointInRect(vec2(5, 40), r, 5)).toBe(true);
    expect(pointInRect(vec2(4.9, 40), r, 5)).toBe(false);
  });

  it('reports a rect shrunk past nothing as empty', () => {
    const thin: Rect = { x: 100, y: 200, w: 300, h: 20 };
    expect(isEmptyRect(inflate(thin, 0))).toBe(false);
    expect(isEmptyRect(inflate(thin, -9))).toBe(false); // 20 -> 2, still real
    expect(isEmptyRect(inflate(thin, -15))).toBe(true); // 20 -> -10, inverted
  });
});

/*
 * A negative pad shrinks rather than grows. The game never does this — its hit
 * radius is always positive — but the predicate has to stay coherent across its
 * whole parameter domain, because the next thing to use it (a grid validator
 * eroding cells) will.
 */
describe('shrunk-past-empty rects', () => {
  const thin: Rect = { x: 100, y: 200, w: 300, h: 20 };
  const across = [vec2(250, 100), vec2(250, 300)] as const;

  it('cannot be hit, matching pointInRect', () => {
    expect(pointInRect(vec2(250, 210), thin, -15)).toBe(false);
    expect(segRect(across[0], across[1], thin, -15)).toBe(false);
    expect(segRectEntryT(across[0], across[1], thin, -15)).toBeNull();
  });

  it('still resolves normally at a shrink that leaves the rect real', () => {
    expect(segRect(across[0], across[1], thin, -9)).toBe(true);
    expect(segRectEntryT(across[0], across[1], thin, -9)).toBeCloseTo(0.545, 12);
  });

  it('keeps the two implementations in agreement across negative pads', () => {
    const r2 = rng(31337);
    for (let i = 0; i < 8000; i++) {
      const a = vec2(r2() * 600, r2() * 600);
      const b = vec2(r2() * 600, r2() * 600);
      const rect: Rect = { x: 100, y: 200, w: 300, h: 20 };
      const pad = r2() * 40 - 30; // spans shrink-to-empty and grow
      expect(segRectEntryT(a, b, rect, pad) !== null).toBe(segRect(a, b, rect, pad));
    }
  });
});

describe('segSeg', () => {
  it('detects a plain crossing', () => {
    expect(segSeg(vec2(0, 0), vec2(10, 10), vec2(0, 10), vec2(10, 0))).toBe(true);
  });

  it('rejects non-crossing segments', () => {
    expect(segSeg(vec2(0, 0), vec2(1, 1), vec2(5, 5), vec2(6, 6))).toBe(false);
    expect(segSeg(vec2(0, 0), vec2(10, 0), vec2(0, 5), vec2(10, 5))).toBe(false);
  });

  it('rejects parallel segments', () => {
    expect(segSeg(vec2(0, 0), vec2(10, 0), vec2(0, 1), vec2(10, 1))).toBe(false);
  });

  it('accepts a shared endpoint', () => {
    expect(segSeg(vec2(0, 0), vec2(10, 0), vec2(10, 0), vec2(10, 10))).toBe(true);
  });

  it('accepts a T junction', () => {
    expect(segSeg(vec2(0, 0), vec2(10, 0), vec2(5, 0), vec2(5, 10))).toBe(true);
  });

  it('accepts overlapping collinear segments', () => {
    expect(segSeg(vec2(0, 0), vec2(10, 0), vec2(5, 0), vec2(15, 0))).toBe(true);
    expect(segSeg(vec2(0, 0), vec2(10, 0), vec2(2, 0), vec2(8, 0))).toBe(true);
  });

  it('rejects disjoint collinear segments', () => {
    expect(segSeg(vec2(0, 0), vec2(10, 0), vec2(11, 0), vec2(20, 0))).toBe(false);
  });

  it('accepts collinear segments that touch at one point', () => {
    expect(segSeg(vec2(0, 0), vec2(10, 0), vec2(10, 0), vec2(20, 0))).toBe(true);
  });

  it('handles a degenerate point lying on a segment', () => {
    expect(segSeg(vec2(5, 0), vec2(5, 0), vec2(0, 0), vec2(10, 0))).toBe(true);
    expect(segSeg(vec2(5, 1), vec2(5, 1), vec2(0, 0), vec2(10, 0))).toBe(false);
  });
});

describe('segRect', () => {
  // A wall shaped like the real thing: wide and thin.
  const wall: Rect = { x: 100, y: 200, w: 300, h: 20 };

  it('hits when both endpoints are inside', () => {
    expect(segRect(vec2(150, 205), vec2(200, 215), wall)).toBe(true);
  });

  it('hits when one endpoint is inside', () => {
    expect(segRect(vec2(0, 0), vec2(150, 210), wall)).toBe(true);
    expect(segRect(vec2(150, 210), vec2(0, 0), wall)).toBe(true);
  });

  it('hits when the segment passes straight through', () => {
    expect(segRect(vec2(250, 100), vec2(250, 400), wall)).toBe(true);
  });

  it('misses when the segment stays clear', () => {
    expect(segRect(vec2(0, 0), vec2(90, 100), wall)).toBe(false);
    expect(segRect(vec2(250, 100), vec2(250, 150), wall)).toBe(false);
    expect(segRect(vec2(250, 300), vec2(250, 400), wall)).toBe(false);
    expect(segRect(vec2(500, 0), vec2(500, 500), wall)).toBe(false);
  });

  it('misses when the segment stops just short', () => {
    expect(segRect(vec2(250, 100), vec2(250, 199.9), wall)).toBe(false);
  });

  it('hits when the segment ends exactly on the edge', () => {
    expect(segRect(vec2(250, 100), vec2(250, 200), wall)).toBe(true);
  });

  it('grows the wall by the pad', () => {
    // 5px clear of the wall: a miss bare, a hit once the hit radius is applied.
    expect(segRect(vec2(250, 100), vec2(250, 195), wall)).toBe(false);
    expect(segRect(vec2(250, 100), vec2(250, 195), wall, 5)).toBe(true);
    expect(segRect(vec2(250, 100), vec2(250, 195), wall, 4.9)).toBe(false);
  });

  it('detects a segment collinear with the top edge', () => {
    // Dragging exactly along the flat top of a wall.
    expect(segRect(vec2(0, 200), vec2(500, 200), wall)).toBe(true);
  });

  it('detects a segment that only clips a corner', () => {
    // Passes through the (100,200) corner and nothing else.
    expect(segRect(vec2(50, 250), vec2(150, 150), wall)).toBe(true);
    // Same diagonal shifted clear of the corner.
    expect(segRect(vec2(40, 250), vec2(140, 150), wall)).toBe(false);
  });

  it('handles zero-length segments', () => {
    expect(segRect(vec2(250, 210), vec2(250, 210), wall)).toBe(true);
    expect(segRect(vec2(250, 100), vec2(250, 100), wall)).toBe(false);
    expect(segRect(vec2(250, 195), vec2(250, 195), wall, 10)).toBe(true);
  });

  it('handles a degenerate zero-area rect', () => {
    const dot: Rect = { x: 100, y: 100, w: 0, h: 0 };
    expect(segRect(vec2(0, 100), vec2(200, 100), dot)).toBe(true);
    expect(segRect(vec2(0, 101), vec2(200, 101), dot)).toBe(false);
    expect(segRect(vec2(0, 101), vec2(200, 101), dot, 2)).toBe(true);
  });

  /*
   * LOCKED rule 2. A flick across the screen delivers pointer samples hundreds
   * of pixels apart; a per-point test would report "clear" for every one of
   * them and the stroke would pass straight through the wall.
   */
  describe('no tunnelling', () => {
    const thin: Rect = { x: 0, y: 500, w: 700, h: 8 };

    it('catches a 1000px vertical swipe across an 8px wall', () => {
      expect(segRect(vec2(300, 0), vec2(300, 1000), thin)).toBe(true);
    });

    it('catches a fast diagonal swipe across a thin wall', () => {
      expect(segRect(vec2(20, 20), vec2(680, 980), thin)).toBe(true);
    });

    it('catches a near-horizontal swipe that grazes across the wall', () => {
      expect(segRect(vec2(0, 495), vec2(700, 515), thin)).toBe(true);
    });

    it('catches every crossing of a thin wall at every angle', () => {
      const r = rng(99);
      for (let i = 0; i < 2000; i++) {
        // Both endpoints strictly on opposite sides of the wall's y band, and
        // x kept inside the wall's span, so the crossing is unavoidable.
        const a = vec2(r() * 700, r() * 490);
        const b = vec2(r() * 700, 520 + r() * 480);
        expect(segRect(a, b, thin)).toBe(true);
        expect(segRect(b, a, thin)).toBe(true);
      }
    });
  });
});

describe('segRectEntryT', () => {
  const wall: Rect = { x: 100, y: 200, w: 300, h: 20 };

  it('returns 0 when the segment starts inside', () => {
    expect(segRectEntryT(vec2(250, 210), vec2(1000, 210), wall)).toBe(0);
  });

  it('returns the fraction of the way to first contact', () => {
    // 100 -> 300 in y, wall top at 200, so contact at exactly halfway.
    expect(segRectEntryT(vec2(250, 100), vec2(250, 300), wall)).toBeCloseTo(0.5, 12);
  });

  it('accounts for the pad', () => {
    // Padded top edge sits at y = 180, i.e. 40% of the way from 100 to 300.
    expect(segRectEntryT(vec2(250, 100), vec2(250, 300), wall, 20)).toBeCloseTo(0.4, 12);
  });

  it('returns null when the segment never reaches the wall', () => {
    expect(segRectEntryT(vec2(250, 100), vec2(250, 150), wall)).toBeNull();
    expect(segRectEntryT(vec2(500, 0), vec2(500, 500), wall)).toBeNull();
    expect(segRectEntryT(vec2(250, 300), vec2(250, 400), wall)).toBeNull();
  });

  it('reports contact from the far side too', () => {
    expect(segRectEntryT(vec2(250, 300), vec2(250, 100), wall)).toBeCloseTo(0.4, 12);
  });

  it('handles zero-length segments like segRect does', () => {
    expect(segRectEntryT(vec2(250, 210), vec2(250, 210), wall)).toBe(0);
    expect(segRectEntryT(vec2(250, 100), vec2(250, 100), wall)).toBeNull();
  });

  /*
   * The two functions are independent implementations of the same predicate —
   * orientation tests versus slab clipping. Cross-checking them is the closest
   * thing to a proof this codebase can run, and it is why a bug in either would
   * have to be duplicated in the other to survive.
   */
  it('agrees with segRect over random continuous cases', () => {
    const r = rng(1234);
    for (let i = 0; i < 30000; i++) {
      const a = vec2(r() * 800 - 100, r() * 800 - 100);
      const b = vec2(r() * 800 - 100, r() * 800 - 100);
      const rect: Rect = {
        x: r() * 500,
        y: r() * 500,
        w: r() * 300,
        h: r() * 300,
      };
      const pad = r() * 10;
      expect(segRectEntryT(a, b, rect, pad) !== null).toBe(segRect(a, b, rect, pad));
    }
  });

  /*
   * Integer coordinates make exact grazing — corner clips, collinear edges —
   * common instead of measure-zero, and there the two algorithms can legally
   * disagree by one ULP. Sandwich the comparison with a tiny pad delta so the
   * assertion still bites everywhere except within 1e-6 of a true tangency.
   */
  it('agrees with segRect over an integer grid, up to grazing', () => {
    const r = rng(5678);
    const d = 1e-6;
    for (let i = 0; i < 30000; i++) {
      const a = vec2(Math.floor(r() * 12) * 10, Math.floor(r() * 12) * 10);
      const b = vec2(Math.floor(r() * 12) * 10, Math.floor(r() * 12) * 10);
      const rect: Rect = { x: 30, y: 40, w: 50, h: 20 };
      const pad = Math.floor(r() * 3) * 10;

      if (segRectEntryT(a, b, rect, pad - d) !== null) {
        expect(segRect(a, b, rect, pad)).toBe(true);
      }
      if (segRect(a, b, rect, pad) && segRectEntryT(a, b, rect, pad + d) === null) {
        throw new Error(`segRect hit but entryT missed: ${JSON.stringify({ a, b, pad })}`);
      }
    }
  });
});

describe('segCircleEntryT', () => {
  const c = vec2(100, 100);

  it('returns 0 when the segment starts inside', () => {
    expect(segCircleEntryT(vec2(100, 100), vec2(500, 100), c, 20)).toBe(0);
    expect(segCircleEntryT(vec2(115, 100), vec2(500, 100), c, 20)).toBe(0);
  });

  it('returns the entry fraction', () => {
    // Travelling 0 -> 200 in x at y = 100; circle edge at x = 80.
    expect(segCircleEntryT(vec2(0, 100), vec2(200, 100), c, 20)).toBeCloseTo(0.4, 12);
  });

  it('returns null when the segment misses', () => {
    expect(segCircleEntryT(vec2(0, 0), vec2(200, 0), c, 20)).toBeNull();
  });

  it('returns null when the segment stops short', () => {
    expect(segCircleEntryT(vec2(0, 100), vec2(70, 100), c, 20)).toBeNull();
  });

  it('catches a fast flick that would overshoot the goal', () => {
    // Point sampling would see (0,100) and (900,100), both far outside.
    expect(segCircleEntryT(vec2(0, 100), vec2(900, 100), c, 20)).not.toBeNull();
  });

  it('handles a zero-length segment outside the circle', () => {
    expect(segCircleEntryT(vec2(0, 0), vec2(0, 0), c, 20)).toBeNull();
  });
});

describe('distPointToSeg', () => {
  it('measures perpendicular distance when the foot is on the segment', () => {
    expect(distPointToSeg(vec2(5, 10), vec2(0, 0), vec2(10, 0))).toBeCloseTo(10, 12);
  });

  it('falls back to the nearer endpoint past the ends', () => {
    expect(distPointToSeg(vec2(-5, 0), vec2(0, 0), vec2(10, 0))).toBeCloseTo(5, 12);
    expect(distPointToSeg(vec2(15, 0), vec2(0, 0), vec2(10, 0))).toBeCloseTo(5, 12);
  });

  it('handles a degenerate segment', () => {
    expect(distPointToSeg(vec2(3, 4), vec2(0, 0), vec2(0, 0))).toBeCloseTo(5, 12);
  });
});

describe('boundsOf', () => {
  it('returns null for an empty set', () => {
    expect(boundsOf([])).toBeNull();
  });

  it('wraps every point', () => {
    const pts: Vec2[] = [vec2(10, 5), vec2(-4, 30), vec2(22, 12)];
    expect(boundsOf(pts)).toEqual({ x: -4, y: 5, w: 26, h: 25 });
  });

  it('handles a single point', () => {
    expect(boundsOf([vec2(3, 7)])).toEqual({ x: 3, y: 7, w: 0, h: 0 });
  });
});
