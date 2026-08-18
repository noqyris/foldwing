/**
 * Release gate: prove which AdMob units are actually inside the built bundle.
 *
 * Generic — no publisher id is hard-coded. Google's sample units are a fixed,
 * public constant; anything else that looks like a publisher id is treated as
 * live inventory. Drop this file into any project unchanged.
 *
 *   node scripts/check-ad-mode.mjs test [dir]   # TestFlight / internal: test units only
 *   node scripts/check-ad-mode.mjs live [dir]   # App Store / Play production: real units only
 *
 * `dir` defaults to dist/assets. Exits non-zero on a mismatch so it can sit in
 * an && chain and abort the release.
 *
 * Why this exists: VITE_AD_MODE (or any env switch) fails OPEN — anything that
 * is not exactly 'test' serves live inventory, and a typo compiles silently.
 * That is how real-ad builds reached TestFlight, where the owner installs the
 * newest build and taps his own ads. Google closed publisher account
 * pub-3307486877162157 for invalid traffic on 2026-08-18 over exactly this.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const GOOGLE_TEST_PUB = '3940256099942544' // Google's public sample publisher

const want = process.argv[2]
const dir = process.argv[3] ?? 'dist/assets'
if (want !== 'test' && want !== 'live') {
  console.error('usage: node check-ad-mode.mjs <test|live> [dir]')
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

// Preferred proof: a marker the app bakes in, e.g.
//   export const AD_MODE = import.meta.env.VITE_REAL_ADS === '1' ? 'live' : 'test'
// The bundler folds the env read to a literal, so the marker is unambiguous even
// when BOTH id sets ship — which they must in an app that decides at runtime.
const marked = { test: bundle.includes('ADMODE:test'), live: bundle.includes('ADMODE:live') }
if (marked.test !== marked.live) {
  const actual = marked.test ? 'test' : 'live'
  console.log(`ad-mode check — marker says: ${actual.toUpperCase()}`)
  if (actual === want) { console.log('✓ bundle matches target'); process.exit(0) }
  console.error(`\n✗ MISMATCH — release aborted. Built ${actual}, target ${want}.`)
  process.exit(1)
}

const ids = [...new Set(bundle.match(/ca-app-pub-\d{10,}[~/]\d+/g) ?? [])]
const test = ids.filter((i) => i.includes(GOOGLE_TEST_PUB))
const live = ids.filter((i) => !i.includes(GOOGLE_TEST_PUB))

const target = want === 'test' ? 'TEST ads (TestFlight / internal testing)' : 'REAL ads (App Store / Play production)'
console.log(`ad-mode check — target: ${target}`)
console.log(`  test units: ${test.length}`)
console.log(`  live units: ${live.length}${live.length ? '  ' + [...new Set(live.map((i) => i.split(/[~/]/)[0]))].join(', ') : ''}`)

const ok = want === 'test' ? test.length > 0 && live.length === 0 : live.length > 0 && test.length === 0
if (ok) { console.log('✓ bundle matches target'); process.exit(0) }

console.error('\n✗ MISMATCH — release aborted.')
if (want === 'test' && live.length) {
  console.error('  This bundle carries REAL ad units but is going to TestFlight.')
  console.error('  Installing it and tapping an ad is invalid traffic; Google closes accounts for it.')
}
if (want === 'live' && test.length) {
  console.error('  This bundle carries TEST ad units but is going to the store = zero revenue.')
}
if (want === 'live' && !live.length) console.error('  No ad units found at all.')
process.exit(1)
