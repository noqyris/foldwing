/**
 * Baked — static chrome painted once into textures (tech G2).
 *
 * Phaser re-triangulates every Graphics object on every frame. A card built
 * from live rounded rects and a stacked shadow is cheap alone and ruinous in
 * numbers: forty of them measured 45 ms a frame at the 4× CPU proxy, where
 * the same forty baked into a texture measured under 4. So everything that
 * does not change this frame — panels, shadows, glows, discs — is painted
 * here with Canvas2D, once, and drawn as an Image or a NineSlice.
 *
 * Canvas2D rather than a RenderTexture of Graphics because it has what the
 * look needs and Graphics does not: real blur (`shadowBlur`), gradients, and
 * round joins. A bake costs a few milliseconds at first use; every later use
 * of the same key is free.
 *
 * The elevation ladder is Night Fold's (art-spec §5): one light, top-left;
 * surfaces lift toward the player; every shadow is black, never tinted.
 *
 * Phaser is only touched inside functions: tests import the UI kit with a
 * stand-in Phaser, and a module that reached for it at load would break them.
 */

import Phaser from 'phaser';
import { dp, rgba, ui } from './Theme';

/* ------------------------------------------------------------- elevation */

/** One drop shadow, CSS box-shadow style, in base units. */
export interface Drop {
  readonly dy: number;
  readonly blur: number;
  /** Negative pulls the shadow in under the face, as CSS spread does. */
  readonly spread: number;
  readonly alpha: number;
}

export interface Elevation {
  /** Drop shadows, painted under the face in order. */
  readonly drops: readonly Drop[];
  /** The lit top edge: a 1 px cream hairline inside the face, at this alpha. */
  readonly highlight: number;
  /** A sunk face's inner shadow from the top, at this alpha (0 = raised). */
  readonly inner: number;
}

export type ElevationName = 'flat' | 'e1' | 'e2' | 'e3' | 'sunk';

/**
 * The four levels, from the B mocks' box-shadows (pt at 402, here in base):
 *
 *   e1  chips, tiles    7 % top line · 1 px contact at 35 % · 14 blur −6 at 55 %
 *   e2  cards, pills    8 % · 1 px at 40 % · 30 blur −10 at 65 %
 *   e3  hero, board     10 % · 2 px at 40 % · 50 blur −14 at 80 %
 *   sunk tracks, wells  inner 3 px at 45 %
 */
export const ELEVATION: Readonly<Record<ElevationName, Elevation>> = {
  flat: { drops: [], highlight: 0, inner: 0 },
  e1: {
    drops: [
      { dy: dp(1), blur: 0, spread: 0, alpha: 0.35 },
      { dy: dp(6), blur: dp(14), spread: -dp(6), alpha: 0.55 },
    ],
    highlight: 0.07,
    inner: 0,
  },
  e2: {
    drops: [
      { dy: dp(1), blur: 0, spread: 0, alpha: 0.4 },
      { dy: dp(16), blur: dp(30), spread: -dp(10), alpha: 0.65 },
    ],
    highlight: 0.08,
    inner: 0,
  },
  e3: {
    drops: [
      { dy: dp(2), blur: 0, spread: 0, alpha: 0.4 },
      { dy: dp(30), blur: dp(50), spread: -dp(14), alpha: 0.8 },
    ],
    highlight: 0.1,
    inner: 0,
  },
  sunk: { drops: [], highlight: 0, inner: 0.45 },
};

/** How far a level's shadows reach past the face: the pad a bake needs around it. */
export function shadowReach(e: Elevation): { top: number; side: number; bottom: number } {
  let top = 0;
  let side = 0;
  let bottom = 0;
  for (const d of e.drops) {
    // A Gaussian of this blur is invisible past about its full radius.
    const r = d.blur + d.spread;
    top = Math.max(top, r - d.dy);
    side = Math.max(side, r);
    bottom = Math.max(bottom, r + d.dy);
  }
  // Whole pixels, one spare: a clipped shadow edge is a hard line.
  return { top: Math.ceil(Math.max(0, top)) + 1, side: Math.ceil(side) + 1, bottom: Math.ceil(bottom) + 1 };
}

/* ------------------------------------------------------------ radii (B) */

/** The shape radii of SPEC §2.4, in base units. */
export const RADII = {
  chip: dp(18),
  tile: dp(20),
  button: dp(20),
  card: dp(26),
  board: dp(28),
  sheet: dp(34),
  mini: dp(15),
} as const;

/* -------------------------------------------------------------- Canvas2D */

/** A rounded-rect path, the radius clamped to what the box can hold. */
export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** Where the offscreen trick puts a shape so only its shadow lands on the canvas. */
const OFFSCREEN = 20000;

/**
 * Paint only the SHADOW of a rounded rect: the shape is drawn far off the
 * canvas and its shadow offset back onto it, so no face is left to cover. A
 * shadow offset is in device pixels, untouched by the transform, so this
 * expects an unscaled context (every bake here is one pixel per base unit).
 */
export function paintDrop(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  d: Drop,
  color: number = ui().shadow
): void {
  const s = d.spread;
  ctx.save();
  ctx.shadowColor = rgba(color, d.alpha);
  ctx.shadowBlur = d.blur;
  ctx.shadowOffsetX = OFFSCREEN;
  ctx.shadowOffsetY = d.dy;
  ctx.fillStyle = '#000';
  roundRectPath(ctx, x - s - OFFSCREEN, y - s, w + 2 * s, h + 2 * s, r + s);
  ctx.fill();
  ctx.restore();
}

/** Every drop of an elevation, under a face of (x, y, w, h, r). */
export function paintElevation(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  e: Elevation
): void {
  for (const d of e.drops) paintDrop(ctx, x, y, w, h, r, d);
}

/**
 * The lit top edge: a 1 px cream line just inside the face's top, fading out
 * down its corners — light from the top-left catching the rim.
 */
export function paintHighlight(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  alpha: number
): void {
  if (!(alpha > 0)) return;
  const u = ui();
  ctx.save();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.clip();
  const g = ctx.createLinearGradient(0, y, 0, y + Math.min(h, r + 2));
  g.addColorStop(0, rgba(u.glass, alpha));
  g.addColorStop(1, rgba(u.glass, 0));
  ctx.strokeStyle = g;
  ctx.lineWidth = 2;
  roundRectPath(ctx, x, y, w, h + 2, r);
  ctx.stroke();
  ctx.restore();
}

/** A sunk face's inner shadow: dark from the top edge, inside the shape. */
export function paintInner(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  alpha: number
): void {
  if (!(alpha > 0)) return;
  ctx.save();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.clip();
  // A frame around the face, drawn with a shadow that falls inward.
  ctx.shadowColor = rgba(ui().shadow, alpha);
  ctx.shadowBlur = dp(3);
  ctx.shadowOffsetY = dp(1);
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.rect(x - 40, y - 40, w + 80, h + 80);
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  // The hole, wound the other way so the frame is filled around it.
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x, y, x, y + rr, rr);
  ctx.lineTo(x, y + h - rr);
  ctx.arcTo(x, y + h, x + rr, y + h, rr);
  ctx.lineTo(x + w - rr, y + h);
  ctx.arcTo(x + w, y + h, x + w, y + h - rr, rr);
  ctx.lineTo(x + w, y + rr);
  ctx.arcTo(x + w, y, x + w - rr, y, rr);
  ctx.closePath();
  ctx.fill('evenodd');
  ctx.restore();
  // And the faint lit rim a well has at night.
  ctx.save();
  ctx.strokeStyle = rgba(ui().glass, 0.03);
  ctx.lineWidth = 2;
  roundRectPath(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.stroke();
  ctx.restore();
}

/** What a face is filled with. */
export type Face =
  /** Smoked glass: see UiTheme.smoke / glass. Shows the sky through. */
  | { readonly kind: 'glass'; readonly extra?: number }
  /** One colour, at an alpha. */
  | { readonly kind: 'solid'; readonly color: number; readonly alpha?: number }
  /** A vertical gradient, top to bottom — the primary button. Bake exact-size. */
  | { readonly kind: 'vertical'; readonly top: number; readonly bottom: number; readonly alpha?: number }
  /** A diagonal gradient, top-left to bottom-right — the Daily's dusk. Bake exact-size. */
  | { readonly kind: 'diagonal'; readonly from: number; readonly to: number; readonly alpha?: number }
  /** Nothing: a shadow or outline alone. */
  | { readonly kind: 'none' };

export interface PanelSpec {
  readonly radius: number;
  readonly face: Face;
  readonly elevation?: ElevationName;
  /** An outline just inside the edge: colour, alpha, width. */
  readonly outline?: { readonly color: number; readonly alpha: number; readonly width?: number };
  /**
   * A glow around the face instead of (or as well as) a shadow — the primary
   * button's lamp: colour, alpha, blur, and how far below it sits.
   */
  readonly glow?: { readonly color: number; readonly alpha: number; readonly blur: number; readonly dy?: number };
}

/**
 * Whether a face needs its exact size: a diagonal gradient survives no
 * stretch at all. (A vertical one survives a stretch across — see `stretchX`.)
 */
export function needsExact(spec: PanelSpec): boolean {
  return spec.face.kind === 'diagonal';
}

/** The pad a spec needs around its face for its shadows and glow. */
export function panelPad(spec: PanelSpec): { top: number; side: number; bottom: number } {
  const reach = shadowReach(ELEVATION[spec.elevation ?? 'flat']);
  const g = spec.glow;
  const gr = g ? Math.ceil(g.blur) + 1 : 0;
  const gdy = g?.dy ?? 0;
  return {
    top: Math.max(reach.top, gr - gdy, 1),
    side: Math.max(reach.side, gr, 1),
    bottom: Math.max(reach.bottom, gr + gdy, 1),
  };
}

/** Paint a panel's shadows, glow, face, highlight, inner shadow and outline at (x, y, w, h). */
export function paintPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  spec: PanelSpec
): void {
  const u = ui();
  const r = spec.radius;
  const e = ELEVATION[spec.elevation ?? 'flat'];
  paintElevation(ctx, x, y, w, h, r, e);
  if (spec.glow) {
    const g = spec.glow;
    ctx.save();
    ctx.shadowColor = rgba(g.color, g.alpha);
    ctx.shadowBlur = g.blur;
    ctx.shadowOffsetX = OFFSCREEN;
    ctx.shadowOffsetY = g.dy ?? 0;
    ctx.fillStyle = '#000';
    roundRectPath(ctx, x - OFFSCREEN, y, w, h, r);
    ctx.fill();
    ctx.restore();
  }
  const f = spec.face;
  if (f.kind !== 'none') {
    // A face over its own shadow must not let the shadow show through where
    // it is translucent: glass shows the SKY, not the shadow under the glass.
    ctx.save();
    roundRectPath(ctx, x, y, w, h, r);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();
    roundRectPath(ctx, x, y, w, h, r);
    if (f.kind === 'glass') {
      ctx.fillStyle = rgba(u.smoke, u.smokeAlpha);
      ctx.fill();
      ctx.fillStyle = rgba(u.glass, u.glassAlpha + (f.extra ?? 0));
      ctx.fill();
    } else if (f.kind === 'solid') {
      ctx.fillStyle = rgba(f.color, f.alpha ?? 1);
      ctx.fill();
    } else if (f.kind === 'vertical') {
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, rgba(f.top, f.alpha ?? 1));
      g.addColorStop(1, rgba(f.bottom, f.alpha ?? 1));
      ctx.fillStyle = g;
      ctx.fill();
    } else {
      const g = ctx.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, rgba(f.from, f.alpha ?? 1));
      g.addColorStop(1, rgba(f.to, f.alpha ?? 1));
      ctx.fillStyle = g;
      ctx.fill();
    }
  }
  paintHighlight(ctx, x, y, w, h, r, e.highlight);
  paintInner(ctx, x, y, w, h, r, e.inner);
  if (spec.outline) {
    const o = spec.outline;
    const lw = o.width ?? 2;
    ctx.save();
    ctx.strokeStyle = rgba(o.color, o.alpha);
    ctx.lineWidth = lw;
    roundRectPath(ctx, x + lw / 2, y + lw / 2, w - lw, h - lw, Math.max(0, r - lw / 2));
    ctx.stroke();
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ bakes */

/** Paint a face into a bake: the face's rect inside the texture, in texture pixels. */
export type PanelPaint = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void;

export interface BakeOptions {
  /** Room around the face for shadows and glow. */
  pad?: { top: number; side: number; bottom: number } | number;
  /**
   * The corner the nine-slice keeps unstretched, past the pad: normally the
   * radius. Without it (or with `exact`) the bake is the exact size asked.
   */
  slice?: number;
  /** Bake at exactly w × h, keyed by size — for a diagonal gradient and one-offs. */
  exact?: boolean;
  /**
   * Stretch only across: a THREE-slice with its height baked exact. For a
   * face whose look runs top to bottom — the primary's vertical gradient —
   * which a nine-slice would band but a horizontal stretch keeps whole.
   */
  stretchX?: boolean;
}

/** What `bakedPanel` returns: an Image or a NineSlice, both centred and sized to the face plus its pad. */
export type Panel = Phaser.GameObjects.NineSlice | Phaser.GameObjects.Image;

const padOf = (p: BakeOptions['pad']): { top: number; side: number; bottom: number } =>
  typeof p === 'number' ? { top: p, side: p, bottom: p } : p ?? { top: 0, side: 0, bottom: 0 };

/** The texture key a bake lands under: the caller's key, plus the size when it is exact. */
export function bakeKey(key: string, w: number, h: number, exact: boolean): string {
  return exact ? `fw-bake-${key}-${Math.round(w)}x${Math.round(h)}` : `fw-bake-${key}`;
}

/** Whether this scene's renderer can draw a NineSlice (WebGL only in Phaser 3.90). */
function nineSliceWorks(scene: Phaser.Scene): boolean {
  const type = scene.sys.game?.renderer?.type;
  return type !== undefined && type === Phaser.WEBGL;
}

/**
 * A panel painted once and shared: the SPEC's `bakedPanel(scene, key, w, h,
 * paint)`.
 *
 * `key` names the LOOK, not the instance: every chip of the same style shares
 * one texture. With `slice`, the look is baked once at the smallest size that
 * holds its corners and drawn as a NineSlice at any w × h — the chip that
 * grows a digit, the toast that wraps. Without it, or with `exact`, the bake
 * is keyed by size too and drawn as an Image (gradients, which a stretch
 * would band). The Canvas renderer cannot draw a NineSlice, so there every
 * bake is exact.
 *
 * The returned object is centred on (x, y) and is the face's size plus its
 * pad, so the FACE is centred on (x, y) whatever shadow hangs off it — with
 * an uneven pad (a shadow that falls down) it is offset to keep that true.
 * Resize a NineSlice later with `sizePanel`.
 */
export function bakedPanel(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  paint: PanelPaint,
  opts: BakeOptions = {},
  x = 0,
  y = 0
): Panel {
  const pad = padOf(opts.pad);
  const slice = opts.slice ?? 0;
  const canSlice = !opts.exact && slice > 0 && nineSliceWorks(scene);
  const faceW = Math.max(1, Math.round(w));
  const faceH = Math.max(1, Math.round(h));

  if (canSlice) {
    const s = Math.ceil(slice);
    const left = pad.side + s;
    // A face narrower than its own two corners cannot slice at all.
    if (faceW >= s * 2) {
      if (faceH >= s * 2 && !opts.stretchX) {
        // Nine-slice: the smallest face that holds two corners and a 2 px
        // middle to stretch, both ways.
        const bw = s * 2 + 2;
        const tkey = bakeKey(key, bw, bw, false);
        ensureBake(scene, tkey, bw, bw, pad, paint);
        const ns = scene.add.nineslice(
          x,
          y + (pad.bottom - pad.top) / 2,
          tkey,
          undefined,
          faceW + pad.side * 2,
          faceH + pad.top + pad.bottom,
          left,
          left,
          pad.top + s,
          pad.bottom + s
        );
        panelInfo.set(ns, { pad, w: faceW, h: faceH });
        return ns;
      }
      // Too short for two corners stacked (a pill), or asked to keep its
      // height whole: a THREE-slice, its height baked exact (keyed by it) and
      // only its width stretched.
      const bw = s * 2 + 2;
      const tkey = `${bakeKey(key, bw, faceH, false)}-h${faceH}`;
      ensureBake(scene, tkey, bw, faceH, pad, paint);
      const ns = scene.add.nineslice(x, y + (pad.bottom - pad.top) / 2, tkey, undefined, faceW + pad.side * 2, 0, left, left);
      panelInfo.set(ns, { pad, w: faceW, h: faceH });
      return ns;
    }
  }
  const tkey = bakeKey(key, faceW, faceH, true);
  ensureBake(scene, tkey, faceW, faceH, pad, paint);
  const img = scene.add.image(x, y + (pad.bottom - pad.top) / 2, tkey);
  panelInfo.set(img, { pad, w: faceW, h: faceH });
  return img;
}

/** The pad each panel was built with, so a resize keeps its face centred; and its face's size. */
const panelInfo = new WeakMap<object, { pad: { top: number; side: number; bottom: number }; w: number; h: number }>();

/** A panel's FACE size, as asked for (not counting the pad its shadow hangs in). */
export function panelFace(p: object): { w: number; h: number } | null {
  const i = panelInfo.get(p);
  return i ? { w: i.w, h: i.h } : null;
}

/**
 * Resize a NineSlice panel's FACE to w × h, keeping it centred where it is.
 * An exact bake (an Image) cannot resize; it is left as it is and `false`
 * comes back, so the caller can rebuild it.
 */
export function sizePanel(p: Panel, w: number, h: number): boolean {
  const info = panelInfo.get(p);
  if (!info || !(p instanceof Phaser.GameObjects.NineSlice)) return false;
  const { pad } = info;
  info.w = Math.round(w);
  info.h = Math.round(h);
  p.setSize(info.w + pad.side * 2, info.h + pad.top + pad.bottom);
  return true;
}

function ensureBake(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  pad: { top: number; side: number; bottom: number },
  paint: PanelPaint
): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w + pad.side * 2, h + pad.top + pad.bottom);
  if (!tex) return;
  const ctx = tex.getContext();
  paint(ctx, pad.side, pad.top, w, h);
  tex.refresh();
}

/**
 * A panel from a spec — the one most callers want. `look` names the style
 * for the cache ("glass-chip", "btn-primary"); two different specs must not
 * share a look.
 */
export function panel(
  scene: Phaser.Scene,
  look: string,
  x: number,
  y: number,
  w: number,
  h: number,
  spec: PanelSpec
): Panel {
  const exact = needsExact(spec);
  return bakedPanel(
    scene,
    look,
    w,
    h,
    (ctx, px, py, pw, ph) => paintPanel(ctx, px, py, pw, ph, spec),
    {
      pad: panelPad(spec),
      slice: exact ? undefined : Math.ceil(spec.radius) + 1,
      exact,
      stretchX: spec.face.kind === 'vertical',
    },
    x,
    y
  );
}

/** The ready-made looks: glass at each elevation, the sunk well, the opaque sheet. */
export const LOOKS = {
  glassChip: (): PanelSpec => ({ radius: RADII.chip, face: { kind: 'glass' }, elevation: 'e1' }),
  glassTile: (): PanelSpec => ({ radius: RADII.tile, face: { kind: 'glass' }, elevation: 'e1' }),
  glassCard: (): PanelSpec => ({ radius: RADII.card, face: { kind: 'glass', extra: 0.01 }, elevation: 'e2' }),
  glassHero: (): PanelSpec => ({ radius: RADII.card, face: { kind: 'glass', extra: 0.015 }, elevation: 'e3' }),
  sheet: (): PanelSpec => ({ radius: RADII.sheet, face: { kind: 'solid', color: ui().sheet }, elevation: 'e3' }),
  well: (radius: number = RADII.tile): PanelSpec => ({
    radius,
    face: { kind: 'solid', color: ui().well, alpha: 0.85 },
    elevation: 'sunk',
  }),
} as const;

/* ----------------------------------------------------------- discs, glows */

/** The soft disc's texture size: large enough to scale up to a lamp without steps. */
const DISC_PX = 128;

/**
 * A soft disc: full at the centre, gone at the rim, falling off like light
 * (a smoothstep of the radius, not a cone). Baked per colour, because the
 * Canvas renderer cannot tint; each is 64 KB.
 */
export function softDiscTexture(scene: Phaser.Scene, color: number): string {
  const key = `fw-disc-${(color & 0xffffff).toString(16).padStart(6, '0')}`;
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, DISC_PX, DISC_PX);
  if (!tex) return '__MISSING';
  const ctx = tex.getContext();
  const c = DISC_PX / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const a = 1 - t * t * (3 - 2 * t);
    g.addColorStop(t, rgba(color, a));
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, DISC_PX, DISC_PX);
  tex.refresh();
  return key;
}

/**
 * A soft disc of `radius` base units at (x, y): a halo, the lamp behind the
 * logo, a nib's glow. Scale and alpha are the caller's to tween.
 */
export function softDisc(
  scene: Phaser.Scene,
  x: number,
  y: number,
  radius: number,
  color: number,
  alpha = 1
): Phaser.GameObjects.Image {
  return scene.add
    .image(x, y, softDiscTexture(scene, color))
    .setScale((radius * 2) / DISC_PX)
    .setAlpha(alpha);
}

/**
 * A blurred rounded rect in `color`: the danger heat on a wall, a button's
 * lamp. The rect itself is not drawn, only its glow, `blur` wide. Exact-size
 * bake, keyed by the look and the size.
 */
export function glowRect(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  color: number,
  blur: number,
  alpha = 1
): Panel {
  const spec: PanelSpec = { radius, face: { kind: 'none' }, glow: { color, alpha: 1, blur } };
  const hex = (color & 0xffffff).toString(16).padStart(6, '0');
  return bakedPanel(
    scene,
    `glow-${hex}-${Math.round(radius)}-${Math.round(blur)}`,
    w,
    h,
    (ctx, px, py, pw, ph) => paintPanel(ctx, px, py, pw, ph, spec),
    { pad: panelPad(spec), exact: true },
    x,
    y
  ).setAlpha(alpha);
}
