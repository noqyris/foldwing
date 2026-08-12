/**
 * FigureCard — where every piece of a finished run lands inside a box.
 *
 * A saved figure is drawn twice in this game by two renderers that share no
 * code: the gallery paints Phaser Graphics, the share card paints a 2D canvas
 * (it has to work with no live scene and be pixel-identical on web and device).
 * That split is deliberate and stays. What must NOT be duplicated is the
 * arithmetic — which scale, which offset, which half of the maze, how wide the
 * nib is at that scale — because two copies of it drift, and the moment they do
 * the picture in the gallery stops being the picture that gets sent.
 *
 * So this module answers "where does everything go" once, in card pixels, and
 * the two painters do nothing but fill the shapes it hands them.
 *
 * THE WHOLE MAZE, NOT JUST THE FIGURE. The closed symmetric figure on its own
 * is a lovely mark and says nothing about what it took: the walls it threaded,
 * the half it could not see, or that there was a puzzle at all. A card carrying
 * the maze is legible to somebody who has never opened the game — which is the
 * only audience a shared image has.
 */

import { boundsOf, mirrorPath, type Rect, type Vec2 } from '../core/Geometry';
import { closedFigure, renderStroke, type DrawnStroke } from '../core/StrokeRecorder';
import { Playfield } from '../core/Playfield';
import type { SavedFigure } from '../systems/Progress';
import { BASE_HEIGHT, BASE_WIDTH, METRICS, pt, theme } from './Theme';

/** A start dot or a goal ring, already placed and sized in card pixels. */
export interface CardMarker {
  readonly p: Vec2;
  readonly kind: 'start' | 'goal';
  /** Reflections are drawn faint: they are not second targets. */
  readonly alpha: number;
}

export interface CardLayout {
  /** Card pixels per base pixel. Everything below is already multiplied by it. */
  readonly scale: number;
  /** Empty for a figure saved before mazes were kept — see SavedFigure.walls. */
  readonly walls: readonly Rect[];
  readonly wallRadius: number;
  readonly markers: readonly CardMarker[];
  /** The fold. Null when there is no maze to fold against. */
  readonly axis: { readonly x: number; readonly top: number; readonly bottom: number } | null;
  readonly axisDash: number;
  readonly axisGap: number;
  /** The closed figure: the line and its reflection joined into one silhouette. */
  readonly outline: readonly Vec2[];
  readonly stroke: DrawnStroke;
  readonly mirrored: DrawnStroke;
  readonly nib: number;
}

/**
 * Lay a saved run out inside `box`.
 *
 * Returns null only when there is nothing to draw at all — a figure with no
 * extent, which `boundsOf` reports for a stroke of fewer than two points.
 *
 * @param nibScale multiplier on the drawn line. The app icon wants a far bolder
 *                 line than a card does.
 */
export function layoutFigureCard(
  figure: SavedFigure,
  box: Rect,
  nibScale = 1
): CardLayout | null {
  /*
   * Rebuild in the reference playfield and fit THAT, so the shape matches the
   * game exactly. Normalized storage is what makes this independent of whatever
   * device drew it.
   */
  const pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset);
  const stroke = renderStroke(
    figure.points.map((p) => pf.toScreen(p)),
    figure.times,
    METRICS.renderMaxSpacing,
    METRICS.smoothIterations
  );
  const outline = closedFigure(stroke.points, pf.axisX);
  const figureBounds = boundsOf(outline);
  if (!figureBounds) return null;

  /*
   * With a maze, the frame is the PLAYFIELD — the same rectangle on every card,
   * so a wide figure and a narrow one sit at the same scale and two cards can
   * be compared at a glance. Without one, fall back to fitting the figure's own
   * bounds, which is all a figure saved before mazes were kept can offer.
   */
  const hasMaze = Boolean(figure.walls && figure.walls.length > 0);
  const frame: Rect = hasMaze
    ? { x: pf.x, y: pf.y, w: pf.w, h: pf.h }
    : figureBounds;

  const scale = Math.min(box.w / Math.max(frame.w, 1), box.h / Math.max(frame.h, 1));
  const offX = box.x + box.w / 2 - (frame.x + frame.w / 2) * scale;
  const offY = box.y + box.h / 2 - (frame.y + frame.h / 2) * scale;

  const place = (p: Vec2): Vec2 => ({ x: p.x * scale + offX, y: p.y * scale + offY });
  const placeRect = (r: Rect): Rect => ({
    x: r.x * scale + offX,
    y: r.y * scale + offY,
    w: r.w * scale,
    h: r.h * scale,
  });

  const markers: CardMarker[] = [];
  if (hasMaze && figure.start && figure.goal) {
    const start = pf.toScreen(figure.start);
    const goal = pf.toScreen(figure.goal);
    // Reflections first, so the real markers paint over them where they meet.
    markers.push(
      { p: place(pf.mirror(start)), kind: 'start', alpha: theme().reflectionAlpha },
      { p: place(pf.mirror(goal)), kind: 'goal', alpha: theme().reflectionAlpha },
      { p: place(start), kind: 'start', alpha: 1 },
      { p: place(goal), kind: 'goal', alpha: 1 }
    );
  }

  return {
    scale,
    walls: hasMaze ? figure.walls!.map((w) => placeRect(pf.toScreenRect(w))) : [],
    wallRadius: METRICS.wallCornerRadius * scale,
    markers,
    axis: hasMaze
      ? {
          x: pf.axisX * scale + offX,
          top: pf.y * scale + offY,
          bottom: pf.bottom * scale + offY,
        }
      : null,
    axisDash: METRICS.axisDash * scale,
    axisGap: METRICS.axisGap * scale,
    outline: outline.map(place),
    stroke: { points: stroke.points.map(place), times: stroke.times },
    mirrored: {
      points: mirrorPath(stroke.points, pf.axisX).map(place),
      times: stroke.times,
    },
    // Never thinner than a pixel: at gallery-thumbnail scale the honest width
    // rounds to nothing and the figure disappears from its own card.
    nib: Math.max(1.5, pt(theme().strokePt) * scale * nibScale),
  };
}

/**
 * The stroke as it stood `ms` into the run.
 *
 * The saved times are what let a figure be replayed rather than merely
 * redrawn: they are the real clock of the hand that made it, so a line that
 * hesitated at a wall hesitates again. Everything that animates a run — the
 * share video, and anything after it — has to agree on where the line had got
 * to at a given moment, so the answer lives here next to the layout rather than
 * in whichever renderer asked first.
 *
 * The final point is INTERPOLATED, not snapped to the last sample. Samples land
 * every few pixels of travel, so a fast stretch leaves long gaps; snapping
 * would make the tip jump those gaps in visible steps while the slow stretches
 * crawled — the opposite of what the timing says happened.
 */
export function strokeUpTo(stroke: DrawnStroke, ms: number): DrawnStroke {
  const { points, times } = stroke;
  if (points.length === 0) return { points: [], times: [] };
  if (ms >= times[times.length - 1]) return stroke;

  let i = 0;
  while (i < times.length && times[i] <= ms) i++;
  if (i === 0) return { points: [points[0]], times: [times[0]] };

  const head = { points: points.slice(0, i), times: times.slice(0, i) };
  const prev = points[i - 1];
  const next = points[i];
  const span = times[i] - times[i - 1];
  // A zero-length span means two samples share a millisecond; there is nothing
  // to interpolate along and dividing by it would put the tip at infinity.
  if (!next || span <= 0) return head;

  const f = (ms - times[i - 1]) / span;
  // Exactly on a sample: the tip IS that sample, and appending it again would
  // hand the ribbon builder a zero-length segment to widen.
  if (f <= 0) return head;
  return {
    points: [...head.points, { x: prev.x + (next.x - prev.x) * f, y: prev.y + (next.y - prev.y) * f }],
    times: [...head.times, ms],
  };
}

/** Marker radii at a given card scale, so both painters size them alike. */
export function markerRadius(kind: 'start' | 'goal', scale: number): number {
  return (kind === 'start' ? METRICS.startRadius : METRICS.goalRadius) * scale;
}

export const goalRingWidth = (scale: number): number =>
  Math.max(1, METRICS.goalRingWidth * scale);
