import { describe, expect, it } from 'vitest';
import { Playfield } from './Playfield';
import { mirrorPoint, vec2, type Vec2 } from './Geometry';

/* Deliberately asymmetric insets, so any axis or origin mistake shows up as a
 * wrong number rather than cancelling itself out. */
const INSET = { top: 80, right: 20, bottom: 40, left: 10 };
const CANVAS_W = 750;
const CANVAS_H = 1334;

function field(): Playfield {
  return new Playfield(CANVAS_W, CANVAS_H, INSET);
}

describe('Playfield geometry', () => {
  it('insets the canvas on every side', () => {
    const pf = field();
    expect(pf.x).toBe(10);
    expect(pf.y).toBe(80);
    expect(pf.w).toBe(720);
    expect(pf.h).toBe(1214);
    expect(pf.right).toBe(730);
    expect(pf.bottom).toBe(1294);
  });

  it('puts the mirror axis at normalized x = 0.5', () => {
    const pf = field();
    expect(pf.axisX).toBe(370);
    expect(pf.toScreen(vec2(0.5, 0.37)).x).toBe(pf.axisX);
  });

  it('maps the normalized unit square onto the playfield corners', () => {
    const pf = field();
    expect(pf.toScreen(vec2(0, 0))).toEqual({ x: 10, y: 80 });
    expect(pf.toScreen(vec2(1, 1))).toEqual({ x: 730, y: 1294 });
    expect(pf.toScreen(vec2(0.5, 0.5))).toEqual({ x: 370, y: 687 });
  });

  it('scales rect width by the playfield width and height by its height', () => {
    const pf = field();
    // Guards the copy-paste that scales h by this.w — a wall would silently
    // change thickness and every level would retune itself.
    expect(pf.toScreenRect({ x: 0, y: 0.5, w: 0.5, h: 0.5 })).toEqual({
      x: 10,
      y: 687,
      w: 360,
      h: 607,
    });
  });
});

describe('Playfield mirror', () => {
  it('agrees with the LOCKED normalized definition mirror(p) = {1-x, y}', () => {
    const pf = field();
    for (const [nx, ny] of [
      [0, 0],
      [0.14, 0.88],
      [0.3, 0.5],
      [0.5, 0.25],
    ] as const) {
      const reflected = pf.mirror(pf.toScreen(vec2(nx, ny)));
      const authored = pf.toScreen(vec2(1 - nx, ny));
      expect(reflected.x).toBeCloseTo(authored.x, 9);
      expect(reflected.y).toBeCloseTo(authored.y, 9);
    }
  });

  it('is an involution and fixes the axis', () => {
    const pf = field();
    const p = vec2(123, 456);
    const back = pf.mirror(pf.mirror(p));
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBe(p.y);
    expect(pf.mirror(vec2(pf.axisX, 99))).toEqual({ x: pf.axisX, y: 99 });
  });

  it('matches the free mirrorPoint helper', () => {
    const pf = field();
    expect(pf.mirror(vec2(40, 7))).toEqual(mirrorPoint(vec2(40, 7), pf.axisX));
  });
});

/*
 * LOCKED: the player may only draw where x < 0.5. The axis is a SOFT wall — the
 * stroke is clamped to it and may slide along it, but must never cross. If this
 * clamp is wrong the reflection folds back into the left half and the mirror
 * stops constraining anything, which is the whole premise of the game.
 */
describe('Playfield.clampToDrawable — the soft wall at the axis', () => {
  const pf = field();

  it('never lets a point cross the axis', () => {
    expect(pf.clampToDrawable(vec2(700, 500)).x).toBe(pf.axisX);
    expect(pf.clampToDrawable(vec2(pf.axisX + 0.001, 500)).x).toBe(pf.axisX);
    expect(pf.clampToDrawable(vec2(1e9, 500)).x).toBe(pf.axisX);
  });

  it('lets a point rest exactly ON the axis', () => {
    expect(pf.clampToDrawable(vec2(pf.axisX, 500)).x).toBe(pf.axisX);
  });

  it('leaves points in the left half untouched', () => {
    expect(pf.clampToDrawable(vec2(200, 500))).toEqual({ x: 200, y: 500 });
  });

  it('holds the point inside the playfield vertically and on the left', () => {
    expect(pf.clampToDrawable(vec2(-50, -50))).toEqual({ x: pf.x, y: pf.y });
    expect(pf.clampToDrawable(vec2(-50, 99999))).toEqual({ x: pf.x, y: pf.bottom });
  });

  it('keeps every clamped point at or left of its own reflection', () => {
    // The invariant that makes the mirror meaningful: reflect a drawable point
    // and it must land in the RIGHT half, never back on top of the stroke.
    let s = 20260725 >>> 0;
    const rand = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < 5000; i++) {
      const p: Vec2 = vec2(rand() * 1600 - 400, rand() * 1800 - 200);
      const c = pf.clampToDrawable(p);
      expect(c.x).toBeLessThanOrEqual(pf.axisX);
      expect(pf.mirror(c).x).toBeGreaterThanOrEqual(pf.axisX);
      expect(c.y).toBeGreaterThanOrEqual(pf.y);
      expect(c.y).toBeLessThanOrEqual(pf.bottom);
    }
  });

  it('does not mutate its argument', () => {
    const p = vec2(9999, 9999);
    pf.clampToDrawable(p);
    expect(p).toEqual({ x: 9999, y: 9999 });
  });
});
