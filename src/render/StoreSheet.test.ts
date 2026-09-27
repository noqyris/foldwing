/*
 * What the store offers, and in what order — the part of the sheet that is a
 * decision rather than drawing. The ad layer, the store and the save are
 * stand-ins whose state each test sets; the card itself is Phaser and is
 * checked in the browser.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rewardedAvailable: true,
  left: 5,
  save: { adsRemoved: false, starterBought: false, totalWins: 10, reveals: 3 },
  iap: {
    available: true,
    canPurchase: true,
    packs: [] as Array<Record<string, unknown>>,
    starter: null as Record<string, unknown> | null,
    removeAds: null as Record<string, unknown> | null,
    pending: [] as string[],
  },
}));

// StoreSheet draws with Phaser, which cannot load without a browser; nothing
// under test here reaches it.
vi.mock('phaser', () => ({ default: {} }));
vi.mock('./UI', () => ({
  eyeGlyph: () => {},
  videoGlyph: () => {},
}));
vi.mock('../systems/Haptics', () => ({ Haptics: { success: vi.fn() } }));
vi.mock('../systems/Audio', () => ({ Audio: { reward: vi.fn() } }));
vi.mock('../systems/Ads', () => ({
  Ads: {
    get rewardedAvailable() {
      return state.rewardedAvailable;
    },
    showRewarded: vi.fn(),
  },
}));
vi.mock('../systems/Progress', () => ({
  Progress: {
    get data() {
      return state.save;
    },
    canAdPay: (n = 1) => state.left >= n,
    adRevealsLeft: () => state.left,
    payAdReveals: vi.fn((n = 1) => {
      if (state.left < n) return false;
      state.left -= n;
      state.save.reveals += n;
      return true;
    }),
    markStarterSeen: vi.fn(),
  },
}));
vi.mock('../systems/Iap', () => ({
  Iap: {
    get available() {
      return state.iap.available;
    },
    canPurchase: () => state.iap.canPurchase,
    revealPacks: () => state.iap.packs,
    starterProduct: () => state.iap.starter,
    removeAdsProduct: () => state.iap.removeAds,
    isPending: (id: string) => state.iap.pending.includes(id),
    buyRevealPack: vi.fn(),
    buyStarter: vi.fn(),
    buyRemoveAds: vi.fn(),
    restore: vi.fn(),
  },
  applyEntitlement: vi.fn(),
}));

import { monetization } from '../config/monetization';
import { Ads } from '../systems/Ads';
import { Haptics } from '../systems/Haptics';
import { applyEntitlement, Iap } from '../systems/Iap';
import { Progress } from '../systems/Progress';
import {
  drawWaiting,
  earnReveal,
  grantNotice,
  restorePurchases,
  sheetBottomLimit,
  SHEET_TOP_LIMIT,
  sheetIsEmpty,
  sheetModel,
  starterOnOffer,
  type StoreOffer,
  storeOffers,
  storeSells,
  storeSheetLayout,
  type StoreHooks,
  WAITING_ALPHA,
  waitingAlphas,
} from './StoreSheet';
import { blend, contrast, glassOver, METRICS, pt, theme, ui } from './Theme';

// The button kit's real numbers — the inks, the press tints and the second
// line's alpha — for the contrast checks below; the mock above only stands in
// for the glyphs.
const { buttonInk, buttonSubAlpha, PRESS_TINT } = await vi.importActual<typeof import('./UI')>('./UI');

const [R10, R20, R30] = monetization.products.revealPacks.map((p) => p.id);
const STARTER = monetization.economy.starter.id;
const REMOVE_ADS = monetization.products.removeAds;

type Money = { sym: string; packs: [number, number, number]; starter: number; removeAds: number };
const USD: Money = { sym: '$', packs: [0.99, 1.49, 1.99], starter: 0.99, removeAds: 2.99 };
const SRB: Money = { sym: '€', packs: [0.99, 1.99, 1.99], starter: 0.99, removeAds: 2.99 };
const GBR: Money = { sym: '£', packs: [0.99, 0.99, 1.99], starter: 0.99, removeAds: 2.99 };

const priced = (id: string, count: number, sym: string, price: number) => ({
  id,
  count,
  title: `${count} reveals`,
  description: '',
  priceString: `${sym}${price.toFixed(2)}`,
  priceMicros: Math.round(price * 1e6),
});

/** The store as it answers in a storefront. */
function storefront(m: Money): void {
  state.iap.packs = [
    priced(R10, 10, m.sym, m.packs[0]),
    priced(R20, 20, m.sym, m.packs[1]),
    priced(R30, 30, m.sym, m.packs[2]),
  ];
  state.iap.starter = priced(STARTER, 25, m.sym, m.starter);
  const { count: _c, ...unlock } = priced(REMOVE_ADS, 0, m.sym, m.removeAds);
  state.iap.removeAds = unlock;
}

/** The store before it has answered: every rung waiting, nothing priced. */
function unanswered(): void {
  state.iap.packs = [10, 20, 30].map((count, i) => ({
    id: [R10, R20, R30][i],
    count,
    title: `${count} reveals`,
    description: '',
    priceString: '',
    priceMicros: 0,
  }));
  state.iap.starter = null;
  state.iap.removeAds = { id: REMOVE_ADS, title: 'Remove ads', description: '', priceString: '', priceMicros: 0 };
}

function hooks() {
  return {
    onChange: vi.fn(),
    onNotice: vi.fn(),
  } satisfies StoreHooks;
}

const kinds = (h: StoreHooks = hooks()) => storeOffers(h).map((o) => (o.priced ? `${o.kind}:${o.priced}` : o.kind));

beforeEach(() => {
  vi.clearAllMocks();
  state.rewardedAvailable = true;
  state.left = 5;
  state.save = { adsRemoved: false, starterBought: false, totalWins: 10, reveals: 3 };
  state.iap.available = true;
  state.iap.canPurchase = true;
  state.iap.pending = [];
  storefront(USD);
});

describe('the rows', () => {
  it('come in order: the free ad, the starter, the ladder, Remove ads', () => {
    expect(kinds()).toEqual([
      'ad',
      `starter:${STARTER}`,
      `pack:${R10}`,
      `pack:${R20}`,
      `pack:${R30}`,
      `removeAds:${REMOVE_ADS}`,
    ]);
    const offers = storeOffers(hooks());
    // The free row is the only primary; the hero is the accent one.
    expect(offers.map((o) => o.variant)).toEqual(['primary', 'secondary', 'secondary', 'secondary', 'secondary', 'accent']);
    expect(offers.every((o) => o.ready)).toBe(true);
  });

  it('say what each costs and saves, from the prices the store returned', () => {
    const offers = storeOffers(hooks());
    expect(offers.map((o) => [o.text, o.sub, o.badge])).toEqual([
      ['Watch an ad', '+1 reveal · free · 5 left today', undefined],
      ['25 reveals', '$0.99 · once · save 60%', 'starter'],
      ['10 reveals', '$0.99', undefined],
      ['20 reveals', '$1.49 · save 25%', undefined],
      ['30 reveals', '$1.99 · save 33%', 'best value'],
      ['Remove ads', '$2.99 once · no ads, unlimited reveals & skips', 'one-time'],
    ]);
  });

  it('count down the free reveals left today', () => {
    state.left = 4;
    expect(storeOffers(hooks())[0].sub).toBe('+1 reveal · free · 4 left today');
    state.left = 1;
    expect(storeOffers(hooks())[0].sub).toBe('+1 reveal · free · 1 left today');
  });

  /*
   * The free rung is the only filled face on the card, and a purchase is never
   * promoted into its place: at the cap nothing is primary. The hero is set
   * apart by its accent face and tag, not by a fill.
   */
  it('keep the free row the only primary, and promote no purchase when it is gone', () => {
    const primaries = storeOffers(hooks()).filter((o) => o.variant === 'primary');
    expect(primaries.map((o) => o.kind)).toEqual(['ad']);
    state.left = 0;
    expect(storeOffers(hooks()).some((o) => o.variant === 'primary')).toBe(false);
    state.left = 5;
    state.rewardedAvailable = false;
    expect(storeOffers(hooks()).some((o) => o.variant === 'primary')).toBe(false);
  });
});

/*
 * QA round 1, UX-2 (S1, S2): every line a player reads before paying is held
 * to 4.5:1 on the face it sits on, at rest and under the thumb. The faces are
 * the button kit's own in Night Fold (UI.buttonFace, buttonInk, PRESS_TINT),
 * on the store's opaque sheet: the tangerine primary with dark ink, smoked
 * glass with cream, the accent wash with ember. A pressed face is the baked
 * face TINTED — each channel multiplied by the tint. The second line's alpha
 * is `buttonSubAlpha`, times whatever this sheet fades a row by. The caption
 * above it is the same colour at no less alpha, so the second line binds.
 */
describe('the price lines, read', () => {
  const t = theme();
  const u = ui();
  /** A baked face under a Phaser tint: every channel scaled by the tint's. */
  const tinted = (c: number, tint: number): number => {
    const ch = (sh: number): number => Math.round((((c >> sh) & 0xff) * ((tint >> sh) & 0xff)) / 255);
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
  };
  /**
   * The grounds a row paints — every one its text may sit on — at `strength`
   * of the row's own alpha over the sheet, and the text colour.
   */
  const face = (variant: StoreOffer['variant'], pressed: boolean, strength = 1) => {
    const over = (c: number): number => blend(c, strength, u.sheet);
    switch (variant) {
      case 'primary': {
        const ends = [u.accentTop, u.accentBottom].map((c) => (pressed ? tinted(c, PRESS_TINT.light) : c));
        return { text: buttonInk('primary'), bgs: ends.map(over) };
      }
      case 'secondary': {
        const g = glassOver(u.sheet);
        return { text: buttonInk('secondary'), bgs: [over(pressed ? tinted(g, PRESS_TINT.dark) : g)] };
      }
      case 'accent': {
        const wash = blend(t.accent, t.accentWash, u.sheet);
        return { text: buttonInk('accent'), bgs: [over(pressed ? tinted(wash, PRESS_TINT.dark) : wash)] };
      }
    }
  };
  const worst = (f: ReturnType<typeof face>, alpha: number): number => Math.min(...f.bgs.map((bg) => contrast(f.text, bg, alpha)));

  it('every priced row clears the body floor, at rest and pressed', () => {
    const offers = storeOffers(hooks());
    expect(new Set(offers.map((o) => o.kind))).toEqual(new Set(['ad', 'starter', 'pack', 'removeAds']));
    for (const o of offers) {
      for (const pressed of [false, true]) {
        const ratio = worst(face(o.variant, pressed), buttonSubAlpha(o.variant));
        expect(ratio, `${o.text} · ${o.sub}${pressed ? ' (pressed)' : ''}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  /*
   * The hero was the palest row on the card: its title and price in 0.8 of
   * the accent on the accent wash, 3.7:1. Both go at full strength now.
   */
  it('reads Remove ads in the full accent, title and price', () => {
    const hero = storeOffers(hooks()).find((o) => o.kind === 'removeAds')!;
    expect(hero.variant).toBe('accent');
    expect(buttonSubAlpha(hero.variant)).toBe(1);
    // The title is the same ember, at full strength too.
    expect(worst(face('accent', false), 1)).toBeGreaterThanOrEqual(4.5);
    expect(worst(face('accent', true), 1)).toBeGreaterThanOrEqual(4.5);
  });

  it('fades a row still waiting for its price, "…" included, as the spec draws it', () => {
    expect(WAITING_ALPHA).toBe(0.5);
    expect(waitingAlphas(false)).toEqual({ row: WAITING_ALPHA, sub: WAITING_ALPHA });
  });

  /*
   * "price unavailable" is the line that says why the row does nothing. Faded
   * with its row it read 2.1:1; it keeps the price line's strength on the
   * faded face instead.
   */
  it('says "price unavailable" at the floor, on the faded row', () => {
    unanswered();
    const waiting = storeOffers(hooks()).filter((o) => !o.ready);
    expect(waiting.map((o) => o.kind)).toEqual(['pack', 'pack', 'pack', 'removeAds']);
    const a = waitingAlphas(true);
    expect(a.row).toBe(WAITING_ALPHA);
    for (const o of waiting) {
      const f = face(o.variant, false, a.row);
      const alpha = buttonSubAlpha(o.variant);
      expect(worst(f, alpha * a.sub), o.text).toBeGreaterThanOrEqual(4.5);
      // Faded with its row, as it was, it would not.
      expect(worst(f, alpha * a.row)).toBeLessThan(4.5);
    }
  });

  /*
   * Part by part: an alpha on the row itself would multiply into the second
   * line too, and no alpha on the line could bring it back.
   */
  it('fades each part of a waiting row but its second line, and makes it unpressable', () => {
    const part = (name: string) => ({ name, setAlpha: vi.fn() });
    const parts = [part(''), part(''), part('button-label'), part('button-sub'), part('button-badge')];
    const row = { list: parts, setAlpha: vi.fn(), disableInteractive: vi.fn() };
    const draw = (timedOut: boolean) =>
      drawWaiting(row as unknown as Parameters<typeof drawWaiting>[0], timedOut);

    draw(true);
    expect(row.disableInteractive).toHaveBeenCalled();
    expect(row.setAlpha).not.toHaveBeenCalled();
    for (const p of parts) {
      expect(p.setAlpha).toHaveBeenLastCalledWith(p.name === 'button-sub' ? 1 : WAITING_ALPHA);
    }

    draw(false);
    for (const p of parts) expect(p.setAlpha).toHaveBeenLastCalledWith(WAITING_ALPHA);
  });

  it('passes over a part with no alpha, and still fades the rest', () => {
    const faded = { name: 'button-label', setAlpha: vi.fn() };
    const row = { list: [{ name: 'hit-zone' }, faded], disableInteractive: vi.fn() };

    expect(() => drawWaiting(row as unknown as Parameters<typeof drawWaiting>[0], false)).not.toThrow();
    expect(faded.setAlpha).toHaveBeenLastCalledWith(WAITING_ALPHA);
    expect(row.disableInteractive).toHaveBeenCalled();
  });
});

describe('the ad row', () => {
  it('goes at the cap', () => {
    state.left = 0;
    expect(kinds()[0]).not.toBe('ad');
  });

  it('is not drawn where no ad can play', () => {
    state.rewardedAvailable = false;
    expect(kinds()).not.toContain('ad');
  });

  it('is never offered to an owner — nothing is', () => {
    state.save.adsRemoved = true;
    expect(storeOffers(hooks())).toEqual([]);
  });
});

describe('the starter', () => {
  it('is gone once bought', () => {
    state.save.starterBought = true;
    expect(kinds()).not.toContain(`starter:${STARTER}`);
  });

  it('waits for five wins', () => {
    state.save.totalWins = 4;
    expect(kinds()).not.toContain(`starter:${STARTER}`);
    state.save.totalWins = 5;
    expect(kinds()).toContain(`starter:${STARTER}`);
  });

  it('is not offered to an owner', () => {
    state.save.adsRemoved = true;
    expect(starterOnOffer()).toBe(false);
  });

  /*
   * At €1.99 it is the price of thirty reveals for twenty-five: not a deal,
   * so not offered, however loudly the tag would have said STARTER.
   */
  it('is not offered where it is not a deal', () => {
    storefront({ ...SRB, starter: 1.99 });
    expect(kinds()).not.toContain(`starter:${STARTER}`);
    expect(starterOnOffer()).toBe(false);
  });

  it('is not offered before the store has priced it, or when it was not returned', () => {
    unanswered();
    expect(kinds()).not.toContain(`starter:${STARTER}`);
    storefront(USD);
    state.iap.starter = null;
    expect(kinds()).not.toContain(`starter:${STARTER}`);
    storefront(USD);
    expect(starterOnOffer()).toBe(true);
  });

  /*
   * Every Ask to Buy request is its own transaction and every approval pays
   * in full: a starter offered again while one waits could be sold twice.
   */
  it('is not offered again while a request for it waits on approval', () => {
    state.iap.pending = [STARTER];
    expect(kinds()).not.toContain(`starter:${STARTER}`);
    expect(starterOnOffer()).toBe(false);
    // Nor is it lost: a parent's No brings it back.
    state.iap.pending = [];
    expect(starterOnOffer()).toBe(true);
  });

  it('saves against the smallest rung actually on sale', () => {
    storefront(GBR);
    // Only the 20 rung survives in the UK: 25 for £0.99 against 20 for £0.99.
    const starter = storeOffers(hooks()).find((o) => o.kind === 'starter');
    expect(starter?.sub).toBe('£0.99 · once · save 20%');
  });
});

describe('the ladder', () => {
  it('drops the rung that is a trap in Serbia, and keeps the honest tag', () => {
    storefront(SRB);
    const packs = storeOffers(hooks()).filter((o) => o.kind === 'pack');
    expect(packs.map((o) => [o.text, o.sub, o.badge])).toEqual([
      ['10 reveals', '€0.99', undefined],
      ['30 reveals', '€1.99 · save 33%', 'best value'],
    ]);
  });

  it('tags nothing when a single rung is left', () => {
    storefront(GBR);
    const packs = storeOffers(hooks()).filter((o) => o.kind === 'pack');
    expect(packs.map((o) => o.text)).toEqual(['20 reveals']);
    expect(packs[0].badge).toBeUndefined();
  });

  it('draws every rung waiting until the store answers', () => {
    unanswered();
    const offers = storeOffers(hooks());
    expect(offers.map((o) => o.kind)).toEqual(['ad', 'pack', 'pack', 'pack', 'removeAds']);
    const buyable = offers.filter((o) => o.kind !== 'ad');
    expect(buyable.every((o) => !o.ready && o.sub === '…' && o.badge !== 'best value')).toBe(true);
  });

  it('is not drawn at all where this iPhone refuses payments', () => {
    state.iap.canPurchase = false;
    expect(kinds()).toEqual(['ad']);
  });

  it('is not drawn where there is no store', () => {
    state.iap.available = false;
    expect(kinds()).toEqual(['ad']);
    state.rewardedAvailable = false;
    expect(storeSells()).toBe(false);
  });
});

/*
 * The menu's "+" and its no-store toasts ask this: it must agree with what the
 * card would draw, or the "+" opens a card that only explains itself.
 */
describe('whether the store sells', () => {
  it('sells while there is a row to draw', () => {
    expect(storeSells()).toBe(true);
    state.rewardedAvailable = false;
    expect(storeSells()).toBe(true);
    // Before the store answers the rows are coming, so the "+" stays.
    unanswered();
    expect(storeSells()).toBe(true);
  });

  it('sells nothing to an owner', () => {
    state.save.adsRemoved = true;
    expect(storeSells()).toBe(false);
  });

  it('sells nothing where payments are off and no ad can play', () => {
    state.rewardedAvailable = false;
    state.iap.canPurchase = false;
    expect(storeSells()).toBe(false);
    // The ad row alone is still something to offer.
    state.rewardedAvailable = true;
    expect(storeSells()).toBe(true);
  });

  it('sells nothing where the store answered with nothing and no ad can play', () => {
    state.rewardedAvailable = false;
    state.iap.packs = [];
    state.iap.starter = null;
    state.iap.removeAds = null;
    expect(storeSells()).toBe(false);
    // One product returned is enough.
    storefront(USD);
    state.iap.packs = [];
    state.iap.starter = null;
    expect(storeSells()).toBe(true);
  });

  it('sells nothing past the cap without a store', () => {
    state.iap.available = false;
    state.left = 0;
    expect(storeSells()).toBe(false);
  });
});

/*
 * The card's words around its rows, and when there is no card at all. The
 * order matters: an owner is told they own it whatever the device allows, and
 * a device that refuses payments is not blamed on the network.
 */
describe('what the card says', () => {
  const model = () => sheetModel(storeOffers(hooks()));

  it('tells an owner it is theirs, with no rows and an endless stash', () => {
    state.save.adsRemoved = true;
    state.iap.canPurchase = false;
    const m = model();
    expect(m.offers).toEqual([]);
    expect(m.message).toBe('Remove ads is yours · reveals are unlimited');
    expect(m.balance).toBe('∞');
    expect(m.note).toBeNull();
    expect(sheetIsEmpty(m)).toBe(false);
  });

  it('says payments are off where this iPhone refuses them', () => {
    state.iap.canPurchase = false;
    const m = model();
    expect(m.message).toBe('Purchases are turned off on this iPhone');
    expect(m.offers.map((o) => o.kind)).toEqual(['ad']);
    expect(m.balance).toBe('you have 3');
  });

  it("says the store isn't reachable when it answered with nothing and no ad can play", () => {
    state.rewardedAvailable = false;
    state.iap.packs = [];
    state.iap.starter = null;
    state.iap.removeAds = null;
    const m = model();
    expect(m.offers).toEqual([]);
    expect(m.message).toBe("The store isn't reachable right now");
    expect(sheetIsEmpty(m)).toBe(false);
  });

  it('says nothing over rows it can draw', () => {
    const m = model();
    expect(m.message).toBeNull();
    expect(m.note).toBeNull();
  });

  it('says when free reveals are back, once the cap is reached', () => {
    state.left = 0;
    const m = model();
    expect(m.offers.map((o) => o.kind)).not.toContain('ad');
    expect(m.note).toBe('free reveals are back tomorrow');
  });

  it('is no card at all where there is no store, no ad and no cap to explain', () => {
    state.iap.available = false;
    state.rewardedAvailable = false;
    const m = model();
    expect(m.message).toBeNull();
    expect(m.note).toBeNull();
    expect(sheetIsEmpty(m)).toBe(true);
    // The cap's footnote alone is still a card.
    state.rewardedAvailable = true;
    state.left = 0;
    expect(sheetIsEmpty(model())).toBe(false);
  });
});

describe('a purchase from the sheet', () => {
  it('reports what landed, with the stash it leaves', async () => {
    const h = hooks();
    vi.mocked(Iap.buyRevealPack).mockImplementation(async () => {
      state.save.reveals += 30;
      return 'bought';
    });
    storeOffers(h).find((o) => o.priced === R30)!.press();
    await vi.waitFor(() => expect(h.onChange).toHaveBeenCalled());
    expect(Iap.buyRevealPack).toHaveBeenCalledWith(R30);
    expect(h.onChange).toHaveBeenCalledWith('+30 reveals · you have 33', {
      kind: 'reveals',
      reveals: 30,
      reason: 'purchase',
    });
    expect(Haptics.success).toHaveBeenCalledTimes(1);
    expect(h.onNotice).not.toHaveBeenCalled();
  });

  it('buys the starter through its own call', async () => {
    const h = hooks();
    vi.mocked(Iap.buyStarter).mockResolvedValue('bought');
    storeOffers(h).find((o) => o.kind === 'starter')!.press();
    await vi.waitFor(() => expect(h.onChange).toHaveBeenCalled());
    expect(h.onChange.mock.calls[0][1]).toEqual({ kind: 'reveals', reveals: 25, reason: 'purchase' });
  });

  it('says ads are gone, through the one entitlement choke point', async () => {
    const h = hooks();
    vi.mocked(Iap.buyRemoveAds).mockResolvedValue('bought');
    storeOffers(h).find((o) => o.kind === 'removeAds')!.press();
    await vi.waitFor(() => expect(h.onChange).toHaveBeenCalled());
    expect(applyEntitlement).toHaveBeenCalledWith(true);
    expect(h.onChange).toHaveBeenCalledWith('ads removed · reveals are unlimited now', {
      kind: 'removeAds',
      reveals: 0,
      reason: 'purchase',
    });
  });

  it.each([
    ['cancelled', 'purchase cancelled', 'plain'],
    ['failed', "the purchase didn't go through", 'warn'],
    ['pending', "waiting for approval · it lands here once it's approved", 'plain'],
  ] as const)('says %s, and changes nothing', async (result, text, tone) => {
    const h = hooks();
    vi.mocked(Iap.buyRevealPack).mockResolvedValue(result);
    storeOffers(h).find((o) => o.priced === R10)!.press();
    await vi.waitFor(() => expect(h.onNotice).toHaveBeenCalled());
    expect(h.onNotice).toHaveBeenCalledWith(text, tone);
    expect(h.onChange).not.toHaveBeenCalled();
    expect(Haptics.success).not.toHaveBeenCalled();
  });
});

describe('the rewarded refill', () => {
  it('pays on the reward, and counts it against the day', async () => {
    const h = hooks();
    vi.mocked(Ads.showRewarded).mockResolvedValue('earned');
    await earnReveal(h);
    expect(Progress.payAdReveals).toHaveBeenCalledWith(1);
    expect(state.left).toBe(4);
    expect(h.onChange).toHaveBeenCalledWith('+1 reveal · you have 4', {
      kind: 'reveals',
      reveals: 1,
      reason: 'rewarded',
    });
  });

  it('pays nothing for an ad that was not there, and says so', async () => {
    const h = hooks();
    vi.mocked(Ads.showRewarded).mockResolvedValue('unavailable');
    await earnReveal(h);
    expect(Progress.payAdReveals).not.toHaveBeenCalled();
    expect(h.onChange).not.toHaveBeenCalled();
    expect(h.onNotice).toHaveBeenCalledWith('no ad ready just now — try again in a moment', 'warn');
  });

  it('pays nothing for an ad closed early', async () => {
    const h = hooks();
    vi.mocked(Ads.showRewarded).mockResolvedValue('declined');
    await earnReveal(h);
    expect(Progress.payAdReveals).not.toHaveBeenCalled();
    expect(h.onNotice).not.toHaveBeenCalled();
  });

  it('pays nothing past the cap, even for an ad that was watched', async () => {
    const h = hooks();
    state.left = 0;
    vi.mocked(Ads.showRewarded).mockResolvedValue('earned');
    await earnReveal(h);
    expect(h.onChange).not.toHaveBeenCalled();
    expect(h.onNotice).toHaveBeenCalledWith('free reveals are back tomorrow', 'plain');
  });
});

describe('a restore', () => {
  it.each([
    [false, 'nothing to restore on this Apple Account', 'plain'],
    ['cancelled', 'restore cancelled — nothing changed', 'plain'],
    [null, "couldn't reach the App Store — try again in a moment", 'warn'],
  ] as const)('answers %s in words', async (result, text, tone) => {
    const h = hooks();
    vi.mocked(Iap.restore).mockResolvedValue(result);
    await restorePurchases(h);
    expect(h.onNotice).toHaveBeenCalledWith(text, tone);
    expect(applyEntitlement).not.toHaveBeenCalled();
  });

  it('applies what it found', async () => {
    const h = hooks();
    vi.mocked(Iap.restore).mockResolvedValue(true);
    await restorePurchases(h);
    expect(applyEntitlement).toHaveBeenCalledWith(true);
    expect(h.onChange).toHaveBeenCalledWith('restored · no ads, unlimited reveals', {
      kind: 'removeAds',
      reveals: 0,
      reason: 'restore',
    });
  });
});

describe('grantNotice', () => {
  it('says a late purchase arrived', () => {
    expect(grantNotice({ reveals: 10, bookmarks: 0, reason: 'late-purchase' })).toBe('+10 reveals arrived');
  });

  it('counts the stash for a purchase or an ad', () => {
    expect(grantNotice({ reveals: 10, bookmarks: 0, reason: 'purchase' })).toBe('+10 reveals · you have 3');
    expect(grantNotice({ reveals: 1, bookmarks: 0, reason: 'rewarded' })).toBe('+1 reveal · you have 3');
  });

  it('names the entitlement, and leaves other systems their own words', () => {
    expect(grantNotice({ reveals: 0, bookmarks: 0, reason: 'purchase', adsRemoved: true })).toBe(
      'ads removed · reveals are unlimited now'
    );
    expect(grantNotice({ reveals: 0, bookmarks: 0, reason: 'repair' })).toBeNull();
    expect(grantNotice({ reveals: 2, bookmarks: 0, reason: 'chapter' })).toBeNull();
    expect(grantNotice({ reveals: 1, bookmarks: 0, reason: 'daily' })).toBeNull();
  });
});

/*
 * The card sits in the band above the banner's reserve: the native banner
 * stays up under a sheet, and a store row under it is a purchase tap landing
 * on an ad.
 */
describe('the card', () => {
  const ROW = pt(50);
  const HERO = pt(62);
  const tallest = {
    // The ad, the starter (tagged), three packs (one tagged), Remove ads (tagged).
    rows: [
      { h: ROW, badge: false },
      { h: ROW, badge: true },
      { h: ROW, badge: false },
      { h: ROW, badge: false },
      { h: ROW, badge: true },
      { h: HERO, badge: true },
    ],
    sub: true,
    messageH: 0,
    note: false,
  };

  // The world's heights: 9:16, a modern iPhone, a tall narrow pane.
  for (const height of [1334, 1460, 1700]) {
    it(`fits between the status bar and the banner at its tallest: ${height} tall`, () => {
      const L = storeSheetLayout({ ...tallest, height });
      expect(L.top).toBeGreaterThanOrEqual(SHEET_TOP_LIMIT);
      expect(L.top + L.height).toBeLessThanOrEqual(sheetBottomLimit(height));
      // The band's bottom is anchored to the banner's reserve, at every height.
      expect(sheetBottomLimit(height)).toBe(height - METRICS.bannerReserve - pt(8));
    });

    it(`centres a short card in the band, which a taller world lowers: ${height} tall`, () => {
      const L = storeSheetLayout({ rows: [], sub: false, messageH: pt(20), note: false, height });
      const band = { top: SHEET_TOP_LIMIT, bottom: sheetBottomLimit(height) };
      expect(L.top - band.top).toBeCloseTo(band.bottom - (L.top + L.height), 6);
      const at916 = storeSheetLayout({ rows: [], sub: false, messageH: pt(20), note: false, height: 1334 });
      expect(L.top - at916.top).toBeCloseTo((height - 1334) / 2, 6);
    });
  }

  it('never lets two tap areas meet, the footer included', () => {
    for (const spec of [tallest, { ...tallest, rows: tallest.rows.slice(0, 2), note: true, messageH: pt(20) }]) {
      const L = storeSheetLayout(spec);
      const rowH = spec.rows.map((r) => r.h);
      for (let i = 0; i + 1 < L.rows.length; i++) {
        const lowerEdgeOfThis = L.rows[i] + Math.max(rowH[i], L.rowTapMax[i]) / 2;
        const upperEdgeOfNext = L.rows[i + 1] - Math.max(rowH[i + 1], L.rowTapMax[i + 1]) / 2;
        expect(lowerEdgeOfThis).toBeLessThan(upperEdgeOfNext);
      }
      const last = L.rows.length - 1;
      const lastBottom = L.rows[last] + Math.max(rowH[last], L.rowTapMax[last]) / 2;
      expect(lastBottom).toBeLessThan(L.footerY - L.footerTapMax / 2);
      // And the footer's area stays on the card.
      expect(L.footerY + L.footerTapMax / 2).toBeLessThanOrEqual(L.top + L.height);
    }
  });

  it('keeps every row at the thumb floor on a canvas drawn at 0.5', () => {
    const L = storeSheetLayout(tallest);
    for (const max of L.rowTapMax) expect(max).toBeGreaterThanOrEqual(pt(44));
    expect(L.footerTapMax).toBeGreaterThanOrEqual(pt(44));
  });

  it('holds a single line and the footer', () => {
    const L = storeSheetLayout({ rows: [], sub: false, messageH: pt(20), note: false });
    expect(L.rows).toEqual([]);
    expect(L.messageY).not.toBeNull();
    expect(L.messageY!).toBeLessThan(L.footerY);
  });
});
