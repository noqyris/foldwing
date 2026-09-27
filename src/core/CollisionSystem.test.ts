import { describe, expect, it } from 'vitest';
import { CollisionSystem } from './CollisionSystem';
import { lerpPoint, mirrorPoint, segRectEntryT, vec2, type Rect, type Vec2 } from './Geometry';
import { Playfield } from './Playfield';
import { LEVELS } from '../data/levels';
import { BASE_HEIGHT, BASE_WIDTH, METRICS } from '../render/Theme';

const pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset);

const AXIS = 500;

/*
 * A fixture shaped like a real level: the two halves disagree.
 *
 *   LEFT_WALL  occupies x ∈ [0,450] at y ∈ [300,320].
 *   RIGHT_WALL occupies x ∈ [520,700] at y ∈ [700,720], which projects through
 *              the mirror onto x ∈ [300,480] on the LEFT at the same y.
 *
 * The two forbidden regions sit at different heights and different x spans, so
 * every assertion below can isolate one side from the other.
 */
const LEFT_WALL: Rect = { x: 0, y: 300, w: 450, h: 20 };
const RIGHT_WALL: Rect = { x: 520, y: 700, w: 180, h: 20 };

function system(hitRadius = 0): CollisionSystem {
  return new CollisionSystem([LEFT_WALL, RIGHT_WALL], hitRadius, AXIS);
}

describe('CollisionSystem', () => {
  it('blocks a segment that hits a wall on the drawn side', () => {
    expect(system().blocks(vec2(100, 200), vec2(100, 400))).toBe(true);
  });

  it('lets a clear segment through', () => {
    expect(system().blocks(vec2(250, 150), vec2(250, 260))).toBe(false);
  });

  /*
   * The entire game, in one assertion. At x = 400, y 600→800 there is no left
   * wall anywhere near the stroke — but its reflection at x = 600 walks
   * straight into the right wall, so the gesture is dead.
   */
  it('blocks a segment whose MIRROR hits a wall', () => {
    expect(system().blocks(vec2(400, 600), vec2(400, 800))).toBe(true);
  });

  it('is symmetric in argument order', () => {
    const c = system();
    expect(c.blocks(vec2(400, 800), vec2(400, 600))).toBe(true);
    expect(c.blocks(vec2(100, 400), vec2(100, 200))).toBe(true);
  });

  it('applies the hit radius as forgiveness on the drawn side', () => {
    // Stops 5px above the left wall's top edge.
    expect(system(0).blocks(vec2(100, 200), vec2(100, 295))).toBe(false);
    expect(system(6).blocks(vec2(100, 200), vec2(100, 295))).toBe(true);
  });

  it('applies the hit radius on the mirrored side too', () => {
    // Mirror of x=400 is x=600, inside the right wall's span; stops 5px short.
    expect(system(0).blocks(vec2(400, 600), vec2(400, 695))).toBe(false);
    expect(system(6).blocks(vec2(400, 600), vec2(400, 695))).toBe(true);
  });

  it('handles a stroke riding exactly along the mirror axis', () => {
    // On the axis a point is its own reflection, so the two checks coincide —
    // and this particular column is clear on both sides.
    expect(system().blocks(vec2(AXIS, 0), vec2(AXIS, 1000))).toBe(false);
  });

  describe('no tunnelling', () => {
    it('catches a full-height flick across a wall on the drawn side', () => {
      expect(system().blocks(vec2(100, 0), vec2(100, 1200))).toBe(true);
    });

    it('catches a full-height flick that only the MIRROR intersects', () => {
      // x=470 clears the left wall; its reflection at 530 does not clear the right.
      expect(system().blocks(vec2(470, 0), vec2(470, 1200))).toBe(true);
    });

    it('catches a fast diagonal that only the mirror intersects', () => {
      expect(system().blocks(vec2(460, 100), vec2(480, 1100))).toBe(true);
    });
  });

  describe('firstHitT', () => {
    it('returns null for a clear segment', () => {
      expect(system().firstHitT(vec2(250, 150), vec2(250, 260))).toBeNull();
    });

    it('locates contact on the drawn side', () => {
      // y 200 -> 400, wall top at 300: halfway.
      expect(system().firstHitT(vec2(100, 200), vec2(100, 400))).toBeCloseTo(0.5, 12);
    });

    it('locates mirrored contact in the ORIGINAL parameterisation', () => {
      // Mirror runs x 600 -> 600, y 600 -> 800; right wall top at 700.
      expect(system().firstHitT(vec2(400, 600), vec2(400, 800))).toBeCloseTo(0.5, 12);
    });

    it('returns the EARLIER of the two sides', () => {
      // Own side is struck at y=300 (t=0.25); the mirror not until y=700 (t≈0.583).
      const t = system().firstHitT(vec2(400, 0), vec2(400, 1200));
      expect(t).toBeCloseTo(300 / 1200, 12);
    });

    it('returns 0 when the segment starts already touching', () => {
      expect(system().firstHitT(vec2(100, 310), vec2(100, 400))).toBe(0);
    });

    it('reports a t that actually lands on the wall', () => {
      const c = system(0);
      const a = vec2(100, 0);
      const b = vec2(100, 1200);
      const t = c.firstHitT(a, b);
      expect(t).not.toBeNull();

      const contact = lerpPoint(a, b, t as number);
      expect(contact.y).toBeCloseTo(300, 9);
      // A hair before contact the stroke is still alive.
      expect(c.blocks(a, lerpPoint(a, b, (t as number) - 1e-4))).toBe(false);
    });

    it('agrees with blocks() on every segment', () => {
      let s = 12345 >>> 0;
      const rand = (): number => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
      };

      const c = system(5.2);
      for (let i = 0; i < 20000; i++) {
        const a = vec2(rand() * 1000, rand() * 1200);
        const b = vec2(rand() * 1000, rand() * 1200);
        expect(c.firstHitT(a, b) !== null).toBe(c.blocks(a, b));
      }
    });
  });
});

/*
 * The wall index is reported for the fail feedback — the struck wall flashes —
 * and must not change a single death. Same fixture: index 0 is LEFT_WALL,
 * index 1 is RIGHT_WALL.
 */
describe('firstHit wall index', () => {
  it('names the wall the drawn stroke struck', () => {
    const hit = system().firstHit(vec2(100, 200), vec2(100, 400));
    expect(hit).toEqual({ t: expect.closeTo(0.5, 12), mirror: false, wall: 0 });
  });

  it('names the REAL wall a mirror death ran into, on the far half', () => {
    const hit = system().firstHit(vec2(400, 600), vec2(400, 800));
    expect(hit).toEqual({ t: expect.closeTo(0.5, 12), mirror: true, wall: 1 });
  });

  it('names the earlier wall when one segment reaches both', () => {
    // Own side struck at y=300 (wall 0) before the mirror reaches wall 1.
    expect(system().firstHit(vec2(400, 0), vec2(400, 1200))?.wall).toBe(0);
    // Upward, the mirror meets wall 1 first.
    const up = system().firstHit(vec2(400, 1200), vec2(400, 0));
    expect(up).toMatchObject({ mirror: true, wall: 1 });
  });

  it('keeps the first-listed wall on a tie', () => {
    const twin: Rect = { ...LEFT_WALL };
    const c = new CollisionSystem([LEFT_WALL, twin], 0, AXIS);
    expect(c.firstHit(vec2(100, 200), vec2(100, 400))?.wall).toBe(0);
    const swapped = new CollisionSystem([RIGHT_WALL, LEFT_WALL], 0, AXIS);
    expect(swapped.firstHit(vec2(100, 200), vec2(100, 400))?.wall).toBe(1);
  });

  /*
   * Checked against the loop as it stood before the index was added, copied
   * here verbatim — not against firstHitT, which is firstHit under another
   * name and would agree with any change. On real mazes, whose wall rects
   * overlap at every joint, so a segment entering at a joint, or starting
   * inside one, strikes two rects at the same t: the tie-break is exercised,
   * not assumed.
   */
  it('changes nothing about which segments die, or where, on real mazes', () => {
    const before = (
      walls: readonly Rect[],
      r: number,
      a: Vec2,
      b: Vec2
    ): { t: number; mirror: boolean } | null => {
      const ma = mirrorPoint(a, pf.axisX);
      const mb = mirrorPoint(b, pf.axisX);
      let earliest: { t: number; mirror: boolean } | null = null;
      for (const wall of walls) {
        const own = segRectEntryT(a, b, wall, r);
        if (own !== null && (earliest === null || own < earliest.t)) {
          earliest = { t: own, mirror: false };
        }
        const reflected = segRectEntryT(ma, mb, wall, r);
        if (reflected !== null && (earliest === null || reflected < earliest.t)) {
          earliest = { t: reflected, mirror: true };
        }
      }
      return earliest;
    };

    let s = 777 >>> 0;
    const rand = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const r = METRICS.hitRadius;
    let hits = 0;
    let ties = 0;
    for (const level of [LEVELS[0], LEVELS[4], LEVELS[37], LEVELS[150], LEVELS[299]]) {
      const walls = level.walls.map((w) => pf.toScreenRect(w));
      const c = new CollisionSystem(walls, r, pf.axisX);
      for (let i = 0; i < 1500; i++) {
        // Short strokes, the length of a few frames of a fast flick: most
        // start clear and end in, or across, a joint.
        const a = vec2(pf.x + rand() * pf.w, pf.y + rand() * pf.h);
        const b = vec2(a.x + (rand() - 0.5) * 160, a.y + (rand() - 0.5) * 160);
        const hit = c.firstHit(a, b);
        const ref = before(walls, r, a, b);
        expect(hit && { t: hit.t, mirror: hit.mirror }).toEqual(ref);
        if (!hit) continue;
        hits++;
        // The wall named is the first, in list order and own side before
        // mirror, that is struck at exactly that t — the rule the old loop
        // applied without saying which wall it was.
        const struck: number[] = [];
        walls.forEach((w, j) => {
          const one = before([w], r, a, b);
          if (one?.t === hit.t && one.mirror === hit.mirror) struck.push(j);
        });
        expect(struck[0]).toBe(hit.wall);
        if (struck.length > 1) ties++;
      }
    }
    expect(hits).toBeGreaterThan(1000);
    expect(ties).toBeGreaterThan(50);
  });
});
