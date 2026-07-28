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
}

export const Rate = new RateService();
