#!/bin/sh
# Foldwing ad-mode guard. An Xcode Run Script phase of the App target, placed
# before Sources, so it runs ahead of any compiling on every build of that
# target: Xcode Run, Product > Archive, a bare `xcodebuild`, and fastlane's
# build_app. It is second in the list, not first: `pod install` moves
# CocoaPods' own "[CP] Check Pods Manifest.lock" phase to the front on every
# run (TargetIntegrator#add_check_manifest_lock_script_phase), so putting this
# one first by hand would only churn the pbxproj. That phase reads nothing from
# App/public, and when this one fails the App target compiles nothing.
#
# WHY IT EXISTS. The npm chains prove the web bundle before `cap sync`
# (scripts/check-ad-mode.mjs) and after it (scripts/check-native-sync.mjs), and
# the release lane proves it again. Product > Archive in Xcode and a hand-typed
# `xcodebuild archive` skip every one of those and take whatever App/public
# holds. After `npm run ios:appstore` that is a LIVE-ads bundle, and a real-ads
# binary on the owner's phone is how the AdMob publisher account was closed on
# 2026-08-18. This phase cannot be walked around, because it runs inside the
# build itself.
#
# WHAT UNITY LEVELPLAY CHANGES. LevelPlay has no test inventory. Its testing
# flag only unlocks the Test Suite, so a bundle marked ADMODE:test + ADS:on
# serves the same real waterfall as ADMODE:live. "Test mode" is therefore not a
# safe build, and Foldwing never archives one. Exactly three bundles may be
# archived, and AD_TARGET has to name the one that is meant:
#
#   AD_TARGET=live   ADMODE:live + ADS:on    the App Store build N
#   AD_TARGET=off    ADMODE:test + ADS:off   the default TestFlight build,
#                                            including the N+1 that must follow
#                                            N at once
#   AD_TARGET=mock   ADMODE:test + ADS:mock  a TestFlight build with FAKE ads
#                                            (fastlane beta_mock), on the
#                                            owner's request since 2026-09-22
#
# The mock build draws its own ads in the page and calls no network, so it is as
# safe on a phone as the ads-off one. It must never reach the store — it earns
# nothing — and the store side refuses it: build_ipa's live target, the live
# markers check, and attach_build's record of fake-ads builds.
#
# The web build bakes those markers in as literals (VITE_AD_MODE and VITE_ADS,
# folded at build time). The marker in the bundle and the word in AD_TARGET
# have to agree; neither is trusted on its own. Pass AD_TARGET as a build
# setting (`xcodebuild ... AD_TARGET=off`) or export it; fastlane has to forward
# its own the same way.
#
# ARCHIVE VERSUS RUN. Xcode sets ACTION=install for Archive (and for
# `xcodebuild archive`, which is what fastlane runs) and ACTION=build for Build
# and Run. Only ACTION=build gets the lenient rules below. Any other value, or
# none, is treated as an archive, so a way of producing a binary that nobody
# thought of fails closed instead of open.
#
#   Archive: AD_TARGET must be live, off or mock. The fake-ads build (ADS:mock)
#            is refused unless AD_TARGET=mock says so, and the boot-mode builds
#            (TESTSUITE:1, ADIDCAPTURE:1) are refused whatever AD_TARGET says.
#            The bundle must carry exactly one ADMODE and exactly one ADS
#            marker, and they must be the pair AD_TARGET names.
#   Run:     test, ads-off, mock and boot-mode bundles all build, with a note,
#            so the simulator and a cabled phone stay usable. A LIVE bundle
#            still needs AD_TARGET=live: running one is a real-ads binary on
#            whatever device is attached. A bundle with no ADMODE marker is
#            refused here too, since nothing proves it is not live.
#
# Exit 1 fails the build with a red error in Xcode. Output lines start with
# "error:", "warning:" or "note:", which Xcode shows in the issue navigator.
set -eu

public="${SRCROOT:?SRCROOT is not set. Run this from the App target build phase}/App/public/assets"
target="${AD_TARGET:-}"
action="${ACTION:-}"

refuse() {
  echo "error: Foldwing ad-mode guard: $1"
  exit 1
}

if [ "$action" = "build" ]; then
  archive=no
else
  archive=yes
fi

case "$target" in
  "" | test | live | off | mock) ;;
  *) refuse "AD_TARGET='$target' is not a mode. Use live, off or mock to archive; leave it empty to Run." ;;
esac

if [ "$archive" = yes ]; then
  case "$target" in
    live | off | mock) ;;
    test)
      refuse "AD_TARGET=test cannot be archived. On LevelPlay a test-mode build serves the REAL waterfall, so it is a real-ads build under a safe-sounding name. Archive AD_TARGET=off for TestFlight (npm run ios:testflight) or AD_TARGET=live for the App Store (npm run ios:appstore)."
      ;;
    "")
      refuse "archiving (ACTION=${action:-unset}) with no AD_TARGET. Nobody said which ads this binary carries. State AD_TARGET=off (TestFlight) or AD_TARGET=live (App Store build N, followed at once by an ads-off N+1)."
      ;;
  esac
fi

if [ ! -d "$public" ]; then
  refuse "$public does not exist. Run an npm sync chain first (npm run ios:testflight, ios:appstore or ios:sync:mock)."
fi

has() {
  grep -Fqs "$1" "$public"/*.js
}

mark() {
  if has "$1"; then echo yes; else echo no; fi
}

mode_test=$(mark 'ADMODE:test')
mode_live=$(mark 'ADMODE:live')
ads_on=$(mark 'ADS:on')
ads_off=$(mark 'ADS:off')
ads_mock=$(mark 'ADS:mock')
suite=$(mark 'TESTSUITE:1')
capture=$(mark 'ADIDCAPTURE:1')

# A LIVE bundle needs a stated AD_TARGET=live on every action, Run included, and
# this comes before every Run-only allowance below: a mock or Test Suite bundle
# that somehow also says ADMODE:live is still a LIVE bundle.
if [ "$mode_live" = yes ] && [ "$target" != live ]; then
  refuse "App/public carries a LIVE-ads bundle (ADMODE:live) and nobody said so. This binary would serve real ads. Only the App Store build N is live, archived with AD_TARGET=live and followed IMMEDIATELY by an ads-off N+1. For anything else run 'npm run ios:testflight' (ads off) or 'npm run ios:sync:mock' (fake ads) first."
fi

# The builds that are never a release, whatever else their markers say. The
# fake-ads build carries ADMODE:test like a test build, and the Test Suite and
# ad-id capture entries carry ADMODE:test + ADS:on, so only their own markers
# keep them out of an archive. The fake-ads build is archived only when
# AD_TARGET=mock names it — for TestFlight, never the store.
if [ "$archive" = yes ] && [ "$ads_mock" = yes ] && [ "$target" != mock ]; then
  refuse "App/public holds the FAKE-ADS build (ADS:mock) but AD_TARGET=$target. It draws our own ads, calls no network and earns nothing, so it is archived only as AD_TARGET=mock, for TestFlight (fastlane beta_mock). Run 'npm run ios:testflight' (off) or 'npm run ios:appstore' (live) first."
fi
if [ "$archive" = yes ] && [ "$suite" = yes ]; then
  refuse "App/public holds a TEST SUITE entry (TESTSUITE:1), not the game. It must never be archived. Rebuild without VITE_TESTSUITE."
fi
if [ "$archive" = yes ] && [ "$capture" = yes ]; then
  refuse "App/public holds an AD-ID CAPTURE screen (ADIDCAPTURE:1), not the game. It must never be archived. Rebuild without VITE_ADID_CAPTURE."
fi

if [ "$mode_test" = no ] && [ "$mode_live" = no ]; then
  refuse "App/public carries no ADMODE marker, so nothing proves it is not a live-ads bundle (a bundle synced before the LevelPlay migration looks exactly like this). Run an npm sync chain: ios:testflight (off), ios:sync:mock (fake ads) or ios:appstore (live)."
fi

if [ "$archive" = no ]; then
  # Run. A stated AD_TARGET still has to match the bundle exactly, stale
  # markers included; an empty one accepts anything the live check above let
  # through.
  case "$target" in
    live)
      { [ "$mode_live" = yes ] && [ "$mode_test" = no ] && [ "$ads_on" = yes ] && [ "$ads_off" = no ] && [ "$ads_mock" = no ]; } || refuse "AD_TARGET=live but App/public is not an ADMODE:live + ADS:on bundle. Run 'npm run ios:appstore' first, or drop AD_TARGET."
      echo "warning: Foldwing ad-mode guard: running a LIVE-ads bundle on purpose (AD_TARGET=live). It serves real ads on whatever device it lands on. Never tap or open an ad."
      ;;
    off)
      { [ "$ads_off" = yes ] && [ "$ads_on" = no ] && [ "$ads_mock" = no ]; } || refuse "AD_TARGET=off but App/public is not an ads-off bundle (ADS:off). Run 'npm run ios:testflight' first, or drop AD_TARGET."
      echo "note: Foldwing ad-mode guard: ads-off bundle (ADS:off). The ad layer never initialises; nothing loads."
      ;;
    mock)
      { [ "$ads_mock" = yes ] && [ "$ads_on" = no ] && [ "$ads_off" = no ]; } || refuse "AD_TARGET=mock but App/public is not the fake-ads bundle (ADS:mock). Run 'npm run ios:sync:mock' first, or drop AD_TARGET."
      echo "note: Foldwing ad-mode guard: FAKE-ADS bundle (ADS:mock), Run only. No network is called and every ad surface is safe to tap. Never archive it."
      ;;
    test)
      { [ "$mode_test" = yes ] && [ "$ads_on" = yes ] && [ "$ads_off" = no ] && [ "$ads_mock" = no ]; } || refuse "AD_TARGET=test but App/public is not an ADMODE:test + ADS:on bundle. Run 'npm run ios:sync' first, or drop AD_TARGET."
      echo "warning: Foldwing ad-mode guard: TEST-mode bundle (ADMODE:test + ADS:on), Run only. On LevelPlay this is the REAL waterfall: never tap or open an ad, and never archive it."
      ;;
    "")
      if [ "$ads_mock" = yes ]; then
        echo "note: Foldwing ad-mode guard: FAKE-ADS bundle (ADS:mock), Run only. No network is called and every ad surface is safe to tap. Never archive it."
      elif [ "$suite" = yes ] || [ "$capture" = yes ]; then
        echo "warning: Foldwing ad-mode guard: boot-mode bundle (Test Suite or ad-id capture), Run only. Rows in the Test Suite are LIVE ads: look once, never tap. Never archive it."
      elif [ "$ads_off" = yes ]; then
        echo "note: Foldwing ad-mode guard: ads-off bundle (ADS:off). The ad layer never initialises; nothing loads."
      else
        echo "warning: Foldwing ad-mode guard: ADMODE:test bundle with the ad layer ON. On LevelPlay this is the REAL waterfall: never tap or open an ad, and never archive it. Prefer 'npm run ios:sync:mock' to look at ad UI."
      fi
      ;;
  esac
  exit 0
fi

# Archive. Every ambiguity is a refusal from here on.
if [ "$mode_test" = yes ] && [ "$mode_live" = yes ]; then
  refuse "App/public carries BOTH ADMODE:test and ADMODE:live, so a stale chunk sits beside a fresh one and the bundle cannot be proven. Re-run the npm sync chain."
fi
ads_count=0
if [ "$ads_on" = yes ]; then ads_count=$((ads_count + 1)); fi
if [ "$ads_off" = yes ]; then ads_count=$((ads_count + 1)); fi
if [ "$ads_mock" = yes ]; then ads_count=$((ads_count + 1)); fi
if [ "$ads_count" -ne 1 ]; then
  refuse "App/public carries $ads_count of the ADS:on / ADS:off / ADS:mock markers where an archive needs exactly one, so it cannot be proven. Re-run the npm sync chain."
fi

if [ "$target" = live ]; then
  [ "$mode_live" = yes ] || refuse "AD_TARGET=live but App/public carries a TEST-mode bundle (ADMODE:test). Run 'npm run ios:appstore' first."
  [ "$ads_off" = no ] || refuse "AD_TARGET=live but App/public carries an ads-off bundle (ADS:off). A store build that never loads an ad is a contradiction. Run 'npm run ios:appstore' first."
  echo "warning: Foldwing ad-mode guard: archiving a LIVE-ads build on purpose (AD_TARGET=live). This is half a release: upload the ads-off build N+1 IMMEDIATELY after this one, so TestFlight never offers a real-ads build."
  exit 0
fi

if [ "$target" = mock ]; then
  [ "$ads_mock" = yes ] || refuse "AD_TARGET=mock but App/public is not the fake-ads bundle (ADS:mock). Run 'npm run ios:sync:mock' first."
  [ "$mode_test" = yes ] || refuse "AD_TARGET=mock over a bundle with no ADMODE:test. The fake-ads build is always test mode, so this pairing cannot come from a real chain. Run 'npm run ios:sync:mock' first."
  echo "note: Foldwing ad-mode guard: archiving a FAKE-ADS build (AD_TARGET=mock) for TestFlight. It draws our own ads, calls no network and earns nothing. Never attach it to an App Store version."
  exit 0
fi

# target = off
[ "$ads_off" = yes ] || refuse "AD_TARGET=off but App/public carries ADS:on. That bundle loads the live waterfall. Run 'npm run ios:testflight' (VITE_ADS=off) first."
[ "$mode_test" = yes ] || refuse "AD_TARGET=off over a bundle with no ADMODE:test. An ads-off build is always test mode, so this pairing cannot come from a real chain. Run 'npm run ios:testflight' first."
echo "note: Foldwing ad-mode guard: archiving an ADS-OFF build (AD_TARGET=off). The ad layer never initialises; it loads no ad on any track."
exit 0
