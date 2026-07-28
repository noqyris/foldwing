fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## iOS

### ios verify

```sh
[bundle exec] fastlane ios verify
```

Verify API-key auth and whether the app record exists

### ios setup_app

```sh
[bundle exec] fastlane ios setup_app
```

Create the App Store Connect app record if missing

### ios build_ipa

```sh
[bundle exec] fastlane ios build_ipa
```

Archive a signed App Store build

### ios beta

```sh
[bundle exec] fastlane ios beta
```

Build and upload to TestFlight

### ios beta_upload

```sh
[bundle exec] fastlane ios beta_upload
```

Re-upload the ipa already in build/ without rebuilding

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
