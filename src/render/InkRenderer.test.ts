import { afterEach, describe, expect, it, vi } from 'vitest';

// InkRenderer draws through Phaser, which cannot load without a browser. The
// parts under test only need game objects that remember what they were told,
// which the stand-ins below are; the renderer type is checked once, to decide
// whether ink is baked.
vi.mock('phaser', () => ({
  default: {
    GameObjects: { Container: class {}, Text: class {}, NineSlice: class {}, Events: { DESTROY: 'destroy' } },
    Scenes: { Events: { POST_UPDATE: 'postupdate', SHUTDOWN: 'shutdown' } },
    WEBGL: 2,
  },
}));

import type Phaser from 'phaser';
import type { Vec2 } from '../core/Geometry';
import { mirrorBands, obstacleRows, rowCrossings } from '../core/Gates';
import { Playfield } from '../core/Playfield';
import { LEVELS } from '../data/levels';
import {
  afterFrames,
  arcCurve,
  crossRows,
  DEATH_ARM,
  deathMarkAt,
  edgeAt,
  InkRenderer,
  PRINT_FADE_MS,
  PRINT_MS,
  PRINT_STEP_MAX,
  printEdges,
  printFront,
  printSchedule,
  splatDrops,
} from './InkRenderer';
import { BASE_HEIGHT, BASE_WIDTH, dp, METRICS, pt, setMotionScale, theme } from './Theme';

/** The last element (Array.prototype.at is past this project's lib). */
const last = <T>(a: readonly T[]): T => a[a.length - 1];

interface Recorded {
  op: string;
  args: number[];
}
type Recorder = Phaser.GameObjects.Graphics & { calls: Recorded[] };

/** A graphics stand-in: every call is recorded, and every call chains. */
const recorder = (): Recorder => {
  const calls: Recorded[] = [];
  const state: Record<string | symbol, unknown> = { alpha: 1, depth: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 };
  const g: Recorder = new Proxy({} as Recorder, {
    get: (_o, k) => {
      if (k === 'calls') return calls;
      if (k in state) return state[k];
      return (...args: number[]) => {
        calls.push({ op: String(k), args });
        if (k === 'setAlpha') state.alpha = args[0];
        if (k === 'setDepth') state.depth = args[0];
        if (k === 'setVisible') state.visible = args[0];
        return g;
      };
    },
    set: (_o, k, v) => {
      state[k] = v;
      return true;
    },
  });
  return g;
};

/** A 2D context stand-in: accepts every call and property, records paths. */
const fakeCtx = (): CanvasRenderingContext2D & { log: Recorded[] } => {
  const log: Recorded[] = [];
  const ctx: CanvasRenderingContext2D & { log: Recorded[] } = new Proxy({} as CanvasRenderingContext2D & { log: Recorded[] }, {
    get: (_o, k) => {
      if (k === 'log') return log;
      return (...args: number[]) => {
        log.push({ op: String(k), args });
        return ctx;
      };
    },
    set: (_o, k, v) => {
      log.push({ op: `=${String(k)}`, args: [v as number] });
      return true;
    },
  });
  return ctx;
};

const pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset);

interface TweenConfig {
  targets?: unknown;
  repeat?: number;
  scale?: number;
  alpha?: number;
  onComplete?: () => void;
}

/** A scene whose every factory records; tweens are kept, not run. */
const fakeScene = () => {
  const tweens: TweenConfig[] = [];
  const objects: Recorder[] = [];
  const made = (): Recorder => {
    const o = recorder();
    objects.push(o);
    return o;
  };
  const textures = new Map<string, { width: number; height: number }>();
  const scene = {
    add: {
      graphics: made,
      image: made,
      renderTexture: made,
      container: made,
      nineslice: made,
      text: made,
    },
    make: { graphics: made },
    textures: {
      exists: (k: string) => textures.has(k),
      get: (k: string) => ({ ...textures.get(k), key: k, getContext: () => fakeCtx(), refresh: () => {} }),
      remove: (k: string) => textures.delete(k),
      createCanvas: (k: string, width: number, height: number) => {
        textures.set(k, { width, height });
        return { key: k, width, height, getContext: () => fakeCtx(), refresh: () => {} };
      },
    },
    game: { renderer: { type: 1 } },
    sys: { game: { renderer: { type: 1 } } },
    time: { delayedCall: () => ({ remove: () => {} }) },
    tweens: {
      add: (c: TweenConfig) => {
        tweens.push(c);
        return { stop: () => {} };
      },
      addCounter: (c: TweenConfig) => {
        tweens.push(c);
        return { stop: () => {} };
      },
      killTweensOf: () => {},
    },
  } as unknown as Phaser.Scene;
  return { scene, tweens, objects, textures };
};

/** A renderer on a scene that records, and the ghost's own graphics. */
const renderer = () => {
  const { scene } = fakeScene();
  const ink = new InkRenderer(scene, pf);
  const ghost = (ink as unknown as { ghostG: Recorder }).ghostG;
  return { ink, ghost };
};

/** The × marks in a ghost: pairs of crossing segments, as [x0, y0, x1, y1]. */
const crosses = (g: Recorder): number[][][] => {
  const segs = g.calls.filter((c) => c.op === 'lineBetween').map((c) => c.args);
  const out: number[][][] = [];
  for (let i = 0; i + 1 < segs.length; i += 2) out.push([segs[i], segs[i + 1]]);
  return out;
};

const centreOf = ([a]: number[][]): Vec2 => ({ x: (a[0] + a[2]) / 2, y: (a[1] + a[3]) / 2 });

afterEach(() => setMotionScale(false));

describe('the death ×', () => {
  /* QA round 1, polish P2: pt(3.5) was a mark small enough to miss. */
  it('has arms pt(5) long', () => {
    expect(DEATH_ARM).toBe(pt(5));
  });

  it('stays where the death was, away from the frame', () => {
    const p = { x: pf.x + pf.w * 0.3, y: pf.y + pf.h * 0.5 };
    expect(deathMarkAt(p, pf)).toEqual(p);
  });

  it('is pulled inside the playfield by an arm at every edge', () => {
    const at = (x: number, y: number): Vec2 => deathMarkAt({ x, y }, pf);
    expect(at(pf.right, pf.y + 100)).toEqual({ x: pf.right - DEATH_ARM, y: pf.y + 100 });
    expect(at(pf.x - 3, pf.y)).toEqual({ x: pf.x + DEATH_ARM, y: pf.y + DEATH_ARM });
    expect(at(pf.x + 50, pf.bottom + 1)).toEqual({ x: pf.x + 50, y: pf.bottom - DEATH_ARM });
  });

  it('draws both marks of a mirror death whole, inside the board, at full size', () => {
    const { ink, ghost } = renderer();
    // A death on the left frame: its reflection lands on the right one, where
    // QA saw the second × clipped.
    const points = [
      { x: pf.x + 80, y: pf.y + 300 },
      { x: pf.x + 20, y: pf.y + 260 },
      { x: pf.x + 1, y: pf.y + 240 },
    ];
    ink.showGhost(points, true);
    const marks = crosses(ghost);
    expect(marks).toHaveLength(2);
    for (const mark of marks) {
      for (const [x0, y0, x1, y1] of mark) {
        // Each stroke of the × is two arms long, end to end.
        expect(Math.hypot(x1 - x0, y1 - y0)).toBeCloseTo(DEATH_ARM * 2, 9);
        for (const x of [x0, x1]) {
          expect(x).toBeGreaterThanOrEqual(pf.x);
          expect(x).toBeLessThanOrEqual(pf.right);
        }
        for (const y of [y0, y1]) {
          expect(y).toBeGreaterThanOrEqual(pf.y);
          expect(y).toBeLessThanOrEqual(pf.bottom);
        }
      }
    }
    expect(centreOf(marks[0])).toEqual({ x: pf.x + DEATH_ARM, y: pf.y + 240 });
    expect(centreOf(marks[1])).toEqual({ x: pf.right - DEATH_ARM, y: pf.y + 240 });
    // In the fail colour, at the mark's own weight.
    expect(ghost.calls).toContainEqual({ op: 'lineStyle', args: [pt(1.4), theme().fail, 0.8] });
  });

  it('marks a plain death once', () => {
    const { ink, ghost } = renderer();
    ink.showGhost([
      { x: pf.x + 100, y: pf.y + 300 },
      { x: pf.x + 120, y: pf.y + 200 },
    ]);
    expect(crosses(ghost)).toHaveLength(1);
  });

  /* A Retry for ★★★ prints over the line that WON: an × at its goal would read "died here". */
  it('leaves the × off a ghost that is not a death', () => {
    const { ink, ghost } = renderer();
    const points = [
      { x: pf.x + 100, y: pf.y + 300 },
      { x: pf.x + 120, y: pf.y + 200 },
    ];
    ink.showGhost(points, true, false, { mark: false });
    expect(crosses(ghost)).toHaveLength(0);
    expect(ghost.calls.filter((c) => c.op === 'strokePath')).toHaveLength(1);
  });

  /* For the first mirror death: the path that ran into the wall, not just its end. */
  it('traces the reflection too, when asked, at the ghost weight', () => {
    const { ink, ghost } = renderer();
    const points = [
      { x: pf.x + 100, y: pf.y + 300 },
      { x: pf.x + 150, y: pf.y + 200 },
    ];
    ink.showGhost(points, true, true);
    expect(ghost.calls.filter((c) => c.op === 'strokePath')).toHaveLength(2);
    const moves = ghost.calls.filter((c) => c.op === 'moveTo').map((c) => c.args);
    expect(moves).toEqual([
      [points[0].x, points[0].y],
      [2 * pf.axisX - points[0].x, points[0].y],
    ]);

    const { ink: plain, ghost: once } = renderer();
    plain.showGhost(points, true);
    expect(once.calls.filter((c) => c.op === 'strokePath')).toHaveLength(1);
  });
});

/* ----------------------------------------------------------- the print-in */

describe('the print-in (SPEC §3.2)', () => {
  it('never takes longer than asked, nor waits more than 34 ms between rows', () => {
    for (const rows of [0, 1, 2, 5, 10, 20, 40]) {
      for (const total of [PRINT_MS, 250]) {
        const s = printSchedule(rows, total);
        expect(s.end).toBeLessThanOrEqual(total + 1e-9);
        expect(s.step).toBeLessThanOrEqual(PRINT_STEP_MAX);
        expect(s.fade).toBeLessThanOrEqual(PRINT_FADE_MS);
        expect(s.end).toBeCloseTo(rows * s.step + s.fade, 9);
      }
    }
    // A long maze fills the budget; a short one keeps its 34 ms rhythm.
    expect(printSchedule(20).end).toBeCloseTo(PRINT_MS, 9);
    expect(printSchedule(2).step).toBe(PRINT_STEP_MAX);
  });

  it('prints from the start row up: edges run bottom to top, between the rows', () => {
    const rows = [900, 700, 400];
    const edges = printEdges(rows, 100, 1000);
    expect(edges).toEqual([1000, 800, 550, 100]);
    expect(edgeAt(edges, 0)).toBe(1000);
    expect(edgeAt(edges, 1.5)).toBe(675);
    expect(edgeAt(edges, 99)).toBe(100);
  });

  it('opens with nothing printed and ends with everything, the front never running backwards', () => {
    const level = LEVELS[47];
    const walls = level.walls.map((w) => pf.toScreenRect(w));
    const rows = obstacleRows(walls, mirrorBands(walls, pf.axisX, pf.x));
    const edges = printEdges(rows, pf.y, pf.bottom);
    const sched = printSchedule(rows.length);
    const at0 = printFront(0, edges, sched);
    expect(at0.settled).toBe(pf.bottom);
    const end = printFront(sched.end, edges, sched);
    expect(end.lead).toBe(pf.y);
    expect(end.settled).toBe(pf.y);
    let last = printFront(0, edges, sched);
    for (let t = 10; t <= sched.end; t += 10) {
      const f = printFront(t, edges, sched);
      expect(f.lead).toBeLessThanOrEqual(last.lead + 1e-9);
      expect(f.settled).toBeLessThanOrEqual(last.settled + 1e-9);
      // The soft front is above the settled rows, never below them.
      expect(f.lead).toBeLessThanOrEqual(f.settled + 1e-9);
      last = f;
    }
  });
});

/* ------------------------------------------------ the fold as a meter */

describe("the fold's notches (SPEC §3.4)", () => {
  /*
   * "The row note, the Light haptic and the notch are the same event": the
   * notches light on exactly the crossings GameScene.ringGates sounds, which
   * are Gates.rowCrossings over the recorded samples.
   */
  it('light on exactly the crossings the row notes sound, on every level', () => {
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (const level of LEVELS.filter((_, i) => i % 15 === 0)) {
      const walls = level.walls.map((w) => pf.toScreenRect(w));
      const rows = obstacleRows(walls, mirrorBands(walls, pf.axisX, pf.x));
      // A wandering stroke up the drawable half, doubling back now and then.
      const pts: Vec2[] = [pf.toScreen(level.start)];
      for (let i = 0; i < 80; i++) {
        const p = pts[pts.length - 1];
        pts.push({ x: pf.x + rnd() * (pf.axisX - pf.x), y: p.y + (rnd() < 0.8 ? -1 : 1) * rnd() * 40 });
      }
      const times = pts.map((_, i) => i * 16);
      const expected = new Set(rowCrossings(pts, times, rows).map((c) => c.row));
      // Fed as the game feeds it: the stroke growing a sample at a time.
      const lit = rows.map(() => false);
      let scan = 0;
      for (let n = 1; n <= pts.length; n++) {
        crossRows(pts.slice(0, n), rows, lit, scan);
        scan = n;
      }
      expect(new Set(lit.flatMap((on, i) => (on ? [i] : [])))).toEqual(expected);
    }
  });

  it('names the newest row crossed, and none when nothing new was crossed', () => {
    const rows = [500, 300];
    const lit = [false, false];
    expect(crossRows([{ x: 0, y: 600 }, { x: 0, y: 450 }], rows, lit, 0)).toBe(0);
    expect(crossRows([{ x: 0, y: 600 }, { x: 0, y: 450 }, { x: 0, y: 520 }], rows, lit, 2)).toBeNull();
    expect(lit).toEqual([true, false]);
  });
});

/* ------------------------------------------------------------- the death */

describe('the death (SPEC §3.6)', () => {
  it('throws its droplets along the travel, the same way every time', () => {
    const up = splatDrops({ x: 0, y: -1 });
    expect(up).toHaveLength(11);
    expect(splatDrops({ x: 0, y: -1 })).toEqual(up);
    const mean = up.reduce((m, d) => ({ x: m.x + d.dx, y: m.y + d.dy }), { x: 0, y: 0 });
    // On average they fly the way the line was going.
    expect(mean.y / up.length).toBeLessThan(-0.5);
    for (const d of up) expect(d.reach).toBeLessThanOrEqual(dp(24));
  });

  it('arcs over the fold, from the pen to the reflection, above both', () => {
    const from = { x: pf.axisX - 90, y: 600 };
    const to = { x: pf.axisX + 90, y: 600 };
    const c = arcCurve(from, to);
    expect(c[0]).toEqual(from);
    expect(c[c.length - 1].x).toBeCloseTo(to.x, 9);
    expect(c[c.length - 1].y).toBeCloseTo(to.y, 9);
    const apex = c.reduce((a, p) => (p.y < a.y ? p : a));
    expect(apex.y).toBeLessThan(from.y - dp(12));
    expect(apex.x).toBeCloseTo(pf.axisX, 6);
  });

  it('splats a mirror death at the REFLECTED contact', () => {
    const { scene, objects } = fakeScene();
    const ink = new InkRenderer(scene, pf);
    const at = { x: pf.x + 100, y: pf.y + 400 };
    const before = objects.length;
    ink.splat('mirror', at, { x: 0, y: -1 });
    const g = objects[before];
    // The blot is the first disc drawn: its centre is the reflected point.
    const blot = g.calls.find((c) => c.op === 'fillPoints')!.args[0] as unknown as Vec2[];
    const cx = blot.reduce((s, p) => s + p.x, 0) / blot.length;
    const cy = blot.reduce((s, p) => s + p.y, 0) / blot.length;
    expect(cx).toBeCloseTo(pf.mirror(at).x, 6);
    expect(cy).toBeCloseTo(at.y, 6);
  });
});

/* ------------------------------------------------------------- guardrails */

describe('the guardrails', () => {
  const level = LEVELS[47];
  const walls = level.walls.map((w) => pf.toScreenRect(w));
  const start = pf.toScreen(level.start);
  const goal = pf.toScreen(level.goal);
  const stroke = Array.from({ length: 40 }, (_, i) => ({ x: start.x + Math.sin(i / 5) * 20, y: start.y - i * 12 }));
  const times = stroke.map((_, i) => i * 16);

  const everything = (ink: InkRenderer): void => {
    ink.drawLevel(walls, start, goal, { printIn: PRINT_MS });
    ink.drawStroke(stroke.slice(0, 10), times.slice(0, 10));
    ink.drawStroke(stroke, times);
    ink.setHeat(3, 0.3, false);
    ink.spark(stroke[20]);
    ink.clearStroke();
    ink.drawStroke(stroke, times);
    ink.flashFail(stroke, times, { at: stroke[39], mirror: true, wall: 2, arrow: 'your reflection' });
    ink.clearStroke();
  };

  /* Tech G7: every endless loop sits behind motionReduced(). */
  it('loops nothing forever under reduced motion — and does breathe without it', () => {
    setMotionScale(true);
    const reduced = fakeScene();
    everything(new InkRenderer(reduced.scene, pf));
    expect(reduced.tweens.filter((c) => c.repeat === -1)).toEqual([]);

    setMotionScale(false);
    const moving = fakeScene();
    everything(new InkRenderer(moving.scene, pf));
    expect(moving.tweens.some((c) => c.repeat === -1)).toBe(true);
  });

  it('shows the board whole at once under reduced motion: no print-in', () => {
    setMotionScale(true);
    const { scene } = fakeScene();
    const ink = new InkRenderer(scene, pf);
    ink.drawLevel(walls, start, goal);
    expect(ink.printIn()).toBe(0);
  });

  /* Tech G5: the goal's halo is a ring leaving the ring, never a disc wider than the threshold. */
  it('pulses the goal outward from its ring, never shrinking the ring', () => {
    const { scene, tweens } = fakeScene();
    const ink = new InkRenderer(scene, pf);
    ink.drawLevel(walls, start, goal);
    ink.drawStroke(stroke.slice(0, 3), times.slice(0, 3));
    const pulses = tweens.filter((c) => c.repeat === -1 && typeof c.scale === 'number');
    expect(pulses.length).toBeGreaterThan(0);
    for (const p of pulses) expect(p.scale!).toBeGreaterThanOrEqual(1);
  });

  it('draws the heat outline inside the wall it names, and puts it out', () => {
    const { scene } = fakeScene();
    const ink = new InkRenderer(scene, pf);
    ink.drawLevel(walls, start, goal);
    ink.setHeat(4, 0.45, true);
    const line = (ink as unknown as { heatLine: Recorder }).heatLine;
    const pts = last(line.calls.filter((c) => c.op === 'strokePoints'))!.args[0] as unknown as Vec2[];
    const w = walls[4];
    const half = dp(1.2) / 2;
    for (const p of pts) {
      // The stroke's outer edge (half its width out from the path) stays in the rect.
      expect(p.x - half).toBeGreaterThanOrEqual(w.x - 1e-9);
      expect(p.x + half).toBeLessThanOrEqual(w.x + w.w + 1e-9);
      expect(p.y - half).toBeGreaterThanOrEqual(w.y - 1e-9);
      expect(p.y + half).toBeLessThanOrEqual(w.y + w.h + 1e-9);
    }
    expect(line.calls).toContainEqual({ op: 'lineStyle', args: [dp(1.2), theme().fail, 1] });
    ink.setHeat(null);
    expect(last(line.calls)).toEqual({ op: 'setVisible', args: [false] });
  });

  it('washes a death at 0.07 of the fail red', () => {
    const { scene } = fakeScene();
    const ink = new InkRenderer(scene, pf);
    ink.drawLevel(walls, start, goal);
    ink.flashFail(stroke, times, { at: stroke[39], mirror: false, wall: null });
    const wash = (ink as unknown as { washG: Recorder }).washG;
    expect(wash.calls).toContainEqual({ op: 'setAlpha', args: [0.07] });
  });

  /* "A press on the start dot completes the print-in in that same frame." */
  it('finishes the print-in on the first touch', () => {
    const { scene } = fakeScene();
    const ink = new InkRenderer(scene, pf);
    ink.drawLevel(walls, start, goal, { printIn: PRINT_MS });
    const inner = ink as unknown as { printTween: unknown };
    expect(inner.printTween).not.toBeNull();
    ink.drawStroke([start], [0]);
    expect(inner.printTween).toBeNull();
  });

  it('drops the hot core from a dead line, and brings it back for the next', () => {
    const { scene } = fakeScene();
    const ink = new InkRenderer(scene, pf);
    ink.drawLevel(walls, start, goal);
    const core = (ink as unknown as { coreG: Recorder }).coreG;
    ink.flashFail(stroke, times, { at: stroke[39], mirror: false, wall: null });
    expect(last(core.calls.filter((c) => c.op === 'setVisible'))).toEqual({ op: 'setVisible', args: [false] });
    ink.clearStroke();
    ink.drawStroke(stroke, times);
    expect(last(core.calls.filter((c) => c.op === 'setVisible'))).toEqual({ op: 'setVisible', args: [true] });
  });
});

describe('the win keeps the line it was drawn with', () => {
  const level = LEVELS[47];
  const walls = level.walls.map((w) => pf.toScreenRect(w));
  const start = pf.toScreen(level.start);
  const goal = pf.toScreen(level.goal);
  const stroke = Array.from({ length: 60 }, (_, i) => ({ x: start.x + Math.sin(i / 6) * 30, y: start.y - i * 14 }));
  const times = stroke.map((_, i) => i * 16);

  /*
   * Painting the figure's line again as one Canvas2D union per pass was the
   * whole goal frame on a long level (QA: 0.86 s at 4× CPU). The line on the
   * board is the figure's line; only the fill is baked.
   */
  it('bakes the fill and no second copy of the line', () => {
    const { scene, textures } = fakeScene();
    const ink = new InkRenderer(scene, pf);
    ink.drawLevel(walls, start, goal);
    ink.drawStroke(stroke, times);
    const before = new Set(textures.keys());
    ink.presentWin(stroke, times);
    const made = [...textures.keys()].filter((k) => !before.has(k));
    expect(made.some((k) => k.startsWith('fw-ink-fill-'))).toBe(true);
    expect(made.some((k) => k.startsWith('fw-ink-figure-'))).toBe(false);
    ink.clearWin();
    expect([...textures.keys()].some((k) => k.startsWith('fw-ink-fill-'))).toBe(false);
  });
});

describe('afterFrames', () => {
  it('runs after the given number of post-updates, and never after a shutdown', () => {
    const handlers = new Map<string, (() => void)[]>();
    const events = {
      once: (e: string, f: () => void) => handlers.set(e, [...(handlers.get(e) ?? []), f]),
      off: (e: string, f: () => void) => handlers.set(e, (handlers.get(e) ?? []).filter((g) => g !== f)),
    };
    const emit = (e: string): void => {
      const hs = handlers.get(e) ?? [];
      handlers.set(e, []);
      hs.forEach((h) => h());
    };
    const scene = { events } as unknown as Phaser.Scene;
    let ran = 0;
    afterFrames(scene, 2, () => ran++);
    emit('postupdate');
    expect(ran).toBe(0);
    emit('postupdate');
    expect(ran).toBe(1);
    afterFrames(scene, 2, () => ran++);
    emit('shutdown');
    emit('postupdate');
    emit('postupdate');
    expect(ran).toBe(1);
  });
});

