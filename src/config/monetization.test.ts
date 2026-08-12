import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { admobUnits, adsConfigured, monetization, packSaving } from './monetization';

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

describe('AdMob identifiers', () => {
  it('uses the right shape for app ids and unit ids', () => {
    const u = admobUnits();
    // ~ is the APP id, / is an AD UNIT id. Swapping them is the classic silent
    // no-fill bug, and the two are one character apart.
    expect(u.appId).toMatch(/^ca-app-pub-\d+~\d+$/);
    expect(u.banner).toMatch(/^ca-app-pub-\d+\/\d+$/);
    expect(u.interstitial).toMatch(/^ca-app-pub-\d+\/\d+$/);
    expect(u.rewarded).toMatch(/^ca-app-pub-\d+\/\d+$/);
  });

  it('gives every format its own unit', () => {
    const u = admobUnits();
    const ids = [u.banner, u.interstitial, u.rewarded];
    expect(new Set(ids).size).toBe(3);
  });

  it('reports itself configured', () => {
    expect(adsConfigured()).toBe(true);
  });

  /*
   * GADApplicationIdentifier is a native value read at launch, so it cannot
   * follow the TypeScript flag — it is edited by hand. Shipping a live app id
   * alongside Google's test units (or the reverse) is an AdMob policy problem,
   * and "remember to change the plist too" is exactly the kind of thing nobody
   * remembers at 1am before a submission. So the build checks it.
   */
  it('keeps the native app id in step with the units it resolves', () => {
    /*
     * GADApplicationIdentifier is native, read at launch, and used to be edited
     * by hand — "remember to change the plist too" being exactly the thing
     * nobody remembers at 1am before a submission. It is a build setting now,
     * so the pair can only disagree if someone edits one of the two defaults.
     */
    const pbx = readFileSync(PBXPROJ, 'utf8');
    const nativeDefault = /GAD_APPLICATION_IDENTIFIER = "([^"]+)"/.exec(pbx)?.[1] ?? '';
    expect(nativeDefault).toMatch(/^ca-app-pub-\d+~\d+$/);
    expect(nativeDefault).toBe(admobUnits().appId);
  });

  /*
   * The test above only proves the two knobs AGREE. Both-on-TEST agrees, so it
   * passes — and that is exactly how build 19 came to carry Google's test app
   * id inside a signed, uploadable ipa.
   *
   * These do not branch on anything. Neither knob is a checked-in value any
   * more: `useTestAds` comes from VITE_TEST_ADS at build time and the native id
   * comes from the GAD_APPLICATION_IDENTIFIER build setting, so a test-ads
   * build is something you ASK FOR at the archive and cannot leave behind. What
   * is on disk is always the submission state, and these assert exactly that.
   */
  it('never leaves Google test ad ids anywhere in the native project', () => {
    const plist = readFileSync(PLIST, 'utf8');
    const pbx = readFileSync(PBXPROJ, 'utf8');
    expect(plist).not.toContain('3940256099942544');
    expect(pbx).not.toContain('3940256099942544');
  });

  it('defaults to live ads when nothing asks for test ads', () => {
    // VITE_TEST_ADS is unset in a normal run, so this is the shipped default.
    expect(monetization.useTestAds).toBe(false);
  });

  it('ships the live publisher account, from a build setting the plist reads', () => {
    // The plist holds a reference, not a literal: that is what makes the
    // test-ads build a one-line xcargs override with nothing left on disk.
    expect(plistString('GADApplicationIdentifier')).toBe('$(GAD_APPLICATION_IDENTIFIER)');

    const pbx = readFileSync(PBXPROJ, 'utf8');
    const defaults = [...pbx.matchAll(/GAD_APPLICATION_IDENTIFIER = "([^"]+)"/g)].map(
      (m) => m[1]
    );
    // Both configurations, both live. A Debug default that drifted from Release
    // would mean the simulator and the archive were talking to different apps.
    expect(defaults.length).toBe(2);
    for (const d of defaults) expect(d).toBe('ca-app-pub-3307486877162157~5033197766');
  });

  it('declares ATT and the SKAdNetwork list the SDK needs', () => {
    const xml = readFileSync(PLIST, 'utf8');
    expect(plistString('NSUserTrackingUsageDescription').length).toBeGreaterThan(20);
    expect(xml).toContain('SKAdNetworkItems');
    // Google's own network must be present or installs are unattributable.
    expect(xml).toContain('cstr6suwn9.skadnetwork');
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
    expect(a.newSessionAfterAwaySeconds).toBeGreaterThanOrEqual(600);
  });

  /*
   * The retry path is the dangerous one. A failed attempt lasts three to eight
   * seconds, so the attempt count ALONE would put an ad on screen every twenty
   * seconds — the pattern AdMob explicitly disables ad serving over.
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
