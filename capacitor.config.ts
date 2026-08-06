import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.streamrelay',
  appName: 'Relay Media',
  // Local fallback page shown only if the hosted app can't be reached.
  webDir: 'capacitor-www',
  server: {
    // The app is server-rendered, so the APK loads the hosted build.
    url: 'https://streamrelay.lovable.app',
    cleartext: false,
    androidScheme: 'https',
    // Allow direct connections to local media servers (Emby/Jellyfin/Plex).
    allowNavigation: [
      'streamrelay.lovable.app',
      'relay-media.store',
      '*.relay-media.store',
      'stream-vault.live',
      '*.stream-vault.live',
    ],
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#0b0b0f',
  },
};

export default config;
