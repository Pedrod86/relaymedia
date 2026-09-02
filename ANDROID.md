# Relay Media — Android phone, tablet & Android TV APK

This project ships a Capacitor Android wrapper in `android/`. One APK covers
phones, tablets, Android TV, Google TV and Fire TV: the launcher declares both
the normal and the LEANBACK launcher category, touchscreen is optional, and the
app auto-switches to the 10-foot TV layout when it detects a TV/box.

The app is server-rendered, so the APK loads the hosted site defined in
`capacitor.config.ts` (`server.url`). Publish the web app first — the APK always
shows the latest published build, so content updates need no new APK.

## One-time setup

1. Install [Android Studio](https://developer.android.com/studio) (includes the
   Android SDK and JDK 21).
2. Clone/download this project and install dependencies: `bun install`.

## Build a signed APK (Android Studio)

1. `bun run cap:sync` — copies config/assets into the native project.
2. `bun run cap:open` — opens `android/` in Android Studio.
3. **Build → Generate Signed App Bundle / APK…**
4. Pick **APK**, then **Create new…** keystore (store it somewhere safe and keep
   the passwords — you need the same keystore for every future update).
5. Choose the **release** build variant → **Finish**.
6. The APK lands in `android/app/release/app-release.apk`.

## Command line

```bash
bun run cap:sync
bun run android:apk        # android/app/build/outputs/apk/release/
bun run android:bundle     # .aab for Google Play
```

Release builds are always signed, so they install immediately:

- With no keystore configured, Gradle signs with the debug key — fine for
  sideloading onto your own phone or TV box, not for Play.
- For a real release key, create `android/keystore.properties` (git-ignored):

  ```properties
  storeFile=/absolute/path/relay-release.jks
  storePassword=…
  keyAlias=relay
  keyPassword=…
  ```

  or set `RELAY_STORE_FILE`, `RELAY_STORE_PASSWORD`, `RELAY_KEY_ALIAS`,
  `RELAY_KEY_PASSWORD` as environment variables (CI uses these).

## Automated builds (GitHub Actions) — persistent release key

`.github/workflows/android.yml` builds the APK and AAB on any `v*` tag or via
**Run workflow**, signs them with your permanent release keystore, and uploads
both as artifacts. Every build gets a higher `versionCode`
(`1000 + run number`), so a new APK installs straight over the old one without
uninstalling.

A release keystore was generated for this project (`relay-release.jks`,
alias `relay`, RSA 4096, valid ~30 years). Keep it and its passwords forever —
losing it means future APKs can no longer update installed copies.

Add these GitHub repository secrets (Settings → Secrets and variables →
Actions):

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | contents of `relay-release.jks.base64` |
| `ANDROID_STORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | `relay` |
| `ANDROID_KEY_PASSWORD` | key password (same as store password) |

Then release with:

```bash
git tag v1.1 && git push origin v1.1
```

or run the workflow manually and pass a `version_name`. Download the APK/AAB
from the run's **Artifacts** section. The workflow prints the signing
certificate so you can confirm every build uses the same key.

Local builds use the same key by creating `android/keystore.properties`
(git-ignored) pointing at `relay-release.jks`.

## Installing on Android TV / Fire TV

- Fire TV / Android TV: enable **Developer options → Install unknown apps**,
  then sideload with `adb install -r app-release.apk` (or use Downloader/Send
  Files to TV).
- The app appears on the TV home row with the banner in
  `android/app/src/main/res/drawable-xhdpi/tv_banner.png`.
- TV layout: shelves + sidebar, D-pad/remote navigation, and the on-screen
  remote keyboard for search. It turns on automatically on TV devices and can be
  toggled from the header button on any device.

## Notes

- App id: `com.relaymedia.app` — change it in `capacitor.config.ts` and
  re-run `cap sync` before publishing to Play.
- Cleartext traffic is allowed so local Emby/Jellyfin/Plex servers on plain HTTP
  still work.
- HTTPS deep links for `relay-media.store` and `stream-vault.live` open in the
  app. For verified app links (no chooser dialog), host an
  `/.well-known/assetlinks.json` with your signing certificate fingerprint.
- To point the APK at a different domain, edit `server.url` in
  `capacitor.config.ts` and re-run `bun run cap:sync`.
