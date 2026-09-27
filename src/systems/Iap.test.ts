/*
 * The StoreKit side of the store.
 *
 * The connect, which several callers ask for at once: a level's warm-up, the
 * out-of-reveals sheet with its own price retries, a purchase. Each call used
 * to run the whole connect again while the first was still waiting on
 * `initialize()` — products registered twice and the approve handler wired
 * twice, so a pack bought afterwards was banked twice.
 *
 * And the purchase path, against the real Progress (with its disk in memory):
 * a transaction is credited once by its id and written to disk before it is
 * finished; a cancel answers at once; an Ask to Buy is 'pending', not a
 * failure; a product StoreKit did not return is not for sale.
 *
 * StoreKit exists neither here nor in a browser, so the plugin's global is a
 * fake that counts what was asked of it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { monetization } from '../config/monetization';
import type { GrantEvent } from './Progress';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
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
const [R10, R20, R30] = monetization.products.revealPacks.map((p) => p.id);
const STARTER = monetization.economy.starter.id;
const PAYMENT_CANCELLED = 6777006;

interface Deferred {
  resolve: () => void;
  reject: (e: unknown) => void;
}

interface FakeTx {
  transactionId: string;
  products: { id: string }[];
  finish: ReturnType<typeof vi.fn>;
}

type Order = () => Promise<unknown>;

const INVALID_PRODUCT_ID = 6777009;
const SETUP = 6777001;

function fakeStore(
  opts: { returned?: readonly string[]; autoInit?: boolean; initErrors?: readonly unknown[] } = {}
) {
  const inits: Deferred[] = [];
  const handlers: {
    approved?: (t: FakeTx) => void;
    pending?: (t: FakeTx) => void;
  } = {};
  const chain = {
    productUpdated: vi.fn(() => chain),
    approved: vi.fn((cb: (t: FakeTx) => void) => {
      handlers.approved = cb;
      return chain;
    }),
    pending: vi.fn((cb: (t: FakeTx) => void) => {
      handlers.pending = cb;
      return chain;
    }),
    verified: vi.fn(() => chain),
  };
  const returned = new Set(opts.returned ?? []);
  const orders = new Map<string, ReturnType<typeof vi.fn<Order>>>();
  const product = (id: string) => {
    if (!returned.has(id)) return undefined;
    let order = orders.get(id);
    if (!order) {
      order = vi.fn<Order>(async () => undefined);
      orders.set(id, order);
    }
    const o = order;
    return {
      id,
      title: '',
      description: '',
      getOffer: () => ({ order: o, pricingPhases: [{ price: '$0.99', priceMicros: 990_000 }] }),
    };
  };
  const store = {
    verbosity: 0,
    register: vi.fn(),
    when: vi.fn(() => chain),
    initialize: vi.fn(
      () =>
        new Promise<unknown[]>((resolve, reject) => {
          const errors = [...(opts.initErrors ?? [])];
          if (opts.autoInit) resolve(errors);
          else inits.push({ resolve: () => resolve(errors), reject });
        })
    ),
    get: vi.fn((id: string) => product(id)),
    owned: vi.fn(() => false),
    restorePurchases: vi.fn(async (): Promise<unknown> => undefined),
    checkSupport: vi.fn(() => true),
  };
  (globalThis as unknown as { CdvPurchase: unknown }).CdvPurchase = {
    store,
    ProductType: { NON_CONSUMABLE: 'non-consumable', CONSUMABLE: 'consumable' },
    Platform: { APPLE_APPSTORE: 'ios-appstore' },
    LogLevel: { WARNING: 1 },
    ErrorCode: { PAYMENT_CANCELLED, REFRESH_RECEIPTS: 6777011, UNKNOWN: 6777010, INVALID_PRODUCT_ID, SETUP },
  };
  /** The order() of a product, once it has been asked for. */
  const orderOf = (id: string) => {
    product(id);
    return orders.get(id)!;
  };
  return { store, chain, inits, handlers, orderOf };
}

/** A fresh service per test: the real one is a module singleton, and so is Progress. */
async function fresh(opts: { load?: boolean } = {}) {
  // The previous test's Progress still has its 250ms save timer pending; on a
  // loaded machine it landed after beforeEach's clear, so this test loaded
  // adsRemoved: true and a Remove Ads grant announced no change. Outwait it,
  // then clear: no older write can land after.
  await sleep(300);
  disk.clear();
  vi.resetModules();
  const { Progress } = await import('./Progress');
  if (opts.load !== false) await Progress.load();
  const { Iap } = await import('./Iap');
  return { Iap, Progress };
}

/** Let pending promise callbacks run. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const tx = (id: string, productId: string): FakeTx => ({
  transactionId: id,
  products: [{ id: productId }],
  finish: vi.fn(async () => undefined),
});

beforeEach(() => {
  disk.clear();
});

describe('the store connect', () => {
  let fake: ReturnType<typeof fakeStore>;
  beforeEach(() => {
    fake = fakeStore();
  });

  it('is shared by callers that ask while it is still in flight', async () => {
    const { Iap } = await fresh();
    const a = Iap.warm();
    const b = Iap.warm();
    const c = Iap.warm();
    await flush();
    expect(fake.store.initialize).toHaveBeenCalledTimes(1);

    fake.inits[0].resolve();
    await Promise.all([a, b, c]);
    expect(fake.store.register).toHaveBeenCalledTimes(1);
    expect(fake.chain.approved).toHaveBeenCalledTimes(1);
    expect(fake.chain.productUpdated).toHaveBeenCalledTimes(1);
  });

  it('is not run again once the store is up', async () => {
    const { Iap } = await fresh();
    const first = Iap.warm();
    await flush();
    fake.inits[0].resolve();
    await first;
    await Iap.warm();
    await Iap.warm();
    expect(fake.store.initialize).toHaveBeenCalledTimes(1);
  });

  it('retries a failed connect without wiring the approve handler twice', async () => {
    const { Iap } = await fresh();
    const first = Iap.warm();
    await flush();
    fake.inits[0].reject(new Error('no storefront'));
    await first;

    // Still not up, so the next surface tries again — with the same listeners.
    const second = Iap.warm();
    await flush();
    expect(fake.store.initialize).toHaveBeenCalledTimes(2);
    fake.inits[1].resolve();
    await second;
    expect(fake.store.register).toHaveBeenCalledTimes(1);
    expect(fake.chain.approved).toHaveBeenCalledTimes(1);
  });
});

/*
 * What a restore says when it fails. A restore is two StoreKit calls behind
 * two Apple Account alerts; cancelling at both lets the restore step finish
 * and fails the receipt refresh after it, which the plugin hands back as
 * REFRESH_RECEIPTS with StoreKit's cancel code only in the message — the
 * shape the simulator's log showed. That is the player saying no, not the
 * network.
 */
describe('a cancelled restore', () => {
  let fake: ReturnType<typeof fakeStore>;
  beforeEach(() => {
    fake = fakeStore();
  });

  async function restoreWith(err: unknown) {
    const { Iap } = await fresh();
    const warm = Iap.warm();
    await flush();
    // A fresh service connects again: answer the connect it just started.
    fake.inits[fake.inits.length - 1].resolve();
    await warm;
    fake.store.restorePurchases.mockResolvedValueOnce(err);
    return Iap.restore();
  }

  it('is cancelled when the restore step itself was cancelled', async () => {
    expect(await restoreWith({ isError: true, code: 6777006, message: 'Restore purchases failed' })).toBe(
      'cancelled'
    );
  });

  it('is cancelled when both alerts were cancelled and the receipt refresh says so', async () => {
    const message =
      'Failed to refresh receipt: The operation couldn’t be completed. (SKErrorDomain error 2.) [#SKErrorDomain:2]';
    expect(await restoreWith({ isError: true, code: 6777011, message })).toBe('cancelled');
  });

  it('finds the cancel among underlying errors too', async () => {
    const message =
      'Failed to refresh receipt: Cannot connect to iTunes Store [#SKErrorDomain:0], (Cancelled [#SKErrorDomain:2])';
    expect(await restoreWith({ isError: true, code: 6777011, message })).toBe('cancelled');
  });

  it('is still a failure to reach the store for any other refresh error', async () => {
    const offline = 'Failed to refresh receipt: Cannot connect to iTunes Store [#SKErrorDomain:0]';
    expect(await restoreWith({ isError: true, code: 6777011, message: offline })).toBeNull();
    // Error code 2 of some other domain is not StoreKit's cancel.
    const other = 'Failed to refresh receipt: failed [#NSURLErrorDomain:2]';
    expect(await restoreWith({ isError: true, code: 6777011, message: other })).toBeNull();
    // A cancel code in the message of an error that is not the refresh's.
    const unknown = 'unknown [#SKErrorDomain:2]';
    expect(await restoreWith({ isError: true, code: 6777010, message: unknown })).toBeNull();
  });

  it('answers with ownership when nothing failed', async () => {
    expect(await restoreWith(undefined)).toBe(false);
    fake.store.owned.mockReturnValue(true);
    expect(await restoreWith(undefined)).toBe(true);
  });
});

describe('the catalogue', () => {
  it('registers the starter as a consumable, in the one register call', async () => {
    const fake = fakeStore({ autoInit: true });
    const { Iap } = await fresh();
    await Iap.warm();
    await Iap.warm();
    expect(fake.store.register).toHaveBeenCalledTimes(1);
    const registered = fake.store.register.mock.calls[0][0] as { id: string; type: string }[];
    expect(registered).toContainEqual(expect.objectContaining({ id: STARTER, type: 'consumable' }));
    expect(registered).toContainEqual(expect.objectContaining({ id: REMOVE_ADS, type: 'non-consumable' }));
    expect(registered.map((p) => p.id).sort()).toEqual([REMOVE_ADS, R10, R20, R30, STARTER].sort());
  });

  /*
   * Before the store answers, every rung is drawn waiting — the price is
   * coming. After it answers, a product it did not return is not for sale: in
   * production before its approval, in the sandbox for up to an hour after a
   * price edit. A priceless row then is a button that always fails.
   */
  it('drops a product StoreKit did not return, once it has answered', async () => {
    fakeStore({ returned: [R10, R30], autoInit: true });
    const { Iap } = await fresh();
    expect(Iap.revealPacks().map((p) => p.id)).toEqual([R10, R20, R30]);
    expect(Iap.revealPacks().every((p) => p.priceString === '')).toBe(true);
    expect(Iap.removeAdsProduct()?.id).toBe(REMOVE_ADS);
    expect(Iap.starterProduct()).toBeNull();

    await Iap.warm();
    expect(Iap.revealPacks().map((p) => p.id)).toEqual([R10, R30]);
    expect(Iap.revealPacks().every((p) => p.priceMicros > 0)).toBe(true);
    expect(Iap.removeAdsProduct()).toBeNull();
    expect(Iap.starterProduct()).toBeNull();
  });

  it('offers the starter with its count once StoreKit returns it', async () => {
    fakeStore({ returned: [R10, STARTER], autoInit: true });
    const { Iap } = await fresh();
    await Iap.warm();
    expect(Iap.starterProduct()).toMatchObject({ id: STARTER, count: 25, priceMicros: 990_000 });
  });

  it('reports a device that refuses payments', async () => {
    const fake = fakeStore({ returned: [R10], autoInit: true });
    const { Iap } = await fresh();
    // Unknown before the store opens: rows are unpriced, so nothing is buyable anyway.
    expect(Iap.canPurchase()).toBe(true);
    await Iap.warm();
    fake.store.checkSupport.mockReturnValue(false);
    expect(Iap.canPurchase()).toBe(false);
    expect(await Iap.buyRevealPack(R10)).toBe('failed');
    expect(fake.orderOf(R10)).not.toHaveBeenCalled();
  });

  /*
   * `initialize` resolves even when StoreKit never started, and the device
   * was then never asked about payments. "Purchases are turned off on this
   * iPhone" would send the player to Screen Time for a fault that is not
   * theirs: the store is simply not reachable.
   */
  it('does not take a store that failed to start for payments turned off', async () => {
    const fake = fakeStore({
      autoInit: true,
      initErrors: [
        { isError: true, code: SETUP, message: 'bridge.init failed', platform: 'ios-appstore', productId: null },
      ],
    });
    fake.store.checkSupport.mockReturnValue(false);
    const { Iap } = await fresh();
    await Iap.warm();
    expect(Iap.canPurchase()).toBe(true);
    expect(Iap.revealPacks()).toEqual([]);
    expect(Iap.removeAdsProduct()).toBeNull();
  });

  it('still reports payments off when the store started and only missed a product', async () => {
    const fake = fakeStore({
      returned: [R10],
      autoInit: true,
      initErrors: [
        {
          isError: true,
          code: INVALID_PRODUCT_ID,
          message: 'Product not found in AppStore. #400',
          platform: 'ios-appstore',
          productId: R20,
        },
      ],
    });
    fake.store.checkSupport.mockReturnValue(false);
    const { Iap } = await fresh();
    await Iap.warm();
    expect(Iap.canPurchase()).toBe(false);
  });
});

describe('an approved transaction', () => {
  it('gives the starter its 25 reveals and marks it bought', async () => {
    const fake = fakeStore({ returned: [STARTER], autoInit: true });
    const { Iap, Progress } = await fresh();
    await Iap.warm();
    const before = Progress.data.reveals;
    const t = tx('1000000001', STARTER);
    fake.handlers.approved!(t);
    await sleep(5);
    expect(Progress.data.reveals).toBe(before + 25);
    expect(Progress.data.starterBought).toBe(true);
    expect(t.finish).toHaveBeenCalledTimes(1);
  });

  /*
   * StoreKit redelivers anything unfinished, and the plugin re-fires
   * `approved` for the same transaction after a minute. Both are the same
   * purchase: paid once, finished every time.
   */
  it('credits a transaction id once, however often it is delivered', async () => {
    const fake = fakeStore({ returned: [R10], autoInit: true });
    const { Iap, Progress } = await fresh();
    await Iap.warm();
    const before = Progress.data.reveals;
    const first = tx('1000000002', R10);
    const again = tx('1000000002', R10);
    fake.handlers.approved!(first);
    await sleep(5);
    fake.handlers.approved!(again);
    await sleep(5);
    expect(Progress.data.reveals).toBe(before + 10);
    expect(first.finish).toHaveBeenCalledTimes(1);
    expect(again.finish).toHaveBeenCalledTimes(1);
    expect(Progress.hasGrantedTx('1000000002')).toBe(true);
  });

  it('is on disk before it is finished', async () => {
    const fake = fakeStore({ returned: [R20], autoInit: true });
    const { Iap, Progress } = await fresh();
    await Iap.warm();
    const order: string[] = [];
    const realFlush = Progress.flush.bind(Progress);
    vi.spyOn(Progress, 'flush').mockImplementation(async () => {
      order.push('flush:start');
      await sleep(20);
      const written = await realFlush();
      order.push('flush:done');
      return written;
    });
    const t = tx('1000000003', R20);
    // What is on disk at the moment of the finish — read then, because an
    // earlier test's Progress may still have a scheduled write of its own.
    let onDisk: { grantedTx: string[] } | null = null;
    t.finish.mockImplementation(async () => {
      order.push('finish');
      onDisk = JSON.parse(disk.get('foldwing.save.v1') ?? 'null') as { grantedTx: string[] } | null;
    });
    fake.handlers.approved!(t);
    await sleep(60);
    expect(order).toEqual(['flush:start', 'flush:done', 'finish']);
    expect(onDisk!.grantedTx).toContain('1000000003');
  });

  /*
   * Before the save is read there is nowhere real to credit it: load() throws
   * the placeholder away. Finishing then would consume a purchase that never
   * landed; left unfinished, StoreKit hands it over again.
   */
  it('is left unfinished when the save has not been read', async () => {
    const fake = fakeStore({ returned: [R10], autoInit: true });
    const { Iap, Progress } = await fresh({ load: false });
    await Iap.warm();
    const t = tx('1000000004', R10);
    fake.handlers.approved!(t);
    await sleep(5);
    expect(t.finish).not.toHaveBeenCalled();
    expect(Progress.hasGrantedTx('1000000004')).toBe(false);
  });

  it('announces each grant once, and a purchase nobody was waiting on as late', async () => {
    const fake = fakeStore({ returned: [R10, R30], autoInit: true });
    const { Iap, Progress } = await fresh();
    await Iap.warm();
    const heard: { reveals: number; reason: string }[] = [];
    Progress.onGrant((g) => void heard.push({ reveals: g.reveals, reason: g.reason }));

    // Bought through the button: the approval lands while the flow waits.
    fake.orderOf(R10).mockImplementation(async () => {
      setTimeout(() => fake.handlers.approved!(tx('1000000005', R10)), 30);
      return undefined;
    });
    expect(await Iap.buyRevealPack(R10)).toBe('bought');
    // The plugin's re-fire a minute later: already paid, nothing said.
    fake.handlers.approved!(tx('1000000005', R10));
    // Redelivered at the next connect, with no button waiting: late.
    fake.handlers.approved!(tx('1000000006', R30));
    await sleep(5);

    expect(heard).toEqual([
      { reveals: 10, reason: 'purchase' },
      { reveals: 30, reason: 'late-purchase' },
    ]);
  });

  /*
   * Remove Ads approved with no button waiting — Ask to Buy, or a purchase
   * redelivered after a crash — is announced as late: the one reason the
   * scenes present from onGrant, and kept for the Menu when nobody did.
   */
  it('announces a Remove Ads approved later as a late purchase', async () => {
    const fake = fakeStore({ returned: [REMOVE_ADS], autoInit: true });
    const { Iap, Progress } = await fresh();
    await Iap.warm();
    const heard: GrantEvent[] = [];
    Progress.onGrant((g) => void heard.push(g));
    fake.orderOf(REMOVE_ADS).mockImplementation(async () => {
      setTimeout(() => fake.handlers.pending!(tx('', REMOVE_ADS)), 30);
      return undefined;
    });
    expect(await Iap.buyRemoveAds()).toBe('pending');
    expect(Progress.data.adsRemoved).toBe(false);

    const t = tx('1000000009', REMOVE_ADS);
    fake.handlers.approved!(t);
    await sleep(5);
    expect(Progress.data.adsRemoved).toBe(true);
    expect(heard).toEqual([{ reveals: 0, bookmarks: 0, reason: 'late-purchase', adsRemoved: true }]);
    expect(Progress.takeUnshownGrants()).toContainEqual(heard[0]);
    expect(t.finish).toHaveBeenCalledTimes(1);
  });

  it('announces Remove Ads found owned as the store opens as a late purchase', async () => {
    const fake = fakeStore({ returned: [REMOVE_ADS], autoInit: true });
    fake.store.owned.mockReturnValue(true);
    const { Iap, Progress } = await fresh();
    const heard: string[] = [];
    Progress.onGrant((g) => void heard.push(`${g.reason}:${g.adsRemoved}`));
    await Iap.warm();
    expect(Progress.data.adsRemoved).toBe(true);
    expect(heard).toEqual(['late-purchase:true']);
  });

  it('is left unfinished when the write does not land, and finished once it does', async () => {
    const fake = fakeStore({ returned: [R10], autoInit: true });
    const { Iap, Progress } = await fresh();
    await Iap.warm();
    const before = Progress.data.reveals;
    const spy = vi.spyOn(Progress, 'flush').mockResolvedValueOnce(false);
    const first = tx('1000000010', R10);
    fake.handlers.approved!(first);
    await sleep(5);
    expect(first.finish).not.toHaveBeenCalled();
    // The plugin's re-fire: already credited, so nothing more lands, and this
    // time the write does.
    const again = tx('1000000010', R10);
    fake.handlers.approved!(again);
    await sleep(5);
    expect(again.finish).toHaveBeenCalledTimes(1);
    expect(Progress.data.reveals).toBe(before + 10);
    spy.mockRestore();
  });

  it('applies Remove Ads', async () => {
    const fake = fakeStore({ returned: [REMOVE_ADS], autoInit: true });
    const { Iap, Progress } = await fresh();
    await Iap.warm();
    fake.orderOf(REMOVE_ADS).mockImplementation(async () => {
      setTimeout(() => fake.handlers.approved!(tx('1000000007', REMOVE_ADS)), 30);
      return undefined;
    });
    expect(await Iap.buyRemoveAds()).toBe('bought');
    expect(Progress.data.adsRemoved).toBe(true);
    const { Ads } = await import('./Ads');
    expect(Ads.setAdsRemoved).toHaveBeenCalledWith(true);
  });
});

describe('how a purchase ends', () => {
  it('says cancelled at once, not after the six-second wait', async () => {
    const fake = fakeStore({ returned: [R10], autoInit: true });
    const { Iap } = await fresh();
    await Iap.warm();
    fake.orderOf(R10).mockResolvedValue({ isError: true, code: PAYMENT_CANCELLED, message: 'cancelled' });
    const t0 = Date.now();
    expect(await Iap.buyRevealPack(R10)).toBe('cancelled');
    expect(Date.now() - t0).toBeLessThan(100);
  });

  it('says failed at once on any other order error', async () => {
    const fake = fakeStore({ returned: [R10], autoInit: true });
    const { Iap } = await fresh();
    await Iap.warm();
    fake.orderOf(R10).mockResolvedValue({ isError: true, code: 6777010, message: 'nope' });
    const t0 = Date.now();
    expect(await Iap.buyRevealPack(R10)).toBe('failed');
    expect(Date.now() - t0).toBeLessThan(100);
  });

  /*
   * Ask to Buy: order() resolves with no error, exactly as for a purchase,
   * and only the pending handler tells them apart. It used to wait six
   * seconds and report "the purchase didn't go through" — to a child whose
   * parent then approved it.
   */
  it('is pending when StoreKit parks it for approval, and late when approved', async () => {
    const fake = fakeStore({ returned: [R20], autoInit: true });
    const { Iap, Progress } = await fresh();
    await Iap.warm();
    const reasons: string[] = [];
    Progress.onGrant((g) => void reasons.push(g.reason));
    fake.orderOf(R20).mockImplementation(async () => {
      setTimeout(() => fake.handlers.pending!(tx('', R20)), 30);
      return undefined;
    });
    const t0 = Date.now();
    expect(await Iap.buyRevealPack(R20)).toBe('pending');
    expect(Date.now() - t0).toBeLessThan(1000);

    const before = Progress.data.reveals;
    fake.handlers.approved!(tx('1000000008', R20));
    await sleep(5);
    expect(Progress.data.reveals).toBe(before + 20);
    expect(reasons).toEqual(['late-purchase']);
  });

  /*
   * The sheet stops offering the once-per-install starter while a request for
   * it waits on a parent, so it has to be able to ask.
   */
  it('keeps a starter waiting on approval pending until it lands', async () => {
    const fake = fakeStore({ returned: [STARTER], autoInit: true });
    const { Iap } = await fresh();
    await Iap.warm();
    fake.orderOf(STARTER).mockImplementation(async () => {
      setTimeout(() => fake.handlers.pending!(tx('', STARTER)), 30);
      return undefined;
    });
    expect(Iap.isPending(STARTER)).toBe(false);
    expect(await Iap.buyStarter()).toBe('pending');
    expect(Iap.isPending(STARTER)).toBe(true);
    fake.handlers.approved!(tx('1000000011', STARTER));
    await sleep(5);
    expect(Iap.isPending(STARTER)).toBe(false);
  });

  it('refuses an id that is not a pack', async () => {
    fakeStore({ returned: [R10, STARTER], autoInit: true });
    const { Iap } = await fresh();
    expect(await Iap.buyRevealPack(STARTER)).toBe('failed');
    expect(await Iap.buyRevealPack('com.example.other')).toBe('failed');
  });
});
