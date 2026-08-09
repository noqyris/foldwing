/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the bundle works inside the Capacitor iOS/Android shell.
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
  },
  server: {
    host: true,
    port: 5173,
  },
  test: {
    // Everything under test is pure math with no DOM dependency, so the fast
    // node environment is enough. Phaser is never imported by a test.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    /*
     * Pinned to a non-UTC zone on purpose.
     *
     * The Daily Fold rolls over at the player's LOCAL midnight and the reveal
     * top-up used to roll over at UTC's — the whole point of the tests around
     * CalendarDay is that those two differ. On a UTC runner they do not, so the
     * assertions that catch the bug pass vacuously. Belgrade is the author's
     * zone and has DST, which the shiftISO tests also want.
     */
    env: { TZ: 'Europe/Belgrade' },
  },
});
