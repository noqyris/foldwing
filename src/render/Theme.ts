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
 * Logical canvas. 750×1334 is a 2× iPhone-SE portrait — 9:16, the widest
 * common portrait aspect — and the reference every design and the playfield
 * are drawn against. The width is fixed everywhere: the mirror needs all of it.
 *
 * The HEIGHT follows the screen (`adaptiveHeight`, `viewHeight`): Phaser runs
 * FIT + CENTER_BOTH against 750 × H, where H is what fills the safe area. It
 * used to be this fixed 1334 on every screen, so a modern ~19.5:9 iPhone drew
 * its whole game in a 9:16 box with a band of empty paper above and below —
 * everything squeezed into the middle. The playfield itself never changes (a
 * level tuned on a phone plays identically on a tablet); it is only placed
 * (`boardInset`), and the chrome around it is anchored to the top and the
 * bottom of the taller world.
 */
export const BASE_WIDTH = 750;
export const BASE_HEIGHT = 1334;

/**
 * The tallest the world grows: 750 × 2.293, a 9:20.6 safe area.
 *
 * The width never moves — the mirror needs every unit of it — but the height
 * follows the screen now (`adaptiveHeight`), so a tall phone gets a taller
 * world instead of two bands of empty paper. Every portrait phone safe area
 * shipping lands under this with room: iPhone SE 1334 (clamped up), iPhone
 * 16/17 1448-1467, iPhone 18 Pro 1451, Pro Max 1466, a 20:9 Android about
 * 1535, a 21:9 one about 1620, and the narrowest iPad Split View pane
 * (320×690) 1613 — its box 1617, less the 2pt it is lifted off the banner
 * (SafeArea.fitShape). Past it are only slivers — Slide Over, a third of an iPad
 * at full height, 2300 and up — and there the playfield (1102 tall, the proved
 * geometry, never stretched) would sit centred in more paper than board: more
 * than a quarter of its height above and below, its HUD floating off from it
 * and the menu's stack from its header. Those letterbox, top and bottom, as
 * every tall phone used to.
 */
export const MAX_HEIGHT = 1720;

/**
 * The logical height for a safe area `safeW` × `safeH` (any unit): what makes
 * a canvas 750 wide fill it exactly — round(750 × safeH / safeW) — clamped to
 * [BASE_HEIGHT, MAX_HEIGHT].
 *
 * A shape wider than 9:16 (the SE's own, iPhone Duo's inner display, an iPad
 * pane held wide) keeps BASE_HEIGHT and letterboxes SIDEWAYS exactly as it
 * always has, desk margins and all; nothing about a 9:16 phone changes.
 * Unmeasurable input — no page yet, a zero box — is BASE_HEIGHT too.
 */
export function adaptiveHeight(safeW: number, safeH: number): number {
  if (!(safeW > 0) || !(safeH > 0) || !Number.isFinite(safeW) || !Number.isFinite(safeH)) return BASE_HEIGHT;
  const h = Math.round((BASE_WIDTH * safeH) / safeW);
  return Math.min(MAX_HEIGHT, Math.max(BASE_HEIGHT, h));
}

/**
 * The world's height right now: the one source of truth for layout.
 *
 * main.ts decides it from the safe area (SafeArea.fitShape) before the game is
 * built, and again on every relayout — a rotation, a fold, Split View — and
 * sets it here BEFORE it resizes the game, so every scene that hears the
 * resize reads the new value. Layout maths takes it as a parameter defaulting
 * to this, so it can be proved at any height; BASE_HEIGHT stays what it always
 * meant — the 9:16 reference the playfield and the designs are drawn against.
 */
let viewH = BASE_HEIGHT;

export function viewHeight(): number {
  return viewH;
}

export function setViewHeight(h: number): void {
  viewH = Math.min(MAX_HEIGHT, Math.max(BASE_HEIGHT, Math.round(Number.isFinite(h) ? h : BASE_HEIGHT)));
}

/**
 * How far below its designed place the board sits on a world `height` tall:
 * half the extra height, so the proved 702×1102 playfield is centred between
 * the HUD it hangs under and the hint band and banner reserve under it — the
 * playfield keeps its size and aspect (the levels, their collision and their
 * proofs are all in that geometry) and is only moved. 0 on a 9:16 world.
 */
export function boardDrop(height: number = viewH): number {
  return Math.floor(Math.max(0, height - BASE_HEIGHT) / 2);
}

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

/**
 * A B-spec measurement in 402-wide design points, in base units.
 *
 * The Night Fold mocks were drawn on the 402pt iPhone 18 Pro, where the
 * 750-wide canvas is 1.866 base units to the point — not the 2 that `pt()`
 * assumes for the 375pt reference phone. Numbers lifted from those mocks go
 * through here, rounded to whole base units so an edge never lands on half a
 * pixel; the legacy screens keep `pt()`.
 */
export const DP = BASE_WIDTH / 402;

export function dp(points: number): number {
  return Math.round(points * DP);
}

export interface InkTheme {
  readonly id: string;
  readonly name: string;
  /**
   * The page: the colour everything sits on. Also the Phaser background, the
   * HUD's text halos and the base the mirror is veiled toward. In Night Fold
   * it is the sky's middle stop — the sky itself is a bake (Paper.ts) over it.
   */
  readonly paper: number;
  /**
   * The FOREGROUND: text, marks, hairlines, and the wash a quiet face is made
   * of (ink at 0.06 over the page). On paper that was the player's ink; at
   * night it is cream, and the player's stroke has its own token, `line`.
   * Every `label()`, `inkCss()` and `fillStyle(t.ink, a)` in the game reads
   * this, which is why the whole app turned dark by changing it.
   */
  readonly ink: number;
  /**
   * The player's stroke. Night Fold: warm lamp light, tangerine, with a hot
   * core (`lineCore`) and a bloom baked into the ink layer. The stroke's
   * renderers read this, never `ink`, since the stroke and the text parted.
   */
  readonly line: number;
  /** The stroke's hot centre, drawn at `lineCoreWidth` of its width. */
  readonly lineCore: number;
  readonly lineCoreWidth: number;
  /**
   * The line's bloom, BAKED into the ink layer as extra passes under it —
   * `width` times the nib at `alpha` each. No postFX: a per-object glow is a
   * render pass per frame on iOS WebGL (tech G3).
   */
  readonly lineBloom: readonly { readonly width: number; readonly alpha: number }[];
  /**
   * The reflection's own colour, when the theme names one. Night Fold's is
   * moonlight. Absent, the reflection is the line veiled toward the page — see
   * `veiledInk`, which answers this for the theme's own line or ink.
   */
  readonly mirror?: number;
  /** Walls: the tile's face. The second-loudest thing on the board. */
  readonly wall: number;
  /** The wall's lit rim, top-left. Walls are baked once per level, rim then face. */
  readonly wallRim: number;
  /** The play board's sheet, and its lighter centre. */
  readonly board: number;
  readonly boardCentre: number;
  /** Start dot, goal ring, progress, rewards — SHAPES only. Text takes `accentText`. */
  readonly accent: number;
  /**
   * The accent for TEXT and icons, held to the 4.5:1 body floor on the page
   * and on glass. Night Fold's ember is a step lighter than the shape accent.
   */
  readonly accentText: number;
  /** Mirrored start and goal markers: reflections, not targets. Opaque. */
  readonly veil: number;
  /** Collision flash, the death splat, the danger heat's last step. */
  readonly fail: number;
  /**
   * The medal's gold, for SHAPES — a filled star, a chapter bead, a seal.
   *
   * On paper two golds were needed: the shape gold was about 2:1 on the page.
   * At night the one gold reads at 9:1, so `medalText` is the same colour; the
   * pair stays, so a lighter appearance can split them again.
   */
  readonly medal: number;
  /** The medal's gold for TEXT: at least 4.5:1 on the page. */
  readonly medalText: number;
  /**
   * Accent at this alpha is the face of an inviting surface — the gift, an
   * accent button. Low on purpose: it tints the page rather than painting on
   * it, so the accent text on top keeps its contrast.
   */
  readonly accentWash: number;
  /**
   * The mirrored stroke's weight when a theme names no `mirror`: the ink
   * blended this far toward the page. Also how far a reflected word fades.
   */
  readonly mirrorAlpha: number;
  /** Fill of the closed win figure. */
  readonly winFillAlpha: number;
  /** The centre axis, in the foreground colour. */
  readonly axisAlpha: number;
  /** Mirrored start/goal markers — reflections, not targets. */
  readonly reflectionAlpha: number;
  /** Nib width, in points. A cosmetic may change this; hit radius never moves. */
  readonly strokePt: number;
}

/**
 * Everything around the board that the appearance decides: the sky, glass,
 * the text ladder, elevation, the Daily's dusk. Chrome only — nothing here
 * reaches the board's collision or the stroke.
 *
 * Kept apart from InkTheme because the two change for different reasons: an
 * ink (P2) recolours the line; an appearance (Night now, Warm Paper later as
 * "Light") recolours the world around it. Adding "Light" is a second entry in
 * `UI_THEMES` and a matching InkTheme — no code path reads a hex directly.
 */
export interface UiTheme {
  readonly id: string;
  /** The sky, lamp to edge: a radial (Paper.ts) over `paper`. */
  readonly skyGlow: number;
  readonly sky: number;
  readonly skyEdge: number;
  /** The star field baked into the sky: how many, how bright, what colour. */
  readonly stars: {
    readonly count: number;
    readonly alphaMin: number;
    readonly alphaMax: number;
    readonly color: number;
  };
  /**
   * Smoked glass: `smoke` at `smokeAlpha`, then `glass` at `glassAlpha`, with
   * a `glassHighlight` hairline along the top edge. The smoke is what keeps
   * captions at 4.5:1 on a panel that sits over the lamp's glow.
   */
  readonly glass: number;
  readonly glassAlpha: number;
  readonly glassHighlight: number;
  readonly smoke: number;
  readonly smokeAlpha: number;
  /**
   * An OPAQUE lifted surface: sheets, toasts, the progress card — anything
   * that must hide what is under it rather than show it through.
   */
  readonly sheet: number;
  /** Sunk wells: tracks, locked nodes, the unearned bead. */
  readonly well: number;
  /** The text ladder. `text` is `ink`; the two lower steps are for secondary lines and captions. */
  readonly text: number;
  readonly text2: number;
  readonly text3: number;
  /** Text and glyphs ON an accent fill (the primary button, a tag, the + disc). */
  readonly onAccent: number;
  /** The primary button's gradient, top to bottom. */
  readonly accentTop: number;
  readonly accentBottom: number;
  /** The done disc (a finished mission, a checked day), with `onAccent` glyphs. */
  readonly done: number;
  /** The star's gold radial, centre to rim, for a punched-in star. */
  readonly goldLight: number;
  readonly goldDeep: number;
  /** The Daily card alone is dusk: its accent, caps, gradient and the ink on its pill. */
  readonly dusk: number;
  readonly duskCaps: number;
  readonly duskFrom: number;
  readonly duskTo: number;
  readonly onDusk: number;
  /** Every shadow's colour. Night: black — never the warm brown of paper. */
  readonly shadow: number;
  /** Modal scrims: this colour at this alpha over the page. */
  readonly scrim: number;
  readonly scrimAlpha: number;
  /** A hairline rule or an outline, in the foreground at this alpha. */
  readonly hairAlpha: number;
  /** The board's crease: a dark hairline beside a light one, each at its alpha. */
  readonly creaseDark: number;
  readonly creaseDarkAlpha: number;
  readonly creaseLight: number;
  readonly creaseLightAlpha: number;
  /**
   * The board's far half, away from the lamp: black from `farShade` at the
   * crease to `farShadeMid` at 22 % of the half, then to 0. The near half
   * catches `nearSheen` of cream at the crease, fading over 30 %.
   */
  readonly farShade: number;
  readonly farShadeMid: number;
  readonly nearSheen: number;
}

/** Cream: the colour of the page's light — glass, highlights, stars. */
const CREAM = 0xfff8ec;

/**
 * Night Fold, the one appearance this release ships (owner, 2026-09-27).
 *
 * The same folded sheet at night under one warm lamp: the line is light, its
 * reflection moonlight, walls slate tiles, cards smoked glass. Every text
 * colour is held to 4.5:1 on the surface it sits on in Theme.test; walls sit
 * at 2.7:1 on the board and carry a lit rim for their edge.
 */
const NIGHT: InkTheme = {
  id: 'night',
  name: 'Night Fold',
  paper: 0x0f2830,
  ink: 0xf4ede1,
  line: 0xff7a52,
  lineCore: 0xffd9c2,
  lineCoreWidth: 0.38,
  lineBloom: [
    { width: 3.2, alpha: 0.18 },
    { width: 2.0, alpha: 0.22 },
  ],
  mirror: 0x9fb2ae,
  wall: 0x416b79,
  wallRim: 0x6394a1,
  board: 0x10262e,
  boardCentre: 0x14313a,
  accent: 0xff7a52,
  accentText: 0xff8c66,
  // Moonlight at 0.8 over the board, pre-blended: the markers are one opaque
  // pass for the same reason the mirror is (see veiledInk). Cream at 0.3 came
  // out a dead grey (88,101,103) beside the moonlight line they belong to;
  // this is the reflection's own colour, a step quieter than the line.
  veil: blend(0x9fb2ae, 0.8, 0x10262e),
  // A lamp-lit red: 4.9:1 on the board, and far enough from the tangerine that
  // the danger heat's last step reads as a change of kind, not of strength.
  fail: 0xf0605a,
  medal: 0xf0c05a,
  medalText: 0xf0c05a,
  // Low enough that the full accent still reads at 4.5:1 on twice this wash —
  // a pressed accent face in code that paints its own.
  accentWash: 0.09,
  mirrorAlpha: 0.45,
  winFillAlpha: 0.22,
  axisAlpha: 0.12,
  reflectionAlpha: 0.3,
  strokePt: 5,
};

const NIGHT_UI: UiTheme = {
  id: 'night',
  skyGlow: 0x1d4450,
  sky: NIGHT.paper,
  skyEdge: 0x081419,
  stars: { count: 84, alphaMin: 0.1, alphaMax: 0.55, color: CREAM },
  glass: CREAM,
  glassAlpha: 0.06,
  glassHighlight: 0.07,
  smoke: 0x040d11,
  smokeAlpha: 0.15,
  sheet: 0x14303a,
  well: 0x0c1f26,
  text: NIGHT.ink,
  text2: 0xa7b8b7,
  // The owner's #86999A measured 4.2:1 on glass under the lamp's shoulder —
  // under the 4.5 floor the same decision set for every text token — so the
  // caption step is lifted by a hair, to 4.6:1 there.
  text3: 0x8da0a1,
  onAccent: 0x1a0e09,
  accentTop: 0xff8c66,
  accentBottom: 0xff6a45,
  done: NIGHT.accent,
  goldLight: 0xfbe3a0,
  goldDeep: 0xb7851c,
  dusk: 0xc99bf0,
  duskCaps: 0xe4b8ff,
  duskFrom: 0x3a2946,
  duskTo: 0x172b36,
  onDusk: 0x1e1530,
  shadow: 0x000000,
  // 0.55 left the tangerine Continue and the dusk Daily card vivid beside
  // and under every sheet, pulling the eye off the modal (QA).
  scrim: 0x02080b,
  scrimAlpha: 0.68,
  hairAlpha: 0.09,
  creaseDark: 0x000000,
  creaseDarkAlpha: 0.55,
  creaseLight: CREAM,
  creaseLightAlpha: 0.07,
  farShade: 0.32,
  farShadeMid: 0.1,
  nearSheen: 0.035,
};

/** Cosmetic ink packs land here as plain data. `undefined` in the value type
 *  keeps the lookup honest — an unknown id is a miss, not a phantom theme. */
export const THEMES: Readonly<Record<string, InkTheme | undefined>> = {
  night: NIGHT,
};

/** Appearances. One this release; "Light" (Warm Paper) is a second entry, never a code change. */
export const UI_THEMES: Readonly<Record<string, UiTheme | undefined>> = {
  night: NIGHT_UI,
};

let active: InkTheme = NIGHT;
let activeUi: UiTheme = NIGHT_UI;

export function theme(): InkTheme {
  return active;
}

/** The appearance's chrome tokens: sky, glass, the text ladder, elevation, dusk. */
export function ui(): UiTheme {
  return activeUi;
}

export function setTheme(id: string): void {
  const next = THEMES[id];
  if (next) active = next;
}

/**
 * The mirror's colour: the theme's named reflection, or ink pre-blended
 * toward the paper.
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
 *
 * A theme that names its `mirror` (Night Fold's moonlight) answers that for
 * its own line AND its own ink: the renderers that still pass `t.ink` get the
 * moonlight too, so no reflection is ever a grey blend beside a named one.
 * Any other colour — a ghost, a hint — is still veiled.
 */
export function veiledInk(ink: number, t: InkTheme = active): number {
  if (t.mirror !== undefined && (ink === t.line || ink === t.ink)) return t.mirror;
  return blend(ink, t.mirrorAlpha, t.paper);
}

/** `color` at `alpha` over `under`, as the one opaque colour the eye sees. */
export function blend(color: number, alpha: number, under: number): number {
  const mix = (shift: number): number => {
    const a = (color >> shift) & 0xff;
    const b = (under >> shift) & 0xff;
    return Math.round(b + (a - b) * alpha) & 0xff;
  };
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

/**
 * The WCAG 2 contrast ratio of `fg` at `alpha` over `bg`, against `bg`: 1 to 21.
 *
 * Anything a player reads to act on — a price, a reward line — is held to
 * 4.5:1, WCAG's floor for body text, on the face it actually sits on. A new
 * colour or alpha is checked against it in a test rather than by eye.
 */
export function contrast(fg: number, bg: number, alpha = 1): number {
  const lum = (c: number): number => {
    const ch = (shift: number): number => {
      const v = ((c >> shift) & 0xff) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(16) + 0.7152 * ch(8) + 0.0722 * ch(0);
  };
  const a = lum(blend(fg, alpha, bg));
  const b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** CSS rgba() string, for the few places that want one instead of a hex int. */
export function rgba(color: number, alpha: number): string {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** CSS #rrggbb, for the page and the DOM. */
export function hexCss(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}

/**
 * The theme's ink (or `color`) as a CSS string, for Phaser text styles.
 *
 * Scenes wrote `'rgba(22,50,60,0.6)'` by hand, which is the paper theme's ink
 * frozen into a string: a second ink pack would have re-coloured every shape
 * and left those lines behind in the old colour.
 */
export function inkCss(alpha: number, color: number = active.ink): string {
  return rgba(color, alpha);
}

/**
 * Smoked glass over `under`, as the one opaque colour it shows there: what
 * text on a glass panel is measured against.
 */
export function glassOver(under: number, u: UiTheme = activeUi, extra = 0): number {
  return blend(u.glass, u.glassAlpha + extra, blend(u.smoke, u.smokeAlpha, under));
}

/* ------------------------------------------------------------------- type */

/**
 * The display face: Georgia carries the "ink on paper" voice — the wordmark,
 * titles, level names, the italic lines, hero numerals.
 */
export const FONT_DISPLAY = 'Georgia, "Iowan Old Style", "Times New Roman", serif';

/**
 * The interface face: the system's. `-apple-system` alone falls back to Times
 * in desktop Chrome — the web Daily's front door — so the stack names SF and
 * Helvetica Neue before the generic family (SPEC §2.3).
 */
export const FONT_UI = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif';

/* ----------------------------------------------------------------- motion */

/**
 * CSS's cubic-bezier as a Phaser ease: `t` in 0..1 to progress in 0..1.
 *
 * Solved for x by Newton steps with a bisection fallback — the curves used
 * here are monotonic in x, so a few iterations land within 1e-6.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (u: number): number => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number): number => ((ay * u + by) * u + cy) * u;
  const dx = (u: number): number => (3 * ax * u + 2 * bx) * u + cx;
  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let u = t;
    for (let i = 0; i < 6; i++) {
      const err = sx(u) - t;
      if (Math.abs(err) < 1e-6) return sy(u);
      const d = dx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= err / d;
    }
    let lo = 0;
    let hi = 1;
    u = t;
    for (let i = 0; i < 30; i++) {
      const x = sx(u);
      if (Math.abs(x - t) < 1e-6) break;
      if (x < t) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return sy(u);
  };
}

/**
 * The motion vocabulary (SPEC §2.5): durations in base ms, to go through
 * `ms()`. Cards and sheets SETTLE; only small stamps POP; one thing BREATHES.
 */
export const MOTION = {
  /** Cards, sheets, tiles: cubic(.2,.8,.2,1). */
  settle: { ms: 280, ease: cubicBezier(0.2, 0.8, 0.2, 1) },
  /** Stars, checks, tokens: Back.out(1.6). */
  pop: { ms: 220, ease: 'Back.easeOut', overshoot: 1.6 },
  /** Draw-ins along an arc: the logo, a path. */
  ink: { ms: 720, ease: 'Sine.easeInOut' },
  /** The one breathing thing on a screen: 2.4 s sine, scale 1 → 1.06, alpha 0.6 → 1. */
  breathe: { period: 2400, scale: 1.06, alphaFrom: 0.6 },
  /** Top-down entrances: 40 ms apart, at most 6, each rising 12 pt. */
  stagger: { ms: 40, max: 6, rise: 12 },
} as const;

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

/**
 * Whether the player asked for reduced motion.
 *
 * For the few effects that are pure travel — a token flying to a counter, ink
 * droplets, the crease sweep. Shortening those to a blink would still flash
 * something across the screen, so they are skipped instead and the change they
 * carried is shown in place.
 */
export function motionReduced(): boolean {
  return motion < 1;
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
   * The ad banner is a NATIVE view pinned to the bottom of the screen — a fixed
   * 320x50 anchored to the safe area — not a game object, so it knows nothing
   * about the canvas. On a tall phone FIT letterboxes and the banner lands in
   * the paper band below the canvas — harmless. On a 9:16 phone there is no
   * letterbox and the banner covers the last stretch of canvas outright, so
   * anything drawn there is invisible.
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

/**
 * METRICS.inset for a world `height` tall: the same board, `boardDrop` further
 * down — the extra height split between the paper above it and below it, so
 * `new Playfield(BASE_WIDTH, height, boardInset(height))` is 702×1102 at every
 * height. Exactly METRICS.inset on a 9:16 world.
 */
export function boardInset(height: number = viewHeight()): {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
} {
  const extra = Math.max(0, height - BASE_HEIGHT);
  const drop = boardDrop(height);
  const i = METRICS.inset;
  return { top: i.top + drop, right: i.right, bottom: i.bottom + extra - drop, left: i.left };
}

/**
 * The first base y the native banner's reserve begins at on a world `height`
 * tall: the bottom METRICS.bannerReserve is the banner's, at every height.
 */
export function bannerLine(height: number = viewHeight()): number {
  return height - METRICS.bannerReserve;
}
