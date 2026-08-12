/**
 * Rate — the native review prompt, spent once, at a delight peak.
 *
 * The OS gives no callback and throttles to roughly three prompts a year, so
 * there is exactly one good ask and it has to land after a win the player is
 * proud of — never after a failure, and never in the same beat as an ad.
 */

import { Capacitor } from '@capacitor/core';
import { InAppReview } from '@capacitor-community/in-app-review';
import { monetization } from '../config/monetization';
import { APP_STORE_URL } from './WebDaily';
import { Progress } from './Progress';

class RateService {
  /**
   * @param adWillShow true if an interstitial is about to fire — in which case
   *                   we stay out of its way rather than stacking two
   *                   interruptions on one event.
   */
  shouldAsk(adWillShow: boolean): boolean {
    if (!Capacitor.isNativePlatform()) return false;
    if (adWillShow) return false;
    const save = Progress.data;
    if (save.ratePrompted) return false;
    return save.totalWins >= monetization.rate.firstPromptAfterWins;
  }

  async ask(): Promise<void> {
    Progress.update({ ratePrompted: true });
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
   * It also does not spend `ratePrompted`: that flag guards the one automatic
   * ask, and someone who came looking for the button has not used it up.
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
