/*
 * The HUD moves by exactly what these return, so the cases are the phones:
 * the one with no letterbox (the SE, where the status bar sits on the canvas),
 * the ones whose letterbox already clears the notch, and a screen whose sides
 * disagree — which is the case a symmetric shortcut would get wrong.
 */
import { describe, expect, it } from 'vitest';
import {
  bannerLift,
  bannerReach,
  BANNER_AIR_PT,
  BANNER_PT,
  DESK_MIN_PT,
  fitCanvas,
  fitShape,
  insetsFrom,
  NO_INSETS,
  paperAround,
  parseSafeParam,
  sidePaperPt,
  uncoveredInsets,
  wantsDesk,
} from './SafeArea';
import { adaptiveHeight, MAX_HEIGHT, METRICS } from './Theme';

const BASE_W = 750;
const BASE_H = 1334;

describe('uncovered safe-area insets', () => {
  it('pushes the canvas down by the whole status bar on a 9:16 phone', () => {
    // iPhone SE: 375×667 CSS px, FIT fills it, 20 pt status bar.
    const got = uncoveredInsets(
      { top: 20, right: 0, bottom: 0, left: 0 },
      { left: 0, top: 0, width: 375, height: 667 },
      { width: 375, height: 667 },
      BASE_W,
      BASE_H
    );
    expect(got.top).toBeCloseTo(40, 5); // 20 CSS px at 2 base units per px
    expect(got.right).toBe(0);
    expect(got.bottom).toBe(0);
    expect(got.left).toBe(0);
  });

  it('asks nothing of a letterboxed phone whose band already clears the notch', () => {
    // iPhone 15: 393×852, the canvas is 393 wide and letterboxed to y 76.5..775.5.
    const height = (393 * BASE_H) / BASE_W;
    const top = (852 - height) / 2;
    const got = uncoveredInsets(
      { top: 59, right: 0, bottom: 34, left: 0 },
      { left: 0, top, width: 393, height },
      { width: 393, height: 852 },
      BASE_W,
      BASE_H
    );
    expect(got).toEqual(NO_INSETS);
  });

  it('charges only what the letterbox leaves over', () => {
    // A band of 10 px against a 30 px inset leaves 20 px on the canvas.
    const got = uncoveredInsets(
      { top: 30, right: 0, bottom: 30, left: 0 },
      { left: 0, top: 10, width: 375, height: 647 },
      { width: 375, height: 667 },
      BASE_W,
      BASE_H
    );
    expect(got.top).toBeCloseTo(20 * (BASE_H / 647), 5);
    expect(got.bottom).toBeCloseTo(20 * (BASE_H / 647), 5);
  });

  it('keeps each side to itself when the insets are asymmetric', () => {
    // A pillarboxed canvas with a 30 px cut-out on the left edge only.
    const got = uncoveredInsets(
      { top: 0, right: 0, bottom: 0, left: 30 },
      { left: 12, top: 0, width: 375, height: 667 },
      { width: 399, height: 667 },
      BASE_W,
      BASE_H
    );
    expect(got.left).toBeCloseTo(18 * (BASE_W / 375), 5);
    expect(got.right).toBe(0);
    expect(got.top).toBe(0);
  });

  it('answers zero rather than nonsense for a canvas that has no size yet', () => {
    const got = uncoveredInsets(
      { top: 20, right: 5, bottom: 5, left: 5 },
      { left: 0, top: 0, width: 0, height: 0 },
      { width: 375, height: 667 },
      BASE_W,
      BASE_H
    );
    expect(got).toEqual(NO_INSETS);
  });

  it('never reports a negative inset', () => {
    const got = uncoveredInsets(
      { top: Number.NaN, right: -4, bottom: 0, left: 0 },
      { left: 0, top: 0, width: 375, height: 667 },
      { width: 375, height: 667 },
      BASE_W,
      BASE_H
    );
    expect(got).toEqual(NO_INSETS);
  });
});

/*
 * The rectangle form, and the shapes it exists for. index.html now fits #app
 * into the safe area, so on a real device the answer is 0 on every side — the
 * cases below prove both the shapes that USED to reach under a band and that
 * the fitted canvas no longer does. FIT's scale is uniform: 750 base px across
 * the canvas's CSS width, for both axes.
 */
describe('insets from the safe rectangle', () => {
  /** The canvas Scale.FIT makes of `box`: uniformly scaled and centred in it. */
  const fit = (box: { left: number; top: number; width: number; height: number }) => {
    const k = Math.min(box.width / BASE_W, box.height / BASE_H);
    const width = BASE_W * k;
    const height = BASE_H * k;
    return {
      left: box.left + (box.width - width) / 2,
      top: box.top + (box.height - height) / 2,
      width,
      height,
    };
  };

  it('finds the 84pt status strip on the right of an iPhone Duo outer display', () => {
    // 466×678, safe area right 84 / bottom 34. The canvas FIT to the whole
    // screen (the old page) is height-bound: 381 wide at x 42.
    const screen = { left: 0, top: 0, width: 466, height: 678 };
    const safe = { left: 0, top: 0, width: 466 - 84, height: 678 - 34 };
    const old = fit(screen);
    const got = insetsFrom(safe, old, BASE_W);
    const k = old.width / BASE_W;
    expect(got.right).toBeCloseTo((old.left + old.width - 382) / k, 5);
    expect(got.right).toBeGreaterThan(75); // ~81 base px of the mirror half
    expect(got.left).toBe(0);
    expect(got.top).toBe(0);
    // Fit into the safe rectangle instead, and nothing is left under the strip.
    expect(insetsFrom(safe, fit(safe), BASE_W)).toEqual(NO_INSETS);
  });

  it('finds the 82pt top band of the inner display held tall', () => {
    const screen = { left: 0, top: 0, width: 669, height: 951 };
    const safe = { left: 0, top: 82, width: 669, height: 951 - 82 - 34 };
    const old = fit(screen);
    const got = insetsFrom(safe, old, BASE_W);
    expect(got.top).toBeCloseTo((82 - old.top) * (BASE_W / old.width), 5);
    expect(got.top).toBeGreaterThan(100);
    expect(got.left).toBe(0);
    expect(got.right).toBe(0);
    expect(insetsFrom(safe, fit(safe), BASE_W)).toEqual(NO_INSETS);
  });

  it('answers all zeros for a canvas already inside the safe rectangle', () => {
    const safe = { left: 0, top: 59, width: 393, height: 852 - 59 - 34 };
    expect(insetsFrom(safe, fit(safe), BASE_W)).toEqual(NO_INSETS);
  });

  it('charges the SE its status bar before the page clears it, and nothing after', () => {
    const screen = { left: 0, top: 0, width: 375, height: 667 };
    const safe = { left: 0, top: 20, width: 375, height: 647 };
    // Before: the canvas filled the glass, its top 20 pt under the bar.
    expect(insetsFrom(safe, fit(screen), BASE_W).top).toBeCloseTo(40, 5);
    // After: fitted into the safe area — a touch smaller, and clear of it.
    const after = fit(safe);
    expect(after.width / BASE_W).toBeCloseTo(0.485, 3);
    expect(insetsFrom(safe, after, BASE_W)).toEqual(NO_INSETS);
  });

  it('agrees with the inset form on a FIT canvas', () => {
    const screen = { left: 0, top: 0, width: 466, height: 678 };
    const canvas = fit(screen);
    const fromRect = insetsFrom({ left: 0, top: 0, width: 382, height: 644 }, canvas, BASE_W);
    const fromInsets = uncoveredInsets(
      { top: 0, right: 84, bottom: 34, left: 0 },
      canvas,
      { width: 466, height: 678 },
      BASE_W,
      BASE_H
    );
    expect(fromInsets.right).toBeCloseTo(fromRect.right, 5);
    expect(fromInsets.bottom).toBeCloseTo(fromRect.bottom, 5);
  });

  it('measures the paper left beside the board, side by side', () => {
    // The inner display held wide, fitted: a narrow board with room either side.
    const safe = { left: 0, top: 0, width: 951 - 84, height: 669 - 34 };
    const canvas = fit(safe);
    const room = paperAround(safe, canvas, BASE_W);
    const perCss = BASE_W / canvas.width;
    expect(room.left).toBeCloseTo(canvas.left * perCss, 5);
    expect(room.right).toBeCloseTo(room.left, 5);
    expect(room.left).toBeGreaterThan(BASE_W / 2);
    expect(room.top).toBe(0);
    expect(room.bottom).toBe(0);
    // And never negative for a canvas that overhangs: the outer display's old
    // canvas ran 41 pt past the safe right edge, and has no paper there.
    const outerSafe = { left: 0, top: 0, width: 382, height: 644 };
    const outerOld = fit({ left: 0, top: 0, width: 466, height: 678 });
    expect(paperAround(outerSafe, outerOld, BASE_W).right).toBe(0);
    expect(paperAround(outerSafe, outerOld, BASE_W).left).toBeGreaterThan(0);
  });
});

/*
 * The banner is 50 POINTS on every phone; what it covers of the canvas, in
 * base units, is what the menu's foot has to end above.
 */
describe('bannerReach', () => {
  it('covers 100 base units of a 9:16 canvas drawn at 0.5', () => {
    const safe = { left: 0, top: 0, width: 375, height: 667 };
    expect(bannerReach(safe, { left: 0, top: 0, width: 375, height: 667 }, BASE_W)).toBeCloseTo(100, 5);
  });

  it('covers more of a canvas drawn smaller: the SE, and the SE with Display Zoom', () => {
    // SE: 375×667 with a 20pt status bar, canvas 647 tall and 363.8 wide.
    const se = { left: 0, top: 20, width: 375, height: 647 };
    const seCanvas = { left: 5.6, top: 20, width: (647 * BASE_W) / BASE_H, height: 647 };
    expect(bannerReach(se, seCanvas, BASE_W)).toBeCloseTo(50 * (BASE_H / 647), 5);
    // Zoomed SE: 320×568, 20pt status bar, 4pt of paper lifted under the canvas.
    const zoom = { left: 0, top: 20, width: 320, height: 548 };
    const zCanvas = { left: 0, top: 20, width: (544 * BASE_W) / BASE_H, height: 544 };
    const reach = bannerReach(zoom, zCanvas, BASE_W);
    expect(reach).toBeCloseTo(46 * (BASE_H / 544), 5);
    expect(reach).toBeGreaterThan(110);
  });

  it('reaches nothing when the letterbox below is taller than the banner', () => {
    // A tall canvas with 60pt of paper under it inside the safe area.
    const safe = { left: 0, top: 59, width: 393, height: 759 };
    const canvas = { left: 0, top: 59, width: 393, height: 699 };
    expect(bannerReach(safe, canvas, BASE_W)).toBeLessThan(0);
  });

  it('is unknown for a canvas that is not laid out', () => {
    const safe = { left: 0, top: 0, width: 375, height: 667 };
    expect(bannerReach(safe, { left: 0, top: 0, width: 0, height: 0 }, BASE_W)).toBeNaN();
  });
});

/*
 * The shapes the lift and the desk are decided on: the safe rectangle each
 * leaves #app, in points. The Duo's are the modelled ones (84pt side strip,
 * 82pt top band, 34pt home indicator) — unmeasured until a Duo simulator run.
 */
const SHAPES = {
  'iPhone 17 Pro': { width: 402, height: 874 - 62 - 34 },
  'iPhone SE': { width: 375, height: 667 - 20 },
  'SE, Display Zoom': { width: 320, height: 568 - 20 },
  'Duo outer 466×678, strip right': { width: 466 - 84, height: 678 - 34 },
  'Duo inner held tall 669×951': { width: 669, height: 951 - 82 - 34 },
  'Duo inner held wide 951×669': { width: 951 - 84, height: 669 - 34 },
  'Duo inner, side-by-side half': { width: 433, height: 669 - 34 },
  'Duo inner, stacked Split View pane': { width: 669, height: 423 },
} as const;

describe('fitCanvas', () => {
  it('is Scale.FIT with CENTER_BOTH: uniform, whole, centred', () => {
    const wide = fitCanvas({ left: 10, top: 20, width: 867, height: 635 }, BASE_W, BASE_H);
    expect(wide.height).toBeCloseTo(635, 6);
    expect(wide.width / wide.height).toBeCloseTo(BASE_W / BASE_H, 6);
    expect(wide.left - 10).toBeCloseTo(10 + 867 - (wide.left + wide.width), 6);
    const tall = fitCanvas({ left: 0, top: 0, width: 300, height: 900 }, BASE_W, BASE_H);
    expect(tall.width).toBeCloseTo(300, 6);
    expect(tall.top).toBeCloseTo((900 - tall.height) / 2, 6);
    expect(fitCanvas({ left: 0, top: 0, width: 0, height: 10 }, BASE_W, BASE_H).width).toBe(0);
  });
});

/*
 * The banner is 50 POINTS; the reserve is base units, so it shrinks with the
 * canvas. Wherever the canvas is drawn small enough that the reserve no longer
 * covers the banner plus its point of air, #app is lifted until it does — and
 * by no more than that, since every point of lift is a point of board lost.
 */
describe('bannerLift', () => {
  const reserve = METRICS.bannerReserve;

  /** What the banner has below the board after a lift, in points. */
  const clearance = (safe: { width: number; height: number }, lift: number): number => {
    const h = safe.height - lift;
    const k = Math.min(safe.width / BASE_W, h / BASE_H);
    return lift + (h - BASE_H * k) / 2 + reserve * k;
  };

  it('lifts nothing on any iPhone or iPhone Duo shape but the two short ones', () => {
    for (const [name, safe] of Object.entries(SHAPES)) {
      const lift = bannerLift(safe, reserve, BASE_W, BASE_H);
      if (name === 'SE, Display Zoom' || name === 'Duo inner, stacked Split View pane') {
        expect(lift, name).toBeGreaterThan(0);
      } else {
        expect(lift, name).toBe(0);
      }
    }
  });

  it('lifts exactly enough, in whole points: the banner and its air, and one point less would not do', () => {
    for (const [name, safe] of Object.entries(SHAPES)) {
      const lift = bannerLift(safe, reserve, BASE_W, BASE_H);
      expect(Number.isInteger(lift), name).toBe(true);
      expect(clearance(safe, lift), name).toBeGreaterThanOrEqual(BANNER_PT + BANNER_AIR_PT - 0.01);
      if (lift > 0) expect(clearance(safe, lift - 1), name).toBeLessThan(BANNER_PT + BANNER_AIR_PT);
    }
  });

  it('matches the zoomed SE the menu was fixed for: 4 points', () => {
    expect(bannerLift(SHAPES['SE, Display Zoom'], reserve, BASE_W, BASE_H)).toBe(4);
  });

  it('lifts the stacked Duo pane off the banner by about 16 points', () => {
    const lift = bannerLift(SHAPES['Duo inner, stacked Split View pane'], reserve, BASE_W, BASE_H);
    expect(lift).toBeGreaterThanOrEqual(15);
    expect(lift).toBeLessThanOrEqual(17);
  });

  it('needs no lift where the paper under a width-bound canvas already holds the banner', () => {
    expect(bannerLift({ width: 300, height: 900 }, reserve, BASE_W, BASE_H)).toBe(0);
  });

  it('answers 0, never NaN, for a page that cannot be measured', () => {
    expect(bannerLift(null, reserve, BASE_W, BASE_H)).toBe(0);
    expect(bannerLift({ width: 0, height: 600 }, reserve, BASE_W, BASE_H)).toBe(0);
    expect(bannerLift({ width: Number.NaN, height: 600 }, reserve, BASE_W, BASE_H)).toBe(0);
    const tiny = bannerLift({ width: 669, height: 20 }, reserve, BASE_W, BASE_H);
    expect(Number.isFinite(tiny)).toBe(true);
    expect(tiny).toBeGreaterThanOrEqual(0);
  });
});

/*
 * Desk mode: 40pt or more of paper on EACH side of the board. Every phone is
 * width-bound or nearly, so it never turns on there; the Duo's inner display
 * does, held either way, as does the short pane.
 */
describe('desk margins', () => {
  const on = (name: keyof typeof SHAPES): boolean => {
    const safe = SHAPES[name];
    return wantsDesk(safe, bannerLift(safe, METRICS.bannerReserve, BASE_W, BASE_H), BASE_W, BASE_H);
  };

  it('stays off on every phone and on the Duo outer display', () => {
    expect(on('iPhone 17 Pro')).toBe(false);
    expect(on('iPhone SE')).toBe(false);
    expect(on('SE, Display Zoom')).toBe(false);
    expect(on('Duo outer 466×678, strip right')).toBe(false);
    // 38pt a side: close, and still a phone-shaped window.
    expect(on('Duo inner, side-by-side half')).toBe(false);
  });

  it('turns on for the Duo inner display, held tall or wide, and the short pane', () => {
    expect(on('Duo inner held tall 669×951')).toBe(true);
    expect(on('Duo inner held wide 951×669')).toBe(true);
    expect(on('Duo inner, stacked Split View pane')).toBe(true);
  });

  it('measures the paper beside the board in points, the same on both sides', () => {
    const p = sidePaperPt(SHAPES['Duo inner held wide 951×669'], 0, BASE_W, BASE_H);
    expect(p.left).toBeCloseTo(p.right, 6);
    expect(p.left).toBeCloseTo((867 - (635 * BASE_W) / BASE_H) / 2, 6);
    const half = sidePaperPt(SHAPES['Duo inner, side-by-side half'], 0, BASE_W, BASE_H);
    expect(half.left).toBeLessThan(DESK_MIN_PT);
    expect(half.left).toBeGreaterThan(35);
  });

  it('is off for a page that cannot be measured', () => {
    expect(wantsDesk(null, 0, BASE_W, BASE_H)).toBe(false);
    expect(wantsDesk({ width: 0, height: 0 }, 0, BASE_W, BASE_H)).toBe(false);
  });
});

/* The DEV ?safe=t,r,b,l switch: four points or nothing. */
describe('parseSafeParam', () => {
  it('reads top, right, bottom, left in points', () => {
    expect(parseSafeParam('0,84,34,0')).toEqual({ top: 0, right: 84, bottom: 34, left: 0 });
    expect(parseSafeParam(' 82 , 0 , 34 , 0 ')).toEqual({ top: 82, right: 0, bottom: 34, left: 0 });
    expect(parseSafeParam('0,0,0,12.5')).toEqual({ top: 0, right: 0, bottom: 0, left: 12.5 });
  });

  it('refuses anything else rather than guessing', () => {
    for (const bad of [null, undefined, '', '1,2,3', '1,2,3,4,5', 'a,b,c,d', '-1,0,0,0', '1,,2,3', 'Infinity,0,0,0']) {
      expect(parseSafeParam(bad), String(bad)).toBeNull();
    }
  });
});

/*
 * The adaptive world (Theme.adaptiveHeight) and the lift, decided together. A
 * tall phone's canvas fills its safe area — no bands — and the banner then
 * covers its bottom 50pt outright, which the reserve holds on every iPhone;
 * every shape 9:16 or wider keeps 1334 and the lift it always had.
 */
describe('fitShape', () => {
  const reserve = METRICS.bannerReserve;
  const TALL = {
    'iPhone 16e 390×844': { width: 390, height: 844 - 47 - 34 },
    'iPhone 17 393×852': { width: 393, height: 852 - 59 - 34 },
    'iPhone 18 Pro 402×874': { width: 402, height: 874 - 62 - 34 },
    'iPhone Pro Max 440×956': { width: 440, height: 956 - 62 - 34 },
    'Split View pane 320×690': { width: 320, height: 690 },
    'Slide Over sliver 320×1300': { width: 320, height: 1300 },
  } as const;

  /** What the banner has below the board after `lift`, in points, on a world `h` tall. */
  const clearance = (safe: { width: number; height: number }, lift: number, h: number): number => {
    const box = safe.height - lift;
    const k = Math.min(safe.width / BASE_W, box / h);
    return lift + (box - h * k) / 2 + reserve * k;
  };

  it('is bannerLift exactly on every shape that keeps 1334', () => {
    for (const [name, safe] of Object.entries(SHAPES)) {
      const shape = fitShape(safe, reserve);
      if (shape.height !== BASE_H) continue;
      expect(shape.lift, name).toBe(bannerLift(safe, reserve, BASE_W, BASE_H));
    }
    // Every Duo shape and the SE are 9:16 or wider, so all of them keep it.
    expect(fitShape(SHAPES['iPhone SE'], reserve)).toEqual({ height: BASE_H, lift: 0 });
    expect(fitShape(SHAPES['SE, Display Zoom'], reserve)).toEqual({ height: BASE_H, lift: 4 });
    expect(fitShape(SHAPES['Duo inner held wide 951×669'], reserve).height).toBe(BASE_H);
    expect(fitShape(SHAPES['Duo inner held tall 669×951'], reserve).height).toBe(BASE_H);
  });

  it('fills a tall phone’s safe area: the canvas is the safe area, give or take a rounding', () => {
    for (const [name, safe] of Object.entries(TALL)) {
      const { height, lift } = fitShape(safe, reserve);
      if (height >= MAX_HEIGHT) continue;
      const box = { left: 0, top: 0, width: safe.width, height: safe.height - lift };
      const canvas = fitCanvas(box, BASE_W, height);
      expect(canvas.width, name).toBeCloseTo(safe.width, 0);
      // Round(750 × h / w) is within half a base unit: a fraction of a point either way.
      expect(Math.abs(canvas.height - box.height), name).toBeLessThan(0.5);
    }
  });

  it('lifts nothing on any iPhone, and a couple of points in the 320pt pane', () => {
    for (const name of ['iPhone 16e 390×844', 'iPhone 17 393×852', 'iPhone 18 Pro 402×874', 'iPhone Pro Max 440×956'] as const) {
      const shape = fitShape(TALL[name], reserve);
      expect(shape.lift, name).toBe(0);
      expect(shape.height, name).toBeGreaterThan(1440);
    }
    const pane = fitShape(TALL['Split View pane 320×690'], reserve);
    expect(pane.lift).toBeGreaterThan(0);
    expect(pane.lift).toBeLessThanOrEqual(3);
    expect(pane.height).toBe(Math.round((BASE_W * (690 - pane.lift)) / 320));
  });

  it('lifts exactly enough on every shape, tall or wide, and one point less would not do', () => {
    for (const [name, safe] of [...Object.entries(SHAPES), ...Object.entries(TALL)]) {
      const { height, lift } = fitShape(safe, reserve);
      expect(Number.isInteger(lift), name).toBe(true);
      expect(height, name).toBe(adaptiveHeight(safe.width, safe.height - lift));
      expect(clearance(safe, lift, height), name).toBeGreaterThanOrEqual(BANNER_PT + BANNER_AIR_PT - 0.01);
      if (lift > 0) {
        // The shape one point less WOULD have built: its own height fills a
        // box a point taller, so the clearance is measured on that world.
        const less = adaptiveHeight(safe.width, safe.height - (lift - 1));
        expect(clearance(safe, lift - 1, less), name).toBeLessThan(BANNER_PT + BANNER_AIR_PT - 0.01);
      }
    }
  });

  it('ships the 320pt pane at 1613, two points lifted (1617 is the unlifted box)', () => {
    expect(fitShape(TALL['Split View pane 320×690'], reserve)).toEqual({ height: 1613, lift: 2 });
    expect(adaptiveHeight(320, 690)).toBe(1617);
  });

  it('letterboxes a sliver past MAX_HEIGHT, top and bottom, as a tall phone used to', () => {
    const { height } = fitShape(TALL['Slide Over sliver 320×1300'], reserve);
    expect(height).toBe(MAX_HEIGHT);
    const canvas = fitCanvas({ left: 0, top: 0, width: 320, height: 1300 }, BASE_W, height);
    expect(canvas.top).toBeGreaterThan(0);
  });

  it('never turns desk mode on for a tall phone, and keeps it where it was', () => {
    for (const [name, safe] of Object.entries(TALL)) {
      const { height, lift } = fitShape(safe, reserve);
      expect(wantsDesk(safe, lift, BASE_W, height), name).toBe(false);
    }
    for (const [name, safe] of Object.entries(SHAPES)) {
      const { height, lift } = fitShape(safe, reserve);
      expect(wantsDesk(safe, lift, BASE_W, height), name).toBe(
        wantsDesk(safe, bannerLift(safe, reserve, BASE_W, BASE_H), BASE_W, BASE_H)
      );
    }
  });

  it('answers the 9:16 world for a page that cannot be measured', () => {
    expect(fitShape(null, reserve)).toEqual({ height: BASE_H, lift: 0 });
    expect(fitShape({ width: 0, height: 600 }, reserve)).toEqual({ height: BASE_H, lift: 0 });
  });

  it('turns base units back into points at the world’s own height', () => {
    // The banner's top on a canvas that fills a 402×778 safe area, 1451 tall:
    // 50pt at 402/750 is 93.3 base units, from the bottom of THAT height.
    const { height } = fitShape(TALL['iPhone 18 Pro 402×874'], reserve);
    const safe = { left: 0, top: 62, width: 402, height: 778 };
    const canvas = fitCanvas(safe, BASE_W, height);
    expect(bannerReach(safe, canvas, BASE_W)).toBeCloseTo((50 * BASE_W) / 402, 0);
    expect(insetsFrom(safe, canvas, BASE_W, height)).toEqual(NO_INSETS);
  });
});
