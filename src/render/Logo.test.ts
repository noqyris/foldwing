import { describe, expect, it, vi } from 'vitest';

// The lockup builds on Phaser, which cannot load without a browser; the
// geometry and the timeline under test touch none of it.
vi.mock('phaser', () => ({ default: { GameObjects: { Events: { DESTROY: 'destroy' } } } }));

import {
  DRAW_IN,
  drawInAt,
  MARK_AXIS,
  MARK_BOX,
  markColors,
  markLine,
  markMirror,
  markWidth,
  partialLine,
  polyLength,
  SETTLED,
} from './Logo';
import { theme } from './Theme';

/*
 * The mark is the App Store icon's own line (logo/A-stacked, mark-game.svg),
 * so its geometry is pinned to the trace: where it starts, where it ends, how
 * long it is, and that the reflection is the line mirrored in the fold.
 */
describe('the mark', () => {
  it('runs from the start dot up to the top cap, as the icon draws it', () => {
    const line = markLine();
    expect(line[0]).toEqual({ x: 206, y: 880.5 });
    const end = line[line.length - 1];
    expect(end.x).toBeCloseTo(206, 9);
    expect(end.y).toBeCloseTo(150, 9);
  });

  it('is exactly as long as the traced path: four straights, two short runs, four quarter bends', () => {
    const straights = 880.5 - 736 + (541 - 483) + (288 - 150);
    const runs = (330 - 301) * 2;
    const bends = (Math.PI / 2) * (95 * 2 + 100 * 2);
    // Chords sit inside their arc: a hair short, never long.
    const len = polyLength(markLine());
    expect(len).toBeLessThanOrEqual(straights + runs + bends + 1e-6);
    expect(len).toBeGreaterThan(straights + runs + bends - 2);
  });

  it('stays inside the icon mark\'s own box, with the line\'s half-width', () => {
    for (const p of [...markLine(), ...markMirror()]) {
      expect(p.x - 47).toBeGreaterThanOrEqual(MARK_BOX.x - 1e-6);
      expect(p.x + 47).toBeLessThanOrEqual(MARK_BOX.x + MARK_BOX.w + 1e-6);
      expect(p.y - 47).toBeGreaterThanOrEqual(MARK_BOX.y - 1e-6);
    }
  });

  it('reflects the line in the fold, point for point', () => {
    const line = markLine();
    const mirror = markMirror();
    expect(mirror).toHaveLength(line.length);
    mirror.forEach((p, i) => {
      expect(p.x + line[i].x).toBeCloseTo(2 * MARK_AXIS, 9);
      expect(p.y).toBe(line[i].y);
    });
  });

  it('keeps the icon\'s proportions at any height', () => {
    expect(markWidth(MARK_BOX.h)).toBeCloseTo(MARK_BOX.w, 9);
    expect(markWidth(168)).toBeCloseTo(151.25, 1);
  });

  it('is the player\'s line and its moonlight at night', () => {
    const c = markColors();
    expect(c.line).toBe(theme().line);
    expect(c.core).toBe(theme().lineCore);
    expect(c.mirror).toBe(theme().mirror);
  });
});

describe('partialLine', () => {
  const L = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];

  it('lays down the first part of a line, by length', () => {
    expect(partialLine(L, 0.25)).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ]);
    expect(polyLength(partialLine(L, 0.75))).toBeCloseTo(15, 9);
    expect(partialLine(L, 1)).toEqual(L);
  });

  it('is nothing but the start at 0, and never runs past the end', () => {
    expect(partialLine(L, 0)).toEqual([{ x: 0, y: 0 }]);
    expect(partialLine(L, 2)).toEqual(L);
    expect(partialLine([], 0.5)).toEqual([]);
  });
});

/*
 * The draw-in, as prototyped (logo/A-stacked): the ink dot lands at once and
 * pops, the line leaves it 60 ms in, the reflection follows 130 ms behind,
 * and everything is settled at 960 ms.
 */
describe('drawInAt', () => {
  it('opens on the dot alone, already visible', () => {
    const p = drawInAt(0);
    expect(p.lineDot).toBeCloseTo(0.55, 9);
    expect(p.mirrorDot).toBe(0);
    expect(p.line).toBe(0);
    expect(p.mirror).toBe(0);
  });

  it('keeps the reflection behind the line, never ahead of it', () => {
    for (let at = 0; at <= DRAW_IN.total; at += 20) {
      const p = drawInAt(at);
      expect(p.mirror).toBeLessThanOrEqual(p.line + 1e-9);
      expect(p.line).toBeGreaterThanOrEqual(0);
      expect(p.line).toBeLessThanOrEqual(1);
    }
    // Half-way through the line's window, the reflection is well short of it.
    const mid = drawInAt((DRAW_IN.line[0] + DRAW_IN.line[1]) / 2);
    expect(mid.line).toBeCloseTo(0.5, 6);
    expect(mid.mirror).toBeLessThan(0.4);
  });

  it('pops the dots past full and settles them at full', () => {
    let peak = 0;
    for (let at = 0; at <= 400; at += 5) peak = Math.max(peak, drawInAt(at).lineDot);
    expect(peak).toBeGreaterThan(1);
    expect(drawInAt(DRAW_IN.lineDot[1]).lineDot).toBeCloseTo(1, 9);
  });

  it('ends exactly settled', () => {
    expect(drawInAt(DRAW_IN.total)).toEqual(SETTLED);
    expect(drawInAt(DRAW_IN.total + 500)).toEqual(SETTLED);
  });
});
