/**
 * Stars — one to three per level, for the LINE the player drew.
 *
 *   ★    cleared
 *   ★★   the line came in at or under 1.25× par (the medal, exactly as before)
 *   ★★★  at or under 1.10× par
 *
 * Par is the validator's proved route (`Level.parPx`), so the ratio says how
 * close a hand came to the best line there is. Stars measure the line and
 * NEVER the attempts: a death costs no star, and neither does a Reveal. That
 * keeps failure cheap, and it keeps a paid-for currency guilt-free.
 *
 * The save stores the MEASUREMENT (`bestRatio`, the best line ÷ par a level has
 * seen) and never the stars: they are derived here, at read time. So the
 * thresholds can be tuned without a migration and without taking a star away
 * from anyone, and a medal from before stars existed is simply ★★ the moment
 * this build reads it, with nothing written.
 *
 * ONE NUMBER, EVERYWHERE. The result card prints "1.10× par", the live meter
 * prints "on pace · 1.10× par", and the stars are decided on the same value.
 * If the star rule compared the raw ratio while the card printed it rounded,
 * a 1.104 line would read "1.10×" beside two stars, and the promise the meter
 * made would be a lie. So every function here canonicalises a ratio the same
 * way — three decimals, the precision the save keeps, then the two the player
 * reads — and decides on what the player reads. It is at most half a hundredth
 * in the player's favour, and it means raw, stored and shown ratios can never
 * disagree about a star.
 *
 * Pure, and tested: no Phaser, no save I/O. `Progress` stores, this derives.
 */

import { dist, type Vec2 } from './Geometry';
import { chapterIndices } from './Rewards';
import { LEVELS } from '../data/levels';

/** 0 = not cleared. Every cleared level has at least one. */
export type StarCount = 0 | 1 | 2 | 3;

/** Stars a level can hold. */
export const MAX_STARS = 3;

/** Line ÷ par at or under which the second star lands. Today's medal, unchanged. */
export const STAR2_RATIO = 1.25;

/**
 * Line ÷ par at or under which the third star lands.
 *
 * PROVISIONAL, and uncalibrated. The spec asks for a cut where about 30% of
 * first clears in chapters 1–5 take ★★★, measured with the hand-play harness;
 * that harness is gone, so this is the design value. It must stay above 1.0 —
 * the proved route itself scores at or under par, and the best line there is
 * has to be worth three (src/data/stars.proof.test.ts holds all 300 to it).
 */
export const STAR3_RATIO = 1.1;

export interface StarThresholds {
  /** ≤ this for ★★. */
  readonly two: number;
  /** ≤ this for ★★★. */
  readonly three: number;
}

export const STAR_THRESHOLDS: StarThresholds = { two: STAR2_RATIO, three: STAR3_RATIO };

/** Every star in the campaign: the Daily is not in it. */
export const TOTAL_STARS = LEVELS.length * MAX_STARS;

/* ------------------------------------------------------------- the number */

const finiteRatio = (r: unknown): r is number => typeof r === 'number' && Number.isFinite(r) && r > 0;

/**
 * A ratio at the precision the save keeps it: three decimals. Idempotent, so
 * a stored value passes through unchanged.
 */
export function roundRatio(r: number): number {
  return Math.round(r * 1000) / 1000;
}

/** The ratio the player reads: two decimals of the stored one. */
export function shownRatio(r: number): number {
  return Math.round(roundRatio(r) * 100) / 100;
}

/** "1.04×" — the ratio as every surface prints it. */
export function ratioText(r: number): string {
  return `${shownRatio(r).toFixed(2)}×`;
}

/* -------------------------------------------------------------- the rule */

/**
 * Stars for a CLEARED line at `ratio` of par. A line with no par to measure
 * against (null, NaN, a par that was missing) still cleared: one star.
 */
export function starsFor(
  ratio: number | null | undefined,
  t: StarThresholds = STAR_THRESHOLDS
): 1 | 2 | 3 {
  if (!finiteRatio(ratio)) return 1;
  const shown = shownRatio(ratio);
  if (shown <= t.three) return 3;
  if (shown <= t.two) return 2;
  return 1;
}

/** The ratio the next star needs, or null at ★★★. */
export function nextStarRatio(stars: StarCount, t: StarThresholds = STAR_THRESHOLDS): number | null {
  if (stars >= 3) return null;
  return stars === 2 ? t.three : t.two;
}

/**
 * "third star at 1.10×" — what the result card says under a line that is one
 * short; null when nothing is missing. For a first star (not cleared) there is
 * nothing to say: that star is the level itself.
 */
export function nextStarLine(stars: StarCount, t: StarThresholds = STAR_THRESHOLDS): string | null {
  const at = nextStarRatio(stars, t);
  if (at === null || stars === 0) return null;
  return `${stars === 2 ? 'third' : 'second'} star at ${ratioText(at)}`;
}

/* ------------------------------------------------------ the save, derived */

/**
 * The part of a save stars are derived from. Structural on purpose, so this
 * module never imports the save's owner and `Progress.data` passes as it is.
 * `bestRatio` is optional: a view that predates it derives from the medals.
 */
export interface StarSave {
  readonly cleared: readonly string[];
  readonly medals: readonly string[];
  readonly bestRatio?: Readonly<Record<string, number>>;
}

/** Sets built once for a many-level read. */
interface StarIndex {
  readonly cleared: ReadonlySet<string>;
  readonly medals: ReadonlySet<string>;
  readonly best: Readonly<Record<string, number>>;
}

function indexOf(save: StarSave): StarIndex {
  return { cleared: new Set(save.cleared), medals: new Set(save.medals), best: save.bestRatio ?? {} };
}

function starsIn(ix: StarIndex, id: string, t: StarThresholds): StarCount {
  if (!ix.cleared.has(id)) return 0;
  const measured = Object.prototype.hasOwnProperty.call(ix.best, id) ? ix.best[id] : undefined;
  // A legacy medal is ★★ with no write; a third star is only ever earned by
  // play, so the medal alone never makes three.
  return Math.max(1, ix.medals.has(id) ? 2 : 0, finiteRatio(measured) ? starsFor(measured, t) : 0) as StarCount;
}

/**
 * The stars level `id` holds: 0 if not cleared, else the most of one (it was
 * cleared), two (a medal on record) and whatever its best line earns.
 */
export function starsOf(save: StarSave, id: string, t: StarThresholds = STAR_THRESHOLDS): StarCount {
  return starsIn(indexOf(save), id, t);
}

/** Per-level stars for a run of level indices, in order. */
export function starsAt(
  save: StarSave,
  indices: readonly number[],
  t: StarThresholds = STAR_THRESHOLDS
): StarCount[] {
  const ix = indexOf(save);
  return indices.map((i) => (LEVELS[i] ? starsIn(ix, LEVELS[i].id, t) : 0));
}

export interface ChapterStarStats {
  /** Stars earned in the chapter. */
  readonly stars: number;
  /** Stars the chapter holds: 3 per level (60 for a full chapter). */
  readonly max: number;
  /** Levels at ★★★. */
  readonly three: number;
  /** Levels cleared. */
  readonly cleared: number;
}

/** "★ 17 of 60", "gold when all 60": everything a chapter's stars say. */
export function chapterStarStats(
  save: StarSave,
  chapter: number,
  t: StarThresholds = STAR_THRESHOLDS
): ChapterStarStats {
  const counts = starsAt(save, chapterIndices(chapter), t);
  return {
    stars: counts.reduce<number>((s, n) => s + n, 0),
    max: counts.length * MAX_STARS,
    three: counts.filter((n) => n === 3).length,
    cleared: counts.filter((n) => n > 0).length,
  };
}

/** Stars earned in chapter `chapter` (0-based). */
export function chapterStars(save: StarSave, chapter: number, t: StarThresholds = STAR_THRESHOLDS): number {
  return chapterStarStats(save, chapter, t).stars;
}

/** Stars earned across the campaign, out of TOTAL_STARS. */
export function totalStars(save: StarSave, t: StarThresholds = STAR_THRESHOLDS): number {
  const ix = indexOf(save);
  let n = 0;
  for (const l of LEVELS) n += starsIn(ix, l.id, t);
  return n;
}

/* ---------------------------------------------------------------- the line */

/**
 * The length of a stroke: the straight-line sum over its RAW samples, exactly
 * what a win is measured on. Not the smoothed ribbon, which is a picture of
 * the line, and not the collision samples' spacing: the recorder's points.
 */
export function lineLength(points: readonly Vec2[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += dist(points[i], points[i - 1]);
  return len;
}

/**
 * A win's ratio: line ÷ par, at the save's precision, or null without a par.
 * THE function: the result card, the stored best, the stars and the live
 * meter's final reading all come from this one value.
 */
export function lineRatio(lineLen: number, par: number | null | undefined): number | null {
  if (!finiteRatio(par) || !Number.isFinite(lineLen) || lineLen < 0) return null;
  return roundRatio(lineLen / par);
}

/**
 * Where a stroke in progress is heading: the line so far plus the shortest way
 * still left to the goal ring (RouteField.remaining), over par. Null until
 * both are known. Because `remaining` is a shortest path, the projection only
 * rises as the stroke wanders, and at the ring it IS the win's ratio.
 */
export function projectRatio(
  lineLen: number,
  remaining: number | null | undefined,
  par: number | null | undefined
): number | null {
  if (remaining === null || remaining === undefined || !Number.isFinite(remaining) || remaining < 0) return null;
  return lineRatio(lineLen + remaining, par);
}

/** "on pace · 1.04× par" — the tray's live line. */
export function paceLine(projected: number): string {
  return `on pace · ${ratioText(projected)} par`;
}

export interface PaceReading {
  /** The projected ratio, or null before the route is known. */
  readonly ratio: number | null;
  /** The stars that ratio earns, or null (show three outlines). */
  readonly stars: 1 | 2 | 3 | null;
  /** "on pace · 1.04× par", or null. */
  readonly text: string | null;
}

const UNKNOWN: PaceReading = { ratio: null, stars: null, text: null };

/**
 * The live star meter's state for one stroke.
 *
 * It only ever RISES within a stroke, so a star that has dropped out never
 * blinks back: the route field reads the grid a cell at a time, and a stroke
 * cutting a corner can make a raw projection dip for a frame. Stars leave
 * quietly and do not come back mid-line; a new stroke (reset) starts afresh.
 * It measures length, not time, so it is not a timer.
 */
export class PaceMeter {
  private high: number | null = null;

  constructor(
    private readonly par: number | null | undefined,
    private readonly t: StarThresholds = STAR_THRESHOLDS
  ) {}

  /** A new stroke. */
  reset(): void {
    this.high = null;
  }

  /** The reading for a stroke `lineLen` long with `remaining` still to go. */
  read(lineLen: number, remaining: number | null | undefined): PaceReading {
    const r = projectRatio(lineLen, remaining, this.par);
    if (r !== null) this.high = this.high === null ? r : Math.max(this.high, r);
    return this.current();
  }

  /** The last reading, unchanged. */
  current(): PaceReading {
    const r = this.high;
    if (r === null) return UNKNOWN;
    return { ratio: r, stars: starsFor(r, this.t), text: paceLine(r) };
  }
}
