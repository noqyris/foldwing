import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Audio,
  MARIMBA,
  MIRROR_RATE,
  MIRROR_SHARE,
  MUSIC_LEVEL,
  noteHz,
  PEN_CUT_TAU,
  PEN_FULL_SPEED,
  PEN_HIGH_HZ,
  PEN_LOW_HZ,
  PEN_PAN,
  PEN_PEAK,
  PEN_STALL_MS,
  PEN_TAU,
  penCentre,
  penLevel,
  scheduleCelebration,
  scheduleNote,
  schedulePenStroke,
  schedulePop,
  scheduleReward,
  scheduleStarNote,
  scheduleStreakUp,
  scheduleTear,
  TEAR,
  scheduleTing,
  scheduleTock,
  semitone,
  startPenVoice,
} from './Audio';

const ROOT_HZ = 261.63;
const hz = (step: number): number => ROOT_HZ * Math.pow(2, semitone(step) / 12);

/*
 * One note per obstacle row crossed alive, climbing as the player gets further
 * up the maze. The ladder used to climb without a ceiling, and the level set
 * does not cooperate: a shipped level has a median of 21 rows and as many as
 * 33. Step 20 was 4186 Hz with its "shine" partial at 8372 Hz, and step 32
 * asked the oscillator for about 21 kHz — so the reward for finally clearing a
 * hard level was the most piercing sound in the game.
 */
describe('the note ladder', () => {
  it('starts on the root', () => {
    expect(semitone(0)).toBe(0);
    expect(hz(0)).toBeCloseTo(ROOT_HZ, 2);
  });

  it('climbs for the first few rows, which is the whole point', () => {
    for (let i = 1; i < 15; i++) {
      expect(semitone(i), `step ${i} did not rise`).toBeGreaterThan(semitone(i - 1));
    }
  });

  it('stays inside the register a phone speaker can play, at every level size', () => {
    // 33 is the largest gate count in the shipped set; go well past it.
    for (let step = 0; step <= 60; step++) {
      const f = hz(step);
      expect(f, `step ${step} is ${Math.round(f)} Hz`).toBeLessThan(1800);
      // The marimba's ×4 partial is bright on purpose, but it must stay in
      // the band a phone plays, and it is a strike: gone in 70 ms (below).
      expect(f * MARIMBA.partial, `step ${step} strike partial`).toBeLessThan(8000);
    }
  });

  it('rolls the phrase over instead of walking out of the range', () => {
    // Three octaves of a five-note scale, then back to the root.
    expect(semitone(15)).toBe(semitone(0));
    expect(semitone(16)).toBe(semitone(1));
  });

  it('only ever plays notes from the pentatonic scale', () => {
    const allowed = new Set([0, 2, 4, 7, 9]);
    for (let step = 0; step <= 60; step++) {
      expect(allowed.has(semitone(step) % 12), `step ${step}`).toBe(true);
    }
  });
});

/*
 * A recording stand-in for a BaseAudioContext: every node remembers where it
 * is connected and every parameter the automation it was given, so a voice
 * can be followed to its filter, its gain and its pan and checked against the
 * spec without a browser.
 */
interface ParamEvent {
  kind: 'set' | 'exp' | 'lin' | 'target';
  v: number;
  t: number;
  tau?: number;
}

interface Param {
  value: number;
  events: ParamEvent[];
  setValueAtTime(v: number, t: number): Param;
  exponentialRampToValueAtTime(v: number, t: number): Param;
  linearRampToValueAtTime(v: number, t: number): Param;
  setTargetAtTime(v: number, t: number, tau: number): Param;
  cancelScheduledValues(t: number): Param;
}

function param(value = 0): Param {
  const p: Param = {
    value,
    events: [],
    setValueAtTime(v, t) {
      p.events.push({ kind: 'set', v, t });
      return p;
    },
    exponentialRampToValueAtTime(v, t) {
      // The real API throws a RangeError on 0 — which would silence the sound.
      if (!(v > 0)) throw new RangeError(`exponential ramp to ${v}`);
      p.events.push({ kind: 'exp', v, t });
      return p;
    },
    linearRampToValueAtTime(v, t) {
      p.events.push({ kind: 'lin', v, t });
      return p;
    },
    setTargetAtTime(v, t, tau) {
      // The real API throws on a non-positive time constant.
      if (!(tau > 0)) throw new RangeError(`time constant ${tau}`);
      p.events.push({ kind: 'target', v, t, tau });
      return p;
    },
    cancelScheduledValues() {
      return p;
    },
  };
  return p;
}

interface Node {
  kind: 'osc' | 'noise' | 'filter' | 'gain' | 'panner' | 'dest';
  targets: Node[];
  disconnected: boolean;
  connect(n: Node): Node;
  disconnect(): void;
  type: string;
  frequency: Param;
  Q: Param;
  gain: Param;
  pan: Param;
  playbackRate: Param;
  loop: boolean;
  buffer: { length: number } | null;
  started: number;
  offset: number;
  stopped: number;
  onended: (() => void) | null;
  start(t?: number, offset?: number): void;
  stop(t?: number): void;
}

function fakeContext() {
  const nodes: Node[] = [];
  const node = (kind: Node['kind']): Node => {
    const n: Node = {
      kind,
      targets: [],
      disconnected: false,
      connect(dst) {
        n.targets.push(dst);
        return dst;
      },
      disconnect() {
        n.disconnected = true;
        n.targets = [];
      },
      type: kind === 'osc' ? 'sine' : 'lowpass',
      frequency: param(kind === 'osc' ? 440 : 350),
      Q: param(1),
      gain: param(1),
      pan: param(0),
      playbackRate: param(1),
      loop: false,
      buffer: null,
      started: NaN,
      offset: 0,
      stopped: NaN,
      onended: null,
      start(t = 0, offset = 0) {
        n.started = t;
        n.offset = offset;
      },
      stop(t = 0) {
        n.stopped = t;
      },
    };
    nodes.push(n);
    return n;
  };
  const ctx = {
    sampleRate: 48000,
    currentTime: 0,
    state: 'running',
    destination: node('dest'),
    resume: () => Promise.resolve(),
    createOscillator: () => node('osc'),
    createGain: () => node('gain'),
    createBiquadFilter: () => node('filter'),
    createStereoPanner: () => node('panner'),
    createBufferSource: () => node('noise'),
    createBuffer(_ch: number, frames: number) {
      const data = new Float32Array(frames);
      return { length: frames, getChannelData: () => data };
    },
  };

  const voices = (): Node[] => nodes.filter((n) => n.kind === 'osc' || n.kind === 'noise');
  /** The nodes a voice runs through, in order, up to where it leaves. */
  const chain = (v: Node): Node[] => {
    const seen: Node[] = [];
    let n: Node | undefined = v;
    while (n && !seen.includes(n)) {
      seen.push(n);
      n = n.targets?.[0];
    }
    return seen;
  };
  const first = (v: Node, kind: Node['kind']): Node | undefined => chain(v).find((n) => n.kind === kind);
  /** The loudest level a voice's gain is ever told to reach. */
  const peakOf = (v: Node): number => Math.max(...first(v, 'gain')!.gain.events.map((e) => e.v));
  /** When a voice's gain is last told to go to (near) silence. */
  const silentAt = (v: Node): number => {
    const ev = first(v, 'gain')!.gain.events;
    return ev[ev.length - 1].t;
  };
  const peak = (): number =>
    Math.max(...nodes.filter((n) => n.kind === 'gain').flatMap((g) => g.gain.events.map((e) => e.v)));
  const reset = (): void => {
    nodes.length = 0;
    nodes.push(ctx.destination);
  };
  return { ctx, nodes, voices, chain, first, peakOf, silentAt, peak, reset };
}

type Fake = ReturnType<typeof fakeContext>;
/** The most recent automation event (the lib target predates Array#at). */
const last = <T>(xs: readonly T[]): T | undefined => xs[xs.length - 1];
const as = (f: Fake): BaseAudioContext => f.ctx as unknown as BaseAudioContext;
const out = {} as AudioNode;

describe('the reward sounds', () => {
  it('pops from 880 to 1320 Hz in 90ms, at 0.07', () => {
    const f = fakeContext();
    schedulePop(as(f), out, 2);
    expect(f.voices()).toHaveLength(1);
    const [v] = f.voices();
    expect(v.frequency.events[0]).toMatchObject({ v: 880, t: 2 });
    const end = v.frequency.events[v.frequency.events.length - 1];
    expect(end).toMatchObject({ v: 1320 });
    expect(end.t).toBeCloseTo(2.09, 9);
    expect(f.peak()).toBeCloseTo(0.07, 9);
  });

  it('rings C6, E6, G6 on triangles 60ms apart, at 0.07', () => {
    const f = fakeContext();
    scheduleReward(as(f), out, 1);
    const hz = f.voices().map((v) => v.frequency.value);
    expect(hz[0]).toBeCloseTo(1046.5, 0);
    expect(hz[1]).toBeCloseTo(1318.5, 0);
    expect(hz[2]).toBeCloseTo(1568.0, 0);
    expect(f.voices().every((v) => v.type === 'triangle')).toBe(true);
    expect(f.voices().map((v) => v.started)).toEqual([1, 1.06, 1.12].map((t) => expect.closeTo(t, 9)));
    expect(f.peak()).toBeCloseTo(0.07, 9);
  });

  it('swells 200ms of noise under a G5, at 0.06', () => {
    const f = fakeContext();
    scheduleStreakUp(as(f), out, 0);
    const noise = f.voices().find((v) => v.kind === 'noise');
    expect(noise?.stopped).toBeCloseTo(0.2, 9);
    const note = f.voices().find((v) => v.kind === 'osc');
    expect(note?.frequency.value).toBeCloseTo(784.0, 0);
    expect(f.peak()).toBeCloseTo(0.06, 9);
  });

  it('stays well under the win it so often lands on', () => {
    const win = fakeContext();
    scheduleCelebration(as(win), out, 0, false);
    for (const play of [schedulePop, scheduleReward, scheduleStreakUp]) {
      const f = fakeContext();
      play(as(f), out, 0);
      expect(f.peak()).toBeLessThan(win.peak());
    }
  });
});

/*
 * SPEC §3.8. The row voice is a struck bar, not a bell: a quick run of rows
 * used to smear into a chord because each note rang on for half a second at
 * full brightness.
 */
describe('the marimba row voice', () => {
  const struck = () => {
    const f = fakeContext();
    scheduleNote(as(f), out, 3, 4);
    const [fund, partial] = f.voices().filter((v) => v.kind === 'osc');
    const click = f.voices().find((v) => v.kind === 'noise')!;
    return { f, fund, partial, click };
  };

  it('strikes a sine fundamental at the row\'s note, 0.15, gone in 0.45 s', () => {
    const { f, fund } = struck();
    expect(fund.type).toBe('sine');
    expect(fund.frequency.value).toBeCloseTo(noteHz(4), 6);
    expect(f.peakOf(fund)).toBeCloseTo(0.15, 9);
    expect(f.silentAt(fund)).toBeCloseTo(3.45, 9);
  });

  it('hits hard: full level within a few milliseconds, not a swell', () => {
    const { f, fund } = struck();
    const attack = f.first(fund, 'gain')!.gain.events.find((e) => e.v === 0.15)!;
    expect(attack.t - 3).toBeLessThanOrEqual(0.005);
  });

  it('adds the ×4 partial at 0.035 that dies in 70 ms', () => {
    const { f, partial } = struck();
    expect(partial.frequency.value).toBeCloseTo(noteHz(4) * 4, 6);
    expect(f.peakOf(partial)).toBeCloseTo(0.035, 9);
    expect(f.silentAt(partial)).toBeCloseTo(3.07, 9);
  });

  it('clicks the mallet: 5 ms of noise through a 3 kHz high-pass', () => {
    const { f, click } = struck();
    const hp = f.first(click, 'filter')!;
    expect(hp.type).toBe('highpass');
    expect(hp.frequency.value).toBe(3000);
    expect(click.stopped - click.started).toBeCloseTo(0.005, 9);
    expect(f.peakOf(click)).toBeLessThan(MARIMBA.peak);
  });
});

describe('the ting, the tear, the tock and the stars', () => {
  it('tings the row\'s note an octave up, sine, 0.06, over in 0.18 s', () => {
    const f = fakeContext();
    scheduleTing(as(f), out, 1, 6);
    const [v] = f.voices();
    expect(v.type).toBe('sine');
    expect(v.frequency.value).toBeCloseTo(noteHz(6) * 2, 6);
    expect(f.peakOf(v)).toBeCloseTo(0.06, 9);
    expect(f.silentAt(v)).toBeCloseTo(1.18, 9);
  });

  it('keeps the ting in a phone\'s range at the top of the phrase', () => {
    for (let step = 0; step < 15; step++) expect(noteHz(step) * 2).toBeLessThan(4000);
  });

  it('tears 60 ms of noise bandpassed at 3 kHz, heard at 0.05', () => {
    const f = fakeContext();
    scheduleTear(as(f), out, 2);
    const [v] = f.voices();
    expect(v.kind).toBe('noise');
    const bp = f.first(v, 'filter')!;
    expect(bp.type).toBe('bandpass');
    expect(bp.frequency.value).toBe(3000);
    expect(v.stopped - v.started).toBeCloseTo(0.06, 9);
    // The gain that lands a 0.05 peak after the band-pass (measured in Chrome).
    expect(TEAR.heard).toBe(0.05);
    expect(f.peakOf(v)).toBeCloseTo(TEAR.gain, 9);
    // Quieter than the thud it rides on (0.3), always.
    expect(TEAR.gain).toBeLessThan(0.3);
  });

  it('gives the tear a body: it holds through most of its 60 ms, not a click', () => {
    const f = fakeContext();
    scheduleTear(as(f), out, 0);
    const ev = f.first(f.voices()[0], 'gain')!.gain.events;
    const at = (t: number): number => {
      // The level the automation describes at t (linear between events is
      // enough to tell a body from a spike).
      let prev = ev[0];
      for (const e of ev) {
        if (e.t >= t) {
          const u = (t - prev.t) / Math.max(1e-9, e.t - prev.t);
          return prev.v + (e.v - prev.v) * u;
        }
        prev = e;
      }
      return prev.v;
    };
    expect(at(0.03)).toBeGreaterThan(TEAR.gain * 0.6);
    expect(at(0.06)).toBeLessThan(0.001);
  });

  it('tocks a soft 520 Hz sine, 0.04, 60 ms', () => {
    const f = fakeContext();
    scheduleTock(as(f), out, 0);
    const [v] = f.voices();
    expect(v.type).toBe('sine');
    expect(v.frequency.value).toBe(520);
    expect(f.peakOf(v)).toBeCloseTo(0.04, 9);
    expect(f.silentAt(v)).toBeCloseTo(0.06, 9);
  });

  it('punches the stars in on C6, D6, G6, triangles at 0.12', () => {
    const want = [1046.5, 1174.66, 1567.98];
    want.forEach((w, i) => {
      const f = fakeContext();
      scheduleStarNote(as(f), out, 0, i);
      const [v] = f.voices();
      expect(v.type).toBe('triangle');
      expect(v.frequency.value).toBeCloseTo(w, 0);
      expect(f.peakOf(v)).toBeCloseTo(0.12, 9);
    });
  });

  it('puts the low fifth under the third star only — ★★★ is the only way to hear it', () => {
    const count = (i: number): number => {
      const f = fakeContext();
      scheduleStarNote(as(f), out, 0, i);
      return f.voices().length;
    };
    expect(count(0)).toBe(1);
    expect(count(1)).toBe(1);
    expect(count(2)).toBe(3);
    const f = fakeContext();
    scheduleStarNote(as(f), out, 0, 2);
    const low = f.voices().slice(1).map((v) => v.frequency.value);
    expect(low[0]).toBeCloseTo(ROOT_HZ / 2, 2);
    expect(low[1] / low[0]).toBeCloseTo(Math.pow(2, 7 / 12), 6);
  });
});

/*
 * THE PEN BED. The sound of the nib on the sheet, for as long as it moves: a
 * looped strand of noise through a bandpass whose level and colour follow the
 * speed, with a quieter copy for the reflection on the other side.
 */
describe('the pen on paper', () => {
  it('is silent at rest and full at 1.1 pt/ms, on a 0.7 curve', () => {
    expect(PEN_FULL_SPEED).toBe(2.2); // 1.1 pt/ms at PT = 2
    expect(penLevel(0)).toBe(0);
    expect(penLevel(PEN_FULL_SPEED)).toBeCloseTo(0.035, 9);
    expect(penLevel(PEN_FULL_SPEED * 5)).toBeCloseTo(0.035, 9);
    expect(penLevel(PEN_FULL_SPEED / 2)).toBeCloseTo(0.035 * Math.pow(0.5, 0.7), 9);
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(penLevel(bad), `${bad}`).toBeGreaterThanOrEqual(0);
      expect(penLevel(bad), `${bad}`).toBeLessThanOrEqual(PEN_PEAK);
    }
  });

  it('brightens from 1.8 to 3.2 kHz as the stroke speeds up', () => {
    expect(penCentre(0)).toBeCloseTo(PEN_LOW_HZ, 6);
    expect(PEN_LOW_HZ).toBe(1800);
    expect(penCentre(PEN_FULL_SPEED)).toBeCloseTo(3200, 6);
    let prev = 0;
    for (let v = 0; v <= 3; v += 0.1) {
      expect(penCentre(v)).toBeGreaterThanOrEqual(prev);
      prev = penCentre(v);
    }
  });

  it('is never louder than the row notes it is a bed for', () => {
    expect(PEN_PEAK * (1 + MIRROR_SHARE)).toBeLessThan(MARIMBA.peak / 2);
  });

  const voice = () => {
    const f = fakeContext();
    const v = startPenVoice(as(f), out, 1);
    const strands = f.voices();
    const [pen, mirror] = strands;
    return { f, v, strands, pen, mirror };
  };

  it('loops a 2 s strand of noise for the pen and one for its reflection', () => {
    const { f, strands, pen, mirror } = voice();
    expect(strands).toHaveLength(2);
    for (const s of strands) {
      expect(s.kind).toBe('noise');
      expect(s.loop).toBe(true);
      expect(s.buffer?.length).toBe(2 * 48000);
      expect(s.started).toBe(1);
      const band = f.first(s, 'filter')!;
      expect(band.type).toBe('bandpass');
      expect(band.Q.value).toBeCloseTo(0.9, 9);
    }
    // The same paper, a slightly different hand.
    expect(pen.playbackRate.value).toBe(1);
    expect(mirror.playbackRate.value).toBeCloseTo(MIRROR_RATE, 9);
    // One strand shared by both, made once per context.
    expect(pen.buffer).toBe(mirror.buffer);
  });

  it('pans the pen left and its reflection right', () => {
    const { f, pen, mirror } = voice();
    expect(PEN_PAN).toBe(0.3);
    expect(f.first(pen, 'panner')!.pan.value).toBeCloseTo(-0.3, 9);
    expect(f.first(mirror, 'panner')!.pan.value).toBeCloseTo(0.3, 9);
  });

  it('starts silent, then follows the speed with τ = 40 ms', () => {
    const { f, v, pen, mirror } = voice();
    const g = (s: Node) => f.first(s, 'gain')!.gain;
    expect(g(pen).events).toEqual([{ kind: 'set', v: 0, t: 1 }]);

    v.speed(PEN_FULL_SPEED, 1.2);
    expect(last(g(pen).events)).toEqual({ kind: 'target', v: PEN_PEAK, t: 1.2, tau: PEN_TAU });
    expect(last(g(mirror).events)!.v).toBeCloseTo(PEN_PEAK * MIRROR_SHARE, 9);
    expect(last(f.first(pen, 'filter')!.frequency.events)).toMatchObject({ v: PEN_HIGH_HZ, tau: PEN_TAU });

    v.speed(PEN_FULL_SPEED, 1.3, false);
    expect(last(g(mirror).events)!.v).toBe(0);
  });

  it('cuts with τ = 30 ms, stops soon after, and lets its nodes go', () => {
    const { f, v, strands } = voice();
    v.speed(1, 1.1);
    v.cut(2);
    for (const s of strands) {
      expect(last(f.first(s, 'gain')!.gain.events)).toEqual({ kind: 'target', v: 0, t: 2, tau: PEN_CUT_TAU });
      expect(s.stopped).toBeGreaterThan(2);
      expect(s.stopped).toBeLessThanOrEqual(2.3);
    }
    const chains = strands.map((s) => f.chain(s).filter((n) => f.nodes.includes(n)));
    const penGain = f.first(strands[0], 'gain')!.gain;
    for (const s of strands) s.onended?.();
    for (const c of chains) {
      expect(c.map((n) => n.kind)).toEqual(['noise', 'filter', 'gain', 'panner']);
      for (const n of c) expect(n.disconnected, n.kind).toBe(true);
    }
    // A speed after the cut must not bring it back.
    const before = penGain.events.length;
    v.speed(2, 2.1);
    expect(penGain.events.length).toBe(before);
  });

  it('lays a recorded stroke out for the replay: the speed it was drawn at, cut at its end', () => {
    const f = fakeContext();
    // 300 ms at a steady 1.1 base px/ms, sampled every 10 ms.
    const times = Array.from({ length: 31 }, (_, i) => 1000 + i * 10);
    const points = times.map((_, i) => ({ x: 100, y: 800 - i * 11 }));
    schedulePenStroke(as(f), out, 5, points, times);
    const [pen] = f.voices();
    const gain = f.first(pen, 'gain')!.gain.events;
    const speeds = gain.filter((e) => e.kind === 'target' && e.v > 0);
    expect(speeds.length).toBeGreaterThan(3);
    for (const e of speeds) expect(e.v).toBeCloseTo(penLevel(1.1), 6);
    expect(last(gain)).toMatchObject({ v: 0, t: expect.closeTo(5.3, 9) });

    // Played at 2×, it is drawn twice as fast and over in half the time.
    const g2 = fakeContext();
    schedulePenStroke(as(g2), out, 5, points, times, 2);
    const fast = g2.first(g2.voices()[0], 'gain')!.gain.events;
    expect(fast.find((e) => e.kind === 'target' && e.v > 0)!.v).toBeCloseTo(penLevel(2.2), 6);
    expect(last(fast)!.t).toBeCloseTo(5.15, 9);
  });
});

/*
 * The live service, on a stand-in context: what the game actually calls.
 */
describe('Audio, in play', () => {
  const f = fakeContext();

  beforeAll(() => {
    const Ctor = function () {
      return f.ctx;
    } as unknown as typeof AudioContext;
    (globalThis as unknown as { window: unknown }).window = { AudioContext: Ctor };
    Audio.unlock();
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    Audio.setEnabled(true);
    Audio.resetScale();
    f.reset();
    f.ctx.currentTime = 10;
  });

  afterEach(() => {
    Audio.penStop();
    vi.useRealTimers();
  });

  const pens = (): Node[] => f.voices().filter((v) => v.kind === 'noise' && v.loop);
  const penGain = (): Param => f.first(pens()[0], 'gain')!.gain;
  const oscHz = (): number[] => f.voices().filter((v) => v.kind === 'osc').map((v) => v.frequency.value);

  it('starts the bed at pen-down and follows the speed', () => {
    Audio.penStart();
    expect(pens()).toHaveLength(2);
    Audio.penSpeed(PEN_FULL_SPEED);
    expect(last(penGain().events)).toMatchObject({ kind: 'target', v: PEN_PEAK, t: 10 });
  });

  it('averages the moves between updates instead of booking every one', () => {
    Audio.penStart();
    Audio.penSpeed(1);
    const booked = penGain().events.length;
    f.ctx.currentTime = 10.01;
    Audio.penSpeed(2);
    f.ctx.currentTime = 10.02;
    Audio.penSpeed(0.4);
    expect(penGain().events.length).toBe(booked);
    f.ctx.currentTime = 10.035;
    Audio.penSpeed(0.6);
    expect(last(penGain().events)!.v).toBeCloseTo(penLevel((2 + 0.4 + 0.6) / 3), 9);
  });

  it('glides to silence on its own when the pen stops moving', () => {
    Audio.penStart();
    Audio.penSpeed(PEN_FULL_SPEED);
    vi.advanceTimersByTime(PEN_STALL_MS - 1);
    expect(last(penGain().events)!.v).toBe(PEN_PEAK);
    f.ctx.currentTime = 10.09;
    vi.advanceTimersByTime(1);
    expect(last(penGain().events)).toMatchObject({ kind: 'target', v: 0, t: 10.09, tau: PEN_TAU });
    // …and the next move, 10 ms later, brings it straight back — not a
    // throttle window later.
    f.ctx.currentTime = 10.1;
    Audio.penSpeed(PEN_FULL_SPEED);
    expect(last(penGain().events)).toMatchObject({ v: PEN_PEAK, t: 10.1 });
  });

  it('starts the first stroke\'s bed while the context is still waking', () => {
    f.ctx.state = 'suspended';
    try {
      Audio.penStart();
      expect(pens()).toHaveLength(2);
      // The one-shots still wait for a running context, as they always have.
      Audio.rowNote(0);
      expect(f.voices().filter((v) => v.kind === 'osc')).toHaveLength(0);
    } finally {
      f.ctx.state = 'running';
    }
  });

  it('cuts on a lift, a death or a win', () => {
    Audio.penStart();
    Audio.penSpeed(1);
    Audio.penStop();
    expect(last(penGain().events)).toMatchObject({ v: 0, tau: PEN_CUT_TAU });
    expect(Audio.penning).toBe(false);
    // A move that arrives after the cut is ignored, not a new bed.
    Audio.penSpeed(2);
    vi.advanceTimersByTime(500);
    expect(last(penGain().events)).toMatchObject({ v: 0, tau: PEN_CUT_TAU });
  });

  it('never stacks two beds', () => {
    Audio.penStart();
    const [first] = pens();
    Audio.penStart();
    expect(first.stopped).toBeGreaterThan(0);
    expect(pens()).toHaveLength(4);
    expect(pens().filter((p) => Number.isNaN(p.stopped))).toHaveLength(2);
  });

  it('goes quiet the moment Sound is switched off, and stays off', () => {
    Audio.penStart();
    Audio.penSpeed(1);
    Audio.setEnabled(false);
    expect(last(penGain().events)).toMatchObject({ v: 0, tau: PEN_CUT_TAU });
    f.reset();
    Audio.penStart();
    Audio.rowNote(0);
    Audio.ting();
    Audio.tear();
    Audio.tock();
    Audio.starNote(0);
    expect(f.voices()).toHaveLength(0);
  });

  it('plays the row it is told, and the phrase carries on from there', () => {
    Audio.rowNote(4);
    Audio.note();
    expect(oscHz().filter((_, i) => i % 2 === 0)).toEqual([noteHz(4), noteHz(5)]);
    f.reset();
    // "Close" tings the row the phrase last played, an octave up.
    Audio.ting();
    expect(oscHz()).toEqual([noteHz(5) * 2]);
  });

  it('keeps counting the phrase while Sound is off, so switching on mid-level is in step', () => {
    Audio.setEnabled(false);
    Audio.rowNote(2);
    Audio.setEnabled(true);
    Audio.note();
    expect(oscHz()[0]).toBeCloseTo(noteHz(3), 9);
  });

  it('hands the music a bus at its resting level', () => {
    const bus = Audio.musicBus();
    expect(bus?.out.gain.value).toBe(MUSIC_LEVEL);
    expect(MUSIC_LEVEL).toBeCloseTo(0.14, 9);
  });
});
