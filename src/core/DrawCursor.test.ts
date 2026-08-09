import { describe, expect, it } from 'vitest';
import { drawCursor } from './DrawCursor';
import { vec2 } from './Geometry';
import { METRICS, pt } from '../render/Theme';

// The shipped geometry: 84px of lift gained across 120px of finger travel.
// The ratio matters — tests below assert the launch is gentler than the
// finger, which only holds while offsetY stays below ~1.9 × rampPx.
const OPTS = {
  touch: true,
  travelPx: 1000,
  offsetY: 84,
  rampPx: 120,
};

describe('drawCursor', () => {
  it('leaves a mouse pointer exactly where it is', () => {
    expect(drawCursor(vec2(100, 500), { ...OPTS, touch: false })).toEqual({
      x: 100,
      y: 500,
    });
  });

  it('applies no offset on mouse however far it travels', () => {
    expect(
      drawCursor(vec2(100, 500), { ...OPTS, touch: false, travelPx: 99999 }).y
    ).toBe(500);
  });

  /*
   * The acceptance criterion: on a 375pt-wide screen the thumb must never cover
   * the active cursor. The cursor is therefore lifted ABOVE the finger — a
   * smaller y in screen space. If this sign ever flips, the live end of the
   * stroke sits under the pad of the thumb on every touch device.
   */
  it('lifts the cursor ABOVE the finger on touch', () => {
    const finger = vec2(100, 500);
    const cursor = drawCursor(finger, OPTS);
    expect(cursor.y).toBeLessThan(finger.y);
    expect(finger.y - cursor.y).toBeCloseTo(84, 9);
  });

  it('never shifts the cursor sideways', () => {
    expect(drawCursor(vec2(137, 500), OPTS).x).toBe(137);
  });

  it('starts at zero offset so the stroke does not teleport on touchdown', () => {
    expect(drawCursor(vec2(100, 500), { ...OPTS, travelPx: 0 }).y).toBe(500);
  });

  /*
   * THE property this file exists for. A finger that has not moved must not
   * move the cursor. A time-based ramp fails this: it slides the cursor — and
   * with it the collision-tested stroke — across the page while the player
   * holds perfectly still, drawing ink they never asked for and can be killed
   * by. Gate the ease on travel and the failure mode cannot exist.
   */
  it('does not move the cursor while the finger is still', () => {
    const still = vec2(100, 500);
    for (const travelPx of [0, 0, 0]) {
      expect(drawCursor(still, { ...OPTS, travelPx }).y).toBe(500);
    }
    // Jitter in place stays effectively pinned, too — smoothstep's zero slope
    // at the origin means sub-pixel travel produces sub-hundredth-pixel lift.
    expect(drawCursor(still, { ...OPTS, travelPx: 0.4 }).y).toBeCloseTo(500, 2);
  });

  /*
   * Smoothstep, not a line. A linear ramp moves the ink at double finger
   * speed from the very first millimetre of a stroke, which is how "I died on
   * the first wall while I was still starting" shipped. Zero slope at the
   * origin means the stroke initially tracks the finger 1:1.
   */
  it('eases the offset along a smoothstep across the travel ramp', () => {
    const lift = (travelPx: number) => 500 - drawCursor(vec2(100, 500), { ...OPTS, travelPx }).y;
    // t = 0.25 -> 3t^2 - 2t^3 = 0.15625
    expect(lift(30)).toBeCloseTo(84 * 0.15625, 9);
    // Halfway through the ramp the lift is exactly half the offset...
    expect(lift(60)).toBeCloseTo(42, 9);
    // ...and the ramp completes at rampPx.
    expect(lift(120)).toBeCloseTo(84, 9);
  });

  it('starts gentler than the finger itself — no double-speed launch', () => {
    // Early in the ramp the manufactured lift stays well under the distance
    // the finger has actually moved; the old linear ramp broke this.
    for (const travelPx of [1, 3, 6, 10]) {
      const lift = 500 - drawCursor(vec2(100, 500), { ...OPTS, travelPx }).y;
      expect(lift).toBeLessThan(travelPx);
    }
  });

  it('holds the offset steady once the ramp completes', () => {
    expect(drawCursor(vec2(100, 500), { ...OPTS, travelPx: 121 }).y).toBeCloseTo(416, 9);
    expect(drawCursor(vec2(100, 500), { ...OPTS, travelPx: 50000 }).y).toBeCloseTo(416, 9);
  });

  it('is monotonic — the cursor only ever rises away from the finger', () => {
    let previous = Infinity;
    for (let travelPx = 0; travelPx <= 120; travelPx += 3) {
      const y = drawCursor(vec2(100, 500), { ...OPTS, travelPx }).y;
      expect(y).toBeLessThanOrEqual(previous);
      previous = y;
    }
  });

  it('cannot be pushed below the finger by a nonsense travel value', () => {
    expect(drawCursor(vec2(100, 500), { ...OPTS, travelPx: -50 }).y).toBe(500);
  });

  it('applies the offset whole when there is no ramp', () => {
    expect(
      drawCursor(vec2(100, 500), { ...OPTS, travelPx: 0, rampPx: 0 }).y
    ).toBeCloseTo(416, 9);
  });

  it('does not mutate its argument', () => {
    const p = vec2(100, 500);
    drawCursor(p, OPTS);
    expect(p).toEqual({ x: 100, y: 500 });
  });

  it('lifts by the shipped 42pt once settled', () => {
    const settled = drawCursor(vec2(100, 500), {
      touch: true,
      travelPx: METRICS.touchOffsetRampPx,
      offsetY: METRICS.touchOffsetY,
      rampPx: METRICS.touchOffsetRampPx,
    });
    expect(500 - settled.y).toBe(pt(42));
  });

  it('never lifts the cursor further than the finger has travelled, plus the offset', () => {
    // Bounds the manufactured motion: during the ramp the cursor moves at most
    // twice finger speed, and never more than offsetY beyond the finger.
    for (let travelPx = 0; travelPx <= 200; travelPx += 1) {
      const lift = 500 - drawCursor(vec2(100, 500), { ...OPTS, travelPx }).y;
      expect(lift).toBeLessThanOrEqual(Math.min(travelPx * 2, OPTS.offsetY) + 1e-9);
    }
  });
});
