/**
 * The seam between "what the game decides" and "who serves the ad".
 *
 * `systems/Ads.ts` owns the policy — the interstitial cadence, the session
 * ladder, the Remove Ads entitlement, the banner hold during the opening film,
 * pausing the Phaser loop and the music under a full-screen ad. None of that is
 * specific to any network. What IS specific is a small, boring surface:
 * initialise (consent included), load, show, tell me when the player is done
 * with it, and which unit ids to use.
 *
 * That surface is this file. Adding a second network means writing one more
 * module under `providers/` — not touching the scenes that call `Ads`.
 *
 * Why it exists: Google closed the publisher account on 2026-08-18 and every
 * placement in every app went dark at once. Whatever serves the ads, the game
 * should not have to be rewritten around it.
 */

// ── Build modes ──────────────────────────────────────────────────────────────
// Two BUILD-time switches, one VITE_ variable each. Vite folds every read to a
// literal, so a switched-off branch is tree-shaken and a switched-on one leaves
// a greppable marker for the release gates.
//
//   VITE_ADS=off   ADS-OFF — a binary with no ad surface at runtime. The ad
//                  layer never initialises: no consent modal, no ATT alert from
//                  the SDK, no banner, no interstitial, no rewarded offer.
//                  Every TestFlight build is this one, including the build that
//                  follows a live App Store upload, because LevelPlay has no
//                  test inventory — a "test" build serves the real waterfall.
//   VITE_ADS=mock  our own FAKE ads, drawn in the DOM, calling no network
//                  (providers/mock.ts). Local development and QA only; every
//                  store target refuses it.
//
// Marker: ADS:on | ADS:off | ADS:mock, carried on the provider's `id` next to
// the ADMODE marker, which is what keeps a string nothing reads alive through
// minification.
//
// ADMODE (VITE_AD_MODE, providers/levelplay.ts) is separate and untouched: an
// ads-off build is still an ADMODE:test build. "Is this the store build" and
// "does this build serve any ads at all" are two questions, two markers, two
// gates.
//
// The functions read the variable at CALL time so a test can vi.stubEnv() them;
// the marker is a module constant so the bundler folds it to one literal.
export function adsOff(): boolean {
  return import.meta.env.VITE_ADS === 'off';
}

/**
 * Three values, baked once into the bundle and grepped by the release gates.
 * `mock` is the build that shows OUR fake ads and calls no network — the only
 * way to exercise the ad flow safely, since LevelPlay has no test inventory.
 * Every store target refuses it, which falls out of the gate's exact-once
 * contract for free: `test`, `live` and `off` each expect `ADS:mock ×0`.
 */
export const ADS_MARKER =
  import.meta.env.VITE_ADS === 'off' ? 'ADS:off' : import.meta.env.VITE_ADS === 'mock' ? 'ADS:mock' : 'ADS:on';

/** True in the fake-ads build. Not a network mode — there is no network. */
export function adsMock(): boolean {
  return import.meta.env.VITE_ADS === 'mock';
}

/*
 * No app-open, and no rewarded interstitial. App-open is not merely unused:
 * Unity's Placement Policy calls a placement "launched before an Application
 * has opened" a violation, so the format does not exist in this seam at all. A
 * rewarded interstitial has no placement in Foldwing and no LevelPlay format
 * behind it, and a dormant format is one wiring mistake away from a live one.
 */
export type AdFormat = 'banner' | 'interstitial' | 'rewarded';

/** Why a dismissal watcher stopped waiting. The first reason sticks. */
export type DismissReason = 'closed' | 'failed' | 'timeout' | 'cancelled';

/** A live subscription to "the ad is finished with", attached BEFORE it shows. */
export interface DismissWatcher {
  done: Promise<void>;
  cancel: () => void;
  /**
   * What ended the wait, or null while it is still waiting.
   *
   * Foldwing's rewarded contract has three outcomes, and two of them look the
   * same from the reward promise: an ad the player closed early ('declined' —
   * they backed out of the deal) and an ad that never reached the screen
   * ('unavailable' — our problem, not theirs). Only the watcher saw which
   * terminal event arrived, so it says.
   */
  reason: () => DismissReason | null;
}

/** Where the network's consent flow has landed. */
export type ConsentState = 'pending' | 'granted' | 'withheld';

export interface AdProvider {
  /**
   * For logs and for the build gates: the provider bakes `ADMODE:test|live`
   * and `ADS:on|off|mock` into this string, and the release scripts grep the
   * bundle for them — see AD_MODE_MARKER in providers/levelplay.ts and
   * ADS_MARKER above.
   */
  readonly id: string;
  /**
   * True when this build serves the network's TEST inventory, i.e. is safe to
   * tap. False on every provider Foldwing has: LevelPlay has no such inventory,
   * and the mock has no network at all.
   */
  readonly testing: boolean;

  /**
   * Not every network has every format. A caller that asks for an unsupported
   * format gets a clean no-op rather than a hang, and the UI can hide the offer
   * instead of drawing a button that leads nowhere.
   */
  supports(format: AdFormat): boolean;

  /** Consent (+ ATT) first, then the SDK — see providers/levelplay.ts init(). */
  init(): Promise<void>;

  /**
   * Optional, synchronous: 'pending' until the player has answered, 'granted'
   * once they said yes, 'withheld' once they said no. A flow that ran and came
   * back with NO answer — a modal that never reached the screen because
   * something else was presenting — stays 'pending': nobody declined, and the
   * network asks again (see retryInit). Consent gates the SDK itself, so a
   * 'withheld' network cannot serve a single ad, and the policy layer takes
   * down what is up and hides the offers. It can move either way at any time
   * (a late answer, the privacy row). A network with no consent flow of its
   * own leaves it out.
   */
  consentState?(): ConsentState;

  /**
   * Optional, synchronous: TRUE while the SDK is actually up and able to load.
   * Read at draw time — whether to promise the player an ad — so it must not
   * await anything. A network that has nothing to start leaves it out, which
   * reads as up.
   */
  sdkReady?(): boolean;

  /**
   * Optional: call `cb` whenever the SDK comes up. The policy layer replays a
   * wanted banner once at the end of init(), but the SDK can come up long after
   * that — a timed retry, a return to the foreground, a consent answered late
   * — and nothing else would tell it the banner can now be created.
   */
  onReady?(cb: () => void): void;

  bannerShow(): Promise<void>;
  bannerResume(): Promise<void>;
  bannerHide(): Promise<void>;
  bannerRemove(): Promise<void>;

  /**
   * Resolve TRUE when inventory is ready to present, FALSE otherwise — and
   * resolve it NOW. The interstitial is asked for at a break the player did
   * not choose, and a load at that moment lets a fill land seconds later over
   * the next stroke. A network that has to fetch does so ahead of the break.
   */
  loadInterstitial(): Promise<boolean>;
  /**
   * TRUE once presented (see `resolvesOnPresent`), FALSE when the present
   * failed or was refused, NULL when nothing was heard inside the ceiling —
   * the ambiguous case, in which an ad may be on screen with its event lost.
   */
  showInterstitial(): Promise<boolean | null>;

  loadRewarded(): Promise<boolean>;
  /** The reward when earned, NULL when the player left without earning it. */
  showRewarded(): Promise<unknown | null>;
  /**
   * Optional, synchronous: TRUE while the network holds a rewarded ad ready to
   * present. Read at draw time, so it must not await anything.
   */
  rewardedReady?(): boolean;

  /**
   * Optional: try once more to start an SDK whose initialize() failed after
   * consent was granted — no network at boot is the usual reason, and Unity's
   * own guidance is "try and initialize the LevelPlay SDK later". The policy
   * layer calls it on every return to the foreground; the network keeps its
   * own backoff, never runs two inits at once, and does nothing while the SDK
   * is up or consent is not GRANTED — except that a consent flow which came
   * back unanswered is asked again from here, at most one ask at a time.
   */
  retryInit?(): void;

  /**
   * Whether `show*()` settles when the ad APPEARS rather than when the player is
   * done with it. True for interstitials, false for rewarded — a difference
   * that decides whether the caller may return straight after show() or has to
   * wait on the dismissal watcher, and getting it wrong freezes the game for
   * the whole show timeout.
   */
  resolvesOnPresent(format: AdFormat): boolean;

  /**
   * Subscribe to every terminal event for a format — dismissed, or failed to
   * present at all. Must be attached BEFORE showing: a fast tap on the close
   * button fires the dismissal while nothing is listening.
   */
  watchDismissal(format: AdFormat, timeoutMs: number): DismissWatcher;
}
