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
 *   ffmpeg -i assets/splashscreen-9-16.mp4 -vf scale=1290:-2 -an \
 *     -c:v libx264 -profile:v high -level 4.0 -pix_fmt yuv420p \
 *     -crf 24 -preset slow -movflags +faststart public/intro.mp4
 *
 * The master is 2192x3824 with an audio track, which is 4.5MB of bundle for a
 * screen no phone has and a soundtrack that can never play; the shipped file
 * is 624KB. `+faststart` matters more than the size does — without it the moov
 * atom sits at the end and the first frame waits for the whole download.
 *
 * MUTED IS NOT A PREFERENCE. iOS refuses to autoplay video with sound without
 * a user gesture, and there is no gesture at launch, so an unmuted file would
 * simply never start. The shipped asset therefore has no audio track at all,
 * which is also most of why it is 624KB rather than 4.5MB.
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
    video.muted = true;
    video.defaultMuted = true;
    video.autoplay = true;
    video.playsInline = true;
    // `playsinline` as an ATTRIBUTE too: older WKWebView reads the attribute,
    // not the property, and without it iOS takes the video fullscreen.
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('muted', '');
    video.preload = 'auto';
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

    // `play()` rejects when autoplay is blocked. There is nothing to recover
    // to at launch, so treat it as "no film" rather than showing a frozen
    // first frame the player has to work out how to dismiss.
    void video.play().catch(finish);
  });
}
