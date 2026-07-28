/**
 * Iap — the Remove Ads purchase.
 *
 * The entitlement is the important part and it lives locally: once owned, a
 * relaunch must never need a store round-trip to know the player paid. A
 * transient store failure therefore returns `null` ("not authoritative") rather
 * than `false`, so a network blip can never silently downgrade someone who
 * bought the thing.
 *
 * Backed by `cordova-plugin-purchase`, which Capacitor bridges natively. The
 * whole store surface is contained in this file — the scenes are written
 * against `available` / `removeAdsProduct` / `buyRemoveAds` / `restore` and
 * know nothing about StoreKit.
 *
 * There is no receipt-validation server, so an approved transaction is finished
 * locally. For a single non-consumable that is the right trade: Apple has
 * already authenticated the purchase, and the only thing a validator would add
 * is protection against a jailbroken device faking a $0.99 unlock.
 */

import { Capacitor } from '@capacitor/core';
import 'cordova-plugin-purchase';
import { monetization } from '../config/monetization';
import { Progress } from './Progress';

export interface StoreProduct {
  id: string;
  title: string;
  description: string;
  priceString: string;
}

export interface IapService {
  /** True when a purchase can actually be made right now. */
  readonly available: boolean;
  init(): Promise<void>;
  removeAdsProduct(): StoreProduct | null;
  /** @returns true if the entitlement is now owned. */
  buyRemoveAds(): Promise<boolean>;
  /** @returns true/false when authoritative, null when the store did not answer. */
  restore(): Promise<boolean | null>;
}

const PRODUCT_ID = monetization.products.removeAds;

class StoreKitIapService implements IapService {
  private ready = false;
  private product: StoreProduct | null = null;

  /*
   * Offered on device WITHOUT having contacted the store yet — see `init`.
   * The price is filled in later if we ever learn it; the menu already renders
   * the row fine without one.
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
   * launch. For a single non-consumable that is invisible — they tap Remove
   * ads, StoreKit reports it already bought, and the entitlement lands.
   */
  private async connect(): Promise<boolean> {
    if (this.ready) return true;
    if (!Capacitor.isNativePlatform()) return false;

    try {
      const { store, ProductType, Platform, LogLevel } = CdvPurchase;
      store.verbosity = LogLevel.WARNING;

      store.register([
        { id: PRODUCT_ID, type: ProductType.NON_CONSUMABLE, platform: Platform.APPLE_APPSTORE },
      ]);

      /*
       * Approve -> grant -> finish, wired BEFORE initialize().
       *
       * `finish()` is not optional: an unfinished transaction is re-delivered
       * by StoreKit on every launch, so the player keeps being shown a purchase
       * they already completed. Granting here rather than only inside
       * `buyRemoveAds` is what makes a purchase that completes after the app
       * was killed mid-flow still land on the next start.
       */
      store
        .when()
        .approved((t) => {
          this.grant();
          void t.finish();
        })
        .verified((r) => void r.finish());

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
      await store.initialize([
        { platform: Platform.APPLE_APPSTORE, options: { needAppReceipt: false } },
      ]);

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
        };
      }

      // Already bought — on another device, or before a reinstall.
      if (p && store.owned({ id: PRODUCT_ID, platform: Platform.APPLE_APPSTORE })) {
        this.grant();
      }

      this.ready = true;
      return true;
    } catch {
      this.ready = false;
      return false;
    }
  }

  removeAdsProduct(): StoreProduct | null {
    if (!this.available) return null;
    // Before the first connect the price is unknown; the row still renders.
    return this.product ?? { id: PRODUCT_ID, title: 'Remove ads', description: '', priceString: '' };
  }

  async buyRemoveAds(): Promise<boolean> {
    if (!(await this.connect())) return false;
    try {
      const { store, Platform } = CdvPurchase;
      const offer = store.get(PRODUCT_ID, Platform.APPLE_APPSTORE)?.getOffer();
      if (!offer) return false;

      await offer.order();
      // The `approved` handler above does the granting, so read the entitlement
      // rather than trusting a return value — a cancel and a failure look the
      // same here, and both simply mean "still whatever it was".
      return Progress.data.adsRemoved;
    } catch {
      return Progress.data.adsRemoved;
    }
  }

  async restore(): Promise<boolean | null> {
    if (!(await this.connect())) return null;
    try {
      const { store, Platform } = CdvPurchase;
      const err = await store.restorePurchases();
      if (err) return null; // not authoritative — never downgrade on a blip
      return store.owned({ id: PRODUCT_ID, platform: Platform.APPLE_APPSTORE });
    } catch {
      return null;
    }
  }

  private grant(): void {
    if (!Progress.data.adsRemoved) Progress.setAdsRemoved(true);
  }
}

export const Iap: IapService = new StoreKitIapService();

/**
 * Apply whatever the store says WITHOUT ever downgrading a local entitlement on
 * a non-authoritative answer. Owning something is sticky; not knowing is not
 * the same as not owning.
 */
export function applyEntitlement(storeSays: boolean | null): void {
  if (storeSays === true) Progress.setAdsRemoved(true);
}
