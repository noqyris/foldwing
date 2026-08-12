/**
 * Theme — palette and sizing tokens.
 *
 * Two deliberately separate objects:
 *
 *   InkTheme  Everything a cosmetic is allowed to change: paper, ink colour,
 *             nib width, opacities. Adding a purchasable ink pack later must be
 *             a JSON object dropped into `THEMES`, never a code change.
 *   Metrics   Everything that decides whether a stroke lives or dies. Nothing
 *             in CollisionSystem reads InkTheme, so no skin can change what
 *             kills you — that is the anti-pay-to-win guarantee, and it is
 *             structural rather than a promise.
 *
 * One consequence worth knowing before shipping a wide nib: collision is
 * measured from the centreline, so a fatter stroke does not survive anything a
 * thin one would not — it simply renders ink over a wall it has legally
 * cleared. Identical mechanics, worse readability. Keep cosmetic nibs near 5pt.
 */

/* ------------------------------------------------------------ base canvas */

/**
 * Logical canvas. Phaser runs FIT + CENTER_BOTH against this fixed size, so
 * game coordinates never change with the device: the playfield keeps one aspect
 * ratio everywhere and a level tuned on a phone plays identically on a tablet.
 * 750×1334 is a 2× iPhone-SE portrait — 9:16, the widest common portrait
 * aspect, so taller phones letterbox into the paper-coloured page background
 * (invisible) rather than pillarboxing and stealing the width the mirror needs.
 */
export const BASE_WIDTH = 750;
export const BASE_HEIGHT = 1334;

/**
 * Base pixels per logical point. The spec's sizes ("5px stroke", "42px finger
 * offset") are in points — what a designer measures on a 375pt-wide screen — so
 * every one of them goes through `pt()` rather than being hardcoded at 2×.
 */
export const PT = 2;

export function pt(points: number): number {
  return points * PT;
}

/* ------------------------------------------------------------------ theme */

export interface InkTheme {
  readonly id: string;
  readonly name: string;
  /** Page colour. Also the Phaser background, so letterboxing disappears. */
  readonly paper: number;
  /** The player's stroke, at full opacity. */
  readonly ink: number;
  /** Obstacles. Quiet — no outline, no texture. The ink is the loud thing. */
  readonly wall: number;
  /** Start dot and goal ring. */
  readonly accent: number;
  /** Collision flash. */
  readonly fail: number;
  /** The mirrored stroke: same ink, seen through glass. */
  readonly mirrorAlpha: number;
  /** Fill of the closed win figure. */
  readonly winFillAlpha: number;
  /** The dashed centre axis. */
  readonly axisAlpha: number;
  /** Mirrored start/goal markers — reflections, not targets. */
  readonly reflectionAlpha: number;
  /** Nib width, in points. A cosmetic may change this; hit radius never moves. */
  readonly strokePt: number;
}

const PAPER: InkTheme = {
  id: 'paper',
  name: 'Paper',
  paper: 0xe9ebe4,
  ink: 0x16323c,
  wall: 0x9a9c90,
  accent: 0x8e3b62,
  fail: 0xb4463c,
  mirrorAlpha: 0.45,
  winFillAlpha: 0.11,
  axisAlpha: 0.16,
  reflectionAlpha: 0.3,
  strokePt: 5,
};

/** Cosmetic ink packs land here as plain data. `undefined` in the value type
 *  keeps the lookup honest — an unknown id is a miss, not a phantom theme. */
export const THEMES: Readonly<Record<string, InkTheme | undefined>> = {
  paper: PAPER,
};

let active: InkTheme = PAPER;

export function theme(): InkTheme {
  return active;
}

export function setTheme(id: string): void {
  const next = THEMES[id];
  if (next) active = next;
}

/**
 * The mirror's colour: ink pre-blended toward the paper.
 *
 * The obvious way to make the reflection quieter is to draw the same ink at
 * `mirrorAlpha` and let the compositor do it. That does not work, and the
 * reason survives every renderer: a ribbon is not one shape, it is dozens of
 * OVERLAPPING quads and discs, and both Phaser Graphics and a 2D canvas
 * composite each fill separately. Every overlap lands on top of the last, so
 * 0.45 accumulates to a measured 0.95-0.97 — the reflection renders as solid as
 * the player's own line, which is exactly the distinction the game is built on.
 *
 * Blending the colour instead gives the intended weight in one opaque pass,
 * immune to how many times the ribbon crosses itself, and costs nothing. It
 * lives here rather than in a renderer because all of them need it and none of
 * them should own it.
 */
export function veiledInk(ink: number, t: InkTheme = active): number {
  const mix = (shift: number): number => {
    const a = (ink >> shift) & 0xff;
    const b = (t.paper >> shift) & 0xff;
    return Math.round(b + (a - b) * t.mirrorAlpha) & 0xff;
  };
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

/** CSS rgba() string, for the few places that want one instead of a hex int. */
export function rgba(color: number, alpha: number): string {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ---------------------------------------------------------------- metrics */

/**
 * Animation scale, 1 normally and near-zero under reduced motion.
 *
 * Set once from the save at boot rather than read per-tween, so nothing in the
 * render layer has to import Progress. Reduced motion SHORTENS rather than
 * removes: the win figure still blooms and a sheet still arrives, so the player
 * sees what happened — they just are not carried through the travel.
 */
let motion = 1;

export function setMotionScale(reduced: boolean): void {
  motion = reduced ? 0.12 : 1;
}

/** Scale a duration in ms. Never returns 0 — a 0ms tween skips its onComplete. */
export function ms(base: number): number {
  return Math.max(1, Math.round(base * motion));
}

export const METRICS = {
  /**
   * LOCKED. Collision radius 2.6pt against a 5pt rendered nib.
   *
   * Note what these two numbers actually produce. The radius is measured from
   * the stroke's CENTRELINE, and a 5pt nib reaches only 2.5pt from that same
   * centreline — so contact is reported 0.1pt BEFORE the visible ink touches
   * the wall, a shade stricter than pixel-perfect rather than forgiving. The
   * numbers are the spec's and are shipped as written; making the line forgive
   * as intended means dropping this to about pt(2.0), which is a change to a
   * LOCKED value and so is the author's call, not this file's.
   */
  hitRadius: pt(2.6),

  /** Minimum travel before a new raw sample is recorded. */
  sampleMinDist: pt(2.6),

  /**
   * On touch, the drawing cursor sits this far ABOVE the finger so the thumb
   * never covers the live end of the stroke on a 375pt-wide screen.
   */
  touchOffsetY: pt(42),

  /**
   * Finger travel over which the offset eases in, rather than snapping on at
   * pointerdown. Measured in DISTANCE, not time: a time-based ramp slides the
   * cursor while the finger is still and draws ink nobody asked for.
   *
   * LONG on purpose. At pt(21) the ink hit full lead within a thumb-width of
   * travel — double finger speed from the first millimetre — and players died
   * on the first obstacle "while still starting". At pt(60), paired with the
   * smoothstep ease in DrawCursor, the stroke leaves the start dot glued to
   * the finger and gains its lead across the level's start runway, before the
   * first wall can be reached.
   */
  touchOffsetRampPx: pt(60),

  /**
   * Longest gap allowed between points fed to the renderer's smoothing pass.
   *
   * Chaikin cuts corners in proportion to the spacing it is given, and pointer
   * samples during a flick land 80-300px apart — enough that the smoothed line
   * would visibly bow through a wall corner the RAW path legally cleared, and
   * the player would watch their stroke pass through a wall and live. Splitting
   * long segments first costs nothing geometrically (the inserted points lie
   * exactly on the raw path) and bounds that bow to well under the nib.
   */
  renderMaxSpacing: pt(5),

  /** Visual radius of the start dot. */
  startRadius: pt(10),

  /** How close a pointerdown must land to the start dot to begin a stroke. */
  startGrabFactor: 2.4,

  /** Visual radius of the goal ring, and the win threshold. */
  goalRadius: pt(15),

  goalRingWidth: pt(2),

  wallCornerRadius: pt(3),

  axisWidth: pt(1),
  axisDash: pt(7),
  axisGap: pt(6),

  /** Chaikin passes applied to the RENDERED stroke only, never to collision. */
  smoothIterations: 2,

  /** Failure must be recoverable in well under a second. No modal, no tap. */
  failFlashMs: 400,

  /** The win figure holds for a beat, then settles. */
  winHoldMs: 180,
  winSettleMs: 350,
  winSettleFrom: 0.97,

  /**
   * Vertical space at the bottom of the canvas that menu chrome must not use.
   *
   * The AdMob banner is a NATIVE view pinned to the bottom of the screen, not a
   * game object, so it knows nothing about the canvas. On a tall phone FIT
   * letterboxes and the banner lands in the paper band below the canvas —
   * harmless. On a 9:16 phone there is no letterbox and the banner covers the
   * last stretch of canvas outright, so anything drawn there is invisible.
   */
  bannerReserve: pt(58),

  /**
   * Playfield inset from the logical canvas, leaving margins like a page.
   *
   * The bottom inset clears `bannerReserve`. The banner is a native view pinned
   * to the bottom of the SCREEN and knows nothing about the canvas, so on a 9:16
   * phone — where FIT leaves no letterbox — it sits directly on top of the last
   * stretch of playfield. A start dot under an ad is both unplayable and an
   * accidental-click generator, which is the fastest way to lose ad serving.
   */
  inset: {
    top: pt(44),
    right: pt(12),
    bottom: pt(72),
    left: pt(12),
  },
} as const;
