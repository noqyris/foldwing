/**
 * Nudges — one quiet reminder a day that today's fold is waiting.
 *
 * LOCAL, NOT PUSH. There is no server behind this game and no reason to build
 * one for a reminder the phone can schedule itself: local notifications need no
 * APNs certificate, no backend, no device token, and they fire with the phone in
 * flight mode. A push stack would be infrastructure to run forever in exchange
 * for nothing this feature needs.
 *
 * NINE LINES, ROTATING. A reminder that says the same sentence every evening
 * stops being read within a week and gets the app's notifications switched off
 * — which is worse than never having asked. The line is picked from the day
 * number, so it cycles rather than repeating, and no two consecutive days ever
 * read alike.
 *
 * The permission is asked for LATE, not at launch. A prompt in the first ten
 * seconds, before the game has given anybody a reason to want it, is how an app
 * spends its one permission ask for nothing.
 */
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';

/**
 * The evening, local time.
 *
 * Late enough that the day's fold is genuinely still unplayed for most people,
 * early enough not to arrive at bedtime.
 */
export const NUDGE_HOUR = 19;

/** How far ahead the schedule is written, in days. */
export const HORIZON_DAYS = 14;

/**
 * Nine, deliberately: enough that a fortnight of reminders never repeats a line
 * on consecutive days, few enough that each one could be written properly.
 *
 * They say what is waiting rather than demanding a return — "your fold is
 * ready" is an invitation, "come back!" is a landlord.
 */
export const LINES: readonly { title: string; body: string }[] = [
  { title: 'Your daily fold is ready', body: "Today's maze is the same one everyone else is drawing." },
  { title: 'A new fold, everyone at once', body: 'One maze a day, the same for the whole world.' },
  { title: 'Today’s fold is waiting', body: 'One line, two answers. See how close you get.' },
  { title: 'The mirror has a new maze', body: 'Draw one line and let the other half survive it.' },
  { title: 'Your fold is folded', body: 'Today’s maze is up. The clock starts when you do.' },
  { title: 'One maze, one line', body: 'The Daily Fold resets at midnight. Yours is ready now.' },
  { title: 'Somebody has already beaten today', body: 'See what the fold looks like from your hand.' },
  { title: 'A fresh fold', body: 'The obstacles moved. The mirror did not.' },
  { title: 'Today’s fold is unplayed', body: 'It takes a minute, and it is different tomorrow.' },
];

/** Same line for the same day, and never the same on two days running. */
export function lineFor(dayNumber: number): { title: string; body: string } {
  return LINES[((dayNumber % LINES.length) + LINES.length) % LINES.length];
}

/** Days since the epoch, in LOCAL time — the day the player is living in. */
export function localDayNumber(d: Date): number {
  return Math.floor(
    (d.getTime() - d.getTimezoneOffset() * 60_000) / 86_400_000
  );
}

/**
 * Ids are derived from the day number so a reschedule REPLACES rather than
 * stacks. Rescheduling on every launch is what keeps the horizon full, and
 * without stable ids that would mean fourteen new notifications a day.
 */
const ID_BASE = 8100;
const idFor = (day: number): number => ID_BASE + (day % 1000);

class NudgeService {
  private asked = false;

  get available(): boolean {
    return Capacitor.isNativePlatform();
  }

  /**
   * Ask, once, and only when called from somewhere that has earned it.
   *
   * @returns whether notifications may be posted.
   */
  async request(): Promise<boolean> {
    if (!this.available) return false;
    try {
      const current = await LocalNotifications.checkPermissions();
      if (current.display === 'granted') return true;
      // 'denied' is a decision, not a state to nag about: iOS shows the system
      // prompt once and every later request resolves denied without any UI.
      if (current.display === 'denied' || this.asked) return false;
      this.asked = true;
      const asked = await LocalNotifications.requestPermissions();
      return asked.display === 'granted';
    } catch {
      return false;
    }
  }

  /**
   * Fill the next fortnight, replacing whatever was there.
   *
   * Cheap and idempotent, so it can run on every launch — which is what keeps
   * the horizon from draining for somebody who plays daily and never reinstalls.
   */
  async schedule(now = new Date()): Promise<number> {
    if (!this.available) return 0;
    if (!(await this.request())) return 0;

    const today = localDayNumber(now);
    const notifications = [];
    for (let i = 1; i <= HORIZON_DAYS; i++) {
      const day = today + i;
      const at = new Date(now);
      at.setDate(at.getDate() + i);
      at.setHours(NUDGE_HOUR, 0, 0, 0);
      const line = lineFor(day);
      notifications.push({
        id: idFor(day),
        title: line.title,
        body: line.body,
        schedule: { at, allowWhileIdle: false },
      });
    }

    try {
      // Clear ours first. Ids are stable, so this only ever removes reminders
      // this code wrote.
      const pending = await LocalNotifications.getPending();
      const mine = pending.notifications.filter((n) => n.id >= ID_BASE && n.id < ID_BASE + 1000);
      if (mine.length) await LocalNotifications.cancel({ notifications: mine });
      await LocalNotifications.schedule({ notifications });
      return notifications.length;
    } catch {
      return 0;
    }
  }

  /** Stop reminding. Leaves the OS permission alone — that is the player's. */
  async clear(): Promise<void> {
    if (!this.available) return;
    try {
      const pending = await LocalNotifications.getPending();
      const mine = pending.notifications.filter((n) => n.id >= ID_BASE && n.id < ID_BASE + 1000);
      if (mine.length) await LocalNotifications.cancel({ notifications: mine });
    } catch {
      /* nothing to clear is the same outcome */
    }
  }
}

export const Nudges = new NudgeService();
