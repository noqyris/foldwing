/**
 * Intro — the Noqyris studio sting, from the portfolio's shared master.
 *
 * The clip, its markup, its styles and its teardown live ONCE, in
 * repository/shared/noqyris-splash, aliased as `@noqyris/splash` in
 * vite.config.ts and tsconfig.json — never copied (mobile-game-playbook). Until
 * 2026-09-27 Foldwing carried its own re-encode of the same five seconds in
 * public/intro.mp4 plus ~500 lines of its own player; a fix to the master never
 * reached it, and it had drifted into playing once per app version, so the
 * owner stopped seeing the brand at all. It now plays like every other app: on
 * each cold launch.
 *
 * What stays Foldwing's, as a thin layer over the shared call:
 *
 *   - NATIVE ONLY. In a browser (dev, QA, store screenshots, the web Daily) there
 *     is no sting — the page is the product there, as in Bee Free.
 *   - Reduced motion does NOT skip it (the owner's call, 2026-09-27): the other
 *     apps play the sting whatever that setting says, and here the in-app switch
 *     — seeded from the OS setting on a first launch — cut it off a second in,
 *     the moment the save was read. It is a short clip with a skip pill.
 *   - The Sound switch reaches the film too (BootScene → setIntroSound): the
 *     shared clip tries sound first, and a player who turned sound off was not
 *     asking to be sung at on the way in.
 *   - A reminder tap skips it (main.ts → skipIntro): somebody who tapped "today's
 *     fold is waiting" is not asking for the studio mark first.
 *   - The layer carries `data-intro`, the marker MenuScene waits on before it
 *     plays the logo draw-in and the day's gift, so neither happens unseen under
 *     the film.
 *
 * The shared splash resolves when its layer is GONE, which is when the ad layer
 * may ask for consent and show a banner (main.ts holds both until then).
 */
import { Capacitor } from '@capacitor/core';
import { markIntroDone, mountSplash } from '@noqyris/splash';
import { WEB_DAILY } from '../systems/WebDaily';

const LAYER_ID = 'noqyris-splash';
const VIDEO_ID = 'noqyris-splash-video';

/** Set by a reminder tap or the Reduced motion switch: no sting this launch. */
let skipped = false;
/** The player's Sound switch, once the save has been read; null before that. */
let soundOn: boolean | null = null;

const layer = (): HTMLElement | null => document.getElementById(LAYER_ID);
const video = (): HTMLVideoElement | null =>
  document.getElementById(VIDEO_ID) as HTMLVideoElement | null;

/**
 * End the sting on screen through its own path — the pointerdown it listens
 * for — so it leaves with its fade and its input shield, exactly as a tap on
 * it would. Nothing on screen: nothing to do.
 */
function dismissLive(): void {
  const el = layer();
  if (!el) return;
  try {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  } catch {
    // An engine without PointerEvent: a plain Event reaches the same listener.
    el.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
  }
}

/** Apply the Sound switch to a sting that is already playing. */
export function setIntroSound(on: boolean): void {
  soundOn = on;
  const v = video();
  if (v && !on) v.muted = true;
}

/** A reminder tap: the sting on screen leaves, one not started never starts. */
export function skipIntro(): void {
  skipped = true;
  dismissLive();
}

/**
 * Play the shared sting, then resolve once its layer is gone — at once where
 * there is nothing to play. Never rejects: the sting is decoration, and its
 * failure must not hold up the game or the ad layer behind it.
 */
export function playIntro(): Promise<void> {
  if (WEB_DAILY || !Capacitor.isNativePlatform() || skipped) {
    markIntroDone();
    return Promise.resolve();
  }
  try {
    const gone = mountSplash({ skipLabel: 'tap to skip' });
    layer()?.setAttribute('data-intro', '');
    // The save may already have said "sound off" (a warm relaunch reads fast).
    if (soundOn === false) {
      const v = video();
      if (v) v.muted = true;
    }
    return gone.then(markIntroDone, markIntroDone);
  } catch {
    markIntroDone();
    return Promise.resolve();
  }
}
