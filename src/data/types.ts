/**
 * Level authoring types.
 *
 * COORDINATE SYSTEM — LOCKED.
 * Levels are authored in normalized coordinates across the FULL playfield:
 * x ∈ [0,1] spans the entire width, y ∈ [0,1] the entire height, y growing
 * downward. The mirror axis is x = 0.5.
 *
 *   - The player may only draw where x < 0.5. The axis is a soft wall: the
 *     stroke is clamped to it and can slide along it, but never crosses.
 *   - mirror(p) = { x: 1 - p.x, y: p.y }
 *   - `start` and `goal` are always authored with x < 0.5. Their mirrors are
 *     drawn on the right at reduced opacity — they are reflections, not second
 *     targets you can reach.
 *
 * A wall authored on the right at x ∈ [a,b] constrains the player on the left
 * to avoid x ∈ [1-b, 1-a] at the same y. That projection is the entire game.
 */
export type { Rect, Vec2 } from '../core/Geometry';

import type { Rect, Vec2 } from '../core/Geometry';

export interface Level {
  readonly id: string;
  readonly name: string;
  /** Normalized, x < 0.5. */
  readonly start: Vec2;
  /** Normalized, x < 0.5. */
  readonly goal: Vec2;
  /** Normalized, full-playfield coords. Asymmetric by design — LOCKED. */
  readonly walls: readonly Rect[];
  /** Target completion time, for a later "par" display. Not used yet. */
  readonly parMs?: number;
  /**
   * Arc length of the validator's proved route, in base pixels — the par a
   * winning line is measured against. Generated levels carry it precomputed;
   * for hand-authored ones it is computed on first win.
   */
  readonly parPx?: number;
}
