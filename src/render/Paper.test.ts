import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));

import { fillingPlace, LAMP, pageSkyCss, paintSky, skyStops, starField } from './Paper';
import { BASE_WIDTH, hexCss, ui } from './Theme';

/*
 * The sky is painted twice — by the page in CSS, behind the canvas, and by
 * the canvas under the game — and the two must be one picture, or the bands
 * at the safe-area edges show a seam. These tests hold the two to the same
 * tokens and the same geometry.
 */
describe('the page sky', () => {
  it('is the lamp\'s radial over the edge colour, from the tokens', () => {
    const u = ui();
    expect(pageSkyCss()).toBe(
      `radial-gradient(90% 42% at 50% 27%, ${hexCss(u.skyGlow)} 0%, ${hexCss(u.sky)} 50%, ${hexCss(u.skyEdge)} 100%) ${hexCss(u.skyEdge)}`
    );
  });

  it('is the SAME sky index.html paints on its first frame, before any script', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8').replace(/\s+/g, ' ');
    const css = pageSkyCss().replace(/\s+/g, ' ');
    expect(html).toContain(css);
  });

  it('matches the launch screen\'s colour in index.html\'s theme colour', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    expect(html).toContain(`content="${hexCss(ui().sky).toUpperCase()}"`);
  });

  it('runs lamp to edge through the page\'s own base', () => {
    const stops = skyStops();
    expect(stops.map(([a]) => a)).toEqual([0, 0.5, 1]);
    expect(stops[1][1]).toBe(ui().sky);
  });
});

/** A 2D context stand-in that records the transform and the gradient it is asked for. */
function recordingCtx() {
  const calls: { op: string; args: unknown[] }[] = [];
  const gradient = { stops: [] as [number, string][], addColorStop(at: number, c: string) { this.stops.push([at, c]); } };
  const ctx = new Proxy(
    {},
    {
      get: (_t, k) => {
        if (k === 'calls') return calls;
        if (k === 'createRadialGradient') return (...args: unknown[]) => {
          calls.push({ op: 'createRadialGradient', args });
          return gradient;
        };
        return (...args: unknown[]) => calls.push({ op: String(k), args });
      },
      set: (_t, k, v) => {
        calls.push({ op: `set:${String(k)}`, args: [v] });
        return true;
      },
    }
  ) as unknown as CanvasRenderingContext2D & { calls: typeof calls };
  return { ctx, gradient };
}

describe('paintSky', () => {
  it('lays the page\'s radial in the canvas\'s own place on the page', () => {
    const { ctx, gradient } = recordingCtx();
    // A canvas 750 wide drawn at 0.536 CSS px per pixel, 62 px down a 402 × 874 page.
    const place = { left: 0, top: 62, scale: 402 / 750, pageW: 402, pageH: 874 };
    paintSky(ctx, 750, 1451, place);
    const ops = (ctx as unknown as { calls: { op: string; args: number[] }[] }).calls;
    const setT = ops.find((c) => c.op === 'setTransform')!.args;
    // Page px → canvas px: divide by the scale, after moving the canvas's corner to the origin.
    expect(setT[0]).toBeCloseTo(1 / place.scale, 9);
    expect(setT[5]).toBeCloseTo(-place.top / place.scale, 9);
    const tr = ops.find((c) => c.op === 'translate')!.args;
    expect(tr).toEqual([place.pageW * LAMP.cx, place.pageH * LAMP.cy]);
    const sc = ops.find((c) => c.op === 'scale')!.args;
    expect(sc).toEqual([place.pageW * LAMP.rx, place.pageH * LAMP.ry]);
    expect(gradient.stops).toEqual(skyStops().map(([a, c]) => [a, hexCss(c)]));
  });

  it('fills the page exactly when nothing can be measured', () => {
    expect(fillingPlace(750, 1334)).toEqual({ left: 0, top: 0, scale: 1, pageW: 750, pageH: 1334 });
  });
});

describe('starField', () => {
  const W = BASE_WIDTH;
  const H = 1451;

  it('is the same night every launch', () => {
    expect(starField(W, H)).toEqual(starField(W, H));
  });

  it('holds the owner\'s count and brightness', () => {
    const u = ui();
    const stars = starField(W, H);
    expect(stars).toHaveLength(u.stars.count);
    expect(stars.length).toBeGreaterThanOrEqual(70);
    expect(stars.length).toBeLessThanOrEqual(90);
    for (const s of stars) {
      expect(s.a).toBeGreaterThanOrEqual(u.stars.alphaMin - 1e-9);
      expect(s.a).toBeLessThanOrEqual(u.stars.alphaMax + 1e-9);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(W);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(H);
      // 0.3-1.2 pt at 402 wide.
      expect(s.r).toBeGreaterThanOrEqual(0.3 * (W / 402) - 1e-9);
      expect(s.r).toBeLessThanOrEqual(1.2 * (W / 402) + 1e-9);
    }
  });

  it('crowds the upper sky and leaves the cards\' ground quiet', () => {
    const stars = starField(W, H);
    const upper = stars.filter((s) => s.y < H / 2).length;
    expect(upper).toBeGreaterThan(stars.length * 0.6);
  });
});
