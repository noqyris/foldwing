import { describe, expect, it } from 'vitest';
import { centredHitArea, liveBox, MIN_TAP_PT, paintedBox, stackFoot, tapFloor, worldPoint } from './HitArea';

/** The world's heights (Theme.adaptiveHeight): 9:16, a modern iPhone, a tall narrow pane. */
const HEIGHTS = [1334, 1460, 1700];

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

/**
 * Apple's 44pt floor, in base units, at the scale the canvas is really drawn.
 *
 * pt(44) was the floor, and it is 44pt only at 0.5. Once the canvas was fitted
 * into the safe area, the SE's status bar drew it at 0.485 and every control
 * "raised to 44pt" measured 42.7pt on the glass.
 */
describe('tapFloor — 44pt on the glass at any scale', () => {
  /** Points on the glass for `base` base units at a canvas scale of `k`. */
  const onGlass = (base: number, k: number): number => base * k;

  it('is pt(44) at the design scale', () => {
    expect(tapFloor(2)).toBe(88);
  });

  it('reaches 44pt on the iPhone SE under its status bar', () => {
    // 667pt screen, 20pt status bar: FIT draws 1334 base rows into 647pt.
    const k = 647 / 1334;
    const floor = tapFloor(1 / k);
    expect(onGlass(88, k)).toBeLessThan(MIN_TAP_PT); // the old floor: 42.7pt
    expect(onGlass(floor, k)).toBeGreaterThanOrEqual(MIN_TAP_PT);
    expect(floor).toBe(91);
  });

  it('reaches 44pt on a smaller canvas still, a short window or a split pane', () => {
    for (const k of [0.49, 0.465, 0.43, 0.4, 0.3]) {
      expect(onGlass(tapFloor(1 / k), k), `scale ${k}`).toBeGreaterThanOrEqual(MIN_TAP_PT);
    }
  });

  it('never shrinks below the designed pt(44) on a larger canvas', () => {
    // i15 draws at 0.524, the Pro Max at 0.573: the layout keeps its sizes.
    expect(tapFloor(1 / 0.524)).toBe(88);
    expect(tapFloor(1 / 0.573)).toBe(88);
  });

  it('falls back to pt(44) on a scale nobody can read', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(tapFloor(bad)).toBe(88);
    }
  });

  it('does not round an exact scale up by a whole unit', () => {
    // 44 × 2.25 is exactly 99; floating point must not make it 100.
    expect(tapFloor(2.25)).toBe(99);
  });
});

/**
 * The menu's selling stack, laid out the way MenuScene lays it out, so the
 * foot's geometry is checked where it lands rather than as three numbers.
 *
 * Continue (66pt) · Daily (54) · Levels | Gallery (54) · Store (40) · Restore
 * (28), pt(11) apart, from pt(321) less the rise. The tagline's text ends at
 * about base 624 and the primary button's shadow reaches pt(3) above it.
 */
for (const height of HEIGHTS) {
  describe(`stackFoot — the menu foot at any floor (${height} tall)`, () => {
    // On a taller world the whole foot sits lower by the extra height: the
    // banner line, the tagline and the stack alike. stackFoot answers in
    // distances, so every assertion holds at every height.
    const E = height - 1334;
    const spec = { upper: 80, lower: 56, gap: 22, air: 2, maxRise: 6 };
    const BANNER_LINE = 1230 + E;
    const TAGLINE_BOTTOM = 624 + E;

    function menu(floor: number) {
      const foot = stackFoot(floor, spec);
      let y = 642 + E - foot.rise;
      const place = (h: number) => {
        const top = y;
        y += h + spec.gap;
        return { top, bottom: top + h, mid: top + h / 2 };
      };
      const primary = place(132);
      place(108);
      const levels = place(108);
      const store = place(spec.upper);
      y += foot.gap - spec.gap;
      const restore = place(spec.lower);
      const area = (row: { mid: number }, h: number) => ({
        top: row.mid - Math.max(h, foot.tap) / 2,
        bottom: row.mid + Math.max(h, foot.tap) / 2,
      });
      return {
        foot,
        shadowTop: primary.top - 6,
        levels,
        store: area(store, spec.upper),
        restore: area(restore, spec.lower),
      };
    }

    it('changes nothing at the design scale', () => {
      expect(stackFoot(88, spec)).toEqual({ tap: 88, gap: 22, rise: 0, lift: 0 });
      const m = menu(88);
      expect(m.restore.bottom).toBe(BANNER_LINE);
      expect(m.restore.top - m.store.bottom).toBe(2);
    });

    it('gives the SE and the Duo outer display their whole floor', () => {
      // 0.485 → 91, 0.483 → 92: the two shapes that need a rise at all.
      expect(stackFoot(91, spec)).toEqual({ tap: 91, gap: 25, rise: 4.5, lift: 0 });
      expect(stackFoot(92, spec)).toEqual({ tap: 92, gap: 26, rise: 6, lift: 0 });
    });

    it('never pushes the primary button into the tagline, or reaches a neighbour', () => {
      // Every floor from 0.5 down to a quarter-size split pane.
      for (let floor = 88; floor <= 180; floor++) {
        const m = menu(floor);
        const at = `floor ${floor}`;
        expect(m.foot.rise, at).toBeLessThanOrEqual(spec.maxRise);
        expect(m.shadowTop - TAGLINE_BOTTOM, at).toBeGreaterThanOrEqual(12 - spec.maxRise);
        expect(m.store.top - m.levels.bottom, at).toBeGreaterThanOrEqual(spec.air);
        expect(m.restore.top - m.store.bottom, at).toBeGreaterThanOrEqual(spec.air);
        expect(m.restore.bottom, at).toBeLessThanOrEqual(BANNER_LINE);
        expect(m.foot.tap, at).toBeLessThanOrEqual(floor);
        expect(m.foot.tap, at).toBeGreaterThanOrEqual(88);
      }
    });

    it('gives way a unit at a time, not all the way back to pt(44)', () => {
      // A stacked Split View pane: 0.317 → 139. The old rise was 76 base px.
      const foot = stackFoot(139, spec);
      expect(foot.tap).toBe(92);
      expect(foot.rise).toBe(6);
    });

    it('keeps the upper area off the row above when the rise is free', () => {
      // With room to rise, the limit is the reach into the gap over Store.
      const foot = stackFoot(200, { ...spec, maxRise: 1000 });
      expect(foot.tap).toBe(spec.upper + 2 * (spec.gap - spec.air));
    });
  });
}

/*
 * The same menu, with the page free to move and the banner line where the
 * phone puts it. `line` is where the Restore area must end; `lift` moves the
 * wordmark, the tagline and the stack together, so the tagline-to-primary
 * gap depends on `rise` alone.
 */
for (const height of HEIGHTS) {
  describe(`stackFoot — the page lift and the banner line (${height} tall)`, () => {
    const E = height - 1334;
    const MAX_LIFT = 60;
    const spec = { upper: 80, lower: 56, gap: 22, air: 2, maxRise: 6, maxLift: MAX_LIFT };
    const DESIGN_LINE = 1230 + E;
    const TAGLINE_BOTTOM = 624 + E;
    const WORDMARK_TOP = 327 + E;

    function menu(floor: number, line: number) {
      const foot = stackFoot(floor, { ...spec, drop: DESIGN_LINE - line });
      let y = 642 + E - foot.rise - foot.lift;
      const place = (h: number) => {
        const top = y;
        y += h + spec.gap;
        return { top, bottom: top + h, mid: top + h / 2 };
      };
      const primary = place(132);
      place(108);
      const levels = place(108);
      const store = place(spec.upper);
      y += foot.gap - spec.gap;
      const restore = place(spec.lower);
      const area = (row: { mid: number }, h: number) => ({
        top: row.mid - Math.max(h, foot.tap) / 2,
        bottom: row.mid + Math.max(h, foot.tap) / 2,
      });
      return {
        foot,
        shadowTop: primary.top - 6,
        tagline: TAGLINE_BOTTOM - foot.lift,
        wordmark: WORDMARK_TOP - foot.lift,
        levels,
        store: area(store, spec.upper),
        restore: area(restore, spec.lower),
      };
    }

    it('moves nothing where the canvas is drawn at 0.5 or more', () => {
      expect(stackFoot(88, { ...spec, drop: 0 })).toEqual({ tap: 88, gap: 22, rise: 0, lift: 0 });
    });

    it('gives an SE with Display Zoom its whole floor, clear of the banner', () => {
      // 0.4077 → floor 108; the banner begins at 1221.2 and 1pt is 2.45 base.
      const m = menu(108, 1218 + E);
      expect(m.foot.tap).toBe(108);
      expect(m.foot.rise).toBe(6);
      expect(m.foot.lift).toBe(36);
      expect(m.restore.bottom).toBe(1218 + E);
    });

    it('keeps every floor an iPhone draws, the banner line and every neighbour', () => {
      // Floors 88..110 (every iPhone, Display Zoom included) against banner
      // lines from the design down to the reserve's.
      for (let floor = 88; floor <= 110; floor++) {
        for (let line = DESIGN_LINE; line >= 1210 + E; line--) {
          const m = menu(floor, line);
          const at = `floor ${floor} line ${line}`;
          expect(m.foot.tap, at).toBe(floor);
          expect(m.restore.bottom, at).toBeCloseTo(line, 9);
          expect(m.foot.rise, at).toBeLessThanOrEqual(spec.maxRise);
          expect(m.foot.lift, at).toBeLessThanOrEqual(MAX_LIFT);
        }
      }
    });

    it('never crosses the banner line, the tagline or a neighbour, down to a quarter-size pane', () => {
      for (let floor = 88; floor <= 180; floor++) {
        for (const line of [DESIGN_LINE, 1224 + E, 1218 + E, 1212 + E]) {
          const m = menu(floor, line);
          const at = `floor ${floor} line ${line}`;
          expect(m.restore.bottom, at).toBeLessThanOrEqual(line + 1e-9);
          expect(m.shadowTop - m.tagline, at).toBeGreaterThanOrEqual(12 - spec.maxRise);
          expect(m.store.top - m.levels.bottom, at).toBeGreaterThanOrEqual(spec.air);
          expect(m.restore.top - m.store.bottom, at).toBeGreaterThanOrEqual(spec.air);
          expect(m.foot.lift, at).toBeLessThanOrEqual(MAX_LIFT);
          expect(m.wordmark, at).toBeGreaterThanOrEqual(WORDMARK_TOP - MAX_LIFT);
          expect(m.foot.tap, at).toBeLessThanOrEqual(Math.max(88, floor));
          expect(m.foot.tap, at).toBeGreaterThanOrEqual(88);
        }
      }
    });

    it('honours the banner line past the lift cap rather than leave the foot over the ad', () => {
      // A line no cap can reach: the floor gives way to pt(44), the banner does not.
      const m = menu(120, DESIGN_LINE - 90);
      expect(m.foot.tap).toBe(88);
      expect(m.restore.bottom).toBe(DESIGN_LINE - 90);
      expect(m.foot.lift).toBeGreaterThan(MAX_LIFT);
    });
  });
}

/*
 * One door for every pointer read (tech G14). Today the canvas point is the
 * world point; stage 3 changes this function and nothing else, so the test
 * pins that it reads the canvas point now and ignores worldX/worldY — a
 * camera scroll must not leak into a hit test drawn in screen space.
 */
describe('worldPoint', () => {
  it('is the pointer itself while the world is drawn at zoom 1', () => {
    expect(worldPoint({ x: 120, y: 840 })).toEqual({ x: 120, y: 840 });
    expect(worldPoint({ x: 120, y: 840, worldX: 999, worldY: -5 })).toEqual({ x: 120, y: 840 });
  });

  it('hands back a fresh point, never the pointer', () => {
    const p = { x: 1, y: 2 };
    const w = worldPoint(p);
    w.x = 50;
    expect(p.x).toBe(1);
  });
});
