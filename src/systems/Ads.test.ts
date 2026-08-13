import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Ads is a state machine, and `monetization.test.ts` only pins the numbers it
 * reads. That gap is real: deleting the time-floor line from `timingAllows`
 * leaves every constant assertion green while the shipped game starts putting
 * an interstitial on screen every twenty seconds on a level someone is stuck
 * on — the exact pattern AdMob disables ad serving over.
 *
 * So this file drives the machine instead of the constants. The plugin is
 * stubbed, the clock is ours, and each test builds a fresh AdsService so the
 * session counters start where the assertions think they do.
 */

/*
 * Event names are the real ones from @capacitor-community/admob. A stub that
 * invents its own strings tests only itself: the plugin's Dismissed really is
 * "interstitialAdDismissed", and getting that wrong in the real code is a
 * listener that never fires and an await that only ever times out.
 */
const stub = vi.hoisted(() => {
  const EVENT = {
    interstitialDismissed: 'interstitialAdDismissed',
    interstitialFailed: 'interstitialAdFailedToShow',
    rewardGranted: 'onRewardedVideoAdReward',
    rewardDismissed: 'onRewardedVideoAdDismissed',
    rewardFailed: 'onRewardedVideoAdFailedToShow',
  } as const;

  const listeners = new Map<string, ((arg?: unknown) => void)[]>();
  const emit = (event: string): void => {
    // Copied before iterating: a handler may register another one.
    for (const fn of [...(listeners.get(event) ?? [])]) fn();
  };

  /*
   * The happy path by default: prepare resolves, show presents and the player
   * closes it. Tests that want a sadder outcome replace one method.
   */
  const fresh = () => ({
    initialize: vi.fn(async (): Promise<void> => {}),
    requestTrackingAuthorization: vi.fn(async (): Promise<void> => {}),
    trackingAuthorizationStatus: vi.fn(async () => ({ status: 'authorized' })),
    requestConsentInfo: vi.fn(async () => ({
      status: 'NOT_REQUIRED',
      isConsentFormAvailable: false,
    })),
    showConsentForm: vi.fn(async (): Promise<void> => {}),
    showBanner: vi.fn(async (): Promise<void> => {}),
    removeBanner: vi.fn(async (): Promise<void> => {}),
    prepareInterstitial: vi.fn(async (): Promise<void> => {}),
    showInterstitial: vi.fn(async (): Promise<void> => {
      emit(EVENT.interstitialDismissed);
    }),
    prepareRewardVideoAd: vi.fn(async (): Promise<void> => {}),
    showRewardVideoAd: vi.fn(async (): Promise<void> => {
      emit(EVENT.rewardGranted);
      emit(EVENT.rewardDismissed);
    }),
    addListener: vi.fn(async (event: string, fn: (arg?: unknown) => void) => {
      const bucket = listeners.get(event);
      if (bucket) bucket.push(fn);
      else listeners.set(event, [fn]);
      return { remove: async (): Promise<void> => {} };
    }),
  });

  /*
   * Mutated in place rather than reassigned. Ads.ts captured this exact object
   * at import time, so swapping the reference would leave the code under test
   * talking to the previous test's spies.
   */
  const AdMob = fresh();
  const reset = (): void => {
    listeners.clear();
    Object.assign(AdMob, fresh());
  };

  return { EVENT, AdMob, emit, reset, platform: 'ios' };
});

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: (): boolean => stub.platform !== 'web',
    getPlatform: (): string => stub.platform,
  },
}));

vi.mock('@capacitor-community/admob', () => ({
  AdMob: stub.AdMob,
  AdmobConsentStatus: {
    NOT_REQUIRED: 'NOT_REQUIRED',
    OBTAINED: 'OBTAINED',
    REQUIRED: 'REQUIRED',
    UNKNOWN: 'UNKNOWN',
  },
  BannerAdPosition: {
    TOP_CENTER: 'TOP_CENTER',
    CENTER: 'CENTER',
    BOTTOM_CENTER: 'BOTTOM_CENTER',
  },
  BannerAdSize: { ADAPTIVE_BANNER: 'ADAPTIVE_BANNER' },
  InterstitialAdPluginEvents: {
    Dismissed: stub.EVENT.interstitialDismissed,
    FailedToShow: stub.EVENT.interstitialFailed,
  },
  RewardAdPluginEvents: {
    Rewarded: stub.EVENT.rewardGranted,
    Dismissed: stub.EVENT.rewardDismissed,
    FailedToShow: stub.EVENT.rewardFailed,
  },
}));

import { AdsService } from './Ads';
import { adsConfigured, monetization } from '../config/monetization';

const A = monetization.ads;

/** A level well past the onboarding grace, so only timing is under test. */
const PLAYING = A.interstitialFromLevel + 20;

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

let ads: AdsService;

/**
 * The smallest `document` that `watchForNewSession` needs.
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

/** Background the app for `seconds`, then bring it back. */
const away = (seconds: number): void => {
  const leftAt = Date.now();
  doc().hidden = true;
  for (const fn of [...visibilityListeners]) fn();
  vi.setSystemTime(leftAt + seconds * 1000);
  doc().hidden = false;
  for (const fn of [...visibilityListeners]) fn();
};

beforeEach(() => {
  stub.reset();
  stub.platform = 'ios';
  vi.useFakeTimers();
  at(0);
  installDocumentStub();
  // Constructed after the clock is set: sessionStartedAt is a field initialiser.
  ads = new AdsService();
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as unknown as { document?: unknown }).document;
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
   * the SDK is ready — BootScene starts the menu without waiting on AdMob, so
   * the object exists well before there is anything to serve.
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
    stub.AdMob.showRewardVideoAd.mockImplementationOnce(async () => {
      stub.emit(stub.EVENT.rewardDismissed);
    });

    at(A.sessionWarmupSeconds + 10);
    expect(await ads.showRewarded('reveal')).toBe('declined');
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

    away(A.newSessionAfterAwaySeconds - 60);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(true);

    away(A.newSessionAfterAwaySeconds + 60);
    // Back from a real absence: the warm-up is armed again.
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);
  });
});

describe('an interstitial that never renders', () => {
  beforeEach(() => {
    at(A.sessionWarmupSeconds + 5);
  });

  /*
   * No-fill is the PERMANENT state of a new AdMob app until Google's review
   * clears it, so this is the common path on day one, not an edge case.
   */
  it('reports no-fill as false and leaves the cadence counter armed', async () => {
    stub.AdMob.prepareInterstitial.mockRejectedValueOnce(new Error('no fill'));

    expect(await ads.showInterstitial()).toBe(false);
    expect(stub.AdMob.showInterstitial).not.toHaveBeenCalled();
    // Nothing spent: the next natural break gets to try again.
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);
  });

  /*
   * Dismissed and FailedToShow arrive on the same await. Treating them alike
   * bills the player's win counter for an ad that never reached the screen,
   * and GameScene.advance() only clears winsSinceAd when this returns true.
   */
  it('reports a failed present as false, not as a shown ad', async () => {
    stub.AdMob.showInterstitial.mockImplementationOnce(async () => {
      stub.emit(stub.EVENT.interstitialFailed);
    });

    expect(await ads.showInterstitial()).toBe(false);
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);
  });

  /*
   * Silence is the ambiguous one: the ad may well be up and the event simply
   * lost. So the call reports false — nothing is owed to the counter — but the
   * time floor is stamped anyway, because stacking a second interstitial on a
   * live one is the offence that costs the account.
   */
  it('treats a lost dismissal as unshown but still stamps the floor', async () => {
    stub.AdMob.showInterstitial.mockImplementationOnce(async (): Promise<void> => {});

    const pending = ads.showInterstitial();
    await vi.advanceTimersByTimeAsync(8000);
    expect(await pending).toBe(false);

    at(A.sessionWarmupSeconds + 5 + 8 + A.minSecondsBetweenInterstitials - 1);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);
    at(A.sessionWarmupSeconds + 5 + 8 + A.minSecondsBetweenInterstitials);
    expect(ads.wouldShowInterstitial(PLAYING, A.interstitialEveryNWins)).toBe(true);
  });
});

describe('the rewarded video', () => {
  beforeEach(() => {
    at(A.sessionWarmupSeconds + 5);
  });

  it('earns the reward when the player watches it out', async () => {
    expect(await ads.showRewarded('reveal')).toBe('earned');
  });

  it('declines when the player closes it before the reward lands', async () => {
    stub.AdMob.showRewardVideoAd.mockImplementationOnce(async () => {
      stub.emit(stub.EVENT.rewardDismissed);
    });
    expect(await ads.showRewarded('reveal')).toBe('declined');
  });

  /*
   * 'unavailable' exists because collapsing it into 'declined' produced a dead
   * button: no-fill withheld the reward from a player who did nothing wrong.
   * An ad we fail to supply is our problem, so callers grant on this and
   * withhold only on 'declined' — the two must not be the same value.
   */
  it('reports unavailable when nothing could be loaded', async () => {
    stub.AdMob.prepareRewardVideoAd.mockRejectedValueOnce(new Error('no fill'));
    expect(await ads.showRewarded('reveal')).toBe('unavailable');
    expect(stub.AdMob.showRewardVideoAd).not.toHaveBeenCalled();
  });

  it('reports unavailable when the load succeeds but the present throws', async () => {
    stub.AdMob.showRewardVideoAd.mockRejectedValueOnce(new Error('not ready'));
    expect(await ads.showRewarded('reveal')).toBe('unavailable');
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
    expect(stub.AdMob.prepareInterstitial).not.toHaveBeenCalled();

    await ads.showBanner();
    expect(stub.AdMob.showBanner).not.toHaveBeenCalled();
  });

  it('loses the banner the moment the purchase lands', async () => {
    await ads.init();
    await ads.showBanner();
    expect(stub.AdMob.showBanner).toHaveBeenCalledTimes(1);

    ads.setAdsRemoved(true);
    expect(stub.AdMob.removeBanner).toHaveBeenCalledTimes(1);
  });

  /* Rewarded helps the player, so taking it away would punish the buyer. */
  it('keeps the opt-in rewarded video', () => {
    ads.setAdsRemoved(true);
    expect(ads.rewardedAvailable).toBe(true);
  });
});

describe('the banner', () => {
  /*
   * BootScene starts the menu without waiting on AdMob, so the menu's
   * showBanner() lands before init() has resolved and the plugin quietly
   * refuses it. Without the replay the banner appears only on a fast network.
   */
  it('is replayed once the SDK is ready if it was asked for too early', async () => {
    await ads.showBanner();
    expect(stub.AdMob.showBanner).not.toHaveBeenCalled();

    await ads.init();
    expect(stub.AdMob.showBanner).toHaveBeenCalledTimes(1);
  });

  it('is not requested twice while it is already up', async () => {
    await ads.init();
    await ads.showBanner();
    await ads.showBanner();
    expect(stub.AdMob.showBanner).toHaveBeenCalledTimes(1);
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
    expect(stub.AdMob.showBanner).not.toHaveBeenCalled();

    await ads.releaseBanner();
    expect(stub.AdMob.showBanner).toHaveBeenCalledTimes(1);
  });

  it('does not conjure a banner nobody asked for when the hold lifts', async () => {
    await ads.init();
    ads.holdBanner();
    await ads.releaseBanner();
    expect(stub.AdMob.showBanner).not.toHaveBeenCalled();
  });

  /* Releasing twice must not stack a second request on top of the live one. */
  it('shows exactly one banner however often the hold is released', async () => {
    await ads.init();
    ads.holdBanner();
    await ads.showBanner();
    await ads.releaseBanner();
    await ads.releaseBanner();
    expect(stub.AdMob.showBanner).toHaveBeenCalledTimes(1);
  });
});

/*
 * LIVE_ANDROID is blank on purpose — there is no Play listing to draw unit ids
 * from — so `adsConfigured()` is false there and every path must no-op rather
 * than fire a request that could only fail. These assertions read the real
 * config, so they also fail loudly if someone commits `useTestAds: true`.
 */
describe('a platform with no ad units', () => {
  beforeEach(() => {
    stub.platform = 'android';
    ads = new AdsService();
  });

  it('turns every ad path into a no-op that still resolves', async () => {
    expect(adsConfigured()).toBe(false);
    expect(ads.enabled).toBe(false);
    expect(ads.rewardedAvailable).toBe(false);

    at(A.sessionWarmupSeconds + 600);
    await expect(ads.init()).resolves.toBeUndefined();
    await expect(ads.showBanner()).resolves.toBeUndefined();
    await expect(ads.hideBanner()).resolves.toBeUndefined();
    await expect(ads.showInterstitial()).resolves.toBe(false);
    await expect(ads.showRewarded('reveal')).resolves.toBe('unavailable');
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);
    expect(ads.wouldShowOnAttempt(PLAYING, 999)).toBe(false);

    expect(stub.AdMob.initialize).not.toHaveBeenCalled();
    expect(stub.AdMob.showBanner).not.toHaveBeenCalled();
    expect(stub.AdMob.prepareInterstitial).not.toHaveBeenCalled();
    expect(stub.AdMob.prepareRewardVideoAd).not.toHaveBeenCalled();
  });
});

describe('the web build', () => {
  beforeEach(() => {
    stub.platform = 'web';
    ads = new AdsService();
  });

  /* The daily fold ships to the browser, where there is no AdMob at all. */
  it('asks the plugin for nothing', async () => {
    at(A.sessionWarmupSeconds + 600);
    await ads.init();
    await ads.showBanner();

    expect(ads.enabled).toBe(false);
    expect(ads.rewardedAvailable).toBe(false);
    expect(ads.wouldShowInterstitial(PLAYING, 999)).toBe(false);
    expect(await ads.showRewarded('reveal')).toBe('unavailable');
    expect(stub.AdMob.initialize).not.toHaveBeenCalled();
    expect(stub.AdMob.showBanner).not.toHaveBeenCalled();
  });
});
