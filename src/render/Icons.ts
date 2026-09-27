/**
 * Icons — the pen-line icon family (SPEC §2.4, art-tokens "ICONS").
 *
 * A 24-unit grid, a 1.9-unit stroke, round caps and joins: every icon is drawn
 * the way the player draws, with a pen. And wherever a line STARTS it begins
 * with a filled dot, as the logo's line does — the start dot is the game's own
 * mark, so the icons read as the same hand. A closed outline (the eye, the
 * lock, the flame) has no start, so it carries its dot inside, as a pupil, a
 * keyhole, an ember.
 *
 * The path data is SVG's, lifted from the mocks (`final/_work/lib.js`, `I`),
 * but it is not handed to the browser as SVG: it is flattened here, in plain
 * TypeScript, into polylines. That one flattening feeds both renderers — the
 * Canvas2D bake (`iconTexture`, an Image per use, one texture per icon and
 * colour) and the live Phaser Graphics the old `Glyph` functions draw into —
 * so the two can never disagree, and the shapes can be tested without a DOM.
 *
 * Phaser is only touched inside functions: tests import the UI kit with a
 * stand-in Phaser, and a module that reached for it at load would break them.
 */

import type Phaser from 'phaser';
import type { Vec2 } from '../core/Geometry';

/* ------------------------------------------------------------ flattening */

/** One run of a path: its points in order, and whether it closes on itself. */
export interface SubPath {
  readonly points: Vec2[];
  readonly closed: boolean;
}

const CUBIC_STEPS = 10;
const QUAD_STEPS = 8;
/** An arc is cut into chords of at most this angle. */
const ARC_STEP = Math.PI / 14;

/** Tokenise SVG path data: commands and numbers, with the compact forms SVG allows (".5.5", "1-2"). */
function tokens(d: string): (string | number)[] {
  const out: (string | number)[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) out.push(m[1] ?? Number(m[2]));
  return out;
}

/**
 * The endpoint arc of SVG (`A rx ry rot large sweep x y`) as points, the
 * start excluded — the spec's own conversion (SVG 1.1, F.6.5), radii grown
 * when they cannot span the chord.
 */
function arcPoints(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  rotDeg: number,
  large: boolean,
  sweep: boolean,
  x2: number,
  y2: number
): Vec2[] {
  if (x1 === x2 && y1 === y2) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [{ x: x2, y: y2 }];
  const phi = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  let co = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) co = -co;
  const cxp = (co * rx * yp) / ry;
  const cyp = (-co * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = angle(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = angle((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  else if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(2, Math.ceil(Math.abs(dt) / ARC_STEP));
  const pts: Vec2[] = [];
  for (let i = 1; i <= n; i++) {
    const t = t1 + (dt * i) / n;
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    pts.push({ x: cos * ex - sin * ey + cx, y: sin * ex + cos * ey + cy });
  }
  // Land exactly on the endpoint, so the next command starts where SVG says.
  pts[pts.length - 1] = { x: x2, y: y2 };
  return pts;
}

/**
 * SVG path data as polylines: every command of SVG 1.1 (M L H V C S Q T A Z,
 * absolute and relative), curves cut into short chords. Exact at every
 * command's end point; within a small fraction of a unit between them, which
 * at icon size is far under a pixel.
 */
export function flattenPath(d: string): SubPath[] {
  const tk = tokens(d);
  const out: { points: Vec2[]; closed: boolean }[] = [];
  let cur: Vec2[] | null = null;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  // The last control point, for S and T's reflection.
  let cx2: number | null = null;
  let cy2: number | null = null;
  let qx: number | null = null;
  let qy: number | null = null;
  let cmd = '';
  let i = 0;
  const num = (): number => {
    const v = tk[i++];
    if (typeof v !== 'number') throw new Error(`icon path: expected a number in "${d}"`);
    return v;
  };
  const start = (): void => {
    cur = [{ x, y }];
    out.push({ points: cur, closed: false });
  };
  const lineTo = (nx: number, ny: number): void => {
    if (!cur) start();
    x = nx;
    y = ny;
    (cur as Vec2[]).push({ x, y });
  };

  while (i < tk.length) {
    const t = tk[i];
    if (typeof t === 'string') {
      cmd = t;
      i++;
      if (cmd === 'Z' || cmd === 'z') {
        if (cur) {
          out[out.length - 1].closed = true;
          x = sx;
          y = sy;
        }
        cur = null;
        cx2 = cy2 = qx = qy = null;
        continue;
      }
    } else if (!cmd) {
      throw new Error(`icon path: a number before any command in "${d}"`);
    }
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M': {
        x = num() + ox;
        y = num() + oy;
        sx = x;
        sy = y;
        start();
        // Pairs after a moveto are linetos.
        cmd = rel ? 'l' : 'L';
        cx2 = cy2 = qx = qy = null;
        break;
      }
      case 'L':
        lineTo(num() + ox, num() + oy);
        cx2 = cy2 = qx = qy = null;
        break;
      case 'H':
        lineTo(num() + ox, y);
        cx2 = cy2 = qx = qy = null;
        break;
      case 'V':
        lineTo(x, num() + oy);
        cx2 = cy2 = qx = qy = null;
        break;
      case 'C':
      case 'S': {
        let ax: number;
        let ay: number;
        if (cmd.toUpperCase() === 'C') {
          ax = num() + ox;
          ay = num() + oy;
        } else {
          ax = cx2 === null ? x : 2 * x - cx2;
          ay = cy2 === null ? y : 2 * y - (cy2 as number);
        }
        const bx = num() + ox;
        const by = num() + oy;
        const ex = num() + ox;
        const ey = num() + oy;
        const x0 = x;
        const y0 = y;
        for (let k = 1; k <= CUBIC_STEPS; k++) {
          const u = k / CUBIC_STEPS;
          const v = 1 - u;
          lineTo(
            v * v * v * x0 + 3 * v * v * u * ax + 3 * v * u * u * bx + u * u * u * ex,
            v * v * v * y0 + 3 * v * v * u * ay + 3 * v * u * u * by + u * u * u * ey
          );
        }
        x = ex;
        y = ey;
        cx2 = bx;
        cy2 = by;
        qx = qy = null;
        break;
      }
      case 'Q':
      case 'T': {
        let ax: number;
        let ay: number;
        if (cmd.toUpperCase() === 'Q') {
          ax = num() + ox;
          ay = num() + oy;
        } else {
          ax = qx === null ? x : 2 * x - qx;
          ay = qy === null ? y : 2 * y - (qy as number);
        }
        const ex = num() + ox;
        const ey = num() + oy;
        const x0 = x;
        const y0 = y;
        for (let k = 1; k <= QUAD_STEPS; k++) {
          const u = k / QUAD_STEPS;
          const v = 1 - u;
          lineTo(v * v * x0 + 2 * v * u * ax + u * u * ex, v * v * y0 + 2 * v * u * ay + u * u * ey);
        }
        x = ex;
        y = ey;
        qx = ax;
        qy = ay;
        cx2 = cy2 = null;
        break;
      }
      case 'A': {
        const rx = num();
        const ry = num();
        const rot = num();
        const large = num() !== 0;
        const sweep = num() !== 0;
        const ex = num() + ox;
        const ey = num() + oy;
        for (const p of arcPoints(x, y, rx, ry, rot, large, sweep, ex, ey)) lineTo(p.x, p.y);
        x = ex;
        y = ey;
        cx2 = cy2 = qx = qy = null;
        break;
      }
      default:
        throw new Error(`icon path: unsupported command ${cmd}`);
    }
  }
  // A lone moveto draws nothing.
  return out.filter((s) => s.points.length > 1);
}

/* ------------------------------------------------------------- the family */

/** A filled circle: `[x, y, r]` in the 24-unit box. */
export type Dot = readonly [number, number, number];

export interface IconDef {
  /** Paths drawn as pen lines, in order. */
  readonly strokes?: readonly string[];
  /** Paths filled solid (the star, the play triangle). */
  readonly fills?: readonly string[];
  /** Paths filled at `alpha` under the lines: the flame's warm body. */
  readonly washes?: readonly { readonly d: string; readonly alpha: number }[];
  /** Paths drawn as dotted pen lines: `[dash, gap]`. */
  readonly dotted?: readonly { readonly d: string; readonly dash: number; readonly gap: number }[];
  /** Filled circles — the start dots, a pupil, a keyhole. */
  readonly dots?: readonly Dot[];
  /** Stroked circles: `[x, y, r]`. */
  readonly rings?: readonly Dot[];
}

/** The pen's width on the 24-unit grid. */
export const ICON_STROKE = 1.9;
/** A start dot: 1.7× the line, the logo's own proportion (dot r 80 for a 94 line). */
const DOT = 1.6;

export const ICONS = {
  back: { strokes: ['M14.5 5 L7.5 12 L14.5 19'] },
  more: {
    dots: [
      [5.5, 12, 1.6],
      [12, 12, 1.6],
      [18.5, 12, 1.6],
    ],
  },
  plus: { strokes: ['M12 6v12M6 12h12'] },
  flame: {
    strokes: [
      'M12 21c-3.9 0-6.5-2.6-6.5-6.1 0-2.9 1.9-4.6 3.2-6.4.9 1.4 1.9 2.1 2.9 2.4-.3-2.9.9-5.7 3-7.4.2 3 1.5 4.6 2.9 6.2 1.3 1.5 2 3 2 5.1 0 3.6-3 6.2-7.5 6.2z',
    ],
    washes: [
      {
        d: 'M12 21c-3.9 0-6.5-2.6-6.5-6.1 0-2.9 1.9-4.6 3.2-6.4.9 1.4 1.9 2.1 2.9 2.4-.3-2.9.9-5.7 3-7.4.2 3 1.5 4.6 2.9 6.2 1.3 1.5 2 3 2 5.1 0 3.6-3 6.2-7.5 6.2z',
        alpha: 0.25,
      },
    ],
    // The ember: where the flame burns from.
    dots: [[12, 16.4, DOT]],
  },
  bookmark: {
    strokes: ['M7 3.5h10v17l-5-3.6-5 3.6z'],
    dots: [[12, 9, DOT * 0.9]],
  },
  eye: {
    strokes: ['M2.5 12c2.4-4.2 5.6-6.3 9.5-6.3s7.1 2.1 9.5 6.3c-2.4 4.2-5.6 6.3-9.5 6.3S4.9 16.2 2.5 12z'],
    dots: [[12, 12, 2.6]],
  },
  gift: {
    strokes: [
      'M4 11h16v7.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z',
      'M3.5 8h17v3h-17z',
      'M12 8v12.5',
      'M12 8c-1.5-3.8-6-4.6-6-1.8C6 8 12 8 12 8zm0 0c1.5-3.8 6-4.6 6-1.8C18 8 12 8 12 8z',
    ],
    dots: [[12, 8, DOT]],
  },
  store: {
    strokes: [
      'M5 8.5h14l-1.2 11a1.5 1.5 0 0 1-1.5 1.3H7.7a1.5 1.5 0 0 1-1.5-1.3z',
      'M8.8 11.5V7a3.2 3.2 0 0 1 6.4 0v4.5',
    ],
    // The handle's two ends, riveted: a line that starts on a dot at each.
    dots: [
      [8.8, 11.5, DOT * 0.85],
      [15.2, 11.5, DOT * 0.85],
    ],
  },
  levels: {
    strokes: ['M6 19.5V15a3 3 0 0 1 3-3h6a3 3 0 0 0 3-3V4.5'],
    dots: [[6, 19.5, 2.2]],
    rings: [[18, 4.5, 2.2]],
  },
  gallery: {
    strokes: [
      'M12 4.5C8 3.5 4.5 5.5 5.5 9c.6 2 2.8 2.6 2.8 4.2 0 1.8-3.3 2.6-2.3 5.1.8 2 4 2.4 6 1.2',
      'M12 4.5c4-1 7.5 1 6.5 4.5-.6 2-2.8 2.6-2.8 4.2 0 1.8 3.3 2.6 2.3 5.1-.8 2-4 2.4-6 1.2',
    ],
    dotted: [{ d: 'M12 8.2v8.6', dash: 1.2, gap: 2.6 }],
    // Both halves start at the fold: one dot for the pair.
    dots: [[12, 4.5, DOT]],
  },
  share: {
    strokes: ['M12 15V3.8M7.8 8L12 3.8 16.2 8', 'M6 11.5v7a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-7'],
    dots: [[12, 15, DOT]],
  },
  retry: {
    strokes: ['M5 12a7 7 0 1 0 2.1-5', 'M6.6 3.2L7 7.2l4-.5'],
    dots: [[5, 12, DOT]],
  },
  lock: {
    strokes: ['M5.5 10.5h13v7.5a2.5 2.5 0 0 1-2.5 2.5h-8a2.5 2.5 0 0 1-2.5-2.5z', 'M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5'],
    dots: [[12, 15.3, DOT]],
  },
  star: {
    fills: ['M12 3.6l2.5 5.2 5.7.7-4.2 3.9 1.1 5.6L12 16.3 6.9 19l1.1-5.6-4.2-3.9 5.7-.7z'],
  },
  starOutline: {
    strokes: ['M12 3.6l2.5 5.2 5.7.7-4.2 3.9 1.1 5.6L12 16.3 6.9 19l1.1-5.6-4.2-3.9 5.7-.7z'],
  },
  check: {
    strokes: ['M6 12.5l4 4 8-9'],
    dots: [[6, 12.5, DOT]],
  },
  arrow: {
    strokes: ['M5 12h13M13 6.5l5.5 5.5-5.5 5.5'],
    dots: [[5, 12, DOT]],
  },
  sense: {
    strokes: ['M4 17a8 8 0 0 1 16 0', 'M12 17l4.2-5.2'],
    dots: [[12, 17, 1.8]],
  },
  clean: {
    strokes: ['M3 12c2-3.6 4-3.6 6 0s4 3.6 6 0 4-3.6 6 0'],
    dots: [[3, 12, DOT]],
  },
  sound: {
    strokes: ['M4 9.5h3.5L12 5.5v13l-4.5-4H4z', 'M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11'],
  },
  moon: { strokes: ['M19.5 14.8A8 8 0 0 1 9.2 4.5 8 8 0 1 0 19.5 14.8z'] },
  play: { fills: ['M8 5.5v13l10.5-6.5z'] },
  calendar: {
    strokes: ['M4 8.5a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z', 'M4 10h16M8.5 3v4M15.5 3v4'],
    dots: [
      [8.5, 3, DOT * 0.8],
      [15.5, 3, DOT * 0.8],
    ],
  },
  target: {
    rings: [[12, 12, 8]],
    dots: [[12, 12, 2.5]],
  },
  medal: {
    rings: [[12, 12, 8.5]],
    fills: ['M12 7.2l1.5 3 3.3.4-2.4 2.3.6 3.3-3-1.6-3 1.6.6-3.3-2.4-2.3 3.3-.4z'],
  },
  video: {
    strokes: ['M5.5 6.5h13a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z'],
    fills: ['M10.3 9.2v5.6l4.6-2.8z'],
  },
  noAds: {
    strokes: ['M5.5 8h13a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z', 'M3.5 19.5L20.5 4.5'],
    dots: [[3.5, 19.5, DOT]],
  },
} as const satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;

export const ICON_NAMES = Object.keys(ICONS) as IconName[];

/** A def's paths, flattened once and kept: the shapes never change at run time. */
interface Flat {
  strokes: SubPath[];
  fills: SubPath[];
  washes: { paths: SubPath[]; alpha: number }[];
  dotted: { paths: SubPath[]; dash: number; gap: number }[];
  dots: readonly Dot[];
  rings: readonly Dot[];
}

const flatCache = new Map<IconName, Flat>();

export function flatIcon(name: IconName): Flat {
  let f = flatCache.get(name);
  if (!f) {
    const def: IconDef = ICONS[name];
    f = {
      strokes: (def.strokes ?? []).flatMap(flattenPath),
      fills: (def.fills ?? []).flatMap(flattenPath),
      washes: (def.washes ?? []).map((w) => ({ paths: flattenPath(w.d), alpha: w.alpha })),
      dotted: (def.dotted ?? []).map((w) => ({ paths: flattenPath(w.d), dash: w.dash, gap: w.gap })),
      dots: def.dots ?? [],
      rings: def.rings ?? [],
    };
    flatCache.set(name, f);
  }
  return f;
}

/**
 * Split a polyline into its dashes: `[dash, gap]` along the arc length.
 * The dotted pen line, for renderers with no dash support (Phaser Graphics).
 */
export function dashes(points: readonly Vec2[], dash: number, gap: number): Vec2[][] {
  const out: Vec2[][] = [];
  let on = true;
  let left = dash;
  let run: Vec2[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    let a = points[i - 1];
    const b = points[i];
    let seg = Math.hypot(b.x - a.x, b.y - a.y);
    while (seg > 0) {
      const step = Math.min(seg, left);
      const t = step / seg;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (on) run.push(p);
      seg -= step;
      left -= step;
      a = p;
      if (left <= 1e-9) {
        if (on && run.length > 1) out.push(run);
        on = !on;
        left = on ? dash : gap;
        run = [p];
      }
    }
  }
  if (on && run.length > 1) out.push(run);
  return out;
}

/* ------------------------------------------------------------ Canvas2D */

/**
 * Paint an icon into a 2D context, centred on (cx, cy), the 24-unit box
 * drawn `size` across. The bake and the share outputs both come through
 * here.
 */
export function paintIcon(
  ctx: CanvasRenderingContext2D,
  name: IconName,
  cx: number,
  cy: number,
  size: number,
  color: string,
  strokeWidth = ICON_STROKE
): void {
  const f = flatIcon(name);
  const k = size / 24;
  ctx.save();
  ctx.translate(cx - 12 * k, cy - 12 * k);
  ctx.scale(k, k);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = strokeWidth;
  const trace = (s: SubPath): void => {
    ctx.moveTo(s.points[0].x, s.points[0].y);
    for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
    if (s.closed) ctx.closePath();
  };
  for (const w of f.washes) {
    ctx.globalAlpha = w.alpha;
    ctx.beginPath();
    w.paths.forEach(trace);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (f.fills.length) {
    ctx.beginPath();
    f.fills.forEach(trace);
    ctx.fill();
  }
  if (f.strokes.length) {
    ctx.beginPath();
    f.strokes.forEach(trace);
    ctx.stroke();
  }
  for (const d of f.dotted) {
    ctx.beginPath();
    for (const p of d.paths) for (const run of dashes(p.points, d.dash, d.gap)) trace({ points: run, closed: false });
    ctx.stroke();
  }
  for (const [x, y, r] of f.rings) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const [x, y, r] of f.dots) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* -------------------------------------------------------------- Graphics */

/**
 * Draw an icon into a Phaser Graphics, centred on (cx, cy), `size` across.
 *
 * For the `Glyph` functions every scene already calls — a live Graphics, so
 * it is for the few marks that animate or recolour. A static mark should be
 * an `icon()` Image off the baked texture instead (tech G2).
 *
 * Graphics lines have no round caps or joins, so the caps are discs at the
 * open ends and the sharp corners get one too; a gentle curve's joins are
 * under a pixel apart and need nothing.
 */
export function drawIcon(
  g: Phaser.GameObjects.Graphics,
  name: IconName,
  cx: number,
  cy: number,
  size: number,
  color: number,
  alpha = 1,
  strokeWidth = ICON_STROKE
): void {
  if (!(alpha > 0)) return;
  const f = flatIcon(name);
  const k = size / 24;
  const at = (p: Vec2): Vec2 => ({ x: cx + (p.x - 12) * k, y: cy + (p.y - 12) * k });
  const lw = strokeWidth * k;
  for (const w of f.washes) {
    g.fillStyle(color, alpha * w.alpha);
    for (const s of w.paths) g.fillPoints(s.points.map(at), true);
  }
  g.fillStyle(color, alpha);
  for (const s of f.fills) g.fillPoints(s.points.map(at), true);
  const line = (pts: Vec2[], closed: boolean): void => {
    g.lineStyle(lw, color, alpha);
    g.strokePoints(pts, closed, closed);
    g.fillStyle(color, alpha);
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const open = !closed && (i === 0 || i === n - 1);
      if (open || sharp(pts, i, closed)) g.fillCircle(pts[i].x, pts[i].y, lw / 2);
    }
  };
  for (const s of f.strokes) line(s.points.map(at), s.closed);
  for (const d of f.dotted) {
    for (const p of d.paths) for (const run of dashes(p.points, d.dash, d.gap)) line(run.map(at), false);
  }
  for (const [x, y, r] of f.rings) {
    const c = at({ x, y });
    g.lineStyle(lw, color, alpha);
    g.strokeCircle(c.x, c.y, r * k);
  }
  g.fillStyle(color, alpha);
  for (const [x, y, r] of f.dots) {
    const c = at({ x, y });
    g.fillCircle(c.x, c.y, r * k);
  }
}

/** Whether the polyline turns by more than 35° at vertex `i`: a corner that needs its join filled. */
function sharp(pts: readonly Vec2[], i: number, closed: boolean): boolean {
  const n = pts.length;
  if (!closed && (i === 0 || i === n - 1)) return false;
  const a = pts[(i - 1 + n) % n];
  const b = pts[i];
  const c = pts[(i + 1) % n];
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const lu = Math.hypot(ux, uy);
  const lv = Math.hypot(vx, vy);
  if (lu === 0 || lv === 0) return false;
  return (ux * vx + uy * vy) / (lu * lv) < Math.cos((35 * Math.PI) / 180);
}

/* ----------------------------------------------------------------- bakes */

/**
 * How many texture pixels an icon gets per base unit. 2, so an icon stays
 * crisp when the canvas is drawn larger than its 750 base units (every
 * iPhone draws it at 1.5-1.7×) and when stage 3 renders at device size.
 */
const ICON_RES = 2;

/** The texture key for `name` in `color` at `px` base units across. */
export function iconKey(name: IconName, color: number, px: number): string {
  return `fw-icon-${name}-${(color & 0xffffff).toString(16).padStart(6, '0')}-${Math.round(px)}`;
}

/**
 * The baked texture for an icon — painted once per name, colour and size,
 * then shared by every Image that shows it, on every screen. Baked per
 * colour rather than in white for a tint: the Canvas renderer cannot tint,
 * and an icon in the wrong colour is broken where one baked right is not.
 * An icon is a few kilobytes; the few dozen a session uses never add up.
 */
export function iconTexture(scene: Phaser.Scene, name: IconName, color: number, px: number): string {
  const key = iconKey(name, color, px);
  if (scene.textures.exists(key)) return key;
  // A pixel of air on every side, so the round caps are never clipped.
  const side = Math.ceil((px + 4) * ICON_RES);
  const tex = scene.textures.createCanvas(key, side, side);
  if (!tex) return '__MISSING';
  const ctx = tex.getContext();
  paintIcon(ctx, name, side / 2, side / 2, px * ICON_RES, `#${(color & 0xffffff).toString(16).padStart(6, '0')}`);
  tex.refresh();
  return key;
}

export interface IconOptions {
  /** The 24-unit box drawn this many base units across. */
  size?: number;
  color: number;
  alpha?: number;
}

/**
 * An icon as an Image off its baked texture, centred on (x, y). One draw call
 * among many, never a Graphics re-triangulated every frame.
 */
export function icon(
  scene: Phaser.Scene,
  x: number,
  y: number,
  name: IconName,
  o: IconOptions
): Phaser.GameObjects.Image {
  const px = o.size ?? 36;
  const key = iconTexture(scene, name, o.color, px);
  return scene.add
    .image(x, y, key)
    .setScale(1 / ICON_RES)
    .setAlpha(o.alpha ?? 1);
}
