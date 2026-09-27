import { describe, expect, it } from 'vitest';
import { Playfield } from '../core/Playfield';
import {
  adaptiveHeight,
  bannerLine,
  BASE_HEIGHT,
  BASE_WIDTH,
  blend,
  boardDrop,
  boardInset,
  contrast,
  cubicBezier,
  DP,
  dp,
  FONT_DISPLAY,
  FONT_UI,
  glassOver,
  hexCss,
  inkCss,
  MAX_HEIGHT,
  MOTION,
  METRICS,
  motionReduced,
  ms,
  PT,
  pt,
  setMotionScale,
  setTheme,
  setViewHeight,
  theme,
  THEMES,
  ui,
  UI_THEMES,
  veiledInk,
  viewHeight,
} from './Theme';

/*
 * These are the spec's numbers, not incidental constants. Pinning them means a
 * later tweak to "just the look" cannot quietly retune the feel of the game,
 * and the LOCKED values announce themselves if anyone edits them.
 */

describe('base canvas', () => {
  it('is a 9:16 portrait reference space, fixed in width', () => {
    expect(BASE_WIDTH).toBe(750);
    expect(BASE_HEIGHT).toBe(1334);
    // Wider than any common portrait phone: a taller phone grows the world's
    // height (adaptiveHeight) rather than pillarboxing and stealing the
    // mirror's width, and this is the least that height ever is.
    expect(BASE_WIDTH / BASE_HEIGHT).toBeLessThan(0.5626);
  });

  it('converts logical points at 2x', () => {
    expect(PT).toBe(2);
    expect(pt(5)).toBe(10);
    expect(pt(2.6)).toBeCloseTo(5.2, 12);
    expect(pt(0)).toBe(0);
  });
});

/*
 * The adaptive height, on the safe areas it is decided from (points: the
 * screen less the status bar and the home indicator). A tall phone gets a
 * taller world that fills it; anything 9:16 or wider keeps 1334 and
 * letterboxes sideways exactly as before.
 */
describe('adaptiveHeight', () => {
  const safe = (w: number, h: number, top: number, bottom: number): number => adaptiveHeight(w, h - top - bottom);

  it('is 1334 on the 9:16 SE, with or without its status bar', () => {
    expect(adaptiveHeight(375, 667)).toBe(BASE_HEIGHT);
    // 375×647 is wider than 9:16: clamped up, and the canvas letterboxes sideways by a hair.
    expect(safe(375, 667, 20, 0)).toBe(BASE_HEIGHT);
  });

  it('fills the iPhone 16 / 17 safe areas', () => {
    expect(safe(393, 852, 59, 34)).toBe(Math.round((750 * 759) / 393));
    expect(safe(393, 852, 59, 34)).toBe(1448);
    expect(safe(390, 844, 47, 34)).toBe(1467);
  });

  it('fills the iPhone 18 Pro (402×874, insets 62/34) and the Pro Max (440×956)', () => {
    expect(safe(402, 874, 62, 34)).toBe(1451);
    expect(safe(440, 956, 62, 34)).toBe(1466);
  });

  it('keeps 1334 on every iPhone Duo shape: they are all 9:16 or wider', () => {
    expect(adaptiveHeight(466 - 84, 678 - 34)).toBe(BASE_HEIGHT); // outer, strip right
    expect(adaptiveHeight(669, 951 - 82 - 34)).toBe(BASE_HEIGHT); // inner held tall
    expect(adaptiveHeight(951 - 84, 669 - 34)).toBe(BASE_HEIGHT); // inner held wide
    expect(adaptiveHeight(433, 669 - 34)).toBe(BASE_HEIGHT); // side-by-side half
  });

  it('fills a narrow Split View pane, and keeps 1334 in a wide short one', () => {
    // The pane's whole box. The app builds 1613: fitShape lifts it 2pt off the
    // banner first, and fills what is left (SafeArea.test).
    expect(adaptiveHeight(320, 690)).toBe(1617);
    expect(adaptiveHeight(320, 690 - 2)).toBe(1613);
    expect(adaptiveHeight(669, 440)).toBe(BASE_HEIGHT);
  });

  it('stops at MAX_HEIGHT for a sliver, which letterboxes top and bottom instead', () => {
    expect(MAX_HEIGHT).toBe(1720);
    expect(adaptiveHeight(320, 1300)).toBe(MAX_HEIGHT);
    // 20:9 and 21:9 Android phones, full screen less their bars, still fill.
    expect(adaptiveHeight(412, 915 - 24 - 48)).toBeLessThan(MAX_HEIGHT);
    expect(adaptiveHeight(411, 960 - 24 - 48)).toBeLessThan(MAX_HEIGHT);
  });

  it('is 1334 for a page that cannot be measured', () => {
    for (const [w, h] of [
      [0, 800],
      [400, 0],
      [Number.NaN, 800],
      [400, Number.POSITIVE_INFINITY],
      [-1, 800],
    ]) {
      expect(adaptiveHeight(w, h)).toBe(BASE_HEIGHT);
    }
  });

  it('is what viewHeight answers once set, clamped the same way', () => {
    const was = viewHeight();
    try {
      setViewHeight(1451);
      expect(viewHeight()).toBe(1451);
      setViewHeight(9000);
      expect(viewHeight()).toBe(MAX_HEIGHT);
      setViewHeight(Number.NaN);
      expect(viewHeight()).toBe(BASE_HEIGHT);
    } finally {
      setViewHeight(was);
    }
  });
});

describe('the board on a taller world', () => {
  const HEIGHTS = [BASE_HEIGHT, 1451, 1460, 1613, 1700, MAX_HEIGHT];

  it('is METRICS.inset exactly on a 9:16 world', () => {
    expect(boardInset(BASE_HEIGHT)).toEqual(METRICS.inset);
    expect(boardDrop(BASE_HEIGHT)).toBe(0);
    expect(bannerLine(BASE_HEIGHT)).toBe(BASE_HEIGHT - METRICS.bannerReserve);
  });

  for (const h of HEIGHTS) {
    it(`keeps the proved 702×1102 playfield, centred in the extra height: ${h}`, () => {
      const pf = new Playfield(BASE_WIDTH, h, boardInset(h));
      const ref = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset);
      expect(pf.w).toBe(ref.w);
      expect(pf.h).toBe(ref.h);
      expect(pf.x).toBe(ref.x);
      // Moved, never stretched: the same drop above as the paper gained below.
      const above = pf.y - ref.y;
      const below = h - pf.bottom - (BASE_HEIGHT - ref.bottom);
      expect(above).toBe(boardDrop(h));
      expect(Math.abs(above - below)).toBeLessThanOrEqual(1);
      // And clear of the banner's reserve by the designed margin.
      expect(bannerLine(h) - pf.bottom).toBeGreaterThanOrEqual(METRICS.inset.bottom - METRICS.bannerReserve);
    });
  }
});

/*
 * Night Fold (owner, 2026-09-27): the B tokens are the app's look. They are
 * pinned exactly — a "quick tweak to the look" should be loud — and every
 * text token is held to WCAG's 4.5:1 body floor on each surface it sits on,
 * every non-text mark to 3:1, walls excepted at 2.6-2.8:1 with their rim.
 */
describe('palette: Night Fold', () => {
  const t = theme();
  const u = ui();

  it('is the default, and the only appearance this release', () => {
    expect(t.id).toBe('night');
    expect(u.id).toBe('night');
    expect(Object.keys(THEMES)).toEqual(['night']);
    expect(Object.keys(UI_THEMES)).toEqual(['night']);
  });

  it('matches the owner\'s tokens, exactly', () => {
    expect([u.skyGlow, u.sky, u.skyEdge]).toEqual([0x1d4450, 0x0f2830, 0x081419]);
    expect(t.paper).toBe(u.sky);
    expect([t.board, t.boardCentre]).toEqual([0x10262e, 0x14313a]);
    expect([t.ink, u.text, u.text2]).toEqual([0xf4ede1, 0xf4ede1, 0xa7b8b7]);
    // The one lift: the owner's #86999A is 4.2:1 on glass under the lamp's
    // shoulder, under the owner's own 4.5 floor, so captions moved a hair lighter.
    expect(u.text3).toBe(0x8da0a1);
    expect(contrast(0x86999a, glassOver(0x11303a))).toBeLessThan(4.5);
    expect([t.line, t.lineCore, t.lineCoreWidth]).toEqual([0xff7a52, 0xffd9c2, 0.38]);
    expect(t.lineBloom).toEqual([
      { width: 3.2, alpha: 0.18 },
      { width: 2.0, alpha: 0.22 },
    ]);
    expect(t.mirror).toBe(0x9fb2ae);
    expect([t.wall, t.wallRim]).toEqual([0x416b79, 0x6394a1]);
    expect([t.medal, t.medalText]).toEqual([0xf0c05a, 0xf0c05a]);
    expect([t.accent, t.accentText]).toEqual([0xff7a52, 0xff8c66]);
    expect([u.dusk, u.duskFrom, u.duskTo]).toEqual([0xc99bf0, 0x3a2946, 0x172b36]);
    expect([u.glass, u.glassAlpha, u.glassHighlight]).toEqual([0xfff8ec, 0.06, 0.07]);
    expect(u.stars.count).toBeGreaterThanOrEqual(70);
    expect(u.stars.count).toBeLessThanOrEqual(90);
    expect([u.stars.alphaMin, u.stars.alphaMax]).toEqual([0.1, 0.55]);
  });

  it('keeps every shadow black: never the warm brown of paper', () => {
    expect(u.shadow).toBe(0x000000);
    // A scrim darkens toward the night; a cream one would fog the page.
    expect(contrast(u.scrim, u.sky)).toBeGreaterThan(1.2);
    expect(u.scrim & 0xffffff).toBeLessThan(u.sky);
  });

  /** The lamp's shoulder: where the missions strip and the Continue card sit under the glow. */
  const SHOULDER = 0x11303a;
  const TEXT_SURFACES: Record<string, number> = {
    sky: u.sky,
    skyEdge: u.skyEdge,
    'glass over the sky': glassOver(u.sky),
    'glass over the lamp shoulder': glassOver(SHOULDER),
    'glass over the edge': glassOver(u.skyEdge),
    sheet: u.sheet,
    board: t.board,
    well: u.well,
  };
  const TEXT: Record<string, number> = {
    text: u.text,
    text2: u.text2,
    text3: u.text3,
    accentText: t.accentText,
    medalText: t.medalText,
  };
  for (const [name, fg] of Object.entries(TEXT)) {
    for (const [where, bg] of Object.entries(TEXT_SURFACES)) {
      it(`sets ${name} at the body floor on the ${where}`, () => {
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('sets ember text at the floor on its own accent wash', () => {
    for (const under of [u.sky, SHOULDER, u.sheet]) {
      expect(contrast(t.accentText, blend(t.accent, t.accentWash, under))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('puts dark ink on every accent fill, and dusk ink on the dusk pill', () => {
    for (const face of [t.accent, u.accentTop, u.accentBottom, u.done]) {
      expect(contrast(u.onAccent, face)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(u.onDusk, u.dusk)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the Daily\'s dusk caps and secondary text readable across its gradient', () => {
    for (const bg of [u.duskFrom, u.duskTo]) {
      expect(contrast(u.duskCaps, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(u.text2, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(u.text, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(u.text3, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('holds every non-text mark to 3:1 on the board and the sky', () => {
    for (const bg of [t.board, t.boardCentre, u.sky, glassOver(u.sky)]) {
      for (const mark of [t.accent, t.line, t.medal, veiledInk(t.line), t.fail]) {
        expect(contrast(mark, bg)).toBeGreaterThanOrEqual(3);
      }
    }
    // The lit rim carries the wall's edge.
    expect(contrast(t.wallRim, t.board)).toBeGreaterThanOrEqual(3);
  });

  it('lets walls sit under 3:1 only by the rim\'s grace: 2.6-2.8 on the board', () => {
    const c = contrast(t.wall, t.board);
    expect(c).toBeGreaterThanOrEqual(2.6);
    expect(c).toBeLessThanOrEqual(2.8);
  });

  it('tells the fail red from the tangerine: a change of kind, not of strength', () => {
    const hue = (c: number): number => {
      const [r, g, b] = [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      return max === r ? (60 * (g - b)) / (max - min) : 0;
    };
    expect(hue(t.line) - hue(t.fail)).toBeGreaterThan(8);
  });

  it('reflects the line in moonlight, the ink too, and veils anything else', () => {
    expect(veiledInk(t.line)).toBe(t.mirror);
    // Renderers that still pass the foreground get the same moonlight.
    expect(veiledInk(t.ink)).toBe(t.mirror);
    // Any other colour is blended toward the page, as it always was.
    expect(veiledInk(0x000000)).toBe(blend(0x000000, t.mirrorAlpha, t.paper));
  });

  it('pre-blends the mirrored markers: one opaque pass', () => {
    expect(t.veil).toBe(blend(0x9fb2ae, 0.8, t.board));
  });

  it('writes the ink as a CSS string for text styles', () => {
    expect(inkCss(0.6)).toBe('rgba(244,237,225,0.6)');
    expect(inkCss(1, t.medalText)).toBe('rgba(240,192,90,1)');
    expect(hexCss(u.sky)).toBe('#0f2830');
  });

  it('measures contrast the WCAG way', () => {
    expect(contrast(0x000000, 0xffffff)).toBeCloseTo(21, 9);
    expect(contrast(0xffffff, 0xffffff)).toBe(1);
    // Symmetric, and an alpha of 0 is the background itself.
    expect(contrast(0xffffff, 0x000000)).toBeCloseTo(21, 9);
    expect(contrast(t.ink, t.paper, 0)).toBe(1);
    // The owner's measurements: cream 13:1 on the sky, text3 4.8-5.2.
    expect(contrast(u.text, u.sky)).toBeCloseTo(13.2, 1);
    expect(contrast(u.text3, u.sky)).toBeGreaterThan(5);
  });

  it('blends a colour over another as one opaque colour', () => {
    expect(blend(0x000000, 0.5, 0xffffff)).toBe(0x808080);
    expect(blend(0x123456, 1, 0xffffff)).toBe(0x123456);
    expect(blend(0x123456, 0, 0xabcdef)).toBe(0xabcdef);
  });

  it('measures glass as smoke then cream over what is under it', () => {
    const under = u.sky;
    expect(glassOver(under)).toBe(blend(u.glass, u.glassAlpha, blend(u.smoke, u.smokeAlpha, under)));
    // Smoked: over the lamp's bright centre it is DARKER than the sky, which
    // is what keeps captions on it readable.
    expect(glassOver(u.skyGlow)).not.toBe(u.skyGlow);
  });

  it('ignores an unknown theme id rather than blanking the game', () => {
    const before = theme().id;
    setTheme('no-such-ink-pack');
    expect(theme().id).toBe(before);
  });
});

describe('design points', () => {
  it('turns the B mocks\' 402-wide points into whole base units', () => {
    expect(DP).toBeCloseTo(750 / 402, 12);
    expect(dp(46)).toBe(86);
    expect(dp(19)).toBe(35);
    expect(dp(28)).toBe(52);
    expect(dp(0)).toBe(0);
  });
});

describe('motion', () => {
  it('eases like CSS cubic-bezier, ends pinned', () => {
    const settle = cubicBezier(0.2, 0.8, 0.2, 1);
    expect(settle(0)).toBe(0);
    expect(settle(1)).toBe(1);
    // A settle is most of the way there early, and never overshoots.
    expect(settle(0.3)).toBeGreaterThan(0.7);
    let last = 0;
    for (let i = 1; i <= 100; i++) {
      const v = settle(i / 100);
      expect(v).toBeGreaterThanOrEqual(last - 1e-9);
      expect(v).toBeLessThanOrEqual(1 + 1e-9);
      last = v;
    }
    // The identity curve is the identity.
    const lin = cubicBezier(0, 0, 1, 1);
    for (const x of [0.1, 0.37, 0.8]) expect(lin(x)).toBeCloseTo(x, 5);
  });

  it('carries the SPEC §2.5 vocabulary', () => {
    expect(MOTION.settle.ms).toBeGreaterThanOrEqual(240);
    expect(MOTION.settle.ms).toBeLessThanOrEqual(320);
    expect(MOTION.breathe).toMatchObject({ period: 2400, scale: 1.06, alphaFrom: 0.6 });
    expect(MOTION.stagger).toMatchObject({ ms: 40, max: 6, rise: 12 });
  });
});

describe('type', () => {
  it('names SF and Helvetica Neue before the generic family: -apple-system alone is Times in Chrome', () => {
    expect(FONT_UI.startsWith('-apple-system')).toBe(true);
    expect(FONT_UI).toContain('"SF Pro Text"');
    expect(FONT_UI).toContain('"Helvetica Neue"');
    expect(FONT_UI.endsWith('sans-serif')).toBe(true);
    expect(FONT_DISPLAY.startsWith('Georgia')).toBe(true);
  });
});

describe('LOCKED rule 3 — hit radius against the rendered nib', () => {
  it('ships 2.6pt of collision inside a 5pt nib', () => {
    expect(METRICS.hitRadius).toBe(pt(2.6));
    expect(theme().strokePt).toBe(5);
    expect(METRICS.hitRadius).toBeLessThan(pt(theme().strokePt));
  });

  /*
   * Documenting the consequence rather than asserting an intent. Collision is
   * measured from the centreline and the nib reaches half its width, so these
   * two numbers put the kill boundary 0.2 base px OUTSIDE the visible ink —
   * marginally strict, where the spec's prose asks for marginally forgiving.
   * Change hitRadius and this number moves; it is here so the change is loud.
   */
  it('places the kill boundary 0.2 base px outside the visible ink', () => {
    const halfNib = pt(theme().strokePt) / 2;
    expect(METRICS.hitRadius - halfNib).toBeCloseTo(0.2, 12);
  });

  it('keeps collision forgiveness out of the cosmetic theme', () => {
    // hitRadius must never migrate into InkTheme: a purchasable skin that moved
    // the kill boundary would be pay-to-win.
    expect(Object.keys(theme())).not.toContain('hitRadius');
    expect(METRICS.hitRadius).toBeGreaterThan(0);
  });
});

describe('feel constants', () => {
  it('samples no more often than the hit radius', () => {
    expect(METRICS.sampleMinDist).toBe(pt(2.6));
    // A rejected sample sits within a hit radius of one already tested, which
    // is what makes dropping it safe.
    expect(METRICS.sampleMinDist).toBeLessThanOrEqual(METRICS.hitRadius);
  });

  it('lifts the touch cursor 42pt clear of the finger', () => {
    expect(METRICS.touchOffsetY).toBe(pt(42));
  });

  it('eases the touch offset in over DISTANCE, not time', () => {
    // A time-based ramp moves the cursor while the finger is still, drawing —
    // and collision-testing — ink the player never made. The unit is the point.
    expect(METRICS.touchOffsetRampPx).toBe(pt(60));
    expect(METRICS.touchOffsetRampPx).toBeGreaterThan(0);
    /*
     * LONGER than the offset itself, on purpose. It was pt(21) — full lead
     * within a thumb-width, ink at double finger speed from the first
     * millimetre — and the recurring player report was dying on the first
     * obstacle "while still starting". Paired with DrawCursor's smoothstep,
     * pt(60) finishes the lift inside the level's start runway (every level
     * keeps ≥ pt(70) of wall-free ground above the start dot), so the lead is
     * complete before the first wall can be met but never dominates takeoff.
     */
    expect(METRICS.touchOffsetRampPx).toBeLessThanOrEqual(pt(70));
  });

  it('bounds render smoothing so the drawn line cannot lie about collision', () => {
    expect(METRICS.renderMaxSpacing).toBe(pt(5));
    // Chaikin's corner cut scales with the spacing it is handed; keeping that
    // spacing near the nib keeps the bow well inside the ink.
    expect(METRICS.renderMaxSpacing).toBeLessThanOrEqual(pt(theme().strokePt));
  });

  it('grabs the start dot at 2.4x its radius', () => {
    expect(METRICS.startGrabFactor).toBe(2.4);
    expect(METRICS.startRadius * METRICS.startGrabFactor).toBe(pt(24));
  });

  it('recovers from failure in well under a second, with no tap', () => {
    expect(METRICS.failFlashMs).toBe(400);
    expect(METRICS.failFlashMs).toBeLessThan(1000);
  });

  it('settles the win figure from 0.97 over 350ms', () => {
    expect(METRICS.winSettleFrom).toBe(0.97);
    expect(METRICS.winSettleMs).toBe(350);
    expect(METRICS.winHoldMs).toBeGreaterThan(0); // "hold for a beat, then..."
  });

  it('smooths the render but leaves collision alone', () => {
    expect(METRICS.smoothIterations).toBeGreaterThan(0);
  });
});

describe('reduced motion', () => {
  it('shortens durations but never to zero, and says so', () => {
    setMotionScale(true);
    try {
      expect(motionReduced()).toBe(true);
      expect(ms(520)).toBeLessThan(100);
      // A 0ms tween skips its onComplete, which is where the effects clean up.
      expect(ms(1)).toBe(1);
    } finally {
      setMotionScale(false);
    }
    expect(motionReduced()).toBe(false);
    expect(ms(520)).toBe(520);
  });
});
