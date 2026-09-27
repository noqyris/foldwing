/**
 * The painters the share card, the replay and the play board share (tech
 * G11). What is pinned is what the picture may never get wrong: a wall drawn
 * no bigger than the wall that kills, a goal ring at exactly the threshold, a
 * bloom that is one light and not a stack of lines, and a ribbon that fills
 * once however often it overlaps itself.
 */

import { describe, expect, it, vi } from 'vitest';

// The painters reach the look kit, whose modules import Phaser at load.
vi.mock('phaser', () => ({ default: {} }));

import { ribbonSlice } from '../core/Ribbon';
import { BOARD_SHEET, sheetAround, START_DOT_R } from './FigureCard';
import {
  bloomProfile,
  lineLook,
  mirrorLook,
  paintGoalRing,
  paintWalls,
  ribbonPath,
  stackAlphas,
  WALL_RIM,
  WALL_SHADOW,
} from './ShareCard';
import { dp, METRICS, theme } from './Theme';

/** The last element (Array.prototype.at is past this project's lib). */
const last = <T>(a: readonly T[]): T => a[a.length - 1];

interface Call {
  op: string;
  args: unknown[];
}

/** A 2D context that records every call and every property set. */
const recordingCtx = (): CanvasRenderingContext2D & { log: Call[] } => {
  const log: Call[] = [];
  const ctx = new Proxy({} as CanvasRenderingContext2D & { log: Call[] }, {
    get: (_o, k) => {
      if (k === 'log') return log;
      return (...args: unknown[]) => {
        log.push({ op: String(k), args });
        return ctx;
      };
    },
    set: (_o, k, v) => {
      log.push({ op: `=${String(k)}`, args: [v] });
      return true;
    },
  });
  return ctx;
};

const points = (log: Call[]): { x: number; y: number }[] =>
  log
    .filter((c) => c.op === 'moveTo' || c.op === 'lineTo' || c.op === 'arcTo')
    .flatMap((c) => {
      const a = c.args as number[];
      return c.op === 'arcTo'
        ? [
            { x: a[0], y: a[1] },
            { x: a[2], y: a[3] },
          ]
        : [{ x: a[0], y: a[1] }];
    });

describe('the slate walls', () => {
  const walls = [
    { x: 40, y: 100, w: 200, h: 16 },
    { x: 224, y: 100, w: 16, h: 180 },
  ];

  /* Tech G5: rendering may not lie about collision. */
  it('draw nothing outside the collision rects, at any scale', () => {
    for (const scale of [1, 1.4]) {
      const ctx = recordingCtx();
      const scaled = walls.map((w) => ({ x: w.x * scale, y: w.y * scale, w: w.w * scale, h: w.h * scale }));
      paintWalls(ctx, scaled, METRICS.wallCornerRadius * scale, scale);
      for (const p of points(ctx.log)) {
        expect(scaled.some((w) => p.x >= w.x - 1e-9 && p.x <= w.x + w.w + 1e-9 && p.y >= w.y - 1e-9 && p.y <= w.y + w.h + 1e-9)).toBe(true);
      }
    }
  });

  it('cast a shadow of at most 0.10, at most 3 pt down, so it never reads as more wall', () => {
    expect(WALL_SHADOW.alpha).toBeLessThanOrEqual(0.1);
    expect(WALL_SHADOW.dy).toBeLessThanOrEqual(dp(3));
    const ctx = recordingCtx();
    paintWalls(ctx, walls, METRICS.wallCornerRadius, 1);
    const colour = ctx.log.find((c) => c.op === '=shadowColor')!.args[0] as string;
    expect(Number(/,([\d.]+)\)$/.exec(colour)![1])).toBeLessThanOrEqual(0.1);
  });

  it('show the lit rim along the top and left only: the face sits 0.9 pt in from them', () => {
    expect(WALL_RIM).toBeCloseTo(0.9 * (750 / 402), 9);
    const ctx = recordingCtx();
    paintWalls(ctx, [walls[0]], 0, 1);
    // The face is the last path: it starts WALL_RIM in from the top-left and ends at the far edges.
    const lastPath = last(ctx.log.map((c, i) => (c.op === 'beginPath' ? i : -1)).filter((i) => i >= 0))!;
    const face = points(ctx.log.slice(lastPath));
    expect(Math.min(...face.map((p) => p.x))).toBeCloseTo(walls[0].x + WALL_RIM, 6);
    expect(Math.min(...face.map((p) => p.y))).toBeCloseTo(walls[0].y + WALL_RIM, 6);
    expect(Math.max(...face.map((p) => p.x))).toBeCloseTo(walls[0].x + walls[0].w, 6);
    expect(Math.max(...face.map((p) => p.y))).toBeCloseTo(walls[0].y + walls[0].h, 6);
  });
});

describe('the goal ring', () => {
  /* The ring IS the win threshold: its outer edge is goalRadius exactly. */
  it('reaches exactly its radius, stroke included', () => {
    const ctx = recordingCtx();
    const r = METRICS.goalRadius;
    const w = METRICS.goalRingWidth;
    paintGoalRing(ctx, 100, 100, r, w, false);
    const i = ctx.log.findIndex((c) => c.op === 'stroke');
    const arc = last(ctx.log.slice(0, i).filter((c) => c.op === 'arc'))!.args as number[];
    const width = last(ctx.log.slice(0, i).filter((c) => c.op === '=lineWidth'))!.args[0] as number;
    expect(arc[2] + width / 2).toBeCloseTo(r, 9);
  });

  it('is drawn in the text accent, its reflection in veil', () => {
    const live = recordingCtx();
    paintGoalRing(live, 0, 0, 30, 4, false);
    const mirror = recordingCtx();
    paintGoalRing(mirror, 0, 0, 30, 4, true);
    const stroke = (log: Call[]): string => last(log.filter((c) => c.op === '=strokeStyle'))!.args[0] as string;
    const rgb = (c: number): string => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},1)`;
    expect(stroke(live.log)).toBe(rgb(theme().accentText));
    expect(stroke(mirror.log)).toBe(rgb(theme().veil));
  });
});

describe('the bloom', () => {
  const rings = bloomProfile();

  /* OWNER-DECISIONS 1: 3.2× at 0.18 and 2.0× at 0.22, as one light. */
  it('keeps the two passes' + "' reach and peak, falling smoothly between", () => {
    expect(rings[0].width).toBeCloseTo(3.2, 9);
    expect(last(rings)!.level).toBeCloseTo(1 - 0.82 * 0.78, 9);
    for (let i = 1; i < rings.length; i++) {
      expect(rings[i].width).toBeLessThan(rings[i - 1].width);
      expect(rings[i].level).toBeGreaterThan(rings[i - 1].level);
    }
    // Nearly gone at its reach, so it ends as light, not as an edge.
    expect(rings[0].level).toBeLessThan(0.02);
  });

  it('composites as a stack to exactly the level of every ring', () => {
    const levels = rings.map((r) => r.level);
    const alphas = stackAlphas(levels);
    let shown = 0;
    alphas.forEach((a, i) => {
      shown = shown + (1 - shown) * a;
      expect(shown).toBeCloseTo(levels[i], 9);
    });
  });

  it('glows the line and a dead line, never the moonlight', () => {
    expect(lineLook().bloom.length).toBeGreaterThan(0);
    expect(lineLook(theme().fail).bloom.length).toBeGreaterThan(0);
    expect(lineLook(theme().fail).core).toBeNull();
    expect(lineLook().core).toBe(theme().lineCore);
    expect(mirrorLook().bloom).toEqual([]);
    expect(mirrorLook().color).toBe(theme().mirror);
  });
});

describe('the ribbon as one path', () => {
  /* Every sub-path clockwise, so a nonzero fill paints the union once. */
  it('winds every quad and disc the same way', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 30, y: 10 },
      { x: 40, y: 50 },
      { x: 10, y: 70 },
      { x: -20, y: 40 },
    ];
    const ctx = recordingCtx();
    ribbonPath(ctx, ribbonSlice(pts, pts.map(() => 6)));
    const log = ctx.log;
    let poly: { x: number; y: number }[] = [];
    const areas: number[] = [];
    for (const c of log) {
      const a = c.args as number[];
      if (c.op === 'moveTo') poly = [{ x: a[0], y: a[1] }];
      else if (c.op === 'lineTo') poly.push({ x: a[0], y: a[1] });
      else if (c.op === 'closePath' && poly.length >= 3) {
        let s = 0;
        for (let i = 0; i < poly.length; i++) {
          const p = poly[i];
          const q = poly[(i + 1) % poly.length];
          s += p.x * q.y - q.x * p.y;
        }
        areas.push(s);
        poly = [];
      } else if (c.op === 'arc') {
        // Canvas arcs default to clockwise on screen: positive in y-down coordinates.
        expect(c.args[5]).toBeUndefined();
        poly = [];
      }
    }
    expect(areas.length).toBe(4);
    for (const a of areas) expect(a).toBeGreaterThan(0);
  });
});

describe('the board sheet', () => {
  it('frames the playfield 11 wider each side and 22 taller top and bottom, at any scale', () => {
    expect(sheetAround({ x: 24, y: 88, w: 702, h: 1102 })).toEqual({ x: 13, y: 66, w: 724, h: 1146 });
    expect(sheetAround({ x: 0, y: 0, w: 100, h: 100 }, 2)).toEqual({ x: -22, y: -44, w: 144, h: 188 });
    expect(BOARD_SHEET.radius).toBe(Math.round(28 * (750 / 402)));
  });

  it('draws the start dot at 8.5 pt, whatever grabs it', () => {
    expect(START_DOT_R).toBe(dp(8.5));
    // The grab is METRICS' own, and wider than any dot drawn.
    expect(METRICS.startRadius * METRICS.startGrabFactor).toBeGreaterThan(START_DOT_R * 2);
  });
});
