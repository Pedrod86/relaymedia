import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.relaymedia.app',
  appName: 'Relay Media',
  // Local fallback page shown only if the hosted app can't be reached.
  webDir: 'capacitor-www',
  server: {
    // The app is server-rendered, so the APK loads the hosted build.
    url: 'https://relay-media.lovable.app',
    cleartext: false,
    androidScheme: 'https',
    // Allow direct connections to the hosted app and local media servers.
    allowNavigation: [
      'relay-media.lovable.app',
      '*.relay-media.lovable.app',
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
