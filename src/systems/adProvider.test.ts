import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * The seam is only worth having if it actually holds. A single SDK call that
 * leaks back into the policy layer or a scene is invisible in review and undoes
 * the whole split, so this asserts the boundary structurally rather than
 * trusting it — along with the handful of things the migration off AdMob has to
 * keep true for good: no Google ad code, no badge that claims a build is safe
 * to tap, no ad SDK started over the opening film.
 */

const repo = (p: string): string => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const read = (p: string): string => readFileSync(repo(p), 'utf8');

/** Comments may still name a network; code may not. */
const codeOnly = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Every TypeScript file under src, as repo-relative paths. */
function sources(dir = repo('src')): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.ts$/.test(name)) out.push(relative(repo('.'), p));
  }
  return out;
}

const ALL = sources();
const isTest = (f: string): boolean => /\.test\.ts$/.test(f);

describe('the ad provider seam', () => {
  it('keeps the SDK inside providers/levelplay.ts', () => {
    // Scenes and the policy layer talk to `Ads`; only the provider talks to the
    // plugin. One direct import elsewhere and the next network change is a
    // many-file change again.
    const importers = ALL.filter((f) => !isTest(f) && /from ['"]capacitor-levelplay-ads['"]/.test(read(f)));
    expect(importers).toEqual(['src/systems/providers/levelplay.ts']);
  });

  it('routes every scene and screen through Ads, never a provider', () => {
    const offenders = ALL.filter(
      (f) =>
        !isTest(f) &&
        !f.startsWith('src/systems/') &&
        /from ['"][./]*(systems\/)?providers\//.test(codeOnly(read(f)))
    );
    expect(offenders).toEqual([]);
  });

  it('gives a second provider the same interface checklist', () => {
    const seam = read('src/systems/adProvider.ts');
    const body = seam.slice(seam.indexOf('export interface AdProvider'));
    const members = [...body.matchAll(/^ {2}(?:readonly )?(\w+)[(?:]/gm)].map((m) => m[1]);
    expect(members.length).toBeGreaterThan(10);
    const levelplay = read('src/systems/providers/levelplay.ts');
    const mock = read('src/systems/providers/mock.ts');
    for (const m of members) expect(levelplay, `levelplay provider is missing ${m}`).toMatch(new RegExp(`\\b${m}\\b`));
    // The mock may leave out optional members (retryInit, consentState) — it
    // has no SDK to retry and no consent flow — but nothing required.
    const optional = [...body.matchAll(/^ {2}(\w+)\?\(/gm)].map((m) => m[1]);
    for (const m of members.filter((x) => !optional.includes(x))) {
      expect(mock, `mock provider is missing ${m}`).toMatch(new RegExp(`\\b${m}\\b`));
    }
  });

  it('LevelPlay carries both gate markers on its id, because its unit ids cannot prove anything', () => {
    // LevelPlay ships the SAME unit ids in every build and flips a boolean —
    // invisible after minification. The markers are the only proof, so their
    // absence is a release that cannot be checked.
    const levelplay = read('src/systems/providers/levelplay.ts');
    expect(levelplay).toMatch(/const AD_MODE_MARKER = TESTING \? 'ADMODE:test' : 'ADMODE:live'/);
    // A const nothing reads is dead code the bundler is free to drop. Riding
    // on `id` keeps it alive.
    expect(levelplay).toMatch(/id:\s*`levelplay \$\{AD_MODE_MARKER\} \$\{ADS_MARKER\}`/);
    expect(read('src/systems/providers/mock.ts')).toMatch(/id:\s*`mock ADMODE:test \$\{ADS_MARKER\}`/);
  });

  it('carries each marker literal exactly once in the code that ships', () => {
    // The gate counts occurrences in the bundle and demands exactly one of the
    // right ones. A second literal anywhere in shipped code — a log line, a
    // label — would fail every release, or worse, satisfy the wrong target.
    const shipped = ALL.filter((f) => !isTest(f)).map((f) => codeOnly(read(f))).join('\n');
    for (const marker of ["'ADMODE:test'", "'ADMODE:live'", "'ADS:on'", "'ADS:off'", "'ADS:mock'"]) {
      expect(shipped.split(marker).length - 1, marker).toBe(1);
    }
    expect(shipped.split('ADMODE:test').length - 1).toBe(2); // the provider's constant + the mock's id
  });

  it('keeps the two switches apart', () => {
    // VITE_ADS decides whether a build serves ads at all; VITE_AD_MODE whether
    // it is the store build. An ads-off build is still ADMODE:test.
    const seam = read('src/systems/adProvider.ts');
    expect(seam).toMatch(/import\.meta\.env\.VITE_ADS === 'off'/);
    expect(codeOnly(seam)).not.toContain('VITE_AD_MODE');
  });

  it('picks the mock with an INLINE env read, so every other bundle tree-shakes it', () => {
    // Through the adsMock() helper the bundler cannot fold the choice, and every
    // store build would carry the fake-ad code.
    expect(codeOnly(read('src/systems/Ads.ts'))).toContain(
      "const provider = import.meta.env.VITE_ADS === 'mock' ? mockProvider : levelplayProvider;"
    );
    const importers = ALL.filter((f) => !isTest(f) && /from ['"]\.\/providers\/mock['"]/.test(read(f)));
    expect(importers).toEqual(['src/systems/Ads.ts']);
  });

  it('has no app-open anywhere, because Unity forbids the placement outright', () => {
    // Unity's Placement Policy calls an ad shown before the app opens a
    // violation. A dormant implementation is one wiring mistake from a breach.
    for (const f of ALL.filter((x) => !isTest(x))) {
      expect(codeOnly(read(f)), f).not.toMatch(/app[-_ ]?open/i);
    }
  });
});

describe('no Google ad code — the publisher account is permanently closed', () => {
  // Built from parts so this file does not itself contain what it forbids.
  const GOOGLE_ID = ['ca', 'app', 'pub'].join('-');
  const ADMOB_PLUGIN = ['@capacitor-community', 'admob'].join('/');

  it('has no Google ad id of any kind anywhere in src, tests included', () => {
    for (const f of ALL) {
      const src = read(f);
      expect(src.includes(GOOGLE_ID), `${f} carries a Google ad id`).toBe(false);
      expect(/pub-\d{16}/.test(src), `${f} carries a Google publisher id`).toBe(false);
    }
  });

  it('imports no AdMob plugin and depends on none', () => {
    for (const f of ALL) {
      expect(codeOnly(read(f)), f).not.toContain(ADMOB_PLUGIN);
    }
    const pkg = JSON.parse(read('package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })).not.toContain(ADMOB_PLUGIN);
  });
});

describe('nothing claims a build is safe to tap', () => {
  /*
   * There was a green "TEST ADS" badge, lit whenever the build served Google's
   * test units. On LevelPlay no build serves test inventory — `isTesting` only
   * unlocks the Test Suite — so the badge could only ever be wrong or dark. It
   * was deleted rather than rewired: a light nobody should learn to look for is
   * a light that will one day be believed.
   */
  it('ships no TEST ADS badge', () => {
    expect(existsSync(repo('src/testAdsBadge.ts'))).toBe(false);
    for (const f of ALL.filter((x) => !isTest(x))) {
      expect(codeOnly(read(f)), f).not.toMatch(/TEST ADS|showTestAdsBadge|test-ads-badge/);
    }
  });

  it('reports testing:false from both providers', () => {
    expect(read('src/systems/providers/levelplay.ts')).toMatch(/^ {2}testing: false,$/m);
    expect(read('src/systems/providers/mock.ts')).toMatch(/^ {2}testing: false,$/m);
  });
});

describe('the boot order', () => {
  const main = codeOnly(read('src/main.ts'));

  /*
   * Starting the ad layer asks for consent — iOS's tracking alert, then the
   * LevelPlay modal — and both are system dialogs. BootScene runs while the
   * opening film is still playing, so an init there puts them on top of it.
   */
  it('never starts the ad SDK from BootScene', () => {
    expect(codeOnly(read('src/scenes/BootScene.ts'))).not.toMatch(/Ads\.init\(/);
    expect(codeOnly(read('src/scenes/BootScene.ts'))).toMatch(/Ads\.setAdsRemoved\(save\.adsRemoved\);\s*markEntitlementKnown\(\);/);
  });

  it('starts it in main.ts only after the film, and only once the entitlement is known', () => {
    const film = main.indexOf('playIntro()');
    const release = main.indexOf('Ads.releaseBanner()');
    const web = main.indexOf('if (WEB_DAILY) return;');
    const entitlement = main.indexOf('await entitlementKnown;');
    const init = main.indexOf('Ads.init()');
    for (const [what, at] of Object.entries({ film, release, web, entitlement, init })) {
      expect(at, what).toBeGreaterThanOrEqual(0);
    }
    expect(film).toBeLessThan(release);
    expect(release).toBeLessThan(web);
    expect(web).toBeLessThan(entitlement);
    expect(entitlement).toBeLessThan(init);
    expect(main.split('Ads.init(').length - 1).toBe(1);
    // A film that never resolves must not cost the session its ads.
    expect(main).toMatch(/Promise\.race\(\[\s*playIntro\(\),/);
  });

  /*
   * GameKit's sign-in sheet and the consent alert are presented from the same
   * view controller, and UIKit refuses the second while the first is up. The
   * menu is built behind the film, before consent is asked — so a sign-in
   * straight from create() could hold the controller when the alert needed
   * it, and the session silently went without ads. Ads.test.ts pins when
   * consentFlowDone settles; this pins that the menu waits for it.
   */
  it('signs in to Game Center only after the ad consent flow, and only from a menu still on screen', () => {
    const menu = codeOnly(read('src/scenes/MenuScene.ts'));
    expect(menu).toMatch(
      /Ads\.consentFlowDone\.then\(\(\) => \{\s*if \(this\.scene\.isActive\(\)\) void GameCenter\.signIn\(\);\s*\}\)/
    );
    expect(menu.split('GameCenter.signIn(').length - 1).toBe(1);
    for (const f of ALL.filter((x) => !isTest(x) && x !== 'src/scenes/MenuScene.ts')) {
      expect(codeOnly(read(f)), f).not.toMatch(/GameCenter\.signIn\(/);
    }
  });

  it('lets the ad layer pause the game, and retry its start on every return', () => {
    expect(main).toMatch(/registerGame\(game\)/);
    expect(main).toMatch(/addEventListener\('visibilitychange',[\s\S]*?Ads\.foregrounded\(\)/);
  });
});
