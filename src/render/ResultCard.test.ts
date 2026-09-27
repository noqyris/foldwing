import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ResultCard draws with Phaser, which cannot load without a browser. The
// layout and the words under test touch none of it.
vi.mock('phaser', () => ({
  default: { GameObjects: { Container: class {}, Text: class {} } },
}));

import { MIN_TAP_PT, tapFloor } from './HitArea';
import {
  actionRow,
  bannerClear,
  beadCleared,
  chipLook,
  crownStars,
  foldChips,
  MIN_FRAME_SCALE,
  NEXT_CAPS_ALPHA,
  onControl,
  outwardPoint,
  RC,
  REDUCED_BEAT,
  RESULT_BEAT,
  resultCardLayout,
  resultChapter,
  resultFace,
  resultFrameScale,
  resultHead,
  resultRows,
  type ResultRows,
  resultSquares,
  resultSub,
  scaledBottom,
  starTimes,
  TOKEN_R,
  TURN_ABOVE,
  weekLetters,
  type Band,
  type ResultLayout,
  type ResultChip,
  type ResultSpec,
  type TapBand,
} from './ResultCard';
import { Playfield } from '../core/Playfield';
import { bannerLine, BASE_HEIGHT, BASE_WIDTH, blend, boardInset, contrast, dp, pt, setMotionScale, theme, ui } from './Theme';

/* ==================================================================== *
 *  The Night Fold card                                                 *
 * ==================================================================== */

/** SPEC §8's heights: the SE's 9:16, an iPhone 18 Pro-class phone, a tall narrow pane. */
const N_HEIGHTS = [BASE_HEIGHT, 1460, 1700];

/** Canvas scales (CSS px per base px): Split View pane, SE zoomed, Duo pane, the SE, the Duo inside. */
const N_SCALES = [0.317, 0.41, 0.476, 0.5, 0.626];

/** The board's pivot and bottom on a world `h` tall, and where the card may end: over the banner, or at the canvas's bottom with none. */
function nWorld(h: number): { pivotY: number; boardBottom: number; bottoms: number[] } {
  const pf = new Playfield(BASE_WIDTH, h, boardInset(h));
  return { pivotY: pf.y, boardBottom: pf.bottom, bottoms: [bannerLine(h), h] };
}

const SHAPES: Record<string, ResultRows> = {
  campaign: { crown: 'stars', chips: true, band: 'chapter', offer: false },
  'campaign, nothing arrived': { crown: 'stars', chips: false, band: 'chapter', offer: false },
  'campaign, the doubler': { crown: 'stars', chips: true, band: 'chapter', offer: true },
  daily: { crown: 'badge', chips: true, band: 'week', offer: false },
  'daily, the ask': { crown: 'badge', chips: true, band: 'week', offer: true },
  'no crown, no band': { crown: null, chips: false, band: null, offer: false },
};

const EPS = 1e-6;

/** The text rows, top to bottom. */
const texts = (L: ResultLayout): Band[] =>
  [L.verdict, L.sub, L.chips, L.band].filter((b): b is Band => b !== null);

/** The controls, top to bottom. */
const controls = (L: ResultLayout): TapBand[] => (L.offer ? [L.offer, L.actions] : [L.actions]);

describe('resultCardLayout: the Night Fold card', () => {
  for (const [name, rows] of Object.entries(SHAPES)) {
    for (const height of N_HEIGHTS) {
      it(`keeps "${name}" off the board, off the banner and tappable at every scale: ${height} tall`, () => {
        const w = nWorld(height);
        for (const scale of N_SCALES) {
          for (const bannerTop of w.bottoms) {
            const floor = tapFloor(1 / scale);
            const at = `${name} @${scale} bottom ${bannerTop}`;
            const s = resultFrameScale({ want: 0.7, pivotY: w.pivotY, boardBottom: w.boardBottom, bannerTop, floor, rows });
            const framed = scaledBottom(w.pivotY, w.boardBottom, s);
            const L = resultCardLayout({ boardBottom: framed, bannerTop, floor, rows });

            expect(s, at).toBeLessThanOrEqual(0.7);
            expect(s, at).toBeGreaterThanOrEqual(MIN_FRAME_SCALE);
            // Every card without an ask fits on every shape with the board
            // at half or more; an ask may stand over the board's foot.
            if (!rows.offer) expect(L.fits, at).toBe(true);
            if (L.fits) expect(L.crownTop, at).toBeGreaterThanOrEqual(framed + RC.above - EPS);

            // The face ends over the banner line.
            expect(L.bottom, at).toBeLessThanOrEqual(bannerTop - RC.below + EPS);

            // Every control: 44 pt to the thumb, drawn inside the card, and
            // no point of its tap area within 8 pt of the banner line.
            for (const c of controls(L)) {
              expect(c.tap, at).toBeGreaterThanOrEqual(floor);
              expect(c.tap, at).toBeGreaterThanOrEqual(c.h);
              expect(c.y + c.h / 2, at).toBeLessThanOrEqual(L.bottom + EPS);
              expect(c.y + c.tap / 2, at).toBeLessThanOrEqual(bannerTop - bannerClear(floor) + EPS);
            }
            // Two rows of controls: their tap areas never meet.
            if (L.offer) {
              expect(L.offer.y + L.offer.tap / 2, at).toBeLessThanOrEqual(L.actions.y - L.actions.tap / 2 + EPS);
            }

            // Text rows stack without touching, in order, and all of them
            // clear of the top control's tap area: a tap on words is a tap on the card.
            const t = texts(L);
            expect(t.length, at).toBe(2 + (rows.chips ? 1 : 0) + (rows.band ? 1 : 0));
            for (let i = 1; i < t.length; i++) {
              expect(t[i - 1].y + t[i - 1].h / 2, at).toBeLessThanOrEqual(t[i].y - t[i].h / 2 + EPS);
            }
            const top = controls(L)[0];
            const last = t[t.length - 1];
            expect(last.y + last.h / 2, at).toBeLessThanOrEqual(top.y - top.tap / 2 + EPS);

            // The crown stands on the verdict and overlaps the card's top edge.
            expect(L.crownTop, at).toBeLessThanOrEqual(L.top + EPS);
            expect(L.verdict.y - L.verdict.h / 2, at).toBeGreaterThanOrEqual(L.feet - EPS);
            if (rows.crown) {
              expect(L.feet, at).toBeGreaterThan(L.top);
              expect(L.crownTop, at).toBeLessThan(L.top);
            }
            expect(L.top, at).toBeLessThan(L.bottom);
          }
        }
      });
    }
  }

  it('fits the whole campaign card on the SE with a banner, the board at half or more', () => {
    // The SE: 375 pt wide, a canvas drawn at 0.5 — 2 base units to the point.
    const floor = tapFloor(2);
    expect(floor).toBe(pt(44));
    const w = nWorld(BASE_HEIGHT);
    const rows = SHAPES.campaign;
    const bannerTop = bannerLine(BASE_HEIGHT);
    const s = resultFrameScale({ want: 0.7, pivotY: w.pivotY, boardBottom: w.boardBottom, bannerTop, floor, rows });
    const L = resultCardLayout({ boardBottom: scaledBottom(w.pivotY, w.boardBottom, s), bannerTop, floor, rows });
    expect(s).toBeGreaterThanOrEqual(MIN_FRAME_SCALE);
    expect(L.fits).toBe(true);
    expect(L.actions.y + L.actions.tap / 2).toBeLessThanOrEqual(bannerTop - dp(8) + 1);
  });

  it('frames the board at exactly the configured scale where there is room, and near it on a phone', () => {
    const frame = (height: number, bannerTop: number): number => {
      const w = nWorld(height);
      return resultFrameScale({
        want: 0.7,
        pivotY: w.pivotY,
        boardBottom: w.boardBottom,
        bannerTop,
        floor: tapFloor(1 / 0.536),
        rows: SHAPES.campaign,
      });
    };
    expect(frame(1700, 1700)).toBe(0.7);
    // An 18 Pro-class phone: the mock's figure (about 0.64 of the board)
    // with no banner, and still well over half with one.
    expect(frame(1460, 1460)).toBeGreaterThan(0.64);
    expect(frame(1460, bannerLine(1460))).toBeGreaterThan(0.55);
  });

  it('lets a frame scale of 1 (or none) turn the step back off', () => {
    const w = nWorld(1460);
    const base = { pivotY: w.pivotY, boardBottom: w.boardBottom, bannerTop: bannerLine(1460), floor: pt(44), rows: SHAPES.campaign };
    expect(resultFrameScale({ ...base, want: 1 })).toBe(1);
    expect(resultFrameScale({ ...base, want: 0 })).toBe(1);
    expect(resultFrameScale({ ...base, want: Number.NaN })).toBe(1);
    // Unframed, the card stands over the board on its own face, and says so.
    const L = resultCardLayout({ boardBottom: w.boardBottom, bannerTop: base.bannerTop, floor: pt(44), rows: SHAPES.campaign });
    expect(L.fits).toBe(false);
    expect(L.bottom).toBeLessThanOrEqual(base.bannerTop - RC.below);
  });

  it('never steps the board back past half, however crowded the card', () => {
    const w = nWorld(BASE_HEIGHT);
    const s = resultFrameScale({
      want: 0.7,
      pivotY: w.pivotY,
      boardBottom: w.boardBottom,
      bannerTop: bannerLine(BASE_HEIGHT),
      floor: tapFloor(1 / 0.317),
      rows: SHAPES['daily, the ask'],
    });
    expect(s).toBe(MIN_FRAME_SCALE);
  });

  it('shares spare sky evenly, up to RC.spread a gap, anchored over the banner', () => {
    const floor = pt(44);
    const bannerTop = 1700;
    const rows = SHAPES.campaign;
    // A board reaching the banner leaves no spare: the tightest card.
    const tight = resultCardLayout({ boardBottom: bannerTop, bannerTop, floor, rows });
    const roomy = resultCardLayout({ boardBottom: 0, bannerTop, floor, rows });
    // Anchored: the same bottom and action row whatever the sky above.
    expect(roomy.bottom).toBe(tight.bottom);
    expect(roomy.actions.y).toBe(tight.actions.y);
    // Each gap grew by the same amount, at most spread; the tight one is unchanged by the board.
    const gap = (a: Band, b: Band): number => b.y - b.h / 2 - (a.y + a.h / 2);
    const grow = gap(roomy.verdict, roomy.sub) - gap(tight.verdict, tight.sub);
    expect(grow).toBeGreaterThan(0);
    expect(grow).toBeLessThanOrEqual(RC.spread + EPS);
    expect(gap(roomy.sub, roomy.chips as Band) - gap(tight.sub, tight.chips as Band)).toBeCloseTo(grow, 6);
    expect(gap(roomy.chips as Band, roomy.band as Band) - gap(tight.chips as Band, tight.band as Band)).toBeCloseTo(grow, 6);
    expect(roomy.tightTop).toBe(tight.crownTop);
    // A card with just enough sky gets exactly its tight layout.
    const exact = resultCardLayout({ boardBottom: tight.crownTop - RC.above, bannerTop, floor, rows });
    expect(exact.crownTop).toBeCloseTo(tight.crownTop, 6);
    expect(exact.fits).toBe(true);
  });

  it('lays the action row out as the mock: squares at the left, the primary filling the rest', () => {
    const cx = BASE_WIDTH / 2;
    const width = BASE_WIDTH - dp(10) * 2;
    const inner = width - RC.padX * 2;
    for (const squares of [[], ['share'], ['share', 'retry'], ['share', 'board']] as const) {
      const row = actionRow(cx, width, squares);
      expect(row.map((b) => b.key)).toEqual([...squares, 'primary']);
      for (let i = 1; i < row.length; i++) {
        expect(row[i - 1].x + row[i - 1].w / 2 + RC.gap).toBeCloseTo(row[i].x - row[i].w / 2, 6);
      }
      expect(row[0].x - row[0].w / 2).toBeCloseTo(cx - inner / 2, 6);
      const p = row[row.length - 1];
      expect(p.x + p.w / 2).toBeCloseTo(cx + inner / 2, 6);
      for (const b of row.slice(0, -1)) expect(b.w).toBe(RC.square);
    }
    // A pane too narrow for the primary: the squares give way, never the primary.
    const narrow = actionRow(cx, dp(260), ['share', 'retry']);
    const p = narrow[2];
    expect(p.w).toBeGreaterThanOrEqual(dp(150) - EPS);
    expect(narrow[0].w).toBeLessThan(RC.square);
  });

  it('keeps nothing tappable within 8 pt of the banner, in points on the glass', () => {
    // bannerClear is 8 pt at the scale the floor was read at.
    for (const scale of N_SCALES) {
      const floor = tapFloor(1 / scale);
      expect(bannerClear(floor) * scale).toBeGreaterThanOrEqual(8 - 0.01);
    }
    expect(bannerClear(pt(MIN_TAP_PT))).toBe(pt(8));
  });
});

describe('the rows a spec draws', () => {
  const base: ResultSpec = {
    stars: 2,
    ratio: 1.12,
    missing: 'third star at 1.10×',
    sub: '7.0 s · first try',
    chips: [],
    chapter: null,
    next: null,
    daily: null,
  };

  it('crowns a campaign card with stars and a Daily with its flame', () => {
    expect(resultRows(base)).toEqual({ crown: 'stars', chips: false, band: null, offer: false });
    expect(resultRows({ ...base, stars: 0 }).crown).toBeNull();
    const daily = { streak: { from: 5, to: 6 }, title: null, week: ['done'] as const, today: '2026-09-27', fresh: true, button: 'Back to today' };
    expect(resultRows({ ...base, daily, chips: [{ key: 'reveal', text: '+1 reveal' }], offer: { button: 'Remind me' } })).toEqual({
      crown: 'badge',
      chips: true,
      band: 'week',
      offer: true,
    });
  });

  it('offers Retry only while a star is missing, and never on the Daily', () => {
    expect(resultSquares(base)).toEqual(['share', 'retry']);
    expect(resultSquares({ ...base, stars: 1 })).toEqual(['share', 'retry']);
    expect(resultSquares({ ...base, stars: 3 })).toEqual(['share']);
    const daily = { streak: { from: 0, to: 1 }, title: null, week: [], today: '2026-09-27', fresh: true, button: 'Back to today' };
    expect(resultSquares({ ...base, stars: 1, daily })).toEqual(['share']);
    // The caller's word wins: the first folds have one verb, next.
    expect(resultSquares({ ...base, squares: [] })).toEqual([]);
    expect(resultSquares({ ...base, daily, squares: ['share', 'board'] })).toEqual(['share', 'board']);
  });
});

describe('the words', () => {
  it('says the verdict as every surface prints the ratio', () => {
    expect(resultHead({ ratio: 1.1234, daily: null })).toEqual({
      count: null,
      pieces: [
        { text: '1.12', big: true },
        { text: '×', big: false },
        { text: ' par', big: true },
      ],
    });
    // Two decimals of the stored three (Stars.shownRatio): what earns ★★★ reads 1.10.
    expect(resultHead({ ratio: 1.1044, daily: null }).pieces[0].text).toBe('1.10');
    expect(resultHead({ ratio: 1.105, daily: null }).pieces[0].text).toBe('1.11');
    expect(resultHead({ ratio: 0.97, daily: null }).pieces[0].text).toBe('0.97');
    expect(resultHead({ ratio: null, daily: null }).pieces).toEqual([{ text: 'Folded', big: true }]);
    expect(resultHead({ ratio: Number.NaN, daily: null }).pieces[0].text).toBe('Folded');
  });

  it('says the Daily as its run, flipping up from yesterday', () => {
    const d = { title: null, week: [], today: '2026-09-27', fresh: true, button: 'Back to today' };
    expect(resultHead({ ratio: 1.1, daily: { ...d, streak: { from: 5, to: 6 } } })).toEqual({
      count: { from: 5, to: 6 },
      pieces: [{ text: '-day streak', big: true }],
    });
    // No run before: no "0-day streak" on the way up.
    expect(resultHead({ ratio: 1.1, daily: { ...d, streak: { from: 0, to: 1 } } }).count).toEqual({ from: 1, to: 1 });
    expect(resultHead({ ratio: 1.1, daily: { ...d, streak: { from: 0, to: 0 } } }).pieces[0].text).toBe('Folded');
    expect(resultHead({ ratio: 1.1, daily: { ...d, title: 'A week of folds', streak: { from: 6, to: 7 } } })).toEqual({
      count: null,
      pieces: [{ text: 'A week of folds', big: true }],
    });
  });

  it('says what the line is short of, in gold, after the facts', () => {
    const s = { sub: '7.0 s · first try', daily: null, ratio: 1.12 };
    expect(resultSub({ ...s, stars: 2, missing: 'third star at 1.10×' })).toEqual({
      lead: '7.0 s · first try · ',
      tail: 'third star at 1.10×',
    });
    expect(resultSub({ ...s, stars: 3, missing: null })).toEqual({
      lead: '7.0 s · first try · ',
      tail: 'the best line there is',
    });
    expect(resultSub({ ...s, stars: 1, missing: 'second star at 1.25×' }).tail).toBe('second star at 1.25×');
    // No par: one star, nothing to be short of.
    expect(resultSub({ ...s, stars: 1, missing: null, ratio: null })).toEqual({ lead: '7.0 s · first try', tail: null });
    expect(resultSub({ ...s, sub: '', stars: 3, missing: null })).toEqual({ lead: '', tail: 'the best line there is' });
    const daily = { streak: { from: 1, to: 2 }, title: null, week: [], today: '2026-09-27', fresh: true, button: 'Back to today' };
    expect(resultSub({ ...s, stars: 3, missing: null, daily })).toEqual({ lead: '7.0 s · first try', tail: null });
  });

  it('shows at most three chips, folding the rest into the last', () => {
    const c = (key: string, text: string, gain?: string): ResultChip => ({ key, text, gain });
    const two = [c('reveal', '+1 reveal'), c('mission', 'mission · 2 new')];
    expect(foldChips(two).map((s) => s.chip)).toEqual(two);
    const five = [...two, c('sense', 'Fold Sense 74', '+3'), c('close', '2 close calls'), c('bookmark', '+1 bookmark')];
    const shown = foldChips(five);
    expect(shown).toHaveLength(3);
    expect(shown[0].keys).toEqual(['reveal']);
    expect(shown[2].chip.text).toBe('Fold Sense 74 +3 · 2 close calls · +1 bookmark');
    expect(shown[2].chip.tone).toBe('quiet');
    // A flight from any chip that was folded still finds where to leave from.
    expect(shown[2].keys).toEqual(['sense', 'close', 'bookmark']);
  });

  it('names the seven days under the week, oldest first', () => {
    // 2026-09-27 is a Sunday.
    expect(weekLetters('2026-09-27')).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    // Across the clock change (UTC days, so no day is lost or doubled).
    expect(weekLetters('2026-10-28')).toEqual(['T', 'F', 'S', 'S', 'M', 'T', 'W']);
    expect(weekLetters('not a day')).toHaveLength(7);
  });
});

describe('the beats', () => {
  afterEach(() => setMotionScale(false));

  it('punches the stars in at 700, 880 and 1060, one per star earned', () => {
    expect(RESULT_BEAT.stars).toEqual([700, 880, 1060]);
    expect(starTimes(3, 0, false)).toEqual([700, 880, 1060]);
    expect(starTimes(1, 0, false)).toEqual([700]);
    expect(starTimes(0, 0, false)).toEqual([]);
    // Built late: the beats keep the win's clock, and one already due fires now.
    expect(starTimes(3, 100, false)).toEqual([600, 780, 960]);
    // (ms() never returns 0: a 0 ms timer can skip its callback.)
    expect(starTimes(3, 900, false)).toEqual([1, 1, 160]);
    // The card rises before the first star lands, and the chapter after the last.
    expect(RESULT_BEAT.rise).toBeLessThan(RESULT_BEAT.stars[0]);
    expect(RESULT_BEAT.chapter).toBeGreaterThan(RESULT_BEAT.stars[2]);
  });

  it('under reduced motion, crossfades in whole and keeps the notes a haptic apart', () => {
    setMotionScale(true);
    const t = starTimes(3, 0, true);
    expect(t).toHaveLength(3);
    expect(t[1] - t[0]).toBe(REDUCED_BEAT.noteGap);
    expect(t[2] - t[1]).toBe(REDUCED_BEAT.noteGap);
    // After the crossfade, which is at most 150 ms.
    expect(REDUCED_BEAT.fade).toBeLessThanOrEqual(150);
    expect(REDUCED_BEAT.noteGap).toBeGreaterThanOrEqual(70);
  });

  it('loops nothing: no repeat: -1 anywhere in the card (tech G7)', () => {
    const src = readFileSync(new URL('./ResultCard.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/repeat:\s*-1/);
  });
});

describe('resultChapter', () => {
  const eco = { halfReward: 1, fullReward: 2 };
  const ids = (from: number, to: number): string[] => Array.from({ length: to - from + 1 }, (_, i) => `l${from + i}`);

  it('reads the chapter row from the settled save', () => {
    // Chapter III (levels 41–60): 8 cleared, the 8th just now; one at ★★★.
    const save = {
      cleared: [...ids(1, 40), ...ids(41, 48)],
      medals: ['l41', 'l43'],
      bestRatio: { l42: 1.04, l48: 1.3 },
      unlockedIndex: 48,
      chapterMarks: ['0:10', '0:20', '1:10', '1:20'],
    };
    const c = resultChapter({ save, levelIndex: 47, wasCleared: false, owner: false, crossed: [], economy: eco });
    expect(c.title).toBe('Chapter III · Hinge');
    expect(c.count).toBe(8);
    expect(c.size).toBe(20);
    expect(c.beads.slice(0, 9)).toEqual(['cleared', 'gold', 'cleared', 'cleared', 'cleared', 'cleared', 'cleared', 'cleared', 'open']);
    expect(c.here).toBe(7);
    expect(c.fresh).toBe(true);
    expect(c.mark).toBe('+1 at 10 — two to go');
    // ★★ + ★★★ + ★★ + four ★ + ★ for the 1.3 line.
    expect(c.stars).toBe('★ 12 of 60');
    expect(c.gifts).toEqual([9, 19]);
    expect(c.paysNow).toEqual([]);
    expect(c.completes).toBe(false);
    // A replay lights nothing new.
    expect(resultChapter({ save, levelIndex: 44, wasCleared: true, owner: false, crossed: [], economy: eco }).fresh).toBe(false);
  });

  it('pays the gift a win crosses, and promises the next one', () => {
    const save = {
      cleared: ids(1, 50),
      medals: [],
      unlockedIndex: 50,
      chapterMarks: ['0:10', '0:20', '1:10', '1:20', '2:10'],
    };
    const c = resultChapter({ save, levelIndex: 49, wasCleared: false, owner: false, crossed: [10], economy: eco });
    expect(c.count).toBe(10);
    expect(c.gifts).toEqual([9, 19]);
    expect(c.paysNow).toEqual([9]);
    expect(c.mark).toBe('+2 at 20 — ten to go');
    // Paid before this win: no outline.
    const later = resultChapter({ save: { ...save, cleared: ids(1, 51) }, levelIndex: 50, wasCleared: false, owner: false, crossed: [], economy: eco });
    expect(later.gifts).toEqual([19]);
    // Owners: no marks, no gifts; the stars line speaks instead.
    const own = resultChapter({ save, levelIndex: 49, wasCleared: false, owner: true, crossed: [10], economy: eco });
    expect(own.mark).toBeNull();
    expect(own.gifts).toEqual([]);
    expect(own.stars).toMatch(/^★ \d+ of 60$/);
  });

  it('knows a completed chapter', () => {
    const save = { cleared: ids(1, 20), medals: [], unlockedIndex: 20, chapterMarks: ['0:10', '0:20'] };
    const c = resultChapter({ save, levelIndex: 19, wasCleared: false, owner: false, crossed: [20], economy: eco });
    expect(c.completes).toBe(true);
    expect(c.count).toBe(20);
    expect(c.mark).toBeNull();
    expect(c.paysNow).toEqual([19]);
  });
});

describe('the card reads on its face (Night Fold contrast)', () => {
  const t = theme();
  const u = ui();
  const face = resultFace();
  const faces = [face.top, face.bottom];

  it('keeps every word at 4.5:1 on the face, top to bottom', () => {
    for (const bg of faces) {
      for (const [name, c] of Object.entries({ text: u.text, text2: u.text2, ember: t.accentText, gold: t.medalText })) {
        expect(contrast(c, bg), `${name} on ${bg.toString(16)}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps every chip word at 4.5:1 on its own wash', () => {
    for (const bg of faces) {
      for (const tone of ['accent', 'gold', 'quiet'] as const) {
        const look = chipLook(tone);
        // The wash over the face, as the one colour the eye sees.
        const under = blend(look.face, look.alpha, bg);
        expect(contrast(look.ink, under), `${tone} chip`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps the shapes that say something at 3:1: stars, beads, outlines, week dots', () => {
    for (const bg of faces) {
      expect(contrast(t.medal, bg), 'gold star / bead').toBeGreaterThanOrEqual(3);
      expect(contrast(u.text3, bg), 'an unearned star’s outline, a skipped bead').toBeGreaterThanOrEqual(3);
      expect(contrast(beadCleared(), bg), 'a cleared bead').toBeGreaterThanOrEqual(3);
      expect(contrast(t.accent, bg), 'a gift outline, the here ring').toBeGreaterThanOrEqual(3);
      expect(contrast(u.dusk, bg), 'a done day').toBeGreaterThanOrEqual(3);
    }
    // A cleared bead and a gold one differ by more than colour alone would
    // need, but the count beside them says it in words too.
    expect(contrast(u.onDusk, u.dusk), 'the check on a done day').toBeGreaterThanOrEqual(4.5);
  });

  it('reads the Next button: its caps and name at 4.5:1 on the tangerine', () => {
    for (const bg of [u.accentTop, u.accentBottom]) {
      expect(contrast(u.onAccent, bg, NEXT_CAPS_ALPHA), 'NEXT · 49').toBeGreaterThanOrEqual(4.5);
      expect(contrast(u.onAccent, bg), 'the name').toBeGreaterThanOrEqual(4.5);
    }
  });

  it('bottom-aligns the crown: the big star in the middle, the small ones tilted out', () => {
    const s = crownStars(375, 1000);
    expect(s.map((x) => x.angle)).toEqual([-8, 0, 8]);
    expect(s[1].size).toBe(RC.starBig);
    for (const x of s) expect(x.y + x.size / 2).toBe(1000);
    expect(s[0].x + s[0].size / 2).toBeLessThan(s[1].x - s[1].size / 2);
    expect(s[2].x - s[2].size / 2).toBeGreaterThan(s[1].x + s[1].size / 2);
  });
});

describe('onControl: what a win-screen tap does not advance', () => {
  // The Reveal pill and ‹ at the iPhone's header, tapped at 44pt.
  const pill = { x: 630, y: 52, w: pt(96), tap: pt(44) };
  const back = { x: 60, y: 52, w: pt(46), tap: pt(44) };

  it('carves out the controls by their tap areas, and nothing else in the header', () => {
    expect(onControl(630, 52, [pill, back])).toBe(true);
    expect(onControl(630 - pt(48) + 1, 52 + pt(22) - 1, [pill, back])).toBe(true);
    expect(onControl(60, 20, [pill, back])).toBe(true);
    // The title between them, and the paper under the pill: "anywhere".
    expect(onControl(375, 52, [pill, back])).toBe(false);
    expect(onControl(630, 52 + pt(22) + 2, [pill, back])).toBe(false);
    expect(onControl(375, 52, [])).toBe(false);
  });
});

describe('outwardPoint: reward flights beside the card\u2019s words, never across them', () => {
  const cx = BASE_WIDTH / 2;
  // The card as GameScene places it on a phone: 10 pt of sky each side.
  const width = BASE_WIDTH - dp(10) * 2;
  const inner = width - RC.padX * 2;
  /** Where the Reveal pill's eye is on a phone — at the top at every height. */
  const pill = { x: 564, y: 52 };

  for (const height of N_HEIGHTS) {
    for (const scale of [0.317, 0.52, 0.626]) {
      it(`climbs from a chip past every line above it, and turns in over the crown @${scale}, ${height} tall`, () => {
        const floor = tapFloor(1 / scale);
        const rows = SHAPES.campaign;
        const w = nWorld(height);
        const bannerTop = bannerLine(height);
        const s = resultFrameScale({ want: 0.7, pivotY: w.pivotY, boardBottom: w.boardBottom, bannerTop, floor, rows });
        const L = resultCardLayout({ boardBottom: scaledBottom(w.pivotY, w.boardBottom, s), bannerTop, floor, rows });
        const chips = L.chips as Band;
        // As WinCard.gutter and chipEnd have them.
        const gutter = Math.min(cx + width / 2 + TOKEN_R + pt(4), BASE_WIDTH - TOKEN_R);
        for (const half of [pt(40), inner / 2]) {
          const from = { x: Math.min(cx + half + pt(6) + TOKEN_R, BASE_WIDTH - TOKEN_R), y: chips.y };
          for (let k = 0; k <= 400; k++) {
            const p = k / 400;
            const at = outwardPoint(from, gutter, L.crownTop - TURN_ABOVE, pill, p);
            const r = TOKEN_R * (1 - 0.3 * p);
            const why = `chip row ${half}, p ${p}`;
            // Out along its own row, clear of its own chip.
            if (at.y === from.y) {
              expect(at.x - r, why).toBeGreaterThanOrEqual(cx + half - 1e-6);
              continue;
            }
            // Level with anything drawn above the chips — the verdict, the
            // sub-line, the crown — it is right of the card's words.
            if (at.y + r < L.crownTop || at.y - r > chips.y - chips.h / 2) continue;
            expect(at.x - r, why).toBeGreaterThanOrEqual(cx + inner / 2 - 1e-6);
          }
          expect(outwardPoint(from, gutter, L.crownTop - TURN_ABOVE, pill, 1)).toEqual(pill);
          expect(outwardPoint(from, gutter, L.crownTop - TURN_ABOVE, pill, 0)).toEqual(from);
        }
      });
    }
  }

  it('brings a bookmark in to the Daily\u2019s flame from the left, over the crown', () => {
    const floor = tapFloor(1 / 0.52);
    const rows = SHAPES.daily;
    for (const height of N_HEIGHTS) {
      const w = nWorld(height);
      const bannerTop = bannerLine(height);
      const s = resultFrameScale({ want: 0.7, pivotY: w.pivotY, boardBottom: w.boardBottom, bannerTop, floor, rows });
      const L = resultCardLayout({ boardBottom: scaledBottom(w.pivotY, w.boardBottom, s), bannerTop, floor, rows });
      const chips = L.chips as Band;
      // WinCard.headPoint: the badge's centre, standing on the crown's feet
      // at the card's top edge — so the flight turns in over the crown, as a
      // reveal's does (turnY = card.top − TURN_ABOVE), and comes down onto it.
      const flame = { x: cx, y: L.feet - RC.badge / 2 };
      const turnY = L.crownTop - TURN_ABOVE;
      const gutter = Math.max(cx - width / 2 - TOKEN_R - pt(4), TOKEN_R);
      const from = { x: Math.max(cx - pt(100) - pt(6) - TOKEN_R, TOKEN_R), y: chips.y };
      for (let k = 0; k <= 400; k++) {
        const p = k / 400;
        const at = outwardPoint(from, gutter, turnY, flame, p);
        const r = TOKEN_R * (1 - 0.3 * p);
        // Level with the verdict or the sub-line, it is left of the card's words.
        const level = at.y + r > L.verdict.y - L.verdict.h / 2 && at.y - r < L.sub.y + L.sub.h / 2;
        if (level && at.y !== from.y) expect(at.x + r, `${height} p ${p}`).toBeLessThanOrEqual(cx - inner / 2 + 1e-6);
      }
      expect(outwardPoint(from, gutter, turnY, flame, 1)).toEqual(flame);
    }
  });
});
