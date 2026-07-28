/**
 * Playfield — the one place that converts normalized level space into pixels.
 *
 * Levels are authored in x,y ∈ [0,1] across the full playfield with the mirror
 * axis at x = 0.5 (see data/types.ts, LOCKED). Everything downstream —
 * collision, rendering, input — works in playfield pixels, so this conversion
 * happens exactly once, when a level loads.
 */

import { clamp, mirrorPoint, type Rect, type Vec2 } from './Geometry';

export interface Inset {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export class Playfield {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;

  constructor(canvasW: number, canvasH: number, inset: Inset) {
    this.x = inset.left;
    this.y = inset.top;
    this.w = canvasW - inset.left - inset.right;
    this.h = canvasH - inset.top - inset.bottom;
  }

  get right(): number {
    return this.x + this.w;
  }

  get bottom(): number {
    return this.y + this.h;
  }

  /** The mirror axis in pixels — normalized x = 0.5. */
  get axisX(): number {
    return this.x + this.w * 0.5;
  }

  /** Normalized point → playfield pixels. */
  toScreen(p: Vec2): Vec2 {
    return { x: this.x + p.x * this.w, y: this.y + p.y * this.h };
  }

  /**
   * Playfield pixels → normalized. The inverse of `toScreen`.
   *
   * Saved figures are stored normalized rather than in pixels so they survive a
   * change of device, of playfield inset, or of export size — a figure drawn on
   * a phone has to redraw correctly at 1080×1080 in a share card.
   */
  toNormalized(p: Vec2): Vec2 {
    return { x: (p.x - this.x) / this.w, y: (p.y - this.y) / this.h };
  }

  /** Normalized rect → playfield pixels. */
  toScreenRect(r: Rect): Rect {
    return {
      x: this.x + r.x * this.w,
      y: this.y + r.y * this.h,
      w: r.w * this.w,
      h: r.h * this.h,
    };
  }

  /** Reflect a pixel point across the mirror axis. */
  mirror(p: Vec2): Vec2 {
    return mirrorPoint(p, this.axisX);
  }

  /**
   * Confine a cursor to the drawable region: inside the playfield, and never
   * across the axis. Clamped, never rejected — the axis is a soft wall the
   * stroke can slide along but not pass (LOCKED).
   */
  clampToDrawable(p: Vec2): Vec2 {
    return {
      x: clamp(p.x, this.x, this.axisX),
      y: clamp(p.y, this.y, this.bottom),
    };
  }
}
