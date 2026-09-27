/**
 * InkRenderer — everything the player sees on the board.
 *
 * Night Fold (OWNER-DECISIONS 1): a folded sheet under one warm lamp. The
 * board is a dark sheet with a crease down the fold and its far half turned
 * from the light; the walls are slate tiles with a lit rim; the player's line
 * is light — tangerine with a hot core and a bloom — and its reflection is
 * moonlight. The line is still the loudest thing on the page, and the only
 * thing that moves with the hand.
 *
 * The renderer is the ONLY place smoothing and nib width are applied. Collision
 * runs on the raw samples at a fixed hit radius, so however thick the ink
 * happens to look, it never changes what kills you — and the drawn path is
 * held to within a hit radius of the tested one, so the player is never shown a
 * stroke doing something the rules did not allow. Everything added for the
 * look (the bloom, the heat, the print-in, the win's bloom) is picture only:
 * nothing here is read by CollisionSystem, and nothing drawn claims more wall
 * than kills (tech G5).
 *
 * WHAT IS BAKED. The sheet is painted once per board place, the walls once
 * per level, both with Canvas2D (real blur, gradients) into textures shown as
 * Images: the walls stopped re-triangulating every frame, which is a
 * measured gain (tech C). The settled part of the line is baked into render
 * textures as it is drawn (InkPass). What stays a live Graphics is only what
 * changes this frame: the pen's end, the wet head, a tweening ring, a flash.
 */

import Phaser from 'phaser';
import { boundsOf, clamp, mirrorPath, type Rect, type Vec2 } from '../core/Geometry';
import { mirrorBands, obstacleRows } from '../core/Gates';
import type { Playfield } from '../core/Playfield';
import {
  DEFAULT_RIBBON,
  ribbonSlice,
  settledPoints,
  thinPath,
  widthProfile,
  type Ribbon,
  type RibbonOptions,
} from '../core/Ribbon';
import { closedFigure, renderStroke, renderTailReach, type DrawnStroke } from '../core/StrokeRecorder';
import type { Level } from '../data/types';
import type { SavedFigure } from '../systems/Progress';
import { bakedPanel, panel, paintPanel, panelPad, sizePanel, softDisc, type Panel, type PanelSpec } from './Baked';
import { BOARD_SHEET, goalRingWidth, layoutFigureCard, markerRadius, sheetAround, START_DOT_R } from './FigureCard';
import { paintBoardSheet } from './Paper';
import {
  bloomProfile,
  FIGURE_FILL,
  GLOW_RES,
  paintFigureFill,
  paintGoalRing,
  paintStartDot,
  paintWalls,
  strokeWidths,
  WALL_RIM,
  WALL_SHADOW,
} from './ShareCard';
import {
  BASE_WIDTH,
  blend,
  dp,
  FONT_DISPLAY,
  METRICS,
  MOTION,
  motionReduced,
  ms,
  pt,
  rgba,
  theme,
  ui,
  veiledInk,
  viewHeight,
} from './Theme';
import { breathe, dimPage, label, undimPage } from './UI';

const DEPTH = {
  /** The board's sheet, under everything on the board. */
  sheet: 4,
  /** The danger heat's glow: UNDER the walls, so it lights around a wall, never over its face. */
  heat: 8,
  /** The walls (and, while it prints, the print-in's soft front). */
  level: 10,
  /** The heat's outline, inside the wall's own edge. */
  heatLine: 11,
  /** The fold's notches and spine. */
  axis: 12,
  /** The live start dot and goal ring, and their halos. */
  markers: 13,
  reveal: 15,
  /** The fingertip's shadow and its tether to the nib. */
  finger: 16,
  /**
   * The win's bloom, rays, fill and crease light: UNDER the line. The line on
   * the board at the goal IS the figure's line (see presentWin), so what the
   * win adds goes beneath it, as the share card paints it.
   */
  winGlow: 16.2,
  winRays: 16.4,
  winFill: 17.2,
  winCrease: 17.6,
  mirror: 18,
  /** The line's bloom, under the line. */
  glow: 19,
  stroke: 20,
  core: 20.5,
  wet: 21,
  nib: 22,
  win: 30,
  wash: 40,
  /** The splat, the arc arrow and the wall flash: over the wash, or the red would veil them. */
  fail: 41,
} as const;

/**
 * Revealed bands: an accent tint with a 45° hatch over it.
 *
 * They were a solid 0.6 of the FAIL red, which made the reward the player
 * watched a video for look exactly like a death. The accent is the game's own
 * colour for things that help — the start dot, the goal — and the hatch keeps
 * the bands as loud as the red was (the lines are 0.6, the walls' own weight)
 * while the 0.25 tint under them lets a real wall beneath a band show through,
 * darker. Neither is a solid fill, so a band still reads as "a place", not as a
 * second set of walls.
 */
const REVEAL_TINT = 0.25;
const REVEAL_HATCH = 0.6;
const REVEAL_HATCH_WIDTH = pt(1.4);
/** Between hatch lines, measured across them. */
const REVEAL_HATCH_GAP = pt(4.2);

/**
 * The previous attempt's line. 0.16 measured 1.3:1 on the paper — a ghost so
 * faint that players who died did not know it was there. The death marks carry
 * their own, stronger alpha, which is why this lives in the line style rather
 * than on the whole Graphics.
 */
const GHOST_ALPHA = 0.26;

/**
 * How far each arm of a death's × reaches from its centre. It was pt(3.5),
 * a mark small enough to miss — and the mirror death's × is the one thing
 * that shows the player where the reflection they never watched ran out.
 */
export const DEATH_ARM = pt(5);

/**
 * Where a death's × is centred: at `p`, pulled inside the playfield by an
 * arm's length. A death against the frame — most often the reflection, at
 * the far edge the player was not watching — otherwise drew half an × past
 * the board's edge, clipped by whatever sat there.
 */
export function deathMarkAt(
  p: Vec2,
  pf: Pick<Playfield, 'x' | 'y' | 'right' | 'bottom'>,
  arm: number = DEATH_ARM
): Vec2 {
  return {
    x: clamp(p.x, pf.x + arm, pf.right - arm),
    y: clamp(p.y, pf.y + arm, pf.bottom - arm),
  };
}

/**
 * The walls, while the win card is up and no bloom has dimmed them: the maze
 * recedes, the figure stays.
 */
const FRAMED_WALL_ALPHA = 0.45;

/**
 * The walls under a win's figure (SPEC §3.7): ghosts of the maze it was drawn
 * through, low enough that the figure is plainly the subject — and, under the
 * fill, low enough to be all but gone.
 */
export const BLOOM_WALL_ALPHA = 0.22;

/** What a death struck, for `flashFail` to show — see CollisionSystem.firstHit. */
export interface FailHit {
  /** The contact point on the player's own stroke. */
  at: Vec2;
  /** The reflection died: the splat lands at the reflected point instead. */
  mirror: boolean;
  /** Index of the struck wall in the walls `drawLevel` was given, or null for none. */
  wall: number | null;
  /** How many times the wall flashes. Default 1; the first mirror death is taught with 2. */
  flashes?: number;
  /**
   * A mirror death's arc arrow over the fold: its label ("your reflection",
   * for the first three mirror deaths of a save — Progress.mirrorLabel), null
   * for the arrow alone (the default), false for no arrow.
   */
  arrow?: string | null | false;
}

/** A danger reading, as core/Proximity.heatOf gives it. */
export interface HeatReading {
  readonly wall: number;
  readonly amount: number;
  readonly tight: boolean;
}

/** A short-lived effect and the tween driving it — stopped together, never orphaned. */
type Effect = Phaser.GameObjects.GameObject &
  Phaser.GameObjects.Components.Transform &
  Phaser.GameObjects.Components.Depth;
type Effects = Map<Effect, Phaser.Tweens.Tween | null>;

/**
 * Ink painted into a texture is painted at twice the canvas's resolution and
 * shown at half size. A render texture has no multisampling and the canvas
 * does, so at 1× the baked part of a line would come out visibly more jagged
 * than the live end drawn next to it; 2×2 supersampling is the same four
 * samples a pixel the canvas takes.
 */
const BAKE_SUPERSAMPLE = 2;

/**
 * The hot core's bake: 1×. It is a third of the line's width in the middle of
 * the line, cream on tangerine, so its edge has little contrast to alias — and
 * a third 2× texture for it would be another 7 MB while drawing (tech G4).
 */
const CORE_BAKE = 1;

/** Baked textures sit this far below their layer, so its live part paints over them. */
const BAKED_BELOW = 0.01;

/**
 * How far a disc's polygon may fall inside the true circle, in the pixels it
 * is painted in.
 *
 * Phaser's `fillCircle` always cuts 100 segments — a vertex every 0.4px on the
 * nib, every 0.02px on a gallery card — and a ribbon puts a disc on every
 * sample, so the circles alone were most of what ink cost to draw. A polygon
 * within 0.03px of the circle is the circle. Rounded wall corners get the same
 * treatment: `fillRoundedRect` spends 100 segments on each of the four.
 */
const CURVE_TOLERANCE = 0.03;

/**
 * A gallery card's line, thinned to what the card can show: chords at most
 * CARD_SPAN card pixels long that stray at most CARD_TOLERANCE from the
 * smoothed line (see `thinPath`). The nib there is 1.5–2.5px wide.
 */
const CARD_SPAN = 2;
const CARD_TOLERANCE = 0.1;

/* ------------------------------------------------------------ the look */

/** The wet head (SPEC §3.3): this many samples behind the pen are still wet. */
export const WET_SAMPLES = 45;
/** The wet core starts this many samples back over the baked one: no seam where they meet. */
const WET_OVERLAP = 6;
/** How long wet ink takes to dry once the pen stops, lifts, dies or wins. */
export const DRY_MS = 600;
/** A pen held this still has stopped: its ink starts to dry. */
const STILL_MS = 160;

/** The print-in (SPEC §3.2): at most this long, each row fading up over PRINT_FADE_MS. */
export const PRINT_MS = 520;
export const PRINT_FADE_MS = 180;
/** A row never waits longer than this after the one below it. */
export const PRINT_STEP_MAX = 34;

/**
 * The waiting start dot's glow: a soft tangerine disc 2.4× the dot, breathing
 * 0.22 → 0.5 — the "0.6 → 1" of the breath, on the light instead of the dot.
 */
const START_HALO = { r: START_DOT_R * 2.4, from: 0.22, to: 0.5 } as const;
/** The nib: a 7.5 pt ring (1.4 pt stroke), an 11 pt soft halo at 0.30, a hot dot at the tip. */
const NIB = { ring: dp(7.5), ringWidth: dp(1.4), halo: dp(11), haloAlpha: 0.3, dot: dp(2.2) } as const;

/** The fingertip's shadow, 24 × 27 pt, and the dotted tether to the nib. */
const FINGER = { w: dp(24), h: dp(27), alpha: 0.12, dash: dp(1.5), gap: dp(3.5), tether: 0.28 } as const;

/**
 * The fold as a progress meter (SPEC §3.4). The spine is quieter than the
 * spec's 2.2 pt at 0.8: that hard, saturated line ran the whole crossed length
 * beside the player's own glowing line and competed with it (QA). The lit
 * notches carry the progress; the spine only joins them.
 */
const NOTCH = {
  w: dp(5),
  h: dp(1.6),
  alpha: 0.35,
  litW: dp(8),
  litH: dp(3.2),
  spine: dp(1.4),
  spineAlpha: 0.45,
  popFrom: dp(10),
  popTo: dp(16),
  popMs: 220,
} as const;

/**
 * The danger heat (SPEC §3.5): a baked halo round the wall, and a 1.2 pt
 * outline inside its edge.
 *
 * The halo is three glows in one bake (HEAT_PASSES) — tight and bright on the
 * wall's edge, wide and soft well past it — because the spec's single dp(9)
 * blur, sized to the wall and hidden under it, left only a fringe outside the
 * slate: at the spec's 0.22 alpha on the night board it measured as nothing
 * (QA: "the heat cannot be seen"). It is light, not wall — drawn under the
 * walls, so it glows round a wall and never over its face.
 *
 * `amount` (Proximity.heatOf, 0..0.45) is the DANGER; what the eye gets is
 * `glowMax · √(amount / max)`: a halo that is already there at the edge of
 * the band and near full well before the last point of slack, where the
 * spec's linear 0.45 ramp only reached a visible level at the very end.
 */
const HEAT = {
  outline: dp(1.2),
  outlineFrom: 0.6,
  max: 0.45,
  glowMax: 0.8,
} as const;

/** The halo's alpha for a heat reading `amount` (0..HEAT.max). */
export function heatGlowAlpha(amount: number): number {
  const danger = clamp(amount / HEAT.max, 0, 1);
  return HEAT.glowMax * Math.sqrt(danger);
}

/** The outline's alpha for a heat reading: never faint, full at the last point of slack. */
export function heatLineAlpha(amount: number): number {
  const danger = clamp(amount / HEAT.max, 0, 1);
  return HEAT.outlineFrom + (1 - HEAT.outlineFrom) * danger;
}

/** The "close" spark: 8 lines and 5 gold flecks at the tight spot, and a ring flicker at the nib. */
const SPARK = { lines: 8, r0: dp(4), len: dp(8), flecks: 5, ms: 320, ring: dp(9), ringMs: 150, ringAlpha: 0.55 } as const;

/** The death's splat (SPEC §3.6): a blot, 11 droplets thrown along the travel, two rings. */
const SPLAT = { blot: dp(5.2), drops: 11, reach: dp(24), spread: 2.4, rings: [dp(13), dp(20)] } as const;

/** The mirror death's arc arrow over the fold. */
const ARROW = { width: dp(1.6), dash: dp(4), gap: dp(3.5), head: dp(8), lift: dp(26), label: dp(13.5) } as const;

/** The win's bloom (SPEC §3.7), ms from the moment the line closes. */
export const BLOOM = {
  catchMs: 260,
  fill: [150, 510],
  glow: [300, 900],
  rays: [350, 900],
  rayCount: 44,
  fleckCount: 20,
  // The warm bloom behind the figure: stronger than the first 0.4, which the
  // lifted fill no longer outshone (QA: the B mock's figure glows).
  glowAlpha: 0.55,
} as const;

/** The path actually drawn, plus its timing, from the collision-tested samples. */
function drawnPath(raw: readonly Vec2[], times: readonly number[]): DrawnStroke {
  return renderStroke(raw, times, METRICS.renderMaxSpacing, METRICS.smoothIterations);
}

/** Nib options for the current theme. */
function nibOpts(): RibbonOptions {
  return { ...DEFAULT_RIBBON, baseWidth: pt(theme().strokePt) };
}

/** The widest the line's ink reaches past its centreline, at `k` × the nib, plus antialiasing. */
function inkReach(k = 1): number {
  return Math.ceil((pt(theme().strokePt) / 2) * DEFAULT_RIBBON.maxScale * k) + 2;
}

/** The widest bloom pass, as a multiple of the nib. */
function bloomWidth(): number {
  return theme().lineBloom.reduce((m, b) => Math.max(m, b.width), 1);
}

/** Sides for a full circle of radius r to stay within CURVE_TOLERANCE of it. */
function curveSides(r: number): number {
  if (r <= CURVE_TOLERANCE) return 6;
  return clamp(Math.ceil(Math.PI / Math.acos(1 - CURVE_TOLERANCE / r)), 6, 100);
}

const unitCircles = new Map<number, Vec2[]>();

function fillDisc(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number): void {
  const sides = curveSides(r);
  let unit = unitCircles.get(sides);
  if (!unit) {
    unit = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      unit.push({ x: Math.cos(a), y: Math.sin(a) });
    }
    unitCircles.set(sides, unit);
  }
  g.fillPoints(
    unit.map((u) => ({ x: x + u.x * r, y: y + u.y * r })),
    true
  );
}

/** `fillRoundedRect`, with corners cut only as finely as their radius needs. */
function fillRoundRect(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  if (r <= CURVE_TOLERANCE) {
    g.fillRect(x, y, w, h);
    return;
  }
  g.fillPoints(roundRectPoints(x, y, w, h, r), true);
}

/**
 * The outline `fillRoundRect` fills, clockwise on screen. A radius under the
 * curve tolerance gives the four corners.
 */
function roundRectPoints(x: number, y: number, w: number, h: number, r: number): Vec2[] {
  if (r <= CURVE_TOLERANCE) {
    return [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ];
  }
  const steps = Math.max(1, Math.ceil(curveSides(r) / 4));
  const pts: Vec2[] = [];
  const corner = (cx: number, cy: number, from: number): void => {
    for (let i = 0; i <= steps; i++) {
      const a = from + (Math.PI / 2) * (i / steps);
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
  };
  corner(x + w - r, y + r, -Math.PI / 2);
  corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, Math.PI / 2);
  corner(x + r, y + r, Math.PI);
  return pts;
}

/**
 * Paint ribbon parts: every segment as a quad, every joint as a disc.
 *
 * Always at full opacity for the ink the player draws. Neighbouring quads
 * overlap, and at reduced alpha each overlap would darken where it met the
 * next, so the stroke would look beaded. The mirror is lightened by
 * pre-blending its COLOUR instead — see `veiledInk`. Translucent passes (the
 * bloom) are painted opaque into a texture and faded there, as a whole.
 */
function paintParts(
  g: Phaser.GameObjects.Graphics,
  part: Ribbon,
  color: number,
  alpha = 1
): void {
  g.fillStyle(color, alpha);
  for (const q of part.quads) g.fillPoints([q.a, q.b, q.c, q.d], true);
  for (const d of part.discs) {
    if (d.r > 0.25) fillDisc(g, d.p.x, d.p.y, d.r);
  }
}

/**
 * `widths` × `k` over the indices a slice [from, to) reads — its own and the
 * one before it, for its first quad. The rest stay empty: the pass never
 * reads them, and scaling a thousand-sample line on every move to use twelve
 * of them is waste.
 */
function scaledRange(widths: readonly number[], k: number, from: number, to: number): readonly number[] {
  if (k === 1) return widths;
  const out = new Array<number>(widths.length);
  for (let i = Math.max(0, from - 1); i < to; i++) out[i] = widths[i] * k;
  return out;
}

/** Supersampling for a baked texture of w×h, within the GPU's largest texture. */
function bakeScale(scene: Phaser.Scene, w: number, h: number, want: number = BAKE_SUPERSAMPLE): number {
  const renderer = scene.game.renderer as { getMaxTextureSize?: () => number };
  const maxSide = renderer.getMaxTextureSize?.() ?? 4096;
  return Math.min(want, maxSide / Math.max(w, h, 1));
}

/** Smallest even whole number of texels covering `px` base pixels at `scale`. */
const evenTexels = (px: number, scale: number): number => 2 * Math.ceil((px * scale) / 2);

/* ------------------------------------------------------------ pure parts */

/**
 * The print-in's timing for `rows` obstacle rows in at most `total` ms: each
 * row starts `step` after the one below it (never more than PRINT_STEP_MAX)
 * and fades up over `fade`; the last is in place at `end`.
 */
export function printSchedule(rows: number, total: number = PRINT_MS): { step: number; fade: number; end: number } {
  const fade = Math.min(PRINT_FADE_MS, Math.max(1, total));
  const n = Math.max(0, Math.floor(rows));
  const step = n > 0 ? Math.min(PRINT_STEP_MAX, Math.max(0, total - fade) / n) : 0;
  return { step, fade, end: n * step + fade };
}

/**
 * The print-in's row edges, bottom first: the board's bottom, a line halfway
 * between each pair of rows, the board's top. The crop edge travels between
 * them, so it crosses a row's walls only while that row is printing and never
 * leaves a sliver of the next one.
 */
export function printEdges(rows: readonly number[], top: number, bottom: number): number[] {
  const edges = [bottom];
  for (let k = 0; k + 1 < rows.length; k++) edges.push((rows[k] + rows[k + 1]) / 2);
  edges.push(top);
  return edges;
}

/** The y at fractional row `f` along `edges` (0 = the bottom, edges.length − 1 = the top). */
export function edgeAt(edges: readonly number[], f: number): number {
  const last = edges.length - 1;
  if (last <= 0) return edges[0] ?? 0;
  const x = clamp(f, 0, last);
  const i = Math.min(last - 1, Math.floor(x));
  return edges[i] + (edges[i + 1] - edges[i]) * (x - i);
}

/**
 * Where the print-in stands `t` ms in: the leading edge (rows below it have
 * begun) and the settled edge (rows below it are fully printed). Between the
 * two is the soft front, fading up.
 */
export function printFront(
  t: number,
  edges: readonly number[],
  sched: { step: number; fade: number; end: number }
): { lead: number; settled: number } {
  const rows = edges.length - 1;
  const travel = Math.max(1e-6, sched.end - sched.fade);
  const f = (ms: number): number => (sched.end - sched.fade <= 0 ? (ms >= 0 ? rows : 0) : (rows * ms) / travel);
  return { lead: edgeAt(edges, f(t)), settled: edgeAt(edges, f(t - sched.fade)) };
}

/**
 * The rows a stroke has crossed alive: the same test as GameScene.ringGates —
 * a recorded segment whose ends lie on different sides of a row's midline —
 * over the recorded samples from `from`, so the notches light on exactly the
 * crossings the row notes and the Light haptic fire on. Returns the newest
 * row lit, or null; `lit` is updated in place.
 */
export function crossRows(
  raw: readonly Vec2[],
  rows: readonly number[],
  lit: boolean[],
  from: number
): number | null {
  let newest: number | null = null;
  for (let i = Math.max(1, from); i < raw.length; i++) {
    const a = raw[i - 1];
    const b = raw[i];
    for (let r = 0; r < rows.length; r++) {
      if (lit[r]) continue;
      if (a.y > rows[r] === b.y > rows[r]) continue;
      lit[r] = true;
      newest = r;
    }
  }
  return newest;
}

/**
 * A splat's droplets, thrown along `dir`: the same throw every death (the
 * jitter is fixed), so a splat reads as the line's momentum, not as noise.
 */
export function splatDrops(dir: Vec2, n: number = SPLAT.drops): { dx: number; dy: number; reach: number; r: number }[] {
  const len = Math.hypot(dir.x, dir.y);
  const base = len > 1e-9 ? Math.atan2(dir.y, dir.x) : -Math.PI / 2;
  return Array.from({ length: n }, (_, i) => {
    const u = (i * 0.618034) % 1;
    const v = (i * 0.381966 + 0.25) % 1;
    const a = base + SPLAT.spread * (u - 0.5);
    return {
      dx: Math.cos(a),
      dy: Math.sin(a),
      // Along the throw the drops fly furthest; off it they fall short.
      reach: SPLAT.reach * (0.35 + 0.65 * v) * (1 - 0.45 * Math.abs(u - 0.5)),
      r: dp(1.1) + dp(1.5) * ((i * 0.7548776) % 1),
    };
  });
}

/**
 * The arc arrow's curve: a quadratic from the pen's head over the fold to
 * the reflection's contact, lifted above the higher of the two so it reads
 * as "over there", not as a line through the maze.
 */
export function arcCurve(from: Vec2, to: Vec2, samples = 40): Vec2[] {
  const cx = (from.x + to.x) / 2;
  const cy = Math.min(from.y, to.y) - Math.max(ARROW.lift, Math.abs(to.x - from.x) * 0.45);
  const out: Vec2[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    out.push({ x: a * from.x + b * cx + c * to.x, y: a * from.y + b * cy + c * to.y });
  }
  return out;
}

/** A polyline cut into dashes of `dash` with `gap` between, up to `upTo` of its length. */
function dashesAlong(pts: readonly Vec2[], dash: number, gap: number, upTo = Infinity): [Vec2, Vec2][] {
  const out: [Vec2, Vec2][] = [];
  let travelled = 0;
  let on = true;
  let left = dash;
  let start: Vec2 = pts[0];
  for (let i = 1; i < pts.length && travelled < upTo; i++) {
    let a = pts[i - 1];
    const b = pts[i];
    let seg = Math.hypot(b.x - a.x, b.y - a.y);
    while (seg > 1e-9 && travelled < upTo) {
      const step = Math.min(seg, left, upTo - travelled);
      const f = step / seg;
      const p = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      travelled += step;
      seg -= step;
      left -= step;
      if (on) {
        if (left <= 1e-9 || travelled >= upTo || seg <= 1e-9) out.push([start, p]);
      }
      if (left <= 1e-9) {
        on = !on;
        left = on ? dash : gap;
        start = p;
      }
      a = p;
    }
    if (on && seg <= 1e-9 && left > 1e-9) start = on ? start : b;
  }
  return out;
}

/* ---------------------------------------------------------------- InkPass */

/** One way of inking a line: how wide, at what resolution, how it is shown. */
interface PassSpec {
  /** The ribbon's width, as a multiple of the nib. */
  readonly width: number;
  /** Texels per base unit the pass is baked at. */
  readonly res: number;
  /**
   * Bake every point on every move, the still-moving tail included, as a
   * union: for a translucent pass, which cannot have a live Graphics end
   * (overlapping quads at partial alpha bead) and whose soft edge hides the
   * few pixels a settling tail moves.
   */
  readonly eager: boolean;
  readonly depth: number;
  /** The whole pass's alpha, applied to its texture as one. */
  readonly alpha: number;
  /**
   * A glow: rings of the ribbon at `width` × `width` each, filled at their
   * `level` under a MAX blend (`blend`), so the texture holds the brightest
   * ring at every texel whatever order — or however often — they land in.
   */
  readonly levels?: readonly { readonly width: number; readonly level: number }[];
  /** The renderer's MAX blend mode, for `levels`. */
  readonly blend?: number;
}

/**
 * The renderer's MAX blend mode — a custom Phaser blend whose equation keeps
 * the brighter of source and destination, channel by channel — or null where
 * there is none (no WebGL, or WebGL 1 without EXT_blend_minmax, which every
 * iPhone has). Made once per renderer.
 */
const maxBlends = new WeakMap<object, number | null>();

function maxBlendMode(scene: Phaser.Scene): number | null {
  const r = scene.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
  if (!r || r.type !== Phaser.WEBGL || !r.gl) return null;
  const gl = r.gl;
  // Asked every time, not only once: a context lost and restored (iOS can
  // drop one in the background) must have the extension enabled again.
  const ext = gl.getExtension('EXT_blend_minmax') as { MAX_EXT?: number } | null;
  if (maxBlends.has(r)) return maxBlends.get(r) ?? null;
  const eq = (gl as unknown as { MAX?: number }).MAX ?? ext?.MAX_EXT;
  const mode = eq ? r.addBlendMode([gl.ONE, gl.ONE], eq) : null;
  maxBlends.set(r, mode);
  return mode;
}

/**
 * One half of the live ink — the stroke, or its reflection, or one of the
 * stroke's extra passes — kept cheap to draw however long it gets.
 *
 * A Graphics object is not a picture. Phaser replays and re-triangulates its
 * whole command list on every frame, changed or not, so a line painted as quads
 * and discs cost more every frame the longer it got: about 30fps near the end
 * of level 300. But almost all of a growing ribbon is already final (see
 * `settledPoints`), so that part is painted ONCE, into a texture, and only the
 * few samples at the pen are redrawn per move — on the pass's own Graphics,
 * just above the texture.
 *
 * The texture holds the ink in white and is tinted to the ink's colour, which
 * is how the fail flash turns the whole line red without repainting any of it.
 * It covers only the region this half's ink can reach, and is created on the
 * first bake. The canvas renderer cannot tint, so there — a fallback no iPhone
 * takes — nothing is baked: the line stays live, and a translucent pass (the
 * bloom) is simply absent, never broken (tech G3).
 */
class InkPass {
  private rt: Phaser.GameObjects.RenderTexture | null = null;
  private baker: Phaser.GameObjects.Graphics | null = null;
  /** Leading points of the current stroke already in the texture. */
  private baked = 0;
  private readonly bakes: boolean;
  private shown = true;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly spec: PassSpec,
    private readonly region: Rect,
    private readonly live: Phaser.GameObjects.Graphics | null
  ) {
    this.bakes = scene.game.renderer.type === Phaser.WEBGL;
  }

  /** Show a path whose first `settled` points will not change again. */
  paint(points: readonly Vec2[], widths: readonly number[], settled: number, color: number): void {
    const k = this.spec.width;
    const n = points.length;
    if (this.spec.eager) {
      if (!this.bakes) return;
      const from = Math.min(this.baked, n);
      if (n > from) {
        const levels = this.spec.levels;
        if (levels) {
          this.bakeLevels(
            levels.map((l) => ({ part: ribbonSlice(points, scaledRange(widths, l.width, from, n), from, n), level: l.level }))
          );
        } else {
          this.bake(ribbonSlice(points, scaledRange(widths, k, from, n), from, n));
        }
      }
      this.baked = Math.min(settled, n);
      this.rt?.setTint(color);
      return;
    }
    const upTo = this.bakes ? Math.min(settled, n) : 0;
    let next = this.baked;
    // A point whose ink would spill past the texture simply stays live.
    while (next < upTo && this.fits(points[next], widths[next] * k)) next++;
    if (next > this.baked) {
      this.bake(ribbonSlice(points, scaledRange(widths, k, this.baked, next), this.baked, next));
      this.baked = next;
    }
    this.rt?.setTint(color);
    if (this.live) {
      this.live.clear();
      paintParts(this.live, ribbonSlice(points, scaledRange(widths, k, this.baked, n), this.baked, n), color);
    }
  }

  setVisible(on: boolean): void {
    this.shown = on;
    this.forgetDead();
    this.rt?.setVisible(on);
    if (this.live?.scene) this.live.setVisible(on);
  }

  /** What this pass shows on the board now: its texture, and its live end. */
  parts(): Effect[] {
    this.forgetDead();
    const out: Effect[] = [];
    if (this.rt) out.push(this.rt);
    if (this.live?.scene) out.push(this.live);
    return out;
  }

  /** Forget the stroke. `release` frees the texture too, until the next bake. */
  clear(release = false): void {
    this.baked = 0;
    this.forgetDead();
    this.live?.clear();
    if (release) {
      this.rt?.destroy();
      this.baker?.destroy();
      this.rt = null;
      this.baker = null;
    } else {
      this.rt?.clear();
    }
  }

  destroy(): void {
    this.clear(true);
    this.live?.destroy();
  }

  private fits(p: Vec2, r: number): boolean {
    const m = r + 1; // and the antialiased edge
    const { x, y, w, h } = this.region;
    return p.x - m >= x && p.x + m <= x + w && p.y - m >= y && p.y + m <= y + h;
  }

  private bake(part: Ribbon): void {
    this.ensureTexture();
    if (!this.rt || !this.baker) return;
    this.baker.clear();
    paintParts(this.baker, part, 0xffffff);
    this.rt.draw(this.baker);
  }

  /** A glow's rings, each at its level, under the MAX blend: brightest ring wins. */
  private bakeLevels(rings: readonly { part: Ribbon; level: number }[]): void {
    this.ensureTexture();
    if (!this.rt || !this.baker) return;
    this.baker.clear();
    for (const r of rings) paintParts(this.baker, r.part, 0xffffff, r.level);
    this.rt.draw(this.baker);
  }

  /**
   * Drop a texture destroyed under the pass. A win lends the pass's objects
   * to the board's frame (InkRenderer.frameBoard); a scene that shuts down
   * with the frame up destroys them with it, before the renderer's own
   * destroy asks the pass to clear — and a destroyed RenderTexture has no
   * renderer left to clear with.
   */
  private forgetDead(): void {
    if (this.rt && !this.rt.scene) {
      this.rt = null;
      this.baker?.destroy();
      this.baker = null;
    }
  }

  private ensureTexture(): void {
    this.forgetDead();
    if (!this.rt || !this.baker) {
      const { x, y, w, h } = this.region;
      const s = bakeScale(this.scene, w, h, this.spec.res);
      this.rt = this.scene.add
        .renderTexture(x, y, evenTexels(w, s), evenTexels(h, s))
        .setOrigin(0, 0)
        .setScale(1 / s)
        .setAlpha(this.spec.alpha)
        .setVisible(this.shown)
        .setDepth(this.live ? this.live.depth - BAKED_BELOW : this.spec.depth);
      this.baker = this.scene.make.graphics({ x: -x * s, y: -y * s }, false).setScale(s);
      if (this.spec.blend !== undefined) this.baker.setBlendMode(this.spec.blend);
    }
  }
}

/* ------------------------------------------------------------ textures */

/**
 * The Image can still be cropped: alive, on a frame whose texture was not
 * removed under it (a removed texture's frames drop their source and data,
 * and setCrop then throws inside Phaser).
 */
function croppable(img: Phaser.GameObjects.Image): boolean {
  return img.active && Boolean(img.frame?.source);
}

let rendererSeq = 0;

/** A canvas texture of w × h under `key`, painted by `paint` — replaced if one of another size is there. */
function canvasTexture(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  paint: (ctx: CanvasRenderingContext2D) => void
): string | null {
  const tm = scene.textures;
  const W = Math.max(1, Math.ceil(w));
  const H = Math.max(1, Math.ceil(h));
  let tex = tm.exists(key) ? (tm.get(key) as Phaser.Textures.CanvasTexture) : null;
  if (tex && (tex.width !== W || tex.height !== H || typeof tex.getContext !== 'function')) {
    tm.remove(key);
    tex = null;
  }
  tex = tex ?? tm.createCanvas(key, W, H);
  if (!tex) return null;
  const ctx = tex.getContext();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.restore();
  ctx.save();
  paint(ctx);
  ctx.restore();
  tex.refresh();
  return key;
}

/** A small, shared, never-changing texture: made once for the session (they are a few KB each). */
function stamp(scene: Phaser.Scene, key: string, w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): string {
  if (scene.textures.exists(key)) return key;
  return canvasTexture(scene, key, w, h, paint) ?? '__MISSING';
}

/** The live start dot: tangerine with the lamp's highlight. */
function startTexture(scene: Phaser.Scene): string {
  const r = START_DOT_R;
  const s = Math.ceil(r + 3);
  return stamp(scene, `fw-ink-start-${r}`, s * 2, s * 2, (ctx) => paintStartDot(ctx, s, s, r, false));
}

/** The live goal: the ring (exactly goalRadius) on its disc, with its dot. */
function goalTexture(scene: Phaser.Scene): string {
  const r = METRICS.goalRadius;
  const s = Math.ceil(r + 3);
  return stamp(scene, `fw-ink-goal-${r}`, s * 2, s * 2, (ctx) => paintGoalRing(ctx, s, s, r, goalRingWidth(1), false));
}

/** A thin ring of radius r — the goal's halo pulse, the ready ripple; tinted and scaled by the caller. */
function ringTexture(scene: Phaser.Scene, r: number, width: number): string {
  const s = Math.ceil(r + width + 2);
  return stamp(scene, `fw-ink-ring-${Math.round(r)}-${Math.round(width * 10)}`, s * 2, s * 2, (ctx) => {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(s, s, r, 0, Math.PI * 2);
    ctx.stroke();
  });
}

/** The nib: halo, ring, hot dot. */
function nibTexture(scene: Phaser.Scene): string {
  const t = theme();
  const s = Math.ceil(NIB.halo + 2);
  return stamp(scene, 'fw-ink-nib', s * 2, s * 2, (ctx) => {
    const g = ctx.createRadialGradient(s, s, 0, s, s, NIB.halo);
    g.addColorStop(0, rgba(t.line, NIB.haloAlpha));
    g.addColorStop(0.55, rgba(t.line, NIB.haloAlpha * 0.55));
    g.addColorStop(1, rgba(t.line, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s * 2, s * 2);
    ctx.strokeStyle = rgba(t.line, 1);
    ctx.lineWidth = NIB.ringWidth;
    ctx.beginPath();
    ctx.arc(s, s, NIB.ring, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = rgba(t.lineCore, 1);
    ctx.beginPath();
    ctx.arc(s, s, NIB.dot, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** The fingertip's shadow: a soft ellipse of the page's light, 24 × 27 pt. */
function fingerTexture(scene: Phaser.Scene): string {
  const w = Math.ceil(FINGER.w);
  const h = Math.ceil(FINGER.h);
  return stamp(scene, 'fw-ink-finger', w, h, (ctx) => {
    ctx.translate(w / 2, h / 2);
    ctx.scale(1, h / w);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w / 2);
    g.addColorStop(0, rgba(ui().glass, FINGER.alpha));
    g.addColorStop(1, rgba(ui().glass, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
    ctx.fill();
  });
}

/**
 * The heat's (and the wall flash's) glow: white, tinted per use, nine-sliced
 * to any wall. Three glows stacked, each the wall's rect grown by its own
 * `spread` and blurred by its own `blur` — tight and bright on the edge, wide
 * and soft past it — because one canvas shadow is only half its colour at the
 * rect's edge and gone a blur later: the light has to be most of the way up
 * where the slate stops hiding it, and still there several points out.
 */
const HEAT_PASSES = [
  { spread: dp(1.5), blur: dp(8), alpha: 1 },
  { spread: dp(4), blur: dp(18), alpha: 0.9 },
  { spread: dp(7), blur: dp(30), alpha: 0.6 },
] as const;

function heatPanel(scene: Phaser.Scene, w: Rect): Panel {
  const r = METRICS.wallCornerRadius;
  const specs = HEAT_PASSES.map((p) => ({
    grow: p.spread,
    spec: { radius: r + p.spread, face: { kind: 'none' }, glow: { color: 0xffffff, alpha: p.alpha, blur: p.blur } } as PanelSpec,
  }));
  const pad = Math.ceil(
    Math.max(...specs.map(({ grow, spec }) => {
      const pp = panelPad(spec);
      return Math.max(pp.side, pp.top, pp.bottom) + grow;
    }))
  );
  return bakedPanel(
    scene,
    'ink-heat-halo3',
    w.w,
    w.h,
    (ctx, x, y, pw, ph) => {
      for (const { grow, spec } of specs) paintPanel(ctx, x - grow, y - grow, pw + 2 * grow, ph + 2 * grow, spec);
    },
    { pad, slice: Math.ceil(r) + 1 },
    w.x + w.w / 2,
    w.y + w.h / 2
  );
}

/* ---------------------------------------------------------- InkRenderer */

export class InkRenderer {
  private readonly id = ++rendererSeq;
  /* The board. */
  private sheetImg: Phaser.GameObjects.Image | null = null;
  /** The sheet's e3 shadow: one shared nine-slice, under the sheet. */
  private sheetShadow: Panel | null = null;
  private sheetBox: Rect = { x: 0, y: 0, w: 1, h: 1 };
  private wallsImg: Phaser.GameObjects.Image | null = null;
  /** The print-in's soft front: the same walls texture, cropped to the rows fading up. */
  private frontImg: Phaser.GameObjects.Image | null = null;
  private wallsBox: Rect = { x: 0, y: 0, w: 1, h: 1 };
  private readonly axisG: Phaser.GameObjects.Graphics;
  private startImg: Phaser.GameObjects.Image | null = null;
  private goalImg: Phaser.GameObjects.Image | null = null;
  private goalHalo: Phaser.GameObjects.Image | null = null;
  /** The start dot's glow: what breathes, so the dot itself stays opaque tangerine. */
  private startHalo: Phaser.GameObjects.Image | null = null;
  private ripple: Phaser.GameObjects.Image | null = null;
  /** The one thing breathing on the board, and the pulse that goes with it. */
  private readonly loops: Phaser.Tweens.Tween[] = [];
  private startPx: Vec2 = { x: 0, y: 0 };
  private goalPx: Vec2 = { x: 0, y: 0 };
  /** A stroke has begun on this level: the goal calls, the start waits. */
  private touched = false;
  /* The fold as a meter. */
  private rows: number[] = [];
  private lit: boolean[] = [];
  private rowScan = 0;
  /* The print-in. */
  private printTween: Phaser.Tweens.Tween | null = null;
  private creaseLight: Phaser.GameObjects.Image | null = null;
  /** Where the last mirror death's arc arrow and its label are, while they show (see arrowRects). */
  private arrowBoxes: Rect[] = [];
  private arrowG: Phaser.GameObjects.Graphics | null = null;
  /* Danger. */
  private heatGlow: Panel | null = null;
  private readonly heatLine: Phaser.GameObjects.Graphics;
  private heat: { wall: number; tight: boolean } | null = null;
  /* The line. */
  private readonly revealG: Phaser.GameObjects.Graphics;
  private readonly ghostG: Phaser.GameObjects.Graphics;
  /** The live ends of the reflection, the stroke and its core; see InkPass. */
  private readonly mirrorG: Phaser.GameObjects.Graphics;
  private readonly strokeG: Phaser.GameObjects.Graphics;
  private readonly coreG: Phaser.GameObjects.Graphics;
  private readonly mirrorInk: InkPass;
  private readonly strokeInk: InkPass;
  private readonly coreInk: InkPass;
  private readonly glowInk: InkPass[];
  private readonly wetG: Phaser.GameObjects.Graphics;
  private wetCount = WET_SAMPLES;
  /** 1 wet, 0 dry: how much of the wet look the head still has. */
  private wet = { d: 0 };
  private wetTween: Phaser.Tweens.Tween | null = null;
  private stillTimer: Phaser.Time.TimerEvent | null = null;
  /** What the wet head is painted over: the drawn line as it stands. */
  private head: { points: readonly Vec2[]; widths: readonly number[]; color: number } | null = null;
  private nibImg: Phaser.GameObjects.Image | null = null;
  private nibAt: Vec2 | null = null;
  private fingerImg: Phaser.GameObjects.Image | null = null;
  private fingerG: Phaser.GameObjects.Graphics | null = null;
  private fingerAt: Vec2 | null = null;
  private readonly washG: Phaser.GameObjects.Graphics;
  /* The win. */
  /** A win's figure is up: the line on the board is the figure's line, kept (see presentWin). */
  private figureUp = false;
  /** Which win the deferred fill bake belongs to — a clearWin in between drops it. */
  private winSeq = 0;
  private winFill: Phaser.GameObjects.Image | null = null;
  private winKeys: string[] = [];
  /** The win's own tweens that drive plain counters, not its objects — stopped with it. */
  private winTweens: Phaser.Tweens.Tween[] = [];
  /** The page's share of the fail wash — see flashFail. */
  private washDim: number | null = null;
  /** The level's walls, as drawn — the wall flash and the heat look their wall up here by index. */
  private walls: readonly Rect[] = [];
  /** The band shape the reveal is clipped to — see showReveal. */
  private revealShape: Phaser.GameObjects.Graphics | null = null;
  /** The win's frame move, while one is on — see frameBoard. */
  private frame: Phaser.GameObjects.Container | null = null;
  private framePivot: Vec2 = { x: 0, y: 0 };
  /** The walls' alpha the win left them at, for the frame not to raise it. */
  private wallsWinAlpha = 1;
  /** The crease, the droplets, the rays, the glow: they belong to one win and go with it. */
  private readonly winFx: Effects = new Map();
  /** The splat, the arrow and the wall flash: they belong to one death. */
  private readonly failFx: Effects = new Map();
  /** Sparks and notch pops: they belong to the stroke they lit. */
  private readonly fx: Effects = new Map();
  /** Enough of the stroke on screen to tell whether the next one continues it. */
  private drawn: { n: number; first: Vec2; last: Vec2; t0: number; tLast: number } | null =
    null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly pf: Playfield
  ) {
    const t = theme();
    this.axisG = scene.add.graphics().setDepth(DEPTH.axis);
    this.heatLine = scene.add.graphics().setDepth(DEPTH.heatLine).setVisible(false);
    this.revealG = scene.add.graphics().setDepth(DEPTH.reveal).setAlpha(0);
    // Below the live stroke: the previous attempt, kept as a faint ghost.
    this.ghostG = scene.add.graphics().setDepth(DEPTH.reveal).setAlpha(0);
    // Opaque; the reflection's lightness lives in its colour, not its alpha.
    this.mirrorG = scene.add.graphics().setDepth(DEPTH.mirror);
    this.strokeG = scene.add.graphics().setDepth(DEPTH.stroke);
    this.coreG = scene.add.graphics().setDepth(DEPTH.core);
    this.wetG = scene.add.graphics().setDepth(DEPTH.wet);
    this.washG = scene.add.graphics().setDepth(DEPTH.wash).setAlpha(0);

    /*
     * The ink is clamped to the drawable half (Playfield.clampToDrawable) and
     * smoothing only ever averages points inside it, so each half's ink stays
     * within its half of the playfield plus the widest nib — and the bloom's
     * passes within their own wider reach.
     */
    const half = (x0: number, x1: number, reach: number): Rect => ({
      x: Math.floor(x0) - reach,
      y: Math.floor(pf.y) - reach,
      w: Math.ceil(x1 - x0) + 2 * reach + 1,
      h: Math.ceil(pf.h) + 2 * reach + 1,
    });
    const left = (reach: number): Rect => half(pf.x, pf.axisX, reach);
    this.strokeInk = new InkPass(
      scene,
      { width: 1, res: BAKE_SUPERSAMPLE, eager: false, depth: DEPTH.stroke, alpha: 1 },
      left(inkReach()),
      this.strokeG
    );
    this.coreInk = new InkPass(
      scene,
      { width: t.lineCoreWidth, res: CORE_BAKE, eager: false, depth: DEPTH.core, alpha: 1 },
      left(inkReach(t.lineCoreWidth)),
      this.coreG
    );
    /*
     * The bloom (OWNER-DECISIONS 1): the theme's two passes — 3.2× the nib at
     * 0.18, 2.0× at 0.22 — as one smooth falloff of the same reach and peak
     * (ShareCard.bloomProfile), baked into ONE texture at half resolution
     * under a MAX blend and tinted. No postFX, no per-frame filter (tech G3).
     * Without a MAX blend it is simply absent — never a banded, beaded glow.
     */
    const blend = maxBlendMode(scene);
    const levels = bloomProfile();
    this.glowInk =
      blend === null || levels.length === 0
        ? []
        : [
            new InkPass(
              scene,
              { width: 1, res: GLOW_RES, eager: true, depth: DEPTH.glow, alpha: 1, levels, blend },
              left(inkReach(bloomWidth())),
              null
            ),
          ];
    this.mirrorInk = new InkPass(
      scene,
      { width: 1, res: BAKE_SUPERSAMPLE, eager: false, depth: DEPTH.mirror, alpha: 1 },
      half(pf.axisX, 2 * pf.axisX - pf.x, inkReach()),
      this.mirrorG
    );
  }

  /* --------------------------------------------------------------- level */

  /**
   * The level's board, from the level itself: `drawLevel` in board pixels,
   * then the print-in (SPEC §3.2) unless `printIn` is false. Pass a shorter
   * print-in for a Retry (250 ms).
   */
  bakeBoard(
    level: Pick<Level, 'walls' | 'start' | 'goal'>,
    opts: { printIn?: number | false } = {}
  ): void {
    const pf = this.pf;
    this.drawLevel(
      level.walls.map((w) => pf.toScreenRect(w)),
      pf.toScreen(level.start),
      pf.toScreen(level.goal),
      { printIn: opts.printIn ?? PRINT_MS }
    );
  }

  /**
   * Takes pixel-space geometry, not level-space: converting normalized
   * coordinates is the Playfield's job and happens once, when a level loads.
   *
   * Bakes the board — the sheet (once per board place), then this level's
   * walls and the mirrored markers into one texture — and places the live
   * start dot and goal ring, which breathe and call. No print-in unless asked:
   * a board that only moved (a resize) must not print itself again.
   */
  drawLevel(walls: readonly Rect[], startPx: Vec2, goalPx: Vec2, opts: { printIn?: number | false } = {}): void {
    // A board left framed by the last win would draw the new maze scaled and
    // faded, away from where collision puts its walls.
    this.resetFrame();
    this.clearEffects(this.failFx);
    this.clearEffects(this.fx);
    this.completePrintIn();
    this.setHeat(null);
    this.walls = walls;
    this.startPx = { x: startPx.x, y: startPx.y };
    this.goalPx = { x: goalPx.x, y: goalPx.y };
    this.touched = false;

    this.bakeSheet();
    this.bakeWalls();
    this.placeMarkers();

    this.rows = obstacleRows(walls, mirrorBands(walls, this.pf.axisX, this.pf.x));
    this.lit = this.rows.map(() => false);
    this.rowScan = 0;
    this.drawAxis();
    this.idleState(false);

    if (opts.printIn !== undefined && opts.printIn !== false) this.printIn(opts.printIn);
  }

  /**
   * The sheet: the night board, the crease, the far half's shade — painted
   * once per board place — over its e3 shadow. The shadow is Baked's shared
   * nine-slice rather than part of this bake: a 50 pt blur over the whole
   * sheet was most of what a level install cost (52 ms at the 4× proxy), and
   * a rounded rect's shadow is the same along every edge.
   */
  private bakeSheet(): void {
    const pf = this.pf;
    const sheet = sheetAround(pf);
    const box: Rect = { x: Math.floor(sheet.x), y: Math.floor(sheet.y), w: Math.ceil(sheet.w), h: Math.ceil(sheet.h) };
    /*
     * Keyed by its size alone: the sheet is painted in its own coordinates,
     * and the playfield never changes size (it is only moved), so every board
     * in the session is this one texture. Painted at the first level, kept —
     * like the sky — rather than re-painted and re-uploaded on every visit.
     */
    const key = `fw-ink-sheet-${box.w}x${box.h}`;
    if (this.sheetImg && this.sheetImg.texture.key === key && this.sheetBox.x === box.x && this.sheetBox.y === box.y) return;
    this.sheetBox = box;
    const made = this.scene.textures.exists(key)
      ? key
      : canvasTexture(this.scene, key, box.w, box.h, (ctx) => {
          paintBoardSheet(ctx, sheet.x - box.x, sheet.y - box.y, sheet.w, sheet.h, {
            radius: BOARD_SHEET.radius,
            axisX: pf.axisX - sheet.x,
          });
        });
    if (!made) return;
    this.sheetImg?.destroy();
    this.sheetImg = this.scene.add.image(box.x, box.y, key).setOrigin(0, 0).setDepth(DEPTH.sheet);
    this.sheetShadow?.destroy();
    this.sheetShadow = panel(this.scene, 'ink-board-e3', sheet.x + sheet.w / 2, sheet.y + sheet.h / 2, sheet.w, sheet.h, {
      radius: BOARD_SHEET.radius,
      face: { kind: 'none' },
      elevation: 'e3',
    }).setDepth(DEPTH.sheet - 0.5);
  }

  /** The walls and the reflected markers, baked into this renderer's one walls texture. */
  private bakeWalls(): void {
    const pf = this.pf;
    // Room for the walls' cast shadow and the reflected goal ring past the field.
    const pad = Math.ceil(WALL_SHADOW.dy + WALL_SHADOW.blur * 2) + 2;
    const box: Rect = { x: Math.floor(pf.x) - pad, y: Math.floor(pf.y) - pad, w: Math.ceil(pf.w) + 2 * pad, h: Math.ceil(pf.h) + 2 * pad };
    this.wallsBox = box;
    const key = `fw-ink-walls-${this.id}`;
    const start = pf.mirror(this.startPx);
    const goal = pf.mirror(this.goalPx);
    const made = canvasTexture(this.scene, key, box.w, box.h, (ctx) => {
      ctx.translate(-box.x, -box.y);
      paintWalls(ctx, this.walls, METRICS.wallCornerRadius, 1);
      // Reflections of the markers, in veil. They are not targets.
      paintStartDot(ctx, start.x, start.y, START_DOT_R, true);
      paintGoalRing(ctx, goal.x, goal.y, METRICS.goalRadius, goalRingWidth(1), true);
    });
    if (!made) return;
    if (!this.wallsImg) {
      this.wallsImg = this.scene.add.image(box.x, box.y, key).setOrigin(0, 0).setDepth(DEPTH.level);
    } else {
      // The same texture, repainted: the Image re-reads its frame's size.
      this.wallsImg.setTexture(key).setPosition(box.x, box.y);
    }
    this.wallsImg.setCrop().setAlpha(1).setVisible(true);
    this.wallsWinAlpha = 1;
  }

  /** The live markers: the start dot and the goal ring, each its own Image so it can breathe. */
  private placeMarkers(): void {
    const s = this.scene;
    const t = theme();
    this.stopLoops();
    this.startImg ??= s.add.image(0, 0, startTexture(s)).setDepth(DEPTH.markers);
    this.goalImg ??= s.add.image(0, 0, goalTexture(s)).setDepth(DEPTH.markers);
    this.goalHalo ??= s.add
      .image(0, 0, ringTexture(s, METRICS.goalRadius, dp(1.6)))
      .setTint(t.accentText)
      .setDepth(DEPTH.markers - 0.1);
    this.ripple ??= s.add
      .image(0, 0, ringTexture(s, START_DOT_R, dp(1.4)))
      .setTint(t.accent)
      .setDepth(DEPTH.markers - 0.1);
    this.startHalo ??= softDisc(s, 0, 0, START_HALO.r, t.line, 0).setDepth(DEPTH.markers - 0.2);
    this.startHalo.setPosition(this.startPx.x, this.startPx.y).setAlpha(0).setVisible(true);
    this.startImg.setPosition(this.startPx.x, this.startPx.y).setScale(1).setAlpha(1).setVisible(true);
    this.goalImg.setPosition(this.goalPx.x, this.goalPx.y).setScale(1).setAlpha(1).setVisible(true);
    this.goalHalo.setPosition(this.goalPx.x, this.goalPx.y).setScale(1).setAlpha(0).setVisible(true);
    this.ripple.setPosition(this.startPx.x, this.startPx.y).setScale(1).setAlpha(0).setVisible(true);
  }

  /* ------------------------------------------------------ living markers */

  private stopLoops(): void {
    for (const tw of this.loops) tw.stop();
    this.loops.length = 0;
    for (const o of [this.startImg, this.goalImg, this.goalHalo, this.ripple, this.startHalo]) {
      if (o) this.scene.tweens.killTweensOf(o);
    }
    this.startHalo?.setAlpha(0);
    this.startImg?.setScale(1).setAlpha(1);
    this.goalImg?.setScale(1).setAlpha(1);
    this.goalHalo?.setScale(1).setAlpha(0);
    this.ripple?.setScale(1).setAlpha(0);
  }

  /** Keep a looping tween, if motion allows one (every `repeat: -1` sits behind motionReduced — tech G7). */
  private loop(config: Phaser.Types.Tweens.TweenBuilderConfig): void {
    if (motionReduced()) return;
    this.loops.push(this.scene.tweens.add({ ...config, repeat: -1 }));
  }

  /**
   * Waiting for the pen: the start dot breathes — the one living thing
   * (SPEC §2.5.4). After an attempt (`ready`), a ripple leaves it every
   * 1.6 s as well: go again.
   */
  private idleState(ready: boolean): void {
    this.stopLoops();
    const start = this.startImg;
    if (!start) return;
    // The dot breathes in scale only and stays fully opaque: at 0.6 on the
    // night board the tangerine went a muddy terracotta. What breathes in
    // alpha is its glow, under it (static at its middle under reduced motion).
    const tw = breathe(this.scene, start, { alphaFrom: 1 });
    if (tw) this.loops.push(tw);
    const halo = this.startHalo;
    if (halo) {
      halo.setAlpha(motionReduced() ? (START_HALO.from + START_HALO.to) / 2 : START_HALO.from);
      this.loop({
        targets: halo,
        alpha: START_HALO.to,
        // Half a breath each way: the glow keeps the dot's time.
        duration: MOTION.breathe.period / 2,
        ease: 'Sine.easeInOut',
        yoyo: true,
      });
    }
    const ripple = this.ripple;
    if (ready && ripple) {
      const from = 1;
      const to = dp(31) / START_DOT_R;
      ripple.setScale(from).setAlpha(0.34);
      this.loop({ targets: ripple, scale: to, alpha: 0, duration: 1600, ease: 'Sine.easeOut' });
      if (motionReduced()) ripple.setAlpha(0);
    }
  }

  /**
   * Drawing: the goal calls instead. Its ring does not grow — it IS the win
   * threshold — so it breathes in alpha only, and a halo pulse leaves it
   * outward: a ring starting AT the ring, never a disc wider than it (tech G5).
   */
  private drawingState(): void {
    this.stopLoops();
    const goal = this.goalImg;
    const halo = this.goalHalo;
    if (!goal || !halo) return;
    const tw = breathe(this.scene, goal, { scale: 1, alphaFrom: 0.72 });
    if (tw) this.loops.push(tw);
    halo.setScale(1).setAlpha(0.5);
    this.loop({ targets: halo, scale: 1.42, alpha: 0, duration: 2400, ease: 'Sine.easeOut' });
    if (motionReduced()) halo.setAlpha(0);
  }

  /* ------------------------------------------------------------ print-in */

  /**
   * Print the board in (SPEC §3.2): the walls appear in row bands from the
   * start's row up to the goal's, each fading up over 180 ms, a tangerine
   * light running up the crease with the front. `total` is the most it may
   * take (520 ms; a Retry passes 250). Returns the time it will take — 0
   * under reduced motion, which shows the board whole at once.
   *
   * Picture only: collision has the final walls from the first frame, and a
   * press on the start dot (the first `drawStroke`) finishes it in that same
   * frame. One crop per frame on the baked walls — no objects per wall, no
   * mask (tech G3).
   */
  printIn(total: number = PRINT_MS): number {
    this.completePrintIn();
    const walls = this.wallsImg;
    if (!walls || motionReduced() || !(total > 0)) return 0;
    const sched = printSchedule(this.rows.length, total);
    const box = this.wallsBox;
    const edges = printEdges(this.rows, box.y, box.y + box.h);
    this.frontImg ??= this.scene.add.image(box.x, box.y, walls.texture.key).setOrigin(0, 0).setDepth(DEPTH.level + 0.01);
    this.frontImg.setTexture(walls.texture.key).setPosition(box.x, box.y).setVisible(true);
    this.creaseLight ??= softDisc(this.scene, this.pf.axisX, box.y + box.h, dp(16), theme().line, 0).setDepth(DEPTH.axis + 0.1);
    this.creaseLight.setVisible(true);
    this.goalImg?.setAlpha(0);
    this.axisG.setAlpha(0);

    const at = (tMs: number): void => {
      // A crop on a texture that went away mid-tween throws on every frame and
      // stalls the scene's whole TweenManager: the card would never come in.
      if (!croppable(walls)) return;
      const { lead, settled } = printFront(tMs, edges, sched);
      const y0 = box.y;
      // Settled rows: everything below the settled edge, at full strength.
      walls.setCrop(0, settled - y0, box.w, Math.max(0, box.y + box.h - settled));
      // The soft front: from the leading edge down to the settled one, fading up.
      const front = this.frontImg;
      if (front && croppable(front)) {
        front.setCrop(0, lead - y0, box.w, Math.max(0, settled - lead));
        front.setAlpha(0, 0, 1, 1);
      }
      this.creaseLight?.setPosition(this.pf.axisX, lead).setAlpha(lead > box.y + 1 ? 0.75 : 0);
      if (this.goalImg && lead <= this.goalPx.y + METRICS.goalRadius) {
        this.goalImg.setAlpha(clamp((this.goalPx.y + METRICS.goalRadius - lead) / (METRICS.goalRadius * 2), 0, 1));
      }
      this.axisG.setAlpha(clamp(tMs / sched.end, 0, 1));
    };
    at(0);
    this.printTween = this.scene.tweens.addCounter({
      from: 0,
      to: sched.end,
      duration: sched.end,
      onUpdate: (tw) => at(tw.getValue() ?? 0),
      onComplete: () => this.completePrintIn(),
    });
    return sched.end;
  }

  /** Finish the print-in now: the whole board, in place. Idempotent. */
  completePrintIn(): void {
    const tw = this.printTween;
    this.printTween = null;
    tw?.stop();
    this.wallsImg?.setCrop();
    this.frontImg?.setVisible(false);
    this.creaseLight?.setVisible(false);
    if (this.goalImg && !this.figureUp) this.goalImg.setAlpha(1);
    this.axisG.setAlpha(1);
  }

  /* ------------------------------------------------- the fold as a meter */

  /**
   * Light the fold's notches (SPEC §3.4): `lit` is the count of rows crossed
   * from the start (bottom first, Gates.obstacleRows' order — GameScene's
   * gates), or a flag per row; `newest` pops its ring. The renderer already
   * lights them itself from the stroke it draws, with GameScene.ringGates'
   * own test (`crossRows`), so a caller only needs this to say it louder.
   */
  setRowsLit(lit: number | readonly boolean[], newest: number | null = null): void {
    this.lit = this.rows.map((_, i) => (typeof lit === 'number' ? i < lit : Boolean(lit[i])));
    this.drawAxis();
    if (newest !== null && newest >= 0 && newest < this.rows.length) this.popNotch(this.rows[newest]);
  }

  /** The rows, bottom first, in board pixels — the notches' heights. */
  get rowMids(): readonly number[] {
    return this.rows;
  }

  /** The notches on the crease, and the spine up to the highest one crossed. Redrawn only when a gate fires. */
  private drawAxis(): void {
    const t = theme();
    const g = this.axisG;
    const x = this.pf.axisX;
    g.clear();
    let top: number | null = null;
    this.rows.forEach((y, i) => {
      if (this.lit[i]) top = top === null ? y : Math.min(top, y);
    });
    if (top !== null) {
      const from = clamp(this.startPx.y, this.pf.y, this.pf.bottom);
      g.fillStyle(t.line, NOTCH.spineAlpha);
      g.fillRect(x - NOTCH.spine / 2, Math.min(top, from), NOTCH.spine, Math.abs(from - top));
    }
    this.rows.forEach((y, i) => {
      if (this.lit[i]) {
        g.fillStyle(t.line, 1);
        g.fillRect(x - NOTCH.litW / 2, y - NOTCH.litH / 2, NOTCH.litW, NOTCH.litH);
      } else {
        g.fillStyle(t.ink, NOTCH.alpha);
        g.fillRect(x - NOTCH.w / 2, y - NOTCH.h / 2, NOTCH.w, NOTCH.h);
      }
    });
  }

  /** The newest notch's ring: 10 → 16 pt over 220 ms. A pop, so none under reduced motion. */
  private popNotch(y: number): void {
    if (motionReduced()) return;
    const t = theme();
    const g = this.scene.add.graphics().setDepth(DEPTH.axis + 0.2);
    const s = { p: 0 };
    const x = this.pf.axisX;
    const draw = (): void => {
      g.clear();
      g.lineStyle(dp(1.4), t.line, 0.8 * (1 - s.p));
      g.strokeCircle(x, y, NOTCH.popFrom + (NOTCH.popTo - NOTCH.popFrom) * s.p);
    };
    draw();
    this.fx.set(
      g,
      this.scene.tweens.add({
        targets: s,
        p: 1,
        duration: NOTCH.popMs,
        ease: 'Cubic.easeOut',
        onUpdate: draw,
        onComplete: () => this.endEffect(this.fx, g),
      })
    );
  }

  /* -------------------------------------------------------------- danger */

  /**
   * The danger heat (SPEC §3.5): wall `wall` glows at `amount` (0..0.45,
   * Proximity.heatOf), tangerine, or fail red when `tight`. Null (or 0) puts
   * it out. It lights the REAL wall on its own half — never a far wall
   * projected onto the drawing side, which is what Reveal sells.
   *
   * The glow is one baked blur nine-sliced to the wall and tinted, UNDER the
   * walls; the outline sits inside the wall's own edge. Cheap enough to call
   * on every move: it only rebuilds when the wall changes.
   */
  setHeat(wall: number | HeatReading | null, amount = 0, tight = false): void {
    if (wall !== null && typeof wall === 'object') {
      ({ wall: wall, amount, tight } = wall as HeatReading & { wall: number });
    }
    const w = wall === null ? undefined : this.walls[wall as number];
    if (!w || !(amount > 0)) {
      this.heat = null;
      this.heatGlow?.setVisible(false);
      this.heatLine.setVisible(false);
      return;
    }
    const t = theme();
    const color = tight ? t.fail : t.accent;
    const a = clamp(amount, 0, HEAT.max);
    const same = this.heat !== null && this.heat.wall === wall && this.heat.tight === tight;
    if (!same) {
      this.paintHeatLine(w, color);
      if (this.canTint()) {
        let glow = this.heatGlow;
        if (glow && this.heat?.wall !== wall && !sizePanel(glow, w.w, w.h)) {
          glow.destroy();
          glow = null;
        }
        glow ??= heatPanel(this.scene, w).setDepth(DEPTH.heat);
        glow.setPosition(w.x + w.w / 2, w.y + w.h / 2);
        (glow as Phaser.GameObjects.Image).setTint(color);
        this.heatGlow = glow;
      }
      this.heat = { wall: wall as number, tight };
    }
    this.heatGlow?.setVisible(this.canTint()).setAlpha(heatGlowAlpha(a));
    this.heatLine.setVisible(true).setAlpha(heatLineAlpha(a));
  }

  private paintHeatLine(w: Rect, color: number): void {
    const g = this.heatLine;
    const lw = HEAT.outline;
    const r = Math.max(0, Math.min(METRICS.wallCornerRadius, w.w / 2, w.h / 2) - lw / 2);
    g.clear();
    g.lineStyle(lw, color, 1);
    // Inside the wall's own edge: a highlight never claims more wall than kills.
    g.strokePoints(roundRectPoints(w.x + lw / 2, w.y + lw / 2, w.w - lw, w.h - lw, r), true, true);
  }

  private canTint(): boolean {
    return this.scene.game.renderer.type === Phaser.WEBGL;
  }

  /**
   * A near miss survived — "close" (SPEC §3.5): eight tangerine lines and five
   * gold flecks thrown from the tight spot `p`, and a ring flickering at the
   * nib, where the eye is. The "close" pill and the ting are the HUD's and
   * Audio's.
   */
  spark(p: Vec2): void {
    const t = theme();
    const g = this.scene.add.graphics().setDepth(DEPTH.nib - 0.5);
    const reduced = motionReduced();
    const s = { p: reduced ? 0.7 : 0 };
    const draw = (): void => {
      g.clear();
      const fade = reduced ? 1 - s.p * 0.5 : 1 - s.p;
      g.lineStyle(dp(1.2), t.line, 0.9 * fade);
      for (let i = 0; i < SPARK.lines; i++) {
        const a = (i / SPARK.lines) * Math.PI * 2 + ((i * 0.618034) % 1) * 0.4;
        const r0 = SPARK.r0 * (1 + 0.6 * s.p);
        const r1 = r0 + SPARK.len * (0.4 + 0.6 * s.p);
        g.lineBetween(p.x + Math.cos(a) * r0, p.y + Math.sin(a) * r0, p.x + Math.cos(a) * r1, p.y + Math.sin(a) * r1);
      }
      if (!reduced) {
        g.fillStyle(t.medal, 0.9 * fade);
        for (let i = 0; i < SPARK.flecks; i++) {
          const a = ((i + 0.5) / SPARK.flecks) * Math.PI * 2 + 0.3;
          const r = SPARK.r0 + (SPARK.len + dp(4)) * s.p;
          g.fillCircle(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, dp(1.1));
        }
      }
    };
    draw();
    this.fx.set(
      g,
      this.scene.tweens.add({
        targets: s,
        p: 1,
        duration: ms(SPARK.ms),
        ease: 'Cubic.easeOut',
        onUpdate: draw,
        onComplete: () => this.endEffect(this.fx, g),
      })
    );
    const at = this.nibAt;
    if (!at) return;
    const ring = this.scene.add.graphics().setDepth(DEPTH.nib + 0.1);
    ring.lineStyle(dp(1.4), t.line, 1);
    ring.strokeCircle(at.x, at.y, SPARK.ring);
    ring.setAlpha(SPARK.ringAlpha);
    this.fx.set(
      ring,
      this.scene.tweens.add({
        targets: ring,
        alpha: 0,
        duration: ms(SPARK.ringMs),
        ease: 'Quad.easeIn',
        onComplete: () => this.endEffect(this.fx, ring),
      })
    );
  }

  /* ------------------------------------------------------------ stroke */

  /**
   * Redraw the live stroke and its reflection from the raw samples.
   *
   * Called on every move with the whole stroke so far. When it continues the
   * stroke already on screen, only the part a new sample can still change is
   * repainted; the rest was baked on an earlier move (see InkPass). The first
   * call of a level — the press on the dot — finishes the print-in in the
   * same frame and hands the breathing to the goal. The fold's notches light
   * from the same samples, by the same test the row notes use.
   */
  drawStroke(raw: readonly Vec2[], times: readonly number[], color?: number): void {
    this.paintStroke(raw, times, color ?? theme().line, true);
  }

  private paintStroke(raw: readonly Vec2[], times: readonly number[], color: number, live: boolean): void {
    const t = theme();
    // Opaque: the lightness is baked into the COLOUR, not the alpha.
    this.mirrorG.setAlpha(1);

    if (raw.length === 0) {
      this.clearStroke();
      return;
    }
    if (!this.touched) {
      this.touched = true;
      this.completePrintIn();
      this.drawingState();
    }
    // A different stroke from the one on screen: none of what is baked is ours.
    if (!this.continues(raw, times)) this.resetInk();

    const stroke = drawnPath(raw, times);
    const opts = nibOpts();
    // One profile serves both halves: a reflection moves at the same speeds.
    const widths = widthProfile(stroke.points, stroke.times, opts);
    const settled = settledPoints(stroke.points.length, opts, renderTailReach(METRICS.smoothIterations));
    const isLine = color === t.line;

    this.mirrorInk.paint(mirrorPath(stroke.points, this.pf.axisX), widths, settled, veiledInk(color, t));
    for (const glow of this.glowInk) glow.paint(stroke.points, widths, settled, color);
    this.strokeInk.paint(stroke.points, widths, settled, color);
    this.coreInk.setVisible(isLine);
    if (isLine) this.coreInk.paint(stroke.points, widths, settled, t.lineCore);

    this.head = { points: stroke.points, widths, color };
    if (live) {
      this.wetTween?.stop();
      this.wetTween = null;
      this.wet.d = 1;
      this.drawWet();
      this.stillTimer?.remove();
      this.stillTimer = this.scene.time?.delayedCall(STILL_MS, () => this.dry()) ?? null;
      const tip = stroke.points[stroke.points.length - 1];
      this.nib(tip, isLine);
      if (this.rows.length > 0) {
        const newest = crossRows(raw, this.rows, this.lit, this.rowScan);
        this.rowScan = raw.length;
        if (newest !== null) {
          this.drawAxis();
          this.popNotch(this.rows[newest]);
        }
      }
    } else {
      this.drawWet();
    }

    const n = raw.length;
    this.drawn = {
      n,
      first: { x: raw[0].x, y: raw[0].y },
      last: { x: raw[n - 1].x, y: raw[n - 1].y },
      t0: times[0] ?? 0,
      tLast: times[n - 1] ?? 0,
    };
  }

  /** Wipe the ink layers, keeping the textures for the next stroke (and the lit notches, if asked). */
  private resetInk(keepRows = false): void {
    this.strokeInk.clear();
    this.coreInk.clear();
    for (const glow of this.glowInk) glow.clear();
    this.mirrorInk.clear();
    this.wetTween?.stop();
    this.wetTween = null;
    this.wet.d = 0;
    this.head = null;
    this.wetG.clear();
    this.drawn = null;
    this.rowScan = 0;
    if (!keepRows && this.lit.some(Boolean)) {
      this.lit = this.rows.map(() => false);
      this.drawAxis();
    }
  }

  /**
   * The stroke is over — lifted, or its death has played out — and the board
   * waits for the next: the ink goes, the notches go dark, the heat goes
   * out, and the start dot breathes again, rippling now: go again.
   */
  clearStroke(): void {
    const had = this.drawn !== null || this.touched;
    this.resetInk();
    this.stillTimer?.remove();
    this.stillTimer = null;
    this.nib(null, false);
    this.setHeat(null);
    this.clearEffects(this.fx);
    this.coreInk.setVisible(true);
    if (had && this.startImg && !this.figureUp) {
      this.touched = false;
      this.idleState(true);
    }
  }

  /** Whether `raw` is the stroke on screen with samples appended — the only way a stroke grows. */
  private continues(raw: readonly Vec2[], times: readonly number[]): boolean {
    const d = this.drawn;
    if (!d || raw.length < d.n) return false;
    const first = raw[0];
    const last = raw[d.n - 1];
    return (
      first.x === d.first.x &&
      first.y === d.first.y &&
      last.x === d.last.x &&
      last.y === d.last.y &&
      (times[0] ?? 0) === d.t0 &&
      (times[d.n - 1] ?? 0) === d.tLast
    );
  }

  /* ----------------------------------------------------------- wet head */

  /**
   * How many samples behind the pen are wet (SPEC §3.3; 45). 0 turns the wet
   * head off.
   */
  wetHead(samples: number = WET_SAMPLES): void {
    this.wetCount = Math.max(0, Math.floor(samples));
    this.drawWet();
  }

  /**
   * Let the wet head dry: over 600 ms back to the line's own look. Called by
   * itself when the pen stops, on a death and on a win; a lift clears the
   * line outright.
   */
  dry(): void {
    if (!(this.wet.d > 0) || this.wetTween) return;
    this.wetTween = this.scene.tweens.add({
      targets: this.wet,
      d: 0,
      duration: ms(DRY_MS),
      ease: 'Sine.easeOut',
      onUpdate: () => this.drawWet(),
      onComplete: () => {
        this.wetTween = null;
        this.wetG.clear();
      },
    });
  }

  /**
   * The wet head, over the baked line: the last samples warmed toward the
   * core, the core itself a little wider, and a sheen along the lit side,
   * each fading to nothing toward the dry end of the run — so where the wet
   * run meets the baked line there is no seam. Painted opaque (the colours
   * blend, the alphas do not stack); the bake never sees it.
   */
  private drawWet(): void {
    const g = this.wetG;
    g.clear();
    const h = this.head;
    const d = this.wet.d;
    if (!h || this.wetCount <= 0 || !(d > 0)) return;
    const t = theme();
    const n = h.points.length;
    const from = Math.max(0, n - this.wetCount);
    const span = n - from;
    if (span < 2) return;
    const isLine = h.color === t.line;
    const hot = isLine ? t.lineCore : blend(0xffffff, 0.3, h.color);
    const wetAt = (i: number): number => (d * (i - from)) / (span - 1);
    const quad = (i: number, k: number, off: number): Vec2[] | null => {
      const p = h.points[i - 1];
      const q = h.points[i];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) return null;
      const nx = -dy / len;
      const ny = dx / len;
      const wp = h.widths[i - 1] * k;
      const wq = h.widths[i] * k;
      const op = h.widths[i - 1] * off;
      const oq = h.widths[i] * off;
      return [
        { x: p.x + nx * (op + wp), y: p.y + ny * (op + wp) },
        { x: q.x + nx * (oq + wq), y: q.y + ny * (oq + wq) },
        { x: q.x + nx * (oq - wq), y: q.y + ny * (oq - wq) },
        { x: p.x + nx * (op - wp), y: p.y + ny * (op - wp) },
      ];
    };
    // The body, warming toward the core at the pen.
    for (let i = from + 1; i < n; i++) {
      const w = wetAt(i);
      if (w <= 0.01) continue;
      g.fillStyle(blend(hot, 0.3 * w, h.color), 1);
      const q = quad(i, 1, 0);
      if (q) g.fillPoints(q, true);
      if (h.widths[i] > 0.25) fillDisc(g, h.points[i].x, h.points[i].y, h.widths[i]);
    }
    // The core, wider while wet — begun WET_OVERLAP samples back over the
    // baked core, at its exact width with a round cap, so the wet run takes
    // it over inside a stretch that is already core-coloured. Started at the
    // wet run's first sample, the body's butt end cut the baked core there and
    // the crisp live core met the texture's softer one at a visible step (QA).
    if (isLine) {
      const back = Math.max(0, from - WET_OVERLAP);
      g.fillStyle(t.lineCore, 1);
      const k0 = t.lineCoreWidth;
      if (h.widths[back] * k0 > 0.25) fillDisc(g, h.points[back].x, h.points[back].y, h.widths[back] * k0);
      for (let i = back + 1; i < n; i++) {
        const w = i > from ? wetAt(i) : 0;
        const k = t.lineCoreWidth + 0.16 * w;
        const q = quad(i, k, 0);
        if (q) g.fillPoints(q, true);
        if (h.widths[i] * k > 0.25) fillDisc(g, h.points[i].x, h.points[i].y, h.widths[i] * k);
      }
    }
    // The sheen: 0.42·w wide, 0.38·w off the centre on the normal, white
    // fading head to tail — and fading out at a sharp joint, where the two
    // segments' offset quads overlap on the inside of the turn and doubled
    // into a white fleck.
    const straight = (i: number): number => {
      const a = h.points[i - 1];
      const b = h.points[i];
      const c = h.points[i + 1];
      if (!a || !b || !c) return 1;
      const ux = b.x - a.x;
      const uy = b.y - a.y;
      const vx = c.x - b.x;
      const vy = c.y - b.y;
      const l = Math.hypot(ux, uy) * Math.hypot(vx, vy);
      if (l < 1e-9) return 1;
      return clamp(((ux * vx + uy * vy) / l - 0.5) / 0.4, 0, 1);
    };
    for (let i = from + 1; i < n; i++) {
      const w = wetAt(i) * Math.min(straight(i - 1), straight(i));
      if (w <= 0.02) continue;
      const q = quad(i, 0.21, -0.38);
      if (!q) continue;
      g.fillStyle(0xffffff, 0.5 * w);
      g.fillPoints(q, true);
    }
  }

  /* ------------------------------------------------------ nib and finger */

  /**
   * The nib (SPEC §3.3): a tangerine ring round the pen's head, a soft halo
   * under it, a hot dot at the tip. The renderer moves it with the line; this
   * is for a caller that wants it elsewhere, or gone.
   */
  nib(p: Vec2 | null, visible = true): void {
    if (!p || !visible) {
      this.nibAt = null;
      this.nibImg?.setVisible(false);
      this.drawFinger();
      return;
    }
    this.nibAt = { x: p.x, y: p.y };
    this.nibImg ??= this.scene.add.image(0, 0, nibTexture(this.scene)).setDepth(DEPTH.nib);
    this.nibImg.setPosition(p.x, p.y).setVisible(true);
    this.drawFinger();
  }

  /**
   * The fingertip's shadow under the finger at `p`, a dotted tether up to the
   * nib — the lesson of why the line draws above the thumb, without words
   * (SPEC §3.3). Null hides it. The caller stops showing it once the lesson
   * is learnt (totalWins ≥ 5); it is static, so it shows under reduced motion.
   */
  fingertip(p: Vec2 | null): void {
    this.fingerAt = p ? { x: p.x, y: p.y } : null;
    this.drawFinger();
  }

  private drawFinger(): void {
    const p = this.fingerAt;
    if (!p) {
      this.fingerImg?.setVisible(false);
      this.fingerG?.clear();
      return;
    }
    this.fingerImg ??= this.scene.add.image(0, 0, fingerTexture(this.scene)).setDepth(DEPTH.finger);
    this.fingerImg.setPosition(p.x, p.y).setVisible(true);
    const g = (this.fingerG ??= this.scene.add.graphics().setDepth(DEPTH.finger + 0.1));
    g.clear();
    const nib = this.nibAt;
    if (!nib) return;
    g.lineStyle(Math.max(1, dp(0.8)), ui().glass, FINGER.tether);
    for (const [a, b] of dashesAlong([nib, p], FINGER.dash, FINGER.gap)) g.lineBetween(a.x, a.y, b.x, b.y);
  }

  /* ---------------------------------------------------------------- fail */

  /**
   * 400ms of red and then it is gone. No modal, no "you lost", no tap to
   * dismiss — the retry loop is the product, and anything that stands between
   * the player and their next attempt is a tax on it.
   *
   * What the 400ms says (SPEC §3.6): the line turns red and glows red; a
   * splat lands on the side that hit — for a mirror death at the
   * reflection's contact; the struck wall flashes with heat; a mirror death
   * throws an arc over the fold from the pen to where its reflection died;
   * a wash of red at 0.07.
   */
  flashFail(raw: readonly Vec2[], times: readonly number[], hit?: FailHit): void {
    const t = theme();
    this.completePrintIn();
    this.setHeat(null);
    this.paintStroke(raw, times, t.fail, false);
    this.stillTimer?.remove();
    this.stillTimer = null;
    this.dry();
    this.nib(null, false);
    // Where, and against what. The wash says "you died"; these say how.
    if (hit) {
      const n = raw.length;
      const dir =
        n >= 2 ? { x: raw[n - 1].x - raw[n - 2].x, y: raw[n - 1].y - raw[n - 2].y } : { x: 0, y: -1 };
      this.splat(hit.mirror ? 'mirror' : 'pen', hit.at, dir);
      if (hit.wall !== null) this.flashWall(hit.wall, hit.flashes ?? 1);
      if (hit.mirror && hit.arrow !== false) {
        this.arcArrow(hit.at, this.pf.mirror(hit.at), typeof hit.arrow === 'string' ? hit.arrow : null);
      }
    }

    this.washG.clear();
    this.washG.fillStyle(t.fail, 1);
    // The whole world, as tall as it is now (Theme.viewHeight).
    this.washG.fillRect(0, 0, BASE_WIDTH, viewHeight());
    this.washG.setAlpha(0.07);

    this.scene.tweens.killTweensOf(this.washG);
    this.dimPageWithWash();
    this.scene.tweens.add({
      targets: this.washG,
      alpha: 0,
      duration: METRICS.failFlashMs,
      ease: 'Quad.easeOut',
      onUpdate: () => this.dimPageWithWash(),
      onComplete: () => this.dimPageWithWash(),
    });
  }

  /**
   * The splat (SPEC §3.6) on `side`: the pen's own contact at `p`, or — for
   * the mirror — the reflection's, on the half the player was not watching,
   * against the wall that actually killed them. Drawing it where their own
   * pen was would point at open paper and teach the opposite of what
   * happened. A blot, droplets thrown along `dir` (the travel), two rings.
   */
  splat(side: 'pen' | 'mirror', p: Vec2, dir: Vec2): void {
    const t = theme();
    const at = side === 'mirror' ? this.pf.mirror(p) : p;
    const d = side === 'mirror' ? { x: -dir.x, y: dir.y } : dir;
    const drops = splatDrops(d);
    const g = this.scene.add.graphics().setDepth(DEPTH.fail);
    const reduced = motionReduced();
    const s = { p: reduced ? 1 : 0 };
    const draw = (): void => {
      g.clear();
      g.fillStyle(t.fail, 1);
      fillDisc(g, at.x, at.y, SPLAT.blot * (0.55 + 0.45 * s.p));
      for (const drop of drops) {
        const dist = SPLAT.blot * 0.6 + drop.reach * s.p;
        fillDisc(g, at.x + drop.dx * dist, at.y + drop.dy * dist, drop.r * (1 - 0.3 * s.p));
      }
      if (!reduced) {
        for (const r of SPLAT.rings) {
          g.lineStyle(dp(1.2), t.fail, 0.55 * (1 - s.p));
          g.strokeCircle(at.x, at.y, SPLAT.blot + (r - SPLAT.blot) * s.p);
        }
      }
    };
    draw();
    const fade = (): void => {
      if (!this.failFx.has(g)) return;
      this.failFx.set(
        g,
        this.scene.tweens.add({
          targets: g,
          alpha: 0,
          delay: METRICS.failFlashMs,
          duration: ms(300),
          ease: 'Quad.easeIn',
          onComplete: () => this.endEffect(this.failFx, g),
        })
      );
    };
    if (reduced) {
      this.failFx.set(g, null);
      fade();
      return;
    }
    this.failFx.set(
      g,
      this.scene.tweens.add({
        targets: s,
        p: 1,
        duration: 180,
        ease: 'Cubic.easeOut',
        onUpdate: draw,
        onComplete: fade,
      })
    );
  }

  /** The old contact ring, kept for its callers: now the splat, thrown upward. */
  contactRing(at: Vec2, mirror: boolean): void {
    this.splat(mirror ? 'mirror' : 'pen', at, { x: 0, y: -1 });
  }

  /**
   * The arc arrow over the fold (SPEC §3.6, mirror deaths): dashed, from the
   * pen's head at `from` to the reflection's contact at `to`, an arrowhead
   * there, and `text` above it ("your reflection") while the lesson is new.
   * It stays until the next stroke begins (clearGhost), and fades out after
   * a couple of seconds if none does.
   */
  arcArrow(from: Vec2, to: Vec2, text: string | null = null): void {
    const t = theme();
    const curve = arcCurve(from, to);
    let length = 0;
    for (let i = 1; i < curve.length; i++) {
      length += Math.hypot(curve[i].x - curve[i - 1].x, curve[i].y - curve[i - 1].y);
    }
    const g = this.scene.add.graphics().setDepth(DEPTH.fail + 0.1);
    const s = { p: motionReduced() ? 1 : 0 };
    const end = curve[curve.length - 1];
    const before = curve[curve.length - 3] ?? curve[0];
    const draw = (): void => {
      g.clear();
      g.lineStyle(ARROW.width, t.fail, 1);
      for (const [a, b] of dashesAlong(curve, ARROW.dash, ARROW.gap, length * s.p)) g.lineBetween(a.x, a.y, b.x, b.y);
      if (s.p >= 0.999) {
        const ang = Math.atan2(end.y - before.y, end.x - before.x);
        g.fillStyle(t.fail, 1);
        const l = ARROW.head;
        g.fillTriangle(
          end.x,
          end.y,
          end.x - Math.cos(ang - 0.45) * l,
          end.y - Math.sin(ang - 0.45) * l,
          end.x - Math.cos(ang + 0.45) * l,
          end.y - Math.sin(ang + 0.45) * l
        );
      }
    };
    draw();
    const parts: Effect[] = [g];
    this.arrowG = g;
    const bounds = boundsOf(curve);
    const pad = ARROW.head;
    this.arrowBoxes = bounds
      ? [{ x: bounds.x - pad, y: bounds.y - pad, w: bounds.w + 2 * pad, h: bounds.h + 2 * pad }]
      : [];
    if (text) {
      let apex = curve[0];
      for (const q of curve) if (q.y < apex.y) apex = q;
      const words = label(this.scene, apex.x, apex.y - dp(5), text, {
        font: FONT_DISPLAY,
        italic: true,
        size: ARROW.label,
        color: t.fail,
      })
        .setOrigin(0.5, 1)
        .setDepth(DEPTH.fail + 0.1);
      // On the board's own colour: over a wall or the crease the red fell to
      // 3.8:1 (QA); on its backing it keeps the 4.9:1 it has on the board.
      // Kept inside the board, whatever the apex.
      const bw = Math.ceil(words.width) + dp(12);
      const bh = Math.ceil(words.height) + dp(2);
      const x = clamp(apex.x, this.pf.x + bw / 2, this.pf.right - bw / 2);
      const y = apex.y - dp(5) - words.height / 2;
      words.setX(x);
      const backing = panel(this.scene, `ink-arrow-label-${Math.round(bh)}`, x, y, bw, bh, {
        radius: bh / 2,
        face: { kind: 'solid', color: t.board, alpha: 0.9 },
      }).setDepth(DEPTH.fail + 0.05);
      parts.push(backing, words);
      this.arrowBoxes.push({ x: x - bw / 2, y: y - bh / 2, w: bw, h: bh });
    }
    const linger = (): void => {
      for (const o of parts) {
        if (!this.failFx.has(o)) continue;
        this.failFx.set(
          o,
          this.scene.tweens.add({
            targets: o,
            alpha: 0,
            delay: 1800,
            duration: ms(400),
            onComplete: () => this.endEffect(this.failFx, o),
          })
        );
      }
    };
    for (const o of parts) this.failFx.set(o, null);
    if (s.p >= 1) {
      linger();
      return;
    }
    this.failFx.set(
      g,
      this.scene.tweens.add({
        targets: s,
        p: 1,
        duration: 200,
        ease: 'Sine.easeOut',
        onUpdate: draw,
        onComplete: linger,
      })
    );
  }

  /**
   * Where the mirror death's arc arrow and its "your reflection" label are
   * while they are on the board — what the "87% · furthest yet" tag keeps
   * clear of. Empty once they have faded, or when there were none.
   */
  arrowRects(): readonly Rect[] {
    if (!this.arrowG || !this.failFx.has(this.arrowG)) this.arrowBoxes = [];
    return this.arrowBoxes;
  }

  /**
   * The struck wall, by its index in the walls `drawLevel` was given — the
   * same list CollisionSystem tests, so `firstHit().wall` is the index to
   * pass: its outline in fail red and its heat at 0.75, fading over 500 ms.
   * `times` repeats the flash, for the first mirror death, which is worth a
   * second look. An unknown index flashes nothing.
   */
  flashWall(index: number, times = 1): void {
    const w = this.walls[index];
    if (!w) return;
    const t = theme();
    const lw = pt(2);
    const g = this.scene.add.graphics().setDepth(DEPTH.fail);
    const r = Math.max(0, Math.min(METRICS.wallCornerRadius, w.w / 2, w.h / 2) - lw / 2);
    g.lineStyle(lw, t.fail, 1);
    g.strokePoints(roundRectPoints(w.x + lw / 2, w.y + lw / 2, w.w - lw, w.h - lw, r), true, true);
    g.setAlpha(0.9);
    const parts: Effect[] = [g];
    if (this.canTint()) {
      const glow = heatPanel(this.scene, w).setDepth(DEPTH.heat + 0.1);
      (glow as Phaser.GameObjects.Image).setTint(t.fail);
      glow.setAlpha(0.75);
      parts.push(glow);
    }
    for (const o of parts) {
      this.failFx.set(
        o,
        this.scene.tweens.add({
          targets: o,
          alpha: 0,
          duration: ms(500),
          ease: 'Quad.easeIn',
          repeat: Math.max(0, Math.round(times) - 1),
          onComplete: () => this.endEffect(this.failFx, o),
        })
      );
    }
  }

  /**
   * Tint the page behind the canvas to match the wash, frame by frame.
   *
   * On a letterboxed iPhone the bands above and below the canvas are the page,
   * which the wash cannot reach, so the flash showed as a hard-edged red
   * rectangle between two strips of clean paper. Released when the wash is
   * spent, and on destroy, so a scene that ends mid-flash cannot leave the page
   * tinted behind the next one.
   */
  private dimPageWithWash(): void {
    if (this.washDim !== null) undimPage(this.washDim);
    this.washDim = null;
    const alpha = this.washG.active ? this.washG.alpha : 0;
    if (alpha > 0.002) this.washDim = dimPage(alpha, theme().fail);
  }

  /* -------------------------------------------------------------- reveal */

  /**
   * Paint the mirror's forbidden bands onto the left half.
   *
   * This is the rewarded-video reward, and it is the right one because it hands
   * over exactly the information the game withholds: not the answer, but where
   * your own reflection is about to kill you. The player still has to draw it.
   */
  showReveal(mirroredWalls: readonly Rect[], durationMs: number): void {
    const t = theme();
    const g = this.revealG;
    g.clear();
    g.setAlpha(0);
    if (mirroredWalls.length === 0) return;

    /*
     * One tint and one hatch over the bands' whole bounding box, CLIPPED to
     * the bands by a mask — never a translucent fill per band.
     *
     * Maze joints overlap on purpose, and Phaser composites every fill on its
     * own, alpha on the whole Graphics included: per-band paint stamped a
     * darker patch on every junction of the revealed labyrinth. Painted once
     * and clipped, a junction is just more of the same band.
     */
    /*
     * The mask is ONE path, every band a closed sub-path of it, filled once.
     * On Phaser's Canvas renderer (what AUTO falls back to without WebGL) a
     * geometry mask becomes a single `clip()` of the path last begun, and
     * `fillPoints` begins a new path each call: one fill per band clipped to
     * the last band alone. WebGL fills each sub-path into the stencil either
     * way. The sub-paths all run clockwise, so the canvas's nonzero rule
     * unions the overlapping joints instead of cutting holes in them.
     */
    const shape = (this.revealShape ??= this.scene.make.graphics({}, false));
    shape.clear();
    shape.fillStyle(0xffffff, 1);
    shape.beginPath();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const w of mirroredWalls) {
      const r = Math.min(METRICS.wallCornerRadius, w.w / 2, w.h / 2);
      const pts = roundRectPoints(w.x, w.y, w.w, w.h, r);
      shape.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, pts[i].y);
      shape.lineTo(pts[0].x, pts[0].y);
      x0 = Math.min(x0, w.x);
      y0 = Math.min(y0, w.y);
      x1 = Math.max(x1, w.x + w.w);
      y1 = Math.max(y1, w.y + w.h);
    }
    shape.fillPath();
    if (!g.mask) g.setMask(shape.createGeometryMask());

    g.fillStyle(t.accent, REVEAL_TINT);
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    // 45°, rising to the right: every line is x + y = k, cut to the box.
    const step = REVEAL_HATCH_GAP * Math.SQRT2;
    g.lineStyle(REVEAL_HATCH_WIDTH, t.accent, REVEAL_HATCH);
    for (let k = x0 + y0 + step / 2; k < x1 + y1; k += step) {
      const ax = Math.max(x0, k - y1);
      const bx = Math.min(x1, k - y0);
      if (bx > ax) g.lineBetween(ax, k - ax, bx, k - bx);
    }

    this.scene.tweens.killTweensOf(g);
    this.scene.tweens.add({
      targets: g,
      alpha: 1,
      duration: ms(220),
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.scene.tweens.add({
          targets: g,
          alpha: 0,
          delay: durationMs,
          duration: ms(420),
          ease: 'Quad.easeIn',
          onComplete: () => g.clear(),
        });
      },
    });
  }

  /* ---------------------------------------------------------------- ghost */

  /**
   * The previous attempt, as a thin faint centreline. Not a ribbon: the
   * ghost is information ("here is where you died"), not ink, and drawing it
   * at ribbon weight would read as a stroke the player still owns.
   *
   * The death is marked with an ×, and a mirror death with a second one at
   * the reflected point — the place the player never looked, which is the
   * thing the next attempt has to plan around.
   *
   * `reflected` also leaves the reflection's own line, at the same weight:
   * for the one death that teaches the mirror, where the player needs to see
   * the path that ran into the wall, not just where it ended.
   *
   * `mark: false` leaves the × off: a Retry for ★★★ prints over the ghost of
   * the line that WON, and an × at its goal would read as "died here".
   */
  showGhost(
    points: readonly Vec2[],
    mirrorDeath = false,
    reflected = false,
    opts: { mark?: boolean } = {},
  ): void {
    const t = theme();
    const g = this.ghostG;
    this.scene.tweens.killTweensOf(g);
    g.clear();
    g.setAlpha(1);
    if (points.length < 2) return;

    g.lineStyle(Math.max(1, pt(1.2)), t.ink, GHOST_ALPHA);
    const trace = (line: readonly Vec2[]): void => {
      g.beginPath();
      g.moveTo(line[0].x, line[0].y);
      for (let i = 1; i < line.length; i++) g.lineTo(line[i].x, line[i].y);
      g.strokePath();
    };
    trace(points);
    if (reflected) trace(mirrorPath(points, this.pf.axisX));

    if (opts.mark === false) return;
    const last = points[points.length - 1];
    this.deathMark(g, deathMarkAt(last, this.pf));
    if (mirrorDeath) this.deathMark(g, deathMarkAt(this.pf.mirror(last), this.pf));
  }

  /** An × — two arms `DEATH_ARM` long each way from `p`. */
  private deathMark(g: Phaser.GameObjects.Graphics, p: Vec2): void {
    const d = DEATH_ARM * Math.SQRT1_2;
    g.lineStyle(pt(1.4), theme().fail, 0.8);
    g.lineBetween(p.x - d, p.y - d, p.x + d, p.y + d);
    g.lineBetween(p.x - d, p.y + d, p.x + d, p.y - d);
  }

  /** The ghost fades, and whatever the last death left on the board goes with it: a new stroke is starting. */
  clearGhost(): void {
    this.clearEffects(this.failFx);
    this.scene.tweens.killTweensOf(this.ghostG);
    this.scene.tweens.add({ targets: this.ghostG, alpha: 0, duration: ms(200) });
  }

  clearReveal(): void {
    this.scene.tweens.killTweensOf(this.revealG);
    this.revealG.clear();
    this.revealG.setAlpha(0);
  }

  /* ----------------------------------------------------------------- win */

  /**
   * THE feature. The stroke and its mirror close into one symmetric figure,
   * and the figure blooms (SPEC §3.7):
   *
   *        0  the goal ring catches the pen (1 → 0.85 → 1.25 → 1)
   *  150–510  the fill floods out from the fold; the walls fade to 0.22
   *  300–900  a warm bloom behind the figure
   *  350–900  44 rays draw outward, 20 flecks drift
   *
   * The crease light (creaseSweep), the droplets and the board stepping back
   * (frameBoard) are the caller's beats on the same clock. Nothing waits for
   * any of it; under reduced motion it is the end state, crossfaded in.
   */
  presentWin(raw: readonly Vec2[], times: readonly number[]): void {
    // Only a figure still up is cleared — not the crease, which the caller may
    // have started a moment ago for this same win.
    if (this.figureUp) this.clearWin();
    this.completePrintIn();
    this.setHeat(null);
    this.stillTimer?.remove();
    this.stillTimer = null;
    this.nib(null, false);
    this.fingertip(null);
    this.clearEffects(this.fx);
    this.stopLoops();

    /*
     * The line already on the board IS the figure's line: the same ribbon, the
     * same passes, drawn from the same samples by the same code. It is kept —
     * its last few live samples baked — rather than painted a second time.
     *
     * Painting it again, as one Canvas2D union per pass (bloom rings, body,
     * core, moonlight), was the whole of the goal frame: 0.86 s at 4× CPU on
     * level 300, a freeze right after the goal's click that pushed every beat
     * after it late (QA). Baking the tail is a few quads. The fold's meter has
     * said its piece: it steps aside with the walls (below), and the crease
     * light carries the moment.
     */
    const stroke = drawnPath(raw, times);
    this.settleInk(raw, times, stroke);
    this.figureUp = true;
    const seq = ++this.winSeq;

    const outline = closedFigure(stroke.points, this.pf.axisX);
    const b = boundsOf(outline);
    if (!b) return;
    const reduced = motionReduced();
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const at = (from: number): number => (reduced ? 0 : from);
    const len = (range: readonly [number, number]): number => ms(range[1] - range[0]);

    // The ring catches the pen: in, out past itself, home — "the pen clicks in".
    const goal = this.goalImg;
    if (goal && !reduced) {
      const s = { p: 0 };
      const keys = [1, 0.85, 1.25, 1];
      this.winTween({
        targets: s,
        p: 1,
        duration: BLOOM.catchMs,
        onUpdate: () => {
          const x = s.p * (keys.length - 1);
          const i = Math.min(keys.length - 2, Math.floor(x));
          const f = x - i;
          const e = 1 - (1 - f) * (1 - f);
          goal.setScale(keys[i] + (keys[i + 1] - keys[i]) * e);
        },
        onComplete: () => goal.setScale(1),
      });
    }

    /*
     * The fill floods out from the fold: a crop growing from the axis to the
     * figure's half-width (the figure is symmetric about it). Its bake — the
     * gradient and the engraving, clipped to the outline — is the one real
     * paint left, and it waits two frames: the goal frame shows the click, not
     * a stall. The flood starts at 150 ms, long after.
     */
    afterFrames(this.scene, 2, () => {
      if (seq !== this.winSeq || !this.figureUp) return;
      const fig = buildFigureFill(this.scene, outline);
      if (!fig) return;
      const fill = fig.fill.setDepth(DEPTH.winFill);
      this.winFill = fill;
      this.winKeys = fig.keys;
      // A board already framed (a very late bake) takes the fill in too.
      if (this.frame) {
        fill.setPosition(fill.x - this.framePivot.x, fill.y - this.framePivot.y);
        this.frame.add(fill);
        this.frame.sort('depth');
      }
      const fw = fill.width;
      const fh = fill.height;
      const open = (p: number): void => {
        if (!croppable(fill)) return;
        const half = (fw / 2) * p;
        fill.setCrop(fw / 2 - half, 0, half * 2, fh);
      };
      if (reduced) {
        open(1);
        fill.setAlpha(0);
        this.scene.tweens.add({ targets: fill, alpha: 1, duration: 150 });
      } else {
        open(0);
        const s = { p: 0 };
        this.winTween({
          targets: s,
          p: 1,
          delay: Math.max(0, BLOOM.fill[0] - 2 * 17),
          duration: len(BLOOM.fill),
          ease: 'Cubic.easeOut',
          onUpdate: () => open(s.p),
        });
      }
    });

    // The walls recede to ghosts of the maze; the notches go with the fill.
    this.scene.tweens.add({
      targets: this.axisG,
      alpha: 0,
      delay: at(BLOOM.fill[0]),
      duration: reduced ? 150 : len(BLOOM.fill),
    });
    const walls = this.wallsImg;
    if (walls) {
      this.wallsWinAlpha = BLOOM_WALL_ALPHA;
      this.scene.tweens.add({
        targets: walls,
        alpha: BLOOM_WALL_ALPHA,
        delay: at(BLOOM.fill[0]),
        duration: reduced ? 150 : len(BLOOM.fill),
        ease: 'Sine.easeInOut',
      });
    }

    // The warm bloom behind the figure.
    const glow = softDisc(this.scene, cx, cy, Math.max(b.w, b.h) * 0.75, theme().line, 0).setDepth(DEPTH.winGlow);
    this.adoptWinEffect(glow);
    this.winFx.set(
      glow,
      this.scene.tweens.add({
        targets: glow,
        alpha: BLOOM.glowAlpha,
        delay: at(BLOOM.glow[0]),
        duration: reduced ? 150 : len(BLOOM.glow),
        ease: 'Sine.easeOut',
      })
    );

    this.rays(b, reduced);
  }

  /**
   * Bake the whole of `raw` into the ink passes — the stroke on the board,
   * its tail included — and put the wet head away: the figure keeps the line
   * exactly as it was drawn. A stroke that is not the one on screen is
   * painted from the start (the same passes, the same cost as drawing it).
   */
  private settleInk(raw: readonly Vec2[], times: readonly number[], stroke: DrawnStroke): void {
    const t = theme();
    this.wetTween?.stop();
    this.wetTween = null;
    this.wet.d = 0;
    this.wetG.clear();
    if (raw.length === 0) return;
    if (!this.continues(raw, times)) this.resetInk(true);
    const widths = widthProfile(stroke.points, stroke.times, nibOpts());
    const n = stroke.points.length;
    this.mirrorG.setAlpha(1);
    this.mirrorInk.paint(mirrorPath(stroke.points, this.pf.axisX), widths, n, veiledInk(t.line, t));
    for (const glow of this.glowInk) glow.paint(stroke.points, widths, n, t.line);
    this.strokeInk.paint(stroke.points, widths, n, t.line);
    this.coreInk.setVisible(true);
    this.coreInk.paint(stroke.points, widths, n, t.lineCore);
    this.head = null;
  }

  /** The ink passes' objects on the board: what the figure is, for the frame to move. */
  private inkParts(): Effect[] {
    return [this.mirrorInk, ...this.glowInk, this.strokeInk, this.coreInk].flatMap((p) => p.parts());
  }

  /** A tween of the win's that drives a counter: kept, so clearWin can stop it. */
  private winTween(config: Phaser.Types.Tweens.TweenBuilderConfig): void {
    this.winTweens.push(this.scene.tweens.add(config));
  }

  /** The spec's name for the win's figure bloom: `presentWin`. */
  bloom(raw: readonly Vec2[], times: readonly number[]): void {
    this.presentWin(raw, times);
  }

  /**
   * 44 fine rays round the figure, tangerine and gold, drawing outward, and
   * 20 flecks drifting 20 pt out. The same every win: the jitter is fixed.
   * Under reduced motion the rays are simply there, and there are no flecks.
   */
  private rays(b: Rect, reduced: boolean): void {
    const t = theme();
    const g = this.scene.add.graphics().setDepth(DEPTH.winRays);
    this.adoptWinEffect(g);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const rx = b.w / 2 + dp(16);
    const ry = b.h / 2 + dp(16);
    const rays = Array.from({ length: BLOOM.rayCount }, (_, i) => {
      const a = (i / BLOOM.rayCount) * Math.PI * 2 + ((i * 0.618034) % 1) * 0.12;
      const len = dp(12) + dp(26) * ((i * 0.381966) % 1);
      return { a, len, gold: i % 3 === 1, alpha: 0.35 + 0.4 * ((i * 0.7548776) % 1) };
    });
    const flecks = Array.from({ length: BLOOM.fleckCount }, (_, i) => {
      const a = ((i + 0.3) / BLOOM.fleckCount) * Math.PI * 2 + ((i * 0.5698) % 1) * 0.5;
      const r = 0.55 + 0.5 * ((i * 0.381966) % 1);
      return { a, r, gold: i % 2 === 0 };
    });
    const s = { p: reduced ? 1 : 0 };
    const draw = (): void => {
      g.clear();
      for (const ray of rays) {
        const ux = Math.cos(ray.a);
        const uy = Math.sin(ray.a);
        const x0 = cx + ux * rx;
        const y0 = cy + uy * ry;
        const l = ray.len * s.p;
        g.lineStyle(dp(1), ray.gold ? t.medal : t.line, ray.alpha);
        g.lineBetween(x0, y0, x0 + ux * l, y0 + uy * l);
      }
      if (reduced) return;
      for (const f of flecks) {
        const d = f.r * Math.max(rx, ry) + dp(20) * s.p;
        g.fillStyle(f.gold ? t.medal : t.lineCore, 0.8 - 0.4 * s.p);
        g.fillRect(cx + Math.cos(f.a) * d, cy + Math.sin(f.a) * d * (ry / Math.max(rx, ry)), dp(1.6), dp(1.6));
      }
    };
    draw();
    this.winFx.set(
      g,
      reduced
        ? null
        : this.scene.tweens.add({
            targets: s,
            p: 1,
            delay: BLOOM.rays[0],
            duration: ms(BLOOM.rays[1] - BLOOM.rays[0]),
            ease: 'Sine.easeOut',
            onUpdate: draw,
          })
    );
  }

  clearWin(): void {
    for (const tw of this.winTweens) tw.stop();
    this.winTweens = [];
    this.winSeq += 1;
    this.resetFrame();
    if (this.figureUp) {
      // The figure's line was the stroke's ink: it goes with the figure.
      this.figureUp = false;
      this.resetInk(true);
    }
    if (this.winFill) {
      this.scene.tweens.killTweensOf(this.winFill);
      this.winFill.destroy();
      this.winFill = null;
    }
    for (const key of this.winKeys) if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    this.winKeys = [];
  }

  /**
   * A crease lit down the fold at the instant the figure closes: tangerine,
   * 2.6 pt at 0.75, from `y0` to `y1` over 240 ms from 80 ms in, then gone
   * over 300 ms.
   *
   * The game's one idea — the page folds here — said once, at the moment it
   * paid off. Over the figure's fill, under its line. Pure travel, so under
   * reduced motion it is not drawn at all. May be called just before or just
   * after `presentWin`.
   */
  creaseSweep(axisX: number, y0: number, y1: number): void {
    if (motionReduced()) return;
    const t = theme();
    const g = this.scene.add.graphics().setDepth(DEPTH.winCrease).setAlpha(0.75);
    this.adoptWinEffect(g);
    const w = dp(2.6);
    const s = { p: 0 };
    const draw = (): void => {
      g.clear();
      g.fillStyle(t.line, 1);
      const y = y0 + (y1 - y0) * s.p;
      g.fillRect(axisX - w / 2, Math.min(y0, y), w, Math.abs(y - y0));
    };
    this.winFx.set(
      g,
      this.scene.tweens.add({
        targets: s,
        p: 1,
        delay: 80,
        duration: ms(240),
        ease: 'Cubic.easeOut',
        onUpdate: draw,
        onComplete: () => {
          if (!this.winFx.has(g)) return;
          this.winFx.set(
            g,
            this.scene.tweens.add({
              targets: g,
              alpha: 0,
              duration: ms(300),
              ease: 'Quad.easeIn',
              onComplete: () => this.endEffect(this.winFx, g),
            })
          );
        },
      })
    );
  }

  /**
   * Eight drops of light thrown off the goal ring as the figure lands, and
   * their reflections off the mirrored ring: out to pt(28), 0.5 fading to
   * nothing, over 420ms. The line arriving hard enough to splash — not
   * confetti. Skipped under reduced motion.
   */
  droplets(at: Vec2): void {
    if (motionReduced()) return;
    const t = theme();
    const g = this.scene.add.graphics().setDepth(DEPTH.win + 1);
    this.adoptWinEffect(g);
    const twin = this.pf.mirror(at);
    const veiled = veiledInk(t.line, t);
    // Evenly round the ring, each nudged by a fixed amount so the splash is
    // not a perfect star — and so every win splashes the same way.
    const drops = Array.from({ length: 8 }, (_, i) => {
      const jitter = ((i * 0.618034) % 1) - 0.5;
      const a = ((i + 0.5) / 8) * Math.PI * 2 + jitter * 0.35;
      const reach = pt(28) * (0.8 + 0.2 * ((i * 0.381966) % 1));
      return { dx: Math.cos(a), dy: Math.sin(a), reach };
    });
    const r0 = METRICS.goalRadius;
    const s = { p: 0 };
    const draw = (): void => {
      g.clear();
      const alpha = 0.5 * (1 - s.p);
      const radius = pt(2.5) * (1 - 0.35 * s.p);
      for (const [x, ink, side] of [
        [at.x, t.line, 1],
        [twin.x, veiled, -1],
      ] as const) {
        g.fillStyle(ink, alpha);
        for (const d of drops) {
          const dist = r0 + (Math.max(r0, d.reach) - r0) * s.p;
          fillDisc(g, x + side * d.dx * dist, at.y + d.dy * dist, radius);
        }
      }
    };
    draw();
    this.winFx.set(
      g,
      this.scene.tweens.add({
        targets: s,
        p: 1,
        duration: ms(420),
        ease: 'Cubic.easeOut',
        onUpdate: draw,
        onComplete: () => this.endEffect(this.winFx, g),
      })
    );
  }

  /** Everything that IS the board, in paint order — what the win's frame moves as one. */
  private boardParts(): Effect[] {
    const out: Effect[] = [];
    for (const o of [
      this.sheetShadow,
      this.sheetImg,
      this.heatGlow,
      this.wallsImg,
      this.frontImg,
      this.heatLine,
      this.axisG,
      this.ripple,
      this.goalHalo,
      this.startHalo,
      this.startImg,
      this.goalImg,
    ]) {
      if (o) out.push(o as Effect);
    }
    return out;
  }

  /**
   * The figure steps back: the board and the win figure scale together about
   * `pivot` to `scale` over `dur` base ms (through `ms()`), making room for
   * the result card under the board. The walls, unless the bloom already
   * dimmed them further, fade to 0.45.
   *
   * The two move as ONE container, so the figure stays exactly where it was
   * drawn in the maze however the scale runs; the win's effects join it while
   * they last. A scale of 1 is the kill switch: nothing moves and nothing
   * fades. A reveal still showing fades out — its bands would stay at full
   * size over the shrinking maze. A second call re-aims the scale about the
   * first call's pivot.
   *
   * This moves what the player SEES, never what collision tests, so it must
   * not outlive the win: `resetFrame` puts everything back, and runs from
   * `clearWin` and `drawLevel`, so no path into the next attempt can skip it.
   */
  frameBoard(scale: number, pivot: Vec2, dur: number): void {
    if (!(scale > 0) || Math.abs(scale - 1) < 1e-3) return;
    if (!this.frame) {
      const frame = this.scene.add.container(pivot.x, pivot.y).setDepth(DEPTH.win);
      const members: Effect[] = [...this.boardParts(), ...this.winFx.keys()];
      if (this.winFill) members.push(this.winFill);
      if (this.figureUp) members.push(...this.inkParts());
      // In depth order, which is the order they painted in before.
      members.sort((a, b) => a.depth - b.depth);
      for (const m of members) {
        m.x -= pivot.x;
        m.y -= pivot.y;
        frame.add(m);
      }
      this.frame = frame;
      this.framePivot = { x: pivot.x, y: pivot.y };
    }

    if (this.revealG.alpha > 0) {
      const g = this.revealG;
      this.scene.tweens.killTweensOf(g);
      this.scene.tweens.add({
        targets: g,
        alpha: 0,
        duration: ms(200),
        onComplete: () => g.clear(),
      });
    }

    const frame = this.frame;
    this.scene.tweens.killTweensOf(frame);
    this.scene.tweens.add({
      targets: frame,
      scale,
      duration: ms(dur),
      ease: 'Cubic.easeInOut',
    });
    const walls = this.wallsImg;
    if (walls && this.wallsWinAlpha > FRAMED_WALL_ALPHA) {
      this.scene.tweens.killTweensOf(walls);
      this.wallsWinAlpha = FRAMED_WALL_ALPHA;
      this.scene.tweens.add({
        targets: walls,
        alpha: FRAMED_WALL_ALPHA,
        duration: ms(dur),
        ease: 'Cubic.easeInOut',
      });
    }
  }

  /**
   * Put the board back exactly as `drawLevel` left it: out of the frame,
   * unscaled, walls opaque — and drop the win's effects.
   * Idempotent; cheap when nothing was framed.
   */
  resetFrame(): void {
    this.clearEffects(this.winFx);
    const frame = this.frame;
    if (frame) {
      this.scene.tweens.killTweensOf(frame);
      const { x: px, y: py } = this.framePivot;
      /*
       * Phaser's Container.remove forgets to take off the destroy listener
       * its add put on the child (it removes a different handler than the one
       * it added). Left on, every win would hang one more dead frame off the
       * board's objects until the scene ended.
       */
      const onChildDestroyed = (frame as unknown as { onChildDestroyed: () => void })
        .onChildDestroyed;
      for (const m of [...frame.list] as Effect[]) {
        frame.remove(m); // exclusive: back onto the scene's display list
        m.off(Phaser.GameObjects.Events.DESTROY, onChildDestroyed, frame);
        m.x += px;
        m.y += py;
      }
      frame.destroy();
      this.frame = null;
    }
    const walls = this.wallsImg;
    if (walls) {
      this.scene.tweens.killTweensOf(walls);
      walls.setPosition(this.wallsBox.x, this.wallsBox.y).setScale(1).setAlpha(1);
    }
    this.wallsWinAlpha = 1;
    this.sheetImg?.setPosition(this.sheetBox.x, this.sheetBox.y).setScale(1).setAlpha(1);
    this.sheetShadow?.setScale(1).setAlpha(1);
    this.goalImg?.setScale(1);
    this.scene.tweens.killTweensOf(this.axisG);
    this.axisG.setAlpha(1);
  }

  /**
   * True when the board is drawn exactly where collision tests it: no frame,
   * the walls at their place, unscaled, opaque. For a DEV assertion when a
   * level is installed.
   */
  get frameIsIdentity(): boolean {
    const w = this.wallsImg;
    const s = this.sheetImg;
    const home = (o: Phaser.GameObjects.Image | null, x: number, y: number): boolean =>
      !o ||
      (o.parentContainer === null && o.x === x && o.y === y && o.scaleX === 1 && o.scaleY === 1 && o.alpha === 1);
    return this.frame === null && home(w, this.wallsBox.x, this.wallsBox.y) && home(s, this.sheetBox.x, this.sheetBox.y);
  }

  /** A win effect joins the frame if the board is already framed. */
  private adoptWinEffect(g: Effect): void {
    if (!this.frame) return;
    g.setPosition(g.x - this.framePivot.x, g.y - this.framePivot.y);
    this.frame.add(g);
  }

  /** One effect finished: forget it and free it. */
  private endEffect(set: Effects, g: Effect): void {
    set.delete(g);
    g.destroy();
  }

  /** Stop and free every effect in `set`, mid-flight or not. */
  private clearEffects(set: Effects): void {
    for (const [g, tween] of set) {
      tween?.stop();
      this.scene.tweens.killTweensOf(g);
      g.destroy();
    }
    set.clear();
  }

  destroy(): void {
    this.clearWin();
    this.completePrintIn();
    this.stopLoops();
    this.clearEffects(this.failFx);
    this.clearEffects(this.fx);
    this.wetTween?.stop();
    this.stillTimer?.remove();
    if (this.washDim !== null) undimPage(this.washDim);
    this.washDim = null;
    this.revealG.clearMask(true);
    this.revealShape?.destroy();
    this.revealShape = null;
    for (const o of [
      this.sheetShadow,
      this.sheetImg,
      this.wallsImg,
      this.frontImg,
      this.startImg,
      this.goalImg,
      this.goalHalo,
      this.startHalo,
      this.ripple,
      this.creaseLight,
      this.heatGlow,
      this.nibImg,
      this.fingerImg,
      this.fingerG,
    ]) {
      o?.destroy();
    }
    this.axisG.destroy();
    this.heatLine.destroy();
    this.revealG.destroy();
    this.ghostG.destroy();
    this.wetG.destroy();
    this.mirrorInk.destroy();
    this.strokeInk.destroy();
    this.coreInk.destroy();
    for (const glow of this.glowInk) glow.destroy();
    this.washG.destroy();
    // This renderer's own bake, the walls (tech G4: a scene's textures go
    // with it). The sheet and the small shared stamps stay for the next.
    for (const key of [`fw-ink-walls-${this.id}`]) {
      if (this.scene.textures?.exists(key)) this.scene.textures.remove(key);
    }
  }
}

/* ------------------------------------------------------------ the figure */

/** The win figure's fill: one texture painted once, over the figure's bounds. */
export interface FigureFill {
  /** The fill and engraving over the figure's bounds (origin top-left), to crop. */
  readonly fill: Phaser.GameObjects.Image;
  /** The closed figure's bounds, in board pixels. */
  readonly bounds: Rect;
  /** The textures to remove when the figure goes. */
  readonly keys: string[];
}

let figureSeq = 0;

/**
 * Bake the closed symmetric figure's fill and engraving, with the SAME
 * Canvas2D painter as the share card and the replay (ShareCard.paintFigureFill),
 * so the figure the player watches bloom is the figure they send.
 *
 * The figure's LINE is not baked here: it is the ink already on the board
 * (InkRenderer.presentWin keeps it), drawn by the same ribbon code from the
 * same samples, so it is exactly the line the player made. A texture, not a
 * Graphics: the figure stays on screen for as long as the player looks at
 * it, and a Graphics is re-triangulated on every one of those frames.
 */
export function buildFigureFill(scene: Phaser.Scene, outline: readonly Vec2[]): FigureFill | null {
  const bounds = boundsOf(outline);
  if (!bounds) return null;
  const fillKey = `fw-ink-fill-${++figureSeq}`;
  const fx = Math.floor(bounds.x);
  const fy = Math.floor(bounds.y);
  // At FILL_RES: a soft gradient under a faint engraving loses nothing at
  // half resolution, and a quarter of the texels is a quarter of the paint
  // and of the upload — the one bake the win still makes (a whole maze tall).
  const k = FILL_RES;
  const fill = canvasTexture(scene, fillKey, (Math.ceil(bounds.w) + 2) * k, (Math.ceil(bounds.h) + 2) * k, (ctx) => {
    ctx.scale(k, k);
    ctx.translate(-fx, -fy);
    paintFigureFill(ctx, outline, 1);
  });
  if (!fill) return null;
  const img = scene.add.image(fx, fy, fillKey).setOrigin(0, 0).setScale(1 / k);
  return { fill: img, bounds, keys: [fillKey] };
}

/** Texels per base unit of the win's fill bake. */
const FILL_RES = 0.5;

/**
 * Run `fn` once `frames` whole frames have been drawn — work a moment can
 * wait for (a bake, a card) moved off the frame that shows the moment. Counts
 * the scene's post-updates, so it is safe to call from an input handler or an
 * update alike; a scene that stops first never runs it.
 */
export function afterFrames(scene: Phaser.Scene, frames: number, fn: () => void): void {
  const events = scene.events;
  if (!events || typeof events.once !== 'function') {
    fn();
    return;
  }
  let left = Math.max(1, Math.floor(frames));
  const tick = (): void => {
    left -= 1;
    if (left <= 0) {
      events.off(Phaser.Scenes.Events.SHUTDOWN, drop);
      fn();
    } else {
      events.once(Phaser.Scenes.Events.POST_UPDATE, tick);
    }
  };
  const drop = (): void => {
    events.off(Phaser.Scenes.Events.POST_UPDATE, tick);
  };
  events.once(Phaser.Scenes.Events.POST_UPDATE, tick);
  events.once(Phaser.Scenes.Events.SHUTDOWN, drop);
}

/**
 * Paint a saved run — the maze, the line that solved it, its reflection —
 * into an arbitrary box, with Phaser Graphics. The gallery thumbnail.
 *
 * The same layout the share card uses, so what a player looks at in the grid is
 * exactly what leaves the phone when they tap it — in the same materials: the
 * crease, slate walls with their lit rim, the markers, a tangerine fill, the
 * moonlight and the line with its core. (A card this small has no room for
 * the bloom, and Graphics no gradient: the fill is its middle stop.) Figures
 * saved before mazes were kept carry no walls and simply paint as the bare
 * figure they always were; `layoutFigureCard` decides that, not this function.
 */
export function paintFigureInto(
  g: Phaser.GameObjects.Graphics,
  figure: SavedFigure,
  box: Rect,
  alphaScale = 1
): void {
  const t = theme();
  const u = ui();
  const layout = layoutFigureCard(figure, box);
  if (!layout) return;

  if (layout.axis) {
    // The crease: a dark hairline beside a light one.
    const { x, top, bottom } = layout.axis;
    const w = Math.max(1, layout.scale * 2) / 2;
    g.fillStyle(u.creaseDark, u.creaseDarkAlpha * alphaScale);
    g.fillRect(x - w, top, w, bottom - top);
    g.fillStyle(u.creaseLight, Math.min(1, u.creaseLightAlpha * 2) * alphaScale);
    g.fillRect(x, top, w, bottom - top);
  }

  if (layout.walls.length > 0) {
    const inset = WALL_RIM * layout.scale;
    const rim = inset >= 0.5;
    if (rim) {
      g.fillStyle(t.wallRim, alphaScale);
      for (const wall of layout.walls) {
        const r = Math.min(layout.wallRadius, wall.w / 2, wall.h / 2);
        fillRoundRect(g, wall.x, wall.y, wall.w, wall.h, r);
      }
    }
    g.fillStyle(t.wall, alphaScale);
    for (const wall of layout.walls) {
      const i = rim ? inset : 0;
      const r = Math.min(layout.wallRadius, (wall.w - i) / 2, (wall.h - i) / 2);
      fillRoundRect(g, wall.x + i, wall.y + i, wall.w - i, wall.h - i, r);
    }
  }

  for (const m of [...layout.markers].sort((a, b) => Number(b.mirror) - Number(a.mirror))) {
    const r = markerRadius(m.kind, layout.scale);
    const color = m.mirror ? t.veil : m.kind === 'start' ? t.accent : t.accentText;
    g.fillStyle(color, alphaScale);
    if (m.kind === 'start') {
      g.fillCircle(m.p.x, m.p.y, r);
    } else {
      // A ring this small draws as an annulus rather than a stroked circle:
      // lineStyle widths below a pixel drop out entirely at thumbnail scale.
      g.fillCircle(m.p.x, m.p.y, r);
      g.fillStyle(t.boardCentre, alphaScale);
      g.fillCircle(m.p.x, m.p.y, Math.max(0, r - goalRingWidth(layout.scale)));
      g.fillStyle(color, 0.8 * alphaScale);
      g.fillCircle(m.p.x, m.p.y, Math.max(1, r * 0.2));
    }
  }

  const opts: RibbonOptions = { ...DEFAULT_RIBBON, baseWidth: layout.nib };

  const outline = thinPath(layout.outline, CARD_SPAN, CARD_TOLERANCE).map(
    (i) => layout.outline[i]
  );
  const [, mid, midAlpha] = FIGURE_FILL[1];
  g.fillStyle(mid, midAlpha * alphaScale);
  g.fillPoints(outline, true);

  paintRibbonAlpha(g, layout.mirrored, veiledInk(t.line, t), alphaScale, opts);
  paintRibbonAlpha(g, layout.stroke, t.line, alphaScale, opts);
  paintRibbonAlpha(g, layout.stroke, t.lineCore, alphaScale, opts, t.lineCoreWidth);
}

/**
 * Ribbon at an explicit alpha, thinned to the card.
 *
 * The live stroke fades its mirror by setting alpha on a whole Graphics object,
 * because overlapping quads at partial alpha bead where they meet. A thumbnail
 * is small enough that the beading is sub-pixel, and sharing one Graphics for
 * the whole grid is worth far more than the artefact costs.
 *
 * The drawn path is smoothed at the PLAYFIELD's scale — the card has to show
 * the same line the share card and the capture check see — which on a card
 * puts a sample every fraction of a pixel. Widths come from every sample; the
 * shapes are painted only for the ones the card can tell apart (`thinPath`).
 */
function paintRibbonAlpha(
  g: Phaser.GameObjects.Graphics,
  stroke: DrawnStroke,
  color: number,
  alpha: number,
  opts: RibbonOptions,
  widthScale = 1
): void {
  const widths = strokeWidths(stroke, opts.baseWidth);
  const keep = thinPath(stroke.points, CARD_SPAN, CARD_TOLERANCE);
  paintParts(
    g,
    ribbonSlice(
      keep.map((i) => stroke.points[i]),
      keep.map((i) => widths[i] * widthScale)
    ),
    color,
    alpha
  );
}
