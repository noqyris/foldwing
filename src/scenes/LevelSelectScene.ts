/**
 * LevelSelectScene — the campaign as a journey, one chapter to a page.
 *
 * Three hundred cards in one wall read as a featureless climb, and building
 * them all cost a 205 ms hitch at 4× CPU. A page holds ONE chapter: its twenty
 * folds strung on a serpentine path, the player's own figure glowing in every
 * fold they have made, the next one lit with Play, the rest ahead, dotted.
 * The chapter strip above turns the pages (so does a sideways swipe), and the
 * chapter card says where this twenty stands: its name, its stars, the two
 * reveals on the way through it.
 *
 * Night Fold (the B mock, `direction-B-4-levels.png`): constellation discs on
 * the sky, the path drawn as the player's own line is — warm light with a hot
 * core and a baked bloom — through the folds made, dotted beyond.
 *
 * RENDERING. Everything static is BAKED with Canvas2D (tech G2) and drawn as
 * Images, and there is no Phaser Text on the page at all: each Text is a
 * canvas of its own, and a page of them cost more at 4× than every bake here
 * together. A node is its own bake — the figure or maze, its stars, its
 * number — over a disc every node shares; the path's legs, the gifts and
 * that disc come from one KIT atlas painted once a session; the strip is one
 * bake kept between visits, the header one, the card one. Node bakes wait in
 * a small pool between visits (a win changes one node, not twenty) and are
 * painted after `create`, a few a frame, while the page fades in — so create
 * stays inside G13's 50 ms at 4× (see the handoff for the numbers).
 *
 * Input goes through ScrollView rather than per-node interactive objects,
 * because scrolling and tapping are the same gesture until the finger has
 * committed to one, and only the thing that owns the drag can tell them apart.
 */

import Phaser from 'phaser';
import { monetization } from '../config/monetization';
import { chapterName, chapterNumeral, chapterTiles, foldsLabel, frontierIndex, type ChapterTile } from '../core/Chapters';
import { boundsOf, mirrorPath, type Rect, type Vec2 } from '../core/Geometry';
import { Playfield } from '../core/Playfield';
import { CHAPTER_COUNT, chapterIndices, chapterOf, MARK_AT, markReward, type MarkAt } from '../core/Rewards';
import { thinPath } from '../core/Ribbon';
import { chapterStarStats, MAX_STARS, starsAt, type StarCount } from '../core/Stars';
import { closedFigure } from '../core/StrokeRecorder';
import { LEVELS } from '../data/levels';
import type { Level } from '../data/types';
import { Ads } from '../systems/Ads';
import { Haptics } from '../systems/Haptics';
import { Progress, type SavedFigure } from '../systems/Progress';
import { ELEVATION, paintElevation, paintInner, paintPanel, roundRectPath, softDisc } from '../render/Baked';
import type { CardLayout, CardMarker } from '../render/FigureCard';
import { icon, paintIcon, type IconName } from '../render/Icons';
import { paintMazeThumb } from '../render/MazeThumb';
import { listFade, ScrollView, type ScrollRow } from '../render/ScrollView';
import {
  bannerLine,
  BASE_HEIGHT,
  BASE_WIDTH,
  dp,
  FONT_DISPLAY,
  FONT_UI,
  hexCss,
  METRICS,
  MOTION,
  ms,
  pt,
  rgba,
  theme,
  ui,
  veiledInk,
  viewHeight,
} from '../render/Theme';
import { breathe, button, countText, enter, glassPanel, shieldInput, TYPE, watchHeight } from '../render/UI';

/** How long the card's reward line says why a locked fold did not open. */
const LOCKED_NOTE_MS = 1800;

export interface LevelSelectData {
  /**
   * Open on this level instead of the frontier: the one the player just left,
   * when they got there from this screen — see GameScene's back button.
   */
  focus?: number;
  /**
   * Open exactly here, without the entrance: this screen rebuilt for a new
   * world height (UI.watchHeight), showing the page, the rows and the strip
   * it showed.
   */
  scroll?: number;
  chapter?: number;
  strip?: number;
}

/* ================================================================ layout */

/**
 * The page's fixed measures, in base units: the B mock's points (402 wide)
 * through `dp`. Every screen is 750 wide, so x never changes between phones;
 * only the journey's window grows with the height.
 */
export const LV = {
  /** Side margin of cards and chips. */
  side: dp(16),
  /** The back button and the reveal chip, on one line under the safe top. */
  topRow: dp(24),
  back: dp(44),
  chipH: dp(36),
  /** "Levels", Georgia 34, and the totals pills on its line. */
  titleX: dp(20),
  titleRow: dp(72),
  titleSize: dp(34),
  pillH: dp(28),
  pillGap: dp(6),
  pillText: dp(13.5),
  /** The chapter strip: the band that takes its presses, and each tile's parts. */
  stripTop: dp(98),
  stripBottom: dp(180),
  tileY: dp(128),
  tileLabelY: dp(160),
  tileBarY: dp(173),
  tileDisc: dp(44),
  tilePitch: dp(60),
  tileFirst: dp(41),
  /** The chapter card. */
  cardTop: dp(186),
  cardH: dp(86),
  ringR: dp(25),
  ringW: dp(5),
  /** The journey window starts this far under the card. */
  windowGap: dp(8),
  /** Nodes: the disc, the current one's (×1.15), the rows and the three columns. */
  nodeD: dp(88),
  currentD: dp(101),
  rowPitch: dp(140),
  firstRow: dp(66),
  cols: [dp(71.6), dp(201), dp(330.4)] as readonly number[],
  /** How far past its column's centre a U-turn swings. */
  turnOut: dp(41),
  giftD: dp(40),
  /** Content under the last row: its label, and air above the window's end. */
  endPad: dp(72),
  /** The path's width, before its bloom. */
  pathW: dp(3.2),
} as const;

/**
 * Air between anything tappable and the banner's line: 8 pt ON THE GLASS
 * (CLAUDE.md), whatever the canvas scale — pt(8) is 8 pt only at 0.5, and
 * a narrow Split View pane draws the canvas smaller than that.
 */
export function bannerAir(basePerPoint: number): number {
  const design = pt(8);
  if (!Number.isFinite(basePerPoint) || basePerPoint <= 0) return design;
  return Math.max(design, Math.ceil(8 * basePerPoint));
}

/**
 * Where a browsing screen's list window ends: the canvas edge with no banner
 * (an ads-off build, a Remove Ads owner, no consent), else `bannerAir` above
 * the banner's line — a card under the native banner can be seen and never
 * tapped, and a thumb aimed at it presses the ad.
 */
export function windowBottom(height: number, bannerOn: boolean, basePerPoint: number): number {
  return bannerOn ? bannerLine(height) - bannerAir(basePerPoint) : height;
}

export interface LevelsLayout {
  /** The journey's window, screen space. */
  readonly top: number;
  readonly bottom: number;
  /** The chapter card's face, centred on (x, y). */
  readonly card: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

/**
 * The page for a world `height` tall. Pure (tech G6): everything above the
 * journey is fixed under the safe top, and the journey takes the rest — the
 * one flexible gap — down to the banner's air.
 */
export function levelsLayout(height: number, bannerOn: boolean, basePerPoint: number): LevelsLayout {
  const top = LV.cardTop + LV.cardH + LV.windowGap;
  const bottom = Math.max(top + LV.nodeD, windowBottom(height, bannerOn, basePerPoint));
  return {
    top,
    bottom,
    card: { x: BASE_WIDTH / 2, y: LV.cardTop + LV.cardH / 2, w: BASE_WIDTH - LV.side * 2, h: LV.cardH },
  };
}

export interface JourneyNode {
  readonly x: number;
  readonly y: number;
  readonly row: number;
  readonly col: number;
}

export interface JourneyGift {
  readonly x: number;
  readonly y: number;
  /** The marks this gift pays: 10 and 20 — both at the end of a short chapter. */
  readonly marks: readonly MarkAt[];
}

/** One stretch of path: between two folds on a row, or a U-turn down to the next row. */
export interface JourneyLeg {
  readonly from: Vec2;
  readonly to: Vec2;
  /** A U-turn's side: +1 swings right, −1 left; 0 is straight. */
  readonly turn: 1 | -1 | 0;
}

export interface Journey {
  readonly nodes: readonly JourneyNode[];
  readonly gifts: readonly JourneyGift[];
  /** Node to node, then the last node to the end gift when there is one. */
  readonly legs: readonly JourneyLeg[];
  readonly contentHeight: number;
}

/** Slot `s` of the serpentine: three to a row, turning at the ends. */
function slot(s: number): JourneyNode {
  const row = Math.floor(s / 3);
  const pos = s % 3;
  const col = row % 2 === 0 ? pos : 2 - pos;
  return { x: LV.cols[col], y: LV.firstRow + row * LV.rowPitch, row, col };
}

/**
 * The journey of a chapter of `size` folds, in content space (y = 0 at the
 * window's top). Pure.
 *
 * The folds run three to a row, left to right then back, and the chapter's
 * two reveals sit ON the path (SPEC §5.4): the halfway gift between folds 10
 * and 11 — on the straight between them, which the serpentine always puts on
 * one row — and the full one in the slot after the last fold. A chapter of
 * ten or fewer pays both at its end (Rewards.dueMarks), so it has one gift
 * holding both. `gifts` false (a Remove Ads owner) leaves them out.
 */
export function journeyLayout(size: number, gifts = true): Journey {
  const n = Math.max(0, Math.trunc(size));
  const nodes: JourneyNode[] = [];
  for (let k = 0; k < n; k++) nodes.push(slot(k));
  const out: JourneyGift[] = [];
  let end: JourneyNode | null = null;
  if (gifts && n > 0) {
    if (n > 10) {
      const a = nodes[9];
      const b = nodes[10];
      out.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, marks: [10] });
    }
    end = slot(n);
    out.push({ x: end.x, y: end.y, marks: n > 10 ? [20] : [10, 20] });
  }
  const stops = end ? [...nodes, end] : nodes;
  const legs: JourneyLeg[] = [];
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    legs.push({ from: a, to: b, turn: a.row === b.row ? 0 : a.col === 2 ? 1 : -1 });
  }
  const lastY = stops.length > 0 ? stops[stops.length - 1].y : LV.firstRow;
  return { nodes, gifts: out, legs, contentHeight: lastY + LV.nodeD / 2 + LV.endPad };
}

/**
 * What a fold's node shows:
 *  - `current`  the frontier, not yet made: its maze, lit, with Play
 *  - `cleared`  made: the player's own figure and its stars
 *  - `open`     let past without clearing (a skip): its maze, playable
 *  - `locked`   beyond the frontier: a lock
 */
export type NodeKind = 'cleared' | 'current' | 'open' | 'locked';

export function nodeKind(index: number, cleared: boolean, unlockedIndex: number, frontier: number): NodeKind {
  if (index === frontier && !cleared) return 'current';
  if (cleared) return 'cleared';
  return index <= unlockedIndex ? 'open' : 'locked';
}

/**
 * How many legs of the path are drawn solid — the rest are dotted. Solid up
 * to the fold being played next; a chapter already behind the frontier is
 * solid to its end, one ahead of it dotted from its start.
 */
export function solidLegs(
  chapterStart: number,
  size: number,
  legCount: number,
  frontier: number,
  allCleared: boolean
): number {
  if (allCleared || frontier >= chapterStart + size) return legCount;
  if (frontier < chapterStart) return 0;
  return Math.min(legCount, frontier - chapterStart);
}

/**
 * How far to scroll so the fold at content y `at` shows whole, Play and all,
 * with as much of the way behind it as the window holds: the made folds are
 * the page's picture, and what is ahead is dotted and locked.
 */
export function openOffset(at: number, windowH: number, range: number): number {
  const need = at + LV.currentD / 2 + dp(56);
  return Math.max(0, Math.min(range, Math.round(need - windowH)));
}

/** The newest saved figure for every level id: a node shows the player's latest line. */
export function latestFigures(figures: readonly SavedFigure[]): Map<string, SavedFigure> {
  const out = new Map<string, SavedFigure>();
  for (const f of figures) {
    const had = out.get(f.levelId);
    if (!had || f.at >= had.at) out.set(f.levelId, f);
  }
  return out;
}

/** One of a chapter's two marks, as its card and its gift show it. */
export interface ChapterReward {
  readonly at: MarkAt;
  readonly reward: number;
  readonly paid: boolean;
  /** The fold it is paid at: 10 and 20, or a short chapter's end. */
  readonly fold: number;
}

/**
 * Chapter `c`'s two reveals — "+1 at 10", "+2 at 20" — and which are paid.
 * `size` is the chapter's level count: a short last chapter pays both at its
 * end, the rule `dueMarks` pays by. Nothing for an owner of Remove Ads: their
 * reveals are already unlimited, so a marker would promise nothing.
 */
export function chapterRewards(
  c: number,
  size: number,
  paid: ReadonlySet<string>,
  owner: boolean,
  cfg: { halfReward: number; fullReward: number } = monetization.economy.chapter
): ChapterReward[] {
  if (owner) return [];
  return MARK_AT.map((at) => {
    const mark = `${c}:${at}`;
    return { at, reward: markReward(mark, cfg), paid: paid.has(mark), fold: Math.min(at, size) };
  });
}

/**
 * The NEXT of chapter `c`'s two marks still unpaid — "+1 at 10" until `c:10`
 * is paid, then "+2 at 20" — and nothing once both are paid or for an owner.
 */
export function chapterMarker(
  c: number,
  size: number,
  paid: ReadonlySet<string>,
  owner: boolean,
  cfg: { halfReward: number; fullReward: number } = monetization.economy.chapter
): string | null {
  const next = chapterRewards(c, size, paid, owner, cfg).find((r) => !r.paid);
  return next ? `+${next.reward} at ${next.fold}` : null;
}

/** The label under a strip tile: "7/20", or "61+" for a chapter not reached. */
export function tileLabel(tile: ChapterTile): string {
  return tile.status === 'locked' ? `${tile.first}+` : `${tile.cleared}/${tile.size}`;
}

/** The strip's tiles, all of them, baked into one image this wide. */
export const stripWidth = (count: number): number => LV.tileFirst * 2 + Math.max(0, count - 1) * LV.tilePitch;

/* ================================================================ figures */

/** A saved run placed in a box, ready to paint: the Levels disc and the Gallery print share it. */
export interface FigureArt {
  readonly scale: number;
  readonly axis: { readonly x: number; readonly top: number; readonly bottom: number } | null;
  readonly walls: readonly Rect[];
  readonly wallRadius: number;
  readonly markers: readonly CardMarker[];
  /** The closed figure: the line and its reflection joined into one silhouette. */
  readonly outline: readonly Vec2[];
  readonly line: readonly Vec2[];
  readonly mirror: readonly Vec2[];
}

/** The share card's layout (FigureCard), as a print paints it: the whole maze. */
export function cardArt(L: CardLayout): FigureArt {
  return {
    scale: L.scale,
    axis: L.axis,
    walls: L.walls,
    wallRadius: L.wallRadius,
    markers: L.markers,
    outline: L.outline,
    line: L.stroke.points,
    mirror: L.mirrored.points,
  };
}

/**
 * A figure fitted to its OWN bounds inside `box` — a disc shows the figure,
 * not the maze. From the saved samples as they are: at a disc's scale the
 * render smoothing is under a pixel and not worth its cost on a page of
 * twenty. Null for a figure with nothing to draw.
 */
/** How much of a node's radius its figure may reach from the centre (the mock's ~78% inset, less the rings). */
export const NODE_ART_R = 0.74;

/**
 * The box a figure is drawn into so its WHOLE bounds sit inside a circle of
 * radius `r` about (cx, cy): the figure's own aspect, half-diagonal `r`.
 */
export function discArtBox(figure: Pick<SavedFigure, 'points'>, cx: number, cy: number, r: number): Rect {
  const pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset);
  const raw = figure.points.map((p) => pf.toScreen(p));
  const b = raw.length >= 2 ? boundsOf(closedFigure(raw, pf.axisX)) : null;
  const w = Math.max(1, b?.w ?? 1);
  const h = Math.max(1, b?.h ?? 1);
  const k = r / Math.hypot(w / 2, h / 2);
  return { x: cx - (w * k) / 2, y: cy - (h * k) / 2, w: w * k, h: h * k };
}

export function discArt(figure: Pick<SavedFigure, 'points'>, box: Rect): FigureArt | null {
  const pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset);
  const raw = figure.points.map((p) => pf.toScreen(p));
  if (raw.length < 2) return null;
  const outline = closedFigure(raw, pf.axisX);
  const b = boundsOf(outline);
  if (!b || (b.w <= 0 && b.h <= 0)) return null;
  const scale = Math.min(box.w / Math.max(b.w, 1), box.h / Math.max(b.h, 1));
  const ox = box.x + box.w / 2 - (b.x + b.w / 2) * scale;
  const oy = box.y + box.h / 2 - (b.y + b.h / 2) * scale;
  const place = (p: Vec2): Vec2 => ({ x: p.x * scale + ox, y: p.y * scale + oy });
  return {
    scale,
    axis: { x: pf.axisX * scale + ox, top: box.y - box.h * 0.04, bottom: box.y + box.h * 1.04 },
    walls: [],
    wallRadius: 0,
    markers: [],
    outline: outline.map(place),
    line: raw.map(place),
    mirror: mirrorPath(raw, pf.axisX).map(place),
  };
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
}

function polyline(ctx: CanvasRenderingContext2D, pts: readonly Vec2[], width: number, style: string): void {
  if (pts.length === 0 || !(width > 0)) return;
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  // A single point still leaves a round dot.
  if (pts.length === 1) ctx.lineTo(pts[0].x + 0.01, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

export interface FigureArtOptions {
  /** The line's width in the bake, before its bloom. */
  readonly lineWidth: number;
  /** Paint the maze's walls (a gallery print); a Levels disc shows the figure alone. */
  readonly walls?: boolean;
  /**
   * `card`: the maze's start and goal where the layout puts them (a print);
   * `ends`: a dot where the line and its reflection start, a ring where they
   * meet (the disc, which has no maze to place them in).
   */
  readonly markers?: 'card' | 'ends';
  /** How warm the glow pooled in the figure is, 1 the print's; a small disc wants more. */
  readonly glow?: number;
}

/**
 * A saved run in Night Fold, painted with Canvas2D into a bake — the one
 * picture of a player's figure the browsing screens share: a Levels node,
 * a Gallery print.
 *
 * The line is the stroke's own token set, as the board draws it: tangerine
 * light with a hot core and the two baked bloom passes, the reflection one
 * opaque pass of moonlight (Theme `line`, `lineCore`, `lineBloom`, `mirror`).
 * Each pass is ONE stroked path, so a translucent bloom never beads where the
 * line crosses itself. At these sizes the ribbon's width profile is under a
 * pixel, so the line is drawn at an even width through its thinned samples.
 * The closed figure holds a warm glow: lamp light pooled where the fold met.
 */
export function paintFigureArt(ctx: CanvasRenderingContext2D, art: FigureArt, o: FigureArtOptions): void {
  const t = theme();
  const u = ui();
  const w = o.lineWidth;
  const mirror = t.mirror ?? veiledInk(t.line, t);
  ctx.save();

  if (art.axis) {
    // The crease, not the old dashed axis: a dark hairline beside a light one.
    const h = art.axis.bottom - art.axis.top;
    ctx.fillStyle = rgba(u.creaseDark, u.creaseDarkAlpha * 0.6);
    ctx.fillRect(art.axis.x - 1, art.axis.top, 1, h);
    ctx.fillStyle = rgba(u.creaseLight, u.creaseLightAlpha * 1.4);
    ctx.fillRect(art.axis.x, art.axis.top, 1, h);
  }

  if (o.walls) {
    for (const wall of art.walls) {
      const r = Math.min(art.wallRadius, wall.w / 2, wall.h / 2);
      // A lit rim on a wall thick enough to show one, then the slate face
      // inset from the top-left: the board's raised tile, in miniature.
      const rim = wall.w > 2.4 && wall.h > 2.4;
      if (rim) {
        ctx.fillStyle = hexCss(t.wallRim);
        roundRectPath(ctx, wall.x, wall.y, wall.w, wall.h, r);
        ctx.fill();
      }
      const inset = rim ? 0.8 : 0;
      ctx.fillStyle = hexCss(t.wall);
      roundRectPath(ctx, wall.x + inset, wall.y + inset, wall.w - inset, wall.h - inset, Math.max(0, r - inset));
      ctx.fill();
    }
  }

  if (o.markers === 'card') {
    for (const m of art.markers) {
      const r = (m.kind === 'start' ? METRICS.startRadius : METRICS.goalRadius) * art.scale;
      if (m.kind === 'start') {
        ctx.fillStyle = hexCss(m.mirror ? t.veil : t.accent);
        circle(ctx, m.p.x, m.p.y, Math.max(1.2, r));
        ctx.fill();
      } else {
        ctx.strokeStyle = hexCss(m.mirror ? t.veil : t.accentText);
        ctx.lineWidth = Math.max(1, METRICS.goalRingWidth * art.scale);
        circle(ctx, m.p.x, m.p.y, Math.max(2, r));
        ctx.stroke();
      }
    }
  }

  // The warm glow inside the closed figure.
  const b = boundsOf(art.outline);
  if (b && art.outline.length > 2) {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h * 0.55;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(b.w, b.h) * 0.62);
    // Gone by the edge, so the closing seams at the start and the goal
    // never draw a box around the figure.
    const k = o.glow ?? 1;
    g.addColorStop(0, rgba(t.accent, 0.3 * k));
    g.addColorStop(0.55, rgba(t.accent, 0.1 * k));
    g.addColorStop(1, rgba(t.accent, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(art.outline[0].x, art.outline[0].y);
    for (let i = 1; i < art.outline.length; i++) ctx.lineTo(art.outline[i].x, art.outline[i].y);
    ctx.closePath();
    ctx.fill();
  }

  const span = Math.max(8, w * 5);
  const thin = (pts: readonly Vec2[]): Vec2[] => thinPath(pts, span, 0.3).map((i) => pts[i]);
  const line = thin(art.line);
  const refl = thin(art.mirror);

  polyline(ctx, refl, w * 2.6, rgba(mirror, 0.1));
  polyline(ctx, refl, w, hexCss(mirror));
  for (const pass of t.lineBloom) polyline(ctx, line, w * pass.width, rgba(t.line, pass.alpha));
  polyline(ctx, line, w, hexCss(t.line));
  polyline(ctx, line, Math.max(0.8, w * t.lineCoreWidth), hexCss(t.lineCore));

  if (o.markers === 'ends' && line.length > 1 && refl.length > 1) {
    const dotR = w * 1.35;
    ctx.fillStyle = hexCss(mirror);
    circle(ctx, refl[0].x, refl[0].y, dotR);
    ctx.fill();
    ctx.fillStyle = hexCss(t.accent);
    circle(ctx, line[0].x, line[0].y, dotR);
    ctx.fill();
    const endL = line[line.length - 1];
    const endR = refl[refl.length - 1];
    ctx.lineWidth = Math.max(1, w * 0.55);
    ctx.strokeStyle = hexCss(mirror);
    circle(ctx, endR.x, endR.y, w * 1.6);
    ctx.stroke();
    ctx.strokeStyle = hexCss(t.lineCore);
    circle(ctx, endL.x, endL.y, w * 1.6);
    ctx.stroke();
  }
  ctx.restore();
}

/* ================================================================ words */

interface Ink {
  readonly size: number;
  readonly color: number;
  readonly weight?: 400 | 500 | 600 | 700;
  readonly display?: boolean;
  /** Caps tracking, base units: letters set one by one, as Phaser's letterSpacing does. */
  readonly tracking?: number;
  readonly align?: 'left' | 'center' | 'right';
}

const fontOf = (o: Ink): string =>
  o.display ? `400 ${o.size}px ${FONT_DISPLAY}` : `${o.weight ?? 600} ${o.size}px ${FONT_UI}`;

/*
 * Measuring is a layout, and a first measurement of every word on a page was
 * a seventh of the first visit's create at 4×. So widths are remembered, and
 * measured on one scratch context that keeps its font. A bake's own context
 * is always given its font afresh: Phaser pools canvases, and a pooled canvas
 * resized for a new bake has its font reset under any cache of it.
 */
const widths = new Map<string, number>();
let scratchFont = '';

function widthOf(font: string, text: string): number {
  const key = `${font}|${text}`;
  let w = widths.get(key);
  if (w === undefined) {
    const m = measureCtx();
    if (!m) return text.length * 8;
    if (scratchFont !== font) {
      m.font = font;
      scratchFont = font;
    }
    w = m.measureText(text).width;
    widths.set(key, w);
  }
  return w;
}

/** How wide `text` sets in `o`, tracking included. */
function measure(text: string, o: Ink): number {
  const font = fontOf(o);
  if (!o.tracking) return widthOf(font, text);
  let w = 0;
  for (const ch of text) w += widthOf(font, ch);
  return w + o.tracking * Math.max(0, [...text].length - 1);
}

/**
 * Set a line of words into a bake, vertically centred on y: the kit's `label`
 * for a baked surface — the same stacks, the same caps tracking. Only tracked
 * words are measured (their letters are set one by one); the rest let the
 * canvas align them, since a first measurement of every word on a page cost
 * more at 4× than painting them.
 */
function words(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, o: Ink): void {
  const font = fontOf(o);
  ctx.font = font;
  ctx.fillStyle = hexCss(o.color);
  ctx.textBaseline = 'middle';
  if (!o.tracking) {
    ctx.textAlign = o.align ?? 'left';
    ctx.fillText(text, x, y);
    return;
  }
  const w = measure(text, o);
  let at = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
  ctx.textAlign = 'left';
  for (const ch of text) {
    ctx.fillText(ch, at, y);
    at += widthOf(font, ch) + o.tracking;
  }
}

/** One part of a line of marks and words: "★ 17 of 60", "👁 +1 at 10". */
export interface InlinePart {
  readonly icon?: IconName;
  readonly iconColor?: number;
  readonly text?: string;
  readonly color?: number;
}

const INLINE = { icon: dp(15), gapAfterIcon: dp(5), gapAfterText: dp(3), between: dp(12) };

/**
 * Lay a run of parts along y from x (or just measure it, with `paint`
 * false): an icon, then its words, and a gap before the next group — a
 * group starts at every part with an icon.
 */
function inline(
  ctx: CanvasRenderingContext2D,
  parts: readonly InlinePart[],
  x: number,
  y: number,
  size: number,
  paint = true
): number {
  let at = x;
  parts.forEach((part, i) => {
    if (part.icon) {
      if (i > 0) at += INLINE.between - INLINE.gapAfterText;
      if (paint) paintIcon(ctx, part.icon, at + INLINE.icon / 2, y, INLINE.icon, hexCss(part.iconColor ?? ui().text2));
      at += INLINE.icon + INLINE.gapAfterIcon;
    }
    if (part.text) {
      const o: Ink = { size, color: part.color ?? ui().text, weight: 600 };
      if (paint) words(ctx, part.text, at, y, o);
      at += measure(part.text, o) + INLINE.gapAfterText;
    }
  });
  return at - x - (parts.length > 0 && parts[parts.length - 1].text ? INLINE.gapAfterText : 0);
}

/** The glass pill's inner padding, each side. */
const PILL_PAD = dp(11);

/**
 * A glass pill that shows counts — "62 /300", "★ 131", the reveal balance —
 * painted into a bake with its right edge at `right`, centred on y, `h`
 * tall. Not a button: it only tells. Returns its width.
 */
export function paintPill(
  ctx: CanvasRenderingContext2D,
  right: number,
  y: number,
  parts: readonly InlinePart[],
  h: number = LV.pillH
): number {
  const size = h >= LV.chipH ? TYPE.label : LV.pillText;
  const w = Math.ceil(inline(ctx, parts, 0, 0, size, false) + PILL_PAD * 2);
  paintPanel(ctx, right - w, y - h / 2, w, h, { radius: h / 2, face: { kind: 'glass' }, elevation: 'e1' });
  inline(ctx, parts, right - w + PILL_PAD, y, size);
  return w;
}

/** What a browsing screen's header shows besides its title: a chip on the top line, pills on the title's. */
export interface HeaderPills {
  /** The reveal balance, say, on the back button's line at the right. */
  readonly top?: readonly InlinePart[];
  /** Right to left on the title's line. */
  readonly row: readonly (readonly InlinePart[])[];
}

/** How tall the header's bake is: down past the title's pills and their shadow. */
export const HEADER_H = LV.titleRow + LV.pillH / 2 + dp(16);

/**
 * Paint a browsing screen's header — the title in Georgia and the pills —
 * into a bake `BASE_WIDTH` × HEADER_H. The ‹ is a live button over it.
 */
export function paintHeader(ctx: CanvasRenderingContext2D, title: string, pills: HeaderPills): void {
  const u = ui();
  words(ctx, title, LV.titleX, LV.titleRow + dp(1), { size: LV.titleSize, display: true, color: u.text });
  if (pills.top) paintPill(ctx, BASE_WIDTH - LV.side, LV.topRow, pills.top, LV.chipH);
  let right = BASE_WIDTH - LV.side;
  for (const parts of pills.row) right -= paintPill(ctx, right, LV.titleRow, parts) + LV.pillGap;
}

/**
 * The top of a browsing screen in Night Fold: a round glass ‹ on the left,
 * the title in Georgia under it, the counts in glass pills to its right.
 * Levels and Gallery wear the same one, so moving between them never makes
 * the header jump. The words and pills are ONE bake (per visit): a Phaser
 * Text each cost more at 4× than the whole bake.
 */
export function browseHeader(
  scene: Phaser.Scene,
  title: string,
  onBack: () => void,
  pills: HeaderPills
): { back: Phaser.GameObjects.Container; head: Phaser.GameObjects.Image } {
  const back = button(scene, LV.side + LV.back / 2, LV.topRow, '', {
    width: LV.back,
    height: LV.back,
    variant: 'secondary',
    minTap: true,
    onPress: onBack,
  });
  back.add(icon(scene, -dp(1), 0, 'back', { size: dp(24), color: ui().text }));
  if (scene.textures.exists(HEADER_KEY)) scene.textures.remove(HEADER_KEY);
  const tex = scene.textures.createCanvas(HEADER_KEY, BASE_WIDTH, Math.ceil(HEADER_H));
  if (tex) {
    paintHeader(tex.getContext(), title, pills);
    tex.refresh();
  }
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    if (scene.textures.exists(HEADER_KEY)) scene.textures.remove(HEADER_KEY);
  });
  const head = scene.add.image(0, 0, HEADER_KEY).setOrigin(0, 0);
  // Under the ‹, which is drawn over its corner of the bake.
  back.setDepth(1);
  return { back, head };
}

const HEADER_KEY = 'fw-browse-header';

/* ================================================================ bakes */

/** A fold's node, as a bake needs to know it. */
export interface NodeSpec {
  readonly kind: NodeKind;
  readonly number: number;
  readonly stars: StarCount;
  readonly level: Level;
  /** The player's latest figure for this fold, if the gallery still keeps one. */
  readonly figure?: SavedFigure;
}

/**
 * A node's bake: its content box and where the disc's centre sits in it.
 * The fold to play bakes whole (its glow, its ring, Play) in the larger box;
 * every other node bakes only what is its own — figure or maze, stars,
 * number — over the one disc they all share (the kit's `node-base`).
 */
export const NODE_BOX = { w: dp(92), h: dp(124), cx: dp(46), cy: dp(46) } as const;
export const CURRENT_BOX = { w: dp(134), h: dp(150), cx: dp(67), cy: dp(64) } as const;

export const nodeBox = (kind: NodeKind): typeof NODE_BOX | typeof CURRENT_BOX =>
  kind === 'current' ? CURRENT_BOX : NODE_BOX;

/** Whether a node sits on the shared disc: all but the one to play (whole) and a locked one (sunk). */
export const onBase = (kind: NodeKind): boolean => kind === 'cleared' || kind === 'open';

/** The pool key of a node's bake: everything the bake shows, and nothing else. */
export function nodeKey(s: NodeSpec): string {
  const fig = s.kind === 'cleared' ? (s.figure ? `f${s.figure.at}` : 'm') : '';
  return `fw-node-${s.level.id}-${s.number}-${s.kind}-${s.stars}${fig}`;
}

/** `color` blended toward `over` by `a`. */
function mix(color: number, over: number, a: number): number {
  const ch = (s: number): number => {
    const c = (color >> s) & 0xff;
    return Math.round(c + (((over >> s) & 0xff) - c) * a) & 0xff;
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** The disc every made or open node sits on: a small dark board under the lamp, lifted (e2). */
export function paintNodeBase(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number = LV.nodeD / 2): void {
  const t = theme();
  const u = ui();
  paintElevation(ctx, cx - R, cy - R, R * 2, R * 2, R, ELEVATION.e2);
  // The face, lighter toward the lamp at the top-left.
  const g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.45, R * 0.1, cx, cy, R * 1.05);
  g.addColorStop(0, hexCss(mix(t.boardCentre, u.glass, 0.07)));
  g.addColorStop(1, hexCss(t.board));
  circle(ctx, cx, cy, R);
  ctx.fillStyle = g;
  ctx.fill();
}

/**
 * Paint a node's own part into `ctx` with its disc centred at (cx, cy).
 *
 * Inside the disc: the player's own figure for a fold they made, else the
 * maze — at 0.55 for a cleared fold whose figure the gallery no longer keeps
 * (SPEC §5.4), full for a skipped one. Under a made fold, its three stars on
 * a pill across the rim and its number; a gilt rim at ★★★. A fold ahead is
 * sunk, with a lock. The fold to play is painted whole: a size larger, its
 * lamp, the maze, a tangerine ring and Play.
 */
export function paintNode(ctx: CanvasRenderingContext2D, s: NodeSpec, cx: number, cy: number): void {
  const t = theme();
  const u = ui();
  const current = s.kind === 'current';
  const R = (current ? LV.currentD : LV.nodeD) / 2;

  if (s.kind === 'locked') {
    // Sunk into the sky: a faint well, its inner shadow, a lock in a hollow.
    circle(ctx, cx, cy, R);
    ctx.fillStyle = rgba(u.well, 0.42);
    ctx.fill();
    paintInner(ctx, cx - R, cy - R, R * 2, R * 2, R, 0.3);
    ctx.strokeStyle = rgba(u.glass, 0.05);
    ctx.lineWidth = 1.5;
    circle(ctx, cx, cy, R - 0.75);
    ctx.stroke();
    circle(ctx, cx, cy, dp(17));
    ctx.fillStyle = rgba(u.well, 0.9);
    ctx.fill();
    paintIcon(ctx, 'lock', cx, cy, dp(18), hexCss(u.text3));
  } else {
    if (current) {
      // The lamp around the fold to play; the breathing halo is a live disc under it.
      ctx.save();
      ctx.shadowColor = rgba(t.accent, 0.55);
      ctx.shadowBlur = dp(16);
      circle(ctx, cx, cy, R);
      ctx.fillStyle = hexCss(t.board);
      ctx.fill();
      ctx.restore();
      const g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.45, R * 0.1, cx, cy, R * 1.05);
      g.addColorStop(0, hexCss(mix(t.boardCentre, u.glass, 0.07)));
      g.addColorStop(1, hexCss(t.board));
      circle(ctx, cx, cy, R);
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.save();
    circle(ctx, cx, cy, R - 1);
    ctx.clip();
    const art =
      s.kind === 'cleared' && s.figure
        ? // Inside a circle 0.74 of the disc's, a little high — clear of the
          // rim and of the star pill across its bottom. Fitted to a box the
          // figure's corners reached the rim, and the goal rings at its top
          // poked out of the disc (QA; the mock insets it to about 78%).
          discArt(s.figure, discArtBox(s.figure, cx, cy - R * 0.06, R * NODE_ART_R))
        : null;
    if (art) {
      paintFigureArt(ctx, art, { lineWidth: dp(2.5), markers: 'ends', glow: 1.35 });
    } else {
      const mw = R * 1.24;
      const mh = R * 1.56;
      ctx.globalAlpha = s.kind === 'cleared' ? 0.55 : 1;
      paintMazeThumb(ctx, s.level, cx - mw / 2, cy - mh / 2, mw, mh, { frame: false });
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // The rim: a lit hairline, gold at ★★★, the tangerine ring on the fold to play.
    const rimW = current ? dp(3) : s.stars === MAX_STARS ? dp(2) : 1.5;
    ctx.lineWidth = rimW;
    ctx.strokeStyle = current
      ? hexCss(t.accent)
      : s.stars === MAX_STARS
        ? rgba(t.medal, 0.9)
        : rgba(u.glass, s.kind === 'open' ? 0.16 : 0.1);
    circle(ctx, cx, cy, R - rimW / 2);
    ctx.stroke();
  }

  if (current) {
    // Play, on a tangerine tab under the disc.
    const pw = dp(60);
    const ph = dp(28);
    const py = cy + R + dp(10);
    ctx.save();
    ctx.shadowColor = rgba(t.accent, 0.5);
    ctx.shadowBlur = dp(12);
    ctx.shadowOffsetY = dp(3);
    roundRectPath(ctx, cx - pw / 2, py - ph / 2, pw, ph, ph / 2);
    const pg = ctx.createLinearGradient(0, py - ph / 2, 0, py + ph / 2);
    pg.addColorStop(0, hexCss(u.accentTop));
    pg.addColorStop(1, hexCss(u.accentBottom));
    ctx.fillStyle = pg;
    ctx.fill();
    ctx.restore();
    words(ctx, 'Play', cx, py + 0.5, { size: dp(15), weight: 700, color: u.onAccent, align: 'center' });
    return;
  }

  if (s.kind === 'cleared') {
    // Three stars on a pill across the bottom of the rim: what the line earned.
    const pw = dp(50);
    const ph = dp(17);
    const py = cy + R - dp(1);
    roundRectPath(ctx, cx - pw / 2, py - ph / 2, pw, ph, ph / 2);
    ctx.fillStyle = hexCss(u.sheet);
    ctx.fill();
    ctx.strokeStyle = rgba(u.glass, 0.1);
    ctx.lineWidth = 1;
    ctx.stroke();
    for (let i = 0; i < MAX_STARS; i++) {
      const earned = i < s.stars;
      paintIcon(
        ctx,
        earned ? 'star' : 'starOutline',
        cx + (i - 1) * dp(14),
        py,
        dp(12),
        hexCss(earned ? t.medal : u.text3),
        earned ? undefined : 2.2
      );
    }
  }

  words(ctx, String(s.number), cx, cy + R + dp(s.kind === 'cleared' ? 22 : 16), {
    size: dp(14),
    color: s.kind === 'locked' ? u.text3 : u.text2,
    align: 'center',
  });
}

/**
 * One leg of the path, in the leg's own content space: the player's line —
 * tangerine light, its bloom, its core — or, `solid` false, cream dots.
 */
export function paintLeg(ctx: CanvasRenderingContext2D, leg: JourneyLeg, solid: boolean): void {
  const t = theme();
  const u = ui();
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(leg.from.x, leg.from.y);
  if (leg.turn === 0) {
    ctx.lineTo(leg.to.x, leg.to.y);
  } else {
    // A half circle out past the column: its far side `turnOut` beyond the
    // centre, its ends under the two discs it joins.
    const R = (leg.to.y - leg.from.y) / 2;
    const cx = leg.from.x + leg.turn * (LV.turnOut - R);
    ctx.lineTo(cx, leg.from.y);
    ctx.arc(cx, leg.from.y + R, R, -Math.PI / 2, Math.PI / 2, leg.turn < 0);
    ctx.lineTo(leg.to.x, leg.to.y);
  }
  const stroke = (width: number, style: string): void => {
    ctx.lineWidth = width;
    ctx.strokeStyle = style;
    ctx.stroke();
  };
  if (solid) {
    for (const pass of t.lineBloom) stroke(LV.pathW * pass.width, rgba(t.line, pass.alpha));
    stroke(LV.pathW, hexCss(t.line));
    stroke(LV.pathW * t.lineCoreWidth, hexCss(t.lineCore));
  } else {
    // Dotted: a round dot, then air — the way still to go.
    ctx.setLineDash([0.01, dp(8)]);
    stroke(dp(2.4), rgba(u.text, 0.26));
  }
  ctx.restore();
}

/** The three shapes a leg can take — every straight is one column apart, every turn a row down. */
export type LegShape = 'straight' | 'right' | 'left';

export const legShape = (leg: JourneyLeg): LegShape => (leg.turn === 0 ? 'straight' : leg.turn > 0 ? 'right' : 'left');

/**
 * A leg of each shape, from a node at the origin, and the box a bake of it
 * needs (x, y from that node's centre). Every leg a journey has is one of
 * these, moved — which a test holds it to.
 */
export function legBox(shape: LegShape): { leg: JourneyLeg; x: number; y: number; w: number; h: number } {
  const pad = Math.ceil(LV.pathW * 2);
  const pitch = LV.cols[1] - LV.cols[0];
  if (shape === 'straight') {
    return { leg: { from: { x: 0, y: 0 }, to: { x: pitch, y: 0 }, turn: 0 }, x: 0, y: -pad, w: pitch, h: pad * 2 };
  }
  const R = LV.rowPitch / 2;
  const s = shape === 'right' ? 1 : -1;
  // How far the half circle's centre sits inside the column.
  const inner = R - LV.turnOut;
  const leg: JourneyLeg = { from: { x: 0, y: 0 }, to: { x: 0, y: LV.rowPitch }, turn: s };
  const x = s > 0 ? -inner - pad : -LV.turnOut - pad;
  return { leg, x, y: -pad, w: inner + LV.turnOut + pad * 2, h: LV.rowPitch + pad * 2 };
}

/** A gift on the path: waiting (ember, lit) or paid (quiet, checked). */
function paintGift(ctx: CanvasRenderingContext2D, c: Vec2, paid: boolean): void {
  const t = theme();
  const u = ui();
  const r = LV.giftD / 2;
  ctx.save();
  ctx.shadowColor = paid ? 'rgba(0,0,0,0.5)' : rgba(t.accent, 0.45);
  ctx.shadowBlur = dp(paid ? 8 : 12);
  circle(ctx, c.x, c.y, r);
  ctx.fillStyle = hexCss(u.sheet);
  ctx.fill();
  ctx.restore();
  if (!paid) {
    circle(ctx, c.x, c.y, r);
    ctx.fillStyle = rgba(t.accent, t.accentWash);
    ctx.fill();
  }
  const lw = paid ? 1.5 : dp(1.6);
  ctx.lineWidth = lw;
  ctx.strokeStyle = paid ? rgba(u.glass, 0.12) : rgba(t.accent, 0.8);
  circle(ctx, c.x, c.y, r - lw / 2);
  ctx.stroke();
  paintIcon(ctx, paid ? 'check' : 'gift', c.x, c.y, dp(20), hexCss(paid ? u.text3 : t.accentText));
}

/** "+1 reveal" over a waiting gift. */
export const giftText = (reward: number): string => `+${reward} ${reward === 1 ? 'reveal' : 'reveals'}`;

/**
 * The page's KIT: every piece that is the same on every page — the four leg
 * bakes (a left turn is a right one mirrored), the two gifts and their
 * words, the disc under a node, the strip's page marker — painted once into
 * ONE atlas for the session (1024 wide, under 2 MB). One canvas and one
 * upload instead of a dozen: at 4× each canvas cost about half a millisecond
 * just to exist.
 */
interface KitItem {
  readonly name: string;
  readonly w: number;
  readonly h: number;
  /** The anchor (a node's centre, a leg's start) inside the item. */
  readonly ax: number;
  readonly ay: number;
  readonly paint: (ctx: CanvasRenderingContext2D, anchor: Vec2) => void;
}

const KIT_KEY = 'fw-levels-kit';
const KIT_W = 1024;

function kitItems(): KitItem[] {
  const items: KitItem[] = [];
  // A left turn is a right turn in a mirror: it is drawn flipped (`legImage`).
  for (const shape of ['straight', 'right'] as const) {
    const b = legBox(shape);
    for (const solid of [true, false]) {
      items.push({
        name: `leg-${shape}-${solid ? 's' : 'd'}`,
        w: Math.ceil(b.w),
        h: Math.ceil(b.h),
        ax: -b.x,
        ay: -b.y,
        paint: (ctx, a) => {
          ctx.save();
          ctx.translate(a.x, a.y);
          paintLeg(ctx, b.leg, solid);
          ctx.restore();
        },
      });
    }
  }
  const giftSide = LV.giftD + dp(14) * 2;
  for (const paid of [false, true]) {
    items.push({
      name: paid ? 'gift-paid' : 'gift-pending',
      w: giftSide,
      h: giftSide,
      ax: giftSide / 2,
      ay: giftSide / 2,
      paint: (ctx, a) => paintGift(ctx, a, paid),
    });
  }
  const { halfReward, fullReward } = monetization.economy.chapter;
  const ink: Ink = { size: dp(13), weight: 600, color: theme().accentText, align: 'center' };
  for (const reward of new Set([halfReward, fullReward, halfReward + fullReward])) {
    const text = giftText(reward);
    const w = Math.ceil(measure(text, ink) + 4);
    const h = Math.ceil(dp(18));
    items.push({ name: `gift-label-${reward}`, w, h, ax: w / 2, ay: h / 2, paint: (ctx, a) => words(ctx, text, a.x, a.y, ink) });
  }
  const R = LV.nodeD / 2;
  const reach = dp(22);
  items.push({
    name: 'node-base',
    w: LV.nodeD + reach * 2,
    h: LV.nodeD + reach + dp(40),
    ax: R + reach,
    ay: R + dp(6),
    paint: (ctx, a) => paintNodeBase(ctx, a.x, a.y),
  });
  const bw = dp(18);
  const bh = dp(3);
  items.push({
    name: 'bar',
    w: bw + 2,
    h: bh + 2,
    ax: bw / 2 + 1,
    ay: bh / 2 + 1,
    paint: (ctx, a) => {
      roundRectPath(ctx, a.x - bw / 2, a.y - bh / 2, bw, bh, bh / 2);
      ctx.fillStyle = hexCss(ui().text);
      ctx.fill();
    },
  });
  return items;
}

/**
 * Shelf-pack `items` into rows `width` wide, tallest first (so a row is as
 * tall as its first item and no taller); returns each item's top-left, in
 * the order given, and the atlas height. Every pixel of the atlas is
 * uploaded, so the empty ones count.
 */
export function packKit(items: readonly { w: number; h: number }[], width = KIT_W): { at: Vec2[]; height: number } {
  const order = items.map((_, i) => i).sort((a, b) => items[b].h - items[a].h);
  const at: Vec2[] = new Array(items.length);
  let x = 0;
  let y = 0;
  let row = 0;
  for (const i of order) {
    const it = items[i];
    if (x > 0 && x + it.w > width) {
      x = 0;
      y += row + 2;
      row = 0;
    }
    at[i] = { x, y };
    x += it.w + 2;
    row = Math.max(row, it.h);
  }
  return { at, height: y + row };
}

/** The kit's anchors, by frame name: an Image's origin puts the anchor on its position. */
const kitAnchors = new Map<string, { ox: number; oy: number }>();

/** Paint the kit once per session (or again, after a context loss took it). */
function ensureKit(scene: Phaser.Scene): void {
  if (scene.textures.exists(KIT_KEY)) return;
  const items = kitItems();
  const { at, height } = packKit(items);
  const tex = scene.textures.createCanvas(KIT_KEY, KIT_W, Math.ceil(height) + 1);
  if (!tex) return;
  const ctx = tex.getContext();
  items.forEach((it, i) => {
    const p = at[i];
    it.paint(ctx, { x: p.x + it.ax, y: p.y + it.ay });
    tex.add(it.name, 0, p.x, p.y, it.w, it.h);
    kitAnchors.set(it.name, { ox: it.ax / it.w, oy: it.ay / it.h });
  });
  tex.refresh();
}

/** An Image of kit piece `name` with its anchor at (x, y). */
function kitImage(scene: Phaser.Scene, x: number, y: number, name: string): Phaser.GameObjects.Image {
  const a = kitAnchors.get(name) ?? { ox: 0.5, oy: 0.5 };
  return scene.add.image(x, y, KIT_KEY, name).setOrigin(a.ox, a.oy);
}

/** A leg of the path from (x, y): its shape's kit piece, a left turn as the right one mirrored. */
function legImage(scene: Phaser.Scene, leg: JourneyLeg, solid: boolean): Phaser.GameObjects.Image {
  const shape = legShape(leg);
  const name = `leg-${shape === 'left' ? 'right' : shape}-${solid ? 's' : 'd'}`;
  // A straight is baked left to right: one running back along an odd row
  // starts from its other end.
  const from = shape === 'straight' && leg.to.x < leg.from.x ? leg.to : leg.from;
  const img = kitImage(scene, from.x, from.y, name);
  // Flipping mirrors the frame, not its origin: the anchor moves to the mirrored side.
  if (shape === 'left') img.setFlipX(true).setOrigin(1 - img.originX, img.originY);
  return img;
}

/**
 * Paint the kit now, where nobody is waiting: BootScene can call this under
 * the opening film, so the first Levels visit of a session opens as fast as
 * every later one. Harmless to call again.
 */
export function warmLevels(scene: Phaser.Scene): void {
  ensureKit(scene);
  ensureStrip(scene, chapterTiles(Progress.data));
}

/**
 * The strip's bake, kept between visits while what it shows is the same (a
 * win changes one tile's count, and repaints it).
 */
function ensureStrip(scene: Phaser.Scene, tiles: readonly ChapterTile[]): void {
  const sig = tiles.map((t) => `${t.status}${t.cleared}${t.gilt ? 'g' : ''}`).join(',');
  if (sig === stripSig && scene.textures.exists(STRIP_KEY)) return;
  if (scene.textures.exists(STRIP_KEY)) scene.textures.remove(STRIP_KEY);
  const tex = scene.textures.createCanvas(STRIP_KEY, stripWidth(tiles.length), LV.stripBottom - LV.stripTop);
  if (!tex) return;
  paintStrip(tex.getContext(), tiles);
  tex.refresh();
  stripSig = sig;
}

/**
 * Paint the chapter strip, its band's top at y = 0: a pale disc for a
 * chapter made, a gold badge on one with every star; the chapter in play
 * ringed in tangerine; a lock and "61+" on one not reached.
 */
export function paintStrip(ctx: CanvasRenderingContext2D, tiles: readonly ChapterTile[]): void {
  const t = theme();
  const u = ui();
  const r = LV.tileDisc / 2;
  const y = LV.tileY - LV.stripTop;
  const ly = LV.tileLabelY - LV.stripTop;
  // One shadow, drawn once and stamped under every raised tile: a blur per
  // tile was most of the strip's cost.
  const shadowSide = Math.ceil(r * 2 + dp(20));
  const shadow = document.createElement('canvas');
  shadow.width = shadowSide;
  shadow.height = shadowSide;
  const sctx = shadow.getContext('2d');
  if (sctx) {
    sctx.shadowColor = 'rgba(0,0,0,0.45)';
    sctx.shadowBlur = dp(8);
    sctx.shadowOffsetY = dp(3);
    circle(sctx, shadowSide / 2, shadowSide / 2, r - 1);
    sctx.fillStyle = '#000';
    sctx.fill();
  }
  tiles.forEach((tile, i) => {
    const x = LV.tileFirst + i * LV.tilePitch;
    const done = tile.status === 'done';
    const locked = tile.status === 'locked';
    const current = tile.status === 'current';
    if (locked) {
      circle(ctx, x, y, r);
      ctx.fillStyle = rgba(u.well, 0.34);
      ctx.fill();
      paintInner(ctx, x - r, y - r, r * 2, r * 2, r, 0.25);
      paintIcon(ctx, 'lock', x, y, dp(17), hexCss(u.text3));
    } else {
      if (current) {
        ctx.save();
        ctx.shadowColor = rgba(t.accent, 0.6);
        ctx.shadowBlur = dp(12);
        circle(ctx, x, y, r);
        ctx.fillStyle = hexCss(t.board);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.drawImage(shadow, x - shadowSide / 2, y - shadowSide / 2);
      }
      circle(ctx, x, y, r);
      ctx.fillStyle = done ? hexCss(mix(u.text, u.sky, 0.1)) : hexCss(mix(u.sheet, u.glass, 0.04));
      ctx.fill();
      if (current) {
        ctx.lineWidth = dp(2.5);
        ctx.strokeStyle = hexCss(t.accent);
        circle(ctx, x, y, r - dp(1.25));
        ctx.stroke();
      } else if (!done) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = rgba(u.glass, 0.14);
        circle(ctx, x, y, r - 0.75);
        ctx.stroke();
      }
      words(ctx, String(tile.chapter + 1), x, y + dp(1), {
        size: dp(20),
        display: true,
        color: done ? t.paper : u.text,
        align: 'center',
      });
      if (tile.gilt) {
        const bx = x + r * 0.74;
        const by = y - r * 0.74;
        circle(ctx, bx, by, dp(9.5));
        ctx.fillStyle = hexCss(u.sky);
        ctx.fill();
        circle(ctx, bx, by, dp(8));
        ctx.fillStyle = hexCss(t.medal);
        ctx.fill();
        paintIcon(ctx, 'star', bx, by, dp(10), hexCss(u.onAccent));
      }
    }
    words(ctx, tileLabel(tile), x, ly, {
      size: dp(12.5),
      color: current ? t.accentText : locked ? u.text3 : u.text2,
      align: 'center',
    });
  });
}

/** What the chapter card says about a chapter: everything its bake shows. */
export interface CardFacts {
  readonly chapter: number;
  readonly cleared: number;
  readonly size: number;
  readonly stars: number;
  readonly max: number;
  readonly three: number;
  /** For a chapter not reached, the fold that opens it once made; null once reached. */
  readonly opensAfter: number | null;
  readonly rewards: readonly ChapterReward[];
}

/** The card's reward line: ★ stars, then each reveal — ember while waiting, quiet with a check once paid. */
export function rewardParts(f: CardFacts): InlinePart[] {
  const t = theme();
  const u = ui();
  if (f.opensAfter !== null) {
    return [{ icon: 'lock', iconColor: u.text3, text: `Opens after fold ${f.opensAfter}`, color: u.text2 }];
  }
  const parts: InlinePart[] = [{ icon: 'star', iconColor: t.medal, text: `${f.stars} of ${f.max}`, color: t.medalText }];
  for (const r of f.rewards) {
    parts.push({
      icon: r.paid ? 'check' : 'eye',
      iconColor: r.paid ? u.text3 : t.accentText,
      text: `+${r.reward} at ${r.fold}`,
      color: r.paid ? u.text3 : t.accentText,
    });
  }
  return parts;
}

/** Where the card's parts sit, from its face's top-left. */
const CARD_AT = { left: dp(18), caps: dp(19), name: dp(41), row: dp(67), rowH: dp(22) } as const;

/**
 * The chapter card's words and ring, painted over its glass (a panel of its
 * own): caps "CHAPTER III · FOLDS 41–60", the name in Georgia, and the ring —
 * folds made in tangerine, ★★★ in gold over them, "7 / OF 20" inside.
 */
export function paintCardHead(ctx: CanvasRenderingContext2D, f: CardFacts, w: number, h: number): void {
  const t = theme();
  const u = ui();
  words(ctx, `Chapter ${chapterNumeral(f.chapter)} · ${foldsLabel(f.chapter)}`.toUpperCase(), CARD_AT.left, CARD_AT.caps, {
    size: TYPE.caps,
    weight: 600,
    color: u.text2,
    tracking: dp(1.4),
  });
  words(ctx, chapterName(f.chapter), CARD_AT.left, CARD_AT.name, { size: dp(23), display: true, color: u.text });

  const c = { x: w - dp(18) - LV.ringR - LV.ringW / 2, y: h / 2 };
  const r = LV.ringR;
  const top = -Math.PI / 2;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = LV.ringW;
  ctx.strokeStyle = rgba(u.glass, 0.09);
  circle(ctx, c.x, c.y, r);
  ctx.stroke();
  const arc = (frac: number, style: string): void => {
    if (!(frac > 0)) return;
    ctx.strokeStyle = style;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, top, top + Math.PI * 2 * Math.min(1, frac));
    ctx.stroke();
  };
  const n = Math.max(1, f.size);
  arc(f.cleared / n, hexCss(t.accent));
  arc(f.three / n, hexCss(t.medal));
  ctx.restore();
  words(ctx, String(f.cleared), c.x, c.y - dp(4), { size: dp(20), display: true, color: u.text, align: 'center' });
  words(ctx, `OF ${f.size}`, c.x, c.y + dp(10), { size: dp(8), weight: 700, color: u.text3, align: 'center', tracking: dp(0.6) });
}

/** A scratch context for measuring before a bake has a size. */
let scratch: CanvasRenderingContext2D | null = null;
function measureCtx(): CanvasRenderingContext2D | null {
  if (!scratch) scratch = document.createElement('canvas').getContext('2d');
  return scratch;
}

/* ================================================================ caches */

/** Baked nodes kept between visits, most recent last. A page is twenty; a win changes one. */
const NODE_POOL = 24;
const nodeTextures: string[] = [];

function touchNode(key: string): void {
  const i = nodeTextures.indexOf(key);
  if (i >= 0) nodeTextures.splice(i, 1);
  nodeTextures.push(key);
}

/** Let the pool go back to NODE_POOL, oldest first. Called once no Image shows the page's nodes. */
function trimNodes(scene: Phaser.Scene): void {
  while (nodeTextures.length > NODE_POOL) {
    const key = nodeTextures.shift() as string;
    if (scene.textures.exists(key)) scene.textures.remove(key);
  }
}

/** The strip's bake is kept between visits while what it shows is the same. */
let stripSig = '';

/* ================================================================ scene */

/**
 * What each frame may spend baking nodes, in ms, from the frame after the
 * page is built — nearest the view first. `create` bakes none: a page arrives
 * fading in, after the header's entrance, so the nodes in view land before
 * anyone can see them missing; a node from the pool shows at once.
 */
const FRAME_BAKE_MS = 4;

const STRIP_KEY = 'fw-levels-strip';
const CARD_KEY = 'fw-levels-card';
const NOTE_KEY = 'fw-levels-note';

interface Page {
  readonly content: Phaser.GameObjects.Container;
  readonly view: ScrollView;
  stopBake: () => void;
}

interface NodeView {
  readonly spec: NodeSpec;
  /** The node: the shared disc (for most) and its own bake, as one thing the list shows and hides. */
  readonly node: Phaser.GameObjects.Container;
  readonly img: Phaser.GameObjects.Image;
  readonly y: number;
}

export class LevelSelectScene extends Phaser.Scene {
  private layout!: LevelsLayout;
  private page: Page | null = null;
  private chapter = 0;
  private pathCam!: Phaser.Cameras.Scene2D.Camera;
  /** The journey window's soft edges (ScrollView.listFade). */
  private fades: { top: Phaser.GameObjects.Image | null; bottom: Phaser.GameObjects.Image | null } = {
    top: null,
    bottom: null,
  };
  private tiles: ChapterTile[] = [];
  private stripView: ScrollView | null = null;
  private stripBar: Phaser.GameObjects.Image | null = null;
  private card: Phaser.GameObjects.Container | null = null;
  private cardHead: Phaser.GameObjects.Image | null = null;
  private rewardRow: Phaser.GameObjects.Image | null = null;
  private note: Phaser.GameObjects.Image | null = null;
  private noteTimer: Phaser.Time.TimerEvent | null = null;
  private bannerOn = false;

  constructor() {
    super('LevelSelect');
  }

  create(data: LevelSelectData = {}): void {
    // Fields outlive the scene; a visit starts with nothing built.
    this.page = null;
    this.stripView = null;
    this.stripBar = null;
    this.card = null;
    this.cardHead = null;
    this.rewardRow = null;
    this.note = null;
    this.noteTimer = null;

    const save = Progress.data;
    // `Ads.enabled` is the banner's own condition (see Ads.showBanner).
    this.bannerOn = Ads.enabled;
    this.layout = levelsLayout(viewHeight(), this.bannerOn, this.scale.displayScale.y);
    const L = this.layout;
    this.tiles = chapterTiles(save);
    ensureKit(this);

    /*
     * Read once, then consumed. `data` IS the scene's stored data, and Phaser
     * keeps it from one start to the next whenever the next start passes none
     * — Menu → Levels passes none — so one return from a level left its focus
     * behind for the rest of the session.
     */
    const returning = data.focus !== undefined;
    const rebuilt = typeof data.scroll === 'number' && Number.isFinite(data.scroll);
    const frontier = frontierIndex(save);
    const focus =
      typeof data.focus === 'number' && Number.isInteger(data.focus)
        ? Phaser.Math.Clamp(data.focus, 0, LEVELS.length - 1)
        : frontier;
    const chapter =
      rebuilt && typeof data.chapter === 'number' && Number.isInteger(data.chapter)
        ? Phaser.Math.Clamp(data.chapter, 0, CHAPTER_COUNT - 1)
        : chapterOf(focus);
    const scroll = rebuilt ? (data.scroll as number) : null;
    const stripScroll = rebuilt && typeof data.strip === 'number' ? data.strip : null;
    delete data.focus;
    delete data.scroll;
    delete data.chapter;
    delete data.strip;

    /* ---------------------------------------------------------- header */
    const t = theme();
    const u = ui();
    const folded = LEVELS.filter((l) => save.cleared.includes(l.id)).length;
    // Right to left on the title's line: Fold Sense (once rated), the stars,
    // the folds. The balance on the top line, as the menu's chip shows it (∞
    // for an owner); here it only tells, so it has no "+".
    const row: InlinePart[][] = [];
    if (save.foldSense > 0) {
      row.push([{ icon: 'sense', iconColor: t.accentText, text: String(Math.round(save.foldSense)) }]);
    }
    row.push([{ icon: 'star', iconColor: t.medal, text: String(Progress.totalStars()) }]);
    row.push([{ text: String(folded) }, { text: `/${LEVELS.length}`, color: u.text2 }]);
    const { back, head } = browseHeader(
      this,
      'Levels',
      () => {
        Haptics.tap();
        this.scene.start('Menu');
      },
      { top: [{ icon: 'eye', iconColor: t.accentText, text: countText(Progress.reveals) }], row }
    );

    /* ------------------------------------------------------------ strip */
    const strip = this.buildStrip(chapter, stripScroll);

    /* ------------------------------------------------------------- card */
    this.card = this.add.container(L.card.x, L.card.y);
    this.card.add(glassPanel(this, 0, 0, L.card.w, L.card.h, 'e2'));

    /*
     * Clip the journey to its window with a second CAMERA rather than a mask:
     * a geometry mask costs a stencil pass every frame (about 8 ms here, half
     * the frame), a camera viewport is a GPU scissor and costs nothing. The
     * two cameras ignore each other's objects, so anything this scene adds
     * later goes on one list or the other: the card's parts go in the card
     * (ignored here), a page's in its content (ignored by the main camera).
     */
    this.pathCam = this.cameras.add(0, L.top, BASE_WIDTH, L.bottom - L.top);
    this.pathCam.setScroll(0, L.top);
    this.pathCam.ignore([back, head, strip, this.card]);
    // The window's soft edges, over the journey on its own camera (see listFade).
    this.fades = { top: listFade(this, L.top, L.bottom, 'top'), bottom: listFade(this, L.top, L.bottom, 'bottom') };
    for (const f of [this.fades.top, this.fades.bottom]) {
      if (!f) continue;
      f.setDepth(5);
      this.cameras.main.ignore(f);
    }

    this.chapter = chapter;
    this.fillCard(chapter);
    this.page = this.buildPage(chapter, { focus, scroll, dir: 0 });

    // The level's ‹ and this screen's ‹ share the top-left corner: the second
    // tap of a double tap on the one must not land on the other.
    if (returning) shieldInput(this);

    /*
     * A new world height rebuilds the screen where it was — the page, its
     * rows, the strip — and a shorter one cuts the window to the banner's new
     * line at once, before the rebuild has waited out the resize.
     */
    this.scale.on(Phaser.Scale.Events.RESIZE, this.holdWindow, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    watchHeight(this, () =>
      this.scene.restart({
        scroll: this.page?.view.scrolled ?? 0,
        chapter: this.chapter,
        strip: this.stripView?.scrolled ?? 0,
      })
    );

    if (!rebuilt) {
      enter(this, [head, back, strip, this.card], MOTION.stagger.ms);
      const content = this.page.content;
      content.setAlpha(0);
      this.tweens.add({
        targets: content,
        alpha: 1,
        duration: ms(MOTION.settle.ms),
        delay: ms(MOTION.stagger.ms * 3),
        ease: MOTION.settle.ease,
      });
    }
  }

  /** Cut the window to the banner's new line on a shrink, at once; the rebuild follows. */
  private holdWindow(): void {
    const L = this.layout;
    const now = Math.min(L.bottom, windowBottom(viewHeight(), this.bannerOn, this.scale.displayScale.y));
    this.pathCam.setSize(this.pathCam.width, Math.max(0, now - L.top));
    this.page?.view.clip(now);
  }

  private shutdown(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.holdWindow, this);
    this.destroyPage();
    this.stripView?.destroy();
    for (const key of [CARD_KEY, NOTE_KEY]) {
      if (this.textures.exists(key)) this.textures.remove(key);
    }
  }

  /* ------------------------------------------------------------ strip */

  private buildStrip(chapter: number, scroll: number | null): Phaser.GameObjects.Container {
    const W = stripWidth(this.tiles.length);
    const H = LV.stripBottom - LV.stripTop;
    ensureStrip(this, this.tiles);
    const content = this.add.container(0, LV.stripTop);
    content.add(this.add.image(0, 0, STRIP_KEY).setOrigin(0, 0));
    // Which page is showing: a short cream bar under its tile's count.
    const bar = kitImage(this, LV.tileFirst, LV.tileBarY - LV.stripTop, 'bar');
    this.stripBar = bar;
    content.add(bar);
    this.placeBar(chapter, false);

    const items: ScrollRow[] = this.tiles.map((tile, i) => ({
      x: LV.tileFirst + i * LV.tilePitch,
      y: H / 2,
      width: LV.tilePitch,
      height: H,
      onTap: () => {
        if (tile.chapter === this.chapter) return;
        Haptics.select();
        this.turnTo(tile.chapter);
      },
    }));
    this.stripView = new ScrollView(this, content, {
      top: LV.stripTop,
      bottom: LV.stripBottom,
      contentHeight: 0,
      items,
      horizontal: { left: 0, right: BASE_WIDTH, contentWidth: W },
    });
    this.stripView.scrollTo(scroll ?? this.stripOffsetFor(chapter));
    return content;
  }

  /** The strip scrolled so chapter `c`'s tile sits in the middle, as far as the strip goes. */
  private stripOffsetFor(c: number): number {
    const x = LV.tileFirst + c * LV.tilePitch;
    return Math.max(0, Math.min(this.stripView?.range ?? 0, x - BASE_WIDTH / 2));
  }

  private placeBar(c: number, animate: boolean): void {
    const bar = this.stripBar;
    if (!bar) return;
    const x = LV.tileFirst + c * LV.tilePitch;
    this.tweens.killTweensOf(bar);
    if (animate) {
      this.tweens.add({ targets: bar, x, duration: ms(MOTION.settle.ms), ease: MOTION.settle.ease });
    } else {
      bar.x = x;
    }
  }

  /** Keep chapter `c`'s tile on screen, gliding the strip there if it is not. */
  private revealTile(c: number): void {
    const view = this.stripView;
    if (!view) return;
    const x = LV.tileFirst + c * LV.tilePitch - view.scrolled;
    if (x >= LV.tilePitch && x <= BASE_WIDTH - LV.tilePitch) return;
    const from = view.scrolled;
    const to = this.stripOffsetFor(c);
    const glide = { t: 0 };
    this.tweens.add({
      targets: glide,
      t: 1,
      duration: ms(MOTION.settle.ms),
      ease: MOTION.settle.ease,
      onUpdate: () => view.scrollTo(from + (to - from) * glide.t),
    });
  }

  /* ------------------------------------------------------------- card */

  /** Everything the card says about chapter `c`, from one read of the save. */
  private cardFacts(c: number): CardFacts {
    const save = Progress.data;
    const tile = this.tiles[c];
    const stats = chapterStarStats(save, c);
    const size = tile?.size ?? chapterIndices(c).length;
    return {
      chapter: c,
      cleared: stats.cleared,
      size,
      stars: stats.stars,
      max: stats.max,
      three: stats.three,
      opensAfter: tile?.status === 'locked' ? tile.first - 1 : null,
      rewards: chapterRewards(c, size, new Set(save.chapterMarks), save.adsRemoved),
    };
  }

  /**
   * Bake the card for chapter `c` over its glass: ONE canvas, two frames —
   * the head (caps, name, ring) and the reward line, which a locked tap
   * swaps for a moment (see `sayLocked`).
   */
  private fillCard(c: number): void {
    const card = this.card;
    if (!card) return;
    this.noteTimer?.remove();
    this.noteTimer = null;
    this.note?.destroy();
    this.note = null;
    this.cardHead?.destroy();
    this.rewardRow?.destroy();
    const L = this.layout;
    const facts = this.cardFacts(c);
    const w = Math.round(L.card.w);
    const h = Math.round(L.card.h);
    const rowW = w - CARD_AT.left * 2 - (LV.ringR + LV.ringW) * 2;

    if (this.textures.exists(CARD_KEY)) this.textures.remove(CARD_KEY);
    const tex = this.textures.createCanvas(CARD_KEY, w, h + CARD_AT.rowH);
    if (tex) {
      const ctx = tex.getContext();
      paintCardHead(ctx, facts, w, h);
      inline(ctx, rewardParts(facts), 0, h + CARD_AT.rowH / 2, dp(13));
      tex.add('head', 0, 0, 0, w, h);
      tex.add('row', 0, 0, h, rowW, CARD_AT.rowH);
      tex.refresh();
    }
    this.cardHead = this.add.image(0, 0, CARD_KEY, 'head');
    this.rewardRow = this.add.image(-w / 2 + CARD_AT.left, -h / 2 + CARD_AT.row, CARD_KEY, 'row').setOrigin(0, 0.5);
    card.add([this.cardHead, this.rewardRow]);
  }

  /**
   * Say, in the card's reward line, why a locked fold did not open — for a
   * moment, then the line comes back. A tap on a dim node used to do nothing
   * at all, which cannot be told from a dead screen.
   */
  private sayLocked(): void {
    const row = this.rewardRow;
    const card = this.card;
    if (!row || !card) return;
    const next = frontierIndex(Progress.data);
    const parts: InlinePart[] = [
      { icon: 'lock', iconColor: ui().text2, text: `Locked · fold ${next + 1} is next`, color: ui().text },
    ];
    if (!this.textures.exists(NOTE_KEY)) {
      const m = measureCtx();
      const w = Math.ceil(m ? inline(m, parts, 0, 0, dp(13), false) : 200) + 2;
      const tex = this.textures.createCanvas(NOTE_KEY, w, CARD_AT.rowH);
      if (tex) {
        inline(tex.getContext(), parts, 0, CARD_AT.rowH / 2, dp(13));
        tex.refresh();
      }
    }
    this.note?.destroy();
    const note = this.add.image(row.x, row.y, NOTE_KEY).setOrigin(0, 0.5);
    card.add(note);
    this.note = note;
    row.setVisible(false);
    this.noteTimer?.remove();
    this.noteTimer = this.time.delayedCall(LOCKED_NOTE_MS, () => {
      this.noteTimer = null;
      note.destroy();
      if (this.note === note) this.note = null;
      if (row.scene) row.setVisible(true);
    });
  }

  /* ------------------------------------------------------------- pages */

  /** Turn to the chapter one page on (+1) or back (−1), if there is one. */
  private turn(dir: 1 | -1): void {
    const next = this.chapter + dir;
    if (next < 0 || next >= CHAPTER_COUNT) return;
    Haptics.select();
    this.turnTo(next);
  }

  private turnTo(c: number): void {
    if (c === this.chapter) return;
    const dir: 1 | -1 = c > this.chapter ? 1 : -1;
    this.chapter = c;
    this.destroyPage();
    this.fillCard(c);
    this.placeBar(c, true);
    this.revealTile(c);
    const frontier = frontierIndex(Progress.data);
    this.page = this.buildPage(c, { focus: c === chapterOf(frontier) ? frontier : null, scroll: null, dir });
  }

  private destroyPage(): void {
    const page = this.page;
    if (!page) return;
    this.page = null;
    page.stopBake();
    page.view.destroy();
    // The halo's breath and any node's press or shake go with the page: a
    // tween does not end when its target is destroyed.
    this.tweens.killTweensOf([page.content, ...page.content.list]);
    page.content.destroy(true);
    trimNodes(this);
  }

  /**
   * Build chapter `c`'s page: the path, the gifts on it, the twenty nodes, and
   * the list that scrolls them. Opens on `focus` (a level index) when it is
   * on this page, else at the top; `scroll` wins when the screen is rebuilt.
   */
  private buildPage(c: number, o: { focus: number | null; scroll: number | null; dir: 0 | 1 | -1 }): Page {
    const t = theme();
    const L = this.layout;
    const save = Progress.data;
    const indices = chapterIndices(c);
    const size = indices.length;
    const owner = save.adsRemoved;
    const J = journeyLayout(size, !owner);
    const frontier = frontierIndex(save);
    const allCleared = LEVELS.every((l) => save.cleared.includes(l.id));
    const stars = starsAt(save, indices);
    const figures = latestFigures(Progress.figures);

    const content = this.add.container(0, L.top);
    this.cameras.main.ignore(content);

    // The path: one Image per leg, off the kit's leg bakes.
    const solid = solidLegs(indices[0], size, J.legs.length, frontier, allCleared);
    J.legs.forEach((leg, i) => content.add(legImage(this, leg, i < solid)));

    // The gifts: the chapter's two reveals, on the path where they are paid.
    const rewards = chapterRewards(c, size, new Set(save.chapterMarks), owner);
    for (const gift of J.gifts) {
      const due = rewards.filter((r) => gift.marks.includes(r.at));
      const done = due.length > 0 && due.every((r) => r.paid);
      content.add(kitImage(this, gift.x, gift.y, done ? 'gift-paid' : 'gift-pending'));
      const reward = due.filter((r) => !r.paid).reduce((s, r) => s + r.reward, 0);
      if (reward > 0) {
        const name = `gift-label-${reward}`;
        const y = gift.y - LV.giftD / 2 - dp(12);
        // Every reward the economy can pay has its words in the kit; a
        // reward outside it (a config changed mid-session) is left unlabelled
        // rather than wrong.
        if (kitAnchors.has(name)) content.add(kitImage(this, gift.x, y, name));
      }
    }

    // The nodes: the shared disc, then each node's own bake over it.
    const items: ScrollRow[] = [];
    const views: NodeView[] = [];
    let focusY: number | null = null;
    indices.forEach((index, k) => {
      const level = LEVELS[index];
      const at = J.nodes[k];
      const kind = nodeKind(index, stars[k] > 0, save.unlockedIndex, frontier);
      const spec: NodeSpec = {
        kind,
        number: index + 1,
        stars: stars[k],
        level,
        figure: kind === 'cleared' ? figures.get(level.id) : undefined,
      };
      if (kind === 'current') {
        // The one living thing on the page: a lamp that breathes under it.
        const halo = softDisc(this, at.x, at.y, dp(80), t.accent, 0.9);
        content.add(halo);
        breathe(this, halo);
      }
      const node = this.add.container(at.x, at.y);
      if (onBase(kind)) node.add(kitImage(this, 0, 0, 'node-base'));
      const box = nodeBox(kind);
      // Its own part shows once its bake lands (a frame or two, under the fade).
      const img = this.add.image(0, 0, '__DEFAULT').setOrigin(0.5, box.cy / box.h).setVisible(false);
      node.add(img);
      content.add(node);
      views.push({ spec, node, img, y: at.y });
      if (index === o.focus) focusY = at.y;

      const locked = kind === 'locked';
      items.push({
        x: at.x,
        y: at.y + dp(12),
        width: LV.nodeD + dp(16),
        height: LV.nodeD + dp(44),
        view: node,
        onArm: locked
          ? undefined
          : (armed) => {
              this.tweens.killTweensOf(node);
              this.tweens.add({
                targets: node,
                scale: armed ? 0.95 : 1,
                duration: ms(armed ? 90 : 260),
                ease: armed ? 'Quad.easeOut' : 'Back.easeOut',
              });
            },
        onTap: locked
          ? () => this.refuse(node, at.x)
          : () => {
              Haptics.tap();
              // Picked from here, so the level's ‹ comes back here — to this node.
              this.scene.start('Game', { levelIndex: index, from: 'LevelSelect' });
            },
      });
    });

    const view = new ScrollView(this, content, {
      top: L.top,
      bottom: L.bottom,
      contentHeight: J.contentHeight,
      items,
      onSwipe: (dir) => this.turn(dir),
      fades: this.fades,
    });
    const windowH = L.bottom - L.top;
    if (o.scroll !== null) view.scrollTo(o.scroll);
    else if (focusY !== null) view.scrollTo(openOffset(focusY, windowH, view.range));

    const stopBake = this.bakeNodes(views, view, windowH);

    if (o.dir !== 0) {
      // A page turn: the new page slides in from the side it was swiped from.
      content.x = o.dir * dp(36);
      content.setAlpha(0);
      this.tweens.add({
        targets: content,
        x: 0,
        alpha: 1,
        duration: ms(MOTION.settle.ms),
        ease: MOTION.settle.ease,
      });
    }
    return { content, view, stopBake };
  }

  /**
   * Bake the page's nodes a few per frame, nearest the view first (see
   * FRAME_BAKE_MS); a node in the pool shows at once. Returns the stop for a
   * page taken down.
   */
  private bakeNodes(views: NodeView[], view: ScrollView, windowH: number): () => void {
    const show = (v: NodeView, key: string): void => {
      if (v.img.scene) v.img.setTexture(key).setVisible(true);
    };
    const left = views.filter((v) => {
      const key = nodeKey(v.spec);
      if (!this.textures.exists(key)) return true;
      touchNode(key);
      show(v, key);
      return false;
    });
    const distance = (y: number): number => Math.abs(y - (view.scrolled + windowH / 2));
    const nearest = (): number => {
      let best = -1;
      let bestD = Infinity;
      left.forEach(({ y }, i) => {
        const d = distance(y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return best;
    };
    const step = (): void => {
      const started = performance.now();
      while (left.length > 0) {
        const [v] = left.splice(nearest(), 1);
        show(v, this.bakeNode(v.spec));
        if (performance.now() - started >= FRAME_BAKE_MS) break;
      }
      if (left.length === 0) this.events.off(Phaser.Scenes.Events.UPDATE, step);
    };
    if (left.length > 0) this.events.on(Phaser.Scenes.Events.UPDATE, step);
    return () => this.events.off(Phaser.Scenes.Events.UPDATE, step);
  }

  /** Bake one node into the pool (or find it there) and return its key. */
  private bakeNode(spec: NodeSpec): string {
    const key = nodeKey(spec);
    if (!this.textures.exists(key)) {
      const box = nodeBox(spec.kind);
      const tex = this.textures.createCanvas(key, box.w, box.h);
      if (!tex) return '__DEFAULT';
      paintNode(tex.getContext(), spec, box.cx, box.cy);
      tex.refresh();
    }
    touchNode(key);
    return key;
  }

  /**
   * A locked node says no, and says why: it shakes once, and the card names
   * the fold that opens next.
   */
  private refuse(node: Phaser.GameObjects.Container, restX: number): void {
    Haptics.warn();
    this.tweens.killTweensOf(node);
    node.setX(restX);
    this.tweens.add({
      targets: node,
      x: restX + pt(4),
      duration: ms(45),
      yoyo: true,
      repeat: 2,
      ease: 'Sine.easeInOut',
      onComplete: () => node.setX(restX),
    });
    this.sayLocked();
  }
}
