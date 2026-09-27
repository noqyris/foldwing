/**
 * Ads — the policy, baked in here rather than at the call sites.
 *
 * Call sites ask "may I?" and "show it"; they never decide cadence. That keeps
 * one source of truth for whether an interruption is allowed right now, which
 * is what lets the rating prompt and the upsell stay out of the ad's way.
 *
 * It does not know WHO serves the ad. Every SDK call goes through the provider
 * seam (`adProvider.ts`), implemented by Unity LevelPlay
 * (`providers/levelplay.ts`) — AdMob went when Google closed the publisher
 * account on 2026-08-18, and `adProvider.test.ts` fails the build if Google ad
 * code ever comes back. What stays here is everything that was never about the
 * network: the interstitial gate and its session ladder, the Remove Ads
 * entitlement, the banner hold during the opening film, and quieting the game
 * while a full-screen ad owns the screen.
 *
 * Every method swallows its own errors, and every one of them is a no-op that
 * still resolves in a build with no ad surface (web, VITE_ADS=off, a platform
 * with no LevelPlay app). A no-fill, a network drop or a misbehaving creative
 * must never be able to break a level.
 */

import { Capacitor } from '@capacitor/core';
import { monetization } from '../config/monetization';
import { adsMock, adsOff, type DismissWatcher } from './adProvider';
import { Audio } from './Audio';
import { pauseGameLoop, resumeGameLoop } from './gameLoop';
import { Music } from './Music';
import {
  levelplayConfigured,
  levelplayProvider,
  openPrivacyOptions as openProviderPrivacyOptions,
} from './providers/levelplay';
import { mockProvider } from './providers/mock';
import { SessionClock } from './SessionClock';
import { onSessionStart, whenAdLayerMayStart } from './SessionLifecycle';

/**
 * Which network this build talks to. `VITE_ADS=mock` swaps in the fake one —
 * our own banner/interstitial/rewarded, drawn in the DOM, calling nothing.
 * Decided at BUILD time and baked into the provider's `id`, so the release
 * gates can see it in the bundle and refuse it for every store target.
 *
 * `import.meta.env` inline, NOT the adsMock() helper: Vite constant-folds the
 * former at build time, so a non-mock bundle folds to `levelplayProvider` and
 * tree-shakes providers/mock.ts out entirely. Through a function call it
 * cannot, and every store build would carry fake ad code it must never reach.
 */
const provider = import.meta.env.VITE_ADS === 'mock' ? mockProvider : levelplayProvider;

/**
 * Whether this build, on this device, has an ad surface at all.
 *
 * False on the web, and false in an ADS-OFF build (`VITE_ADS=off`) even on a
 * device — the build TestFlight gets, because LevelPlay has no test inventory
 * and every ads-on build serves the real waterfall. A false answer means: no
 * init, hence no consent modal and no ATT alert from the SDK; no banner; no
 * interstitial; and no rewarded offer drawn at all.
 *
 * `VITE_ADS=mock` deliberately satisfies the platform half: the fake provider
 * is pure DOM and runs in a browser, so `npm run dev:mock` exercises the whole
 * ad flow — held banner, cadence, reward granted or withheld, loop pause — with
 * no device and no network.
 */
export function adsSupported(): boolean {
  return (adsMock() || Capacitor.isNativePlatform()) && !adsOff();
}

/**
 * True when there is a network app to talk to on this platform: always for the
 * mock, and for LevelPlay only where the dashboard has an app key and all three
 * units — iOS today, not Android, which has no app.
 */
const configured = (): boolean => adsMock() || levelplayConfigured();

/** Loading must not hang the UI; playback gets a long leash (real ads, and the
 *  advertiser page the player may browse), purely as a deadlock breaker. */
const AD_LOAD_TIMEOUT_MS = 15_000;
const AD_SHOW_TIMEOUT_MS = 180_000;
/**
 * The longest Game Center waits on the ad layer's start — see consentFlowDone.
 * The provider's consent steps carry their own ceilings (ATT 20 s, the modal
 * 120 s, the stored read 20 s: 160 s at most), but initialize() behind them has
 * none, and a hung native init must not cost the player the leaderboard too.
 */
const CONSENT_FLOW_CEILING_MS = 180_000;
/**
 * How long a dismissal is allowed to wait for a reward that is already on its
 * way. Some LevelPlay adapters emit RewardedClosed BEFORE RewardedRewarded, and
 * the two race: without the grace the close wins, the wait returns "no reward",
 * and the reward event lands a few milliseconds later with nobody listening.
 * The player watched the whole ad and got nothing — which from the other side
 * of the screen looks exactly like a scam.
 */
const REWARD_AFTER_CLOSE_MS = 800;

/**
 * Whether the player can see the game right now. No document at all — a test
 * of some other module that imports this one — reads as visible, so the
 * session clock runs on the wall clock there, as it always has.
 */
const pageVisible = (): boolean => typeof document === 'undefined' || !document.hidden;

interface FullScreenAdOptions<T> {
  show: () => Promise<T>;
  /** Value to return when nothing useful came back (no fill, skipped, timed out). */
  onTimeout: T;
  /**
   * Whether the provider settles show() at PRESENT time rather than when the
   * player is done with the ad — see AdProvider.resolvesOnPresent.
   */
  resolvesOnPresent: boolean;
  /** Attached before show() — see AdProvider.watchDismissal. */
  watch: () => DismissWatcher;
}

/**
 * Race a promise against a deadline. The ad SDK can hang indefinitely (no fill,
 * no network, a dropped callback) — and callers hold a tapped button while they
 * await, so a hang would leave the player stuck with no way out. Timing out just
 * loses the ad; it can never lock the game.
 */
function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(onTimeout);
    }, ms);
    p.then(
      (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(onTimeout);
      }
    );
  });
}

/** A provider call that may throw synchronously or reject — neither may escape. */
async function quietly(call: () => Promise<unknown>): Promise<void> {
  try {
    await call();
  } catch {
    /* no banner to hide, or not on device */
  }
}

/**
 * Ask a caller's "is this ad still wanted?" — and read a predicate that throws
 * (it usually reads a scene, and the scene may be gone) as a no.
 */
function stillWantedNow(stillWanted: (() => boolean) | undefined): boolean {
  if (!stillWanted) return true;
  try {
    return stillWanted();
  } catch {
    return false;
  }
}

/**
 * What a rewarded ad came to, as the caller has to tell it apart — see
 * showRewarded.
 */
export type RewardedOutcome = 'earned' | 'declined' | 'unavailable' | 'abandoned';

export class AdsService {
  /** The SDK-ready gate: released when init() finishes, success OR failure. */
  private ready = false;
  private initStarted = false;
  private adsRemoved = false;
  private bannerShown = false;
  /** In-flight creation, shared by concurrent callers — see showBanner(). */
  private bannerCreating: Promise<void> | null = null;
  /**
   * Bumped by every teardown, so a creation that was torn down while it loaded
   * can tell it is stale — see hideBanner().
   */
  private bannerGeneration = 0;
  /**
   * A banner was asked for before the SDK was ready.
   *
   * The menu starts without waiting on the ad SDK — gameplay must never wait
   * on one, and init does not even begin until the opening film is gone and
   * the player has answered the consent questions — so the menu's showBanner()
   * call lands long before there is anything to show. Remembering the request
   * and replaying it after init is the difference between a banner that always
   * appears and one that appears only when the network is fast.
   */
  private bannerWanted = false;
  /** Set while the opening film is on screen — see holdBanner(). */
  private bannerHeld = false;
  /** Full-screen ads currently on screen; the banner stays down while > 0. */
  private fullScreenDepth = 0;

  /**
   * The session's AGE, in foreground time — what the warm-up and the
   * long-session mark read. The floor since the last ad and the mute below
   * stay on the wall clock. Whether a return is a new session is the app's
   * one rule (SessionLifecycle), not this clock's — see newSession().
   */
  private readonly session = new SessionClock();
  private lastInterstitialAt = 0;
  private mutedUntil = 0;
  private interstitialsThisSession = 0;
  private inFlight = false;

  private settleConsentFlow: () => void = () => {};
  /**
   * Resolves once the ad layer can no longer put a consent question on screen
   * at launch: when init() has settled, or straight away in a build that has no
   * consent modal at all (the web, ads-off, the mock, a platform with no
   * LevelPlay app).
   *
   * Game Center waits on it (MenuScene). The consent alert is presented on the
   * bridge view controller, and so is GameKit's sign-in sheet — and UIKit
   * silently refuses to present from a controller that is already presenting.
   * With the sheet up first, the consent alert never appeared and the session
   * was treated as a decline. In this order the sheet can only follow the
   * question, never block it.
   *
   * Never rejects. Bounded by CONSENT_FLOW_CEILING_MS from init's start, so a
   * hung SDK start delays the sign-in rather than cancelling it.
   */
  readonly consentFlowDone = new Promise<void>((resolve) => {
    this.settleConsentFlow = resolve;
  });

  constructor() {
    this.session.start(Date.now(), pageVisible());
    /*
     * Bound here rather than in `init()` on purpose: the session is not the ad
     * SDK's business, and it has to keep working on the paths where init never
     * runs or fails outright.
     */
    this.watchVisibility();
    onSessionStart((reason) => {
      if (reason === 'return') this.newSession();
    });
    // The same predicate as the Privacy choices row: the only build with a
    // consent modal is a device build that really talks to LevelPlay.
    if (!this.privacyChoicesAvailable) this.settleConsentFlow();
  }

  /**
   * Record the Remove Ads entitlement. Called at boot with the saved value and
   * again the moment a purchase or restore lands.
   *
   * `true` tears the banner down — but only a banner that exists. The boot call
   * re-delivers an owner's `true` on every launch, including in an ads-off
   * build, and a teardown with nothing to tear down must not reach the plugin.
   */
  setAdsRemoved(v: boolean): void {
    this.adsRemoved = v;
    if (v) void this.hideBanner();
  }

  /**
   * Whether an ad can be served at all right now, owner or not: a build and
   * platform with an ad surface, a network app behind it, and consent that has
   * not been withheld. Consent gates the SDK itself — no consent, no SDK — so
   * a player who declined gets no ads of any kind, and must not be offered one.
   */
  private get serving(): boolean {
    return adsSupported() && configured() && provider.consentState?.() !== 'withheld';
  }

  /** Intrusive formats. Suppressed outright by the Remove Ads purchase. */
  get enabled(): boolean {
    return this.serving && !this.adsRemoved;
  }

  /**
   * Opt-in rewarded stays available even to owners: it helps the player, and
   * taking it away would punish the person who paid.
   *
   * False wherever no ad can ever arrive — the web, an ads-off build, a
   * platform with no LevelPlay app, and a player who withheld consent — so the
   * "Watch an ad" row is not drawn and the skip pill does not promise an ad.
   * Drawing it there turned the row into "no ad ready just now — try again in
   * a moment", forever.
   *
   * False too while the SDK is not up: consent still unanswered (nothing may
   * load before it), or an initialize() that failed offline and has not come
   * back. Read at draw time, so it flips to true on the next draw once the
   * SDK is up; until then the skip pill skips without promising an ad, which
   * is exactly what it does on 'unavailable'.
   */
  get rewardedAvailable(): boolean {
    return this.serving && provider.supports('rewarded') && provider.sdkReady?.() !== false;
  }

  /**
   * Whether this build serves TEST inventory that is safe to tap. Always false:
   * LevelPlay has none and the mock has no network — see `testing` in
   * providers/levelplay.ts. No build of Foldwing is safe to tap an ad in.
   */
  get isTestAds(): boolean {
    return provider.testing;
  }

  /**
   * A full-screen ad is loading or on screen. A control that would open
   * something for the player to look at — a store sheet — waits it out rather
   * than opening the thing underneath the ad.
   */
  get busy(): boolean {
    return this.inFlight;
  }

  /**
   * Whether Settings should offer "Privacy choices": a device build that
   * really talks to LevelPlay. Not the web, not ads-off (there is no SDK to
   * consent to), not the mock (there is no network behind it).
   */
  get privacyChoicesAvailable(): boolean {
    return Capacitor.isNativePlatform() && !adsOff() && !adsMock() && levelplayConfigured();
  }

  /**
   * Consent + ATT, then the SDK. Safe to call more than once; only the first
   * call does anything.
   *
   * main.ts calls it once the saved entitlement is known — never BootScene,
   * which runs while the film is still playing, and the consent modal and the
   * ATT alert are system dialogs that would land on top of it. It runs for
   * Remove Ads owners too: they keep the rewarded ads.
   *
   * And whoever calls it, nothing is asked before the ad layer's one starter
   * gate opens (SessionLifecycle.whenAdLayerMayStart): the film gone AND the
   * app ACTIVE. main.ts's backstop timer, and the film's own cap, can come due
   * in the background and fire on the return — in the ~300 ms before
   * didBecomeActive, where ATT shows nothing and answers notDetermined.
   */
  async init(): Promise<void> {
    if (!adsSupported() || !configured()) {
      this.settleConsentFlow(); // no consent modal in this build
      return;
    }
    if (this.initStarted) return;
    this.initStarted = true;
    /*
     * The SDK can come up long after this method has finished — a timed retry
     * after an offline launch, a return to the foreground, a consent answered
     * past the modal's ceiling or from Privacy choices — and the replay in the
     * finally below has run by then. Without this a player who stayed in the
     * levels, where no scene is recreated, had no banner for the whole sitting.
     */
    provider.onReady?.(() => {
      if (this.bannerWanted && !this.bannerShown) void this.showBanner();
    });
    // Before the ceiling below, which bounds the consent flow, not this wait:
    // a ceiling that fell due in the background would release Game Center's
    // sheet in the very window the consent alert is waiting for.
    await whenAdLayerMayStart();
    const ceiling = setTimeout(() => this.settleConsentFlow(), CONSENT_FLOW_CEILING_MS);
    try {
      await provider.init();
    } catch (err) {
      // Not final: the provider keeps a bounded retry of its own (backoff, then
      // every return to the foreground via foregrounded()), and every scene's
      // showBanner() asks again.
      console.warn('[ads] init failed', err);
    } finally {
      clearTimeout(ceiling);
      this.settleConsentFlow();
      // Released either way. Setting this only on success parked every banner
      // request forever the first time init failed or consent was declined —
      // and a failed init is not the end of the session, see above.
      this.ready = true;
      // The session starts here, not at process start: the film and the
      // consent questions are not play. The SDK may settle with the app in the
      // background — the clock then waits for the player to come back.
      this.session.start(Date.now(), pageVisible());
      if (this.bannerWanted) void this.showBanner();
    }
  }

  /**
   * Called by main.ts on every return to the foreground. For an SDK whose
   * initialize() failed this is the one event that means "the failure reason
   * may be resolved" — the player is back from wherever they lost the network —
   * so it is the one retry that is not on a timer (the provider owns the timed
   * ones and the guard against two inits at once). Nothing to do before init()
   * has run, or in a build with no ads.
   *
   * Through the starter gate, like init(): this is called from the
   * `visibilitychange` of the return, which fires while the app is still
   * INACTIVE, and a retry can re-ask ATT and the consent modal
   * (levelplay.retryInit → reaskConsent).
   */
  foregrounded(): void {
    if (!adsSupported() || !this.initStarted) return;
    void whenAdLayerMayStart().then(() => provider.retryInit?.());
  }

  /**
   * Re-open the consent modal so the player can change their decision — the
   * "Privacy choices" row in Settings. Lives here rather than being imported
   * straight from the provider because scenes talk to the policy layer, never
   * to a network.
   *
   * And it acts on the answer, because nothing else will. A withdrawal used to
   * change what LATER calls were allowed to do and nothing more: the banner
   * already on screen stayed there, refreshing — a new ad request every
   * minute — for the rest of the session, under a modal that had just said
   * "If you decline, Foldwing shows no ads at all". So a no DESTROYS the banner
   * (a hidden native banner view still refreshes); the provider stops its own
   * loading. The want is kept, so a later yes brings the same strip back — at
   * once when the SDK is already up, or via onReady when this yes is what
   * starts it.
   */
  async openPrivacyOptions(): Promise<void> {
    if (!this.privacyChoicesAvailable) return;
    // A tap on a Settings row: active, and past the film, in practice. It is a
    // route that opens consent and can start the SDK, so it takes the gate all
    // the same — every one of them does.
    await whenAdLayerMayStart();
    await openProviderPrivacyOptions();
    if (provider.consentState?.() === 'withheld') {
      const wanted = this.bannerWanted;
      await this.hideBanner();
      this.bannerWanted = wanted;
      return;
    }
    if (this.bannerWanted && !this.bannerShown) await this.showBanner();
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
    // No SDK to create it in — consent still unanswered, or a start that failed
    // offline. A create now is a native call that can only be refused; the
    // provider's onReady replays the want the moment there is one (see init()).
    if (provider.sdkReady?.() === false) return;
    // Share one in-flight creation. The film's release and the end of init can
    // both replay a wanted banner in the same moment a scene asks for one, and
    // each would otherwise see `bannerShown === false` and create a native
    // banner view of its own — stacked, with only one of them ever removable.
    if (this.bannerCreating) return this.bannerCreating;
    const generation = this.bannerGeneration;
    const creating: Promise<void> = provider
      .bannerShow()
      .then(async () => {
        const stale = generation !== this.bannerGeneration;
        // A purchase can land while the banner loads — and so can a withdrawal
        // of consent, which `enabled` reads too. A stale creation was already
        // torn down by hideBanner(); it removes what landed only when nothing
        // newer has been created since, or it would destroy that one instead.
        if (stale || !this.enabled) {
          if (!stale || (!this.bannerShown && !this.bannerCreating)) {
            await quietly(() => provider.bannerRemove());
          }
          return;
        }
        this.bannerShown = true;
        // …and so can a full-screen ad, which the banner must not sit on top of.
        if (this.fullScreenDepth > 0) await quietly(() => provider.bannerHide());
      })
      .catch(() => {
        /* no fill is a fine outcome — the next scene's call retries */
      })
      .finally(() => {
        if (this.bannerCreating === creating) this.bannerCreating = null;
      });
    this.bannerCreating = creating;
    return creating;
  }

  async hideBanner(): Promise<void> {
    this.bannerWanted = false;
    // Nothing to tear down → no plugin call. A banner still being created
    // counts as one to remove.
    if (!adsSupported() || (!this.bannerShown && !this.bannerCreating)) return;
    this.bannerShown = false;
    // A creation still loading is abandoned, not awaited. The plugin never
    // settles a load whose banner it destroyed (destroyBannerInternal drops the
    // pending call on iOS), so keeping that promise as `bannerCreating` handed
    // every later showBanner() the same hung promise: after a withdrawal during
    // a load, a yes in the same session never brought a banner back.
    this.bannerGeneration += 1;
    this.bannerCreating = null;
    await quietly(() => provider.bannerRemove());
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
    // Two clocks on purpose. The session's age is time spent PLAYING — a
    // phone locked for twenty minutes has not warmed anyone up. The mute and
    // the floor since the last ad are real elapsed time, and time away
    // counts toward them just the same.
    const sessionSeconds = this.session.ageSeconds(now);
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
   * Pause the session's age while the app is in the background, and resume it
   * when the page comes back. Only the AGE: whether the return is a new session
   * is SessionLifecycle's decision, heard in newSession().
   *
   * Bound to visibilitychange, the same signal main.ts hands the lifecycle and
   * the menu uses to notice the date rolling over.
   */
  private watchVisibility(): void {
    if (typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', () => {
      const now = Date.now();
      if (document.hidden) this.session.hide(now);
      else this.session.show(now);
    });
  }

  /**
   * A return started a new session (core/Session: 30 minutes away, or a new
   * day). Reset exactly what is per session: the cap, and the age — so the
   * warm-up is armed again.
   *
   * Deliberately untouched, because none of them is per session:
   * `lastInterstitialAt` and `mutedUntil` are floors on real elapsed time (the
   * gap is what keeps an ad from landing right after a return), and the
   * every-Nth-win / attempt counters and the daily rewarded cap live in the
   * save.
   */
  private newSession(): void {
    this.interstitialsThisSession = 0;
    this.session.start(Date.now(), pageVisible());
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
   * The provider's show resolves when the ad is PRESENTED, not when the player
   * closes it. Awaiting only that would carry on with the ad still covering the
   * screen, so the wait for the close is the dismissal watcher's — for up to
   * three minutes, because video interstitials run long and a player may visit
   * the advertiser's page.
   *
   * The ad comes from the provider's prefetch cache or not at all:
   * loadInterstitial() answers at once and never loads at the break (see
   * AdProvider.loadInterstitial). A load here held the "next fold" tap for the
   * whole load, and on the retry path let a fill land seconds after the gate
   * was checked — with the player already mid-stroke, or in a sheet they had
   * opened since. The load timeout below is a deadlock breaker for a bridge
   * call that never answers, not a wait for inventory.
   *
   * @param stillWanted Asked once more with the ad in hand, right before it
   *   goes on screen. Even a cache answer is a bridge round trip or two, and a
   *   break the caller checked before it was a moment ago: the player may have
   *   reached for the next stroke, opened a sheet, or left the scene. A no
   *   shows nothing and stamps nothing — the break was not taken, so the next
   *   natural one gets it.
   * @returns true if an ad was really shown.
   */
  async showInterstitial(stillWanted?: () => boolean): Promise<boolean> {
    if (!this.enabled || this.inFlight) return false;
    this.inFlight = true;

    try {
      const loaded = await withTimeout(provider.loadInterstitial(), AD_LOAD_TIMEOUT_MS, false);
      // No fill or offline: leave the counter armed so the next break retries.
      if (!loaded) return false;
      if (!stillWantedNow(stillWanted)) return false;

      const shown = await this.underFullScreenAd<boolean | null>({
        show: () => provider.showInterstitial(),
        onTimeout: null,
        resolvesOnPresent: provider.resolvesOnPresent('interstitial'),
        watch: () => provider.watchDismissal('interstitial', AD_SHOW_TIMEOUT_MS),
      });

      if (shown !== true) {
        // A failed or refused present, or nothing heard at all. Either way no
        // impression is known to have happened, so the caller keeps its
        // win/attempt counter armed and retries at the next natural break —
        // reporting true here would spend the counter on an ad the player
        // never saw.
        //
        // Silence is the ambiguous case: it can also mean an ad IS on screen
        // and we merely missed the event, so it still stamps the time floor.
        // Stacking a second interstitial on a live one is the exact pattern
        // that gets ad serving disabled.
        if (shown === null) this.lastInterstitialAt = Date.now();
        return false;
      }

      this.lastInterstitialAt = Date.now();
      this.interstitialsThisSession += 1;
      return true;
    } catch {
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
   *   'unavailable' no ad reached the screen (no fill, offline, a present that
   *                 failed, or a build with no ads at all)
   *   'abandoned'   the ad loaded, but `stillWanted` said no before it went on
   *                 screen — the player left the level, started drawing, or
   *                 won while it loaded. Nothing was shown and nothing is
   *                 owed, and it is not the network's fault either: a caller
   *                 that skips for free on 'unavailable' must not on this.
   *
   * The distinction exists because collapsing them to a boolean produced a
   * dead button: "Skip this fold" called this, got `false` for no-fill, and
   * silently did nothing. An ad we fail to supply is our problem, not the
   * player's — but what a caller does about it is the caller's decision:
   * the skip pill skips anyway on 'unavailable', while the reveal refill says
   * no ad was ready and grants nothing, because reveals are the game's one
   * currency and a payout has to cost what it claims to cost.
   *
   * The reward is granted ONLY on the network's reward event, never on close.
   *
   * A rewarded view also mutes interstitials for a while: someone who just
   * volunteered their attention should not be taxed again immediately.
   *
   * `stillWanted` is asked once the ad has loaded, as for the interstitial —
   * and matters more here, because a rewarded load with nothing cached is a
   * real network fetch at the tap and can take seconds.
   */
  async showRewarded(placement: string, stillWanted?: () => boolean): Promise<RewardedOutcome> {
    if (!this.rewardedAvailable) return 'unavailable';
    if (this.inFlight) return 'declined';
    this.inFlight = true;

    try {
      const loaded = await withTimeout(provider.loadRewarded(), AD_LOAD_TIMEOUT_MS, false);
      if (!loaded) return 'unavailable';
      if (!stillWantedNow(stillWanted)) return 'abandoned';

      // Held so the outcome can ask the watcher what ended the wait.
      const seen: { watcher?: DismissWatcher } = {};
      const reward = await this.underFullScreenAd<unknown | null>({
        // Settles ONLY on the reward event — or null on a failed/refused present.
        show: () => provider.showRewarded(),
        onTimeout: null,
        resolvesOnPresent: false,
        watch: () => (seen.watcher = provider.watchDismissal('rewarded', AD_SHOW_TIMEOUT_MS)),
      });

      if (reward != null) {
        this.mutedUntil = Date.now() + monetization.ads.muteAfterRewardedSeconds * 1000;
        return 'earned';
      }
      // No reward. A close (or an ad the player sat on past the ceiling) is a
      // decline; a present that failed, or a show the network refused outright
      // — which ends the wait before any terminal event, so the watcher reads
      // 'cancelled' — never put an ad on screen at all.
      const why = seen.watcher?.reason() ?? null;
      return why === 'closed' || why === 'timeout' ? 'declined' : 'unavailable';
    } catch {
      return 'unavailable';
    } finally {
      void placement;
      this.inFlight = false;
    }
  }

  /* ------------------------------------------------------- full-screen ad */

  /**
   * Run a full-screen ad's SHOW step with the rest of the app quieted down.
   *
   * This exists for an on-device symptom KVIZKO found first: the ad's own close
   * button stops responding. Underneath the ad the WebView keeps compositing an
   * animated canvas, the music keeps scheduling, AND the banner keeps refreshing
   * — three things fighting the ad for the same main thread, the last of them a
   * second live ad surface. Quiet all three for the duration.
   *
   * Restoring also undoes what iOS does to us: a full-screen ad interrupts the
   * Web Audio context, and without the unlock the game is silent for the rest
   * of the session.
   */
  private async underFullScreenAd<T>(opts: FullScreenAdOptions<T>): Promise<T> {
    this.fullScreenDepth += 1;
    let watcher: DismissWatcher | null = null;
    try {
      // Loop first: the music refuses to restart while the loop is paused, so a
      // return from the background with the ad still up cannot bring it back.
      pauseGameLoop();
      // …and the bars it had already booked, seconds ahead, go with it.
      Music.stop();
      if (this.bannerShown) await quietly(() => provider.bannerHide());
      // Subscribe BEFORE showing. Attaching afterwards races the player: a fast
      // tap on the close button fires the dismissal while nothing is listening,
      // and the listener then waits out its whole timeout with the game asleep.
      const w = opts.watch();
      watcher = w;
      if (opts.resolvesOnPresent) {
        // show() comes back as soon as the ad is on screen, so it says nothing
        // about when the player is done — the dismissal event does.
        const shown = await withTimeout(opts.show(), AD_LOAD_TIMEOUT_MS, opts.onTimeout);
        // Only wait for a dismissal that can actually arrive. When the native
        // side REJECTS the call — "The interstitial ad is not ready yet." — no
        // ad is presented and LevelPlay emits nothing: not displayed, not
        // failed, not closed. Waiting anyway would park the game on the
        // watcher's three-minute ceiling with the loop, music and input asleep.
        if (shown) await w.done;
        return shown;
      }
      // Rewarded: show() resolves only on a reward earned. A skipped ad is
      // signalled by dismissal alone, so whichever lands first ends the wait.
      // ONE promise, awaited from two places — calling opts.show() twice would
      // present a second ad.
      const showing = withTimeout(opts.show(), AD_SHOW_TIMEOUT_MS, opts.onTimeout);
      const outcome = await Promise.race([
        showing,
        // The close arriving first does not mean the ad was skipped; it may only
        // mean this adapter reports the close first. Give the reward a moment
        // to land before concluding the player walked away empty-handed.
        w.done.then(() => withTimeout(showing, REWARD_AFTER_CLOSE_MS, opts.onTimeout)),
      ]);
      // The reward won the race, which is the usual order: networks grant it
      // when the video completes, and the player is still on the end card
      // looking for the close button. The outcome is decided, but the ad is
      // still on screen — restoring now brought the loop, the music and a
      // refreshing banner back under it, the exact contention the quieting
      // exists to prevent. Wait for the close; the watcher's own ceiling
      // bounds it.
      if (outcome != null && w.reason() === null) await w.done;
      return outcome;
    } finally {
      // finally, not the happy path: a throw anywhere above — the watcher
      // included — must not leave the loop asleep or the music stopped.
      watcher?.cancel();
      resumeGameLoop();
      Audio.unlock();
      Music.start(); // a no-op when the player has the music switched off
      this.fullScreenDepth -= 1;
      // Resume the SAME banner — never create a second one.
      if (this.fullScreenDepth === 0 && this.bannerShown && !this.adsRemoved) {
        void quietly(() => provider.bannerResume());
      }
    }
  }
}

export const Ads = new AdsService();
