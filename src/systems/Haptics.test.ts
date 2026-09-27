import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  isNative: true,
  calls: [] as string[],
  /** When each call reached the plugin, on the test clock. */
  at: [] as number[],
  clock: 0,
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.isNative },
}));

vi.mock('@capacitor/haptics', () => {
  const log = (s: string) => {
    native.calls.push(s);
    native.at.push(native.clock);
  };
  return {
    ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
    NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
    Haptics: {
      impact: async (o: { style: string }) => log(`impact:${o.style}`),
      notification: async (o: { type: string }) => log(`notify:${o.type}`),
      selectionStart: async () => log('selectionStart'),
      selectionChanged: async () => log('selectionChanged'),
      selectionEnd: async () => log('selectionEnd'),
    },
  };
});

import { BurstThrottle, Haptics, TAP_GAP_MS, TAP_MAX_LATE_MS, TapGate } from './Haptics';

/*
 * Six reward tokens land 45ms apart (UI.flyReward). Six taps in a quarter of a
 * second play as one long buzz; three distinct ones read as "several arrived".
 */
describe('BurstThrottle', () => {
  it('lets three of six token landings through, 60ms or more apart', () => {
    const th = new BurstThrottle();
    const landings = [0, 45, 90, 135, 180, 225].map((t) => 1000 + t);
    const fired = landings.filter((t) => th.allow(t));
    expect(fired).toEqual([1000, 1090, 1180]);
    for (let i = 1; i < fired.length; i++) {
      expect(fired[i] - fired[i - 1]).toBeGreaterThanOrEqual(60);
    }
  });

  it('caps a long stream at three: requests keep the burst alive', () => {
    const th = new BurstThrottle();
    let fired = 0;
    for (let t = 0; t < 3000; t += 100) if (th.allow(t)) fired++;
    expect(fired).toBe(3);
  });

  it('starts a new burst after a quiet gap', () => {
    const th = new BurstThrottle();
    for (const t of [0, 60, 120, 180]) th.allow(t);
    expect(th.allow(240)).toBe(false);
    // A second flight a second later is its own moment.
    expect(th.allow(1300)).toBe(true);
  });
});

/*
 * Taptic hygiene. Two impacts closer than 70 ms play as one smeared buzz, and
 * the game asks for exactly that: a flick crosses three rows in a frame, a row
 * tick lands 16 ms before the wall that kills the stroke.
 */
describe('TapGate', () => {
  it('keeps every tap at least 70 ms from the last', () => {
    expect(TAP_GAP_MS).toBe(70);
    const gate = new TapGate();
    // A flick: row ticks one frame apart. Texture, so the crowded ones go.
    const played = [0, 16, 33, 50, 66, 83, 100, 140].filter((t) => gate.book(t, false) !== null);
    expect(played).toEqual([0, 83]);
  });

  it('makes the moment wait rather than lose it: a death 16 ms after a row tick', () => {
    const gate = new TapGate();
    expect(gate.book(1000, false)).toBe(1000); // the row tick
    expect(gate.book(1016, true)).toBe(1070); // the death, at the next free slot
  });

  it('never lets a waiting tap play more than TAP_MAX_LATE_MS after its moment', () => {
    const gate = new TapGate();
    gate.book(0, true);
    expect(gate.book(0, true)).toBe(70);
    expect(gate.book(0, true)).toBe(140);
    expect(140).toBeLessThanOrEqual(TAP_MAX_LATE_MS);
    // A fourth would be 210 ms late: no longer this moment's tap.
    expect(gate.book(0, true)).toBeNull();
  });

  it('holds its slot while it waits: texture arriving in between is dropped', () => {
    const gate = new TapGate();
    gate.book(0, false);
    expect(gate.book(10, true)).toBe(70);
    // The rumble at 40 would land 30 ms before the waiting death.
    expect(gate.book(40, false)).toBeNull();
    expect(gate.book(150, false)).toBe(150);
  });

  it('books a pattern\'s later beat ahead: the double knock', () => {
    const gate = new TapGate();
    expect(gate.book(500, true)).toBe(500);
    expect(gate.book(500, true, 570)).toBe(570);
  });
});

describe('Haptics', () => {
  /*
   * The service keeps one gate for the whole app, so every case runs on its
   * own stretch of clock, far from the last one's taps.
   */
  let base = 1e7;

  beforeEach(() => {
    base += 1e6;
    native.clock = base;
    native.isNative = true;
    native.calls.length = 0;
    native.at.length = 0;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(performance, 'now').mockImplementation(() => native.clock);
    Haptics.setEnabled(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Move the clock and the timers together. */
  const advance = (ms: number): void => {
    for (let i = 0; i < ms; i++) {
      native.clock += 1;
      vi.advanceTimersByTime(1);
    }
  };
  /** Let the plugin's awaited calls run. */
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  const since = (): number[] => native.at.map((t) => t - base);

  it('maps each moment to its native pattern', async () => {
    Haptics.land();
    advance(100);
    Haptics.success();
    advance(100);
    Haptics.warn();
    await flush();
    expect(native.calls).toEqual(['impact:LIGHT', 'notify:SUCCESS', 'notify:WARNING']);
  });

  it('wraps a selection tick in start/end, or iOS plays nothing', async () => {
    Haptics.select();
    await flush();
    expect(native.calls).toEqual(['selectionStart', 'selectionChanged', 'selectionEnd']);
  });

  it('knocks once for a wall, twice 70 ms apart for the reflection', async () => {
    Haptics.pair('wall');
    advance(300);
    expect(native.calls).toEqual(['impact:MEDIUM']);

    native.calls.length = 0;
    native.at.length = 0;
    const t0 = native.clock - base;
    Haptics.pair('mirror');
    expect(native.calls).toEqual(['impact:MEDIUM']);
    advance(69);
    expect(native.calls).toEqual(['impact:MEDIUM']);
    advance(1);
    expect(native.calls).toEqual(['impact:MEDIUM', 'impact:LIGHT']);
    expect(since()).toEqual([t0, t0 + 70]);
  });

  it('still knocks for a death that lands one frame after a row tick', () => {
    Haptics.tick();
    advance(16);
    Haptics.pair('mirror');
    advance(300);
    expect(native.calls).toEqual(['impact:LIGHT', 'impact:MEDIUM', 'impact:LIGHT']);
    // …and every one of them 70 ms or more from the one before.
    const at = since();
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(70);
  });

  it('drops the row ticks of a flick instead of buzzing', () => {
    for (let i = 0; i < 6; i++) {
      Haptics.tick();
      advance(16);
    }
    expect(native.calls).toEqual(['impact:LIGHT', 'impact:LIGHT']);
  });

  it('clicks when the pen reaches the goal, even straight after a row', () => {
    Haptics.tick();
    advance(10);
    Haptics.goal();
    advance(100);
    expect(native.calls).toEqual(['impact:LIGHT', 'impact:LIGHT']);
    expect(since()[1]).toBe(70);
  });

  it('punches the stars in as Light, Light, Success', () => {
    for (const i of [0, 1, 2]) {
      Haptics.star(i);
      advance(180);
    }
    expect(native.calls).toEqual(['impact:LIGHT', 'impact:LIGHT', 'notify:SUCCESS']);
  });

  it('keeps the rumble off the other taps', () => {
    Haptics.tick();
    advance(30);
    Haptics.rumble();
    advance(100);
    Haptics.rumble();
    expect(native.calls).toEqual(['impact:LIGHT', 'selectionStart']);
  });

  // Through the service, not just the throttle: reward() must both ask it and
  // respect the switch.
  it('plays three of six token landings as light taps', async () => {
    for (let i = 0; i < 6; i++) {
      Haptics.reward();
      advance(45);
    }
    await flush();
    expect(native.calls).toEqual(['impact:LIGHT', 'impact:LIGHT', 'impact:LIGHT']);

    native.calls.length = 0;
    Haptics.setEnabled(false);
    advance(2000);
    Haptics.reward();
    await flush();
    expect(native.calls).toEqual([]);
  });

  it('drops a waiting knock when the switch goes off before it plays', () => {
    Haptics.pair('mirror');
    Haptics.setEnabled(false);
    advance(200);
    expect(native.calls).toEqual(['impact:MEDIUM']);
  });

  it('is silent on the web and when the switch is off', async () => {
    native.isNative = false;
    Haptics.land();
    Haptics.success();
    Haptics.select();
    Haptics.reward();
    Haptics.pair('mirror');
    Haptics.goal();
    Haptics.star(2);
    advance(300);
    native.isNative = true;
    Haptics.setEnabled(false);
    Haptics.warn();
    Haptics.select();
    Haptics.close();
    Haptics.ready();
    Haptics.rumble();
    advance(300);
    await flush();
    expect(native.calls).toEqual([]);
  });
});
