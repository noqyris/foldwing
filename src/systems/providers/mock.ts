import { ADS_MARKER, type AdFormat, type AdProvider, type DismissReason, type DismissWatcher } from '../adProvider';

/**
 * The FAKE ad network — the build you test ads on.
 *
 * Why it exists: LevelPlay has no test inventory. AdMob shipped demo ad units
 * that were explicitly safe to click; LevelPlay ships nothing of the kind. Its
 * `isTesting` flag only unlocks the Test Suite, the Test Suite serves live ads
 * for every non-bidding line, and a dashboard-pinned device still receives
 * real ads. There is no way to make the real network serve an ad that is safe
 * to look at, let alone tap.
 *
 * So we draw our own. Everything below renders in the DOM, over the canvas, in
 * the same places a native banner and a native full-screen ad occupy — and
 * touches no network at all. Zero impressions, zero billing, zero risk, and
 * every surface is safe to tap as hard as you like.
 *
 * What it is FOR: proving OUR code is right — that the banner is held off the
 * opening film and sits in the strip `METRICS.bannerReserve` keeps clear, that
 * the interstitial honours the cadence and the session ladder, that a rewarded
 * ad watched to the end grants a reveal and one closed early does not, that the
 * Phaser loop pauses and the music stops and both come back. All of that is our
 * logic and none of it needs a real advertiser.
 *
 * What it is NOT for: proving the real waterfall fills. Only LevelPlay's
 * reports can say that, from real players. Two different questions — do not
 * let a green mock run stand in for the one it cannot answer.
 *
 * Every surface is deliberately ugly and says FAKE AD in large letters: a mock
 * build must be unmistakable at a glance, so nobody ever wonders which build is
 * on the phone in their hand. The release gates refuse this bundle for every
 * store target anyway (`scripts/check-ad-mode.mjs`), but the gates protect the
 * store — the lettering protects the human.
 */

/** The native banner is a fixed 320x50 view (providers/levelplay.ts), so this is 50 CSS px too. */
const BANNER_H = 50;
/** How long a fake rewarded runs before it may be closed with the reward. */
const REWARD_SECONDS = 5;
/**
 * Fake network latency, so nothing in the policy layer is tested at zero delay
 * — except the interstitial's load, which by contract has none (see below).
 */
const LOAD_MS = 250;

const Z = 2147483000;
const BANNER_TEXT = 'FAKE BANNER AD — mock build, tap freely';

let bannerEl: HTMLElement | null = null;
let bannerHidden = false;

/** Resolvers for the dismissal watchers, by format. */
const dismissWaiters: Partial<Record<AdFormat, Array<() => void>>> = {};

function fireDismissed(format: AdFormat): void {
  const waiting = dismissWaiters[format];
  dismissWaiters[format] = [];
  waiting?.forEach((r) => r());
}

const wait = (ms: number): Promise<void> => new Promise<void>((r) => setTimeout(r, ms));

function styleOn(el: HTMLElement, css: Record<string, string>): void {
  for (const [k, v] of Object.entries(css)) el.style.setProperty(k, v);
}

/**
 * Keep a fake surface's touches to itself, as a native ad view does.
 *
 * Phaser listens for touches and mouse buttons on the WINDOW as well as on the
 * canvas, and hit-tests whatever lands there against the game objects under the
 * same point. So a tap on the fake banner closed the Settings sheet behind it,
 * and the fake rewarded ad's Close button pressed the skip pill it happens to
 * sit over. A real LevelPlay view never hands its touches to the web view, and
 * a mock that does proves nothing about the build it stands in for.
 *
 * Stopped as they bubble out of the surface, so the surface's own controls
 * still get them; and never prevented, or the click the controls listen for
 * would not be synthesised.
 *
 * Only presses that BEGAN on the surface, though — exactly what a native view
 * owns. A mouse pressed on the canvas and released over the fake banner is the
 * game's release: swallowing it left the stroke drawing with no button held.
 */
function keepTouches(el: HTMLElement): void {
  const families: Array<[string, string[]]> = [
    ['touchstart', ['touchend', 'touchcancel']],
    ['mousedown', ['mouseup']],
    ['pointerdown', ['pointerup', 'pointercancel']],
  ];
  for (const [down, ups] of families) {
    let pressedHere = false;
    el.addEventListener(down, (e) => {
      pressedHere = true;
      e.stopPropagation();
    });
    for (const up of ups) {
      el.addEventListener(up, (e) => {
        if (!pressedHere) return;
        pressedHere = false;
        e.stopPropagation();
      });
    }
  }
}

// ── banner ───────────────────────────────────────────────────────────────────

function makeBanner(): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-foldwing-mock', 'banner');
  styleOn(el, {
    position: 'fixed',
    // Where the plugin anchors the real one: the safe-area bottom, not the
    // screen edge, horizontally centred IN THE SAFE AREA (safeAreaLayoutGuide
    // .centerXAnchor) at its fixed width. Centring on the screen is the same
    // thing only while the left and right insets are equal — never on iPhone
    // Duo, where one side carries an 84pt status bar.
    left: 'calc(env(safe-area-inset-left, 0px) + (100vw - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)) / 2)',
    transform: 'translateX(-50%)',
    bottom: 'env(safe-area-inset-bottom, 0px)',
    width: 'min(320px, calc(100vw - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)))',
    height: `${BANNER_H}px`,
    'box-sizing': 'border-box',
    'z-index': String(Z),
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
    padding: '0 8px',
    background: 'repeating-linear-gradient(45deg,#2b2f3a,#2b2f3a 12px,#242833 12px,#242833 24px)',
    'border-top': '2px solid #ff5a5a',
    color: '#ffd6d1',
    font: '700 12px/1.2 ui-sans-serif, system-ui, sans-serif',
    'letter-spacing': '.04em',
    'text-align': 'center',
    'user-select': 'none',
    '-webkit-user-select': 'none',
  });
  el.textContent = BANNER_TEXT;
  keepTouches(el);
  // Tapping is the whole point: it must be provably harmless here.
  el.addEventListener('click', () => {
    el.textContent = 'tapped — nothing happened, which is the point';
    setTimeout(() => {
      el.textContent = BANNER_TEXT;
    }, 1400);
  });
  return el;
}

// ── full-screen formats ──────────────────────────────────────────────────────

/**
 * Show a fake full-screen ad. Resolves with TRUE when the player sat through it
 * (or closed an interstitial, which has nothing to sit through), FALSE when they
 * left a rewarded early. `onPresented` fires the moment it is on screen, which is
 * what `resolvesOnPresent` promises the policy layer for interstitials.
 */
function showFullScreen(format: AdFormat, opts: { countdown: number }, onPresented: () => void): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const root = document.createElement('div');
    root.setAttribute('data-foldwing-mock', format);
    styleOn(root, {
      position: 'fixed',
      inset: '0',
      // A real full-screen ad covers everything, and so does this one — but its
      // controls must stay reachable, so the padding keeps them out of the
      // notch and the home indicator.
      'padding-top': 'calc(24px + env(safe-area-inset-top, 0px))',
      'padding-bottom': 'calc(24px + env(safe-area-inset-bottom, 0px))',
      'padding-left': 'calc(24px + env(safe-area-inset-left, 0px))',
      'padding-right': 'calc(24px + env(safe-area-inset-right, 0px))',
      'box-sizing': 'border-box',
      'z-index': String(Z + 1),
      background: '#11141c',
      display: 'flex',
      'flex-direction': 'column',
      'align-items': 'center',
      'justify-content': 'center',
      gap: '18px',
      color: '#e8eaf0',
      font: '600 15px/1.5 ui-sans-serif, system-ui, sans-serif',
      'text-align': 'center',
      'user-select': 'none',
      '-webkit-user-select': 'none',
      // index.html sets touch-action: none on the page for the canvas; the fake
      // ad's own button has to stay tappable regardless.
      'touch-action': 'manipulation',
    });

    const title = document.createElement('div');
    styleOn(title, { font: '800 26px/1.15 ui-sans-serif, system-ui, sans-serif', color: '#ff5a5a', 'letter-spacing': '.04em' });
    title.textContent = format === 'rewarded' ? 'FAKE REWARDED AD' : 'FAKE INTERSTITIAL AD';

    const body = document.createElement('div');
    styleOn(body, { color: '#9aa2b0', 'max-width': '30rem' });
    body.textContent =
      format === 'rewarded'
        ? 'Not a real ad. No network was called and nothing is billed. Watch to the end and the reward arrives; close it early to check that it does NOT.'
        : 'Not a real ad. No network was called and nothing is billed.';

    const tapzone = document.createElement('div');
    styleOn(tapzone, {
      width: 'min(70vw, 260px)',
      height: 'min(28vh, 180px)',
      border: '2px dashed #3a4152',
      'border-radius': '14px',
      display: 'grid',
      'place-items': 'center',
      color: '#6b7484',
      font: '700 13px/1.3 ui-sans-serif, system-ui, sans-serif',
    });
    tapzone.textContent = 'tap me — it is safe';
    tapzone.addEventListener('click', () => {
      tapzone.textContent = 'nothing happened ✓';
    });

    const btn = document.createElement('button');
    styleOn(btn, {
      appearance: 'none',
      border: '0',
      'border-radius': '999px',
      padding: '12px 26px',
      font: '800 15px/1 ui-sans-serif, system-ui, sans-serif',
      cursor: 'pointer',
      background: '#2a3140',
      color: '#6b7484',
    });

    root.append(title, body, tapzone, btn);
    keepTouches(root);
    document.body.appendChild(root);
    onPresented();

    let left = opts.countdown;
    let earned = left === 0;
    let timer = 0;

    const close = (): void => {
      window.clearInterval(timer);
      root.remove();
      fireDismissed(format);
      resolve(earned);
    };

    const paint = (): void => {
      if (left > 0) {
        btn.textContent = `Skip (${left})`;
        btn.style.setProperty('background', '#2a3140');
        btn.style.setProperty('color', '#6b7484');
      } else {
        // An interstitial has nothing to award, so it must not offer one:
        // `earned` is true the moment the countdown is zero, and an
        // interstitial starts at zero.
        btn.textContent = format === 'rewarded' && earned ? 'Close and take the reward' : 'Close';
        btn.style.setProperty('background', '#ffc940');
        btn.style.setProperty('color', '#11141c');
      }
    };
    paint();
    btn.addEventListener('click', close);

    if (left > 0) {
      timer = window.setInterval(() => {
        left -= 1;
        if (left <= 0) {
          window.clearInterval(timer);
          left = 0;
          earned = true;
        }
        paint();
      }, 1000);
    }
  });
}

// ── the provider ─────────────────────────────────────────────────────────────

export const mockProvider: AdProvider = {
  // ADMODE stays `test` — a mock build is never a store build, and the gate
  // reads ADS:mock to tell it apart from every other bundle.
  id: `mock ADMODE:test ${ADS_MARKER}`,
  // FALSE, exactly as on LevelPlay. `testing` means "this build serves the
  // NETWORK's test inventory", and there is no network here at all.
  testing: false,

  supports: (format: AdFormat) => format === 'banner' || format === 'interstitial' || format === 'rewarded',

  async init() {
    await wait(LOAD_MS);
  },
  // Nothing to start and nothing to fail: the fake network is always up.
  sdkReady: () => true,

  async bannerShow() {
    await wait(LOAD_MS);
    if (!bannerEl) {
      bannerEl = makeBanner();
      document.body.appendChild(bannerEl);
    }
    bannerHidden = false;
    bannerEl.style.setProperty('display', 'flex');
  },
  async bannerResume() {
    if (bannerEl && bannerHidden) {
      bannerHidden = false;
      bannerEl.style.setProperty('display', 'flex');
    }
  },
  async bannerHide() {
    if (bannerEl) {
      bannerHidden = true;
      bannerEl.style.setProperty('display', 'none');
    }
  },
  async bannerRemove() {
    bannerEl?.remove();
    bannerEl = null;
    bannerHidden = false;
  },

  /*
   * At once, with no fake latency — the one load that must not have any. The
   * contract (AdProvider.loadInterstitial) is "answer NOW": LevelPlay answers
   * from a cache it filled ahead of the break. A mock that waited here opened a
   * window in which the player started the next stroke, and then drew the
   * interstitial over it — a bug of the mock's own making that the build it
   * stands in for does not have, and that hid the one it might.
   */
  async loadInterstitial() {
    return true;
  },
  showInterstitial() {
    // Resolves on PRESENT, like LevelPlay's — the wait for the player to be done
    // is watchDismissal's job, and conflating the two freezes the game.
    return new Promise<boolean>((resolve) => {
      void showFullScreen('interstitial', { countdown: 0 }, () => resolve(true));
    });
  },

  async loadRewarded() {
    await wait(LOAD_MS);
    return true;
  },
  async showRewarded() {
    const earned = await showFullScreen('rewarded', { countdown: REWARD_SECONDS }, () => {});
    return earned ? { type: 'mock', amount: 1 } : null;
  },
  rewardedReady: () => true,

  resolvesOnPresent: (format: AdFormat) => format === 'interstitial',

  watchDismissal(format: AdFormat, timeoutMs: number): DismissWatcher {
    let why: DismissReason | null = null;
    let timer = 0;
    let settle: (reason: DismissReason) => void = () => {};
    let waiter: (() => void) | null = null;
    const done = new Promise<void>((resolve) => {
      settle = (reason) => {
        if (why) return;
        why = reason;
        window.clearTimeout(timer);
        const list = dismissWaiters[format];
        if (list && waiter) dismissWaiters[format] = list.filter((r) => r !== waiter);
        resolve();
      };
      waiter = () => settle('closed');
      (dismissWaiters[format] ??= []).push(waiter);
      timer = window.setTimeout(() => settle('timeout'), timeoutMs);
    });
    return { done, cancel: () => settle('cancelled'), reason: () => why };
  },
};
