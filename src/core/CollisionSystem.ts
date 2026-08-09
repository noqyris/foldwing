/**
 * CollisionSystem — the stroke and its reflection, tested against every wall.
 *
 * One gesture has to satisfy two sets of constraints at once. Each new segment
 * is checked twice: once as drawn, once mirrored across the axis. Both are
 * tested against the FULL wall list — a left-hand segment cannot physically
 * reach a right-hand wall, so a single code path covers both halves without
 * anyone having to remember which walls belong to which side.
 *
 * Testing is CONTINUOUS along the segment (LOCKED). Pointer samples arrive one
 * per frame at best; during a fast flick consecutive samples can be hundreds of
 * pixels apart, and anything that only inspected the samples themselves would
 * let the stroke tunnel straight through a wall.
 */

import {
  mirrorPoint,
  segRect,
  segRectEntryT,
  type Rect,
  type Vec2,
} from './Geometry';

export class CollisionSystem {
  /**
   * @param walls     wall rects in playfield pixels, both halves
   * @param hitRadius stroke collision radius — smaller than the rendered nib
   * @param axisX     the mirror axis, in playfield pixels
   */
  constructor(
    private readonly walls: readonly Rect[],
    private readonly hitRadius: number,
    private readonly axisX: number
  ) {}

  /** Does the segment a→b, or its mirror, touch any wall? */
  blocks(a: Vec2, b: Vec2): boolean {
    if (this.sideBlocked(a, b)) return true;
    return this.sideBlocked(
      mirrorPoint(a, this.axisX),
      mirrorPoint(b, this.axisX)
    );
  }

  /**
   * Where along a→b the first contact happens, as t ∈ [0,1], or null if the
   * segment is clear.
   *
   * Reflection is an isometry that preserves a segment's parameterisation, so a
   * t measured on the mirrored segment refers to the same instant of the
   * player's gesture as one measured on the original. That is what makes the
   * two sides directly comparable, and what lets the caller decide whether a
   * wall or the goal came first when a single long segment reaches both.
   */
  firstHitT(a: Vec2, b: Vec2): number | null {
    return this.firstHit(a, b)?.t ?? null;
  }

  /**
   * Like firstHitT, but says WHICH stroke died: the one the player draws, or
   * its reflection. The distinction is the game's own skill axis — a mirror
   * death means the half they were not looking at killed them — and it is
   * what Fold Sense measures.
   */
  firstHit(a: Vec2, b: Vec2): { t: number; mirror: boolean } | null {
    const ma = mirrorPoint(a, this.axisX);
    const mb = mirrorPoint(b, this.axisX);

    let earliest: { t: number; mirror: boolean } | null = null;

    for (const wall of this.walls) {
      const own = segRectEntryT(a, b, wall, this.hitRadius);
      if (own !== null && (earliest === null || own < earliest.t)) {
        earliest = { t: own, mirror: false };
      }

      const reflected = segRectEntryT(ma, mb, wall, this.hitRadius);
      if (reflected !== null && (earliest === null || reflected < earliest.t)) {
        earliest = { t: reflected, mirror: true };
      }
    }

    return earliest;
  }

  private sideBlocked(a: Vec2, b: Vec2): boolean {
    for (const wall of this.walls) {
      if (segRect(a, b, wall, this.hitRadius)) return true;
    }
    return false;
  }
}
