/**
 * The store, as one definition used from every screen that sells.
 *
 * It lived inside GameScene, reachable only by running out of reveals mid-fold.
 * That is the highest-intent moment in the game and it stays that way — but it
 * was also the ONLY moment, so a player who wanted to buy something while
 * looking at the menu had no way to do it, and the menu could only offer the
 * single most expensive product with no ladder around it.
 *
 * Both screens now build the same rows from the same expressions. The prices,
 * the savings, the order of the rungs and the wording of every caption exist
 * once, so the two cannot drift into looking like two different shops.
 *
 * The rows are built BEFORE the card is drawn, and only rows that can actually
 * do something: the rewarded row is skipped wherever no ad can ever play (the
 * whole web build, an ads-off build, and a player who declined ad consent — see
 * `Ads.rewardedAvailable`) and once today's ad-paid reveals are used up; a
 * product the store did not return is not drawn at all; a row whose price has
 * not arrived is drawn waiting and cannot be pressed. Where nothing is left to
 * sell, the card says why in one plain line rather than showing a sheet whose
 * only live control is "Not now".
 *
 * WHO SAYS WHAT LANDED. A purchase or a rewarded ad started here is reported
 * by this file, through `StoreHooks.onChange` with the line to show and what
 * arrived — Progress announces the same grant to its `onGrant` listeners, but
 * those should present only what no flow reported: a 'late-purchase' (an Ask to
 * Buy approved later, a transaction redelivered after a crash), for which
 * `grantNotice` has the line.
 */
import Phaser from 'phaser';
import {
  bestValueId,
  monetization,
  packSaving,
  type PricedPack,
  sellableLadder,
  starterWorthShowing,
} from '../config/monetization';
import { Ads } from '../systems/Ads';
import { Audio } from '../systems/Audio';
import { Haptics } from '../systems/Haptics';
import {
  applyEntitlement,
  Iap,
  type PurchaseResult,
  type RestoreResult,
  type RevealPack,
  type StoreProduct,
} from '../systems/Iap';
import { type GrantEvent, Progress } from '../systems/Progress';
import { icon } from './Icons';
import { bannerLine, BASE_WIDTH, dp, pt, theme, ui, viewHeight } from './Theme';
import {
  button,
  cardBlocker,
  dismissOnScrim,
  eyeGlyph,
  FONT,
  type Glyph,
  keepCentred,
  label,
  mainCameraOnly,
  RADIUS,
  scrim,
  sheetPanel,
  shieldInput,
  strokeRoundRect,
  type Tone,
  TYPE,
  videoGlyph,
} from './UI';

export type StoreRowKind = 'ad' | 'starter' | 'pack' | 'removeAds';

export interface StoreOffer {
  readonly kind: StoreRowKind;
  readonly text: string;
  readonly sub?: string;
  readonly variant: 'primary' | 'secondary' | 'accent';
  /** What the row sells, drawn on its left — see the glyphs in UI. */
  readonly icon?: Glyph;
  /** A tag on the row's corner: STARTER, BEST VALUE, ONE-TIME. */
  readonly badge?: string;
  /** Product id, on rows that sell one. */
  readonly priced?: string;
  /**
   * False while the store has not priced the row. It is drawn waiting and
   * cannot be pressed: Apple asks for the full price on every purchase
   * control, and a buy button with no price is a promise nobody can check.
   */
  readonly ready: boolean;
  readonly press: () => void;
}

/** What arrived, for the screen that animates it. */
export interface StoreLanded {
  readonly kind: 'reveals' | 'removeAds';
  /** Reveals that arrived; 0 for Remove Ads. */
  readonly reveals: number;
  readonly reason: 'rewarded' | 'purchase' | 'restore';
}

export interface StoreHooks {
  /**
   * Something landed — reveals or the entitlement.
   *
   * Called ONLY when something changed, with the line saying what landed and
   * what it was, so the screen can fly the tokens and tick its count. The
   * success haptic and the reward sound have already played.
   */
  readonly onChange: (notice?: string, landed?: StoreLanded) => void;
  /**
   * Something worth saying out loud that is not a landing — a cancel, a
   * failure, a purchase waiting for approval — in the caller's own idiom.
   */
  readonly onNotice: (message: string, tone?: Tone) => void;
  /**
   * Whether the rewarded refill is still wanted once its ad has loaded — asked
   * right before the ad would go on screen (see Ads.showRewarded). An uncached
   * rewarded load is a real fetch at the tap, and by the time it answers the
   * player may have left the level or started drawing; the ad must not land on
   * the Menu or over a live stroke. Undefined means always wanted: the Menu's
   * store has nothing to leave.
   */
  readonly stillWanted?: () => boolean;
}

const STARTER = monetization.economy.starter;
const PER_AD = monetization.reveals.grantedPerRewarded;

/* ------------------------------------------------------------ the words */

const plural = (n: number): string => `+${n} ${n === 1 ? 'reveal' : 'reveals'}`;

/**
 * What a grant of `n` reveals says, with the stash it leaves — counted from the
 * save after the grant, so the line cannot disagree with the Reveal pill.
 * Owners have no stash to count.
 */
function landedLine(n: number): string {
  if (Progress.data.adsRemoved) return plural(n);
  return `${plural(n)} · you have ${Progress.data.reveals}`;
}

const ADS_REMOVED = 'ads removed · reveals are unlimited now';

/**
 * The line for a grant event, for an `onGrant` listener that shows one: a late
 * purchase is "+10 reveals arrived", because nothing on screen asked for it.
 * Null for events that carry nothing to say, and for grants that belong to
 * other systems (missions, chapters, streaks) with their own copy.
 */
export function grantNotice(g: GrantEvent): string | null {
  if (g.adsRemoved === true) return ADS_REMOVED;
  if (g.reveals <= 0) return null;
  switch (g.reason) {
    case 'late-purchase':
      return `${plural(g.reveals)} arrived`;
    case 'purchase':
    case 'rewarded':
      return landedLine(g.reveals);
    default:
      return null;
  }
}

const OUTCOME: Record<Exclude<PurchaseResult, 'bought'>, { text: string; tone: Tone }> = {
  cancelled: { text: 'purchase cancelled', tone: 'plain' },
  pending: { text: "waiting for approval · it lands here once it's approved", tone: 'plain' },
  failed: { text: "the purchase didn't go through", tone: 'warn' },
};

/*
 * The second line of each priced row. Once, here, because it is drawn again
 * every time a late price arrives — two copies of the expression are how a
 * caption changes on the second visit to the store.
 */
const hasPrice = (p: StoreProduct): boolean => p.priceString !== '';
const WAITING = '…';

function savingText(base: PricedPack | undefined, p: PricedPack): string {
  const saving = base ? packSaving(base, p) : null;
  return saving === null ? '' : `save ${saving}%`;
}

function packSub(base: RevealPack | undefined, pack: RevealPack): string {
  if (!hasPrice(pack)) return WAITING;
  return [pack.priceString, savingText(base, pack)].filter(Boolean).join(' · ');
}

function starterSub(base: RevealPack | undefined, starter: RevealPack): string {
  return [starter.priceString, 'once', savingText(base, starter)].filter(Boolean).join(' · ');
}

/*
 * "& skips" is a true added benefit: owners skip a stuck fold without an ad.
 * "once" is on the price because a one-time price next to consumables is the
 * thing a player most needs to be sure of before paying three times as much.
 */
function removeAdsSub(product: StoreProduct): string {
  if (!hasPrice(product)) return WAITING;
  return `${product.priceString} once · no ads, unlimited reveals & skips`;
}

/* ------------------------------------------------------------ the rows */

/** The rewarded row is drawn: an ad can play, the player has not paid to stop them, and today's cap has room. */
function adRowShown(now: Date): boolean {
  return Ads.rewardedAvailable && !Progress.data.adsRemoved && Progress.canAdPay(PER_AD, now);
}

/** Today's ad-paid reveals are used up — the row is gone, and the card says until when. */
function capReached(now: Date): boolean {
  return Ads.rewardedAvailable && !Progress.data.adsRemoved && !Progress.canAdPay(PER_AD, now);
}

/** The ladder this storefront can honestly sell, and the starter if it is a deal against it. */
function catalogue(): { kept: RevealPack[]; starter: RevealPack | null } {
  if (!Iap.available || !Iap.canPurchase()) return { kept: [], starter: null };
  const kept = sellableLadder(Iap.revealPacks());
  const s = Iap.starterProduct();
  const d = Progress.data;
  /*
   * Not while an Ask to Buy for it is waiting either: each request a child
   * sends is its own transaction, and every approval pays in full. It is not
   * marked bought on 'pending', because a parent's No would lose it for good.
   */
  const eligible =
    s !== null &&
    !d.adsRemoved &&
    !d.starterBought &&
    !Iap.isPending(s.id) &&
    d.totalWins >= STARTER.afterWins &&
    starterWorthShowing(s, kept);
  return { kept, starter: eligible ? s : null };
}

/** Whether the starter row would be drawn right now — for the menu's NEW badge. */
export function starterOnOffer(): boolean {
  return !Progress.data.adsRemoved && catalogue().starter !== null;
}

/**
 * Whether the store has anything to sell this player: a row `storeOffers`
 * would draw, counted the same way, so a "+" never opens a card that can only
 * explain why it sells nothing. False for owners, where payments are off, and
 * where the store answered with nothing and no ad can play. True before the
 * store has answered: the rows are coming.
 */
export function storeSells(now: Date = new Date()): boolean {
  if (Progress.data.adsRemoved) return false;
  if (adRowShown(now)) return true;
  if (!Iap.available || !Iap.canPurchase()) return false;
  const { kept, starter } = catalogue();
  return kept.length > 0 || starter !== null || Iap.removeAdsProduct() !== null;
}

/** The hooks each offer list was built with, so the sheet can rebuild it as prices arrive. */
const builtWith = new WeakMap<readonly StoreOffer[], StoreHooks>();

/**
 * Every row that can be sold right now, in the order the card draws them.
 *
 * THE LADDER: watch an ad, then the starter, then the packs, then reveals that
 * never run out. The free row comes first and is the only primary — reveals
 * must stay earnable, or watching the next ad stops being a fair deal — and a
 * purchase never gets promoted just because the free row is missing.
 *
 * The packs are the ones `sellableLadder` keeps: in a storefront where Apple's
 * tiers make a bigger pack no better value (Serbia's 20 and 30 are both
 * €1.99), the trap rung is simply not drawn. BEST VALUE goes where the
 * arithmetic says it does, or nowhere. There is no "most popular": nothing
 * here has sales data, so it would be a false claim.
 *
 * Remove Ads keeps that name here, on the menu, and in App Store Connect — the
 * same name Apple prints in the payment dialog. One product wearing two names
 * at one price looks like two products, and the player finds out which it was
 * at the moment they pay. What it gives goes on the second line.
 */
export function storeOffers(hooks: StoreHooks, now: Date = new Date()): StoreOffer[] {
  const offers: StoreOffer[] = [];
  builtWith.set(offers, hooks);
  // Owners have unlimited reveals and no ads: there is nothing left to sell them.
  if (Progress.data.adsRemoved) return offers;

  if (adRowShown(now)) {
    offers.push({
      kind: 'ad',
      text: 'Watch an ad',
      // What lands, what it costs, and how many more today — the cap is real,
      // so the row says it before the player finds it by surprise.
      sub: `${plural(PER_AD)} · free · ${Progress.adRevealsLeft(now)} left today`,
      variant: 'primary',
      icon: videoGlyph,
      ready: true,
      press: () => void earnReveal(hooks),
    });
  }

  const { kept, starter } = catalogue();
  const base = kept[0];

  if (starter) {
    offers.push({
      kind: 'starter',
      text: `${starter.count} reveals`,
      sub: starterSub(base, starter),
      variant: 'secondary',
      icon: eyeGlyph,
      badge: 'starter',
      priced: starter.id,
      ready: true,
      press: () =>
        void purchase(() => Iap.buyStarter(), { kind: 'reveals', reveals: starter.count }, hooks),
    });
  }

  const best = bestValueId(kept);
  /*
   * Count on the face, price and what it saves underneath.
   *
   * Two lines rather than one long caption. `30 reveals · $1.99 · save 33%` is
   * a run-on the eye has to parse before it can compare rows, and comparing
   * rows is the only thing this card is for.
   */
  for (const pack of kept) {
    offers.push({
      kind: 'pack',
      text: `${pack.count} reveals`,
      sub: packSub(base, pack),
      variant: 'secondary',
      // The same eye the Reveal pill wears, so the row looks like the thing it
      // buys rather than a number beside a price.
      icon: eyeGlyph,
      badge: pack.id === best ? 'best value' : undefined,
      priced: pack.id,
      ready: hasPrice(pack),
      press: () =>
        void purchase(() => Iap.buyRevealPack(pack.id), { kind: 'reveals', reveals: pack.count }, hooks),
    });
  }

  const unlock = Iap.available && Iap.canPurchase() ? Iap.removeAdsProduct() : null;
  if (unlock) {
    offers.push({
      kind: 'removeAds',
      text: 'Remove ads',
      sub: removeAdsSub(unlock),
      variant: 'accent',
      // No mark on the left: its second line is the longest in the store and
      // needs the whole row, and the outline and the tag already set it apart.
      badge: 'one-time',
      priced: unlock.id,
      ready: hasPrice(unlock),
      press: () => void purchase(() => Iap.buyRemoveAds(), { kind: 'removeAds', reveals: 0 }, hooks),
    });
  }

  return offers;
}

/** The moment something lands: one success tap and the reward chord. */
function celebrate(): void {
  Haptics.success();
  Audio.reward();
}

/**
 * The rewarded refill. The reveal is granted ONLY when the ad was watched to
 * the reward.
 *
 * This used to grant on anything that was not 'declined', which meant
 * 'unavailable' paid out too — and 'unavailable' covers no-fill, offline, and
 * every non-native build. On the web Daily that made the button an infinite
 * reveal dispenser that never showed an ad: the limit was not generous, it was
 * switched off. Reveals are the game's one currency, so the payout has to cost
 * what it claims to cost — and count against the day's cap, in the same write.
 *
 * The instinct behind the old code is still right — a control that visibly does
 * nothing reads as broken — so a missing ad now SAYS it is missing rather than
 * quietly paying.
 */
export async function earnReveal(hooks: StoreHooks): Promise<void> {
  const result = await Ads.showRewarded('reveal', hooks.stillWanted);
  if (result === 'earned') {
    // Refused only if another placement spent the last of today's cap while
    // this ad played; the row said how many were left when it was drawn.
    if (!Progress.payAdReveals(PER_AD)) {
      hooks.onNotice('free reveals are back tomorrow', 'plain');
      return;
    }
    celebrate();
    hooks.onChange(landedLine(PER_AD), { kind: 'reveals', reveals: PER_AD, reason: 'rewarded' });
    return;
  }
  // 'declined' means they closed the ad early and know why nothing arrived;
  // 'abandoned' means they walked away or started drawing while it loaded —
  // nothing was shown, and there is nobody left to tell. Only a missing ad is
  // worth a word.
  if (result === 'unavailable') {
    hooks.onNotice('no ad ready just now — try again in a moment', 'warn');
  }
}

/**
 * Run a purchase and say how it ended.
 *
 * A change only when something landed. This used to call onChange after the
 * notice either way — and on the menu onChange rebuilds the scene, which wiped
 * "the purchase didn't go through" in the same frame it was written: a
 * cancelled purchase there said nothing at all.
 */
async function purchase(
  run: () => Promise<PurchaseResult>,
  what: { kind: 'reveals' | 'removeAds'; reveals: number },
  hooks: StoreHooks
): Promise<void> {
  const result = await run();
  if (result !== 'bought') {
    hooks.onNotice(OUTCOME[result].text, OUTCOME[result].tone);
    return;
  }
  /*
   * applyEntitlement is the choke point that persists the entitlement AND
   * tells the ad layer. The approved handler already ran it; running it again
   * is free, and a 'bought' that somehow skipped it must not leave ads up.
   */
  if (what.kind === 'removeAds') applyEntitlement(true);
  celebrate();
  hooks.onChange(what.kind === 'removeAds' ? ADS_REMOVED : landedLine(what.reveals), {
    ...what,
    reason: 'purchase',
  });
}

/**
 * Restore purchases, and say what came of it — every outcome, because a
 * button that answers only on success reads as broken on every other path.
 * Used by the store's footer; the Settings row can call it too, so the two
 * say the same thing.
 */
export async function restorePurchases(hooks: StoreHooks): Promise<RestoreResult> {
  const result = await Iap.restore();
  if (result === true) {
    applyEntitlement(true);
    celebrate();
    hooks.onChange('restored · no ads, unlimited reveals', {
      kind: 'removeAds',
      reveals: 0,
      reason: 'restore',
    });
    return result;
  }
  hooks.onNotice(
    result === false
      ? 'nothing to restore on this Apple Account'
      : result === 'cancelled'
        ? 'restore cancelled — nothing changed'
        : "couldn't reach the App Store — try again in a moment",
    result === null ? 'warn' : 'plain'
  );
  return result;
}

/* ------------------------------------------------------------ the card */

/** How long a sheet waits for missing prices before it says so. */
const PRICE_WAIT_MS = 6000;
/** Asks the store again this often while prices are missing, this many times. */
const PRICE_ATTEMPTS = 8;
const PRICE_RETRY_MS = 750;

const CW = pt(300);
const ROW_W = CW - pt(30);
const PAD_TOP = pt(18);
const HEAD_H = pt(28);
const SUB_H = pt(18);
const HEAD_GAP = pt(14);
const ROW = pt(50);
const HERO = pt(62);
const GAP = pt(9);
/** Extra air over a row wearing a tag: the tag straddles its top edge. */
const TAG_ROOM = pt(6);
const NOTE_H = pt(20);
const FOOT_GAP = pt(12);
const FOOT_H = pt(44);
const PAD_BOTTOM = pt(10);

/**
 * Where the card may sit: under the status bar, and clear of the banner.
 *
 * The native banner stays up while a sheet is open, pinned to the bottom of
 * the screen, and on a 9:16 phone the canvas runs right under it. A store row
 * drawn there is a purchase button under an ad — a misclick onto the ad, the
 * one thing this game's ad account cannot afford. So the card is centred in
 * the band above the banner's reserve, not on the canvas.
 */
export const SHEET_TOP_LIMIT = pt(44);

/**
 * The band's bottom on a world `height` tall: pt(8) over the banner's reserve,
 * which is anchored to the bottom — so on a taller world the band is taller
 * and a centred card sits lower, in the middle of the screen it is on.
 */
export function sheetBottomLimit(height: number = viewHeight()): number {
  return bannerLine(height) - pt(8);
}

export interface SheetRowSpec {
  readonly h: number;
  readonly badge: boolean;
}

export interface StoreSheetLayout {
  readonly top: number;
  readonly height: number;
  readonly titleY: number;
  readonly subY: number | null;
  /** Row centres, in order. */
  readonly rows: readonly number[];
  /** Tallest each row's tap area may grow, a point short of its neighbour's reach. */
  readonly rowTapMax: readonly number[];
  readonly messageY: number | null;
  readonly noteY: number | null;
  readonly footerY: number;
  readonly footerTapMax: number;
}

/**
 * The card, laid out from a running cursor rather than a formula per case: it
 * holds anything from one line to six rows, a tag here and there, a footnote.
 * A single arithmetic expression for the height stopped being checkable long
 * before that — measure the rows, then draw the card around them. Pure, so the
 * banner rule is tested rather than eyeballed.
 *
 * Tap areas: every row is drawn at pt(50) or more and tapped at the thumb's
 * floor, which is in points and grows in base units as the canvas shrinks. Each
 * area may grow a point short of half the gap on either side, so two areas never
 * share a spot however small the canvas is drawn; the footer gets the same
 * treatment against the last row and the card's own bottom edge. Below a
 * canvas scale of about 0.42 (a Split View pane) that caps taps under 44pt,
 * which is accepted rather than letting rows overlap.
 */
export function storeSheetLayout(spec: {
  readonly rows: readonly SheetRowSpec[];
  readonly sub: boolean;
  readonly messageH: number;
  readonly note: boolean;
  /** The world's height; the current one by default. */
  readonly height?: number;
}): StoreSheetLayout {
  let y = PAD_TOP;
  const titleY = y + HEAD_H / 2;
  y += HEAD_H;
  let subY: number | null = null;
  if (spec.sub) {
    subY = y + SUB_H / 2;
    y += SUB_H;
  }
  y += HEAD_GAP;

  const rows: number[] = [];
  const rowTapMax: number[] = [];
  for (const r of spec.rows) {
    if (r.badge) y += TAG_ROOM;
    rows.push(y + r.h / 2);
    rowTapMax.push(r.h + GAP - pt(1));
    y += r.h + GAP;
  }
  if (spec.rows.length > 0) y -= GAP;

  let messageY: number | null = null;
  if (spec.messageH > 0) {
    if (spec.rows.length > 0) y += GAP;
    messageY = y + spec.messageH / 2;
    y += spec.messageH;
  }
  let noteY: number | null = null;
  if (spec.note) {
    y += pt(4);
    noteY = y + NOTE_H / 2;
    y += NOTE_H;
  }

  y += FOOT_GAP;
  const footerY = y + FOOT_H / 2;
  y += FOOT_H + PAD_BOTTOM;
  const height = y;

  // The last row reaches at most (GAP - pt(1)) / 2 below its face.
  const rowReach = (GAP - pt(1)) / 2;
  const footerTapMax = FOOT_H + 2 * Math.min(FOOT_GAP - rowReach - pt(1), PAD_BOTTOM - pt(1));

  const band = sheetBottomLimit(spec.height) - SHEET_TOP_LIMIT;
  const top = SHEET_TOP_LIMIT + Math.max(0, (band - height) / 2);
  const shift = (v: number): number => top + v;
  return {
    top,
    height,
    titleY: shift(titleY),
    subY: subY === null ? null : shift(subY),
    rows: rows.map(shift),
    rowTapMax,
    messageY: messageY === null ? null : shift(messageY),
    noteY: noteY === null ? null : shift(noteY),
    footerY: shift(footerY),
    footerTapMax,
  };
}

const rowHeight = (o: StoreOffer): number => (o.kind === 'removeAds' ? HERO : ROW);

/**
 * Keep a row's second line clear of its mark and inside its face.
 *
 * The prices are the store's, localised: "1 234,00 ₽" is longer than "$0.99",
 * and a line that runs under the icon on the left is the one line on the row
 * the player must read before paying. Scaled down rather than cut, so no price
 * is ever shown in part. `button-sub` is the name UI gives that line so it can
 * be found again (see setButtonSub).
 */
function fitSub(row: Phaser.GameObjects.Container, maxW: number): void {
  const sub = row.getByName('button-sub');
  if (sub instanceof Phaser.GameObjects.Text && sub.width > maxW) sub.setScale(maxW / sub.width);
}

/** A row the store has not priced is drawn at this strength: it is not for pressing yet. */
export const WAITING_ALPHA = 0.5;

/**
 * How strongly a waiting row draws its parts: the face, caption, mark and tag
 * (`row`), and its second line (`sub`), on top of that line's own alpha.
 *
 * The whole row fades while it waits, "…" included — a mark, not words. Once
 * the wait has run out the second line says "price unavailable", and that is
 * the one thing on the row a player reads: faded with it, it measured 2.1:1.
 * So it keeps the strength every price line has, held to the 4.5:1 floor on
 * its face (UI's `buttonSubAlpha`), and the row around it stays faded.
 */
export function waitingAlphas(timedOut: boolean): { readonly row: number; readonly sub: number } {
  return { row: WAITING_ALPHA, sub: timedOut ? 1 : WAITING_ALPHA };
}

/**
 * Fade a row that is waiting on its price, and make it unpressable. Part by
 * part rather than the row's own alpha, which would fade every child with it.
 */
export function drawWaiting(row: Phaser.GameObjects.Container, timedOut: boolean): void {
  const a = waitingAlphas(timedOut);
  row.disableInteractive();
  for (const part of row.list) {
    // A part that draws nothing (a Zone for a hit area, say) has no alpha to fade.
    if (!('setAlpha' in part)) continue;
    const faded = part as Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Alpha;
    faded.setAlpha(part.name === 'button-sub' ? a.sub : a.row);
  }
}

export interface SheetModel {
  readonly offers: readonly StoreOffer[];
  readonly balance: string;
  /** One plain line where rows would be: owners, an unreachable store, payments off. */
  readonly message: string | null;
  /** The ad cap's footnote. */
  readonly note: string | null;
}

/**
 * What the card says around its rows. The order of the checks is the order
 * of the truths: an owner has nothing to buy whatever the device allows, and a
 * device that refuses payments is why the store looks empty, not the network.
 */
export function sheetModel(offers: readonly StoreOffer[], now: Date = new Date()): SheetModel {
  const owner = Progress.data.adsRemoved;
  let message: string | null = null;
  if (owner) message = 'Remove ads is yours · reveals are unlimited';
  else if (Iap.available && !Iap.canPurchase()) message = 'Purchases are turned off on this iPhone';
  else if (Iap.available && offers.length === 0) message = "The store isn't reachable right now";
  return {
    offers,
    balance: owner ? '∞' : `you have ${Progress.data.reveals}`,
    message,
    note: capReached(now) ? 'free reveals are back tomorrow' : null,
  };
}

/** No row, no line, no footnote: no store here at all — `showStoreSheet` returns null. */
export function sheetIsEmpty(m: SheetModel): boolean {
  return m.offers.length === 0 && !m.message && !m.note;
}

/**
 * Draw the store. Returns null when there is no store here at all — no
 * products to be had, no ad to earn from, not an owner — so the caller can say
 * so in its own words.
 *
 * Pass `hooks` and the sheet builds its own rows, and rebuilds them as the
 * store answers: prices fill in, a product the store did not return goes, the
 * starter appears once its price proves it a deal. `offers` from
 * `storeOffers(hooks)` still works and does the same — the hooks are found
 * from the list they built.
 */
export function showStoreSheet(
  scene: Phaser.Scene,
  opts: {
    readonly title: string;
    /** 'refill' adds a line on what a reveal does. Defaults from the title. */
    readonly kind?: 'store' | 'refill';
    readonly hooks?: StoreHooks;
    readonly offers?: readonly StoreOffer[];
    readonly onClose: () => void;
    /** Still the live sheet? Guards the async price fill against a close. */
    readonly stillOpen: (sheet: Phaser.GameObjects.Container) => boolean;
  }
): Phaser.GameObjects.Container | null {
  const hooks = opts.hooks ?? (opts.offers ? builtWith.get(opts.offers) : undefined);
  const build = (): readonly StoreOffer[] =>
    hooks ? storeOffers(hooks) : (opts.offers ?? []);
  const refill = (opts.kind ?? (opts.title === 'Out of reveals' ? 'refill' : 'store')) === 'refill';

  let model = sheetModel(opts.offers ?? build(), new Date());
  if (sheetIsEmpty(model)) return null;

  const t = theme();
  const u = ui();
  // Laid out for the world as it is now — every redraw too — and kept
  // centred if it changes (keepCentred), purchase in flight and all.
  const builtH = viewHeight();
  const sheet = keepCentred(scene.add.container(0, 0).setDepth(90));
  mainCameraOnly(scene, sheet);

  /*
   * Every way out of the sheet that a TAP takes also raises a short shield:
   * the sheet is gone on the release, and the second tap of a double tap
   * would otherwise land on whatever it was covering — see `shieldInput`.
   */
  const close = (): void => {
    shieldInput(scene);
    opts.onClose();
  };
  const alive = (): boolean => opts.stillOpen(sheet) && !!sheet.scene;

  // The night's scrim, the page's bands dimmed with it (UI.scrim).
  const dim = scrim(scene, BASE_WIDTH / 2, builtH / 2);
  dismissOnScrim(dim, close);
  sheet.add(dim);

  let body: Phaser.GameObjects.Container | null = null;
  let drawn = '';
  let timedOut = false;

  const draw = (m: SheetModel): void => {
    body?.destroy(true);
    body = scene.add.container(0, 0);
    sheet.add(body);
    const b = body;

    const cx = BASE_WIDTH / 2;
    const left = cx - CW / 2;
    const right = cx + CW / 2;
    const message = m.message
      ? label(scene, cx, 0, m.message, { size: TYPE.label, color: u.text2, align: 'center' })
          .setOrigin(0.5)
          .setWordWrapWidth(ROW_W)
      : null;
    const L = storeSheetLayout({
      rows: m.offers.map((o) => ({ h: rowHeight(o), badge: !!o.badge })),
      sub: refill,
      messageH: message ? Math.max(pt(20), message.height) : 0,
      note: m.note !== null,
      height: builtH,
    });

    // The opaque sheet (UI.sheetPanel): a tap on the title or between two rows is not a request to leave.
    b.add(sheetPanel(scene, cx, L.top + L.height / 2, CW, L.height, RADIUS.lg));
    b.add(cardBlocker(scene, cx, L.top + L.height / 2, CW, L.height));

    // The header: what this is on the left, what the player has on the right.
    b.add(
      label(scene, left + pt(18), L.titleY, opts.title, {
        size: TYPE.heading,
        font: FONT.display,
        color: u.text,
      }).setOrigin(0, 0.5)
    );
    const balance = label(scene, right - pt(18), L.titleY, m.balance, {
      size: TYPE.label,
      weight: 600,
      color: u.text2,
    }).setOrigin(1, 0.5);
    const eye = icon(scene, balance.x - balance.width - pt(12), L.titleY, 'eye', { size: dp(19), color: t.accentText });
    b.add([eye, balance]);
    if (L.subY !== null) {
      const seconds = Math.round(monetization.reveals.durationMs / 1000);
      const sub = label(scene, left + pt(18), L.subY, `a reveal shows the folded walls for ${seconds} seconds`, {
        size: TYPE.micro,
        color: u.text3,
      }).setOrigin(0, 0.5);
      // A long font fallback must not run the line off the card.
      if (sub.width > ROW_W) sub.setScale(ROW_W / sub.width);
      b.add(sub);
    }

    m.offers.forEach((offer, i) => {
      const h = rowHeight(offer);
      const waiting = !offer.ready;
      const row = button(scene, cx, L.rows[i], offer.text, {
        width: ROW_W,
        height: h,
        variant: offer.variant,
        size: offer.kind === 'removeAds' ? TYPE.body : TYPE.label,
        sub: waiting ? (timedOut ? 'price unavailable' : WAITING) : offer.sub || undefined,
        icon: offer.icon,
        badge: offer.badge,
        minTap: true,
        maxTap: L.rowTapMax[i],
        onPress: () => {
          close();
          offer.press();
        },
      });
      if (offer.kind === 'starter') {
        // Secondary face, accent outline: set apart from the ladder without
        // outshouting the free row or looking like the hero below it.
        const lw = pt(1.5);
        const ring = scene.add.graphics();
        ring.lineStyle(lw, t.accent, 1);
        strokeRoundRect(ring, -ROW_W / 2 + lw / 2, -h / 2 + lw / 2, ROW_W - lw, h - lw, RADIUS.md - lw / 2);
        row.addAt(ring, 1);
        Progress.markStarterSeen();
      }
      fitSub(row, offer.icon ? ROW_W - 2 * pt(36) : ROW_W - pt(24));
      if (waiting) drawWaiting(row, timedOut);
      b.add(row);
    });

    if (message && L.messageY !== null) {
      message.setY(L.messageY);
      b.add(message);
    } else {
      message?.destroy();
    }
    if (m.note !== null && L.noteY !== null) {
      b.add(
        label(scene, cx, L.noteY, m.note, { size: TYPE.micro, color: u.text3, align: 'center' }).setOrigin(0.5)
      );
    }

    // Restore sits in the store's footer and in Settings, not on the menu.
    const restorable = Iap.available && hooks !== undefined;
    const footW = restorable ? (ROW_W - pt(8)) / 2 : ROW_W;
    const foot = (x: number, text: string, onPress: () => void): Phaser.GameObjects.Container =>
      button(scene, x, L.footerY, text, {
        width: footW,
        height: FOOT_H,
        variant: 'ghost',
        size: TYPE.label,
        minTap: true,
        maxTap: L.footerTapMax,
        onPress,
      });
    if (restorable && hooks) {
      const h = hooks;
      b.add(
        foot(left + pt(15) + footW / 2, 'Restore purchases', () => {
          close();
          void restorePurchases(h);
        })
      );
      b.add(foot(right - pt(15) - footW / 2, 'Not now', close));
    } else {
      b.add(foot(cx, 'Not now', close));
    }
  };

  /** Everything the card shows, in one string: redraw only when it changes. */
  const signature = (m: SheetModel): string =>
    JSON.stringify([
      m.balance,
      m.message,
      m.note,
      timedOut,
      m.offers.map((o) => [o.kind, o.priced, o.text, o.sub, o.ready, o.badge]),
    ]);

  /*
   * A redraw destroys every row, and a press is judged on the release by the
   * row that saw it begin (see UI's wirePress). A finger that went down on
   * "Watch an ad" and lifts after the prices arrived would lift onto a new row
   * that never saw it, and nothing would happen. So a change that lands
   * mid-press waits for every finger to be off the glass — polled, because a
   * release outside the canvas is not a pointer-up — by which time the press
   * has been judged, and has usually closed the card.
   */
  const pressing = (): boolean => scene.input.manager.pointers.some((p) => p.isDown);
  let held = false;
  const redrawOnRelease = (): void => {
    if (held) return;
    held = true;
    const wait = (): void => {
      window.setTimeout(() => {
        if (!alive()) return;
        if (pressing()) return wait();
        held = false;
        refresh();
      }, 100);
    };
    wait();
  };

  const refresh = (): SheetModel => {
    if (hooks) model = sheetModel(build(), new Date());
    const sig = signature(model);
    if (sig === drawn) return model;
    // The first draw is the card itself, and cannot wait.
    if (drawn !== '' && pressing()) {
      redrawOnRelease();
      return model;
    }
    drawn = sig;
    draw(model);
    return model;
  };
  refresh();

  /*
   * Fill the store in if it has not answered yet.
   *
   * `Iap.warm()` is fired when a selling screen opens, so the store has
   * normally answered by the time anyone gets here and this does nothing. It
   * covers the case that is not: a player who reaches the store within a second
   * or two of launching, on a slow connection — which on device is simply the
   * first Store visit of a launch.
   *
   * Keeps asking for a few seconds while the sheet is up, rather than once: a
   * price the store sends a moment after it connects must still land on the
   * row the player is looking at, not only on the next visit. After six
   * seconds a row still waiting says so instead of spinning forever.
   */
  if (hooks && Iap.available) {
    void (async () => {
      for (let attempt = 0; attempt < PRICE_ATTEMPTS; attempt++) {
        await Iap.warm();
        if (!alive()) return;
        if (refresh().offers.every((o) => o.ready)) return;
        await new Promise((r) => setTimeout(r, PRICE_RETRY_MS));
        if (!alive()) return;
      }
    })();
    window.setTimeout(() => {
      // Only a card with a row still waiting changes. `timedOut` is in the
      // signature, so any other would be rebuilt for nothing.
      if (!alive() || model.offers.every((o) => o.ready)) return;
      timedOut = true;
      refresh();
    }, PRICE_WAIT_MS);
  }

  return sheet;
}
