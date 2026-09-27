import { afterAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

/*
 * The policy layer over the REAL LevelPlay provider, over a plugin double.
 *
 * Ads.test.ts pins the policy against a fake provider, and levelplay.test.ts
 * pins the provider against the plugin. Every defect in this file lived in the
 * gap between the two: each half did what its own tests said, and the player
 * still got a banner that outlived a withdrawal of consent, an interstitial that
 * loaded at the break and landed mid-stroke, a banner that never came after an
 * offline launch, or a session with no ads because a consent alert never
 * reached the screen. So these run both halves together and assert on what
 * reaches the native plugin.
 */

type Handler = (info: unknown) => void;

const h = vi.hoisted(() => {
  const listeners = new Map<string, Set<Handler>>();
  const calls: string[] = [];
  const st = {
    /** What the SDK has stored — what getConsentData() reads back. */
    consent: 'GRANTED',
    /** What the player taps whenever a consent modal does reach the screen. */
    answer: 'GRANTED',
    /** The modal never appears and never calls back: UIKit refused to present it. */
    modalBlocked: false,
    initFails: false,
    initialized: false,
    /** Whether a load fills. */
    fill: { interstitial: false, rewarded: false } as Record<string, boolean>,
    /** What the SDK holds, as isReady() reports it. */
    ready: { interstitial: false, rewarded: false } as Record<string, boolean>,
    doNotSell: [] as boolean[],
    /** iOS's app state, as @capacitor/app reports it. */
    active: true,
    /** Whoever waits on appStateChange. */
    stateListeners: new Set<(s: { isActive: boolean }) => void>(),
    /** The opening film: resolved means gone. */
    intro: Promise.resolve(),
    introGone: (): void => {},
  };
  const emit = (event: string, info: unknown = {}): void => {
    for (const fn of [...(listeners.get(event) ?? [])]) fn(info);
  };
  const reset = (): void => {
    listeners.clear();
    calls.length = 0;
    Object.assign(st, {
      consent: 'GRANTED',
      answer: 'GRANTED',
      modalBlocked: false,
      initFails: false,
      initialized: false,
      fill: { interstitial: false, rewarded: false },
      ready: { interstitial: false, rewarded: false },
      doNotSell: [],
      active: true,
      intro: Promise.resolve(),
    });
    st.stateListeners.clear();
  };
  /** iOS moves the app to `active`, and tells whoever listens. */
  const setActive = (active: boolean): void => {
    st.active = active;
    for (const fn of [...st.stateListeners]) fn({ isActive: active });
  };
  /** The film is on screen until `st.introGone()` takes it off. */
  const filmPlaying = (): void => {
    st.intro = new Promise<void>((r) => (st.introGone = r));
  };
  return { listeners, calls, st, emit, reset, setActive, filmPlaying };
});

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
}));
/*
 * The starter gate runs for real here: the film and iOS's app state are the
 * two things it reads, so those are what is faked.
 */
vi.mock('@capacitor/app', () => ({
  App: {
    getState: async () => ({ isActive: h.st.active }),
    addListener: (_event: string, fn: (s: { isActive: boolean }) => void) => {
      h.st.stateListeners.add(fn);
      return Promise.resolve({ remove: async () => void h.st.stateListeners.delete(fn) });
    },
  },
}));
vi.mock('@noqyris/splash', () => ({ whenIntroDone: () => h.st.intro }));
vi.mock('./gameLoop', () => ({ pauseGameLoop: () => {}, resumeGameLoop: () => {}, registerGame: () => {} }));
vi.mock('./Music', () => ({ Music: { stop: () => {}, start: () => {} } }));
vi.mock('./Audio', () => ({ Audio: { unlock: () => {} } }));

vi.mock('capacitor-levelplay-ads', () => {
  const AdEvent = {
    InterstitialLoaded: 'onInterstitialAdLoaded',
    InterstitialLoadFailed: 'onInterstitialAdLoadFailed',
    InterstitialDisplayed: 'onInterstitialAdDisplayed',
    InterstitialDisplayFailed: 'onInterstitialAdDisplayFailed',
    InterstitialClosed: 'onInterstitialAdClosed',
    RewardedLoaded: 'onRewardedAdLoaded',
    RewardedLoadFailed: 'onRewardedAdLoadFailed',
    RewardedDisplayFailed: 'onRewardedAdDisplayFailed',
    RewardedClosed: 'onRewardedAdClosed',
    RewardedRewarded: 'onRewardedAdRewarded',
    ConsentStatusChanged: 'onConsentStatusChanged',
  };
  const record = (name: string) => (): Promise<void> => {
    h.calls.push(name);
    return Promise.resolve();
  };
  /** Like the plugin's ensureReady(): nothing ad-shaped before initialize(). */
  const notUp = (): Promise<never> => Promise.reject(new Error('LevelPlay is not initialized.'));
  const load = (format: 'interstitial' | 'rewarded', loaded: string, failed: string) => (): Promise<void> => {
    h.calls.push(format === 'interstitial' ? 'loadInterstitial' : 'loadRewarded');
    if (!h.st.initialized) return notUp();
    setTimeout(() => {
      if (!h.st.fill[format]) return h.emit(failed, { errorCode: 509 });
      h.st.ready[format] = true;
      h.emit(loaded, {});
    }, 50);
    return Promise.resolve();
  };
  /** The native side notifies the decision BEFORE it resolves the call. */
  const decide = (): { status: string } => {
    h.emit('onConsentStatusChanged', { status: h.st.consent });
    return { status: h.st.consent };
  };
  return {
    AdEvent,
    LevelPlayAds: {
      initialize: () => {
        h.calls.push('initialize');
        if (h.st.initFails) return Promise.reject(new Error('init failed: no network'));
        h.st.initialized = true;
        return Promise.resolve({ status: 'INITIALIZED_SUCCESSFULLY' });
      },
      setCCPAConsent: (o: { doNotSell: boolean }) => {
        h.st.doNotSell.push(o.doNotSell);
        return Promise.resolve();
      },
      setChildDirected: () => Promise.resolve(),
      requestTrackingAuthorization: () => {
        // What iOS does with an ATT request made while the app is not active:
        // nothing on screen, and notDetermined back.
        h.calls.push(h.st.active ? 'requestTrackingAuthorization' : 'requestTrackingAuthorization:inactive');
        return Promise.resolve({ status: h.st.active ? 'authorized' : 'notDetermined' });
      },
      requestConsentInfo: () => {
        h.calls.push('requestConsentInfo');
        if (h.st.consent !== 'UNKNOWN') return Promise.resolve(decide());
        if (h.st.modalBlocked) return new Promise<never>(() => {});
        h.st.consent = h.st.answer;
        return Promise.resolve(decide());
      },
      showPrivacyOptions: () => {
        h.calls.push('showPrivacyOptions');
        h.st.consent = h.st.answer;
        return Promise.resolve(decide());
      },
      getConsentData: () => Promise.resolve({ status: h.st.consent }),
      createBanner: () => {
        h.calls.push('createBanner');
        return h.st.initialized ? Promise.resolve() : notUp();
      },
      showBanner: record('showBanner'),
      hideBanner: record('hideBanner'),
      destroyBanner: record('destroyBanner'),
      loadInterstitial: load('interstitial', 'onInterstitialAdLoaded', 'onInterstitialAdLoadFailed'),
      loadRewarded: load('rewarded', 'onRewardedAdLoaded', 'onRewardedAdLoadFailed'),
      isInterstitialReady: () => Promise.resolve({ isReady: h.st.ready.interstitial }),
      isRewardedReady: () => Promise.resolve({ isReady: h.st.ready.rewarded }),
      showInterstitial: () => {
        h.calls.push('showInterstitial');
        if (!h.st.ready.interstitial) return Promise.reject(new Error('The interstitial ad is not ready yet.'));
        h.st.ready.interstitial = false;
        setTimeout(() => h.emit('onInterstitialAdDisplayed', {}), 10);
        setTimeout(() => h.emit('onInterstitialAdClosed', {}), 3_000);
        return Promise.resolve();
      },
      showRewarded: () => {
        h.calls.push('showRewarded');
        return Promise.reject(new Error('The rewarded ad is not ready yet.'));
      },
      addListener: (event: string, fn: Handler) => {
        const set = h.listeners.get(event) ?? new Set<Handler>();
        set.add(fn);
        h.listeners.set(event, set);
        return Promise.resolve({ remove: () => void set.delete(fn) });
      },
    },
  };
});

// A normal ads-on build, whatever the release chain running this suite exported.
vi.stubEnv('VITE_ADS', '');
vi.stubEnv('VITE_AD_MODE', '');
vi.resetModules();
const { AdsService } = await import('./Ads');
const { __resetForTests } = await import('./providers/levelplay');

afterAll(() => {
  vi.unstubAllEnvs();
});

const count = (name: string): number => h.calls.filter((c) => c === name).length;
const loads = (): number => count('loadInterstitial') + count('loadRewarded');
/** Microtasks only — not one millisecond of fake time. */
const microtasks = async (): Promise<void> => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
};

let ads: InstanceType<typeof AdsService>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-09-16T10:00:00Z'));
  h.reset();
  __resetForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  ads = new AdsService();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Settings → Privacy choices', () => {
  it('a Decline destroys the live banner and ends every ad request; an Accept brings both back', async () => {
    await ads.showBanner(); // the menu's want, during the film
    await ads.init();
    await vi.advanceTimersByTimeAsync(100); // both prefetches miss: 30 s retries pending
    expect(count('createBanner')).toBe(1);
    expect(h.st.doNotSell).toEqual([false]);

    h.calls.length = 0;
    h.st.answer = 'DENIED';
    await ads.openPrivacyOptions();
    expect(count('destroyBanner')).toBe(1);
    expect(ads.enabled).toBe(false);
    expect(ads.rewardedAvailable).toBe(false);

    await ads.showBanner(); // every later scene asks
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(loads()).toBe(0);
    expect(count('createBanner')).toBe(0);
    expect(count('showBanner')).toBe(0);
    expect(count('destroyBanner')).toBe(1);

    h.st.answer = 'GRANTED';
    await ads.openPrivacyOptions();
    await vi.advanceTimersByTimeAsync(100);
    expect(count('createBanner')).toBe(1);
    expect(loads()).toBeGreaterThan(0);
    expect(ads.rewardedAvailable).toBe(true);
    // do_not_sell followed every answer, the re-grant included.
    expect(h.st.doNotSell).toEqual([false, true, false]);
  });
});

describe('the interstitial at a break', () => {
  it('with a cold cache and a retry pending: nothing requested, nothing shown, answered at once', async () => {
    await ads.init();
    await vi.advanceTimersByTimeAsync(100); // the prefetch missed; its retry is pending
    h.st.fill.interstitial = true; // a load now WOULD fill — seconds after the gate
    h.calls.length = 0;

    let shown: boolean | undefined;
    void ads.showInterstitial().then((v) => (shown = v));
    await microtasks();
    expect(shown).toBe(false);
    expect(count('loadInterstitial')).toBe(0);

    // Nothing lands later either, under a finger already drawing again.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(count('showInterstitial')).toBe(0);
  });

  it('with a warm cache: shows, and comes back when the player closes it', async () => {
    await ads.init();
    h.st.ready.interstitial = true;
    let shown: boolean | undefined;
    void ads.showInterstitial().then((v) => (shown = v));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(count('showInterstitial')).toBe(1);
    expect(shown).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_100);
    expect(shown).toBe(true);
  });
});

describe('an offline launch', () => {
  it('promises no rewarded ad, then gets its banner and offers when a retry brings the SDK up — no scene recreated', async () => {
    h.st.initFails = true;
    await ads.showBanner();
    await ads.init();
    await vi.advanceTimersByTimeAsync(10);
    expect(ads.rewardedAvailable).toBe(false); // the skip pill says "Skip this fold"
    expect(await ads.showRewarded('skip')).toBe('unavailable');
    expect(count('createBanner')).toBe(0); // nothing to create it in
    const bootInits = count('initialize');

    h.st.initFails = false; // back in coverage
    await vi.advanceTimersByTimeAsync(30_100);
    expect(count('initialize')).toBe(bootInits + 1); // the timed retry
    expect(count('createBanner')).toBe(1);
    expect(h.calls.lastIndexOf('createBanner')).toBeGreaterThan(h.calls.lastIndexOf('initialize'));
    expect(ads.rewardedAvailable).toBe(true);
  });
});

describe('a consent alert that never reached the screen', () => {
  it('holds Game Center back until the flow ends, records no decline, and asks again on the next return', async () => {
    h.st.consent = 'UNKNOWN';
    h.st.modalBlocked = true; // Game Center's sheet holds the view controller
    let flowDone = false;
    void ads.consentFlowDone.then(() => (flowDone = true));

    await ads.showBanner();
    void ads.init();
    await vi.advanceTimersByTimeAsync(100_000);
    expect(flowDone).toBe(false); // the alert may still be on screen

    await vi.advanceTimersByTimeAsync(60_000);
    expect(flowDone).toBe(true);
    expect(count('initialize')).toBe(0);
    expect(ads.enabled).toBe(true); // not a decline — the banner want survives
    expect(ads.rewardedAvailable).toBe(false); // but nothing can load yet

    // The sheet is gone. The player comes back to the app; this time the
    // alert shows, and they accept.
    h.st.modalBlocked = false;
    h.st.answer = 'GRANTED';
    ads.foregrounded();
    await vi.advanceTimersByTimeAsync(100);
    expect(count('requestConsentInfo')).toBe(2);
    expect(count('initialize')).toBe(1);
    expect(count('createBanner')).toBe(1);
    expect(ads.rewardedAvailable).toBe(true);
  });
});

/*
 * The ATT trap, end to end: the policy layer, the real provider and the real
 * starter gate, with iOS's rule faked in the plugin double — an ATT request
 * made while the app is not active shows nothing and answers notDetermined.
 */
describe('ATT, never while the app is inactive', () => {
  it('asks nothing at launch until the film is gone AND the app is active', async () => {
    h.filmPlaying();
    const booting = ads.init();
    await vi.advanceTimersByTimeAsync(9_000); // main.ts's backstop came due in the background
    expect(count('requestConsentInfo')).toBe(0);

    h.setActive(false); // coming back: willEnterForeground, not yet active
    h.st.introGone(); // the film's overdue cap timer fires in that window
    await vi.advanceTimersByTimeAsync(10);
    expect(h.calls.filter((c) => c.startsWith('requestTrackingAuthorization'))).toEqual([]);
    expect(count('requestConsentInfo')).toBe(0);

    h.setActive(true); // didBecomeActive, ~300 ms later
    await booting;
    expect(h.calls.filter((c) => c.startsWith('requestTrackingAuthorization'))).toEqual(['requestTrackingAuthorization']);
    expect(count('initialize')).toBe(1);
  });

  it('re-asks an unanswered flow on a return only once the app is active', async () => {
    h.st.consent = 'UNKNOWN';
    h.st.modalBlocked = true;
    void ads.init();
    await vi.advanceTimersByTimeAsync(160_000); // the flow runs out, unanswered
    const asked = count('requestTrackingAuthorization');

    h.st.modalBlocked = false;
    h.setActive(false);
    ads.foregrounded(); // visibilitychange: still inactive
    await vi.advanceTimersByTimeAsync(10);
    expect(count('requestTrackingAuthorization:inactive')).toBe(0);
    expect(count('requestTrackingAuthorization')).toBe(asked);

    h.setActive(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(count('requestTrackingAuthorization')).toBe(asked + 1);
    expect(count('requestTrackingAuthorization:inactive')).toBe(0);
    expect(count('initialize')).toBe(1);
  });
});
