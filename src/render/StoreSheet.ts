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
 * do something: the rewarded row is skipped where there is no rewarded unit
 * (the whole web build), and the card is not shown at all when nothing can be
 * offered. A sheet whose only live control is "Not now" is worse than saying
 * the plain truth.
 */
import Phaser from 'phaser';
import { monetization, packSaving } from '../config/monetization';
import { Ads } from '../systems/Ads';
import { applyEntitlement, Iap } from '../systems/Iap';
import { Progress } from '../systems/Progress';
import { BASE_HEIGHT, BASE_WIDTH, pt, theme } from './Theme';
import {
  button,
  FONT,
  label,
  RADIUS,
  roundRect,
  setButtonSub,
  softShadow,
  TYPE,
} from './UI';

export interface StoreOffer {
  readonly text: string;
  readonly sub?: string;
  readonly variant: 'primary' | 'secondary';
  /** Product id, on rows whose caption still changes when the store answers. */
  readonly priced?: string;
  readonly press: () => void;
}

export interface StoreHooks {
  /** Reveals or the entitlement changed — repaint whatever shows them. */
  readonly onChange: () => void;
  /** Something worth saying out loud, in the caller's own idiom. */
  readonly onNotice: (message: string) => void;
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
 * what it claims to cost.
 *
 * The instinct behind the old code is still right — a control that visibly does
 * nothing reads as broken — so a missing ad now SAYS it is missing rather than
 * quietly paying.
 */
export async function earnReveal(hooks: StoreHooks): Promise<void> {
  const result = await Ads.showRewarded('reveal');
  if (result === 'earned') {
    Progress.grantReveals(monetization.reveals.grantedPerRewarded);
    hooks.onChange();
    return;
  }
  // 'declined' means they closed the ad early and know why nothing arrived.
  if (result === 'unavailable') {
    hooks.onNotice('no ad ready just now — try again in a moment');
  }
}

/**
 * Every rung that can be sold right now, cheapest first.
 *
 * THE LADDER: watch an ad, then 10, 20, 30 reveals, then reveals that never run
 * out. Each rung is better value per reveal than the one above it and it ends
 * somewhere no pack can reach, which makes the permanent unlock the obvious end
 * of the row rather than something the player has to go and find.
 *
 * Remove Ads keeps that name here, on the menu, and in App Store Connect — the
 * same name Apple prints in the payment dialog. It read "Unlimited reveals" for
 * one build, which is a better headline on a sheet about reveals and was still
 * wrong: one product wearing two names at one price looks like two products,
 * and the player finds out which it was at the moment they pay. What it gives
 * goes on the second line, where there is room to say all of it.
 */
export function storeOffers(hooks: StoreHooks): StoreOffer[] {
  const offers: StoreOffer[] = [];

  if (Ads.rewardedAvailable) {
    offers.push({
      // Say what lands. "+1" alone left the player to infer the unit from a
      // sheet whose whole subject is reveals, next to rows that spell theirs
      // out — the free option read as the vaguer of the two.
      text: 'Watch an ad',
      sub: '+1 reveal, free',
      variant: 'primary',
      press: () => void earnReveal(hooks),
    });
  }

  const packs = Iap.available ? Iap.revealPacks() : [];
  const base = packs[0];
  /*
   * Count on the face, price and what it saves underneath.
   *
   * Two lines rather than one long caption. `30 reveals · $1.99 · save 33%` is
   * a run-on the eye has to parse before it can compare rows, and comparing
   * rows is the only thing this card is for. Split, the counts line up down the
   * left and the value story sits quietly under each one.
   */
  for (const pack of packs) {
    const saving = base ? packSaving(base, pack) : null;
    offers.push({
      text: `${pack.count} reveals`,
      sub: [pack.priceString, saving === null ? '' : `save ${saving}%`]
        .filter(Boolean)
        .join(' · '),
      variant: 'secondary',
      priced: pack.id,
      press: () =>
        void (async () => {
          const bought = await Iap.buyRevealPack(pack.id);
          if (!bought) hooks.onNotice("the purchase didn't go through");
          hooks.onChange();
        })(),
    });
  }

  const removeAds = Iap.available ? Iap.removeAdsProduct() : null;
  if (removeAds && !Progress.data.adsRemoved) {
    offers.push({
      text: 'Remove ads',
      sub: [removeAds.priceString, 'unlimited reveals, no ads'].filter(Boolean).join(' · '),
      variant: 'secondary',
      priced: removeAds.id,
      press: () =>
        void (async () => {
          /*
           * Say so when it fails. A cancelled or failed purchase used to leave
           * the card simply closing, which is indistinguishable from having
           * bought something — applyEntitlement is the choke point that
           * persists the entitlement AND tells the ad layer, so if it did not
           * run, nothing happened and the player deserves to be told.
           */
          if (await Iap.buyRemoveAds()) applyEntitlement(true);
          else hooks.onNotice("the purchase didn't go through");
          hooks.onChange();
        })(),
    });
  }

  return offers;
}

/**
 * Draw the card. Returns null when there was nothing worth showing.
 *
 * Laid out from a running cursor rather than a formula per case: the card grew
 * from two rows to five when the packs became a ladder, and every row now
 * carries a second line. A single arithmetic expression for the height stopped
 * being checkable at that point — the menu stack learned the same lesson when a
 * hand-placed row got drawn off the bottom of the canvas. Measure the rows,
 * then draw the card around them.
 */
export function showStoreSheet(
  scene: Phaser.Scene,
  opts: {
    readonly title: string;
    readonly offers: readonly StoreOffer[];
    readonly onClose: () => void;
    /** Still the live sheet? Guards the async price fill against a close. */
    readonly stillOpen: (sheet: Phaser.GameObjects.Container) => boolean;
  }
): Phaser.GameObjects.Container | null {
  const { offers } = opts;
  if (offers.length === 0) return null;

  const t = theme();
  const sheet = scene.add.container(0, 0).setDepth(90);

  const dim = scene.add
    .rectangle(BASE_WIDTH / 2, BASE_HEIGHT / 2, BASE_WIDTH, BASE_HEIGHT, t.ink, 0.22)
    .setInteractive();
  dim.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => opts.onClose());
  sheet.add(dim);

  const cw = pt(292);
  const ROW = pt(50);
  const GAP = pt(9);
  const TITLE_TO_ROWS = pt(30);
  const ROWS_TO_TAIL = pt(16);
  const TAIL = pt(30);
  const PAD_TOP = pt(26);
  const PAD_BOTTOM = pt(20);

  const rowsHeight = offers.length * ROW + (offers.length - 1) * GAP;
  const ch = PAD_TOP + pt(20) + TITLE_TO_ROWS + rowsHeight + ROWS_TO_TAIL + TAIL + PAD_BOTTOM;
  const cy = BASE_HEIGHT / 2;
  const top = cy - ch / 2;

  const card = scene.add.graphics();
  softShadow(card, BASE_WIDTH / 2 - cw / 2, top, cw, ch, RADIUS.md, 0.8);
  card.fillStyle(t.paper, 1);
  roundRect(card, BASE_WIDTH / 2 - cw / 2, top, cw, ch, RADIUS.md);
  sheet.add(card);

  sheet.add(
    label(scene, BASE_WIDTH / 2, top + PAD_TOP + pt(10), opts.title, {
      size: TYPE.body,
      font: FONT.display,
      alpha: 0.8,
    }).setOrigin(0.5)
  );

  const pricedRows = new Map<string, Phaser.GameObjects.Container>();
  let rowY = top + PAD_TOP + pt(20) + TITLE_TO_ROWS + ROW / 2;
  for (const offer of offers) {
    const row = button(scene, BASE_WIDTH / 2, rowY, offer.text, {
      width: cw - pt(30),
      height: ROW,
      variant: offer.variant,
      size: TYPE.label,
      sub: offer.sub || undefined,
      onPress: () => {
        opts.onClose();
        offer.press();
      },
    });
    if (offer.priced) pricedRows.set(offer.priced, row);
    sheet.add(row);
    rowY += ROW + GAP;
  }

  rowY += ROWS_TO_TAIL - GAP;
  sheet.add(
    button(scene, BASE_WIDTH / 2, rowY, 'Not now', {
      width: cw - pt(30),
      height: TAIL,
      variant: 'ghost',
      size: TYPE.label,
      onPress: () => opts.onClose(),
    })
  );

  /*
   * Fill the prices in if the store has not answered yet.
   *
   * `Iap.warm()` is fired when a selling screen opens, so the prices are
   * normally known by the time anyone gets here and this does nothing. It
   * covers the case that is not: a player who reaches the store within a second
   * or two of launching, on a slow connection.
   *
   * Rebuilt from the same expressions the rows were built from, so a caption
   * that changes here cannot drift from one that did not.
   */
  if (offers.some((o) => o.priced && !o.sub)) {
    void (async () => {
      await Iap.warm();
      if (!opts.stillOpen(sheet)) return; // they closed it meanwhile

      const fresh = Iap.revealPacks();
      const freshBase = fresh[0];
      for (const pack of fresh) {
        if (!pack.priceString) continue;
        const saving = freshBase ? packSaving(freshBase, pack) : null;
        setButtonSub(
          pricedRows.get(pack.id) ?? null,
          [pack.priceString, saving === null ? '' : `save ${saving}%`].filter(Boolean).join(' · ')
        );
      }

      const unlock = Iap.removeAdsProduct();
      if (unlock?.priceString) {
        setButtonSub(
          pricedRows.get(unlock.id) ?? null,
          `${unlock.priceString} · unlimited reveals, no ads`
        );
      }
    })();
  }

  return sheet;
}
