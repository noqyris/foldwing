import { describe, expect, it, vi } from 'vitest';

// PlayHud.ts builds on Phaser (and the kit), which cannot load without a
// browser. Only the pure parts are under test here; the stand-in carries the
// names those modules touch at load.
vi.mock('phaser', () => ({
  default: {
    GameObjects: { Container: class {}, Text: class {}, Events: { DESTROY: 'destroy' } },
    Scale: { Events: { RESIZE: 'resize' } },
    Scenes: { Events: { SHUTDOWN: 'shutdown' } },
  },
}));

import { tapFloor } from './HitArea';
import {
  beadsWidth,
  dailyNo,
  dailyTitle,
  deathTagText,
  fitCentred,
  fitLine,
  pickSpot,
  furthestPct,
  meterIdle,
  paintBeads,
  PLAY_HUD,
  PlayHud,
  playHudLayout,
  titleWords,
  trayWords,
} from './PlayHud';
import { bannerLine, BASE_HEIGHT, BASE_WIDTH, boardInset, dp, METRICS } from './Theme';

/**
 * The shape table (tech G6): the world's height, the canvas's base units per
 * point on the glass (750 / its width in points), and the safe insets the
 * canvas does not clear.
 */
const SHAPES: {
  name: string;
  h: number;
  perPt: number;
  safe?: { top?: number; bottom?: number; left?: number; right?: number };
}[] = [
  { name: 'iPhone SE', h: 1334, perPt: 2 },
  { name: 'iPhone SE, status bar over the canvas', h: 1334, perPt: 2, safe: { top: 40 } },
  { name: 'iPhone 17', h: 1448, perPt: 750 / 393 },
  { name: 'iPhone 18 Pro', h: 1451, perPt: 750 / 402 },
  { name: 'Pro Max', h: 1466, perPt: 750 / 440 },
  { name: '20:9 Android', h: 1535, perPt: 750 / 412 },
  { name: 'iPad Split View pane', h: 1613, perPt: 750 / 320 },
  { name: '21:9', h: 1620, perPt: 750 / 411 },
  { name: 'Slide Over', h: 1720, perPt: 750 / 320 },
  { name: 'Duo inner held wide', h: 1334, perPt: 1334 / 440 },
  { name: 'Duo outer', h: 1334, perPt: 1334 / 560, safe: { bottom: 20 } },
  { name: 'Duo landscape (lock ignored)', h: 1334, perPt: 1334 / 390, safe: { left: 30, right: 30 } },
];

const inputFor = (s: (typeof SHAPES)[number]) => ({
  tap: tapFloor(s.perPt),
  safeTop: s.safe?.top,
  safeBottom: s.safe?.bottom,
  safeLeft: s.safe?.left,
  safeRight: s.safe?.right,
});

describe('playHudLayout across the shape table', () => {
  for (const s of SHAPES) {
    for (const bannerOn of [true, false]) {
      describe(`${s.name} (H ${s.h}, banner ${bannerOn ? 'on' : 'off'})`, () => {
        const input = inputFor(s);
        const l = playHudLayout(s.h, bannerOn, input);

        it('places the board where boardDrop puts the proved playfield, untouched', () => {
          const inset = boardInset(s.h);
          expect(l.boardTop).toBe(inset.top);
          expect(l.boardBottom).toBe(s.h - inset.bottom);
          expect(l.boardBottom - l.boardTop).toBe(1102);
          expect(l.sheetTop).toBe(l.boardTop - PLAY_HUD.sheetY);
          expect(l.sheetBottom).toBe(l.boardBottom + PLAY_HUD.sheetY);
        });

        it("keeps the header's tap band inside the safe area", () => {
          expect(l.headerY - input.tap / 2).toBeGreaterThanOrEqual((s.safe?.top ?? 0) - 1e-9);
          expect(l.kickerY).toBeLessThan(l.titleY);
          expect(l.kickerY).toBeGreaterThan(0);
        });

        it('keeps the thread row near the board it belongs to', () => {
          if (l.threadOnSheet) return;
          const free = l.sheetTop - l.headerBottom;
          const over = l.sheetTop - (l.threadY + PLAY_HUD.threadH / 2);
          expect(over).toBeGreaterThanOrEqual(-1e-9);
          expect(over).toBeLessThanOrEqual(Math.max(PLAY_HUD.threadHug, (free - PLAY_HUD.threadH) / 2) + 1e-9);
        });

        it('never lets the thread row reach anything a maze draws', () => {
          expect(l.threadY + PLAY_HUD.threadH / 2).toBeLessThanOrEqual(l.ringTop - PLAY_HUD.threadGap + 1e-9);
          expect(l.threadY - PLAY_HUD.threadH / 2).toBeGreaterThan(l.headerY);
        });

        it('keeps the tray a row under the board and clear of the banner', () => {
          const t = l.tray;
          if (!t) return;
          expect(t.top).toBeGreaterThanOrEqual(l.sheetBottom);
          expect(t.bottom - t.top).toBeGreaterThanOrEqual(PLAY_HUD.trayMin);
          expect(t.y - PLAY_HUD.trayMin / 2).toBeGreaterThanOrEqual(t.top - 1e-9);
          expect(t.y + PLAY_HUD.trayMin / 2).toBeLessThanOrEqual(t.bottom + 1e-9);
          if (bannerOn) {
            expect(t.bottom).toBeLessThanOrEqual(bannerLine(s.h) - (s.safe?.bottom ?? 0) - 16);
          } else {
            expect(t.bottom).toBeLessThanOrEqual(s.h - (s.safe?.bottom ?? 0) - 16);
          }
          // It hugs the board: never further than trayReach under the sheet.
          expect(t.y - l.sheetBottom).toBeLessThanOrEqual(PLAY_HUD.trayReach + 1e-9);
        });

        it('hangs the hint over the banner line, as it always has', () => {
          expect(l.hintBottom).toBe(bannerLine(s.h) - PLAY_HUD.hintLift - (s.safe?.bottom ?? 0));
          expect(l.floorY).toBe(bannerOn ? bannerLine(s.h) - (s.safe?.bottom ?? 0) : s.h - (s.safe?.bottom ?? 0));
        });

        it('leaves the title a span around the fold between its controls', () => {
          expect(l.titleLeft).toBeLessThan(BASE_WIDTH / 2);
          expect(l.titleRight).toBeGreaterThan(BASE_WIDTH / 2);
          expect(l.backX! + PLAY_HUD.back / 2).toBeLessThanOrEqual(l.titleLeft);
          expect(l.revealX - PLAY_HUD.revealW / 2).toBeGreaterThanOrEqual(l.titleRight);
          expect(l.backX! - PLAY_HUD.back / 2).toBeGreaterThanOrEqual((s.safe?.left ?? 0) + METRICS.inset.left - 1e-9);
          expect(l.revealX + PLAY_HUD.revealW / 2).toBeLessThanOrEqual(
            BASE_WIDTH - METRICS.inset.right - (s.safe?.right ?? 0) + 1e-9
          );
        });
      });
    }
  }

  it('fits the tray on an 18 Pro with its banner, and on every taller shape', () => {
    for (const s of SHAPES.filter((x) => x.h > BASE_HEIGHT)) {
      expect(playHudLayout(s.h, true, inputFor(s)).tray, s.name).not.toBeNull();
    }
  });

  it('has no tray on a 9:16 phone with a banner (14 pt under the board), and one without', () => {
    const se = SHAPES[0];
    expect(playHudLayout(se.h, true, inputFor(se)).tray).toBeNull();
    expect(playHudLayout(se.h, false, inputFor(se)).tray).not.toBeNull();
  });

  it('puts the thread row in the paper over the sheet on an 18 Pro, and over its empty margin on the SE', () => {
    const pro = playHudLayout(1451, true, inputFor(SHAPES[3]));
    expect(pro.threadOnSheet).toBe(false);
    expect(pro.threadY + PLAY_HUD.threadH / 2).toBeLessThanOrEqual(pro.sheetTop);
    const se = playHudLayout(1334, true, inputFor(SHAPES[0]));
    expect(se.threadOnSheet).toBe(true);
    expect(se.threadY + PLAY_HUD.threadH / 2).toBeLessThanOrEqual(se.ringTop);
  });

  it('gives the 18 Pro’s meter row nearly its 8 pt of air over the board, under the painted controls', () => {
    const pro = SHAPES[3];
    const l = playHudLayout(pro.h, true, inputFor(pro));
    const vis = PLAY_HUD.star / 2;
    // What is left between the controls and the sheet goes under the row.
    expect(l.sheetTop - (l.threadY + vis)).toBeGreaterThanOrEqual(PLAY_HUD.threadAir - dp(1.5));
    expect(l.threadY - vis).toBeGreaterThanOrEqual(l.headerY + Math.max(PLAY_HUD.back, PLAY_HUD.revealH) / 2);
  });

  it('centres the title on the axis in the room the nearer control leaves, shrinking before it slides', () => {
    const f = fitCentred(400, 100, 560);
    expect(f.x).toBe(BASE_WIDTH / 2);
    expect(f.scale).toBeCloseTo((2 * (560 - 375)) / 400, 9);
    // Too long to centre at the floor scale: at the floor, slid toward the room.
    const g = fitCentred(600, 100, 560);
    expect(g.scale).toBeLessThanOrEqual(PLAY_HUD.titleMinScale);
    expect(g.x).toBeLessThan(BASE_WIDTH / 2);
  });

  it("drops the header under an inset the canvas runs under, by just enough", () => {
    const plain = playHudLayout(1334, true, { tap: 88 });
    const under = playHudLayout(1334, true, { tap: 88, safeTop: 40 });
    expect(under.headerY - under.headerBottom).toBe(plain.headerY - plain.headerBottom);
    expect(under.headerY - 44).toBe(40);
  });

  it('follows the goal ring it is given', () => {
    const l = playHudLayout(1334, true, { tap: 88, ringTop: 125 });
    expect(l.threadY + PLAY_HUD.threadH / 2).toBeLessThanOrEqual(125 - PLAY_HUD.threadGap);
  });

  it('has no back button on the web Daily, and the title may use its place', () => {
    const l = playHudLayout(1334, false, { web: true });
    expect(l.backX).toBeNull();
    expect(l.titleLeft).toBe(METRICS.inset.left + PLAY_HUD.titleGap);
  });

  it('is PlayHud.layout under the spec’s name', () => {
    expect(PlayHud.layout).toBe(playHudLayout);
  });
});

describe('pickSpot', () => {
  const bounds = { x: 0, y: 0, w: 750, h: 1400 };
  it('takes the first spot that covers nothing', () => {
    const label = { r: { x: 80, y: 180, w: 200, h: 40 }, weight: 100 };
    const spot = pickSpot([{ x: 180, y: 200 }, { x: 180, y: 300 }], 160, 50, [label], bounds);
    expect(spot).toEqual({ x: 180, y: 300 });
  });
  it('takes the least covered one when every spot covers something, weighing what matters most', () => {
    const arrow = { r: { x: 0, y: 0, w: 750, h: 260 }, weight: 100 };
    const wall = { r: { x: 0, y: 270, w: 750, h: 20 }, weight: 1 };
    const spot = pickSpot([{ x: 300, y: 240 }, { x: 300, y: 280 }], 160, 50, [arrow, wall], bounds);
    expect(spot.y).toBe(280);
  });
  it('keeps every spot inside its bounds', () => {
    const spot = pickSpot([{ x: 10, y: -40 }], 160, 50, [], bounds);
    expect(spot).toEqual({ x: 80, y: 25 });
  });
});

describe('fitLine', () => {
  it('centres a line on the fold when it fits there', () => {
    expect(fitLine(200, 100, 600)).toEqual({ x: 375, scale: 1 });
  });
  it('slides a line toward the roomier side before it shrinks it', () => {
    const f = fitLine(400, 100, 520);
    expect(f.scale).toBe(1);
    expect(f.x + 200).toBeLessThanOrEqual(520);
    expect(f.x - 200).toBeGreaterThanOrEqual(100);
  });
  it('scales a line that fits nowhere, centred in the span', () => {
    expect(fitLine(500, 100, 500)).toEqual({ x: 300, scale: 0.8 });
  });
});

describe('the words', () => {
  it('names the chapter and the fold in the kicker, and the level under it', () => {
    expect(titleWords({ levelIndex: 46, name: 'First span', daily: null })).toEqual({
      kicker: 'Chapter III · 7 of 20',
      won: false,
      number: '47',
      name: 'First span',
    });
    expect(titleWords({ levelIndex: 0, name: 'First reflection', daily: null }).kicker).toBe('Chapter I · 1 of 20');
    expect(titleWords({ levelIndex: 299, name: 'x', daily: null }).kicker).toBe('Chapter XV · 20 of 20');
  });

  it('says what a win is in the kicker: a new figure, or folded again', () => {
    expect(titleWords({ levelIndex: 5, name: 'n', daily: null, won: true, firstClear: true }).kicker).toBe(
      'Folded · new figure'
    );
    expect(titleWords({ levelIndex: 5, name: 'n', daily: null, won: true, firstClear: false }).kicker).toBe('Folded');
  });

  it('numbers the Daily as the share text does, and names its day', () => {
    expect(dailyNo('2026-08-01')).toBe(1);
    expect(dailyNo('2026-09-27')).toBe(58);
    expect(dailyTitle('2026-09-26')).toBe('Saturday’s fold');
    expect(dailyTitle('nonsense')).toBe('Daily fold');
    const w = titleWords({ levelIndex: 150, name: 'Daily fold', daily: '2026-09-27' });
    expect(w).toEqual({ kicker: 'Daily fold · No. 58', won: false, number: null, name: 'Sunday’s fold' });
  });

  it('shows what a level holds, and what the next star asks, between strokes', () => {
    expect(meterIdle({ daily: false, stars: 0, best: null })).toEqual({ stars: 0, text: 'all three at 1.10× par' });
    expect(meterIdle({ daily: false, stars: 1, best: 1.4 })).toEqual({ stars: 1, text: 'second star at 1.25× par' });
    expect(meterIdle({ daily: false, stars: 2, best: null })).toEqual({ stars: 2, text: 'third star at 1.10× par' });
    expect(meterIdle({ daily: false, stars: 3, best: 1.0432 })).toEqual({ stars: 3, text: 'best 1.04× par' });
    // The Daily keeps no stars, so the meter never shows any there.
    expect(meterIdle({ daily: true, stars: 0, best: null }).stars).toBeNull();
  });

  it('says the attempt and the best to beat in the tray', () => {
    expect(trayWords({ attempts: 3, furthest: 0.874, bestMs: null })).toEqual({ main: 'Attempt 3', aside: 'beat 87%' });
    expect(trayWords({ attempts: 2, furthest: 0.1, bestMs: 5000 })).toEqual({ main: 'Attempt 2', aside: '' });
    expect(trayWords({ attempts: 0, furthest: 0, bestMs: 7040 })).toEqual({ main: '', aside: 'best 7.0 s' });
    expect(trayWords({ attempts: 0, furthest: 0, bestMs: null })).toEqual({ main: '', aside: '' });
  });

  it('never says a death reached 100%, nor anything under 20%', () => {
    expect(furthestPct(0.999)).toBe(99);
    expect(furthestPct(0.19)).toBeNull();
    expect(furthestPct(0.2)).toBe(20);
    expect(deathTagText(87)).toBe('87% · furthest yet');
  });
});

describe('paintBeads', () => {
  function recorder() {
    const ops: string[] = [];
    let fill = '';
    let stroke = '';
    const ctx = {
      beginPath: () => undefined,
      arc: (x: number) => ops.push(`arc ${Math.round(x)}`),
      fill: () => ops.push(`fill ${fill}`),
      stroke: () => ops.push(`stroke ${stroke}`),
      set fillStyle(v: string) {
        fill = v;
      },
      set strokeStyle(v: string) {
        stroke = v;
      },
      lineWidth: 1,
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
  }

  it('paints one bead per fold, and rings the current one and the marks still ahead', () => {
    const { ctx, ops } = recorder();
    const beads = Array.from({ length: 20 }, (_, i) => (i < 6 ? 'cleared' : i === 6 ? 'current' : 'open')) as never[];
    paintBeads(ctx, beads, 0, 10, [10, 20]);
    const arcs = ops.filter((o) => o.startsWith('arc'));
    // 20 beads, a ring on the current bead and on the 10th and 20th.
    expect(arcs).toHaveLength(23);
    expect(beadsWidth(20)).toBe(PLAY_HUD.bead + 19 * PLAY_HUD.beadPitch);
  });
});
