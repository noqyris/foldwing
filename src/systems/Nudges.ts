/**
 * Nudges — the reminders the phone keeps for the player, and what a tap on
 * one does.
 *
 * LOCAL, NOT PUSH. There is no server behind this game and no reason to build
 * one for a reminder the phone can schedule itself: local notifications need no
 * APNs certificate, no backend, no device token, and they fire with the phone in
 * flight mode. Everything a reminder needs to know — the streak, the bookmarks,
 * when this player usually plays — is already on the phone.
 *
 * WHAT TO SAY AND WHEN is NudgePlan's, and pure. This file only reads the save,
 * asks the plugin, and routes a tap.
 *
 * THE PERMISSION IS ASKED FOR BY THE PLAYER, NEVER BY A SCHEDULE. Plugin 8.3's
 * `schedule()` puts the system prompt up by itself when permission is
 * undecided, so `rebuild()` checks first and does nothing unless it is already
 * granted. The only path to the alert is `request()`, which the game calls
 * from the player's own [Remind me] tap or the Settings switch — a prompt
 * nobody asked for spends the one permission ask iOS grants for nothing.
 */
import { LocalNotifications } from '@capacitor/local-notifications';
import type { ActionPerformed, LocalNotificationSchema } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import { todayISO } from '../core/CalendarDay';
import { chapterIndices, chapterOf, chapterStats } from '../core/Rewards';
import { LEVELS } from '../data/levels';
import {
  NUDGE_ID_FIRST,
  NUDGE_ID_LAST,
  NUDGE_IDS,
  planNudges,
  reminderMinute,
  routeForTap,
  shouldSoftAsk,
  timeLabel,
  type NudgeState,
} from './NudgePlan';
import { Progress } from './Progress';
import { WEB_DAILY } from './WebDaily';

export type NudgePermission = 'granted' | 'denied' | 'prompt';

/**
 * The registry key a warm reminder tap leaves for the Menu when it could not
 * switch scenes itself (a level, a sheet or an ad was up). The Menu consumes it
 * on its next create with `Nudges.takePendingRoute(this.registry)`.
 */
export const PENDING_ROUTE = 'pendingRoute';

/** The plugin surface this file uses — the real one, or the DEV web stand-in. */
type Plugin = Pick<
  typeof LocalNotifications,
  | 'checkPermissions'
  | 'requestPermissions'
  | 'schedule'
  | 'cancel'
  | 'getPending'
  | 'removeAllDeliveredNotifications'
  | 'registerActionTypes'
  | 'addListener'
>;

/**
 * DEV only, in a browser: a permission and a pending list kept in memory, so
 * the Settings switch, the soft ask and a reminder tap can be driven from the
 * QA harness without a phone. `?notif=granted|denied|prompt` sets where the
 * permission starts (default undecided), `?notifAnswer=deny` makes the fake
 * system alert refuse. `import.meta.env.DEV` is false in every `vite build`,
 * so none of this reaches a bundle.
 */
interface DevPlugin extends Plugin {
  pending: LocalNotificationSchema[];
  tap(extra: unknown): void;
}

function devPlugin(): DevPlugin | null {
  if (!import.meta.env.DEV || Capacitor.isNativePlatform() || typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search);
  let display: NudgePermission =
    q.get('notif') === 'granted' ? 'granted' : q.get('notif') === 'denied' ? 'denied' : 'prompt';
  const listeners: ((a: ActionPerformed) => void)[] = [];
  const fake: DevPlugin = {
    pending: [],
    tap(extra) {
      const notification = { id: 0, title: '', body: '', extra };
      for (const l of listeners) l({ actionId: 'tap', notification });
    },
    checkPermissions: async () => ({ display, exact_alarm: 'granted' as const }) as never,
    requestPermissions: async () => {
      if (display === 'prompt') display = q.get('notifAnswer') === 'deny' ? 'denied' : 'granted';
      return { display, exact_alarm: 'granted' as const } as never;
    },
    schedule: async ({ notifications }) => {
      const ids = new Set(notifications.map((n) => n.id));
      fake.pending = [...fake.pending.filter((n) => !ids.has(n.id)), ...notifications];
      return { notifications: notifications.map((n) => ({ id: n.id })) };
    },
    cancel: async ({ notifications }) => {
      const ids = new Set(notifications.map((n) => n.id));
      fake.pending = fake.pending.filter((n) => !ids.has(n.id));
    },
    getPending: async () => ({ notifications: fake.pending.map((n) => ({ ...n })) }) as never,
    removeAllDeliveredNotifications: async () => {},
    registerActionTypes: async () => {},
    addListener: (async (_event: string, fn: (a: ActionPerformed) => void) => {
      listeners.push(fn);
      return { remove: async () => {} };
    }) as never,
  };
  return fake;
}

const dev = devPlugin();
const plugin = (): Plugin => dev ?? LocalNotifications;

/** Every slot id, cancelled by id as well as from the pending list. */
const SLOT_IDS = Object.values(NUDGE_IDS);

/**
 * A rebuild asked for this soon after the last one, from the same inputs, has
 * nothing to write: what that one left is still pending. A return from the
 * background can arrive as two visibilitychanges, and the simulator showed
 * every foreground running the whole cancel-and-schedule cycle twice.
 */
export const REBUILD_DEDUPE_MS = 1000;

class NudgeService {
  private asked = false;
  /** The player has answered the system prompt, now or on an earlier launch. */
  private decided = false;
  /** request() calls in flight that could still put the system alert up. */
  private mayPrompt = 0;
  /** The FOLD category is registered once a session, before the first schedule. */
  private actionsRegistered = false;
  private listening = false;
  /** A tap not yet routed, and what the notification carried. */
  private tapped = false;
  private tapExtra: unknown = undefined;
  /**
   * Rebuilds run one at a time: two interleaved would cancel each other's
   * work. A clear waits its turn too, so it cannot land under a schedule.
   */
  private queue: Promise<unknown> = Promise.resolve();
  /**
   * The rebuild queued behind the one running, not started yet. Every rebuild
   * asked for before it starts IS that run: a foreground, a grant and a win in
   * the same moment write the plan once more, not once each.
   */
  private next: { now: Date | undefined; run: Promise<number> } | null = null;
  /** What the last rebuild to reach the plugin wrote, when, and how many. */
  private last: { inputs: string; at: number; count: number } | null = null;

  get available(): boolean {
    return Capacitor.isNativePlatform() || dev !== null;
  }

  /**
   * True from the moment a request that could show the permission alert
   * starts until it has settled — including the whole time the alert is up.
   *
   * Set SYNCHRONOUSLY by request(), before its first await, so code running in
   * the same beat as the call already sees it. A [Remind me] on the win card
   * asks for reminders and then, a second later, the win would spend the one
   * automatic review prompt, which iOS drops under the permission alert while
   * the save still marks it spent. Rate stands down while this is true.
   */
  get promptPending(): boolean {
    return this.mayPrompt > 0;
  }

  /**
   * Ask, once, and only because the player tapped something that asked for
   * reminders. Callers follow a `true` with `rebuild()`.
   *
   * @returns whether notifications may be posted.
   */
  async request(): Promise<boolean> {
    if (!this.available) return false;
    // An answered prompt never comes back (short of a reinstall), so once the
    // answer is known no call can raise the alert again.
    const couldPrompt = !this.asked && !this.decided;
    if (couldPrompt) this.mayPrompt++;
    try {
      const current = await plugin().checkPermissions();
      if (current.display === 'granted' || current.display === 'denied') this.decided = true;
      if (current.display === 'granted') return true;
      // 'denied' is a decision, not a state to nag about: iOS shows the system
      // prompt once and every later request resolves denied without any UI.
      if (current.display === 'denied' || this.asked) return false;
      this.asked = true;
      const asked = await plugin().requestPermissions();
      if (asked.display === 'granted' || asked.display === 'denied') this.decided = true;
      return asked.display === 'granted';
    } catch {
      return false;
    } finally {
      if (couldPrompt) this.mayPrompt--;
    }
  }

  /**
   * Learn, without asking, whether the player answered the prompt on some
   * earlier launch. Never puts anything on screen.
   *
   * Without it every session starts not knowing, so the first [Remind me] of
   * each one would raise `promptPending` for the instant the check takes — and
   * a player who only ever plays the Daily would never be asked for a review
   * at all. BootScene runs this once the save is in.
   */
  async warm(): Promise<void> {
    if (!this.available || this.decided) return;
    try {
      const current = await plugin().checkPermissions();
      if (current.display === 'granted' || current.display === 'denied') this.decided = true;
    } catch {
      /* still unknown; the next request finds out */
    }
  }

  /**
   * What iOS has on record, without asking. 'denied' also covers "cannot
   * post at all" (the web, a broken plugin): no surface should offer a
   * reminder it cannot deliver.
   */
  async permission(): Promise<NudgePermission> {
    if (!this.available) return 'denied';
    try {
      const { display } = await plugin().checkPermissions();
      if (display === 'granted' || display === 'denied') {
        this.decided = true;
        return display;
      }
      return 'prompt';
    } catch {
      return 'denied';
    }
  }

  /**
   * Replace every pending reminder with the plan for the player as they are
   * now. NEVER prompts.
   *
   * Cheap and idempotent, so it runs wherever the player's state moves: boot,
   * every foreground, the first Daily finish, the Settings switch, an accepted
   * soft ask, Remove Ads, a repair. With Reminders off it clears instead; with
   * permission not granted it touches nothing; while the Daily is still locked
   * the plan is empty, so it only clears.
   *
   * COALESCED. One runs at a time, and however many ask while it does, one
   * more runs after it, from the save as it is then; each asker gets that
   * run's count. A run that finds the same inputs the last one wrote, less
   * than REBUILD_DEDUPE_MS later, touches nothing and returns its count.
   *
   * @returns how many reminders are now pending.
   */
  rebuild(now?: Date): Promise<number> {
    const waiting = this.next;
    if (waiting) {
      // The latest ask's clock wins; none given means the moment it starts.
      waiting.now = now;
      return waiting.run;
    }
    const next: { now: Date | undefined; run: Promise<number> } = { now, run: Promise.resolve(0) };
    next.run = this.serial(() => {
      // Started: from here on an ask is one more run, after this one.
      if (this.next === next) this.next = null;
      return this.rebuildNow(next.now ?? new Date());
    }, 0);
    this.next = next;
    return next.run;
  }

  /** Run `task` after everything already queued; a throw resolves to `fallback`. */
  private serial<T>(task: () => Promise<T>, fallback: T): Promise<T> {
    const run = this.queue.then(task).catch(() => fallback);
    this.queue = run;
    return run;
  }

  /**
   * @deprecated The 1.3 entry point, which asked for permission on the first
   * Daily win. It now only rebuilds, never prompts; the ask is the win card's
   * [Remind me]. Kept until GameScene calls `rebuild()` itself.
   */
  schedule(now?: Date): Promise<number> {
    return this.rebuild(now);
  }

  private async rebuildNow(now: Date): Promise<number> {
    if (!this.available || WEB_DAILY) return 0;
    // Progress.load() stamps lastSeen (markSeen); empty means the save has not
    // been read, and a plan built from the placeholder is a stranger's.
    if (!Progress.data.lastSeen) return 0;

    // The same inputs as the last write, moments ago: it is all still pending.
    // Only a run that got as far as the plugin is remembered, so one that
    // found permission undecided never hides the rebuild after a [Remind me].
    const inputs = this.inputs(now);
    const last = this.last;
    const since = last ? now.getTime() - last.at : -1;
    if (last && last.inputs === inputs && since >= 0 && since < REBUILD_DEDUPE_MS) return last.count;
    this.last = null;

    if (!Progress.data.reminders) {
      await this.clearNow();
      this.last = { inputs, at: now.getTime(), count: 0 };
      return 0;
    }
    // THE check. Plugin 8.3's schedule() would raise the alert itself.
    if ((await this.permission()) !== 'granted') return 0;

    // Read again after the await: the save may have moved under it.
    const plan = planNudges(this.state(now));
    try {
      await this.cancelOurs();
      if (!this.actionsRegistered) {
        // A category with no buttons: it exists for the placeholder text iOS
        // shows when previews are hidden, which would otherwise be the body.
        await plugin().registerActionTypes({
          types: [{ id: 'FOLD', actions: [], iosHiddenPreviewsBodyPlaceholder: 'Daily fold' }],
        });
        this.actionsRegistered = true;
      }
      if (plan.length) await plugin().schedule({ notifications: plan });
      this.last = { inputs: JSON.stringify(plan), at: now.getTime(), count: plan.length };
      return plan.length;
    } catch {
      return 0;
    }
  }

  /**
   * What a rebuild now would leave on the phone: the plan itself, whose every
   * field (ids, copy, times) comes from the save and the clock, or 'off'.
   */
  private inputs(now: Date): string {
    return Progress.data.reminders ? JSON.stringify(planNudges(this.state(now))) : 'off';
  }

  /** The planner's view of the save. */
  private state(now: Date): NudgeState {
    const save = Progress.data;
    const today = todayISO(now);
    const doneToday = Progress.hasDaily(today);
    const latest = Object.keys(save.daily)
      .filter((d) => d <= today)
      .sort()
      .pop();
    const cleared = new Set(save.cleared);
    const allCleared = LEVELS.every((l) => cleared.has(l.id));
    // The same frontier the Menu's Continue opens.
    const next = Math.min(Math.max(0, save.unlockedIndex), LEVELS.length - 1);
    const c = chapterOf(next);
    const inChapter = chapterStats(cleared, new Set(save.medals), c, save.unlockedIndex).cleared;
    return {
      now,
      // The same rule as the Daily card and the tap route: a player still in
      // the tutorial is told about nothing they cannot open.
      dailyOpen: Progress.dailyUnlocked(),
      doneToday,
      streak: Progress.dailyStreak(today),
      longest: Progress.longestStreak(),
      bookmarks: Progress.bookmarks,
      lastDailyMs: latest ? save.daily[latest].ms : null,
      sessionMinutes: save.sessionMinutes,
      adsRemoved: save.adsRemoved,
      figures: save.figures.length,
      chapter: allCleared ? null : { index: c, left: chapterIndices(c).length - inChapter },
      resume:
        allCleared || !(next > 0 || save.totalWins > 0) ? null : { index: next, name: LEVELS[next].name },
    };
  }

  /**
   * Cancel every id this game has ever used: whatever iOS lists as pending in
   * the range, plus the nine slots by id in case an add it reported is not
   * listed yet (the plugin resolves schedule() before iOS confirms each one).
   */
  private async cancelOurs(): Promise<void> {
    const pending = await plugin().getPending();
    const ids = new Set(SLOT_IDS);
    for (const n of pending.notifications) {
      if (n.id >= NUDGE_ID_FIRST && n.id <= NUDGE_ID_LAST) ids.add(n.id);
    }
    await plugin().cancel({ notifications: [...ids].map((id) => ({ id })) });
  }

  /**
   * Stop reminding. Leaves the OS permission alone — that is the player's.
   * Queued behind a rebuild already running, which would otherwise schedule
   * after it; a rebuild asked for after this runs after it.
   */
  clear(): Promise<void> {
    if (!this.available) return Promise.resolve();
    this.next = null;
    return this.serial(() => this.clearNow(), undefined);
  }

  private async clearNow(): Promise<void> {
    // Whatever the last rebuild wrote is gone, so the next one is not a repeat.
    this.last = null;
    try {
      await this.cancelOurs();
    } catch {
      /* nothing to clear is the same outcome */
    }
  }

  /**
   * Take yesterday's reminders out of Notification Center. Run on every
   * return to the app: a reminder the player has already answered by opening
   * the game is clutter, and this also resets the badge.
   */
  async clearDelivered(): Promise<void> {
    if (!this.available || WEB_DAILY) return;
    try {
      await plugin().removeAllDeliveredNotifications();
    } catch {
      /* cosmetic */
    }
  }

  /**
   * Listen for taps. Called once, at module scope in main.ts, before the game
   * exists: the plugin holds a tap that launched the app until a listener is
   * added, and adding it early is what lets a cold launch find it.
   *
   * `onTap` runs for every tap on one of ours; the route itself is read with
   * `takeRoute()`, by BootScene on a cold launch and by main.ts on a warm one.
   */
  installTapListener(onTap?: () => void): void {
    if (this.listening || !this.available || WEB_DAILY) return;
    this.listening = true;
    try {
      void plugin()
        .addListener('localNotificationActionPerformed', (a: ActionPerformed) => {
          this.tapped = true;
          this.tapExtra = a?.notification?.extra;
          onTap?.();
        })
        .catch(() => {
          this.listening = false;
        });
    } catch {
      this.listening = false;
    }
  }

  /**
   * The route an unread tap asks for, now: 'daily' when today's fold is still
   * there to play (routeForTap), else null. Emptied by the call.
   */
  takeRoute(now: Date = new Date()): 'daily' | null {
    if (!this.tapped) return null;
    const extra = this.tapExtra;
    this.tapped = false;
    this.tapExtra = undefined;
    return this.routeNow(extra, now);
  }

  /**
   * For the Menu's create(): the route a warm tap left in the registry, checked
   * again against the save now — the player may have folded it since.
   */
  takePendingRoute(
    registry: { get(key: string): unknown; remove(key: string): unknown },
    now: Date = new Date()
  ): 'daily' | null {
    const v = registry.get(PENDING_ROUTE);
    if (v === undefined || v === null) return null;
    registry.remove(PENDING_ROUTE);
    return v === 'daily' ? this.routeNow({ route: 'daily' }, now) : null;
  }

  private routeNow(extra: unknown, now: Date): 'daily' | null {
    const today = todayISO(now);
    const route = routeForTap(extra, {
      doneToday: Progress.hasDaily(today),
      unlockedIndex: Progress.data.unlockedIndex,
      dailyUnlocked: Progress.dailyUnlocked(),
    });
    return route === 'daily' ? 'daily' : null;
  }

  /**
   * When this player's reminder lands, as the surfaces say it: "7 pm", for
   * "Reminders on · around 7 pm" and the Settings row's "… · around 7 pm".
   */
  reminderTimeLabel(): string {
    return timeLabel(reminderMinute(Progress.data.sessionMinutes));
  }

  /** Whether a surface may offer [Remind me] now. See NudgePlan.shouldSoftAsk. */
  shouldSoftAsk(
    save: { readonly nudgeAsks: number; readonly nudgeAskedOn: string; readonly reminders: boolean },
    today: string,
    permission: NudgePermission
  ): boolean {
    if (WEB_DAILY) return false;
    return shouldSoftAsk(save, today, permission);
  }

  /** DEV only: what the stand-in plugin holds, and a fake tap. Null on a device. */
  get devPlugin(): { readonly pending: readonly LocalNotificationSchema[]; tap(extra?: unknown): void } | null {
    if (!dev) return null;
    return {
      get pending() {
        return dev.pending;
      },
      tap: (extra: unknown = { route: 'daily', kind: 'ready-today', forDay: todayISO() }) => dev.tap(extra),
    };
  }
}

export const Nudges = new NudgeService();
