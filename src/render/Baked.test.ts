import { describe, expect, it, vi } from 'vitest';

// A NineSlice class for `instanceof`, and WebGL's number, as Phaser has them.
vi.mock('phaser', () => {
  class NineSlice {
    w: number;
    h: number;
    constructor(
      public key: string,
      w: number,
      h: number,
      public slices: number[]
    ) {
      this.w = w;
      this.h = h;
    }
    setSize(w: number, h: number) {
      this.w = w;
      this.h = h;
      return this;
    }
  }
  return { default: { WEBGL: 2, CANVAS: 1, GameObjects: { NineSlice } } };
});

import Phaser from 'phaser';
import {
  bakedPanel,
  bakeKey,
  ELEVATION,
  needsExact,
  panel,
  panelFace,
  panelPad,
  RADII,
  shadowReach,
  sizePanel,
} from './Baked';
import { dp } from './Theme';

/** A scene with a texture store and the two game objects a bake becomes. */
function fakeScene(renderer: number | null = 2) {
  const textures = new Map<string, { w: number; h: number }>();
  const created: string[] = [];
  const ctx = new Proxy({}, { get: () => () => ({ addColorStop: () => {} }), set: () => true });
  const NS = (Phaser as unknown as { GameObjects: { NineSlice: new (...a: unknown[]) => unknown } }).GameObjects
    .NineSlice;
  const scene = {
    sys: { game: { renderer: renderer === null ? null : { type: renderer } } },
    textures: {
      exists: (k: string) => textures.has(k),
      createCanvas: (k: string, w: number, h: number) => {
        created.push(k);
        textures.set(k, { w, h });
        return { getContext: () => ctx, refresh: () => {} };
      },
    },
    add: {
      nineslice: (
        _x: number,
        _y: number,
        key: string,
        _f: unknown,
        w: number,
        h: number,
        l: number,
        r: number,
        t = 0,
        b = 0
      ) => new NS(key, w, h, [l, r, t, b]),
      image: (x: number, y: number, key: string) => ({ kind: 'image', x, y, key }),
    },
  };
  return { scene: scene as unknown as Phaser.Scene, textures, created };
}

const paint = () => {};

describe('elevation', () => {
  it('climbs e1 → e2 → e3: longer blur, deeper shadow, brighter edge', () => {
    const big = (e: keyof typeof ELEVATION) => ELEVATION[e].drops[ELEVATION[e].drops.length - 1];
    expect(big('e1').blur).toBeLessThan(big('e2').blur);
    expect(big('e2').blur).toBeLessThan(big('e3').blur);
    expect(big('e1').alpha).toBeLessThan(big('e2').alpha);
    expect(big('e2').alpha).toBeLessThan(big('e3').alpha);
    expect(ELEVATION.e1.highlight).toBeLessThan(ELEVATION.e3.highlight);
  });

  it('is the B mocks\' box-shadows, in base units', () => {
    expect(ELEVATION.e1.drops[1]).toEqual({ dy: dp(6), blur: dp(14), spread: -dp(6), alpha: 0.55 });
    expect(ELEVATION.e3.drops[1]).toEqual({ dy: dp(30), blur: dp(50), spread: -dp(14), alpha: 0.8 });
    expect(ELEVATION.sunk).toMatchObject({ drops: [], inner: 0.45 });
    expect(ELEVATION.e1.highlight).toBe(0.07);
  });

  it('pads a bake for everything its shadow reaches, falling down more than up', () => {
    const r = shadowReach(ELEVATION.e3);
    expect(r.bottom).toBeGreaterThan(r.top);
    expect(r.side).toBeGreaterThanOrEqual(dp(50) - dp(14));
    expect(shadowReach(ELEVATION.flat)).toEqual({ top: 1, side: 1, bottom: 1 });
  });

  it('gives a glow its room on every side', () => {
    const p = panelPad({ radius: 10, face: { kind: 'none' }, glow: { color: 0, alpha: 1, blur: 30, dy: 8 } });
    expect(p.side).toBeGreaterThanOrEqual(31);
    expect(p.bottom).toBeGreaterThan(p.top);
  });
});

describe('radii', () => {
  it('are SPEC §2.4\'s, in whole base units', () => {
    expect(RADII).toEqual({
      chip: dp(18),
      tile: dp(20),
      button: dp(20),
      card: dp(26),
      board: dp(28),
      sheet: dp(34),
      mini: dp(15),
    });
  });
});

describe('bakedPanel', () => {
  const pad = { top: 4, side: 6, bottom: 10 };

  it('bakes a look once and nine-slices it to any size', () => {
    const { scene, created } = fakeScene();
    const a = bakedPanel(scene, 'card', 300, 200, paint, { pad, slice: 40 }) as unknown as {
      key: string;
      w: number;
      h: number;
      slices: number[];
    };
    const b = bakedPanel(scene, 'card', 500, 120, paint, { pad, slice: 40 }) as unknown as { key: string };
    expect(created).toEqual([bakeKey('card', 82, 82, false)]);
    expect(b.key).toBe(a.key);
    // The object is the face plus its pad; the slices keep the pad and the corner whole.
    expect([a.w, a.h]).toEqual([300 + 12, 200 + 14]);
    expect(a.slices).toEqual([46, 46, 44, 50]);
    expect(panelFace(a)).toEqual({ w: 300, h: 200 });
  });

  it('three-slices a pill: its height baked exact, its width stretched', () => {
    const { scene, created } = fakeScene();
    const chip = bakedPanel(scene, 'chip', 140, 60, paint, { pad, slice: 31 }) as unknown as {
      h: number;
      slices: number[];
    };
    expect(created[0]).toContain('-h60');
    expect(chip.slices.slice(2)).toEqual([0, 0]);
    // A wider chip is the same texture.
    bakedPanel(scene, 'chip', 260, 60, paint, { pad, slice: 31 });
    expect(created).toHaveLength(1);
  });

  it('bakes exact, keyed by size, when asked, when it cannot slice, and on the Canvas renderer', () => {
    const exact = fakeScene();
    const img = bakedPanel(exact.scene, 'btn', 300, 100, paint, { pad, exact: true }) as unknown as { kind: string; key: string };
    expect(img.kind).toBe('image');
    expect(img.key).toBe(bakeKey('btn', 300, 100, true));

    const narrow = fakeScene();
    const n = bakedPanel(narrow.scene, 'card', 50, 200, paint, { pad, slice: 40 }) as unknown as { kind: string };
    expect(n.kind).toBe('image');

    const canvas = fakeScene(1);
    const c = bakedPanel(canvas.scene, 'card', 300, 200, paint, { pad, slice: 40 }) as unknown as { kind: string };
    expect(c.kind).toBe('image');

    const none = fakeScene(null);
    const d = bakedPanel(none.scene, 'card', 300, 200, paint, { pad, slice: 40 }) as unknown as { kind: string };
    expect(d.kind).toBe('image');
  });

  it('centres the FACE on the point asked, whatever shadow hangs below it', () => {
    const { scene } = fakeScene(1);
    const img = bakedPanel(scene, 'drop', 100, 100, paint, { pad, exact: true }, 50, 80) as unknown as { y: number };
    expect(img.y).toBe(80 + (pad.bottom - pad.top) / 2);
  });

  it('resizes a nine-slice by its face, and says so when it cannot', () => {
    const { scene } = fakeScene();
    const p = bakedPanel(scene, 'card', 300, 200, paint, { pad, slice: 40 });
    expect(sizePanel(p, 400, 220)).toBe(true);
    expect(panelFace(p)).toEqual({ w: 400, h: 220 });
    expect((p as unknown as { w: number }).w).toBe(412);
    const img = bakedPanel(fakeScene(1).scene, 'card', 300, 200, paint, { pad, slice: 40 });
    expect(sizePanel(img, 400, 220)).toBe(false);
  });
});

describe('panel', () => {
  it('bakes a diagonal gradient exact, a vertical one per height, and flat faces as slices', () => {
    expect(needsExact({ radius: 10, face: { kind: 'diagonal', from: 0, to: 1 } })).toBe(true);
    expect(needsExact({ radius: 10, face: { kind: 'vertical', top: 0, bottom: 1 } })).toBe(false);
    expect(needsExact({ radius: 10, face: { kind: 'glass' } })).toBe(false);
    const { scene, created } = fakeScene();
    panel(scene, 'glass-e1', 0, 0, 300, 120, { radius: 30, face: { kind: 'glass' }, elevation: 'e1' });
    panel(scene, 'glass-e1', 0, 0, 200, 120, { radius: 30, face: { kind: 'glass' }, elevation: 'e1' });
    expect(created).toHaveLength(1);
    // A vertical gradient: every width of one height is one texture, a new height another.
    panel(scene, 'grad', 0, 0, 300, 120, { radius: 30, face: { kind: 'vertical', top: 0, bottom: 1 } });
    panel(scene, 'grad', 0, 0, 480, 120, { radius: 30, face: { kind: 'vertical', top: 0, bottom: 1 } });
    expect(created).toHaveLength(2);
    panel(scene, 'grad', 0, 0, 300, 100, { radius: 30, face: { kind: 'vertical', top: 0, bottom: 1 } });
    expect(created).toHaveLength(3);
    panel(scene, 'dusk', 0, 0, 300, 120, { radius: 30, face: { kind: 'diagonal', from: 0, to: 1 } });
    panel(scene, 'dusk', 0, 0, 301, 120, { radius: 30, face: { kind: 'diagonal', from: 0, to: 1 } });
    expect(created).toHaveLength(5);
  });
});
