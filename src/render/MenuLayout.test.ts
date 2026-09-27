import { describe, expect, it } from 'vitest';
import { LEVELS } from '../data/levels';
import { tapFloor } from './HitArea';
import {
  BANNER_CLEAR_PT,
  beadPitch,
  beadSignature,
  BRAND_AIR,
  BRAND_TIERS,
  brandHeight,
  CARD_GAP,
  continueCardLayout,
  continueModel,
  CONTINUE_H,
  CONTINUE_H_SMALL,
  dailyCardLayout,
  DAILY_H,
  EDGE,
  liftedHold,
  MENU_COLUMN,
  menuFootLine,
  menuLayout,
  MORE_D,
  MORE_X,
  NO_BRAND,
  PAPER_AIR,
  SETTINGS_W,
  settingsWidth,
  markGap,
  pageToastSlot,
  pageToastY,
  sheetToastY,
  STRIP_H,
  STRIP_TOP,
  tapHeight,
  THUMB,
  THUMB_SMALL,
  TILES_H,
  TOAST_AIR,
  TOAST_GAP,
  ToastPacer,
  toastSpan,
  TOP_BAR_Y,
  TOP_CHIP_H,
  underToast,
  wordBox,
  type MenuLayout,
  type MenuShape,
} from './MenuLayout';
import { BANNER_PT } from './SafeArea';
import { bannerLine, BASE_WIDTH, dp, pt } from './Theme';

/**
 * The tall-canvas shape table (tech G6): each shape's world height and the
 * base units a point on its glass is worth — 750 over the canvas's width in
 * points, or over its height where it letterboxes sideways (the Duo, desk
 * mode). The banner is 50 pt at the bottom of the canvas: the worst case, a
 * canvas with no letterbox under it.
 */
const SHAPES: readonly { name: string; height: number; perPoint: number }[] = [
  { name: 'iPhone SE', height: 1334, perPoint: 1334 / 647 },
  { name: 'iPhone SE, Display Zoom', height: 1334, perPoint: 1334 / 548 },
  { name: 'iPhone 17', height: 1448, perPoint: 750 / 393 },
  { name: 'iPhone 16e', height: 1467, perPoint: 750 / 390 },
  { name: 'iPhone 18 Pro', height: 1451, perPoint: 750 / 402 },
  { name: 'Pro Max', height: 1466, perPoint: 750 / 440 },
  { name: '20:9 Android', height: 1535, perPoint: 750 / 360 },
  { name: '21:9', height: 1620, perPoint: 750 / 360 },
  { name: 'iPad Split View pane', height: 1613, perPoint: 750 / 320 },
  { name: 'Slide Over', height: 1720, perPoint: 750 / 320 },
  { name: 'Duo inner, held wide', height: 1334, perPoint: 1334 / 440 },
  { name: 'Duo outer', height: 1334, perPoint: 1334 / 560 },
  { name: 'Duo landscape', height: 1334, perPoint: 1334 / 390 },
];

/** Where the native banner starts on a canvas `height` tall with nothing under it. */
const bannerTopOf = (height: number, perPoint: number): number => height - BANNER_PT * perPoint;

function shapeOf(s: (typeof SHAPES)[number], banner: boolean, missions = true): MenuShape {
  return {
    height: s.height,
    footLine: menuFootLine(s.height, banner, banner ? bannerTopOf(s.height, s.perPoint) : null, s.perPoint),
    floor: tapFloor(s.perPoint),
    missions,
  };
}

/** Every band a thumb can press, top to bottom. */
function bandsOf(L: MenuLayout) {
  return [L.bands.top, ...(L.bands.strip ? [L.bands.strip] : []), L.bands.continue, L.bands.daily, L.bands.tiles];
}

/** Where the header ends: the strip's face, or the top row's. */
const headerBottom = (L: MenuLayout): number => (L.strip ? STRIP_TOP + STRIP_H : TOP_BAR_Y + TOP_CHIP_H / 2);

describe('menuLayout at every shape of the table', () => {
  for (const s of SHAPES) {
    for (const banner of [true, false]) {
      for (const missions of [true, false]) {
        const label = `${s.name}, ${banner ? 'banner' : 'no banner'}${missions ? '' : ', no missions'}`;
        const shape = shapeOf(s, banner, missions);

        it(`fits, and keeps every tap off the banner: ${label}`, () => {
          const L = menuLayout(shape);
          expect(L.fits).toBe(true);
          expect(L.bottom).toBeLessThanOrEqual(shape.footLine);
          for (const b of bandsOf(L)) expect(b.bottom).toBeLessThanOrEqual(shape.footLine);
          if (banner) {
            // Nothing tappable within 8 pt of the banner line, nor of the banner itself.
            const clear = BANNER_CLEAR_PT * s.perPoint;
            expect(L.bottom).toBeLessThanOrEqual(bannerLine(s.height) - clear + 1e-9);
            expect(L.bottom).toBeLessThanOrEqual(bannerTopOf(s.height, s.perPoint) - clear + 1e-9);
          } else {
            expect(L.bottom).toBeLessThanOrEqual(s.height - PAPER_AIR);
          }
        });

        it(`keeps every tap area to itself, top to bottom: ${label}`, () => {
          const L = menuLayout(shape);
          const bands = bandsOf(L);
          for (let i = 0; i + 1 < bands.length; i++) expect(bands[i].bottom).toBeLessThan(bands[i + 1].top);
          // The top row's area never leaves the canvas downward into the strip, nor the strip into the card.
          expect(L.bands.top.bottom).toBeLessThan(STRIP_TOP);
        });

        it(`seats the logo inside its room, with air: ${label}`, () => {
          const L = menuLayout(shape);
          const h = brandHeight(L.brand);
          if (h === 0) return;
          expect(L.brandTop).toBeGreaterThanOrEqual(headerBottom(L) + BRAND_AIR - 1e-9);
          expect(L.brandTop + h).toBeLessThanOrEqual(L.continue.y - L.continue.h / 2 - BRAND_AIR + 1e-9);
        });

        it(`taps the cards and tiles at the floor or better: ${label}`, () => {
          const L = menuLayout(shape);
          const floor = shape.floor;
          expect(L.bands.continue.bottom - L.bands.continue.top).toBeGreaterThanOrEqual(floor);
          expect(L.bands.daily.bottom - L.bands.daily.top).toBeGreaterThanOrEqual(floor);
          expect(L.bands.tiles.bottom - L.bands.tiles.top).toBeGreaterThanOrEqual(Math.min(floor, TILES_H + L.gap - 2));
        });
      }
    }
  }

  /*
   * Below a canvas scale of about 0.45 the top row and the strip are tapped
   * under 44 pt (the file header): accepted rather than let them overlap —
   * asserted, so it is a decision and not an accident.
   */
  it('taps the top row and the strip at 44 pt on every phone drawn at 0.45 or more', () => {
    for (const s of SHAPES.filter((x) => x.perPoint <= 1 / 0.45)) {
      const shape = shapeOf(s, true);
      const L = menuLayout(shape);
      expect(L.bands.top.bottom - Math.max(0, L.bands.top.top), s.name).toBeGreaterThanOrEqual(shape.floor / 2 + TOP_BAR_Y - 1);
      if (L.bands.strip) expect(L.bands.strip.bottom - L.bands.strip.top, s.name).toBeGreaterThanOrEqual(Math.min(shape.floor, STRIP_H));
    }
  });
});

describe('the mock, on an iPhone 18 Pro', () => {
  const pro = SHAPES.find((s) => s.name === 'iPhone 18 Pro')!;
  /** A mock y (pt from the top of the 874 pt screen) in base units under the 62 pt safe top. */
  const mockY = (y: number): number => (y - 62) * (750 / 402);

  it('draws the whole page with no banner: the full logo, the strip, the big thumbnail', () => {
    const L = menuLayout(shapeOf(pro, false));
    expect(L.brand).toEqual(BRAND_TIERS[0]);
    expect(L.strip).not.toBeNull();
    expect(L.compact).toBe(false);
    expect(L.thumb).toEqual(THUMB);
    expect(L.gap).toBe(CARD_GAP);
    // The cards land where the mock puts them, to a couple of points.
    const near = (base: number, y: number): void => expect(Math.abs(base - mockY(y))).toBeLessThanOrEqual(dp(3));
    near(L.tiles.y + L.tiles.h / 2, 826);
    near(L.daily.y - L.daily.h / 2, 608);
    near(L.continue.y - L.continue.h / 2, 356);
    near(STRIP_TOP, 110);
    near(TOP_BAR_Y, 81);
  });

  it('compresses the logo for the banner, and ends the tiles 8 pt over its line', () => {
    const shape = shapeOf(pro, true);
    const L = menuLayout(shape);
    expect(L.brand.markH).toBeLessThan(BRAND_TIERS[0].markH);
    expect(L.brand.wordSize).toBe(dp(38));
    expect(L.strip).not.toBeNull();
    expect(L.compact).toBe(false);
    expect(L.tiles.y + L.tiles.h / 2).toBeLessThanOrEqual(bannerLine(pro.height) - 8 * pro.perPoint);
  });
});

describe('the order things give way in', () => {
  const pro = SHAPES.find((s) => s.name === 'iPhone 18 Pro')!;
  /** The layout's place on the ladder: bigger means more has given way. */
  const rank = (L: MenuLayout): number => {
    const tier = L.brand === NO_BRAND ? BRAND_TIERS.length : BRAND_TIERS.indexOf(L.brand);
    return tier * 1 + (L.stripCollapsed ? 10 : 0) + (L.compact ? 100 : 0) + (L.gap < CARD_GAP ? 1000 : 0) + (L.brand === NO_BRAND ? 10000 : 0);
  };

  it('gives way one step at a time as the banner rises, never backwards', () => {
    const floor = tapFloor(pro.perPoint);
    let last = -1;
    const seen = new Set<string>();
    for (let line = pro.height - PAPER_AIR; line >= 900; line -= 3) {
      const L = menuLayout({ height: pro.height, footLine: line, floor, missions: true });
      const r = rank(L);
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
      seen.add(`${BRAND_TIERS.indexOf(L.brand)}|${L.stripCollapsed}|${L.compact}|${L.gap}`);
      expect(L.bottom).toBeLessThanOrEqual(line);
    }
    // Every step of the file header was taken on the way down.
    expect([...seen]).toEqual([
      `0|false|false|${CARD_GAP}`,
      `1|false|false|${CARD_GAP}`,
      `2|false|false|${CARD_GAP}`,
      `3|false|false|${CARD_GAP}`,
      `3|true|false|${CARD_GAP}`,
      `3|true|true|${CARD_GAP}`,
      `3|true|true|${dp(10)}`,
      `-1|true|true|${dp(10)}`,
    ]);
  });

  it('drops the tagline, then the mark, keeping the wordmark, on an SE with a banner', () => {
    const se = SHAPES[0];
    const L = menuLayout(shapeOf(se, true));
    expect(L.brand.tagline).toBe(false);
    expect(L.brand.wordSize).toBeGreaterThan(0);
    expect(L.strip).not.toBeNull();
  });

  it('keeps the banner clear even past the last resort', () => {
    const L = menuLayout({ height: 1334, footLine: 700, floor: tapFloor(2), missions: true });
    expect(L.fits).toBe(false);
    expect(L.bottom).toBeLessThanOrEqual(700);
  });

  it('shrinks the Continue card by the thumbnail’s 40 pt', () => {
    expect(CONTINUE_H - CONTINUE_H_SMALL).toBe(THUMB.h - THUMB_SMALL.h);
    expect(Math.abs(THUMB.h - THUMB_SMALL.h - dp(40))).toBeLessThanOrEqual(1);
  });
});

describe('menuFootLine', () => {
  it('is the paper’s bottom less the margin with no banner', () => {
    for (const h of [1334, 1451, 1720]) expect(menuFootLine(h, false)).toBe(Math.floor(h - PAPER_AIR));
  });

  it('keeps 8 pt over the banner line, or over the banner where it reaches higher', () => {
    const pp = 750 / 402;
    expect(menuFootLine(1451, true, null, pp)).toBe(Math.floor(bannerLine(1451) - 8 * pp));
    // A banner that reaches over its reserve (a canvas drawn small) moves the line up with it.
    expect(menuFootLine(1334, true, 1100, 3)).toBe(Math.floor(1100 - 24));
    // Unmeasured: 2 base units to the point.
    expect(menuFootLine(1334, true, null, Number.NaN)).toBe(Math.floor(bannerLine(1334) - 16));
  });
});

describe('the Continue card', () => {
  it('lays its parts out inside the card, the button across the foot', () => {
    for (const compact of [false, true]) {
      const h = compact ? CONTINUE_H_SMALL : CONTINUE_H;
      const C = continueCardLayout(MENU_COLUMN, h, compact);
      expect(C.thumb.y + C.thumb.h).toBeLessThan(C.ctaY - C.ctaH / 2);
      expect(C.infoX + C.infoW).toBe(MENU_COLUMN - C.pad);
      // The last line of the text column clears the button.
      const lastText = (C.pillY ?? C.metaY) + dp(12);
      expect(lastText).toBeLessThan(C.ctaY - C.ctaH / 2);
      expect(C.ctaY + C.ctaH / 2).toBe(h - C.pad);
      expect(C.ctaW).toBe(MENU_COLUMN - 2 * C.pad);
    }
    expect(continueCardLayout(MENU_COLUMN, CONTINUE_H_SMALL, true).pillY).toBeNull();
  });

  it('fits twenty beads across the text column', () => {
    const C = continueCardLayout(MENU_COLUMN, CONTINUE_H, false);
    const b = beadPitch(C.infoW);
    expect(b.pitch * 19 + b.width).toBeCloseTo(C.infoW, 6);
    expect(b.width).toBeGreaterThan(dp(6));
    expect(beadSignature(['gold', 'cleared', 'current', 'skipped', 'open'])).toBe('gcnso');
  });

  const save = (p: Partial<Parameters<typeof continueModel>[0]> = {}) => ({
    cleared: [] as string[],
    medals: [] as string[],
    bestRatio: {} as Record<string, number>,
    unlockedIndex: 0,
    totalWins: 0,
    ...p,
  });
  const flags = { allCleared: false, firstSession: false, owner: false };

  it('says the frontier: its chapter, number, name, beads and stars to earn', () => {
    const cleared = LEVELS.slice(40, 47).map((l) => l.id);
    const m = continueModel(save({ cleared, unlockedIndex: 47, totalWins: 47, bestRatio: { [cleared[0]]: 1.05 } }), flags);
    expect(m.index).toBe(47);
    expect(m.caps).toBe('Chapter III · Hinge');
    expect(m.number).toBe('48');
    expect(m.name).toBe(LEVELS[47].name);
    expect(m.beads).toHaveLength(20);
    expect(m.beads[7]).toBe('current');
    expect(m.beads[0]).toBe('gold');
    expect(m.beads.slice(1, 7).every((b) => b === 'cleared')).toBe(true);
    expect(m.count).toBe('7 of 20');
    expect(m.stars).toBe('9/60');
    expect(m.mark).toBe('+1 at 10');
    expect(m.pill).toEqual({ earned: 0, text: '3 to earn' });
    expect(m.cta).toBe('Continue');
  });

  it('names the next star for a level already cleared, and the best line at three', () => {
    const id = LEVELS[12].id;
    const two = continueModel(save({ cleared: [id], medals: [id], unlockedIndex: 12, totalWins: 12 }), flags);
    expect(two.pill).toEqual({ earned: 2, text: 'third star at 1.10×' });
    const three = continueModel(save({ cleared: [id], bestRatio: { [id]: 1.02 }, unlockedIndex: 12, totalWins: 12 }), flags);
    expect(three.pill).toEqual({ earned: 3, text: 'the best line there is' });
  });

  it('says Play to a player who has never won, and hides the economy in the first session and from owners', () => {
    expect(continueModel(save(), { ...flags, firstSession: true })).toMatchObject({ cta: 'Play', mark: null, number: '1' });
    expect(continueModel(save({ unlockedIndex: 5, totalWins: 5 }), { ...flags, owner: true }).mark).toBeNull();
    // Past both marks there is nothing ahead to promise.
    const all = LEVELS.slice(0, 20).map((l) => l.id);
    expect(continueModel(save({ cleared: all, unlockedIndex: 20, totalWins: 20 }), flags).index).toBe(20);
    expect(continueModel(save({ cleared: all.slice(0, 19), unlockedIndex: 19, totalWins: 19 }), flags).mark).toBe('+2 at 20');
  });

  it('offers a replay once all are folded, on the last level, with no current bead', () => {
    const m = continueModel(save({ cleared: LEVELS.map((l) => l.id), unlockedIndex: LEVELS.length - 1, totalWins: 400 }), {
      ...flags,
      allCleared: true,
    });
    expect(m.index).toBe(LEVELS.length - 1);
    expect(m.cta).toBe('Replay a fold');
    expect(m.beads).not.toContain('current');
    expect(m.mark).toBeNull();
  });

  it('clamps a hostile frontier onto the ladder', () => {
    expect(continueModel(save({ unlockedIndex: 9999 }), flags).index).toBe(LEVELS.length - 1);
    expect(continueModel(save({ unlockedIndex: -3 }), flags).index).toBe(0);
  });
});

describe('the Daily card', () => {
  it('keeps the week and the sub-line on the left of the streak and the pill', () => {
    for (const bare of [false, true]) {
      const D = dailyCardLayout(MENU_COLUMN, DAILY_H, bare);
      const lastDot = D.weekX + 6 * D.dotPitch + D.dot / 2;
      expect(lastDot).toBeLessThanOrEqual(D.leftEnd);
      expect(D.subY).toBeLessThan(DAILY_H - D.pad / 2);
      expect(D.pillY + D.pillH / 2).toBe(DAILY_H - D.pad);
      expect(D.streakCapsY).toBeLessThan(D.pillY - D.pillH / 2);
    }
  });
});

describe('the top row', () => {
  it('sets the chips and ••• on the 16 pt margins', () => {
    expect(EDGE).toBe(dp(16));
    expect(MORE_X + MORE_D / 2).toBe(BASE_WIDTH - EDGE);
    expect(MENU_COLUMN).toBe(BASE_WIDTH - 2 * EDGE);
    expect(tapHeight(TOP_CHIP_H, 200, 96)).toBe(96);
    expect(tapHeight(TOP_CHIP_H, 10, 96)).toBe(TOP_CHIP_H);
  });
});

/** UI.TOAST_MAX_H, the tallest toast (two lines); passed in, so this file stays free of Phaser. */
const TOAST_MAX_H = pt(50);
/** StoreSheet.SHEET_TOP_LIMIT: no sheet's card starts higher. */
const SHEET_TOP = pt(44);
/** Every sheet's card keeps this much paper above its title (PAD_TOP). */
const CARD_PAD_TOP = pt(18);

/*
 * QA round 1 (SET-2): a toast raised from a sheet sat on the sheet's heading at
 * a phone's size, and on its first row in the Split View pane.
 */
describe('sheetToastY', () => {
  const barBottom = TOP_BAR_Y + TOP_CHIP_H / 2;

  it('centres the toast between the top row and the card when two lines fit there', () => {
    const cardTop = 280;
    const y = sheetToastY(cardTop, TOAST_MAX_H);
    expect(y - TOAST_MAX_H / 2).toBeGreaterThanOrEqual(barBottom + TOAST_AIR);
    expect(y + TOAST_MAX_H / 2).toBeLessThanOrEqual(cardTop - TOAST_AIR);
    expect(y).toBe((barBottom + TOAST_AIR + cardTop - TOAST_AIR) / 2);
  });

  it('hangs it from the top of the paper when the card leaves no room, clear of the title', () => {
    for (const h of [pt(34), TOAST_MAX_H]) {
      for (let cardTop = SHEET_TOP; cardTop <= 400; cardTop += 4) {
        const y = sheetToastY(cardTop, h);
        expect(y - h / 2).toBeGreaterThanOrEqual(0);
        expect(y + h / 2).toBeLessThanOrEqual(cardTop + CARD_PAD_TOP);
      }
    }
  });
});

describe('pageToastY', () => {
  it('puts a page toast over the Continue card, clear of the mark and the header, at every shape', () => {
    for (const s of SHAPES) {
      for (const banner of [true, false]) {
        const L = menuLayout(shapeOf(s, banner));
        for (const h of [pt(34), TOAST_MAX_H]) {
          const y = pageToastY(L, h);
          const at = `${s.name} ${banner} ${h}`;
          expect(y - h / 2, at).toBeGreaterThanOrEqual(headerBottom(L) + TOAST_AIR - 1e-9);
          // Never on the mark: below its foot wherever the room allows it.
          const markFoot = L.brandTop + L.brand.markH;
          const contTop = L.continue.y - L.continue.h / 2;
          if (L.brand.markH > 0 && contTop - markFoot >= h + 2 * TOAST_AIR) {
            expect(y - h / 2, at).toBeGreaterThanOrEqual(markFoot);
          }
          // Never on the card.
          expect(y + h / 2, at).toBeLessThanOrEqual(Math.max(contTop - TOAST_AIR, headerBottom(L) + TOAST_AIR + h) + 1e-9);
          // Over the wordmark only where it takes the word's place.
          const slot = pageToastSlot(L, h);
          if (!slot.coversWord && L.brand.wordSize > 0) {
            const wordFoot = L.brandTop + (L.brand.markH > 0 ? L.brand.markH + markGap(L.brand) : 0) + wordBox(L.brand);
            expect(y - h / 2, at).toBeGreaterThanOrEqual(wordFoot - 1e-9);
          }
        }
      }
    }
  });
});

describe('sheetToastY, with no paper over the card', () => {
  it('goes under the card where there is room, not onto the top row', () => {
    const y = sheetToastY(SHEET_TOP, pt(34), { cardBottom: 900, floor: 1200 });
    expect(y - pt(34) / 2).toBeGreaterThanOrEqual(900 + TOAST_AIR);
  });
});

describe('underToast', () => {
  it('launches tokens just under the pill, at the end nearer their chip, never over its words', () => {
    for (const pill of [
      { w: 400, h: pt(34), y: 140 },
      { w: 620, h: pt(50), y: 200 },
    ]) {
      const right = underToast(pill, 'right');
      expect(right.y).toBeGreaterThan(pill.y + pill.h / 2);
      expect(right.x).toBeLessThanOrEqual(BASE_WIDTH / 2 + pill.w / 2);
      expect(right.x).toBeGreaterThan(BASE_WIDTH / 2 + pill.w / 4);
      const left = underToast(pill, 'left');
      expect(left.y).toBe(right.y);
      expect(left.x).toBe(BASE_WIDTH - right.x);
    }
  });
});

describe('ToastPacer', () => {
  /** First in, first out: the pacer's own contract, without the kit's tone rules. */
  class Fifo<T> {
    private items: T[] = [];
    push(t: T): void {
      this.items.push(t);
    }
    next(): T | null {
      return this.items.shift() ?? null;
    }
    get size(): number {
      return this.items.length;
    }
    clear(): void {
      this.items.length = 0;
    }
  }
  interface T {
    text: string;
    urgent?: boolean;
    opts: { holdMs?: number };
  }
  const say = (text: string, urgent = false, holdMs?: number): T => ({ text, urgent, opts: { holdMs } });
  const SPAN = toastSpan(undefined, false) + TOAST_GAP;

  it('spans the kit’s rise, hold and fade, and the hurry before an urgent one', () => {
    expect(toastSpan(undefined, false)).toBe(220 + 2600 + 220);
    expect(toastSpan(1000, true)).toBe(120 + 220 + 1000 + 220);
  });

  it('shows the first toast now and holds the next until the first is gone', () => {
    const p = new ToastPacer<T>(new Fifo());
    expect(p.say(say('a'), 0)?.text).toBe('a');
    expect(p.say(say('b'), 500)).toBeNull();
    expect(p.due).toBe(SPAN);
    expect(p.next(SPAN - 1)).toBeNull();
    expect(p.onScreen(SPAN - 1)?.toast.text).toBe('a');
    expect(p.next(SPAN)?.text).toBe('b');
    expect(p.due).toBeNull();
  });

  it('times a toast from when it shows, not from when it was said', () => {
    const p = new ToastPacer<T>(new Fifo());
    p.say(say('a'), 0);
    p.say(say('b'), 100);
    const shownAt = SPAN + 30;
    p.next(shownAt);
    expect(p.onScreen(shownAt)).toEqual({ toast: expect.objectContaining({ text: 'b' }), until: shownAt + SPAN });
  });

  it('shows an urgent toast at once, over the one up, and the waiting resume after it', () => {
    const p = new ToastPacer<T>(new Fifo());
    p.say(say('a'), 0);
    p.say(say('b'), 10);
    expect(p.say(say('answer', true), 1000)?.text).toBe('answer');
    const until = 1000 + toastSpan(undefined, true) + TOAST_GAP;
    expect(p.onScreen(1000)?.until).toBe(until);
    expect(p.due).toBe(until);
    expect(p.next(until)?.text).toBe('b');
  });

  it('lifts the toast on screen to end when it would have, dropping nothing waiting', () => {
    const p = new ToastPacer<T>(new Fifo());
    p.say(say('arrival'), 0);
    p.say(say('waiting'), 200);
    const now = 900;
    const up = p.onScreen(now)!;
    const holdMs = liftedHold(up.until, now);
    expect(holdMs).toBeGreaterThan(400);
    expect(p.say({ ...up.toast, urgent: true, opts: { holdMs } }, now)?.text).toBe('arrival');
    expect(p.onScreen(now)?.until).toBe(up.until);
    expect(p.next(up.until)?.text).toBe('waiting');
  });

  it('forgets everything on clear', () => {
    const p = new ToastPacer<T>(new Fifo());
    p.say(say('a'), 0);
    p.say(say('b'), 0);
    p.clear();
    expect(p.onScreen(0)).toBeNull();
    expect(p.due).toBeNull();
    expect(p.say(say('c'), 1)?.text).toBe('c');
  });
});

describe('settingsWidth', () => {
  it('is the sheets’ pt(300) when every row fits, else the column', () => {
    expect(SETTINGS_W).toBe(pt(300));
    expect(settingsWidth([pt(200), pt(300)], 638)).toBe(pt(300));
    expect(settingsWidth([pt(200), pt(300) + 1], 638)).toBe(638);
  });
});
