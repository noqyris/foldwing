/**
 * ShareCard — the figure, rendered as a 1080×1080 image worth posting.
 *
 * Drawn on a plain 2D canvas rather than through Phaser's WebGL snapshot. The
 * export has to be pixel-exact, identical on web and device, and available
 * without a live scene (the gallery renders figures the player earned in an
 * earlier session), and a raw canvas gives all three where a render-texture
 * readback gives none of them reliably.
 *
 * Two variants:
 *   card        paper, the figure, the wordmark. This is what gets shared —
 *               it carries the brand into someone else's feed, which is the
 *               entire point of a share button.
 *   transparent just the ink on alpha, for anyone compositing it themselves.
 *
 * The default is the card. A transparent PNG posted to a social app lands on
 * whatever background that app happens to use, which is usually black, and the
 * dark ink disappears into it — a shared image nobody can see is not a share.
 */

import { boundsOf, mirrorPath, type Vec2 } from '../core/Geometry';
import { closedFigure, renderStroke } from '../core/StrokeRecorder';
import { buildRibbon, DEFAULT_RIBBON } from '../core/Ribbon';
import { Playfield } from '../core/Playfield';
import { BASE_HEIGHT, BASE_WIDTH, METRICS, pt, theme } from './Theme';
import type { SavedFigure } from '../systems/Progress';

export const CARD_SIZE = 1080;

export interface CardOptions {
  readonly size?: number;
  readonly transparent?: boolean;
  /** Caption under the figure. Falsy hides the whole footer. */
  readonly caption?: string;
  readonly showWordmark?: boolean;
  /** Fraction of the side left as breathing room. Default 0.12. */
  readonly marginScale?: number;
  /** Multiplier on the nib. The app icon wants a far bolder line than a card. */
  readonly nibScale?: number;
  /** Skip the grain — wanted for an app icon, which must stay flat. */
  readonly flat?: boolean;
}

function cssRgba(color: number, alpha: number): string {
  return `rgba(${(color >> 16) & 0xff},${(color >> 8) & 0xff},${color & 0xff},${alpha})`;
}

/**
 * Paper is not flat. A very light grain stops a 1080×1080 field of one colour
 * from reading as "empty PNG" and gives the ink something to sit on.
 *
 * The grain goes through an offscreen canvas and `drawImage`, NOT
 * `putImageData`. putImageData does not composite — it overwrites the
 * destination pixels including their alpha — so painting grain that way punched
 * the opaque paper down to ~10% alpha and every colour laid on top of it came
 * out wrong.
 */
function layPaper(ctx: CanvasRenderingContext2D, size: number, paper: number): void {
  ctx.fillStyle = cssRgba(paper, 1);
  ctx.fillRect(0, 0, size, size);

  // A small tile, stretched: full-resolution noise is 4MB of work for a texture
  // nobody can resolve at this alpha anyway.
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
  ctx.drawImage(off, 0, 0, size, size);
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

function paintRibbon(
  ctx: CanvasRenderingContext2D,
  points: readonly Vec2[],
  times: readonly number[],
  baseWidth: number
): void {
  const { quads, discs } = buildRibbon(points, times, {
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
 * Render a saved figure to a PNG data URL.
 *
 * The figure is rebuilt through the SAME ribbon and smoothing code the game
 * used when it was earned, so what the player shares is what they made — down
 * to where they hesitated and where they rushed.
 */
export function renderShareCard(figure: SavedFigure, opts: CardOptions = {}): string {
  const size = opts.size ?? CARD_SIZE;
  const t = theme();

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  if (!opts.transparent) {
    if (opts.flat) {
      ctx.fillStyle = cssRgba(t.paper, 1);
      ctx.fillRect(0, 0, size, size);
    } else {
      layPaper(ctx, size, t.paper);
    }
  }

  // Rebuild in the reference playfield so the shape matches the game exactly,
  // then fit that shape to the card. Normalized storage is what makes this
  // independent of whatever device drew it.
  const pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset);
  const raw = figure.points.map((p) => pf.toScreen(p));
  const stroke = renderStroke(
    raw,
    figure.times,
    METRICS.renderMaxSpacing,
    METRICS.smoothIterations
  );

  const mirrored = mirrorPath(stroke.points, pf.axisX);
  const outline = closedFigure(stroke.points, pf.axisX);
  const bounds = boundsOf(outline);
  if (!bounds) return canvas.toDataURL('image/png');

  const hasFooter = Boolean(opts.caption) || opts.showWordmark !== false;
  const margin = size * (opts.marginScale ?? 0.12);
  const footer = hasFooter && !opts.transparent ? size * 0.11 : 0;
  const boxW = size - margin * 2;
  const boxH = size - margin * 2 - footer;

  // Uniform scale: the figure's proportions are the drawing. Stretching it to
  // fill the square would make every player's figure the same shape.
  const scale = Math.min(boxW / Math.max(bounds.w, 1), boxH / Math.max(bounds.h, 1));
  const offX = size / 2 - (bounds.x + bounds.w / 2) * scale;
  const offY = margin + (boxH - bounds.h * scale) / 2 - bounds.y * scale;

  const place = (p: Vec2): Vec2 => ({ x: p.x * scale + offX, y: p.y * scale + offY });
  const nibWidth = pt(t.strokePt) * scale * (opts.nibScale ?? 1);

  // Fill first, so the strokes sit on top of their own silhouette.
  ctx.fillStyle = cssRgba(t.ink, t.winFillAlpha);
  fillPath(ctx, outline.map(place));

  ctx.fillStyle = cssRgba(t.ink, t.mirrorAlpha);
  paintRibbon(ctx, mirrored.map(place), stroke.times, nibWidth);

  ctx.fillStyle = cssRgba(t.ink, 1);
  paintRibbon(ctx, stroke.points.map(place), stroke.times, nibWidth);

  if (footer > 0) {
    const baseY = size - margin * 0.72;

    if (opts.caption) {
      ctx.font = `${Math.round(size * 0.034)}px Georgia, "Times New Roman", serif`;
      ctx.fillStyle = cssRgba(t.ink, 0.46);
      ctx.textAlign = 'center';
      ctx.fillText(opts.caption, size / 2, baseY - size * 0.055);
    }

    if (opts.showWordmark !== false) {
      ctx.font = `${Math.round(size * 0.042)}px Georgia, "Times New Roman", serif`;
      ctx.fillStyle = cssRgba(t.ink, 0.8);
      ctx.textAlign = 'center';
      ctx.fillText('foldwing', size / 2, baseY);
    }
  }

  return canvas.toDataURL('image/png');
}
