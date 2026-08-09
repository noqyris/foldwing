/**
 * Ads — AdMob, with the policy baked in here rather than at the call sites.
 *
 * Call sites ask "may I?" and "show it"; they never decide cadence. That keeps
 * one source of truth for whether an interruption is allowed right now, which
 * is what lets the rating prompt and the upsell stay out of the ad's way.
 *
 * Every method swallows its own errors. A no-fill, a network drop or a
 * misbehaving creative must never be able to break a level.
 */

import { Capacitor } from '@capacitor/core';
import {
  AdMob,
  AdmobConsentStatus,
  BannerAdPosition,
  BannerAdSize,
  InterstitialAdPluginEvents,
  RewardAdPluginEvents,
  type AdMobRewardItem,
} from '@capacitor-community/admob';
import { admobUnits, adsConfigured, monetization } from '../config/monetization';

const isNative = (): boolean => Capacitor.isNativePlatform();

class AdsService {
  private ready = false;
  private adsRemoved = false;
  private bannerShown = false;
  /**
   * A banner was asked for before the SDK was ready.
   *
   * BootScene starts the menu without waiting on AdMob — gameplay must never
   * wait on an ad SDK — so the menu's showBanner() call usually lands before
   * initialize() has resolved and the plugin quietly refuses it. Remembering
   * the request and replaying it after init is the difference between a banner
   * that always appears and one that appears only when the network is fast.
   */
  private bannerWanted = false;

  /**
   * False whenever ATT or UMP has not given us permission to personalise.
   *
   * Every request then carries npa=1. This is what makes the App Store answer
   * "limits ad tracking: yes" true rather than aspirational — and the default is
   * the restrictive one, so a consent call that throws leaves us non-personalised
   * instead of quietly tracking people.
   */
  private personalized = false;

  private sessionStartedAt = Date.now();
  private lastInterstitialAt = 0;
  private mutedUntil = 0;
  private interstitialsThisSession = 0;
  private inFlight = false;

  setAdsRemoved(v: boolean): void {
    this.adsRemoved = v;
    if (v) void this.hideBanner();
  }

  /** Intrusive formats. Suppressed outright by the Remove Ads purchase. */
  get enabled(): boolean {
    return isNative() && adsConfigured() && !this.adsRemoved;
  }

  /**
   * Opt-in rewarded stays available even to owners: it helps the player, and
   * taking it away would punish the person who paid.
   */
  get rewardedAvailable(): boolean {
    return isNative() && adsConfigured();
  }

  async init(): Promise<void> {
    if (!isNative() || !adsConfigured() || this.ready) return;
    try {
      await AdMob.initialize({ initializeForTesting: monetization.useTestAds });
      try {
        // ATT then UMP. Declining either is fine — we serve non-personalised.
        // requestTrackingAuthorization resolves void, so the answer has to be
        // read back separately rather than taken from the request.
        await AdMob.requestTrackingAuthorization();
        const att = await AdMob.trackingAuthorizationStatus();

        let consent = await AdMob.requestConsentInfo();
        if (
          consent.isConsentFormAvailable &&
          consent.status === AdmobConsentStatus.REQUIRED
        ) {
          await AdMob.showConsentForm();
          consent = await AdMob.requestConsentInfo();
        }

        this.personalized =
          att.status === 'authorized' &&
          consent.status !== AdmobConsentStatus.REQUIRED;
      } catch {
        /* consent is best-effort; never block the game on it */
      }
      this.ready = true;
      this.sessionStartedAt = Date.now();
      if (this.bannerWanted) void this.showBanner();
    } catch (err) {
      console.warn('AdMob init failed', err);
    }
  }

  /* ---------------------------------------------------------------- banner */

  /**
   * Always on, every scene. The playfield inset reserves the strip it occupies,
   * so it covers paper margin and never anything the player can touch — a
   * control under an ad is an accidental-click generator, and accidental clicks
   * are what get ad serving disabled.
   */
  async showBanner(): Promise<void> {
    if (!this.enabled || this.bannerShown) return;
    this.bannerWanted = true;
    if (!this.ready) return; // replayed at the end of init()
    try {
      await AdMob.showBanner({
        adId: admobUnits().banner,
        adSize: BannerAdSize.ADAPTIVE_BANNER,
        position: BannerAdPosition.BOTTOM_CENTER,
        margin: 0,
        isTesting: monetization.useTestAds,
        npa: !this.personalized,
      });
      this.bannerShown = true;
    } catch {
      /* no banner is a fine outcome */
    }
  }

  async hideBanner(): Promise<void> {
    this.bannerWanted = false;
    if (!this.bannerShown) return;
    this.bannerShown = false;
    try {
      await AdMob.removeBanner();
    } catch {
      /* ignore */
    }
  }

  /* ---------------------------------------------------- interstitial gate */

  /**
   * The gate every interstitial passes: session warm-up, session cap, the
   * rewarded-ad mute, and the hard time floor since the last ad.
   *
   * Separated from the count check so both entry points — a win and a run of
   * failures — share exactly one definition of "is an interruption allowed at
   * all right now", and adding a third entry point later cannot accidentally
   * skip it.
   */
  private timingAllows(levelIndex: number): boolean {
    if (!this.enabled) return false;

    const a = monetization.ads;
    if (levelIndex < a.interstitialFromLevel) return false;
    if (this.interstitialsThisSession >= a.maxInterstitialsPerSession) return false;

    const now = Date.now();
    if ((now - this.sessionStartedAt) / 1000 < a.sessionWarmupSeconds) return false;
    if (now < this.mutedUntil) return false;
    return (now - this.lastInterstitialAt) / 1000 >= a.minSecondsBetweenInterstitials;
  }

  /**
   * Non-consuming predicate: "would an ad fire on leaving this win?". Anything
   * else that wants to interrupt (the rating prompt) asks first and yields.
   */
  wouldShowInterstitial(levelIndex: number, winsSinceAd: number): boolean {
    return (
      this.timingAllows(levelIndex) &&
      winsSinceAd >= monetization.ads.interstitialEveryNWins
    );
  }

  /**
   * "Would an ad fire on this retry?" — the failure path.
   *
   * Both axes are required. The attempt count alone would put an ad every
   * twenty-odd seconds on a level someone is stuck on, which is the exact
   * pattern that gets ad serving disabled; the time floor inside
   * `timingAllows` is what makes the count safe to honour.
   *
   * The caller must only fire this at a real transition — after the fail flash
   * has finished and the board is clear — never over the flash itself.
   */
  wouldShowOnAttempt(levelIndex: number, attemptsSinceAd: number): boolean {
    return (
      this.timingAllows(levelIndex) &&
      attemptsSinceAd >= monetization.ads.interstitialEveryNAttempts
    );
  }

  /**
   * Show an interstitial and resolve only once it is GONE.
   *
   * `showInterstitial()` resolves when the ad is PRESENTED, not when the player
   * closes it. Awaiting only that would carry on with the ad still covering the
   * screen — and if it never settled, the next level would never start, so the
   * close button would look dead. Wait for Dismissed/FailedToShow with a
   * timeout, and only spend the counter if it actually rendered.
   *
   * @returns true if an ad was really shown.
   */
  async showInterstitial(): Promise<boolean> {
    if (!this.enabled || this.inFlight) return false;
    this.inFlight = true;

    try {
      await AdMob.prepareInterstitial({
        adId: admobUnits().interstitial,
        isTesting: monetization.useTestAds,
        npa: !this.personalized,
      });

      const dismissed = this.once(
        [
          InterstitialAdPluginEvents.Dismissed,
          InterstitialAdPluginEvents.FailedToShow,
        ],
        8000
      );
      await AdMob.showInterstitial();
      await dismissed;

      this.lastInterstitialAt = Date.now();
      this.interstitialsThisSession += 1;
      return true;
    } catch {
      // No fill or offline: leave the counter armed so the next break retries.
      return false;
    } finally {
      this.inFlight = false;
    }
  }

  /* -------------------------------------------------------------- rewarded */

  /**
   * Opt-in video, with the three outcomes a CALLER has to tell apart:
   *
   *   'earned'      the player watched and the reward is owed
   *   'declined'    an ad played but the player closed it before the reward —
   *                 they backed out of the deal, so nothing is owed
   *   'unavailable' no ad could even be loaded (no fill, offline, web build)
   *
   * The distinction exists because collapsing them to a boolean produced a
   * dead button: "Skip this fold" called this, got `false` for NO-FILL — the
   * permanent state of a new AdMob app before Google's review — and silently
   * did nothing. An ad we fail to supply is our problem, not the player's;
   * callers grant the reward on 'unavailable' and withhold it only on
   * 'declined'.
   *
   * A rewarded view also mutes interstitials for a while: someone who just
   * volunteered their attention should not be taxed again immediately.
   */
  async showRewarded(placement: string): Promise<'earned' | 'declined' | 'unavailable'> {
    if (!this.rewardedAvailable) return 'unavailable';
    if (this.inFlight) return 'declined';
    this.inFlight = true;

    try {
      try {
        await AdMob.prepareRewardVideoAd({
          adId: admobUnits().rewarded,
          isTesting: monetization.useTestAds,
          npa: !this.personalized,
        });
      } catch {
        return 'unavailable';
      }

      let earned = false;
      const onReward = (): void => {
        earned = true;
      };
      await AdMob.addListener(RewardAdPluginEvents.Rewarded, onReward as (i: AdMobRewardItem) => void);

      const closed = this.once(
        [RewardAdPluginEvents.Dismissed, RewardAdPluginEvents.FailedToShow],
        60000
      );
      try {
        await AdMob.showRewardVideoAd();
      } catch {
        return 'unavailable';
      }
      await closed;

      if (earned) {
        this.mutedUntil = Date.now() + monetization.ads.muteAfterRewardedSeconds * 1000;
        return 'earned';
      }
      return 'declined';
    } finally {
      void placement;
      this.inFlight = false;
    }
  }

  /** Resolve on the first of several plugin events, or on a timeout. */
  private once(events: string[], timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      for (const e of events) {
        void AdMob.addListener(e as never, finish as never);
      }
    });
  }
}

export const Ads = new AdsService();
