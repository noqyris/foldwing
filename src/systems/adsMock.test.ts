import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The fake-ads build, and the one thing that must never happen to it.
 *
 * `VITE_ADS=mock` swaps the LevelPlay provider for `providers/mock.ts`, which
 * draws its own banner, interstitial and rewarded ad in the DOM and calls no
 * network at all. It exists because LevelPlay has no test inventory to borrow:
 * the mock is the only ad surface in this game that is safe to tap.
 *
 * The danger it introduces is the mirror image of the one it removes: a mock
 * bundle reaching a store would show players rectangles we drew ourselves while
 * the game earns nothing — and it would LOOK like it works, which is why no
 * amount of looking would catch it. The release gates refuse it
 * (`scripts/check-ad-mode.mjs`); these tests pin the properties they rely on.
 */

const REAL_ADS = import.meta.env.VITE_ADS;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('the ADS marker is exactly one value, and mock is its own', () => {
  const cases: [string, string][] = [
    ['', 'ADS:on'],
    ['off', 'ADS:off'],
    ['mock', 'ADS:mock'],
  ];

  for (const [env, marker] of cases) {
    it(`VITE_ADS=${env || '(unset)'} bakes ${marker}`, async () => {
      vi.stubEnv('VITE_ADS', env);
      vi.resetModules();
      const { ADS_MARKER } = await import('./adProvider');
      expect(ADS_MARKER).toBe(marker);
    });
  }

  it('no marker is a prefix of another — the gates count by plain substring', () => {
    // scripts/check-ad-mode.mjs counts with `bundle.split(literal).length - 1`.
    // If one marker contained another, a mock bundle would also report ADS:on
    // and pass a store target.
    const markers = ['ADS:on', 'ADS:off', 'ADS:mock', 'ADMODE:test', 'ADMODE:live'];
    for (const a of markers) {
      for (const b of markers) {
        if (a !== b) expect(a.includes(b), `${a} must not contain ${b}`).toBe(false);
      }
    }
  });
});

describe('the mock provider is a real provider, not a stub that lies', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ADS', 'mock');
    vi.resetModules();
  });

  it('carries ADS:mock in the id the gates grep for', async () => {
    const { mockProvider } = await import('./providers/mock');
    expect(mockProvider.id).toBe('mock ADMODE:test ADS:mock');
    // ADMODE stays test: a mock build is never a store build, and claiming
    // `live` would make the live gate accept a bundle that earns nothing.
    expect(mockProvider.id).not.toContain('ADMODE:live');
  });

  it('reports testing=false, exactly like the real provider', async () => {
    const { mockProvider } = await import('./providers/mock');
    expect(mockProvider.testing).toBe(false);
  });

  it('matches LevelPlay on the one contract that freezes the game if wrong', async () => {
    // resolvesOnPresent decides whether the caller may return straight after
    // show() or must wait on watchDismissal. Diverging here would make the mock
    // exercise a code path the real build never takes — the opposite of useful.
    const { mockProvider } = await import('./providers/mock');
    expect(mockProvider.resolvesOnPresent('interstitial')).toBe(true);
    expect(mockProvider.resolvesOnPresent('rewarded')).toBe(false);
  });

  it('serves the same formats as LevelPlay', async () => {
    const { mockProvider } = await import('./providers/mock');
    expect(mockProvider.supports('banner')).toBe(true);
    expect(mockProvider.supports('interstitial')).toBe(true);
    expect(mockProvider.supports('rewarded')).toBe(true);
  });

  it('says in its own lettering that it is a fake ad', () => {
    // A mock build must be unmistakable on the phone in someone's hand.
    const src = readSource('./providers/mock.ts');
    expect(src).toContain("'FAKE REWARDED AD'");
    expect(src).toContain("'FAKE INTERSTITIAL AD'");
    expect(src).toMatch(/const BANNER_TEXT = 'FAKE BANNER AD/);
    // …and never carries a marker string anywhere a bundle would keep it.
    expect(codeOnly(src).replace('`mock ADMODE:test ${ADS_MARKER}`', '')).not.toMatch(/ADMODE:|ADS:(on|off|mock)/);
  });
});

describe('a normal build does not become a mock build by accident', () => {
  it('adsMock() is false unless VITE_ADS is exactly "mock"', async () => {
    for (const env of ['', 'off', 'on', 'Mock', 'MOCK', 'mocked', ' mock']) {
      vi.stubEnv('VITE_ADS', env);
      vi.resetModules();
      const { adsMock } = await import('./adProvider');
      expect(adsMock(), `VITE_ADS=${JSON.stringify(env)}`).toBe(false);
    }
  });

  it('adsOff() is false unless VITE_ADS is exactly "off"', async () => {
    for (const env of ['', 'mock', 'on', 'Off', 'OFF', ' off', 'false']) {
      vi.stubEnv('VITE_ADS', env);
      vi.resetModules();
      const { adsOff } = await import('./adProvider');
      expect(adsOff(), `VITE_ADS=${JSON.stringify(env)}`).toBe(false);
    }
  });

  it('this very test run is not a mock build unless the chain exported one', () => {
    // The release chains run vitest with their own VITE_ADS exported. If a mock
    // value ever leaked into a store chain's test stage, this says so here
    // rather than in the store.
    expect(REAL_ADS === 'mock' ? 'mock chain' : 'not mock').toBe(
      process.env.VITE_ADS === 'mock' ? 'mock chain' : 'not mock'
    );
  });
});

function readSource(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), 'utf8');
}

/** Comments may say anything; code may not. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
