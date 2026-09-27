import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { milestonesBetween } from '../core/Streak';
import {
  bestValueId,
  monetization,
  packSaving,
  sellableLadder,
  starterWorthShowing,
  type PricedPack,
} from './monetization';

/*
 * Anchored to this file, not to the working directory. A cwd-relative path
 * reads nothing when the suite is invoked from anywhere but the repo root, and
 * a plist that fails to load silently turns every assertion below into a
 * comparison against the empty string.
 */
const repo = (p: string): string =>
  fileURLToPath(new URL(`../../${p}`, import.meta.url));

const PLIST = repo('ios/App/App/Info.plist');
const XCPRIVACY = repo('ios/App/App/PrivacyInfo.xcprivacy');
const PBXPROJ = repo('ios/App/App.xcodeproj/project.pbxproj');

/** The value of a <key>/<string> pair in an Info.plist. */
function plistString(key: string): string {
  const xml = readFileSync(PLIST, 'utf8');
  const m = new RegExp(
    `<key>${key}</key>\\s*<string>([^<]*)</string>`,
    'm'
  ).exec(xml);
  return m ? m[1].trim() : '';
}

describe('the native project', () => {
  /*
   * Google closed the publisher account for good, and a Google ad identifier
   * left in the native project is not inert: the Google Mobile Ads SDK reads
   * GADApplicationIdentifier at launch, and KVIZKO crashed at launch with
   * GADInvalidInitializationException when the LevelPlay sync hook deleted the
   * key while the SDK was still linked. Nothing of it may remain — not the key,
   * not the build setting that fed it, not an id in any form.
   *
   * The needle is built from parts so this file does not contain what it
   * forbids.
   */
  const GOOGLE_ID = ['ca', 'app', 'pub'].join('-');

  it('carries no Google ad identifier of any kind', () => {
    const plist = readFileSync(PLIST, 'utf8');
    const pbx = readFileSync(PBXPROJ, 'utf8');
    for (const [name, text] of [['Info.plist', plist], ['project.pbxproj', pbx]] as const) {
      expect(text, name).not.toContain('GADApplicationIdentifier');
      expect(text, name).not.toContain('GAD_APPLICATION_IDENTIFIER');
      expect(text.includes(GOOGLE_ID), `${name} carries a Google ad id`).toBe(false);
      expect(/pub-\d{16}/.test(text), `${name} carries a Google publisher id`).toBe(false);
    }
  });

  /*
   * The plugin's native side picks its consent UI from this key, and a missing
   * key means Usercentrics (LevelPlayAdsImpl.swift, `consentMode`), a CMP
   * Foldwing is not set up for. `custom` is the plugin's own alert, the one
   * that shows Foldwing's copy (providers/levelplay.ts, consentOptions).
   */
  it('selects the custom consent modal the provider writes copy for', () => {
    expect(plistString('LevelPlayCMPProvider')).toBe('custom');
  });

  it('declares ATT and the SKAdNetwork ids LevelPlay and Unity Ads attribute through', () => {
    const xml = readFileSync(PLIST, 'utf8');
    expect(plistString('NSUserTrackingUsageDescription').length).toBeGreaterThan(20);
    expect(xml).toContain('SKAdNetworkItems');
    // ironSource (LevelPlay itself) and Unity Ads, the network in the waterfall.
    expect(xml).toContain('su67r6k2v3.skadnetwork');
    expect(xml).toContain('4dzt52r2t5.skadnetwork');
    // Google's own network id goes with Google: it attributed installs for an
    // account that no longer exists, and the no-Google gate refuses it.
    expect(xml).not.toContain('cstr6suwn9');
  });

  /*
   * capacitor-levelplay-ads declares `s.ios.deployment_target = '15.0'`. A
   * project that still targets 14 either refuses to install the pod or builds
   * an app that claims to run where its ad SDK cannot. Every configuration,
   * not just Release: the simulator and the archive must agree.
   */
  it('targets iOS 15, the floor the LevelPlay plugin requires', () => {
    const pbx = readFileSync(PBXPROJ, 'utf8');
    const targets = [...pbx.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([\d.]+);/g)].map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) expect(t).toBe('15.0');
  });

  /*
   * Picking "Save Image" from the share sheet runs the save inside this app's
   * process, so iOS requires the add-only photo permission string. Its absence
   * is an immediate SIGABRT, not a denial — and the share pill is reachable
   * from the win screen, the gallery and the web-daily end card, which makes it
   * one of the first things a reviewer taps.
   */
  it('carries the photo-add permission the share sheet crashes without', () => {
    expect(plistString('NSPhotoLibraryAddUsageDescription').length).toBeGreaterThan(20);
  });

  /*
   * @capacitor/preferences (UserDefaults) and @capacitor/filesystem (file
   * timestamps) ship no privacy manifest of their own, so the App target has to
   * declare those required-reason APIs or Apple returns ITMS-91053.
   */
  it('ships a privacy manifest declaring the required-reason APIs', () => {
    const xcp = readFileSync(XCPRIVACY, 'utf8');
    expect(xcp).toContain('NSPrivacyAccessedAPICategoryUserDefaults');
    expect(xcp).toContain('CA92.1');
    expect(xcp).toContain('NSPrivacyAccessedAPICategoryFileTimestamp');
    expect(xcp).toContain('C617.1');

    // It is only in the bundle if the Xcode project copies it.
    const pbx = readFileSync(PBXPROJ, 'utf8');
    expect(pbx).toContain('PrivacyInfo.xcprivacy in Resources');
  });

  /*
   * fastlane derives the next build number from TestFlight and writes it into
   * CURRENT_PROJECT_VERSION. A literal here reads none of that: the archive
   * keeps the old number and App Store Connect rejects it as a duplicate.
   */
  it('lets the build number come from the build setting fastlane increments', () => {
    expect(plistString('CFBundleVersion')).toBe('$(CURRENT_PROJECT_VERSION)');
    expect(plistString('CFBundleShortVersionString')).toBe('$(MARKETING_VERSION)');
  });
});

describe('the reveal pack', () => {
  /*
   * A StoreKit product id is immutable once created, so changing what a pack
   * contains means creating a NEW product — and the id left behind still
   * advertises the old count. `…reveals20` granting ten is a player charged for
   * something other than what the button said, which is the one class of bug in
   * this file that costs real money and real trust.
   */
  it('names in every product id exactly what it grants', () => {
    for (const pack of monetization.products.revealPacks) {
      const declared = /\.reveals(\d+)$/.exec(pack.id);
      expect(declared, pack.id).not.toBeNull();
      expect(Number(declared![1]), pack.id).toBe(pack.count);
    }
  });

  it('keeps the consumables and the permanent unlock distinct', () => {
    const ids = monetization.products.revealPacks.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(monetization.products.removeAds);
  });

  /*
   * A ladder only works in one direction. Each rung has to give more reveals
   * for less money apiece than the rung below it, or the middle of the row is
   * a worse deal than both its neighbours and the player is being asked to do
   * arithmetic to avoid being overcharged.
   */
  it('gets cheaper per reveal as the packs get bigger', () => {
    const packs = monetization.products.revealPacks;
    expect(packs.length).toBeGreaterThan(0);
    for (let i = 1; i < packs.length; i += 1) {
      expect(packs[i].count).toBeGreaterThan(packs[i - 1].count);
    }
  });
});

/*
 * "save 25%" is a claim about a price, shown on 175 storefronts. Apple's tiers
 * are not proportional across currencies, so the same two packs really do save
 * different amounts in different places — which is why the badge is computed
 * from the numbers the store returns and never written into the copy.
 */
describe('the savings badge', () => {
  const base = { count: 10, priceMicros: 990_000 };

  it('reports what the bigger pack actually saves per reveal', () => {
    expect(packSaving(base, { count: 20, priceMicros: 1_490_000 })).toBe(25);
    expect(packSaving(base, { count: 30, priceMicros: 1_990_000 })).toBe(33);
  });

  it('follows the local prices rather than the dollar ones', () => {
    // Same counts, a storefront whose tiers happen to be nearly proportional:
    // the honest badge there is much smaller, and must say so.
    expect(packSaving(base, { count: 20, priceMicros: 1_900_000 })).toBe(4);
  });

  it('says nothing at all rather than something untrue', () => {
    // No price yet — the store has not answered.
    expect(packSaving(base, { count: 20, priceMicros: 0 })).toBeNull();
    expect(packSaving({ count: 10, priceMicros: 0 }, { count: 20, priceMicros: 1 })).toBeNull();
    // Bigger pack, worse value. This is the 25-at-$1.49 / 30-at-$1.99 shape.
    expect(
      packSaving({ count: 25, priceMicros: 1_490_000 }, { count: 30, priceMicros: 1_990_000 })
    ).toBeNull();
    // Same value per reveal is not a saving.
    expect(packSaving(base, { count: 20, priceMicros: 1_980_000 })).toBeNull();
  });

  it('never divides by a count of zero', () => {
    expect(packSaving({ count: 0, priceMicros: 990_000 }, base)).toBeNull();
    expect(packSaving(base, { count: 0, priceMicros: 990_000 })).toBeNull();
  });
});

describe('ad cadence', () => {
  const a = monetization.ads;

  it('protects onboarding', () => {
    expect(a.interstitialFromLevel).toBeGreaterThanOrEqual(6);
  });

  it('keeps interstitials rare and spaced', () => {
    expect(a.interstitialEveryNWins).toBeGreaterThanOrEqual(3);
    expect(a.minSecondsBetweenInterstitials).toBeGreaterThanOrEqual(120);
    expect(a.lateSecondsBetweenInterstitials).toBeGreaterThanOrEqual(120);
    expect(a.sessionWarmupSeconds).toBeGreaterThanOrEqual(120);
  });

  /*
   * The ladder only makes sense in one direction: generous while the session is
   * young, tighter once it is clearly long. Inverting the two would put the
   * heaviest frequency exactly where first-session churn happens, which is the
   * shape the flat 90s/120s pair had and the reason it was replaced.
   */
  it('gets no stricter with time, only more permissive', () => {
    expect(a.lateSecondsBetweenInterstitials).toBeLessThanOrEqual(
      a.minSecondsBetweenInterstitials
    );
    expect(a.longSessionAfterSeconds).toBeGreaterThan(a.sessionWarmupSeconds);
  });

  /*
   * The per-session cap is a backstop, not the pacing mechanism. If it is low
   * enough to bind before the floors do, it is the cap that shapes the session
   * — which is what made the old model front-load every ad it would ever show
   * into the first ten minutes and then go silent.
   */
  it('caps above what the time floors alone would allow in a long session', () => {
    const halfHour = 30 * 60;
    const reachable = Math.floor(
      (halfHour - a.sessionWarmupSeconds) / a.lateSecondsBetweenInterstitials
    );
    expect(a.maxInterstitialsPerSession).toBeGreaterThanOrEqual(reachable / 2);
  });

  /*
   * The retry path is the dangerous one. A failed attempt lasts three to eight
   * seconds, so the attempt count ALONE would put an ad on screen every twenty
   * seconds — the pattern ad networks disable ad serving over.
   *
   * The count is only ever a permission; the clock is the brake. This pins the
   * arithmetic so nobody can make the game more aggressive by editing one
   * number in isolation: even in the worst case of instant failures, the floor
   * holds the interval to minutes.
   */
  it('cannot fire on retries faster than the time floor allows', () => {
    expect(a.interstitialEveryNAttempts).toBeGreaterThanOrEqual(3);

    const fastestFailSeconds = 3;
    const soonestByCount = a.interstitialEveryNAttempts * fastestFailSeconds;
    expect(soonestByCount).toBeLessThan(a.lateSecondsBetweenInterstitials);

    // Worst case a player can actually experience, in minutes between ads.
    const worstCaseGapMinutes = a.lateSecondsBetweenInterstitials / 60;
    expect(worstCaseGapMinutes).toBeGreaterThanOrEqual(2);

    /*
     * And the count has to sit BEYOND the rescue ladder. A run of failures is a
     * difficulty spike, which is where the rewarded offer belongs — it pays
     * about three times what an interstitial does and lifts retention rather
     * than spending it. `maybeAdOnRetry` suppresses the interstitial while
     * either rescue pill is up; this keeps that the normal case.
     */
    expect(a.interstitialEveryNAttempts).toBeGreaterThan(
      monetization.reveals.offerSkipAfterAttempts
    );
  });

  it('stops taxing someone who just watched a rewarded ad', () => {
    expect(a.muteAfterRewardedSeconds).toBeGreaterThanOrEqual(180);
  });

  it('only offers a skip once the level has really resisted', () => {
    expect(monetization.reveals.offerSkipAfterAttempts).toBeGreaterThanOrEqual(5);
  });
});

/*
 * The faucets are sized together, so they are pinned together. The failure
 * each guards against is a pack nobody needs: when a day of free reveals comes
 * close to what the smallest pack holds, the store stops selling anything.
 */
describe('the economy', () => {
  const e = monetization.economy;

  it('gives an engaged player less in a day than the smallest pack holds', () => {
    const free = monetization.reveals.freeDailyTopUp + e.missions.count * e.missions.reward;
    expect(free).toBeLessThanOrEqual(4);
    expect(free).toBeLessThan(monetization.products.revealPacks[0].count);
  });

  it('caps ad-paid reveals at a daily number that keeps the packs worth buying', () => {
    expect(e.rewardedRevealsPerDay).toBeGreaterThanOrEqual(3);
    expect(e.rewardedRevealsPerDay).toBeLessThanOrEqual(10);
  });

  it('pays a chapter no more than five', () => {
    expect(e.chapter.halfReward + e.chapter.fullReward).toBeLessThanOrEqual(5);
  });

  it('pays at most twelve milestone reveals in the first month of a streak', () => {
    const table = e.streak.milestones as Readonly<Record<number, number>>;
    const firstMonth = Object.entries(table)
      .filter(([day]) => Number(day) <= 30)
      .reduce((s, [, r]) => s + r, 0);
    expect(firstMonth).toBeLessThanOrEqual(12);
  });

  /*
   * The pin above is the table (§0). Bookmark overflow is its own faucet (§2):
   * a player who never misses and so sits at the cap gets a reveal instead on
   * each bookmark day. Pinned too, so it cannot grow unnoticed.
   */
  it('adds at most one overflow reveal per bookmark day in that month', () => {
    const days = [...Array(30)].map((_, i) => i + 1);
    const paid = e.streak.milestones as Readonly<Record<number, number>>;
    const table = days.reduce((s, d) => s + (paid[d] ?? 0), 0);
    const at: readonly number[] = e.streak.bookmarkAt;
    const bookmarkDays = days.filter((d) => at.includes(d) || d % e.streak.bookmarkEvery === 0);
    const atCap = milestonesBetween(0, 30, e.streak.bookmarkMax, e.streak).reduce((s, m) => s + m.reveals, 0);
    expect(atCap).toBe(table + bookmarkDays.length * e.streak.overflowReveals);
    expect(atCap).toBeLessThanOrEqual(15);
  });

  /*
   * The starter reuses the one product id never sold. Its count is in its id
   * for the same reason every pack's is, and it must not appear on the ladder:
   * a once-per-install offer sold as an ordinary rung could be bought forever.
   */
  it('sells the starter as reveals25, once, off the ladder', () => {
    const s = e.starter;
    expect(s.id.endsWith('.reveals25')).toBe(true);
    expect(Number(/\.reveals(\d+)$/.exec(s.id)?.[1])).toBe(s.count);
    expect(monetization.products.revealPacks.map((p) => p.id)).not.toContain(s.id);
    expect(s.afterWins).toBeGreaterThanOrEqual(1);
  });

  it('keeps the bookmark and repair rules inside their own limits', () => {
    expect(e.streak.bookmarkMax).toBeGreaterThanOrEqual(1);
    expect(e.streak.bookmarkAt.every((d) => d > 0)).toBe(true);
    expect(e.repair.maxGapDays).toBe(1);
    expect(e.repair.cooldownDays).toBeGreaterThanOrEqual(7);
  });

  it('keeps the win frame move switchable off, and never enlarging', () => {
    for (const s of [monetization.ui.winFrameScale, monetization.ui.winFrameScaleDaily]) {
      expect(s).toBeGreaterThan(0.5);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});

/*
 * The ladder as each storefront actually prices it. Apple's tiers are not
 * proportional across currencies, so the same three ids make an honest ladder
 * in dollars and a trap in dinars or pounds unless the dominated rung is hidden.
 */
describe('the sellable ladder', () => {
  const pack = (count: number, micros: number) => ({
    id: `com.noqyris.foldwing.reveals${count}`,
    count,
    priceMicros: micros,
  });
  const counts = (packs: readonly { count: number }[]) => packs.map((p) => p.count);

  it('keeps every rung in dollars, and badges the thirty', () => {
    const kept = sellableLadder([pack(10, 990_000), pack(20, 1_490_000), pack(30, 1_990_000)]);
    expect(counts(kept)).toEqual([10, 20, 30]);
    expect(bestValueId(kept)).toBe('com.noqyris.foldwing.reveals30');
  });

  it('drops the twenty where it costs the same as the thirty (Serbia)', () => {
    const kept = sellableLadder([pack(10, 990_000), pack(20, 1_990_000), pack(30, 1_990_000)]);
    expect(counts(kept)).toEqual([10, 30]);
    expect(bestValueId(kept)).toBe('com.noqyris.foldwing.reveals30');
  });

  it('drops the ten where it costs the same as the twenty (UK)', () => {
    // The thirty at £1.99 is dearer per reveal than twenty at £0.99: gone too.
    expect(counts(sellableLadder([pack(10, 990_000), pack(20, 990_000), pack(30, 1_990_000)]))).toEqual([20]);
    // Priced below the twenty per reveal, it stays.
    expect(counts(sellableLadder([pack(10, 990_000), pack(20, 990_000), pack(30, 1_290_000)]))).toEqual([20, 30]);
  });

  it('judges nothing before the store has answered', () => {
    const waiting = [pack(10, 0), pack(20, 1_490_000), pack(30, 0)];
    expect(sellableLadder(waiting)).toEqual(waiting);
    expect(bestValueId(waiting)).toBeNull();
  });

  it('keeps the fields the store row needs', () => {
    const rich = [{ ...pack(10, 990_000), title: 'Ten', priceString: '$0.99' }];
    expect(sellableLadder(rich)[0].priceString).toBe('$0.99');
  });

  it('keeps one of two identical rungs', () => {
    expect(counts(sellableLadder([pack(10, 990_000), { ...pack(10, 990_000), id: 'dup' }]))).toEqual([10]);
  });

  it('badges nothing alone, or on a saving too small to claim', () => {
    expect(bestValueId([pack(10, 990_000)])).toBeNull();
    // 20 at $1.90 saves 4% on the ten: true, but not worth a badge.
    expect(bestValueId([pack(10, 990_000), pack(20, 1_900_000)])).toBeNull();
  });
});

describe('the starter offer', () => {
  const usd: PricedPack[] = [
    { count: 10, priceMicros: 990_000 },
    { count: 20, priceMicros: 1_490_000 },
    { count: 30, priceMicros: 1_990_000 },
  ];

  it('is a deal at $0.99 for twenty-five, and says how much of one', () => {
    const starter = { count: 25, priceMicros: 990_000 };
    expect(starterWorthShowing(starter, usd)).toBe(true);
    expect(packSaving(usd[0], starter)).toBe(60);
  });

  it('is not shown where it is no cheaper than the thirty', () => {
    // €1.99 for 25 against €1.99 for 30 — what $1.49 became in euros.
    expect(starterWorthShowing({ count: 25, priceMicros: 1_990_000 }, [{ count: 30, priceMicros: 1_990_000 }])).toBe(
      false
    );
  });

  it('is not shown on prices nobody has seen', () => {
    expect(starterWorthShowing({ count: 25, priceMicros: 0 }, usd)).toBe(false);
    expect(starterWorthShowing({ count: 25, priceMicros: 990_000 }, [{ count: 10, priceMicros: 0 }])).toBe(false);
  });

  it('is not shown with no rung on sale to be a saving against', () => {
    // The store returned the starter and no pack: "save 60%" of nothing.
    expect(starterWorthShowing({ count: 25, priceMicros: 990_000 }, [])).toBe(false);
  });
});
