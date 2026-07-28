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
