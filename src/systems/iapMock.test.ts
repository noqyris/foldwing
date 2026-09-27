/*
 * The fake store the browser's mock build sells through.
 *
 * Three things matter more than the rest. It is chosen ONLY in a browser
 * running the mock build: a phone gets StoreKit's sandbox, and every other
 * bundle must not carry it at all. It sells exactly the products the config
 * names, so what it proves is about the real catalogue. And it delivers
 * through the same function StoreKit's approved handler does, so a fake
 * purchase exercises the real credit, the real starter rule and the real
 * entitlement.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { monetization, sellableLadder } from '../config/monetization';
import {
  createMockIap,
  type Deliver,
  type MockChoice,
  type MockEnv,
  MOCK_OWNED_KEY,
  MOCK_PRODUCT_IDS,
  PRICE_FIXTURES,
} from './iapMock';

const cap = vi.hoisted(() => ({ native: false }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => cap.native, getPlatform: () => (cap.native ? 'ios' : 'web') },
}));
vi.mock('cordova-plugin-purchase', () => ({}));
vi.mock('./Ads', () => ({ Ads: { setAdsRemoved: vi.fn() } }));

const { disk } = vi.hoisted(() => ({ disk: new Map<string, string>() }));
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: ({ key }: { key: string }) => Promise.resolve({ value: disk.get(key) ?? null }),
    set: ({ key, value }: { key: string; value: string }) => {
      disk.set(key, value);
      return Promise.resolve();
    },
    remove: ({ key }: { key: string }) => {
      disk.delete(key);
      return Promise.resolve();
    },
  },
}));

const REMOVE_ADS = monetization.products.removeAds;
const PACK_IDS = monetization.products.revealPacks.map((p) => p.id);
const STARTER = monetization.economy.starter.id;

/** A test's stand-in for the page: no DOM, no clock, no URL. */
function env(o: {
  choice?: MockChoice;
  approve?: boolean;
  query?: Record<string, string>;
  prices?: MockEnv['prices'];
} = {}) {
  const store = new Map<string, string>();
  let approve: (ok: boolean) => void = () => {};
  const approval = new Promise<boolean>((r) => (approve = r));
  const e: Partial<MockEnv> = {
    choose: vi.fn(async () => o.choice ?? 'buy'),
    awaitApproval: vi.fn(() => (o.approve === undefined ? approval : Promise.resolve(o.approve))),
    query: (name) => o.query?.[name] ?? null,
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    wait: async () => {},
    prices: o.prices ?? (() => null),
  };
  return { env: e, store, approve: (ok: boolean) => approve(ok) };
}

const deliverSpy = () => vi.fn<Deliver>(() => true);

describe('which store a build gets', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    cap.native = false;
  });

  async function selected(flag: string | undefined, native: boolean): Promise<string> {
    if (flag === undefined) vi.stubEnv('VITE_ADS', '');
    else vi.stubEnv('VITE_ADS', flag);
    cap.native = native;
    vi.resetModules();
    return (await import('./Iap')).Iap.kind;
  }

  it('is the fake one in the mock build, in a browser', async () => {
    expect(await selected('mock', false)).toBe('mock');
  });

  it('is the fake one in the mock build on a phone too — a cable build must not ask for a sandbox login', async () => {
    expect(await selected('mock', true)).toBe('mock');
  });

  it('is never the fake one without the flag', async () => {
    expect(await selected(undefined, false)).toBe('storekit');
    expect(await selected('off', false)).toBe('storekit');
    expect(await selected('off', true)).toBe('storekit');
  });

  /*
   * The release gate counts ADS: and ADMODE: markers in every bundle, and the
   * mock build's markers live in the ad layer. A copy in this file would be
   * counted too. And the fake sheet's lettering must live only here, where the
   * selection above can fold it out of every other bundle.
   */
  it('carries no build marker, and is the only file that says FAKE PURCHASE', () => {
    const read = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
    const mock = read('./iapMock.ts');
    expect(mock).not.toContain('ADS:');
    expect(mock).not.toContain('ADMODE:');
    expect(mock).toContain('FAKE PURCHASE');
    expect(read('./Iap.ts')).not.toContain('FAKE PURCHASE');
    expect(read('../render/StoreSheet.ts')).not.toContain('FAKE PURCHASE');
  });
});

describe('the fake catalogue', () => {
  it('sells exactly the products the config names', async () => {
    expect([...MOCK_PRODUCT_IDS].sort()).toEqual([REMOVE_ADS, ...PACK_IDS, STARTER].sort());
    const iap = createMockIap(deliverSpy(), env().env);
    await iap.warm();
    expect(iap.revealPacks().map((p) => p.id)).toEqual(PACK_IDS);
    expect(iap.revealPacks().map((p) => p.count)).toEqual(monetization.products.revealPacks.map((p) => p.count));
    expect(iap.starterProduct()).toMatchObject({ id: STARTER, count: monetization.economy.starter.count });
    expect(iap.removeAdsProduct()?.id).toBe(REMOVE_ADS);
  });

  it('prices nothing until it has answered, like StoreKit', async () => {
    const iap = createMockIap(deliverSpy(), env().env);
    expect(iap.available).toBe(true);
    expect(iap.revealPacks().every((p) => p.priceMicros === 0 && p.priceString === '')).toBe(true);
    expect(iap.starterProduct()).toBeNull();
    await iap.warm();
    expect(iap.revealPacks().map((p) => p.priceMicros)).toEqual([990_000, 1_490_000, 1_990_000]);
    expect(iap.revealPacks()[0].priceString).toBe('$0.99');
    expect(iap.starterProduct()?.priceMicros).toBe(990_000);
    expect(iap.removeAdsProduct()?.priceMicros).toBe(2_990_000);
  });

  it('answers with nothing under ?iap=none', async () => {
    const iap = createMockIap(deliverSpy(), env({ query: { iap: 'none' } }).env);
    expect(iap.revealPacks()).toHaveLength(3);
    await iap.warm();
    expect(iap.revealPacks()).toEqual([]);
    expect(iap.removeAdsProduct()).toBeNull();
    expect(iap.starterProduct()).toBeNull();
    expect(await iap.buyRevealPack(PACK_IDS[0])).toBe('failed');
  });

  it('refuses payments under ?iap=restricted', async () => {
    const deliver = deliverSpy();
    const iap = createMockIap(deliver, env({ query: { iap: 'restricted' } }).env);
    expect(iap.canPurchase()).toBe(false);
    expect(await iap.buyRevealPack(PACK_IDS[0])).toBe('failed');
    expect(deliver).not.toHaveBeenCalled();
  });

  it('answers slowly under ?iap=slow', async () => {
    const waits: number[] = [];
    const e = env({ query: { iap: 'slow' } }).env;
    e.wait = async (ms) => void waits.push(ms);
    await createMockIap(deliverSpy(), e).warm();
    expect(waits).toEqual([8000]);
  });

  /*
   * The storefronts the ladder rules were written for: in Serbia 20 and 30
   * reveals are both €1.99, so the 20 rung is a trap and is not sold.
   */
  it('prices by a storefront fixture', async () => {
    const iap = createMockIap(deliverSpy(), env({ prices: () => PRICE_FIXTURES.srb }).env);
    await iap.warm();
    expect(iap.revealPacks()[1].priceString).toBe('€1.99');
    expect(sellableLadder(iap.revealPacks()).map((p) => p.count)).toEqual([10, 30]);
  });
});

describe('a fake purchase', () => {
  it('delivers by the id bought, as a purchase', async () => {
    const deliver = deliverSpy();
    const iap = createMockIap(deliver, env().env);
    expect(await iap.buyRevealPack(PACK_IDS[1])).toBe('bought');
    expect(await iap.buyStarter()).toBe('bought');
    expect(deliver.mock.calls.map(([ids, , reason]) => [ids, reason])).toEqual([
      [[PACK_IDS[1]], 'purchase'],
      [[STARTER], 'purchase'],
    ]);
    // Every delivery its own transaction, so the credit-once record sees two.
    const txs = deliver.mock.calls.map(([, txId]) => txId);
    expect(new Set(txs).size).toBe(2);
    expect(txs.every((t) => t.length > 0 && t.length <= 64)).toBe(true);
  });

  it('refuses an id that is not a pack', async () => {
    const deliver = deliverSpy();
    const iap = createMockIap(deliver, env().env);
    expect(await iap.buyRevealPack(STARTER)).toBe('failed');
    expect(await iap.buyRevealPack('com.example.other')).toBe('failed');
    expect(deliver).not.toHaveBeenCalled();
  });

  it('delivers nothing on Cancel or Fail', async () => {
    for (const [choice, result] of [
      ['cancel', 'cancelled'],
      ['fail', 'failed'],
    ] as const) {
      const deliver = deliverSpy();
      const iap = createMockIap(deliver, env({ choice }).env);
      expect(await iap.buyRevealPack(PACK_IDS[0])).toBe(result);
      expect(deliver).not.toHaveBeenCalled();
    }
  });

  it('parks a Pending purchase, and delivers it late once approved', async () => {
    const deliver = deliverSpy();
    const page = env({ choice: 'pending' });
    const iap = createMockIap(deliver, page.env);
    expect(await iap.buyRevealPack(PACK_IDS[2])).toBe('pending');
    expect(deliver).not.toHaveBeenCalled();
    page.approve(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0][0]).toEqual([PACK_IDS[2]]);
    expect(deliver.mock.calls[0][2]).toBe('late-purchase');
  });

  it('delivers nothing when a Pending purchase is declined', async () => {
    const deliver = deliverSpy();
    const iap = createMockIap(deliver, env({ choice: 'pending', approve: false }).env);
    expect(await iap.buyRevealPack(PACK_IDS[0])).toBe('pending');
    await new Promise((r) => setTimeout(r, 0));
    expect(deliver).not.toHaveBeenCalled();
    expect(iap.isPending(PACK_IDS[0])).toBe(false);
  });

  it('says a Pending purchase is waiting until the parent answers', async () => {
    const page = env({ choice: 'pending' });
    const iap = createMockIap(deliverSpy(), page.env);
    expect(iap.isPending(STARTER)).toBe(false);
    expect(await iap.buyStarter()).toBe('pending');
    expect(iap.isPending(STARTER)).toBe(true);
    expect(iap.isPending(PACK_IDS[0])).toBe(false);
    page.approve(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(iap.isPending(STARTER)).toBe(false);
  });

  it('remembers Remove Ads as owned, for a restore after a reload', async () => {
    const page = env();
    const iap = createMockIap(deliverSpy(), page.env);
    expect(await iap.buyRemoveAds()).toBe('bought');
    expect(page.store.get(MOCK_OWNED_KEY)).toBe('1');

    const deliver = deliverSpy();
    const again = createMockIap(deliver, { ...page.env });
    expect(await again.restore()).toBe(true);
    expect(deliver).toHaveBeenCalledWith([REMOVE_ADS], '', 'purchase');
  });
});

describe('a fake restore', () => {
  it('comes back with whatever ?restore= says', async () => {
    const outcome = async (restore: string) =>
      createMockIap(deliverSpy(), env({ query: { restore } }).env).restore();
    expect(await outcome('true')).toBe(true);
    expect(await outcome('false')).toBe(false);
    expect(await outcome('cancelled')).toBe('cancelled');
    expect(await outcome('error')).toBeNull();
  });

  it('finds nothing on an account that bought nothing', async () => {
    const deliver = deliverSpy();
    expect(await createMockIap(deliver, env().env).restore()).toBe(false);
    expect(deliver).not.toHaveBeenCalled();
  });
});

/*
 * End to end through Iap.ts's own delivery, against the real Progress: what a
 * fake purchase does to the save is exactly what StoreKit's approval does.
 */
describe('a fake purchase, delivered for real', () => {
  beforeEach(() => {
    disk.clear();
    cap.native = false;
  });

  async function real() {
    // The previous test's Progress still has its 250ms save timer pending, and
    // under load it fired after beforeEach's clear — or during the async
    // load() below — writing that test's save (adsRemoved: true) onto the disk
    // this one reads. Outwait it, then clear: no older write can land after.
    await new Promise((r) => setTimeout(r, 300));
    disk.clear();
    vi.resetModules();
    const { Progress } = await import('./Progress');
    await Progress.load();
    const { creditPurchase } = await import('./Iap');
    return { Progress, creditPurchase };
  }

  it('gives the starter its 25 reveals and marks it bought', async () => {
    const { Progress, creditPurchase } = await real();
    const heard: string[] = [];
    Progress.onGrant((g) => void heard.push(`${g.reason}:${g.reveals}`));
    const before = Progress.data.reveals;
    const iap = createMockIap(creditPurchase, env().env);
    expect(await iap.buyStarter()).toBe('bought');
    expect(Progress.data.reveals).toBe(before + 25);
    expect(Progress.data.starterBought).toBe(true);
    expect(Progress.data.grantedTx).toHaveLength(1);
    expect(heard).toEqual(['purchase:25']);
  });

  it('removes ads', async () => {
    const { Progress, creditPurchase } = await real();
    const iap = createMockIap(creditPurchase, env().env);
    expect(await iap.buyRemoveAds()).toBe('bought');
    expect(Progress.data.adsRemoved).toBe(true);
  });

  /*
   * Pending, then Approve, for Remove Ads: the banner goes, and the moment is
   * announced as late — the reason the scenes show — not as a purchase that
   * the sheet (long closed) would have been the one to say.
   */
  it('announces Remove Ads approved later as a late purchase', async () => {
    const { Progress, creditPurchase } = await real();
    const heard: string[] = [];
    Progress.onGrant((g) => void heard.push(`${g.reason}:${g.adsRemoved}`));
    const page = env({ choice: 'pending' });
    const iap = createMockIap(creditPurchase, page.env);
    expect(await iap.buyRemoveAds()).toBe('pending');
    expect(Progress.data.adsRemoved).toBe(false);
    page.approve(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(Progress.data.adsRemoved).toBe(true);
    expect(heard).toEqual(['late-purchase:true']);
  });
});
