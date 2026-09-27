import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The LevelPlay provider is one long event race, and the expensive way to get it
 * wrong is silent: resolve a rewarded show on the wrong event and a skipped ad
 * reads as an earned reward, or the game sits with its loop paused for the whole
 * show timeout. The policy layer races show() against the dismissal watcher, so
 * exactly which event settles which promise IS the contract — these tests pin it
 * rather than trusting the comments. Ported from KVIZKO, which found every one
 * of these the hard way, with Foldwing's additions: the watcher's reason, the
 * silent show, consent state, and the keys resolved per platform at call time.
 */

// ── plugin double ────────────────────────────────────────────────────────────
// A tiny event bus standing in for the native SDK, so a test can say "the ad
// closed" and watch what the provider does about it.
type Handler = (info: unknown) => void;
const listeners = new Map<string, Set<Handler>>();
const calls: string[] = [];
/** Flipped per test: what getConsentData() reports after the CMP ran. */
let consentStatus = 'GRANTED';
/** Flipped per test: what the SDK says it holds when asked isReady(). */
const ready = { interstitial: false, rewarded: false };
/** Flipped per test: initialize() rejects, the way it does with no network. */
let initFails = false;
/** Flipped per test: a show call is refused natively ("not ready yet"). */
let showRefused = false;
/** Flipped per test: the platform Capacitor reports. */
let platform = 'ios';
/** The last argument each plugin call received, by name. */
const argsOf: Record<string, unknown> = {};
/** Every do_not_sell value sent, in order — the last one alone hides a missed re-grant. */
const doNotSell: boolean[] = [];
/**
 * Flipped per test: the consent modal never comes back — what UIKit does to an
 * alert presented from a view controller that is already presenting a sheet.
 */
let consentModalBlocked = false;
/** Set per test: initialize() waits on this, so a test can act while it is out. */
let initGate: Promise<void> | null = null;

function emit(event: string, info: unknown = {}): void {
  for (const h of [...(listeners.get(event) ?? [])]) h(info);
}
function listenerCount(): number {
  let n = 0;
  for (const set of listeners.values()) n += set.size;
  return n;
}

// The provider picks its app key and unit ids by platform, at call time.
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => platform !== 'web', getPlatform: () => platform },
}));

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
  const record =
    (name: string) =>
    (...args: unknown[]): Promise<unknown> => {
      calls.push(name);
      argsOf[name] = args[0];
      return Promise.resolve(undefined);
    };
  const show =
    (name: string) =>
    (): Promise<unknown> => {
      calls.push(name);
      return showRefused ? Promise.reject(new Error('The ad is not ready yet.')) : Promise.resolve(undefined);
    };
  return {
    AdEvent,
    LevelPlayAds: {
      initialize: async (...args: unknown[]) => {
        calls.push('initialize');
        argsOf.initialize = args[0];
        if (initGate) await initGate;
        if (initFails) throw new Error('init failed: no network');
        return { status: 'INITIALIZED_SUCCESSFULLY' };
      },
      setCCPAConsent: (o: { doNotSell: boolean }) => {
        doNotSell.push(o.doNotSell);
        return record('setCCPAConsent')(o);
      },
      setChildDirected: record('setChildDirected'),
      requestTrackingAuthorization: record('requestTrackingAuthorization'),
      requestConsentInfo: (...args: unknown[]) =>
        consentModalBlocked
          ? (calls.push('requestConsentInfo'), new Promise<never>(() => {}))
          : record('requestConsentInfo')(...args),
      showPrivacyOptions: record('showPrivacyOptions'),
      createBanner: record('createBanner'),
      showBanner: record('showBanner'),
      hideBanner: record('hideBanner'),
      destroyBanner: record('destroyBanner'),
      loadInterstitial: record('loadInterstitial'),
      showInterstitial: show('showInterstitial'),
      loadRewarded: record('loadRewarded'),
      showRewarded: show('showRewarded'),
      getConsentData: () => {
        calls.push('getConsentData');
        return Promise.resolve({ status: consentStatus });
      },
      isInterstitialReady: () => {
        calls.push('isInterstitialReady');
        return Promise.resolve({ isReady: ready.interstitial });
      },
      isRewardedReady: () => {
        calls.push('isRewardedReady');
        return Promise.resolve({ isReady: ready.rewarded });
      },
      addListener: (event: string, fn: Handler) => {
        calls.push(`addListener:${event}`);
        const set = listeners.get(event) ?? new Set<Handler>();
        set.add(fn);
        listeners.set(event, set);
        return Promise.resolve({
          remove: () => {
            set.delete(fn);
          },
        });
      },
    },
  };
});

const {
  levelplayProvider: provider,
  levelplayConfigured,
  openPrivacyOptions,
  __resetForTests,
} = await import('./levelplay');

const SOURCE = readFileSync(new URL('./levelplay.ts', import.meta.url), 'utf8');

/** Let the pending addListener promises resolve before firing anything. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  listeners.clear();
  calls.length = 0;
  consentStatus = 'GRANTED';
  ready.interstitial = false;
  ready.rewarded = false;
  initFails = false;
  showRefused = false;
  platform = 'ios';
  for (const k of Object.keys(argsOf)) delete argsOf[k];
  doNotSell.length = 0;
  consentModalBlocked = false;
  initGate = null;
  __resetForTests();
});

describe('formats this network actually has', () => {
  it('serves banner, interstitial and rewarded', () => {
    for (const f of ['banner', 'interstitial', 'rewarded'] as const) {
      expect(provider.supports(f), f).toBe(true);
    }
  });
});

describe('the Foldwing app in LevelPlay', () => {
  it('is configured on iOS, with its own key and three distinct units', async () => {
    expect(levelplayConfigured()).toBe(true);
    await provider.init();
    expect((argsOf.initialize as { appKey: string }).appKey).toBe('282ab31c5');
  });

  it('is not configured on Android or the web — there is no such app', () => {
    platform = 'android';
    expect(levelplayConfigured()).toBe(false);
    platform = 'web';
    expect(levelplayConfigured()).toBe(false);
  });

  it('refuses to start on a platform with no key, legibly', async () => {
    platform = 'android';
    await expect(provider.init()).rejects.toThrow(/no app key for platform "android"/);
    expect(calls).not.toContain('requestConsentInfo');
    expect(calls).not.toContain('initialize');
  });

  /*
   * A unit id belongs to one app. The iOS ids reused on another platform would
   * be an SDK that silently never fills, the failure mode nobody investigates.
   */
  it('keeps unit ids per platform, and never lends the iOS ones to Android', () => {
    const ios = ['h0a7k5pjpr3ziohk', 'w4ocqufvnz4i9mbt', 'e5mt76phyqseoqpa'];
    expect(new Set(ios).size).toBe(3);
    for (const id of ios) expect(SOURCE.split(id).length - 1, id).toBe(1);
    const android = SOURCE.slice(SOURCE.indexOf('  android: NO_UNITS'));
    for (const id of ios) expect(android).not.toContain(id);
  });

  it('asks each format for its own unit', async () => {
    // The prefetch is where the full-screen loads go out — the interstitial
    // never loads anywhere else.
    await provider.init();
    await settle();
    await provider.bannerShow();
    expect(argsOf.loadInterstitial).toEqual({ adUnitId: 'w4ocqufvnz4i9mbt' });
    expect(argsOf.loadRewarded).toEqual({ adUnitId: 'e5mt76phyqseoqpa' });
    expect(argsOf.createBanner).toMatchObject({ adUnitId: 'h0a7k5pjpr3ziohk' });
  });
});

describe('consent ordering', () => {
  /*
   * ironSource: "You must obtain user consent before initializing any
   * third-party SDK … If consent is not obtained, do not initialize the
   * LevelPlay SDK." initialize() transmits device data to configure the
   * waterfall, so init-before-consent leaks before the player is asked. The
   * AdMob code this replaces initialised first — correct for Google's UMP, and
   * exactly the habit that must not carry over.
   */
  it('asks for consent BEFORE it initializes the SDK', async () => {
    await provider.init();
    const order = calls.filter((c) =>
      ['requestTrackingAuthorization', 'requestConsentInfo', 'getConsentData', 'initialize'].includes(c)
    );
    expect(order).toEqual(['requestTrackingAuthorization', 'requestConsentInfo', 'getConsentData', 'initialize']);
  });

  it('does not initialize at all when no consent decision exists', async () => {
    consentStatus = 'UNKNOWN';
    await provider.init();
    expect(calls).not.toContain('initialize');
  });

  it('does not initialize when the player actively declined', async () => {
    /*
     * KVIZKO's guard once read `status === 'UNKNOWN'`, which let a DECLINE
     * through: the plugin returns UNKNOWN when the CMP never answered and
     * DENIED when it answered no, and only the first was being blocked.
     */
    consentStatus = 'DENIED';
    await provider.init();
    expect(calls).not.toContain('initialize');
  });

  it('subscribes to consent changes BEFORE it shows the modal', async () => {
    await provider.init();
    const listen = calls.indexOf('addListener:onConsentStatusChanged');
    const modal = calls.indexOf('requestConsentInfo');
    expect(listen).toBeGreaterThanOrEqual(0);
    expect(listen).toBeLessThan(modal);
  });

  it('starts the SDK when consent arrives AFTER init() gave up on it', async () => {
    consentStatus = 'UNKNOWN';
    await provider.init();
    await settle();
    expect(calls).not.toContain('initialize');
    emit('onConsentStatusChanged', { status: 'GRANTED', granted: true });
    await settle();
    expect(calls).toContain('initialize');
  });

  it('starts the SDK when a boot-time decline is reversed from Privacy choices', async () => {
    consentStatus = 'DENIED';
    await provider.init();
    await settle();
    expect(calls).not.toContain('initialize');
    emit('onConsentStatusChanged', { status: 'GRANTED', granted: true });
    await settle();
    expect(calls).toContain('initialize');
  });

  it('never starts on a change that is not a yes', async () => {
    consentStatus = 'UNKNOWN';
    await provider.init();
    await settle();
    emit('onConsentStatusChanged', { status: 'DENIED', granted: false });
    emit('onConsentStatusChanged', { status: 'UNKNOWN', granted: false });
    await settle();
    expect(calls).not.toContain('initialize');
  });

  it('starts the SDK once even when init() and the watcher both see the yes', async () => {
    await provider.init();
    await settle();
    emit('onConsentStatusChanged', { status: 'GRANTED', granted: true });
    emit('onConsentStatusChanged', { status: 'GRANTED', granted: true });
    await settle();
    expect(calls.filter((c) => c === 'initialize')).toHaveLength(1);
  });

  it('gives ATT and the consent modal separate ceilings', () => {
    // A hung ATT must not eat the modal's time — and a slow reader must not be
    // mistaken for a hung CMP. Both are visible only through the source.
    expect(SOURCE).toMatch(/withDeadline\(\s*LevelPlayAds\.requestTrackingAuthorization[\s\S]*?ATT_TIMEOUT_MS/);
    expect(SOURCE).toMatch(/withDeadline\(\s*LevelPlayAds\.requestConsentInfo[\s\S]*?CONSENT_TIMEOUT_MS/);
    const att = Number(/const ATT_TIMEOUT_MS = ([\d_]+)/.exec(SOURCE)?.[1].replace(/_/g, ''));
    const consent = Number(/const CONSENT_TIMEOUT_MS = ([\d_]+)/.exec(SOURCE)?.[1].replace(/_/g, ''));
    expect(consent).toBeGreaterThanOrEqual(att * 3);
  });
});

describe('what consent has settled on', () => {
  /*
   * The policy layer hides "Watch an ad" once consent is withheld, so this has
   * to be honest in both directions: never 'withheld' before anyone was asked,
   * and back to 'granted' the moment a later yes arrives.
   */
  it('is pending until the flow has answered', () => {
    expect(provider.consentState?.()).toBe('pending');
  });

  it('is granted after a yes', async () => {
    await provider.init();
    expect(provider.consentState?.()).toBe('granted');
  });

  it('is withheld after a decline', async () => {
    consentStatus = 'DENIED';
    await provider.init();
    expect(provider.consentState?.()).toBe('withheld');
  });

  /*
   * A flow that came back with no answer is not a decline. On this plugin the
   * usual cause is a modal that never reached the screen — UIKit refuses to
   * present over a controller already presenting Game Center's sign-in sheet —
   * and recording that as 'withheld' ended the session's ads for a player
   * nobody had asked.
   */
  it('stays pending after a flow that never answered — nobody declined', async () => {
    consentStatus = 'UNKNOWN';
    await provider.init();
    expect(provider.consentState?.()).toBe('pending');
    expect(calls).not.toContain('initialize');
  });

  it('follows a later change either way', async () => {
    consentStatus = 'DENIED';
    await provider.init();
    await settle();
    emit('onConsentStatusChanged', { status: 'GRANTED' });
    expect(provider.consentState?.()).toBe('granted');
    emit('onConsentStatusChanged', { status: 'DENIED' });
    expect(provider.consentState?.()).toBe('withheld');
  });
});

/*
 * "If you decline, Foldwing shows no ads at all" — and that has to hold for a
 * player who declines LATER, from Settings → Privacy choices, with the SDK
 * already up. The SDK cannot be stopped, but it can stop being asked: a retry
 * timer set a minute before the withdrawal used to fire loads for the rest of
 * the session.
 */
describe('a withdrawal of consent', () => {
  const loads = (): number => calls.filter((c) => c === 'loadInterstitial' || c === 'loadRewarded').length;

  it('stops every load, retry timers already set included', async () => {
    vi.useFakeTimers();
    try {
      await provider.init();
      await vi.advanceTimersByTimeAsync(10);
      emit('onInterstitialAdLoadFailed', { errorCode: 509 });
      emit('onRewardedAdLoadFailed', { errorCode: 509 });
      await vi.advanceTimersByTimeAsync(10); // both 30 s retries are pending now
      emit('onConsentStatusChanged', { status: 'DENIED' });
      calls.length = 0;
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(loads()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('schedules no retry for a load that fails after the withdrawal', async () => {
    vi.useFakeTimers();
    try {
      await provider.init();
      await vi.advanceTimersByTimeAsync(10); // both prefetches are out
      emit('onConsentStatusChanged', { status: 'DENIED' });
      emit('onInterstitialAdLoadFailed', { errorCode: 509 });
      emit('onRewardedAdLoadFailed', { errorCode: 509 });
      calls.length = 0;
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(loads()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fetches no successor for an ad closed after it', async () => {
    vi.useFakeTimers();
    try {
      await provider.init();
      await vi.advanceTimersByTimeAsync(10);
      emit('onRewardedAdLoaded');
      await vi.advanceTimersByTimeAsync(10);
      emit('onConsentStatusChanged', { status: 'DENIED' });
      calls.length = 0;
      emit('onRewardedAdClosed');
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(loads()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refills the cache when a later yes arrives with the SDK still up', async () => {
    vi.useFakeTimers();
    try {
      await provider.init();
      await vi.advanceTimersByTimeAsync(10);
      emit('onInterstitialAdLoadFailed', { errorCode: 509 });
      emit('onRewardedAdLoadFailed', { errorCode: 509 });
      await vi.advanceTimersByTimeAsync(10);
      emit('onConsentStatusChanged', { status: 'DENIED' });
      calls.length = 0;
      emit('onConsentStatusChanged', { status: 'GRANTED' });
      await vi.advanceTimersByTimeAsync(10);
      expect(calls).toContain('loadInterstitial');
      expect(calls).toContain('loadRewarded');
      expect(calls).not.toContain('initialize'); // up already: nothing to start
    } finally {
      vi.useRealTimers();
    }
  });

  it('while initialize() is still out loads nothing, and says do_not_sell once it is up', async () => {
    let finishInit!: () => void;
    initGate = new Promise<void>((r) => (finishInit = r));
    const booting = provider.init();
    await settle(); // consent answered GRANTED, initialize() is out
    expect(calls).toContain('initialize');
    emit('onConsentStatusChanged', { status: 'DENIED' });
    finishInit();
    await booting;
    await settle();
    expect(loads()).toBe(0);
    expect(doNotSell[doNotSell.length - 1]).toBe(true);
  });

  it('is applied when the Privacy choices call resolves, even if no event was heard', async () => {
    // Emits nothing and returns the answer: a watcher that missed the event
    // must not leave consentState() stale for the policy layer reading it next.
    await provider.init();
    await settle();
    const { LevelPlayAds } = await import('capacitor-levelplay-ads');
    const spy = vi.spyOn(LevelPlayAds, 'showPrivacyOptions').mockResolvedValueOnce({ status: 'DENIED' } as never);
    await openPrivacyOptions();
    expect(provider.consentState?.()).toBe('withheld');
    expect(doNotSell).toEqual([false, true]);
    spy.mockRestore();
  });
});

describe('a consent flow that came back unanswered', () => {
  const asks = (): number => calls.filter((c) => c === 'requestConsentInfo').length;

  /*
   * The proof scenario: Game Center's sheet holds the bridge view controller,
   * the consent alert is refused, and the modal's ceiling runs out. Before, the
   * session was 'withheld' and nothing ever asked again.
   */
  it('is asked again on the next return to the foreground, and starts the SDK on a yes', async () => {
    vi.useFakeTimers();
    try {
      consentStatus = 'UNKNOWN';
      consentModalBlocked = true;
      const booting = provider.init();
      await vi.advanceTimersByTimeAsync(140_000 + 20_000);
      await booting;
      expect(provider.consentState?.()).toBe('pending');
      expect(calls).not.toContain('initialize');
      expect(asks()).toBe(1);

      // The sheet is gone; this time the modal shows and the player accepts.
      consentModalBlocked = false;
      consentStatus = 'GRANTED';
      provider.retryInit?.();
      await vi.advanceTimersByTimeAsync(10);
      expect(asks()).toBe(2);
      expect(provider.consentState?.()).toBe('granted');
      expect(calls).toContain('initialize');
      expect(provider.sdkReady?.()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never stacks a second ask on one still out, and stays bounded by the returns', async () => {
    vi.useFakeTimers();
    try {
      consentStatus = 'UNKNOWN';
      consentModalBlocked = true;
      const booting = provider.init();
      await vi.advanceTimersByTimeAsync(160_000);
      await booting;
      provider.retryInit?.();
      provider.retryInit?.();
      provider.retryInit?.();
      await vi.advanceTimersByTimeAsync(10);
      expect(asks()).toBe(2); // one re-ask out, the other returns landed on it
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(asks()).toBe(2); // no timer asks on its own — only a return does
      provider.retryInit?.();
      await vi.advanceTimersByTimeAsync(10);
      expect(asks()).toBe(3);
      expect(provider.consentState?.()).toBe('pending');
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks nothing again after a real decline', async () => {
    consentStatus = 'DENIED';
    await provider.init();
    provider.retryInit?.();
    await settle();
    expect(asks()).toBe(1);
    expect(provider.consentState?.()).toBe('withheld');
  });
});

describe('the SDK being up', () => {
  it('is reported only once initialize() has resolved', async () => {
    expect(provider.sdkReady?.()).toBe(false);
    consentStatus = 'UNKNOWN';
    await provider.init();
    expect(provider.sdkReady?.()).toBe(false);
    consentStatus = 'GRANTED';
    __resetForTests();
    await provider.init();
    expect(provider.sdkReady?.()).toBe(true);
  });

  it('is not reported for an initialize() that failed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    initFails = true;
    await expect(provider.init()).rejects.toThrow();
    expect(provider.sdkReady?.()).toBe(false);
    vi.restoreAllMocks();
  });

  it('is announced to onReady listeners when a retry brings it up after init() gave up', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    initFails = true;
    await expect(provider.init()).rejects.toThrow();
    const heard = vi.fn();
    provider.onReady?.(heard);
    expect(heard).not.toHaveBeenCalled();
    initFails = false;
    provider.retryInit?.();
    await settle();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(provider.sdkReady?.()).toBe(true);
    vi.restoreAllMocks();
  });
});

describe('the consent modal copy', () => {
  /*
   * With no copy the plugin's alert names no network, says nothing about what
   * a decline costs, and drops the privacy-policy button altogether.
   */
  type Copy = {
    title: string;
    message: string;
    acceptButtonText: string;
    declineButtonText: string;
    privacyPolicyUrl: string;
  };

  it('names the network, the trade, the cost of declining and the way back', async () => {
    await provider.init();
    const copy = argsOf.requestConsentInfo as Copy;
    expect(copy.title.length).toBeGreaterThan(0);
    expect(copy.message).toContain('Unity LevelPlay');
    expect(copy.message).toMatch(/free/i);
    expect(copy.message).toMatch(/no ads at all/i);
    expect(copy.message).toMatch(/reveal/i);
    // The row in MenuScene's settings sheet carries this exact name.
    expect(copy.message).toContain('Settings → Privacy choices');
    expect(copy.acceptButtonText).toBe('Accept');
    expect(copy.declineButtonText).toBe('Decline');
    expect(copy.privacyPolicyUrl).toBe('https://www.noqyris.com/foldwing/privacy.html');
  });

  it('re-opens the same modal, with the same copy, from Privacy choices', async () => {
    await provider.init();
    const boot = argsOf.requestConsentInfo;
    await openPrivacyOptions();
    expect(argsOf.showPrivacyOptions).toEqual(boot);
  });

  it('points the modal at a row that really exists in Settings', () => {
    const menu = readFileSync(new URL('../../scenes/MenuScene.ts', import.meta.url), 'utf8');
    expect(menu).toContain("'Privacy choices'");
    expect(menu).toMatch(/Ads\.openPrivacyOptions\(\)/);
  });
});

describe('the test-ads badge must never light on this network', () => {
  /*
   * "Test ads" means "this build is safe to tap". LevelPlay has no build-time
   * test inventory — its isTesting flag only unlocks the Test Suite screen —
   * while show() serves the real waterfall in every build. Reporting
   * testing:true would put a safe-to-tap signal on a live-ads build, which is
   * exactly how the previous ad account was lost.
   */
  it('reports testing:false regardless of build mode', () => {
    expect(provider.testing).toBe(false);
  });

  it('still carries the ad-mode marker, which is a separate concern', () => {
    expect(provider.id).toMatch(/ADMODE:(test|live)/);
  });

  it('fails safe: only VITE_AD_MODE=live declares a live build', () => {
    // Asserted on the SOURCE, so it holds whichever mode the suite runs in:
    // what matters is the DIRECTION of the comparison. `!== 'live'` means every
    // forgotten path — a stray `vite build`, an Xcode archive, a typo — yields a
    // test-mode build, which every store gate refuses.
    expect(SOURCE).toContain("const TESTING = import.meta.env.VITE_AD_MODE !== 'live';");
    expect(SOURCE).toMatch(/testing: false,/);
  });
});

describe('rewarded — the race that decides reward vs skip', () => {
  it('resolves with the reward when the reward event fires', async () => {
    const pending = provider.showRewarded();
    await settle();
    emit('onRewardedAdRewarded', { rewardName: 'reveal', rewardAmount: 1 });
    await expect(pending).resolves.toMatchObject({ rewardAmount: 1 });
  });

  it('stays PENDING when the player just closes the ad', async () => {
    // The whole point. The policy layer races this promise against the
    // dismissal watcher and treats "watcher won" as "skipped". If close also
    // resolved here, a skipped ad would hand out the reward.
    const pending = provider.showRewarded();
    await settle();
    emit('onRewardedAdClosed');
    const outcome = await Promise.race([pending, settle().then(() => 'still-pending')]);
    expect(outcome).toBe('still-pending');
  });

  it('resolves null when the ad fails to present, so the race cannot hang', async () => {
    const pending = provider.showRewarded();
    await settle();
    emit('onRewardedAdDisplayFailed', { errorCode: 509 });
    await expect(pending).resolves.toBeNull();
  });

  it('resolves null when the show is refused natively, which emits nothing', async () => {
    showRefused = true;
    await expect(provider.showRewarded()).resolves.toBeNull();
  });

  it('subscribes BEFORE asking for the ad', async () => {
    void provider.showRewarded();
    await settle();
    const firstShow = calls.indexOf('showRewarded');
    const firstListen = calls.findIndex((c) => c.startsWith('addListener:'));
    expect(firstListen).toBeGreaterThanOrEqual(0);
    expect(firstListen).toBeLessThan(firstShow);
  });

  it('detaches its listeners once settled, so ads do not leak one each', async () => {
    const pending = provider.showRewarded();
    await settle();
    emit('onRewardedAdRewarded', {});
    await pending;
    await settle();
    expect(listenerCount()).toBe(0);
  });
});

describe('prefetch — the ad is loaded before the tap, not at it', () => {
  it('loads both formats the moment initialize() resolves', async () => {
    await provider.init();
    await settle();
    expect(calls).toContain('loadInterstitial');
    expect(calls).toContain('loadRewarded');
  });

  it('does not load anything while the SDK is down', async () => {
    consentStatus = 'UNKNOWN';
    await provider.init();
    await settle();
    expect(calls).not.toContain('loadInterstitial');
    expect(calls).not.toContain('loadRewarded');
  });

  it('answers a tap from the cache without a second load', async () => {
    await provider.init();
    await settle();
    emit('onRewardedAdLoaded');
    await settle();
    expect(provider.rewardedReady?.()).toBe(true);
    calls.length = 0;
    ready.rewarded = true;
    await expect(provider.loadRewarded()).resolves.toBe(true);
    expect(calls).not.toContain('loadRewarded');
  });

  it('lets a tap JOIN an in-flight prefetch instead of superseding it', async () => {
    await provider.init();
    await settle();
    // One prefetch is in flight. A tap now must not issue a second load —
    // the plugin fails the first one with "Superseded by a new load request".
    const tap = provider.loadRewarded();
    await settle();
    expect(calls.filter((c) => c === 'loadRewarded')).toHaveLength(1);
    emit('onRewardedAdLoaded');
    await expect(tap).resolves.toBe(true);
  });

  it('reports not-ready until an ad has actually loaded', async () => {
    await provider.init();
    await settle();
    expect(provider.rewardedReady?.()).toBe(false);
    emit('onRewardedAdLoadFailed', { errorCode: 509 });
    await settle();
    expect(provider.rewardedReady?.()).toBe(false);
  });

  it('fetches the next ad after the shown one closes', async () => {
    vi.useFakeTimers();
    try {
      await provider.init();
      await vi.advanceTimersByTimeAsync(10);
      emit('onRewardedAdLoaded');
      await vi.advanceTimersByTimeAsync(10);
      expect(provider.rewardedReady?.()).toBe(true);
      calls.length = 0;
      emit('onRewardedAdClosed');
      expect(provider.rewardedReady?.()).toBe(false);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(calls).toContain('loadRewarded');
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a missed prefetch with backoff, never in a tight loop', async () => {
    vi.useFakeTimers();
    try {
      await provider.init();
      await vi.advanceTimersByTimeAsync(10);
      emit('onRewardedAdLoadFailed', { errorCode: 509 });
      await vi.advanceTimersByTimeAsync(10);
      expect(calls.filter((c) => c === 'loadRewarded')).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(29_000);
      expect(calls.filter((c) => c === 'loadRewarded')).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(calls.filter((c) => c === 'loadRewarded')).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('interstitial', () => {
  /*
   * CACHE ONLY. The interstitial is asked for at a break the player did not
   * choose, and they are drawing again within a second. A load at the break —
   * or joining the prefetch already out — let a fill land seconds later and put
   * a full-screen ad under a finger mid-stroke. So the break shows what is
   * cached, or nothing, and answers without waiting on any Loaded event.
   */
  it('load answers true from a warm cache, without loading anything', async () => {
    ready.interstitial = true;
    await expect(provider.loadInterstitial()).resolves.toBe(true);
    expect(calls).toContain('isInterstitialReady');
    expect(calls).not.toContain('loadInterstitial');
  });

  it('load answers false from a cold cache at once — no Loaded event is awaited', async () => {
    vi.useFakeTimers();
    try {
      let answer: boolean | undefined;
      void provider.loadInterstitial().then((v) => (answer = v));
      // Microtasks only: not one millisecond of fake time passes.
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
      expect(answer).toBe(false);
      expect(calls).not.toContain('loadInterstitial');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a break never joins the prefetch that is out — it answers false without it', async () => {
    await provider.init();
    await settle();
    expect(calls.filter((c) => c === 'loadInterstitial')).toHaveLength(1); // the prefetch
    await expect(provider.loadInterstitial()).resolves.toBe(false);
    expect(calls.filter((c) => c === 'loadInterstitial')).toHaveLength(1);
    // The prefetch it did not join still fills the NEXT break.
    emit('onInterstitialAdLoaded');
    await settle();
    ready.interstitial = true;
    await expect(provider.loadInterstitial()).resolves.toBe(true);
  });

  it('breaks inside a backoff window send no request of their own', async () => {
    vi.useFakeTimers();
    try {
      await provider.init();
      await vi.advanceTimersByTimeAsync(10);
      emit('onInterstitialAdLoadFailed', { errorCode: 509 }); // the 30 s retry is now pending
      await vi.advanceTimersByTimeAsync(10);
      const loads = (): number => calls.filter((c) => c === 'loadInterstitial').length;
      expect(loads()).toBe(1);
      for (let i = 0; i < 5; i += 1) {
        await expect(provider.loadInterstitial()).resolves.toBe(false);
        await vi.advanceTimersByTimeAsync(1_000);
      }
      expect(loads()).toBe(1);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(loads()).toBe(2); // the backoff's own retry, and only that
    } finally {
      vi.useRealTimers();
    }
  });

  it('a miss with no retry pending asks for the next break in the background', async () => {
    await provider.init();
    await settle();
    emit('onInterstitialAdLoaded');
    await settle();
    // The SDK dropped the ad it held (expired): the break misses, and refills.
    ready.interstitial = false;
    calls.length = 0;
    await expect(provider.loadInterstitial()).resolves.toBe(false);
    expect(calls).toContain('loadInterstitial');
  });

  it('a tap-time rewarded load resolves false, not null, when nothing is heard', async () => {
    vi.useFakeTimers();
    try {
      const pending = provider.loadRewarded();
      await vi.advanceTimersByTimeAsync(20_000);
      await expect(pending).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('show settles at PRESENT time, which is what resolvesOnPresent promises', async () => {
    expect(provider.resolvesOnPresent('interstitial')).toBe(true);
    const pending = provider.showInterstitial();
    await settle();
    emit('onInterstitialAdDisplayed');
    await expect(pending).resolves.toBe(true);
  });

  it('show resolves false on a failed present', async () => {
    const pending = provider.showInterstitial();
    await settle();
    emit('onInterstitialAdDisplayFailed', { errorCode: 509 });
    await expect(pending).resolves.toBe(false);
  });

  it('show resolves false when the call is refused natively, which emits nothing', async () => {
    showRefused = true;
    await expect(provider.showInterstitial()).resolves.toBe(false);
  });

  /*
   * Silence is not failure. A Displayed event that never arrives may be an ad
   * on screen with its event lost, and the policy layer stamps the time floor
   * on exactly this value so a second interstitial cannot land on a live one.
   */
  it('show resolves NULL when neither Displayed nor DisplayFailed arrives', async () => {
    vi.useFakeTimers();
    try {
      const pending = provider.showInterstitial();
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(pending).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rewarded does NOT settle at present time', () => {
    expect(provider.resolvesOnPresent('rewarded')).toBe(false);
  });
});

describe('dismissal watcher', () => {
  it('fires on close, and says so', async () => {
    const w = provider.watchDismissal('interstitial', 5000);
    expect(w.reason()).toBeNull();
    await settle();
    emit('onInterstitialAdClosed');
    await expect(w.done).resolves.toBeUndefined();
    expect(w.reason()).toBe('closed');
  });

  it('also fires on a failed present, which never emits a close — and says that instead', async () => {
    const w = provider.watchDismissal('rewarded', 5000);
    await settle();
    emit('onRewardedAdDisplayFailed');
    await expect(w.done).resolves.toBeUndefined();
    expect(w.reason()).toBe('failed');
  });

  it('reports a timeout as a timeout', async () => {
    vi.useFakeTimers();
    try {
      const w = provider.watchDismissal('rewarded', 5000);
      await vi.advanceTimersByTimeAsync(5000);
      await expect(w.done).resolves.toBeUndefined();
      expect(w.reason()).toBe('timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancel() releases the wait and its listeners', async () => {
    const w = provider.watchDismissal('rewarded', 5000);
    await settle();
    w.cancel();
    await expect(w.done).resolves.toBeUndefined();
    expect(w.reason()).toBe('cancelled');
    expect(listenerCount()).toBe(0);
  });

  it('keeps the first reason — a cancel after a close is still a close', async () => {
    const w = provider.watchDismissal('rewarded', 5000);
    await settle();
    emit('onRewardedAdClosed');
    w.cancel();
    expect(w.reason()).toBe('closed');
  });
});

describe('banner', () => {
  it('creates once, then only shows — a second create would stack two banners', async () => {
    await provider.bannerShow();
    await provider.bannerShow();
    expect(calls.filter((c) => c === 'createBanner')).toHaveLength(1);
    expect(calls.filter((c) => c === 'showBanner')).toHaveLength(1);
  });

  it('creates again after a destroy', async () => {
    await provider.bannerShow();
    await provider.bannerRemove();
    await provider.bannerShow();
    expect(calls.filter((c) => c === 'createBanner')).toHaveLength(2);
  });

  /*
   * Fixed 320x50 at the bottom. ADAPTIVE varies by device, and the strip the
   * scenes keep clear (METRICS.bannerReserve) is a fixed one.
   */
  it('asks for the fixed-size banner at the bottom', async () => {
    await provider.bannerShow();
    expect(argsOf.createBanner).toMatchObject({ adSize: 'BANNER', position: 'BOTTOM' });
  });
});

describe('regulation flags go in BEFORE initialize()', () => {
  it('sets CCPA and COPPA ahead of the SDK start', async () => {
    await provider.init();
    const order = calls.filter((c) => ['setCCPAConsent', 'setChildDirected', 'initialize'].includes(c));
    expect(order.indexOf('initialize')).toBeGreaterThan(order.indexOf('setCCPAConsent'));
    expect(order.indexOf('initialize')).toBeGreaterThan(order.indexOf('setChildDirected'));
  });

  it('declares the app not child-directed — a property of the app, not the player', async () => {
    await provider.init();
    expect(argsOf.setChildDirected).toEqual({ isChildDirected: false });
  });

  it('does not sell only when the player has said yes, which is the only time it starts', async () => {
    await provider.init();
    expect(argsOf.setCCPAConsent).toEqual({ doNotSell: false });
  });

  /*
   * startSdk() sets the flags once per process, so a re-grant after a
   * withdrawal used to leave do_not_sell=true for the rest of the session: the
   * player's latest answer, not honoured.
   */
  it('follows accept → withdraw → accept with do_not_sell each way', async () => {
    await provider.init();
    await settle();
    emit('onConsentStatusChanged', { status: 'DENIED' });
    emit('onConsentStatusChanged', { status: 'GRANTED' });
    await settle();
    expect(doNotSell).toEqual([false, true, false]);
    expect(provider.consentState?.()).toBe('granted');
  });

  it('flips do_not_sell the moment consent is withdrawn after the SDK is up', async () => {
    await provider.init();
    await settle();
    emit('onConsentStatusChanged', { status: 'DENIED', granted: false });
    await settle();
    expect(argsOf.setCCPAConsent).toEqual({ doNotSell: true });
  });
});

describe('init retry — a tunnel at boot is not a session without ads', () => {
  const initializes = (): number => calls.filter((c) => c === 'initialize').length;

  // Every failed retry is logged on purpose; the suite output need not carry it.
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries a failed initialize at 30 s, 60 s and 120 s, then stops', async () => {
    vi.useFakeTimers();
    try {
      initFails = true;
      await expect(provider.init()).rejects.toThrow();
      expect(initializes()).toBe(1);
      await vi.advanceTimersByTimeAsync(29_900);
      expect(initializes()).toBe(1);
      await vi.advanceTimersByTimeAsync(200);
      expect(initializes()).toBe(2);
      await vi.advanceTimersByTimeAsync(59_800);
      expect(initializes()).toBe(2);
      await vi.advanceTimersByTimeAsync(200);
      expect(initializes()).toBe(3);
      await vi.advanceTimersByTimeAsync(119_800);
      expect(initializes()).toBe(3);
      await vi.advanceTimersByTimeAsync(200);
      expect(initializes()).toBe(4);
      // the timed budget is spent — no fifth attempt however long we wait
      await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
      expect(initializes()).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a retry that succeeds brings the SDK up, sets the flags again and starts the prefetch', async () => {
    vi.useFakeTimers();
    try {
      initFails = true;
      await expect(provider.init()).rejects.toThrow();
      calls.length = 0;
      initFails = false;
      await vi.advanceTimersByTimeAsync(30_100);
      expect(initializes()).toBe(1);
      expect(calls.indexOf('setCCPAConsent')).toBeLessThan(calls.indexOf('initialize'));
      expect(calls).toContain('loadInterstitial');
      expect(calls).toContain('loadRewarded');
      calls.length = 0;
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(initializes()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops retrying the moment consent is withdrawn', async () => {
    vi.useFakeTimers();
    try {
      initFails = true;
      await expect(provider.init()).rejects.toThrow();
      emit('onConsentStatusChanged', { status: 'DENIED', granted: false });
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(initializes()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a return to the foreground retries at once, and never runs two inits', async () => {
    vi.useFakeTimers();
    try {
      initFails = true;
      await expect(provider.init()).rejects.toThrow();
      initFails = false;
      provider.retryInit?.();
      provider.retryInit?.(); // the second lands on the in-flight start
      await vi.advanceTimersByTimeAsync(10);
      expect(initializes()).toBe(2);
      // up now: further returns are no-ops, and the pending timer was cancelled
      provider.retryInit?.();
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(initializes()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a foreground return keeps failing inside the same bounded budget', async () => {
    vi.useFakeTimers();
    try {
      initFails = true;
      await expect(provider.init()).rejects.toThrow();
      for (let i = 0; i < 10; i++) {
        provider.retryInit?.();
        await vi.advanceTimersByTimeAsync(10);
      }
      expect(initializes()).toBe(11); // every return is one attempt…
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(initializes()).toBe(11); // …but the timers were used up by the first three
    } finally {
      vi.useRealTimers();
    }
  });

  it('a foreground return without consent starts nothing', async () => {
    consentStatus = 'UNKNOWN';
    await provider.init();
    provider.retryInit?.();
    await settle();
    expect(calls).not.toContain('initialize');
  });

  it('a fresh GRANTED after the budget is spent tries again', async () => {
    vi.useFakeTimers();
    try {
      initFails = true;
      await expect(provider.init()).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(initializes()).toBe(4);
      initFails = false;
      emit('onConsentStatusChanged', { status: 'GRANTED', granted: true });
      await vi.advanceTimersByTimeAsync(10);
      expect(initializes()).toBe(5);
      expect(calls).toContain('loadRewarded');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('build modes', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Both markers are module constants folded at load, so the top-level
  // `provider` carries whatever the PROCESS env said — and the release chains
  // run vitest with it set: `ios:appstore` exports VITE_AD_MODE=live,
  // `ios:sync:adsoff` exports VITE_ADS=off, both BEFORE `vite build`. "The
  // default build" therefore has to be pinned, never assumed, or stage 2 of the
  // App Store chain fails on a test that asserts the TestFlight marker. Last in
  // the file on purpose: resetModules() hands back a fresh provider instance.
  async function fresh(env: Record<string, string>): Promise<typeof import('./levelplay')> {
    vi.stubEnv('VITE_AD_MODE', '');
    vi.stubEnv('VITE_ADS', '');
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.resetModules();
    return import('./levelplay');
  }

  it('carries ADS:on in the id by default, next to the ADMODE marker', async () => {
    const { id } = (await fresh({})).levelplayProvider;
    expect(id).toBe('levelplay ADMODE:test ADS:on');
  });

  it('bakes ADS:off into the id under VITE_ADS=off, and stays an ADMODE:test build', async () => {
    const { id } = (await fresh({ VITE_ADS: 'off' })).levelplayProvider;
    expect(id).toBe('levelplay ADMODE:test ADS:off');
  });

  it('bakes ADMODE:live under VITE_AD_MODE=live — and ADS:on stays, whatever else is set', async () => {
    const { id } = (await fresh({ VITE_AD_MODE: 'live' })).levelplayProvider;
    expect(id).toBe('levelplay ADMODE:live ADS:on');
  });

  it('unlocks the Test Suite flag everywhere except the live build — and serves real ads in both', async () => {
    const test = await fresh({});
    test.__resetForTests();
    await test.levelplayProvider.init();
    expect((argsOf.initialize as { isTesting: boolean }).isTesting).toBe(true);
    expect(test.levelplayProvider.testing).toBe(false);

    const live = await fresh({ VITE_AD_MODE: 'live' });
    live.__resetForTests();
    await live.levelplayProvider.init();
    expect((argsOf.initialize as { isTesting: boolean }).isTesting).toBe(false);
    expect(live.levelplayProvider.testing).toBe(false);
  });
});
