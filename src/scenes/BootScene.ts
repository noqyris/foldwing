/**
 * BootScene — the single entry point every launch passes through.
 *
 * There are no assets to preload: the whole game is vector primitives and
 * system type, which is why cold start is fast. What does happen here is the
 * work the first screen depends on — reading the save, and handing the ad
 * layer the entitlement it needs before anything may request an ad.
 *
 * It also lays the night down: the sky's own scene, under every other scene
 * for the rest of the session (render/Paper.ts), and the kit's first bakes,
 * while the film is still playing — so the first menu frame is not the frame
 * that pays for them. The launch mark index.html shows over the page leaves
 * on the first scene's first frame, which is what makes icon → launch screen
 * → web view → menu one continuous night.
 *
 * Only the save is awaited. Ads and purchases are optional; gameplay is not, so
 * they can never delay the menu. The ad SDK is NOT started here: this runs
 * while the opening film is still playing, and starting it asks for consent in
 * system dialogs that would land on top of the film. main.ts starts it once the
 * film is gone and `entitlementKnown` has resolved.
 */

import Phaser from 'phaser';
import { Ads } from '../systems/Ads';
import { Audio } from '../systems/Audio';
import { Music } from '../systems/Music';
import { todayISO } from '../systems/Daily';
import { Haptics } from '../systems/Haptics';
import { Iap } from '../systems/Iap';
import { Nudges } from '../systems/Nudges';
import { Progress } from '../systems/Progress';
import { WEB_DAILY } from '../systems/WebDaily';
import { iconTexture } from '../render/Icons';
import { setIntroSound } from '../render/Intro';
import { dropBootMark, installSky } from '../render/Paper';
import { softDiscTexture } from '../render/Baked';
import { dp, setMotionScale, theme, ui } from '../render/Theme';
import { GLYPH_SIZE } from '../render/UI';

let markEntitlementKnown: () => void = () => {};

/**
 * Whether Boot has picked the first scene. Until it has, a reminder tap is
 * Boot's to route (it reads Nudges.takeRoute() once the save is in); after,
 * main.ts routes it as a warm tap.
 */
let routed = false;
export const bootRouted = (): boolean => routed;

/**
 * Resolves once the save is read and `Ads.setAdsRemoved` has been told what it
 * says. main.ts waits on it before starting the ad SDK, so init can never run
 * ahead of the entitlement — an owner's first frame must not be the one where
 * the ad layer still believes they own nothing. Never resolves on the web
 * Daily, which has no ads to start.
 */
export const entitlementKnown = new Promise<void>((resolve) => {
  markEntitlementKnown = resolve;
});

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    // The sky shows through: Boot draws nothing of its own.
    this.cameras.main.setBackgroundColor('rgba(0,0,0,0)');
    installSky(this.game);
    warmKit(this);
    // Whatever becomes of the first scene, the launch mark never outstays it.
    window.setTimeout(dropBootMark, 12_000);

    // Bound before the read, and safe there: flush() writes nothing until
    // load() has finished, so a backgrounding mid-read cannot put the empty
    // placeholder save over the player's real one.
    Progress.installLifecycleFlush();
    void Progress.load().then((save) => {
      /*
       * What this device can actually do, recorded at boot — AFTER the load.
       *
       * `load()` replaces the whole state with what came off disk, so writing
       * this before it is writing into an object that is about to be thrown
       * away. It cost one round trip through the simulator to find, which is
       * the argument for the line existing at all: the replay button hides
       * itself when the encoder is missing, and from the outside that is
       * indistinguishable from being on an older build. Settings shows it.
       */
      const g = globalThis as unknown as Record<string, unknown>;
      Progress.update({
        capability: [
          `v${g.VideoEncoder ? 1 : 0}`,
          `a${g.AudioEncoder ? 1 : 0}`,
          `m${g.MediaRecorder ? 1 : 0}`,
        ].join(' '),
      });

      // Apply the player's settings before the first scene that could make a
      // sound or buzz. Both services defaulted to on and had no caller at all
      // until settings existed.
      // The film is already running; hand it the Sound setting the moment we
      // know it, so a muted player is not sung at on the way in.
      setIntroSound(save.sound);
      Audio.setEnabled(save.sound);
      Music.setEnabled(save.music);
      Haptics.setEnabled(save.haptics);
      setMotionScale(save.reducedMotion);

      // The web daily is the whole product on the web: no menu, no store,
      // straight into today's fold.
      if (WEB_DAILY) {
        this.scene.start('Game', { daily: todayISO() });
        leaveBootMark(this.game);
        return;
      }

      // Tell the ad layer about the entitlement BEFORE anything can request an
      // ad, so an owner never sees one flash up during the first frame.
      Ads.setAdsRemoved(save.adsRemoved);
      markEntitlementKnown();

      /*
       * A launch that came from a reminder tap opens today's fold, not the
       * menu the player would only have to cross to reach it. Read here, after
       * the save, because the route depends on it: a fold already played, or a
       * player still in the tutorial, gets the menu (NudgePlan.routeForTap).
       */
      routed = true;
      if (Nudges.takeRoute() === 'daily') this.scene.start('Game', { daily: todayISO() });
      else this.scene.start('Menu');
      leaveBootMark(this.game);

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

      /*
       * Whether the reminder permission was answered on an earlier launch. A
       * read, never a prompt: it only lets the one automatic review ask tell a
       * [Remind me] that can put the permission alert up from one that cannot
       * (Nudges.promptPending, Rate.shouldAsk).
       *
       * Then the reminders themselves, rebuilt for the player as this launch
       * finds them — a rebuild never prompts — and yesterday's taken out of
       * Notification Center, since opening the game has answered them.
       */
      void Nudges.warm().then(() => Nudges.rebuild());
      void Nudges.clearDelivered();
    });
  }
}

/**
 * Bake what the first screen draws, while the film plays: the pen-line marks
 * the top chips and the Reveal pill carry, in their colours, and the soft
 * discs the lamp and the nib use. Each is a few kilobytes; the Menu's first
 * frame then only draws.
 */
function warmKit(scene: Phaser.Scene): void {
  const t = theme();
  const u = ui();
  for (const name of ['eye', 'flame', 'bookmark'] as const) iconTexture(scene, name, t.accentText, GLYPH_SIZE * 0.95);
  iconTexture(scene, 'plus', u.onAccent, dp(15));
  softDiscTexture(scene, t.accent);
  softDiscTexture(scene, t.line);
}

/**
 * Take the launch mark off the page once the first scene has drawn — two
 * frames after it starts, so the canvas under the mark is the menu (or the
 * level) and never an empty sky. A short fade: the mark hands over rather
 * than blinks. Under the film it is already covered, and leaves unseen.
 */
function leaveBootMark(game: Phaser.Game): void {
  let frames = 0;
  const onFrame = (): void => {
    if (++frames < 2) return;
    game.events.off(Phaser.Core.Events.POST_RENDER, onFrame);
    if (typeof document === 'undefined') return;
    const mark = document.getElementById('boot-mark');
    if (!mark) return;
    mark.style.opacity = '0';
    window.setTimeout(dropBootMark, 260);
  };
  game.events.on(Phaser.Core.Events.POST_RENDER, onFrame);
}
