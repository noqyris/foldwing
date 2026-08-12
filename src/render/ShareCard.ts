/**
 * ShareCard — a finished run, rendered as an image worth posting.
 *
 * Drawn on a plain 2D canvas rather than through Phaser's WebGL snapshot. The
 * export has to be pixel-exact, identical on web and device, and available
 * without a live scene (the gallery renders figures the player earned in an
 * earlier session), and a raw canvas gives all three where a render-texture
 * readback gives none of them reliably.
 *
 * WHAT IS ON THE CARD. The maze, the line that solved it, its reflection, the
 * time, and a question. The card used to carry the closed figure alone — a
 * lovely mark, and completely mute: it showed neither the walls that made it
 * hard nor that there had been a puzzle at all, so the only people who could
 * read it were people who already played. The maze is what makes the image
 * legible to a stranger, and the time plus "Can you beat me?" is what turns it
 * from a picture into an invitation.
 *
 * Two variants:
 *   card        paper, the maze, the figure, the wordmark. This is what gets
 *               shared — it carries the brand into someone else's feed, which
 *               is the entire point of a share button.
 *   transparent just the ink on alpha, for anyone compositing it themselves.
 *
 * The default is the card. A transparent PNG posted to a social app lands on
 * whatever background that app happens to use, which is usually black, and the
 * dark ink disappears into it — a shared image nobody can see is not a share.
 */

import type { Vec2 } from '../core/Geometry';
import { buildRibbon, DEFAULT_RIBBON } from '../core/Ribbon';
import type { DrawnStroke } from '../core/StrokeRecorder';
import { theme, veiledInk } from './Theme';
import {
  goalRingWidth,
  layoutFigureCard,
  markerRadius,
  type CardLayout,
} from './FigureCard';
import type { SavedFigure } from '../systems/Progress';
import { APP_STORE_URL } from '../systems/WebDaily';

export const CARD_SIZE = 1080;

/**
 * Height of a card that carries a maze.
 *
 * 9:16, and not by taste: the playfield is 702×1102 base pixels, so at a 5%
 * margin the maze becomes exactly width-bound at this height and fills the card
 * edge to edge. A square card would have printed it 700px wide inside 1080 with
 * two fat bands of empty paper either side. It is also the shape of a phone
 * screenshot, which is what people expect a shared level to look like.
 */
export const CARD_MAZE_HEIGHT = 1920;

/**
 * How far the wordmark's baseline sits above the bottom margin, in multiples of
 * its own type size, so its reflection has somewhere to hang. Without it the
 * mark reads as cropped by the edge of the card rather than folded.
 */
const WORDMARK_DROP = 0.78;

export interface CardOptions {
  readonly size?: number;
  /** Card height. Defaults to 9:16 for a maze card, square without one. */
  readonly height?: number;
  readonly transparent?: boolean;
  /** Caption under the figure. Falsy hides the whole footer. */
  readonly caption?: string;
  /** The line that asks for a rematch. Falsy omits it. */
  readonly challenge?: string;
  readonly showWordmark?: boolean;
  /**
   * Draw the maze behind the figure. Defaults on whenever the figure carries
   * one and the card is a card — an icon (`flat`) and a compositing export
   * (`transparent`) both want the mark by itself.
   */
  readonly showMaze?: boolean;
  /** Fraction of the side left as breathing room. Default 0.12, 0.05 with a maze. */
  readonly marginScale?: number;
  /** Multiplier on the nib. The app icon wants a far bolder line than a card. */
  readonly nibScale?: number;
  /** Skip the grain — wanted for an app icon, which must stay flat. */
  readonly flat?: boolean;
}

/**
 * The line that turns a picture into an invitation.
 *
 * A shared image of a solved maze is a nice thing to look at and asks for
 * nothing. Naming the time and then daring the reader to beat it is what makes
 * the person receiving it open the game — which is the only reason a share
 * button exists.
 */
export const CHALLENGE = 'Can you beat me?';

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/** How the app shares one of its own figures. One definition, two callers. */
export function shareCardOptions(figure: SavedFigure): CardOptions {
  return {
    caption: `${figure.levelName} · ${seconds(figure.ms)}`,
    challenge: CHALLENGE,
  };
}

/**
 * The message beside the image.
 *
 * It repeats the time on purpose: a link preview or a text-only fallback strips
 * the picture, and the challenge has to survive that. The store link is what
 * makes it answerable by someone who does not have the game.
 */
export function shareText(figure: SavedFigure): string {
  return `${figure.levelName} in ${seconds(figure.ms)}. ${CHALLENGE}\n${APP_STORE_URL}`;
}

export function cssRgba(color: number, alpha: number): string {
  return `rgba(${(color >> 16) & 0xff},${(color >> 8) & 0xff},${color & 0xff},${alpha})`;
}

/**
 * Paper is not flat. A very light grain stops a big field of one colour from
 * reading as "empty PNG" and gives the ink something to sit on.
 *
 * The grain goes through an offscreen canvas and `drawImage`, NOT
 * `putImageData`. putImageData does not composite — it overwrites the
 * destination pixels including their alpha — so painting grain that way punched
 * the opaque paper down to ~10% alpha and every colour laid on top of it came
 * out wrong.
 */
export function layPaper(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  paper: number
): void {
  ctx.fillStyle = cssRgba(paper, 1);
  ctx.fillRect(0, 0, w, h);

  // A small tile, stretched: full-resolution noise is megabytes of work for a
  // texture nobody can resolve at this alpha anyway.
  const tile = 256;
  const off = document.createElement('canvas');
  off.width = tile;
  off.height = tile;
  const octx = off.getContext('2d');
  if (!octx) return;

  const grain = octx.createImageData(tile, tile);
  const d = grain.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.random() < 0.5 ? 0 : 255;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
    d[i + 3] = 10;
  }
  octx.putImageData(grain, 0, 0);

  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, 0, 0, w, h);
  ctx.restore();
}

function fillPath(ctx: CanvasRenderingContext2D, pts: readonly Vec2[]): void {
  if (pts.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fill();
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export function paintRibbon(
  ctx: CanvasRenderingContext2D,
  stroke: DrawnStroke,
  baseWidth: number
): void {
  const { quads, discs } = buildRibbon(stroke.points, stroke.times, {
    ...DEFAULT_RIBBON,
    baseWidth,
  });
  for (const q of quads) fillPath(ctx, [q.a, q.b, q.c, q.d]);
  for (const d of discs) {
    if (d.r <= 0.25) continue;
    ctx.beginPath();
    ctx.arc(d.p.x, d.p.y, d.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * The board: fold, walls, start and goal, in that order.
 *
 * Extracted so the replay video can paint the same board under a line that is
 * still being drawn. The still and the video are the same picture at different
 * moments, and two copies of this would drift the moment either changed.
 */
export function paintMaze(ctx: CanvasRenderingContext2D, layout: CardLayout): void {
  const t = theme();

  // The fold, dashed, exactly as the game draws it.
  if (layout.axis) {
    const { x, top, bottom } = layout.axis;
    const step = layout.axisDash + layout.axisGap;
    ctx.fillStyle = cssRgba(t.ink, t.axisAlpha);
    const w = Math.max(1, layout.scale * 2);
    for (let y = top; y < bottom; y += step) {
      ctx.fillRect(x - w / 2, y, w, Math.min(layout.axisDash, bottom - y));
    }
  }

  ctx.fillStyle = cssRgba(t.wall, 1);
  for (const wall of layout.walls) {
    roundRectPath(ctx, wall.x, wall.y, wall.w, wall.h, layout.wallRadius);
    ctx.fill();
  }

  for (const m of layout.markers) {
    const r = markerRadius(m.kind, layout.scale);
    if (m.kind === 'start') {
      ctx.fillStyle = cssRgba(t.accent, m.alpha);
      ctx.beginPath();
      ctx.arc(m.p.x, m.p.y, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = cssRgba(t.accent, m.alpha);
      ctx.lineWidth = goalRingWidth(layout.scale);
      ctx.beginPath();
      ctx.arc(m.p.x, m.p.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = cssRgba(t.accent, m.alpha * 0.55);
      ctx.beginPath();
      ctx.arc(m.p.x, m.p.y, Math.max(1, r * 0.17), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Render a saved run to a PNG data URL.
 *
 * The line is rebuilt through the SAME ribbon and smoothing code the game used
 * when it was earned, so what the player shares is what they made — down to
 * where they hesitated and where they rushed.
 */
export function renderShareCard(figure: SavedFigure, opts: CardOptions = {}): string {
  const t = theme();
  const width = opts.size ?? CARD_SIZE;

  const maze =
    opts.showMaze ??
    (Boolean(figure.walls && figure.walls.length > 0) && !opts.transparent && !opts.flat);
  const height = opts.height ?? (maze ? Math.round((width * CARD_MAZE_HEIGHT) / CARD_SIZE) : width);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  if (!opts.transparent) {
    if (opts.flat) {
      ctx.fillStyle = cssRgba(t.paper, 1);
      ctx.fillRect(0, 0, width, height);
    } else {
      layPaper(ctx, width, height, t.paper);
    }
  }

  const hasFooter =
    Boolean(opts.caption) || Boolean(opts.challenge) || opts.showWordmark !== false;
  // The maze already carries the playfield's own page margins, so it needs far
  // less around it than a bare figure cropped to its ink does.
  const margin = width * (opts.marginScale ?? (maze ? 0.05 : 0.12));
  // 0.12, not 0.11: the wordmark's reflection added a line's worth of height
  // to the footer, and the caption above it was landing inside the maze's box.
  const footer = hasFooter && !opts.transparent ? height * 0.12 : 0;

  const layout = layoutFigureCard(
    figure,
    {
      x: margin,
      y: margin,
      w: width - margin * 2,
      h: height - margin * 2 - footer,
    },
    opts.nibScale ?? 1
  );
  if (!layout) return canvas.toDataURL('image/png');

  if (maze) paintMaze(ctx, layout);

  // Fill first, so the strokes sit on top of their own silhouette.
  ctx.fillStyle = cssRgba(t.ink, t.winFillAlpha);
  fillPath(ctx, layout.outline);

  // Veiled colour at full opacity, not ink at mirrorAlpha: a ribbon overlaps
  // itself dozens of times and a 2D canvas composites every fill separately, so
  // the translucent version came out very nearly as dark as the real line —
  // erasing the difference between the stroke and its reflection on a card
  // whose whole subject is that difference. See veiledInk.
  ctx.fillStyle = cssRgba(veiledInk(t.ink, t), 1);
  paintRibbon(ctx, layout.mirrored, layout.nib);

  ctx.fillStyle = cssRgba(t.ink, 1);
  paintRibbon(ctx, layout.stroke, layout.nib);

  if (footer > 0) {
    /*
     * Stacked UP from the wordmark, so adding or dropping a line never moves
     * the lines below it. Sizes scale with the WIDTH (which is what decides
     * whether a line fits) and gaps with the height.
     */
    const serif = (px: number): string =>
      `${Math.round(px)}px Georgia, "Times New Roman", serif`;
    ctx.textAlign = 'center';
    const cx = width / 2;
    const markSize = width * 0.042;
    // Room under the baseline for the reflection to hang in.
    let baseY = height - margin - markSize * WORDMARK_DROP;

    if (opts.showWordmark !== false) {
      /*
       * The mark, not the word.
       *
       * The footer used to set "foldwing" as plain type, which is the game's
       * NAME but not its logo — the logo is the wordmark folded under itself,
       * the lockup the menu opens with. It is the identity doing the same
       * thing the game does, and on a card that is already about a line and
       * its reflection it is the one piece of branding that belongs there.
       *
       * Built from type rather than a bitmap on purpose: this renderer has to
       * work with no live scene and no asset loader (the gallery draws figures
       * earned in an earlier session), so an embedded PNG would be one more
       * thing that can fail to arrive.
       */
      ctx.font = serif(markSize);
      ctx.letterSpacing = `${(markSize * 0.012).toFixed(2)}px`;
      ctx.fillStyle = cssRgba(t.ink, 0.8);
      ctx.fillText('foldwing', cx, baseY);

      // Flipped about a line just under the baseline, and faint — the same
      // ratio the menu uses, so the two lockups read as one mark.
      ctx.save();
      ctx.translate(cx, baseY + markSize * 0.07);
      ctx.scale(1, -1);
      ctx.fillStyle = cssRgba(t.ink, t.mirrorAlpha * 0.42);
      ctx.fillText('foldwing', 0, 0);
      ctx.restore();

      ctx.letterSpacing = '0px';
      baseY -= height * 0.030;
    }

    if (opts.challenge) {
      ctx.font = serif(width * 0.038);
      ctx.fillStyle = cssRgba(t.ink, 0.62);
      ctx.fillText(opts.challenge, cx, baseY);
      baseY -= height * 0.028;
    }

    if (opts.caption) {
      ctx.font = serif(width * 0.032);
      ctx.fillStyle = cssRgba(t.ink, 0.46);
      ctx.fillText(opts.caption, cx, baseY);
    }
  }

  return canvas.toDataURL('image/png');
}
