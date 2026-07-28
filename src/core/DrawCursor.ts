/**
 * DrawCursor — where the ink goes, given where the finger is.
 *
 * On touch the drawing cursor sits ABOVE the finger so the thumb never covers
 * the live end of the stroke. On a mouse there is no offset at all: nothing is
 * covering anything, and lifting the cursor away from the pointer would just
 * feel broken.
 *
 * The offset eases in, because applying it whole at pointerdown would teleport
 * the cursor 42pt the instant you touched down. The ease is driven by how far
 * the FINGER HAS TRAVELLED, never by elapsed time. That distinction is the
 * whole point of this file: a time-based ease keeps moving the cursor while the
 * finger is still, so the game draws — and collision-tests — ink the player
 * never asked for. Gate it on travel and a motionless finger produces a
 * motionless cursor, which is the only honest behaviour when every pixel of the
 * stroke is being tested against a wall.
 *
 * Kept pure, with no Phaser and no clock, so the offset — the whole of the
 * "finger never covers the cursor" acceptance criterion — is testable.
 */

import { clamp, type Vec2 } from './Geometry';

export interface CursorOptions {
  /** True for touch/pen, false for mouse. */
  readonly touch: boolean;
  /** Straight-line distance from where this stroke's finger first landed. */
  readonly travelPx: number;
  /** How far above the finger the cursor settles, in pixels. */
  readonly offsetY: number;
  /** Finger travel over which the offset eases from nothing to full. */
  readonly rampPx: number;
}

export function drawCursor(raw: Vec2, opts: CursorOptions): Vec2 {
  if (!opts.touch) return { x: raw.x, y: raw.y };

  const ramp = opts.rampPx <= 0 ? 1 : clamp(opts.travelPx / opts.rampPx, 0, 1);
  return { x: raw.x, y: raw.y - opts.offsetY * ramp };
}
