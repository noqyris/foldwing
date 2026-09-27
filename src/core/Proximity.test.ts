import { describe, expect, it } from 'vitest';
import { LEVELS } from '../data/levels';
import { BASE_HEIGHT, BASE_WIDTH, boardInset, METRICS } from '../render/Theme';
import { CollisionSystem } from './CollisionSystem';
import { inflate, mirrorPoint, type Rect, type Vec2 } from './Geometry';
import { Playfield } from './Playfield';
import {
  CLOSE_GAP_MS,
  CLOSE_PER_STROKE,
  CLOSE_TRAVEL,
  DangerTracker,
  HEAT_ALPHA,
  HEAT_SLACK,
  heatOf,
  Proximity,
  RUMBLE_GAP_MS,
  RUMBLE_SLACK,
  slack,
  TIGHT_SLACK,
  type Slack,
} from './Proximity';

const R = METRICS.hitRadius;

/** A small deterministic generator, so a failing probe can be replayed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32);
}

/**
 * Probes for one level: random points over the whole playfield (both halves,
 * and a margin past its edge), plus the grown edges and corners of a few of
 * its walls and their mirror images — exactly where a `<` and a `<=` part
 * company. A few walls a level, over 300 levels, is every kind of edge many
 * times over, at a cost the fast suite can carry.
 */
function probes(walls: readonly Rect[], pf: Playfield, next: () => number, n: number, edgeWalls: number): Vec2[] {
  const out: Vec2[] = [];
  for (let k = 0; k < n; k++) {
    out.push({ x: pf.x - 20 + next() * (pf.w + 40), y: pf.y - 20 + next() * (pf.h + 40) });
  }
  for (let k = 0; k < Math.min(edgeWalls, walls.length); k++) {
    const e = inflate(walls[Math.floor(next() * walls.length)], R);
    const xs = [e.x, e.x + e.w, e.x + e.w / 2];
    const ys = [e.y, e.y + e.h, e.y + e.h / 2];
    for (const x of xs) {
      for (const y of ys) {
        for (const d of [-1e-9, 0, 1e-9]) {
          const q = { x: x + d, y: y - d };
          out.push(q, mirrorPoint(q, pf.axisX));
        }
      }
    }
  }
  return out;
}

const PLAYFIELDS: readonly [string, Playfield][] = [
  ['the proved playfield', new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset)],
  // The 18 Pro's tall canvas: the same 702×1102 board, moved down.
  ['the board moved on a tall canvas', new Playfield(BASE_WIDTH, 1631, boardInset(1631))],
];

/*
 * THE contract. The heat, the rumble and "close" all read slack, and a death
 * is decided by CollisionSystem. If the two ever disagreed the heat would
 * glow where nothing can hit, or stay dark one pixel before a death — and it
 * would teach the wrong wall. So: slack ≤ 0 exactly when a stroke may not sit
 * at p, to the last bit, on every level, on both halves.
 */
describe('slack agrees with CollisionSystem', () => {
  for (const [name, pf] of PLAYFIELDS) {
    it(`on every level, on ${name}`, () => {
      const next = rng(1234);
      let hits = 0;
      let checked = 0;
      for (const level of LEVELS) {
        const walls = level.walls.map((w) => pf.toScreenRect(w));
        const collision = new CollisionSystem(walls, R, pf.axisX);
        const prox = new Proximity(walls, R, pf.axisX);
        for (const p of probes(walls, pf, next, 160, 6)) {
          const s = prox.slack(p);
          const blocked = collision.blocks(p, p);
          checked++;
          if (blocked) hits++;
          if (blocked !== s.slack <= 0) {
            expect.fail(`${level.id} at (${p.x}, ${p.y}): slack ${s.slack}, collision says ${blocked}`);
          }
          if (blocked) {
            // The side that hits, and a wall that really holds it there.
            const own = new CollisionSystem([walls[s.wall]], R, pf.axisX);
            expect(own.blocks(s.point, s.point), level.id).toBe(true);
            expect(s.point).toEqual(s.mirror ? mirrorPoint(p, pf.axisX) : p);
          }
        }
      }
      // Guards the guard: the probes must actually land inside walls too.
      expect(hits).toBeGreaterThan(checked / 20);
      expect(checked).toBeGreaterThan(80_000);
    });
  }

  /*
   * Slack is room, measured the way collision kills: the grown rects have
   * square corners, so it is the L∞ distance. Any move shorter than the slack,
   * in any direction, is still alive.
   */
  it('is room: a move shorter than it never hits', () => {
    const pf = PLAYFIELDS[0][1];
    const next = rng(99);
    for (const level of LEVELS.slice(0, 300).filter((_, i) => i % 5 === 0)) {
      const walls = level.walls.map((w) => pf.toScreenRect(w));
      const collision = new CollisionSystem(walls, R, pf.axisX);
      for (let k = 0; k < 200; k++) {
        const p = { x: pf.x + next() * (pf.axisX - pf.x), y: pf.y + next() * pf.h };
        const s = slack(p, walls, R, pf.axisX).slack;
        if (!(s > 0) || s > 40) continue;
        for (let j = 0; j < 8; j++) {
          const q = { x: p.x + (next() * 2 - 1) * s * 0.999, y: p.y + (next() * 2 - 1) * s * 0.999 };
          expect(collision.blocks(q, q), `${level.id} ${JSON.stringify(p)} → ${JSON.stringify(q)}`).toBe(false);
        }
        // …and one exactly `slack` away, straight at the wall, touches it.
        // (Each axis moves at most to the wall's own edge, so a thin wall is
        // not overshot on the axis that already had no room to give.)
        const tight = slack(p, walls, R, pf.axisX);
        const step = (from: number, to: number): number =>
          from + Math.sign(to - from) * Math.min(s * 1.001, Math.abs(to - from));
        const q = { x: step(tight.point.x, tight.at.x), y: step(tight.point.y, tight.at.y) };
        const own = new CollisionSystem([walls[tight.wall]], R, pf.axisX);
        expect(own.blocks(q, q) || own.blocks(mirrorPoint(q, pf.axisX), mirrorPoint(q, pf.axisX)), level.id).toBe(true);
      }
    }
  });
});

describe('which wall', () => {
  const pf = PLAYFIELDS[0][1];
  const axis = pf.axisX;

  it('names the real wall on the far half for a tight reflection, never a projection of it', () => {
    // A wall on the right only. The pen on the left is clear of everything
    // on its own side; its reflection is 4 px from the wall.
    const wall: Rect = { x: axis + 100, y: 500, w: 40, h: 40 };
    const p = mirrorPoint({ x: axis + 100 - R - 4, y: 520 }, axis);
    const s = slack(p, [wall], R, axis);
    expect(s).toMatchObject({ wall: 0, mirror: true });
    expect(s.slack).toBeCloseTo(4, 9);
    // The spark goes on the wall itself, over on the far half.
    expect(s.at).toEqual({ x: axis + 100, y: 520 });
    expect(s.at.x).toBeGreaterThan(axis);
  });

  it('breaks a tie as CollisionSystem.firstHit does: the wall listed first, then the pen’s own side', () => {
    // Whole numbers, so both sides measure an exact 6 and the tie is real.
    const hr = 4;
    const own: Rect = { x: axis - 140, y: 500, w: 40, h: 40 };
    const far: Rect = { x: axis + 100, y: 500, w: 40, h: 40 }; // own's mirror image
    const p = { x: axis - 100 + hr + 6, y: 520 };
    expect(slack(p, [far, own], hr, axis)).toMatchObject({ slack: 6, mirror: true, wall: 0 });
    expect(slack(p, [own, far], hr, axis)).toMatchObject({ slack: 6, mirror: false, wall: 0 });
    // One wall across the fold, symmetric about it: both sides tie on it.
    const span: Rect = { x: axis - 50, y: 500, w: 100, h: 40 };
    expect(slack({ x: axis - 20, y: 500 - hr - 6 }, [span], hr, axis)).toMatchObject({ slack: 6, mirror: false, wall: 0 });
    // At contact, the reading names the wall a death there would.
    const hit = new CollisionSystem([far, own], hr, axis).firstHit(p, { x: p.x - 7, y: 520 })!;
    const at = slack({ x: p.x - 6, y: 520 }, [far, own], hr, axis);
    expect(at).toMatchObject({ slack: 0, wall: hit.wall, mirror: hit.mirror });
  });

  it('reads Infinity with no walls, and says so without a wall index', () => {
    const s = slack({ x: 10, y: 10 }, [], R, axis);
    expect(s).toMatchObject({ slack: Infinity, wall: -1, mirror: false });
    expect(heatOf(s)).toBeNull();
  });
});

describe('the heat', () => {
  const reading = (value: number, wall = 3, mirror = false): Slack => ({
    slack: value,
    wall,
    mirror,
    point: { x: 0, y: 0 },
    at: { x: 0, y: 0 },
  });

  it('starts under 6 pt of room and grows to its full alpha at contact', () => {
    expect(heatOf(reading(HEAT_SLACK))).toBeNull();
    expect(heatOf(reading(40))).toBeNull();
    expect(heatOf(reading(HEAT_SLACK - 0.01))!.amount).toBeCloseTo(0, 2);
    expect(heatOf(reading(HEAT_SLACK / 2))!.amount).toBeCloseTo(HEAT_ALPHA / 2, 9);
    expect(heatOf(reading(0))!.amount).toBe(HEAT_ALPHA);
    expect(heatOf(reading(-3))!.amount).toBe(HEAT_ALPHA);
    expect(HEAT_ALPHA).toBe(0.45);
    expect(HEAT_SLACK).toBe(11);
  });

  it('turns fail-red only under 1.5 pt, and keeps the side it was found on', () => {
    expect(heatOf(reading(TIGHT_SLACK))!.tight).toBe(false);
    expect(heatOf(reading(TIGHT_SLACK - 0.01))!.tight).toBe(true);
    expect(heatOf(reading(5, 7, true))).toMatchObject({ wall: 7, mirror: true });
  });
});

describe('the rumble and "close"', () => {
  const at = (value: number, wall = 0): Slack => ({
    slack: value,
    wall,
    mirror: false,
    point: { x: 1, y: 2 },
    at: { x: 1, y: 7 },
  });

  it('rumbles on entering 3 pt of room, not while staying in it, at most every 180 ms', () => {
    const d = new DangerTracker();
    expect(d.step(at(8), 0, 0).rumble).toBe(false);
    expect(d.step(at(RUMBLE_SLACK - 0.1), 5, 16).rumble).toBe(true);
    expect(d.step(at(2), 10, 32).rumble).toBe(false); // still inside
    expect(d.step(at(8), 15, 48).rumble).toBe(false);
    expect(d.step(at(4), 20, 64).rumble).toBe(false); // re-entered too soon
    expect(d.step(at(8), 25, 80).rumble).toBe(false);
    expect(d.step(at(4), 30, 16 + RUMBLE_GAP_MS).rumble).toBe(true);
  });

  it('pays "close" once the stroke has left the tight spot 24 pt behind, alive', () => {
    const d = new DangerTracker();
    d.step(at(8), 0, 0);
    d.step(at(2.5), 10, 16);
    d.step(at(1.2, 4), 14, 32); // the tightest moment
    d.step(at(2.9), 20, 48); // still tight: the travel counts from here
    expect(d.step(at(6), 20 + CLOSE_TRAVEL - 1, 64).close).toBeNull();
    const paid = d.step(at(9), 20 + CLOSE_TRAVEL, 80).close;
    expect(paid).toMatchObject({ wall: 4, slack: 1.2, at: { x: 1, y: 7 } });
    expect(d.count).toBe(1);
    // Paid once for that scrape.
    expect(d.step(at(9), 200, 96).close).toBeNull();
  });

  it('never pays while the pen is still squeezing, however long the corridor', () => {
    const d = new DangerTracker();
    for (let len = 0; len < 400; len += 10) expect(d.step(at(2), len, len).close).toBeNull();
  });

  it('pays at most one per 400 ms and three per stroke, and starts over with each stroke', () => {
    const d = new DangerTracker();
    let t = 0;
    let len = 0;
    const scrape = (): boolean => {
      d.step(at(1), (len += 5), (t += 16));
      return d.step(at(9), (len += CLOSE_TRAVEL), (t += 16)).close !== null;
    };
    expect(scrape()).toBe(true);
    expect(scrape()).toBe(false); // 32 ms after the last one
    t += CLOSE_GAP_MS;
    expect(scrape()).toBe(true);
    t += CLOSE_GAP_MS;
    expect(scrape()).toBe(true);
    t += CLOSE_GAP_MS;
    expect(scrape()).toBe(false); // the stroke's three are spent
    expect(d.count).toBe(CLOSE_PER_STROKE);
    d.reset();
    expect(d.count).toBe(0);
    t += CLOSE_GAP_MS;
    len = 0;
    expect(scrape()).toBe(true);
  });

  it('never pays a scrape the stroke died in: a death simply stops the feed', () => {
    const d = new DangerTracker();
    d.step(at(1), 10, 16);
    d.reset(); // the next stroke
    expect(d.step(at(9), 10 + CLOSE_TRAVEL * 3, 500).close).toBeNull();
  });

  it('hands the heat along with every step', () => {
    const d = new DangerTracker();
    expect(d.step(at(20), 0, 0).heat).toBeNull();
    expect(d.step(at(1), 1, 16).heat).toMatchObject({ wall: 0, tight: true });
  });
});
