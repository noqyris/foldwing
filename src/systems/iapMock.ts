/**
 * The FAKE store — the one the browser's mock build sells through.
 *
 * Why it exists: the mock build is where every ad surface is tested, in a
 * browser, with fake ads that are safe to tap. The store had no such stand-in:
 * off a phone `Iap.available` was false, so the one screen that sells could
 * only be seen through a hand-patched page, and the paths that matter most —
 * a cancel, a failure, an Ask to Buy that lands later, a restore that finds
 * nothing — could not be reached at all.
 *
 * What it is FOR: proving OUR side. Every purchase here is delivered through
 * `creditPurchase`, the same function the StoreKit approved handler calls, so
 * the credit-once record, the starter's once-per-install rule, the entitlement
 * and every grant event are the ones the phone runs. Prices behave like
 * StoreKit's too: unknown until the store "answers", then only the products it
 * returned.
 *
 * What it is NOT for: proving StoreKit. Iap.ts selects this file in every mock
 * build, the phone included — a cable-installed build would otherwise ask for a
 * Sandbox Apple Account on every purchase — so Apple's own sheet is tested on an
 * ads-off build with a sandbox tester.
 *
 * Every purchase puts up a sheet that says FAKE PURCHASE in large letters, so
 * nobody ever wonders whether money moved. The release gate refuses that
 * string in every store bundle, and Iap.ts selects this module in a way the
 * bundler folds away everywhere else.
 *
 * Query switches, read when used:
 *   ?iap=slow        the store answers after 8 s instead of 250 ms
 *   ?iap=none        the store answers with no products at all
 *   ?iap=restricted  payments are switched off on this "device"
 *   ?restore=true|false|cancelled|error   what a restore comes back with
 *   ?prices=usd|srb|gbr                   storefront fixtures (dev server only)
 * and `window.__foldwingPrices`, a fixture name or `{ currency, removeAds,
 * starter, packs: { 10: micros, … } }`, for the same on the dev server.
 */
import { monetization } from '../config/monetization';
import type {
  IapService,
  PurchaseResult,
  RestoreResult,
  RevealPack,
  StoreProduct,
} from './Iap';

/** What the tester picks on the fake purchase sheet. */
export type MockChoice = 'buy' | 'cancel' | 'fail' | 'pending';

/** Iap.ts's `creditPurchase`, handed in so this file imports no runtime from it. */
export type Deliver = (
  productIds: readonly string[],
  txId: string,
  reason: 'purchase' | 'late-purchase'
) => boolean;

/** A storefront, as prices in millionths of its currency. */
export interface PriceFixture {
  readonly currency: string;
  readonly removeAds: number;
  readonly starter: number;
  /** By pack count. */
  readonly packs: Readonly<Record<number, number>>;
}

/** Everything this module reaches outside itself for, so a test can stand in. */
export interface MockEnv {
  /** Put the purchase to the tester. Default: the DOM sheet. */
  choose(product: StoreProduct): Promise<MockChoice>;
  /** After Pending: true when the "parent" approves. Default: a DOM pill. */
  awaitApproval(product: StoreProduct): Promise<boolean>;
  /** A query-string switch. */
  query(name: string): string | null;
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void } | null;
  wait(ms: number): Promise<void>;
  /** A storefront override, or null for dollars. */
  prices(): PriceFixture | null;
}

const REMOVE_ADS = monetization.products.removeAds;
const PACKS = monetization.products.revealPacks;
const STARTER = monetization.economy.starter;

/** Every product the fake store knows: exactly the ones the config names. */
export const MOCK_PRODUCT_IDS: readonly string[] = [
  REMOVE_ADS,
  ...PACKS.map((p) => p.id),
  STARTER.id,
];

/** Where "this Apple Account owns Remove Ads" is kept, across reloads. */
export const MOCK_OWNED_KEY = 'foldwing.mockOwned';

/** How long the fake store takes to answer: quick, but never zero. */
const ANSWER_MS = 250;
const SLOW_ANSWER_MS = 8000;

/**
 * The storefronts the ladder was checked against (see sellableLadder): the
 * dollar plan, Serbia where 20 and 30 both cost €1.99, and the UK where 10 and
 * 20 both cost £0.99.
 */
export const PRICE_FIXTURES: Readonly<Record<'usd' | 'srb' | 'gbr', PriceFixture>> = {
  usd: { currency: 'USD', removeAds: 2_990_000, starter: 990_000, packs: { 10: 990_000, 20: 1_490_000, 30: 1_990_000 } },
  srb: { currency: 'EUR', removeAds: 2_990_000, starter: 990_000, packs: { 10: 990_000, 20: 1_990_000, 30: 1_990_000 } },
  gbr: { currency: 'GBP', removeAds: 2_990_000, starter: 990_000, packs: { 10: 990_000, 20: 990_000, 30: 1_990_000 } },
};

function formatPrice(micros: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(micros / 1e6);
  } catch {
    return `${(micros / 1e6).toFixed(2)} ${currency}`;
  }
}

export function createMockIap(deliver: Deliver, overrides: Partial<MockEnv> = {}): IapService {
  const env: MockEnv = { ...browserEnv(), ...overrides };
  let answered = false;
  let answering: Promise<void> | null = null;
  let seq = 0;
  /** Waiting on the "parent", as StoreKit's deferred transactions are. */
  const pending = new Set<string>();

  const mode = (): string | null => env.query('iap');
  const fixture = (): PriceFixture => env.prices() ?? PRICE_FIXTURES.usd;

  /** A product as the store would describe it — priced once it has answered. */
  const productOf = (id: string, title: string, micros: number): StoreProduct => ({
    id,
    title,
    description: '',
    priceString: answered ? formatPrice(micros, fixture().currency) : '',
    priceMicros: answered ? micros : 0,
  });
  const pack = (rung: { id: string; count: number }): RevealPack => ({
    ...productOf(rung.id, `${rung.count} reveals`, fixture().packs[rung.count] ?? 0),
    count: rung.count,
  });
  const starter = (): RevealPack => ({
    ...productOf(STARTER.id, `${STARTER.count} reveals`, fixture().starter),
    count: STARTER.count,
  });
  const removeAds = (): StoreProduct => productOf(REMOVE_ADS, 'Remove ads', fixture().removeAds);
  /** After the answer, `?iap=none` is a store that returned nothing. */
  const returned = (): boolean => !(answered && mode() === 'none');

  const listed = (id: string): StoreProduct | null => {
    if (!answered || !returned()) return null;
    if (id === REMOVE_ADS) return removeAds();
    if (id === STARTER.id) return starter();
    const rung = PACKS.find((p) => p.id === id);
    return rung ? pack(rung) : null;
  };

  /** Deliver as StoreKit's approved handler would: through the same function. */
  const deliverNow = (id: string, reason: 'purchase' | 'late-purchase'): boolean => {
    if (!deliver([id], `mock-${Date.now()}-${++seq}`, reason)) return false;
    if (id === REMOVE_ADS) env.storage?.setItem(MOCK_OWNED_KEY, '1');
    return true;
  };

  const later = async (product: StoreProduct): Promise<void> => {
    pending.add(product.id);
    const approved = await env.awaitApproval(product);
    pending.delete(product.id);
    if (approved) deliverNow(product.id, 'late-purchase');
  };

  const service: IapService = {
    kind: 'mock',
    available: true,
    async init() {
      /* nothing to start */
    },
    warm() {
      if (answered) return Promise.resolve();
      answering ??= env.wait(mode() === 'slow' ? SLOW_ANSWER_MS : ANSWER_MS).then(() => {
        answered = true;
        answering = null;
      });
      return answering;
    },
    canPurchase: () => mode() !== 'restricted',
    removeAdsProduct() {
      return returned() ? removeAds() : null;
    },
    revealPacks() {
      if (!returned()) return [];
      return PACKS.map(pack);
    },
    starterProduct() {
      return answered && returned() ? starter() : null;
    },
    isPending: (id: string) => pending.has(id),
    buyRevealPack(id: string) {
      if (!PACKS.some((p) => p.id === id)) return Promise.resolve<PurchaseResult>('failed');
      return buy(id);
    },
    buyStarter: () => buy(STARTER.id),
    buyRemoveAds: () => buy(REMOVE_ADS),
    async restore(): Promise<RestoreResult> {
      await env.wait(ANSWER_MS);
      switch (env.query('restore')) {
        case 'cancelled':
          return 'cancelled';
        case 'error':
          return null;
        case 'false':
          return false;
        case 'true':
          env.storage?.setItem(MOCK_OWNED_KEY, '1');
          deliver([REMOVE_ADS], '', 'purchase');
          return true;
        default: {
          // As on a phone: restored is whatever this "Apple Account" bought.
          const owned = env.storage?.getItem(MOCK_OWNED_KEY) === '1';
          if (owned) deliver([REMOVE_ADS], '', 'purchase');
          return owned;
        }
      }
    },
  };

  async function buy(id: string): Promise<PurchaseResult> {
    await service.warm();
    const product = listed(id);
    if (!product || !service.canPurchase()) return 'failed';
    switch (await env.choose(product)) {
      case 'cancel':
        return 'cancelled';
      case 'fail':
        return 'failed';
      case 'pending':
        void later(product);
        return 'pending';
      case 'buy':
        return deliverNow(id, 'purchase') ? 'bought' : 'failed';
    }
  }

  return service;
}

/* ─────────────────────────────────────────────── the browser's side of it */

function browserEnv(): MockEnv {
  return {
    choose: chooseInPage,
    awaitApproval: approveInPage,
    query: (name) => {
      try {
        return new URLSearchParams(window.location.search).get(name);
      } catch {
        return null;
      }
    },
    storage: pageStorage(),
    wait: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
    prices: devPrices,
  };
}

/** localStorage, or nothing: a private window can throw on the first touch. */
function pageStorage(): MockEnv['storage'] {
  return {
    getItem: (key) => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* the purchase still lands; only "owned" is forgotten on reload */
      }
    },
  };
}

/**
 * A storefront other than dollars, for the dev server only: the ladder rules
 * (sellableLadder, the BEST VALUE tag, the starter's "save") are all about
 * prices that differ by country, and a store that only ever says $ cannot
 * show one of them failing.
 */
function devPrices(): PriceFixture | null {
  if (!import.meta.env.DEV) return null;
  const pick = (v: unknown): PriceFixture | null => {
    if (typeof v === 'string') {
      const key = v.toLowerCase();
      return Object.prototype.hasOwnProperty.call(PRICE_FIXTURES, key)
        ? PRICE_FIXTURES[key as keyof typeof PRICE_FIXTURES]
        : null;
    }
    if (typeof v === 'object' && v !== null) {
      const o = v as Partial<PriceFixture>;
      return { ...PRICE_FIXTURES.usd, ...o, packs: { ...PRICE_FIXTURES.usd.packs, ...(o.packs ?? {}) } };
    }
    return null;
  };
  try {
    const hook = (window as unknown as { __foldwingPrices?: unknown }).__foldwingPrices;
    return pick(hook) ?? pick(new URLSearchParams(window.location.search).get('prices'));
  } catch {
    return null;
  }
}

const Z = 2147483000 + 2;

function styleOn(el: HTMLElement, css: Record<string, string>): void {
  for (const [k, v] of Object.entries(css)) el.style.setProperty(k, v);
}

/**
 * Keep a fake surface's touches to itself, as a native sheet does.
 *
 * The same rule, and the same code, as the fake ads' (providers/mock.ts, where
 * it is private): Phaser listens on the WINDOW too, so a tap on this sheet
 * would otherwise also press whatever store row sits under it. Only presses
 * that began here are kept, and none is prevented, so the buttons still get
 * their clicks.
 */
function keepTouches(el: HTMLElement): void {
  const families: Array<[string, string[]]> = [
    ['touchstart', ['touchend', 'touchcancel']],
    ['mousedown', ['mouseup']],
    ['pointerdown', ['pointerup', 'pointercancel']],
  ];
  for (const [down, ups] of families) {
    let pressedHere = false;
    el.addEventListener(down, (e) => {
      pressedHere = true;
      e.stopPropagation();
    });
    for (const up of ups) {
      el.addEventListener(up, (e) => {
        if (!pressedHere) return;
        pressedHere = false;
        e.stopPropagation();
      });
    }
  }
}

function fakeButton(text: string, action: string, strong: boolean): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.setAttribute('data-action', action);
  styleOn(b, {
    appearance: 'none',
    border: '0',
    'border-radius': '999px',
    padding: '12px 18px',
    'min-height': '44px',
    font: '800 15px/1 ui-sans-serif, system-ui, sans-serif',
    cursor: 'pointer',
    background: strong ? '#ffc940' : '#2a3140',
    color: strong ? '#11141c' : '#e8eaf0',
  });
  return b;
}

/** The purchase sheet: where StoreKit would put its own, and unmistakably not it. */
function chooseInPage(product: StoreProduct): Promise<MockChoice> {
  return new Promise<MockChoice>((resolve) => {
    const root = document.createElement('div');
    root.setAttribute('data-foldwing-mock', 'purchase');
    styleOn(root, {
      position: 'fixed',
      inset: '0',
      // Reachable controls on any phone shape: clear of the notch, the home
      // indicator, and the side a Duo's status bar sits on.
      'padding-top': 'calc(16px + env(safe-area-inset-top, 0px))',
      'padding-bottom': 'calc(16px + env(safe-area-inset-bottom, 0px))',
      'padding-left': 'calc(16px + env(safe-area-inset-left, 0px))',
      'padding-right': 'calc(16px + env(safe-area-inset-right, 0px))',
      'box-sizing': 'border-box',
      'z-index': String(Z),
      background: 'rgba(17,20,28,.72)',
      display: 'flex',
      'align-items': 'flex-end',
      'justify-content': 'center',
      'user-select': 'none',
      '-webkit-user-select': 'none',
      // index.html sets touch-action: none on the page for the canvas.
      'touch-action': 'manipulation',
    });

    const card = document.createElement('div');
    styleOn(card, {
      width: 'min(100%, 420px)',
      'box-sizing': 'border-box',
      padding: '20px',
      'border-radius': '18px',
      background: '#11141c',
      border: '2px dashed #ff5a5a',
      color: '#e8eaf0',
      font: '600 15px/1.45 ui-sans-serif, system-ui, sans-serif',
      'text-align': 'center',
      display: 'flex',
      'flex-direction': 'column',
      gap: '12px',
    });

    const title = document.createElement('div');
    styleOn(title, { font: '800 22px/1.15 ui-sans-serif, system-ui, sans-serif', color: '#ff5a5a', 'letter-spacing': '.04em' });
    title.textContent = 'FAKE PURCHASE — no money';

    const what = document.createElement('div');
    styleOn(what, { font: '700 17px/1.3 ui-sans-serif, system-ui, sans-serif' });
    what.textContent = `${product.title} · ${product.priceString}`;

    const body = document.createElement('div');
    styleOn(body, { color: '#9aa2b0' });
    body.textContent = 'Nothing is charged and no store is called. Pick what the App Store would do.';

    const row = document.createElement('div');
    styleOn(row, { display: 'flex', 'flex-wrap': 'wrap', gap: '8px', 'justify-content': 'center' });
    const choices: Array<[string, MockChoice]> = [
      ['Buy', 'buy'],
      ['Cancel', 'cancel'],
      ['Fail', 'fail'],
      ['Pending', 'pending'],
    ];
    for (const [text, choice] of choices) {
      const b = fakeButton(text, choice, choice === 'buy');
      b.addEventListener('click', () => {
        root.remove();
        resolve(choice);
      });
      row.append(b);
    }

    card.append(title, what, body, row);
    root.append(card);
    keepTouches(root);
    document.body.appendChild(root);
  });
}

/** Where waiting approvals stack, top of the screen, out of the canvas's way. */
let pendingColumn: HTMLElement | null = null;

/**
 * An Ask to Buy waiting on its "parent": a pill that stays up until someone
 * approves or declines, as the real one can take minutes or days. Approve
 * delivers it as a late purchase — the arrival nobody's button is waiting for.
 */
function approveInPage(product: StoreProduct): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (!pendingColumn) {
      pendingColumn = document.createElement('div');
      styleOn(pendingColumn, {
        position: 'fixed',
        top: 'calc(8px + env(safe-area-inset-top, 0px))',
        left: 'calc(8px + env(safe-area-inset-left, 0px))',
        right: 'calc(8px + env(safe-area-inset-right, 0px))',
        'z-index': String(Z),
        display: 'flex',
        'flex-direction': 'column',
        'align-items': 'center',
        gap: '6px',
        'pointer-events': 'none',
      });
      document.body.appendChild(pendingColumn);
    }
    const column = pendingColumn;

    const pill = document.createElement('div');
    pill.setAttribute('data-foldwing-mock', 'purchase-pending');
    styleOn(pill, {
      'pointer-events': 'auto',
      display: 'flex',
      'align-items': 'center',
      gap: '8px',
      padding: '6px 6px 6px 14px',
      'border-radius': '999px',
      background: '#11141c',
      border: '2px dashed #ff5a5a',
      color: '#e8eaf0',
      font: '700 13px/1.2 ui-sans-serif, system-ui, sans-serif',
      'touch-action': 'manipulation',
      'user-select': 'none',
      '-webkit-user-select': 'none',
    });
    const text = document.createElement('span');
    text.textContent = `FAKE PURCHASE — ${product.title} waiting for approval`;
    const approve = fakeButton('Approve', 'approve', true);
    const decline = fakeButton('Decline', 'decline', false);
    const settle = (ok: boolean): void => {
      pill.remove();
      if (column.childElementCount === 0) {
        column.remove();
        if (pendingColumn === column) pendingColumn = null;
      }
      resolve(ok);
    };
    approve.addEventListener('click', () => settle(true));
    decline.addEventListener('click', () => settle(false));
    pill.append(text, approve, decline);
    keepTouches(pill);
    column.append(pill);
  });
}
