/**
 * InkRenderer — everything the player sees.
 *
 * Ink on paper, not neon. The walls are quiet: no outline, no texture. The ink
 * is the only loud thing on the page.
 *
 * The renderer is the ONLY place smoothing and nib width are applied. Collision
 * runs on the raw samples at a fixed hit radius, so however thick the ink
 * happens to look, it never changes what kills you — and the drawn path is
 * held to within a hit radius of the tested one, so the player is never shown a
 * stroke doing something the rules did not allow.
 */

import Phaser from 'phaser';
import { boundsOf, mirrorPath, type Rect, type Vec2 } from '../core/Geometry';
import {
  closedFigure,
  renderStroke,
  type DrawnStroke,
} from '../core/StrokeRecorder';
import { buildRibbon, DEFAULT_RIBBON, type RibbonOptions } from '../core/Ribbon';
import type { Playfield } from '../core/Playfield';
import { BASE_HEIGHT, BASE_WIDTH, type InkTheme, METRICS, pt, theme } from './Theme';

const DEPTH = {
  level: 10,
  reveal: 15,
  mirror: 18,
  stroke: 20,
  win: 30,
  wash: 40,
} as const;

/** The path actually drawn, plus its timing, from the collision-tested samples. */
function drawnPath(raw: readonly Vec2[], times: readonly number[]): DrawnStroke {
  return renderStroke(raw, times, METRICS.renderMaxSpacing, METRICS.smoothIterations);
}

/** Nib options for the current theme. */
function nib(): RibbonOptions {
  return { ...DEFAULT_RIBBON, baseWidth: pt(theme().strokePt) };
}

/**
 * Paint a ribbon: every segment as a quad, every joint as a disc.
 *
 * Always at full opacity. Neighbouring quads overlap, and at reduced alpha each
 * overlap would darken where it met the next, so the stroke would look beaded.
 * The mirror is lightened by pre-blending its COLOUR instead — see `veil`.
 */
function paintRibbon(
  g: Phaser.GameObjects.Graphics,
  stroke: DrawnStroke,
  color: number,
  opts: RibbonOptions
): void {
  const { quads, discs } = buildRibbon(stroke.points, stroke.times, opts);

  g.fillStyle(color, 1);
  for (const q of quads) g.fillPoints([q.a, q.b, q.c, q.d], true);
  for (const d of discs) {
    if (d.r > 0.25) g.fillCircle(d.p.x, d.p.y, d.r);
  }
}

function mirrorStroke(stroke: DrawnStroke, axisX: number): DrawnStroke {
  return { points: mirrorPath(stroke.points, axisX), times: stroke.times };
}

/**
 * The mirror's colour, pre-blended toward the paper.
 *
 * The obvious way to make the reflection quieter is to draw the same ink at
 * `mirrorAlpha` and let the compositor do it. That does not work here, and the
 * reason is worth keeping: a ribbon is not one shape, it is dozens of
 * OVERLAPPING quads and discs, and Phaser applies a Graphics object's alpha per
 * draw command rather than to the finished result. Every overlap composites on
 * top of the last, so 0.45 accumulated to a measured 0.95-0.97 — the reflection
 * rendered as solid as the player's own line, which is exactly the distinction
 * the game is built on.
 *
 * Blending the colour toward the paper instead gives the intended weight in one
 * opaque pass, immune to how many times the ribbon crosses itself, and costs
 * nothing.
 */
function veil(ink: number, t: InkTheme): number {
  const paper = t.paper;
  const mix = (shift: number): number => {
    const a = (ink >> shift) & 0xff;
    const b = (paper >> shift) & 0xff;
    return Math.round(b + (a - b) * t.mirrorAlpha) & 0xff;
  };
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

export class InkRenderer {
  private readonly levelG: Phaser.GameObjects.Graphics;
  private readonly revealG: Phaser.GameObjects.Graphics;
  private readonly mirrorG: Phaser.GameObjects.Graphics;
  private readonly strokeG: Phaser.GameObjects.Graphics;
  private readonly washG: Phaser.GameObjects.Graphics;
  private winLayer: Phaser.GameObjects.Container | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly pf: Playfield
  ) {
    this.levelG = scene.add.graphics().setDepth(DEPTH.level);
    this.revealG = scene.add.graphics().setDepth(DEPTH.reveal).setAlpha(0);
    // Opaque; the reflection's lightness lives in its colour, not its alpha.
    this.mirrorG = scene.add.graphics().setDepth(DEPTH.mirror);
    this.strokeG = scene.add.graphics().setDepth(DEPTH.stroke);
    this.washG = scene.add.graphics().setDepth(DEPTH.wash).setAlpha(0);
  }

  /* --------------------------------------------------------------- level */

  /**
   * Takes pixel-space geometry, not level-space: converting normalized
   * coordinates is the Playfield's job and happens once, when a level loads.
   */
  drawLevel(walls: readonly Rect[], startPx: Vec2, goalPx: Vec2): void {
    const t = theme();
    const g = this.levelG;
    g.clear();

    this.drawAxis(g);

    g.fillStyle(t.wall, 1);
    for (const w of walls) {
      const r = Math.min(METRICS.wallCornerRadius, w.w / 2, w.h / 2);
      g.fillRoundedRect(w.x, w.y, w.w, w.h, r);
    }

    // Reflections of the markers, at reduced opacity. They are not targets.
    this.drawStart(g, this.pf.mirror(startPx), t.reflectionAlpha);
    this.drawGoal(g, this.pf.mirror(goalPx), t.reflectionAlpha);

    this.drawStart(g, startPx, 1);
    this.drawGoal(g, goalPx, 1);
  }

  private drawAxis(g: Phaser.GameObjects.Graphics): void {
    const t = theme();
    const x = this.pf.axisX;
    const step = METRICS.axisDash + METRICS.axisGap;

    g.lineStyle(METRICS.axisWidth, t.ink, t.axisAlpha);
    for (let y = this.pf.y; y < this.pf.bottom; y += step) {
      g.lineBetween(x, y, x, Math.min(y + METRICS.axisDash, this.pf.bottom));
    }
  }

  private drawStart(g: Phaser.GameObjects.Graphics, p: Vec2, alpha: number): void {
    g.fillStyle(theme().accent, alpha);
    g.fillCircle(p.x, p.y, METRICS.startRadius);
  }

  private drawGoal(g: Phaser.GameObjects.Graphics, p: Vec2, alpha: number): void {
    const t = theme();
    g.lineStyle(METRICS.goalRingWidth, t.accent, alpha);
    g.strokeCircle(p.x, p.y, METRICS.goalRadius);
    g.fillStyle(t.accent, alpha * 0.55);
    g.fillCircle(p.x, p.y, pt(2.5));
  }

  /* ------------------------------------------------------------ stroke */

  /** Redraw the live stroke and its reflection from the raw samples. */
  drawStroke(
    raw: readonly Vec2[],
    times: readonly number[],
    color?: number
  ): void {
    const t = theme();
    this.strokeG.clear();
    this.mirrorG.clear();
    // Opaque: the lightness is baked into the COLOUR, not the alpha. See below.
    this.mirrorG.setAlpha(1);

    if (raw.length === 0) return;

    const stroke = drawnPath(raw, times);
    const ink = color ?? t.ink;
    const opts = nib();

    paintRibbon(this.mirrorG, mirrorStroke(stroke, this.pf.axisX), veil(ink, t), opts);
    paintRibbon(this.strokeG, stroke, ink, opts);
  }

  clearStroke(): void {
    this.strokeG.clear();
    this.mirrorG.clear();
  }

  /* ---------------------------------------------------------------- fail */

  /**
   * 400ms of red and then it is gone. No modal, no "you lost", no tap to
   * dismiss — the retry loop is the product, and anything that stands between
   * the player and their next attempt is a tax on it.
   */
  flashFail(raw: readonly Vec2[], times: readonly number[]): void {
    const t = theme();
    this.drawStroke(raw, times, t.fail);

    this.washG.clear();
    this.washG.fillStyle(t.fail, 1);
    this.washG.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
    this.washG.setAlpha(0.1);

    this.scene.tweens.killTweensOf(this.washG);
    this.scene.tweens.add({
      targets: this.washG,
      alpha: 0,
      duration: METRICS.failFlashMs,
      ease: 'Quad.easeOut',
    });
  }

  /* -------------------------------------------------------------- reveal */

  /**
   * Paint the mirror's forbidden bands onto the left half.
   *
   * This is the rewarded-video reward, and it is the right one because it hands
   * over exactly the information the game withholds: not the answer, but where
   * your own reflection is about to kill you. The player still has to draw it.
   */
  showReveal(mirroredWalls: readonly Rect[], durationMs: number): void {
    const t = theme();
    const g = this.revealG;
    g.clear();
    g.setAlpha(0);

    g.fillStyle(t.fail, 0.16);
    for (const w of mirroredWalls) {
      const r = Math.min(METRICS.wallCornerRadius, w.w / 2, w.h / 2);
      g.fillRoundedRect(w.x, w.y, w.w, w.h, r);
    }

    this.scene.tweens.killTweensOf(g);
    this.scene.tweens.add({
      targets: g,
      alpha: 1,
      duration: 220,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.scene.tweens.add({
          targets: g,
          alpha: 0,
          delay: durationMs,
          duration: 420,
          ease: 'Quad.easeIn',
          onComplete: () => g.clear(),
        });
      },
    });
  }

  clearReveal(): void {
    this.scene.tweens.killTweensOf(this.revealG);
    this.revealG.clear();
    this.revealG.setAlpha(0);
  }

  /* ----------------------------------------------------------------- win */

  /**
   * THE feature. The stroke and its mirror close into one symmetric figure —
   * a butterfly, a Rorschach blot — which is filled and allowed to settle.
   * No confetti, no stars, no score. The figure is the reward.
   */
  presentWin(raw: readonly Vec2[], times: readonly number[]): void {
    this.clearWin();
    this.clearStroke();

    const stroke = drawnPath(raw, times);
    const layer = buildFigure(this.scene, stroke, this.pf.axisX);
    if (!layer) return;

    layer.setDepth(DEPTH.win);
    layer.setScale(METRICS.winSettleFrom);
    this.winLayer = layer;

    this.scene.tweens.add({
      targets: layer,
      scale: 1,
      delay: METRICS.winHoldMs,
      duration: METRICS.winSettleMs,
      ease: 'Cubic.easeOut',
    });
  }

  clearWin(): void {
    if (!this.winLayer) return;
    this.scene.tweens.killTweensOf(this.winLayer);
    this.winLayer.destroy(true);
    this.winLayer = null;
  }

  destroy(): void {
    this.clearWin();
    this.levelG.destroy();
    this.revealG.destroy();
    this.mirrorG.destroy();
    this.strokeG.destroy();
    this.washG.destroy();
  }
}

/**
 * Build the closed symmetric figure as a container centred on itself.
 *
 * Shared by the win moment and the gallery, so a saved figure is rendered by
 * exactly the same code that drew it the moment it was earned — anything else
 * and the thing people share stops matching the thing they made.
 */
export function buildFigure(
  scene: Phaser.Scene,
  stroke: DrawnStroke,
  axisX: number,
  opts?: Partial<RibbonOptions>
): Phaser.GameObjects.Container | null {
  const t = theme();
  const figure = closedFigure(stroke.points, axisX);
  const bounds = boundsOf(figure);
  if (!bounds) return null;

  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  const rebase = (p: Vec2): Vec2 => ({ x: p.x - cx, y: p.y - cy });

  const ribbonOpts: RibbonOptions = {
    ...DEFAULT_RIBBON,
    baseWidth: pt(t.strokePt),
    ...opts,
  };

  const fill = scene.add.graphics();
  fill.fillStyle(t.ink, t.winFillAlpha);
  fill.fillPoints(figure.map(rebase), true);

  const local: DrawnStroke = { points: stroke.points.map(rebase), times: stroke.times };
  const mirrored: DrawnStroke = {
    points: mirrorPath(stroke.points, axisX).map(rebase),
    times: stroke.times,
  };

  // Same reason as the live stroke: a ribbon overlaps itself, so object alpha
  // accumulates. The reflection's weight lives in its colour.
  const mirrorG = scene.add.graphics();
  paintRibbon(mirrorG, mirrored, veil(t.ink, t), ribbonOpts);

  const inkG = scene.add.graphics();
  paintRibbon(inkG, local, t.ink, ribbonOpts);

  return scene.add.container(cx, cy, [fill, mirrorG, inkG]);
}

/**
 * Paint a saved figure into an arbitrary box — the gallery thumbnail.
 *
 * Vector, not a cached bitmap: a grid of figures redrawn as Graphics costs a
 * few hundred fills and stays crisp at any size, where pre-rendering a hundred
 * canvases would stall the scene on open and blur on a bigger screen.
 */
export function paintFigureInto(
  g: Phaser.GameObjects.Graphics,
  raw: readonly Vec2[],
  times: readonly number[],
  axisX: number,
  box: Rect,
  alphaScale = 1
): void {
  const t = theme();
  const stroke = drawnPath(raw, times);
  const outline = closedFigure(stroke.points, axisX);
  const bounds = boundsOf(outline);
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) return;

  const scale = Math.min(box.w / bounds.w, box.h / bounds.h);
  const offX = box.x + box.w / 2 - (bounds.x + bounds.w / 2) * scale;
  const offY = box.y + box.h / 2 - (bounds.y + bounds.h / 2) * scale;
  const place = (p: Vec2): Vec2 => ({ x: p.x * scale + offX, y: p.y * scale + offY });

  const opts: RibbonOptions = {
    ...DEFAULT_RIBBON,
    baseWidth: Math.max(1.5, pt(t.strokePt) * scale),
  };

  g.fillStyle(t.ink, t.winFillAlpha * alphaScale);
  g.fillPoints(outline.map(place), true);

  paintRibbonAlpha(
    g,
    { points: mirrorPath(stroke.points, axisX).map(place), times: stroke.times },
    veil(t.ink, t),
    alphaScale,
    opts
  );
  paintRibbonAlpha(
    g,
    { points: stroke.points.map(place), times: stroke.times },
    t.ink,
    alphaScale,
    opts
  );
}

/**
 * Ribbon at an explicit alpha.
 *
 * The live stroke fades its mirror by setting alpha on a whole Graphics object,
 * because overlapping quads at partial alpha bead where they meet. A thumbnail
 * is small enough that the beading is sub-pixel, and sharing one Graphics for
 * the whole grid is worth far more than the artefact costs.
 */
function paintRibbonAlpha(
  g: Phaser.GameObjects.Graphics,
  stroke: DrawnStroke,
  color: number,
  alpha: number,
  opts: RibbonOptions
): void {
  const { quads, discs } = buildRibbon(stroke.points, stroke.times, opts);
  g.fillStyle(color, alpha);
  for (const q of quads) g.fillPoints([q.a, q.b, q.c, q.d], true);
  for (const d of discs) {
    if (d.r > 0.25) g.fillCircle(d.p.x, d.p.y, d.r);
  }
}
