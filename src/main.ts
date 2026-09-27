import Phaser from 'phaser';
import { BootScene, bootRouted, entitlementKnown } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { LevelSelectScene } from './scenes/LevelSelectScene';
import { GalleryScene } from './scenes/GalleryScene';
import { GameScene } from './scenes/GameScene';
import { BASE_WIDTH, METRICS, setViewHeight, theme, viewHeight } from './render/Theme';
import {
  applySafeOverride,
  fitShape,
  parseSafeParam,
  safeAreaBox,
  safeAreaRect,
  wantsDesk,
  type GameShape,
} from './render/SafeArea';
import { renderShareCard } from './render/ShareCard';
import { playIntro, skipIntro } from './render/Intro';
import { Ads } from './systems/Ads';
import { Audio } from './systems/Audio';
import { todayISO } from './systems/Daily';
import { Nudges, PENDING_ROUTE } from './systems/Nudges';
import { Progress } from './systems/Progress';
import { registerGame } from './systems/gameLoop';
import { noteHidden, noteVisible, startColdSession } from './systems/SessionLifecycle';
import { WEB_DAILY } from './systems/WebDaily';

/*
 * DEV: `?safe=t,r,b,l` pretends the phone has those safe-area insets, in
 * points (render/SafeArea.ts). Before anything measures the page, so #app and
 * the game are built inside the pretend safe area from the first frame.
 * Tree-shaken out of every build.
 */
if (import.meta.env.DEV) {
  applySafeOverride(parseSafeParam(new URLSearchParams(location.search).get('safe')));
}

/*
 * A cold launch is always a session (core/Session). A return after 30 minutes
 * or more, or into a new local day, is one too — the visibility handler below
 * tells the lifecycle, and everything that keeps something per session (the
 * ad cap and warm-up, the review prompt's skip and purchase) hears it there.
 * A launch that begins in the background has, in effect, been away since boot.
 */
void startColdSession();
if (document.hidden) noteHidden();

/**
 * The longest the banner hold waits on the opening film. The film has its own
 * seven-second ceiling (the shared splash), so this is belt and braces for the
 * hold. It is NOT what lets the ad layer start: Ads.init() waits, inside, for
 * the starter gate (SessionLifecycle.whenAdLayerMayStart) — the film really
 * gone AND the app active — because this timer, like the film's own, can come
 * due in the background and fire on the return, before the app is active.
 */
const INTRO_FAILSAFE_MS = 9000;

/*
 * Start the opening film immediately, and do NOT await it. The game is built
 * behind it on the next line, so by the time the film ends the menu is already
 * there — the five seconds are spent loading rather than instead of loading.
 * It plays on the first launch of each day only, and never after a reminder
 * tap (render/Intro.ts); otherwise this resolves at once.
 *
 * The banner is held for the duration. It is a NATIVE view above the webview,
 * so nothing the page draws can cover it; without the hold it slides in over
 * the film. Scenes keep calling showBanner() as they always did — the want is
 * remembered and honoured the moment the film clears.
 *
 * The ad layer does not even START until the film is gone and the app is
 * active (Ads.init → SessionLifecycle.whenAdLayerMayStart). Starting it asks
 * for consent — iOS's tracking alert, then LevelPlay's consent modal — and both
 * are system dialogs, which would land on top of the film on a first launch,
 * and ATT asked while the app is still inactive shows nothing at all. It also
 * waits for the save: BootScene hands the ad layer the Remove Ads entitlement
 * before anything may request an ad, and init must not race it. Nothing is
 * lost by waiting — no interstitial can come before the session warm-up, which
 * is minutes, not seconds.
 *
 * The web Daily never starts it at all: there is no ad surface in a browser,
 * and the page is the whole product there.
 */
void (async () => {
  Ads.holdBanner();
  await Promise.race([
    playIntro(),
    new Promise<void>((resolve) => setTimeout(resolve, INTRO_FAILSAFE_MS)),
  ]);
  void Ads.releaseBanner();
  if (WEB_DAILY) return;
  await entitlementKnown;
  void Ads.init();
})();

/*
 * The session first. A hide stamps the pause (the FIRST hide of it counts); a
 * return after 30 minutes or more, or into a new local day, starts a new
 * session, and every per-session limit has been reset by the time noteVisible()
 * returns — before anything below can read one. A new session is not a new day:
 * the daily top-up, the streak guard and the day stamp below still go by the
 * calendar, once a day.
 *
 * Then every return to the foreground gives an ad SDK whose initialize() failed
 * at boot — no network in a tunnel, say — one more try, which is Unity's own
 * advice for a failed init. The provider owns the backoff and the
 * one-in-flight rule; this is only the trigger, and a no-op before init has run
 * and in any build without ads. The retry waits, inside, for the app to be
 * ACTIVE: this event fires on willEnterForeground, and the retry can re-ask ATT.
 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    noteHidden();
    return;
  }
  noteVisible();
  Ads.foregrounded();
  /*
   * And the free daily reveal, whatever scene the player comes back to.
   *
   * On iOS the app is usually RESUMED the next morning, not relaunched, so the
   * top-up in Progress.load() never runs, and the Menu's own rollover check
   * only fires while the Menu is up and only against the day it was built on.
   * A player who left the app in a level got no reveal at all that day and was
   * told "one more lands tomorrow" on the day it should have landed. The call
   * is idempotent per calendar day, so every return can make it.
   *
   * The streak guard for the same reason — a bookmark must be spent on the
   * morning after the missed day, not whenever the Menu next happens to be
   * built — and the session stamp that the reminder hour is learned from. All
   * three are no-ops until the save is read, and idempotent after.
   */
  Progress.applyDailyTopUp();
  Progress.applyStreakGuard();
  Progress.markSeen();
  /*
   * Then the reminders, rebuilt from where the player is now: the whole
   * schedule is counted from the latest open — every return, however short,
   * not only one that starts a new session (the plan is keyed to opens and
   * calendar days; sessions are SessionLifecycle's). Delivered
   * reminders go too — opening the game has answered them. Neither prompts.
   * iOS can deliver one return as two visibilitychanges, and a grant below
   * may ask in the same beat; rebuild() folds those into one write.
   */
  if (!WEB_DAILY) {
    void Nudges.rebuild();
    void Nudges.clearDelivered();
  }
});

/*
 * Whatever changes what a reminder may truthfully say, outside a foreground or
 * a Daily win: Remove Ads bought or restored (no more reveal copy), a repaired
 * streak, a bookmark earned. Never returns true — that would tell Progress the
 * grant was shown, and hide the daily gift from the Menu.
 */
Progress.onGrant((g) => {
  if (g.adsRemoved !== undefined || g.reason === 'repair' || g.bookmarks > 0) void Nudges.rebuild();
});

/*
 * A tap on a reminder. Registered here, at module scope and before the game
 * exists, because the plugin holds the tap that LAUNCHED the app only until a
 * listener appears — the earlier the listener, the surer a cold launch is to
 * find it.
 *
 * The film goes first, whatever else happens: somebody who tapped "today's
 * fold is waiting" does not sit through the studio sting. Then, on a cold
 * launch, nothing more — BootScene reads the route once the save is in. On a
 * warm one the route goes into the registry for the Menu's create to take
 * (Nudges.takePendingRoute), and a Menu with nothing open is restarted to take
 * it now. A level, a sheet or an ad keeps the screen: nothing is torn down
 * under the player's finger, and the Menu takes the route when it next opens.
 */
Nudges.installTapListener(() => {
  skipIntro();
  if (!bootRouted()) return;
  if (Nudges.takeRoute() !== 'daily') return;
  routeWarmTap();
});

/** A Menu restart is waiting for the end of the frame. */
let warmRestartQueued = false;

function routeWarmTap(): void {
  const scenes = game.scene;
  // Already on today's fold: nothing to route to, and nothing to leave behind.
  const level = scenes.getScene('Game') as (Phaser.Scene & { dailyDate?: unknown }) | null;
  if (level && scenes.isActive('Game') && level.dailyDate === todayISO()) return;
  game.registry.set(PENDING_ROUTE, 'daily');
  if (warmRestartQueued) return;
  /*
   * Never scene.start('Game') from here. A reminder is tapped on a later day
   * than the Menu was built on, so the same return from the background also
   * makes the Menu restart itself (MenuScene.watchForRollover), in no fixed
   * order with this tap. Phaser runs the queued operations in order, and a
   * start('Game') queued ahead of that restart ends with both scenes running.
   *
   * So the Menu's own create() routes, and this only restarts it — at the end
   * of the next step, after that step's queue has run: a rollover restart
   * already queued has taken the route by then, and nothing is restarted
   * twice. The loop is paused while the page is hidden, so a tap that beats
   * the page back to visible waits for the rollover too.
   *
   * The Menu says whether a sheet is open with a public `sheetOpen` boolean
   * (§1.8's single refit gate). Anything but an explicit false — including a
   * Menu that does not say — is treated as busy, and the route waits.
   */
  warmRestartQueued = true;
  game.events.once(Phaser.Core.Events.POST_STEP, () => {
    warmRestartQueued = false;
    if (game.registry.get(PENDING_ROUTE) === undefined) return;
    const menu = scenes.getScene('Menu') as (Phaser.Scene & { sheetOpen?: unknown }) | null;
    if (menu && scenes.isActive('Menu') && menu.sheetOpen === false && !Ads.busy) menu.scene.restart();
  });
}

/*
 * The first touch anywhere opens the audio context.
 *
 * iOS refuses to start audio outside a real user gesture, and it used to be
 * unlocked only by drawing — so the music, which is meant to be there from the
 * menu, could not begin until the player had already entered a level. Any
 * gesture will do, including the one that skips the opening film.
 */
document.addEventListener('pointerdown', () => Audio.unlock(), { once: true, capture: true });

/*
 * The world's shape, decided from the safe area before the game exists
 * (render/SafeArea.ts fitShape): how tall the logical canvas is, and how far
 * #app is lifted off the banner. The width is always 750; the height fills the
 * safe area on a tall phone (Theme.adaptiveHeight) — an iPhone 18 Pro is
 * 750×1451 — and stays 1334 on anything 9:16 or wider, which letterboxes
 * sideways as it always has. Every scene is built at this height from its
 * first frame; `relayout` below keeps it true afterwards.
 *
 * The desk and the lift are written here too, so the first frame is laid out
 * in the box it will keep. Nothing here refreshes the (not yet built) game.
 */
let lastLift = '';
let lastDesk: boolean | null = null;
const applyShape = (safe: ReturnType<typeof safeAreaRect>, shape: GameShape): void => {
  const lift = `${shape.lift}px`;
  if (lift !== lastLift) {
    lastLift = lift;
    document.documentElement.style.setProperty('--fw-banner-lift', lift);
  }
  const desk = !WEB_DAILY && wantsDesk(safe, shape.lift, BASE_WIDTH, shape.height);
  if (desk !== lastDesk) {
    lastDesk = desk;
    document.documentElement.toggleAttribute('data-desk', desk);
  }
};
{
  const safe = safeAreaRect();
  const shape = fitShape(safe, METRICS.bannerReserve);
  applyShape(safe, shape);
  setViewHeight(shape.height);
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  // Matching the page background means FIT's letterbox bars are invisible —
  // the paper simply runs to the edge of whatever screen it lands on. On a
  // tall phone there are none any more; a 9:16-or-wider window still has them
  // at its sides.
  backgroundColor: theme().paper,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: BASE_WIDTH,
    height: viewHeight(),
    // The parent box moves when only the safe area changes (no window resize);
    // Phaser's own poll is the last line of defence for that, so poll often.
    resizeInterval: 100,
  },
  /*
   * Phaser allocates one touch Pointer by default, so a second finger anywhere
   * on the glass is dropped entirely. That breaks the fast-retry path this game
   * is built around: a collision always happens mid-drag, so the drawing finger
   * is still down during the 400ms flash, and reaching in with the other hand
   * to restart would find no Pointer free. Three covers a stray palm too.
   */
  input: { activePointers: 3 },
  render: {
    antialias: true,
    roundPixels: false,
    powerPreference: 'high-performance',
  },
  fps: { target: 60 },
  scene: [BootScene, MenuScene, LevelSelectScene, GalleryScene, GameScene],
});

// Let the ad layer pause the loop while a full-screen ad owns the screen.
registerGame(game);

/*
 * Force the ScaleManager to recompute the canvas bounds — which drive pointer
 * mapping — whenever the real viewport changes. Inside a Capacitor webview the
 * size settles AFTER the game is created (status bar, safe areas, splash
 * dismissal) and often without firing a window 'resize'. A stale canvas rect
 * puts every touch a few points away from where the player aimed, and in a game
 * that is nothing but a drawn line, a few points is the whole experience.
 */
const refresh = (): void => {
  // refresh() sizes the canvas from the CACHED parent size and only re-reads
  // the parent at its very end — so on its own it lays the canvas out for the
  // previous box, then marks the new one as seen, and Phaser's own poll never
  // corrects it. Read the parent first.
  game.scale.getParentBounds();
  game.scale.refresh();
};
window.addEventListener('resize', refresh);
window.addEventListener('orientationchange', refresh);
window.visualViewport?.addEventListener('resize', refresh);
window.visualViewport?.addEventListener('scroll', refresh);
for (const ms of [50, 250, 600, 1200]) setTimeout(refresh, ms);

/*
 * The safe area, as a box the browser keeps up to date. #app is inset by the
 * same env() values, which can change without any window resize (a fold
 * settling, Split View, the status bar moving sides), so this box is watched
 * rather than the window. A move that keeps the size (the band switching
 * sides) is not a resize to the observer; resizeInterval catches that one.
 *
 * Three things are decided from it before the canvas is refreshed
 * (render/SafeArea.ts fitShape), in this order:
 * - the banner lift: zero on every iPhone and Duo shape but the shortest
 *   windows and the 320pt Split View pane, where the 50pt banner would
 *   otherwise reach past the reserve onto the board; index.html adds it to
 *   #app's bottom;
 * - the world's height (Theme.adaptiveHeight), for the box that lift leaves:
 *   set as the one source of truth FIRST, then handed to Phaser, so every
 *   scene that hears the resize reads the new value. setGameSize keeps FIT's
 *   pointer mapping: it resizes the canvas and refreshes the bounds the input
 *   maps through — and refresh() below re-reads the parent after it;
 * - desk mode (SafeArea.wantsDesk): 40pt or more of paper beside the board on
 *   both sides turns the margins into a desk (index.html). Not on the web
 *   Daily, whose page is the product as it stands.
 *
 * The observer's first callback arrives after boot, like the timers above —
 * nothing here calls refresh() synchronously while the game is being built.
 */
const relayout = (): void => {
  const safe = safeAreaRect();
  const shape = fitShape(safe, METRICS.bannerReserve);
  applyShape(safe, shape);
  if (shape.height !== viewHeight()) {
    setViewHeight(shape.height);
    game.scale.setGameSize(BASE_WIDTH, viewHeight());
  }
  refresh();
};
const safeBox = safeAreaBox();
if (safeBox && typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(relayout).observe(safeBox);
}

// Dev-only handle for tooling. `import.meta.env.DEV` is a compile-time
// constant, false in `vite build`, so this is tree-shaken out of the bundle.
if (import.meta.env.DEV) {
  const w = window as unknown as {
    game: Phaser.Game;
    foldwing: { renderShareCard: typeof renderShareCard; nudges: typeof Nudges };
  };
  w.game = game;
  // Asset tooling hook: the app icon is generated by asking the game to draw a
  // figure, so the mark on the home screen is literally made of the mechanic.
  // And the reminders, for the QA harness: `nudges.devPlugin.pending` is what a
  // phone would hold, `nudges.devPlugin.tap()` is a reminder tap.
  w.foldwing = { renderShareCard, nudges: Nudges };
}
