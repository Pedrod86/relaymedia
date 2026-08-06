# Building the Android APK

This project ships a Capacitor Android wrapper in `android/`. The app is
server-rendered, so the APK loads the hosted site defined in
`capacitor.config.ts` (`server.url`). Publish the web app first — the APK
always shows the latest published build, no rebuild needed for content changes.

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
6. The APK lands in `android/app/release/app-release.apk`. Copy it to a phone or
   Android TV box and install (enable "Install unknown apps").

## Command line alternative

```bash
bun run cap:sync
bun run android:apk        # android/app/build/outputs/apk/release/
bun run android:bundle     # .aab for Google Play
```

Unsigned release builds won't install; add a `signingConfig` in
`android/app/build.gradle` or use the Android Studio wizard above.

## Notes

- App id: `app.lovable.streamrelay` — change it in `capacitor.config.ts` and
  re-run `cap sync` before publishing to Play.
- Android TV is supported: the launcher includes `LEANBACK_LAUNCHER` and a TV
  banner, and touchscreen is not required.
- Cleartext traffic is allowed so local Emby/Jellyfin/Plex servers on plain
  HTTP still work.
- To point the APK at a different domain, edit `server.url` in
  `capacitor.config.ts` and re-run `bun run cap:sync`.
