/**
 * Release gate: prove which ad MODE the built bundle declares — test, live, off
 * or mock.
 *
 * The app bakes two literal markers into the bundle, each EXACTLY once:
 *
 *   ADMODE:test | ADMODE:live            folded from VITE_AD_MODE at build time
 *                                        (the LevelPlay provider under src/systems/)
 *   ADS:on | ADS:off | ADS:mock          folded from VITE_ADS at build time
 *                                        (`ADS_MARKER`, src/systems/adProvider.ts)
 *
 * and this script greps dist/ for them. Grepping unit ids proves nothing on
 * Unity LevelPlay: the network has no test/live id pair, the SAME unit ids ship
 * in both modes, and every ADS:on build serves the real waterfall (the test
 * flag only unlocks the Test Suite). `ADS:off` is the one build that serves
 * nothing: the ad layer never initialises, so there is no waterfall to put in
 * front of anyone — which is why it is TestFlight's default. `ADS:mock` draws
 * fake ads in the page and calls no network, so it is TestFlight-safe too
 * (`fastlane beta_mock`); only the store refuses it.
 *
 *   node scripts/check-ad-mode.mjs live [dir]   # App Store:                          ADMODE:live + ADS:on
 *   node scripts/check-ad-mode.mjs off  [dir]   # TestFlight, incl. N+1 after a live upload: ADMODE:test + ADS:off
 *   node scripts/check-ad-mode.mjs mock [dir]   # FAKE ads, dev / simulator / TestFlight (beta_mock): ADMODE:test + ADS:mock
 *   node scripts/check-ad-mode.mjs test [dir]   # Test Suite / plain dev build — REAL waterfall, never uploaded
 *
 * The targets are disjoint, on purpose:
 *   - `test` refuses an ads-off bundle — it would pass a silent, ad-less
 *     build off as the ads-on one somebody asked for;
 *   - `off` refuses an ads-on bundle — it would put the live waterfall on the
 *     owner's phone through TestFlight;
 *   - `live` refuses ADS:off outright — a store build that never loads an ad is
 *     a contradiction, not a mode;
 *   - every target but `mock` refuses a mock bundle, because each one states
 *     `mock: 0` (see the table) — and refuses the fake STORE the mock build
 *     carries ("FAKE PURCHASE"), whatever its markers say.
 * A missing or doubled marker fails every target: the bundle predates the
 * markers, a stale chunk sits beside a fresh one, or a seam moved — either way
 * it cannot be proven, and "cannot prove" is a refusal here.
 *
 * `dir` defaults to dist/assets. Exits non-zero on a mismatch so it can sit in
 * an && chain and abort the release.
 *
 * Why this exists: the flag fails SAFE (`!== 'live'`), so the residual
 * mistake is shipping a store build nobody declared live — or a hand-rolled
 * `cap sync` that skips this check. The old fail-open flag let real-ad builds
 * reach TestFlight, where the owner installs the newest build and taps his own
 * ads; Google closed the AdMob publisher account for invalid traffic on
 * 2026-08-18 over exactly that.
 *
 * Unlike the KVIZKO copy this was ported from, there is no fallback that
 * classifies AdMob unit ids when the ADMODE marker cannot decide. KVIZKO kept
 * one for bundles it had shipped before the markers existed; Foldwing never
 * shipped a marker-less LevelPlay bundle, so the only thing such a fallback
 * could ever vouch for here is an AdMob bundle — which no target may accept.
 * No single ADMODE marker is a refusal, the same answer
 * scripts/check-native-sync.mjs gives after the sync.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Exact occurrence counts a passing bundle must show, per target.
//
// The exact-once contract does the work here: because every target states a
// count for EVERY marker, adding `mock` made the other three refuse a mock
// bundle automatically — `test`, `live` and `off` each already demand
// `mock: 0`. That is the whole reason a fake-ads build can never reach a store
// by accident: nobody has to remember to exclude it.
//        ADMODE:test  ADMODE:live  ADS:on  ADS:off  ADS:mock
const TARGETS = {
  test: { test: 1, live: 0, on: 1, off: 0, mock: 0 },
  live: { test: 0, live: 1, on: 1, off: 0, mock: 0 },
  off: { test: 1, live: 0, on: 0, off: 1, mock: 0 },
  mock: { test: 1, live: 0, on: 0, off: 0, mock: 1 },
}

const want = process.argv[2]
const dir = process.argv[3] ?? 'dist/assets'
if (!TARGETS[want]) {
  console.error('usage: node check-ad-mode.mjs <test|live|off|mock> [dir]')
  process.exit(2)
}

function readAll(d) {
  let out = ''
  for (const name of readdirSync(d)) {
    const p = join(d, name)
    if (statSync(p).isDirectory()) { out += readAll(p); continue }
    if (/\.(js|mjs|cjs|html|json)$/.test(name)) out += readFileSync(p, 'utf8')
  }
  return out
}

let bundle
try { bundle = readAll(dir) } catch {
  console.error(`✗ cannot read ${dir} — run the build first`)
  process.exit(1)
}

// A boot-mode bundle is never a release, whatever its markers say: a Test
// Suite entry (VITE_TESTSUITE=1) and an advertising-id readout
// (VITE_ADID_CAPTURE=1) are ADMODE:test + ADS:on like the plain test build — so,
// without this, a suite entry exported in the shell rides a whole chain green
// and a build ships a screen with no game behind it. Both markers are
// tree-shaken out of every other build, so their presence alone is the proof.
for (const [marker, what] of [['TESTSUITE:1', 'a Test Suite entry (VITE_TESTSUITE=1)'], ['ADIDCAPTURE:1', 'an ad-id capture screen (VITE_ADID_CAPTURE=1)']]) {
  if (bundle.includes(marker)) {
    console.error(`✗ MISMATCH — release aborted. Bundle is ${what}, not the game; no target accepts it.`)
    console.error('  Rebuild in a shell where that variable is not set.')
    process.exit(1)
  }
}

// The markers the app bakes in. The bundler folds each env read to a literal,
// so the markers are unambiguous even though the SAME unit ids ship in every
// mode. Count, do not just test presence: "exactly once" is the contract, and
// a doubled marker means a stale chunk is in the bundle.
const count = (literal) => bundle.split(literal).length - 1
const seen = {
  test: count('ADMODE:test'),
  live: count('ADMODE:live'),
  on: count('ADS:on'),
  off: count('ADS:off'),
  mock: count('ADS:mock'),
}
console.log(
  `ad-mode check — target ${want.toUpperCase()}; markers seen: ` +
    `ADMODE:test ×${seen.test}  ADMODE:live ×${seen.live}  ADS:on ×${seen.on}  ADS:off ×${seen.off}  ADS:mock ×${seen.mock}`,
)

// The fake STORE rides the mock build too (src/systems/iapMock.ts): a DOM sheet
// that says "FAKE PURCHASE — no money" and grants reveals for nothing. Its
// selection is an inline `VITE_ADS === 'mock'` check so every other build
// tree-shakes it, and this proves the shake happened: the sheet's caption is
// the one string that cannot be in a bundle without the sheet. Only `mock`
// may carry it. Case and spacing are ignored — a caption restyled to "Fake
// purchase" is the same sheet — and this runs whatever the markers say, since
// a store bundle that grants free reveals is wrong in every mode.
const fakeStore = bundle.match(/FAKE\s+PURCHASE/gi) ?? []
if (fakeStore.length && want !== 'mock') {
  const at = bundle.search(/FAKE\s+PURCHASE/i)
  console.error(`\n✗ MISMATCH — release aborted. Bundle carries the FAKE STORE (×${fakeStore.length}); target ${want.toUpperCase()}.`)
  console.error(`  …${bundle.slice(Math.max(0, at - 40), at + 60).replace(/\s+/g, ' ')}…`)
  console.error('  Its purchase sheet grants reveals without StoreKit. Only the mock build (VITE_ADS=mock) may carry it —')
  console.error("  the mock iap's inline VITE_ADS check was changed, or a stale mock chunk sits in this bundle. Rebuild.")
  process.exit(1)
}

if (seen.test + seen.live !== 1) {
  console.error(
    `\n✗ MISMATCH — release aborted. The ADMODE marker is ${seen.test + seen.live === 0 ? 'absent' : 'present more than once'}; target ${want.toUpperCase()}.`,
  )
  console.error('  The bundle predates the LevelPlay provider (an AdMob-era build), a stale chunk sits beside a')
  console.error('  fresh one, or the seam moved. Nothing in it can be proven — rebuild with the matching npm chain.')
  process.exit(1)
}

const mode = seen.test ? 'test' : 'live'
const ads = seen.on + seen.off + seen.mock === 1 ? (seen.on ? 'on' : seen.off ? 'off' : 'mock') : null
const label = `ADMODE:${mode} + ${ads ? `ADS:${ads}` : 'no usable ADS marker'}`

const ok = Object.entries(TARGETS[want]).every(([k, n]) => seen[k] === n)
if (ok) {
  console.log(`✓ bundle matches target — ${label}`)
  // A pass is NOT permission to tap an ad. On LevelPlay the test flag only
  // unlocks the integration Test Suite — every ADS:on build still serves the
  // real waterfall, and nothing makes a tap safe: the dashboard pin narrows the
  // SOURCE for about an hour, non-bidding rows stay live. Saying "test" without
  // this line is how self-clicks happen.
  if (want === 'test') {
    console.log('  note: on LevelPlay this unlocks the Test Suite only — inventory is REAL.')
    console.log('        Never tap an ad, never deliberately look at one — impressions count too.')
    console.log('        Not a TestFlight build: TestFlight gets ADS:off, or the fake-ads ADS:mock.')
  }
  if (want === 'off') {
    console.log('  note: ads OFF — the ad layer never initialises, nothing loads, nothing to tap.')
    console.log("        TestFlight's default build, and N+1 of every App Store release.")
  }
  if (want === 'mock') {
    console.log('  note: FAKE ads drawn in the page — no network, no SDK calls. Dev, simulator, or TestFlight')
    console.log('        via `fastlane beta_mock`; the App Store never gets it.')
    if (fakeStore.length) {
      console.log('        The fake store is in it too — on the web only; a native mock build buys through the StoreKit sandbox.')
    }
  }
  if (want === 'live') {
    console.log('  warning: REAL ads. Two-build rule: follow the upload IMMEDIATELY with an ads-off build')
    console.log('           (npm run ios:sync:adsoff && fastlane beta_adsoff) — `npm run release:appstore` does both.')
  }
  process.exit(0)
}

console.error(`\n✗ MISMATCH — release aborted. Bundle is ${label}, target ${want.toUpperCase()}.`)
if (!ads) {
  console.error('  The ADS marker (ADS:on / ADS:off / ADS:mock, from VITE_ADS) is missing or appears more than once —')
  console.error('  the bundle predates it, a stale chunk sits beside a fresh one, or the seam moved.')
  console.error('  It cannot be proven; rebuild.')
}
if (mode === 'live' && (ads === 'off' || ads === 'mock')) {
  console.error(`  ADMODE:live with ADS:${ads} is a contradiction — a store build that never loads a real ad.`)
  console.error('  Rebuild without VITE_ADS.')
}
if (want === 'live' && mode === 'test') {
  console.error('  This bundle is TEST mode but is going to the store = zero revenue.')
  console.error('  Only VITE_AD_MODE=live (ios:appstore / build:live) declares a build live.')
}
if (want !== 'live' && mode === 'live') {
  console.error('  This bundle is declared LIVE but the target is not the store.')
  console.error("  A real-ads binary on a tester's phone is how the AdMob account was lost.")
}
if (want === 'test' && ads === 'off') {
  console.error('  This is an ads-off bundle (VITE_ADS=off). It never passes as the ads-on test build —')
  console.error('  if you meant it, the target is `off` (build:adsoff / ios:sync:adsoff).')
}
if (want === 'off' && ads === 'on') {
  console.error('  This bundle loads the REAL waterfall (ADS:on). TestFlight puts it on the owner\'s phone —')
  console.error('  rebuild with VITE_ADS=off (ios:sync:adsoff).')
}
if (want !== 'mock' && ads === 'mock') {
  console.error('  This is the FAKE-ads bundle (VITE_ADS=mock). It calls no network and earns nothing;')
  console.error('  it is for `npm run dev:mock` / `ios:sync:mock` and `fastlane beta_mock` only, never the store.')
}
if (want === 'mock' && ads !== 'mock') {
  console.error('  Target is the fake-ads build but the bundle is not one — rebuild with VITE_ADS=mock (build:mock).')
}
process.exit(1)
