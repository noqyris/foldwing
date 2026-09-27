/**
 * Iap — the store: Remove Ads, the reveal packs and the one-time starter.
 *
 * The entitlement is the important part and it lives locally: once owned, a
 * relaunch must never need a store round-trip to know the player paid. A
 * transient store failure therefore returns `null` ("not authoritative") rather
 * than `false`, so a network blip can never silently downgrade someone who
 * bought the thing.
 *
 * Backed by `cordova-plugin-purchase`, which Capacitor bridges natively. The
 * whole store surface is contained in this file — the scenes are written
 * against `available` / the product getters / the `buy*` methods / `restore`
 * and know nothing about StoreKit. In the browser's mock build a fake store
 * stands in (iapMock.ts, selected at the bottom of this file).
 *
 * There is no receipt-validation server, so an approved transaction is finished
 * locally. Apple has already authenticated the purchase, and the only thing a
 * validator would add is protection against a jailbroken device faking a
 * $0.99 unlock. What a local finish DOES need is a record: a consumable is
 * credited per transaction id (`Progress.creditTransaction`), because StoreKit
 * redelivers anything unfinished and the plugin re-fires `approved` for the
 * same transaction after a minute.
 */

import { Capacitor } from '@capacitor/core';
import 'cordova-plugin-purchase';
import { monetization } from '../config/monetization';
import { Ads } from './Ads';
import { createMockIap } from './iapMock';
import { Progress } from './Progress';

export interface StoreProduct {
  id: string;
  title: string;
  description: string;
  /** Localised, formatted, ready to print. Empty until the store answers. */
  priceString: string;
  /**
   * The same price as a number, in millionths.
   *
   * Kept alongside the string because the string cannot be compared: it is
   * localised, so "1,49 €" and "$1.49" and "¥250" all arrive as text in
   * whatever shape that storefront uses. Any claim about one price relative to
   * another — every "save 25%" in the store — has to be computed from this.
   */
  priceMicros: number;
}

/** A consumable — a rung of the ladder or the starter — with what it grants. */
export interface RevealPack extends StoreProduct {
  count: number;
}

/**
 * What a restore came back with. `true`/`false` are authoritative; `null` is
 * "the store did not answer"; `'cancelled'` is the player dismissing the Apple
 * Account sign-in that a restore can put up. Not authoritative either — but
 * not a failure, and not something to blame the network for.
 */
export type RestoreResult = boolean | null | 'cancelled';

/**
 * How a purchase ended, as far as the player is concerned.
 *
 * `'pending'` is Ask to Buy: StoreKit parked the payment for a parent's
 * approval. It is not a failure — the approval can land minutes or days later,
 * through the approved handler, as a 'late-purchase' grant.
 */
export type PurchaseResult = 'bought' | 'cancelled' | 'pending' | 'failed';

export interface IapService {
  /** True where this build has a store to talk to at all. */
  readonly available: boolean;
  /** Which store: the real StoreKit, or the browser mock build's fake. */
  readonly kind: 'storekit' | 'mock';
  init(): Promise<void>;
  /**
   * Open the store in the background, because a purchase surface is about to
   * be shown. Idempotent, never throws, and safe to fire and forget.
   */
  warm(): Promise<void>;
  /**
   * False when this device refuses payments (Screen Time's in-app purchase
   * restriction). True while the store has not said — the rows are unpriced,
   * and so not buyable, until it does.
   */
  canPurchase(): boolean;
  /** Null where it cannot be bought, or once the store answered without it. */
  removeAdsProduct(): StoreProduct | null;
  /**
   * The ladder, cheapest first. Placeholders without a price until the store
   * answers; after that only the rungs it actually returned. Empty where
   * nothing can be bought.
   */
  revealPacks(): RevealPack[];
  /** The one-time starter, only once the store has returned it. */
  starterProduct(): RevealPack | null;
  /**
   * True while a purchase of this product waits on Ask to Buy. The store sheet
   * stops offering the once-per-install starter then: every request a child
   * queues would be paid in full on approval.
   */
  isPending(id: string): boolean;
  buyRemoveAds(): Promise<PurchaseResult>;
  buyRevealPack(id: string): Promise<PurchaseResult>;
  buyStarter(): Promise<PurchaseResult>;
  /** See `RestoreResult`. */
  restore(): Promise<RestoreResult>;
}

const PRODUCT_ID = monetization.products.removeAds;
const PACKS = monetization.products.revealPacks;
const STARTER = monetization.economy.starter;

/**
 * What a pack row says before App Store Connect has answered. Derived from the
 * count rather than written out, because a hardcoded "20 reveals" outlived the
 * twenty-reveal pack by exactly one commit.
 */
const packTitle = (count: number): string => `${count} reveals`;

/** Every consumable this build sells — the ladder and the starter — by id. */
const consumableFor = (id: string): { id: string; count: number } | undefined =>
  id === STARTER.id ? STARTER : PACKS.find((p) => p.id === id);

/**
 * Deliver what a transaction bought, and say whether it may now be finished.
 *
 * THE one place a purchase turns into reveals or an entitlement: the StoreKit
 * approved handler and the browser mock both come through here, so the mock
 * proves the path the phone takes rather than one of its own.
 *
 * Granted by the ids that were actually bought, never by a single hardcoded
 * count. With more than one rung on the ladder, paying for 25 and receiving
 * 10 is the failure this shape rules out.
 *
 * The consumables are credited against the transaction id, in the same update
 * that records it. True means the id is now on record — credited now, or
 * credited on some earlier delivery — and the transaction may be finished.
 * False means nothing could be credited (the save is not read yet): leave the
 * transaction unfinished, and StoreKit hands it over again.
 *
 * `reason` is 'late-purchase' for anything no purchase flow is waiting on — an
 * Ask to Buy approval, a transaction redelivered after the app was killed
 * mid-purchase — so the grant is announced with nobody's button to explain it.
 */
export function creditPurchase(
  productIds: readonly string[],
  txId: string,
  reason: 'purchase' | 'late-purchase'
): boolean {
  let reveals = 0;
  let starter = false;
  for (const id of productIds) {
    const pack = consumableFor(id);
    if (pack) reveals += pack.count;
    if (id === STARTER.id) starter = true;
  }
  // Sticky and idempotent, so a redelivery or a restore through here is free.
  // The reason goes with it: a Remove Ads approved later is announced too.
  if (productIds.includes(PRODUCT_ID)) applyEntitlement(true, reason);
  if (reveals === 0) return true;

  /*
   * Marked before the grant is announced: a listener that repaints the store
   * on the grant must already see the starter as bought, or it offers it a
   * second time. Harmless if the credit below is refused — before load() the
   * mark lands on the placeholder save, which load() throws away.
   */
  if (starter) Progress.markStarterBought();
  if (txId) {
    Progress.creditTransaction(txId, reveals, reason);
    return Progress.hasGrantedTx(txId);
  }
  // StoreKit always names a purchased transaction; without an id there is
  // nothing to deduplicate on, so it is credited as the old path did.
  return Progress.grantReveals(reveals, reason);
}

class StoreKitIapService implements IapService {
  readonly kind = 'storekit' as const;
  private ready = false;
  /** The one connect in flight, which every caller shares — see `connect`. */
  private connecting: Promise<boolean> | null = null;
  /** Products registered and listeners wired: once per run, never again. */
  private wired = false;
  private product: StoreProduct | null = null;
  /** Every consumable StoreKit returned — the rungs and the starter — by id. */
  private packProducts = new Map<string, RevealPack>();
  /** Product ids with a purchase flow waiting on them. */
  private readonly buying = new Set<string>();
  /** Deliveries per product id, so a purchase can see its own land. */
  private readonly landed = new Map<string, number>();
  /** Product ids StoreKit parked for a parent's approval. */
  private readonly deferred = new Set<string>();
  /** StoreKit itself did not start — see `open`. Not the same as payments off. */
  private setupFailed = false;

  /*
   * Offered on device WITHOUT having contacted the store yet — see `init`.
   * The prices are filled in later; until then the rows are drawn waiting.
   */
  get available(): boolean {
    return Capacitor.isNativePlatform();
  }

  /**
   * Deliberately does NOT touch StoreKit. See `connect`.
   */
  async init(): Promise<void> {
    /* no-op */
  }

  /**
   * Connect early, because a price nobody has fetched is a price nobody sees.
   *
   * `connect()` is the ONLY thing that ever learns what a product costs, and it
   * used to be reachable exclusively from `buyRevealPack` / `buyRemoveAds` /
   * `restore` — from inside the purchase itself. So the first time a player
   * opened the out-of-reveals sheet the store had never been contacted, and the
   * pack row rendered its priceless fallback: a button reading "20 reveals"
   * with no price at all, which is what the sheet showed on device. The price
   * could only appear on a SECOND visit, after a purchase attempt had already
   * happened — by which point it is far too late to inform the decision.
   *
   * Called when a purchase surface opens rather than at launch, which is the
   * distinction the deferral in `connect` is actually about: what must not
   * happen is StoreKit work before the player has touched anything.
   */
  async warm(): Promise<void> {
    if (!this.available) return;
    await this.connect();
  }

  /**
   * Open the store, once, and only because the player asked to buy or restore.
   *
   * Registering a payment-queue observer is the launch-time pattern Apple
   * documents, and it is what this plugin does from `pluginInitialize` — but
   * StoreKit needs an Apple Account to attach a storefront listener, and on a
   * device that is signed OUT it puts up a sign-in dialog. Measured on a clean
   * simulator: the dialog appeared over the home screen ~3s after launch,
   * before the player had touched anything, and CAME BACK after Cancel. A
   * repeating login wall on first run, for a free game, triggered by a purchase
   * nobody asked for.
   *
   * Deferring costs one thing: a transaction interrupted mid-purchase is
   * delivered when the player next opens the purchase flow rather than at
   * launch. It lands then as a late purchase, credited once by its id.
   *
   * ONE AT A TIME. Several callers ask for the store at once — a level's
   * warm-up, the out-of-reveals sheet opened a second later with its own
   * price retries, a purchase — and every call used to run all of this again
   * while the first was still waiting on `initialize()`: the products
   * registered twice and the approve handler wired twice, so a pack bought
   * after that was banked twice. Callers now share the connect in flight, and
   * the wiring happens once however many connects a failing store needs.
   */
  private connect(): Promise<boolean> {
    if (this.ready) return Promise.resolve(true);
    if (!Capacitor.isNativePlatform()) return Promise.resolve(false);
    this.connecting ??= this.open().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  /** Register the products and wire the store's listeners — once per run. */
  private wire(): void {
    const { store, ProductType, Platform } = CdvPurchase;
    /*
     * ONE register call, starter included. The starter is a CONSUMABLE with a
     * once-per-install rule the app keeps (`starterBought`), not a
     * non-consumable: it grants currency, and currency is consumed.
     */
    store.register([
      { id: PRODUCT_ID, type: ProductType.NON_CONSUMABLE, platform: Platform.APPLE_APPSTORE },
      ...[...PACKS, STARTER].map((p) => ({
        id: p.id,
        type: ProductType.CONSUMABLE,
        platform: Platform.APPLE_APPSTORE,
      })),
    ]);

    /*
     * Prices can arrive after initialize() resolves, and the snapshot used to
     * be taken exactly once, straight after it: a product that loaded late
     * stayed priceless until the next launch. Re-read on every update.
     */
    store.when().productUpdated(() => this.readProducts());

    /*
     * Approve -> grant -> flush -> finish, wired BEFORE initialize().
     *
     * `finish()` is not optional: an unfinished transaction is re-delivered
     * by StoreKit on every launch, so the player keeps being shown a purchase
     * they already completed. Granting here rather than only inside the buy
     * methods is what makes a purchase that completes after the app was
     * killed mid-flow still land on the next start. For the CONSUMABLE that
     * ordering is load-bearing in the other direction too: finish is what
     * consumes the transaction, so the reveals must be ON DISK before it —
     * not merely in memory with a write scheduled 250ms out, which a kill in
     * that window lost along with a pack that was paid for.
     */
    store
      .when()
      .approved((t) => {
        void this.onApproved(t).catch(() => {
          /* unfinished: StoreKit hands it over again */
        });
      })
      .pending((t) => {
        for (const p of t.products) this.deferred.add(p.id);
      })
      .verified((r) => void r.finish());
  }

  private async onApproved(t: CdvPurchase.Transaction): Promise<void> {
    const ids = t.products.map((p) => p.id);
    const late = !ids.some((id) => this.buying.has(id));
    if (!creditPurchase(ids, t.transactionId, late ? 'late-purchase' : 'purchase')) return;
    for (const id of ids) {
      this.deferred.delete(id);
      this.landed.set(id, (this.landed.get(id) ?? 0) + 1);
    }
    // A write that did not land leaves the transaction unfinished: the plugin
    // re-fires the approval, nothing is credited twice, and the write is tried
    // again. That covers Remove Ads before load() too, which has no tx record.
    if (!(await Progress.flush())) return;
    await t.finish();
  }

  private async open(): Promise<boolean> {
    try {
      const { store, Platform, LogLevel, ErrorCode } = CdvPurchase;
      store.verbosity = LogLevel.WARNING;
      if (!this.wired) {
        this.wire();
        this.wired = true;
      }

      /*
       * `needAppReceipt: false` is not an optimisation here, it is a bug fix.
       *
       * The Apple adapter verifies the app receipt on startup by default, and
       * on a fresh install there is no receipt to read — so StoreKit asks the
       * user to sign in to their Apple Account. Verified on a clean simulator:
       * a login dialog appeared over the home screen on cold launch, before the
       * player had touched anything. An unexplained Apple ID prompt at startup
       * is both hostile and a plausible App Review rejection.
       *
       * The receipt only buys first-download analytics, side-load resistance
       * and intro-price eligibility. This app wants none of the three: the
       * entitlement is a single non-consumable that StoreKit itself
       * authenticates at purchase time.
       */
      const errors = await store.initialize([
        { platform: Platform.APPLE_APPSTORE, options: { needAppReceipt: false } },
      ]);
      /*
       * `initialize` resolves even when StoreKit never started: the adapter's
       * own setup error comes back in this list, and payments then read as
       * refused because nobody asked the device. That is not Screen Time, and
       * the sheet must not send the player there — see `canPurchase`. A
       * product StoreKit did not return is reported here too, and is not a
       * setup failure: that is `readProducts`' business.
       */
      this.setupFailed = (Array.isArray(errors) ? errors : []).some(
        (e) => !!e && e.code !== ErrorCode.INVALID_PRODUCT_ID
      );

      this.readProducts();
      const p = store.get(PRODUCT_ID, Platform.APPLE_APPSTORE);

      // Already bought: a transaction left unfinished by a crash, or an Ask to
      // Buy approved while the app was closed. No button is waiting on either,
      // so it is announced as a late purchase.
      if (p && store.owned({ id: PRODUCT_ID, platform: Platform.APPLE_APPSTORE })) {
        applyEntitlement(true, 'late-purchase');
      }

      this.ready = true;
      return true;
    } catch {
      this.ready = false;
      return false;
    }
  }

  /**
   * Snapshot what StoreKit knows about every product: title and, above all,
   * the localised price. Called once the store is up and again whenever it
   * reports a product update. Only products StoreKit returned are recorded;
   * once the store is up, anything it did not return is simply not for sale.
   */
  private readProducts(): void {
    const { store, Platform } = CdvPurchase;
    const p = store.get(PRODUCT_ID, Platform.APPLE_APPSTORE);
    if (p) {
      const offer = p.getOffer();
      this.product = {
        id: PRODUCT_ID,
        title: p.title || 'Remove ads',
        description: p.description || 'No banners, no interstitials, unlimited reveals.',
        // The LOCALISED price the player will actually be charged, never a
        // hardcoded "$0.99" that is wrong in every other storefront.
        priceString: offer?.pricingPhases?.[0]?.price ?? '',
        priceMicros: offer?.pricingPhases?.[0]?.priceMicros ?? 0,
      };
    }

    for (const rung of [...PACKS, STARTER]) {
      const pack = store.get(rung.id, Platform.APPLE_APPSTORE);
      if (!pack) continue;
      const offer = pack.getOffer();
      this.packProducts.set(rung.id, {
        id: rung.id,
        count: rung.count,
        title: pack.title || packTitle(rung.count),
        description: pack.description || `A stash of ${rung.count} folded-wall reveals.`,
        priceString: offer?.pricingPhases?.[0]?.price ?? '',
        priceMicros: offer?.pricingPhases?.[0]?.priceMicros ?? 0,
      });
    }
  }

  /**
   * Whether this iPhone takes payments at all — Screen Time can switch in-app
   * purchases off. Apple's guidance is to show the store only where payments
   * are possible, and a row that can never succeed is the dead button the
   * sheet exists to avoid.
   *
   * A store that failed to start has not asked the device at all, so its
   * "no" means nothing: true, and the sheet says the store isn't reachable,
   * which is what happened.
   */
  canPurchase(): boolean {
    if (!this.available) return false;
    if (!this.ready || this.setupFailed) return true;
    try {
      const { store, Platform } = CdvPurchase;
      return typeof store.checkSupport === 'function'
        ? store.checkSupport(Platform.APPLE_APPSTORE, 'order')
        : true;
    } catch {
      return true;
    }
  }

  /*
   * Before the first connect the prices are unknown and the rows are drawn
   * waiting — see `warm`. After it, a product StoreKit did not return is
   * dropped rather than drawn as a priceless button that always fails: that
   * is production before a product's approval, and the sandbox for up to an
   * hour after a price edit.
   */

  removeAdsProduct(): StoreProduct | null {
    if (!this.available) return null;
    if (this.ready) return this.product;
    return { id: PRODUCT_ID, title: 'Remove ads', description: '', priceString: '', priceMicros: 0 };
  }

  revealPacks(): RevealPack[] {
    if (!this.available) return [];
    if (this.ready) {
      return PACKS.flatMap((rung) => {
        const p = this.packProducts.get(rung.id);
        return p ? [p] : [];
      });
    }
    return PACKS.map((rung) => ({
      id: rung.id,
      count: rung.count,
      title: packTitle(rung.count),
      description: '',
      priceString: '',
      priceMicros: 0,
    }));
  }

  starterProduct(): RevealPack | null {
    if (!this.available || !this.ready) return null;
    return this.packProducts.get(STARTER.id) ?? null;
  }

  /*
   * For this run only: a decline never reaches the pending handler's set, so
   * a starter asked for and refused stays off the sheet until the next launch.
   * The safe way round — the other one sells it twice.
   */
  isPending(id: string): boolean {
    return this.deferred.has(id);
  }

  buyRevealPack(id: string): Promise<PurchaseResult> {
    if (!PACKS.some((p) => p.id === id)) return Promise.resolve('failed');
    return this.buy(id);
  }

  buyStarter(): Promise<PurchaseResult> {
    return this.buy(STARTER.id);
  }

  async buyRemoveAds(): Promise<PurchaseResult> {
    const result = await this.buy(PRODUCT_ID);
    // The entitlement can arrive by another way mid-flow (a restored
    // transaction redelivered as the store opened); owned is owned.
    return result === 'failed' && Progress.data.adsRemoved ? 'bought' : result;
  }

  /**
   * Order one product and wait for it to land, be parked for approval, or
   * fail.
   *
   * The order's own error is read first. A cancel used to be ignored here and
   * the flow waited out the full six-second `settle` below before saying
   * anything — six seconds of a sheet that had closed on nothing.
   */
  private async buy(id: string): Promise<PurchaseResult> {
    if (!(await this.connect())) return 'failed';
    if (!this.canPurchase()) return 'failed';
    const { store, Platform, ErrorCode } = CdvPurchase;
    const offer = store.get(id, Platform.APPLE_APPSTORE)?.getOffer();
    if (!offer) return 'failed';

    const before = this.landed.get(id) ?? 0;
    const landedNow = (): boolean => (this.landed.get(id) ?? 0) > before;
    this.deferred.delete(id);
    this.buying.add(id);
    try {
      const err = await offer.order();
      if (err) return err.code === ErrorCode.PAYMENT_CANCELLED ? 'cancelled' : 'failed';
      /*
       * No error means purchased OR deferred: the plugin resolves `order()`
       * for both, and tells them apart only through the handlers, which run
       * later. Wait for whichever it turns out to be.
       */
      if (!(await settle(() => landedNow() || this.deferred.has(id)))) return 'failed';
      return landedNow() ? 'bought' : 'pending';
    } catch {
      return landedNow() ? 'bought' : 'failed';
    } finally {
      // From here on, an approval for this product is late: nobody's button
      // is waiting to explain it.
      this.buying.delete(id);
    }
  }

  async restore(): Promise<RestoreResult> {
    if (!(await this.connect())) return null;
    try {
      const { store, Platform, ErrorCode } = CdvPurchase;
      const err = await store.restorePurchases();
      /*
       * A restore on a device signed out of its Apple Account puts up the
       * sign-in, and Cancel there comes back as SKErrorPaymentCancelled —
       * which this used to fold into "the store did not answer", so the menu
       * told the player it couldn't reach the App Store when they had simply
       * said no. Neither is authoritative; only one is a failure.
       */
      if (err) return restoreCancelled(err, ErrorCode) ? 'cancelled' : null;
      return store.owned({ id: PRODUCT_ID, platform: Platform.APPLE_APPSTORE });
    } catch {
      return null;
    }
  }
}

/**
 * SKErrorPaymentCancelled as the plugin's native side writes it into a
 * message: "<description> [#SKErrorDomain:2]", with any underlying errors
 * after it in the same form.
 */
const SK_PAYMENT_CANCELLED = /\[#SKErrorDomain:2\]/;

/**
 * Did a restore fail because the player said no?
 *
 * A restore is two StoreKit calls, and there are two Apple Account alerts to
 * say no to. Cancel at the first fails the restore step itself, which the
 * plugin reports as PAYMENT_CANCELLED. Cancel at both lets the restore step
 * finish with nothing — and then the receipt refresh that the plugin runs
 * after it (cordova-plugin-purchase store.js, `restorePurchases`) fails with
 * StoreKit's own cancel code, which arrives as REFRESH_RECEIPTS with the code
 * only in the message. The menu read that one as the network, and told a
 * player who had simply tapped Cancel twice that it couldn't reach the store.
 */
export function restoreCancelled(
  err: { readonly code: number; readonly message?: string },
  codes: { readonly PAYMENT_CANCELLED: number; readonly REFRESH_RECEIPTS?: number }
): boolean {
  if (err.code === codes.PAYMENT_CANCELLED) return true;
  if (codes.REFRESH_RECEIPTS === undefined || err.code !== codes.REFRESH_RECEIPTS) return false;
  return SK_PAYMENT_CANCELLED.test(err.message ?? '');
}

/**
 * Wait for the approved or pending handler to actually run.
 *
 * `order()` does NOT resolve after the entitlement is granted. Traced through
 * the plugin: the Apple bridge calls `receiptsUpdated` and then the payment
 * monitor, and it is the MONITOR that resolves `order()` — while
 * `receiptsUpdated` is debounced 300ms and the store listener adds a further
 * 500ms before it triggers the approved callbacks. So the grant arrives roughly
 * 800ms AFTER the await returns, and reading the entitlement on the next line
 * reported `false` on every first-time success: the player paid, the menu did
 * not change, and nothing looked different until the next launch.
 *
 * Polling rather than a promise from the handler because the handler is also
 * the path a restore and a redelivered transaction take, and it must not be
 * rewired around one caller.
 */
async function settle(
  isDone: () => boolean,
  timeoutMs = 6000,
  stepMs = 100
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!isDone()) {
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return true;
}

/**
 * Which store this build talks to.
 *
 * The fake one in every mock build — in the browser AND on a phone. A mock
 * build on a phone is usually installed over the cable, and a development-
 * signed build asks for a Sandbox Apple Account on every purchase and every
 * receipt refresh, which made the store untestable exactly when the owner
 * tests by cable (TestFlight down, 2026-09-26). The fake store never touches
 * StoreKit, and still credits through `creditPurchase`, the path a real
 * approval takes. Apple's own sandbox sheet is tested on an ads-off build.
 *
 * `import.meta.env` inline, as in Ads.ts: Vite folds it to a literal, so every
 * other bundle folds this to the StoreKit service and drops iapMock.ts — and
 * with it the fake purchase sheet the release gate refuses — entirely.
 */
export const Iap: IapService =
  import.meta.env.VITE_ADS === 'mock' ? createMockIap(creditPurchase) : new StoreKitIapService();

/**
 * Apply whatever the store says WITHOUT ever downgrading a local entitlement on
 * a non-authoritative answer. Owning something is sticky; not knowing is not
 * the same as not owning.
 */
export function applyEntitlement(
  storeSays: boolean | null,
  reason: 'purchase' | 'late-purchase' = 'purchase'
): void {
  if (storeSays !== true) return;
  // Announced (Progress emits on the change), so whatever rebuilds from
  // ownership — the reminder copy, the balance chip — hears it however it came.
  // 'late-purchase' when no button is waiting to say it: see `grantNotice`.
  Progress.setAdsRemoved(true, reason);
  /*
   * The ad layer has to be told here, not by the caller.
   *
   * `Ads.setAdsRemoved` used to be called only from BootScene and by hand at
   * two MenuScene sites, so the grant that runs inside the approved handler —
   * the one an actual purchase goes through — never reached it at all: banners
   * and interstitials kept coming for the rest of the session after the player
   * had paid to stop them. Making this the single choke point means a third
   * caller cannot forget.
   */
  Ads.setAdsRemoved(true);
}
