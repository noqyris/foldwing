/**
 * Haptics — light on progress, medium on collision, nothing on the win.
 *
 * The win is deliberately silent to the hand. The figure settling is a visual
 * beat and a buzz would step on it; the absence of feedback at exactly the
 * moment the player expects some is what makes the moment feel calm.
 *
 * Web is a no-op, and every call is fire-and-forget: haptics failing must never
 * be something the game loop waits on or notices.
 */

import { Capacitor } from '@capacitor/core';
import { Haptics as Native, ImpactStyle } from '@capacitor/haptics';

const isNative = (): boolean => Capacitor.isNativePlatform();

class HapticsService {
  private enabled = true;

  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  /** One obstacle safely passed. */
  tick(): void {
    this.impact(ImpactStyle.Light);
  }

  /** The stroke died. */
  thud(): void {
    this.impact(ImpactStyle.Medium);
  }

  /** A button was pressed. */
  tap(): void {
    this.impact(ImpactStyle.Light);
  }

  private impact(style: ImpactStyle): void {
    if (!this.enabled || !isNative()) return;
    void Native.impact({ style }).catch(() => {
      /* ignore */
    });
  }
}

export const Haptics = new HapticsService();
