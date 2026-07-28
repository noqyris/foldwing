import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { admobUnits, adsConfigured, monetization } from './monetization';

const PLIST = 'ios/App/App/Info.plist';

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

  it('declares ATT and the SKAdNetwork list the SDK needs', () => {
    const xml = readFileSync(PLIST, 'utf8');
    expect(plistString('NSUserTrackingUsageDescription').length).toBeGreaterThan(20);
    expect(xml).toContain('SKAdNetworkItems');
    // Google's own network must be present or installs are unattributable.
    expect(xml).toContain('cstr6suwn9.skadnetwork');
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
