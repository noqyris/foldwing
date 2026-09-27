/*
 * The bed has to stay OUT OF THE WAY, and that is a claim about pitch, not
 * taste. The gameplay phrase climbs from C4 upward as rows are cleared; if a
 * pad ever lands in that register the player hears the game answering itself,
 * and if a voicing wanders off the pentatonic it clashes with every note the
 * game is about to play.
 *
 * Both are properties of `chordAt` alone, so they can be proved rather than
 * listened for.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pauseGameLoop, resumeGameLoop } from './gameLoop';
import {
  BAR_SECONDS,
  chordAt,
  DUCK_DOWN_SECONDS,
  DUCK_HOLD_MS,
  DUCK_LEVEL,
  DUCK_UP_SECONDS,
  Music,
} from './Music';

/*
 * A Web Audio graph small enough to follow by hand: every node remembers where
 * it is connected, and a gain remembers the automation it was given. The music
 * bus is ours; the service under test books its bars into it.
 */
const graph = vi.hoisted(() => {
  interface FakeNode {
    kind: string;
    targets: Set<FakeNode>;
    gain: { value: number; ramps: [number, number][] };
    frequency: { value: number };
    type: string;
    connect(dst: FakeNode): FakeNode;
    disconnect(): void;
    start(): void;
    stop(): void;
  }
  const nodes: FakeNode[] = [];
  const node = (kind: string): FakeNode => {
    const gain = {
      value: 1,
      ramps: [] as [number, number][],
      setValueAtTime(v: number) {
        gain.value = v;
        return gain;
      },
      linearRampToValueAtTime(v: number, t: number) {
        gain.ramps.push([v, t]);
        return gain;
      },
      exponentialRampToValueAtTime(v: number, t: number) {
        gain.ramps.push([v, t]);
        return gain;
      },
      cancelScheduledValues() {
        return gain;
      },
    };
    const n: FakeNode = {
      kind,
      targets: new Set(),
      gain,
      frequency: { value: 0 },
      type: '',
      connect(dst) {
        n.targets.add(dst);
        return dst;
      },
      disconnect() {
        n.targets.clear();
      },
      start() {},
      stop() {},
    };
    nodes.push(n);
    return n;
  };
  const ctx = {
    currentTime: 0,
    createGain: () => node('gain'),
    createOscillator: () => node('osc'),
    createBiquadFilter: () => node('filter'),
  };
  const out = node('bus');
  const reaches = (from: FakeNode, to: FakeNode): boolean => {
    const seen = new Set<FakeNode>();
    const stack = [from];
    while (stack.length) {
      const n = stack.pop()!;
      if (n === to) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      stack.push(...n.targets);
    }
    return false;
  };
  const oscillators = (): FakeNode[] => nodes.filter((n) => n.kind === 'osc');
  const audible = (): number => oscillators().filter((o) => reaches(o, out)).length;
  return { nodes, ctx, out, reaches, oscillators, audible };
});

const effects = vi.hoisted(() => ({ on: true }));

vi.mock('./Audio', () => ({
  MUSIC_LEVEL: 0.14,
  Audio: {
    musicBus: () => ({ ctx: graph.ctx, out: graph.out }),
    unlock: () => {},
    get isEnabled() {
      return effects.on;
    },
  },
}));

/** The set Audio plays from. A pad outside it can clash by a semitone. */
const PENTATONIC = [0, 2, 4, 7, 9];

/** Reduce a signed semitone offset to its degree within the octave. */
const degree = (semi: number): number => ((semi % 12) + 12) % 12;

const BARS = Array.from({ length: 4000 }, (_, i) => i);

describe('the generated bed', () => {
  it('never plays a note the gameplay scale does not contain', () => {
    for (const bar of BARS) {
      for (const semi of chordAt(bar)) {
        expect(PENTATONIC, `bar ${bar} played ${semi}`).toContain(degree(semi));
      }
    }
  });

  /*
   * The gameplay phrase starts at C4, which is offset 0. Everything here must
   * sit strictly below that, or a pad and a cleared-row note collide on the
   * same pitch — the one thing that would make the bed sound like a mistake
   * rather than an accompaniment.
   */
  it('stays below the register the gameplay notes climb through', () => {
    for (const bar of BARS) {
      for (const semi of chordAt(bar)) {
        expect(semi, `bar ${bar}`).toBeLessThan(0);
      }
    }
  });

  it('anchors every bar on the root or the fifth', () => {
    for (const bar of BARS) {
      const degrees = chordAt(bar).map(degree);
      expect(degrees.includes(0) || degrees.includes(7), `bar ${bar}`).toBe(true);
    }
  });

  it('never doubles a pitch inside one bar', () => {
    for (const bar of BARS) {
      const voices = chordAt(bar);
      expect(new Set(voices).size, `bar ${bar}`).toBe(voices.length);
    }
  });

  /*
   * The whole reason this is generated rather than looped: there must be no
   * point at which the ear can start predicting. Received wisdom puts conscious
   * loop detection somewhere past 90 seconds, so an hour of play is the bar
   * that matters.
   */
  it('does not settle into a short cycle', () => {
    const anHour = Math.ceil(3600 / BAR_SECONDS);
    const seen = new Set(
      Array.from({ length: anHour }, (_, i) => chordAt(i).join(',')).values()
    );
    expect(seen.size).toBeGreaterThan(8);

    // And specifically: no period short enough to hear as a loop.
    for (const period of [1, 2, 3, 4, 6, 8, 12, 16]) {
      const repeats = Array.from({ length: 200 }, (_, i) =>
        chordAt(i).join(',') === chordAt(i + period).join(',')
      );
      expect(repeats.every(Boolean), `period ${period} repeated exactly`).toBe(false);
    }
  });

  it('gives the same bar the same voicing every time', () => {
    for (const bar of [0, 1, 7, 99, 1234]) {
      expect(chordAt(bar)).toEqual(chordAt(bar));
    }
  });

  /* Slow enough to be weather. Anything brisk becomes a melody to follow. */
  it('moves slowly enough to sit behind the game', () => {
    expect(BAR_SECONDS).toBeGreaterThanOrEqual(6);
  });
});

/*
 * STOPPING. The scheduler books two bars ahead and each rings for nine and a
 * half seconds, so "stop scheduling" on its own left up to twenty-four seconds
 * of bed playing — including chords that had not started yet — under a
 * full-screen ad whose whole point is that the game goes quiet.
 */
describe('the bed under a full-screen ad', () => {
  type VisibilityListener = () => void;
  const listeners: VisibilityListener[] = [];
  const doc = { hidden: false };

  beforeAll(() => {
    // The service listens for visibility once, on first start: give it a page.
    (globalThis as unknown as { window: unknown }).window = globalThis;
    (globalThis as unknown as { document: unknown }).document = {
      get hidden() {
        return doc.hidden;
      },
      addEventListener: (event: string, fn: VisibilityListener) => {
        if (event === 'visibilitychange') listeners.push(fn);
      },
    };
  });

  beforeEach(() => {
    vi.useFakeTimers();
    graph.nodes.length = 0;
    graph.nodes.push(graph.out);
    graph.out.targets.clear();
    graph.ctx.currentTime = 0;
  });

  afterEach(() => {
    Music.setEnabled(false);
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  const backgroundAndReturn = (): void => {
    doc.hidden = true;
    for (const fn of [...listeners]) fn();
    doc.hidden = false;
    for (const fn of [...listeners]) fn();
  };

  it('books its bars through a node of its own on the music bus', () => {
    Music.setEnabled(true);
    expect(graph.oscillators().length).toBeGreaterThan(0);
    expect(graph.audible()).toBe(graph.oscillators().length);
  });

  it('takes down what was already booked when it stops, on a short fade', () => {
    Music.setEnabled(true);
    const booked = graph.oscillators().length;
    const bed = graph.nodes.find((n) => n.kind === 'gain' && n.targets.has(graph.out))!;

    Music.stop();
    // Faded, not cut: a ramp to silence, over well under a second.
    const [level, at] = bed.gain.ramps[bed.gain.ramps.length - 1];
    expect(level).toBe(0);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThanOrEqual(0.5);
    // …and then gone, with every bar that was waiting to play.
    vi.advanceTimersByTime(1000);
    expect(booked).toBeGreaterThan(0);
    expect(graph.audible()).toBe(0);
  });

  it('starts again on a fresh node rather than on top of the bars it dropped', () => {
    Music.setEnabled(true);
    const first = graph.oscillators();
    Music.stop();
    vi.advanceTimersByTime(1000);
    Music.start();
    const second = graph.oscillators().filter((o) => !first.includes(o));
    expect(second.length).toBeGreaterThan(0);
    expect(second.every((o) => graph.reaches(o, graph.out))).toBe(true);
    expect(first.some((o) => graph.reaches(o, graph.out))).toBe(false);
  });

  it('does not start while a full-screen ad has the game paused', () => {
    pauseGameLoop();
    try {
      Music.setEnabled(true);
      expect(graph.oscillators()).toHaveLength(0);
    } finally {
      resumeGameLoop();
    }
    Music.start();
    expect(graph.audible()).toBeGreaterThan(0);
  });

  /*
   * The ad is up, the player takes a call and comes back: the visibility
   * handler used to restart the bed under the ad. The ad layer's own start,
   * once the ad is gone, is the one that counts.
   */
  it('does not come back under the ad after a trip to the background', () => {
    Music.setEnabled(true);
    pauseGameLoop(); // the ad goes up…
    Music.stop(); // …and quiets the game, as Ads.underFullScreenAd does
    vi.advanceTimersByTime(1000);
    try {
      backgroundAndReturn();
      expect(graph.audible()).toBe(0);
    } finally {
      resumeGameLoop(); // the ad is gone
    }
    Music.start();
    expect(graph.audible()).toBeGreaterThan(0);
  });
});

/*
 * THE DUCK. While the pen is down the bus steps back from 0.14 to 0.07 over
 * 150 ms, and comes back only after the pen has been up for 600 ms — a death
 * and its retry are one breath, and a bed that surged between every attempt
 * would pump.
 */
describe('the duck while drawing', () => {
  const bus = graph.out.gain;
  const lastRamp = (): [number, number] | undefined => bus.ramps[bus.ramps.length - 1];

  beforeEach(() => {
    vi.useFakeTimers();
    effects.on = true;
    bus.ramps.length = 0;
    bus.value = 0.14;
    graph.ctx.currentTime = 10;
  });

  afterEach(() => {
    Music.duck(false);
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('halves the bus over 150 ms when the pen goes down', () => {
    expect(DUCK_LEVEL).toBeCloseTo(0.07, 9);
    expect(DUCK_DOWN_SECONDS).toBeCloseTo(0.15, 9);
    Music.duck(true);
    expect(lastRamp()).toEqual([DUCK_LEVEL, 10 + DUCK_DOWN_SECONDS]);
  });

  it('comes back 600 ms after the pen lifts, not before', () => {
    Music.duck(true);
    const down = bus.ramps.length;
    Music.duck(false);
    vi.advanceTimersByTime(DUCK_HOLD_MS - 1);
    expect(bus.ramps).toHaveLength(down);
    vi.advanceTimersByTime(1);
    const [level, at] = lastRamp()!;
    expect(level).toBeCloseTo(0.14, 9);
    expect(at).toBeCloseTo(10 + DUCK_UP_SECONDS, 9);
  });

  it('stays down through a death and a quick retry', () => {
    Music.duck(true);
    Music.duck(false); // the death
    vi.advanceTimersByTime(400);
    Music.duck(true); // the retry, inside the hold
    vi.advanceTimersByTime(2000);
    expect(bus.ramps.every(([level]) => level === DUCK_LEVEL)).toBe(true);
  });

  it('does not dip for nothing when the effects are switched off', () => {
    effects.on = false;
    Music.duck(true);
    Music.duck(false);
    vi.advanceTimersByTime(2000);
    expect(bus.ramps).toHaveLength(0);
  });

  it('always comes back up, even if the effects went off while it was down', () => {
    Music.duck(true);
    effects.on = false;
    Music.duck(false);
    vi.advanceTimersByTime(DUCK_HOLD_MS);
    expect(lastRamp()![0]).toBeCloseTo(0.14, 9);
  });
});
