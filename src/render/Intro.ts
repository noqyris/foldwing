/**
 * The launch film.
 *
 * This is NOT the iOS launch screen — that is still the static image in
 * LaunchScreen.storyboard, and it has to stay, because it is what covers the
 * gap before any JavaScript exists at all. This plays straight after it.
 *
 * The film is a studio sting on BLACK, so the ground here is black too: the
 * overlay is what the eye sees at the edges and during the fade, and paper
 * behind a black film would rim it in cream. Note the launch image is still
 * light, so the opening currently reads light → black → light. Making
 * LaunchScreen black would close that seam, but it changes the very first
 * thing anyone sees, so it is a decision rather than a tidy-up.
 *
 * Everything here is built around one rule: the film may never be the reason
 * somebody cannot play. It sits ON TOP of a game that is already booting, it
 * can be dismissed by touching it, and every failure path — no file, decode
 * error, autoplay refused, a device that ignores `ended` — removes it
 * immediately rather than leaving a player staring at a still frame.
 *
 * THE ASSET. public/intro.mp4 is derived from assets/splashscreen-9-16.mp4,
 * which is the master and is kept because it cannot be reconstructed:
 *
 *   ffmpeg -i assets/splashscreen-9-16.mp4 -vf scale=1290:-2 \
 *     -c:v libx264 -profile:v high -level 4.0 -pix_fmt yuv420p \
 *     -crf 24 -preset slow -c:a aac -b:a 96k -ac 2 \
 *     -movflags +faststart public/intro.mp4
 *
 * The master is 2192x3824, a screen no phone has, and 4.5MB of bundle; the
 * shipped file is 689KB with its audio intact. `+faststart` matters more than
 * the size does — without it the moov atom sits at the end and the first frame
 * waits for the whole download.
 *
 * IT PLAYS WITH SOUND IN THE APP, AND ONLY THERE. Safari will not autoplay
 * audio without a gesture and there is no gesture at launch — but this does not
 * ship in Safari. Capacitor builds its WKWebView with
 * `mediaTypesRequiringUserActionForPlayback = []`, so inside the app nothing
 * requires one and the sting is heard as it was made. The web Daily gets the
 * same film muted, because there the rule does apply, and a rejected `play()`
 * is retried muted rather than costing anyone the film.
 *
 * The Sound switch still governs it: BootScene reads the save and calls
 * `setIntroSound`, which lands within the first frames. A player who turned the
 * game's sound off did not ask to be sung at on the way in.
 */

/** Hard ceiling. The asset is ~5.2s; anything past this is a stuck decoder. */
const SAFETY_MS = 7000;
/** Long enough not to nag, short enough to be found before boredom sets in. */
const HINT_AFTER_MS = 1400;
const FADE_MS = 280;
/**
 * The overlay stays in the DOM, invisible and still swallowing input, for this
 * long after it has faded.
 *
 * The skip tap must not also press whatever is under it. The menu behind is
 * live from the first frame and its buttons sit dead centre, which is exactly
 * where a thumb goes for "tap anywhere". Holding the shield past the fade
 * covers the whole gesture — pointerup and the synthetic click arrive after
 * pointerdown, and Phaser listens on the window for release events, so simply
 * removing the element on pointerdown would hand the tail of the same tap
 * straight to the game.
 */
const SHIELD_MS = 320;

/**
 * The film currently on screen, so the Sound setting can reach it.
 *
 * The film starts before the save has been read — that is the point of it, it
 * covers the read — so the setting arrives a moment later and mutes it then.
 */
let live: HTMLVideoElement | null = null;

/** Whether this platform will autoplay audio at all. See the header. */
const canAutoplaySound = (): boolean =>
  Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor?.isNativePlatform?.());

/**
 * Apply the player's Sound setting to a film that is already running.
 *
 * Called by BootScene the instant the save resolves. Silent about a film that
 * has already finished, which is the common case on a warm start.
 */
export function setIntroSound(on: boolean): void {
  if (!live) return;
  live.muted = !on || !canAutoplaySound();
}

/**
 * Play the opening film, then resolve.
 *
 * Resolves as soon as the overlay is gone, whether that took five seconds or
 * none, so a caller can simply `void playIntro()` and let the game come up
 * underneath.
 *
 * The default src is resolved against `document.baseURI` rather than written
 * as `/intro.mp4`. Vite builds this app with `base: './'` so it can run from
 * the Capacitor shell, where a leading slash points at the device root and
 * finds nothing — the film would silently never load on the very platform it
 * ships to, while working perfectly in the browser.
 */
export function playIntro(src = new URL('intro.mp4', document.baseURI).href): Promise<void> {
  // Someone who has asked the system for less motion is not asking for a
  // five-second camera move. Skip straight to the game.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const layer = document.createElement('div');
    layer.setAttribute('data-intro', '');
    Object.assign(layer.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '9999',
      background: '#000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: `opacity ${FADE_MS}ms ease`,
      // The game is live behind this from the first frame; swallow taps meant
      // for the film so the first one cannot also land on the menu.
      touchAction: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    const video = document.createElement('video');
    video.src = src;
    // Sound in the app, silence on the web — see the header. `defaultMuted`
    // sets the ATTRIBUTE, which is what a browser consults when it decides
    // whether an autoplay is allowed; the property alone is checked too late.
    const wantSound = canAutoplaySound();
    video.muted = !wantSound;
    video.defaultMuted = !wantSound;
    if (!wantSound) video.setAttribute('muted', '');
    video.autoplay = true;
    video.playsInline = true;
    // `playsinline` as an ATTRIBUTE too: older WKWebView reads the attribute,
    // not the property, and without it iOS takes the video fullscreen.
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.preload = 'auto';
    live = video;
    Object.assign(video.style, {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    const hint = document.createElement('div');
    hint.textContent = 'tap to skip';
    Object.assign(hint.style, {
      position: 'absolute',
      bottom: 'calc(env(safe-area-inset-bottom, 0px) + 28px)',
      left: '0',
      right: '0',
      textAlign: 'center',
      font: '500 13px/1 -apple-system, system-ui, sans-serif',
      letterSpacing: '0.08em',
      color: 'rgba(255,255,255,0.72)',
      textShadow: '0 1px 3px rgba(0,0,0,0.45)',
      opacity: '0',
      transition: 'opacity 400ms ease',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    layer.append(video, hint);
    document.body.append(layer);

    let done = false;
    const timers: number[] = [];

    const finish = (): void => {
      if (done) return;
      done = true;
      if (live === video) live = null;
      timers.forEach(clearTimeout);
      // Stop the decoder before detaching; a playing video removed from the
      // DOM keeps its buffer alive on iOS.
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {
        /* the element is going away regardless */
      }
      layer.style.opacity = '0';
      // Gone to the eye at FADE_MS, gone to the finger at SHIELD_MS. The
      // caller is told the moment it stops being visible, so the banner and
      // anything else waiting on the film are not held up by the shield.
      timers.push(window.setTimeout(resolve, FADE_MS));
      timers.push(window.setTimeout(() => layer.remove(), FADE_MS + SHIELD_MS));
    };

    // Capture phase, and swallow the event whole: the layer is on top, but
    // Phaser also binds release events to the window, where bubbling would
    // still reach it.
    const swallow = (e: Event): void => {
      e.preventDefault();
      e.stopPropagation();
    };
    for (const type of ['pointerup', 'pointercancel', 'click', 'touchend']) {
      layer.addEventListener(type, swallow, { capture: true });
    }
    layer.addEventListener(
      'pointerdown',
      (e) => {
        swallow(e);
        finish();
      },
      { capture: true }
    );
    video.addEventListener('ended', finish);
    video.addEventListener('error', finish);
    // A decoder that never produces a frame is indistinguishable from a hang.
    timers.push(window.setTimeout(finish, SAFETY_MS));
    timers.push(
      window.setTimeout(() => {
        hint.style.opacity = '1';
      }, HINT_AFTER_MS)
    );

    /*
     * `play()` rejects when autoplay is blocked.
     *
     * Retry MUTED before giving up: an unmuted film is the thing a browser
     * refuses, and losing the sound is a far smaller loss than losing the
     * opening. Only if the muted attempt fails too is there nothing to recover
     * to, and then the overlay goes rather than leaving a frozen first frame
     * the player has to work out how to dismiss.
     */
    void video.play().catch(() => {
      video.muted = true;
      video.setAttribute('muted', '');
      void video.play().catch(finish);
    });
  });
}
