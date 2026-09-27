/// <reference types="vitest" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

/** Portfolio-shared code is ALIASED, never copied (mobile-game-playbook). */
const SHARED = fileURLToPath(new URL('../../shared', import.meta.url));

/**
 * The app's marketing version, for the Settings footer and the review prompt's
 * once-per-version rule (src/systems/Rate.ts), which must agree on it.
 *
 * Read, never written, from the Xcode project: the first MARKETING_VERSION in
 * it, which is the number the last archive was built under. fastlane's
 * build_ipa writes the App Store Connect version there, but only AFTER the web
 * build, so the first build of a new version still says the previous one
 * unless the project was bumped first. A checkout without the iOS project
 * falls back to package.json. No build number: fastlane picks that later too.
 */
function appVersion(): string {
  const read = (path: string): string | null => {
    try {
      return readFileSync(new URL(path, import.meta.url), 'utf8');
    } catch {
      return null;
    }
  };
  const pbxproj = read('./ios/App/App.xcodeproj/project.pbxproj');
  const marketing = pbxproj && /\bMARKETING_VERSION = "?([^";\s]+)"?;/.exec(pbxproj);
  if (marketing) return marketing[1];
  try {
    const version = (JSON.parse(read('./package.json') ?? '{}') as { version?: unknown }).version;
    return typeof version === 'string' ? version : '';
  } catch {
    return '';
  }
}

export default defineConfig({
  // Relative base so the bundle works inside the Capacitor iOS/Android shell.
  base: './',
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion()),
  },
  resolve: {
    alias: {
      // The Noqyris studio intro — one master for every app (render/Intro.ts).
      '@noqyris/splash': `${SHARED}/noqyris-splash/src/index.ts`,
    },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
  },
  server: {
    host: true,
    port: 5173,
    // The dev server may also serve repository/shared (the intro clip lives there).
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), SHARED] },
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
    /*
     * Twenty seconds, not vitest's five. The store and save tests reset the
     * module graph and import the StoreKit bridge fresh, which is quick on an
     * idle machine and took over five seconds at a load average near 400 —
     * and every release chain runs this suite, so a busy Mac must not fail a
     * build that is correct. A test that genuinely hangs still fails.
     */
    testTimeout: 20_000,
  },
});
