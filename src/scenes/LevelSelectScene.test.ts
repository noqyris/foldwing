/*
 * The Levels journey's decisions: the page's layout at every shape and its
 * air above the banner, the serpentine and its gifts, what each node shows,
 * how much path is lit, the chapter's reward marks, the kit's packing and a
 * figure fitted to its disc. The page itself is Phaser and is checked in the
 * browser (scratchpad/qa/wpl-*.mjs).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// The scene module draws with Phaser, which cannot load without a browser;
// nothing under test here reaches it or the systems below.
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../render/UI', () => ({ TYPE: { caps: 20, label: 25 } }));
vi.mock('../render/ScrollView', () => ({ ScrollView: class {} }));
vi.mock('../systems/Ads', () => ({ Ads: {} }));
vi.mock('../systems/Haptics', () => ({ Haptics: {} }));
vi.mock('../systems/Progress', () => ({ Progress: {} }));

import { monetization } from '../config/monetization';
import type { ChapterTile } from '../core/Chapters';
import { mirrorPath } from '../core/Geometry';
import { Playfield } from '../core/Playfield';
import { CHAPTER_COUNT } from '../core/Rewards';
import { CHAPTER_SIZE, LEVELS } from '../data/levels';
import { bannerLine, BASE_HEIGHT, BASE_WIDTH, dp, MAX_HEIGHT, METRICS, pt } from '../render/Theme';
import {
  bannerAir,
  chapterMarker,
  chapterRewards,
  discArt,
  journeyLayout,
  latestFigures,
  legBox,
  legShape,
  levelsLayout,
  LV,
  nodeKey,
  nodeKind,
  openOffset,
  packKit,
  rewardParts,
  solidLegs,
  stripWidth,
  tileLabel,
  windowBottom,
  type NodeSpec,
} from './LevelSelectScene';

const none = new Set<string>();

/*
 * The shape table (tech G6), as world heights and base units per point: the
 * SE, the 17, the 18 Pro, the Pro Max, 20:9, 21:9, the Split View pane (the
 * narrowest glass, 320 pt), and the capped sliver.
 */
const SHAPES = [
  { name: 'SE', h: BASE_HEIGHT, bpp: 2.06 },
  { name: '17', h: 1448, bpp: 750 / 393 },
  { name: '18 Pro', h: 1451, bpp: 750 / 402 },
  { name: 'Pro Max', h: 1466, bpp: 750 / 440 },
  { name: '20:9', h: 1535, bpp: 750 / 412 },
  { name: '21:9', h: 1620, bpp: 750 / 412 },
  { name: 'Split View', h: 1613, bpp: 750 / 320 },
  { name: 'Slide Over', h: MAX_HEIGHT, bpp: 750 / 320 },
];

describe('the page at every shape', () => {
  it('keeps everything above the journey fixed under the safe top, and the window under the card', () => {
    for (const s of SHAPES) {
      const L = levelsLayout(s.h, false, s.bpp);
      expect(L.top).toBe(LV.cardTop + LV.cardH + LV.windowGap);
      expect(L.card.y + L.card.h / 2).toBeLessThan(L.top);
      expect(LV.stripBottom).toBeLessThanOrEqual(LV.cardTop);
      // The window is the one flexible gap: it runs to the canvas edge with no banner.
      expect(L.bottom).toBe(s.h);
    }
  });

  it('shows at least two rows of the journey on the shortest world with a banner', () => {
    const se = levelsLayout(BASE_HEIGHT, true, 2.06);
    expect(se.bottom - se.top).toBeGreaterThan(LV.rowPitch * 2);
  });

  it('never lets a press land within 8 pt of the banner line, on the glass, at any shape', () => {
    for (const s of SHAPES) {
      const L = levelsLayout(s.h, true, s.bpp);
      const air = (bannerLine(s.h) - L.bottom) / s.bpp;
      expect(air, s.name).toBeGreaterThanOrEqual(8);
      expect(windowBottom(s.h, true, s.bpp)).toBe(L.bottom);
    }
  });

  it('measures the banner air in points on the glass, never less than pt(8)', () => {
    expect(bannerAir(2)).toBe(pt(8));
    expect(bannerAir(1.5)).toBe(pt(8));
    // The 320 pt Split View pane draws the canvas small: 8 pt is more base units there.
    expect(bannerAir(750 / 320)).toBe(Math.ceil((8 * 750) / 320));
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(bannerAir(bad)).toBe(pt(8));
  });

  it('lays the strip out as one bake, all fifteen tiles', () => {
    expect(stripWidth(CHAPTER_COUNT)).toBe(LV.tileFirst * 2 + (CHAPTER_COUNT - 1) * LV.tilePitch);
    // Under the older iPhones' 4096 px texture limit.
    expect(stripWidth(CHAPTER_COUNT)).toBeLessThan(4096);
  });
});

describe('the journey', () => {
  const J = journeyLayout(CHAPTER_SIZE);

  it('strings twenty folds three to a row, turning at the ends', () => {
    expect(J.nodes).toHaveLength(20);
    const rows = [0, 1, 2].map((r) => J.nodes.filter((n) => n.row === r).map((n) => n.col));
    expect(rows).toEqual([
      [0, 1, 2],
      [2, 1, 0],
      [0, 1, 2],
    ]);
    J.nodes.forEach((n) => {
      expect(n.x).toBe(LV.cols[n.col]);
      expect(n.y).toBe(LV.firstRow + n.row * LV.rowPitch);
    });
  });

  it('keeps every node on the canvas, the turns included', () => {
    for (const n of J.nodes) {
      expect(n.x - LV.currentD / 2).toBeGreaterThanOrEqual(0);
      expect(n.x + LV.currentD / 2).toBeLessThanOrEqual(BASE_WIDTH);
    }
    for (const leg of J.legs) {
      if (leg.turn === 0) continue;
      const far = leg.from.x + leg.turn * LV.turnOut;
      expect(far).toBeGreaterThan(0);
      expect(far).toBeLessThan(BASE_WIDTH);
    }
  });

  it('puts the halfway gift on the straight between folds 10 and 11, and the full one after 20', () => {
    expect(J.gifts).toHaveLength(2);
    const [half, full] = J.gifts;
    const a = J.nodes[9];
    const b = J.nodes[10];
    expect(a.row).toBe(b.row);
    expect(half).toMatchObject({ x: (a.x + b.x) / 2, y: a.y, marks: [10] });
    // It fits between the two discs it sits between.
    expect(Math.abs(a.x - b.x) - LV.nodeD).toBeGreaterThanOrEqual(LV.giftD - 2);
    expect(full.marks).toEqual([20]);
    expect(full.y).toBeGreaterThanOrEqual(J.nodes[19].y);
  });

  it('runs a leg from every fold to the next, and on to the end gift', () => {
    expect(J.legs).toHaveLength(20);
    J.legs.forEach((leg, i) => {
      expect(leg.from).toMatchObject({ x: J.nodes[i].x, y: J.nodes[i].y });
      const to = i < 19 ? J.nodes[i + 1] : J.gifts[1];
      expect(leg.to).toMatchObject({ x: to.x, y: to.y });
      // A straight stays on its row; a turn drops one row at its column.
      if (leg.turn === 0) expect(leg.from.y).toBe(leg.to.y);
      else {
        expect(leg.to.y - leg.from.y).toBe(LV.rowPitch);
        expect(leg.to.x).toBe(leg.from.x);
        expect(leg.turn).toBe(leg.from.x > BASE_WIDTH / 2 ? 1 : -1);
      }
    });
  });

  it('draws every leg with one of the kit shapes, moved', () => {
    for (const leg of J.legs) {
      const box = legBox(legShape(leg));
      if (leg.turn === 0) {
        expect(Math.abs(leg.to.x - leg.from.x)).toBe(box.leg.to.x - box.leg.from.x);
      } else {
        expect(leg.to.y - leg.from.y).toBe(box.leg.to.y - box.leg.from.y);
      }
    }
    // The turn's bake holds its whole half circle.
    const right = legBox('right');
    expect(right.x + right.w).toBeGreaterThanOrEqual(LV.turnOut);
  });

  it('leaves the gifts out for an owner of Remove Ads, and ends the path at the last fold', () => {
    const owner = journeyLayout(CHAPTER_SIZE, false);
    expect(owner.gifts).toHaveLength(0);
    expect(owner.legs).toHaveLength(19);
    expect(owner.contentHeight).toBeLessThanOrEqual(J.contentHeight);
  });

  it('pays a short chapter both marks at its end, from one gift', () => {
    const short = journeyLayout(8);
    expect(short.nodes).toHaveLength(8);
    expect(short.gifts).toEqual([expect.objectContaining({ marks: [10, 20] })]);
  });

  it('is tall enough for the last row and its label', () => {
    const last = J.gifts[1].y;
    expect(J.contentHeight).toBeGreaterThanOrEqual(last + LV.nodeD / 2 + dp(40));
  });
});

describe('what a node shows', () => {
  it('lights the frontier, shows made folds, opens skips and locks the rest', () => {
    expect(nodeKind(47, false, 47, 47)).toBe('current');
    expect(nodeKind(46, true, 47, 47)).toBe('cleared');
    expect(nodeKind(30, false, 47, 47)).toBe('open');
    expect(nodeKind(48, false, 47, 47)).toBe('locked');
    // With every fold made, the frontier is a made fold: no Play on it.
    expect(nodeKind(299, true, 300, 299)).toBe('cleared');
  });

  it('keys a bake by everything it shows', () => {
    const level = LEVELS[40];
    const base: NodeSpec = { kind: 'cleared', number: 41, stars: 2, level };
    const fig = { levelId: level.id, levelName: level.name, points: [], times: [], ms: 1, at: 5 };
    const keys = new Set([
      nodeKey(base),
      nodeKey({ ...base, stars: 3 }),
      nodeKey({ ...base, figure: fig }),
      nodeKey({ ...base, figure: { ...fig, at: 6 } }),
      nodeKey({ ...base, kind: 'open', stars: 0 }),
      nodeKey({ ...base, kind: 'current', stars: 0 }),
      nodeKey({ ...base, kind: 'locked', stars: 0 }),
    ]);
    expect(keys.size).toBe(7);
    // A figure means nothing to a node that does not show one.
    expect(nodeKey({ ...base, kind: 'locked', stars: 0, figure: fig })).toBe(nodeKey({ ...base, kind: 'locked', stars: 0 }));
  });

  it('shows the latest figure the gallery keeps for a fold', () => {
    const f = (levelId: string, at: number) => ({ levelId, levelName: '', points: [], times: [], ms: 1, at });
    const got = latestFigures([f('l1', 5), f('l2', 3), f('l1', 9), f('l1', 7)]);
    expect(got.get('l1')?.at).toBe(9);
    expect(got.get('l2')?.at).toBe(3);
    expect(got.has('l3')).toBe(false);
  });

  it('fits a figure inside its disc, the reflection mirrored at the fold', () => {
    const pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset);
    const pts = [
      { x: 0.1, y: 0.9 },
      { x: 0.3, y: 0.6 },
      { x: 0.2, y: 0.3 },
      { x: 0.45, y: 0.1 },
    ];
    const box = { x: 10, y: 20, w: 60, h: 70 };
    const art = discArt({ points: pts }, box);
    expect(art).not.toBeNull();
    for (const p of [...art!.line, ...art!.mirror]) {
      expect(p.x).toBeGreaterThanOrEqual(box.x - 1e-6);
      expect(p.x).toBeLessThanOrEqual(box.x + box.w + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(box.y - 1e-6);
      expect(p.y).toBeLessThanOrEqual(box.y + box.h + 1e-6);
    }
    // Mirrored about the placed axis, point for point.
    const axis = art!.axis!.x;
    expect(art!.mirror.map((p) => Math.round(p.x * 1e6) / 1e6)).toEqual(
      mirrorPath(art!.line, axis).map((p) => Math.round(p.x * 1e6) / 1e6)
    );
    // The raw samples map through the reference playfield, like a win does.
    expect(pf.axisX).toBeGreaterThan(0);
    expect(discArt({ points: [pts[0]] }, box)).toBeNull();
  });
});

describe('the path through a chapter', () => {
  it('is lit up to the fold being played, and dotted beyond', () => {
    expect(solidLegs(40, 20, 20, 47, false)).toBe(7);
    expect(solidLegs(40, 20, 20, 40, false)).toBe(0);
  });

  it('is lit to its end once the frontier has moved past it, dotted all through before it', () => {
    expect(solidLegs(0, 20, 20, 47, false)).toBe(20);
    expect(solidLegs(60, 20, 20, 47, false)).toBe(0);
    expect(solidLegs(280, 20, 20, 299, true)).toBe(20);
  });
});

describe('opening on the fold to play', () => {
  it('stays at the top when the fold and its Play fit, and never scrolls past the end', () => {
    expect(openOffset(LV.firstRow + 2 * LV.rowPitch, 930, 800)).toBe(0);
    expect(openOffset(LV.firstRow + 6 * LV.rowPitch, 700, 200)).toBe(200);
  });

  it('otherwise shows the fold whole, Play and all, above the window bottom', () => {
    const at = LV.firstRow + 4 * LV.rowPitch;
    const windowH = 800;
    const off = openOffset(at, windowH, 5000);
    expect(at - off + LV.currentD / 2 + dp(40)).toBeLessThanOrEqual(windowH);
    // And no further: the way behind it stays in view.
    expect(at - off).toBeGreaterThan(windowH / 2);
  });
});

describe('chapter rewards', () => {
  it('lists both marks with what they pay and whether they are paid', () => {
    const { halfReward, fullReward } = monetization.economy.chapter;
    expect(chapterRewards(2, 20, new Set(['2:10']), false)).toEqual([
      { at: 10, reward: halfReward, paid: true, fold: 10 },
      { at: 20, reward: fullReward, paid: false, fold: 20 },
    ]);
    expect(chapterRewards(2, 20, none, true)).toEqual([]);
  });

  it('shows a reached chapter its stars and its reveals, and one not reached what opens it', () => {
    const facts = { chapter: 2, cleared: 7, size: 20, stars: 17, max: 60, three: 3 };
    const open = rewardParts({ ...facts, opensAfter: null, rewards: chapterRewards(2, 20, new Set(['2:10']), false) });
    expect(open.map((p) => p.text)).toEqual(['17 of 60', `+${monetization.economy.chapter.halfReward} at 10`, `+${monetization.economy.chapter.fullReward} at 20`]);
    expect(open.map((p) => p.icon)).toEqual(['star', 'check', 'eye']);
    const locked = rewardParts({ ...facts, opensAfter: 60, rewards: [] });
    expect(locked).toEqual([expect.objectContaining({ icon: 'lock', text: 'Opens after fold 60' })]);
  });

  it('labels a strip tile with its count, or where a chapter not reached begins', () => {
    const tile = (status: ChapterTile['status']): ChapterTile => ({
      chapter: 3,
      status,
      cleared: 7,
      size: 20,
      stars: 17,
      max: 60,
      three: 3,
      gilt: false,
      first: 61,
    });
    expect(tileLabel(tile('current'))).toBe('7/20');
    expect(tileLabel(tile('done'))).toBe('7/20');
    expect(tileLabel(tile('locked'))).toBe('61+');
  });
});

describe('chapterMarker — the next unpaid mark', () => {
  it('advertises "+1 at 10" on every chapter of a fresh save, the ones ahead included', () => {
    for (let c = 0; c < CHAPTER_COUNT; c++) expect(chapterMarker(c, 20, none, false)).toBe('+1 at 10');
  });

  it('moves on to "+2 at 20" once the halfway mark is paid', () => {
    expect(chapterMarker(2, 20, new Set(['2:10']), false)).toBe('+2 at 20');
  });

  it('shows nothing once both marks are paid', () => {
    expect(chapterMarker(2, 20, new Set(['2:10', '2:20']), false)).toBeNull();
  });

  it('reads only its own chapter’s marks', () => {
    const paid = new Set(['0:10', '0:20', '1:10']);
    expect(chapterMarker(0, 20, paid, false)).toBeNull();
    expect(chapterMarker(1, 20, paid, false)).toBe('+2 at 20');
    expect(chapterMarker(2, 20, paid, false)).toBe('+1 at 10');
    // "12:10" is not "2:10".
    expect(chapterMarker(2, 20, new Set(['12:10']), false)).toBe('+1 at 10');
  });

  it('still names an unpaid halfway mark when only the full one is recorded', () => {
    expect(chapterMarker(4, 20, new Set(['4:20']), false)).toBe('+1 at 10');
  });

  it('never shows to an owner of Remove Ads, paid or not', () => {
    expect(chapterMarker(0, 20, none, true)).toBeNull();
    expect(chapterMarker(0, 20, new Set(['0:10']), true)).toBeNull();
    expect(chapterMarker(0, 20, new Set(['0:10', '0:20']), true)).toBeNull();
  });

  it('pays the configured rewards, and defaults to the economy’s', () => {
    const { halfReward, fullReward } = monetization.economy.chapter;
    expect(chapterMarker(0, 20, none, false)).toBe(`+${halfReward} at 10`);
    expect(chapterMarker(0, 20, new Set(['0:10']), false)).toBe(`+${fullReward} at 20`);
    const cfg = { halfReward: 3, fullReward: 5 };
    expect(chapterMarker(0, 20, none, false, cfg)).toBe('+3 at 10');
    expect(chapterMarker(0, 20, new Set(['0:10']), false, cfg)).toBe('+5 at 20');
  });

  it('puts both marks of a short chapter at its end, as dueMarks pays them', () => {
    expect(chapterMarker(0, 8, none, false)).toBe('+1 at 8');
    expect(chapterMarker(0, 8, new Set(['0:10']), false)).toBe('+2 at 8');
    expect(chapterMarker(0, 15, none, false)).toBe('+1 at 10');
    expect(chapterMarker(0, 15, new Set(['0:10']), false)).toBe('+2 at 15');
  });
});

describe('the kit atlas', () => {
  const items = [
    { w: 241, h: 24 },
    { w: 155, h: 285 },
    { w: 155, h: 285 },
    { w: 127, h: 127 },
    { w: 127, h: 127 },
    { w: 246, h: 280 },
    { w: 110, h: 34 },
    { w: 36, h: 8 },
  ];

  it('packs every piece inside the atlas without overlap, in the order given', () => {
    const { at, height } = packKit(items, 512);
    expect(at).toHaveLength(items.length);
    items.forEach((a, i) => {
      expect(at[i].x + a.w).toBeLessThanOrEqual(512);
      expect(at[i].y + a.h).toBeLessThanOrEqual(height);
      items.forEach((b, j) => {
        if (j <= i) return;
        const apart =
          at[i].x + a.w <= at[j].x || at[j].x + b.w <= at[i].x || at[i].y + a.h <= at[j].y || at[j].y + b.h <= at[i].y;
        expect(apart, `${i} and ${j}`).toBe(true);
      });
    });
  });

  it('packs tallest first, so a short piece never costs a tall row', () => {
    const { height } = packKit(items, 1024);
    // Three rows at most at 1024: the tall ones, the discs, the rest.
    expect(height).toBeLessThan(285 + 127 + 34 + 12);
  });
});

describe('reduced motion (tech G7)', () => {
  it('loops nothing of its own: the one living thing goes through breathe(), which honours it', () => {
    for (const file of ['./LevelSelectScene.ts', './GalleryScene.ts', '../render/ScrollView.ts']) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(src, file).not.toMatch(/repeat:\s*-1/);
    }
  });
});
