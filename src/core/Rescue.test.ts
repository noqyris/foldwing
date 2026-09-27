import { describe, expect, it } from 'vitest';
import {
  ghostHeadLow,
  rescueOffer,
  rescueSpot,
  skipDrawnFree,
  type LadderState,
  type RescueBand,
} from './Rescue';
import { tapFloor } from '../render/HitArea';
import { bannerLine, BASE_HEIGHT, boardDrop, boardInset, METRICS, pt } from '../render/Theme';
import { LEVELS } from '../data/levels';
import { Playfield } from './Playfield';

const RULES = { revealAfter: 3, skipAfter: 6, skipAnywayAfter: 9 };

const at = (attempts: number, over: Partial<LadderState> = {}): LadderState => ({
  attempts,
  revealsUsed: 0,
  revealOffer: 'spend',
  daily: false,
  ...over,
});

describe('rescueOffer: the ladder', () => {
  it('points at the fold from three deaths, and offers nothing before', () => {
    expect(rescueOffer(at(2), RULES)).toBeNull();
    expect(rescueOffer(at(3), RULES)).toBe('reveal');
    expect(rescueOffer(at(5, { revealOffer: 'ad' }), RULES)).toBe('reveal');
    // No way to see the walls, and too early to skip: nothing at all.
    expect(rescueOffer(at(4, { revealOffer: null }), RULES)).toBeNull();
  });

  it('keeps offering a reveal the player holds and has not used, until nine', () => {
    for (const kind of ['spend', 'owner'] as const) {
      expect(rescueOffer(at(6, { revealOffer: kind }), RULES)).toBe('reveal');
      expect(rescueOffer(at(8, { revealOffer: kind }), RULES)).toBe('reveal');
      expect(rescueOffer(at(9, { revealOffer: kind }), RULES)).toBe('skip');
    }
  });

  it('offers the skip once a reveal has been used on this level', () => {
    expect(rescueOffer(at(6, { revealsUsed: 1 }), RULES)).toBe('skip');
    expect(rescueOffer(at(7, { revealsUsed: 2, revealOffer: 'owner' }), RULES)).toBe('skip');
    // Not before six, however many reveals were used.
    expect(rescueOffer(at(5, { revealsUsed: 1 }), RULES)).toBe('reveal');
  });

  it('skips at six, as before, when there is nothing to spend', () => {
    expect(rescueOffer(at(6, { revealOffer: 'ad' }), RULES)).toBe('skip');
    expect(rescueOffer(at(6, { revealOffer: 'store' }), RULES)).toBe('skip');
    expect(rescueOffer(at(6, { revealOffer: null }), RULES)).toBe('skip');
  });

  it('never offers a skip on the Daily', () => {
    expect(rescueOffer(at(12, { daily: true }), RULES)).toBe('reveal');
    expect(rescueOffer(at(12, { daily: true, revealOffer: null }), RULES)).toBeNull();
  });
});

describe('skipDrawnFree: the skip keeps what it promised', () => {
  it('promises an ad on a new pill only where one can play', () => {
    expect(skipDrawnFree(null, true, false)).toBe(false);
    expect(skipDrawnFree(null, false, false)).toBe(true);
  });

  it('keeps the drawn promise when the pill is built again, whatever the ads say now', () => {
    // Drawn free while ads were down; the SDK came up before a resize.
    expect(skipDrawnFree(true, true, false)).toBe(true);
    // Drawn with an ad; the ad went away. The tap still skips (on 'unavailable').
    expect(skipDrawnFree(false, false, false)).toBe(false);
  });

  it('turns free for a Remove Ads owner, drawn or new', () => {
    expect(skipDrawnFree(false, true, true)).toBe(true);
    expect(skipDrawnFree(null, true, true)).toBe(true);
  });
});

/** Every shipped maze starts on one row; the pill is placed against its dot. */
const pf = new Playfield(750, BASE_HEIGHT, METRICS.inset);
const START_Y = pf.toScreen(LEVELS[0].start).y;
/** A press this far from the dot's centre starts a stroke. */
const GRAB = METRICS.startRadius * METRICS.startGrabFactor;
const GRAB_BOTTOM = START_Y + GRAB;
const band = (scale: number, over: Partial<RescueBand> = {}): RescueBand => ({
  startY: START_Y,
  grabRadius: GRAB,
  bannerTop: BASE_HEIGHT - METRICS.bannerReserve,
  floor: tapFloor(1 / scale),
  faceH: pt(40),
  minFaceH: pt(24),
  gap: pt(4),
  ...over,
});

/**
 * The world's heights (Theme.adaptiveHeight): 9:16, a modern iPhone, a tall
 * narrow pane. The board is centred in the extra height (Theme.boardInset),
 * so the start row moves down by half of it and the banner line by all of it:
 * the band under the dot gains the other half.
 */
const HEIGHTS = [BASE_HEIGHT, 1460, 1700];
const bandAt = (height: number, scale: number): RescueBand => {
  const board = new Playfield(750, height, boardInset(height));
  return band(scale, { startY: board.toScreen(LEVELS[0].start).y, bannerTop: bannerLine(height) });
};

/** Canvas scales (CSS px per base px), from a Split View pane to the Duo inside. */
const SCALES = [0.317, 0.41, 0.476, 0.5, 0.52, 0.626];

describe('rescueSpot: under the start dot', () => {
  it('puts every maze start on one row, so one band serves them all', () => {
    for (const l of LEVELS) expect(pf.toScreen(l.start).y).toBeCloseTo(START_Y, 6);
  });

  for (const height of HEIGHTS) {
    it(`keeps face and tap out of the grab zone and off the banner, at every scale: ${height} tall`, () => {
      for (const scale of SCALES) {
        const b = bandAt(height, scale);
        const grabBottom = b.startY + GRAB;
        const at = `${height} @${scale}`;
        const s = rescueSpot(b);
        expect(s, at).not.toBeNull();
        if (!s) continue;
        // A press on any part of the pill is a press on the pill, never the
        // start of a stroke: the whole grab circle lies above it.
        expect(s.y - s.h / 2, at).toBeGreaterThanOrEqual(grabBottom + b.gap - 1e-9);
        expect(s.y - s.tap / 2, at).toBeGreaterThanOrEqual(grabBottom - 1e-9);
        expect(s.y + s.h / 2, at).toBeLessThanOrEqual(b.bannerTop - b.gap + 1e-9);
        expect(s.y + s.tap / 2, at).toBeLessThanOrEqual(b.bannerTop + 1e-9);
        expect(s.tap, at).toBeGreaterThanOrEqual(s.h);
        expect(s.h, at).toBeGreaterThanOrEqual(b.minFaceH);
        // Far under the lowest wall any maze draws, on the board wherever it is.
        expect(s.y - s.h / 2, at).toBeGreaterThan(pt(500) + boardDrop(height));
      }
    });
  }

  for (const height of HEIGHTS.filter((h) => h > BASE_HEIGHT)) {
    it(`gives a taller world's pill its designed face, and the floor where the band holds it: ${height} tall`, () => {
      for (const scale of SCALES) {
        const b = bandAt(height, scale);
        const bandH = b.bannerTop - (b.startY + GRAB);
        const at = `${height} @${scale}`;
        // The band under the dot gained the half of the extra height the board did not take.
        expect(bandH, at).toBeCloseTo(BASE_HEIGHT - METRICS.bannerReserve - GRAB_BOTTOM + (height - BASE_HEIGHT - boardDrop(height)), 6);
        const s = rescueSpot(b);
        expect(s?.h, at).toBe(pt(40));
        expect(s?.tap, at).toBeCloseTo(Math.min(b.floor, bandH), 6);
      }
    });
  }

  it('gives the tap way to the band, which is shorter than 44pt on every screen', () => {
    // From the grab zone's foot to the banner line: 34pt of base. The floor
    // never goes under pt(44), so the band caps the tap everywhere, and the
    // face shrinks to what is left between the two gaps.
    const bandH = BASE_HEIGHT - METRICS.bannerReserve - GRAB_BOTTOM;
    for (const scale of SCALES) {
      const b = band(scale);
      const s = rescueSpot(b);
      expect(b.floor, `@${scale}`).toBeGreaterThan(bandH);
      expect(s?.tap, `@${scale}`).toBeCloseTo(bandH, 6);
      expect(s?.h, `@${scale}`).toBeCloseTo(bandH - 2 * b.gap, 6);
    }
  });

  it('keeps the floor where the band has room for it', () => {
    // A band taller than the floor: the tap is the floor, the face as designed.
    const b = band(0.52, { faceH: pt(20), minFaceH: pt(12), startY: START_Y - pt(40) });
    const s = rescueSpot(b);
    expect(s?.tap).toBe(b.floor);
    expect(s?.h).toBe(pt(20));
    expect((s?.y ?? 0) - (s?.tap ?? 0) / 2).toBeGreaterThanOrEqual(b.startY + GRAB - 1e-9);
  });

  it('shrinks the face to fit a shorter band, and gives up below the shortest face', () => {
    // A sliver of home-indicator inset the canvas does not clear lifts the banner line.
    const lifted = rescueSpot(band(0.713, { bannerTop: BASE_HEIGHT - METRICS.bannerReserve - 3 }));
    expect(lifted).not.toBeNull();
    expect(lifted?.h).toBeLessThan(pt(26));
    expect(lifted?.h).toBeGreaterThanOrEqual(pt(24));
    expect((lifted?.y ?? 0) - (lifted?.h ?? 0) / 2).toBeGreaterThanOrEqual(GRAB_BOTTOM + pt(4) - 1e-9);
    // More than about 2pt of it leaves no band: the runway takes the pill.
    expect(rescueSpot(band(0.52, { bannerTop: BASE_HEIGHT - METRICS.bannerReserve - pt(4) }))).toBeNull();
    // The Duo outside: 34pt of inset at 0.483 is about 70 base.
    expect(rescueSpot(band(0.483, { bannerTop: BASE_HEIGHT - METRICS.bannerReserve - 70 }))).toBeNull();
  });

  it('stays under the grab zone, and under a ghost that dipped below it', () => {
    // A dip that stays inside the grab zone changes nothing.
    const plain = rescueSpot(band(0.52));
    expect(rescueSpot(band(0.52, { ghostLow: START_Y + pt(20) }))).toEqual(plain);
    // One a pt under the zone's foot pushes the face down by it, and shrinks it.
    const dip = GRAB_BOTTOM + pt(1);
    const s = rescueSpot(band(0.52, { ghostLow: dip }));
    expect(s).not.toBeNull();
    expect((s?.y ?? 0) - (s?.h ?? 0) / 2).toBeGreaterThanOrEqual(dip + pt(4) - 1e-9);
    expect(s?.h).toBeLessThan(plain?.h ?? 0);
    // One that ran further down leaves no band.
    expect(rescueSpot(band(0.52, { ghostLow: GRAB_BOTTOM + pt(4) }))).toBeNull();
  });
});

describe('rescueSpot: under the board sheet', () => {
  /** An 18 Pro's world (1631 base), its board sheet 22 base under the playfield. */
  const H = 1631;
  const board = new Playfield(750, H, boardInset(H));
  const sheetBottom = board.bottom + 22;
  const at = (over: Partial<RescueBand>): RescueBand =>
    band(0.536, { startY: board.toScreen(LEVELS[0].start).y, sheetBottom, ...over });

  it('puts the face wholly under the sheet, hugging it, where the band holds it', () => {
    for (const bannerTop of [H - 63, bannerLine(H) - 63]) {
      const b = at({ bannerTop });
      const s = rescueSpot(b);
      expect(s, `${bannerTop}`).not.toBeNull();
      if (!s) continue;
      expect(s.y - s.h / 2).toBeGreaterThanOrEqual(sheetBottom + b.gap - 1e-9);
      expect(s.y + s.h / 2).toBeLessThanOrEqual(b.bannerTop - b.gap + 1e-9);
      expect(s.y + s.tap / 2).toBeLessThanOrEqual(b.bannerTop + 1e-9);
      expect(s.y - s.tap / 2).toBeGreaterThanOrEqual(b.startY + GRAB - 1e-9);
      expect(s.h).toBeGreaterThanOrEqual(b.minFaceH);
    }
  });

  it('keeps the band under the dot where the sheet leaves no room (a 9:16 phone with its banner)', () => {
    const b = band(0.52, { sheetBottom: BASE_HEIGHT - METRICS.bannerReserve - pt(10) });
    expect(rescueSpot(b)).toEqual(rescueSpot(band(0.52)));
  });
});

describe('ghostHeadLow', () => {
  const up = [
    { x: 100, y: 1100 },
    { x: 100, y: 1080 },
    { x: 100, y: 1040 },
  ];
  it('reads only the first stretch, inside the columns', () => {
    expect(ghostHeadLow(up, 60, 50, 700)).toBe(1100);
    expect(ghostHeadLow(up, 60, 200, 700)).toBeNull();
    const dips = [
      { x: 100, y: 1100 },
      { x: 100, y: 1150 },
      { x: 100, y: 1100 },
      { x: 100, y: 1300 },
    ];
    // The second dip is past the reach.
    expect(ghostHeadLow(dips, 60, 50, 700)).toBe(1150);
    expect(ghostHeadLow([], 60, 0, 750)).toBeNull();
  });
});
