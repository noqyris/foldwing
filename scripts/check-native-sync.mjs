// Verifies what a NATIVE project is actually holding, AFTER `cap sync`.
//
// WHY THIS IS A SEPARATE STEP. These checks used to live inside
// check-no-google.mjs, which every release chain runs BEFORE `cap sync`:
//
//   build → check-ad-mode → check-no-google → cap sync
//
// At that moment `dist/` is the new bundle and the native project still holds
// the previous one, so comparing them is comparing before with after. On the
// App Store chain — where `dist/` has just become LIVE and iOS still holds the
// previous mode — the comparison failed and `&&` aborted the chain, leaving a
// LIVE bundle sitting in dist/ and no sync at all. The gate meant to protect the
// two-build release was the thing that blocked it. (KVIZKO learned this; the
// script is ported from there.)
//
// Run AFTER the sync instead, and the comparison is the one worth making: does
// the native project now carry exactly the bundle the gate just approved.
//
//   node scripts/check-native-sync.mjs ios live    # after ios:appstore's sync
//   node scripts/check-native-sync.mjs ios off     # after ios:sync:adsoff's sync (TestFlight)
//   node scripts/check-native-sync.mjs ios mock    # after ios:sync:mock's sync (simulator only)
//
// Both arguments are required. A missing directory or a missing marker is a
// FAILURE here, never a skip: this script is only ever invoked for a platform
// that was just synced, so "nothing to look at" means the sync did not happen.
//
// On iOS it also proves the CocoaPods side (section 5): the web bundle can be
// perfect while the binary links no ad network at all, and nothing else in the
// build says so. And the scene manifest (section 6): without it an app built
// with the iOS 27 SDK does not launch at all.
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

const WEB_DIR = {
  ios: 'ios/App/App/public/assets',
  android: 'android/app/src/main/assets/public/assets',
}

// What the bundle must carry per target — the same targets, and the same
// exact-once contract, as scripts/check-ad-mode.mjs. `off` (VITE_ADS=off) is
// test mode AND an ad layer that never initialises: the only build TestFlight
// gets, because every ADS:on build serves the real waterfall.
//        ADMODE:test  ADMODE:live  ADS:on  ADS:off  ADS:mock
const TARGETS = {
  test: { test: 1, live: 0, on: 1, off: 0, mock: 0 },
  live: { test: 0, live: 1, on: 1, off: 0, mock: 0 },
  off: { test: 1, live: 0, on: 0, off: 1, mock: 0 },
  mock: { test: 1, live: 0, on: 0, off: 0, mock: 1 },
}
const DESCRIBE = { test: 'TEST-mode ads (real waterfall)', live: 'LIVE ads', off: 'ADS OFF', mock: 'FAKE ads (mock provider)' }

const [platform, expected] = process.argv.slice(2)
if (!WEB_DIR[platform] || !TARGETS[expected]) {
  console.error('usage: node scripts/check-native-sync.mjs <ios|android> <test|live|off|mock>')
  process.exit(2)
}

const dir = WEB_DIR[platform]
const fail = (msg, hint) => {
  console.error(`\n✗ native-sync (${platform}): ${msg}`)
  if (hint) console.error(`  ${hint}`)
  process.exit(1)
}

if (!existsSync(dir)) {
  fail(`${dir} does not exist`, `\`cap sync ${platform}\` did not run, or it failed. Nothing was verified.`)
}

const js = readdirSync(dir).filter((f) => f.endsWith('.js'))
if (!js.length) fail(`${dir} holds no JavaScript`, 'The sync copied nothing — do not archive this project.')
const bundle = js.map((f) => readFileSync(join(dir, f), 'utf8')).join('')

// 1 ── a boot-mode build must never reach a native project: the ad-id capture
//      screen and the Test Suite entry both carry ADMODE:test + ADS:on like the
//      plain test build, so only their own marker tells them apart from it.
if (bundle.includes('ADIDCAPTURE:1')) {
  fail(
    'holds an AD-ID CAPTURE build',
    'That ships an advertising-id readout instead of the game. Rebuild without VITE_ADID_CAPTURE.',
  )
}
if (bundle.includes('TESTSUITE:1')) {
  fail(
    'holds a TEST SUITE build',
    'That ships the Test Suite entry instead of the game. Rebuild without VITE_TESTSUITE.',
  )
}

// 2 ── the mode AND the ads switch in the native project must be what was
//      asked for. Count the markers — "exactly once" is the contract, and a
//      doubled one means a stale chunk sits beside a fresh one.
const count = (literal) => bundle.split(literal).length - 1
const seen = {
  test: count('ADMODE:test'),
  live: count('ADMODE:live'),
  on: count('ADS:on'),
  off: count('ADS:off'),
  mock: count('ADS:mock'),
}
console.log(
  `native-sync (${platform}) — target ${expected.toUpperCase()}; markers seen: ` +
    `ADMODE:test ×${seen.test}  ADMODE:live ×${seen.live}  ADS:on ×${seen.on}  ADS:off ×${seen.off}  ADS:mock ×${seen.mock}`,
)
if (seen.test + seen.live !== 1) {
  fail(
    seen.test + seen.live === 0 ? 'carries no ADMODE marker' : 'carries more than one ADMODE marker',
    'The bundle predates the marker, the provider was changed, or a stale chunk is in it. It cannot be proven safe — do not ship it.',
  )
}
if (seen.on + seen.off + seen.mock !== 1) {
  fail(
    seen.on + seen.off + seen.mock === 0 ? 'carries no ADS marker (ADS:on / ADS:off / ADS:mock)' : 'carries more than one ADS marker',
    'The bundle predates VITE_ADS, or a stale chunk is in it. It cannot be proven — do not ship it.',
  )
}
// `mock` is checked BEFORE `off`: a fake-ads bundle bakes ADMODE:test like an
// ordinary test build, so without its own branch it read as `test` and the mock
// sync chain failed against its own target — which is what happened the first
// time KVIZKO ran this, on 2026-09-14.
const actual = seen.live
  ? seen.off || seen.mock
    ? 'live-contradiction'
    : 'live'
  : seen.mock
    ? 'mock'
    : seen.off
      ? 'off'
      : 'test'
if (actual === 'live-contradiction') {
  fail(
    `carries ADMODE:live with ${seen.off ? 'ADS:off' : 'ADS:mock'}`,
    'A store build that never loads a real ad is a contradiction, not a mode. Rebuild without VITE_ADS.',
  )
}
if (actual !== expected) {
  fail(
    `carries ${DESCRIBE[actual]} but ${DESCRIBE[expected]} was requested`,
    actual === 'off' && expected === 'test'
      ? 'An ads-off bundle never passes as the ads-on test build. If you meant it, the target is `off` (ios:sync:adsoff).'
      : actual === 'test' && expected === 'off'
        ? "This bundle loads the REAL waterfall. TestFlight would put it on the owner's phone — rebuild with VITE_ADS=off."
        : 'The sync copied a different build than the one the gate approved. Re-run the whole chain.',
  )
}

// 2b ── the fake STORE (src/systems/iapMock.ts) is the mock build's alone, as
//       in check-ad-mode: its "FAKE PURCHASE" sheet grants reveals without
//       StoreKit, so the native project of any other target must not hold it.
if (expected !== 'mock' && /FAKE\s+PURCHASE/i.test(bundle)) {
  fail(
    'holds the FAKE STORE ("FAKE PURCHASE"), which only the mock build may carry',
    'The mock iap was not tree-shaken out, or a stale mock chunk was synced. Rebuild with the matching npm chain.',
  )
}

// 3 ── and it must be the bundle that was just built, not an older one with the
//      same mode. Same mode is not the same build: a stale sync of a
//      same-mode bundle is invisible to the check above.
const distDir = 'dist/assets'
if (existsSync(distDir)) {
  const distJs = readdirSync(distDir).filter((f) => f.endsWith('.js'))
  const missing = distJs.filter((f) => !js.includes(f))
  if (missing.length) {
    fail(
      `dist/ has ${missing.length} file(s) the native project does not: ${missing.slice(0, 3).join(', ')}`,
      `\`cap sync ${platform}\` ran against a different build. Re-run it.`,
    )
  }
}

// 4 ── a LIVE Android build must not still carry the Play Games placeholder.
//      Leaderboards and achievements do not crash on a wrong project id; sign-in
//      just fails and the boards stay empty forever, which is the failure nobody
//      investigates. Foldwing has no android/ today; kept so the day one is
//      added, the live chain already knows.
if (platform === 'android' && expected === 'live') {
  const strings = 'android/app/src/main/res/values/strings.xml'
  const xml = existsSync(strings) ? readFileSync(strings, 'utf8') : ''
  const id = (xml.match(/name="game_services_project_id"[^>]*>([^<]*)</) ?? [])[1]?.trim()
  if (!id || /^0+$/.test(id)) {
    fail(
      `still carries the Play Games placeholder id (${id || 'missing'})`,
      'Put the numeric id from Play Console → Play Games Services → Configuration into\n' +
        `  ${strings}. Sign-in fails silently without it — the boards simply stay empty.`,
    )
  }
}

// 5 ── iOS on CocoaPods: the binary must link LevelPlay AND its adapters, from
//      an install that is current.
//
//      The trap this closes is silent. `cap sync ios` runs `pod install` inside
//      its update step and only THEN runs the `capacitor:sync:after` hook
//      (capacitor-levelplay-ads' levelplay-manifest.js), which is what writes
//      the adapter pods into the Podfile. So the sync's own install never sees
//      the adapters; Xcode's `[CP] Check Pods Manifest.lock` phase only
//      compares the two lock files with each other, so the build still passes,
//      and the result is a binary with the LevelPlay SDK and no Unity Ads
//      adapter — a waterfall with nothing in it, reported by nobody. Every
//      chain therefore runs `npm run ios:pods` after the sync, and this proves
//      it did.
//
//      All three files are required. Missing is a failure, not a skip, for the
//      same reason as the web directory above.
if (platform === 'ios') {
  const PODFILE = 'ios/App/Podfile'
  const LOCK = 'ios/App/Podfile.lock'
  const MANIFEST = 'ios/App/Pods/Manifest.lock'
  for (const f of [PODFILE, LOCK, MANIFEST]) {
    if (!existsSync(f)) {
      fail(`${f} does not exist`, 'Run `npx cap sync ios && npm run ios:pods`. Nothing about the native link was verified.')
    }
  }
  const podfileBytes = readFileSync(PODFILE)
  const podfile = podfileBytes.toString('utf8')
  const lock = readFileSync(LOCK, 'utf8')
  const manifest = readFileSync(MANIFEST, 'utf8')

  // 5a ── no Google pod anywhere in the graph. check-no-google.mjs asks this
  //       before the sync, against the previous install; this is the answer for
  //       the install that will actually be linked.
  if (/CapacitorCommunityAdmob|AdMobAdapter/i.test(podfile)) {
    fail('the Podfile declares the AdMob plugin or an AdMob adapter pod', 'Remove `admob` from levelplay.networks / the npm dependency, then sync again.')
  }
  if (/Google-Mobile-Ads-SDK|GoogleUserMessagingPlatform|AdMobAdapter/i.test(lock + manifest)) {
    fail('Google Mobile Ads / UMP / an AdMob adapter is still resolved in the pod graph', 'Run `npm run ios:pods` and commit the new Podfile.lock.')
  }

  // 5b ── the hook's adapter block must exist and must name every network
  //       package.json asks for. An absent or empty block means the hook did not
  //       run, or levelplay.networks is empty — either way no demand is linked.
  const block = podfile.match(/#\s*LEVELPLAY-ADAPTERS:BEGIN[^\n]*\n([\s\S]*?)^[ \t]*#\s*LEVELPLAY-ADAPTERS:END/m)
  if (!block) {
    fail(
      'the Podfile has no LEVELPLAY-ADAPTERS block',
      'The capacitor:sync:after hook did not run (or levelplay.networks is empty). Run `npx cap sync ios && npm run ios:pods`.',
    )
  }
  const adapters = [...block[1].matchAll(/^\s*pod\s+['"]([^'"]+)['"]/gm)].map((m) => m[1])
  if (!adapters.length) {
    fail('the LEVELPLAY-ADAPTERS block declares no adapter pod', 'levelplay.networks in package.json is empty — the SDK would link with no network to fill it.')
  }
  const pkg = JSON.parse(existsSync('package.json') ? readFileSync('package.json', 'utf8') : '{}')
  const registryPath = 'node_modules/capacitor-levelplay-ads/scripts/network-registry.json'
  if (!existsSync(registryPath)) {
    fail(`${registryPath} does not exist`, 'capacitor-levelplay-ads is not installed (or its layout changed). Nothing about the adapters can be proven.')
  }
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'))
  for (const net of pkg.levelplay?.networks ?? []) {
    const pod = registry[String(net).toLowerCase()]?.ios
    if (!pod) fail(`levelplay.networks names "${net}", which the plugin's registry does not know`, 'Fix the network name in package.json.')
    if (!adapters.includes(pod)) {
      fail(
        `levelplay.networks asks for "${net}" but the Podfile's adapter block has no ${pod}`,
        'The hook ran against an older networks list. Run `npx cap sync ios && npm run ios:pods`.',
      )
    }
  }

  // 5c ── Podfile.lock must be the install of THIS Podfile. CocoaPods records
  //       the SHA-1 of the Podfile's bytes as PODFILE CHECKSUM; a mismatch is
  //       exactly the hook-after-install state described above.
  const recorded = (lock.match(/^PODFILE CHECKSUM: ([0-9a-f]{40})\s*$/m) ?? [])[1]
  const current = createHash('sha1').update(podfileBytes).digest('hex')
  if (recorded !== current) {
    fail(
      `the Podfile changed after the last pod install (Podfile.lock records ${recorded ?? 'no checksum'}, the Podfile is ${current})`,
      'The capacitor:sync:after hook edits the Podfile AFTER cap sync ran pod install. Run `npm run ios:pods`.',
    )
  }

  // 5d ── the plugin, the SDK and every adapter must be resolved in the lock.
  //       Only the PODS: section counts. DEPENDENCIES: lists what the Podfile
  //       asked for, and a :path pod appears there as `  - Name (from `…`)`,
  //       which reads exactly like a resolved entry to a looser match: that
  //       match passed a fixture lock that resolved no plugin at all.
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const resolvedPods = (lock.match(/^PODS:\n([\s\S]*?)\n(?:\n|\S)/m) ?? [])[1] ?? ''
  for (const pod of ['CapacitorLevelplayAds', 'IronSourceSDK', ...adapters]) {
    if (!new RegExp(`^  - ${esc(pod)} \\((?!from )`, 'm').test(resolvedPods)) {
      fail(
        `Podfile.lock resolves no ${pod}`,
        pod === 'CapacitorLevelplayAds'
          ? 'The plugin is not in the pod graph — `npx cap sync ios` did not pick it up.'
          : 'capacitor:sync:after edits the Podfile AFTER cap sync ran pod install — run `npm run ios:pods`.',
      )
    }
  }

  // 5e ── and what is installed in Pods/ must be what the lock says. Xcode's own
  //       [CP] phase checks this too, but only at build time and only as a
  //       diff; here it fails before anything is archived.
  if (lock !== manifest) {
    fail('Podfile.lock and Pods/Manifest.lock differ — Pods/ is not the install the lock describes', 'Run `npm run ios:pods`.')
  }

  const version = (pod) => (resolvedPods.match(new RegExp(`^  - ${esc(pod)} \\(([^)]+)\\)`, 'm')) ?? [])[1]
  console.log(`  pods: ${['CapacitorLevelplayAds', 'IronSourceSDK', ...adapters].map((p) => `${p} ${version(p)}`).join(', ')}`)
}

// 6 ── iOS: the app must declare the UIScene life cycle.
//
//      An app built with Xcode 27 (the iOS 27 SDK) that has no scene manifest
//      is refused at launch on iOS 27: a black screen, then the home screen,
//      and "UIScene life cycle is required" in the log. TestFlight 1.4 (52)
//      shipped exactly that, and nothing in the build or the upload said so.
//      The manifest is plain plist data, and the LevelPlay sync hook rewrites
//      this Info.plist on every sync — so it is proven after every sync, here,
//      and again on the plist the archive packed (Fastfile, build_ipa).
//
//      The delegate is `$(PRODUCT_MODULE_NAME).SceneDelegate` in the source
//      plist and `App.SceneDelegate` once Xcode expands it, so only the suffix
//      is fixed. The storyboard must be Main: that is what builds
//      FoldwingBridgeViewController, the one controller carrying the Game
//      Center plugin (SceneDelegate builds none).
//
//      And no UIRequiresFullScreen: it opts the app out of Split View and of
//      every window size but the full screen, and the iPhone Duo work rests
//      on the app taking whatever size iOS hands it.
if (platform === 'ios') {
  const PLIST = 'ios/App/App/Info.plist'
  if (!existsSync(PLIST)) fail(`${PLIST} does not exist`, 'The iOS project is incomplete — nothing about the scene manifest was verified.')
  let info
  try {
    info = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', PLIST], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  } catch (e) {
    fail(`${PLIST} could not be read as JSON by plutil (${String(e.message ?? e).split('\n')[0]})`, 'A missing plutil or a malformed plist — either way the scene manifest is unproven.')
  }
  const scene = info?.UIApplicationSceneManifest?.UISceneConfigurations?.UIWindowSceneSessionRoleApplication?.[0]
  const delegate = scene?.UISceneDelegateClassName
  const storyboard = scene?.UISceneStoryboardFile
  if (typeof delegate !== 'string' || !delegate.endsWith('.SceneDelegate')) {
    fail(
      `Info.plist declares no UIScene delegate (UIApplicationSceneManifest…UIWindowSceneSessionRoleApplication[0].UISceneDelegateClassName is ${JSON.stringify(delegate)})`,
      'iOS 27 refuses to launch an app built without the scene life cycle — TestFlight 52 died of it. Restore the manifest (CLAUDE.md, "UIScene is adopted").',
    )
  }
  if (storyboard !== 'Main') {
    fail(
      `Info.plist's scene configuration loads storyboard ${JSON.stringify(storyboard)}, not "Main"`,
      'Main.storyboard is what creates FoldwingBridgeViewController with the Game Center plugin; SceneDelegate builds no controller.',
    )
  }
  if ('UIRequiresFullScreen' in info) {
    fail('Info.plist sets UIRequiresFullScreen', 'Never add it: the app must accept every window size iOS gives it (iPhone Duo). Remove the key.')
  }
  console.log(`  scene: ${delegate} + ${storyboard}.storyboard`)
}

console.log(`✓ native-sync (${platform}): ${DESCRIBE[expected]}, matches dist/, no boot-mode build${platform === 'ios' ? ', LevelPlay + adapters installed from the current Podfile, UIScene manifest present' : ''}`)
