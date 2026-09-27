// Fixes a consent bug in capacitor-levelplay-ads that silently converts a user's
// REFUSAL into consent from the second launch onward.
//
// THE BUG, in the plugin's own `TcfPrefs` (iOS TcfPrefs.swift, Android
// TcfPrefs.java), for the `custom` consent provider:
//
//   writeStub(granted:)  →  gdprApplies = 0        // SAME for accept and decline
//                           purposeConsents = granted ? "1111111111" : "0000000000"
//
//   isGranted()          →  if gdprApplies == 0 { return true }   // short-circuits
//                           …never reaches the purposeConsents check…
//
// So a user who taps "decline" has that recorded correctly, and then on the next
// launch `consentStatus()` reads it back as GRANTED and the SDK is told
// `setGDPRConsents(["all": true])`. The refusal is silently discarded.
//
// The `gdprApplies == 0` shortcut is not itself wrong — it means "GDPR does not
// apply here", which does imply consent is not required. The bug is that it is
// checked BEFORE the explicit decision the user actually made. This patch only
// reorders the two checks:
//
//   1. If an explicit purposeConsents string exists, it wins. It is a recorded
//      user decision and nothing should override it.
//   2. Otherwise fall back to the original gdprApplies heuristic.
//
// That keeps every out-of-scope case behaving exactly as before, and makes
// "decline" stick. Reported behaviour, not a preference — do not revert.
//
// Idempotent. Wired via package.json "postinstall".
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { createRequire } from 'module'

// Resolve through Node rather than guessing the layout — see the sibling SPM
// patch. A silent skip here means shipping a CMP that ignores refusals.
const require = createRequire(pathToFileURL(process.cwd() + '/'))
let pkgDir
try {
  pkgDir = dirname(require.resolve('capacitor-levelplay-ads/package.json'))
} catch {
  pkgDir = null
}

if (!pkgDir) {
  console.log('[patch-levelplay-consent] plugin not installed — skipping')
  process.exit(0)
}

const MARKER = 'PATCHED-CONSENT-ORDER'
let changed = 0
let already = 0

/** iOS — TcfPrefs.swift */
const swift = join(pkgDir, 'ios/Sources/LevelPlayAdsPlugin/TcfPrefs.swift')
const swiftOld = `    static func isGranted() -> Bool {
        let d = UserDefaults.standard
        let gdprApplies = d.object(forKey: gdprApplies) as? Int
        if gdprApplies == 0 { return true }
        let purposes = d.string(forKey: purposeConsents) ?? ""
        return purposes.first == "1"
    }`
const swiftNew = `    // ${MARKER} (scripts/patch-levelplay-consent.mjs)
    // An explicit recorded decision outranks the "GDPR does not apply" shortcut.
    // Upstream checks gdprApplies FIRST, and writeStub() writes gdprApplies=0 for
    // BOTH outcomes — so a decline read back as GRANTED on every later launch.
    static func isGranted() -> Bool {
        let d = UserDefaults.standard
        let purposes = d.string(forKey: purposeConsents) ?? ""
        if !purposes.isEmpty { return purposes.first == "1" }
        let gdprApplies = d.object(forKey: gdprApplies) as? Int
        return gdprApplies == 0
    }`

/** Android — TcfPrefs.java */
const java = join(pkgDir, 'android/src/main/java/com/capacitor/plugins/levelplay/consent/TcfPrefs.java')
const javaOld = `    public static boolean isGranted(Context ctx) {
        SharedPreferences p = prefs(ctx);
        int gdprApplies = p.getInt(KEY_GDPR_APPLIES, -1);
        if (gdprApplies == 0) return true;
        String purposes = p.getString(KEY_PURPOSE_CONSENTS, "");
        return purposes != null && purposes.length() > 0 && purposes.charAt(0) == '1';
    }`
const javaNew = `    // ${MARKER} (scripts/patch-levelplay-consent.mjs)
    // An explicit recorded decision outranks the "GDPR does not apply" shortcut.
    // Upstream checks gdprApplies FIRST, and writeStub() writes gdprApplies=0 for
    // BOTH outcomes — so a decline read back as GRANTED on every later launch.
    public static boolean isGranted(Context ctx) {
        SharedPreferences p = prefs(ctx);
        String purposes = p.getString(KEY_PURPOSE_CONSENTS, "");
        if (purposes != null && purposes.length() > 0) return purposes.charAt(0) == '1';
        int gdprApplies = p.getInt(KEY_GDPR_APPLIES, -1);
        return gdprApplies == 0;
    }`

for (const [file, oldText, newText, label] of [
  [swift, swiftOld, swiftNew, 'iOS TcfPrefs.swift'],
  [java, javaOld, javaNew, 'Android TcfPrefs.java'],
]) {
  if (!existsSync(file)) {
    console.error(`[patch-levelplay-consent] MISSING ${label} — the plugin layout changed.`)
    console.error('  Re-verify the consent bug by hand before shipping; do not assume it is fixed.')
    process.exit(1)
  }
  const src = readFileSync(file, 'utf8')
  if (src.includes(MARKER)) { already++; continue }
  if (!src.includes(oldText)) {
    console.error(`[patch-levelplay-consent] ${label}: isGranted() no longer matches the known-buggy form.`)
    console.error('  Upstream may have fixed it, or changed it in some other way. Read it before shipping —')
    console.error('  a silently un-applied consent patch is worse than no patch.')
    process.exit(1)
  }
  writeFileSync(file, src.replace(oldText, newText))
  console.log(`[patch-levelplay-consent] ✅ ${label}`)
  changed++
}

if (already && !changed) console.log('[patch-levelplay-consent] already patched')
