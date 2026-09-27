/*
 * What a new session may NOT touch, across every module that listens for one.
 *
 * Ads.test.ts and Rate.test.ts pin what each listener resets; this pins what
 * none of them may: the counters Progress keeps in the save. A new session is
 * not a new day, and not an ad either —
 *
 *   - the daily rewarded cap (`rewardedToday` / `rewardedDay`) rolls over by
 *     the calendar, through `adRevealsLeft` and `applyDailyTopUp`;
 *   - the "every Nth win / attempt" cadence (`winsSinceAd` / `attemptsSinceAd`)
 *     goes back to zero when an interstitial shows, and at no other moment.
 *
 * So the real Progress, Ads and Rate are loaded together with the real
 * lifecycle, and a return after 30 minutes and a return across midnight are
 * driven through noteHidden/noteVisible, as main.ts does. The save must come
 * out of either exactly as it went in. The first test keeps the set of loaded
 * listeners honest: a module that starts listening for sessions has to be
 * loaded here too, or it fails.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { monetization } from '../config/monetization';
import { SESSION_GAP_MS } from '../core/Session';

const { disk } = vi.hoisted(() => ({ disk: new Map<string, string>() }));

vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
}));
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: ({ key }: { key: string }): Promise<{ value: string | null }> =>
      Promise.resolve({ value: disk.get(key) ?? null }),
    set: ({ key, value }: { key: string; value: string }): Promise<void> => {
      disk.set(key, value);
      return Promise.resolve();
    },
  },
}));
vi.mock('@capacitor-community/in-app-review', () => ({ InAppReview: { requestReview: vi.fn() } }));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: () => Promise.resolve({ display: 'granted' }),
    addListener: () => Promise.resolve({ remove: () => undefined }),
  },
}));
/* The ad SDK is never reached: nothing here initialises the ad layer. */
vi.mock('capacitor-levelplay-ads', () => ({ AdEvent: {}, LevelPlayAds: {} }));
vi.mock('./gameLoop', () => ({
  pauseGameLoop: () => {},
  resumeGameLoop: () => {},
  registerGame: () => {},
  gameLoopPaused: () => false,
}));
vi.mock('./Music', () => ({ Music: { stop: () => {}, start: () => {} } }));
vi.mock('./Audio', () => ({ Audio: { unlock: () => {} } }));

/** The key Progress writes under (private to it; see Progress.test.ts). */
const KEY = 'foldwing.save.v1';
const MIN = 60_000;
const CAP = monetization.economy.rewardedRevealsPerDay;

type Listener = () => void;
let page: Listener[] = [];
const doc = (): { hidden: boolean } => (globalThis as unknown as { document: { hidden: boolean } }).document;

let lifecycle: typeof import('./SessionLifecycle');

/** The fields under test, as the save holds them. */
type Counters = Pick<
  import('./Progress').SaveData,
  'rewardedToday' | 'rewardedDay' | 'winsSinceAd' | 'attemptsSinceAd'
>;
const counters = (d: Counters): Counters => ({
  rewardedToday: d.rewardedToday,
  rewardedDay: d.rewardedDay,
  winsSinceAd: d.winsSinceAd,
  attemptsSinceAd: d.attemptsSinceAd,
});

/**
 * A cold launch with every session listener in the app loaded, then a player
 * mid-cadence: two ad-paid reveals spent today, two wins and three attempts
 * since the last interstitial.
 */
async function launch() {
  disk.clear();
  disk.set(KEY, JSON.stringify({ version: 3, playDays: 4 }));
  vi.resetModules();
  lifecycle = await import('./SessionLifecycle');
  const { Progress } = await import('./Progress');
  await import('./Ads');
  await import('./Rate');
  await Progress.load();
  await lifecycle.startColdSession();
  expect(Progress.payAdReveals(2)).toBe(true);
  Progress.update({ winsSinceAd: 2, attemptsSinceAd: 3 });
  return Progress;
}

/** Background the app for `ms`, then bring it back; true when that started a new session. */
function away(ms: number): boolean {
  const leftAt = Date.now();
  doc().hidden = true;
  for (const fn of [...page]) fn();
  lifecycle.noteHidden();
  vi.setSystemTime(leftAt + ms);
  doc().hidden = false;
  for (const fn of [...page]) fn();
  return lifecycle.noteVisible();
}

/** The save as plain data, to compare whole. */
const snapshot = (d: object): unknown => JSON.parse(JSON.stringify(d));

beforeEach(() => {
  // Timers too: every launch leaves the old Progress a debounced write.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date(2026, 8, 22, 10, 0));
  page = [];
  (globalThis as unknown as { document: unknown }).document = {
    hidden: false,
    addEventListener: (event: string, fn: Listener) => {
      if (event === 'visibilitychange') page.push(fn);
    },
    removeEventListener: () => {},
  };
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  delete (globalThis as unknown as { document?: unknown }).document;
});

describe('a new session, across every listener', () => {
  it('is heard by Ads and Rate and nothing else — every listener is loaded here', () => {
    const src = fileURLToPath(new URL('..', import.meta.url));
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]
      );
    const listeners = files(src)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('SessionLifecycle.ts'))
      .filter((f) => /\bonSessionStart\s*\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(src, f).split('\\').join('/'))
      .sort();
    expect(listeners).toEqual(['systems/Ads.ts', 'systems/Rate.ts']);
  });

  it('leaves the daily rewarded cap and the every-Nth counters alone after 30 minutes away', async () => {
    const Progress = await launch();
    const before = snapshot(Progress.data);
    const kept = counters(Progress.data);
    expect(kept).toEqual({ rewardedToday: 2, rewardedDay: '2026-09-22', winsSinceAd: 2, attemptsSinceAd: 3 });

    expect(away(SESSION_GAP_MS + MIN)).toBe(true);
    expect(lifecycle.sessionNumber()).toBe(2);

    expect(counters(Progress.data)).toEqual(kept);
    // The same day: the two reveals the ads paid are still spent.
    expect(Progress.adRevealsLeft()).toBe(CAP - 2);
    // And nothing else in the save moved either: a session writes none of it.
    expect(snapshot(Progress.data)).toEqual(before);
  });

  it('leaves them alone on a return into a new day too: the day rolls over by the calendar', async () => {
    vi.setSystemTime(new Date(2026, 8, 22, 23, 58));
    const Progress = await launch();
    const before = snapshot(Progress.data);
    const kept = counters(Progress.data);

    expect(away(5 * MIN)).toBe(true); // 00:03 on the 23rd: a new session, by the midnight clause
    expect(counters(Progress.data)).toEqual(kept);
    expect(snapshot(Progress.data)).toEqual(before);

    // The cap is fresh because the calendar says so — yesterday's stamp — not
    // because the session touched it. The cadence carries straight on.
    expect(Progress.adRevealsLeft()).toBe(CAP);
    Progress.applyDailyTopUp(); // what main.ts runs after the lifecycle on every return
    expect(Progress.data.winsSinceAd).toBe(2);
    expect(Progress.data.attemptsSinceAd).toBe(3);
    expect(Progress.data.rewardedToday).toBe(2);
    expect(Progress.data.rewardedDay).toBe('2026-09-22');
  });
});
