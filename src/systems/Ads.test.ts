import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Ads is a state machine, and `monetization.test.ts` only pins the numbers it
 * reads. That gap is real: deleting the time-floor line from `timingAllows`
 * leaves every constant assertion green while the shipped game starts putting
 * an interstitial on screen every twenty seconds on a level someone is stuck
 * on — the exact pattern ad networks disable ad serving over.
 *
 * So this file drives the machine instead of the constants. The PROVIDER is
 * faked, the clock is ours, and each test builds a fresh AdsService so the
 * session counters start where the assertions think they do.
 *
 * The provider — not the LevelPlay plugin — is what these tests stand on. The
 * policy is network-agnostic, and a harness built around one SDK's method
 * names and event strings is exactly what had to be thrown away when AdMob
 * went. What the provider itself does with the plugin is pinned separately, in
 * providers/levelplay.test.ts.
 */

type Reason = 'closed' | 'failed' | 'timeout' | 'cancelled';
type Consent = 'pending' | 'granted' | 'withheld';

const stub = vi.hoisted(() => {
  /*
   * Every dismissal watcher the policy layer has attached and not yet seen end.
   * A real provider's watcher ends on a close, a failed present, its own
   * timeout or a cancel — and remembers which. This one does the same, so the
   * three rewarded outcomes are decided by the policy code under test, not by
   * the double.
   */
  const open: ((reason: Reason) => void)[] = [];
  const watch = (_format: string, timeoutMs: number) => {
    let why: Reason | null = null;
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    const finish = (reason: Reason): void => {
      if (why) return;
      why = reason;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    open.push(finish);
    return { done, cancel: () => finish('cancelled'), reason: () => why };
  };
  /** End every open watcher, the way a native close or failed present would. */
  const dismiss = (reason: Reason = 'closed'): void => {
    for (const finish of open.splice(0)) finish(reason);
  };
  /**
   * Dismiss once the current show() has returned — a microtask, not a timer,
   * because the whole suite runs under fake timers and most tests never
   * advance them.
   */
  const dismissSoon = (reason: Reason = 'closed'): void => {
    void Promise.resolve().then(() => dismiss(reason));
  };

  /*
   * The happy path by default: the SDK comes up, every load fills, the
   * interstitial presents and the player closes it, the rewarded ad pays and
   * closes. Tests that want a sadder outcome replace one method.
   */
  const fresh = () => ({
    init: vi.fn(async (): Promise<void> => {}),
    retryInit: vi.fn((): void => {}),
    bannerShow: vi.fn(async (): Promise<void> => {}),
    bannerResume: vi.fn(async (): Promise<void> => {}),
    bannerHide: vi.fn(async (): Promise<void> => {}),
    bannerRemove: vi.fn(async (): Promise<void> => {}),
    loadInterstitial: vi.fn(async (): Promise<boolean> => true),
    showInterstitial: vi.fn(async (): Promise<boolean | null> => {
      dismissSoon('closed');
      return true;
    }),
    loadRewarded: vi.fn(async (): Promise<boolean> => true),
    showRewarded: vi.fn(async (): Promise<unknown | null> => {
      dismissSoon('closed');
      return { rewardName: 'reveal', rewardAmount: 1 };
    }),
    watchDismissal: vi.fn(watch),
  });

  const spies = fresh();
  const state = { platform: 'ios', consent: 'granted' as Consent, sdkUp: true };
  /** Everyone who subscribed through onReady — fired by a test to say "the SDK came up". */
  const readyListeners: (() => void)[] = [];
  const sdkComesUp = (): void => {
    state.sdkUp = true;
    for (const cb of readyListeners) cb();
  };

  const provider = {
    id: 'fake ADMODE:test ADS:on',
    testing: false,
    supports: (): boolean => true,
    consentState: (): Consent => state.consent,
    rewardedReady: (): boolean => true,
    sdkReady: (): boolean => state.sdkUp,
    onReady: (cb: () => void): void => {
      readyListeners.push(cb);
    },
    resolvesOnPresent: (format: string): boolean => format === 'interstitial',
    // Forwarders rather than the spies themselves, so `reset` can swap in
    // fresh spies without the code under test holding the previous test's.
    init: () => spies.init(),
    retryInit: () => spies.retryInit(),
    bannerShow: () => spies.bannerShow(),
    bannerResume: () => spies.bannerResume(),
    bannerHide: () => spies.bannerHide(),
    bannerRemove: () => spies.bannerRemove(),
    loadInterstitial: () => spies.loadInterstitial(),
    showInterstitial: () => spies.showInterstitial(),
    loadRewarded: () => spies.loadRewarded(),
    showRewarded: () => spies.showRewarded(),
    watchDismissal: (format: string, timeoutMs: number) => spies.watchDismissal(format, timeoutMs),
  };

  const openPrivacyOptions = vi.fn(async (): Promise<void> => {});
  /**
   * The ad layer's starter gate (SessionLifecycle.whenAdLayerMayStart): open by
   * default; a test that holds it shut proves a route waits for it.
   */
  const gate = vi.fn((): Promise<void> => Promise.resolve());
  const pluginCalls: string[] = [];
  const loop = { pause: vi.fn(), resume: vi.fn() };
  const music = { stop: vi.fn(), start: vi.fn() };
  const audio = { unlock: vi.fn() };

  const reset = (): void => {
    open.length = 0;
    Object.assign(spies, fresh());
    state.platform = 'ios';
    state.consent = 'granted';
    state.sdkUp = true;
    readyListeners.length = 0;
    openPrivacyOptions.mockReset();
    gate.mockReset();
    gate.mockImplementation(() => Promise.resolve());
    pluginCalls.length = 0;
    for (const s of [loop.pause, loop.resume, music.stop, music.start, audio.unlock]) s.mockClear();
  };

  return {
    spies,
    state,
    provider,
    sdkComesUp,
    dismiss,
    dismissSoon,
    openPrivacyOptions,
    gate,
    pluginCalls,
    loop,
    music,
    audio,
    reset,
  };
});

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: (): boolean => stub.state.platform !== 'web',
    getPlatform: (): string => stub.state.platform,
  },
}));

/*
 * The plugin itself. Nothing in the policy layer may ever reach it — every
 * call goes through the provider — so every method here is a tripwire that
 * records its name. It still has to exist: providers/levelplay.ts is loaded
 * for real below, for its per-platform `levelplayConfigured()` rule.
 */
vi.mock('capacitor-levelplay-ads', () => ({
  AdEvent: {},
  LevelPlayAds: new Proxy(
    {},
    {
      get: (_target, name) => {
        // Only method lookups are tripwires; `then` and symbols are the
        // runtime probing the object, not the code under test calling it.
        if (typeof name !== 'string' || name === 'then') return undefined;
        return (): Promise<never> => {
          stub.pluginCalls.push(name);
          return Promise.reject(new Error(`plugin reached from the policy layer: ${name}`));
        };
      },
    }
  ),
}));

vi.mock('./providers/levelplay', async (importOriginal) => {
  const real = await importOriginal<typeof import('./providers/levelplay')>();
  return {
    ...real,
    levelplayProvider: stub.provider,
    openPrivacyOptions: () => stub.openPrivacyOptions(),
  };
});

/*
 * The session service is REAL — the new-session tests below go through the
 * app's one rule, exactly as main.ts drives it — except the starter gate,
 * which is the film and the app state, neither of which exists here. It is
 * pinned on its own in SessionLifecycle.test.ts.
 */
vi.mock('./SessionLifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./SessionLifecycle')>()),
  whenAdLayerMayStart: () => stub.gate(),
}));

vi.mock('./gameLoop', () => ({
  pauseGameLoop: () => stub.loop.pause(),
  resumeGameLoop: () => stub.loop.resume(),
  registerGame: () => {},
}));
vi.mock('./Music', () => ({ Music: { stop: () => stub.music.stop(), start: () => stub.music.start() } }));
vi.mock('./Audio', () => ({ Audio: { unlock: () => stub.audio.unlock() } }));

import { monetization } from '../config/monetization';
import { SESSION_GAP_MS } from '../core/Session';

const A = monetization.ads;
/** The app's one session rule: this long away, and the return is a new session. */
const AWAY = SESSION_GAP_MS / 1000;

/** A level well past the onboarding grace, so only timing is under test. */
const PLAYING = A.interstitialFromLevel + 20;

/** How long Ads waits for a reward that trails its close (REWARD_AFTER_CLOSE_MS). */
const REWARD_GRACE_MS = 800;
/** Ads' ceiling on a full-screen ad the player is still looking at (AD_SHOW_TIMEOUT_MS). */
const SHOW_CEILING_MS = 180_000;

/*
 * These tests describe a NORMAL ads-on build unless a block says otherwise,
 * and have to say so: `Ads.ts` picks its provider from VITE_ADS when it is
 * imported and reads VITE_ADS again at call time, and the release chains run
 * this suite with the build-mode variables EXPORTED — `ios:sync:adsoff` runs it
 * under VITE_ADS=off, `ios:appstore` under VITE_AD_MODE=live. Left to the
 * process env, stage 2 of exactly those chains would fail here. So the import
 * is taken only after the env is pinned.
 */
function pinNormalBuild(): void {
  vi.stubEnv('VITE_ADS', '');
  vi.stubEnv('VITE_AD_MODE', '');
}

let AdsService: typeof import('./Ads').AdsService;
let adsSupported: typeof import('./Ads').adsSupported;
/** The same module instance Ads listens to — imported after the reset, like Ads. */
let lifecycle: typeof import('./SessionLifecycle');

beforeAll(async () => {
  pinNormalBuild();
  vi.resetModules();
  ({ AdsService, adsSupported } = await import('./Ads'));
  lifecycle = await import('./SessionLifecycle');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

/**
 * Seconds since the session began, as an absolute wall clock.
 *
 * Every gate in Ads reads Date.now(), so the tests move the clock rather than
 * sleeping. The epoch is arbitrary but must be a plausible one: a zero clock
 * would make `now - lastInterstitialAt` pass the floor for free.
 */
const T0 = Date.parse('2026-08-08T10:00:00Z');
const at = (seconds: number): void => {
  vi.setSystemTime(T0 + seconds * 1000);
};

let ads: InstanceType<typeof AdsService>;

/**
 * The smallest `document` that `watchVisibility` needs.
 *
 * The suite runs in the node environment (see vite.config.ts — everything under
 * test is pure math and Phaser is never imported), so there is no DOM to
 * background. Sending the real event through the real listener is worth the
 * eight lines: the alternative is a test that asserts against a copy of the
 * rule rather than the rule.
 */
type VisibilityListener = () => void;
let visibilityListeners: VisibilityListener[] = [];

function installDocumentStub(): void {
  visibilityListeners = [];
  (globalThis as unknown as { document: unknown }).document = {
    hidden: false,
    addEventListener: (event: string, fn: VisibilityListener) => {
      if (event === 'visibilitychange') visibilityListeners.push(fn);
    },
    removeEventListener: () => {},
  };
}

const doc = (): { hidden: boolean } =>
  (globalThis as unknown as { document: { hidden: boolean } }).document;

/**
 * Send the app to the background, or bring it back, through the real
 * listener — and then tell the session lifecycle, as main.ts's handler does
 * (registered after Ads', so it runs after it).
 */
const setHidden = (hidden: boolean): void => {
  doc().hidden = hidden;
  for (const fn of [...visibilityListeners]) fn();
  if (hidden) lifecycle.noteHidden();
  else lifecycle.noteVisible();
};

/** Background the app for `seconds`, then bring it back. */
const away = (seconds: number): void => {
  const leftAt = Date.now();
  setHidden(true);
  vi.setSystemTime(leftAt + seconds * 1000);
  setHidden(false);
};

/** Let a fire-and-forget call (`void this.hideBanner()`) run to its end. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

beforeEach(() => {
  pinNormalBuild();
  stub.reset();
  vi.useFakeTimers();
  at(0);
  installDocumentStub();
  // A fresh process: no pause on record, no listener from the last test.
  lifecycle.__resetSessionLifecycleForTests();
  // Constructed after the clock is set: the constructor starts the session.
  ads = new AdsService();
});

afterEach(() => {
  // Whatever a test left on screen, nothing may leak into the next one.
  stub.dismiss('cancelled');
  vi.useRealTimers();
  delete (globalThis as unknown as { document?: unknown }).document;
  // No test in this file may reach the plugin, whatever it was about.
  expect(stub.pluginCalls).toEqual([]);
});

describe('the interstitial gate', () => {
  it('never interrupts a player still learning the mirror', () => {
    at(A.sessionWarmupSeconds + 600);

    // Counters deliberately absurd: the onboarding grace outranks all of them.
    for (let level = 0; level < A.interstitialFromLevel; level += 1) {
      expect(ads.wouldShowInterstitial(level, 999)).toBe(false);
      expect(ads.wouldShowOnAttempt(level, 999)).toBe(false);
    }

    expect(
      ads.wouldShowInterstitial(A.interstitialFromLevel, A.interstitialEveryNWins)
    ).toBe(true);
  });

  it('stays quiet through the warm-up however many wins land in it', () => {
    at(A.sessionWarmupSeconds - 1);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);
    expect(ads.wouldShowOnAttempt(PLAYING, 999)).toBe(false);

    at(A.sessionWarmupSeconds);
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);
  });

  /*
   * The warm-up protects the opening of a SESSION, and a session begins when
   * the SDK is ready — which is after the opening film AND after the player has
   * answered the consent questions, so the object exists well before there is
   * anything to serve.
   */
  it('dates the warm-up from the SDK being ready, not from construction', async () => {
    at(60);
    await ads.init();

    at(60 + A.sessionWarmupSeconds - 1);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);

    at(60 + A.sessionWarmupSeconds);
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);
  });

  it('wants the wins as well as the clock', () => {
    at(A.sessionWarmupSeconds + 10);
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins - 1)).toBe(false);
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);
  });

  /*
   * THE test. Every other gate has a counter behind it that a player can only
   * move so fast; this one is the brake that holds when the counters are
   * satisfied. Delete the last line of `timingAllows` and the middle assertion
   * below flips to true.
   */
  it('refuses a second interstitial until the time floor has elapsed', async () => {
    const firstAt = A.sessionWarmupSeconds + 5;
    at(firstAt);
    expect(await ads.showInterstitial()).toBe(true);

    at(firstAt + A.minSecondsBetweenInterstitials - 1);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);
    expect(ads.wouldShowOnAttempt(PLAYING, 999)).toBe(false);

    at(firstAt + A.minSecondsBetweenInterstitials);
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);
    expect(ads.wouldShowOnAttempt(PLAYING, A.interstitialEveryNAttempts)).toBe(true);
  });

  it('caps the session however long somebody plays', async () => {
    let t = A.sessionWarmupSeconds;
    for (let i = 0; i < A.maxInterstitialsPerSession; i += 1) {
      at(t);
      expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);
      expect(await ads.showInterstitial()).toBe(true);
      t += A.minSecondsBetweenInterstitials;
    }

    // An hour later, with the floor long gone, the cap still holds.
    at(t + 3600);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);
    expect(ads.wouldShowOnAttempt(PLAYING, 999)).toBe(false);
  });

  it('stands down after a rewarded view the player volunteered for', async () => {
    const watchedAt = A.sessionWarmupSeconds + 10;
    at(watchedAt);
    expect(await ads.showRewarded('reveal')).toBe('earned');

    at(watchedAt + A.muteAfterRewardedSeconds - 1);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);

    at(watchedAt + A.muteAfterRewardedSeconds);
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);
  });

  it('does not hand out the mute for a rewarded ad the player backed out of', async () => {
    // Closed, and the reward never comes: the provider's show never settles.
    stub.spies.showRewarded.mockImplementationOnce(() => {
      stub.dismissSoon('closed');
      return new Promise(() => {});
    });

    at(A.sessionWarmupSeconds + 10);
    const pending = ads.showRewarded('reveal');
    await vi.advanceTimersByTimeAsync(REWARD_GRACE_MS);
    expect(await pending).toBe('declined');
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);
  });
});

describe('the retry path', () => {
  it('will not fire on the attempt count alone', async () => {
    const firstAt = A.sessionWarmupSeconds;
    at(firstAt);
    expect(await ads.showInterstitial()).toBe(true);

    // Thirty seconds and a hundred attempts later — the count says yes, and
    // the count is only ever a permission.
    at(firstAt + 30);
    expect(ads.wouldShowOnAttempt(PLAYING, 100)).toBe(false);

    // And the clock alone is not enough either.
    at(firstAt + A.minSecondsBetweenInterstitials);
    expect(ads.wouldShowOnAttempt(PLAYING, A.interstitialEveryNAttempts - 1)).toBe(false);
    expect(ads.wouldShowOnAttempt(PLAYING, A.interstitialEveryNAttempts)).toBe(true);
  });

  /*
   * The scenario the whole placement was designed against: someone genuinely
   * stuck, dying as fast as the game can restart. A failure here lasts three
   * seconds at the very fastest, so twenty minutes of that is four hundred
   * attempts — eighty ads if the count were honoured on its own.
   */
  it('holds instant repeated failures to the floor and the session cap', async () => {
    const FASTEST_FAIL_SECONDS = 3;
    const firedAt: number[] = [];
    let attemptsSinceAd = 0;

    for (
      let t = A.sessionWarmupSeconds;
      t <= A.sessionWarmupSeconds + 20 * 60;
      t += FASTEST_FAIL_SECONDS
    ) {
      at(t);
      attemptsSinceAd += 1;
      if (!ads.wouldShowOnAttempt(PLAYING, attemptsSinceAd)) continue;

      expect(await ads.showInterstitial()).toBe(true);
      firedAt.push(t);
      attemptsSinceAd = 0;
    }

    expect(firedAt.length).toBeGreaterThan(0);
    expect(firedAt.length).toBeLessThanOrEqual(A.maxInterstitialsPerSession);
    for (let i = 1; i < firedAt.length; i += 1) {
      // The floor is not one number any more — it tightens once the session is
      // a long one. Each gap is held to whichever floor was in force when the
      // later ad fired.
      const floor =
        firedAt[i] >= A.longSessionAfterSeconds
          ? A.lateSecondsBetweenInterstitials
          : A.minSecondsBetweenInterstitials;
      expect(firedAt[i] - firedAt[i - 1]).toBeGreaterThanOrEqual(floor);
    }
  });
});

/*
 * The session ladder. One flat interval cannot serve both ends of a session:
 * early frequency is the strongest correlate of someone closing the app for
 * good, and the same interval half an hour in leaves the most engaged players
 * unmonetised. These pin the shape rather than the numbers.
 */
describe('the session ladder', () => {
  it('shows nothing at all while the session is young', () => {
    at(A.sessionWarmupSeconds - 1);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);
    expect(ads.wouldShowOnAttempt(PLAYING, 999)).toBe(false);

    at(A.sessionWarmupSeconds + 1);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(true);
  });

  it('spaces them wider early than it does deep into a long sitting', async () => {
    at(A.sessionWarmupSeconds + 1);
    expect(await ads.showInterstitial()).toBe(true);

    // Early: the late (tighter) floor is not enough.
    at(A.sessionWarmupSeconds + 1 + A.lateSecondsBetweenInterstitials);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);
    at(A.sessionWarmupSeconds + 1 + A.minSecondsBetweenInterstitials);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(true);
    expect(await ads.showInterstitial()).toBe(true);

    // Past the long-session mark the tighter floor is the one that applies.
    const late = A.longSessionAfterSeconds + A.lateSecondsBetweenInterstitials;
    at(late);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(true);
  });

  it('never lets the late floor outrun the early one', () => {
    expect(A.lateSecondsBetweenInterstitials).toBeLessThanOrEqual(
      A.minSecondsBetweenInterstitials
    );
    expect(A.longSessionAfterSeconds).toBeGreaterThan(A.sessionWarmupSeconds);
  });

  /*
   * "Session" used to mean the lifetime of the process: a phone that sat in a
   * pocket all afternoon came back with the per-session cap already spent and
   * showed nothing until it was force-quit, while someone who glanced at a
   * message lost their warm-up grace.
   */
  it('starts a new session after a real absence, and not after a glance', () => {
    at(A.sessionWarmupSeconds + 10);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(true);

    away(AWAY - 60);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(true);

    away(AWAY + 60);
    // Back from a real absence: the warm-up is armed again.
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);
  });

  it('gives a new session a fresh cap, and a glance does not', async () => {
    let t = A.sessionWarmupSeconds;
    for (let i = 0; i < A.maxInterstitialsPerSession; i += 1) {
      at(t);
      expect(await ads.showInterstitial()).toBe(true);
      t += A.minSecondsBetweenInterstitials;
    }
    at(t);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);

    away(AWAY - 60);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false); // still spent

    away(AWAY);
    const back = t + (AWAY - 60) + AWAY;
    at(back + A.sessionWarmupSeconds);
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);
  });
});

/*
 * The app's one rule (core/Session) also says a return into a NEW DAY is a new
 * session, however short the pause — and that what is not per session stays
 * put: the rewarded mute and the floor since the last ad are real elapsed time.
 */
describe('a new session, as the app defines it', () => {
  /** Seconds from T0 to a local wall time on T0's day (Europe/Belgrade in this suite). */
  const localAt = (hours: number, minutes: number): number =>
    (new Date(2026, 7, 8, hours, minutes).getTime() - T0) / 1000;

  it('re-arms the warm-up on a return into a new day, after five minutes away', () => {
    const lateNight = localAt(23, 58);
    at(lateNight);
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);

    away(5 * 60); // back at 00:03: a new day, so a new session
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);
    at(lateNight + 5 * 60 + A.sessionWarmupSeconds);
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);
  });

  it('gives a return into a new day a fresh cap', async () => {
    let t = A.sessionWarmupSeconds;
    for (let i = 0; i < A.maxInterstitialsPerSession; i += 1) {
      at(t);
      expect(await ads.showInterstitial()).toBe(true);
      t += A.minSecondsBetweenInterstitials;
    }
    const lateNight = localAt(23, 58);
    at(lateNight);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false); // spent

    away(5 * 60);
    at(lateNight + 5 * 60 + A.sessionWarmupSeconds);
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);
  });

  it('keeps the mute after a rewarded ad across a new session', async () => {
    const watchedAt = localAt(23, 59);
    at(watchedAt);
    expect(await ads.showRewarded('reveal')).toBe('earned');

    away(60); // 00:00: a new day, a new session, the warm-up starts over
    at(watchedAt + 60 + A.sessionWarmupSeconds);
    // Warm-up done — and still inside the mute the player earned a minute before midnight.
    expect(watchedAt + 60 + A.sessionWarmupSeconds).toBeLessThan(watchedAt + A.muteAfterRewardedSeconds);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);
    at(watchedAt + A.muteAfterRewardedSeconds);
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);
  });

  it('keeps the floor since the last interstitial across a new session', async () => {
    const shownAt = A.sessionWarmupSeconds + 5;
    at(shownAt);
    expect(await ads.showInterstitial()).toBe(true);
    away(AWAY);
    expect(Reflect.get(ads, 'lastInterstitialAt')).toBe(T0 + shownAt * 1000);
    expect(Reflect.get(ads, 'interstitialsThisSession')).toBe(0);
  });

  it('is decided by the lifecycle, not by the visibility event alone', () => {
    at(A.sessionWarmupSeconds + 10);
    // The page hides and comes back 40 minutes later, but the lifecycle is
    // never told (no main.ts handler): the age only paused, nothing restarted.
    doc().hidden = true;
    for (const fn of [...visibilityListeners]) fn();
    at(A.sessionWarmupSeconds + 10 + 40 * 60);
    doc().hidden = false;
    for (const fn of [...visibilityListeners]) fn();
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);
  });
});

/*
 * The session's AGE is time spent playing. The warm-up protects the first
 * minutes of play, and on the wall clock a phone locked for twenty minutes
 * came back reading twenty-one minutes in: warm-up skipped, and already past
 * the long-session mark, so the tighter floor applied to someone who had
 * played for one. The floor since the last ad and the rewarded mute stay on
 * the wall clock: they are real elapsed time, and time away counts toward
 * them just the same.
 */
describe('time spent in the background', () => {
  it('does not count toward the warm-up — one minute played, twenty away', () => {
    at(60);
    away(20 * 60);
    const back = 60 + 20 * 60;
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);

    // One minute is already played: the rest of the warm-up is on screen.
    at(back + A.sessionWarmupSeconds - 60 - 1);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);
    at(back + A.sessionWarmupSeconds - 60);
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);
  });

  it('does not count toward the long-session floor', async () => {
    at(A.sessionWarmupSeconds + 1);
    away(10 * 60); // the wall clock is now well past longSessionAfterSeconds
    const back = A.sessionWarmupSeconds + 1 + 10 * 60;
    expect(back).toBeGreaterThan(A.longSessionAfterSeconds);
    expect(await ads.showInterstitial()).toBe(true);

    // About five minutes played: the early, wider floor still holds.
    at(back + A.lateSecondsBetweenInterstitials);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);
    at(back + A.minSecondsBetweenInterstitials);
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);
  });

  it('starts over after two minutes of play and thirty-one away', () => {
    at(120);
    away(31 * 60);
    const back = 120 + 31 * 60;
    // Resumed, this session would be through its warm-up a minute from now.
    at(back + 60);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);
    at(back + A.sessionWarmupSeconds - 1);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);
    at(back + A.sessionWarmupSeconds);
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);
  });

  it('still counts toward the floor since the last ad', async () => {
    const firstAt = A.sessionWarmupSeconds + 5;
    at(firstAt);
    expect(await ads.showInterstitial()).toBe(true);

    away(A.minSecondsBetweenInterstitials - 1);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);
    // One second played since that ad, and the floor has passed anyway.
    at(firstAt + A.minSecondsBetweenInterstitials);
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);
  });

  it('still counts toward the mute after a rewarded ad', async () => {
    const watchedAt = A.sessionWarmupSeconds + 10;
    at(watchedAt);
    expect(await ads.showRewarded('reveal')).toBe('earned');

    away(A.muteAfterRewardedSeconds - 1);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);
    at(watchedAt + A.muteAfterRewardedSeconds);
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);
  });

  /*
   * The SDK can come up with the app in the background — the player left while
   * the consent answer or the network was slow. The session starts then, but
   * its age waits for the player.
   */
  it('holds the warm-up for the player when the SDK comes up in the background', async () => {
    at(10);
    setHidden(true);
    at(20);
    await ads.init();
    const back = 20 + 10 * 60;
    at(back);
    setHidden(false);

    at(back + A.sessionWarmupSeconds - 1);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);
    at(back + A.sessionWarmupSeconds);
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);
  });

  it('counts nothing before the player first sees a launch that began in the background', () => {
    doc().hidden = true;
    ads = new AdsService();
    at(3600);
    setHidden(false);

    at(3600 + A.sessionWarmupSeconds - 1);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);
    at(3600 + A.sessionWarmupSeconds);
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);
  });

  it('is not fooled by the same visibility reported twice', () => {
    at(60);
    setHidden(true);
    at(60 + 20 * 60);
    setHidden(true); // a second "hidden": the player left at one minute, not now
    const back = 60 + 31 * 60;
    at(back);
    setHidden(false); // 31 minutes after they left: a new session
    at(back + 60);
    setHidden(false); // a second "visible": the minute already on screen is kept

    at(back + A.sessionWarmupSeconds - 1);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);
    at(back + A.sessionWarmupSeconds);
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);
  });
});

describe('an interstitial that never renders', () => {
  beforeEach(() => {
    at(A.sessionWarmupSeconds + 5);
  });

  /*
   * No fill is the normal state of a brand-new ad unit for its first days, so
   * this is the common path at launch, not an edge case.
   */
  it('reports no-fill as false and leaves the cadence counter armed', async () => {
    stub.spies.loadInterstitial.mockResolvedValueOnce(false);

    expect(await ads.showInterstitial()).toBe(false);
    expect(stub.spies.showInterstitial).not.toHaveBeenCalled();
    // Nothing spent: the next natural break gets to try again.
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);
  });

  /*
   * Displayed and DisplayFailed arrive on the same race. Treating them alike
   * bills the player's win counter for an ad that never reached the screen,
   * and GameScene.advance() only clears winsSinceAd when this returns true.
   */
  it('reports a failed present as false, not as a shown ad', async () => {
    stub.spies.showInterstitial.mockImplementationOnce(async () => {
      stub.dismissSoon('failed');
      return false;
    });

    expect(await ads.showInterstitial()).toBe(false);
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);
  });

  /*
   * LevelPlay REJECTS a show when nothing is ready — "The interstitial ad is
   * not ready yet." — and then emits nothing at all: no displayed, no failed,
   * no closed. Waiting for a dismissal anyway parks the game on the three-
   * minute ceiling with the loop, music and input asleep.
   */
  it('does not park the game on the dismissal ceiling when the network refuses the show', async () => {
    stub.spies.showInterstitial.mockResolvedValueOnce(false);

    let settled = false;
    const pending = ads.showInterstitial().then((v) => {
      settled = true;
      return v;
    });
    await flush();
    expect(settled).toBe(true);
    expect(await pending).toBe(false);
    expect(stub.loop.resume).toHaveBeenCalledTimes(1);
  });

  /*
   * Silence is the ambiguous one: the ad may well be up and its Displayed event
   * simply lost. So the call reports false — nothing is owed to the counter —
   * but the time floor is stamped anyway, because stacking a second
   * interstitial on a live one is the offence that costs the account.
   */
  it('treats a lost Displayed event as unshown but still stamps the floor', async () => {
    stub.spies.showInterstitial.mockResolvedValueOnce(null);

    expect(await ads.showInterstitial()).toBe(false);

    at(A.sessionWarmupSeconds + 5 + A.minSecondsBetweenInterstitials - 1);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);
    at(A.sessionWarmupSeconds + 5 + A.minSecondsBetweenInterstitials);
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);
  });
});

describe('an interstitial the player is still watching', () => {
  beforeEach(() => {
    at(A.sessionWarmupSeconds + 5);
  });

  /*
   * The AdMob code gave the whole thing eight seconds from before the show.
   * A video interstitial runs longer than that, so it reported false with the
   * ad still up, the next level loaded underneath it, and the session cap
   * never counted the ad at all.
   */
  it('does not come back until the player closes it, however long the video runs', async () => {
    stub.spies.showInterstitial.mockResolvedValueOnce(true); // presented, then just sits there

    let result: boolean | undefined;
    void ads.showInterstitial().then((v) => (result = v));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(result).toBeUndefined();
    expect(stub.loop.resume).not.toHaveBeenCalled();

    stub.dismiss('closed');
    await flush();
    expect(result).toBe(true);
    expect(stub.loop.resume).toHaveBeenCalledTimes(1);
  });

  it('hands the game back at the ceiling even if no close ever arrives', async () => {
    stub.spies.showInterstitial.mockResolvedValueOnce(true);

    let result: boolean | undefined;
    void ads.showInterstitial().then((v) => (result = v));
    await vi.advanceTimersByTimeAsync(SHOW_CEILING_MS);
    await flush();
    // It was on screen: the impression is real, and so is the counter.
    expect(result).toBe(true);
    expect(stub.loop.resume).toHaveBeenCalledTimes(1);
  });
});

describe('the rewarded video', () => {
  beforeEach(() => {
    at(A.sessionWarmupSeconds + 5);
  });

  it('earns the reward when the player watches it out', async () => {
    expect(await ads.showRewarded('reveal')).toBe('earned');
  });

  /*
   * The reward event is the ONLY thing that pays. A close is not a reward,
   * however long the ad ran before it.
   */
  it('declines when the player closes it before the reward lands', async () => {
    stub.spies.showRewarded.mockImplementationOnce(() => {
      stub.dismissSoon('closed');
      return new Promise(() => {});
    });
    const pending = ads.showRewarded('reveal');
    await vi.advanceTimersByTimeAsync(REWARD_GRACE_MS);
    expect(await pending).toBe('declined');
  });

  /*
   * Some LevelPlay adapters emit RewardedClosed BEFORE RewardedRewarded. With
   * the close deciding the outcome, the player who watched the whole ad was
   * told they had not — and got nothing.
   */
  it('pays a reward that lands just after the close', async () => {
    stub.spies.showRewarded.mockImplementationOnce(() => {
      stub.dismissSoon('closed');
      return new Promise((resolve) => setTimeout(() => resolve({ rewardAmount: 1 }), 30));
    });
    const pending = ads.showRewarded('reveal');
    await vi.advanceTimersByTimeAsync(30);
    expect(await pending).toBe('earned');
  });

  /*
   * Reward BEFORE close is the usual order: networks grant it when the video
   * completes, and the player is still on the end card looking for the close
   * button. Restoring on the reward brought the loop, the music and a
   * refreshing banner back under the ad — the contention the quieting is for.
   */
  it('keeps the game quiet until the ad is closed when the reward lands first', async () => {
    await ads.init();
    await ads.showBanner();
    stub.spies.showRewarded.mockImplementationOnce(async () => {
      setTimeout(() => stub.dismiss('closed'), 3_000);
      return { rewardAmount: 1 };
    });

    let result: string | undefined;
    void ads.showRewarded('reveal').then((v) => (result = v));
    await vi.advanceTimersByTimeAsync(2_900);
    expect(result).toBeUndefined();
    expect(stub.loop.resume).not.toHaveBeenCalled();
    expect(stub.music.start).not.toHaveBeenCalled();
    expect(stub.spies.bannerResume).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    await flush();
    expect(result).toBe('earned');
    expect(stub.loop.resume).toHaveBeenCalledTimes(1);
    expect(stub.music.start).toHaveBeenCalledTimes(1);
    expect(stub.spies.bannerResume).toHaveBeenCalledTimes(1);
  });

  it('still hands the game back at the ceiling when a rewarded close never arrives', async () => {
    stub.spies.showRewarded.mockImplementationOnce(async () => ({ rewardAmount: 1 }));
    let result: string | undefined;
    void ads.showRewarded('reveal').then((v) => (result = v));
    await vi.advanceTimersByTimeAsync(SHOW_CEILING_MS);
    await flush();
    // The reward was decided before the silence: it is still owed.
    expect(result).toBe('earned');
    expect(stub.loop.resume).toHaveBeenCalledTimes(1);
  });

  it('declines an ad the player sat on past the ceiling without earning', async () => {
    stub.spies.showRewarded.mockImplementationOnce(() => new Promise(() => {}));
    const pending = ads.showRewarded('reveal');
    await vi.advanceTimersByTimeAsync(SHOW_CEILING_MS + REWARD_GRACE_MS);
    expect(await pending).toBe('declined');
  });

  /*
   * 'unavailable' exists because collapsing it into 'declined' produced a dead
   * button: no-fill withheld the skip from a player who did nothing wrong. An
   * ad we fail to supply is our problem — the two must not be the same value.
   */
  it('reports unavailable when nothing could be loaded', async () => {
    stub.spies.loadRewarded.mockResolvedValueOnce(false);
    expect(await ads.showRewarded('reveal')).toBe('unavailable');
    expect(stub.spies.showRewarded).not.toHaveBeenCalled();
  });

  it('reports unavailable when the load succeeds but the present is refused', async () => {
    // The provider resolves null on a rejected show, and nothing else arrives.
    stub.spies.showRewarded.mockResolvedValueOnce(null);
    expect(await ads.showRewarded('reveal')).toBe('unavailable');
  });

  it('reports unavailable when the present fails', async () => {
    stub.spies.showRewarded.mockImplementationOnce(async () => {
      stub.dismissSoon('failed');
      return null;
    });
    expect(await ads.showRewarded('reveal')).toBe('unavailable');
  });

  it('never runs two at once — a second tap while one is up is a decline', async () => {
    stub.spies.showRewarded.mockImplementationOnce(() => new Promise(() => {}));
    const first = ads.showRewarded('reveal');
    await flush();
    expect(await ads.showRewarded('skip')).toBe('declined');
    expect(stub.spies.loadRewarded).toHaveBeenCalledTimes(1);
    stub.dismiss('closed');
    await vi.advanceTimersByTimeAsync(REWARD_GRACE_MS);
    expect(await first).toBe('declined');
  });
});

describe('the game under a full-screen ad', () => {
  beforeEach(() => {
    at(A.sessionWarmupSeconds + 5);
  });

  /*
   * KVIZKO's on-device finding: with the canvas animating, the music scheduling
   * and a banner refreshing underneath, a full-screen ad's own close button
   * stopped responding. And iOS interrupts Web Audio for the ad, so without an
   * unlock afterwards the game is silent for the rest of the session.
   */
  it('pauses the loop and the music for the ad, and brings both back after', async () => {
    stub.spies.showInterstitial.mockImplementationOnce(async () => {
      expect(stub.loop.pause).toHaveBeenCalledTimes(1);
      expect(stub.music.stop).toHaveBeenCalledTimes(1);
      expect(stub.loop.resume).not.toHaveBeenCalled();
      stub.dismissSoon('closed');
      return true;
    });
    expect(await ads.showInterstitial()).toBe(true);
    expect(stub.loop.resume).toHaveBeenCalledTimes(1);
    expect(stub.audio.unlock).toHaveBeenCalledTimes(1);
    expect(stub.music.start).toHaveBeenCalledTimes(1);
  });

  it('takes the banner down for the ad and resumes the same one after', async () => {
    await ads.init();
    await ads.showBanner();
    expect(stub.spies.bannerShow).toHaveBeenCalledTimes(1);

    expect(await ads.showInterstitial()).toBe(true);
    expect(await ads.showRewarded('reveal')).toBe('earned');
    await flush();

    expect(stub.spies.bannerHide).toHaveBeenCalledTimes(2);
    expect(stub.spies.bannerResume).toHaveBeenCalledTimes(2);
    // Resumed, never re-created: a second create stacks two banner views.
    expect(stub.spies.bannerShow).toHaveBeenCalledTimes(1);
  });

  it('gives the game back even when the show throws', async () => {
    stub.spies.showInterstitial.mockRejectedValueOnce(new Error('boom'));
    expect(await ads.showInterstitial()).toBe(false);
    expect(stub.loop.resume).toHaveBeenCalledTimes(1);
    expect(stub.music.start).toHaveBeenCalledTimes(1);
  });

  it('attaches the dismissal watcher BEFORE asking for the ad', async () => {
    // A fast tap on the close button fires the dismissal while nothing is
    // listening if the watcher goes on after the show — and the game then
    // sleeps out the whole ceiling.
    expect(await ads.showInterstitial()).toBe(true);
    const watched = stub.spies.watchDismissal.mock.invocationCallOrder[0];
    const shown = stub.spies.showInterstitial.mock.invocationCallOrder[0];
    expect(watched).toBeLessThan(shown);
  });
});

/*
 * A break is checked, THEN the ad loads, THEN it shows — and the moment the
 * caller checked is gone by the time the ad is in hand. On the retry path the
 * player had reached for the dot and the interstitial landed on the stroke; a
 * rewarded skip loading over seconds was shown over whatever level the player
 * had gone to since, and paid out to it. The caller's question is asked again
 * with the ad in hand, and a no shows nothing and spends nothing.
 */
describe('an ad the caller no longer wants', () => {
  beforeEach(() => {
    at(A.sessionWarmupSeconds + 5);
  });

  it('asks again once the interstitial has loaded, and a no shows nothing and spends nothing', async () => {
    let wanted = true;
    stub.spies.loadInterstitial.mockImplementationOnce(async () => {
      wanted = false; // the player started the next stroke while it loaded
      return true;
    });

    expect(await ads.showInterstitial(() => wanted)).toBe(false);
    expect(stub.spies.showInterstitial).not.toHaveBeenCalled();
    expect(stub.loop.pause).not.toHaveBeenCalled();
    // Not taken, so not stamped: the next natural break still gets it.
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);
    expect(await ads.showInterstitial(() => true)).toBe(true);
  });

  it('asks after the load, not before it', async () => {
    const order: string[] = [];
    stub.spies.loadInterstitial.mockImplementationOnce(async () => {
      order.push('load');
      return true;
    });
    await ads.showInterstitial(() => {
      order.push('asked');
      return true;
    });
    expect(order).toEqual(['load', 'asked']);
  });

  it('reads a question that throws — a scene already torn down — as a no', async () => {
    const gone = (): boolean => {
      throw new Error('scene gone');
    };
    expect(await ads.showInterstitial(gone)).toBe(false);
    expect(await ads.showRewarded('skip', gone)).toBe('abandoned');
    expect(stub.spies.showInterstitial).not.toHaveBeenCalled();
    expect(stub.spies.showRewarded).not.toHaveBeenCalled();
  });

  /*
   * Its own outcome, not 'unavailable': the skip pill skips for free when no
   * ad could be had, and must NOT when the player simply walked away from the
   * one that was loading.
   */
  it('abandons a rewarded ad the player walked away from — nothing shown, nothing owed', async () => {
    expect(await ads.showRewarded('skip', () => false)).toBe('abandoned');
    expect(stub.spies.showRewarded).not.toHaveBeenCalled();
    // Nothing was watched, so nothing mutes the interstitials either.
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);
  });

  it('shows the rewarded ad as before while it is still wanted', async () => {
    expect(await ads.showRewarded('skip', () => true)).toBe('earned');
  });

  it('is busy for exactly as long as an ad is loading or on screen', async () => {
    let finishLoad!: (v: boolean) => void;
    stub.spies.loadRewarded.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (finishLoad = resolve))
    );
    expect(ads.busy).toBe(false);
    const pending = ads.showRewarded('reveal');
    await flush();
    expect(ads.busy).toBe(true);
    finishLoad(true);
    expect(await pending).toBe('earned');
    expect(ads.busy).toBe(false);
  });
});

describe('an owner of Remove Ads', () => {
  it('gets no interstitial and no banner', async () => {
    ads.setAdsRemoved(true);
    at(A.sessionWarmupSeconds + 600);

    expect(ads.enabled).toBe(false);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);
    expect(ads.wouldShowOnAttempt(PLAYING, 999)).toBe(false);
    expect(await ads.showInterstitial()).toBe(false);
    expect(stub.spies.loadInterstitial).not.toHaveBeenCalled();

    await ads.init();
    await ads.showBanner();
    expect(stub.spies.bannerShow).not.toHaveBeenCalled();
  });

  it('loses the banner the moment the purchase lands', async () => {
    await ads.init();
    await ads.showBanner();
    expect(stub.spies.bannerShow).toHaveBeenCalledTimes(1);

    ads.setAdsRemoved(true);
    expect(stub.spies.bannerRemove).toHaveBeenCalledTimes(1);
  });

  /*
   * The boot call re-delivers an owner's entitlement on every launch, before
   * any banner exists. Tearing down nothing must not reach the network.
   */
  it('tears nothing down when the entitlement is re-delivered before any banner exists', async () => {
    ads.setAdsRemoved(true);
    await flush();
    expect(stub.spies.bannerRemove).not.toHaveBeenCalled();
  });

  it('removes a banner that finishes loading after the purchase landed', async () => {
    let finishLoad!: () => void;
    stub.spies.bannerShow.mockImplementationOnce(() => new Promise<void>((r) => (finishLoad = r)));
    await ads.init();
    const showing = ads.showBanner();
    ads.setAdsRemoved(true);
    finishLoad();
    await showing;
    await flush();
    // Once for the in-flight banner at the purchase, once more when it landed.
    expect(stub.spies.bannerRemove).toHaveBeenCalledTimes(2);
    await ads.showBanner();
    expect(stub.spies.bannerShow).toHaveBeenCalledTimes(1);
  });

  /* Rewarded helps the player, so taking it away would punish the buyer. */
  it('keeps the opt-in rewarded video — and still watches it, it is not granted free', async () => {
    ads.setAdsRemoved(true);
    expect(ads.rewardedAvailable).toBe(true);
    at(A.sessionWarmupSeconds + 5);
    expect(await ads.showRewarded('reveal')).toBe('earned');
    expect(stub.spies.showRewarded).toHaveBeenCalledTimes(1);
  });
});

describe('the banner', () => {
  /*
   * The menu starts without waiting on the ad SDK, and init itself waits for
   * the film and the consent questions, so the menu's showBanner() always lands
   * first. Without the replay the banner appears only on a fast network.
   */
  it('is replayed once the SDK is ready if it was asked for too early', async () => {
    await ads.showBanner();
    expect(stub.spies.bannerShow).not.toHaveBeenCalled();

    await ads.init();
    expect(stub.spies.bannerShow).toHaveBeenCalledTimes(1);
  });

  it('is not requested twice while it is already up', async () => {
    await ads.init();
    await ads.showBanner();
    await ads.showBanner();
    expect(stub.spies.bannerShow).toHaveBeenCalledTimes(1);
  });

  /*
   * Callers overlap: the film's release, the end of init and a scene's create
   * can all ask in the same moment, and each would otherwise see "no banner
   * yet" and create its own native view.
   */
  it('shares one creation between callers that arrive while it loads', async () => {
    let finishLoad!: () => void;
    stub.spies.bannerShow.mockImplementationOnce(() => new Promise<void>((r) => (finishLoad = r)));
    await ads.init();
    const a = ads.showBanner();
    const b = ads.showBanner();
    finishLoad();
    await Promise.all([a, b]);
    await ads.showBanner();
    expect(stub.spies.bannerShow).toHaveBeenCalledTimes(1);
  });

  /*
   * The SDK-ready gate is released when init FINISHES, not when it succeeds.
   * Released only on success, a failed init parked every banner request for
   * the rest of the session — and a failed init is not final, the provider
   * retries it.
   */
  it('still asks for a banner when init fails outright', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stub.spies.init.mockRejectedValueOnce(new Error('init failed: no network'));
    await ads.showBanner();
    await ads.init();
    expect(stub.spies.bannerShow).toHaveBeenCalledTimes(1);
    vi.mocked(console.warn).mockRestore();
  });

  /*
   * The replay at the end of init() is one moment, and the SDK can come up long
   * after it: a timed retry after an offline launch, a return to the
   * foreground. GameScene stays alive across levels, so a player who kept
   * playing never hit another showBanner() and never got the strip.
   */
  it('is replayed when the SDK comes up after init has already finished', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stub.spies.init.mockRejectedValueOnce(new Error('init failed: no network'));
    stub.spies.bannerShow.mockRejectedValueOnce(new Error('LevelPlay is not initialized.'));
    await ads.showBanner();
    await ads.init();
    await flush();
    expect(stub.spies.bannerShow).toHaveBeenCalledTimes(1);

    stub.sdkComesUp(); // the 30 s retry succeeded
    await flush();
    expect(stub.spies.bannerShow).toHaveBeenCalledTimes(2);

    stub.sdkComesUp(); // up is up: a second announcement stacks nothing
    await flush();
    expect(stub.spies.bannerShow).toHaveBeenCalledTimes(2);
    vi.mocked(console.warn).mockRestore();
  });

  it('retries a banner that did not fill on the next scene that asks', async () => {
    stub.spies.bannerShow.mockRejectedValueOnce(new Error('Banner failed to load: no fill'));
    await ads.init();
    await ads.showBanner();
    await ads.showBanner();
    expect(stub.spies.bannerShow).toHaveBeenCalledTimes(2);
  });

  /*
   * The opening film is full-bleed, but the banner is a NATIVE view above the
   * webview: nothing the page draws can cover it, so the only way to keep it
   * off the film is not to ask for it yet. The scenes must not have to know
   * that — they call showBanner() whenever they like and the want is honoured
   * when the hold lifts.
   */
  it('stays off the glass while the opening film holds it', async () => {
    await ads.init();
    ads.holdBanner();

    await ads.showBanner();
    expect(stub.spies.bannerShow).not.toHaveBeenCalled();

    await ads.releaseBanner();
    expect(stub.spies.bannerShow).toHaveBeenCalledTimes(1);
  });

  it('does not conjure a banner nobody asked for when the hold lifts', async () => {
    await ads.init();
    ads.holdBanner();
    await ads.releaseBanner();
    expect(stub.spies.bannerShow).not.toHaveBeenCalled();
  });

  /* Releasing twice must not stack a second request on top of the live one. */
  it('shows exactly one banner however often the hold is released', async () => {
    await ads.init();
    ads.holdBanner();
    await ads.showBanner();
    await ads.releaseBanner();
    await ads.releaseBanner();
    expect(stub.spies.bannerShow).toHaveBeenCalledTimes(1);
  });
});

/*
 * Consent gates the SDK itself on this network: no consent, no initialize(),
 * no ads of any kind. The policy layer has to reflect that, or a player who
 * declined sees "Watch an ad" rows that answer "no ad ready just now — try
 * again in a moment" for the rest of time, and a skip pill promising an ad.
 */
describe('ad consent', () => {
  it('hides every offer and serves nothing once consent is withheld', async () => {
    stub.state.consent = 'withheld';
    at(A.sessionWarmupSeconds + 600);
    await ads.init();

    expect(ads.enabled).toBe(false);
    expect(ads.rewardedAvailable).toBe(false);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);
    await ads.showBanner();
    expect(await ads.showInterstitial()).toBe(false);
    expect(await ads.showRewarded('reveal')).toBe('unavailable');

    expect(stub.spies.bannerShow).not.toHaveBeenCalled();
    expect(stub.spies.loadInterstitial).not.toHaveBeenCalled();
    expect(stub.spies.loadRewarded).not.toHaveBeenCalled();
  });

  /*
   * Unanswered is not declined: the banner want is still remembered, so the
   * strip appears the moment a yes starts the SDK. But no ad can load before
   * consent, so nothing may PROMISE one yet.
   */
  it('remembers the banner while the question is unanswered, but promises no rewarded ad', async () => {
    stub.state.consent = 'pending';
    stub.state.sdkUp = false;
    expect(ads.enabled).toBe(true);
    expect(ads.rewardedAvailable).toBe(false);
    await ads.showBanner();
    await ads.init();
    // The yes arrives late and starts the SDK: the wanted banner follows.
    stub.state.consent = 'granted';
    stub.sdkComesUp();
    await flush();
    expect(stub.spies.bannerShow).toHaveBeenCalledTimes(1);
    expect(ads.rewardedAvailable).toBe(true);
  });

  /*
   * rewardedAvailable is the one value behind the skip pill's label ("Watch ad
   * to skip this fold" or "Skip this fold") and the store sheet's "Watch an ad"
   * row. With the SDK down it drew both, and every tap answered 'unavailable'
   * — a free skip under a label promising an ad, and a row that only ever said
   * "no ad ready just now".
   */
  it('promises a rewarded ad only while the SDK is up', async () => {
    const label = (): string => (ads.rewardedAvailable ? 'Watch ad to skip this fold' : 'Skip this fold');

    stub.state.consent = 'pending';
    stub.state.sdkUp = false;
    expect(label()).toBe('Skip this fold');

    stub.state.consent = 'granted'; // …but initialize() failed offline
    expect(label()).toBe('Skip this fold');
    at(A.sessionWarmupSeconds + 5);
    expect(await ads.showRewarded('skip')).toBe('unavailable'); // the free skip
    expect(stub.spies.loadRewarded).not.toHaveBeenCalled();

    stub.state.sdkUp = true; // the retry brought it up
    expect(label()).toBe('Watch ad to skip this fold');

    ads.setAdsRemoved(true); // owners keep the opt-in ad
    expect(label()).toBe('Watch ad to skip this fold');

    stub.state.consent = 'withheld'; // up, but the player said no
    expect(label()).toBe('Skip this fold');
  });

  /*
   * A withdrawal used to change what later calls were allowed to do, and
   * nothing more: the native banner already up stayed attached and kept
   * refreshing for the rest of the session, under a modal that had just said
   * "If you decline, Foldwing shows no ads at all".
   */
  it('destroys the live banner when consent is withdrawn from Privacy choices, and brings it back on a yes', async () => {
    await ads.init();
    await ads.showBanner();
    expect(stub.spies.bannerShow).toHaveBeenCalledTimes(1);

    stub.openPrivacyOptions.mockImplementationOnce(async () => {
      stub.state.consent = 'withheld';
    });
    await ads.openPrivacyOptions();
    expect(stub.spies.bannerRemove).toHaveBeenCalledTimes(1);
    // Destroyed, not hidden: a hidden native banner view still refreshes.
    expect(stub.spies.bannerHide).not.toHaveBeenCalled();
    await ads.showBanner(); // the next scene asks
    expect(stub.spies.bannerShow).toHaveBeenCalledTimes(1);

    stub.openPrivacyOptions.mockImplementationOnce(async () => {
      stub.state.consent = 'granted';
    });
    await ads.openPrivacyOptions();
    expect(stub.spies.bannerShow).toHaveBeenCalledTimes(2);
  });

  it('brings the banner back through onReady when the yes is what starts the SDK', async () => {
    // A stored decline: during the film nothing has read it yet, so the want is
    // recorded; init reads the decline and starts nothing.
    stub.state.consent = 'pending';
    stub.state.sdkUp = false;
    await ads.showBanner();
    stub.spies.init.mockImplementationOnce(async () => {
      stub.state.consent = 'withheld';
    });
    await ads.init();
    expect(stub.spies.bannerShow).not.toHaveBeenCalled();

    stub.openPrivacyOptions.mockImplementationOnce(async () => {
      stub.state.consent = 'granted'; // the SDK starts now, and is not up yet
    });
    await ads.openPrivacyOptions();
    expect(stub.spies.bannerShow).not.toHaveBeenCalled(); // no doomed create
    stub.sdkComesUp();
    await flush();
    expect(stub.spies.bannerShow).toHaveBeenCalledTimes(1);
  });

  it('removes a banner that finishes loading after consent was withdrawn', async () => {
    let finishLoad!: () => void;
    stub.spies.bannerShow.mockImplementationOnce(() => new Promise<void>((r) => (finishLoad = r)));
    await ads.init();
    const showing = ads.showBanner();
    stub.openPrivacyOptions.mockImplementationOnce(async () => {
      stub.state.consent = 'withheld';
    });
    await ads.openPrivacyOptions();
    finishLoad();
    await showing;
    await flush();
    // Once for the in-flight banner at the withdrawal, once more when it landed.
    expect(stub.spies.bannerRemove).toHaveBeenCalledTimes(2);
  });

  /*
   * The native plugin never settles a banner load whose view it destroyed, so
   * the creation promise torn down by a withdrawal hangs forever. Kept as the
   * shared in-flight creation, it was handed to every later showBanner(), and a
   * yes in the same session never brought a banner back.
   */
  it('brings the banner back after a withdrawal that landed mid-load, even though that load never settles', async () => {
    stub.spies.bannerShow.mockImplementationOnce(() => new Promise<void>(() => {}));
    await ads.init();
    void ads.showBanner();
    await flush();
    expect(stub.spies.bannerShow).toHaveBeenCalledTimes(1);

    stub.openPrivacyOptions.mockImplementationOnce(async () => {
      stub.state.consent = 'withheld';
    });
    await ads.openPrivacyOptions();
    expect(stub.spies.bannerRemove).toHaveBeenCalledTimes(1);

    stub.openPrivacyOptions.mockImplementationOnce(async () => {
      stub.state.consent = 'granted';
    });
    await ads.openPrivacyOptions();
    expect(stub.spies.bannerShow).toHaveBeenCalledTimes(2);
    await flush();
    // The fresh banner is up, and nothing tore it down on the stale one's behalf.
    expect(stub.spies.bannerRemove).toHaveBeenCalledTimes(1);
  });

  it('never lets a stale creation that lands late destroy the banner created after it', async () => {
    let finishStale!: () => void;
    stub.spies.bannerShow.mockImplementationOnce(() => new Promise<void>((r) => (finishStale = r)));
    await ads.init();
    void ads.showBanner();
    await flush();
    stub.openPrivacyOptions.mockImplementationOnce(async () => {
      stub.state.consent = 'withheld';
    });
    await ads.openPrivacyOptions();
    stub.openPrivacyOptions.mockImplementationOnce(async () => {
      stub.state.consent = 'granted';
    });
    await ads.openPrivacyOptions(); // creates the second banner, which lands at once
    await flush();
    expect(stub.spies.bannerRemove).toHaveBeenCalledTimes(1);

    finishStale();
    await flush();
    expect(stub.spies.bannerRemove).toHaveBeenCalledTimes(1);
    expect(ads.enabled).toBe(true);
  });

  it('offers again the moment a later answer is a yes', async () => {
    stub.state.consent = 'withheld';
    await ads.init();
    await ads.showBanner();
    expect(ads.rewardedAvailable).toBe(false);

    stub.state.consent = 'granted'; // e.g. from Settings → Privacy choices
    expect(ads.rewardedAvailable).toBe(true);
    await ads.showBanner();
    expect(stub.spies.bannerShow).toHaveBeenCalledTimes(1);
  });

  it('opens the consent modal again from Settings, on a device build with ads', async () => {
    expect(ads.privacyChoicesAvailable).toBe(true);
    await ads.openPrivacyOptions();
    expect(stub.openPrivacyOptions).toHaveBeenCalledTimes(1);
  });
});

/*
 * Game Center's sign-in sheet and the consent alert are both presented on the
 * bridge view controller, and UIKit silently refuses to present from one that
 * is already presenting. With the sheet up first, the consent alert never
 * appeared and the whole session went without ads. MenuScene signs in only
 * once this has settled.
 */
describe('the consent flow, for whoever must not overlap it', () => {
  const settled = async (): Promise<boolean> => {
    let done = false;
    void ads.consentFlowDone.then(() => (done = true));
    await flush();
    return done;
  };

  it('settles only once init has', async () => {
    let finishInit!: () => void;
    stub.spies.init.mockImplementationOnce(() => new Promise<void>((r) => (finishInit = r)));
    expect(await settled()).toBe(false); // the film: init has not even started
    const booting = ads.init();
    expect(await settled()).toBe(false); // consent questions on screen
    finishInit();
    await booting;
    expect(await settled()).toBe(true);
  });

  it('settles when init fails, too', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stub.spies.init.mockRejectedValueOnce(new Error('init failed: no network'));
    await ads.init();
    expect(await settled()).toBe(true);
    vi.mocked(console.warn).mockRestore();
  });

  it('settles at its ceiling when the SDK start never returns', async () => {
    stub.spies.init.mockImplementationOnce(() => new Promise<void>(() => {}));
    void ads.init();
    await vi.advanceTimersByTimeAsync(180_000 - 1);
    expect(await settled()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled()).toBe(true);
  });

  it('is settled from the start in every build with no consent modal', async () => {
    const cases: [string, () => void][] = [
      ['web', () => (stub.state.platform = 'web')],
      ['android, no LevelPlay app', () => (stub.state.platform = 'android')],
      ['ads-off', () => vi.stubEnv('VITE_ADS', 'off')],
      ['mock', () => vi.stubEnv('VITE_ADS', 'mock')],
    ];
    for (const [what, arrange] of cases) {
      pinNormalBuild();
      stub.state.platform = 'ios';
      arrange();
      ads = new AdsService();
      expect(await settled(), what).toBe(true);
    }
    expect(stub.spies.init).not.toHaveBeenCalled();
  });
});

describe('the SDK start', () => {
  it('initialises the provider once, however often it is asked', async () => {
    await ads.init();
    await ads.init();
    expect(stub.spies.init).toHaveBeenCalledTimes(1);
  });

  /*
   * A failed initialize() is retried by the provider, and a return to the
   * foreground is the one event that means the reason may be gone. Before init
   * has run — the film still up — there is nothing to retry.
   */
  it('retries the provider on every return to the foreground, but only after init ran', async () => {
    ads.foregrounded();
    await flush();
    expect(stub.spies.retryInit).not.toHaveBeenCalled();
    await ads.init();
    ads.foregrounded();
    ads.foregrounded();
    await flush();
    // The provider decides whether each one does anything.
    expect(stub.spies.retryInit).toHaveBeenCalledTimes(2);
  });

  it('never claims test inventory — no build of Foldwing is safe to tap', () => {
    expect(ads.isTestAds).toBe(false);
  });
});

/*
 * Foldwing has no Android app in LevelPlay — no Play listing, no app key, no
 * units — so `levelplayConfigured()` is false there and every path must no-op
 * rather than ask for consent or fire a request that could only fail. This
 * reads the REAL per-platform table in providers/levelplay.ts.
 */
/*
 * The ATT trap. `visibilitychange` fires on willEnterForeground, while the app
 * is still INACTIVE, and a timer that came due in the background (the film's
 * cap, main.ts's backstop) fires in the same window; ATT asked then shows
 * nothing and answers notDetermined. So every route into the ad layer that can
 * ask ATT, show the consent modal or start the SDK waits for the ONE starter
 * gate — the film gone, the app active — whoever calls it.
 */
describe('the starter gate', () => {
  /** Hold the gate shut until the returned function opens it. */
  const shut = (): (() => void) => {
    let open!: () => void;
    stub.gate.mockImplementation(() => new Promise<void>((r) => (open = r)));
    return () => open();
  };

  it('asks nothing — no ATT, no consent, no SDK — until the gate opens', async () => {
    const open = shut();
    let flowDone = false;
    void ads.consentFlowDone.then(() => (flowDone = true));
    const booting = ads.init();
    await flush();
    expect(stub.gate).toHaveBeenCalledTimes(1);
    expect(stub.spies.init).not.toHaveBeenCalled();
    open();
    await booting;
    expect(stub.spies.init).toHaveBeenCalledTimes(1);
    expect(flowDone).toBe(true);
  });

  /*
   * The consent-flow ceiling bounds the flow, not the wait for the gate. A
   * ceiling that fell due in the background would release Game Center's sheet
   * in the very window the consent alert is waiting for.
   */
  it('does not start the consent ceiling while it waits', async () => {
    const open = shut();
    let flowDone = false;
    void ads.consentFlowDone.then(() => (flowDone = true));
    stub.spies.init.mockImplementationOnce(() => new Promise<void>(() => {}));
    void ads.init();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(flowDone).toBe(false);
    open();
    await flush();
    await vi.advanceTimersByTimeAsync(180_000 - 1);
    expect(flowDone).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(flowDone).toBe(true);
  });

  it('holds the foreground retry — which can re-ask ATT — until the gate opens', async () => {
    await ads.init();
    const open = shut();
    ads.foregrounded();
    await flush();
    expect(stub.spies.retryInit).not.toHaveBeenCalled();
    open();
    await flush();
    expect(stub.spies.retryInit).toHaveBeenCalledTimes(1);
  });

  it('holds Privacy choices until the gate opens too', async () => {
    await ads.init();
    const open = shut();
    const opening = ads.openPrivacyOptions();
    await flush();
    expect(stub.openPrivacyOptions).not.toHaveBeenCalled();
    open();
    await opening;
    expect(stub.openPrivacyOptions).toHaveBeenCalledTimes(1);
  });
});

describe('a platform with no LevelPlay app', () => {
  beforeEach(() => {
    stub.state.platform = 'android';
    ads = new AdsService();
  });

  it('turns every ad path into a no-op that still resolves', async () => {
    expect(adsSupported()).toBe(true); // a device — the missing piece is the app
    expect(ads.enabled).toBe(false);
    expect(ads.rewardedAvailable).toBe(false);
    expect(ads.privacyChoicesAvailable).toBe(false);

    at(A.sessionWarmupSeconds + 600);
    await expect(ads.init()).resolves.toBeUndefined();
    await expect(ads.showBanner()).resolves.toBeUndefined();
    await expect(ads.hideBanner()).resolves.toBeUndefined();
    await expect(ads.showInterstitial()).resolves.toBe(false);
    await expect(ads.showRewarded('reveal')).resolves.toBe('unavailable');
    await expect(ads.openPrivacyOptions()).resolves.toBeUndefined();
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);
    expect(ads.wouldShowOnAttempt(PLAYING, 999)).toBe(false);

    expect(stub.spies.init).not.toHaveBeenCalled();
    expect(stub.spies.bannerShow).not.toHaveBeenCalled();
    expect(stub.spies.loadInterstitial).not.toHaveBeenCalled();
    expect(stub.spies.loadRewarded).not.toHaveBeenCalled();
    expect(stub.openPrivacyOptions).not.toHaveBeenCalled();
  });
});

describe('the web build', () => {
  beforeEach(() => {
    stub.state.platform = 'web';
    ads = new AdsService();
  });

  /* The daily fold ships to the browser, where there is no ad SDK at all. */
  it('asks the provider for nothing', async () => {
    at(A.sessionWarmupSeconds + 600);
    await ads.init();
    await ads.showBanner();

    expect(adsSupported()).toBe(false);
    expect(ads.enabled).toBe(false);
    expect(ads.rewardedAvailable).toBe(false);
    expect(ads.privacyChoicesAvailable).toBe(false);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);
    expect(await ads.showRewarded('reveal')).toBe('unavailable');
    expect(stub.spies.init).not.toHaveBeenCalled();
    expect(stub.spies.bannerShow).not.toHaveBeenCalled();
  });
});

/*
 * The ADS-OFF build (`VITE_ADS=off`) — what TestFlight gets, including the
 * build that follows every live App Store upload. LevelPlay has no test
 * inventory, so this binary is the only kind that is safe on the owner's
 * phone, and "no ad surface" has to hold function by function, ON A DEVICE.
 * A browser cannot catch a regression here: every path already no-ops on the
 * web, which is exactly why a device-only leak would be invisible.
 */
describe('an ADS-OFF build', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ADS', 'off');
    stub.state.platform = 'ios';
    ads = new AdsService();
  });

  it('has no ad surface, on a native device included', () => {
    expect(adsSupported()).toBe(false);
    expect(ads.enabled).toBe(false);
  });

  it('never initialises the provider — so no consent modal and no ATT alert', async () => {
    await ads.init();
    expect(stub.spies.init).not.toHaveBeenCalled();
  });

  it('creates no banner, even once the film has gone', async () => {
    ads.holdBanner();
    await ads.init();
    await ads.showBanner();
    await ads.releaseBanner();
    expect(stub.spies.bannerShow).not.toHaveBeenCalled();
  });

  it('never shows an interstitial, however long the session runs', async () => {
    at(A.sessionWarmupSeconds + 3600);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);
    expect(ads.wouldShowOnAttempt(PLAYING, 999)).toBe(false);
    expect(await ads.showInterstitial()).toBe(false);
    expect(stub.spies.loadInterstitial).not.toHaveBeenCalled();
  });

  /*
   * No "Watch an ad" row and no "Watch ad" skip pill. The skip still works — it
   * takes 'unavailable' as a free skip — but the reveal refill never grants on
   * it, so a drawn row would be a button that only ever says no.
   */
  it('draws no rewarded offer and plays no rewarded ad', async () => {
    expect(ads.rewardedAvailable).toBe(false);
    expect(await ads.showRewarded('reveal')).toBe('unavailable');
    expect(await ads.showRewarded('skip')).toBe('unavailable');
    expect(stub.spies.loadRewarded).not.toHaveBeenCalled();
    expect(stub.spies.showRewarded).not.toHaveBeenCalled();
  });

  it('does not poke the provider on a return to the foreground', async () => {
    await ads.init();
    ads.foregrounded();
    expect(stub.spies.retryInit).not.toHaveBeenCalled();
  });

  it('offers no privacy choices and opens no modal — there is no SDK behind it', async () => {
    expect(ads.privacyChoicesAvailable).toBe(false);
    await expect(ads.openPrivacyOptions()).resolves.toBeUndefined();
    expect(stub.openPrivacyOptions).not.toHaveBeenCalled();
  });

  /*
   * BootScene re-delivers an owner's Remove Ads on every launch, which is
   * setAdsRemoved(true) on the owner's own phone. In KVIZKO's ads-off build
   * that was the one path still reaching the ad plugin.
   */
  it('a Remove Ads re-delivery at boot tears down nothing', async () => {
    ads.setAdsRemoved(true);
    await flush();
    expect(stub.spies.bannerRemove).not.toHaveBeenCalled();
  });

  it('never claims to be safe to tap either', () => {
    expect(ads.isTestAds).toBe(false);
  });
});
