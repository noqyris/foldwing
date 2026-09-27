/**
 * ShareCard — a finished run, rendered as an image worth posting.
 *
 * Drawn on a plain 2D canvas rather than through Phaser's WebGL snapshot. The
 * export has to be pixel-exact, identical on web and device, and available
 * without a live scene (the gallery renders figures the player earned in an
 * earlier session), and a raw canvas gives all three where a render-texture
 * readback gives none of them reliably.
 *
 * WHAT IS ON THE CARD. The maze, the line that solved it, its reflection, the
 * time, and a question. The card used to carry the closed figure alone — a
 * lovely mark, and completely mute: it showed neither the walls that made it
 * hard nor that there had been a puzzle at all, so the only people who could
 * read it were people who already played. The maze is what makes the image
 * legible to a stranger, and the time plus "Can you beat me?" is what turns it
 * from a picture into an invitation.
 *
 * Two variants:
 *   card        the night sky, the board, the figure, the mark. This is what
 *               gets shared — it carries the brand into someone else's feed,
 *               which is the entire point of a share button.
 *   transparent just the ink on alpha, for anyone compositing it themselves.
 *
 * The default is the card. A transparent PNG posted to a social app lands on
 * whatever background that app happens to use, and a line that only reads on
 * its own board disappears into it — a shared image nobody can see is not a
 * share.
 *
 * THE PAINTERS. This module also holds the Canvas2D painters for the board
 * and the ink — the sheet, the slate walls, the markers, the glowing line and
 * its moonlight, the figure's fill — and the play board (InkRenderer) and the
 * replay video (ReplayVideo) paint with the SAME functions. The still, the
 * clip and the game are one picture at three moments (tech G11); three copies
 * of the look would be three looks within a release.
 */

import { boundsOf, type Rect, type Vec2 } from '../core/Geometry';
import { DEFAULT_RIBBON, ribbonSlice, widthProfile, type Ribbon } from '../core/Ribbon';
import type { DrawnStroke } from '../core/StrokeRecorder';
import { BASE_WIDTH, FONT_DISPLAY, theme, ui, veiledInk } from './Theme';
import {
  BOARD_SHEET,
  goalRingWidth,
  layoutFigureCard,
  markerRadius,
  sheetAround,
  type CardLayout,
  type CardMarker,
} from './FigureCard';
import { fillingPlace, paintBoardSheet, paintSky, paintStars, starField } from './Paper';
import { ELEVATION, paintElevation, type Elevation } from './Baked';
import { markWidth, paintMark, SETTLED, type MarkProgress } from './Logo';
import type { SavedFigure } from '../systems/Progress';
import { APP_STORE_URL } from '../systems/WebDaily';

export const CARD_SIZE = 1080;

/**
 * Height of a card that carries a maze.
 *
 * 9:16, and not by taste: the playfield is 702×1102 base pixels, so at a 5%
 * margin the maze becomes exactly width-bound at this height and fills the card
 * edge to edge. A square card would have printed it 700px wide inside 1080 with
 * two fat bands of empty paper either side. It is also the shape of a phone
 * screenshot, which is what people expect a shared level to look like.
 */
export const CARD_MAZE_HEIGHT = 1920;

/** Card options, all optional. */
export interface CardOptions {
  readonly size?: number;
  /** Card height. Defaults to 9:16 for a maze card, square without one. */
  readonly height?: number;
  readonly transparent?: boolean;
  /** Caption under the figure. Falsy hides the whole footer. */
  readonly caption?: string;
  /** The line that asks for a rematch. Falsy omits it. */
  readonly challenge?: string;
  readonly showWordmark?: boolean;
  /**
   * Draw the maze behind the figure. Defaults on whenever the figure carries
   * one and the card is a card — an icon (`flat`) and a compositing export
   * (`transparent`) both want the mark by itself.
   */
  readonly showMaze?: boolean;
  /** Fraction of the side left as breathing room. Default 0.12, 0.05 with a maze. */
  readonly marginScale?: number;
  /** Multiplier on the nib. The app icon wants a far bolder line than a card. */
  readonly nibScale?: number;
  /** A flat sky, no stars — wanted for an app icon, which must stay flat. */
  readonly flat?: boolean;
}

/**
 * The line that turns a picture into an invitation.
 *
 * A shared image of a solved maze is a nice thing to look at and asks for
 * nothing. Naming the time and then daring the reader to beat it is what makes
 * the person receiving it open the game — which is the only reason a share
 * button exists.
 */
export const CHALLENGE = 'Can you beat me?';

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/** How the app shares one of its own figures. One definition, two callers. */
export function shareCardOptions(figure: SavedFigure): CardOptions {
  return {
    caption: `${figure.levelName} · ${seconds(figure.ms)}`,
    challenge: CHALLENGE,
  };
}

/**
 * The message beside the image.
 *
 * It repeats the time on purpose: a link preview or a text-only fallback strips
 * the picture, and the challenge has to survive that. The store link is what
 * makes it answerable by someone who does not have the game.
 */
export function shareText(figure: SavedFigure): string {
  return `${figure.levelName} in ${seconds(figure.ms)}. ${CHALLENGE}\n${APP_STORE_URL}`;
}

export function cssRgba(color: number, alpha: number): string {
  return `rgba(${(color >> 16) & 0xff},${(color >> 8) & 0xff},${color & 0xff},${alpha})`;
}

/** Base units per 402-wide design point — the B mocks' unit (Theme.dp, unrounded). */
const DP = BASE_WIDTH / 402;

/* -------------------------------------------------------------- the sky */

/**
 * The night sky over a `w` × `h` card: the page's lamp and its star field,
 * the same bake the game stands on (Paper.ts), sized to the card. Stars are
 * seeded, so every card of every run has the same night.
 */
export function laySky(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  paintSky(ctx, w, h, fillingPlace(w, h));
  // The field is laid out in base units for the 750-wide world; a card is
  // wider, so the dots grow with it and stay dots rather than dust.
  const k = w / BASE_WIDTH;
  paintStars(
    ctx,
    starField(w, h).map((st) => ({ ...st, r: st.r * k }))
  );
}

/* ------------------------------------------------------------ the ribbon */

/**
 * Add a ribbon's quads and discs to the current path, every one wound
 * clockwise, so ONE nonzero fill paints their union exactly once.
 *
 * That is what lets the ink be translucent. A ribbon is dozens of shapes that
 * overlap at every joint, and filled one by one a 0.18 bloom came out nearly
 * opaque wherever two met (see veiledInk); as one path, an overlap is simply
 * more of the same area. A quad runs a→b→c→d counter-clockwise on screen for
 * every segment (its normal turns with it), so it is traced a→d→c→b; `arc`
 * with its default direction is already clockwise.
 */
export function ribbonPath(ctx: CanvasRenderingContext2D, part: Ribbon): void {
  for (const q of part.quads) {
    ctx.moveTo(q.a.x, q.a.y);
    ctx.lineTo(q.d.x, q.d.y);
    ctx.lineTo(q.c.x, q.c.y);
    ctx.lineTo(q.b.x, q.b.y);
    ctx.closePath();
  }
  for (const d of part.discs) {
    if (d.r <= 0.25) continue;
    ctx.moveTo(d.p.x + d.r, d.p.y);
    ctx.arc(d.p.x, d.p.y, d.r, 0, Math.PI * 2);
    ctx.closePath();
  }
}

/** Fill a ribbon's union once, in the current fill style. */
export function fillRibbon(ctx: CanvasRenderingContext2D, part: Ribbon): void {
  ctx.beginPath();
  ribbonPath(ctx, part);
  ctx.fill('nonzero');
}

/** The half-widths of a stroke's ribbon at nib `baseWidth`: the game's own speed profile. */
export function strokeWidths(stroke: DrawnStroke, baseWidth: number): number[] {
  return widthProfile(stroke.points, stroke.times, { ...DEFAULT_RIBBON, baseWidth });
}

/** `widths` scaled by `k`, for a bloom or core pass over the same line. */
export const scaleWidths = (widths: readonly number[], k: number): number[] => widths.map((w) => w * k);

/**
 * A stroke's ribbon in the current fill style, as one union. Kept for any
 * caller that paints a plain line; the look's own painter is `paintInk`.
 */
export function paintRibbon(ctx: CanvasRenderingContext2D, stroke: DrawnStroke, baseWidth: number): void {
  fillRibbon(ctx, ribbonSlice(stroke.points, strokeWidths(stroke, baseWidth)));
}

/* ------------------------------------------------------------- the ink */

/** How a line is inked: its colour, its hot core, and the bloom baked under it. */
export interface InkLook {
  readonly color: number;
  /** The core's colour, or null for a line without one (the mirror, a death). */
  readonly core: number | null;
  /** The core's width as a fraction of the line's. */
  readonly coreWidth: number;
  /** Extra passes under the line, each `width` × the nib at `alpha` (Theme.lineBloom). */
  readonly bloom: readonly { readonly width: number; readonly alpha: number }[];
}

/**
 * The player's line: tangerine with its hot core and bloom (OWNER-DECISIONS 1).
 * A `color` other than the theme's line — the fail red — keeps the bloom and
 * drops the core: a dead line is one colour, glowing.
 */
export function lineLook(color?: number): InkLook {
  const t = theme();
  const c = color ?? t.line;
  return {
    color: c,
    core: c === t.line ? t.lineCore : null,
    coreWidth: t.lineCoreWidth,
    bloom: t.lineBloom,
  };
}

/** The reflection: moonlight, one opaque pass, no bloom and no core. */
export function mirrorLook(color?: number): InkLook {
  const t = theme();
  return { color: color ?? veiledInk(t.line, t), core: null, coreWidth: 0, bloom: [] };
}

/**
 * The bloom as a smooth falloff: rings of the line, widest first, each with
 * the glow's strength there — `level` is the alpha the eye sees inside that
 * ring. It keeps the theme's two passes' REACH (the widest, 3.2× the nib) and
 * their PEAK (the two composited: 1 − 0.82 × 0.78 = 0.36), and falls from one
 * to the other along a smoothstep instead of in two flat bands, which read as
 * a second, paler line beside the first rather than as light.
 *
 * The play board fills these into one texture under a MAX blend (so a ring
 * painted twice is painted once); a canvas composites them as a stack
 * (`stackAlphas`). Both show the same alpha at every radius.
 */
export function bloomProfile(bloom = theme().lineBloom, rings = 6): { width: number; level: number }[] {
  if (bloom.length === 0) return [];
  const reach = bloom.reduce((m, b) => Math.max(m, b.width), 1);
  const peak = 1 - bloom.reduce((k, b) => k * (1 - b.alpha), 1);
  const inner = Math.min(1.2, reach);
  const smooth = (u: number): number => u * u * (3 - 2 * u);
  return Array.from({ length: rings }, (_, i) => {
    const width = reach - ((reach - inner) * i) / Math.max(1, rings - 1);
    const u = reach > inner ? ((width - inner) / (reach - inner)) * 0.92 : 0;
    return { width, level: peak * (1 - smooth(u)) };
  });
}

/**
 * The alpha each ring must be composited at, widest first, for the stack to
 * show `level` inside each ring: 1 − (1 − Vj) / (1 − Vj−1).
 */
export function stackAlphas(levels: readonly number[]): number[] {
  let below = 0;
  return levels.map((v) => {
    const a = below >= 1 ? 0 : Math.max(0, 1 - (1 - v) / (1 - below));
    below = v;
    return a;
  });
}

/**
 * The bloom's scratch: a canvas at `res` of the target's resolution the rings
 * are filled into and stretched back from. The stretch smooths the rings'
 * steps into one falloff. The play board bakes its bloom at the same
 * fraction, so the three renderers glow alike.
 */
export interface GlowScratch {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly res: number;
}

export const GLOW_RES = 0.5;

/** A scratch for a `w` × `h` target, or null with no canvas to be had (the bloom is then left out). */
export function glowScratch(w: number, h: number, res = GLOW_RES): GlowScratch | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w * res));
  canvas.height = Math.max(1, Math.ceil(h * res));
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx, res } : null;
}

/** The bloom: its rings stacked into the scratch, stretched back over the target at `alpha`. */
function paintBloom(
  ctx: CanvasRenderingContext2D,
  scratch: GlowScratch,
  points: readonly Vec2[],
  widths: readonly number[],
  color: number,
  bloom: InkLook['bloom'],
  alpha: number
): void {
  const rings = bloomProfile(bloom);
  if (rings.length === 0) return;
  const { canvas, res } = scratch;
  const g = scratch.ctx;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.setTransform(res, 0, 0, res, 0, 0);
  const alphas = stackAlphas(rings.map((r) => r.level));
  rings.forEach((ring, i) => {
    g.fillStyle = cssRgba(color, alphas[i]);
    fillRibbon(g, ribbonSlice(points, scaleWidths(widths, ring.width)));
  });
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, canvas.width / res, canvas.height / res);
  ctx.restore();
}

/**
 * The bloom's rings over points [from, to) as a MAX map: each ring filled
 * opaque in the colour scaled by its level, under `lighten`, so the canvas
 * keeps the brightest ring at every pixel whatever order — or however often
 * — they land. That is what lets a replay paint only the line's moving tail
 * each frame (the play board does the same under a WebGL MAX blend). The map
 * is composited with `screen` over an opaque picture, which on the night
 * board is the alpha blend to within a few levels.
 */
export function paintBloomMax(
  g: CanvasRenderingContext2D,
  points: readonly Vec2[],
  widths: readonly number[],
  color: number,
  from = 0,
  to = points.length,
  bloom: InkLook['bloom'] = theme().lineBloom
): void {
  const rings = bloomProfile(bloom);
  if (rings.length === 0 || to <= from) return;
  const r = (color >> 16) & 0xff;
  const gr = (color >> 8) & 0xff;
  const b = color & 0xff;
  g.save();
  g.globalCompositeOperation = 'lighten';
  for (const ring of rings) {
    const v = ring.level;
    g.fillStyle = `rgb(${Math.round(r * v)},${Math.round(gr * v)},${Math.round(b * v)})`;
    fillRibbon(g, ribbonSlice(points, scaleWidths(widths, ring.width), from, to));
  }
  g.restore();
}

/**
 * A line in its look: the bloom (through `scratch`; none without one),
 * the body, the hot core. `widths` are the ribbon's half-widths
 * (`strokeWidths`); `alpha` fades the whole line as one.
 */
export function paintInk(
  ctx: CanvasRenderingContext2D,
  points: readonly Vec2[],
  widths: readonly number[],
  look: InkLook,
  scratch: GlowScratch | null,
  alpha = 1
): void {
  if (points.length === 0 || !(alpha > 0)) return;
  if (scratch && look.bloom.length > 0) paintBloom(ctx, scratch, points, widths, look.color, look.bloom, alpha);
  ctx.fillStyle = cssRgba(look.color, alpha);
  fillRibbon(ctx, ribbonSlice(points, widths));
  if (look.core !== null && look.coreWidth > 0) {
    ctx.fillStyle = cssRgba(look.core, alpha);
    fillRibbon(ctx, ribbonSlice(points, scaleWidths(widths, look.coreWidth)));
  }
}

/* ------------------------------------------------------------ the board */

/**
 * The walls' cast shadow, in base units: +1.3 pt down, barely blurred, at
 * 0.10 — never more (tech G5): a shadow that read as more wall would show the
 * player a wall where collision has none.
 */
export const WALL_SHADOW = { dy: 1.3 * DP, blur: 2 * DP, alpha: 0.1 } as const;

/** How far a wall's face sits in from its lit rim, top and left: 0.9 pt. */
export const WALL_RIM = 0.9 * DP;

/** Add a rounded rect to the current path, clockwise, as its own sub-path. */
function roundRectSub(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** Where the offscreen trick draws a shape so that only its shadow lands. */
const AWAY = 20000;

/**
 * The slate walls (art-spec §5, B): the cast shadow, the lit rim at full
 * size, then the face inset 0.9 pt from the top-left, so the rim shows along
 * the two edges the lamp reaches. Each pass is ONE union of every wall:
 * joints overlap on purpose, and a shadow or a rim stamped wall by wall would
 * darken or light every junction. Everything drawn stays inside the wall's
 * own rect — the collision rect — so the picture never claims more wall than
 * kills (tech G5).
 *
 * `scale` is target pixels per base pixel; the context must be unscaled (a
 * shadow's offset is in device pixels).
 */
export function paintWalls(
  ctx: CanvasRenderingContext2D,
  walls: readonly Rect[],
  radius: number,
  scale: number,
  alpha = 1
): void {
  if (walls.length === 0) return;
  const t = theme();
  const all = (inset: number): void => {
    ctx.beginPath();
    for (const w of walls) {
      roundRectSub(ctx, w.x + inset, w.y + inset, w.w - inset, w.h - inset, Math.max(0, radius - inset / 2));
    }
  };
  ctx.save();
  ctx.shadowColor = cssRgba(ui().shadow, WALL_SHADOW.alpha * alpha);
  ctx.shadowBlur = WALL_SHADOW.blur * scale;
  ctx.shadowOffsetX = AWAY;
  ctx.shadowOffsetY = WALL_SHADOW.dy * scale;
  ctx.translate(-AWAY, 0);
  ctx.fillStyle = '#000';
  all(0);
  ctx.fill('nonzero');
  ctx.restore();
  ctx.fillStyle = cssRgba(t.wallRim, alpha);
  all(0);
  ctx.fill('nonzero');
  ctx.fillStyle = cssRgba(t.wall, alpha);
  all(WALL_RIM * scale);
  ctx.fill('nonzero');
}

/**
 * The start dot: tangerine, with the lamp's highlight at its top-left
 * (2.6 pt). A reflection is a plain disc in `veil`.
 */
export function paintStartDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  mirror: boolean,
  alpha = 1
): void {
  const t = theme();
  ctx.fillStyle = cssRgba(mirror ? t.veil : t.accent, alpha);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  if (mirror) return;
  ctx.fillStyle = cssRgba(0xffffff, 0.35 * alpha);
  ctx.beginPath();
  ctx.arc(x - r * 0.32, y - r * 0.34, r * (2.6 / 8.5), 0, Math.PI * 2);
  ctx.fill();
}

/**
 * The goal: a ring of exactly `r` — it IS the win threshold — in the text
 * accent, on a disc of the board's lit centre, with the dot at its heart. A
 * reflection is the ring alone, in `veil`.
 */
export function paintGoalRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  width: number,
  mirror: boolean,
  alpha = 1
): void {
  const t = theme();
  const color = mirror ? t.veil : t.accentText;
  if (!mirror) {
    ctx.fillStyle = cssRgba(t.boardCentre, alpha);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = cssRgba(color, alpha);
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(x, y, r - width / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = cssRgba(color, (mirror ? 1 : 0.8) * alpha);
  ctx.beginPath();
  ctx.arc(x, y, Math.max(1, r * 0.2), 0, Math.PI * 2);
  ctx.fill();
}

/** A card's markers, reflections first so the real pair paints over them where they meet. */
export function paintCardMarkers(ctx: CanvasRenderingContext2D, markers: readonly CardMarker[], scale: number): void {
  for (const m of [...markers].sort((a, b) => Number(b.mirror) - Number(a.mirror))) {
    const r = markerRadius(m.kind, scale);
    if (m.kind === 'start') paintStartDot(ctx, m.p.x, m.p.y, r, m.mirror);
    else paintGoalRing(ctx, m.p.x, m.p.y, r, goalRingWidth(scale), m.mirror);
  }
}

/** An elevation's drops at `scale` — Baked's ladder is in base units. */
export function scaledElevation(e: Elevation, scale: number): Elevation {
  return {
    ...e,
    drops: e.drops.map((d) => ({ ...d, dy: d.dy * scale, blur: d.blur * scale, spread: d.spread * scale })),
  };
}

/**
 * The board as the game shows it: the sheet at e3 around the playfield (the
 * crease down the fold, the far half turned from the lamp), the slate walls,
 * and the markers. Nothing for a figure saved before mazes were kept.
 */
export function paintBoard(ctx: CanvasRenderingContext2D, layout: CardLayout): void {
  const frame = layout.frame;
  if (!frame || !layout.axis) return;
  const s = layout.scale;
  const sheet = sheetAround(frame, s);
  const r = BOARD_SHEET.radius * s;
  paintElevation(ctx, sheet.x, sheet.y, sheet.w, sheet.h, r, scaledElevation(ELEVATION.e3, s));
  paintBoardSheet(ctx, sheet.x, sheet.y, sheet.w, sheet.h, { radius: r, axisX: layout.axis.x - sheet.x });
  paintWalls(ctx, layout.walls, layout.wallRadius, s);
  paintCardMarkers(ctx, layout.markers, s);
}

/** The replay's name for the board, from before it was a sheet. */
export const paintMaze = paintBoard;

/* ----------------------------------------------------------- the figure */

/**
 * The win figure's fill (SPEC §3.7, B): warm light at its heart through the
 * line's tangerine to gold at its rim, each at its alpha.
 *
 * Laid out as an ELLIPSE fitted to the figure, not a circle round its bounds.
 * Nearly every figure is tall and narrow — a maze is 702×1102 and the figure
 * hugs the fold — so a circle put the whole of it in the gradient's dim middle
 * stops, and at the spec's 0.26 there the fill read as a flat, muddy brown on
 * the night board, never the lit peach of the B mock (QA). Fitted, the light
 * runs down the fold, where the figure is; the alphas are raised to match.
 */
export const FIGURE_FILL: readonly (readonly [at: number, color: number, alpha: number])[] = [
  [0, 0xffb38f, 0.8],
  [0.5, 0xff7a52, 0.46],
  [1, 0xe0a040, 0.3],
];

/** How far past the figure's bounds the fitted ellipse reaches: the rim stop lands just outside its corners. */
const FILL_REACH = 1.2;

/** The engraving over it: 0.8 pt lines at 45°, 5 pt apart, in the core's cream at 0.22 (SPEC §3.7). */
export const FIGURE_HATCH = { width: 0.8 * DP, gap: 5 * DP, alpha: 0.22 } as const;

function outlinePath(ctx: CanvasRenderingContext2D, pts: readonly Vec2[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

/**
 * The closed figure's fill and engraving, clipped to its outline with
 * Canvas2D — painted once, never a GeometryMask (tech G3). `scale` sizes the
 * hatch; `alpha` fades the whole fill (the replay's settle).
 */
export function paintFigureFill(
  ctx: CanvasRenderingContext2D,
  outline: readonly Vec2[],
  scale: number,
  alpha = 1
): void {
  const b = boundsOf(outline);
  if (!b || outline.length < 3 || !(alpha > 0)) return;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  ctx.save();
  outlinePath(ctx, outline);
  ctx.clip('nonzero');
  // A unit radial, scaled to the figure's own ellipse (see FIGURE_FILL).
  const rx = Math.max(1, (b.w / 2) * FILL_REACH);
  const ry = Math.max(1, (b.h / 2) * FILL_REACH);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(rx, ry);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  for (const [at, color, a] of FIGURE_FILL) g.addColorStop(at, cssRgba(color, a * alpha));
  ctx.fillStyle = g;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
  // 45°, rising to the right: every line is x + y = k, across the bounds.
  const step = FIGURE_HATCH.gap * scale * Math.SQRT2;
  ctx.strokeStyle = cssRgba(theme().lineCore, FIGURE_HATCH.alpha * alpha);
  ctx.lineWidth = Math.max(0.5, FIGURE_HATCH.width * scale);
  ctx.beginPath();
  for (let k = b.x + b.y + step / 2; k < b.x + b.w + b.y + b.h; k += step) {
    ctx.moveTo(k - b.y, b.y);
    ctx.lineTo(k - (b.y + b.h), b.y + b.h);
  }
  ctx.stroke();
  ctx.restore();
}

/** The warm bloom behind a figure: the line's light, radial, gone by its rim. */
export function paintFigureGlow(ctx: CanvasRenderingContext2D, outline: readonly Vec2[], alpha = 1): void {
  const b = boundsOf(outline);
  if (!b || !(alpha > 0)) return;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const r = Math.max(b.w, b.h) * 0.75;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, cssRgba(theme().line, 0.2 * alpha));
  g.addColorStop(1, cssRgba(theme().line, 0));
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
}

/**
 * A finished run in the look: the warm bloom, the fill, the reflection in
 * moonlight, then the glowing line over it — the order the game's win lands
 * in, so the card is that moment held still.
 */
export function paintFigure(
  ctx: CanvasRenderingContext2D,
  layout: CardLayout,
  scratch: GlowScratch | null,
  o: { fill?: number; color?: number } = {}
): void {
  const fill = o.fill ?? 1;
  paintFigureGlow(ctx, layout.outline, fill);
  paintFigureFill(ctx, layout.outline, layout.scale, fill);
  const widths = strokeWidths(layout.stroke, layout.nib);
  paintInk(ctx, layout.mirrored.points, widths, mirrorLook(), null);
  paintInk(ctx, layout.stroke.points, widths, lineLook(o.color), scratch);
}

/* ------------------------------------------------------------- the mark */

/**
 * The brand under the picture: the icon's mark beside "foldwing" in Georgia,
 * centred, its baseline at `baseY`. Side by side rather than stacked, because
 * a card's footer is a line tall; the mirrored wordmark is retired
 * (SPEC §2.4). `progress` draws the mark in (the replay's outro).
 */
export function paintLockup(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  size: number,
  alpha = 1,
  progress: MarkProgress = SETTLED
): void {
  if (!(alpha > 0)) return;
  ctx.save();
  ctx.font = `${Math.round(size)}px ${FONT_DISPLAY}`;
  ctx.letterSpacing = `${(-size * 0.006).toFixed(2)}px`;
  const textW = ctx.measureText('foldwing').width;
  const markH = size * 1.2;
  const markW = markWidth(markH);
  const gap = size * 0.34;
  const x0 = cx - (markW + gap + textW) / 2;
  ctx.globalAlpha *= alpha;
  // The mark sits on the baseline's x-height band: centred on the lowercase.
  paintMark(ctx, x0, baseY - size * 0.26 - markH / 2, markH, progress);
  ctx.textAlign = 'left';
  ctx.fillStyle = cssRgba(ui().text, 0.92);
  ctx.fillText('foldwing', x0 + markW + gap, baseY);
  ctx.restore();
}

/* ------------------------------------------------------------ the card */

/**
 * Render a saved run to a PNG data URL.
 *
 * The line is rebuilt through the SAME ribbon and smoothing code the game used
 * when it was earned, so what the player shares is what they made — down to
 * where they hesitated and where they rushed.
 */
export function renderShareCard(figure: SavedFigure, opts: CardOptions = {}): string {
  const u = ui();
  const width = opts.size ?? CARD_SIZE;

  const maze =
    opts.showMaze ??
    (Boolean(figure.walls && figure.walls.length > 0) && !opts.transparent && !opts.flat);
  const height = opts.height ?? (maze ? Math.round((width * CARD_MAZE_HEIGHT) / CARD_SIZE) : width);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  if (!opts.transparent) {
    if (opts.flat) {
      ctx.fillStyle = cssRgba(u.sky, 1);
      ctx.fillRect(0, 0, width, height);
    } else {
      laySky(ctx, width, height);
    }
  }

  const hasFooter =
    Boolean(opts.caption) || Boolean(opts.challenge) || opts.showWordmark !== false;
  // The maze already carries the playfield's own page margins, so it needs far
  // less around it than a bare figure cropped to its ink does.
  const margin = width * (opts.marginScale ?? (maze ? 0.05 : 0.12));
  const footer = hasFooter && !opts.transparent ? height * 0.12 : 0;

  const layout = layoutFigureCard(
    figure,
    {
      x: margin,
      y: margin,
      w: width - margin * 2,
      h: height - margin * 2 - footer,
    },
    opts.nibScale ?? 1
  );
  if (!layout) return canvas.toDataURL('image/png');

  if (maze) paintBoard(ctx, layout);
  paintFigure(ctx, layout, glowScratch(width, height));

  if (footer > 0) {
    /*
     * Stacked UP from the mark, so adding or dropping a line never moves the
     * lines below it. Sizes scale with the WIDTH (which is what decides
     * whether a line fits) and gaps with the height.
     */
    const serif = (px: number, italic = false): string =>
      `${italic ? 'italic ' : ''}${Math.round(px)}px ${FONT_DISPLAY}`;
    ctx.textAlign = 'center';
    const cx = width / 2;
    const markSize = width * 0.042;
    let baseY = height - margin - markSize * 0.4;

    if (opts.showWordmark !== false) {
      paintLockup(ctx, cx, baseY, markSize);
      ctx.textAlign = 'center';
      baseY -= height * 0.034;
    }

    if (opts.challenge) {
      ctx.font = serif(width * 0.038, true);
      ctx.fillStyle = cssRgba(u.text, 0.9);
      ctx.fillText(opts.challenge, cx, baseY);
      baseY -= height * 0.028;
    }

    if (opts.caption) {
      ctx.font = serif(width * 0.032);
      ctx.fillStyle = cssRgba(u.text2, 1);
      ctx.fillText(opts.caption, cx, baseY);
    }
  }

  return canvas.toDataURL('image/png');
}
