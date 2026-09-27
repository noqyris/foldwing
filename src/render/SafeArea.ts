/**
 * SafeArea — the part of the phone's safe-area insets that the canvas does not
 * already keep clear, in BASE units.
 *
 * The page runs edge to edge (`viewport-fit=cover`, Capacitor's contentInset
 * 'never'), so `env(safe-area-inset-*)` is the only thing that knows where the
 * status bar, the notch and the home indicator are. Scale.FIT then letterboxes
 * the 750×1334 canvas, and on a tall phone that letterbox is already taller
 * than the status bar: the canvas starts below it and nothing needs to move.
 * On a 9:16 phone — the iPhone SE — there is no letterbox. The canvas top IS the
 * screen top, and a HUD row drawn at pt(26) sits under the clock and the
 * battery.
 *
 * So the answer is per side and net of the letterbox: how far into the canvas
 * each inset still reaches. Every side is measured on its own. A screen whose
 * insets differ left to right — a foldable's hinge, a camera cut into one edge,
 * a notch in landscape — must not be made symmetric by assumption.
 *
 * Since index.html fits #app into the safe area itself (iPhone Duo puts an
 * 84pt status bar down one side, which no in-canvas offset can absorb), the
 * canvas never reaches under an inset any more and every side answers 0 on
 * every iPhone and Duo shape. The measurement stays: it is what proves that,
 * and it is net of the canvas's real position — never the raw env() values,
 * which would count every inset twice now that the page already clears it.
 *
 * The maths is kept free of the DOM and of Phaser, so it can be proved in a unit
 * test; `canvasInsets` and `canvasPaper` are the calls that read the page.
 *
 * The world's height is no longer fixed (Theme.adaptiveHeight): on a tall phone
 * the canvas fills the safe area outright, top to bottom, and the letterbox
 * this file used to reason about is gone there. Every function that turns CSS
 * px into base units takes the height it should use — the current one,
 * Theme.viewHeight(), from every live caller.
 */

import { adaptiveHeight, BASE_HEIGHT, BASE_WIDTH } from './Theme';

export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** A box on the page, in CSS px — what getBoundingClientRect reports. */
export interface CanvasBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

const positive = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0);

/**
 * How far past the safe rectangle `safe` the canvas at `canvas` reaches, per
 * side, in the canvas's own base units: max(0, safe edge − canvas edge) on each
 * side. Both boxes in CSS px. `baseHeight` defaults to the uniform scale FIT
 * gives, so a caller with only the width gets the same answer.
 */
export function insetsFrom(
  safe: CanvasBox,
  canvas: CanvasBox,
  baseWidth: number,
  baseHeight?: number
): Insets {
  if (!(canvas.width > 0) || !(canvas.height > 0)) return NO_INSETS;
  const perCssX = baseWidth / canvas.width;
  const perCssY = baseHeight === undefined ? perCssX : baseHeight / canvas.height;
  return {
    top: positive(safe.top - canvas.top) * perCssY,
    right: positive(canvas.left + canvas.width - (safe.left + safe.width)) * perCssX,
    bottom: positive(canvas.top + canvas.height - (safe.top + safe.height)) * perCssY,
    left: positive(safe.left - canvas.left) * perCssX,
  };
}

/**
 * The paper INSIDE the safe rectangle around the canvas, per side, in base
 * units — the room a wide layout could use beside the board (the inner display
 * of an iPhone Duo held wide has more of it than board). The mirror of
 * `insetsFrom`: max(0, canvas edge − safe edge).
 */
export function paperAround(safe: CanvasBox, canvas: CanvasBox, baseWidth: number): Insets {
  if (!(canvas.width > 0) || !(canvas.height > 0)) return NO_INSETS;
  const perCss = baseWidth / canvas.width;
  return {
    top: positive(canvas.top - safe.top) * perCss,
    right: positive(safe.left + safe.width - (canvas.left + canvas.width)) * perCss,
    bottom: positive(safe.top + safe.height - (canvas.top + canvas.height)) * perCss,
    left: positive(canvas.left - safe.left) * perCss,
  };
}

/**
 * The native banner: a fixed 320×50 view pinned to the safe-area bottom
 * (providers/levelplay.ts asks for `BANNER`, never adaptive), so its height is
 * 50 points on every phone. The mock draws the same 50 CSS px.
 */
export const BANNER_PT = 50;

/**
 * Air, in points on the glass, that every tap area keeps above the banner. A
 * tap area that ends exactly where the ad begins shares an edge with it: the
 * thumb that just misses the control lands on the ad.
 */
export const BANNER_AIR_PT = 1;

/**
 * How far up the canvas the banner reaches, in the canvas's base units,
 * measured from its bottom edge: the banner's height less the paper between
 * the canvas and the safe-area bottom, at the scale the canvas is drawn. Zero
 * or less when the banner lies wholly in the letterbox below.
 *
 * The banner is a fixed height in POINTS, so the base units it covers grow as
 * the canvas is drawn smaller: 100 at 0.5, 103 on the SE (0.485), 122 on an
 * SE with Display Zoom (0.41). A strip reserved in base units covers it at one
 * scale only — which is how Restore's tap area ended 11 base px under the ad
 * on a zoomed SE.
 */
export function bannerReach(
  safe: CanvasBox,
  canvas: CanvasBox,
  baseWidth: number,
  bannerPt: number = BANNER_PT
): number {
  if (!(canvas.width > 0) || !(canvas.height > 0)) return Number.NaN;
  const perCss = baseWidth / canvas.width;
  const paperBelow = safe.top + safe.height - (canvas.top + canvas.height);
  return (bannerPt - paperBelow) * perCss;
}

/**
 * The canvas Scale.FIT makes of `box`: uniformly scaled to fit, centred
 * (CENTER_BOTH). The model main.ts plans with before Phaser has moved anything.
 */
export function fitCanvas(box: CanvasBox, baseWidth: number, baseHeight: number): CanvasBox {
  if (!(box.width > 0) || !(box.height > 0)) return { left: box.left, top: box.top, width: 0, height: 0 };
  const k = Math.min(box.width / baseWidth, box.height / baseHeight);
  const width = baseWidth * k;
  const height = baseHeight * k;
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
}

/**
 * How far to lift the canvas off the safe-area bottom, in points, so the
 * banner never reaches onto it.
 *
 * `reserve` (METRICS.bannerReserve, base units) keeps the bottom of the canvas
 * clear for the banner, and covers it, with `airPt` to spare, whenever the
 * canvas is drawn at 0.44 or more — every iPhone and every iPhone Duo shape
 * except an SE with Display Zoom and a short Split View pane. Below that the
 * banner would reach past the reserve, toward the board — over the start dot,
 * on every maze, which is an ad placed where a finger is about to land — so
 * the canvas is lifted by the shortfall instead. Zero everywhere else;
 * index.html adds it to #app's bottom.
 *
 * The air is part of the target: stopping within half a point of the reserve
 * and rounding could leave the banner a fraction of a point INSIDE the strip
 * the scenes had drawn up to. Whole points, rounded up.
 */
export function bannerLift(
  safe: ViewportSize | null,
  reserve: number,
  baseWidth: number,
  baseHeight: number,
  bannerPt: number = BANNER_PT,
  airPt: number = BANNER_AIR_PT
): number {
  if (!safe || !(safe.width > 0) || !(safe.height > 0)) return 0;
  let lift = 0;
  // Lifting shrinks the canvas, which shrinks the reserve with it: converge.
  // Each step closes all but a few percent of the gap, so eight is plenty.
  for (let i = 0; i < 8; i++) {
    const h = safe.height - lift;
    if (!(h > 0)) break;
    const k = Math.min(safe.width / baseWidth, h / baseHeight);
    const paperBelow = lift + (h - baseHeight * k) / 2;
    const short = bannerPt + airPt - (paperBelow + reserve * k);
    if (short <= 0.01) break;
    lift += short;
  }
  return Math.ceil(lift);
}

/** The world main.ts builds for a safe area: how tall, and how far #app is lifted off the banner. */
export interface GameShape {
  /** The logical height (Theme.adaptiveHeight of the box #app is left). */
  readonly height: number;
  /** Points added to #app's bottom inset — see `bannerLift`. */
  readonly lift: number;
}

/**
 * The adaptive height and the banner lift, decided together: each moves the
 * other. The height fills the box #app is left once lifted; the lift is
 * whatever that canvas still needs for the banner and its air to sit inside
 * the reserve. The least whole-point lift that does it, found by walking up
 * from zero — the clearance only grows with the lift — which is `bannerLift`
 * exactly wherever the height stays at BASE_HEIGHT (every 9:16-or-wider
 * shape), and on a tall one the lift a canvas that fills the box needs.
 *
 * On a tall phone that fills its safe area the canvas bottom IS the safe
 * bottom, so the banner always covers its bottom 50pt: the reserve holds it
 * whenever the canvas is drawn at 0.44 or more, i.e. a safe area at least
 * 330pt wide — every iPhone. The 320pt Split View pane is the one tall shape
 * that is lifted, by a couple of points.
 */
export function fitShape(
  safe: ViewportSize | null,
  reserve: number,
  baseWidth: number = BASE_WIDTH,
  bannerPt: number = BANNER_PT,
  airPt: number = BANNER_AIR_PT
): GameShape {
  if (!safe || !(safe.width > 0) || !(safe.height > 0)) return { height: BASE_HEIGHT, lift: 0 };
  const need = bannerPt + airPt - 0.01;
  const most = Math.ceil(safe.height);
  for (let lift = 0; lift < most; lift++) {
    const box = safe.height - lift;
    const height = adaptiveHeight(safe.width, box);
    const k = Math.min(safe.width / baseWidth, box / height);
    const below = lift + (box - height * k) / 2;
    if (below + reserve * k >= need) return { height, lift };
  }
  return { height: BASE_HEIGHT, lift: 0 };
}

/**
 * "Desk" mode (index.html, html[data-desk]): when the board has at least this
 * much paper on EACH side, in points, the page around it turns desk-coloured
 * and the canvas gets a shadow, so a narrow board in a wide window reads as a
 * sheet on a desk rather than a strip lost in blank paper — the HIG's "artwork
 * in the padding" at CSS cost. iPhone Duo's inner display, held either way.
 */
export const DESK_MIN_PT = 40;

/** Paper beside the fitted canvas, per side, in points, after a `lift`. */
export function sidePaperPt(
  safe: ViewportSize,
  lift: number,
  baseWidth: number,
  baseHeight: number
): { left: number; right: number } {
  const box: CanvasBox = { left: 0, top: 0, width: safe.width, height: safe.height - Math.max(0, lift) };
  const canvas = fitCanvas(box, baseWidth, baseHeight);
  if (!(canvas.width > 0)) return { left: 0, right: 0 };
  // paperAround answers in base units; the canvas's CSS width per base unit
  // turns that back into points.
  const room = paperAround(box, canvas, baseWidth);
  const perBase = canvas.width / baseWidth;
  return { left: room.left * perBase, right: room.right * perBase };
}

export function wantsDesk(safe: ViewportSize | null, lift: number, baseWidth: number, baseHeight: number): boolean {
  if (!safe) return false;
  const p = sidePaperPt(safe, lift, baseWidth, baseHeight);
  return Math.min(p.left, p.right) >= DESK_MIN_PT;
}

/**
 * The same rule, from the four insets and the viewport rather than a safe
 * rectangle: the letterbox on each side pays for its inset first; only what is
 * left over is the canvas's problem.
 */
export function uncoveredInsets(
  safe: Insets,
  canvas: CanvasBox,
  viewport: ViewportSize,
  baseWidth: number,
  baseHeight: number
): Insets {
  const top = positive(safe.top);
  const left = positive(safe.left);
  return insetsFrom(
    {
      left,
      top,
      width: viewport.width - left - positive(safe.right),
      height: viewport.height - top - positive(safe.bottom),
    },
    canvas,
    baseWidth,
    baseHeight
  );
}

/*
 * DEV: pretend insets, for a browser that has none.
 *
 * Desktop Chrome reports every env(safe-area-inset-*) as zero, so the Duo's
 * side strip and every other asymmetric shape could only be tested on glass.
 * `?safe=t,r,b,l` (points) sets these variables on <html>; index.html's #app
 * and the safe box below read `var(--fw-safe-top, env(safe-area-inset-top))`
 * and so on, and follow them. main.ts calls this only under
 * `import.meta.env.DEV`, so on a device the variables never exist and every
 * side is its env() value, exactly as before.
 */
export const SAFE_VARS = {
  top: '--fw-safe-top',
  right: '--fw-safe-right',
  bottom: '--fw-safe-bottom',
  left: '--fw-safe-left',
} as const;

/** "0,84,34,0" → the four insets; anything else → null. */
export function parseSafeParam(v: string | null | undefined): Insets | null {
  if (!v) return null;
  const parts = v.split(',').map((s) => s.trim());
  if (parts.length !== 4 || parts.some((s) => s === '')) return null;
  const n = parts.map(Number);
  if (n.some((x) => !Number.isFinite(x) || x < 0)) return null;
  return { top: n[0], right: n[1], bottom: n[2], left: n[3] };
}

export function applySafeOverride(insets: Insets | null, root: HTMLElement = document.documentElement): void {
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    if (insets) root.style.setProperty(SAFE_VARS[side], `${insets[side]}px`);
    else root.style.removeProperty(SAFE_VARS[side]);
  }
}

const insetCss = (side: keyof typeof SAFE_VARS): string =>
  `${side}:var(${SAFE_VARS[side]},env(safe-area-inset-${side},0px))`;

let box: HTMLElement | null = null;

/**
 * The safe area as an element: fixed, inset by `env(safe-area-inset-*)` on all
 * four sides (or the DEV override above), invisible and untouchable. #app is
 * inset by the same values, so this box is exactly where the game may draw.
 *
 * One element, shared: main.ts watches it with a ResizeObserver — the insets
 * can change with no window resize (a fold settling, Split View, the status bar
 * moving sides) — and the measurements below read it. Created on first use and
 * kept; reading it is one style lookup.
 */
export function safeAreaBox(): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (!box || !box.isConnected) {
    box = document.createElement('div');
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText = [
      'position:fixed',
      'visibility:hidden',
      'pointer-events:none',
      insetCss('top'),
      insetCss('right'),
      insetCss('bottom'),
      insetCss('left'),
    ].join(';');
    document.body.appendChild(box);
  }
  return box;
}

/**
 * `env(safe-area-inset-*)` in CSS px, as the engine resolves it right now.
 *
 * Read as the safe box's computed offsets: for a positioned element those are
 * always resolved lengths, in every engine, where a custom property holding
 * env() may come back as the unresolved text.
 */
export function measureSafeInsets(): Insets {
  const el = safeAreaBox();
  if (!el) return NO_INSETS;
  const style = getComputedStyle(el);
  const px = (v: string): number => positive(Number.parseFloat(v));
  return {
    top: px(style.top),
    right: px(style.right),
    bottom: px(style.bottom),
    left: px(style.left),
  };
}

/** The safe rectangle on the page, in CSS px; null outside a browser. */
export function safeAreaRect(): CanvasBox | null {
  const el = safeAreaBox();
  return el ? el.getBoundingClientRect() : null;
}

/**
 * The canvas's uncovered insets right now, in base units. Measured on every
 * call, so a caller that re-asks on the scale manager's resize — which fires on
 * every viewport change, rotation and fold — always gets the current screen.
 * Never from a window 'resize' handler: the canvas has not moved yet there.
 */
export function canvasInsets(
  canvas: HTMLCanvasElement | null | undefined,
  baseWidth: number,
  baseHeight: number
): Insets {
  const safe = safeAreaRect();
  if (!canvas || !safe) return NO_INSETS;
  return insetsFrom(safe, canvas.getBoundingClientRect(), baseWidth, baseHeight);
}

/**
 * Where the banner's top edge is on the canvas right now, in base units (y
 * grows downward, so `baseHeight` or more means it covers none of it); null
 * when the page cannot be measured — no DOM, a canvas not laid out yet.
 *
 * Measured whether or not a banner is showing: layouts that keep clear of it
 * are built for the one that can arrive, so nothing moves when it does.
 */
export function canvasBannerTop(
  canvas: HTMLCanvasElement | null | undefined,
  baseWidth: number,
  baseHeight: number
): number | null {
  const safe = safeAreaRect();
  if (!canvas || !safe || !(safe.height > 0)) return null;
  const reach = bannerReach(safe, canvas.getBoundingClientRect(), baseWidth);
  return Number.isFinite(reach) ? baseHeight - reach : null;
}

/** The free paper around the canvas inside the safe area right now, in base units. */
export function canvasPaper(
  canvas: HTMLCanvasElement | null | undefined,
  baseWidth: number
): Insets {
  const safe = safeAreaRect();
  if (!canvas || !safe) return NO_INSETS;
  return paperAround(safe, canvas.getBoundingClientRect(), baseWidth);
}
