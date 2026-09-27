/**
 * MazeThumb — a level drawn in miniature: its walls, the fold, the start and
 * the goal, from the same normalised data the game plays.
 *
 * The Menu's Continue card, the result card's Next button and the Levels
 * journey all show "the next maze" before it is played; one painter serves
 * them, so the three can never draw the same level three ways. Extracted from
 * LevelSelect's `buildPreview` — the same mapping (normalised x/y straight
 * onto the thumb's box, the mirror at the middle) — and moved from a handful
 * of tinted quads per card to ONE baked texture per level and size: a thumb
 * is an Image, one draw call, however many walls the maze has.
 *
 * Night Fold's look (the B mocks' mini boards): a small dark board with a lit
 * rim, pill-ended slate walls, a hairline crease, the tangerine start dot and
 * goal ring, and their reflections veiled in cream.
 *
 * Textures are shared and counted: every Image showing a thumb holds its
 * texture, and a texture no Image holds waits in a small pool for the next
 * screen that wants it (the Menu's Continue thumb is the result card's Next),
 * the oldest going when the pool is full.
 */

import type Phaser from 'phaser';
import type { Level } from '../data/types';
import { dp, hexCss, rgba, theme, ui } from './Theme';
import { roundRectPath } from './Baked';

export interface MazeThumbOptions {
  /** A locked level: walls and markers at `LOCKED_ALPHA`. */
  dim?: boolean;
  /** The small board behind the maze (default true). Without it the maze sits on whatever is under it. */
  frame?: boolean;
  /** The frame's corner radius, base units. Default: the mini board's 15 pt. */
  radius?: number;
  /** The maze's inset inside the frame, as a fraction of the thumb's width. */
  pad?: number;
  /** The start and goal and their reflections (default true). */
  markers?: boolean;
  /** Texture pixels per base unit. */
  res?: number;
}

/** A locked maze shows at this: seen, not yet offered (SPEC §5.4). */
export const LOCKED_ALPHA = 0.55;

const DEFAULT_RES = 1.5;

export interface ThumbRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Corner radius: pill ends, like the board's walls. */
  r: number;
}

export interface ThumbLayout {
  /** The maze's own box inside the thumb. */
  inner: { x: number; y: number; w: number; h: number };
  axisX: number;
  walls: ThumbRect[];
  start: { x: number; y: number };
  goal: { x: number; y: number };
  mirrorStart: { x: number; y: number };
  mirrorGoal: { x: number; y: number };
  /** The start dot's radius and the goal ring's, and the ring's stroke. */
  dotR: number;
  ringR: number;
  ringW: number;
  /** A wall's least drawn thickness: a sliver still reads as a wall. */
  minWall: number;
}

/**
 * Where everything goes in a thumb `w` × `h`: pure, so the mapping is tested.
 *
 * Normalised coordinates map straight onto the inner box, as LevelSelect's
 * preview did — a thumb is read for its shape, and filling the card reads
 * better than a letterboxed board. The markers scale with the thumb but never
 * vanish: a start dot under 2 base units is not a dot.
 */
export function thumbLayout(level: Level, w: number, h: number, o: MazeThumbOptions = {}): ThumbLayout {
  const frame = o.frame !== false;
  // One inset all round, measured on the width, so the frame's margin is even.
  const pad = frame ? w * (o.pad ?? 0.07) : 0;
  const inner = { x: pad, y: pad, w: w - 2 * pad, h: h - 2 * pad };
  const minWall = Math.max(1.5, w / 80);
  const walls = level.walls.map((wall) => {
    const rw = Math.max(minWall, wall.w * inner.w);
    const rh = Math.max(minWall, wall.h * inner.h);
    return {
      x: inner.x + wall.x * inner.w,
      y: inner.y + wall.y * inner.h,
      w: rw,
      h: rh,
      r: Math.min(rw, rh) / 2,
    };
  });
  const at = (p: { x: number; y: number }) => ({ x: inner.x + p.x * inner.w, y: inner.y + p.y * inner.h });
  const start = at(level.start);
  const goal = at(level.goal);
  const scale = w / dp(104);
  return {
    inner,
    axisX: inner.x + inner.w / 2,
    walls,
    start,
    goal,
    mirrorStart: { x: inner.x + (1 - level.start.x) * inner.w, y: start.y },
    mirrorGoal: { x: inner.x + (1 - level.goal.x) * inner.w, y: goal.y },
    dotR: Math.max(2, dp(3.4) * scale),
    ringR: Math.max(3, dp(5.2) * scale),
    ringW: Math.max(1, dp(1.5) * scale),
    minWall,
  };
}

/** Paint a thumb into `ctx` with its top-left at (x, y). */
export function paintMazeThumb(
  ctx: CanvasRenderingContext2D,
  level: Level,
  x: number,
  y: number,
  w: number,
  h: number,
  o: MazeThumbOptions = {}
): void {
  const t = theme();
  const u = ui();
  const L = thumbLayout(level, w, h, o);
  const a = o.dim ? LOCKED_ALPHA : 1;
  ctx.save();
  ctx.translate(x, y);
  if (o.frame !== false) {
    const r = o.radius ?? dp(15);
    roundRectPath(ctx, 0, 0, w, h, r);
    ctx.fillStyle = hexCss(o.dim ? u.well : blendHex(t.board, u.skyEdge, 0.25));
    ctx.fill();
    // The rim: cream at 7 %, the mini board's lit edge.
    ctx.strokeStyle = rgba(u.glass, 0.07);
    ctx.lineWidth = 2;
    roundRectPath(ctx, 1, 1, w - 2, h - 2, Math.max(0, r - 1));
    ctx.stroke();
  }
  // The fold, a hairline.
  ctx.fillStyle = rgba(u.glass, 0.1 * a);
  ctx.fillRect(Math.round(L.axisX) - 0.5, L.inner.y, 1, L.inner.h);
  // Walls: opaque, pre-blended when dim — joints overlap on purpose, and a
  // translucent wall would stamp a darker patch on every one.
  ctx.fillStyle = hexCss(o.dim ? blendHex(t.wall, u.well, LOCKED_ALPHA) : t.wall);
  for (const wall of L.walls) {
    roundRectPath(ctx, wall.x, wall.y, wall.w, wall.h, wall.r);
    ctx.fill();
  }
  if (o.markers !== false) {
    const veil = rgba(u.glass, 0.28 * a);
    // Reflections first: rings and dots in veiled cream.
    ctx.strokeStyle = veil;
    ctx.lineWidth = L.ringW;
    ctx.beginPath();
    ctx.arc(L.mirrorGoal.x, L.mirrorGoal.y, L.ringR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = veil;
    disc(ctx, L.mirrorGoal.x, L.mirrorGoal.y, L.ringR * 0.3);
    disc(ctx, L.mirrorStart.x, L.mirrorStart.y, L.dotR);
    // The live pair in the accent.
    ctx.strokeStyle = rgba(t.accent, a);
    ctx.beginPath();
    ctx.arc(L.goal.x, L.goal.y, L.ringR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = rgba(t.accent, a);
    disc(ctx, L.goal.x, L.goal.y, L.ringR * 0.3);
    disc(ctx, L.start.x, L.start.y, L.dotR);
  }
  ctx.restore();
}

function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function blendHex(color: number, under: number, alpha: number): number {
  const mix = (s: number): number =>
    Math.round(((under >> s) & 0xff) + (((color >> s) & 0xff) - ((under >> s) & 0xff)) * alpha) & 0xff;
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

/* ------------------------------------------------------------------ cache */

/** The texture key for a level's thumb at a size and look. */
export function thumbKey(level: Level, w: number, h: number, o: MazeThumbOptions = {}): string {
  const flags = [o.dim ? 'd' : '', o.frame === false ? 'n' : '', o.markers === false ? 'm' : ''].join('');
  return `fw-thumb-${level.id}-${Math.round(w)}x${Math.round(h)}${flags ? `-${flags}` : ''}`;
}

/** Images holding each texture right now. */
const holders = new Map<string, number>();
/** Textures no Image holds, oldest first: kept for the next screen that asks. */
const idle: string[] = [];
/** How many unheld thumbs are kept. About two screens' worth of Next and Continue. */
export const THUMB_POOL = 24;

function hold(key: string): void {
  holders.set(key, (holders.get(key) ?? 0) + 1);
  const i = idle.indexOf(key);
  if (i >= 0) idle.splice(i, 1);
}

function release(scene: Phaser.Scene, key: string): void {
  const n = (holders.get(key) ?? 1) - 1;
  if (n > 0) {
    holders.set(key, n);
    return;
  }
  holders.delete(key);
  idle.push(key);
  while (idle.length > THUMB_POOL) {
    const old = idle.shift() as string;
    if (!holders.has(old) && scene.textures.exists(old)) scene.textures.remove(old);
  }
}

/**
 * The baked texture of a level's thumb, painted on first use. The caller that
 * takes the key without making an Image through `mazeThumb` owns it: nothing
 * counts it, and the pool may take it back.
 */
export function mazeThumbTexture(
  scene: Phaser.Scene,
  level: Level,
  w: number,
  h: number,
  o: MazeThumbOptions = {}
): string {
  const key = thumbKey(level, w, h, o);
  if (scene.textures.exists(key)) return key;
  const res = o.res ?? DEFAULT_RES;
  const tex = scene.textures.createCanvas(key, Math.ceil(w * res), Math.ceil(h * res));
  if (!tex) return '__MISSING';
  const ctx = tex.getContext();
  ctx.save();
  ctx.scale(res, res);
  paintMazeThumb(ctx, level, 0, 0, w, h, o);
  ctx.restore();
  tex.refresh();
  return key;
}

/**
 * SPEC's `MazeThumb(level, w, h)`: the level's thumb as an Image centred on
 * (x, y), `w` × `h` base units. Cached per level and size; the texture is
 * held while the Image lives.
 */
export function mazeThumb(
  scene: Phaser.Scene,
  x: number,
  y: number,
  level: Level,
  w: number,
  h: number,
  o: MazeThumbOptions = {}
): Phaser.GameObjects.Image {
  const key = mazeThumbTexture(scene, level, w, h, o);
  const res = o.res ?? DEFAULT_RES;
  const img = scene.add.image(x, y, key).setScale(1 / res);
  hold(key);
  img.once('destroy', () => release(scene, key));
  return img;
}

/** For tests: how many Images hold `key`, and whether it waits in the pool. */
export function thumbHolders(key: string): { held: number; pooled: boolean } {
  return { held: holders.get(key) ?? 0, pooled: idle.includes(key) };
}
