import { Capacitor } from '@capacitor/core';
import { AdEvent, LevelPlayAds } from 'capacitor-levelplay-ads';
import {
  ADS_MARKER,
  type AdFormat,
  type AdProvider,
  type ConsentState,
  type DismissReason,
  type DismissWatcher,
} from '../adProvider';

/**
 * Unity LevelPlay behind the AdProvider seam.
 *
 * Written after Google closed the publisher account on 2026-08-18, ported from
 * KVIZKO, which made the same move first. Everything network-specific lives
 * here; the policy layer (`systems/Ads.ts`) knows none of it — see
 * `adProvider.ts` for why the split exists.
 *
 * Three things differ from AdMob in ways that matter, and each one is a comment
 * further down rather than a surprise later:
 *
 *  1. LevelPlay does not have separate test ad units, or test inventory of any
 *     kind. The SAME unit ids ship in every build and only a flag differs — a
 *     flag that unlocks the Test Suite and nothing else. Every build that
 *     initialises this SDK serves the real waterfall. See AD_MODE_MARKER.
 *  2. Nothing settles on the promise. `show*()` and `load*()` return void and
 *     the real answer arrives as an event, so every call here is an event race.
 *  3. Consent comes BEFORE initialize(), and no consent means no SDK at all —
 *     not a non-personalised SDK, as it was under Google's UMP.
 */

// ── Go-live config ───────────────────────────────────────────────────────────
// Which build this is — the App Store one or not — is decided at BUILD time by
// VITE_AD_MODE:
//   VITE_AD_MODE=live  → the App Store build (ios:appstore only)
//   unset / anything else → test mode, which on this network means the Test
//                           Suite is unlocked. The ads are REAL either way.
//
// The flag fails SAFE. A typo, a stray `vite build`, someone hitting Archive in
// Xcode — all of them yield a test-mode build, which every store gate refuses.
// A live build requires somebody to type `live`.
//
// Whether a build serves ads AT ALL is a different switch — `VITE_ADS=off`,
// read in adProvider.ts ("Build modes") — and it does not touch this one: an
// ads-off build is still ADMODE:test.
const TESTING = import.meta.env.VITE_AD_MODE !== 'live';

/**
 * The proof the release gate reads (`scripts/check-ad-mode.mjs`).
 *
 * THIS IS WHY IT EXISTS: with AdMob the gate could scan the bundle for Google's
 * sample publisher id and know a build carried test units. LevelPlay has no
 * such tell — the same unit ids ship in both modes and only `isTesting`
 * differs, and a boolean folded into minified JS is not greppable. Without this
 * literal the gate sees nothing it can tell apart, and cannot distinguish the
 * App Store build from any other, which is the exact blindness that cost the
 * account once already.
 *
 * It rides on `id` because the seam already documents that field as "for logs
 * and for the build gates", and because the provider object is imported and
 * used, so no bundler will tree-shake the string away.
 */
const AD_MODE_MARKER = TESTING ? 'ADMODE:test' : 'ADMODE:live';

/**
 * LevelPlay app keys, from the dashboard: Setup → App → App Key.
 *
 * iOS and Android are SEPARATE APPS in LevelPlay with separate keys and separate
 * ad unit ids — a store URL registers exactly one platform. Foldwing has no
 * Android app (there is no android/ folder and no Play listing), so its entry is
 * empty ON PURPOSE: `levelplayConfigured()` reads it and every ad path no-ops
 * cleanly there, instead of initialising an SDK against an app that does not
 * exist — not a crash, just an SDK that never fills, the failure mode nobody
 * investigates. Fill both tables in at the moment the Android app is created in
 * the dashboard, not before.
 */
const APP_KEYS: Record<string, string> = {
  ios: '282ab31c5',
  android: '',
};

interface AdUnits {
  banner: string;
  interstitial: string;
  rewarded: string;
}

const NO_UNITS: AdUnits = { banner: '', interstitial: '', rewarded: '' };

/**
 * Ad unit ids from the LevelPlay dashboard.
 *
 * Unlike AdMob there is no test/live pair — these are the real ids in every
 * build, and NOTHING here makes a build safe to tap:
 *   • `isTesting` maps only to the Test Suite flag; ordinary shows serve the
 *     real waterfall in every build.
 *   • The dashboard's Test Devices list is narrower than it sounds. Unity's own
 *     words: a pinned device receives ads "exclusively from that specific ad
 *     network" — exclusivity of SOURCE, not test creatives — the configuration
 *     "will reset within the hour", and "non-bidding ad networks can only test
 *     live ads".
 * So treat every ads-on build on every device as live. The rule that protects
 * the account is not tapping, and not shipping ads-on builds to testers — not a
 * dashboard entry.
 */
const UNITS_BY_PLATFORM: Record<string, AdUnits> = {
  ios: {
    banner: 'h0a7k5pjpr3ziohk',
    interstitial: 'w4ocqufvnz4i9mbt',
    rewarded: 'e5mt76phyqseoqpa',
  },
  // No Android app in LevelPlay — see APP_KEYS. Never borrow the iOS ids here:
  // a unit id belongs to one app, and on the other platform it silently never
  // fills.
  android: NO_UNITS,
};

/*
 * Resolved at CALL time, not at import. The platform cannot change inside one
 * process, so on a device this is the same answer every time — but the policy
 * layer's tests run one suite across iOS, Android and the web, and a value
 * frozen at import would test only whichever platform happened to load first.
 */
const platform = (): string => Capacitor.getPlatform();
const appKey = (): string => APP_KEYS[platform()] ?? '';
const units = (): AdUnits => UNITS_BY_PLATFORM[platform()] ?? NO_UNITS;

/**
 * True when this platform has an app key AND all three unit ids. The policy
 * layer reads it before anything else, so an unconfigured platform never asks
 * for consent for ads it cannot serve, and draws no offer that leads nowhere.
 */
export function levelplayConfigured(): boolean {
  const u = units();
  return appKey() !== '' && u.banner !== '' && u.interstitial !== '' && u.rewarded !== '';
}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ATT is a system alert the OS answers in a moment; a stall here is a hang.
 * The consent modal is different: it is READ. In KVIZKO these two first shared
 * one 20 s ceiling, so a player who took 25 s over the text was treated as a
 * stalled CMP — the deadline fired with the modal still on screen,
 * getConsentData() answered UNKNOWN, init() returned, and the Accept tapped a
 * moment later reached nobody: a whole session without ads, silently. The
 * modal gets its own, generous ceiling — and, the actual fix, its decision is
 * WATCHED (see watchConsent), so even a decision after the ceiling starts the
 * SDK.
 */
const ATT_TIMEOUT_MS = 20_000;
const CONSENT_TIMEOUT_MS = 120_000;

/**
 * Await with a ceiling. On expiry it logs which call stalled and returns the
 * fallback, so the session degrades to "no ads" loudly instead of silently.
 */
function withDeadline<T>(p: Promise<T>, ms: number, what: string, fallback?: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(`[levelplay] ${what} did not settle in ${ms}ms — continuing without it`);
      resolve(fallback as T);
    }, ms);
    void p.then(
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
        resolve(fallback as T);
      }
    );
  });
}

/** How long to wait for a load/display event before calling it a failure. */
const LOAD_EVENT_TIMEOUT_MS = 20_000;
const SHOW_EVENT_TIMEOUT_MS = 10_000;

/**
 * Every terminal event per format — dismissed, or failed to present at all —
 * with the reason each one reports to the policy layer.
 */
const AD_EVENTS: Record<AdFormat, readonly (readonly [string, DismissReason])[]> = {
  interstitial: [
    [AdEvent.InterstitialClosed, 'closed'],
    [AdEvent.InterstitialDisplayFailed, 'failed'],
  ],
  rewarded: [
    [AdEvent.RewardedClosed, 'closed'],
    [AdEvent.RewardedDisplayFailed, 'failed'],
  ],
  // A banner has no dismissal; supports() does not make the policy layer ask.
  banner: [],
};

/** Formats this network actually serves. */
const SUPPORTED: ReadonlySet<AdFormat> = new Set<AdFormat>(['banner', 'interstitial', 'rewarded']);

let bannerCreated = false;

// ── Privacy flags ────────────────────────────────────────────────────────────
/*
 * CCPA and COPPA, set BEFORE every initialize(). Unity's regulation page:
 * "the recommended best practice is to set the API before initializing the SDK
 * to ensure compliance with privacy frameworks" (CCPA from SDK 6.14, COPPA
 * from 7.1). The plugin exposes both as first-class calls — setCCPAConsent →
 * LPMPrivacySettings.setCCPA, and setChildDirected → …setCOPPA — and neither
 * sits behind the plugin's ensureReady() guard, so they can go first. They are
 * static SDK settings and transmit nothing.
 *
 * COPPA: false. Foldwing is a general-audience puzzle game, not directed at
 * children, and is registered in the LevelPlay dashboard as COPPA "Not
 * directed". A property of the app, not of the player — hence a constant. If
 * the age rating or the dashboard answer ever changes, this changes with it.
 *
 * CCPA mirrors the consent decision, because the SDK only ever starts on
 * GRANTED. The modal says in as many words that LevelPlay's partners use the
 * advertising identifier to show and measure ads, including personalised ones
 * — that is the "sale or sharing" CCPA lets a Californian refuse — so a player
 * who tapped Accept has agreed to it and do_not_sell is false at init. A player
 * who later withdraws from Settings → Privacy choices flips it to true: the SDK
 * cannot be stopped once up, but it can be told to stop selling. There is no
 * separate CCPA opt-out screen; the one modal, re-openable from Settings, is
 * the opt-out.
 */
const CHILD_DIRECTED = false;

async function applyPrivacyFlags(granted: boolean): Promise<void> {
  await Promise.all([
    LevelPlayAds.setCCPAConsent({ doNotSell: !granted }).catch(() => {
      // a plugin without the call — init must not hang on a privacy flag
    }),
    LevelPlayAds.setChildDirected({ isChildDirected: CHILD_DIRECTED }).catch(() => {
      // same
    }),
  ]);
}

// ── Start + retry ────────────────────────────────────────────────────────────
/**
 * The SDK starts at most once per process, and every path that can start it
 * shares this promise — init() reaching GRANTED, the consent watcher seeing
 * GRANTED, a retry timer and a return to the foreground can all arrive for the
 * same decision, and initialize() is not re-entrant (the plugin rejects a
 * second call with "already initializing"). A failed start is forgotten so the
 * next attempt can try again.
 */
let sdkStart: Promise<void> | null = null;
let sdkUp = false;

/**
 * What consent currently says. Every retry reads it: Unity's rule is no
 * consent, no init, and that holds for the fourth attempt as much as for the
 * first.
 */
let consentGranted = false;
/** Whether any answer has arrived yet — the difference between 'pending' and 'withheld'. */
let consentSettled = false;
/**
 * The flow ran to its ceilings and came back with no answer at all — which is
 * not a decline. See askConsent() for why it happens and why it is asked again.
 */
let consentUnanswered = false;
/** The one consent ask in flight: init() and a foreground re-ask share it. */
let consentAsk: Promise<void> | null = null;

/*
 * A failed initialize() would otherwise be final for the session: the promise
 * forgotten, the policy layer swallowing the error, and only a LATER consent
 * decision able to start the SDK again — so a player who opened the game in a
 * tunnel had no ads, and no rewarded offers, until the next launch. Unity, on
 * onInitFailed: "It is recommended to try and initialize the LevelPlay SDK
 * later (when internet connection is available, or when the failure reason is
 * resolved)."
 *
 * So: three timed retries with backoff, then one more on every return to the
 * foreground (the policy layer's foregrounded() calls retryInit from main.ts's
 * visibility hook). A bounded schedule that cannot tight-loop against a dead
 * network, with the one event that means "the failure reason may be resolved"
 * kept alive for the whole session. Every attempt still requires consent to be
 * GRANTED; a fresh GRANTED resets the budget.
 */
const INIT_RETRY_DELAYS_MS: readonly number[] = [30_000, 60_000, 120_000];
let initFailures = 0;
let initRetryTimer: ReturnType<typeof setTimeout> | null = null;

function startSdk(): Promise<void> {
  sdkStart ??= applyPrivacyFlags(true)
    .then(() => LevelPlayAds.initialize({ appKey: appKey(), isTesting: TESTING }))
    .then(() => {
      initFailures = 0;
      onSdkUp();
    })
    .catch((e: unknown) => {
      sdkStart = null;
      scheduleInitRetry();
      throw e;
    });
  return sdkStart;
}

/** One pending timer at most; silence once the timed budget is spent. */
function scheduleInitRetry(): void {
  if (initRetryTimer) return;
  const spent = initFailures >= INIT_RETRY_DELAYS_MS.length;
  const delay = INIT_RETRY_DELAYS_MS[Math.min(initFailures, INIT_RETRY_DELAYS_MS.length - 1)];
  initFailures += 1;
  if (spent) return;
  initRetryTimer = setTimeout(() => {
    initRetryTimer = null;
    attemptInit();
  }, delay);
}

function cancelInitRetry(): void {
  if (initRetryTimer) clearTimeout(initRetryTimer);
  initRetryTimer = null;
}

/** Try again now — if the SDK is down, nothing is in flight, and consent still says yes. */
function attemptInit(): void {
  if (sdkUp || sdkStart || !consentGranted) return;
  cancelInitRetry();
  void startSdk().catch((e: unknown) => {
    console.warn('[levelplay] initialize retry failed', e);
  });
}

/**
 * Record a consent decision, and make what is already running follow it.
 *
 * The privacy flags go out again on every CHANGED decision while the SDK is up,
 * in both directions. startSdk() sets them once per process, so a player who
 * withdrew and then accepted again in the same session kept do_not_sell=true
 * until the next launch: their latest answer, not honoured. An unchanged answer
 * sends nothing — the same yes arrives twice at every boot (the modal's event
 * and init's own read), and the flags already say it.
 *
 * A yes resets the retry budget — a new decision is a new reason to try — and,
 * with the SDK already up, refills the cache a withdrawal left alone. A no
 * cancels any pending init retry AND every prefetch timer: the SDK cannot be
 * stopped once it is up, but it can stop being asked for ads, and "no consent,
 * no ads" has to hold for a timer set a minute before the player said no.
 */
function noteConsent(granted: boolean): void {
  const changed = !consentSettled || consentGranted !== granted;
  consentSettled = true;
  consentUnanswered = false;
  consentGranted = granted;
  if (sdkUp && changed) void applyPrivacyFlags(granted);
  if (granted) {
    initFailures = 0;
    // Only a CHANGED yes refills: prefetch() cancels a pending retry timer, and
    // the boot's repeated yes must not cut a backoff short.
    if (changed) {
      prefetch('interstitial');
      prefetch('rewarded');
    }
    return;
  }
  cancelInitRetry();
  stopPrefetch();
}

/** A decision from any source: record it, and a yes starts the SDK. */
function consentAnswered(granted: boolean): void {
  noteConsent(granted);
  if (!consentGranted) return;
  void startSdk().catch((e: unknown) => {
    console.warn('[levelplay] initialize after a late consent failed', e);
  });
}

/**
 * Start the SDK whenever consent becomes GRANTED — whenever that is.
 *
 * The plugin fires onConsentStatusChanged from requestConsentInfo() AND from
 * showPrivacyOptions(), so one listener covers both late arrivals: the player
 * who read the modal past init()'s ceiling, and the player who declined at
 * boot and later said yes from Settings → Privacy choices. Without it, both of
 * them would have no ads until the next launch, and nothing would say why.
 *
 * Attached BEFORE the modal is requested — a decision made while nothing is
 * listening is a decision lost. Idempotent: init() can run more than once in
 * tests and a second listener would start nothing new but is still one too
 * many.
 */
let consentWatched = false;

function watchConsent(): void {
  if (consentWatched) return;
  consentWatched = true;
  void LevelPlayAds.addListener(AdEvent.ConsentStatusChanged, (data: { status?: string } | null) => {
    consentAnswered(data?.status === 'GRANTED');
  }).catch(() => {
    // no native bridge (browser dev) — nothing to watch
    consentWatched = false;
  });
}

// ── Prefetch ─────────────────────────────────────────────────────────────────
/*
 * Full-screen ads are loaded AHEAD of the tap, not at it.
 *
 * AdMob loaded at the tap, and LevelPlay cannot: the plugin refuses a show
 * with "The interstitial ad is not ready yet." when nothing is loaded, and a
 * load reports only through events, up to twenty seconds later. The
 * interstitial fires on the way OUT of a win, after the player has tapped for
 * the next fold, and the rewarded ad sits behind "Watch an ad" and "Skip this
 * fold" — an un-cached load in any of those places holds a tapped button on a
 * dead screen for the whole load.
 *
 * So each format keeps one ad ready: loaded as soon as the SDK is up, loaded
 * again after every close, retried with backoff after a miss — and only while
 * consent says yes. The interstitial answers from that cache and nothing else
 * (cachedInterstitial); the rewarded ad, which the player asked for, may still
 * join or start a load at the tap (loadOrCached). The plugin's isReady() is the
 * truth at tap time; the local `ready` flag is the draw-time hint
 * rewardedReady() hands the policy layer without an await.
 */
const PREFETCH_RETRY_MIN_MS = 30_000;
const PREFETCH_RETRY_MAX_MS = 5 * 60_000;
/** A breath after close: the SDK is still tearing the ad's view down. */
const PREFETCH_AFTER_CLOSE_MS = 1_500;

type Cacheable = 'interstitial' | 'rewarded';

interface Slot {
  ready: boolean;
  loading: Promise<boolean> | null;
  retryMs: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const emptySlot = (): Slot => ({ ready: false, loading: null, retryMs: PREFETCH_RETRY_MIN_MS, timer: null });
const slots: Record<Cacheable, Slot> = { interstitial: emptySlot(), rewarded: emptySlot() };

/*
 * load() returns void the moment the request is queued, so "did it fill" is
 * only knowable from the event pair. Listeners are attached BEFORE the call:
 * a cached ad can report Loaded synchronously, and a listener attached after
 * that would wait out the whole timeout for an event already gone by.
 */
const LOADERS: Record<Cacheable, () => Promise<boolean>> = {
  interstitial: () =>
    awaitOutcome(AdEvent.InterstitialLoaded, AdEvent.InterstitialLoadFailed, LOAD_EVENT_TIMEOUT_MS, () =>
      LevelPlayAds.loadInterstitial({ adUnitId: units().interstitial })
    ).then((ok) => ok === true),
  rewarded: () =>
    awaitOutcome(AdEvent.RewardedLoaded, AdEvent.RewardedLoadFailed, LOAD_EVENT_TIMEOUT_MS, () =>
      LevelPlayAds.loadRewarded({ adUnitId: units().rewarded })
    ).then((ok) => ok === true),
};

const READY: Record<Cacheable, () => Promise<{ isReady: boolean }>> = {
  interstitial: () => LevelPlayAds.isInterstitialReady(),
  rewarded: () => LevelPlayAds.isRewardedReady(),
};

/**
 * One load per format at a time. The plugin answers a second load with
 * "Superseded by a new load request" and fails the first, so a tap landing
 * on an in-flight prefetch must JOIN it, not restart it.
 */
function load(format: Cacheable): Promise<boolean> {
  const slot = slots[format];
  slot.loading ??= LOADERS[format]().then((ok) => {
    slot.loading = null;
    slot.ready = ok;
    return ok;
  });
  return slot.loading;
}

/** Whether the SDK holds an ad of this format right now. Never throws. */
function sdkHolds(format: Cacheable): Promise<boolean> {
  return Promise.resolve()
    .then(() => READY[format]())
    .then((r) => r.isReady === true)
    .catch(() => false);
}

/**
 * What loadRewarded() does: answer from the cache when the SDK holds an ad,
 * load otherwise. The player tapped "Watch an ad" and is waiting for one, so a
 * load at the tap is what they asked for.
 */
async function loadOrCached(format: Cacheable): Promise<boolean> {
  const slot = slots[format];
  if (slot.loading) return slot.loading;
  const ready = await sdkHolds(format);
  slot.ready = ready;
  return ready || load(format);
}

/**
 * What loadInterstitial() does: answer from the cache, NOW, and never load.
 *
 * Nobody asked for this ad. It is requested at a break — leaving a win, or a
 * retry on a level the player is stuck on — and the player does not wait at a
 * break: the next stroke starts well inside a second. A load here, or joining
 * the prefetch already out, let a fill land seconds later and put a full-screen
 * ad up under a finger mid-stroke — the accidental-click pattern networks claw
 * money back for — or held the "next fold" tap for the whole load. So the
 * break shows what is already cached, or nothing.
 *
 * A miss asks for the NEXT break's ad, unless a retry is already scheduled:
 * otherwise every break inside a backoff window fired a request of its own and
 * the backoff meant nothing.
 */
async function cachedInterstitial(): Promise<boolean> {
  const slot = slots.interstitial;
  const ready = await sdkHolds('interstitial');
  slot.ready = ready;
  if (!ready && !slot.timer) prefetch('interstitial');
  return ready;
}

function prefetch(format: Cacheable): void {
  const slot = slots[format];
  // Consent is read here, not only before init: a withdrawal from Privacy
  // choices leaves the SDK up, and an up SDK kept being asked for ads.
  if (!sdkUp || !consentGranted || slot.ready || slot.loading) return;
  if (slot.timer) {
    clearTimeout(slot.timer);
    slot.timer = null;
  }
  void load(format).then((ok) => {
    if (ok) {
      slot.retryMs = PREFETCH_RETRY_MIN_MS;
      return;
    }
    // Withdrawn while the load was out: no retry. A later yes refills.
    if (!consentGranted) return;
    slot.timer = setTimeout(() => {
      slot.timer = null;
      prefetch(format);
    }, slot.retryMs);
    slot.retryMs = Math.min(slot.retryMs * 2, PREFETCH_RETRY_MAX_MS);
  });
}

/** Consent withdrawn: cancel every refill already scheduled, retries included. */
function stopPrefetch(): void {
  for (const format of ['interstitial', 'rewarded'] as const) {
    const slot = slots[format];
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
  }
}

/** The cached ad was shown (or failed to present): it is spent, fetch the next. */
function spent(format: Cacheable): void {
  const slot = slots[format];
  slot.ready = false;
  if (slot.timer) clearTimeout(slot.timer);
  slot.timer = null;
  // An ad closed after a withdrawal fetches no successor; a later yes does.
  if (!consentGranted) return;
  slot.timer = setTimeout(() => {
    slot.timer = null;
    prefetch(format);
  }, PREFETCH_AFTER_CLOSE_MS);
}

/** Persistent listeners: every terminal event of a shown ad refills its slot. */
function watchSpent(): void {
  const on = (event: string, format: Cacheable): void => {
    void LevelPlayAds.addListener(event, () => spent(format)).catch(() => {
      // no native bridge (browser dev)
    });
  };
  on(AdEvent.InterstitialClosed, 'interstitial');
  on(AdEvent.InterstitialDisplayFailed, 'interstitial');
  on(AdEvent.RewardedClosed, 'rewarded');
  on(AdEvent.RewardedDisplayFailed, 'rewarded');
}

/** Everyone waiting to hear that the SDK came up — see AdProvider.onReady. */
const readyListeners: (() => void)[] = [];

/** Runs once, when initialize() has resolved. */
function onSdkUp(): void {
  sdkUp = true;
  watchSpent();
  // startSdk() set the flags for a yes before initialize(); a no that landed
  // while initialize() was out found the SDK not yet up and set nothing.
  if (!consentGranted) void applyPrivacyFlags(false);
  prefetch('interstitial');
  prefetch('rewarded');
  // Last: a listener may ask for a banner, and the SDK is fully up by now.
  for (const cb of readyListeners) {
    try {
      cb();
    } catch {
      // the listener's failure is not the SDK's
    }
  }
}

/** Test seam: forget that the SDK was started and that consent is watched. */
export function __resetForTests(): void {
  sdkStart = null;
  sdkUp = false;
  consentWatched = false;
  consentGranted = false;
  consentSettled = false;
  consentUnanswered = false;
  consentAsk = null;
  readyListeners.length = 0;
  initFailures = 0;
  cancelInitRetry();
  bannerCreated = false;
  for (const format of ['interstitial', 'rewarded'] as const) {
    const slot = slots[format];
    if (slot.timer) clearTimeout(slot.timer);
    slots[format] = emptySlot();
  }
}

export const levelplayProvider: AdProvider = {
  // The gate markers ride along — see AD_MODE_MARKER above and ADS_MARKER in adProvider.ts.
  id: `levelplay ${AD_MODE_MARKER} ${ADS_MARKER}`,

  /*
   * FALSE ON PURPOSE, and not the same thing as TESTING.
   *
   * `testing` means "this build serves the network's test inventory and is
   * safe to tap". On LevelPlay no build is.
   *
   * `isTesting` passed to initialize() does NOT select test inventory — in the
   * plugin it maps to `setMetaDataWithKey("is_test_suite", "enable")`
   * (LevelPlayAdsImpl.swift), which only unlocks the manually-launched Test
   * Suite screen. Ordinary show() calls serve the REAL waterfall in every
   * build.
   *
   * Reporting `testing: TESTING` would light up anything that reads it as a
   * safety signal on a build serving live ads — which is why Foldwing's green
   * "TEST ADS" badge was deleted outright rather than rewired: a badge that can
   * only ever be dark is a badge nobody should learn to look for. Tapping a
   * real ad is what closed the Google account; Unity terminates for it too, and
   * additionally claws back money.
   *
   * There is no inventory control on this network. Pinning a device in the
   * dashboard narrows which NETWORK answers, for about an hour, and Unity says
   * outright that "non-bidding ad networks can only test live ads" — so it is
   * not a way to make tapping safe either. The only safe surfaces are an
   * ads-off build (nothing to tap) and the mock build (nothing real to tap).
   * TESTING itself drives AD_MODE_MARKER and the release gate, which remain
   * meaningful.
   */
  testing: false,

  supports: (format: AdFormat) => SUPPORTED.has(format),

  /*
   * CONSENT FIRST, THEN INIT — and that order is a legal requirement, not style.
   *
   * ironSource's GDPR guidance: "You must obtain user consent before
   * initializing any third-party SDK, including LevelPlay and ironSource ad
   * network. If consent is not obtained, do not initialize the LevelPlay SDK."
   * The plugin repeats it under a heading literally called "CRITICAL: Proper
   * Execution Order" (definitions.d.ts).
   *
   * Foldwing's AdMob code ran the other way round — initialize, then ATT, then
   * UMP — which IS correct for Google's UMP and is exactly the habit to lose
   * here. `initialize()` is not inert: it calls LevelPlay.initWith(), which
   * transmits device and app data to configure the waterfall — so doing it
   * first means data leaves the device before the player has been asked. The
   * milliseconds do not matter; ePrivacy conditions the access, not its length.
   *
   * Do not "tidy" this back. It reads like a nit and is not one.
   */
  async init(): Promise<void> {
    // An unconfigured key would reach the SDK as an opaque init failure some
    // frames later, looking exactly like "no fill" — the one symptom nobody
    // investigates. Fail here instead, where the reason is legible.
    if (!appKey()) {
      throw new Error(
        `levelplay: no app key for platform "${platform()}" — create that platform's app in the ` +
          'LevelPlay dashboard (it is a separate app from the other platform) and paste its key into APP_KEYS'
      );
    }
    watchConsent();
    await askConsent();
    // DENIED counts as "consent not obtained" exactly as much as UNKNOWN does.
    // KVIZKO's first version of this guard read `=== 'UNKNOWN'` and so let a
    // player who had actively tapped Decline straight through to initialize()
    // — the one case the whole ordering above exists for. Only GRANTED is a
    // yes; askConsent() decides only what the silence is RECORDED as.
    if (!consentGranted) return;
    // Rejects when initialize() fails. The policy layer swallows that, and the
    // retry schedule above takes over — see INIT_RETRY_DELAYS_MS.
    await startSdk();
  },

  /*
   * The foreground retry — see the "Start + retry" section for the schedule.
   * A flow that came back unanswered is asked again instead: nothing can start
   * without an answer, and this is the moment whatever blocked the modal (a
   * sheet the player has since closed) is most likely gone.
   */
  retryInit: () => {
    if (consentUnanswered) reaskConsent();
    else attemptInit();
  },

  consentState: (): ConsentState => (!consentSettled ? 'pending' : consentGranted ? 'granted' : 'withheld'),

  /* Up means loadable: consent alone is not enough, initialize() has to have resolved. */
  sdkReady: () => sdkUp,

  onReady(cb: () => void): void {
    readyListeners.push(cb);
  },

  async bannerShow(): Promise<void> {
    if (!bannerCreated) {
      // The iOS plugin shows a banner as soon as it fills, so creating it IS
      // showing it — and it resolves only once it has loaded, rejecting on no
      // fill. Creating a second one stacks two banner surfaces.
      await LevelPlayAds.createBanner({
        adUnitId: units().banner,
        // Fixed 320x50, never ADAPTIVE: its height is known, so the strip
        // METRICS.bannerReserve keeps clear always covers it. Adaptive varies
        // by device and could overlap the controls above the reserve.
        adSize: 'BANNER',
        // Anchored to the safe-area bottom by the plugin, not the screen edge.
        position: 'BOTTOM',
        isAutoShow: true,
      });
      bannerCreated = true;
      return;
    }
    await LevelPlayAds.showBanner();
  },
  bannerResume: () => LevelPlayAds.showBanner(),
  bannerHide: () => LevelPlayAds.hideBanner(),
  async bannerRemove(): Promise<void> {
    await LevelPlayAds.destroyBanner();
    bannerCreated = false;
  },

  /* Cache only, never a load at the break — see cachedInterstitial(). */
  loadInterstitial: () => cachedInterstitial(),

  /*
   * Resolves on DISPLAYED, not on close — which is what resolvesOnPresent()
   * promises the policy layer for this format. The wait for the player to be
   * finished is a separate concern and belongs to watchDismissal().
   *
   * Silence resolves NULL rather than false: a present that failed is a known
   * non-impression, but a Displayed event that never arrived may be an ad on
   * screen with its event lost, and the policy layer stamps the interstitial
   * time floor on that case so a second ad can never be stacked on a live one.
   */
  showInterstitial: () =>
    awaitOutcome(
      AdEvent.InterstitialDisplayed,
      AdEvent.InterstitialDisplayFailed,
      SHOW_EVENT_TIMEOUT_MS,
      () => LevelPlayAds.showInterstitial(),
      null
    ),

  /* The player asked: the cache, or a load they are waiting for — see loadOrCached(). */
  loadRewarded: () => loadOrCached('rewarded'),

  /** The draw-time hint: true while the prefetch holds a rewarded ad. */
  rewardedReady: () => slots.rewarded.ready,

  /*
   * Settles ONLY when the reward is earned, because the policy layer races this
   * promise against the dismissal watcher and reads "watcher won" as "player
   * skipped". Resolving here on close as well would make a skipped ad look like
   * a reward. A failed present still resolves null so the race cannot hang on
   * an ad that never appeared.
   */
  showRewarded: () => awaitReward(),

  resolvesOnPresent: (format: AdFormat) => format === 'interstitial',

  watchDismissal(format: AdFormat, timeoutMs: number): DismissWatcher {
    return watchLevelPlay(AD_EVENTS[format], timeoutMs);
  },
};

/**
 * Ask — ATT, then the modal, then the stored answer — and record what came back.
 *
 * Both consent calls are bounded. Unbounded, they would be the only awaits in
 * the whole ad layer without a ceiling, and they sit in front of everything: a
 * CMP that renders and never returns would leave init() pending forever, with
 * nothing logged to say why. requestConsent() swallows every error, so the
 * stored answer is read back rather than trusted from the modal's promise.
 *
 * GRANTED and DENIED are answers, and are recorded as answers. UNKNOWN is not.
 * It means the flow ran to its ceilings with nobody answering, and on this
 * plugin the likely reason is that the modal never reached the screen: it is
 * presented on the bridge view controller, and UIKit silently refuses to
 * present from a controller that is already presenting something — the Game
 * Center sign-in sheet, for one. No alert, no callback, and two minutes later
 * the stored status still reads UNKNOWN. Recording that as 'withheld' ended
 * every ad for the session for a player who was never asked, and left nothing
 * that would ever ask them. So it stays 'pending', and the next return to the
 * foreground asks again (retryInit → reaskConsent).
 */
function askConsent(): Promise<void> {
  consentAsk ??= (async () => {
    await requestConsent();
    const status = await withDeadline(
      LevelPlayAds.getConsentData()
        .then((d) => d.status)
        .catch(() => 'UNKNOWN'),
      ATT_TIMEOUT_MS, // a stored-value read, not a screen: the short ceiling
      'getConsentData',
      'UNKNOWN'
    );
    if (status === 'GRANTED' || status === 'DENIED') noteConsent(status === 'GRANTED');
    // The watcher may have recorded a late answer while the ceilings ran.
    else if (!consentSettled) consentUnanswered = true;
  })().finally(() => {
    consentAsk = null;
  });
  return consentAsk;
}

/**
 * Ask again after a flow that came back unanswered. One ask at a time: a player
 * who leaves and returns while the modal is still up must not stack a second
 * one behind it (UIKit would refuse it anyway, and its wait would run the full
 * ceiling for nothing).
 */
function reaskConsent(): void {
  if (consentAsk) return;
  void askConsent().then(() => {
    if (consentGranted) attemptInit();
  });
}

async function requestConsent(): Promise<void> {
  // iOS 14.5+ ATT — needs NSUserTrackingUsageDescription in Info.plist.
  // Asked first: it is the system's own question, and the consent modal that
  // follows is the one that decides whether the SDK starts at all.
  await withDeadline(
    LevelPlayAds.requestTrackingAuthorization().catch(() => {
      // declined / non-iOS
    }),
    ATT_TIMEOUT_MS,
    'requestTrackingAuthorization'
  );
  // Each call gets its own ceiling. Under one shared deadline a slow ATT ate
  // the modal's time, and a slow reader looked like a stalled CMP.
  await withDeadline(
    LevelPlayAds.requestConsentInfo(consentOptions()).catch(() => {
      // not required / unavailable
    }),
    CONSENT_TIMEOUT_MS,
    'requestConsentInfo'
  );
}

/** Where the modal's privacy-policy button goes. */
const PRIVACY_POLICY_URL = 'https://www.noqyris.com/foldwing/privacy.html';

/**
 * Copy for the plugin's native consent modal.
 *
 * Passing nothing is not "use the defaults" in any sense we want: the custom
 * provider falls back to a generic "We value your privacy" that names no
 * network and says nothing about what a decline does, and it silently drops the
 * privacy-policy button, which the native code only adds when a URL is
 * supplied — leaving the one screen that asks about ad data with no link to
 * the policy describing it.
 *
 * The message has to carry four facts, because a decline here is not the soft
 * "less relevant ads" of ATT — it is the end of every ad path: who serves the
 * ads (Unity LevelPlay), why they exist (they keep the game free), what
 * declining costs (no ads at all, and with them no ad-for-reveal offers), and
 * where to change it (Settings → Privacy choices). English only, like the rest
 * of the game.
 *
 * `title`, `message` and the button labels are read by the native alert but are
 * missing from the plugin's `ConsentOptions` type, which is why this returns a
 * plain object rather than one annotated as that type.
 */
function consentOptions() {
  return {
    title: 'Ads and your privacy',
    message:
      'Ads keep Foldwing free. They are served by Unity LevelPlay and its ad partners, ' +
      "which use your device's advertising identifier and basic device information to " +
      'show and measure ads, including personalised ones.\n\n' +
      'If you decline, Foldwing shows no ads at all — and no offers to watch an ad for a reveal. ' +
      'You can change your choice any time in Settings → Privacy choices.',
    acceptButtonText: 'Accept',
    declineButtonText: 'Decline',
    privacyPolicyUrl: PRIVACY_POLICY_URL,
  };
}

/**
 * Re-open the consent modal so a decision can be changed.
 *
 * Without this the first tap is final: the modal only appears while consent is
 * UNKNOWN, so a player who declined — or accepted and changed their mind — has
 * no way back, in an app that ships worldwide. GDPR treats withdrawal as having
 * to be as available as the original consent. The watcher above turns a new
 * yes into a running SDK, and a new no into do_not_sell and an end to loading.
 *
 * When this resolves, consentState() already says what the player chose: the
 * policy layer reads it straight after, to take the banner down or bring it
 * back. The plugin emits ConsentStatusChanged before it resolves, so the
 * watcher has normally recorded it; the returned status is applied only when it
 * has not (no watcher attached yet, or the two messages arrived the other way
 * round), so a normal decision still sets each flag once.
 */
export async function openPrivacyOptions(): Promise<void> {
  try {
    const data = await LevelPlayAds.showPrivacyOptions(consentOptions());
    const status = (data as { status?: string } | undefined)?.status;
    if (status !== 'GRANTED' && status !== 'DENIED') return;
    const granted = status === 'GRANTED';
    if (!consentSettled || consentGranted !== granted) consentAnswered(granted);
  } catch {
    // provider without a privacy screen, or not on device
  }
}

/**
 * Run `trigger`, then resolve TRUE on the success event and FALSE on the
 * failure event — the shape every load and show in this SDK takes.
 *
 * Timeout-guarded because a dropped event would otherwise leave the game
 * waiting for ever with its loop paused. A timeout resolves `silence`: FALSE
 * for loads, where losing an ad is cheap, and NULL for the interstitial show,
 * where "nothing heard" and "failed" must stay apart (see showInterstitial).
 */
function awaitOutcome(
  okEvent: string,
  failEvent: string,
  timeoutMs: number,
  trigger: () => Promise<unknown>,
  silence: false | null = false
): Promise<boolean | null> {
  return new Promise<boolean | null>((resolve) => {
    const handles: { remove: () => void }[] = [];
    let settled = false;
    const finish = (value: boolean | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      detach(handles);
      resolve(value);
    };
    const timer = setTimeout(() => finish(silence), timeoutMs);
    attach(okEvent, () => finish(true), handles, () => settled);
    attach(failEvent, () => finish(false), handles, () => settled);
    // Only now, with both listeners pending, is it safe to ask for the ad.
    // A rejected call ("not ready", "no view controller") emits NOTHING
    // natively, so the rejection itself is the failure.
    void trigger().catch(() => finish(false));
  });
}

/**
 * Show a rewarded ad and resolve with the reward, or null if it never arrives.
 * See showRewarded() for why close is NOT a resolution here.
 */
function awaitReward(): Promise<unknown | null> {
  return new Promise<unknown | null>((resolve) => {
    const handles: { remove: () => void }[] = [];
    let settled = false;
    const finish = (value: unknown | null): void => {
      if (settled) return;
      settled = true;
      detach(handles);
      resolve(value);
    };
    attach(AdEvent.RewardedRewarded, (info) => finish(info ?? true), handles, () => settled);
    attach(AdEvent.RewardedDisplayFailed, () => finish(null), handles, () => settled);
    void LevelPlayAds.showRewarded().catch(() => finish(null));
  });
}

/**
 * Watch for "this ad is over" — closed OR failed to present, since a failed
 * present never emits a close and would otherwise hang the wait — and remember
 * which of them it was.
 */
function watchLevelPlay(events: readonly (readonly [string, DismissReason])[], timeoutMs: number): DismissWatcher {
  const handles: { remove: () => void }[] = [];
  let why: DismissReason | null = null;
  let finish: (reason: DismissReason) => void = () => {};
  const done = new Promise<void>((resolve) => {
    finish = (reason) => {
      if (why) return;
      why = reason;
      clearTimeout(timer);
      detach(handles);
      resolve();
    };
  });
  const timer = setTimeout(() => finish('timeout'), timeoutMs);
  for (const [evt, reason] of events) attach(evt, () => finish(reason), handles, () => why !== null);
  return { done, cancel: () => finish('cancelled'), reason: () => why };
}

/**
 * Subscribe, keeping the handle so it can be detached — and detaching straight
 * away if the race was already decided while the subscription was in flight,
 * which otherwise leaks one listener per ad shown.
 */
function attach(
  event: string,
  handler: (info: unknown) => void,
  handles: { remove: () => void }[],
  isSettled: () => boolean
): void {
  try {
    void LevelPlayAds.addListener(event, handler)
      .then((h) => (isSettled() ? void h.remove() : handles.push(h)))
      .catch(() => {});
  } catch {
    // event unsupported here — the timeout still covers us
  }
}

function detach(handles: { remove: () => void }[]): void {
  for (const h of handles) {
    try {
      void h.remove();
    } catch {
      // already detached
    }
  }
}
