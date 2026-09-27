/*
 * The automatic review prompt: one per app version, at a peak, and the moments
 * it must stay out of.
 *
 * Apple allows three prompts in 365 days and says nothing about whether one
 * showed, so each version's ask is spent blind. The rules are pinned as pure
 * logic first (shouldAskAt), then through the service against a real save, so
 * what the service gathers — the version, the play days, the session's skips
 * and purchases — is tested too. The permission alert case lives in
 * Nudges.test.ts, next to the alert.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { monetization } from '../config/monetization';
import { SESSION_GAP_MS } from '../core/Session';
import {
  isPeak,
  RATE_RULES,
  shouldAskAt,
  type RateContext,
  type RateMoment,
  type RateWin,
} from './Rate';

const native = vi.hoisted(() => ({ on: true }));
const review = vi.hoisted(() => ({ requestReview: vi.fn() }));
const { disk } = vi.hoisted(() => ({ disk: new Map<string, string>() }));
vi.mock('@capacitor-community/in-app-review', () => ({ InAppReview: review }));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: () => Promise.resolve({ display: 'granted' }),
    addListener: () => Promise.resolve({ remove: () => undefined }),
  },
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
vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  Capacitor: { isNativePlatform: () => native.on, getPlatform: () => 'ios' },
}));

/** The key Progress writes under (private to it; see Progress.test.ts). */
const KEY = 'foldwing.save.v1';

/** This build's version, as vite.config.ts defines it for every run. */
const VERSION = import.meta.env.VITE_APP_VERSION ?? '';

/** A first-try medal on level 21: the plainest peak there is. */
const MEDAL: RateWin = { levelIndex: 20, medal: true, todayDailyFirst: false, streakAfter: 0, attempts: 1 };

/** Today's Daily, first finish, taking the streak to three. */
const DAILY: RateWin = { levelIndex: null, medal: false, todayDailyFirst: true, streakAfter: 3, attempts: 2 };

const at = (win: RateWin, extra: Partial<RateMoment> = {}): RateMoment => ({ adWillShow: false, win, ...extra });

/** A player who may be asked: second day, nothing spent on this version, nothing in the way. */
const READY: RateContext = { version: '1.4', promptedVersion: '', playDays: 2, skipped: false, purchased: false };

describe('isPeak', () => {
  it('is a medal from level 10 on, and nothing short of it', () => {
    expect(isPeak({ ...MEDAL, levelIndex: RATE_RULES.medalFromIndex })).toBe(true);
    expect(isPeak({ ...MEDAL, levelIndex: 9 })).toBe(true);
    // Level 9 and the tutorial: the player has not chosen the game yet.
    expect(isPeak({ ...MEDAL, levelIndex: 8 })).toBe(false);
    expect(isPeak({ ...MEDAL, levelIndex: 0 })).toBe(false);
    // A clear without the medal, however late, is an ordinary win.
    expect(isPeak({ ...MEDAL, levelIndex: 250, medal: false })).toBe(false);
  });

  it("is today's first Daily finish taking the streak to three or more", () => {
    expect(isPeak(DAILY)).toBe(true);
    expect(isPeak({ ...DAILY, streakAfter: 40 })).toBe(true);
    expect(isPeak({ ...DAILY, streakAfter: 2 })).toBe(false);
    // A streak that did not move (a replay says 0), a replay, and yesterday's
    // fold finished after midnight are not it.
    expect(isPeak({ ...DAILY, streakAfter: 0 })).toBe(false);
    expect(isPeak({ ...DAILY, todayDailyFirst: false, streakAfter: 5 })).toBe(false);
  });

  it('never takes a medal on the Daily for one', () => {
    expect(isPeak({ ...DAILY, medal: true, streakAfter: 1 })).toBe(false);
  });
});

describe('shouldAskAt', () => {
  it('asks at a peak, for a player who may be asked', () => {
    expect(shouldAskAt(at(MEDAL), READY)).toBe(true);
    expect(shouldAskAt(at(DAILY), READY)).toBe(true);
    expect(shouldAskAt(at(MEDAL, { quiet: false }), READY)).toBe(true);
  });

  it('asks nowhere else', () => {
    expect(shouldAskAt(at({ ...MEDAL, medal: false }), READY)).toBe(false);
    expect(shouldAskAt(at({ ...DAILY, streakAfter: 2 }), READY)).toBe(false);
  });

  it('once per version: an ask spent on an older one, or by a build before 1.4, leaves this one', () => {
    expect(shouldAskAt(at(MEDAL), { ...READY, promptedVersion: '1.4' })).toBe(false);
    expect(shouldAskAt(at(MEDAL), { ...READY, promptedVersion: '1.3' })).toBe(true);
    // '' is what a pre-1.4 save with ratePrompted: true reads as.
    expect(shouldAskAt(at(MEDAL), { ...READY, promptedVersion: '' })).toBe(true);
    expect(shouldAskAt(at(MEDAL), { ...READY, version: '1.5', promptedVersion: '1.4' })).toBe(true);
  });

  it('never in a build that cannot name its version', () => {
    expect(shouldAskAt(at(MEDAL), { ...READY, version: '', promptedVersion: '' })).toBe(false);
  });

  it('never on the first play day', () => {
    expect(shouldAskAt(at(MEDAL), { ...READY, playDays: 0 })).toBe(false);
    expect(shouldAskAt(at(MEDAL), { ...READY, playDays: 1 })).toBe(false);
    expect(shouldAskAt(at(MEDAL), { ...READY, playDays: RATE_RULES.fromPlayDay })).toBe(true);
  });

  it('never after a struggle: six strokes on the level, the winning one included', () => {
    expect(shouldAskAt(at({ ...MEDAL, attempts: 5 }), READY)).toBe(true);
    expect(shouldAskAt(at({ ...MEDAL, attempts: 6 }), READY)).toBe(false);
    expect(shouldAskAt(at({ ...DAILY, attempts: 9 }), READY)).toBe(false);
    // The same number the rescue ladder offers the skip at.
    expect(RATE_RULES.struggleAttempts).toBe(monetization.reveals.offerSkipAfterAttempts);
  });

  it('never in a session with a skip or a purchase in it', () => {
    expect(shouldAskAt(at(MEDAL), { ...READY, skipped: true })).toBe(false);
    expect(shouldAskAt(at(DAILY), { ...READY, purchased: true })).toBe(false);
  });

  it('stands down for an interstitial or the card’s own ask', () => {
    expect(shouldAskAt(at(MEDAL, { adWillShow: true }), READY)).toBe(false);
    expect(shouldAskAt(at(MEDAL, { quiet: true }), READY)).toBe(false);
  });
});

/*
 * The service, against a real save on a fake disk.
 */

/**
 * The smallest `document` the modules under test need — the suite runs in node.
 */
type Listener = () => void;
let visibility: Listener[] = [];
const doc = (): { hidden: boolean } => (globalThis as unknown as { document: { hidden: boolean } }).document;

/** The session lifecycle the current launch's Rate listens to. */
let lifecycle: typeof import('./SessionLifecycle');

/**
 * Background the app for `seconds`, then bring it back — through the page's
 * listeners and the session lifecycle, as main.ts's handler drives it.
 */
function away(seconds: number): void {
  const leftAt = Date.now();
  doc().hidden = true;
  for (const fn of [...visibility]) fn();
  lifecycle.noteHidden();
  vi.setSystemTime(leftAt + seconds * 1000);
  doc().hidden = false;
  for (const fn of [...visibility]) fn();
  lifecycle.noteVisible();
}

/** A cold launch onto `stored` (a save as some build wrote it), with fresh singletons. */
async function launch(stored: Record<string, unknown> = {}) {
  disk.set(KEY, JSON.stringify({ version: 3, ...stored }));
  vi.resetModules();
  const { Rate } = await import('./Rate');
  const { Progress } = await import('./Progress');
  lifecycle = await import('./SessionLifecycle');
  await Progress.load();
  return { Rate, Progress };
}

/** The app's one session rule, in seconds. */
const AWAY = SESSION_GAP_MS / 1000;

/** A save that has been played on an earlier day. */
const SEASONED = { playDays: 4 };

beforeEach(() => {
  /*
   * The clock is fake from the start, timers included. Every launch leaves the
   * old Progress a debounced write 250ms out; on a real timer it lands on the
   * next test's disk after that test has written its save, and a version spent
   * one test ago comes back.
   */
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date(2026, 8, 22, 10, 0));
  native.on = true;
  disk.clear();
  review.requestReview.mockReset();
  review.requestReview.mockResolvedValue(undefined);
  visibility = [];
  (globalThis as unknown as { document: unknown }).document = {
    hidden: false,
    addEventListener: (event: string, fn: Listener) => {
      if (event === 'visibilitychange') visibility.push(fn);
    },
    removeEventListener: () => {},
  };
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  delete (globalThis as unknown as { document?: unknown }).document;
});

describe('the version', () => {
  it('is the Xcode project’s marketing version, which the Settings footer shows too', () => {
    const pbx = readFileSync(
      fileURLToPath(new URL('../../ios/App/App.xcodeproj/project.pbxproj', import.meta.url)),
      'utf8'
    );
    const first = /\bMARKETING_VERSION = "?([^";\s]+)"?;/.exec(pbx);
    expect(first).not.toBeNull();
    expect(VERSION).toBe(first?.[1]);
  });
});

describe('Rate', () => {
  it('asks once on this version, and spends it for older builds too', async () => {
    const { Rate, Progress } = await launch(SEASONED);
    expect(Rate.shouldAsk(at(MEDAL))).toBe(true);
    await Rate.ask();
    expect(review.requestReview).toHaveBeenCalledTimes(1);
    expect(Progress.data.ratePromptedVersion).toBe(VERSION);
    expect(Progress.data.ratePrompted).toBe(true);
    expect(Rate.shouldAsk(at(MEDAL))).toBe(false);
    expect(Rate.shouldAsk(at(DAILY))).toBe(false);
  });

  it('keeps the version spent across a relaunch', async () => {
    const first = await launch(SEASONED);
    await first.Rate.ask();
    await first.Progress.flush();
    const { Rate } = await launch(JSON.parse(disk.get(KEY) ?? '{}') as Record<string, unknown>);
    expect(Rate.shouldAsk(at(MEDAL))).toBe(false);
  });

  it('gives 1.4 its ask when a build before it spent the old lifetime one', async () => {
    const { Rate } = await launch({ ...SEASONED, ratePrompted: true });
    expect(Rate.shouldAsk(at(MEDAL))).toBe(true);
  });

  it('waits for the second day the game is played on', async () => {
    const { Rate, Progress } = await launch();
    expect(Progress.data.playDays).toBe(1);
    expect(Rate.shouldAsk(at(MEDAL))).toBe(false);

    // Later the same day is still the first.
    Progress.markSeen(new Date(2026, 8, 22, 22, 0));
    expect(Rate.shouldAsk(at(MEDAL))).toBe(false);

    Progress.markSeen(new Date(2026, 8, 23, 8, 0));
    expect(Progress.data.playDays).toBe(2);
    expect(Rate.shouldAsk(at(MEDAL))).toBe(true);
  });

  it('stands down for the rest of a session with a purchase in it', async () => {
    const { Rate, Progress } = await launch(SEASONED);
    // What the game gives away is not a purchase.
    Progress.grantReveals(1, 'daily');
    Progress.payAdReveals(1);
    expect(Rate.shouldAsk(at(MEDAL))).toBe(true);

    Progress.grantReveals(5, 'purchase');
    expect(Rate.shouldAsk(at(MEDAL))).toBe(false);
    expect(Rate.shouldAsk(at(DAILY))).toBe(false);
  });

  it('hears an Ask to Buy approval that lands later as a purchase too', async () => {
    const { Rate, Progress } = await launch(SEASONED);
    Progress.setAdsRemoved(true, 'late-purchase');
    expect(Rate.shouldAsk(at(MEDAL))).toBe(false);
  });

  it('stands down for the rest of a session with a skip in it', async () => {
    const { Rate, Progress } = await launch(SEASONED);
    Progress.unlockThrough(30, 300);
    expect(Progress.skipsSinceLaunch).toBe(1);
    expect(Rate.shouldAsk(at(MEDAL))).toBe(false);
  });

  it('forgets the skip and the purchase once a new session begins', async () => {
    const { Rate, Progress } = await launch(SEASONED);
    Progress.unlockThrough(30, 300);
    Progress.grantReveals(5, 'purchase');

    // A glance at another app is the same session…
    away(AWAY - 1);
    expect(Rate.shouldAsk(at(MEDAL))).toBe(false);

    // …half an hour away is a new one.
    away(AWAY);
    expect(Rate.shouldAsk(at(MEDAL))).toBe(true);

    // And a skip in the new session counts in it.
    Progress.unlockThrough(31, 300);
    expect(Rate.shouldAsk(at(MEDAL))).toBe(false);
  });

  it('forgets them on a return into a new day, after five minutes away', async () => {
    vi.setSystemTime(new Date(2026, 8, 22, 23, 58));
    const { Rate, Progress } = await launch(SEASONED);
    Progress.grantReveals(5, 'purchase');
    Progress.unlockThrough(30, 300);
    expect(Rate.shouldAsk(at(MEDAL))).toBe(false);

    away(5 * 60); // 00:03 on the 23rd
    expect(Rate.shouldAsk(at(MEDAL))).toBe(true);
  });

  it('measures the absence from the first hide, not the last', async () => {
    const { Rate, Progress } = await launch(SEASONED);
    Progress.grantReveals(5, 'purchase');
    doc().hidden = true;
    lifecycle.noteHidden();
    vi.setSystemTime(Date.now() + 29 * 60_000);
    lifecycle.noteHidden(); // iOS reports one departure twice
    vi.setSystemTime(Date.now() + 2 * 60_000);
    doc().hidden = false;
    lifecycle.noteVisible();
    expect(Rate.shouldAsk(at(MEDAL))).toBe(true);
  });

  /*
   * The cold launch is the session Rate was born into, so its announcement
   * erases nothing: a skip or a purchase already heard in this launch stays in
   * it. Moot with today's boot order (main.ts announces the cold session before
   * anything can be bought or skipped), and pinned so it stays moot if that
   * order ever changes.
   */
  it('forgets nothing at the cold launch’s own announcement', async () => {
    const bought = await launch(SEASONED);
    bought.Progress.grantReveals(5, 'purchase');
    await lifecycle.startColdSession();
    expect(bought.Rate.shouldAsk(at(MEDAL))).toBe(false);

    const skipped = await launch(SEASONED);
    skipped.Progress.unlockThrough(30, 300);
    await lifecycle.startColdSession();
    expect(skipped.Rate.shouldAsk(at(MEDAL))).toBe(false);
  });

  it('stands down when the card already asks for something, spending nothing', async () => {
    const { Rate, Progress } = await launch(SEASONED);
    expect(Rate.shouldAsk(at(MEDAL, { quiet: true }))).toBe(false);
    expect(Rate.shouldAsk(at(MEDAL, { adWillShow: true }))).toBe(false);
    expect(Progress.data.ratePromptedVersion).toBe('');
    expect(Rate.shouldAsk(at(MEDAL))).toBe(true);
  });

  it('never asks off the phone', async () => {
    const { Rate } = await launch(SEASONED);
    native.on = false;
    expect(Rate.shouldAsk(at(MEDAL))).toBe(false);
  });
});
