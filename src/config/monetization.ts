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
 *   2. A BANNER, ALWAYS ON, IN EVERY SCENE — gameplay included. It is a native
 *      view pinned to the bottom of the screen, and every scene keeps its strip
 *      clear (METRICS.bannerReserve; the playfield's bottom inset clears it
 *      too), so it covers paper margin and never the playfield or anything the
 *      player can touch: a control under an ad is an accidental-click generator.
 *      Shown once and left up across scene changes (Ads.showBanner); it comes
 *      down only for Remove Ads or withdrawn consent.
 *   3. A VOLUNTARY ASK. Rewarded video, opt-in, reward named before the video.
 *
 * And the one placement that needs its constraints stated, because the naive
 * version of it kills the product:
 *
 *   A RETRY INTERSTITIAL, GATED ON BOTH AXES. Failing is the most common event
 *   in the game by an order of magnitude, which makes it look like the richest
 *   ad slot on the board. An attempt counter alone — "every 5th try" — would
 *   put an ad on screen roughly every 25 seconds on a level someone is stuck
 *   on, and ad-network placement policies forbid an interstitial triggered on
 *   every user action, with ad serving disabled over it. So the COUNT is only
 *   a permission and the CLOCK is the brake: `interstitialEveryNAttempts` AND
 *   `minSecondsBetweenInterstitials`, both, never either. `monetization.test.ts`
 *   pins the arithmetic so the count can never outrun the time floor.
 *
 *   This placement was originally absent by design and was added deliberately.
 *   If you are tempted to loosen either gate, the failure mode is not lost
 *   retention — it is a disabled ad account.
 */

export const monetization = {
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
     * 25 seconds. Ad-network placement policies forbid an interstitial
     * triggered on every user action within the app and disable ad serving
     * for it, so the count is the permission and the clock is the brake. Industry practice is exactly this pair — minimum seconds AND
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

    /**
     * No ad at all while the session is this young. Rewarded still works.
     * Counted in time PLAYED — foreground only, see SessionClock — because a
     * phone locked for twenty minutes has not warmed anyone up.
     */
    sessionWarmupSeconds: 180,

    /** Floor between two interstitials for the rest of the first stretch. */
    minSecondsBetweenInterstitials: 180,

    /** Once a session has been PLAYED this long, the floor drops to the value below. */
    longSessionAfterSeconds: 600,
    lateSecondsBetweenInterstitials: 120,

    /**
     * Bounded per session however long someone plays — a backstop, not the
     * pacing mechanism. At the floors above, a session would have to run past
     * twenty minutes to reach it.
     */
    maxInterstitialsPerSession: 8,

    /*
     * What a SESSION is — and so when the cap above resets and the warm-up
     * re-arms — is not a knob here. It is the app's one rule, core/Session
     * (SESSION_GAP_MS): a cold launch, a return after 30 minutes or more, or a
     * return into a new day. This config used to hold the 30 minutes as
     * `newSessionAfterAwaySeconds`, read by two private copies of the rule.
     */

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

  /**
   * THE FAUCETS. Every way a reveal arrives that is not a purchase, sized
   * together because they only make sense together (monetization.test.ts pins
   * the sums).
   *
   * The rule behind the numbers: an engaged player who never pays and never
   * watches an ad should still gain a few reveals a day — enough that the
   * currency is something they have, not something they are denied — and
   * never as many as the smallest pack holds. A day's free supply that matched
   * a pack would make the pack a thing nobody needs.
   */
  economy: {
    /**
     * Ad-paid reveals per local day, across every placement that pays reveals
     * (the store row, the refill, the three-death offer, the chapter doubler).
     * The skip and the streak repair are rescues, not currency, and are not
     * counted. Without a cap an ad is a better deal than every pack, forever.
     */
    rewardedRevealsPerDay: 5,
    /** Three a day, slot one always the Daily; each pays itself on completion. */
    missions: { count: 3, reward: 1, unlockAfterIndex: 5 },
    /** Halfway and complete. Skipped levels do not count toward either mark. */
    chapter: { size: 20, halfReward: 1, fullReward: 2 },
    streak: {
      /** Bookmarks held at most; each covers one missed day of a run ≥ guardMinRun. */
      bookmarkMax: 2,
      /** Streak days that earn a bookmark, besides every `bookmarkEvery`th. */
      bookmarkAt: [3],
      bookmarkEvery: 7,
      guardMinRun: 2,
      /** What a bookmark earned at the cap pays instead. */
      overflowReveals: 1,
      /** Reveals paid on the day the streak reaches each of these. */
      milestones: { 7: 2, 14: 3, 30: 5, 50: 5, 100: 10 },
      everyFiftyAfter100: 5,
    },
    /** One missed day, a run worth keeping, and not a habit. */
    repair: { maxGapDays: 1, cooldownDays: 14, minRun: 2 },
    /**
     * The starter pack reuses the one product never sold, whose id already
     * names its count — ids are permanent, so no new one is minted for it.
     * Sold once per install, and only after the game has had five wins to
     * earn the ask.
     */
    starter: { id: 'com.noqyris.foldwing.reveals25', count: 25, afterWins: 5 },
  },

  /**
   * The win card's board frame: how far the maze shrinks to make room for the
   * result. Setting either to 1 turns the move off without touching code.
   */
  ui: { winFrameScale: 0.74, winFrameScaleDaily: 0.7 },
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

type IdPack = PricedPack & { readonly id: string };

const priced = (p: PricedPack): boolean => p.priceMicros > 0 && p.count > 0;
const unit = (p: PricedPack): number => p.priceMicros / p.count;

/**
 * The rungs worth selling in THIS storefront, smallest first.
 *
 * The dollar ladder is honest, but Apple's tiers are not proportional across
 * currencies: in Serbia the 20-pack and the 30-pack are both €1.99, and in the
 * UK the 10-pack and the 20-pack are both £0.99. Shown as-is, one row there
 * sells fewer reveals for the same money as the row beside it — a trap for
 * whoever does not do the arithmetic, on a screen that exists to be trusted.
 * The ids are permanent, so the fix is at runtime: drop every rung another
 * rung dominates (as many or more for as little or less), then keep only rungs
 * whose price per reveal strictly falls as they grow.
 *
 * Unpriced (the store has not answered) returns the list untouched: rows show
 * as waiting, and nothing is judged on a price that is not there.
 */
export function sellableLadder<T extends IdPack>(packs: readonly T[]): T[] {
  if (!packs.every(priced)) return [...packs];

  const undominated = packs.filter(
    (a, i) =>
      !packs.some(
        (b, j) =>
          j !== i &&
          b.count >= a.count &&
          b.priceMicros <= a.priceMicros &&
          // Identical rungs: the first one stands, so exactly one survives.
          (b.count > a.count || b.priceMicros < a.priceMicros || j < i)
      )
  );

  const kept: T[] = [];
  for (const p of [...undominated].sort((a, b) => a.count - b.count)) {
    const last = kept[kept.length - 1];
    if (!last || unit(p) < unit(last)) kept.push(p);
  }
  return kept;
}

/**
 * The rung that earns a BEST VALUE tag, if any does.
 *
 * Only among two or more rungs (a lone row is not "best" of anything), and only
 * when it saves at least 15% on the smallest shown rung: a badge on a 4% saving
 * is a claim the arithmetic does not support.
 */
export function bestValueId(kept: readonly IdPack[]): string | null {
  if (kept.length < 2 || !kept.every(priced)) return null;
  const base = kept.reduce((a, b) => (b.count < a.count ? b : a));
  const best = kept.reduce((a, b) => (unit(b) < unit(a) ? b : a));
  if (best === base) return null;
  const saving = packSaving(base, best);
  return saving !== null && saving >= 15 ? best.id : null;
}

/**
 * Whether the starter is honestly a deal here: cheaper per reveal than every
 * rung on sale. At $1.49 it became €1.99 — the same money as thirty reveals
 * for twenty-five — so the check is on the prices the store returned, never on
 * the dollar plan. False when anything is unpriced, or when no rung is on sale
 * (the store returned the starter and no pack): "save 60%" cannot be said
 * about a number nobody has seen, nor against nothing.
 */
export function starterWorthShowing(starter: PricedPack, kept: readonly PricedPack[]): boolean {
  if (kept.length === 0 || !priced(starter) || !kept.every(priced)) return false;
  return kept.every((p) => unit(starter) < unit(p));
}
