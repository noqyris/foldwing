/**
 * ResultCard — what a win says, under the figure it was won with.
 *
 * The Night Fold card of SPEC §5.3: three stars punched into its top edge,
 * the line's verdict against par, what arrived as chips, the chapter's beads,
 * and one row of actions whose Next button shows the next maze. (It replaced
 * the 1.4 card, whose verdict was a medal line and whose chapter was a bar.)
 *
 * This file owns how a result looks and where it sits, never what happened:
 * the caller says what the win earned (`Progress.settleWin`, `recordRatio`).
 * Positions come from one pure function, `resultCardLayout`, tested at every
 * height and canvas scale, so a resize lays the card out again from the same
 * numbers it was built with. The flights that leave from the card
 * (`flyOut`) and the tap carve-out (`onControl`) are here too. */

import Phaser from 'phaser';
import type { Vec2 } from '../core/Geometry';
import { chapterBeads, chapterTitle, nextMarkLine, type Bead } from '../core/Chapters';
import { chapterStarStats, shownRatio, type StarSave } from '../core/Stars';
import type { WeekDot } from '../core/Streak';
import { CHAPTER_SIZE } from '../data/levels';
import type { Level } from '../data/types';
import { Audio } from '../systems/Audio';
import { Haptics } from '../systems/Haptics';
import { glowRect, panel, softDisc, type Panel, type PanelSpec } from './Baked';
import { MIN_TAP_PT } from './HitArea';
import { icon, type IconName } from './Icons';
import { mazeThumb } from './MazeThumb';
import { BASE_WIDTH, blend, dp, hexCss, MOTION, motionReduced, ms, pt, rgba, theme, ui } from './Theme';
import {
  button,
  FONT,
  type Glyph,
  GLYPH_SIZE,
  glyphIcon,
  label,
  mainCameraOnly,
  pulse,
  setButtonText,
  TYPE,
} from './UI';

/* ==================================================================== *
 *  The Night Fold card (SPEC §5.3, §3.7)                               *
 * ==================================================================== */

/* ------------------------------------------------------------- the beats */

/**
 * The win's beats this card plays, in ms from the win (SPEC §3.7). GameScene
 * keeps the others — the bloom, the board stepping back, the flights — on the
 * same clock, and builds the card at the win's t = 0 (or says how late with
 * `at`).
 */
export const RESULT_BEAT = {
  /** The card starts to rise and settles over `riseMs`. */
  rise: 620,
  riseMs: 320,
  /** One star punched in at each, left to right: C6, D6, G6. */
  stars: [700, 880, 1060],
  /** A punch: 0 → 1.25 → 1, turning in from −12°. */
  punchMs: 260,
  /** The chapter bead lights, the count ticks on, the streak flips. */
  chapter: 1200,
} as const;

/**
 * Reduced motion: the card crossfades in over `fade`, already in its end
 * state, and the stars' notes still sound — one per star, `noteGap` apart, a
 * haptic's breath, so three do not land as one buzz.
 */
export const REDUCED_BEAT = { fade: 150, noteGap: 110 } as const;

/**
 * When each earned star's beat fires, in ms from now for a card built `at`
 * ms into the win. Through `ms()`, like every beat on GameScene's clock.
 */
export function starTimes(stars: number, at: number, reduced: boolean): number[] {
  const n = Math.max(0, Math.min(3, Math.floor(Number.isFinite(stars) ? stars : 0)));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(
      reduced
        ? Math.max(0, ms(RESULT_BEAT.rise - at)) + REDUCED_BEAT.fade + i * REDUCED_BEAT.noteGap
        : Math.max(0, ms(RESULT_BEAT.stars[i] - at))
    );
  }
  return out;
}

/* ----------------------------------------------------------- the metrics */

/**
 * The card's measures, from the B mock (pt at 402 wide, through `dp`). The
 * gaps are the tightest the card is drawn at; spare sky opens each by up to
 * `spread`, and the rest stays over the card.
 */
export const RC = {
  starBig: dp(54),
  starSmall: dp(40),
  /** The stars stand on a line this far under the card's top edge, so they overlap it. */
  crownFeet: dp(30),
  /** The Daily's flame badge, standing on the same line. */
  badge: dp(54),
  verdict: dp(34),
  sub: dp(18),
  chips: dp(28),
  chapter: dp(30),
  week: dp(36),
  offer: dp(46),
  actions: dp(62),
  gapCrown: dp(6),
  gapSub: dp(4),
  gapChips: dp(10),
  gapBand: dp(12),
  gapOffer: dp(10),
  gapActions: dp(14),
  /** A card with no crown: sky between its top edge and the verdict. */
  padTop: dp(22),
  spread: dp(8),
  padX: dp(16),
  padBottom: dp(12),
  /** Clear sky between the framed board and the highest star. */
  above: dp(8),
  /** Between the card's face and the banner line (or the canvas's bottom). */
  below: dp(10),
  /** Text never reaches into a control's tap area; this much clear of it. */
  textClear: dp(2),
  square: dp(58),
  gap: dp(8),
  radius: dp(34),
  thumbW: dp(40),
  thumbH: dp(52),
  bead: dp(7),
  beadGap: dp(3),
  chipGap: dp(6),
  chipPadX: dp(10),
  day: dp(22),
  dayGap: dp(12),
} as const;

/** The furthest the board steps back to make room for the card. Shared with the 1.4 card. */
export const MIN_FRAME_SCALE = 0.5;

/** "Nothing tappable within 8 pt of the banner line", in base units at the scale the floor was read at. */
export function bannerClear(floor: number): number {
  return (floor * 8) / MIN_TAP_PT;
}

/* ------------------------------------------------------------- the model */

export type ChipTone = 'accent' | 'quiet' | 'gold';

/** One thing that arrived with the win: "+1 reveal", "mission · 2 new", "Fold Sense 74 +3". */
export interface ResultChip {
  /** What a flight asks for by name: 'reveal', 'mission', 'sense', 'close', 'bookmark'… */
  readonly key: string;
  readonly text: string;
  readonly icon?: IconName;
  /** accent: something paid (the default); gold: a star thing; quiet: a fact. */
  readonly tone?: ChipTone;
  /** A gain after the text, in ember: the "+3" of "Fold Sense 74 +3". */
  readonly gain?: string;
}

/** The chapter row: "Chapter III · Hinge · 8 of 20", the next mark, 20 beads. */
export interface ResultChapter {
  readonly title: string;
  /** Folds cleared in the chapter, this win included. */
  readonly count: number;
  readonly size: number;
  /** One per fold, after this win. */
  readonly beads: readonly Bead[];
  /** The bead of the fold just played: it glows. */
  readonly here: number | null;
  /** This win cleared `here` for the first time: it lights at the chapter beat, and the count ticks on. */
  readonly fresh: boolean;
  /** "+1 at 10 — two to go", in ember; null for owners, or with both marks paid. */
  readonly mark: string | null;
  /** Said instead when there is no mark: "★ 47 of 60", in gold. */
  readonly stars: string | null;
  /** Bead indices wearing a gift outline: the chapter marks not paid before this win. */
  readonly gifts: readonly number[];
  /** The gift this win paid (its outline flashes and goes at the beat). */
  readonly paysNow: readonly number[];
  /** All twenty: the beads flash gold down the row. */
  readonly completes: boolean;
}

/** The Next button: the next maze in miniature, "NEXT · 49", "Soft crease". */
export interface ResultNext {
  /** Drawn as a thumbnail; null draws none (the last fold: "Finish"). */
  readonly level: Level | null;
  /** The caps over the name, or null for a plain caption. */
  readonly caps: string | null;
  readonly name: string;
}

export interface ResultDaily {
  /** The run before and after this win; `to` 0 is no run ("Folded"). */
  readonly streak: { readonly from: number; readonly to: number };
  /** A milestone's title takes the line ("A week of folds"); the streak is then the caller's sub-line. */
  readonly title: string | null;
  /** The last seven days, oldest first (core/Streak `weekStrip`). */
  readonly week: readonly WeekDot[];
  /** Today, ISO: names the days under the dots. */
  readonly today: string;
  /** Today's first finish: today's dot fills at the chapter beat. */
  readonly fresh: boolean;
  /** The primary's caption: "Back to today". */
  readonly button: string;
}

/** A row the card asks with: [Remind me], or the chapter doubler's ad. One at most. */
export interface ResultOffer {
  /** The ask's words beside its button; without them the button spans the card. */
  readonly text?: string;
  readonly button: string;
}

/** The squares left of the primary. */
export type ResultSquare = 'share' | 'retry' | 'board';

/**
 * What a win earned, as the card shows it. SPEC §6's `showResult({ stars,
 * ratio, missing, chips, chapter, next, daily })`, plus the sub-line's facts,
 * the squares and the one offer the card may carry.
 */
export interface ResultSpec {
  /** Stars this line earned (Progress.recordRatio's `line`); 0 draws no stars (the Daily). */
  readonly stars: 0 | 1 | 2 | 3;
  /** Line ÷ par, or null with no par. */
  readonly ratio: number | null;
  /** "third star at 1.10×" (Stars.nextStarLine), or null. */
  readonly missing: string | null;
  /** The sub-line's facts: "7.0 s · first try". */
  readonly sub: string;
  readonly chips: readonly ResultChip[];
  readonly chapter: ResultChapter | null;
  /** The campaign's Next; null on the last fold ("Finish") and on the Daily. */
  readonly next: ResultNext | null;
  readonly daily: ResultDaily | null;
  /** Default: Share, and Retry while a star is missing (never on the Daily). */
  readonly squares?: readonly ResultSquare[];
  readonly offer?: ResultOffer | null;
}

/** The rows a spec draws — what the layout and the frame need, before anything is built. */
export interface ResultRows {
  readonly crown: 'stars' | 'badge' | null;
  readonly chips: boolean;
  readonly band: 'chapter' | 'week' | null;
  readonly offer: boolean;
}

export function resultRows(
  spec: Pick<ResultSpec, 'stars' | 'chips' | 'chapter' | 'daily' | 'offer'>
): ResultRows {
  return {
    crown: spec.daily ? 'badge' : spec.stars > 0 ? 'stars' : null,
    chips: spec.chips.length > 0,
    band: spec.daily ? (spec.daily.week.length > 0 ? 'week' : null) : spec.chapter ? 'chapter' : null,
    offer: !!spec.offer,
  };
}

/** The squares a spec shows, left to right. */
export function resultSquares(spec: Pick<ResultSpec, 'stars' | 'daily' | 'squares'>): ResultSquare[] {
  if (spec.squares) return [...spec.squares];
  if (spec.daily) return ['share'];
  return spec.stars > 0 && spec.stars < 3 ? ['share', 'retry'] : ['share'];
}

/* ------------------------------------------------------------ the layout */

/** Where the card may go right now. Re-read on every resize. The same shape as the 1.4 card's. */
export interface CardPlace {
  /** Where the (framed) board ends, base y. */
  readonly boardBottom: number;
  /** The first base y the native banner may cover — or the canvas's bottom with no banner. */
  readonly bannerTop: number;
  /** The thumb's floor now — `minTap(scene)`. */
  readonly floor: number;
  readonly cx: number;
  /** The card's face, edge to edge. */
  readonly width: number;
}

export interface ResultLayoutSpec {
  readonly boardBottom: number;
  readonly bannerTop: number;
  readonly floor: number;
  readonly rows: ResultRows;
}

/** A row: its centre line and height. */
export interface Band {
  readonly y: number;
  readonly h: number;
}

/** A row of controls: its face, and the tap height it keeps clear. */
export interface TapBand extends Band {
  readonly tap: number;
}

export interface ResultLayout {
  /** The face's top and bottom edges. */
  readonly top: number;
  readonly bottom: number;
  /** The highest thing drawn: the big star's top, or the face's top with no crown. */
  readonly crownTop: number;
  /** The line the stars stand on (bottom-aligned, like the mock). */
  readonly feet: number;
  readonly verdict: Band;
  readonly sub: Band;
  readonly chips: Band | null;
  readonly band: Band | null;
  readonly offer: TapBand | null;
  readonly actions: TapBand;
  /** Where `crownTop` would be with no spare shared out: what the board steps back for. */
  readonly tightTop: number;
  /** The crown keeps its sky under the board. False only when the board cannot step back far enough. */
  readonly fits: boolean;
}

type TextRow = 'verdict' | 'sub' | 'chips' | 'band';

const GAP_BEFORE: Readonly<Record<TextRow, number>> = {
  verdict: 0,
  sub: RC.gapSub,
  chips: RC.gapChips,
  band: RC.gapBand,
};

function textRows(rows: ResultRows): { kind: TextRow; h: number }[] {
  const list: { kind: TextRow; h: number }[] = [
    { kind: 'verdict', h: RC.verdict },
    { kind: 'sub', h: RC.sub },
  ];
  if (rows.chips) list.push({ kind: 'chips', h: RC.chips });
  if (rows.band) list.push({ kind: 'band', h: rows.band === 'week' ? RC.week : RC.chapter });
  return list;
}

/** The gaps spare sky is shared between: crown→verdict, each between text rows, and each over a control row. */
function gapCount(rows: ResultRows): number {
  return 1 + (textRows(rows).length - 1) + 1 + (rows.offer ? 1 : 0);
}

/**
 * The card from the bottom up, every gap opened by `extra`.
 *
 * The action row is anchored first: its face `padBottom` inside the card,
 * whose face ends `below` over the banner line, and its TAP area — taller
 * than the face at a small canvas scale — ending at least 8 pt over that line
 * (CLAUDE.md: nothing tappable near the banner). An offer row stacks on it,
 * its tap area never reaching into the action row's. The text rows stack
 * over the controls, never inside a tap area — a tap on the words is a tap on
 * the card, not a stray press — and the crown stands on the verdict.
 */
function stackResult(s: ResultLayoutSpec, extra: number): Omit<ResultLayout, 'tightTop' | 'fits'> {
  const clear = bannerClear(s.floor);
  const bottom = s.bannerTop - RC.below;
  const aTap = Math.max(RC.actions, s.floor);
  const aY = Math.min(bottom - RC.padBottom - RC.actions / 2, s.bannerTop - clear - aTap / 2);
  const actions: TapBand = { y: aY, h: RC.actions, tap: aTap };

  let offer: TapBand | null = null;
  let control: TapBand = actions;
  let gapOver = RC.gapActions;
  if (s.rows.offer) {
    const oTap = Math.max(RC.offer, s.floor);
    const oY = Math.min(
      aY - RC.actions / 2 - RC.gapOffer - extra - RC.offer / 2,
      aY - aTap / 2 - oTap / 2
    );
    offer = { y: oY, h: RC.offer, tap: oTap };
    control = offer;
    gapOver = RC.gapOffer;
  }
  // The lowest a text row may end: its gap over the top control's face, and
  // clear of its tap area.
  let edge = control.y - Math.max(control.h / 2 + gapOver + extra, control.tap / 2 + RC.textClear);

  const rows = textRows(s.rows);
  const boxes: Partial<Record<TextRow, Band>> = {};
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    boxes[r.kind] = { y: edge - r.h / 2, h: r.h };
    edge -= r.h;
    if (i > 0) edge -= GAP_BEFORE[r.kind] + extra;
  }
  const verdictTop = edge;

  let top: number;
  let feet: number;
  let crownTop: number;
  if (s.rows.crown) {
    feet = verdictTop - RC.gapCrown - extra;
    top = feet - RC.crownFeet;
    crownTop = feet - (s.rows.crown === 'badge' ? RC.badge : RC.starBig);
  } else {
    top = verdictTop - RC.padTop - extra;
    feet = top;
    crownTop = top;
  }
  return {
    top,
    bottom,
    crownTop,
    feet,
    verdict: boxes.verdict as Band,
    sub: boxes.sub as Band,
    chips: boxes.chips ?? null,
    band: boxes.band ?? null,
    offer,
    actions,
  };
}

/**
 * Where everything on the card goes. Bottom-anchored over the banner line
 * (see `stackResult`); the sky left between the framed board and the crown is
 * shared evenly between the card's gaps, up to `spread` each, so a tall phone
 * gets a card that breathes rather than one jammed onto its buttons under a
 * band of empty sky. What is left over stays sky.
 */
export function resultCardLayout(s: ResultLayoutSpec): ResultLayout {
  const tight = stackResult(s, 0);
  const spare = tight.crownTop - (s.boardBottom + RC.above);
  const extra = spare > 0 ? Math.min(RC.spread, spare / gapCount(s.rows)) : 0;
  const L = extra > 0 ? stackResult(s, extra) : tight;
  return {
    ...L,
    tightTop: tight.crownTop,
    // Within a rounding error: resultFrameScale aims the board exactly at it.
    fits: tight.crownTop >= s.boardBottom + RC.above - 1e-6,
  };
}

/**
 * How far the board steps back for this card: the configured scale, or less
 * when the card needs more room than it leaves — never under
 * MIN_FRAME_SCALE, past which the figure is too small to be the reward. A
 * configured 1 (or anything that is not a scale) is the kill switch: the
 * board stays, and the card stands over it on its own opaque face.
 */
export function resultFrameScale(o: {
  readonly want: number;
  readonly pivotY: number;
  readonly boardBottom: number;
  readonly bannerTop: number;
  readonly floor: number;
  readonly rows: ResultRows;
}): number {
  if (!(o.want > 0) || o.want >= 1 - 1e-3) return 1;
  const { tightTop } = resultCardLayout({ boardBottom: 0, bannerTop: o.bannerTop, floor: o.floor, rows: o.rows });
  const span = o.boardBottom - o.pivotY;
  if (!(span > 0)) return o.want;
  const fit = (tightTop - RC.above - o.pivotY) / span;
  return Math.max(Math.min(o.want, MIN_FRAME_SCALE), Math.min(o.want, fit));
}

/** One control of the action row: its key, centre x and width. */
export interface ActionBox {
  readonly key: ResultSquare | 'primary';
  readonly x: number;
  readonly w: number;
}

/**
 * The action row, left to right: the squares, then the primary filling the
 * rest (the B mock's [share][retry][Next fold →]). A pane too narrow for the
 * primary's least width shrinks the squares, never the primary.
 */
export function actionRow(cx: number, width: number, squares: readonly ResultSquare[]): ActionBox[] {
  const inner = Math.max(0, width - RC.padX * 2);
  const left = cx - inner / 2;
  const least = dp(150);
  const n = squares.length;
  const room = inner - least - n * RC.gap;
  const sq = n === 0 ? 0 : Math.max(0, Math.min(RC.square, room / n));
  const out: ActionBox[] = [];
  let x = left;
  for (const key of squares) {
    out.push({ key, x: x + sq / 2, w: sq });
    x += sq + RC.gap;
  }
  const w = left + inner - x;
  out.push({ key: 'primary', x: x + w / 2, w });
  return out;
}

/* -------------------------------------------------------------- the words */

/** A piece of a headline: big (Georgia 31) or small (the "×"). */
export interface HeadPiece {
  readonly text: string;
  readonly big: boolean;
}

/**
 * Line 1. The campaign's is the verdict on the line, "1.12× par" — the ratio
 * as every surface prints it (two decimals, Stars.shownRatio) — or "Folded"
 * with no par to measure against. The Daily's is the run: "6-day streak",
 * its number flipping up from yesterday's, or a milestone's title.
 */
export function resultHead(
  spec: Pick<ResultSpec, 'ratio' | 'daily'>
): { count: { from: number; to: number } | null; pieces: HeadPiece[] } {
  const d = spec.daily;
  if (d) {
    if (d.title) return { count: null, pieces: [{ text: d.title, big: true }] };
    if (d.streak.to > 0) {
      // Flipped only from a real run: "0-day streak" is not a thing to show.
      const from = d.streak.from > 0 ? d.streak.from : d.streak.to;
      return { count: { from, to: d.streak.to }, pieces: [{ text: '-day streak', big: true }] };
    }
    return { count: null, pieces: [{ text: 'Folded', big: true }] };
  }
  const r = spec.ratio;
  if (r === null || !Number.isFinite(r) || r <= 0) return { count: null, pieces: [{ text: 'Folded', big: true }] };
  return {
    count: null,
    pieces: [
      { text: shownRatio(r).toFixed(2), big: true },
      { text: '×', big: false },
      { text: ' par', big: true },
    ],
  };
}

/**
 * Line 2: the facts in the voice (italic), then what the line is short of in
 * gold — "7.0 s · first try · third star at 1.10×". At ★★★ nothing is short:
 * "the best line there is". The Daily has no stars to be short of.
 */
export function resultSub(
  spec: Pick<ResultSpec, 'sub' | 'missing' | 'stars' | 'daily' | 'ratio'>
): { lead: string; tail: string | null } {
  let tail: string | null = null;
  if (!spec.daily) {
    if (spec.missing) tail = spec.missing;
    else if (spec.stars >= 3) tail = 'the best line there is';
  }
  const lead = spec.sub.trim();
  return { lead: tail && lead ? `${lead} · ` : lead, tail };
}

/** A chip as drawn, and every key it answers to (a folded chip answers for all it holds). */
export interface ShownChip {
  readonly chip: ResultChip;
  readonly keys: readonly string[];
}

/**
 * At most `max` chips (SPEC §5.3): the rest fold into the last one, their
 * words joined — nothing that arrived goes unsaid, and a flight from a folded
 * chip still finds where to leave from.
 */
export function foldChips(chips: readonly ResultChip[], max = 3): ShownChip[] {
  if (chips.length <= max) return chips.map((chip) => ({ chip, keys: [chip.key] }));
  const keep = chips.slice(0, Math.max(0, max - 1)).map((chip) => ({ chip, keys: [chip.key] }));
  const rest = chips.slice(Math.max(0, max - 1));
  const text = rest.map((c) => (c.gain ? `${c.text} ${c.gain}` : c.text)).join(' · ');
  return [
    ...keep,
    { chip: { key: rest[0].key, text, icon: rest[0].icon, tone: 'quiet' }, keys: rest.map((c) => c.key) },
  ];
}

const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** The initials of the seven days ending `today` (ISO), oldest first: under the week's dots. */
export function weekLetters(today: string): string[] {
  const t = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(t)) return ['', '', '', '', '', '', ''];
  const out: string[] = [];
  for (let i = 6; i >= 0; i--) out.push(WEEKDAY[new Date(t - i * 86_400_000).getUTCDay()]);
  return out;
}

/* ---------------------------------------------------- the chapter, built */

/** What `resultChapter` reads of the save: stars, the frontier, the marks paid. */
export interface ChapterSave extends StarSave {
  readonly unlockedIndex?: number;
  readonly chapterMarks: readonly string[];
}

const MARKS = [10, 20] as const;

/**
 * The chapter row for a win of `levelIndex`, read from the save AFTER the win
 * was settled (its clear, its ratio and any mark it paid are in). One place
 * for GameScene to ask, so the beads, the count and the promise are the ones
 * the rest of the game draws (core/Chapters).
 */
export function resultChapter(o: {
  readonly save: ChapterSave;
  readonly levelIndex: number;
  /** The level was cleared before this win: its bead does not light again. */
  readonly wasCleared: boolean;
  /** Owners: "+2" of something unlimited promises nothing, so no marks. */
  readonly owner: boolean;
  /** The marks this win crossed (WinOutcome.chapter.crossed). */
  readonly crossed: readonly number[];
  readonly economy: { readonly halfReward: number; readonly fullReward: number };
}): ResultChapter {
  const c = Math.max(0, Math.floor(o.levelIndex / CHAPTER_SIZE));
  const beads = chapterBeads(o.save, c, null);
  const count = beads.filter((b) => b === 'gold' || b === 'cleared').length;
  const paid = new Set(o.save.chapterMarks);
  // Unpaid before this win: not in the save's marks, or paid by this very win.
  const due = o.owner
    ? []
    : MARKS.filter((at) => at <= beads.length && (!paid.has(`${c}:${at}`) || o.crossed.includes(at)));
  const s = chapterStarStats(o.save, c);
  return {
    title: chapterTitle(c),
    count,
    size: beads.length,
    beads,
    here: o.levelIndex - c * CHAPTER_SIZE,
    fresh: !o.wasCleared,
    mark: o.owner ? null : nextMarkLine(count, o.economy, beads.length),
    stars: `★ ${s.stars} of ${s.max}`,
    gifts: due.map((at) => at - 1),
    paysNow: due.filter((at) => o.crossed.includes(at)).map((at) => at - 1),
    completes: o.crossed.includes(20),
  };
}

/* ------------------------------------------------------------ the colours */

/**
 * The card's face: a vertical wash of the sheet colour, lit a little at the
 * top and deepened toward the well at the bottom — the mock's #1A3A45 →
 * #122B33 — derived from the tokens so another appearance follows.
 */
export function resultFace(): { top: number; bottom: number } {
  const u = ui();
  return { top: blend(u.glass, 0.035, u.sheet), bottom: blend(u.well, 0.35, u.sheet) };
}

/** A cleared (not ★★★) bead: moonlit cream, the mock's #D8E3DF. */
export function beadCleared(): number {
  const u = ui();
  return blend(u.text, 0.55, u.text2);
}

/**
 * A chip's face wash, per tone, and the colour its words are in. Every chip
 * sits on the same neutral well and says its tone in its WORDS: a 0.12 wash
 * of gold over the card's teal came out a muddy olive (QA), and a lighter
 * glass wash held the ember under 4.5:1.
 */
export function chipLook(tone: ChipTone): { face: number; alpha: number; ink: number } {
  const t = theme();
  const u = ui();
  if (tone === 'gold') return { face: u.well, alpha: 0.7, ink: t.medalText };
  if (tone === 'quiet') return { face: u.well, alpha: 0.7, ink: u.text2 };
  return { face: u.well, alpha: 0.7, ink: t.accentText };
}

/** The Next button's caps ("NEXT · 49"), in the primary's ink at this. */
export const NEXT_CAPS_ALPHA = 0.86;

/* ------------------------------------------------------------ the stars */

/** Texture pixels per base unit for the stars: they are the reward, and they scale up past 1 in the punch. */
const STAR_RES = 2;

/** The mock's star (a 24 grid): fuller than the icon's, points slightly round. */
const STAR_PTS: readonly (readonly [number, number])[] = [
  [12, 2.2],
  [14.9, 8.2],
  [21.5, 9],
  [16.6, 13.5],
  [17.9, 20],
  [12, 16.8],
  [6.1, 20],
  [7.4, 13.5],
  [2.5, 9],
  [9.1, 8.2],
];

/**
 * A star, `size` px across its box, centred on (cx, cy). Earned: the gold
 * radial of SPEC §5.3 (light → gold → deep) with a pale edge and a dark soft
 * drop. Still to earn: a sunk slot with a moonlight outline — a different
 * shape of fill, so colour is never the only signal.
 */
export function paintStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  earned: boolean
): void {
  const u = ui();
  const t = theme();
  const k = size / 20;
  const path = (): void => {
    ctx.beginPath();
    STAR_PTS.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
  };
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(k, k);
  ctx.translate(-12, -11.1);
  ctx.lineJoin = 'round';
  if (earned) {
    ctx.save();
    // Shadow offsets and blur are in device pixels, outside the transform.
    ctx.shadowColor = rgba(u.shadow, 0.55);
    ctx.shadowBlur = size * 0.09;
    ctx.shadowOffsetY = size * 0.045;
    path();
    const g = ctx.createRadialGradient(8.4, 7.2, 0, 8.4, 7.2, 20.4);
    g.addColorStop(0, hexCss(u.goldLight));
    g.addColorStop(0.55, hexCss(t.medal));
    g.addColorStop(1, hexCss(u.goldDeep));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    path();
    ctx.strokeStyle = rgba(u.goldLight, 0.95);
    ctx.lineWidth = 0.7;
    ctx.stroke();
  } else {
    path();
    ctx.fillStyle = rgba(u.well, 0.85);
    ctx.fill();
    ctx.strokeStyle = hexCss(u.text3);
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }
  ctx.restore();
}

/** One baked texture per kind and size, shared by every card. */
function starTexture(scene: Phaser.Scene, earned: boolean, size: number): string {
  const key = `fw-rstar-${earned ? 'gold' : 'slot'}-${Math.round(size)}`;
  if (scene.textures.exists(key)) return key;
  // Room for the drop and the rotation.
  const side = Math.ceil(size * 1.35 * STAR_RES);
  const tex = scene.textures.createCanvas(key, side, side);
  if (!tex) return '__MISSING';
  paintStar(tex.getContext(), side / 2, side / 2, size * STAR_RES, earned);
  tex.refresh();
  return key;
}

/** Each star's rest: its place in the crown, its size and its tilt (−8°, 0, +8°). */
export function crownStars(cx: number, feet: number): { x: number; y: number; size: number; angle: number }[] {
  const off = RC.starBig / 2 + dp(5) + RC.starSmall / 2;
  return [
    { x: cx - off, y: feet - RC.starSmall / 2, size: RC.starSmall, angle: -8 },
    { x: cx, y: feet - RC.starBig / 2, size: RC.starBig, angle: 0 },
    { x: cx + off, y: feet - RC.starSmall / 2, size: RC.starSmall, angle: 8 },
  ];
}

/* ------------------------------------------------------------- the card */

const noop = (): void => undefined;

type Img = Phaser.GameObjects.Image;
type Txt = Phaser.GameObjects.Text;
type Box = Phaser.GameObjects.Container;

/** A control of the card, by what it does. */
export type ControlKey = 'next' | 'share' | 'retry' | 'board' | 'offer';

interface StarRef {
  readonly slot: Img;
  readonly gold: Img | null;
  readonly glow: Img | null;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

interface ChapterRef {
  readonly count: Txt;
  readonly beadAt: (i: number) => Vec2;
  readonly beadW: number;
  /** How many beads. */
  readonly beads: number;
  /** The fresh bead's own state, popped in at the beat. */
  readonly lit: Panel | null;
  /** Its glow and ring, faded in with it. */
  readonly here: Panel[];
  readonly gifts: Map<number, Panel>;
}

interface Refs {
  readonly fx: Box;
  readonly stars: StarRef[];
  readonly badge: Box | null;
  readonly head: { readonly root: Box; readonly num: Txt | null };
  readonly chips: { readonly keys: readonly string[]; readonly x: number; readonly y: number; readonly w: number }[];
  readonly chapter: ChapterRef | null;
  readonly today: Box | null;
  readonly buttons: Map<ControlKey, Box>;
  readonly taps: Map<ControlKey, number>;
}

/**
 * The card on screen. `showResult` builds it at the win and plays its beats;
 * GameScene asks it where things are for the flights and whether a tap is on
 * one of its controls. Everything drawn is a child of `root`, destroyed as
 * one. A resize (`relayout`) and a skip (`finish`) rebuild it from the same
 * spec, in the state its beats have reached — so there is no half-moved star
 * or bead to chase after either.
 */
export class WinCard {
  readonly root: Box;
  /** The primary: Next, Finish, or the Daily's "Back to today". */
  onNext: () => void = noop;
  onRetry: () => void = noop;
  onShare: () => void = noop;
  /** The Daily's leaderboard square. */
  onBoard: () => void = noop;
  onOffer: () => void = noop;

  private place: CardPlace;
  private L: ResultLayout;
  private readonly shape: ResultRows;
  private body: Box | null = null;
  private refs: Refs | null = null;
  private readonly timers: Phaser.Time.TimerEvent[] = [];
  private readonly running = new Set<Phaser.Tweens.Tween>();
  private readonly state = { risen: false, stars: 0, sounded: 0, chapter: false, live: false };
  /** The sub-line, and the streak count in it when a milestone's title has the headline. */
  private subRoot: Box | null = null;
  private subNum: Txt | null = null;
  private offerState: { button: string; enabled: boolean; answer: string | null } | null;

  constructor(
    private readonly scene: Phaser.Scene,
    readonly spec: ResultSpec,
    place: CardPlace
  ) {
    this.place = place;
    this.shape = resultRows(spec);
    this.L = resultCardLayout({ ...place, rows: this.shape });
    this.offerState = spec.offer ? { button: spec.offer.button, enabled: true, answer: null } : null;
    this.root = scene.add.container(0, 0).setDepth(55).setAlpha(0);
    this.build();
  }

  /** The rows this card draws — what the board's step back is sized for. */
  get rows(): ResultRows {
    return this.shape;
  }

  /** The highest thing drawn (the big star's top), where it is now: for a toast over it, and flights turning in above it. */
  get top(): number {
    return this.L.crownTop + this.root.y;
  }

  /**
   * Where a flight from the card turns in toward its target: over the crown.
   * A bookmark bound for the Daily's flame turns here too, and comes down
   * onto it, rather than cutting across the verdict (tested).
   */
  get turnY(): number {
    return this.top - TURN_ABOVE;
  }

  /** The face's top edge, where it is now. */
  get faceTop(): number {
    return this.L.top + this.root.y;
  }

  /** The layout it is drawn from now. */
  get layout(): ResultLayout {
    return this.L;
  }

  /** Beats still to come. */
  get playing(): boolean {
    return this.timers.some((t) => t.getOverallProgress() < 1);
  }

  /**
   * Schedule the beats, for a card built `at` ms into the win: rise at 620,
   * a star at 700 / 880 / 1060 for each earned, the chapter at 1200. Under
   * reduced motion the card crossfades in over 150 ms already whole, and only
   * the stars' notes keep their own time.
   */
  play(at = 0): void {
    const reduced = motionReduced();
    const rise = Math.max(0, ms(RESULT_BEAT.rise - at));
    this.after(rise, () => this.rise());
    // Only a crown of stars punches: the Daily's flame has no stars to land.
    const stars = this.shape.crown === 'stars' ? this.spec.stars : 0;
    starTimes(stars, at, reduced).forEach((t, i) => this.after(t, () => this.punch(i)));
    if (!reduced) this.after(Math.max(0, ms(RESULT_BEAT.chapter - at)), () => this.light());
  }

  /**
   * Jump to the end state now: a tap during the sequence (SPEC §2.5.1). The
   * card is up, every earned star in, the chapter lit. Notes not yet played
   * stay silent — the player has moved on from them.
   */
  finish(): void {
    if (!this.root.scene) return;
    this.clearTimers();
    this.stopTweens();
    this.state.risen = true;
    this.state.stars = this.state.sounded = this.spec.stars;
    this.state.chapter = true;
    this.root.setY(0).setAlpha(1);
    this.build();
  }

  /** Taps are the card's: its controls respond. Before this, nothing on it does. */
  setLive(on: boolean): void {
    this.state.live = on;
    this.applyLive();
  }

  /**
   * Whether (x, y) is on one of the card's controls — the carve-out from "a
   * tap anywhere is the next fold". Judged by the tap areas, not the faces,
   * and only once the card is live and more than half there.
   */
  hitsControl(x: number, y: number): boolean {
    const r = this.refs;
    if (!r || !this.state.live || this.root.alpha < 0.5) return false;
    const boxes: TapBox[] = [];
    for (const [key, b] of r.buttons) {
      if (!b.scene) continue;
      const m = b.getWorldTransformMatrix();
      boxes.push({ x: m.tx, y: m.ty, w: b.width, tap: r.taps.get(key) ?? b.height });
    }
    return onControl(x, y, boxes);
  }

  /** The column beside the card on `side`, where an outward flight climbs. */
  gutter(side: 'left' | 'right'): number {
    const { cx, width } = this.place;
    const clear = TOKEN_R + pt(4);
    return side === 'right'
      ? Math.min(cx + width / 2 + clear, BASE_WIDTH - TOKEN_R)
      : Math.max(cx - width / 2 - clear, TOKEN_R);
  }

  /**
   * Just past the `side` end of the chip that says `key`, in world space —
   * where its reward's flight leaves from. Null when no chip says it.
   */
  chipEnd(key: string, side: 'left' | 'right'): Vec2 | null {
    const chips = this.refs?.chips ?? [];
    const c = chips.find((ch) => ch.keys.includes(key));
    if (!c) return null;
    // Past the ROW's end on that side, when another chip follows this one
    // there: from the chip's own end the tokens set off on top of the next
    // chip ("+2 reveals" over "Fold Sense 72 +3" — QA).
    const row = chips.filter((ch) => Math.abs(ch.y - c.y) < 1);
    const edge =
      side === 'right'
        ? Math.max(...row.map((ch) => ch.x + ch.w / 2))
        : Math.min(...row.map((ch) => ch.x - ch.w / 2));
    const off = pt(6) + TOKEN_R;
    return { x: onCanvas(side === 'right' ? edge + off : edge - off), y: c.y + this.root.y };
  }

  /** The centre of control `key`, in world space. */
  controlPoint(key: ControlKey): Vec2 {
    const b = this.refs?.buttons.get(key);
    if (!b || !b.scene) return { x: this.place.cx, y: this.L.actions.y + this.root.y };
    const m = b.getWorldTransformMatrix();
    return { x: m.tx, y: m.ty };
  }

  /** Just past control `key`'s `side` end — where the doubler's reveals set off. */
  controlEnd(key: ControlKey, side: 'left' | 'right'): Vec2 {
    const c = this.controlPoint(key);
    const half = (this.refs?.buttons.get(key)?.width ?? 0) / 2 + pt(6) + TOKEN_R;
    return { x: onCanvas(side === 'right' ? c.x + half : c.x - half), y: c.y };
  }

  /** Where a bookmark lands: the Daily's flame, or the headline. */
  headPoint(): Vec2 {
    const r = this.refs;
    if (r?.badge) return { x: r.badge.x, y: r.badge.y + this.root.y };
    return { x: this.place.cx, y: this.L.verdict.y + this.root.y };
  }

  /** What a landing bookmark pulses. */
  get headTarget(): Phaser.GameObjects.Components.Transform {
    return this.refs?.badge ?? this.refs?.head.root ?? this.root;
  }

  /** Rewrite the offer's button — the doubler's "loading the ad…", "✓ +2 more" — and say whether it can be pressed. */
  setOffer(text: string, enabled: boolean): void {
    if (!this.offerState) return;
    this.offerState.button = text;
    this.offerState.enabled = enabled;
    const b = this.refs?.buttons.get('offer');
    if (!b || !b.scene) return;
    setButtonText(b, text);
    b.setAlpha(enabled ? 1 : 0.6);
    this.applyLive();
  }

  /** The offer's button, while it can be pressed. */
  setOfferEnabled(on: boolean): void {
    if (this.offerState) this.setOffer(this.offerState.button, on);
  }

  /** The ask was answered: the row says how, and its button goes. */
  answerOffer(text: string): void {
    if (!this.offerState) return;
    this.offerState.answer = text;
    this.build();
  }

  /** Put everything where `place` says, from the same layout the tests pin. */
  relayout(place: CardPlace): void {
    this.place = place;
    this.L = resultCardLayout({ ...place, rows: this.shape });
    this.stopTweens();
    if (this.state.risen) this.root.setY(0).setAlpha(1);
    this.build();
  }

  destroy(): void {
    this.clearTimers();
    this.stopTweens();
    if (this.root.scene) this.scene.tweens.killTweensOf(this.root);
    this.root.destroy(true);
    this.body = null;
    this.refs = null;
  }

  /* ------------------------------------------------------------ the beats */

  private after(delay: number, fn: () => void): void {
    this.timers.push(
      this.scene.time.delayedCall(delay, () => {
        if (this.root.scene) fn();
      })
    );
  }

  private clearTimers(): void {
    for (const t of this.timers) t.remove(false);
    this.timers.length = 0;
  }

  private tween(cfg: Phaser.Types.Tweens.TweenBuilderConfig): Phaser.Tweens.Tween {
    const t = this.scene.tweens.add(cfg);
    this.running.add(t);
    return t;
  }

  private stopTweens(): void {
    for (const t of this.running) t.stop();
    this.running.clear();
  }

  /** The card rises and settles; under reduced motion it crossfades in, whole. */
  private rise(): void {
    if (this.state.risen) return;
    this.state.risen = true;
    if (motionReduced()) {
      this.state.stars = this.spec.stars;
      this.state.chapter = true;
      this.build();
      this.root.setY(0).setAlpha(0);
      this.tween({ targets: this.root, alpha: 1, duration: REDUCED_BEAT.fade });
      return;
    }
    this.root.setY(dp(28)).setAlpha(0);
    this.tween({
      targets: this.root,
      y: 0,
      alpha: 1,
      duration: ms(RESULT_BEAT.riseMs),
      ease: MOTION.settle.ease,
    });
  }

  /**
   * Star `i` punched in: 0 → 1.25 → 1 while turning in from −12°, its note
   * (C6, D6, G6) and its haptic (Light, Light, Success). The third adds a
   * gold ring and sparks. Under reduced motion the star is already there and
   * only the note and the haptic come.
   */
  private punch(i: number): void {
    if (i >= this.spec.stars) return;
    if (i >= this.state.sounded) {
      this.state.sounded = i + 1;
      Audio.starNote(i);
      Haptics.star(i);
    }
    if (i < this.state.stars) return;
    this.state.stars = i + 1;
    const s = this.refs?.stars[i];
    if (!s?.gold) return;
    const base = 1 / STAR_RES;
    s.gold.setVisible(true).setScale(0).setAngle(s.angle - 12);
    this.tween({
      targets: s.gold,
      scale: base * 1.25,
      duration: ms(RESULT_BEAT.punchMs * 0.6),
      ease: 'Cubic.easeOut',
      onComplete: () => {
        if (s.gold?.scene) this.tween({ targets: s.gold, scale: base, duration: ms(RESULT_BEAT.punchMs * 0.4), ease: 'Sine.easeInOut' });
      },
    });
    this.tween({ targets: s.gold, angle: s.angle, duration: ms(RESULT_BEAT.punchMs), ease: 'Back.easeOut' });
    if (s.glow) {
      s.glow.setVisible(true).setAlpha(0);
      this.tween({ targets: s.glow, alpha: GLOW_ALPHA, duration: ms(RESULT_BEAT.punchMs) });
    }
    if (i === 2) this.burst();
  }

  /** ★★★: a gold ring opening to 31 pt round the crown and twelve sparks. Transient, and never under reduced motion. */
  private burst(): void {
    const r = this.refs;
    const mid = r?.stars[1];
    if (!r || !mid || motionReduced()) return;
    const g = this.scene.add.graphics().setPosition(mid.x, mid.y);
    r.fx.add(g);
    const gold = theme().medal;
    const p = { t: 0 };
    this.tween({
      targets: p,
      t: 1,
      duration: ms(460),
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        if (!g.scene) return;
        g.clear();
        const fade = 1 - p.t;
        g.lineStyle(dp(2), gold, 0.9 * fade);
        g.strokeCircle(0, 0, dp(18) + (dp(31) - dp(18)) * p.t);
        g.lineStyle(dp(1.6), gold, fade);
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2 + 0.13;
          const r0 = dp(33) + dp(8) * p.t;
          const r1 = r0 + dp(9) * (1 - p.t * 0.5);
          g.lineBetween(Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * r1, Math.sin(a) * r1);
        }
      },
      onComplete: () => g.destroy(),
    });
  }

  /**
   * The chapter beat: the fold just cleared lights its bead (gold for ★★★),
   * the count ticks on, a gift it paid flashes and goes, and a completed
   * chapter runs gold down the row. The Daily's run flips up and today's dot
   * fills.
   */
  private light(): void {
    if (this.state.chapter) return;
    this.state.chapter = true;
    const r = this.refs;
    if (!r) return;
    const c = this.spec.chapter;
    if (c && r.chapter) {
      const ch = r.chapter;
      if (c.fresh) {
        this.flipText(ch.count, `${c.count} of ${c.size}`);
        if (ch.lit) {
          ch.lit.setVisible(true).setScale(0.3);
          this.tween({ targets: ch.lit, scale: 1, duration: ms(260), ease: 'Back.easeOut' });
        }
        for (const h of ch.here) {
          h.setVisible(true).setAlpha(0);
          this.tween({ targets: h, alpha: 1, duration: ms(260) });
        }
      }
      for (const at of c.paysNow) {
        const gift = ch.gifts.get(at);
        if (!gift) continue;
        this.tween({
          targets: gift,
          scale: 1.8,
          alpha: 0,
          duration: ms(420),
          ease: 'Cubic.easeOut',
          onComplete: () => gift.setVisible(false),
        });
      }
      if (c.completes) this.sweep(ch);
    }
    const d = this.spec.daily;
    if (d) {
      const head = resultHead(this.spec);
      if (head.count && r.head.num && head.count.from !== head.count.to) {
        this.flipText(r.head.num, String(head.count.to), () => this.layoutHead(r.head));
        if (r.badge) pulse(this.scene, r.badge, 0.12);
      } else if (this.subNum?.scene && d.streak.from !== d.streak.to) {
        this.flipText(this.subNum, String(d.streak.to), () => this.layoutSub());
        if (r.badge) pulse(this.scene, r.badge, 0.12);
      }
      if (r.today) {
        r.today.setVisible(true).setScale(0.3);
        this.tween({ targets: r.today, scale: 1, duration: ms(260), ease: 'Back.easeOut' });
      }
    }
  }

  /** A completed chapter: gold runs down the twenty beads, 15 ms apart. */
  private sweep(ch: ChapterRef): void {
    if (motionReduced()) return;
    for (let i = 0; i < ch.beads; i++) {
      const at = ch.beadAt(i);
      const flash = this.bead('gold', at.x, at.y, ch.beadW).setAlpha(0);
      this.body?.add(flash);
      this.tween({
        targets: flash,
        alpha: 0.95,
        delay: ms(i * 15),
        duration: ms(150),
        yoyo: true,
        onComplete: () => flash.destroy(),
      });
    }
  }

  /** The old number rises away, the new one rises in. Under reduced motion it simply changes. */
  private flipText(text: Txt, to: string, after?: () => void): void {
    if (motionReduced()) {
      text.setText(to);
      after?.();
      return;
    }
    const y = text.y;
    this.tween({
      targets: text,
      y: y - dp(5),
      alpha: 0,
      duration: ms(180),
      ease: 'Quad.easeIn',
      onComplete: () => {
        if (!text.scene) return;
        text.setText(to).setY(y + dp(5));
        after?.();
        this.tween({ targets: text, y, alpha: 1, duration: ms(180), ease: 'Quad.easeOut' });
      },
    });
  }

  private applyLive(): void {
    const r = this.refs;
    if (!r) return;
    for (const [key, b] of r.buttons) {
      if (!b.scene) continue;
      const enabled = key !== 'offer' || this.offerState?.enabled !== false;
      if (this.state.live && enabled) b.setInteractive();
      else b.disableInteractive();
    }
  }

  private press(key: ControlKey): void {
    if (!this.state.live) return;
    if (key === 'next') this.onNext();
    else if (key === 'retry') this.onRetry();
    else if (key === 'share') this.onShare();
    else if (key === 'board') this.onBoard();
    else if (this.offerState?.enabled !== false) this.onOffer();
  }

  /* ----------------------------------------------------------- the build */

  /** (Re)build every object from the spec, the layout and the beats reached so far. */
  private build(): void {
    const scene = this.scene;
    this.body?.destroy(true);
    const body = scene.add.container(0, 0);
    this.body = body;
    this.root.add(body);

    const L = this.L;
    const { cx, width } = this.place;
    const inner = width - RC.padX * 2;
    const face = resultFace();
    const u = ui();

    body.add(
      panel(scene, 'result-face', cx, (L.top + L.bottom) / 2, width, L.bottom - L.top, {
        radius: RC.radius,
        face: { kind: 'vertical', top: face.top, bottom: face.bottom },
        elevation: 'e3',
        outline: { color: u.glass, alpha: 0.07, width: 2 },
      })
    );
    const fx = scene.add.container(0, 0);
    body.add(fx);

    const stars = this.shape.crown === 'stars' ? this.buildStars(body, cx, L.feet) : [];
    const badge = this.shape.crown === 'badge' ? this.buildBadge(body, cx, L.feet) : null;
    const head = this.buildHead(body, cx, L.verdict.y, inner);
    this.buildSub(body, cx, L.sub.y, inner);
    const chips = L.chips ? this.buildChips(body, cx, L.chips.y, inner) : [];
    const chapter = L.band && this.shape.band === 'chapter' ? this.buildChapter(body, cx, L.band, inner) : null;
    const today = L.band && this.shape.band === 'week' ? this.buildWeek(body, cx, L.band) : null;

    const buttons = new Map<ControlKey, Box>();
    const taps = new Map<ControlKey, number>();
    if (L.offer) this.buildOffer(body, cx, L.offer, inner, buttons, taps);
    this.buildActions(body, cx, width, L.actions, buttons, taps);

    this.refs = { fx, stars, badge, head, chips, chapter, today, buttons, taps };
    this.applyLive();
  }

  private buildStars(body: Box, cx: number, feet: number): StarRef[] {
    const scene = this.scene;
    const t = theme();
    return crownStars(cx, feet).map((s, i) => {
      const earned = i < this.spec.stars;
      const shown = i < this.state.stars;
      const glow = earned ? softDisc(scene, s.x, s.y, s.size * 0.8, t.medal, GLOW_ALPHA).setVisible(shown) : null;
      if (glow) body.add(glow);
      const slot = scene.add
        .image(s.x, s.y, starTexture(scene, false, s.size))
        .setScale(1 / STAR_RES)
        .setAngle(s.angle);
      body.add(slot);
      const gold = earned
        ? scene.add
            .image(s.x, s.y, starTexture(scene, true, s.size))
            .setScale(1 / STAR_RES)
            .setAngle(s.angle)
            .setVisible(shown)
        : null;
      if (gold) body.add(gold);
      return { slot, gold, glow, x: s.x, y: s.y, angle: s.angle };
    });
  }

  /** The Daily's crown: a flame on a dusk-rimmed disc, standing where the stars stand. */
  private buildBadge(body: Box, cx: number, feet: number): Box {
    const scene = this.scene;
    const u = ui();
    const d = RC.badge;
    const b = scene.add.container(cx, feet - d / 2);
    b.add(
      panel(scene, 'result-badge', 0, 0, d, d, {
        radius: d / 2,
        face: { kind: 'solid', color: resultFace().top },
        elevation: 'e2',
        outline: { color: u.dusk, alpha: 0.85, width: dp(1.5) },
        glow: { color: u.dusk, alpha: 0.35, blur: dp(16) },
      })
    );
    // Dusk, like its ring: the Daily's one colour (OWNER-DECISIONS 1), not a
    // tangerine flame inside a purple rim (QA).
    b.add(icon(scene, 0, 0, 'flame', { size: dp(30), color: u.dusk }));
    body.add(b);
    return b;
  }

  /** Line 1: "1.12× par" — or the Daily's run, its number flipping. */
  private buildHead(body: Box, cx: number, y: number, inner: number): { root: Box; num: Txt | null } {
    const scene = this.scene;
    const u = ui();
    const head = resultHead(this.spec);
    const root = scene.add.container(cx, y);
    const big = { font: FONT.display, size: dp(31), color: u.text };
    let num: Txt | null = null;
    if (head.count) {
      const shown = this.state.chapter ? head.count.to : head.count.from;
      num = label(scene, 0, 0, String(shown), big).setOrigin(0, 0.5);
      root.add(num);
    }
    for (const p of head.pieces) {
      const t = p.big
        ? label(scene, 0, 0, p.text, big)
        : label(scene, 0, 0, p.text, { font: FONT.display, size: dp(19), color: u.text2 });
      t.setOrigin(0, 0.5).setData('small', !p.big);
      root.add(t);
    }
    body.add(root);
    const ref = { root, num };
    this.layoutHead(ref, inner);
    return ref;
  }

  /** The headline's pieces side by side, centred as one; scaled down, never wrapped. */
  private layoutHead(ref: { root: Box; num: Txt | null }, inner = this.place.width - RC.padX * 2): void {
    const parts = ref.root.list as Txt[];
    const total = parts.reduce((s, p) => s + p.width, 0);
    let x = -total / 2;
    for (const p of parts) {
      p.setX(x);
      // The small "×" sits on the numerals' baseline, not their middle.
      p.setY(p.getData('small') ? dp(3) : 0);
      x += p.width;
    }
    ref.root.setScale(total > inner ? inner / total : 1);
  }

  /** Line 2: the facts in the voice, then what is short in gold. */
  private buildSub(body: Box, cx: number, y: number, inner: number): void {
    const scene = this.scene;
    const u = ui();
    const s = resultSub(this.spec);
    const root = scene.add.container(cx, y);
    const parts: Txt[] = [];
    const voice = { font: FONT.display, italic: true, size: dp(14.5), color: u.text2 };
    let lead = s.lead;
    // A milestone's title has the headline, so the streak's count is said
    // here ("7-day streak · 0:01 · first try") — and it flips here, from
    // yesterday's, at the same beat the headline's would. Printed already
    // at its new number, the flip's sound and haptic landed on nothing (QA).
    const d = this.spec.daily;
    const to = d ? String(d.streak.to) : '';
    if (d?.title && d.streak.from > 0 && d.streak.from !== d.streak.to && lead.startsWith(`${to}-`)) {
      const num = label(scene, 0, 0, this.state.chapter ? to : String(d.streak.from), voice).setOrigin(0, 0.5);
      parts.push(num);
      this.subNum = num;
      lead = lead.slice(to.length);
    }
    if (lead) parts.push(label(scene, 0, 0, lead, voice).setOrigin(0, 0.5));
    if (s.tail) {
      // The same voice as the lead, said in gold: a switch to bold sans
      // mid-sentence read as a second line jammed into the first (QA).
      parts.push(
        label(scene, 0, 0, s.tail, { font: FONT.display, italic: true, size: dp(14.5), color: theme().medalText }).setOrigin(0, 0.5)
      );
    }
    root.add(parts);
    this.subRoot = root;
    this.layoutSub(inner);
    body.add(root);
  }

  /** The sub-line's parts side by side, centred as one; scaled down, never wrapped. */
  private layoutSub(inner = this.place.width - RC.padX * 2): void {
    const root = this.subRoot;
    if (!root) return;
    const parts = root.list as Txt[];
    const total = parts.reduce((sum, p) => sum + p.width, 0);
    let x = -total / 2;
    for (const p of parts) {
      p.setX(x);
      x += p.width;
    }
    root.setScale(total > inner ? inner / total : 1);
  }

  /** What arrived: up to three chips, centred; a row wider than the card is scaled to it. */
  private buildChips(body: Box, cx: number, y: number, inner: number): Refs['chips'] {
    const scene = this.scene;
    const t = theme();
    const shown = foldChips(this.spec.chips);
    const row = scene.add.container(cx, y);
    const built = shown.map(({ chip, keys }) => {
      const look = chipLook(chip.tone ?? 'accent');
      const c = scene.add.container(0, 0);
      const iconSize = dp(15);
      const words = label(scene, 0, 0, chip.text, { size: dp(12), weight: 600, color: look.ink }).setOrigin(0, 0.5);
      const gain = chip.gain
        ? label(scene, 0, 0, chip.gain, { size: dp(12), weight: 700, color: t.accentText }).setOrigin(0, 0.5)
        : null;
      const w =
        RC.chipPadX * 2 +
        (chip.icon ? iconSize + dp(5) : 0) +
        words.width +
        (gain ? dp(4) + gain.width : 0);
      const spec: PanelSpec = {
        radius: RC.chips / 2,
        face: { kind: 'solid', color: look.face, alpha: look.alpha },
        elevation: chip.tone === 'quiet' ? 'sunk' : undefined,
      };
      c.add(panel(scene, `result-chip-${chip.tone ?? 'accent'}`, 0, 0, w, RC.chips, spec));
      let x = -w / 2 + RC.chipPadX;
      if (chip.icon) {
        c.add(icon(scene, x + iconSize / 2, 0, chip.icon, { size: iconSize, color: look.ink }));
        x += iconSize + dp(5);
      }
      words.setX(x);
      c.add(words);
      x += words.width;
      if (gain) {
        gain.setX(x + dp(4));
        c.add(gain);
      }
      row.add(c);
      return { c, w, keys };
    });
    const total = built.reduce((s, b) => s + b.w, 0) + RC.chipGap * Math.max(0, built.length - 1);
    const k = total > inner ? inner / total : 1;
    let x = -total / 2;
    const out: Refs['chips'] = [];
    for (const b of built) {
      b.c.setX(x + b.w / 2);
      out.push({ keys: b.keys, x: cx + (x + b.w / 2) * k, y, w: b.w * k });
      x += b.w + RC.chipGap;
    }
    row.setScale(k);
    body.add(row);
    return out;
  }

  /** A bead of `state`, centred on (x, y), `w` wide. Baked: one texture per state, stretched across. */
  private bead(state: Bead | 'gift' | 'ring', x: number, y: number, w: number): Panel {
    const t = theme();
    const u = ui();
    const h = RC.bead;
    let spec: PanelSpec;
    let bw = w;
    let bh = h;
    switch (state) {
      case 'gold':
        spec = { radius: h / 2, face: { kind: 'solid', color: t.medal } };
        break;
      case 'cleared':
      case 'current':
        spec = { radius: h / 2, face: { kind: 'solid', color: beadCleared() } };
        break;
      case 'skipped':
        spec = {
          radius: h / 2,
          face: { kind: 'solid', color: u.well, alpha: 0.6 },
          outline: { color: u.text3, alpha: 0.9, width: dp(1.2) },
        };
        break;
      case 'gift':
        bw = w + dp(3);
        bh = h + dp(3);
        spec = { radius: bh / 2, face: { kind: 'none' }, outline: { color: t.accent, alpha: 1, width: dp(1.5) } };
        break;
      case 'ring':
        bw = w + dp(4);
        bh = h + dp(4);
        spec = { radius: bh / 2, face: { kind: 'solid', color: t.accent, alpha: 0.35 } };
        break;
      default:
        spec = { radius: h / 2, face: { kind: 'solid', color: u.well, alpha: 0.9 }, elevation: 'sunk' };
    }
    return panel(this.scene, `result-bead-${state}`, x, y, bw, bh, spec);
  }

  /** "Chapter III · Hinge · 8 of 20", the next mark in ember, and the twenty beads. */
  private buildChapter(body: Box, cx: number, band: Band, inner: number): ChapterRef | null {
    const c = this.spec.chapter;
    if (!c) return null;
    const scene = this.scene;
    const t = theme();
    const u = ui();
    const left = cx - inner / 2;
    const right = cx + inner / 2;
    const top = band.y - band.h / 2;
    const textY = top + dp(7);
    const beadY = top + band.h - RC.bead / 2;
    const text = { size: dp(11.5), weight: 600 as const };

    const lead = scene.add.container(left, textY);
    const title = label(scene, 0, 0, `${c.title} · `, { ...text, color: u.text2 }).setOrigin(0, 0.5);
    const shownCount = c.fresh && !this.state.chapter ? Math.max(0, c.count - 1) : c.count;
    const count = label(scene, title.width, 0, `${shownCount} of ${c.size}`, { ...text, color: u.text2 }).setOrigin(0, 0.5);
    lead.add([title, count]);

    const promise = c.mark ?? c.stars;
    const trail = scene.add.container(right, textY);
    let trailW = 0;
    if (promise) {
      const gold = !c.mark;
      const color = gold ? t.medalText : t.accentText;
      const words = label(scene, 0, 0, gold ? promise.replace(/^★\s*/, '') : promise, { ...text, color }).setOrigin(1, 0.5);
      const mark = icon(scene, -words.width - dp(4) - dp(7), 0, gold ? 'star' : 'eye', { size: dp(14), color });
      trail.add([mark, words]);
      trailW = words.width + dp(4) + dp(14);
    }
    const leadW = title.width + count.width;
    // A narrow pane: both sides shrink alike rather than collide.
    const room = inner - dp(12);
    const k = leadW + trailW > room ? room / (leadW + trailW) : 1;
    lead.setScale(k);
    trail.setScale(k);
    body.add([lead, trail]);

    const n = c.beads.length;
    const w = (inner - RC.beadGap * (n - 1)) / n;
    const beadAt = (i: number): Vec2 => ({ x: left + i * (w + RC.beadGap) + w / 2, y: beadY });
    // A first clear's bead is still open until the beat lights it.
    const lightNow = c.fresh && !this.state.chapter;
    const here: Panel[] = [];
    if (c.here !== null && c.here >= 0 && c.here < n) {
      const at = beadAt(c.here);
      const glow = glowRect(scene, at.x, at.y, w, RC.bead, RC.bead / 2, t.accent, dp(6), 0.9);
      const ring = this.bead('ring', at.x, at.y, w);
      body.add([glow, ring]);
      here.push(glow, ring);
      if (lightNow) for (const h of here) h.setVisible(false);
    }
    let lit: Panel | null = null;
    for (let i = 0; i < n; i++) {
      const state = c.beads[i];
      const at = beadAt(i);
      const pending = lightNow && i === c.here;
      body.add(this.bead(pending ? 'open' : state, at.x, at.y, w));
      if (pending) {
        lit = this.bead(state, at.x, at.y, w).setVisible(false);
        body.add(lit);
      }
    }
    const gifts = new Map<number, Panel>();
    for (const g of c.gifts) {
      if (g < 0 || g >= n) continue;
      // Paid by this win and its beat has come: the outline has gone.
      if (c.paysNow.includes(g) && this.state.chapter) continue;
      const at = beadAt(g);
      const img = this.bead('gift', at.x, at.y, w);
      body.add(img);
      gifts.set(g, img);
    }
    return { count, beadAt, beadW: w, beads: n, lit, here, gifts };
  }

  /** The Daily's week: seven dots, oldest first, the day's initial under each. Returns today's fill, which lands at the beat. */
  private buildWeek(body: Box, cx: number, band: Band): Box | null {
    const d = this.spec.daily;
    if (!d) return null;
    const scene = this.scene;
    const u = ui();
    const size = RC.day;
    const top = band.y - band.h / 2;
    const dotY = top + size / 2;
    const letterY = top + size + dp(7);
    const n = d.week.length;
    const x0 = cx - (n * size + (n - 1) * RC.dayGap) / 2 + size / 2;
    const letters = weekLetters(d.today);
    let today: Box | null = null;
    for (let i = 0; i < n; i++) {
      const dot = d.week[i];
      const x = x0 + i * (size + RC.dayGap);
      // Today's first finish fills its dot at the beat; until then it is today's ring.
      const pending = i === n - 1 && d.fresh && dot === 'today-done' && !this.state.chapter;
      body.add(this.dayDot(pending || dot === 'today-open' ? 'ring' : dot, x, dotY));
      if (pending) {
        today = this.dayDot('today-done', x, dotY).setVisible(false);
        body.add(today);
      }
      body.add(label(scene, x, letterY, letters[i] ?? '', { size: dp(9.5), weight: 600, color: u.text2 }).setOrigin(0.5));
    }
    return today;
  }

  private dayDot(kind: WeekDot | 'ring', x: number, y: number): Box {
    const scene = this.scene;
    const u = ui();
    const size = RC.day;
    const c = scene.add.container(x, y);
    const disc = (look: string, spec: PanelSpec): Panel => panel(scene, `result-day-${look}`, 0, 0, size, size, spec);
    if (kind === 'done' || kind === 'today-done') {
      c.add(disc('done', { radius: size / 2, face: { kind: 'solid', color: u.dusk } }));
      c.add(icon(scene, 0, 0, 'check', { size: dp(14), color: u.onDusk }));
    } else if (kind === 'marked') {
      c.add(disc('marked', { radius: size / 2, face: { kind: 'none' }, outline: { color: u.dusk, alpha: 0.9, width: dp(1.5) } }));
      c.add(icon(scene, 0, 0, 'bookmark', { size: dp(12), color: u.dusk }));
    } else if (kind === 'ring') {
      c.add(disc('ring', { radius: size / 2, face: { kind: 'none' }, outline: { color: u.dusk, alpha: 0.9, width: dp(1.5) } }));
    } else {
      c.add(disc('missed', { radius: size / 2, face: { kind: 'none' }, outline: { color: u.text3, alpha: 0.6, width: dp(1.2) } }));
    }
    return c;
  }

  /** The one ask the card may carry: words and a button, a full-width button, or — answered — the answer. */
  private buildOffer(
    body: Box,
    cx: number,
    row: TapBand,
    inner: number,
    buttons: Map<ControlKey, Box>,
    taps: Map<ControlKey, number>
  ): void {
    const o = this.spec.offer;
    const st = this.offerState;
    if (!o || !st) return;
    const scene = this.scene;
    const u = ui();
    if (st.answer !== null) {
      const t = label(scene, cx, row.y, st.answer, { size: dp(13), weight: 500, color: u.text2 }).setOrigin(0.5);
      if (t.width > inner) t.setScale(inner / t.width);
      body.add(t);
      return;
    }
    const bw = o.text ? dp(118) : inner;
    const bx = o.text ? cx + inner / 2 - bw / 2 : cx;
    const b = button(scene, bx, row.y, st.button, {
      width: bw,
      height: row.h,
      variant: 'secondary',
      size: dp(14),
      minTap: true,
      maxTap: row.tap,
      onPress: () => this.press('offer'),
    });
    fitCaption(b, bw - dp(20));
    b.setAlpha(st.enabled ? 1 : 0.6);
    body.add(b);
    buttons.set('offer', b);
    taps.set('offer', row.tap);
    if (o.text) {
      const words = label(scene, cx - inner / 2, row.y, o.text, { size: dp(13), weight: 500, color: u.text }).setOrigin(0, 0.5);
      const room = inner - bw - dp(10);
      if (words.width > room) words.setScale(room / words.width);
      body.add(words);
    }
  }

  /** The action row: the squares, then the primary with the next maze in it. */
  private buildActions(
    body: Box,
    cx: number,
    width: number,
    row: TapBand,
    buttons: Map<ControlKey, Box>,
    taps: Map<ControlKey, number>
  ): void {
    const scene = this.scene;
    const t = theme();
    const u = ui();
    for (const box of actionRow(cx, width, resultSquares(this.spec))) {
      if (box.key === 'primary') {
        const b = this.buildPrimary(box.x, row, box.w);
        body.add(b);
        buttons.set('next', b);
        taps.set('next', row.tap);
        continue;
      }
      const key = box.key;
      const b = button(scene, box.x, row.y, '', {
        width: box.w,
        height: row.h,
        variant: 'secondary',
        minTap: true,
        maxTap: row.tap,
        onPress: () => this.press(key),
      });
      if (key === 'retry') {
        // The circle arrow over the stars still to earn: "retry for ★★★".
        b.add(icon(scene, 0, -dp(7), 'retry', { size: dp(22), color: u.text }));
        for (let i = 0; i < 3; i++) {
          const earned = i < this.spec.stars;
          b.add(icon(scene, (i - 1) * dp(11), dp(14), earned ? 'star' : 'starOutline', { size: dp(11), color: t.medal }));
        }
      } else {
        b.add(icon(scene, 0, 0, key === 'share' ? 'share' : 'medal', { size: dp(22), color: u.text }));
      }
      body.add(b);
      buttons.set(key, b);
      taps.set(key, row.tap);
    }
  }

  /**
   * The primary. The campaign's Next shows the next maze in miniature, the
   * caps "NEXT · 49", its name in Georgia and an arrow; the last fold's and
   * the Daily's are a plain caption.
   */
  private buildPrimary(x: number, row: TapBand, w: number): Box {
    const scene = this.scene;
    const u = ui();
    const n = this.spec.next;
    const rich = !!n && (n.level !== null || n.caps !== null);
    const caption = this.spec.daily ? this.spec.daily.button : rich ? '' : n?.name ?? 'Finish';
    const b = button(scene, x, row.y, caption, {
      width: w,
      height: row.h,
      variant: 'primary',
      size: TYPE.button,
      minTap: true,
      maxTap: row.tap,
      onPress: () => this.press('next'),
    });
    if (!rich || !n) {
      fitCaption(b, w - dp(24));
      return b;
    }
    let x0 = -w / 2 + dp(10);
    if (n.level) {
      b.add(mazeThumb(scene, x0 + RC.thumbW / 2, 0, n.level, RC.thumbW, RC.thumbH, { radius: dp(10) }));
      x0 += RC.thumbW + dp(12);
    } else {
      x0 += dp(6);
    }
    const arrowX = w / 2 - dp(24);
    b.add(icon(scene, arrowX, 0, 'arrow', { size: dp(24), color: u.onAccent }));
    const room = arrowX - dp(18) - x0;
    const name = label(scene, x0, n.caps ? dp(9) : 0, n.name, { font: FONT.display, size: dp(20), color: u.onAccent }).setOrigin(0, 0.5);
    if (name.width > room) name.setScale(room / name.width);
    b.add(name);
    if (n.caps) {
      const caps = label(scene, x0, -dp(10), n.caps, {
        size: dp(10),
        weight: 600,
        caps: true,
        color: u.onAccent,
        alpha: NEXT_CAPS_ALPHA,
        letterSpacing: dp(1.5),
      }).setOrigin(0, 0.5);
      if (caps.width > room) caps.setScale(room / caps.width);
      b.add(caps);
    }
    return b;
  }
}

/** The glow under an earned star. */
const GLOW_ALPHA = 0.3;

/**
 * Build the result card for a win and play its beats — SPEC §6's
 * `showResult`. `place` is where it may go now (see `resultFrameScale` for
 * how far the board steps back first); `at` is how far into the win it is
 * being built. Wire `onNext`, `onRetry`, `onShare` (and `onBoard`,
 * `onOffer`) on what comes back.
 */
export function showResult(
  scene: Phaser.Scene,
  spec: ResultSpec,
  place: CardPlace,
  o: { readonly at?: number; readonly play?: boolean } = {}
): WinCard {
  const card = new WinCard(scene, spec, place);
  if (o.play !== false) card.play(o.at ?? 0);
  return card;
}

/* ==================================================================== *
 *  Taps and flights                                                    *
 * ==================================================================== */

/** Where a board framed at `scale` about `pivotY` ends. */
export function scaledBottom(pivotY: number, boardBottom: number, scale: number): number {
  return pivotY + (boardBottom - pivotY) * scale;
}

/* ------------------------------------------------------------ the helpers */

const BUTTON_LABEL = 'button-label';

/**
 * Shrink a kit button's caption to `maxW` if it runs wider — a long localised
 * word, a system font fallback. Never truncates. A no-op on anything that is
 * not a live kit button.
 */
export function fitCaption(b: Phaser.GameObjects.Container | null, maxW: number): void {
  if (!b || !b.scene) return;
  for (const o of b.list) {
    if (!(o instanceof Phaser.GameObjects.Text) || o.name !== BUTTON_LABEL) continue;
    o.setScale(1);
    if (o.width > maxW && maxW > 0) o.setScale(maxW / o.width);
  }
}

/** `setButtonText`, then fit the new caption. */
export function relabel(b: Phaser.GameObjects.Container | null, text: string, maxW: number): void {
  setButtonText(b, text);
  fitCaption(b, maxW);
}

/** A control's tap area: centred on (x, y), `w` wide and `tap` tall. */
export interface TapBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly tap: number;
}

/**
 * Whether (x, y) is on one of `controls` — the carve-out from "on a win, a
 * tap anywhere is the next fold": the card's own buttons, and in the header
 * the ‹ and the Reveal pill, whose taps mean something else.
 */
export function onControl(x: number, y: number, controls: readonly TapBox[]): boolean {
  return controls.some((c) => Math.abs(x - c.x) <= c.w / 2 && Math.abs(y - c.y) <= c.tap / 2);
}

/* ------------------------------------------------------------ the flights */

/** The flying token's radius, as the kit draws it. */
export const TOKEN_R = pt(12);

/** How much of a flight goes out to the gutter, before the climb. */
const OUT_SHARE = 0.28;

/** How far above the card a flight to a target over it (the Reveal pill) turns in. */
export const TURN_ABOVE = pt(32);

/**
 * Where an outward flight is at progress `p` (0..1): straight out along the
 * row it leaves from to `gutterX`, then up the gutter — rising on a curve
 * bent toward `turnY` — and in to `to`.
 *
 * The kit's flight bows up from the chord between the two ends, and from a
 * reward line to the Reveal pill that chord runs through every line above:
 * "Medal · the b◉st line". This one leaves along its own row, past the end
 * of its own text, climbs beside the card rather than over it, and only turns
 * in above it (or level with a target that is on it). Pure, so the claim that
 * it never crosses the card's text is a test, not a hope.
 */
export function outwardPoint(from: Vec2, gutterX: number, turnY: number, to: Vec2, p: number): Vec2 {
  const u = Math.max(0, Math.min(1, p));
  if (u < OUT_SHARE) {
    const q = u / OUT_SHARE;
    const e = 1 - (1 - q) * (1 - q);
    return { x: from.x + (gutterX - from.x) * e, y: from.y };
  }
  // Speeding up into the target: it is being collected, not thrown. It
  // rises on a curve toward `turnY` and only leaves the gutter late (the
  // fourth power), so it is past the card's lines before it turns in.
  const s = (u - OUT_SHARE) / (1 - OUT_SHARE);
  const k = s * s;
  return {
    x: gutterX + (to.x - gutterX) * k * k * k * k,
    y: (1 - k) * (1 - k) * from.y + 2 * (1 - k) * k * turnY + k * k * to.y,
  };
}

export interface FlyOutOptions {
  /** Where the tokens leave from: the end of the line that paid, on the `gutterX` side. */
  readonly from: Vec2;
  /** Where they land — read every frame, like the kit's flight. */
  readonly to: () => Vec2;
  /** The column beside the card they climb. */
  readonly gutterX: number;
  /** Where they turn in to the target. */
  readonly turnY: number;
  readonly count: number;
  readonly glyph: Glyph;
  /** Pulsed as each token lands. */
  readonly target?: Phaser.GameObjects.Components.Transform;
  /** After the last token lands. */
  readonly onLand?: () => void;
}

const MAX_TOKENS = 6;

/**
 * The kit's reward flight (UI.flyReward) on an outward path — the same
 * tokens, stagger, landings, haptics and sound, and the same reduced-motion
 * rule: nothing travels, the target pulses once and the number changes.
 * Only the path differs, and only because a flight that leaves from inside
 * the card must not be drawn across it.
 */
export function flyOut(scene: Phaser.Scene, o: FlyOutOptions): void {
  const count = Number.isNaN(o.count) ? 0 : Math.floor(o.count);
  const n = Math.min(Math.max(0, count), MAX_TOKENS);
  if (n === 0) {
    o.onLand?.();
    return;
  }
  if (motionReduced()) {
    scene.time.delayedCall(ms(520), () => {
      if (o.target) pulse(scene, o.target);
      Haptics.reward();
      Audio.pop();
      o.onLand?.();
    });
    return;
  }
  let aim: Vec2 = { x: o.from.x, y: o.from.y };
  const target = (): Vec2 => {
    try {
      const p = o.to();
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) aim = { x: p.x, y: p.y };
    } catch {
      // A target torn down mid-flight: keep flying to where it last was.
    }
    return aim;
  };
  const from = { x: o.from.x, y: o.from.y };
  for (let i = 0; i < n; i++) {
    const token = flyingToken(scene, o.glyph);
    token.setPosition(from.x, from.y);
    const p = { t: 0 };
    scene.tweens.add({
      targets: p,
      t: 1,
      delay: ms(i * 45),
      // A longer way round than the kit's chord, so a little longer on it.
      duration: ms(640),
      onUpdate: (tween: Phaser.Tweens.Tween) => {
        if (!token.scene) return;
        const at = outwardPoint(from, o.gutterX, o.turnY, target(), p.t);
        token
          .setPosition(at.x, at.y)
          .setScale(1 - 0.3 * p.t)
          .setAlpha(Math.min(1, tween.progress * 6));
      },
      onComplete: () => {
        token.destroy(true);
        if (o.target) pulse(scene, o.target);
        Haptics.reward();
        if (i === 0 || i === n - 1) Audio.pop();
        if (i === n - 1) o.onLand?.();
      },
    });
  }
}

/**
 * One token, drawn exactly as the kit draws its own (UI.flyReward): a sheet
 * disc with an accent rim over a little of the lamp, the glyph baked in
 * ember — so a flight that leaves from the card and one that does not are
 * the same thing arriving.
 */
function flyingToken(scene: Phaser.Scene, glyph: Glyph): Phaser.GameObjects.Container {
  const t = theme();
  const c = scene.add.container(0, 0).setDepth(85).setAlpha(0);
  mainCameraOnly(scene, c);
  const disc = panel(scene, 'token', 0, 0, TOKEN_R * 2, TOKEN_R * 2, {
    radius: TOKEN_R,
    face: { kind: 'solid', color: ui().sheet },
    elevation: 'e1',
    outline: { color: t.accent, alpha: 0.55, width: pt(1) },
  });
  c.add([softDisc(scene, 0, 0, TOKEN_R * 1.9, t.accent, 0.22), disc]);
  const name = glyphIcon(glyph);
  if (name) c.add(icon(scene, 0, 0, name, { size: GLYPH_SIZE * 1.05, color: t.accentText }));
  else {
    const mark = scene.add.graphics().setScale(16 / 13);
    glyph(mark, 0, 0, t.accentText, 1);
    c.add(mark);
  }
  return c;
}

/** A token's centre, kept where the whole token is on the canvas. */
function onCanvas(x: number): number {
  return Math.min(Math.max(x, TOKEN_R), BASE_WIDTH - TOKEN_R);
}
