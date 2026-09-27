/**
 * SessionLifecycle — sessions as core/Session defines them, for the whole app:
 * a cold launch, OR a return from the background after 30 minutes or more, OR a
 * return into a new local day.
 *
 * main.ts drives it: `startColdSession()` once at boot, `noteHidden()` and
 * `noteVisible()` from its `visibilitychange` handler. Everything that keeps
 * something per session listens through `onSessionStart` — there is no other
 * copy of the rule in the app:
 *
 *   - Ads: the interstitial cap per session goes back to zero, and the
 *     session's foreground age (SessionClock) restarts, so the warm-up re-arms.
 *   - Rate: "not in a session with a skip or a purchase" forgets the last
 *     session's skips and purchases.
 *
 * Deliberately NOT reset on a new session, because none of them is per session:
 * the floor since the last interstitial and the mute after a rewarded view
 * (real elapsed time — the floor is what keeps an ad from landing right after a
 * return), the "every Nth win / attempt" counters in the save, and the daily
 * rewarded cap. And a new session is not a new day: the daily gift, the streak
 * and the missions roll over by the calendar, not here.
 *
 * The count is persisted under its own key. No rule reads it yet; it is the
 * install's session number, cold launches included (App Review notes that say
 * "force-quit and relaunch" depend on a cold launch still being one).
 *
 * `whenAdLayerMayStart` is the ATT trap's fix, and the ONE gate every route that
 * can start the ad layer passes through (Ads.init, Ads.foregrounded,
 * Ads.openPrivacyOptions). WKWebView fires `visibilitychange` on
 * willEnterForeground, while the app is still INACTIVE — didBecomeActive comes
 * ~300 ms later, later still after an unlock swipe — and a timer that came due
 * in the background (the opening film's own cap, main.ts's backstop) fires in
 * that same window. ATT requested while inactive shows nothing and answers
 * notDetermined; the consent modal still appears, and the SDK starts with a
 * zeroed advertising id. So the gate waits for the film to be gone AND the app
 * to be active.
 */
import { App } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { whenIntroDone } from '@noqyris/splash';
import { todayISO } from '../core/CalendarDay';
import { onHidden, onVisible, type HiddenStamp } from '../core/Session';

/** Where the session count lives: its own key, beside the save (`foldwing.save.v1`). */
export const SESSIONS_KEY = 'foldwing.sessions';

export type SessionReason = 'cold' | 'return';
export type SessionListener = (reason: SessionReason, n: number) => void;

/** The first hide of the current pause; null while the page is visible. */
let stamp: HiddenStamp | null = null;
/** The count on disk when this process read it; null until the read lands. */
let stored: number | null = null;
/** Sessions this process has started: the cold launch, then every renewing return. */
let started = 0;
/** A return has started a new session since this process launched. */
let renewed = false;
/** The cold start, shared: a second call is the same boot. */
let cold: Promise<number> | null = null;
const listeners = new Set<SessionListener>();

function announce(reason: SessionReason): void {
  const n = sessionNumber();
  for (const fn of [...listeners]) {
    try {
      fn(reason, n);
    } catch {
      /* a listener must never break the lifecycle, or the listeners after it */
    }
  }
}

async function readStored(): Promise<number> {
  try {
    const { value } = await Preferences.get({ key: SESSIONS_KEY });
    const n = Number(value);
    return value !== null && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

/** Write the total. Before the boot's read has landed there is nothing to add to: that read writes it. */
async function persist(): Promise<void> {
  if (stored === null) return;
  try {
    await Preferences.set({ key: SESSIONS_KEY, value: String(stored + started) });
  } catch {
    /* a lost count is a statistic, never a crash */
  }
}

/**
 * Boot: a cold launch is always a session. Counted at once — listeners hear it
 * before the read — and persisted on top of what the disk holds. Resolves with
 * the install's session number.
 */
export function startColdSession(): Promise<number> {
  if (cold) return cold;
  started += 1;
  announce('cold');
  cold = (async () => {
    stored = await readStored();
    await persist();
    return sessionNumber();
  })();
  return cold;
}

/** The install's session number: the stored count plus this process's sessions. */
export function sessionNumber(): number {
  return (stored ?? 0) + started;
}

/**
 * Whether a return has started a new session since this process launched —
 * that is, whether the install's first session of this launch is over. The
 * question any "not in the first session" rule has to ask, since a suspended
 * process can outlive its first session by days.
 */
export function renewedSinceLaunch(): boolean {
  return renewed;
}

/**
 * Hear every session start, cold and return. Synchronous, inside the same
 * `visibilitychange` that decided it, so a per-session limit is reset before
 * anything else on that return can read it. Returns the unsubscribe.
 */
export function onSessionStart(fn: SessionListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The page went hidden. The FIRST hide of a pause is kept (core/Session.onHidden). */
export function noteHidden(now: number = Date.now()): void {
  stamp = onHidden(stamp, now, todayISO(new Date(now)));
}

/**
 * The page came back. True when this return starts a new session: the count
 * goes up, the first session is over, and every listener has already reset
 * what it keeps per session by the time this returns.
 */
export function noteVisible(now: number = Date.now()): boolean {
  const r = onVisible(stamp, now, todayISO(new Date(now)));
  stamp = r.stamp;
  if (!r.newSession) return false;
  renewed = true;
  started += 1;
  announce('return');
  void persist();
  return true;
}

/**
 * Resolves once the app is ACTIVE (didBecomeActive) — at once when it already
 * is, and off-device. The listener is registered FIRST and the state read
 * again after it: a transition between the first read and the registration
 * would otherwise be missed, and the wait would last until the next one.
 */
export async function whenAppActive(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    if ((await App.getState()).isActive) return;
  } catch {
    // No App plugin linked: nothing to wait on. Better to go on than to hang.
    return;
  }
  await new Promise<void>((resolve) => {
    let done = false;
    let handle: Promise<PluginListenerHandle> | undefined;
    // Only ever called back asynchronously — by an event, or by the re-check.
    const finish = (): void => {
      if (done) return;
      done = true;
      void handle?.then((h) => h.remove()).catch(() => undefined);
      resolve();
    };
    handle = App.addListener('appStateChange', (s) => {
      if (s.isActive) finish();
    });
    void App.getState()
      .then((s) => {
        if (s.isActive) finish();
      })
      .catch(() => undefined);
  });
}

/**
 * THE starter gate of the ad layer — ATT, the consent modal and the SDK start
 * all go through it. Resolves once the opening film is off the screen AND the
 * app is active, in that order: the film can end in the inactive window (its
 * cap timer came due in the background), so "active" is checked after it.
 */
export async function whenAdLayerMayStart(): Promise<void> {
  await whenIntroDone();
  await whenAppActive();
}

/** @internal Test seam: a fresh process. */
export function __resetSessionLifecycleForTests(): void {
  stamp = null;
  stored = null;
  started = 0;
  renewed = false;
  cold = null;
  listeners.clear();
}
