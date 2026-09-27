#!/usr/bin/env node
/**
 * Release gate #2: prove NO Google ad surface can reach a shipped binary.
 *
 * Sibling of scripts/check-ad-mode.mjs. That one asks "which ad mode?"; this
 * one asks "is Google in the build at all?" — because the owner's AdMob
 * publisher account was terminated for invalid traffic on 2026-08-18 and the
 * appeal was rejected, final. Under the AdSense T&Cs a terminated publisher is
 * not eligible for further participation in AdSense/AdMob/AdMob Mediation, so
 * any AdMob or Google-Ad-Manager demand path is not "risky revenue" — it is
 * zero revenue plus a fresh policy record.
 *
 * Ported from KVIZKO, which links its native dependencies through SPM. Foldwing
 * stays on CocoaPods, so rule 3 reads the Podfile and both lock files as well —
 * the SPM reads alone found nothing to read here and passed without checking.
 *
 * Run BEFORE `cap sync` in every sync/release chain, and again inside fastlane's
 * `build_ipa`, after the sync. Exit non-zero on any hit.
 *
 *   node scripts/check-no-google.mjs                  # repo + native projects + dist/assets
 *   node scripts/check-no-google.mjs --bundle <dir>   # rule 8 reads <dir> instead of dist/assets
 *
 * There is no --strict here, and no prose exemption: the dead publisher id and
 * every AdMob app/unit id fail in docs exactly as they fail in code. KVIZKO lets
 * its postmortems quote the id; this repo removed it instead, so a hit anywhere
 * is a regression rather than history.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const failures = []
const notes = []

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null)
const fail = (rule, where, detail) => failures.push({ rule, where, detail })

// The terminated publisher id, as a SHA-256 of its 16 digits — never the digits
// themselves. A gate that spells the id out is one more file that carries it,
// and the point of this repo's cleanup is that `grep` for the id finds nothing.
// Every standalone 16-digit run is hashed and compared; see deadPubLines().
const DEAD_PUB_SHA256 = 'b03eec77dfa1c9da028a2fef101fb69b931dbca36eb9a164161ec894100ce5b3'
const ADMOB_SKAN = 'cstr6suwn9.skadnetwork' // AdMob's SKAdNetwork id
const ADMOB_ID = /ca-app-pub-\d{10,}[~/]\d+/

const hashed = new Map()
function isDeadPub(digits) {
  let hit = hashed.get(digits)
  if (hit === undefined) {
    hit = createHash('sha256').update(digits).digest('hex') === DEAD_PUB_SHA256
    hashed.set(digits, hit)
  }
  return hit
}
/** 1-based line numbers on which the dead publisher id appears. */
function deadPubLines(src) {
  const lines = []
  for (const m of src.matchAll(/(?<!\d)\d{16}(?!\d)/g)) {
    if (isDeadPub(m[0])) lines.push(src.slice(0, m.index).split('\n').length)
  }
  return lines
}
/** 1-based line numbers carrying an AdMob app or unit id. */
function admobIdLines(src) {
  const lines = []
  for (const m of src.matchAll(new RegExp(ADMOB_ID.source, 'g'))) lines.push(src.slice(0, m.index).split('\n').length)
  return lines
}
const at = (lines) => [...new Set(lines)].slice(0, 5).join(',') + (new Set(lines).size > 5 ? ',…' : '')

const bundleArg = process.argv.indexOf('--bundle')
const BUNDLE_DIR = bundleArg > -1 ? process.argv[bundleArg + 1] : 'dist/assets'
if (bundleArg > -1 && !BUNDLE_DIR) {
  console.error('usage: node scripts/check-no-google.mjs [--bundle <dir>]')
  process.exit(2)
}

// ── 1. package.json: the mediation network list ──────────────────────────────
// The single most likely accident. capacitor-levelplay-ads' own README shows
//   "networks": ["admob", "applovin", "unityads"]
// as THE example config — admob first. Copy-paste it when adding AppLovin and
// the AdMob adapter pod and the AdMob SKAdNetwork id both land in the native
// project on the next `cap sync`, silently.
const pkg = JSON.parse(read('package.json') ?? '{}')
const nets = (pkg.levelplay?.networks ?? []).map((n) => String(n).toLowerCase())
const GOOGLE_NETS = ['admob', 'googleadmanager', 'google-ad-manager', 'gam', 'admanager', 'adx']
for (const n of nets) {
  if (GOOGLE_NETS.includes(n)) fail('levelplay-network', 'package.json', `levelplay.networks contains "${n}"`)
}
if (pkg.levelplay?.admob) fail('levelplay-network', 'package.json', 'levelplay.admob config block present')
notes.push(`levelplay.networks = [${nets.join(', ') || '(empty)'}]`)

// ── 2. package.json: no AdMob SDK dependency at all ──────────────────────────
for (const field of ['dependencies', 'devDependencies']) {
  for (const dep of Object.keys(pkg[field] ?? {})) {
    if (/admob|google-mobile-ads|react-native-google-mobile-ads/i.test(dep)) {
      fail('npm-dep', 'package.json', `${field}."${dep}" pulls the Google Mobile Ads SDK`)
    }
  }
}

// ── 3. iOS: the dependency graph is what actually links the binary ───────────
// CocoaPods first, because that is what this project uses. Three files, three
// different questions:
//   Podfile              what was ASKED for — the Capacitor-generated plugin
//                        list and the LevelPlay hook's adapter block;
//   Podfile.lock         what was RESOLVED and is committed — the pin;
//   Pods/Manifest.lock   what is INSTALLED on this machine and gets linked.
// This rule runs before `cap sync` in the npm chains, so it reads the previous
// install: a Google pod here means the last sync resolved one, or a lock from
// before the migration came back with a checkout. scripts/check-native-sync.mjs
// asks the same question again after the sync.
const podfile = read('ios/App/Podfile')
if (podfile && /CapacitorCommunityAdmob|AdMobAdapter/i.test(podfile)) {
  fail('ios-link', 'ios/App/Podfile', 'declares the AdMob Capacitor plugin or a LevelPlay AdMob adapter pod')
}
for (const lock of ['ios/App/Podfile.lock', 'ios/App/Pods/Manifest.lock']) {
  const src = read(lock)
  if (src && /Google-Mobile-Ads-SDK|GoogleUserMessagingPlatform|AdMobAdapter/i.test(src)) {
    fail('ios-link', lock, 'Google Mobile Ads / UMP / an AdMob adapter is resolved — run `npx cap sync ios && npm run ios:pods` and commit the new Podfile.lock')
  }
}
// SPM, should this project ever be converted (it must not be — see CLAUDE.md).
const capSpm = read('ios/App/CapApp-SPM/Package.swift')
if (capSpm && /Admob|AdMob|GoogleMobileAds/i.test(capSpm)) {
  fail('ios-link', 'ios/App/CapApp-SPM/Package.swift', 'links an AdMob Capacitor plugin — the GMA SDK ends up in the binary')
}
const resolved = read('ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved')
if (resolved && /google-mobile-ads|google-user-messaging-platform|googleads/i.test(resolved)) {
  fail('ios-link', 'Package.resolved', 'Google Mobile Ads / UMP still pinned in the resolved SPM graph')
}
if (!podfile && !capSpm) notes.push('no ios/App/Podfile and no CapApp-SPM — iOS link checks had nothing to read')

// ── 4. iOS Info.plist and build settings: the app id, and the SKAdNetwork tell ─
// The LevelPlay hook deletes GADApplicationIdentifier when admob is not in
// levelplay.networks, but it only ever ADDS SKAdNetwork ids — it never removes
// Google's. So the AdMob-era id survives every sync unless removed by hand.
const plist = read('ios/App/App/Info.plist')
if (plist) {
  if (plist.includes('GADApplicationIdentifier')) fail('ios-plist', 'ios/App/App/Info.plist', 'GADApplicationIdentifier present')
  if (plist.includes(ADMOB_SKAN)) fail('ios-plist', 'ios/App/App/Info.plist', `AdMob SKAdNetwork id ${ADMOB_SKAN} present — remove its <dict>; the hook never will`)
}
const pbxproj = read('ios/App/App.xcodeproj/project.pbxproj')
if (pbxproj && pbxproj.includes('GAD_APPLICATION_IDENTIFIER')) {
  fail('ios-plist', 'ios/App/App.xcodeproj/project.pbxproj', 'GAD_APPLICATION_IDENTIFIER build setting present (the AdMob-era app id the plist used to read)')
}

// ── 5. Android: manifest meta-data + injected gradle adapters ────────────────
// Foldwing has no android/ today; these reads find nothing and cost nothing, and
// they start working the day `npx cap add android` runs.
const manifest = read('android/app/src/main/AndroidManifest.xml')
if (manifest && manifest.includes('com.google.android.gms.ads.APPLICATION_ID')) {
  fail('android-manifest', 'AndroidManifest.xml', 'com.google.android.gms.ads.APPLICATION_ID meta-data present')
}
for (const g of ['android/app/build.gradle', 'android/app/capacitor.build.gradle', 'android/build.gradle', 'android/settings.gradle', 'android/capacitor.settings.gradle']) {
  const src = read(g)
  if (!src) continue
  if (/play-services-ads(?!-identifier)|admob-adapter|capacitor-community-admob/i.test(src)) {
    fail('android-link', g, 'AdMob adapter / play-services-ads / admob plugin on the classpath')
  }
}

// ── 6. app-ads.txt: the only Google surface that is PUBLIC ───────────────────
// A google.com line naming a terminated publisher is a permanent, crawlable
// link between this bundle id and the closed account — exactly the signal
// Google uses to tie a new publisher account back to a disabled one. It also
// authorises nobody who can actually pay, while declaring nothing for the
// network that can: no seller line means DSPs treat the inventory as
// unauthorised and skip it.
//
// Foldwing's copy is NOT in this repo: the listing's developer site serves it
// from the noqyris-website repo. So by default this rule is a note. To enforce
// it against a local copy, declare the path in package.json —
//   "adSafety": { "appAdsTxt": "<path>", "sellers": ["unity", "ironsrc"] }
// — or pass APP_ADS_PATH for one run.
const APP_ADS = process.env.APP_ADS_PATH ?? pkg.adSafety?.appAdsTxt ?? null
const SELLERS = pkg.adSafety?.sellers ?? ['unity', 'ironsrc']
const appAds = APP_ADS ? read(APP_ADS) : null

if (appAds === null) {
  // NOT a failure unless a path was declared. Every other rule here fails on the
  // PRESENCE of a Google surface; absence of a repo copy of a hosted text file
  // is not one.
  if (APP_ADS) {
    notes.push(`${APP_ADS} not found (declared) — app-ads.txt checks could not run`)
    fail('app-ads', APP_ADS, 'declared in adSafety.appAdsTxt / APP_ADS_PATH but not present')
  } else {
    notes.push('app-ads.txt is served from the noqyris-website repo, not this one — checks skipped (set adSafety.appAdsTxt or APP_ADS_PATH to enforce)')
  }
} else {
  // A google.com RESELLER line is NOT a problem and must not be stripped: those
  // are Unity/ironSource's own AdX seats, and removing them tells every
  // Google-sourced buyer this inventory is unauthorised — cutting real demand
  // for no safety gain. What must never appear is OUR terminated publisher, or
  // a google.com DIRECT line, which would claim we sell through Google.
  for (const line of appAds.split('\n')) {
    const l = line.trim()
    if (!l || l.startsWith('#')) continue
    if (!/^google(\.com|syndication)/i.test(l)) continue
    if (deadPubLines(l).length) {
      fail('app-ads', APP_ADS, 'a google.com line names the terminated publisher')
    } else if (/,\s*DIRECT/i.test(l)) {
      fail('app-ads', APP_ADS, `claims a DIRECT Google seller relationship: ${l}`)
    }
  }
  // Somebody must be authorised to sell, or DSPs skip the inventory entirely.
  const sellerRe = new RegExp(`^\\s*(${SELLERS.join('|')})\\.com,[^,]+,\\s*DIRECT`, 'im')
  if (!sellerRe.test(appAds)) {
    fail('app-ads', APP_ADS, `no ${SELLERS.join('/')}.com DIRECT line — the live ad stack is unauthorised`)
  }
}

// ── 7. The dead publisher id and AdMob ids, everywhere they can still hide ───
// Generated output is skipped: dist/ and ios/App/App/public are the bundle rule
// 8 reads (a pre-sync read of App/public is the PREVIOUS build, which would
// block the very sync that replaces it); .build/ and build/ are derived data and
// ipa output; Pods/ and node_modules/ are third-party.
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'dist-daily', 'build', '.build', 'Pods', 'DerivedData', '.gradle', '.scratch',
  'ios/App/App/public', 'ios/App/output', 'ios/capacitor-cordova-ios-plugins',
])
const SCAN_EXT = /\.(ts|tsx|js|mjs|cjs|json|swift|m|h|kt|java|gradle|xml|plist|xcprivacy|xcconfig|html|txt|pbxproj|entitlements|md|sh|rb|ya?ml|env|example)$/
// Files with no extension that still configure the build. Fastfile held the
// live AdMob app id and was never scanned because of it.
const SCAN_NAMES = new Set(['Fastfile', 'Podfile', 'Appfile', 'Gemfile', 'Matchfile', 'Pluginfile'])
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const rel = p.replace(/^\.\//, '')
    if (SKIP_DIRS.has(name) || SKIP_DIRS.has(rel)) continue
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else if (SCAN_EXT.test(name) || SCAN_NAMES.has(name)) out.push(rel)
  }
  return out
}
for (const f of walk('.')) {
  const src = read(f)
  if (!src) continue
  const dead = deadPubLines(src)
  if (dead.length) fail('dead-pub-id', `${f}:${at(dead)}`, 'names the terminated AdMob publisher')
  const ids = admobIdLines(src)
  if (ids.length) fail('admob-unit-id', `${f}:${at(ids)}`, 'contains an AdMob app/unit id')
}

// ── 8. The built bundle — the thing that actually ships ──────────────────────
// dist/assets by default (what `cap sync` is about to copy); fastlane's
// build_ipa passes --bundle ios/App/App/public/assets, the copy it archives.
if (existsSync(BUNDLE_DIR)) {
  let bundle = ''
  const stack = [BUNDLE_DIR]
  while (stack.length) {
    const d = stack.pop()
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) stack.push(p)
      else if (/\.(js|mjs|cjs|html|json|css)$/.test(n)) bundle += readFileSync(p, 'utf8')
    }
  }
  if (bundle.includes('ca-app-pub-')) fail('bundle', BUNDLE_DIR, 'shipped JS carries an AdMob app/unit id')
  if (deadPubLines(bundle).length) fail('bundle', BUNDLE_DIR, 'shipped JS names the terminated AdMob publisher')
} else if (bundleArg > -1) {
  fail('bundle', BUNDLE_DIR, 'the bundle directory passed with --bundle does not exist')
} else {
  notes.push(`${BUNDLE_DIR} not built — bundle check skipped`)
}

// ── report ───────────────────────────────────────────────────────────────────
console.log('no-google gate')
for (const n of notes) console.log(`  · ${n}`)
if (!failures.length) {
  console.log('✓ no Google ad surface found in the build inputs')
  process.exit(0)
}
console.error(`\n✗ ${failures.length} Google ad surface(s) found — release aborted.\n`)
for (const f of failures) console.error(`  [${f.rule}] ${f.where}\n      ${f.detail}`)
console.error('\n  The publisher account is terminated and the appeal was refused.')
console.error('  Any AdMob/Ad-Manager path earns nothing and creates a new policy record.')
process.exit(1)
