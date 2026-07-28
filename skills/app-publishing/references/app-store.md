# App Store Connect (iOS) via fastlane

Everything below is scriptable — **no browser needed** — using an **ASC API key**.

## Auth: ASC API key

Create in App Store Connect → Users and Access → Integrations → App Store Connect API. Store as `ios/App/fastlane/keys/asc_api_key.json` (**gitignored**):
```json
{ "key_id": "...", "issuer_id": "...", "key": "-----BEGIN PRIVATE KEY-----\n...", "in_house": false }
```
In the Fastfile: `app_store_connect_api_key(key_id:, issuer_id:, key_content:, set_spaceship_token: true)` — `set_spaceship_token` lets the older Spaceship-based actions authenticate too.

## Versions & build numbers

- **Marketing version** (`MARKETING_VERSION`, e.g. `1.2.0`) = what users see.
- **Build number** (`CURRENT_PROJECT_VERSION`) must increase for every upload of the same version. Bump it with agvtool (updates the project *and* Info.plist):
  ```bash
  cd ios/App && xcrun agvtool new-version -all 12
  ```
- **Version-train rule:** if the marketing version is already `READY_FOR_SALE`, you cannot upload more builds for it. Bump `MARKETING_VERSION` or the upload fails with **90186 / 90062 — "Invalid Pre-Release Train … is closed"**. A silent-looking upload that never appears on ASC is usually this.

## Useful lanes

```ruby
lane :build_and_upload do          # build + sign + TestFlight (no store version, no submit)
  key = asc_api_key
  build_ipa                        # gym: Release, app-store export, clean archive
  upload_to_testflight(api_key: key, app_identifier: APP_ID, ipa: "build/App.ipa",
                       skip_submission: true, skip_waiting_for_build_processing: true)
end

lane :prep do                      # create the version + push metadata, NO submit (safe/reversible)
  upload_to_app_store(api_key: asc_api_key, app_identifier: APP_ID,
    app_version: "1.2.0", skip_binary_upload: true, skip_screenshots: true,
    submit_for_review: false, force: true, metadata_path: "./fastlane/metadata")
end

lane :submit do                    # attach the build + submit, MANUAL release
  upload_to_app_store(api_key: asc_api_key, app_identifier: APP_ID,
    app_version: "1.2.0", build_number: "12",
    skip_binary_upload: true, skip_screenshots: true, force: true,
    run_precheck_before_submit: true, submit_for_review: true,
    automatic_release: false,                       # ← you press Release
    submission_information: {
      add_id_info_uses_idfa: true, add_id_info_serves_ads: true,   # ads → IDFA
      add_id_info_tracks_install: false, add_id_info_tracks_action: false,
      add_id_info_limits_tracking: true,            # respects ATT
      export_compliance_uses_encryption: false,
      content_rights_contains_third_party_content: false },
    metadata_path: "./fastlane/metadata")
end
```

Handy read-only diagnostics (Spaceship): list recent builds with `processing_state`, and list App Store versions with `app_store_state` — invaluable for "did my upload land?".

## Export compliance

Put this in `Info.plist` so TestFlight never blocks a build on the encryption question:
```xml
<key>ITSAppUsesNonExemptEncryption</key><false/>
```

## Metadata (fastlane/metadata/en-US/*.txt)

| File | Limit | Notes |
|---|---|---|
| `name.txt` | 30 | Strongest ranking factor — brand + top keyword |
| `subtitle.txt` | 30 | Different keywords than the name |
| `keywords.txt` | 100 | Comma-separated, **no spaces** |
| `promotional_text.txt` | 170 | Editable anytime **without review** |
| `description.txt` | 4000 | Changing it requires a new version submission |
| `release_notes.txt` | — | "What's New" |

**ASO rules that matter:**
- Never repeat words already in the name/subtitle — Apple indexes those automatically; repeating wastes the 100 chars.
- Use **singular** forms (plurals are matched automatically).
- `games` is a high-value multiplier: it combines with your name/subtitle into "number games", "math games", "logic games", "offline games"…
- Apple builds phrases by combining keywords, so prefer many distinct tokens over long phrases.

`run_precheck_before_submit: true` catches banned copy — e.g. **claiming your IAP is free**, placeholder text, competitor mentions, broken URLs.

## App Privacy (the nutrition label)

**Not** managed by fastlane — set it in the ASC UI, and it applies at the **app level**, independent of any version (so it can be fixed any time, including during review). With AdMob you must declare:
- **Identifiers → Device ID (IDFA)** — Third-Party Advertising, *Not Linked*, **Used for Tracking**
- **Usage Data → Product Interaction** — Third-Party Advertising + Analytics, *Not Linked*, Used to Track
- optionally Diagnostics (crash/performance)

You can verify what's currently published without logging in: fetch the public store page `apps.apple.com/app/id<APPID>` and read its App Privacy section.

## IAP

- Create the product in ASC (e.g. Non-Consumable "Remove Ads"); the **product id must match the code**.
- With `cordova-plugin-purchase`, grant the entitlement **only** on an `approved`/`finished` transaction that actually contains your product — a cancelled payment fires `error`, never `approved`. Don't grant off `store.owned()` (it can read true for a cancelled sandbox transaction with no receipt validator).
- Ship a visible **"Restore purchases"** action — Apple requires it.
- Test with a **Sandbox Apple ID** (ASC → Users and Access → Sandbox → Testers) on a real device. Purchases are free in sandbox. On the simulator the sheet appears but can't complete — that's expected, not a bug.

## TestFlight

- Builds go `PROCESSING` → `VALID`, usually a few minutes. Poll rather than guess.
- Test the **real** build on a device before submitting; TestFlight builds are identical to what ships.
