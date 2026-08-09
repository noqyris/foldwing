import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { admobUnits, adsConfigured, monetization } from './monetization';

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
  it('keeps the native app id in step with useTestAds', () => {
    const native = plistString('GADApplicationIdentifier');
    expect(native).toMatch(/^ca-app-pub-\d+~\d+$/);
    expect(native).toBe(admobUnits().appId);

    if (monetization.useTestAds) {
      expect(native).toBe('ca-app-pub-3940256099942544~1458002511');
    } else {
      expect(native).not.toContain('3940256099942544');
    }
  });

  /*
   * The test above only proves the two knobs AGREE. Both-on-TEST agrees, so it
   * passes — and that is exactly how build 19 came to carry Google's test app
   * id inside a signed, uploadable ipa.
   *
   * This one does not branch on anything. The tree's committed state is the
   * submission state, so the test publisher id may not appear in the plist at
   * all. Flip `useTestAds` locally to judge placement if you like; you cannot
   * commit that flip, and you cannot archive past it.
   */
  it('never leaves Google test ad ids in the native project', () => {
    const xml = readFileSync(PLIST, 'utf8');
    expect(xml).not.toContain('3940256099942544');
    expect(monetization.useTestAds).toBe(false);
  });

  it('ships the live publisher account, not somebody else s', () => {
    expect(plistString('GADApplicationIdentifier')).toBe(
      'ca-app-pub-3307486877162157~5033197766'
    );
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

describe('ad cadence', () => {
  const a = monetization.ads;

  it('protects onboarding', () => {
    expect(a.interstitialFromLevel).toBeGreaterThanOrEqual(6);
  });

  it('keeps interstitials rare, spaced and capped', () => {
    expect(a.interstitialEveryNWins).toBeGreaterThanOrEqual(3);
    expect(a.minSecondsBetweenInterstitials).toBeGreaterThanOrEqual(120);
    expect(a.maxInterstitialsPerSession).toBeLessThanOrEqual(4);
    expect(a.sessionWarmupSeconds).toBeGreaterThanOrEqual(60);
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
    expect(soonestByCount).toBeLessThan(a.minSecondsBetweenInterstitials);

    // Worst case a player can actually experience, in minutes between ads.
    const worstCaseGapMinutes = a.minSecondsBetweenInterstitials / 60;
    expect(worstCaseGapMinutes).toBeGreaterThanOrEqual(2);
  });

  it('stops taxing someone who just watched a rewarded ad', () => {
    expect(a.muteAfterRewardedSeconds).toBeGreaterThanOrEqual(180);
  });

  it('only offers a skip once the level has really resisted', () => {
    expect(monetization.reveals.offerSkipAfterAttempts).toBeGreaterThanOrEqual(5);
  });
});
