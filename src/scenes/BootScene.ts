/**
 * BootScene — the single entry point every launch passes through.
 *
 * There are no assets to preload: the whole game is vector primitives and
 * system type, which is why cold start is fast. What does happen here is the
 * work the first screen depends on — reading the save, and starting the ad and
 * store SDKs.
 *
 * Only the save is awaited. Ads and purchases are optional; gameplay is not, so
 * they warm up in the background and can never delay the menu.
 */

import Phaser from 'phaser';
import { Ads } from '../systems/Ads';
import { Audio } from '../systems/Audio';
import { todayISO } from '../systems/Daily';
import { Haptics } from '../systems/Haptics';
import { Iap } from '../systems/Iap';
import { Progress } from '../systems/Progress';
import { WEB_DAILY } from '../systems/WebDaily';
import { setMotionScale, theme } from '../render/Theme';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(theme().paper);

    Progress.installLifecycleFlush();
    void Progress.load().then((save) => {
      // Apply the player's settings before the first scene that could make a
      // sound or buzz. Both services defaulted to on and had no caller at all
      // until settings existed.
      Audio.setEnabled(save.sound);
      Haptics.setEnabled(save.haptics);
      setMotionScale(save.reducedMotion);

      // The web daily is the whole product on the web: no menu, no store,
      // straight into today's fold.
      if (WEB_DAILY) {
        this.scene.start('Game', { daily: todayISO() });
        return;
      }

      // Tell the ad layer about the entitlement BEFORE anything can request an
      // ad, so an owner never sees one flash up during the first frame.
      Ads.setAdsRemoved(save.adsRemoved);
      this.scene.start('Menu');

      void Ads.init();
      /*
       * No silent restore on launch, and no store contact at all until the
       * player asks for one.
       *
       * A restore reaches StoreKit, StoreKit needs an Apple Account, and on a
       * signed-out device it puts a "Sign in to Apple Account" dialog over the
       * app before the player has touched anything — which then REAPPEARS after
       * Cancel. Verified on a clean simulator: a repeating login wall on first
       * run of a free game, for a purchase nobody asked for. Apple's own
       * guidance says the same thing for the same reason: restoring is a
       * user-initiated action, never automatic.
       *
       * The cost is that a reinstalling owner sees ads until they tap "Restore
       * purchases", which is what that button is for and what every other app
       * does. `Iap.init()` is deliberately a no-op; the store opens on the
       * first purchase or restore.
       */
      void Iap.init();
    });
  }
}
