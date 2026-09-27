/// <reference types="vite/client" />

/**
 * The build-time switches the app reads. Vite folds every read to a literal,
 * so an unset variable is `undefined` here, a dead branch is tree-shaken, and a
 * grep of the bundle can prove a build mode. Where each is read and what it
 * does: src/systems/adProvider.ts ("Build modes") and, for VITE_AD_MODE,
 * src/systems/providers/levelplay.ts.
 */
interface ImportMetaEnv {
  /** `live` declares the App Store build. Anything else is test mode — which on LevelPlay still serves REAL ads. */
  readonly VITE_AD_MODE?: string;
  /** `off` builds a binary with no ad surface at all (marker ADS:off); `mock` draws fake ads in the DOM (ADS:mock). */
  readonly VITE_ADS?: string;
  /** `1` builds the browser-only Daily Fold — see src/systems/WebDaily.ts. */
  readonly VITE_WEB_DAILY?: string;
  /**
   * The marketing version, e.g. `1.4`. Not an env switch: vite.config.ts defines
   * it from the Xcode project on every build, dev server and test run. Read by
   * the Settings footer and src/systems/Rate.ts.
   */
  readonly VITE_APP_VERSION?: string;
}
