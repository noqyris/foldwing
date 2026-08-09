/**
 * WebDaily — the browser-only Daily Fold build.
 *
 * The Wordle lesson: the viral front door has to be playable with zero
 * install. This flag carves that product out of the same codebase — the
 * deployed page at noqyris.com boots straight into today's fold, hides
 * every surface that assumes the full app (menu, level select, store), and
 * funnels a finished player toward the App Store, where the other 300
 * levels live.
 *
 * Set at BUILD time (`VITE_WEB_DAILY=1 vite build`) for the deployed page;
 * the `?daily` query is a dev convenience so the mode is testable against
 * the normal dev server.
 */

import { Capacitor } from '@capacitor/core';

export const WEB_DAILY: boolean =
  !Capacitor.isNativePlatform() &&
  (import.meta.env.VITE_WEB_DAILY === '1' ||
    (typeof location !== 'undefined' && new URLSearchParams(location.search).has('daily')));

export const APP_STORE_URL = 'https://apps.apple.com/app/id6794804195';
