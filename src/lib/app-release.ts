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
  versionName: "1.1",
  versionCode: 3,
  apkUrl: "https://relay-media.lovable.app/downloads/relay-media-latest.apk",
  notes: "Native Media3/ExoPlayer playback, offline recovery screen and stability fixes.",
  mandatory: false,
};
