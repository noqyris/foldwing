/**
 * Paper — the surfaces everything sits on: the night sky with its stars, and
 * the board's folded sheet.
 *
 * THE SKY is one bake, drawn by its own scene under every other scene, so it
 * never re-bakes, flashes or jumps when the screen changes: the Menu, Levels
 * and a level all stand on the same night. It is a radial lamp in the upper
 * third (Theme's skyGlow → sky → skyEdge) with a sparse star field.
 *
 * It is ALSO the page. The canvas fits inside the safe area, and the bands
 * outside it — the status bar, the home indicator, the desk margins of a
 * wide shape — are the web page's own background, which no Phaser object can
 * reach. index.html paints the same radial there in CSS (`PAGE_SKY_CSS`), and
 * the bake here reproduces it pixel for pixel in the canvas's own place on
 * the page: it reads where the canvas sits and paints the page's gradient in
 * those coordinates. So the bands are not "close to" the canvas's sky — they
 * are the same picture, and there is no seam at the safe-area edge.
 *
 * THE BOARD's sheet is a Canvas2D painter (`paintBoardSheet`) rather than a
 * texture, so the play board's bake, the share card and the replay video all
 * paint the identical material (tech G11).
 *
 * Phaser is only touched inside functions: tests import these painters with
 * no Phaser at all.
 */

import Phaser from 'phaser';
import { BASE_WIDTH, hexCss, rgba, theme, ui, viewHeight, type UiTheme } from './Theme';

/* -------------------------------------------------------------- the sky */

/**
 * The lamp's geometry, as fractions of the PAGE (the full screen): centred
 * at 50 % across and 27 % down, its ellipse 90 % of the width and 42 % of the
 * height across. Over the Menu's logo, which is where the B mock lit it.
 */
export const LAMP = { cx: 0.5, cy: 0.27, rx: 0.9, ry: 0.42 } as const;

/** The lamp's colour stops, centre to rim: glow, the sky, the edge. */
export function skyStops(u: UiTheme = ui()): readonly [number, number][] {
  return [
    [0, u.skyGlow],
    [0.5, u.sky],
    [1, u.skyEdge],
  ];
}

/**
 * The sky as CSS, for the page behind the canvas. The same stops and the
 * same ellipse `paintSky` uses; index.html carries a copy for the first
 * paint, and `applyPageSky` rewrites it from the tokens at boot.
 */
export function pageSkyCss(u: UiTheme = ui()): string {
  const stops = skyStops(u)
    .map(([at, c]) => `${hexCss(c)} ${Math.round(at * 100)}%`)
    .join(', ');
  return `radial-gradient(${LAMP.rx * 100}% ${LAMP.ry * 100}% at ${LAMP.cx * 100}% ${LAMP.cy * 100}%, ${stops}) ${hexCss(u.skyEdge)}`;
}

/** Where the canvas sits on the page, in CSS px, and how big the page is. */
export interface PagePlace {
  /** The canvas's top-left on the page, CSS px. */
  readonly left: number;
  readonly top: number;
  /** CSS px per canvas pixel (FIT scales both axes alike). */
  readonly scale: number;
  /** The page: the full screen the CSS gradient is laid over. */
  readonly pageW: number;
  readonly pageH: number;
}

/**
 * The canvas's place when nothing can be measured (a test, a canvas not in
 * the page yet): as if it filled the page exactly.
 */
export function fillingPlace(w: number, h: number): PagePlace {
  return { left: 0, top: 0, scale: 1, pageW: w, pageH: h };
}

/**
 * Paint the sky into `ctx`, a canvas `w` × `h` pixels that sits on the page
 * at `place`: the page's own radial, in this canvas's coordinates.
 */
export function paintSky(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  place: PagePlace = fillingPlace(w, h),
  u: UiTheme = ui()
): void {
  ctx.save();
  ctx.fillStyle = hexCss(u.skyEdge);
  ctx.fillRect(0, 0, w, h);
  // Page CSS px → this canvas: x_canvas = (x_page − left) / scale.
  ctx.setTransform(1 / place.scale, 0, 0, 1 / place.scale, -place.left / place.scale, -place.top / place.scale);
  ctx.translate(place.pageW * LAMP.cx, place.pageH * LAMP.cy);
  ctx.scale(place.pageW * LAMP.rx, place.pageH * LAMP.ry);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  for (const [at, c] of skyStops(u)) g.addColorStop(at, hexCss(c));
  ctx.fillStyle = g;
  // In the lamp's unit space: anything this size covers the page many times.
  ctx.fillRect(-8, -8, 16, 16);
  ctx.restore();
}

/** A star: centre, radius and alpha, in canvas base units. */
export interface Star {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly a: number;
}

/**
 * The star field for a world `w` × `h`: `u.stars.count` dots, seeded so the
 * sky is the same every launch (a sky that reshuffled on each screen would
 * read as noise, not as night). Denser toward the top, where the lamp is
 * dimmest in its reach and the menu's brand sits; sparse and faint low down,
 * under the cards. Radii 0.3-1.2 pt; alpha within the token's range.
 */
export function starField(w: number, h: number, u: UiTheme = ui(), seed = 7): Star[] {
  let s = seed >>> 0 || 1;
  const rnd = (): number => {
    // Park–Miller: tiny, deterministic, and good enough for where a star goes.
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const out: Star[] = [];
  const { count, alphaMin, alphaMax } = u.stars;
  const pt = BASE_WIDTH / 402;
  for (let i = 0; i < count; i++) {
    const x = rnd() * w;
    // y skewed up: most stars in the upper half, a few all the way down.
    const fy = rnd() ** 1.6;
    const y = fy * h;
    const r = (0.3 + rnd() * 0.9) * pt;
    // Lower stars dimmer, so the cards' captions never sit beside a bright one.
    const a = alphaMin + (alphaMax - alphaMin) * rnd() * (1 - 0.5 * fy);
    out.push({ x, y, r, a });
  }
  return out;
}

/** Paint `stars` over the sky. */
export function paintStars(ctx: CanvasRenderingContext2D, stars: readonly Star[], u: UiTheme = ui()): void {
  ctx.save();
  for (const st of stars) {
    ctx.fillStyle = rgba(u.stars.color, st.a);
    ctx.beginPath();
    ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* ------------------------------------------------------------ the board */

export interface BoardSheetOptions {
  /** Corner radius, base units. */
  radius?: number;
  /** The fold, in the sheet's own x. Default: its centre. */
  axisX?: number;
  /** Which half is the far one — the mirror's, away from the lamp. */
  farSide?: 'left' | 'right';
  /** Draw the crease (dark hairline beside a light one). Default true. */
  crease?: boolean;
  /** The lit top edge's alpha (e3's), 0 for none. */
  highlight?: number;
}

/**
 * The board's folded sheet, at (x, y, w, h): Night Fold's material, exactly.
 *
 *   - the sheet, radial from `boardCentre` in the middle to `board` at the rim;
 *   - the far half turned from the lamp: black `farShade` at the crease,
 *     `farShadeMid` at 22 % of the half, gone by its edge;
 *   - the near half catching `nearSheen` of cream at the crease, gone by 30 %;
 *   - the crease: a 1 px dark hairline and, beside it, a 1 px light one. It
 *     replaces the dashed axis;
 *   - the lit top edge.
 *
 * Walls, markers and ink are drawn over it by their owners. No shadow here:
 * the board's e3 drop is Baked's, under whatever holds this.
 */
export function paintBoardSheet(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  o: BoardSheetOptions = {}
): void {
  const t = theme();
  const u = ui();
  const r = Math.max(0, Math.min(o.radius ?? Math.round(28 * (BASE_WIDTH / 402)), w / 2, h / 2));
  const ax = x + (o.axisX ?? w / 2);
  const far = o.farSide ?? 'right';
  ctx.save();
  sheetPath(ctx, x, y, w, h, r);
  ctx.clip();
  // The sheet: lighter in the middle, where the lamp falls.
  const cx = x + w / 2;
  const cy = y + h * 0.45;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(w, h) * 0.6);
  g.addColorStop(0, hexCss(t.boardCentre));
  g.addColorStop(1, hexCss(t.board));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  // The far half, a few degrees away from the light.
  const farW = far === 'right' ? x + w - ax : ax - x;
  const dir = far === 'right' ? 1 : -1;
  const shade = ctx.createLinearGradient(ax, 0, ax + dir * farW, 0);
  shade.addColorStop(0, rgba(0x000000, u.farShade));
  shade.addColorStop(0.22, rgba(0x000000, u.farShadeMid));
  shade.addColorStop(1, rgba(0x000000, 0));
  ctx.fillStyle = shade;
  if (far === 'right') ctx.fillRect(ax, y, farW, h);
  else ctx.fillRect(x, y, farW, h);
  // The near half catches the lamp at the crease.
  const nearW = w - farW;
  const sheen = ctx.createLinearGradient(ax, 0, ax - dir * nearW, 0);
  sheen.addColorStop(0, rgba(u.glass, u.nearSheen));
  sheen.addColorStop(0.3, rgba(u.glass, 0));
  ctx.fillStyle = sheen;
  if (far === 'right') ctx.fillRect(x, y, nearW, h);
  else ctx.fillRect(ax, y, nearW, h);
  if (o.crease !== false) {
    // Dark on the near side of the fold line, light on the far: a valley.
    const d = far === 'right' ? -1 : 0;
    ctx.fillStyle = rgba(u.creaseDark, u.creaseDarkAlpha);
    ctx.fillRect(Math.round(ax) + d, y, 1, h);
    ctx.fillStyle = rgba(u.creaseLight, u.creaseLightAlpha);
    ctx.fillRect(Math.round(ax) + d + 1, y, 1, h);
  }
  ctx.restore();
  const hi = o.highlight ?? 0.1;
  if (hi > 0) {
    ctx.save();
    sheetPath(ctx, x, y, w, h, r);
    ctx.clip();
    const lg = ctx.createLinearGradient(0, y, 0, y + r + 2);
    lg.addColorStop(0, rgba(u.glass, hi));
    lg.addColorStop(1, rgba(u.glass, 0));
    ctx.strokeStyle = lg;
    ctx.lineWidth = 2;
    sheetPath(ctx, x, y, w, h + 2, r);
    ctx.stroke();
    ctx.restore();
  }
}

function sheetPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/* ------------------------------------------------------ the page (DOM) */

/**
 * Put the sky on the page behind the canvas, from the tokens. index.html
 * already carries the same CSS for the first paint (before any script), so
 * this only matters if the tokens and that copy ever drift; it also sets the
 * theme-color the browser chrome uses.
 */
export function applyPageSky(u: UiTheme = ui()): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--fw-sky', pageSkyCss(u));
  root.style.setProperty('--fw-sky-base', hexCss(u.skyEdge));
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', hexCss(u.sky));
}

/** Take the launch mark index.html shows while the bundle loads off the page. */
export function dropBootMark(): void {
  if (typeof document === 'undefined') return;
  document.getElementById('boot-mark')?.remove();
}

/** Where the game canvas sits on the page right now, or null when it cannot be measured. */
export function measurePlace(canvas: HTMLCanvasElement | null | undefined, worldW: number): PagePlace | null {
  if (typeof document === 'undefined' || !canvas || typeof canvas.getBoundingClientRect !== 'function') {
    return null;
  }
  const c = canvas.getBoundingClientRect();
  const page = document.body?.getBoundingClientRect();
  const pageW = page?.width || window.innerWidth;
  const pageH = page?.height || window.innerHeight;
  if (!(c.width > 0) || !(pageW > 0) || !(pageH > 0)) return null;
  return { left: c.left - (page?.left ?? 0), top: c.top - (page?.top ?? 0), scale: c.width / worldW, pageW, pageH };
}

/* ---------------------------------------------------------- the Sky scene */

export const SKY_SCENE = 'Sky';
const SKY_KEY = 'fw-sky';

/**
 * Start the sky: its own scene, sent to the back of the scene list, drawing
 * one opaque Image under every other scene for the rest of the session.
 *
 * Scenes still paint their camera in `theme().paper` from before the sky
 * existed. A camera background in exactly the page colour means "the page",
 * and the page is now the sky, so such a camera is made transparent right
 * after its scene's `create` — a deliberate background in any other colour
 * is left alone. That keeps every screen on the sky without a line changed in
 * any of them; a scene may still drop its `setBackgroundColor(t.paper)`.
 *
 * Idempotent: a second call finds the sky running and does nothing.
 */
export function installSky(game: Phaser.Game): void {
  const scenes = game.scene;
  if (scenes.getScene(SKY_SCENE)) return;
  applyPageSky();
  scenes.add(SKY_SCENE, makeSkyScene(), true);
  scenes.sendToBack(SKY_SCENE);

  const paper = theme().paper;
  for (const s of scenes.scenes) {
    if (s.sys.settings.key === SKY_SCENE) continue;
    s.sys.events.on('create', () => {
      const cam = s.cameras?.main;
      if (!cam) return;
      const bg = cam.backgroundColor;
      // Alpha 0, not `transparent`: the WebGL renderer paints any background
      // whose alpha is above 0, whatever that flag says.
      if (bg && bg.alpha > 0 && (bg.color & 0xffffff) === paper) cam.setBackgroundColor('rgba(0,0,0,0)');
    });
  }
}

/**
 * The Sky scene's class, made on demand — defining it at load would reach
 * for Phaser.Scene, which is a stand-in under every UI test.
 */
function makeSkyScene(): Phaser.Types.Scenes.SceneType {
  return class SkyScene extends Phaser.Scene {
    private img: Phaser.GameObjects.Image | null = null;
    private builtFor = '';

    constructor() {
      super({ key: SKY_SCENE, active: false });
    }

    create(): void {
      this.cameras.main.setBackgroundColor(theme().paper);
      this.bake();
      // The ScaleManager is the game's, not the scene's: it reaches a paused scene.
      this.scale.on('resize', this.bake, this);
      this.events.once('shutdown', () => this.scale.off('resize', this.bake, this));
      /*
       * Paused as soon as it is running: a paused scene is still DRAWN, but it
       * does not update, and it is not "active" — so anything that asks for
       * the running scene (getScenes(true), isActive) still finds only the
       * screen the player is on, never the sky under it.
       */
      this.events.once('create', () => this.scene.pause());
    }

    /** Paint (or repaint) the sky for the world as it is: its height, and the canvas's place on the page. */
    private bake(): void {
      const w = BASE_WIDTH;
      const h = viewHeight();
      const place = measurePlace(this.game.canvas, w) ?? fillingPlace(w, h);
      const sig = `${h}:${place.left.toFixed(1)}:${place.top.toFixed(1)}:${place.scale.toFixed(4)}:${place.pageW}x${place.pageH}`;
      if (sig === this.builtFor && this.img) return;
      this.builtFor = sig;
      let tex = this.textures.exists(SKY_KEY) ? (this.textures.get(SKY_KEY) as Phaser.Textures.CanvasTexture) : null;
      if (tex && (tex.width !== w || tex.height !== h)) {
        this.img?.destroy();
        this.img = null;
        this.textures.remove(SKY_KEY);
        tex = null;
      }
      tex = tex ?? this.textures.createCanvas(SKY_KEY, w, h);
      if (!tex) return;
      const ctx = tex.getContext();
      paintSky(ctx, w, h, place);
      paintStars(ctx, starField(w, h));
      tex.refresh();
      if (!this.img) this.img = this.add.image(0, 0, SKY_KEY).setOrigin(0, 0);
    }
  };
}
