/**
 * Haptics — light on progress, medium on collision, a click when the ink
 * closes, one soft tap when the figure settles.
 *
 * The win used to be silent to the hand at the moment the ink closed, on the
 * reasoning that a buzz would step on the figure settling. The redesign
 * reverses that on purpose (SPEC §9, the owner's call): the close is the peak,
 * and a crisp click there — the pen clicking into the ring (`goal`) — is what
 * makes it physical. The settle still taps (`land`); if the two read as a
 * double on a device, the land tap is the one to drop. A medal gets the
 * notification pattern (`success`). Things the player receives — a purchase, a
 * streak going up, a chapter completed — take `success` too, so the hand learns
 * one feel for "you got something", and a refusal (a locked card) takes `warn`
 * rather than the same light tap as a press that worked.
 *
 * Every tap goes through one gate, at least TAP_GAP_MS apart — see TapGate.
 *
 * Web is a no-op, and every call is fire-and-forget: haptics failing must never
 * be something the game loop waits on or notices.
 */

import { Capacitor } from '@capacitor/core';
import { Haptics as Native, ImpactStyle, NotificationType } from '@capacitor/haptics';

const isNative = (): boolean => Capacitor.isNativePlatform();

/**
 * At most `maxPerBurst` taps, at least `minGapMs` apart, per burst — where a
 * burst ends after `quietMs` with no request at all.
 *
 * For reward tokens. Six eyes landing 45ms apart asked for six taps in a
 * quarter of a second, which the Taptic Engine plays as one long buzz: three
 * distinct taps read as "several things arrived", six read as a fault.
 * Requests are counted whether or not they fire, so a long stream of them is
 * one burst and stays capped.
 */
export class BurstThrottle {
  private lastFired = Number.NEGATIVE_INFINITY;
  private lastAsked = Number.NEGATIVE_INFINITY;
  private fired = 0;

  constructor(
    private readonly minGapMs = 60,
    private readonly maxPerBurst = 3,
    private readonly quietMs = 300
  ) {}

  /** Whether a tap asked for at `now` (ms, any monotonic clock) should play. */
  allow(now: number): boolean {
    if (now - this.lastAsked >= this.quietMs) this.fired = 0;
    this.lastAsked = now;
    if (this.fired >= this.maxPerBurst) return false;
    if (now - this.lastFired < this.minGapMs) return false;
    this.fired += 1;
    this.lastFired = now;
    return true;
  }
}

/** The least time between any two taps, ms (SPEC §2.5, "haptic hygiene"). */
export const TAP_GAP_MS = 70;
/**
 * The latest a tap that waits may play after the moment it belongs to, ms.
 * Later than this it is no longer that moment's tap, and it is dropped.
 */
export const TAP_MAX_LATE_MS = 140;

/**
 * Taptic hygiene: every tap in the game at least TAP_GAP_MS apart.
 *
 * Two impacts closer than that play as one smeared buzz on the Taptic Engine,
 * and the game asks for exactly that all the time: a flick crosses three rows
 * in one frame, a row tick lands 16 ms before the wall that kills the stroke,
 * the rumble fires as a row is passed. So each tap is booked here, and a tap
 * whose slot is taken is either DROPPED or MADE TO WAIT:
 *
 *  - dropped: the ones that are texture, where one more of the same says
 *    nothing — a row tick, the rumble, a reward token, a button press;
 *  - wait: the ones that ARE the moment — the death, the pen clicking into
 *    the goal, a star, a success. Those play at the next free slot, at most
 *    TAP_MAX_LATE_MS late. A death felt 54 ms late is still the death; a death
 *    swallowed because a row tick got there first is a missing beat.
 *
 * A booking reserves its slot, so a tap that is waiting also holds off the
 * texture that arrives before it plays. `earliest` lets a pattern book a later
 * beat now: the mirror's double knock is booked in one go.
 */
export class TapGate {
  private last = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly gapMs = TAP_GAP_MS,
    private readonly maxLateMs = TAP_MAX_LATE_MS
  ) {}

  /**
   * When a tap asked for at `now` (ms, any monotonic clock) plays — `now` or
   * later — or null when it is dropped.
   */
  book(now: number, wait: boolean, earliest: number = now): number | null {
    const want = Math.max(now, earliest);
    const at = Math.max(want, this.last + this.gapMs);
    if (at > want && (!wait || at - want > this.maxLateMs)) return null;
    this.last = at;
    return at;
  }
}

const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

/** Which death: the pen's own wall, or the reflection's. */
export type Knock = 'wall' | 'mirror';

type Play = () => Promise<unknown>;

class HapticsService {
  private enabled = true;
  private readonly rewards = new BurstThrottle();
  private readonly gate = new TapGate();

  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  /** One obstacle row safely passed: the tick under the row note. Texture. */
  tick(): void {
    this.impact(ImpactStyle.Light, false);
  }

  /** The stroke died. Prefer `pair(kind)`, which also says which side. */
  thud(): void {
    this.impact(ImpactStyle.Medium, true);
  }

  /**
   * The death's knock. A wall of the pen's own half: one Medium. The
   * reflection's: Medium, then a Light 70 ms later — the double knock that
   * tells the hand "the other side" before the eye has found the splat.
   */
  pair(kind: Knock): void {
    this.impact(ImpactStyle.Medium, true);
    if (kind === 'mirror') this.impact(ImpactStyle.Light, true, TAP_GAP_MS);
  }

  /** The line reached the goal: the pen clicks into the ring. */
  goal(): void {
    this.impact(ImpactStyle.Light, true);
  }

  /** A scrape survived — "close". */
  close(): void {
    this.impact(ImpactStyle.Light, true);
  }

  /** The board cleared after a death: the tock, THUD … tock. */
  ready(): void {
    this.impact(ImpactStyle.Light, true);
  }

  /** Star `i` (0, 1, 2) punched in: Light, Light, and Success for the third. */
  star(i: number): void {
    if (i >= 2) this.notify(NotificationType.Success, true);
    else this.impact(ImpactStyle.Light, true);
  }

  /** A button was pressed. */
  tap(): void {
    this.impact(ImpactStyle.Light, false);
  }

  /** The win figure has settled — an ordinary win. */
  land(): void {
    this.impact(ImpactStyle.Light, true);
  }

  /** Something was earned: the medal stamp, a purchase, the streak up, a chapter done. */
  success(): void {
    this.notify(NotificationType.Success, true);
  }

  /** A refusal: a locked card, the locked Daily. */
  warn(): void {
    this.notify(NotificationType.Warning, true);
  }

  /** A setting changed. */
  select(): void {
    this.selection();
  }

  /**
   * The stroke slipped into a wall's danger zone — the rumble strip. The
   * caller throttles it to its own rhythm (Proximity: one per 180 ms); the
   * gate only keeps it off the other taps.
   */
  rumble(): void {
    this.selection();
  }

  /** A reward token landed. Throttled — see BurstThrottle. */
  reward(): void {
    if (!this.enabled || !isNative()) return;
    if (!this.rewards.allow(now())) return;
    this.impact(ImpactStyle.Light, false);
  }

  private selection(): void {
    /*
     * All three calls, in order. The plugin's `selectionChanged` only speaks
     * through a generator that `selectionStart` created — on iOS it is a silent
     * no-op on its own — and `selectionEnd` lets the generator go again.
     */
    this.play(async () => {
      await Native.selectionStart();
      await Native.selectionChanged();
      await Native.selectionEnd();
    }, false);
  }

  private impact(style: ImpactStyle, wait: boolean, afterMs = 0): void {
    this.play(() => Native.impact({ style }), wait, afterMs);
  }

  private notify(type: NotificationType, wait: boolean): void {
    this.play(() => Native.notification({ type }), wait);
  }

  /** Book a tap through the gate and play it at its slot. */
  private play(fire: Play, wait: boolean, afterMs = 0): void {
    if (!this.enabled || !isNative()) return;
    const t = now();
    const at = this.gate.book(t, wait, t + afterMs);
    if (at === null) return;
    const run = (): void => {
      // The switch may have gone off while it waited.
      if (!this.enabled) return;
      void fire().catch(() => {
        /* ignore */
      });
    };
    if (at <= t) run();
    else setTimeout(run, at - t);
  }
}

export const Haptics = new HapticsService();
