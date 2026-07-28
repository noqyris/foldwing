import { describe, expect, it } from 'vitest';
import { centredHitArea, liveBox, paintedBox } from './HitArea';

/**
 * The contract these tests defend: what you can tap is what you can see.
 *
 * The failure they exist to catch is not hypothetical — the shipped build used
 * `Rectangle(-w/2, -h/2, w, h)`, which reads correctly and is wrong, and the
 * result was buttons that responded on roughly a fifth of their face.
 */
describe('centredHitArea — the live area must equal the painted area', () => {
  const CASES = [
    { name: 'menu primary', cx: 375, cy: 776, w: 638, h: 132 },
    { name: 'menu secondary', cx: 375, cy: 918, w: 638, h: 108 },
    { name: 'reveal pill', cx: 604, cy: 52, w: 148, h: 68 },
    { name: 'back chevron', cx: 80, cy: 104, w: 104, h: 88 },
  ];

  for (const c of CASES) {
    it(`${c.name} responds over its whole face`, () => {
      const live = liveBox(centredHitArea(c.w, c.h), c.cx, c.cy, c.w, c.h);
      expect(live).toEqual(paintedBox(c.cx, c.cy, c.w, c.h));
    });
  }

  it('covers every point of the face, corners included', () => {
    const { cx, cy, w, h } = CASES[1];
    const live = liveBox(centredHitArea(w, h), cx, cy, w, h);
    for (let i = 0; i <= 20; i++) {
      for (let j = 0; j <= 20; j++) {
        // Just inside the painted edge, so the half-open interval is honest.
        const px = cx - w / 2 + (w * i) / 20 + (i === 20 ? -0.5 : 0.5);
        const py = cy - h / 2 + (h * j) / 20 + (j === 20 ? -0.5 : 0.5);
        expect(px >= live.left && px < live.right).toBe(true);
        expect(py >= live.top && py < live.bottom).toBe(true);
      }
    }
  });
});

describe('the rectangle that shipped', () => {
  /** What `setInteractive(new Rectangle(-w/2, -h/2, w, h))` actually produced. */
  const shipped = (w: number, h: number) => ({ x: -w / 2, y: -h / 2, width: w, height: h });

  it('responded only over the top-left quarter', () => {
    const cx = 375, cy = 918, w = 638, h = 108;
    const live = liveBox(shipped(w, h), cx, cy, w, h);
    const painted = paintedBox(cx, cy, w, h);

    // Shifted a half-extent up and left of the art.
    expect(live.right).toBe(cx);
    expect(live.bottom).toBe(cy);
    expect(live.left).toBe(painted.left - w / 2);

    const overlapW = Math.min(live.right, painted.right) - Math.max(live.left, painted.left);
    const overlapH = Math.min(live.bottom, painted.bottom) - Math.max(live.top, painted.top);
    expect((overlapW * overlapH) / (w * h)).toBeCloseTo(0.25, 6);
  });

  it('overhung its neighbour, stealing taps meant for the button above', () => {
    // Menu stack: Levels centred at 918, Gallery at 1048, both 638x108.
    const levels = paintedBox(375, 918, 638, 108);
    const galleryLive = liveBox(shipped(638, 108), 375, 1048, 638, 108);

    // Gallery's live area reached up into the Levels button's face.
    expect(galleryLive.top).toBeLessThan(levels.bottom);
    expect(galleryLive.top).toBe(994 - 54);

    // With the fix it stops exactly where Gallery is painted.
    const fixed = liveBox(centredHitArea(638, 108), 375, 1048, 638, 108);
    expect(fixed.top).toBeGreaterThanOrEqual(levels.bottom);
  });
});
