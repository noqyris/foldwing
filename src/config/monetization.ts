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
   * Google's test units instead of the live ones. FALSE unless the build was
   * explicitly asked for it, and there is no way to commit it true.
   *
   * A TestFlight build needs this. A new AdMob app shows "Requires review /
   * Limited ad serving" until the app is PUBLIC on the store, so live units
   * return no-fill and a tester sees blank space where the ads are — they
   * cannot judge placement or frequency at all, which is the main thing worth
   * judging before release. Test units render immediately.
   *
   * It is a BUILD-TIME env var, not a checked-in constant, because a checked-in
   * constant is how build 19 came to carry Google's test ids inside a signed,
   * uploadable ipa. `npm run ios:sync` cannot produce a test-ads build; only
   * `npm run ios:sync:testads` can, and it leaves nothing behind on disk that a
   * later archive could pick up by accident. See `fastlane beta_testads`.
   *
   * Shipping test ads to real users violates AdMob policy, and clicking your
   * own LIVE ads is invalid traffic — the most common way to get an account
   * banned. Both are prevented by the same property: the tree is always in
   * submission state.
   */
  useTestAds: import.meta.env.VITE_TEST_ADS === '1',

  products: {
    /** Non-consumable. Kills the banner and interstitials, unlocks unlimited reveals. */
    removeAds: 'com.noqyris.foldwing.removeads',

    /**
     * THE LADDER, cheapest first, and it ends at Remove Ads on purpose.
     *
     *     10 reveals   $0.99   9.90¢ each
     *     20 reveals   $1.49   7.45¢ each   (−25%)
     *     30 reveals   $1.99   6.63¢ each   (−33%)
     *     unlimited    $2.99   —            and no ads, ever
     *
     * Four rungs, each better value than the last, and the top one is not a
     * pack at all. A dollar past the 30-pack buys reveals that never run out,
     * which makes the permanent unlock the obvious end of the row rather than a
     * separate thing sold on another screen — and a permanent unlock is worth
     * more than any number of consumables from a player who was going to spend
     * once.
     *
     * WHY THESE COUNTS AND NOT 10/25/30. Twenty-five at $1.49 works on its own
     * (6.0¢) but not with thirty at $1.99 above it (6.63¢): the bigger pack
     * would cost MORE per reveal than the smaller one, so the row stops being a
     * ladder and starts being a trap for whoever does not do the arithmetic.
     * Every rung has to beat the one below it on unit price — pinned by a test.
     *
     * The consumables must also stay strictly under the price of unlimited. A
     * pack priced the same as unlimited-plus-no-ads cannot be bought by anyone
     * who reads both rows; that was the state when the 10-pack and Remove Ads
     * both sat at $0.99, and it is why the top of the ladder moved to $2.99
     * when a $1.99 pack was added underneath it.
     *
     * Counts live in the product ids because a StoreKit id is immutable —
     * changing what a pack holds means a new product, and an id that disagrees
     * with the count is a player charged for something other than what the
     * button said.
     */
    revealPacks: [
      { id: 'com.noqyris.foldwing.reveals10', count: 10 },
      { id: 'com.noqyris.foldwing.reveals20', count: 20 },
      { id: 'com.noqyris.foldwing.reveals30', count: 30 },
    ],
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
     *
     * Raised from 5 to 8 deliberately. A run of failures is a difficulty spike,
     * and a difficulty spike is where the REWARDED offer belongs: measured
     * across casual titles, rewarded video at a difficulty spike lifts
     * retention, while interstitial frequency is the single strongest
     * correlate of first-session churn. The rescue ladder already fires at
     * three deaths and six; by the time this count is reached the game is
     * selling the thing that pays three times as much (see the suppression in
     * `maybeAdOnRetry`).
     */
    interstitialEveryNAttempts: 8,

    /**
     * THE SESSION LADDER.
     *
     * Ads get less rare the longer someone has been playing, instead of one
     * flat interval that is either too aggressive at minute one or too shy at
     * minute thirty. The shape is the one that holds up across casual
     * benchmarks: rewarded only while the session is young, interstitials at a
     * generous spacing once the player is engaged, tightening after they have
     * settled in for a long sitting.
     *
     * The previous flat pair — 90s warm-up, 120s floor, four per session —
     * front-loaded every ad it was ever going to show into the first ten
     * minutes and then went silent for the rest of the session. That is
     * backwards on both ends: heaviest exactly where churn happens, and
     * nothing at all from the players least likely to leave.
     */

    /** No ad at all while the session is this young. Rewarded still works. */
    sessionWarmupSeconds: 180,

    /** Floor between two interstitials for the rest of the first stretch. */
    minSecondsBetweenInterstitials: 180,

    /** Once a session has run this long, the floor drops to the value below. */
    longSessionAfterSeconds: 600,
    lateSecondsBetweenInterstitials: 120,

    /**
     * Bounded per session however long someone plays — a backstop, not the
     * pacing mechanism. At the floors above, a session would have to run past
     * twenty minutes to reach it.
     */
    maxInterstitialsPerSession: 8,

    /**
     * Away this long and the next launch counts as a NEW session: warm-up
     * re-arms and the per-session cap resets.
     *
     * "Session" used to mean the lifetime of the process, so a phone that sat
     * in a pocket all afternoon came back with the cap already spent and never
     * showed another ad until the app was force-quit — while a player who
     * merely checked a message lost their warm-up grace. Thirty minutes is the
     * usual line between "still the same sitting" and "came back later".
     */
    newSessionAfterAwaySeconds: 1800,

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

/** What a store row needs to work out whether it is a better deal. */
export interface PricedPack {
  readonly count: number;
  /** Localised price in millionths. 0 when the store has not answered yet. */
  readonly priceMicros: number;
}

/**
 * How much cheaper per reveal a pack is than the cheapest one, as a percent.
 *
 * Computed from real numbers rather than written into the copy, because the
 * copy would be a lie in most of the world: Apple's price tiers are not
 * proportional across storefronts, so a pack that saves 25% in dollars can save
 * 19% or 31% somewhere else. A badge that says otherwise is a false claim about
 * a price, on 175 storefronts, made by a string literal.
 *
 * Null whenever the claim cannot be made honestly — before the store has
 * answered, or when the bigger pack is not actually better value. Callers show
 * no badge rather than a zero.
 */
export function packSaving(base: PricedPack, pack: PricedPack): number | null {
  if (base.priceMicros <= 0 || pack.priceMicros <= 0) return null;
  if (base.count <= 0 || pack.count <= 0) return null;

  const perReveal = pack.priceMicros / pack.count;
  const basePerReveal = base.priceMicros / base.count;
  const saved = Math.round((1 - perReveal / basePerReveal) * 100);
  return saved > 0 ? saved : null;
}

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
