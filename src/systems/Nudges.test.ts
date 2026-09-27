/*
 * The service around the plan: what it asks the plugin, and when. The plan
 * itself — hours, days, copy — is NudgePlan.test.ts.
 *
 * The expensive mistakes here are all about the permission alert. iOS shows it
 * once; plugin 8.3's schedule() raises it by itself when permission is
 * undecided; and the one automatic review prompt dies silently under it. So
 * the tests below pin that a rebuild never gets near it, and that the one call
 * that can still raise it keeps the review out of its way.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { todayISO } from '../core/CalendarDay';

const ln = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  getPending: vi.fn(),
  cancel: vi.fn(),
  schedule: vi.fn(),
  registerActionTypes: vi.fn(),
  removeAllDeliveredNotifications: vi.fn(),
  addListener: vi.fn(),
}));
const review = vi.hoisted(() => ({ requestReview: vi.fn() }));
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: ln }));
vi.mock('@capacitor-community/in-app-review', () => ({ InAppReview: review }));
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: (): Promise<{ value: string | null }> => Promise.resolve({ value: null }),
    set: (): Promise<void> => Promise.resolve(),
  },
}));
vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
}));

/** A cold launch: fresh singletons, a loaded save that has earned the review ask. */
async function launch(load = true) {
  vi.resetModules();
  const { Nudges, PENDING_ROUTE, REBUILD_DEDUPE_MS } = await import('./Nudges');
  const { Rate } = await import('./Rate');
  const { Progress } = await import('./Progress');
  if (load) {
    await Progress.load();
    Progress.update({ totalWins: 10, ratePrompted: false, playDays: 2 });
  }
  return { Nudges, Rate, Progress, PENDING_ROUTE, REBUILD_DEDUPE_MS };
}

/** A win the review may follow: a first-try medal on level 21 (see Rate). */
const PEAK = {
  adWillShow: false,
  win: { levelIndex: 20, medal: true, todayDailyFirst: false, streakAfter: 0, attempts: 1 },
};

/** A player past the tutorial, with the Daily open. */
const PAST_TUTORIAL = { unlockedIndex: 7, cleared: ['l1', 'l2', 'l3', 'l4', 'l5'] };

/** Let every already-settled promise run its continuation. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

/** Plugin calls in the order they were made. */
let calls: string[] = [];

beforeEach(() => {
  calls = [];
  for (const [name, f] of Object.entries(ln)) {
    f.mockReset();
    f.mockImplementation(() => {
      calls.push(name);
      return Promise.resolve(undefined);
    });
  }
  ln.getPending.mockImplementation(() => {
    calls.push('getPending');
    return Promise.resolve({ notifications: [] });
  });
  review.requestReview.mockReset();
  review.requestReview.mockResolvedValue(undefined);
});

const granted = (display = 'granted') =>
  ln.checkPermissions.mockImplementation(() => {
    calls.push('checkPermissions');
    return Promise.resolve({ display });
  });

/*
 * The one automatic review prompt must not share a beat with the notification
 * permission alert.
 *
 * A Daily win asked about reminders and, a second later, spent the review ask:
 * iOS put the review under the permission alert and never showed it, while the
 * save already marked it spent. The ask is once per lifetime, so that was the
 * whole of it gone. Verified on the simulator: the log shows requestPermissions,
 * then requestReview about a second later, and no review ever appears. The
 * alert now only follows [Remind me], which is request(); the rule is the same.
 */
describe('the permission alert and the one review prompt', () => {
  it('stands the review down while [Remind me] has the alert up, and asks on the next win', async () => {
    const { Nudges, Rate, Progress } = await launch();
    granted('prompt');
    let answer: (v: { display: string }) => void = () => {};
    ln.requestPermissions.mockReturnValue(new Promise((r) => (answer = r)));

    // [Remind me] on the win card, then the win's rating check.
    const asked = Nudges.request();
    expect(Nudges.promptPending).toBe(true);
    expect(Rate.shouldAsk(PEAK)).toBe(false);

    // The alert is up; a delayed ask that slipped through must not spend it.
    await settle();
    expect(ln.requestPermissions).toHaveBeenCalledTimes(1);
    await Rate.ask();
    expect(review.requestReview).not.toHaveBeenCalled();
    expect(Progress.data.ratePrompted).toBe(false);

    answer({ display: 'granted' });
    expect(await asked).toBe(true);
    expect(Nudges.promptPending).toBe(false);

    // The next win has the screen to itself.
    expect(Rate.shouldAsk(PEAK)).toBe(true);
    await Rate.ask();
    expect(review.requestReview).toHaveBeenCalledTimes(1);
    expect(Progress.data.ratePrompted).toBe(true);
  });

  it('does not hold the review back once the player has answered on an earlier launch', async () => {
    for (const display of ['granted', 'denied']) {
      const { Nudges, Rate } = await launch();
      granted(display);
      await Nudges.warm();

      void Nudges.request();
      expect(Nudges.promptPending, display).toBe(false);
      expect(Rate.shouldAsk(PEAK), display).toBe(true);
    }
    expect(ln.requestPermissions).not.toHaveBeenCalled();
  });

  it('never asks for the permission while only warming up', async () => {
    const { Nudges } = await launch();
    granted('prompt');
    await Nudges.warm();
    expect(ln.requestPermissions).not.toHaveBeenCalled();
    expect(Nudges.promptPending).toBe(false);
  });

  it('lets go once the check finds nothing to ask', async () => {
    const { Nudges } = await launch();
    granted('granted');
    const asked = Nudges.request();
    // Not known yet on this launch, so the beat is held — and then released.
    expect(Nudges.promptPending).toBe(true);
    expect(await asked).toBe(true);
    expect(Nudges.promptPending).toBe(false);
    expect(ln.requestPermissions).not.toHaveBeenCalled();
  });

  it('lets go when the plugin fails', async () => {
    const { Nudges } = await launch();
    ln.checkPermissions.mockRejectedValue(new Error('no plugin'));
    expect(await Nudges.request()).toBe(false);
    expect(Nudges.promptPending).toBe(false);
  });
});

describe('rebuild', () => {
  it('never prompts, and touches nothing, while permission is undecided or refused', async () => {
    for (const display of ['prompt', 'prompt-with-rationale', 'denied']) {
      const { Nudges } = await launch();
      granted(display);
      expect(await Nudges.rebuild(), display).toBe(0);
      expect(Nudges.promptPending).toBe(false);
    }
    expect(ln.requestPermissions).not.toHaveBeenCalled();
    expect(ln.schedule).not.toHaveBeenCalled();
    expect(ln.cancel).not.toHaveBeenCalled();
  });

  it('clears instead, and never schedules or prompts, with Reminders off', async () => {
    const { Nudges, Progress } = await launch();
    granted('prompt');
    Progress.setReminders(false);
    ln.getPending.mockResolvedValue({ notifications: [{ id: 8105 }, { id: 8123 }, { id: 7000 }] });
    expect(await Nudges.rebuild()).toBe(0);
    expect(ln.requestPermissions).not.toHaveBeenCalled();
    expect(ln.schedule).not.toHaveBeenCalled();
    const cancelled = (ln.cancel.mock.calls[0][0] as { notifications: { id: number }[] }).notifications.map((n) => n.id);
    expect(cancelled).toContain(8105);
    expect(cancelled).toContain(8123); // a 1.3 fortnight id
    expect(cancelled).not.toContain(7000); // not ours
  });

  it('cancels the whole range first — the 1.3 fortnight too — then schedules the plan', async () => {
    const { Nudges, Progress } = await launch();
    Progress.update(PAST_TUTORIAL);
    granted();
    ln.getPending.mockImplementation(() => {
      calls.push('getPending');
      return Promise.resolve({ notifications: [{ id: 8123 }, { id: 9099 }, { id: 9100 }] });
    });
    const n = await Nudges.rebuild(new Date(2026, 8, 22, 8, 0));
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(8);

    expect(calls.indexOf('cancel')).toBeLessThan(calls.indexOf('schedule'));
    const cancelled = (ln.cancel.mock.calls[0][0] as { notifications: { id: number }[] }).notifications.map((x) => x.id);
    expect(cancelled).toEqual(expect.arrayContaining([8101, 8102, 8103, 8104, 8105, 8106, 8107, 8108, 8109, 8123, 9099]));
    expect(cancelled).not.toContain(9100);

    const scheduled = (ln.schedule.mock.calls[0][0] as { notifications: { id: number; extra: { route: string } }[] })
      .notifications;
    expect(scheduled).toHaveLength(n);
    for (const x of scheduled) {
      expect(x.id).toBeGreaterThanOrEqual(8101);
      expect(x.id).toBeLessThanOrEqual(8109);
      expect(x.extra.route).toBe('daily');
    }
    expect(ln.registerActionTypes).toHaveBeenCalledWith({
      types: [{ id: 'FOLD', actions: [], iosHiddenPreviewsBodyPlaceholder: 'Daily fold' }],
    });
    expect(ln.requestPermissions).not.toHaveBeenCalled();

    // Once a session is enough for the category.
    await Nudges.rebuild(new Date(2026, 8, 22, 8, 5));
    expect(ln.schedule).toHaveBeenCalledTimes(2);
    expect(ln.registerActionTypes).toHaveBeenCalledTimes(1);
  });

  it('reads the player: a folded Daily takes today off the schedule', async () => {
    const { Nudges, Progress } = await launch();
    granted();
    const now = new Date(2026, 8, 22, 8, 0);
    Progress.recordDaily(todayISO(now), { ms: 48_000, deaths: 0, foldSense: 0 });
    await Nudges.rebuild(now);
    const scheduled = (ln.schedule.mock.calls[0][0] as { notifications: { extra: { forDay: string } }[] })
      .notifications;
    expect(scheduled.some((x) => x.extra.forDay === '2026-09-22')).toBe(false);
  });

  /*
   * Permission can come before the Daily does (the Settings switch works from
   * the first session), and every line is about the Daily, which the tap would
   * then find locked. The range is still cleared: a 1.3 set must not outlive
   * the rebuild.
   */
  it('plans nothing while the Daily is locked, but still clears', async () => {
    const { Nudges, Progress } = await launch();
    granted();
    ln.getPending.mockResolvedValue({ notifications: [{ id: 8123 }] });
    expect(await Nudges.rebuild(new Date(2026, 8, 22, 8, 0))).toBe(0);
    expect(ln.schedule).not.toHaveBeenCalled();
    expect((ln.cancel.mock.calls[0][0] as { notifications: { id: number }[] }).notifications.map((x) => x.id)).toContain(8123);

    Progress.update(PAST_TUTORIAL);
    expect(await Nudges.rebuild(new Date(2026, 8, 22, 8, 0))).toBeGreaterThan(0);
  });

  it('does nothing before the save is read: the placeholder is a stranger', async () => {
    const { Nudges } = await launch(false);
    granted();
    expect(await Nudges.rebuild()).toBe(0);
    expect(ln.checkPermissions).not.toHaveBeenCalled();
    expect(ln.schedule).not.toHaveBeenCalled();
  });

  it('writes once for any number of asks in the same beat', async () => {
    const { Nudges, Progress } = await launch();
    Progress.update(PAST_TUTORIAL);
    granted();
    const now = new Date(2026, 8, 22, 8, 0);
    // A foreground with a milestone bookmark: the grant and the foreground
    // both ask, and a Daily win asks twice in one beat.
    const counts = await Promise.all([Nudges.rebuild(now), Nudges.rebuild(now), Nudges.rebuild(now)]);
    expect(counts[0]).toBeGreaterThan(0);
    expect(new Set(counts).size).toBe(1);
    expect(calls.filter((c) => c === 'cancel' || c === 'schedule')).toEqual(['cancel', 'schedule']);
    expect(ln.checkPermissions).toHaveBeenCalledTimes(1);
  });

  it('runs one at a time, and asks made while one runs are ONE more run after it', async () => {
    const { Nudges, Progress } = await launch();
    Progress.update(PAST_TUTORIAL);
    granted();
    let release: () => void = () => {};
    ln.getPending.mockImplementationOnce(() => {
      calls.push('getPending');
      return new Promise((r) => (release = () => r({ notifications: [] })));
    });
    const first = Nudges.rebuild(new Date(2026, 8, 22, 8, 0));
    await settle();
    expect(calls).toEqual(['checkPermissions', 'getPending']); // in flight, held at the pending list

    // Three asks while it runs, from a later moment (not a repeat of its inputs).
    const later = new Date(2026, 8, 22, 8, 5);
    const asks = [Nudges.rebuild(later), Nudges.rebuild(later), Nudges.rebuild(later)];
    await settle();
    expect(calls.filter((c) => c === 'cancel' || c === 'schedule')).toEqual([]); // nothing interleaves

    release();
    const n = await first;
    const after = await Promise.all(asks);
    expect(after).toEqual([n, n, n]);
    // Two runs, whole and in order — not four.
    expect(calls.filter((c) => c === 'cancel' || c === 'schedule')).toEqual(['cancel', 'schedule', 'cancel', 'schedule']);
    expect(ln.getPending).toHaveBeenCalledTimes(2);
  });

  /*
   * The dedupe cannot stand in for the join. A slow plugin keeps a run going
   * past REBUILD_DEDUPE_MS, and the asks that pile up meanwhile carry clocks
   * more than a second apart: run one by one, each would be a whole write.
   */
  it('joins the asks made during a slow run into one more run, on the latest clock', async () => {
    const { Nudges, Progress, REBUILD_DEDUPE_MS } = await launch();
    Progress.update(PAST_TUTORIAL);
    granted();
    let release: () => void = () => {};
    ln.getPending.mockImplementationOnce(() => {
      calls.push('getPending');
      return new Promise((r) => (release = () => r({ notifications: [] })));
    });
    const t0 = new Date(2026, 8, 22, 8, 0).getTime();
    const first = Nudges.rebuild(new Date(t0));
    await settle();

    // Three asks, each past the dedupe window of the one before.
    const clocks = [1, 2, 3].map((k) => t0 + k * (REBUILD_DEDUPE_MS + 500));
    const asks = clocks.map((t) => Nudges.rebuild(new Date(t)));
    release();
    const n = await first;
    expect(await Promise.all(asks)).toEqual([n, n, n]);
    // One more cycle for the three, not three more.
    expect(calls.filter((c) => c === 'cancel' || c === 'schedule')).toEqual(['cancel', 'schedule', 'cancel', 'schedule']);
    expect(ln.checkPermissions).toHaveBeenCalledTimes(2);

    // It ran on the last ask's clock: half a second after that is a repeat.
    const cycle = calls.length;
    expect(await Nudges.rebuild(new Date(clocks[2] + REBUILD_DEDUPE_MS / 2))).toBe(n);
    expect(calls).toHaveLength(cycle);
  });

  /*
   * The simulator: every return from the background ran the whole cycle —
   * checkPermissions, getPending, cancel, schedule — twice, back to back, with
   * the same seven ids both times.
   */
  it('skips a rebuild with the same inputs inside a second, and only then', async () => {
    const { Nudges, Progress, REBUILD_DEDUPE_MS } = await launch();
    Progress.update(PAST_TUTORIAL);
    granted();
    const t0 = new Date(2026, 8, 22, 8, 0).getTime();
    const n = await Nudges.rebuild(new Date(t0));
    expect(n).toBeGreaterThan(0);
    const cycle = calls.length;

    // The second foreground: nothing reaches the plugin, not even the check.
    expect(await Nudges.rebuild(new Date(t0 + 400))).toBe(n);
    expect(await Nudges.rebuild(new Date(t0 + REBUILD_DEDUPE_MS - 1))).toBe(n);
    expect(calls).toHaveLength(cycle);

    // A second later it writes again, even with nothing changed.
    await Nudges.rebuild(new Date(t0 + REBUILD_DEDUPE_MS));
    expect(ln.schedule).toHaveBeenCalledTimes(2);

    // Inside the second, but the player moved: today's fold is done, so the
    // plan differs and is written.
    Progress.recordDaily(todayISO(new Date(t0)), { ms: 48_000, deaths: 0, foldSense: 0 });
    const done = await Nudges.rebuild(new Date(t0 + REBUILD_DEDUPE_MS + 200));
    expect(ln.schedule).toHaveBeenCalledTimes(3);
    const scheduled = (ln.schedule.mock.calls[2][0] as { notifications: { extra: { forDay: string } }[] }).notifications;
    expect(scheduled).toHaveLength(done);
    expect(scheduled.some((x) => x.extra.forDay === '2026-09-22')).toBe(false);

    // A clock set back is not "inside a second".
    await Nudges.rebuild(new Date(t0 - 10_000));
    expect(ln.schedule).toHaveBeenCalledTimes(4);
  });

  it('never skips the rebuild that follows a [Remind me], however soon', async () => {
    const { Nudges, Progress } = await launch();
    Progress.update(PAST_TUTORIAL);
    const t0 = new Date(2026, 8, 22, 8, 0).getTime();
    // The Daily win rebuilds while permission is undecided: nothing is written.
    granted('prompt');
    expect(await Nudges.rebuild(new Date(t0))).toBe(0);
    // 0.8 s later the player allows reminders on the card; the same inputs.
    granted('granted');
    expect(await Nudges.rebuild(new Date(t0 + 800))).toBeGreaterThan(0);
    expect(ln.schedule).toHaveBeenCalledTimes(1);
  });

  it('never skips the rebuild after a clear, and orders the two', async () => {
    const { Nudges, Progress } = await launch();
    Progress.update(PAST_TUTORIAL);
    granted();
    const t0 = new Date(2026, 8, 22, 8, 0).getTime();
    await Nudges.rebuild(new Date(t0));

    // Settings: Reminders off, then straight back on, inside the second.
    const cycle = calls.length;
    Progress.setReminders(false);
    void Nudges.clear();
    Progress.setReminders(true);
    const n = await Nudges.rebuild(new Date(t0 + 300));
    expect(n).toBeGreaterThan(0);
    // The clear's cancel, then the rebuild's whole cycle: the reminders end up
    // pending, as the switch says.
    expect(calls.slice(cycle)).toEqual(['getPending', 'cancel', 'checkPermissions', 'getPending', 'cancel', 'schedule']);
  });

  /*
   * Reminders off while a foreground's rebuild is still writing. A clear run at
   * once would cancel first and the rebuild would schedule over it: reminders
   * pending under a switch that says off.
   */
  it('queues a clear behind the rebuild in flight', async () => {
    const { Nudges, Progress } = await launch();
    Progress.update(PAST_TUTORIAL);
    granted();
    let release: () => void = () => {};
    ln.getPending.mockImplementationOnce(() => {
      calls.push('getPending');
      return new Promise((r) => (release = () => r({ notifications: [] })));
    });
    const first = Nudges.rebuild(new Date(2026, 8, 22, 8, 0));
    await settle();
    expect(calls).toEqual(['checkPermissions', 'getPending']);

    Progress.setReminders(false);
    const cleared = Nudges.clear();
    await settle();
    expect(ln.cancel).not.toHaveBeenCalled(); // it waits its turn

    release();
    await Promise.all([first, cleared]);
    // The rebuild's schedule, then the clear's cancel: nothing is left pending.
    expect(calls).toEqual([
      'checkPermissions',
      'getPending',
      'cancel',
      'registerActionTypes',
      'schedule',
      'getPending',
      'cancel',
    ]);
  });

  it('runs a rebuild asked for after a clear after it, not with one asked before', async () => {
    const { Nudges, Progress } = await launch();
    Progress.update(PAST_TUTORIAL);
    granted();
    let release: () => void = () => {};
    ln.getPending.mockImplementationOnce(() => {
      calls.push('getPending');
      return new Promise((r) => (release = () => r({ notifications: [] })));
    });
    const t0 = new Date(2026, 8, 22, 8, 0).getTime();
    const first = Nudges.rebuild(new Date(t0));
    await settle();

    // A grant asks while the foreground's run is held, then the switch goes
    // off and straight back on.
    const before = Nudges.rebuild(new Date(t0 + 300));
    Progress.setReminders(false);
    const cleared = Nudges.clear();
    Progress.setReminders(true);
    const after = Nudges.rebuild(new Date(t0 + 600));
    release();
    await Promise.all([first, before, cleared]);
    expect(await after).toBeGreaterThan(0);
    // The clear, then a whole write: the reminders end up pending, as the
    // switch says. Joined to the ask before the clear, the write would come
    // first and the clear would take it away.
    expect(calls.slice(-6)).toEqual(['getPending', 'cancel', 'checkPermissions', 'getPending', 'cancel', 'schedule']);
  });

  it('clears once, not twice, for two asks with Reminders off', async () => {
    const { Nudges, Progress } = await launch();
    Progress.update(PAST_TUTORIAL);
    granted();
    Progress.setReminders(false);
    const t0 = new Date(2026, 8, 22, 8, 0).getTime();
    await Nudges.rebuild(new Date(t0));
    await Nudges.rebuild(new Date(t0 + 250));
    expect(ln.cancel).toHaveBeenCalledTimes(1);
    expect(ln.schedule).not.toHaveBeenCalled();
    expect(ln.checkPermissions).not.toHaveBeenCalled();
  });

  it('comes back 0, not a throw, when the plugin fails', async () => {
    const { Nudges, Progress } = await launch();
    Progress.update(PAST_TUTORIAL);
    granted();
    ln.schedule.mockRejectedValue(new Error('denied by the OS'));
    expect(await Nudges.rebuild()).toBe(0);
    // And the queue is not jammed by it.
    ln.schedule.mockResolvedValue(undefined);
    expect(await Nudges.rebuild(new Date(2026, 8, 22, 8, 0))).toBeGreaterThan(0);
  });

  it('keeps the 1.3 schedule() name only as a rebuild — it no longer asks', async () => {
    const { Nudges } = await launch();
    granted('prompt');
    const p = Nudges.schedule();
    expect(Nudges.promptPending).toBe(false);
    expect(await p).toBe(0);
    expect(ln.requestPermissions).not.toHaveBeenCalled();
  });
});

describe('permission, clear and delivered', () => {
  it('reports what iOS has, without asking', async () => {
    const { Nudges } = await launch();
    for (const [display, want] of [
      ['granted', 'granted'],
      ['denied', 'denied'],
      ['prompt', 'prompt'],
      ['prompt-with-rationale', 'prompt'],
    ]) {
      granted(display);
      expect(await Nudges.permission()).toBe(want);
    }
    ln.checkPermissions.mockRejectedValue(new Error('no plugin'));
    expect(await Nudges.permission()).toBe('denied');
    expect(ln.requestPermissions).not.toHaveBeenCalled();
  });

  it('clears the delivered ones on request', async () => {
    const { Nudges } = await launch();
    await Nudges.clearDelivered();
    expect(ln.removeAllDeliveredNotifications).toHaveBeenCalledTimes(1);
  });
});

describe('a reminder tap', () => {
  /** Install, then deliver a tap the way the plugin does. */
  async function tapped(extra: unknown) {
    const env = await launch();
    let fire: (a: unknown) => void = () => {};
    ln.addListener.mockReset();
    ln.addListener.mockImplementation((_e: string, fn: (a: unknown) => void) => {
      fire = fn;
      return Promise.resolve({ remove: () => Promise.resolve() });
    });
    const onTap = vi.fn();
    env.Nudges.installTapListener(onTap);
    env.Nudges.installTapListener(onTap); // once is enough
    expect(ln.addListener).toHaveBeenCalledTimes(1);
    expect(ln.addListener.mock.calls[0][0]).toBe('localNotificationActionPerformed');
    fire({ actionId: 'tap', notification: { id: 8101, title: '', body: '', extra } });
    expect(onTap).toHaveBeenCalledTimes(1);
    return env;
  }

  it('routes to today’s fold once, then forgets it', async () => {
    const { Nudges, Progress } = await tapped({ route: 'daily', kind: 'ready-today', forDay: '2026-09-22' });
    Progress.update(PAST_TUTORIAL);
    expect(Nudges.takeRoute()).toBe('daily');
    expect(Nudges.takeRoute()).toBeNull();
  });

  it('routes to the menu for a player still in the tutorial, or with today folded', async () => {
    const early = await tapped({ route: 'daily' });
    expect(early.Nudges.takeRoute()).toBeNull();

    const done = await tapped({ route: 'daily' });
    done.Progress.update(PAST_TUTORIAL);
    done.Progress.recordDaily(todayISO(), { ms: 1000, deaths: 0, foldSense: 0 });
    expect(done.Nudges.takeRoute()).toBeNull();
  });

  it('has no route without a tap', async () => {
    const { Nudges, Progress } = await launch();
    Progress.update(PAST_TUTORIAL);
    expect(Nudges.takeRoute()).toBeNull();
  });

  it('leaves a warm tap for the Menu, which checks it again when it takes it', async () => {
    const { Nudges, Progress, PENDING_ROUTE } = await launch();
    Progress.update(PAST_TUTORIAL);
    const reg = new Map<string, unknown>();
    const registry = { get: (k: string) => reg.get(k), remove: (k: string) => reg.delete(k) };

    expect(Nudges.takePendingRoute(registry)).toBeNull();
    reg.set(PENDING_ROUTE, 'daily');
    expect(Nudges.takePendingRoute(registry)).toBe('daily');
    expect(reg.has(PENDING_ROUTE)).toBe(false);

    // Folded in the meantime: the flag is spent and routes nowhere.
    reg.set(PENDING_ROUTE, 'daily');
    Progress.recordDaily(todayISO(), { ms: 1000, deaths: 0, foldSense: 0 });
    expect(Nudges.takePendingRoute(registry)).toBeNull();
    expect(reg.has(PENDING_ROUTE)).toBe(false);
  });
});

describe('the reminder time label', () => {
  it('follows the player: 19:00 by default, their hour once learned', async () => {
    const { Nudges, Progress } = await launch();
    Progress.update({ sessionMinutes: [] });
    expect(Nudges.reminderTimeLabel()).toBe('7 pm');
    Progress.update({ sessionMinutes: [600, 610, 620] });
    expect(Nudges.reminderTimeLabel()).toBe('9:45 am');
  });
});

describe('the soft ask', () => {
  it('covers the cap, the spacing and a decided permission', async () => {
    const { Nudges } = await launch();
    const save = { nudgeAsks: 0, nudgeAskedOn: '', reminders: true };
    expect(Nudges.shouldSoftAsk(save, '2026-09-22', 'prompt')).toBe(true);
    expect(Nudges.shouldSoftAsk(save, '2026-09-22', 'granted')).toBe(false);
    expect(Nudges.shouldSoftAsk(save, '2026-09-22', 'denied')).toBe(false);
    expect(Nudges.shouldSoftAsk({ ...save, nudgeAsks: 3, nudgeAskedOn: '2026-08-01' }, '2026-09-22', 'prompt')).toBe(false);
    expect(Nudges.shouldSoftAsk({ ...save, nudgeAsks: 1, nudgeAskedOn: '2026-09-20' }, '2026-09-22', 'prompt')).toBe(false);
    expect(Nudges.shouldSoftAsk({ ...save, nudgeAsks: 1, nudgeAskedOn: '2026-09-15' }, '2026-09-22', 'prompt')).toBe(true);
  });
});
