import { describe, expect, it } from 'vitest';
import { dashes, flatIcon, flattenPath, ICON_NAMES, ICON_STROKE, ICONS, type IconName } from './Icons';

const close = (a: { x: number; y: number }, b: { x: number; y: number }, eps = 1e-6): boolean =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;

/*
 * The flattening is the one geometry both renderers draw from — the baked
 * atlas and the live Graphics glyphs — so it is proved here on SVG's own
 * commands, and the family is held to the rules the art direction set.
 */
describe('flattenPath', () => {
  it('draws lines, and H and V, absolute and relative', () => {
    const [s] = flattenPath('M1 2 L5 2 h3 v4 H0 V2');
    expect(s.points).toEqual([
      { x: 1, y: 2 },
      { x: 5, y: 2 },
      { x: 8, y: 2 },
      { x: 8, y: 6 },
      { x: 0, y: 6 },
      { x: 0, y: 2 },
    ]);
    expect(s.closed).toBe(false);
  });

  it('reads the compact number forms SVG allows', () => {
    const [s] = flattenPath('M.5.5l1-1');
    expect(s.points).toEqual([
      { x: 0.5, y: 0.5 },
      { x: 1.5, y: -0.5 },
    ]);
  });

  it('closes on Z, and a later relative move starts from the start point', () => {
    const subs = flattenPath('M2 2h4v4z m1 1h1');
    expect(subs).toHaveLength(2);
    expect(subs[0].closed).toBe(true);
    expect(subs[1].points[0]).toEqual({ x: 3, y: 3 });
  });

  it('lands every curve exactly on its end point', () => {
    const [c] = flattenPath('M0 0 C0 10 10 10 10 0');
    expect(close(c.points[c.points.length - 1], { x: 10, y: 0 })).toBe(true);
    // The cubic's midpoint, at t = ½: (5, 7.5).
    const mid = c.points[Math.floor(c.points.length / 2)];
    expect(close(mid, { x: 5, y: 7.5 }, 1e-9)).toBe(true);
    const [q] = flattenPath('M0 0 Q5 10 10 0 t10 0');
    expect(close(q.points[q.points.length - 1], { x: 20, y: 0 })).toBe(true);
    const [s] = flattenPath('M0 0 c0 4 4 4 4 0 s4 -4 4 0');
    expect(close(s.points[s.points.length - 1], { x: 8, y: 0 })).toBe(true);
  });

  it('draws an arc on its circle, through its end point', () => {
    // A quarter of a circle of radius 10 about (10, 0), clockwise on screen.
    const [a] = flattenPath('M0 0 A10 10 0 0 0 10 10');
    for (const p of a.points) expect(Math.hypot(p.x - 10, p.y - 0)).toBeCloseTo(10, 6);
    expect(close(a.points[a.points.length - 1], { x: 10, y: 10 })).toBe(true);
    // The sweep flag picks the other centre.
    const [b] = flattenPath('M0 0 A10 10 0 0 1 10 10');
    for (const p of b.points) expect(Math.hypot(p.x - 0, p.y - 10)).toBeCloseTo(10, 6);
  });

  it('refuses what it cannot read rather than draw something else', () => {
    expect(() => flattenPath('1 2')).toThrow();
  });
});

describe('dashes', () => {
  it('splits a line into dash and gap by arc length', () => {
    const runs = dashes(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      2,
      3
    );
    // 0-2 drawn, 2-5 gap, 5-7 drawn, 7-10 gap; a dash of no length is not one.
    expect(runs.map((r) => [r[0].x, r[r.length - 1].x])).toEqual([
      [0, 2],
      [5, 7],
    ]);
  });
});

describe('the pen-line family', () => {
  it('holds every icon the kit and the screens ask for', () => {
    const wanted: IconName[] = [
      'flame',
      'bookmark',
      'eye',
      'gift',
      'store',
      'levels',
      'gallery',
      'share',
      'retry',
      'lock',
      'star',
      'check',
      'arrow',
      'back',
      'more',
      'plus',
      'sense',
      'sound',
      'moon',
    ];
    for (const n of wanted) expect(ICON_NAMES).toContain(n);
  });

  for (const name of ICON_NAMES) {
    it(`draws ${name} inside its 24-unit box, stroke and all`, () => {
      const f = flatIcon(name);
      const pad = ICON_STROKE / 2 + 0.2;
      const all = [
        ...f.strokes.flatMap((s) => s.points),
        ...f.fills.flatMap((s) => s.points),
        ...f.washes.flatMap((w) => w.paths.flatMap((s) => s.points)),
      ];
      for (const p of all) {
        expect(p.x).toBeGreaterThanOrEqual(0 + pad - 0.25);
        expect(p.x).toBeLessThanOrEqual(24 - pad + 0.25);
        expect(p.y).toBeGreaterThanOrEqual(0 + pad - 0.25);
        expect(p.y).toBeLessThanOrEqual(24 - pad + 0.25);
      }
      for (const [x, y, r] of [...f.dots, ...f.rings]) {
        expect(x - r).toBeGreaterThanOrEqual(0);
        expect(x + r).toBeLessThanOrEqual(24);
        expect(y - r).toBeGreaterThanOrEqual(0);
        expect(y + r).toBeLessThanOrEqual(24);
      }
      expect(all.length + f.dots.length + f.rings.length).toBeGreaterThan(0);
    });
  }

  /*
   * "Wherever a line starts, it begins with a filled dot, like the logo."
   * An open line's dot sits ON its first point; a closed outline has no
   * start, so its dot is inside it — a pupil, a keyhole, an ember.
   */
  const OPEN: IconName[] = ['levels', 'share', 'retry', 'check', 'arrow', 'clean', 'noAds'];
  for (const name of OPEN) {
    it(`starts ${name}'s line from a dot`, () => {
      const f = flatIcon(name);
      // The first line that has a start at all: an outline (the banner behind
      // the no-ads slash) has none.
      const start = f.strokes.find((st) => !st.closed)!.points[0];
      expect(f.dots.some(([x, y]) => close({ x, y }, start, 1e-9))).toBe(true);
    });
  }

  const MARKED: IconName[] = ['flame', 'bookmark', 'eye', 'gift', 'store', 'gallery', 'lock', 'sense', 'target'];
  for (const name of MARKED) {
    it(`carries ${name}'s dot`, () => {
      expect(flatIcon(name).dots.length).toBeGreaterThan(0);
    });
  }

  it('makes the star a filled mark and its outline a line: earned and still to earn', () => {
    expect(ICONS.star.fills.length).toBe(1);
    expect(flatIcon('starOutline').strokes).toHaveLength(1);
    expect(flatIcon('starOutline').strokes[0].closed).toBe(true);
  });

  it('dots the dotted fold in the gallery mark', () => {
    const f = flatIcon('gallery');
    expect(f.dotted).toHaveLength(1);
    const d = f.dotted[0];
    expect(dashes(d.paths[0].points, d.dash, d.gap).length).toBeGreaterThan(2);
  });
});
