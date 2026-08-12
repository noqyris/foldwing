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
import { Audio } from '../systems/Audio';
import { todayISO } from '../systems/Daily';
import { Haptics } from '../systems/Haptics';
import { applyEntitlement, Iap } from '../systems/Iap';
import { Progress, type SaveData } from '../systems/Progress';
import { Rate } from '../systems/Rate';
import { BASE_HEIGHT, BASE_WIDTH, METRICS, ms, pt, setMotionScale, theme } from '../render/Theme';
import {
  button,
  COLUMN,
  enter,
  FONT,
  label,
  RADIUS,
  roundRect,
  softShadow,
  SPACE,
  tappable,
  TYPE,
  wordmark,
} from '../render/UI';

export class MenuScene extends Phaser.Scene {
  private settingsSheet: Phaser.GameObjects.Container | null = null;
  /** A store round-trip is in flight; a second tap must not place a second order. */
  private busy = false;
  /** The tagline, which doubles as the menu's one status line — see `flash`. */
  private tagline: Phaser.GameObjects.Text | null = null;
  private taglineText = '';
  private taglineAlpha = 0.42;
  private flashTimer: Phaser.Time.TimerEvent | null = null;

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

    /*
     * The tagline sits clear of the wordmark's reflection, which hangs a full
     * line-height below the baseline — overlapping it made both unreadable.
     *
     * The end of the campaign is said once, here, in its place.
     *
     * Clearing the three-hundredth maze used to drop the player back on the
     * level grid with no acknowledgement at all — the one moment in the game
     * that has genuinely been earned, and the game looked away. It reads as the
     * tagline's replacement rather than a modal, because a trophy screen would
     * be a bigger interruption than the achievement deserves.
     */
    const finished = this.registry.get('campaignComplete') === true;
    if (finished) this.registry.remove('campaignComplete');

    // Held on the scene so `flash` can borrow the slot and put it back.
    this.taglineText = finished
      ? 'all 300 folded. the daily is still yours.'
      : 'one line. two answers.';
    this.taglineAlpha = finished ? 0.62 : 0.42;

    const tagline = label(this, cx, pt(295), this.taglineText, {
      size: TYPE.body,
      alpha: this.taglineAlpha,
      font: FONT.display,
    }).setOrigin(0.5, 0);
    this.tagline = tagline;

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
        // Re-derived at the tap, never the captured `today` above: a phone left
        // on this screen overnight would otherwise open yesterday's fold and
        // write the result under yesterday's date.
        this.scene.start('Game', { daily: todayISO() });
      },
    });

    this.watchForRollover(today);

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
        /*
         * The menu says what the purchase GIVES, not only what it removes.
         *
         * "Remove ads · $2.99" on its own left the unlimited reveals — half of
         * what is being sold, and the half the out-of-reveals sheet is about —
         * invisible from the one screen a player browses. Measured at 494px in
         * a 638px column, so it fits on the line rather than needing a second
         * one the stack has no room for.
         *
         * The name stays "Remove ads" in both places and in App Store Connect:
         * one product under two names at one price reads as two products, and
         * the player would find out which at the system payment dialog.
         */
        button(this, cx, place(pt(40)), `Remove ads · unlimited reveals${price}`, {
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

    /*
     * Settings sits OUTSIDE the vertical stack, top-right.
     *
     * The stack's geometry is derived from its row count and already runs to
     * within a few pixels of the banner line when there is a purchase to offer
     * — a sixth row is what put "Restore purchases" half off the canvas once
     * before. A corner control costs the stack nothing and is where a settings
     * control is looked for anyway.
     */
    /*
     * pt(52), the same height as the back chevron on Levels — the two are the
     * same slot seen on different screens, and this one sat 12pt below it.
     * With nothing else in the row to align against, that difference reads as
     * the control having slipped down the page, which is how it was reported.
     *
     * It cannot go much higher. At pt(52) the pt(44)-tall hit box starts at
     * base y 60; on a 9:16 phone FIT leaves no letterbox at all, so the canvas
     * top IS the screen top and the status bar is the next thing up.
     */
    entering.push(
      button(this, BASE_WIDTH - METRICS.inset.left - pt(30), pt(52), '•••', {
        width: pt(52),
        height: pt(44),
        variant: 'ghost',
        size: TYPE.body,
        onPress: () => this.openSettings(),
      })
    );

    enter(this, entering);

    // The banner lives here and on level select. Never over the playfield.
    void Ads.showBanner();
  }

  /* ------------------------------------------------------------- settings */

  /**
   * Sound, haptics and reduced motion.
   *
   * All three services had a `setEnabled` and no caller, so every one of them
   * was permanently on — including for players who need them not to be. The
   * sheet is deliberately three rows and nothing else: anything the game can
   * decide for the player, it already has.
   */
  private openSettings(): void {
    if (this.settingsSheet) return;
    Haptics.tap();

    const t = theme();
    const cx = BASE_WIDTH / 2;
    const w = COLUMN;
    const rowH = pt(46);
    // Three toggles, then the rating row, then the capability line.
    const h = pt(58) + rowH * 4 + pt(30);

    const sheet = this.add.container(cx, BASE_HEIGHT / 2).setDepth(60);
    this.settingsSheet = sheet;

    const scrim = this.add
      .rectangle(0, 0, BASE_WIDTH * 2, BASE_HEIGHT * 2, t.ink, 0.32)
      .setInteractive();
    scrim.on('pointerdown', () => this.closeSettings());

    const card = this.add.graphics();
    softShadow(card, -w / 2, -h / 2, w, h, RADIUS.md, 1);
    card.fillStyle(t.paper, 1);
    roundRect(card, -w / 2, -h / 2, w, h, RADIUS.md);

    sheet.add([scrim, card]);
    sheet.add(
      label(this, 0, -h / 2 + pt(26), 'Settings', {
        size: TYPE.heading,
        font: FONT.ui,
      }).setOrigin(0.5)
    );

    /*
     * What this device can encode, at the foot of the sheet.
     *
     * v/a/m are VideoEncoder, AudioEncoder, MediaRecorder — the three that
     * decide whether the replay is a video with sound, a silent video, or not
     * offered at all. It reads as noise to a player and is invisible unless
     * they open Settings, which is the right price for never again having to
     * infer from a screenshot whether a button is missing or a build is old.
     */
    const cap = Progress.data.capability;
    if (cap) {
      sheet.add(
        label(this, 0, h / 2 - pt(12), `replay ${cap}`, {
          size: TYPE.micro,
          alpha: 0.28,
        }).setOrigin(0.5)
      );
    }

    const rows: [string, keyof SaveData, (v: boolean) => void][] = [
      ['Sound', 'sound', (v) => Audio.setEnabled(v)],
      ['Haptics', 'haptics', (v) => Haptics.setEnabled(v)],
      ['Reduced motion', 'reducedMotion', (v) => setMotionScale(v)],
    ];

    rows.forEach(([text, key, apply], i) => {
      const y = -h / 2 + pt(58) + rowH * i + rowH / 2;
      sheet.add(this.buildToggleRow(y, w, rowH, text, key, apply));
    });

    /*
     * "Rate this game", where someone who wants to say something will look for
     * it. Not on the menu itself: the home screen is one primary action and the
     * things a returning player needs, and a rating ask is neither.
     *
     * It opens the App Store review page rather than the OS prompt — see
     * `Rate.openStoreListing`. A deliberate tap has to do something visible,
     * and the native prompt is throttled to a few a year and may show nothing.
     */
    sheet.add(
      button(this, 0, -h / 2 + pt(58) + rowH * rows.length + rowH / 2, 'Rate this game', {
        width: w - pt(40),
        height: pt(38),
        variant: 'secondary',
        size: TYPE.label,
        onPress: () => {
          Haptics.tap();
          void Rate.openStoreListing();
        },
      })
    );

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.closeSettings());
  }

  private buildToggleRow(
    y: number,
    w: number,
    h: number,
    text: string,
    key: keyof SaveData,
    apply: (v: boolean) => void
  ): Phaser.GameObjects.Container {
    const t = theme();
    const row = this.add.container(0, y);
    const pad = pt(18);

    const name = label(this, -w / 2 + pad, 0, text, { size: TYPE.body, alpha: 0.9 })
      .setOrigin(0, 0.5);

    const state = label(this, w / 2 - pad, 0, '', { size: TYPE.body, alpha: 0.55 })
      .setOrigin(1, 0.5);

    const paint = (): void => {
      const on = Progress.data[key] === true;
      state.setText(on ? 'on' : 'off').setAlpha(on ? 0.75 : 0.35);
    };
    paint();

    row.add([name, state]);
    row.setSize(w, h);
    tappable(row, w, h);
    row.on('pointerdown', () => {
      const next = Progress.data[key] !== true;
      Progress.update({ [key]: next } as Partial<SaveData>);
      apply(next);
      // Feedback for the haptics row has to fire on the way OUT, or turning it
      // off would still buzz. Audio.setEnabled has already applied by here.
      Haptics.tap();
      paint();
    });

    // A hairline between rows, not around them: three boxed cards for three
    // switches is more chrome than the content.
    const line = this.add.graphics();
    line.fillStyle(t.ink, 0.07);
    line.fillRect(-w / 2 + pad, h / 2 - 1, w - pad * 2, 1);
    row.add(line);

    return row;
  }

  private closeSettings(): void {
    this.settingsSheet?.destroy(true);
    this.settingsSheet = null;
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
    // Out of 100, for the same reason the win line now says so: a bare rating
    // makes the reader guess the scale, and the two places it appears must not
    // disagree about what the number is.
    if (sense > 0) bits.push(`Fold Sense ${sense}/100`);
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

  /**
   * Rebuild the menu when the calendar day changes underneath it.
   *
   * The daily row is rendered once in `create()`, and a Phaser scene is not
   * re-created when the app comes back from the background. A phone left on
   * this screen overnight therefore kept showing yesterday's "solved · 4 day
   * streak" against today's unsolved fold — and the free reveal top-up, which
   * is also keyed to the day, never ran.
   */
  private watchForRollover(builtFor: string): void {
    const check = (): void => {
      if (document.visibilityState !== 'visible') return;
      if (todayISO() === builtFor) return;
      Progress.applyDailyTopUp();
      this.scene.restart();
    };
    document.addEventListener('visibilitychange', check);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      document.removeEventListener('visibilitychange', check);
    });
  }

  private open(index: number): void {
    Haptics.tap();
    // The banner stays up through gameplay now, so it is never torn down and
    // rebuilt on a scene change — a banner that disappears and reappears is
    // worse than one that is simply always there.
    this.scene.start('Game', { levelIndex: index });
  }

  private async purchase(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    Haptics.tap();
    try {
      // applyEntitlement is the choke point: it persists the entitlement AND
      // tells the ad layer, so neither can be forgotten here.
      const owned = await Iap.buyRemoveAds();
      if (!owned) {
        this.flash("the purchase didn't go through");
        return;
      }
      applyEntitlement(true);
      this.scene.restart();
    } finally {
      this.busy = false;
    }
  }

  private async restore(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    Haptics.tap();
    try {
      const result = await Iap.restore();
      applyEntitlement(result);
      /*
       * Every outcome says something. This used to branch only on `true`, so
       * both "you own nothing on this Apple Account" and "the store did not
       * answer" fell off the end in silence — and a tester tapping a button
       * that never responds reports it as broken, which is exactly right.
       */
      if (result === true) {
        this.scene.restart();
        return;
      }
      this.flash(
        result === false
          ? 'nothing to restore on this Apple Account'
          : "couldn't reach the App Store — try again in a moment"
      );
    } finally {
      this.busy = false;
    }
  }

  /**
   * Say something, in the tagline's slot.
   *
   * The menu had no way to say anything at all, which is why the store was
   * silent on every path that was not a clean success. The first version of
   * this put the line low on the screen instead — and there is no room down
   * there. When the store is selling, the stack runs to `pt(593)` and the
   * playfield floor is `pt(595)`: a two-pixel gap. So "the purchase didn't go
   * through" was drawn straight across the bottom of the Remove ads button it
   * was talking about, which is what the TestFlight screenshot showed.
   *
   * The tagline is the only line on this screen with guaranteed clear space
   * around it, it is already the slot the menu speaks from (finishing all 300
   * replaces it), and a message where the eye is already resting beats one
   * squeezed under the fold.
   */
  private flash(message: string): void {
    const line = this.tagline;
    if (!line) return;

    this.flashTimer?.remove();
    this.tweens.killTweensOf(line);
    line.setText(message).setAlpha(0.75);

    this.flashTimer = this.time.delayedCall(ms(2600), () => {
      this.flashTimer = null;
      // Guard the scene, not just the object: `restore()` can restart the scene
      // out from under a pending timer on a later tap.
      if (!line.scene) return;
      this.tweens.add({
        targets: line,
        alpha: 0,
        duration: ms(200),
        onComplete: () => {
          if (!line.scene) return;
          line.setText(this.taglineText);
          this.tweens.add({ targets: line, alpha: this.taglineAlpha, duration: ms(260) });
        },
      });
    });
  }
}
