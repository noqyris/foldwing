/**
 * MenuScene — the home page.
 *
 * Deliberately close to empty. The wordmark reflects itself, which states the
 * mechanic before a word of copy does, and everything else is one primary
 * action plus the things a returning player needs: where they are, what they
 * have, and the quiet way to remove the ads.
 */

import Phaser from 'phaser';
import { LEVELS } from '../data/levels';
import { Ads } from '../systems/Ads';
import { todayISO } from '../systems/Daily';
import { Haptics } from '../systems/Haptics';
import { applyEntitlement, Iap } from '../systems/Iap';
import { Progress } from '../systems/Progress';
import { BASE_WIDTH, pt, theme } from '../render/Theme';
import {
  button,
  COLUMN,
  enter,
  FONT,
  label,
  RADIUS,
  roundRect,
  SPACE,
  TYPE,
  wordmark,
} from '../render/UI';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    const t = theme();
    this.cameras.main.setBackgroundColor(t.paper);

    const cx = BASE_WIDTH / 2;
    const save = Progress.data;
    // Belt and braces: the save is sanitised on load, but this indexes straight
    // into LEVELS and an out-of-range value here throws inside create(), which
    // leaves no scene running at all — a blank screen with nothing to press.
    const nextIndex = Math.min(Math.max(0, save.unlockedIndex), LEVELS.length - 1);
    /*
     * Label from the same signal the button ACTS on. Reading `resuming` off
     * totalWins while `nextIndex` comes from unlockedIndex made the button say
     * "Play" and then open level 6, which is the state a rewarded skip leaves.
     */
    const resuming = nextIndex > 0 || save.totalWins > 0;

    const mark = wordmark(this, cx, pt(215));

    // Clear of the wordmark's reflection, which hangs a full line-height below
    // the baseline — overlapping it made both unreadable.
    const tagline = label(this, cx, pt(295), 'one line. two answers.', {
      size: TYPE.body,
      alpha: 0.42,
      font: FONT.display,
    }).setOrigin(0.5, 0);

    /*
     * Lay the actions out as a stack from a fixed top, rather than hand-placing
     * each one. Hand-placed rows are how the Gallery button ended up below the
     * bottom of the canvas the moment a third button was added — and on a 9:16
     * phone, where FIT leaves no letterbox at all, the banner eats the last
     * ~100 base px of the canvas, so the stack has to end well above it.
     */
    /*
     * The stack has to END above the banner, so its top and its gaps depend on
     * how many rows it has to hold. With a purchase to offer there are five,
     * and the comfortable spacing runs 84px past the banner line — which is how
     * "Restore purchases" got drawn half off the bottom of the canvas. Deriving
     * the geometry from the row count is the only version that cannot drift.
     */
    /*
     * The gap may never dip under pt(11): the primary button's drop shadow
     * reaches exactly pt(7) spread + pt(4) offset past its box, so anything
     * tighter paints the shadow onto the face of the next button — which is
     * what the five-row stack did at pt(7). The selling stack pays for the
     * wider gaps with slightly shorter purchase rows instead.
     */
    const selling = Iap.available && !save.adsRemoved;
    const rowGap = pt(11);
    const tallRow = pt(66);
    const row = pt(54);
    // pt(321) leaves 13 base px between the tagline and the primary button's
    // upward shadow reach (spread − offset = pt(3)); anything higher crowds
    // the tagline against the button, which the simulator screenshot showed.
    let cursorY = selling ? pt(321) : pt(355);
    const place = (h: number): number => {
      const y = cursorY + h / 2;
      cursorY += h + rowGap;
      return y;
    };

    const play = button(this, cx, place(tallRow), resuming ? 'Continue' : 'Play', {
      width: COLUMN,
      height: tallRow,
      variant: 'primary',
      sub: resuming ? `${nextIndex + 1}. ${LEVELS[nextIndex].name}` : undefined,
      onPress: () => this.open(nextIndex),
    });

    /*
     * The Daily Fold: one maze, everyone, today. The sub-line carries the
     * whole retention loop in six words — done or not, and the streak.
     */
    const today = todayISO();
    const doneToday = Progress.hasDaily(today);
    const streak = Progress.dailyStreak(today);
    const dailySub = doneToday
      ? streak > 1
        ? `solved · ${streak} day streak`
        : 'solved · come back tomorrow'
      : streak > 0
        ? `${streak} day streak — keep it`
        : 'one maze, everyone, today';
    const daily = button(this, cx, place(row), 'Daily fold', {
      width: COLUMN,
      height: row,
      variant: 'secondary',
      sub: dailySub,
      onPress: () => {
        Haptics.tap();
        this.scene.start('Game', { daily: today });
      },
    });

    // Levels and Gallery share a row: both are places you browse, and the
    // stack has to fit the Daily above them and the store below.
    const half = (COLUMN - pt(10)) / 2;
    const levels = button(this, cx - half / 2 - pt(5), place(row), 'Levels', {
      width: half,
      height: row,
      variant: 'secondary',
      onPress: () => {
        Haptics.tap();
        this.scene.start('LevelSelect');
      },
    });
    const figureCount = save.figures.length;
    const gallery = button(this, cx + half / 2 + pt(5), levels.y, 'Gallery', {
      width: half,
      height: row,
      variant: 'secondary',
      onPress: () => {
        Haptics.tap();
        this.scene.start('Gallery');
      },
    });

    const entering: Phaser.GameObjects.GameObject[] = [mark, tagline, play, daily, levels, gallery];

    /*
     * The purchase rows continue the SAME stack, and REPLACE the reveal chip.
     *
     * Two lessons are baked in here. They used to be hand-placed from a
     * `footerY` measured up from the banner, which put the invisible "Remove
     * ads" hit box over the bottom 38px of the Gallery button — a dead band on
     * a live button. Continuing the stack fixes that, but the stack then has to
     * actually FIT: five rows plus the chip runs past the banner line and off
     * the bottom of the canvas, which is how "Restore purchases" ended up half
     * drawn. So when there is something to buy, the chip gives up its slot.
     */
    if (!selling) {
      entering.push(this.buildRevealChip(cx, cursorY + pt(15), figureCount));
    }

    if (selling) {
      const product = Iap.removeAdsProduct();
      const price = product?.priceString ? ` · ${product.priceString}` : '';
      entering.push(
        button(this, cx, place(pt(40)), `Remove ads${price}`, {
          width: COLUMN,
          variant: 'secondary',
          size: TYPE.body,
          height: pt(40),
          onPress: () => void this.purchase(),
        })
      );
      entering.push(
        button(this, cx, place(pt(28)), 'Restore purchases', {
          width: COLUMN,
          variant: 'ghost',
          size: TYPE.label,
          height: pt(28),
          onPress: () => void this.restore(),
        })
      );
    }
    // No separate "you own this" row: the chip above already reads "unlimited
    // reveals" for owners, and the two were drawn 12px apart, overlapping by
    // more than half a line — both illegible.

    enter(this, entering);

    // The banner lives here and on level select. Never over the playfield.
    void Ads.showBanner();
  }

  /** The stash badge — a reveal only feels like a currency if it is visible. */
  private buildRevealChip(
    cx: number,
    y: number,
    figureCount: number
  ): Phaser.GameObjects.Container {
    const t = theme();
    const unlimited = Progress.data.adsRemoved;
    const n = Progress.data.reveals;
    const reveals = unlimited ? 'unlimited reveals' : `${n} ${n === 1 ? 'reveal' : 'reveals'}`;
    const sense = Progress.data.foldSense;
    const bits = [reveals];
    if (sense > 0) bits.push(`Fold Sense ${sense}`);
    if (figureCount > 0) bits.push(`${figureCount} folded`);
    const text = bits.join(' · ');

    const c = this.add.container(cx, y);
    const temp = label(this, 0, 0, text, { size: TYPE.label, alpha: 0.55 }).setOrigin(0.5);
    const w = temp.width + SPACE.lg;
    const h = pt(30);

    const g = this.add.graphics();
    g.fillStyle(t.ink, 0.05);
    roundRect(g, -w / 2, -h / 2, w, h, RADIUS.pill);

    c.add([g, temp]);
    return c;
  }

  private open(index: number): void {
    Haptics.tap();
    // The banner stays up through gameplay now, so it is never torn down and
    // rebuilt on a scene change — a banner that disappears and reappears is
    // worse than one that is simply always there.
    this.scene.start('Game', { levelIndex: index });
  }

  private async purchase(): Promise<void> {
    Haptics.tap();
    const owned = await Iap.buyRemoveAds();
    if (!owned) return;
    Progress.setAdsRemoved(true);
    Ads.setAdsRemoved(true);
    this.scene.restart();
  }

  private async restore(): Promise<void> {
    Haptics.tap();
    const result = await Iap.restore();
    applyEntitlement(result);
    if (result === true) {
      Ads.setAdsRemoved(true);
      this.scene.restart();
    }
  }
}
