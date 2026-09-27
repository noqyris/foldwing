import { describe, expect, it } from 'vitest';
import { LEVELS } from '../data/levels';
import {
  chapterStars,
  chapterStarStats,
  lineLength,
  lineRatio,
  MAX_STARS,
  nextStarLine,
  nextStarRatio,
  PaceMeter,
  paceLine,
  projectRatio,
  ratioText,
  roundRatio,
  shownRatio,
  STAR2_RATIO,
  STAR3_RATIO,
  STAR_THRESHOLDS,
  starsAt,
  starsFor,
  starsOf,
  totalStars,
  TOTAL_STARS,
  type StarSave,
  type StarThresholds,
} from './Stars';

const id = (i: number): string => LEVELS[i].id;

/** A small deterministic generator, so a failing case can be replayed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32);
}

describe('the rule', () => {
  it('keeps the medal as the second star and a planned line as the third', () => {
    expect(STAR2_RATIO).toBe(1.25);
    expect(STAR3_RATIO).toBe(1.1);
    // The best line there is must be worth three: par itself sits under it.
    expect(STAR3_RATIO).toBeGreaterThan(1);
    expect(STAR2_RATIO).toBeGreaterThan(STAR3_RATIO);
    expect(TOTAL_STARS).toBe(LEVELS.length * MAX_STARS);
    expect(TOTAL_STARS).toBe(900);
  });

  it('gives one star for a clear, two at or under 1.25× par, three at or under 1.10×', () => {
    expect(starsFor(0.93)).toBe(3);
    expect(starsFor(1)).toBe(3);
    expect(starsFor(1.1)).toBe(3);
    expect(starsFor(1.11)).toBe(2);
    expect(starsFor(1.25)).toBe(2);
    expect(starsFor(1.26)).toBe(1);
    expect(starsFor(4.2)).toBe(1);
  });

  it('still gives the clear its star when there is no par to measure against', () => {
    expect(starsFor(null)).toBe(1);
    expect(starsFor(undefined)).toBe(1);
    expect(starsFor(Number.NaN)).toBe(1);
    expect(starsFor(Number.POSITIVE_INFINITY)).toBe(1);
    expect(starsFor(-1)).toBe(1);
  });

  /*
   * The card prints "1.10×"; the stars must agree with what it prints. A
   * 1.104 line reading "1.10×" beside two stars would make the meter's
   * promise a lie, so the rule decides on the shown value.
   */
  it('decides on the number the player reads, never on digits they cannot see', () => {
    expect(ratioText(1.104)).toBe('1.10×');
    expect(starsFor(1.104)).toBe(3);
    expect(ratioText(1.2549)).toBe('1.25×');
    expect(starsFor(1.2549)).toBe(2);
    expect(ratioText(1.106)).toBe('1.11×');
    expect(starsFor(1.106)).toBe(2);
    const next = rng(11);
    for (let k = 0; k < 20_000; k++) {
      const r = 0.8 + next() * 0.7;
      const printed = Number(ratioText(r).slice(0, -1));
      expect(starsFor(r), `${r}`).toBe(starsFor(printed));
      // And the save's three decimals never move it either.
      expect(starsFor(roundRatio(r)), `${r}`).toBe(starsFor(r));
    }
  });

  it('rounds idempotently, so a stored ratio passes through unchanged', () => {
    expect(roundRatio(1.23456)).toBe(1.235);
    expect(roundRatio(roundRatio(1.23456))).toBe(1.235);
    expect(shownRatio(1.235)).toBe(1.24);
    expect(shownRatio(0.999)).toBe(1);
  });

  it('says what the next star needs, and nothing at three', () => {
    expect(nextStarRatio(1)).toBe(STAR2_RATIO);
    expect(nextStarRatio(2)).toBe(STAR3_RATIO);
    expect(nextStarRatio(3)).toBeNull();
    expect(nextStarLine(2)).toBe('third star at 1.10×');
    expect(nextStarLine(1)).toBe('second star at 1.25×');
    expect(nextStarLine(3)).toBeNull();
    expect(nextStarLine(0)).toBeNull();
  });
});

describe('stars derived from a save', () => {
  const save = (s: Partial<StarSave>): StarSave => ({ cleared: [], medals: [], ...s });

  it('gives nothing for a level not cleared, whatever else the save says', () => {
    expect(starsOf(save({ medals: [id(0)], bestRatio: { [id(0)]: 1 } }), id(0))).toBe(0);
  });

  it('reads a clear as one star and a legacy medal as two, with nothing written', () => {
    const s = save({ cleared: [id(0), id(1)], medals: [id(1)] });
    expect(starsOf(s, id(0))).toBe(1);
    expect(starsOf(s, id(1))).toBe(2);
    expect(s).toEqual({ cleared: [id(0), id(1)], medals: [id(1)] });
  });

  it('lets only a line make three: a medal alone never does', () => {
    const s = save({ cleared: [id(0)], medals: [id(0)] });
    expect(starsOf(s, id(0))).toBe(2);
    expect(starsOf({ ...s, bestRatio: { [id(0)]: 1.08 } }, id(0))).toBe(3);
    // A worse measurement than the medal took nothing back.
    expect(starsOf({ ...s, bestRatio: { [id(0)]: 1.4 } }, id(0))).toBe(2);
  });

  it('ignores a measurement that is not a number, or a key off the prototype', () => {
    const s = save({ cleared: [id(0), 'constructor'], bestRatio: { [id(0)]: Number.NaN } as Record<string, number> });
    expect(starsOf(s, id(0))).toBe(1);
    expect(starsOf(s, 'constructor')).toBe(1);
  });

  /*
   * §7: a derived count must never fall when a threshold is loosened. Stars
   * are a total the player watched grow; tuning the rule may give, never take.
   */
  it('never takes a star when a threshold moves up', () => {
    const next = rng(5);
    for (let trial = 0; trial < 200; trial++) {
      const cleared: string[] = [];
      const medals: string[] = [];
      const bestRatio: Record<string, number> = {};
      for (let i = 0; i < 60; i++) {
        if (next() < 0.7) cleared.push(id(i));
        if (next() < 0.3) medals.push(id(i));
        if (next() < 0.6) bestRatio[id(i)] = roundRatio(0.9 + next() * 0.8);
      }
      const s = { cleared, medals, bestRatio };
      const looser: StarThresholds = {
        two: STAR_THRESHOLDS.two + next() * 0.3,
        three: STAR_THRESHOLDS.three + next() * 0.1,
      };
      const indices = Array.from({ length: 60 }, (_, i) => i);
      const now = starsAt(s, indices);
      const after = starsAt(s, indices, looser);
      now.forEach((n, k) => expect(after[k], `level ${k + 1}, trial ${trial}`).toBeGreaterThanOrEqual(n));
      expect(totalStars(s, looser)).toBeGreaterThanOrEqual(totalStars(s));
    }
  });

  it('adds up a chapter and the campaign', () => {
    const s = save({
      cleared: [id(0), id(1), id(2), id(20)],
      medals: [id(1)],
      bestRatio: { [id(2)]: 1.02, [id(20)]: 1.3 },
    });
    expect(chapterStarStats(s, 0)).toEqual({ stars: 1 + 2 + 3, max: 60, three: 1, cleared: 3 });
    expect(chapterStars(s, 0)).toBe(6);
    expect(chapterStars(s, 1)).toBe(1);
    expect(chapterStars(s, 14)).toBe(0);
    expect(totalStars(s)).toBe(7);
    expect(starsAt(s, [0, 1, 2, 3, 999])).toEqual([1, 2, 3, 0, 0]);
  });

  it('holds all 900 when every line was planned', () => {
    const all = LEVELS.map((l) => l.id);
    const s = save({ cleared: all, bestRatio: Object.fromEntries(all.map((i) => [i, 1.0])) });
    expect(totalStars(s)).toBe(TOTAL_STARS);
    expect(chapterStarStats(s, 14)).toEqual({ stars: 60, max: 60, three: 20, cleared: 20 });
  });
});

describe('the line and the live meter', () => {
  it('measures a stroke over its raw samples', () => {
    expect(lineLength([])).toBe(0);
    expect(lineLength([{ x: 0, y: 0 }])).toBe(0);
    expect(lineLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }])).toBe(11);
  });

  it('gives a win its ratio at the save’s precision, or none without a par', () => {
    expect(lineRatio(1234.5, 1000)).toBe(1.235);
    expect(lineRatio(900, 1000)).toBe(0.9);
    expect(lineRatio(900, 0)).toBeNull();
    expect(lineRatio(900, null)).toBeNull();
    expect(lineRatio(900, undefined)).toBeNull();
    expect(lineRatio(Number.NaN, 1000)).toBeNull();
  });

  it('projects the line so far plus the shortest way left', () => {
    expect(projectRatio(400, 640, 1000)).toBe(1.04);
    expect(paceLine(1.04)).toBe('on pace · 1.04× par');
    // Not known yet: no projection, and the meter shows outlines.
    expect(projectRatio(400, null, 1000)).toBeNull();
    expect(projectRatio(400, Number.NaN, 1000)).toBeNull();
    expect(projectRatio(400, -1, 1000)).toBeNull();
    expect(projectRatio(400, 600, null)).toBeNull();
    // At the ring the rest is zero, and the projection IS the win's ratio.
    expect(projectRatio(1087, 0, 1000)).toBe(lineRatio(1087, 1000));
  });

  it('shows three outlines until the route is known', () => {
    const m = new PaceMeter(1000);
    expect(m.current()).toEqual({ ratio: null, stars: null, text: null });
    expect(m.read(120, null)).toEqual({ ratio: null, stars: null, text: null });
    expect(new PaceMeter(null).read(120, 800)).toEqual({ ratio: null, stars: null, text: null });
  });

  /*
   * Stars leave quietly and never blink back mid-line: a stroke cutting a
   * corner can make one raw projection dip for a frame.
   */
  it('only ever lets a stroke’s projection rise, until the next stroke', () => {
    const m = new PaceMeter(1000);
    expect(m.read(0, 1000)).toEqual({ ratio: 1, stars: 3, text: 'on pace · 1.00× par' });
    expect(m.read(300, 850).stars).toBe(2); // 1.15
    expect(m.read(320, 700)).toMatchObject({ ratio: 1.15, stars: 2 }); // a dip to 1.02 is held
    expect(m.read(500, 800)).toMatchObject({ ratio: 1.3, stars: 1 });
    expect(m.current()).toMatchObject({ ratio: 1.3, stars: 1, text: 'on pace · 1.30× par' });
    m.reset();
    expect(m.current().ratio).toBeNull();
    expect(m.read(0, 980).stars).toBe(3);
  });

  it('reads the same stars the finished line will be given', () => {
    const m = new PaceMeter(1000);
    const final = m.read(1104, 0);
    expect(final.stars).toBe(starsFor(lineRatio(1104, 1000)));
    expect(final.text).toBe(`on pace · ${ratioText(lineRatio(1104, 1000) as number)} par`);
  });
});
