/**
 * Monetization — the ONE place where money touches this game.
 *
 * The design problem, stated honestly: Foldwing's retention engine is a
 * fail-to-retry loop under one second. Anything that interrupts that loop does
 * not cost a little revenue, it costs the player. So the placements below are
 * chosen around three moments that are already interruptions, and nothing else.
 *
 *   1. LEAVING a win. The player has seen their figure, absorbed it, and tapped
 *      to move on. That tap is the only natural break the game has. The ad fires
 *      AFTER the figure has been shown and dismissed — never over it, because
 *      the figure is the reward and an ad chaser would spend the best moment in
 *      the game to sell the cheapest impression in it.
 *   2. THE MENU AND LEVEL SELECT. A banner lives here and only here. During play
 *      a banner would either eat the playfield or sit exactly under the thumb.
 *   3. A VOLUNTARY ASK. Rewarded video, opt-in, reward named before the video.
 *
 * And the one placement that needs its constraints stated, because the naive
 * version of it kills the product:
 *
 *   A RETRY INTERSTITIAL, GATED ON BOTH AXES. Failing is the most common event
 *   in the game by an order of magnitude, which makes it look like the richest
 *   ad slot on the board. An attempt counter alone — "every 5th try" — would
 *   put an ad on screen roughly every 25 seconds on a level someone is stuck
 *   on, and AdMob policy explicitly forbids triggering an interstitial "every
 *   time a user clicks", with ad serving disabled over it. So the COUNT is only
 *   a permission and the CLOCK is the brake: `interstitialEveryNAttempts` AND
 *   `minSecondsBetweenInterstitials`, both, never either. `monetization.test.ts`
 *   pins the arithmetic so the count can never outrun the time floor.
 *
 *   This placement was originally absent by design and was added deliberately.
 *   If you are tempted to loosen either gate, the failure mode is not lost
 *   retention — it is a disabled ad account.
 */

import { Capacitor } from '@capacitor/core';

export interface AdUnits {
  /** ca-app-pub-XXXX~NNNN — the tilde one. Goes in the NATIVE config, not here. */
  readonly appId: string;
  readonly banner: string;
  readonly interstitial: string;
  readonly rewarded: string;
}

/**
 * Google's official test units — serve real test ads with no account, and are
 * safe to tap. iOS and Android have different ones; using the iOS units on
 * Android is the classic silent no-fill bug.
 */
const TEST_IOS: AdUnits = {
  appId: 'ca-app-pub-3940256099942544~1458002511',
  banner: 'ca-app-pub-3940256099942544/2934735716',
  interstitial: 'ca-app-pub-3940256099942544/4411468910',
  rewarded: 'ca-app-pub-3940256099942544/1712485313',
};

const TEST_ANDROID: AdUnits = {
  appId: 'ca-app-pub-3940256099942544~3347511713',
  banner: 'ca-app-pub-3940256099942544/6300978111',
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
  rewarded: 'ca-app-pub-3940256099942544/5224354917',
};

/**
 * Live units for com.noqyris.foldwing — AdMob app "Foldwing: Mirror Puzzle",
 * publisher ca-app-pub-3307486877162157.
 *
 * These are real and verified against the console's ad-unit list, format by
 * format: putting the interstitial id in the banner slot is a silent no-fill
 * that looks exactly like "ads are broken".
 *
 * `appId` is duplicated in ios/App/App/Info.plist as GADApplicationIdentifier.
 * The two must always agree, and both must match `useTestAds`.
 */
const LIVE_IOS: AdUnits = {
  appId: 'ca-app-pub-3307486877162157~5033197766',
  banner: 'ca-app-pub-3307486877162157/6426316277',
  interstitial: 'ca-app-pub-3307486877162157/4373767928',
  rewarded: 'ca-app-pub-3307486877162157/5113234608',
};

/**
 * Empty ON PURPOSE — there is no Play listing and therefore no Android AdMob
 * app to draw ids from. `adsConfigured()` reads the interstitial slot and
 * returns false for a blank one, so on Android every ad path no-ops cleanly
 * instead of firing requests that could only fail.
 *
 * Fill these in at the same moment the Play listing is created, not before: a
 * half-filled set is worse than an empty one, because `adsConfigured()` would
 * then report true and the requests would start failing for real.
 */
const LIVE_ANDROID: AdUnits = {
  appId: '',
  banner: '',
  interstitial: '',
  rewarded: '',
};

export const monetization = {
  /**
   * FALSE is the submission state, and the default.
   *
   * Flipping it to true swaps in Google's test units, which actually render —
   * useful for judging placement, because a new AdMob app shows "Requires
   * review / Limited ad serving" until the app is public, so live units
   * return no-fill and a TestFlight build looks broken.
   *
   * If you do flip it, flip `GADApplicationIdentifier` in Info.plist with it
   * and FLIP BOTH BACK BEFORE ARCHIVING. Shipping Google's test ads to real
   * users violates AdMob policy, and clicking your own LIVE ads is invalid
   * traffic — the most common way to get an AdMob account banned.
   *
   * `monetization.test.ts` pins the two together, and — because "both on TEST"
   * used to be a PASSING state and shipped that way into build 19 — a separate
   * test now fails outright on Google's test publisher id in the plist,
   * whatever this flag says.
   */
  useTestAds: false,

  products: {
    /** Non-consumable. Kills the banner and interstitials, unlocks unlimited reveals. */
    removeAds: 'com.noqyris.foldwing.removeads',
    /**
     * Consumable hint pack — the second pillar of puzzle IAP. Offered at the
     * out-of-reveals moment, next to the rewarded option, never instead of
     * it: reveals must stay earnable or the rewarded loop stops being honest.
     */
    revealPack: 'com.noqyris.foldwing.reveals20',
    revealPackCount: 20,
  },

  ads: {
    /**
     * Onboarding grace. The first levels teach the mirror; a player who has not
     * yet felt the hook monetizes badly and churns easily.
     */
    interstitialFromLevel: 8,
    /** One interstitial per N wins — a rhythm the player can learn. */
    interstitialEveryNWins: 3,

    /**
     * Failed attempts before an interstitial may fire on a retry.
     *
     * This is HALF a gate. It is useless on its own and must never be used
     * without the time floor below, because a failed attempt in this game lasts
     * three to eight seconds: "every 5th attempt" alone would mean an ad every
     * 25 seconds. AdMob's own policy forbids triggering an interstitial "every
     * time a user clicks within the app" and warns that ad serving gets
     * disabled for it, so the count is the permission and the clock is the
     * brake. Industry practice is exactly this pair — minimum seconds AND
     * minimum actions since the last ad, both required.
     */
    interstitialEveryNAttempts: 5,

    /**
     * Hard floor between two interstitials, whatever the counters say. This is
     * the number that actually governs pacing on a level someone is stuck on.
     */
    minSecondsBetweenInterstitials: 120,

    /** No ad in the opening stretch of a session, however many events land. */
    sessionWarmupSeconds: 90,

    /** Bounded per session regardless of how long someone plays. */
    maxInterstitialsPerSession: 4,
    /** After a volunteered rewarded view, stop taxing them for a while. */
    muteAfterRewardedSeconds: 300,
  },

  reveals: {
    /**
     * A "reveal" paints the mirror's forbidden bands onto the left half for a
     * few seconds — the exact information the player is struggling to hold in
     * their head, and the reason this game is hard in a good way.
     */
    grantedPerRewarded: 1,
    freeDailyTopUp: 1,
    startingStash: 2,
    durationMs: 6000,
    /**
     * The escalation ladder, in deaths on one level: at three, point at the
     * fold (the contextual reveal offer — the highest-value rewarded moment
     * in the game); at six, offer the way past. The gap between them exists
     * so the game visibly tries to TEACH before it offers to excuse.
     */
    offerRevealAfterAttempts: 3,
    /** Only offer the skip once the level has genuinely resisted them. */
    offerSkipAfterAttempts: 6,
  },

  rate: {
    /** Ask at a delight peak, once, and never alongside an ad. */
    firstPromptAfterWins: 6,
  },
} as const;

const isAndroid = (): boolean => Capacitor.getPlatform() === 'android';

/** The unit set actually in force, resolved at call time so tests can vary it. */
export function admobUnits(): AdUnits {
  if (monetization.useTestAds) return isAndroid() ? TEST_ANDROID : TEST_IOS;
  return isAndroid() ? LIVE_ANDROID : LIVE_IOS;
}

/**
 * False until real unit ids exist for THIS platform — every ad path then no-ops
 * cleanly rather than firing requests that can only fail.
 */
export const adsConfigured = (): boolean => admobUnits().interstitial.length > 0;
