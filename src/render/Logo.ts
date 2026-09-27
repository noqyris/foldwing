/**
 * Logo — the stacked lockup: the icon's mark above the "foldwing" wordmark.
 *
 * The mark is the App Store icon's own line, traced (logo/A-stacked,
 * mark-game.svg): a path down one side of the fold and its reflection, each
 * starting from a dot, drawn as ONE uniform round-capped stroke — not a
 * Ribbon: the icon's line has no pressure, and the logo must match the icon
 * the player just tapped.
 *
 * At night the line is the player's line — tangerine, with its hot core and
 * the same baked bloom passes the board's ink uses — and the reflection is
 * moonlight (owner, 2026-09-27). The mirrored wordmark of 1.4 is retired: the
 * mark already shows the mirror.
 *
 * One Canvas2D texture per lockup, painted from polylines flattened here (the
 * same flattening as the icons), so the settled mark and every frame of its
 * draw-in are the same geometry. A draw-in repaints the texture for under a
 * second; settled, it is a plain Image and costs one draw call.
 */

import Phaser from 'phaser';
import type { Vec2 } from '../core/Geometry';
import { flattenPath } from './Icons';
import { dp, FONT_DISPLAY, hexCss, motionReduced, ms, rgba, theme, ui, veiledInk } from './Theme';

/* -------------------------------------------------------------- geometry */

/** The mark's own box, in the 1024-px icon's pixels (mark-game.svg's viewBox). */
export const MARK_BOX = { x: 126, y: 103, w: 772, h: 857.5 } as const;
/** The icon's line width and start-dot radius, icon px. */
export const MARK_LINE = 94;
export const MARK_DOT = 80;
/** The fold axis: the mirror is x' = 2·512 − x. */
export const MARK_AXIS = 512;

/**
 * The player's side, drawn the way it is drawn in play: FROM the start dot
 * (206, 880.5) up to the top cap (206, 150). The svg runs cap to dot; this is
 * its exact reverse (each arc's sweep flipped), so a draw-in leaves the dot.
 */
const LINE_D =
  'M206 880.5 V736 A95 95 0 0 1 301 641 H330 A100 100 0 0 0 430 541 V483 A100 100 0 0 0 330 383 H301 A95 95 0 0 1 206 288 V150';

let flatLine: Vec2[] | null = null;

/** The line's centreline, dot to cap, in icon px. */
export function markLine(): Vec2[] {
  if (!flatLine) flatLine = flattenPath(LINE_D)[0].points;
  return flatLine;
}

/** The reflection's centreline, dot to cap: the line mirrored in the fold. */
export function markMirror(): Vec2[] {
  return markLine().map((p) => ({ x: 2 * MARK_AXIS - p.x, y: p.y }));
}

/** The width a mark `h` base units tall takes. */
export function markWidth(h: number): number {
  return (h * MARK_BOX.w) / MARK_BOX.h;
}

/** A polyline's length. */
export function polyLength(pts: readonly Vec2[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return s;
}

/** The first `frac` of a polyline, by length: the part of the line a draw-in has laid down. */
export function partialLine(pts: readonly Vec2[], frac: number): Vec2[] {
  if (frac >= 1) return pts.slice();
  if (!(frac > 0) || pts.length === 0) return pts.length ? [pts[0]] : [];
  const want = polyLength(pts) * frac;
  const out: Vec2[] = [pts[0]];
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (s + d >= want) {
      const t = d > 0 ? (want - s) / d : 0;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      return out;
    }
    s += d;
    out.push(b);
  }
  return out;
}

/* ------------------------------------------------------------------ paint */

export interface MarkColors {
  /** The player's line and its start dot. */
  line: number;
  /** The hot core down the line's middle, or null for none. */
  core: number | null;
  /** The reflection and its dot. */
  mirror: number;
}

/** The mark in the theme's colours: the line, its core, moonlight. */
export function markColors(): MarkColors {
  const t = theme();
  return { line: t.line, core: t.lineCore, mirror: t.mirror ?? veiledInk(t.line, t) };
}

/** How far each track has come, 0..1, and each dot's scale. */
export interface MarkProgress {
  line: number;
  mirror: number;
  lineDot: number;
  mirrorDot: number;
}

export const SETTLED: MarkProgress = { line: 1, mirror: 1, lineDot: 1, mirrorDot: 1 };

/** The room the glow needs past the mark's own box, in icon px. */
export function markBleed(): number {
  // The glow's Gaussian is gone by about three sigma past the line.
  return LINE_GLOW * 3 + 8;
}

/**
 * The lamp's glow round the line, as a Gaussian's sigma in icon px: about
 * half the line's width, so it reads as light around the line, not a halo
 * drawn beside it.
 */
const LINE_GLOW = 44;

/**
 * Paint the mark into `ctx` with its box's top-left at (x, y), `h` pixels
 * tall. The reflection first, so the player's line is the top layer, as in
 * the game. Used by the lockup's texture and by the launch image.
 */
export function paintMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  p: MarkProgress = SETTLED,
  c: MarkColors = markColors()
): void {
  const k = h / MARK_BOX.h;
  const t = theme();
  ctx.save();
  ctx.translate(x - MARK_BOX.x * k, y - MARK_BOX.y * k);
  ctx.scale(k, k);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const stroke = (pts: readonly Vec2[], color: number, alpha: number, width: number): void => {
    if (pts.length < 2) return;
    ctx.strokeStyle = rgba(color, alpha);
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  };
  const disc = (cx: number, cy: number, r: number, color: number, alpha: number): void => {
    if (!(r > 0)) return;
    ctx.fillStyle = rgba(color, alpha);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const dotY = markLine()[0].y;
  const lineX = markLine()[0].x;
  const mirrorX = 2 * MARK_AXIS - lineX;
  /*
   * A soft glow: the shape drawn far off the canvas with its SHADOW thrown
   * back onto it, so only the blur lands. A shadow's blur and offset are in
   * canvas pixels, untouched by the transform, hence the `px` scale.
   */
  const px = h / MARK_BOX.h;
  const AWAY = 20000;
  const glow = (pts: readonly Vec2[], dotX: number, dotR: number, color: number, alpha: number, sigma: number): void => {
    if (pts.length < 2 && !(dotR > 0)) return;
    ctx.save();
    ctx.shadowColor = rgba(color, alpha);
    ctx.shadowBlur = sigma * 2 * px;
    ctx.shadowOffsetX = AWAY * px;
    ctx.translate(-AWAY, 0);
    stroke(pts, color, 1, MARK_LINE);
    disc(dotX, dotY, dotR, color, 1);
    ctx.restore();
  };

  // The reflection: moonlight, one opaque pass, a faint cool glow under it.
  const mirror = partialLine(markMirror(), p.mirror);
  glow(mirror, mirrorX, MARK_DOT * p.mirrorDot, c.mirror, 0.25, 24);
  stroke(mirror, c.mirror, 1, MARK_LINE);
  disc(mirrorX, dotY, MARK_DOT * p.mirrorDot, c.mirror, 1);

  // The line: the lamp's glow round it, the line, its hot core — the light the
  // player draws with, and the logo's line the same.
  const line = partialLine(markLine(), p.line);
  glow(line, lineX, MARK_DOT * p.lineDot, c.line, 0.75, LINE_GLOW);
  stroke(line, c.line, 1, MARK_LINE);
  disc(lineX, dotY, MARK_DOT * p.lineDot, c.line, 1);
  if (c.core !== null) {
    stroke(line, c.core, 0.85, MARK_LINE * t.lineCoreWidth);
  }
  // The start dot's highlight, top-left, as the dot in play has.
  if (p.lineDot > 0.5) {
    disc(lineX - 24, dotY - 26, 22 * p.lineDot, 0xffffff, 0.4);
  }
  ctx.restore();
}

/* ---------------------------------------------------------------- lockup */

export interface LogoOptions {
  /** The mark's height, base units. B: 66 pt. */
  markH?: number;
  /** The wordmark's size, base units, or 0 for the mark alone. B: Georgia 46 pt. */
  wordSize?: number;
  /** From the mark's bottom to the wordmark's top, base units. */
  gap?: number;
  /** Override the mark's colours. */
  colors?: Partial<MarkColors>;
  /** The wordmark's colour. Default: the text colour. */
  wordColor?: number;
}

export interface Logo {
  /** Holds the mark and the wordmark; its origin is the lockup's top-centre. */
  readonly container: Phaser.GameObjects.Container;
  readonly mark: Phaser.GameObjects.Image;
  readonly word: Phaser.GameObjects.Text | null;
  /** The mark's height and width, base units. */
  readonly markH: number;
  readonly markW: number;
  /** From the lockup's top to the wordmark's bottom (the mark's bottom without one). */
  readonly height: number;
  /** The wordmark's top and bottom, relative to the lockup's top. */
  readonly wordTop: number;
  readonly wordBottom: number;
  /**
   * Draw the mark in, as the icon's line is drawn: the dot lands, the line
   * leaves it for the cap, its reflection follows 130 ms behind. About a
   * second; a tap should call `settle`. Under reduced motion it does not
   * run: the mark is shown settled and `onComplete` comes at once.
   */
  drawIn(o?: { delay?: number; onComplete?: () => void }): void;
  /** Jump a draw-in to its end. A no-op when there is none. */
  settle(): void;
  readonly drawing: boolean;
  destroy(): void;
}

/** Pixels per base unit in the mark's texture: sharp at the 1.6× every iPhone draws the canvas at. */
const MARK_RES = 2;

let logoSeq = 0;

/**
 * The draw-in timeline (logo/A-stacked, as prototyped), ms from the start:
 * each track's window and its easing.
 */
export const DRAW_IN = {
  lineDot: [0, 220],
  mirrorDot: [110, 330],
  line: [60, 780],
  mirror: [190, 910],
  total: 960,
} as const;

/** Where every track of the draw-in is at `ms` into it. Pure, for the test and the frames. */
export function drawInAt(at: number): MarkProgress {
  const win = (w: readonly [number, number]): number => Math.min(1, Math.max(0, (at - w[0]) / (w[1] - w[0])));
  const sine = (u: number): number => (1 - Math.cos(Math.PI * u)) / 2;
  // Back.out on the dots: 0.55 → 1, with the overshoot the stamp wants.
  const back = (u: number): number => {
    const s = 1.70158;
    const v = u - 1;
    return v * v * ((s + 1) * v + s) + 1;
  };
  const dot = (u: number): number => (u <= 0 ? 0.55 : 0.55 + 0.45 * back(u));
  return {
    lineDot: at <= 0 ? 0.55 : dot(win(DRAW_IN.lineDot)),
    mirrorDot: at < DRAW_IN.mirrorDot[0] ? 0 : dot(win(DRAW_IN.mirrorDot)),
    line: sine(win(DRAW_IN.line)),
    mirror: sine(win(DRAW_IN.mirror)),
  };
}

/**
 * The stacked lockup, its top-centre at (x, y).
 *
 * The container holds the mark and the wordmark; the tagline and the lamp are
 * the Menu's (it owns the layout they sit in). The mark's texture is this
 * lockup's own and goes with it.
 */
export function logo(scene: Phaser.Scene, x: number, y: number, o: LogoOptions = {}): Logo {
  const markH = Math.round(o.markH ?? dp(66));
  const markW = markWidth(markH);
  const wordSize = o.wordSize ?? dp(46);
  const gap = o.gap ?? dp(14);
  const colors: MarkColors = { ...markColors(), ...o.colors };

  const k = markH / MARK_BOX.h;
  const bleed = Math.ceil(markBleed() * k) + 2;
  const texW = Math.ceil((markW + bleed * 2) * MARK_RES);
  const texH = Math.ceil((markH + bleed * 2) * MARK_RES);
  const key = `fw-logo-${++logoSeq}`;
  const tex = scene.textures.createCanvas(key, texW, texH);
  const paint = (p: MarkProgress): void => {
    if (!tex) return;
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, texW, texH);
    paintMark(ctx, bleed * MARK_RES, bleed * MARK_RES, markH * MARK_RES, p, colors);
    tex.refresh();
  };
  paint(SETTLED);

  const container = scene.add.container(x, y);
  const mark = scene.add
    .image(0, markH / 2, tex ? key : '__MISSING')
    .setScale(1 / MARK_RES);
  container.add(mark);

  let word: Phaser.GameObjects.Text | null = null;
  let wordTop = markH;
  let wordBottom = markH;
  if (wordSize > 0) {
    word = scene.add
      .text(0, markH + gap, 'foldwing', {
        fontFamily: FONT_DISPLAY,
        fontSize: `${Math.round(wordSize)}px`,
        color: hexCss(o.wordColor ?? ui().text),
      })
      .setOrigin(0.5, 0);
    word.setLetterSpacing(-Math.max(0, Math.round(dp(0.3))));
    container.add(word);
    wordTop = markH + gap;
    wordBottom = wordTop + word.height;
  }

  let tween: Phaser.Tweens.Tween | null = null;
  let done: (() => void) | undefined;
  const finish = (): void => {
    tween = null;
    paint(SETTLED);
    const cb = done;
    done = undefined;
    cb?.();
  };

  const self: Logo = {
    container,
    mark,
    word,
    markH,
    markW,
    height: wordBottom,
    wordTop,
    wordBottom,
    get drawing() {
      return tween !== null;
    },
    drawIn(opts = {}) {
      tween?.stop();
      tween = null;
      done = opts.onComplete;
      if (motionReduced()) {
        finish();
        return;
      }
      paint(drawInAt(0));
      const clock = { at: 0 };
      tween = scene.tweens.add({
        targets: clock,
        at: DRAW_IN.total,
        delay: opts.delay ?? 0,
        duration: ms(DRAW_IN.total),
        ease: 'Linear',
        onUpdate: () => {
          if (container.scene) paint(drawInAt(clock.at));
        },
        onComplete: () => {
          if (container.scene) finish();
        },
      });
    },
    settle() {
      if (!tween) return;
      tween.stop();
      finish();
    },
    destroy() {
      container.destroy(true);
    },
  };

  container.once(Phaser.GameObjects.Events.DESTROY, () => {
    tween?.stop();
    tween = null;
    done = undefined;
    // The texture is this lockup's alone: it goes with it.
    if (scene.textures.exists(key)) scene.textures.remove(key);
  });
  return self;
}

/**
 * A duration for the lockup's draw-in, through `ms()`: what a caller holding
 * its own moments back (the day's gift toast) should wait.
 */
export function drawInMs(): number {
  return motionReduced() ? 0 : ms(DRAW_IN.total);
}
