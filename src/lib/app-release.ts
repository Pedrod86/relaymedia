// Single source of truth for the latest published Android build.
//
// Bump these when a new APK is released (CI can override via env at build time).
// `versionCode` must match `RELAY_VERSION_CODE` used by the Gradle release
// build — it's the number the in-app updater compares against.

export type AppRelease = {
  versionName: string;
  versionCode: number;
  /** Absolute HTTPS URL of the downloadable APK. */
  apkUrl: string;
  /** Optional release notes shown in the update prompt. */
  notes: string;
  /** Blocks usage until updated when true. */
  mandatory: boolean;
};

export const LATEST_ANDROID_RELEASE: AppRelease = {
  versionName: "1.8",
  versionCode: 10,
  apkUrl: "https://stream-vault.live/__l5e/assets-v1/03675413-7192-4a9a-a06c-53840f916772/relay-media-1.8.apk",
  notes: "Adds the built-in MPV player (Settings → Player → Device player engine).",
  mandatory: false,
};
