/**
 * Hit areas for containers that are built around their centre.
 *
 * Phaser hit-tests a Game Object by inverting its world transform and then
 * ADDING the display origin back — `InputManager.pointWithinHitArea` does
 * `x += gameObject.displayOriginX` before running the containment callback.
 * Hit areas are therefore authored in TOP-LEFT space, the same space as a
 * texture frame, no matter where the object's origin sits.
 *
 * Everything in this UI is drawn around its own centre (`-w/2, -h/2, w, h`), and
 * `setSize(w, h)` puts the display origin at `(w/2, h/2)`. Handing that same
 * visually obvious `(-w/2, -h/2, w, h)` rectangle to `setInteractive` therefore
 * subtracts the half-extent twice: the live area lands a half-width left and a
 * half-height up of the painted one, so only the top-left QUARTER of a button
 * responds — and its overhang silently steals taps from whatever sits above and
 * to the left of it.
 *
 * That is the bug behind "I have to tap Play two or three times to hit it".
 * Measured on the shipped build, the menu's Levels button responded on 10 of 45
 * probe points; with the rectangle below it responds on all of them.
 *
 * The maths is kept here, free of Phaser, so it can be proved in a unit test
 * rather than only in a browser.
 */

import { pt } from './Theme';

export interface HitRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The hit rectangle for a container of `w`×`h` whose art is centred on its
 * origin. Top-left space, because that is what Phaser normalizes into.
 */
export function centredHitArea(w: number, h: number): HitRect {
  return { x: 0, y: 0, width: w, height: h };
}

/** Apple's floor for anything a thumb has to hit, in points on the glass. */
export const MIN_TAP_PT = 44;

/**
 * Apple's floor in BASE units, for a canvas drawn at `basePerPoint` base units
 * to the point (Phaser's `scale.displayScale`; a CSS pixel is a point in the
 * app's web view).
 *
 * pt(44) is 44pt only while the canvas is drawn at 0.5. Since the canvas fits
 * inside the safe area, the SE's 20pt status bar draws it at 0.485, and every
 * control raised "to Apple's minimum" measured 42.7pt on the glass. So the
 * floor follows the live scale — but never drops below pt(44): a screen that
 * draws the canvas larger keeps the size the layout was designed around, and a
 * scale nobody can read (0, NaN, a canvas not laid out yet) falls back to it.
 * Rounded up to a whole base unit, so rounding never lands a hair short.
 */
export function tapFloor(basePerPoint: number): number {
  const design = pt(MIN_TAP_PT);
  if (!Number.isFinite(basePerPoint) || basePerPoint <= 0) return design;
  return Math.max(design, Math.ceil(MIN_TAP_PT * basePerPoint - 1e-9));
}

export interface FootSpec {
  /** Drawn height of the upper row. */
  readonly upper: number;
  /** Drawn height of the lower row. */
  readonly lower: number;
  /** The stack's gap between drawn rows — also the one over the upper row. */
  readonly gap: number;
  /** Clear space kept between the two tap areas, and over the upper one. */
  readonly air: number;
  /** How far the stack alone may start above its designed top. */
  readonly maxRise: number;
  /**
   * How far above its designed line the lower tap area must end: the banner
   * reaches higher up a canvas drawn smaller. Always honoured — see `stackFoot`.
   */
  readonly drop?: number;
  /**
   * How far the whole page — the stack and everything above it — may move up,
   * on top of `maxRise`, to make room the stack alone may not take.
   */
  readonly maxLift?: number;
}

export interface Foot {
  /** Tap height of both rows: the floor, or as much of it as there is room for. */
  readonly tap: number;
  /** Drawn gap between the two rows. */
  readonly gap: number;
  /** How far the stack starts above its designed top, relative to the page. */
  readonly rise: number;
  /** How far the whole page — the stack with it — moves up. */
  readonly lift: number;
}

/**
 * The foot of a stack — two short rows, drawn at their own height and tapped
 * at the thumb's floor. The menu's Store and Restore rows.
 *
 * They were placed for pt(44): the lower tap area ends exactly on the line the
 * stack must not pass (a 9:16 phone's banner) and the two areas sit `air`
 * apart. A higher floor has to find its room upward — the gap between the two
 * opens by what the floor needs, and the whole stack rises by that plus the
 * lower area's extra reach. A banner that reaches higher than that line
 * (`drop`) moves the stack up by the difference too.
 *
 * Upward is not free, which the first version of this missed. The stack
 * starts a few pixels under the menu's tagline, so in a split pane drawn at
 * 0.3 the rise put the primary button over the line the menu speaks from; and
 * since the stack rises as one, the upper area's reach into the row above
 * grows with the floor however far it rises. So the stack alone rises at most
 * `maxRise`; past that the whole page moves up with it (`lift`, at most
 * `maxLift`), which keeps every gap above the stack as designed; the upper
 * area stops `air` short of the row above; and past all of those the floor
 * gives way instead — a smaller tap area, never one that reaches a neighbour.
 *
 * The one limit that never gives way is `drop`. A tap area under the banner is
 * an ad tapped by accident, so when even pt(44) areas do not fit under the
 * caps, the page moves up past `maxLift` rather than leave the foot over the ad.
 */
export function stackFoot(floor: number, spec: FootSpec): Foot {
  const design = pt(MIN_TAP_PT);
  const { upper, lower, gap, air, maxRise } = spec;
  const drop = Math.max(0, spec.drop ?? 0);
  const maxLift = Math.max(0, spec.maxLift ?? 0);
  // Centres a tap area and `air` apart, never closer than the stack's own gap.
  const gapFor = (tap: number): number => Math.max(gap, tap + air - (upper + lower) / 2);
  const riseFor = (tap: number): number =>
    gapFor(tap) - gap + Math.max(0, tap - design) / 2 + drop;
  let tap = Math.min(Math.max(design, floor), upper + 2 * (gap - air));
  // Floors are whole base units (see `tapFloor`), so it gives way a unit at a time.
  while (tap > design && riseFor(tap) > maxRise + maxLift) {
    tap = Math.max(design, Math.ceil(tap) - 1);
  }
  const total = riseFor(tap);
  const rise = Math.min(total, maxRise);
  return { tap, gap: gapFor(tap), rise, lift: total - rise };
}

export interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** The rectangle the art actually occupies on screen. */
export function paintedBox(cx: number, cy: number, w: number, h: number): Box {
  return { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2 };
}

/**
 * The screen-space region a hit area really responds in, derived the way Phaser
 * derives it: local = point − centre, then += displayOrigin (w/2, h/2), then
 * tested against the hit rect.
 */
export function liveBox(hit: HitRect, cx: number, cy: number, w: number, h: number): Box {
  const originX = cx - w / 2;
  const originY = cy - h / 2;
  return {
    left: originX + hit.x,
    right: originX + hit.x + hit.width,
    top: originY + hit.y,
    bottom: originY + hit.y + hit.height,
  };
}

/** What `worldPoint` reads off a pointer: Phaser's Pointer has all four. */
export interface PointerLike {
  readonly x: number;
  readonly y: number;
  readonly worldX?: number;
  readonly worldY?: number;
}

/**
 * Where a pointer is in the WORLD the scene lays out in — the one question
 * every piece of pointer code asks, asked in one place.
 *
 * Today it is the pointer's own x/y: every camera sits at zoom 1 over a
 * 750-wide world drawn at 750 canvas pixels, so the canvas point IS the world
 * point. Rendering at device resolution (SPEC §6 stage 3, tech G14) makes the
 * game 750k wide with every camera at zoom k, and then the canvas point and
 * the world point part: this becomes `worldX/worldY` here, once, instead of at
 * thirty-three call sites. New pointer code goes through it from day one.
 */
export function worldPoint(p: PointerLike): { x: number; y: number } {
  return { x: p.x, y: p.y };
}
