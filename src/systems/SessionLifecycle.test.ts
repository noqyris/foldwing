/*
 * The session service and the ad layer's starter gate. core/Session.test.ts
 * pins the pure rule; this pins what the app does with it — the persisted
 * count, the end of the first session, what listeners hear — and the gate
 * every route that can ask ATT goes through: the film gone, then the app
 * ACTIVE, with the state read again after the listener is registered.
 *
 * Each rule is written so that deleting it fails a test (the mutation check is
 * summarised in docs/09-systems.md §8).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type StateListener = (s: { isActive: boolean }) => void;

const h = vi.hoisted(() => {
  const state = {
    native: true,
    /** What getState answers, call by call; the last entry repeats. */
    answers: [] as boolean[],
    getStateCalls: 0,
    /** getState rejects: no App plugin linked. */
    noPlugin: false,
    listener: null as ((s: { isActive: boolean }) => void) | null,
    /** The order App was talked to in: 'get' and 'listen'. */
    order: [] as string[],
    removed: 0,
    disk: new Map<string, string>(),
    failWrites: false,
    writes: [] as string[],
    introDone: (): void => {},
    intro: Promise.resolve(),
  };
  const resetIntro = (): void => {
    state.intro = new Promise<void>((r) => (state.introDone = r));
  };
  return { state, resetIntro };
});
const state = h.state;

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => h.state.native } }));
vi.mock('@capacitor/app', () => ({
  App: {
    getState: async (): Promise<{ isActive: boolean }> => {
      h.state.order.push('get');
      if (h.state.noPlugin) throw new Error('"App" plugin is not implemented on ios');
      const i = Math.min(h.state.getStateCalls, h.state.answers.length - 1);
      h.state.getStateCalls += 1;
      return { isActive: h.state.answers[i] ?? true };
    },
    addListener: (_event: string, fn: StateListener) => {
      h.state.order.push('listen');
      h.state.listener = fn;
      return Promise.resolve({
        remove: async () => {
          h.state.removed += 1;
        },
      });
    },
  },
}));
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: h.state.disk.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => {
      if (h.state.failWrites) throw new Error('disk full');
      h.state.writes.push(value);
      h.state.disk.set(key, value);
    },
  },
}));
vi.mock('@noqyris/splash', () => ({ whenIntroDone: () => h.state.intro }));

const s = await import('./SessionLifecycle');

const MIN = 60_000;
/** 2026-09-27 12:00 local (the suite runs in Europe/Belgrade). */
const NOON = new Date(2026, 8, 27, 12, 0).getTime();

/** Let queued promise callbacks run. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

/** Whether `p` has resolved yet. */
const resolved = async (p: Promise<unknown>): Promise<boolean> => {
  let done = false;
  void p.then(() => (done = true));
  await settle();
  return done;
};

const leave = (): void => s.noteHidden();
const back = (): boolean => s.noteVisible();
const at = (ms: number): void => {
  vi.setSystemTime(ms);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at(NOON);
  s.__resetSessionLifecycleForTests();
  Object.assign(state, {
    native: true,
    answers: [true],
    getStateCalls: 0,
    noPlugin: false,
    listener: null,
    order: [],
    removed: 0,
    failWrites: false,
    writes: [],
  });
  state.disk.clear();
  h.resetIntro();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the session count', () => {
  it('counts a cold launch on top of what the disk holds, and writes it back', async () => {
    state.disk.set(s.SESSIONS_KEY, '7');
    expect(await s.startColdSession()).toBe(8);
    expect(state.disk.get(s.SESSIONS_KEY)).toBe('8');
    expect(s.sessionNumber()).toBe(8);
    expect(s.renewedSinceLaunch()).toBe(false);
  });

  it('counts a boot once, however often it is started', async () => {
    const first = s.startColdSession();
    expect(s.startColdSession()).toBe(first);
    expect(await first).toBe(1);
    expect(state.writes).toEqual(['1']);
  });

  it('starts from zero when the disk holds nothing usable', async () => {
    state.disk.set(s.SESSIONS_KEY, 'lots');
    expect(await s.startColdSession()).toBe(1);
    s.__resetSessionLifecycleForTests();
    state.disk.set(s.SESSIONS_KEY, '-4');
    expect(await s.startColdSession()).toBe(1);
  });

  it('a return after 30 minutes is a new session: counted, written, and the first session is over', async () => {
    state.disk.set(s.SESSIONS_KEY, '2');
    await s.startColdSession();
    leave();
    at(NOON + 30 * MIN);
    expect(back()).toBe(true);
    expect(s.sessionNumber()).toBe(4);
    expect(s.renewedSinceLaunch()).toBe(true);
    await settle();
    expect(state.writes).toEqual(['3', '4']);
  });

  it('a shorter return is the same session: nothing counted, nothing written', async () => {
    await s.startColdSession();
    leave();
    at(NOON + 30 * MIN - 1);
    expect(back()).toBe(false);
    expect(s.sessionNumber()).toBe(1);
    expect(s.renewedSinceLaunch()).toBe(false);
    await settle();
    expect(state.writes).toEqual(['1']);
  });

  it('a return into a new local day is a new session after five minutes', async () => {
    at(new Date(2026, 8, 27, 23, 58).getTime());
    await s.startColdSession();
    leave();
    at(new Date(2026, 8, 28, 0, 3).getTime());
    expect(back()).toBe(true);
    expect(s.sessionNumber()).toBe(2);
  });

  it('measures the absence from the FIRST hide', async () => {
    await s.startColdSession();
    leave();
    at(NOON + 29 * MIN);
    leave(); // iOS reports one departure twice
    at(NOON + 31 * MIN);
    expect(back()).toBe(true);
  });

  it('a visible with no hide before it changes nothing', async () => {
    await s.startColdSession();
    at(NOON + 5 * 60 * MIN);
    expect(back()).toBe(false);
    expect(s.sessionNumber()).toBe(1);
  });

  it('a clock set back within the day is not a pause', async () => {
    await s.startColdSession();
    leave();
    at(NOON - 3 * 60 * MIN);
    expect(back()).toBe(false);
  });

  it('forgets the pause once the page is back — the next return is measured afresh', async () => {
    await s.startColdSession();
    leave();
    at(NOON + 20 * MIN);
    expect(back()).toBe(false);
    at(NOON + 40 * MIN);
    leave();
    at(NOON + 60 * MIN);
    // 20 minutes since this hide, 60 since the first one: the same session.
    expect(back()).toBe(false);
  });

  it('keeps a return that lands before the boot read in the total it writes', async () => {
    state.disk.set(s.SESSIONS_KEY, '5');
    const boot = s.startColdSession();
    leave();
    at(NOON + 45 * MIN);
    expect(back()).toBe(true);
    expect(await boot).toBe(7);
    await settle();
    expect(state.disk.get(s.SESSIONS_KEY)).toBe('7');
  });

  it('never throws when the count cannot be written', async () => {
    state.failWrites = true;
    expect(await s.startColdSession()).toBe(1);
    leave();
    at(NOON + 31 * MIN);
    expect(back()).toBe(true);
    await settle();
  });
});

describe('who hears a session start', () => {
  it('hears the cold launch and every renewing return, at once, with the number', async () => {
    const heard: string[] = [];
    s.onSessionStart((reason, n) => heard.push(`${reason}:${n}`));
    void s.startColdSession();
    expect(heard).toEqual(['cold:1']); // before the disk has answered
    await settle();
    leave();
    at(NOON + 40 * MIN);
    back();
    expect(heard).toEqual(['cold:1', 'return:2']);
  });

  it('hears nothing from a glance', async () => {
    await s.startColdSession();
    const heard = vi.fn();
    s.onSessionStart(heard);
    leave();
    at(NOON + 10 * MIN);
    back();
    expect(heard).not.toHaveBeenCalled();
  });

  it('keeps telling the others when one listener throws, and stops telling an unsubscribed one', async () => {
    await s.startColdSession();
    const later = vi.fn();
    const gone = vi.fn();
    s.onSessionStart(() => {
      throw new Error('a broken listener');
    });
    s.onSessionStart(later);
    const off = s.onSessionStart(gone);
    off();
    leave();
    at(NOON + 31 * MIN);
    expect(back()).toBe(true);
    expect(later).toHaveBeenCalledWith('return', 2);
    expect(gone).not.toHaveBeenCalled();
  });
});

/*
 * The ATT trap. `visibilitychange` fires on willEnterForeground; the app turns
 * ACTIVE ~300 ms later. ATT asked in between shows nothing and answers
 * notDetermined.
 */
describe('whenAppActive', () => {
  it('resolves at once when the app is already active', async () => {
    expect(await resolved(s.whenAppActive())).toBe(true);
    expect(state.order).toEqual(['get']);
  });

  it('asks nothing off-device, and resolves', async () => {
    state.native = false;
    state.answers = [false];
    expect(await resolved(s.whenAppActive())).toBe(true);
    expect(state.order).toEqual([]);
  });

  it('waits while the app is inactive, for an appStateChange that says ACTIVE, then removes its listener', async () => {
    state.answers = [false];
    const p = s.whenAppActive();
    expect(await resolved(p)).toBe(false);
    state.listener?.({ isActive: false }); // resigning again is not coming back
    expect(await resolved(p)).toBe(false);
    state.listener?.({ isActive: true });
    expect(await resolved(p)).toBe(true);
    expect(state.removed).toBe(1);
    state.listener?.({ isActive: true }); // a late duplicate removes nothing twice
    await settle();
    expect(state.removed).toBe(1);
  });

  it('registers the listener FIRST and then reads the state again, so a change in between is not missed', async () => {
    state.answers = [false, true]; // inactive at the first read, active by the second
    const p = s.whenAppActive();
    expect(await resolved(p)).toBe(true); // no event ever fired
    expect(state.order).toEqual(['get', 'listen', 'get']);
    expect(state.removed).toBe(1);
  });

  it('does not hang where there is no App plugin to ask', async () => {
    state.noPlugin = true;
    expect(await resolved(s.whenAppActive())).toBe(true);
  });
});

describe('whenAdLayerMayStart — the one starter gate', () => {
  it('waits for the opening film to be gone, even with the app active', async () => {
    const p = s.whenAdLayerMayStart();
    expect(await resolved(p)).toBe(false);
    state.introDone();
    expect(await resolved(p)).toBe(true);
  });

  it('waits for the app to be active, even with the film gone', async () => {
    state.introDone();
    state.answers = [false];
    const p = s.whenAdLayerMayStart();
    expect(await resolved(p)).toBe(false);
    state.listener?.({ isActive: true });
    expect(await resolved(p)).toBe(true);
  });

  /*
   * The late splash timer. The film's cap (or main.ts's backstop) came due in
   * the background and fires on the return — inside the inactive window. The
   * app was active when the wait began, so "active" must be read AFTER the
   * film, not alongside it.
   */
  it('reads "active" after the film has gone, not when the wait began', async () => {
    state.answers = [true];
    const p = s.whenAdLayerMayStart();
    await settle();
    state.answers = [false]; // backgrounded mid-film, and now coming back
    state.getStateCalls = 0;
    state.introDone(); // the overdue cap timer fires, still inactive
    expect(await resolved(p)).toBe(false);
    state.listener?.({ isActive: true });
    expect(await resolved(p)).toBe(true);
  });
});

describe('the wiring', () => {
  const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

  it('main.ts counts the cold launch, stamps every hide and hands every return to the lifecycle first', () => {
    const main = read('../main.ts');
    expect(main).toMatch(/^void startColdSession\(\);$/m);
    expect(main).toMatch(/if \(document\.hidden\) \{\s*noteHidden\(\);\s*return;\s*\}\s*noteVisible\(\);\s*Ads\.foregrounded\(\);/);
  });

  it('the lifecycle resets nothing itself — no ad gap, no cadence, no daily cap', () => {
    const imports = read('./SessionLifecycle.ts')
      .split('\n')
      .filter((l) => l.startsWith('import '))
      .join('\n');
    expect(imports).toMatch(/core\/Session'/);
    expect(imports).not.toMatch(/Ads|Progress|monetization|Rate/);
  });
});
