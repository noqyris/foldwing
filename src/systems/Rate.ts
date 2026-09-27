/**
 * Rate — the native review prompt, spent at most once per app version, and
 * only at a peak.
 *
 * The OS gives no callback and throttles to three prompts in 365 days, and the
 * HIG asks for the moment after engagement, never an interruption. So the one
 * ask a version gets has to land after something the player is proud of, and
 * the rules below are mostly about which wins it may NOT land on:
 *
 *  - a peak only: a medal from level 10 on, or the first finish of today's
 *    Daily that takes the streak to three or more. An ordinary clear is not
 *    one, however many there have been;
 *  - not on the first day the game is played: from the second on;
 *  - not after a struggle (six or more strokes on the level), and not in a
 *    session with a skip or a purchase in it — a player who was just let past
 *    a level, or just paid, is not at a peak whatever the win says;
 *  - never in the same beat as an ad, another ask on the win card, or the
 *    notification permission alert.
 *
 * The rules are `shouldAskAt`, a pure function; the service only gathers what
 * it reads — the platform, the alert, the save and the session.
 */

import { Capacitor } from '@capacitor/core';
import { InAppReview } from '@capacitor-community/in-app-review';
import { APP_STORE_URL } from './WebDaily';
import { Nudges } from './Nudges';
import { Progress } from './Progress';
import { onSessionStart } from './SessionLifecycle';

/**
 * This build's marketing version, as vite.config.ts reads it from the Xcode
 * project: the string the Settings footer shows, and the key of the
 * once-per-version rule.
 */
const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? '';

/** The numbers behind the rules above. Not money, so not in the monetization config. */
export const RATE_RULES = {
  /** A medal counts from level 10 (index 9): by then the player has chosen the game. */
  medalFromIndex: 9,
  /** A Daily counts once it takes the streak to this many days. */
  streakFrom: 3,
  /** Distinct play days before the first ask: never on the day of the install. */
  fromPlayDay: 2,
  /**
   * Strokes on the level that make the win a relief rather than a peak — the
   * point at which the rescue ladder offers the skip.
   */
  struggleAttempts: 6,
} as const;

/** The win the ask would follow, as GameScene.win knows it. */
export interface RateWin {
  /** The campaign level's index; null for the Daily Fold. */
  readonly levelIndex: number | null;
  /** Beat the medal ratio of par. Never set on a Daily, which claims no medal. */
  readonly medal: boolean;
  /** The first finish of TODAY's Daily — not a replay, not yesterday's after midnight. */
  readonly todayDailyFirst: boolean;
  /** The streak this win took the run to; 0 when it did not move it. */
  readonly streakAfter: number;
  /** Strokes started on the level this visit, the winning one included. */
  readonly attempts: number;
}

/** What else the win is doing — see `shouldAskAt`. */
export interface RateMoment {
  /** An interstitial is about to fire on the way out. */
  readonly adWillShow: boolean;
  /**
   * The win card already asks for something: [Remind me], or the chapter
   * doubler's rewarded ad. One ask per moment, and those were there first.
   */
  readonly quiet?: boolean;
  readonly win: RateWin;
}

/** Everything else the rules read, gathered by `Rate.shouldAsk`. */
export interface RateContext {
  /** This build's marketing version; '' when the build does not know it. */
  readonly version: string;
  /** The version the ask was last spent on (`SaveData.ratePromptedVersion`). */
  readonly promptedVersion: string;
  /** Distinct local days the game has been played on (`SaveData.playDays`). */
  readonly playDays: number;
  /** A level was skipped this session. */
  readonly skipped: boolean;
  /** Something was bought this session, or an Ask to Buy approval landed. */
  readonly purchased: boolean;
}

/** A win worth asking after: a late medal, or a Daily that makes a streak. */
export function isPeak(win: RateWin): boolean {
  if (win.levelIndex !== null) return win.medal && win.levelIndex >= RATE_RULES.medalFromIndex;
  return win.todayDailyFirst && win.streakAfter >= RATE_RULES.streakFrom;
}

/**
 * Whether this win may spend the version's one review prompt. Standing down
 * spends nothing: the next peak asks instead.
 */
export function shouldAskAt(moment: RateMoment, ctx: RateContext): boolean {
  const { adWillShow, quiet = false, win } = moment;
  // One interruption per moment: an ad or the card's own ask was there first.
  if (adWillShow || quiet) return false;
  // Once per version — and a build that cannot name its version cannot keep
  // that promise, so it does not ask at all.
  if (ctx.version === '' || ctx.promptedVersion === ctx.version) return false;
  if (ctx.playDays < RATE_RULES.fromPlayDay) return false;
  if (ctx.skipped || ctx.purchased) return false;
  if (win.attempts >= RATE_RULES.struggleAttempts) return false;
  return isPeak(win);
}

class RateService {
  /** A purchase landed this session. */
  private purchased = false;
  /** `Progress.skipsSinceLaunch` when this session began. */
  private skipsBefore = 0;

  constructor() {
    /*
     * Purchases are heard, not asked about: every one — bought, restored, or
     * an Ask to Buy approved while the player was elsewhere — is announced
     * through onGrant. Never returns true, which would tell Progress the grant
     * was shown and hide it from the scene that should show it.
     */
    Progress.onGrant((g) => {
      if (g.reason === 'purchase' || g.reason === 'late-purchase') this.purchased = true;
    });
    /*
     * A new session forgets the last one's skips and purchases. The app's one
     * rule (core/Session via SessionLifecycle — 30 minutes away, or a new day),
     * the same the ad cadence hears. This used to be a private copy, which
     * measured an absence from the LAST hide and knew no midnight: a process
     * kept alive in the background for days carried a Monday purchase into
     * Thursday's wins.
     */
    onSessionStart((reason) => {
      if (reason !== 'return') return;
      this.purchased = false;
      this.skipsBefore = Progress.skipsSinceLaunch;
    });
  }

  /**
   * Whether this win may spend the version's review prompt — see the header,
   * and `shouldAskAt` for the rules themselves.
   */
  shouldAsk(moment: RateMoment): boolean {
    if (!Capacitor.isNativePlatform()) return false;
    /*
     * Nor while the notification permission alert is up. It follows a tap on
     * [Remind me] — the one path to it — and a review requested a second later
     * lands under it and iOS never shows it, yet the version below was already
     * spent, so its one ask was gone. Standing down here costs nothing: the
     * next peak asks instead.
     */
    if (Nudges.promptPending) return false;
    const save = Progress.data;
    return shouldAskAt(moment, {
      version: APP_VERSION,
      promptedVersion: save.ratePromptedVersion,
      playDays: save.playDays,
      skipped: Progress.skipsSinceLaunch > this.skipsBefore,
      purchased: this.purchased,
    });
  }

  async ask(): Promise<void> {
    // Checked again at the moment of asking, which is a beat after shouldAsk:
    // a permission alert that went up in between still wins, and the version
    // is left unspent for the next peak.
    if (Nudges.promptPending) return;
    // `ratePrompted` too, for a build before 1.4 that this save may yet meet:
    // it reads that flag as spent for good, and so it should.
    Progress.update({ ratePrompted: true, ratePromptedVersion: APP_VERSION });
    try {
      await InAppReview.requestReview();
    } catch {
      /* the prompt is a nicety; never let it surface as an error */
    }
  }

  /**
   * The player ASKED to rate it — a tap on "Rate this game", not the automatic
   * prompt.
   *
   * This goes to the App Store review page rather than through
   * `requestReview()`, and the difference matters. The OS prompt is throttled
   * to roughly three a year per user and gives no callback, so a player who
   * deliberately taps a button is very likely to get nothing at all — a control
   * that visibly does nothing, which is worse than not offering it. The web
   * link always opens, and it opens on the write-a-review sheet.
   *
   * It also spends nothing: `ratePromptedVersion` guards the automatic ask,
   * and someone who came looking for the button has not used it up.
   */
  async openStoreListing(): Promise<void> {
    try {
      window.open(`${APP_STORE_URL}?action=write-review`, '_blank');
    } catch {
      /* nothing to recover; the button simply did not open a page */
    }
  }
}

export const Rate = new RateService();
