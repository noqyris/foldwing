import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));

import type Phaser from 'phaser';
import type { Level } from '../data/types';
import { mazeThumb, THUMB_POOL, thumbHolders, thumbKey, thumbLayout } from './MazeThumb';

const LEVEL: Level = {
  id: 'lt',
  name: 'Test',
  start: { x: 0.1, y: 0.9 },
  goal: { x: 0.2, y: 0.1 },
  walls: [
    { x: 0.1, y: 0.5, w: 0.3, h: 0.02 },
    { x: 0.6, y: 0.3, w: 0.001, h: 0.2 },
  ],
};

describe('thumbLayout', () => {
  it('maps the level\'s normalised coordinates onto the maze box, as LevelSelect did', () => {
    const L = thumbLayout(LEVEL, 200, 260, { pad: 0.05 });
    expect(L.inner).toEqual({ x: 10, y: 10, w: 180, h: 240 });
    expect(L.start).toEqual({ x: 10 + 0.1 * 180, y: 10 + 0.9 * 240 });
    expect(L.goal).toEqual({ x: 10 + 0.2 * 180, y: 10 + 0.1 * 240 });
    expect(L.walls[0]).toMatchObject({ x: 10 + 0.1 * 180, y: 10 + 0.5 * 240, w: 0.3 * 180 });
    expect(L.axisX).toBe(100);
  });

  it('reflects the start and goal in the fold', () => {
    const L = thumbLayout(LEVEL, 200, 260);
    expect(L.mirrorStart.x - L.axisX).toBeCloseTo(L.axisX - L.start.x, 9);
    expect(L.mirrorGoal.x - L.axisX).toBeCloseTo(L.axisX - L.goal.x, 9);
    expect(L.mirrorStart.y).toBe(L.start.y);
  });

  it('keeps a sliver a wall, and gives every wall pill ends', () => {
    const L = thumbLayout(LEVEL, 200, 260);
    const thin = L.walls[1];
    expect(thin.w).toBe(L.minWall);
    for (const w of L.walls) expect(w.r).toBeCloseTo(Math.min(w.w, w.h) / 2, 9);
  });

  it('never lets a marker vanish on the smallest thumb', () => {
    const L = thumbLayout(LEVEL, 78, 100);
    expect(L.dotR).toBeGreaterThanOrEqual(2);
    expect(L.ringR).toBeGreaterThanOrEqual(3);
    expect(L.ringW).toBeGreaterThanOrEqual(1);
  });

  it('fills the whole thumb when there is no frame', () => {
    const L = thumbLayout(LEVEL, 200, 260, { frame: false });
    expect(L.inner).toEqual({ x: 0, y: 0, w: 200, h: 260 });
  });
});

describe('thumbKey', () => {
  it('names a thumb by its level, size and look, nothing else', () => {
    expect(thumbKey(LEVEL, 194, 246)).toBe('fw-thumb-lt-194x246');
    expect(thumbKey(LEVEL, 194.4, 246)).toBe('fw-thumb-lt-194x246');
    expect(thumbKey(LEVEL, 194, 246, { dim: true })).toBe('fw-thumb-lt-194x246-d');
    expect(thumbKey(LEVEL, 194, 246, { dim: true, frame: false })).not.toBe(thumbKey(LEVEL, 194, 246, { dim: true }));
  });
});

/** A scene with a texture store, and images that can be destroyed. */
function fakeScene() {
  const textures = new Map<string, unknown>();
  const created: string[] = [];
  const removed: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get: () => () => ({ addColorStop: () => {} }),
      set: () => true,
    }
  );
  const scene = {
    textures: {
      exists: (k: string) => textures.has(k),
      createCanvas: (k: string) => {
        created.push(k);
        const t = { getContext: () => ctx, refresh: () => {} };
        textures.set(k, t);
        return t;
      },
      remove: (k: string) => {
        removed.push(k);
        textures.delete(k);
      },
    },
    add: {
      image: (_x: number, _y: number, key: string) => {
        const handlers: (() => void)[] = [];
        const img = {
          key,
          setScale: () => img,
          once: (_e: string, fn: () => void) => handlers.push(fn),
          destroy: () => handlers.forEach((fn) => fn()),
        };
        return img;
      },
    },
  };
  return { scene: scene as unknown as Phaser.Scene, created, removed };
}

describe('the thumb cache', () => {
  it('bakes a level\'s thumb once, however many screens show it', () => {
    const { scene, created } = fakeScene();
    const a = mazeThumb(scene, 0, 0, LEVEL, 100, 130);
    const b = mazeThumb(scene, 0, 0, LEVEL, 100, 130);
    expect(created).toEqual(['fw-thumb-lt-100x130']);
    expect(thumbHolders('fw-thumb-lt-100x130')).toEqual({ held: 2, pooled: false });
    a.destroy();
    expect(thumbHolders('fw-thumb-lt-100x130')).toEqual({ held: 1, pooled: false });
    b.destroy();
    // Nobody holds it: it waits for the next screen rather than going.
    expect(thumbHolders('fw-thumb-lt-100x130')).toEqual({ held: 0, pooled: true });
    // And the next screen takes it back without a bake.
    mazeThumb(scene, 0, 0, LEVEL, 100, 130);
    expect(created).toHaveLength(1);
    expect(thumbHolders('fw-thumb-lt-100x130').pooled).toBe(false);
  });

  it('lets the pool keep only so many unheld thumbs, the oldest going first', () => {
    const { scene, removed } = fakeScene();
    const levels = Array.from({ length: THUMB_POOL + 3 }, (_, i) => ({ ...LEVEL, id: `p${i}` }));
    for (const lv of levels) mazeThumb(scene, 0, 0, lv, 60, 80).destroy();
    expect(removed).toEqual(['fw-thumb-p0-60x80', 'fw-thumb-p1-60x80', 'fw-thumb-p2-60x80']);
  });

  it('never removes a texture an image still shows', () => {
    const { scene, removed } = fakeScene();
    const held = mazeThumb(scene, 0, 0, { ...LEVEL, id: 'held' }, 60, 80);
    for (let i = 0; i < THUMB_POOL + 5; i++) mazeThumb(scene, 0, 0, { ...LEVEL, id: `q${i}` }, 60, 80).destroy();
    expect(removed).not.toContain('fw-thumb-held-60x80');
    held.destroy();
  });
});
