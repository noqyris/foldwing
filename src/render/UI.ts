/**
 * UI — the shell around the game, in Night Fold.
 *
 * The board is a folded sheet at night under one warm lamp; everything around
 * it is smoked glass over the sky, lit from the top-left, with one warm
 * accent — the tangerine of the icon, the start dot and the player's line.
 * The kit here is what every screen is built from: type, buttons, chips,
 * tags, toasts, glyphs, the page's dims. Restyle it and every screen follows.
 *
 * Static chrome is BAKED (Baked.ts): a button face, a chip, a toast is one
 * texture drawn as an Image or a NineSlice, never a Graphics object that
 * Phaser re-triangulates every frame. Glyphs are the pen-line icon family
 * (Icons.ts), baked too wherever the kit draws them.
 *
 * Everything here is still built from runtime primitives: no font or image
 * assets to load, and cold start stays under a second.
 */

import Phaser from 'phaser';
import type { Vec2 } from '../core/Geometry';
import { Audio } from '../systems/Audio';
import { Haptics } from '../systems/Haptics';
import {
  bakedPanel,
  LOOKS,
  paintPanel,
  panel,
  panelPad,
  RADII,
  sizePanel,
  softDisc,
  type Panel,
  type PanelSpec,
} from './Baked';
import { centredHitArea, tapFloor, worldPoint } from './HitArea';
import { drawIcon, icon, ICON_STROKE, type IconName } from './Icons';
import { canvasInsets } from './SafeArea';
import type { ScrollView } from './ScrollView';
import {
  bannerLine,
  BASE_WIDTH,
  dp,
  FONT_DISPLAY,
  FONT_UI,
  METRICS,
  MOTION,
  motionReduced,
  ms,
  pt,
  rgba,
  theme,
  ui,
  veiledInk,
  viewHeight,
} from './Theme';

/**
 * Make a centre-drawn container tappable over its whole face.
 *
 * Always go through this rather than calling `setInteractive` with a hand-built
 * rectangle: the obvious `(-w/2, -h/2, w, h)` is wrong, because Phaser adds the
 * display origin back before testing containment. See `HitArea.ts` — that
 * mistake shipped, and it is why buttons needed several taps.
 *
 * With `floor`, the TAP area is also kept at least `minTap` tall for as long
 * as the container lives: the floor is in points on the glass, so it moves
 * with the canvas scale and is re-measured on every resize. Returns the tap
 * height as it is now, for a caller that judges a release by the same
 * rectangle as the press.
 *
 * `cap` is the most the floor may grow it to: the room the caller's layout
 * left between this control and its neighbours. The layout is spaced for the
 * floor at the scale it was built at, and a later resize grew the areas but
 * not the spacing, so neighbours overlapped until the screen was rebuilt.
 */
export function tappable(
  container: Phaser.GameObjects.Container,
  w: number,
  h: number,
  floor = false,
  cap = Number.POSITIVE_INFINITY
): () => number {
  return tapArea(container, () => ({ w, h }), floor, cap).tapH;
}

/**
 * `tappable` for a control whose painted size can change after it is built —
 * a chip whose count grows a digit. `refit` re-reads the size; the caller
 * calls it after `setSize`.
 */
function tapArea(
  container: Phaser.GameObjects.Container,
  size: () => { w: number; h: number },
  floor: boolean,
  cap: number
): { tapH: () => number; refit: () => void } {
  const scene = container.scene;
  // One rectangle, re-shaped in place: Phaser tests against the object it was
  // handed, so a resize reaches the live hit area without re-registering it.
  const rect = new Phaser.Geom.Rectangle();
  let tapH = size().h;
  const fit = (): void => {
    const { w, h } = size();
    tapH = floor ? Math.max(h, Math.min(minTap(scene), cap)) : h;
    const a = hitRect(w, h, tapH);
    rect.setTo(a.x, a.y, a.width, a.height);
  };
  fit();
  container.setInteractive(rect, Phaser.Geom.Rectangle.Contains);
  if (floor) {
    // The ScaleManager outlives every scene; the listener goes with the control.
    scene.scale.on(Phaser.Scale.Events.RESIZE, fit);
    container.once(Phaser.GameObjects.Events.DESTROY, () => {
      scene.scale.off(Phaser.Scale.Events.RESIZE, fit);
    });
  }
  return { tapH: () => tapH, refit: fit };
}

/**
 * Apple's floor for anything a thumb has to hit, in base units at the scale the
 * canvas is drawn right now — see `tapFloor`. Painted controls on these sheets
 * are often quieter than that — a 30pt "Not now" under a column of 50pt rows is
 * the right weight — so the floor applies to the TAP area, never to what is
 * drawn.
 *
 * Not a constant. It was `pt(44)`, which is 44pt only on a canvas drawn at
 * 0.5; on the SE, whose canvas now clears the status bar, every control
 * raised to it measured 42.7pt.
 */
export function minTap(scene: Phaser.Scene): number {
  return tapFloor(scene.scale.displayScale.y);
}

/**
 * The centred hit rectangle, grown vertically to `minHitHeight` when the
 * painted height is less. Top-left space, like `centredHitArea` — the growth
 * is split evenly above and below, so the face stays in the middle of it.
 */
function hitRect(w: number, h: number, minHitHeight: number) {
  const a = centredHitArea(w, h);
  const grow = Math.max(0, minHitHeight - h);
  return { x: a.x, y: a.y - grow / 2, width: a.width, height: a.height + grow };
}

/* ------------------------------------------------------------- type scale */

export const FONT = {
  /** The display face. Georgia carries the literary voice into the chrome. */
  display: FONT_DISPLAY,
  /** Numerals, labels, anything that must read as interface rather than prose. */
  ui: FONT_UI,
} as const;

/**
 * The type scale, in base units.
 *
 * The first six are the 1.4 scale every screen is laid out on, kept as they
 * were so no layout moves under a restyle. The named B roles (SPEC §2.3, pt
 * at 402 wide) are for new work: the wordmark, the button, caps and the
 * italic voice.
 */
export const TYPE = {
  hero: pt(46),
  title: pt(27),
  heading: pt(19),
  body: pt(15),
  label: pt(12.5),
  micro: pt(10.5),
  /** "foldwing": Georgia 46 pt. */
  display: dp(46),
  /** Button captions: system semibold 19 pt. */
  button: dp(19),
  /** Caps labels: system semibold 10.5 pt, tracked +1.4. */
  caps: dp(10.5),
  /** The voice — tagline, a win's sub-line: Georgia italic 15 pt. */
  voice: dp(15),
} as const;

export const SPACE = {
  xs: pt(6),
  sm: pt(10),
  md: pt(16),
  lg: pt(24),
  xl: pt(36),
  xxl: pt(56),
} as const;

/**
 * Corner radii (SPEC §2.4): `sm` a mini board or a polaroid, `md` a button
 * or a tile, `lg` a card, `sheet` a bottom sheet; `pill` rounds anything
 * fully. Every drawing helper clamps it to what the box can hold.
 */
export const RADIUS = {
  sm: RADII.mini,
  md: RADII.button,
  lg: RADII.card,
  sheet: RADII.sheet,
  pill: pt(999),
} as const;

/**
 * The foreground wash of a quiet face — the old secondary button, a chip —
 * at rest and while pressed. At night the foreground is cream, so this is
 * glass; the kit's own faces are baked smoked glass (`glassPanel`).
 */
export const INK_WASH = { rest: 0.055, pressed: 0.09 } as const;

/**
 * How much of a filled face shows while pressed, for code that still paints
 * a face at an alpha. The kit's baked faces are tinted instead (`PRESS_TINT`).
 */
export const PRESSED_FACE = 0.86;

/** The ghost face: bare at rest, glass under the thumb. */
export const GHOST_WASH = { rest: 0, pressed: 0.06 } as const;

/**
 * The tint a baked face takes while pressed. A light face (the tangerine
 * primary, dark text) dips only a little, or its caption would lose the body
 * floor under the thumb; a dark glass face (cream text) can go further and
 * only gains contrast.
 */
export const PRESS_TINT = { light: 0xebebeb, dark: 0xc4c4c4 } as const;

/**
 * How far a finger may travel between press and release and still count as a
 * tap. Generous on purpose: a thumb on glass never holds still, and treating
 * that drift as a drag is what makes a button feel broken.
 */
export const TAP_SLOP = pt(14);

/* ---------------------------------------------------------------- helpers */

/** Segments per quarter circle: G2's curve tolerance, where Phaser's own cut about a hundred. */
export const CORNER_SEGMENTS = 8;

/**
 * A rounded rect as a polygon, clockwise on screen, `CORNER_SEGMENTS` chords
 * to each corner. The radius is clamped to what the box can hold.
 *
 * Phaser's `fillRoundedRect` cuts about a hundred segments per corner and
 * re-triangulates them every frame, and it takes the radius on trust: a pill
 * radius on a 60px chip swept its arcs hundreds of pixels past the shape and
 * painted faint streaks across the page. Eight chords are round at any size a
 * live shape is drawn, a tenth of the vertices, and the clamp is built in.
 */
export function roundRectPoints(
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  segments = CORNER_SEGMENTS
): Vec2[] {
  const r = clampRadius(radius, w, h);
  if (r <= 0.5) {
    return [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ];
  }
  const pts: Vec2[] = [];
  const corner = (cx: number, cy: number, from: number): void => {
    for (let i = 0; i <= segments; i++) {
      const a = from + (Math.PI / 2) * (i / segments);
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
  };
  corner(x + w - r, y + r, -Math.PI / 2);
  corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, Math.PI / 2);
  corner(x + r, y + r, Math.PI);
  return pts;
}

/** Fill a rounded rect — see `roundRectPoints`. */
export function roundRect(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
): void {
  if (!(w > 0) || !(h > 0)) return;
  g.fillPoints(roundRectPoints(x, y, w, h, radius), true);
}

/** The outline of the same shape. Same clamp, same reason. */
export function strokeRoundRect(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
): void {
  if (!(w > 0) || !(h > 0)) return;
  g.strokePoints(roundRectPoints(x, y, w, h, radius), true, true);
}

const clampRadius = (radius: number, w: number, h: number): number =>
  Math.max(0, Math.min(radius, w / 2, h / 2));

export interface TextOptions {
  size?: number;
  color?: number;
  alpha?: number;
  font?: string;
  align?: 'left' | 'center' | 'right';
  letterSpacing?: number;
  /** 400 regular, 500 medium, 600 semibold, 700 bold. */
  weight?: 400 | 500 | 600 | 700;
  italic?: boolean;
  /**
   * Caps: the text upper-cased and tracked (+1.4 pt unless `letterSpacing`
   * says otherwise) — "CHAPTER III · HINGE", "DAY STREAK".
   */
  caps?: boolean;
}

/**
 * The resolution every label rasterises at. 1 today, where the canvas is
 * 750 base units wide; device-resolution rendering (SPEC §6 stage 3) sets it
 * to its k here, once, for every Text in the game (tech G12).
 */
let textResolution = 1;

export function setTextResolution(k: number): void {
  textResolution = Number.isFinite(k) && k > 0 ? k : 1;
}

/**
 * Every Text in the game comes through here (tech G12): the font stack, the
 * theme's foreground, the weight and the resolution in one place.
 */
export function label(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: TextOptions = {}
): Phaser.GameObjects.Text {
  const t = theme();
  const style: Phaser.Types.GameObjects.Text.TextStyle = {
    fontFamily: opts.font ?? FONT.ui,
    fontSize: `${opts.size ?? TYPE.body}px`,
    color: rgba(opts.color ?? t.ink, opts.alpha ?? 1),
    align: opts.align ?? 'left',
  };
  const fontStyle = [opts.italic ? 'italic' : '', opts.weight && opts.weight !== 400 ? String(opts.weight) : '']
    .filter(Boolean)
    .join(' ');
  if (fontStyle) style.fontStyle = fontStyle;
  if (textResolution !== 1) style.resolution = textResolution;
  const obj = scene.add.text(x, y, opts.caps ? text.toUpperCase() : text, style);
  const spacing = opts.letterSpacing ?? (opts.caps ? dp(1.4) : 0);
  if (spacing) obj.setLetterSpacing(spacing);
  return obj;
}

/**
 * A soft drop shadow for a LIVE shape, faked with stacked translucent
 * rounded rects in the shadow colour — black at night, never tinted.
 *
 * Static chrome should not use this: a baked panel (`glassPanel`,
 * `sheetPanel`, Baked.panel) has a real blurred shadow and costs nothing per
 * frame. This stays for a face that genuinely changes every frame.
 */
export function softShadow(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  strength = 1
): void {
  const u = ui();
  const layers = [
    { spread: pt(7), dy: pt(5), alpha: 0.1 },
    { spread: pt(4), dy: pt(3), alpha: 0.14 },
    { spread: pt(1.5), dy: pt(1.2), alpha: 0.2 },
  ];
  for (const l of layers) {
    g.fillStyle(u.shadow, l.alpha * strength);
    roundRect(g, x - l.spread, y - l.spread + l.dy, w + l.spread * 2, h + l.spread * 2, radius + l.spread);
  }
}

/* ------------------------------------------------------------ surfaces */

export type GlassLevel = 'e1' | 'e2' | 'e3';

/**
 * A smoked-glass panel, baked: chips and tiles at e1, cards at e2, the hero
 * at e3 (SPEC §2.4). Centred on (x, y), its face w × h. A NineSlice, so one
 * texture per look serves every size; resize with `Baked.sizePanel`.
 */
export function glassPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  level: GlassLevel = 'e2',
  radius: number = level === 'e1' ? RADIUS.md : RADIUS.lg
): Panel {
  const extra = level === 'e1' ? 0 : level === 'e2' ? 0.01 : 0.015;
  return panel(scene, `glass-${level}-${Math.round(radius)}`, x, y, w, h, {
    radius,
    face: { kind: 'glass', extra },
    elevation: level,
  });
}

/**
 * The opaque lifted surface every sheet, card-over-a-scrim and toast is made
 * of: the sheet colour, a lit top edge, an e3 shadow. Centred on (x, y).
 */
export function sheetPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number = RADIUS.sheet
): Panel {
  return panel(scene, `sheet-${Math.round(radius)}`, x, y, w, h, {
    ...LOOKS.sheet(),
    radius,
  });
}

/**
 * A sunk well — a track, a locked node, an unearned slot. Centred on (x, y).
 */
export function wellPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number = RADIUS.md
): Panel {
  return panel(scene, `well-${Math.round(radius)}`, x, y, w, h, LOOKS.well(radius));
}

/**
 * A modal scrim: the whole canvas darkened toward the night (never the cream
 * foreground, which would FOG the page), and the page's bands dimmed with it
 * for as long as it lives. `strength` scales the theme's scrim alpha.
 *
 * Interactive, so nothing under it takes a tap; the caller wires what a tap
 * on it does (`dismissOnScrim`) and adds it to its sheet. The DIM is full
 * bleed; the tap area stops `SCRIM_BANNER_CLEAR` over the banner line, like
 * every other control, so the 8 pt rule holds without an exception (nothing
 * tappable is drawn in that band to be shielded from).
 */
export function scrim(
  scene: Phaser.Scene,
  x: number = BASE_WIDTH / 2,
  y: number = viewHeight() / 2,
  strength = 1
): Phaser.GameObjects.Rectangle {
  const u = ui();
  const alpha = Math.min(0.85, u.scrimAlpha * strength);
  const w = BASE_WIDTH * 2;
  const h = scrimHeight();
  const r = scene.add.rectangle(x, y, w, h, u.scrim, alpha);
  // The lowest world y a tap may land on it: the banner line, less the clear.
  const floor = (): number =>
    bannerLine() - canvasInsets(scene.game?.canvas, BASE_WIDTH, viewHeight()).bottom - SCRIM_BANNER_CLEAR;
  // Where its top is in the world: callers put it in a sheet's container.
  const top = (): number => {
    const ty = typeof r.getWorldTransformMatrix === 'function' ? r.getWorldTransformMatrix().ty : r.y;
    return ty - h / 2;
  };
  const area = new Phaser.Geom.Rectangle(0, 0, w, h);
  const fit = (): void => {
    if (r.scene) area.height = Math.max(1, Math.min(h, floor() - top()));
  };
  // Local to the rectangle (its top-left is 0, 0), tested against the floor as
  // it is at the tap — a sheet moves with the world's height (keepCentred).
  r.setInteractive(area, (a: Phaser.Geom.Rectangle, lx: number, ly: number) => {
    return lx >= 0 && lx <= a.width && ly >= 0 && ly <= Math.min(h, floor() - top());
  });
  fit();
  // Placed now; a caller adding it to a container places it again this frame.
  scene.events?.once?.(Phaser.Scenes.Events.POST_UPDATE, fit);
  dimPageWhile(r, alpha, u.scrim);
  return r;
}

/** How far over the banner line a scrim's tap area stops: the house's 8 pt. */
export const SCRIM_BANNER_CLEAR = dp(8);

/**
 * Breathe `target`: the one living thing on a screen (SPEC §2.5.4) — 2.4 s
 * sine, scale 1 → 1.06, alpha 0.6 → 1, forever.
 *
 * Every `repeat: -1` in the game sits behind `motionReduced()` (tech G7):
 * under reduced motion nothing loops, the target is left at its full,
 * settled state, and this returns null.
 */
export function breathe(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.Components.Transform & Phaser.GameObjects.Components.Alpha,
  o: { scale?: number; alphaFrom?: number; period?: number } = {}
): Phaser.Tweens.Tween | null {
  const base = target.scaleX;
  if (motionReduced()) {
    target.setAlpha(1);
    return null;
  }
  const s = o.scale ?? MOTION.breathe.scale;
  target.setAlpha(o.alphaFrom ?? MOTION.breathe.alphaFrom);
  return scene.tweens.add({
    targets: target,
    scaleX: base * s,
    scaleY: base * s,
    alpha: 1,
    duration: (o.period ?? MOTION.breathe.period) / 2,
    ease: 'Sine.easeInOut',
    yoyo: true,
    repeat: -1,
  });
}

/* ------------------------------------------------------------------ glyphs */

/**
 * A mark drawn into a caller's graphics object.
 *
 * Vector rather than emoji or an image: emoji render as full-colour cartoons
 * from a system font that this game has no say over. Every glyph is now one
 * of the pen-line icons (Icons.ts) — a 24-unit grid, a 1.9 stroke, a dot
 * where a line starts — drawn at `GLYPH_SIZE`, so every chip, pill, store row
 * and token that passes one of these picks up the family without a change.
 * The kit itself draws them from the baked atlas wherever it knows the glyph
 * (see `glyphIcon`).
 */
export type Glyph = (
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  color: number,
  alpha: number
) => void;

/** The size a glyph's 24-unit box is drawn at: about the 14 pt the old glyphs stood. */
export const GLYPH_SIZE = dp(19);

/** Which icon each named glyph is, so the kit can use the baked icon instead of live lines. */
const glyphIcons = new WeakMap<Glyph, IconName>();

/** The icon a glyph draws, if it is one of the family. */
export function glyphIcon(glyph: Glyph | undefined): IconName | undefined {
  return glyph ? glyphIcons.get(glyph) : undefined;
}

/**
 * The glyph for any icon of the family: a Glyph for code that draws into its
 * own Graphics. Memoised, so `glyphOf('star') === glyphOf('star')`.
 */
const byName = new Map<IconName, Glyph>();
export function glyphOf(name: IconName): Glyph {
  let g = byName.get(name);
  if (!g) {
    g = (gr, x, y, color, alpha) => drawIcon(gr, name, x, y, GLYPH_SIZE, color, alpha, ICON_STROKE);
    glyphIcons.set(g, name);
    byName.set(name, g);
  }
  return g;
}

/**
 * The reveal: an eye — an almond with a pupil. Every place a reveal is shown —
 * the Reveal pill, the store rows, the balance chip, the tokens that fly into
 * them — draws THIS mark, because what the store sells has to look like the
 * thing it buys.
 */
export const eyeGlyph: Glyph = glyphOf('eye');

/** A video: a screen with a play triangle, for the rewarded row. */
export const videoGlyph: Glyph = glyphOf('video');

/**
 * No ads: a banner with a line through it — the pen's line, starting from its
 * dot. Not an infinity sign: ∞ says "unlimited reveals" and reads as maths
 * next to a price; the struck banner says the half people are buying.
 */
export const noAdsGlyph: Glyph = glyphOf('noAds');

/**
 * The streak: a flame — a leaning outline with a second, smaller tongue off
 * its shoulder, a warm body and an ember at its base.
 *
 * A symmetric round-bottomed shape with one point is a water drop whoever
 * draws it; two tongues and the notch between them are what only a flame has.
 */
export const flameGlyph: Glyph = glyphOf('flame');

/**
 * The flame for a face that is not the page. The 1.4 flame cut its inner
 * tongue out in the face's colour; the pen-line flame has no cut-out — its
 * body is a wash of its own colour — so it reads on any face and this is the
 * same flame. Kept so callers need not change.
 */
export const flameGlyphOn =
  (_face: number): Glyph =>
  (g, x, y, color, alpha) =>
    flameGlyph(g, x, y, color, alpha);

/** A bookmark: the ribbon that keeps a streak's place. */
export const bookmarkGlyph: Glyph = glyphOf('bookmark');

/** A padlock, its keyhole the dot. */
export const lockGlyph: Glyph = glyphOf('lock');

/** Done: a check that starts from the pen's dot. */
export const checkGlyph: Glyph = glyphOf('check');

/**
 * The medal: a filled star in a ring. Stars are the medal now (SPEC §4), so
 * the mark a medal has always been shown by is a star, told apart from a
 * plain clear by shape as well as colour.
 */
export const medalGlyph: Glyph = glyphOf('medal');

/** A star, filled: an earned star. */
export const starGlyph: Glyph = glyphOf('star');

/** A star's outline: one still to earn. */
export const starOutlineGlyph: Glyph = glyphOf('starOutline');

/**
 * Plus. Three rects that do not overlap, so a partial alpha paints evenly —
 * at the pen's weight, with a rounded feel from its short arms.
 */
export const plusGlyph: Glyph = (g, x, y, color, alpha) => {
  const a = GLYPH_SIZE * (6 / 24);
  const b = (GLYPH_SIZE * (ICON_STROKE / 24)) / 2;
  g.fillStyle(color, alpha);
  g.fillRect(x - a, y - b, a * 2, b * 2);
  g.fillRect(x - b, y - a, b * 2, a - b);
  g.fillRect(x - b, y + b, b * 2, a - b);
};
glyphIcons.set(plusGlyph, 'plus');

/* ----------------------------------------------------------------- button */

export interface ButtonOptions {
  width: number;
  height?: number;
  /**
   * `primary` is the one thing a screen is for: the tangerine gradient with
   * its lamp glow and dark ink. `secondary` is smoked glass. `accent` is the
   * inviting one — a tangerine wash with an outline and ember caption — for
   * the offer a screen exists to make, where primary would outshout the page.
   * `ghost` is bare until pressed.
   */
  variant?: 'primary' | 'secondary' | 'ghost' | 'accent';
  size?: number;
  sub?: string;
  /**
   * A small caps tag ("NEW", "BEST VALUE") on the top-right corner, straddling
   * the edge — see `tag`. It is part of the button, so it moves, dips and goes
   * with it; `setButtonBadge` changes or removes it.
   */
  badge?: string;
  /**
   * A mark on the left, with the text still centred in the space that is left.
   *
   * The label is NOT shifted to make room. A row of icons down the left edge
   * with ragged captions beside them is harder to compare than centred text,
   * and comparing rows is the only thing a store card is for.
   */
  icon?: Glyph;
  /**
   * Keep the TAP area at least `minTap` tall, leaving the face as drawn — at
   * whatever scale the canvas is drawn, through every resize. Callers set it
   * where the painted height is a design choice below the thumb's floor, or
   * sits right at it; the caller also owns checking that the grown rectangle
   * does not reach a neighbour's.
   */
  minTap?: boolean;
  /**
   * With `minTap`, the tallest the tap area may grow: the room the caller left
   * for it, in base units. The floor gives way here rather than reach a
   * neighbour — see `tappable`.
   */
  maxTap?: number;
  onPress: () => void;
}

/** Child names, so a caption can be found again after the button is built. */
const BUTTON_LABEL = 'button-label';
const BUTTON_SUB = 'button-sub';
const BUTTON_BADGE = 'button-badge';

/** Where the caption sits with a second line under it, and without one. */
const LABEL_Y_WITH_SUB = -pt(9);

/** How a button's words are set, kept so a caption or line can be made after the build. */
interface ButtonWords {
  readonly ink: number;
  readonly size: number;
  readonly alpha: number;
  readonly subAlpha: number;
}
const BUTTON_WORDS = new WeakMap<Phaser.GameObjects.Container, ButtonWords>();

/*
 * The caption and the second line are made only when they have words. A Text
 * is a canvas and a texture upload — about 1.2 ms each at the 4× CPU proxy —
 * and the menu alone builds eight caption-less buttons (cards, tiles, the
 * strip, •••): an empty caption and an empty line on each was 16 ms of its
 * create (tech G13). A late caption or line is made on first use.
 */
function buttonCaption(container: Phaser.GameObjects.Container, text: string, y: number): Phaser.GameObjects.Text | null {
  const w = BUTTON_WORDS.get(container);
  if (!w) return null;
  const main = label(container.scene, 0, y, text, {
    size: w.size,
    color: w.ink,
    alpha: w.alpha,
    font: FONT.ui,
    weight: 600,
  })
    .setOrigin(0.5)
    .setName(BUTTON_LABEL);
  addUnderBadge(container, main);
  return main;
}

function buttonSubLine(container: Phaser.GameObjects.Container, text: string): Phaser.GameObjects.Text | null {
  const w = BUTTON_WORDS.get(container);
  if (!w) return null;
  const sub = label(container.scene, 0, pt(13), text, {
    size: TYPE.label,
    color: w.ink,
    alpha: w.subAlpha,
    weight: 500,
  })
    .setOrigin(0.5)
    .setName(BUTTON_SUB);
  addUnderBadge(container, sub);
  return sub;
}

/** Words made late still draw under the corner tag, as they would have from the build. */
function addUnderBadge(container: Phaser.GameObjects.Container, o: Phaser.GameObjects.GameObject): void {
  const badge = container.getByName(BUTTON_BADGE);
  const at = badge ? container.getIndex(badge) : -1;
  if (at >= 0) container.addAt(o, at);
  else container.add(o);
}

/**
 * Rewrite a live button's caption, or the second line under it.
 *
 * For the one case where the text is not knowable when the button is built: a
 * store price arrives from StoreKit a second or so after the sheet offering it
 * is already on screen. Rebuilding the sheet would flash it; a silent relabel
 * is what the player expects a price to do.
 *
 * Both are no-ops if the container is not a button — a caller that has
 * destroyed the sheet in the meantime must not throw from a late callback.
 */
export function setButtonText(
  container: Phaser.GameObjects.Container | null,
  text: string
): void {
  if (!container || !container.scene) return;
  const main = container.getByName(BUTTON_LABEL);
  if (main instanceof Phaser.GameObjects.Text) {
    main.setText(text);
    return;
  }
  if (text === '') return;
  const sub = container.getByName(BUTTON_SUB);
  const withSub = sub instanceof Phaser.GameObjects.Text && sub.visible;
  buttonCaption(container, text, withSub ? LABEL_Y_WITH_SUB : 0);
}

/**
 * Every button can take a second line, whether or not it was built with one.
 *
 * It used to work only when the button was BUILT with one. A pack row drawn
 * before StoreKit had answered has no price and so no second line, which
 * made this call silently do nothing: on the first Store visit after launch
 * the three packs stayed bare "10 reveals" for good while Remove ads — whose
 * second line always has text — filled its price in. So the line is made on
 * the first call that has words for it, the caption moves up to make room
 * when a line arrives, and back down if one is cleared.
 */
export function setButtonSub(
  container: Phaser.GameObjects.Container | null,
  text: string
): void {
  if (!container || !container.scene) return;
  const found = container.getByName(BUTTON_SUB);
  const main = container.getByName(BUTTON_LABEL);
  const sub = found instanceof Phaser.GameObjects.Text ? found : text !== '' ? buttonSubLine(container, text) : null;
  if (!sub) return;
  sub.setText(text).setVisible(text !== '');
  if (main instanceof Phaser.GameObjects.Text) {
    main.setY(text !== '' ? LABEL_Y_WITH_SUB : 0);
  }
}

/**
 * Put a tag on a live button's corner, replace the one there, or (`null`)
 * take it off. A no-op on anything that is not a live button.
 */
export function setButtonBadge(
  container: Phaser.GameObjects.Container | null,
  text: string | null
): void {
  if (!container || !container.scene) return;
  container.getByName(BUTTON_BADGE)?.destroy();
  if (text) placeBadge(container, text);
}

function placeBadge(container: Phaser.GameObjects.Container, text: string): void {
  const badge = tag(container.scene, 0, 0, text);
  // Its right end a corner-radius in from the button's, riding the top edge.
  badge.setPosition(container.width / 2 - RADIUS.md - badge.width / 2, -container.height / 2);
  badge.setName(BUTTON_BADGE);
  container.add(badge);
}

/**
 * The alpha of a button's second line, of the face's own text colour.
 *
 * The prices and the Daily's streak live on this line — the one line on a
 * store row the player has to read before paying — so it is held to the 4.5:1
 * body floor on its face, at rest and pressed (UI.toast.test). On glass the
 * cream at 0.78 is far over it and still a step under the caption. On the
 * tangerine primary the dark ink needs 0.9 to hold the floor under the press
 * tint; on the accent face the ember goes at full strength — the step under
 * the caption is carried by the size alone there.
 */
export function buttonSubAlpha(variant: ButtonOptions['variant'] = 'primary'): number {
  return variant === 'accent' ? 1 : variant === 'primary' ? 0.9 : 0.78;
}

/** The face each variant is baked as, or null for the ghost's bare rest. */
export function buttonFace(variant: NonNullable<ButtonOptions['variant']>): PanelSpec | null {
  const t = theme();
  const u = ui();
  switch (variant) {
    case 'primary':
      return {
        radius: RADIUS.md,
        face: { kind: 'vertical', top: u.accentTop, bottom: u.accentBottom },
        glow: { color: t.accent, alpha: 0.5, blur: dp(22), dy: dp(8) },
        outline: { color: t.accent, alpha: 0.3, width: 2 },
      };
    case 'secondary':
      return { radius: RADIUS.md, face: { kind: 'glass' }, elevation: 'e1' };
    case 'accent':
      return {
        radius: RADIUS.md,
        face: { kind: 'solid', color: t.accent, alpha: t.accentWash },
        outline: { color: t.accent, alpha: 0.9, width: pt(1.5) },
      };
    default:
      return null;
  }
}

/** The text colour on each variant's face. */
export function buttonInk(variant: NonNullable<ButtonOptions['variant']>): number {
  const t = theme();
  if (variant === 'primary') return ui().onAccent;
  if (variant === 'accent') return t.accentText;
  return t.ink;
}

/**
 * The primary face: the tangerine gradient, its lamp glow below it, and the
 * bevel a lit button has — a white hairline along the top inside, a darker
 * band along the bottom inside.
 */
function paintPrimary(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, spec: PanelSpec): void {
  paintPanel(ctx, x, y, w, h, spec);
  const r = Math.min(spec.radius, w / 2, h / 2);
  const inside = (fn: () => void): void => {
    ctx.save();
    ctx.beginPath();
    const pts = roundRectPoints(x, y, w, h, r, 16);
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.clip();
    fn();
    ctx.restore();
  };
  inside(() => {
    const top = ctx.createLinearGradient(0, y, 0, y + 3);
    top.addColorStop(0, 'rgba(255,255,255,0.35)');
    top.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = top;
    ctx.fillRect(x, y, w, 3);
    const bottom = ctx.createLinearGradient(0, y + h - 4, 0, y + h);
    bottom.addColorStop(0, 'rgba(120,30,0,0)');
    bottom.addColorStop(1, 'rgba(120,30,0,0.35)');
    ctx.fillStyle = bottom;
    ctx.fillRect(x, y + h - 4, w, 4);
  });
}

/** A baked button face centred on the origin, `w` × `h`. */
function buttonFacePanel(
  scene: Phaser.Scene,
  variant: NonNullable<ButtonOptions['variant']>,
  w: number,
  h: number
): Panel | null {
  const spec = buttonFace(variant);
  if (!spec) return null;
  if (variant === 'primary') {
    // Stretched across only: its gradient runs top to bottom, so one bake per
    // HEIGHT serves every width.
    return bakedPanel(scene, 'btn-primary', w, h, (ctx, x, y, bw, bh) => paintPrimary(ctx, x, y, bw, bh, spec), {
      pad: panelPad(spec),
      slice: Math.ceil(spec.radius) + 1,
      stretchX: true,
    });
  }
  return panel(scene, `btn-${variant}`, 0, 0, w, h, spec);
}

/**
 * A pressable card. Returns a Container so callers can position, tween and
 * destroy it as one thing.
 *
 * The press animation is a scale dip with a spring back, the face dipping a
 * shade with it — motion reads as responsive where a colour flash reads as
 * noise.
 */
export function button(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: ButtonOptions
): Phaser.GameObjects.Container {
  const variant = opts.variant ?? 'primary';
  const w = opts.width;
  const h = opts.height ?? (opts.sub ? pt(66) : pt(54));

  const container = scene.add.container(x, y);
  const face = buttonFacePanel(scene, variant, w, h);
  // The ghost has no face at rest; under the thumb it shows glass.
  const ghostFace = variant === 'ghost' ? glassPanel(scene, 0, 0, w, h, 'e1').setVisible(false) : null;
  if (face) container.add(face);
  if (ghostFace) container.add(ghostFace);

  const tint = variant === 'primary' ? PRESS_TINT.light : PRESS_TINT.dark;
  const paint = (pressed: boolean): void => {
    if (face) {
      if (pressed) face.setTint(tint);
      else face.clearTint();
    }
    ghostFace?.setVisible(pressed);
  };

  const ink = buttonInk(variant);
  const labelY = opts.sub ? LABEL_Y_WITH_SUB : 0;
  if (opts.icon) {
    const glyphColor = variant === 'primary' ? ink : theme().accentText;
    const name = glyphIcon(opts.icon);
    if (name) {
      container.add(icon(scene, -w / 2 + pt(24), 0, name, { size: GLYPH_SIZE, color: glyphColor, alpha: 0.95 }));
    } else {
      /*
       * Its own graphics object, not the face's: a mark drawn into something
       * repainted on every press would vanish the moment it was touched.
       */
      const mark = scene.add.graphics();
      opts.icon(mark, -w / 2 + pt(24), 0, glyphColor, 0.95);
      container.add(mark);
    }
  }

  BUTTON_WORDS.set(container, {
    ink,
    size: opts.size ?? TYPE.heading,
    alpha: variant === 'primary' || variant === 'accent' ? 1 : 0.94,
    subAlpha: buttonSubAlpha(variant),
  });
  // Named so a caller can rewrite them in place — see `setButtonText` and
  // `setButtonSub`, which also make them when the build had no words.
  if (text !== '') buttonCaption(container, text, labelY);
  if (opts.sub) buttonSubLine(container, opts.sub);

  container.setSize(w, h);
  const tapH = tappable(container, w, h, opts.minTap === true, opts.maxTap);
  if (opts.badge) placeBadge(container, opts.badge);

  wirePress(container, () => w, tapH, paint, opts.onPress);
  return container;
}

/**
 * Make a centre-drawn, already tappable container act as a button: it dips
 * while pressed and fires `onPress` on a release that is a real tap.
 *
 * Arm on the container's own pointerdown, but resolve on the SCENE's pointerup.
 *
 * The obvious version — fire on the button's `pointerup`, cancel on
 * `pointerout` — is unusable on touch. A finger always slides a few pixels
 * between press and release, Phaser emits `pointerout` the moment it leaves
 * the hit rectangle, and the press is cancelled. The button then needs two or
 * three stabs to register, which is exactly what it felt like.
 *
 * So movement is judged by DISTANCE, not by the hit area, with a slop
 * generous enough for a real thumb. That is also what UIKit does, and it is
 * why native buttons never feel like this.
 */
function wirePress(
  container: Phaser.GameObjects.Container,
  width: () => number,
  tapH: () => number,
  paint: (pressed: boolean) => void,
  onPress: () => void
): void {
  const scene = container.scene;
  let armed = false;
  let downX = 0;
  let downY = 0;
  setRestScale(container, 1);

  const settle = (): void => {
    paint(false);
    scene.tweens.add({ targets: container, scale: 1, duration: ms(320), ease: 'Back.easeOut' });
  };

  container.on('pointerdown', (p: Phaser.Input.Pointer) => {
    armed = true;
    const at = worldPoint(p);
    downX = at.x;
    downY = at.y;
    paint(true);
    stopPulse(container);
    scene.tweens.add({ targets: container, scale: 0.965, duration: ms(90), ease: 'Quad.easeOut' });
  });

  const onUp = (p: Phaser.Input.Pointer): void => {
    if (!armed) return;
    armed = false;
    settle();

    // A touch the system cancelled — the phone folded or rotated under the
    // finger, an alert came up — reaches us as a pointer-up too. Not a tap.
    if (p.wasCanceled) return;
    const at = worldPoint(p);
    if (Phaser.Math.Distance.Between(downX, downY, at.x, at.y) > TAP_SLOP) return;

    // Still require the release to land on the button, so dragging off it to
    // cancel — which people expect — keeps working.
    //
    // Measured from the button's WORLD position. `container.x/y` are relative to
    // the parent, and the pointer is in world space: for a button placed straight
    // on the scene the two agree, but for one inside a container — every button
    // on the Settings sheet — the rectangle sat around the sheet's origin, no
    // release ever landed in it, and Leaderboard, Achievements, Rate this game
    // and Privacy choices all did nothing. The press animation scales the
    // container, so the untransformed w/h are used, not getBounds() — and the
    // TAP height, so a release is judged by the same rectangle as the press.
    const world = container.getWorldTransformMatrix();
    const w = width();
    const hitH = tapH();
    const b = new Phaser.Geom.Rectangle(world.tx - w / 2, world.ty - hitH / 2, w, hitH);
    if (!b.contains(at.x, at.y)) return;

    onPress();
  };

  scene.input.on(Phaser.Input.Events.POINTER_UP, onUp);
  container.once('destroy', () => {
    scene.input.off(Phaser.Input.Events.POINTER_UP, onUp);
  });
}

/* ----------------------------------------------------------- tags, chips */

/**
 * A small caps pill in the accent, with dark ink: "NEW", "BEST VALUE".
 *
 * Centred on (x, y) and sized to its text; `.width` / `.height` are set, so a
 * caller can align it by an edge. Not interactive — it labels something that
 * is.
 */
export function tag(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string
): Phaser.GameObjects.Container {
  const t = theme();
  const c = scene.add.container(x, y);
  const caption = label(scene, 0, 0, text.toUpperCase(), {
    size: TYPE.micro * 0.9,
    color: ui().onAccent,
    letterSpacing: pt(0.6),
    weight: 700,
  }).setOrigin(0.5);
  const w = Math.ceil(caption.width) + pt(12);
  const h = pt(17);
  const face = panel(scene, 'tag', 0, 0, w, h, {
    radius: h / 2,
    face: { kind: 'solid', color: t.accent },
  });
  c.add([face, caption]);
  c.setSize(w, h);
  return c;
}

export interface ChipOptions {
  glyph: Glyph;
  text: string;
  /**
   * An accent disc with a "+" at the right end: the chip is also the way to
   * get more of what it counts. Only where that is true — a "+" that opens
   * nothing is a lie the player learns in one tap.
   */
  plus?: boolean;
  /** Fixed width. Without it the chip fits its text, and refits on `setChipText`. */
  width?: number;
  /** An accent dot on the top-right corner: something here wants a look. */
  dot?: boolean;
  /**
   * Where `x` is: the chip's centre (default), or its left or right edge.
   * A fitted chip keeps that edge where it is when its text changes, so a
   * top-bar chip grows away from the screen edge it is set against.
   */
  align?: 'left' | 'center' | 'right';
  /** Makes the chip a button. Without it the chip is a display only. */
  onPress?: () => void;
  /** The tallest the `minTap` floor may grow the tap area — see `tappable`. */
  maxTap?: number;
  /**
   * The mark's colour: the ember (default) for the economy's marks — flame,
   * eye — or the quiet secondary text for a mark that only labels.
   */
  glyphColor?: number;
}

interface ChipState {
  opts: ChipOptions;
  w: number;
  text: Phaser.GameObjects.Text;
  face: Panel;
  repaint: () => void;
  refit: (() => void) | null;
}

const chips = new WeakMap<Phaser.GameObjects.Container, ChipState>();

const CHIP_H = dp(36);
const CHIP_PAD = pt(12);
const CHIP_GLYPH = pt(15);
const CHIP_GAP = pt(6);
const CHIP_PLUS_R = dp(13);

/** The chip's width for `text`, when it fits its text. */
function chipFit(state: { opts: ChipOptions; text: Phaser.GameObjects.Text }): number {
  const { opts, text } = state;
  if (opts.width !== undefined) return opts.width;
  const right = opts.plus ? CHIP_GAP + CHIP_PLUS_R * 2 + pt(4) : pt(14);
  return Math.max(CHIP_H, Math.ceil(CHIP_PAD + CHIP_GLYPH + CHIP_GAP + text.width + right));
}

/**
 * A glass pill that shows a count with its mark — the reveal balance, the
 * streak.
 *
 * dp(36) tall, smoked glass at e1, text left-aligned after the mark so a count
 * that grows a digit grows away from it. A chip with `onPress` is a button:
 * the tap area is floored at `minTap` (capped by `maxTap`) and follows the
 * chip's width as its text changes.
 */
export function chip(
  scene: Phaser.Scene,
  x: number,
  y: number,
  o: ChipOptions
): Phaser.GameObjects.Container {
  const t = theme();
  const u = ui();
  const c = scene.add.container(x, y);
  const text = label(scene, 0, 0, o.text, { size: TYPE.label, alpha: 0.95, weight: 600 }).setOrigin(0, 0.5);
  const probe = { opts: { ...o }, text };
  const w0 = chipFit(probe);
  const face = glassPanel(scene, 0, 0, w0, CHIP_H, 'e1', CHIP_H / 2);
  const glyphColor = o.glyphColor ?? t.accentText;
  const name = glyphIcon(o.glyph);
  const mark: Phaser.GameObjects.Image | Phaser.GameObjects.Graphics = name
    ? icon(scene, 0, 0, name, { size: GLYPH_SIZE * 0.95, color: glyphColor })
    : scene.add.graphics();
  const plus = o.plus
    ? [
        panel(scene, 'chip-plus', 0, 0, CHIP_PLUS_R * 2, CHIP_PLUS_R * 2, {
          radius: CHIP_PLUS_R,
          face: { kind: 'solid', color: t.accent },
        }),
        icon(scene, 0, 0, 'plus', { size: dp(15), color: u.onAccent }),
      ]
    : [];
  const dot = scene.add.graphics();
  c.add([face, mark, text, ...plus, dot]);

  let pressed = false;
  const state: ChipState = { opts: { ...o }, w: w0, text, face, repaint: () => {}, refit: null };

  state.repaint = (): void => {
    const w = state.w;
    const h = CHIP_H;
    if (!sizePanel(face, w, h)) face.setDisplaySize(w, h);
    if (pressed) face.setTint(PRESS_TINT.dark);
    else face.clearTint();

    const left = -w / 2 + CHIP_PAD;
    if (mark instanceof Phaser.GameObjects.Graphics) {
      mark.clear();
      state.opts.glyph(mark, left + CHIP_GLYPH / 2, 0, glyphColor, 0.95);
    } else {
      mark.setPosition(left + CHIP_GLYPH / 2, 0);
    }
    text.setX(left + CHIP_GLYPH + CHIP_GAP);
    if (plus.length) {
      const px = w / 2 - pt(4) - CHIP_PLUS_R;
      for (const p of plus) p.setPosition(px, 0);
    }
    dot.clear();
    if (state.opts.dot) {
      // Ringed in the sky so it stays a separate mark where it overlaps the edge.
      const dx = w / 2 - pt(5);
      const dy = -h / 2 + pt(5);
      dot.fillStyle(t.paper, 1);
      dot.fillCircle(dx, dy, pt(5.5));
      dot.fillStyle(t.accent, 1);
      dot.fillCircle(dx, dy, pt(4));
    }
  };
  state.repaint();
  c.setSize(state.w, CHIP_H);

  // `x` named an edge: the container's own x is always the centre.
  if (o.align === 'left') c.x = x + state.w / 2;
  else if (o.align === 'right') c.x = x - state.w / 2;

  if (o.onPress) {
    const area = tapArea(
      c,
      () => ({ w: state.w, h: CHIP_H }),
      true,
      o.maxTap ?? Number.POSITIVE_INFINITY
    );
    state.refit = area.refit;
    const paint = (down: boolean): void => {
      pressed = down;
      state.repaint();
    };
    wirePress(c, () => state.w, area.tapH, paint, o.onPress);
  }

  chips.set(c, state);
  return c;
}

/**
 * Rewrite a chip's text. A chip that fits its text is re-measured, keeps the
 * edge it was aligned to, and moves its tap area with it. A no-op on anything
 * that is not a live chip.
 */
export function setChipText(c: Phaser.GameObjects.Container, text: string): void {
  const state = chips.get(c);
  if (!state || !c.scene) return;
  if (state.text.text === text) return;
  state.text.setText(text);
  relayoutChip(c, state);
}

/** Show or hide a chip's accent dot. */
export function setChipDot(c: Phaser.GameObjects.Container, dot: boolean): void {
  const state = chips.get(c);
  if (!state || !c.scene || !!state.opts.dot === dot) return;
  state.opts.dot = dot;
  state.repaint();
}

/** A chip's painted width right now, for laying out its neighbours. 0 for a non-chip. */
export function chipWidth(c: Phaser.GameObjects.Container): number {
  return chips.get(c)?.w ?? 0;
}

function relayoutChip(c: Phaser.GameObjects.Container, state: ChipState): void {
  const was = state.w;
  state.w = chipFit(state);
  if (state.w !== was) {
    const align = state.opts.align ?? 'center';
    if (align === 'left') c.x += (state.w - was) / 2;
    else if (align === 'right') c.x -= (state.w - was) / 2;
    c.setSize(state.w, CHIP_H);
    state.refit?.();
  }
  state.repaint();
}

/* ------------------------------------------------------------------ misc */

/** A hairline rule, for separating sections without drawing a box. */
export function rule(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  alpha: number = ui().hairAlpha
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(theme().ink, alpha);
  g.fillRect(x - w / 2, y, w, Math.max(1, pt(0.5)));
  return g;
}

/**
 * The wordmark alone: "foldwing" in Georgia, its bottom at (x, y).
 *
 * It used to carry its own reflection under it. The stacked lockup's mark
 * shows the mirror now (Logo.ts), so the reflected word is retired here too
 * and every screen that still calls this gets the plain word.
 */
export function wordmark(
  scene: Phaser.Scene,
  x: number,
  y: number
): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  const top = label(scene, 0, 0, 'foldwing', {
    size: TYPE.hero,
    color: ui().text,
    font: FONT.display,
    letterSpacing: -Math.round(dp(0.3)),
  }).setOrigin(0.5, 1);
  c.add(top);
  return c;
}

/**
 * Standard page entrance: content rises a few points and settles in — the
 * settle curve, top-down, `stagger` ms apart.
 */
export function enter(
  scene: Phaser.Scene,
  targets: Phaser.GameObjects.GameObject[],
  stagger: number = MOTION.stagger.ms
): void {
  targets.forEach((obj, i) => {
    const o = obj as unknown as Phaser.GameObjects.Components.Transform &
      Phaser.GameObjects.Components.Alpha;
    const restY = o.y;
    o.y = restY + dp(MOTION.stagger.rise);
    o.alpha = 0;
    scene.tweens.add({
      targets: o,
      y: restY,
      alpha: 1,
      duration: ms(MOTION.settle.ms + 60),
      delay: ms(i * stagger),
      ease: MOTION.settle.ease,
    });
  });
}

/** Width of a comfortable content column, inset from the canvas edges. */
export const COLUMN = BASE_WIDTH - METRICS.inset.left * 2 - pt(16) * 2;

/**
 * The header every browsing screen wears: the back chevron and the title on
 * one line, the count under it, and the top of the scrolling list.
 *
 * Levels and Gallery each carried their own numbers — 52/90/120 against
 * 56/96/126 — so moving between the two screens made the whole header jump
 * by a few points, which reads as the page not being finished. One set now,
 * and it is the Levels one: the menu's ••• already sits at `y` on purpose.
 */
export const HEADER = {
  y: pt(52),
  subY: pt(90),
  listTop: pt(120),
} as const;

/**
 * Where a scrolling list stops at the bottom of a canvas `height` tall.
 *
 * Short of the banner when one can show — a card under a native banner can be
 * seen and never tapped. With no banner at all (an ads-off build, a Remove Ads
 * owner, a player who withheld consent) that reserve was an empty band with the
 * last row cut off above it, so the list looked truncated. It runs to the
 * canvas edge then, the way a list does on every other screen of the phone.
 *
 * On a taller world (Theme.adaptiveHeight) the window runs further down, so a
 * list shows MORE rows, never bigger ones: the top stays under the header.
 */
export function listBottom(bannerCanShow: boolean, height: number = viewHeight()): number {
  return bannerCanShow ? bannerLine(height) - pt(6) : height;
}

/**
 * Keep a centred sheet centred when the world's height changes under it (a
 * fold, Split View, a rotation — never on a phone held still). Every sheet
 * is centred in a band that runs from under the status bar to over the
 * banner's reserve, and both ends of that band are anchored to the canvas's
 * edges, so its centre moves by half the change: so does the sheet. Its
 * scrim goes with it, which is why every scrim is drawn twice the height it
 * covers (see `scrimHeight`). Nothing is rebuilt, so nothing the player has
 * open — a purchase in flight, a toggle half pressed — is lost.
 *
 * The listener goes with the sheet. Returns the sheet, for chaining.
 */
export function keepCentred<T extends Phaser.GameObjects.Container>(sheet: T): T {
  const scene = sheet.scene;
  let built = viewHeight();
  const follow = (): void => {
    const now = viewHeight();
    if (now === built || !sheet.scene) return;
    sheet.y += (now - built) / 2;
    built = now;
  };
  scene.scale.on(Phaser.Scale.Events.RESIZE, follow);
  sheet.once(Phaser.GameObjects.Events.DESTROY, () => {
    scene.scale.off(Phaser.Scale.Events.RESIZE, follow);
  });
  return sheet;
}

/** How long the world's height has to hold still before a screen rebuilds for it. */
export const REBUILD_SETTLE_MS = 250;

/**
 * Rebuild a screen when the world's height changes under it (Theme.viewHeight
 * — a fold, Split View, a rotation). A list screen is laid out once: its
 * scroll window and its clipping camera are fixed at build, so a taller world
 * means rebuilding it with more rows in the window, not stretching it.
 *
 * Once the height has held still for REBUILD_SETTLE_MS — a Split View divider
 * drags through many sizes — and never while `busy()` (a sheet the player is
 * reading, a share in flight). Returns the check, for the caller to run again
 * when whatever was busy ends. The listener goes with the scene.
 */
export function watchHeight(
  scene: Phaser.Scene,
  rebuild: () => void,
  busy: () => boolean = () => false
): () => void {
  const built = viewHeight();
  let settle: Phaser.Time.TimerEvent | null = null;
  const check = (): void => {
    if (!scene.sys.isActive() || busy() || viewHeight() === built) return;
    rebuild();
  };
  const onResize = (): void => {
    settle?.remove();
    settle = scene.time.delayedCall(REBUILD_SETTLE_MS, () => {
      settle = null;
      check();
    });
  };
  scene.scale.on(Phaser.Scale.Events.RESIZE, onResize);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.scale.off(Phaser.Scale.Events.RESIZE, onResize);
    settle?.remove();
    settle = null;
  });
  return check;
}

/**
 * Keep a list's window out of the banner's reserve while the world is shorter
 * than the list was built for — AT ONCE, on the resize itself, where
 * `watchHeight`'s rebuild waits for the height to hold (REBUILD_SETTLE_MS) and
 * for anything `busy` (the Gallery's share) to end.
 *
 * The window — the clipping camera's scissor and the rows the list takes
 * presses on (ScrollView.clip) — was built down to `bottom`, the listBottom
 * of its day. After a shrink the reserve's line moves up over the last rows at
 * once, and so does the native banner: a card left drawn there is under the
 * ad, and a thumb aimed at it presses the ad. So the window is cut to the new
 * listBottom until the rebuild, and never grown past the one built: below it
 * there are no rows yet. The GameScene needs none of this — its bottom band
 * is re-laid out on the resize itself.
 */
export function holdListWindow(
  scene: Phaser.Scene,
  camera: Phaser.Cameras.Scene2D.Camera,
  view: Pick<ScrollView, 'clip'>,
  top: number,
  bottom: number,
  bannerCanShow: boolean
): void {
  const follow = (): void => {
    const now = Math.min(bottom, listBottom(bannerCanShow));
    camera.setSize(camera.width, Math.max(0, now - top));
    view.clip(now);
  };
  scene.scale.on(Phaser.Scale.Events.RESIZE, follow);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.scale.off(Phaser.Scale.Events.RESIZE, follow);
  });
}

/**
 * The height a full-screen scrim is drawn at, centred on the canvas: twice
 * the world's, so a sheet moved by `keepCentred` — half of any change, and the
 * world never more than MAX_HEIGHT / BASE_HEIGHT taller — still covers it all.
 */
export function scrimHeight(): number {
  return viewHeight() * 2;
}

/* ----------------------------------------------------------------- modals */

/**
 * How long a sheet's backdrop ignores presses after the sheet opens.
 *
 * Every sheet opens on a RELEASE, and the control that opened it is usually
 * under the backdrop the moment it appears. So the second tap of a double tap
 * — on Reveal, on the menu's Store row — landed on the backdrop and closed
 * the sheet it had just opened: the player saw a flash, or nothing. Nobody
 * reads a sheet and dismisses it inside this window on purpose.
 */
export const MODAL_GUARD_MS = 350;

/**
 * Close a sheet when its backdrop is tapped — tapped, not merely released on.
 *
 * The backdrop used to close on any pointerup over it. A row on the sheet
 * dips to 0.965 while pressed, and Phaser hit-tests that shrunken face, so a
 * normal tap within a few points of a row's edge released onto the backdrop:
 * the sheet closed and destroyed the row before the row's own release could
 * buy anything. Only a press that STARTED on the backdrop, after the guard,
 * may dismiss; anything else resolves through the control it began on.
 */
export function dismissOnScrim(
  scrim: Phaser.GameObjects.GameObject,
  onClose: () => void
): void {
  // Wall-clock time, not the scene's: a double tap is a human interval, and
  // the scene clock falls behind it whenever frames run long.
  const openedAt = performance.now();
  let pressedAt = -1;
  scrim.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, (p: Phaser.Input.Pointer) => {
    pressedAt = performance.now() - openedAt >= MODAL_GUARD_MS ? p.downTime : -1;
  });
  scrim.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, (p: Phaser.Input.Pointer) => {
    if (pressedAt < 0 || p.downTime !== pressedAt) return;
    pressedAt = -1;
    onClose();
  });
}

/**
 * An invisible block that takes the taps landing on a sheet's card.
 *
 * The cards are plain Graphics, so a tap on a title, the padding or the gap
 * between two rows fell through to the full-screen backdrop and closed the
 * whole sheet — a player who missed a toggle by a few points lost Settings.
 * Add it right after the card, before the controls, so the controls stay on
 * top of it. It does not stop propagation: a press that began on a row and
 * drifted onto the card must still reach the row's release.
 */
export function cardBlocker(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number
): Phaser.GameObjects.Zone {
  return scene.add.zone(x, y, w, h).setInteractive();
}

/** A game-object pointer handler that ends the event there: nothing under it, scene listeners included, sees it. */
const swallowEvent = (
  _p: Phaser.Input.Pointer,
  _x: number,
  _y: number,
  e: Phaser.Types.Input.EventData
): void => e.stopPropagation();

/**
 * Swallow every tap for a moment, over the whole canvas.
 *
 * For the instant after a sheet row fires. The row closes its sheet on the
 * release, so nothing was left to absorb the second tap of a double tap, and
 * it landed on whatever the sheet had covered: "20 reveals" bought AND
 * started the level whose Continue button sat underneath.
 */
export function shieldInput(scene: Phaser.Scene, duration = 300): void {
  const shield = scene.add
    .zone(BASE_WIDTH / 2, viewHeight() / 2, BASE_WIDTH * 2, scrimHeight())
    .setDepth(10_000)
    .setInteractive();
  shield.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, swallowEvent);
  shield.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, swallowEvent);
  // Wall clock, like the scrim guard; the scene may be gone by then.
  window.setTimeout(() => {
    if (shield.scene) shield.destroy();
  }, duration);
}

/**
 * Draw an overlay with the main camera only.
 *
 * Levels and Gallery clip their grid with a second camera, and every object
 * not told otherwise is drawn by BOTH. A sheet opened there was composited
 * twice inside the grid window — a darker band with hard edges at the header
 * and above the banner, and a doubled shadow. LevelSelect's own comment warns
 * about exactly this for anything added late; overlays are always added late.
 *
 * The main camera then has to render LAST, or a camera drawn after it paints
 * its own content over the overlay — GalleryScene reorders its cameras so.
 */
export function mainCameraOnly(
  scene: Phaser.Scene,
  obj: Phaser.GameObjects.GameObject
): void {
  const main = scene.cameras.main;
  for (const cam of scene.cameras.cameras) {
    if (cam !== main) cam.ignore(obj);
  }
}

/*
 * The page behind the canvas, dimmed with it.
 *
 * The canvas fits inside the safe area, and the bands outside it — over the
 * status bar, around the banner, a wide shape's desk — are the page's own
 * background, which no Phaser object can reach. Every scrim therefore dimmed
 * the canvas and left the bands bright, with hard edges. The page carries an
 * overlay for exactly this (index.html: `body::after`, under the canvas) and
 * it takes the colour and alpha the scrims composite to, handing them back
 * when the last one goes. Counted, not toggled: a progress card can open over
 * a sheet, and closing the one on top must not un-dim the one still under it.
 *
 * An overlay rather than the page's colour, because the page is the sky — a
 * gradient — and a colour cannot dim a gradient; a translucent layer over it
 * dims it exactly as the scrim dims the canvas's copy of the same sky.
 */
const pageDims: { id: number; alpha: number; color: number }[] = [];
let pageDimSeq = 0;

/**
 * Several translucent layers over an unknown page, as ONE layer: the colour
 * and alpha of their composite. Pure, so the stacking rule is tested.
 */
export function compositeDims(layers: readonly { alpha: number; color: number }[]): { alpha: number; color: number } {
  let alpha = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (const d of layers) {
    const a = Math.min(1, Math.max(0, d.alpha));
    // Premultiplied "over": the new layer on top of what is already there.
    r = ((d.color >> 16) & 0xff) * a + r * (1 - a);
    g = ((d.color >> 8) & 0xff) * a + g * (1 - a);
    b = (d.color & 0xff) * a + b * (1 - a);
    alpha = a + alpha * (1 - a);
  }
  if (alpha <= 0) return { alpha: 0, color: 0 };
  const c = (v: number): number => Math.min(255, Math.max(0, Math.round(v / alpha)));
  return { alpha, color: (c(r) << 16) | (c(g) << 8) | c(b) };
}

function paintPage(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (pageDims.length === 0) {
    // '' hands the page back to index.html rather than restating it here.
    root.style.removeProperty('--fw-dim');
    return;
  }
  const { alpha, color } = compositeDims(pageDims);
  root.style.setProperty('--fw-dim', rgba(color, Math.round(alpha * 1000) / 1000));
}

/**
 * Tint the page as a scrim of `alpha` in `color` would. The colour defaults
 * to the foreground, as it always has, for the scrims still drawn in it;
 * `scrim()` passes the night's scrim colour and is what new code should use.
 * @returns a handle for `undimPage`.
 */
export function dimPage(alpha: number, color: number = theme().ink): number {
  const id = ++pageDimSeq;
  pageDims.push({ id, alpha, color });
  paintPage();
  return id;
}

/** Undo one `dimPage` — the given handle, or the latest. Unknown handles are ignored. */
export function undimPage(id?: number): void {
  const i = id === undefined ? pageDims.length - 1 : pageDims.findIndex((d) => d.id === id);
  if (i < 0) return;
  pageDims.splice(i, 1);
  paintPage();
}

/**
 * Dim the page for exactly as long as `owner` lives.
 *
 * Tied to the object's destruction rather than to a close handler, because a
 * sheet is not always closed: a scene that stops or restarts destroys it with
 * everything else, and a page left dim behind the next screen would be worse
 * than the stripes this fixes.
 */
export function dimPageWhile(
  owner: Phaser.GameObjects.GameObject,
  alpha: number,
  color?: number
): void {
  const id = dimPage(alpha, color);
  owner.once(Phaser.GameObjects.Events.DESTROY, () => undimPage(id));
}


/* --------------------------------------------------------------- progress */

export interface ProgressCard {
  /** 0..1. Values outside are clamped; the bar never runs backwards visually. */
  setProgress(p: number): void;
  setMessage(text: string): void;
  /**
   * Put a Cancel button under the card. Once; it goes with the card. For work
   * that can hang — the modal card is otherwise the only thing on screen, and
   * a render that never finished left no way out but killing the app.
   */
  offerCancel(onCancel: () => void): void;
  destroy(): void;
}

/**
 * A modal card that says something is being made, and how far along it is.
 *
 * The bar is a stroke and its reflection growing out of the fold — the game's
 * one idea, used as the one place it waits: the player's side in the line's
 * tangerine, the reflection in moonlight, as on the board. A generic sweep
 * would have belonged to no game in particular; this reads as Foldwing before
 * a word of it is read, which matters most on the surface whose whole job is
 * to be seen by people who have never played.
 *
 * Modal on purpose. It appears after a deliberate tap, it is over in a couple
 * of seconds, and the alternative — a live board with a frozen button on it —
 * is what "the share button hangs" looks like.
 */
export function progressCard(scene: Phaser.Scene, message: string): ProgressCard {
  const t = theme();
  const cx = BASE_WIDTH / 2;
  const cy = viewHeight() / 2;

  const root = keepCentred(scene.add.container(0, 0).setDepth(95));
  mainCameraOnly(scene, root);

  const shade = scrim(scene, cx, cy, 0.8);
  /*
   * Swallow taps: the board underneath must not take them while this is up.
   *
   * Being on top is not enough for that. Phaser still emits the SCENE-level
   * pointer events after the scrim's own, and a scene-level listener — the
   * Gallery's scrolling grid — scrolled a full window behind this card and
   * pressed the card under the finger. Stopping propagation is what makes it
   * modal.
   */
  shade.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, swallowEvent);
  shade.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, swallowEvent);
  root.add(shade);

  const cw = pt(250);
  const ch = pt(104);
  root.add(sheetPanel(scene, cx, cy, cw, ch, RADIUS.lg));

  const text = label(scene, cx, cy - pt(20), message, {
    size: TYPE.body,
    font: FONT.display,
    alpha: 0.92,
  }).setOrigin(0.5);
  root.add(text);

  const barW = cw - pt(64);
  const barY = cy + pt(16);
  const nib = Math.max(2, pt(2.4));

  // The fold the two halves grow away from: a crease, dark beside light.
  const u = ui();
  const axis = scene.add.graphics();
  axis.fillStyle(u.creaseDark, u.creaseDarkAlpha);
  axis.fillRect(cx - 1, barY - pt(10), 1, pt(20));
  axis.fillStyle(u.creaseLight, 0.14);
  axis.fillRect(cx, barY - pt(10), 1, pt(20));
  root.add(axis);

  const bar = scene.add.graphics();
  root.add(bar);

  let cancel: Phaser.GameObjects.Container | null = null;
  let shown = 0;
  const paint = (p: number): void => {
    const half = (barW / 2) * p;
    bar.clear();
    if (half <= 0) return;
    // The player's side in the line's own light, the reflection in moonlight:
    // the weights the board gives them, so the bar is the game in miniature.
    bar.fillStyle(t.line, 0.22);
    bar.fillRect(cx - half, barY - nib, half, nib * 2);
    bar.fillStyle(t.line, 1);
    bar.fillRect(cx - half, barY - nib / 2, half, nib);
    bar.fillStyle(veiledInk(t.line, t), 1);
    bar.fillRect(cx, barY - nib / 2, half, nib);
  };
  paint(0);

  return {
    setProgress(p: number): void {
      // Monotonic: an encoder that reports a frame twice must not make the bar
      // twitch backwards, which reads as something having gone wrong.
      shown = Math.max(shown, Math.min(1, Math.max(0, p)));
      paint(shown);
    },
    setMessage(next: string): void {
      text.setText(next);
    },
    offerCancel(onCancel: () => void): void {
      if (cancel || !root.scene) return;
      // Below the card, on the scrim — which keeps the board behind it out of
      // reach — on a glass face of its own so it reads as a control.
      const w = pt(140);
      const h = pt(40);
      cancel = button(scene, cx, cy + ch / 2 + pt(34), 'Cancel', {
        width: w,
        height: h,
        minTap: true,
        variant: 'secondary',
        size: TYPE.label,
        onPress: onCancel,
      });
      cancel.setDepth(96).setAlpha(0);
      mainCameraOnly(scene, cancel);
      scene.tweens.add({ targets: cancel, alpha: 1, duration: ms(200) });
    },
    destroy(): void {
      cancel?.destroy(true);
      cancel = null;
      root.destroy(true);
    },
  };
}
/* --------------------------------------------------------------- feedback */

/**
 * What a toast is saying. `reward` — something arrived; `warn` — something was
 * refused or went wrong; `plain` — anything else. The tone picks the accent
 * and decides which queued toast a new one replaces.
 */
export type Tone = 'plain' | 'reward' | 'warn';

export interface ToastItem {
  text: string;
  tone: Tone;
  /** The answer to the player's own tap: it goes ahead of everything waiting — see `toast`. */
  urgent?: boolean;
}

/**
 * The toasts waiting their turn. Pure, so the rules are tested without Phaser.
 *
 * At most `cap` wait. A new toast of a tone already waiting replaces that one
 * and joins the back: two "+1 reveal" lines queued behind each other are the
 * same news twice, and the newer one carries the current count. Tones differ in
 * kind, so a reward never pushes out a warning. Past the cap — which three tones
 * cannot reach at the default — the oldest goes.
 *
 * An urgent toast is the answer to a tap, and a tap's answer that waits two
 * seconds behind an arrival toast reads as no answer. It goes to the front,
 * ahead of the news, and only the latest one waits: a second tap's answer
 * replaces the first's, whatever its tone. It is not news, so it neither
 * replaces a queued toast of its tone nor counts towards the cap, and nothing
 * queued is dropped for it — the news resumes after it.
 */
export class ToastQueue<T extends ToastItem = ToastItem> {
  private readonly items: T[] = [];
  private urgent: T | null = null;

  constructor(private readonly cap = 3) {}

  push(t: T): void {
    if (t.urgent) {
      this.urgent = t;
      return;
    }
    const same = this.items.findIndex((q) => q.tone === t.tone);
    if (same >= 0) this.items.splice(same, 1);
    this.items.push(t);
    while (this.items.length > this.cap) this.items.shift();
  }

  next(): T | null {
    const first = this.urgent;
    if (first) {
      this.urgent = null;
      return first;
    }
    return this.items.shift() ?? null;
  }

  get size(): number {
    return this.items.length + (this.urgent ? 1 : 0);
  }

  clear(): void {
    this.items.length = 0;
    this.urgent = null;
  }
}

/**
 * A toast's text as it is set: one line when it fits `room`, else two.
 *
 * Two lines break at a " · " first — the game's own separator, dropped at the
 * break so neither line starts or ends on a dot — choosing the break that
 * leaves the two lines most even. With no separator break that fits, at the
 * space that does. A text that still does not fit (one long word, or two
 * lines of more than `room`) comes back as the most even pair it has, and the
 * caller scales it down: a notice is never cut, and never runs to a third line.
 */
export function toastLines(
  text: string,
  measure: (s: string) => number,
  room: number
): string[] {
  if (measure(text) <= room) return [text];
  const SEP = ' · ';
  const bySep: [string, string][] = [];
  for (let i = text.indexOf(SEP); i >= 0; i = text.indexOf(SEP, i + 1)) {
    bySep.push([text.slice(0, i), text.slice(i + SEP.length)]);
  }
  const bySpace: [string, string][] = [];
  for (let i = text.indexOf(' '); i >= 0; i = text.indexOf(' ', i + 1)) {
    const a = text.slice(0, i);
    const b = text.slice(i + 1);
    // A dot at either side of the break belongs to the separator splits.
    if (a && b && !a.endsWith('·') && !b.startsWith('·')) bySpace.push([a, b]);
  }
  const widest = ([a, b]: [string, string]): number => Math.max(measure(a), measure(b));
  const mostEven = (pairs: [string, string][]): [string, string] | null =>
    pairs.reduce<[string, string] | null>(
      (best, p) => (best === null || widest(p) < widest(best) ? p : best),
      null
    );
  const fits = (p: [string, string]): boolean => widest(p) <= room;
  const pick =
    mostEven(bySep.filter(fits)) ??
    mostEven(bySpace.filter(fits)) ??
    mostEven([...bySep, ...bySpace]);
  return pick ? [...pick] : [text];
}

export interface ToastOptions {
  /**
   * Centre line of the pill. Without one the pill hangs from `TOAST_TOP`, under
   * a menu's top bar and mission strip: a two-line toast grows down over the
   * page, never up into the strip.
   */
  y?: number;
  icon?: Glyph;
  tone?: Tone;
  /** How long it stays readable, in real ms — never shortened by reduced motion. */
  holdMs?: number;
  /**
   * The answer to the player's own tap — a refusal, a status they just asked
   * for. Shown now: the toast on screen leaves with a quick fade, and the
   * toasts waiting resume after this one. Not for news that arrives by itself.
   */
  urgent?: boolean;
}

interface QueuedToast extends ToastItem {
  opts: ToastOptions;
}

interface ToastState {
  queue: ToastQueue<QueuedToast>;
  showing: Phaser.GameObjects.Container | null;
  /** The toast on screen is already leaving early, for an urgent one. */
  hurried: boolean;
}

const toasts = new WeakMap<Phaser.Scene, ToastState>();

const TOAST_DEPTH = 80;
/** A one-line toast's height. */
export const TOAST_H = pt(34);
/** From one line's centre to the next's, in a two-line toast. */
const TOAST_LINE = pt(16);
/** The tallest a toast gets: two lines. A caller placing one in a gap needs this much. */
export const TOAST_MAX_H = TOAST_H + TOAST_LINE;
/**
 * A toast's top edge when the caller names no `y`: a one-line pill centred on
 * pt(140), pt(8) under the menu's mission strip. Its bottom is `TOAST_H` or
 * `TOAST_MAX_H` below.
 */
export const TOAST_TOP = pt(140) - TOAST_H / 2;
const TOAST_HOLD = 2600;
/** How long the toast on screen takes to leave for an urgent one, in base ms. */
const TOAST_HURRY = 120;

/**
 * A notice in a paper pill that comes, holds, and goes by itself.
 *
 * Never interactive, so it can never take a tap meant for the board or a button
 * under it, and nothing has to be carved out of anyone's input handling for it.
 * One at a time per scene; the rest wait in a `ToastQueue`, except an `urgent`
 * one, which is shown now. At most `COLUMN` wide: a longer text wraps to two
 * lines (see `toastLines`), centred on `y`. Every toast's text is also written
 * to a hidden polite live region, so VoiceOver reads rewards that are
 * otherwise only drawn.
 */
export function toast(scene: Phaser.Scene, text: string, opts: ToastOptions = {}): void {
  // A scene that has shut down would keep the pill until its next start.
  if (scene.sys.settings.status >= Phaser.Scenes.SHUTDOWN) return;
  let state = toasts.get(scene);
  if (!state) {
    const fresh: ToastState = {
      queue: new ToastQueue<QueuedToast>(),
      showing: null,
      hurried: false,
    };
    state = fresh;
    toasts.set(scene, fresh);
    // The pill goes with the scene's display list; the queue must go too, or a
    // restarted scene would open on the last run's leftovers.
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      fresh.queue.clear();
      toasts.delete(scene);
    });
  }
  state.queue.push({ text, tone: opts.tone ?? 'plain', urgent: opts.urgent === true, opts });
  if (!state.showing) showNextToast(scene, state);
  else if (opts.urgent) hurryToast(scene, state);
}

/** Drop the toast on screen and every one waiting — a level change, a scene leaving. */
export function clearToasts(scene: Phaser.Scene): void {
  const state = toasts.get(scene);
  if (!state) return;
  state.queue.clear();
  const showing = state.showing;
  state.showing = null;
  state.hurried = false;
  if (showing?.scene) {
    scene.tweens.killTweensOf(showing);
    showing.destroy(true);
  }
}

/** Send the toast on screen off in `TOAST_HURRY`, so the urgent one queued next shows now. */
function hurryToast(scene: Phaser.Scene, state: ToastState): void {
  const c = state.showing;
  if (!c || state.hurried) return;
  if (!c.scene) {
    retireToast(scene, state, c);
    return;
  }
  state.hurried = true;
  scene.tweens.killTweensOf(c);
  scene.tweens.add({
    targets: c,
    y: c.y - pt(4),
    alpha: 0,
    duration: ms(TOAST_HURRY),
    ease: 'Quad.easeIn',
    onComplete: () => retireToast(scene, state, c),
  });
}

/** A toast has gone: the next one waiting takes its place. */
function retireToast(
  scene: Phaser.Scene,
  state: ToastState,
  c: Phaser.GameObjects.Container
): void {
  c.destroy(true);
  if (state.showing !== c) return;
  state.showing = null;
  state.hurried = false;
  showNextToast(scene, state);
}

function showNextToast(scene: Phaser.Scene, state: ToastState): void {
  const item = state.queue.next();
  if (!item) return;
  const t = theme();
  const u = ui();
  const glyph = item.opts.icon;
  const accent = item.tone === 'reward' ? t.accent : item.tone === 'warn' ? t.fail : t.ink;

  const padX = pt(16);
  const iconW = glyph ? pt(22) : 0;
  // The pill is never wider than the column the screens are built on.
  const room = COLUMN - padX * 2 - iconW;
  const line = (s: string): Phaser.GameObjects.Text =>
    label(scene, 0, 0, s, { size: TYPE.label, alpha: 0.94, weight: 500 }).setOrigin(0.5);
  const probe = line('');
  // Phaser's own measure, once per candidate: every setText redraws the text.
  const widths = new Map<string, number>();
  const measure = (s: string): number => {
    let px = widths.get(s);
    if (px === undefined) widths.set(s, (px = probe.setText(s).width));
    return px;
  };
  const lines = toastLines(item.text, measure, room);
  const captions = lines.map((s, i) => (i === 0 ? probe.setText(s) : line(s)));
  const widest = Math.max(...captions.map((cap) => cap.width));
  // Two lines of more than the room, or one word that is: scaled, never cut.
  const k = widest > room ? room / widest : 1;
  captions.forEach((cap, i) => {
    cap.setScale(k).setPosition(iconW / 2, (i - (lines.length - 1) / 2) * TOAST_LINE);
  });
  const w = widest * k + padX * 2 + iconW;
  const h = TOAST_H + (lines.length - 1) * TOAST_LINE;
  // A pill for one line; two lines get a card's corners, not a lozenge.
  const r = Math.min(h / 2, RADIUS.lg);
  /*
   * Centred on the caller's line. With none it hangs from TOAST_TOP: centred on
   * pt(140), a second line reached up flush against the menu's mission strip
   * (QA round 1), and under the strip there is only the sky and the wordmark.
   */
  const y = item.opts.y ?? TOAST_TOP + h / 2;

  const c = scene.add.container(BASE_WIDTH / 2, y + pt(8)).setDepth(TOAST_DEPTH).setAlpha(0);
  mainCameraOnly(scene, c);

  /*
   * An OPAQUE lifted surface, not glass: a toast lands over anything — the
   * board, the lamp, a card — and glass would show the busiest of them
   * through its words. A reward or a warning carries its tone as a hairline.
   */
  c.add(
    panel(scene, `toast-${item.tone}-${Math.round(r)}`, 0, 0, w, h, {
      radius: r,
      face: { kind: 'solid', color: u.sheet },
      elevation: 'e2',
      outline: item.tone === 'plain' ? undefined : { color: accent, alpha: 0.5, width: pt(1) },
    })
  );
  if (glyph) {
    const color = item.tone === 'plain' ? t.accentText : accent === t.fail ? t.fail : t.accentText;
    const name = glyphIcon(glyph);
    const gx = -w / 2 + padX + pt(7);
    if (name) c.add(icon(scene, gx, 0, name, { size: GLYPH_SIZE * 0.9, color }));
    else {
      const mark = scene.add.graphics();
      glyph(mark, gx, 0, color, 0.95);
      c.add(mark);
    }
  }
  c.add(captions);

  state.showing = c;
  state.hurried = false;
  announce(item.text);

  scene.tweens.add({
    targets: c,
    y,
    alpha: 1,
    duration: ms(220),
    ease: 'Cubic.easeOut',
    onComplete: () => {
      if (!c.scene) return;
      scene.tweens.add({
        targets: c,
        y: y - pt(4),
        alpha: 0,
        delay: item.opts.holdMs ?? TOAST_HOLD,
        duration: ms(220),
        ease: 'Quad.easeIn',
        onComplete: () => retireToast(scene, state, c),
      });
    },
  });
}

const LIVE_ID = 'fw-live';

/** Write `text` into the page's hidden live region, creating it once. */
function announce(text: string): void {
  if (typeof document === 'undefined' || !document.body) return;
  let el = document.getElementById(LIVE_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = LIVE_ID;
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('role', 'status');
    // Visually hidden, still read: display:none would silence it.
    Object.assign(el.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      margin: '-1px',
      padding: '0',
      border: '0',
      overflow: 'hidden',
      clip: 'rect(0 0 0 0)',
      whiteSpace: 'nowrap',
    });
    document.body.appendChild(el);
  }
  // Emptied first: a live region speaks on a CHANGE, so the same line twice in
  // a row would be read once.
  const live = el;
  live.textContent = '';
  window.setTimeout(() => {
    live.textContent = text;
  }, 60);
}

/** The rest scale of anything a `pulse` is under way on, so pulses never compound. */
const pulsing = new WeakMap<object, { x: number; y: number; tween: Phaser.Tweens.Tween | null }>();

/** The scale a pressable control settles back to — see setRestScale. */
const restScales = new WeakMap<object, number>();

/**
 * Tell `pulse` the scale `target` rests at, for a control that dips while
 * pressed. Every kit button and chip is registered at 1 already; a scene's own
 * pressable (the Reveal pill) calls this once.
 *
 * Without it a pulse takes the scale it finds as the rest: a token landing
 * while a finger holds the chip down would settle it back to the pressed dip,
 * after the release had already grown it to 1 — and it would stay shrunk.
 */
export function setRestScale(target: object, scale = 1): void {
  restScales.set(target, scale);
}

/** A press takes over from a pulse under way: the dip is the answer to the finger. */
function stopPulse(target: object): void {
  pulsing.get(target)?.tween?.stop();
  pulsing.delete(target);
}

/**
 * A quick swell and settle: "this changed". 1 → 1 + amt over ms(140), back
 * with a little overshoot over ms(220).
 *
 * Only the pulse's own tweens are stopped when a new one starts — never every
 * tween on the target, which may be fading or moving for its own reasons — and
 * the swell is always measured from the scale the target rests at, so a burst
 * of landings cannot ratchet it larger.
 */
export function pulse(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.Components.Transform,
  amt = 0.1
): void {
  // A destroyed object has no scene: the counter it was went with its screen.
  if ('scene' in target && !(target as { scene?: unknown }).scene) return;
  const prior = pulsing.get(target);
  prior?.tween?.stop();
  const base = restScales.get(target);
  const rest =
    prior ??
    (base !== undefined
      ? { x: base, y: base, tween: null }
      : { x: target.scaleX, y: target.scaleY, tween: null });
  target.setScale(rest.x, rest.y);
  pulsing.set(target, rest);
  rest.tween = scene.tweens.add({
    targets: target,
    scaleX: rest.x * (1 + amt),
    scaleY: rest.y * (1 + amt),
    duration: ms(140),
    ease: 'Quad.easeOut',
    onComplete: () => {
      rest.tween = scene.tweens.add({
        targets: target,
        scaleX: rest.x,
        scaleY: rest.y,
        duration: ms(220),
        ease: 'Back.easeOut',
        onComplete: () => {
          if (pulsing.get(target) === rest) pulsing.delete(target);
        },
      });
    },
  });
}

const counting = new WeakMap<object, Phaser.Tweens.Tween>();
/** A flipping text's resting height, kept while a flip is under way. */
const flipRest = new WeakMap<object, number>();

/**
 * Only +Infinity is "unlimited" — the Remove Ads owner's balance. A NaN or a
 * −Infinity is a broken number, and a broken number must never read as the
 * one thing people paid for: it shows as 0.
 */
export const countText = (n: number): string =>
  n === Infinity ? '∞' : Number.isFinite(n) ? String(Math.round(n)) : '0';

/**
 * Run a number from `from` to `to` on a text — or on a chip, which then keeps
 * its layout as the digits change.
 *
 * Whole numbers only, rounded as it goes. Infinity is never counted towards
 * (there is no "halfway to unlimited"): into or out of ∞ the text FLIPS — it
 * folds shut, changes, and opens. `dur` is in base ms and goes through `ms()`
 * here; a later count on the same text takes over from an earlier one.
 */
export function countUp(
  scene: Phaser.Scene,
  t: Phaser.GameObjects.Text | Phaser.GameObjects.Container,
  from: number,
  to: number,
  fmt: (n: number) => string = countText,
  dur = 600
): void {
  const chipState = t instanceof Phaser.GameObjects.Container ? chips.get(t) : undefined;
  const text = t instanceof Phaser.GameObjects.Text ? t : chipState?.text;
  if (!text) return;
  const write = (s: string): void => {
    if (!text.scene) return;
    if (chipState && t instanceof Phaser.GameObjects.Container) setChipText(t, s);
    else text.setText(s);
  };

  counting.get(text)?.stop();
  counting.delete(text);

  // A flip that was cut short left the text part-folded: put it back first.
  const rest = flipRest.get(text);
  if (rest !== undefined) text.setScale(text.scaleX, rest);

  // A NaN is a number gone wrong, not a trip to ∞: it counts as 0, so only a
  // real infinity flips.
  if (Number.isNaN(from)) from = 0;
  if (Number.isNaN(to)) to = 0;
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    const restY = rest ?? text.scaleY;
    flipRest.set(text, restY);
    const fold = scene.tweens.add({
      targets: text,
      scaleY: 0,
      duration: ms(110),
      ease: 'Quad.easeIn',
      onComplete: () => {
        write(fmt(to));
        const open = scene.tweens.add({
          targets: text,
          scaleY: restY,
          duration: ms(160),
          ease: 'Back.easeOut',
          onComplete: () => {
            counting.delete(text);
            flipRest.delete(text);
          },
        });
        counting.set(text, open);
      },
    });
    counting.set(text, fold);
    return;
  }
  flipRest.delete(text);

  if (from === to) {
    write(fmt(to));
    return;
  }

  const n = { v: from };
  write(fmt(from));
  const tween = scene.tweens.add({
    targets: n,
    v: to,
    duration: ms(dur),
    ease: 'Cubic.easeOut',
    onUpdate: () => write(fmt(Math.round(n.v))),
    onComplete: () => {
      write(fmt(to));
      counting.delete(text);
    },
  });
  counting.set(text, tween);
}

export interface FlyOptions {
  /** Where the tokens leave from, in the scene's world space. */
  from: Vec2;
  /**
   * Where they land — read on every frame of the flight, so it is where the
   * target IS when each token arrives. A fold, Split View or the HUD moving
   * mid-flight cannot send a token to where the counter used to be.
   */
  to: () => Vec2;
  /** How many things arrived. At most six tokens fly; the count says the rest. */
  count: number;
  glyph: Glyph;
  depth?: number;
  /**
   * Pulsed as each token lands — the chip or pill that is receiving. With
   * reduced motion it is pulsed once, and that is the whole effect.
   */
  target?: Phaser.GameObjects.Components.Transform;
  /** After the last token lands: the moment to update the count. */
  onLand?: () => void;
}

const MAX_TOKENS = 6;

/**
 * Tokens fly from where something was earned to the counter that holds it.
 *
 * Each is the glyph on a paper disc, launched 45ms after the one before, on a
 * curve that rises pt(60) over the midpoint and speeds up into the target
 * (Cubic.easeIn — it is being collected, not thrown), shrinking to 0.7. Every
 * landing pulses the target and asks for a reward tap (throttled to three);
 * the first and last also pop. `onLand` fires on the last one, which is when
 * the caller should move the number.
 *
 * Under reduced motion nothing travels: after the same short beat the target
 * pulses once, and the number just changes. If the scene shuts down mid-flight
 * the tokens go with it and `onLand` never fires — the next screen reads the
 * balance fresh anyway.
 */
export function flyReward(scene: Phaser.Scene, o: FlyOptions): void {
  // A NaN count flies nothing but still lands: the caller's counter update
  // rides on onLand, in both motion modes.
  const count = Number.isNaN(o.count) ? 0 : Math.floor(o.count);
  const n = Math.min(Math.max(0, count), MAX_TOKENS);
  if (n === 0) {
    o.onLand?.();
    return;
  }

  let aim: Vec2 = { x: o.from.x, y: o.from.y };
  const target = (): Vec2 => {
    try {
      const p = o.to();
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) aim = { x: p.x, y: p.y };
    } catch {
      // A target torn down mid-flight: keep flying to where it last was.
    }
    return aim;
  };

  const land = (i: number): void => {
    const last = i === n - 1;
    if (o.target) pulse(scene, o.target);
    Haptics.reward();
    if (i === 0 || last) Audio.pop();
    if (last) o.onLand?.();
  };

  if (motionReduced()) {
    scene.time.delayedCall(ms(520), () => {
      if (o.target) pulse(scene, o.target);
      Haptics.reward();
      Audio.pop();
      o.onLand?.();
    });
    return;
  }

  const from = { x: o.from.x, y: o.from.y };
  for (let i = 0; i < n; i++) {
    const token = rewardToken(scene, o.glyph, o.depth ?? 85);
    token.setPosition(from.x, from.y);
    const p = { t: 0 };
    scene.tweens.add({
      targets: p,
      t: 1,
      delay: ms(i * 45),
      duration: ms(520),
      ease: 'Cubic.easeIn',
      onUpdate: (tween: Phaser.Tweens.Tween) => {
        if (!token.scene) return;
        const to = target();
        const cx = (from.x + to.x) / 2;
        const cy = (from.y + to.y) / 2 - pt(60);
        const u = p.t;
        const a = (1 - u) * (1 - u);
        const b = 2 * (1 - u) * u;
        const c = u * u;
        token
          .setPosition(a * from.x + b * cx + c * to.x, a * from.y + b * cy + c * to.y)
          .setScale(1 - 0.3 * u)
          // Faded in over the first moments rather than popping into being.
          .setAlpha(Math.min(1, tween.progress * 6));
      },
      onComplete: () => {
        token.destroy(true);
        land(i);
      },
    });
  }
}

/** One flying token: the glyph, a size up, on a lifted disc with an accent rim. */
function rewardToken(
  scene: Phaser.Scene,
  glyph: Glyph,
  depth: number
): Phaser.GameObjects.Container {
  const t = theme();
  const c = scene.add.container(0, 0).setDepth(depth).setAlpha(0);
  mainCameraOnly(scene, c);
  const r = pt(12);
  const disc = panel(scene, 'token', 0, 0, r * 2, r * 2, {
    radius: r,
    face: { kind: 'solid', color: ui().sheet },
    elevation: 'e1',
    outline: { color: t.accent, alpha: 0.55, width: pt(1) },
  });
  // A little of the lamp behind it: the token is something warm arriving.
  const glow = softDisc(scene, 0, 0, r * 1.9, t.accent, 0.22);
  c.add([glow, disc]);
  const name = glyphIcon(glyph);
  if (name) c.add(icon(scene, 0, 0, name, { size: GLYPH_SIZE * 1.05, color: t.accentText }));
  else {
    // The glyphs are drawn at about pt(13); a token carries one at pt(16).
    const mark = scene.add.graphics().setScale(16 / 13);
    glyph(mark, 0, 0, t.accentText, 1);
    c.add(mark);
  }
  return c;
}
