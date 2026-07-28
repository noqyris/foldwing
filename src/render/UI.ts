/**
 * UI — the modern shell around the game.
 *
 * The art direction of the PLAY surface is fixed: ink on paper, quiet walls,
 * restraint everywhere except the win. That is the product's identity and the
 * saved figures depend on it. So the modern feel is carried by everything
 * around the play surface instead — a real type scale, generous whitespace,
 * soft elevation, spring transitions, and touch targets that never fight the
 * thumb. Contemporary minimal, not neon.
 *
 * Everything here is built from Phaser primitives, so there are no font or
 * image assets to load and cold start stays under a second.
 */

import Phaser from 'phaser';
import { centredHitArea } from './HitArea';
import { BASE_WIDTH, METRICS, pt, rgba, theme } from './Theme';

/**
 * Make a centre-drawn container tappable over its whole face.
 *
 * Always go through this rather than calling `setInteractive` with a hand-built
 * rectangle: the obvious `(-w/2, -h/2, w, h)` is wrong, because Phaser adds the
 * display origin back before testing containment. See `HitArea.ts` — that
 * mistake shipped, and it is why buttons needed several taps.
 */
export function tappable(
  container: Phaser.GameObjects.Container,
  w: number,
  h: number
): void {
  const a = centredHitArea(w, h);
  container.setInteractive(
    new Phaser.Geom.Rectangle(a.x, a.y, a.width, a.height),
    Phaser.Geom.Rectangle.Contains
  );
}

/* ------------------------------------------------------------- type scale */

export const FONT = {
  /** The display face. Serif carries the "ink on paper" idea into the chrome. */
  display: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
  /** Numerals, labels, anything that must read as interface rather than prose. */
  ui: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif',
} as const;

/** A proper modular scale, in logical points. */
export const TYPE = {
  hero: pt(46),
  title: pt(27),
  heading: pt(19),
  body: pt(15),
  label: pt(12.5),
  micro: pt(10.5),
} as const;

export const SPACE = {
  xs: pt(6),
  sm: pt(10),
  md: pt(16),
  lg: pt(24),
  xl: pt(36),
  xxl: pt(56),
} as const;

export const RADIUS = {
  sm: pt(10),
  md: pt(16),
  lg: pt(22),
  pill: pt(999),
} as const;

/**
 * How far a finger may travel between press and release and still count as a
 * tap. Generous on purpose: a thumb on glass never holds still, and treating
 * that drift as a drag is what makes a button feel broken.
 */
export const TAP_SLOP = pt(14);

/* ---------------------------------------------------------------- helpers */

/**
 * Rounded rect with the corner radius clamped to what the box can actually
 * hold.
 *
 * Phaser's `fillRoundedRect` takes the radius on trust and draws the corner
 * arcs at whatever size you hand it. Pass a pill radius to a 60px-tall chip and
 * those arcs sweep hundreds of pixels past the shape, which paints faint
 * full-height streaks across the page — a real bug that shipped into the menu
 * and the in-game reveal button before this helper existed. Always clamp.
 */
export function roundRect(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
): void {
  g.fillRoundedRect(x, y, w, h, Math.max(0, Math.min(radius, w / 2, h / 2)));
}

export interface TextOptions {
  size?: number;
  color?: number;
  alpha?: number;
  font?: string;
  align?: 'left' | 'center' | 'right';
  letterSpacing?: number;
}

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
  const obj = scene.add.text(x, y, text, style);
  if (opts.letterSpacing) obj.setLetterSpacing(opts.letterSpacing);
  return obj;
}

/**
 * A soft drop shadow, faked with stacked translucent rounded rects.
 *
 * Phaser has no shadow primitive for Graphics, and a blur post-pipeline for one
 * card would cost a render target. Three offset layers at low alpha read as
 * elevation at a fraction of the cost, and stay crisp at any FIT scale.
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
  const t = theme();
  const layers = [
    { spread: pt(7), dy: pt(4), alpha: 0.05 },
    { spread: pt(4), dy: pt(2.5), alpha: 0.06 },
    { spread: pt(1.5), dy: pt(1), alpha: 0.07 },
  ];
  for (const l of layers) {
    g.fillStyle(t.ink, l.alpha * strength);
    roundRect(
      g,
      x - l.spread,
      y - l.spread + l.dy,
      w + l.spread * 2,
      h + l.spread * 2,
      radius + l.spread
    );
  }
}

/* ----------------------------------------------------------------- button */

export interface ButtonOptions {
  width: number;
  height?: number;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: number;
  sub?: string;
  onPress: () => void;
}

/**
 * A pressable card. Returns a Container so callers can position, tween and
 * destroy it as one thing.
 *
 * The press animation is a scale dip with a spring back rather than a colour
 * flash — on a page this quiet, motion reads as responsive where a colour
 * change would read as noise.
 */
export function button(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: ButtonOptions
): Phaser.GameObjects.Container {
  const t = theme();
  const variant = opts.variant ?? 'primary';
  const w = opts.width;
  const h = opts.height ?? (opts.sub ? pt(66) : pt(54));

  const container = scene.add.container(x, y);
  const g = scene.add.graphics();

  const paint = (pressed: boolean): void => {
    g.clear();
    const alpha = pressed ? 0.86 : 1;

    if (variant === 'primary') {
      softShadow(g, -w / 2, -h / 2, w, h, RADIUS.md, pressed ? 0.4 : 1);
      g.fillStyle(t.ink, alpha);
      roundRect(g, -w / 2, -h / 2, w, h, RADIUS.md);
    } else if (variant === 'secondary') {
      g.fillStyle(t.ink, pressed ? 0.09 : 0.055);
      roundRect(g, -w / 2, -h / 2, w, h, RADIUS.md);
    } else {
      g.fillStyle(t.ink, pressed ? 0.06 : 0);
      roundRect(g, -w / 2, -h / 2, w, h, RADIUS.md);
    }
  };
  paint(false);
  container.add(g);

  const onInk = variant === 'primary';
  const labelColor = onInk ? t.paper : t.ink;
  const labelY = opts.sub ? -pt(9) : 0;

  const main = label(scene, 0, labelY, text, {
    size: opts.size ?? TYPE.heading,
    color: labelColor,
    alpha: onInk ? 1 : 0.9,
    font: FONT.ui,
  }).setOrigin(0.5);
  container.add(main);

  if (opts.sub) {
    container.add(
      label(scene, 0, pt(13), opts.sub, {
        size: TYPE.label,
        color: labelColor,
        alpha: onInk ? 0.66 : 0.5,
      }).setOrigin(0.5)
    );
  }

  container.setSize(w, h);
  tappable(container, w, h);

  /*
   * Arm on the button's own pointerdown, but resolve on the SCENE's pointerup.
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
  let armed = false;
  let downX = 0;
  let downY = 0;

  const settle = (): void => {
    paint(false);
    scene.tweens.add({ targets: container, scale: 1, duration: 320, ease: 'Back.easeOut' });
  };

  container.on('pointerdown', (p: Phaser.Input.Pointer) => {
    armed = true;
    downX = p.x;
    downY = p.y;
    paint(true);
    scene.tweens.add({ targets: container, scale: 0.965, duration: 90, ease: 'Quad.easeOut' });
  });

  const onUp = (p: Phaser.Input.Pointer): void => {
    if (!armed) return;
    armed = false;
    settle();

    if (Phaser.Math.Distance.Between(downX, downY, p.x, p.y) > TAP_SLOP) return;

    // Still require the release to land on the button, so dragging off it to
    // cancel — which people expect — keeps working.
    const b = container.getBounds();
    b.setTo(container.x - w / 2, container.y - h / 2, w, h);
    if (!b.contains(p.x, p.y)) return;

    opts.onPress();
  };

  scene.input.on(Phaser.Input.Events.POINTER_UP, onUp);
  container.once('destroy', () => {
    scene.input.off(Phaser.Input.Events.POINTER_UP, onUp);
  });

  return container;
}

/* ------------------------------------------------------------------ misc */

/** A hairline rule, for separating sections without drawing a box. */
export function rule(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  alpha = 0.1
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(theme().ink, alpha);
  g.fillRect(x - w / 2, y, w, Math.max(1, pt(0.5)));
  return g;
}

/**
 * The wordmark: "foldwing" with its own reflection under it, which is the whole
 * game in one image and costs nothing to draw.
 */
export function wordmark(
  scene: Phaser.Scene,
  x: number,
  y: number
): Phaser.GameObjects.Container {
  const t = theme();
  const c = scene.add.container(x, y);

  const top = label(scene, 0, 0, 'foldwing', {
    size: TYPE.hero,
    color: t.ink,
    font: FONT.display,
    letterSpacing: pt(0.5),
  }).setOrigin(0.5, 1);

  const reflection = label(scene, 0, pt(3), 'foldwing', {
    size: TYPE.hero,
    color: t.ink,
    alpha: t.mirrorAlpha * 0.42,
    font: FONT.display,
    letterSpacing: pt(0.5),
  })
    .setOrigin(0.5, 1)
    .setScale(1, -1);

  c.add([reflection, top]);
  return c;
}

/** Standard page entrance: content rises a few points and fades in. */
export function enter(
  scene: Phaser.Scene,
  targets: Phaser.GameObjects.GameObject[],
  stagger = 45
): void {
  targets.forEach((obj, i) => {
    const o = obj as unknown as Phaser.GameObjects.Components.Transform &
      Phaser.GameObjects.Components.Alpha;
    const restY = o.y;
    o.y = restY + pt(14);
    o.alpha = 0;
    scene.tweens.add({
      targets: o,
      y: restY,
      alpha: 1,
      duration: 420,
      delay: i * stagger,
      ease: 'Cubic.easeOut',
    });
  });
}

/** Width of a comfortable content column, inset from the canvas edges. */
export const COLUMN = BASE_WIDTH - METRICS.inset.left * 2 - pt(16) * 2;
