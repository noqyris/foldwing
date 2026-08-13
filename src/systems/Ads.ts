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

export class AdsService {
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
  /** Set while the opening film is on screen — see holdBanner(). */
  private bannerHeld = false;

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

  constructor() {
    /*
     * Bound here rather than in `init()` on purpose: what counts as a session
     * is not the ad SDK's business, and it has to keep working on the paths
     * where init never runs or fails outright.
     */
    this.watchForNewSession();
  }

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
   * Keep the strip off the glass until `releaseBanner()`.
   *
   * The opening film is full-bleed, and a banner is a NATIVE view sitting above
   * the webview — it does not care what the page is showing, so without this it
   * slides in over the film. Scenes still call showBanner() whenever they like;
   * the want is remembered and honoured the moment the hold lifts.
   */
  holdBanner(): void {
    this.bannerHeld = true;
  }

  async releaseBanner(): Promise<void> {
    if (!this.bannerHeld) return;
    this.bannerHeld = false;
    if (this.bannerWanted && !this.bannerShown) await this.showBanner();
  }

  /**
   * Always on, every scene. The playfield inset reserves the strip it occupies,
   * so it covers paper margin and never anything the player can touch — a
   * control under an ad is an accidental-click generator, and accidental clicks
   * are what get ad serving disabled.
   */
  async showBanner(): Promise<void> {
    if (!this.enabled || this.bannerShown) return;
    this.bannerWanted = true;
    if (this.bannerHeld) return; // replayed by releaseBanner()
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
    const sessionSeconds = (now - this.sessionStartedAt) / 1000;
    if (sessionSeconds < a.sessionWarmupSeconds) return false;
    if (now < this.mutedUntil) return false;
    return (now - this.lastInterstitialAt) / 1000 >= this.gapSeconds(sessionSeconds);
  }

  /**
   * How long the current stretch of the session makes us wait between ads.
   *
   * One number cannot serve both ends of a session. Early on, frequency is the
   * strongest predictor of someone closing the app for good; half an hour in,
   * the same interval is leaving the most engaged players unmonetised. So the
   * floor starts generous and tightens once the sitting is clearly a long one.
   */
  private gapSeconds(sessionSeconds: number): number {
    const a = monetization.ads;
    return sessionSeconds >= a.longSessionAfterSeconds
      ? a.lateSecondsBetweenInterstitials
      : a.minSecondsBetweenInterstitials;
  }

  /**
   * Start a fresh session when the app comes back after a real absence.
   *
   * Bound to visibilitychange rather than a Capacitor lifecycle plugin because
   * the webview already reports it, it needs no new dependency, and it is the
   * same signal the menu uses to notice the date rolling over.
   */
  private watchForNewSession(): void {
    if (typeof document === 'undefined') return;
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      const away = (Date.now() - hiddenAt) / 1000;
      if (hiddenAt === 0 || away < monetization.ads.newSessionAfterAwaySeconds) return;
      this.sessionStartedAt = Date.now();
      this.interstitialsThisSession = 0;
      // `lastInterstitialAt` deliberately survives: it is a floor on real
      // elapsed time, and time spent away counts toward it just the same.
    });
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

      const settled = this.once(
        [
          InterstitialAdPluginEvents.Dismissed,
          InterstitialAdPluginEvents.FailedToShow,
        ],
        8000
      );
      await AdMob.showInterstitial();
      const how = await settled;

      if (how !== InterstitialAdPluginEvents.Dismissed) {
        // FailedToShow, or nothing at all inside the timeout. Either way no
        // impression happened, so the caller keeps its win/attempt counter
        // armed and retries at the next natural break — reporting true here
        // spent the counter on an ad the player never saw.
        //
        // Silence is the ambiguous case: it can also mean an ad IS on screen
        // and we merely missed the event, so it still stamps the time floor.
        // Stacking a second interstitial on a live one is the exact pattern
        // that gets ad serving disabled.
        if (how === null) this.lastInterstitialAt = Date.now();
        return false;
      }

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
      // Held so it can be taken off again — see `once`. A reward handler that
      // outlives its ad is the one leak here that would not stay inert.
      const rewardHandle = await AdMob.addListener(
        RewardAdPluginEvents.Rewarded,
        onReward as (i: AdMobRewardItem) => void
      );

      const closed = this.once(
        [RewardAdPluginEvents.Dismissed, RewardAdPluginEvents.FailedToShow],
        60000
      );
      try {
        await AdMob.showRewardVideoAd();
      } catch {
        void rewardHandle.remove();
        return 'unavailable';
      }
      await closed;
      void rewardHandle.remove();

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

  /**
   * Resolve on the first of several plugin events, or with null on a timeout.
   *
   * It reports WHICH event fired rather than merely that one did, because
   * Dismissed and FailedToShow arrive on the same await and only one of them
   * is an impression. Collapsing them is how a failed present came to be
   * counted as a shown ad.
   */
  private once(events: string[], timeoutMs: number): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      let done = false;
      /*
       * Every listener is removed once the race is settled.
       *
       * These used to be added and never taken off, so a session accumulated
       * two dead handles per interstitial and two per rewarded video. They were
       * inert — each one only called `finish` on a promise that had already
       * resolved — but the plugin still delivered every future ad event to a
       * growing list of them, and "inert leak" is one refactor away from a
       * handler that does something.
       */
      const handles: Promise<{ remove: () => Promise<void> }>[] = [];
      const finish = (event: string | null): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        for (const h of handles) void h.then((l) => l.remove()).catch(() => undefined);
        resolve(event);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      for (const e of events) {
        handles.push(
          AdMob.addListener(e as never, (() => finish(e)) as never) as unknown as Promise<{
            remove: () => Promise<void>;
          }>
        );
      }
    });
  }
}

export const Ads = new AdsService();
