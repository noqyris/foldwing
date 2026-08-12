/**
 * The gallery and the share card are two renderers with no code in common — one
 * paints Phaser Graphics, the other a 2D canvas — and this module is the only
 * thing holding them to the same picture. When it drifts, the card a player
 * looks at stops being the card they send, and nothing about that failure is
 * loud.
 *
 * So what is pinned here is the contract both painters read: where the maze
 * lands, that it stays inside the box it was given, that the reflection is a
 * reflection, and that a figure saved before mazes existed still draws.
 */

import { describe, expect, it } from 'vitest';
import { layoutFigureCard, markerRadius } from './FigureCard';
import { BASE_HEIGHT, BASE_WIDTH, METRICS, theme } from './Theme';
import { Playfield } from '../core/Playfield';
import type { SavedFigure } from '../systems/Progress';

const BOX = { x: 0, y: 0, w: 400, h: 600 };

/** A short diagonal on the drawable half, with a maze behind it. */
function figure(extra: Partial<SavedFigure> = {}): SavedFigure {
  return {
    levelId: 'l6',
    levelName: 'First fold',
    points: [
      { x: 0.4, y: 0.9 },
      { x: 0.3, y: 0.5 },
      { x: 0.42, y: 0.1 },
    ],
    times: [0, 200, 400],
    ms: 400,
    at: 1_700_000_000_000,
    walls: [
      { x: 0.0, y: 0.3, w: 0.33, h: 0.02 },
      { x: 0.6, y: 0.7, w: 0.4, h: 0.02 },
    ],
    start: { x: 0.4, y: 0.9 },
    goal: { x: 0.42, y: 0.1 },
    ...extra,
  };
}

/** Everything the painters are handed, as one flat list of points. */
function allPoints(
  layout: NonNullable<ReturnType<typeof layoutFigureCard>>
): { x: number; y: number }[] {
  return [
    ...layout.outline,
    ...layout.stroke.points,
    ...layout.mirrored.points,
    ...layout.markers.map((m) => m.p),
    ...layout.walls.flatMap((w) => [
      { x: w.x, y: w.y },
      { x: w.x + w.w, y: w.y + w.h },
    ]),
  ];
}

describe('laying a saved run out on a card', () => {
  it('frames the whole playfield when the figure carries a maze', () => {
    const layout = layoutFigureCard(figure(), BOX)!;
    const pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset);

    // Uniform scale, chosen by whichever axis binds. The playfield is far
    // taller than it is wide, so on a 400×600 box that is the height.
    expect(layout.scale).toBeCloseTo(BOX.h / pf.h, 6);
    expect(layout.axis).not.toBeNull();
    // The fold is the centre of the playfield, so it is the centre of the card.
    expect(layout.axis!.x).toBeCloseTo(BOX.x + BOX.w / 2, 6);
    expect(layout.axis!.bottom - layout.axis!.top).toBeCloseTo(pf.h * layout.scale, 6);
  });

  /*
   * Every card at the same scale is the point of framing the playfield rather
   * than the ink: two runs through the same maze have to be comparable at a
   * glance, and a wide figure blown up to the same size as a narrow one is
   * exactly what made the old gallery unreadable as a record.
   */
  it('gives two different runs through one maze the same scale', () => {
    const wide = layoutFigureCard(figure(), BOX)!;
    const narrow = layoutFigureCard(
      figure({
        points: [
          { x: 0.45, y: 0.9 },
          { x: 0.44, y: 0.5 },
          { x: 0.45, y: 0.1 },
        ],
      }),
      BOX
    )!;
    expect(narrow.scale).toBeCloseTo(wide.scale, 6);
  });

  it('keeps everything it hands a painter inside the box', () => {
    const layout = layoutFigureCard(figure(), BOX)!;
    const pad = markerRadius('goal', layout.scale) + layout.nib;

    for (const p of allPoints(layout)) {
      expect(p.x).toBeGreaterThanOrEqual(BOX.x - pad);
      expect(p.x).toBeLessThanOrEqual(BOX.x + BOX.w + pad);
      expect(p.y).toBeGreaterThanOrEqual(BOX.y - pad);
      expect(p.y).toBeLessThanOrEqual(BOX.y + BOX.h + pad);
    }
  });

  it('reflects the line across the fold rather than redrawing it', () => {
    const layout = layoutFigureCard(figure(), BOX)!;
    const axis = layout.axis!.x;

    expect(layout.mirrored.points).toHaveLength(layout.stroke.points.length);
    for (let i = 0; i < layout.stroke.points.length; i++) {
      const a = layout.stroke.points[i];
      const b = layout.mirrored.points[i];
      expect(b.x).toBeCloseTo(2 * axis - a.x, 6);
      expect(b.y).toBeCloseTo(a.y, 6);
    }
    // The player draws on the left; the reflection therefore lives on the right.
    for (const p of layout.stroke.points) expect(p.x).toBeLessThanOrEqual(axis + 1e-6);
    for (const p of layout.mirrored.points) expect(p.x).toBeGreaterThanOrEqual(axis - 1e-6);
  });

  it('marks the start and the goal on both halves, the reflections faint', () => {
    const layout = layoutFigureCard(figure(), BOX)!;
    expect(layout.markers).toHaveLength(4);

    const faint = layout.markers.filter((m) => m.alpha < 1);
    expect(faint).toHaveLength(2);
    for (const m of faint) expect(m.alpha).toBe(theme().reflectionAlpha);

    const real = layout.markers.filter((m) => m.alpha === 1);
    expect(real.map((m) => m.kind).sort()).toEqual(['goal', 'start']);
    // A reflected marker is never on the half the player draws on.
    for (const m of faint) expect(m.p.x).toBeGreaterThan(layout.axis!.x);
  });

  /*
   * Figures earned before the maze was kept are the whole reason `walls` is
   * optional. They must still draw — as the bare figure they always were,
   * cropped to their own ink, with no fold and no walls to paint.
   */
  it('falls back to fitting the ink when there is no maze', () => {
    const layout = layoutFigureCard(
      figure({ walls: undefined, start: undefined, goal: undefined }),
      BOX
    )!;
    expect(layout.walls).toEqual([]);
    expect(layout.markers).toEqual([]);
    expect(layout.axis).toBeNull();

    // Cropped to the ink means the figure touches an edge of the box.
    const xs = layout.outline.map((p) => p.x);
    const ys = layout.outline.map((p) => p.y);
    const filled =
      Math.abs(Math.max(...xs) - Math.min(...xs) - BOX.w) < 1 ||
      Math.abs(Math.max(...ys) - Math.min(...ys) - BOX.h) < 1;
    expect(filled).toBe(true);
  });

  it('never lets the nib vanish at thumbnail scale', () => {
    const tiny = layoutFigureCard(figure(), { x: 0, y: 0, w: 20, h: 30 })!;
    expect(tiny.nib).toBeGreaterThanOrEqual(1.5);
  });

  it('reports nothing to draw rather than throwing on an empty stroke', () => {
    expect(layoutFigureCard(figure({ points: [], times: [] }), BOX)).toBeNull();
  });
});
