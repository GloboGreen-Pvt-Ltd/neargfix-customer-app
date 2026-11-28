import fs from 'fs';
import path from 'path';

// Firebase config for remote push (native FCM token on Android). Without it the
// build cannot get a push token at all, so the server's customer pushes go nowhere.
// EAS: secret file env var GOOGLE_SERVICES_JSON (the JSON is not in git);
// local builds fall back to the untracked ./google-services.json.
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON
  || (fs.existsSync(path.join(__dirname, 'google-services.json')) ? './google-services.json' : null);

// Use your computer's IP when running on a physical device so the app can reach your backend.
// Run: set EXPO_PUBLIC_API_HOST=192.168.1.5  (then npx expo start)
// Or create .env with EXPO_PUBLIC_API_HOST=192.168.1.5
const host = process.env.EXPO_PUBLIC_API_HOST || 'localhost';
const masterPort = process.env.EXPO_PUBLIC_MASTER_PORT || '8091';
const masterBase =
  process.env.EXPO_PUBLIC_MASTER_BASE || `http://${host}:${masterPort}/`;

export default {
  expo: {
    name: 'Customer',
    slug: 'neargfix-customer',
    // EAS account/organization that owns the project (from your Expo dashboard).
    // Verify this matches expo.dev → your account. Change if different.
    owner: 'globogreen-system-and-technology-private-limited',
    version: '1.0.0',
    // OTA (EAS Update): updates download in the background on launch and apply on
    // the next cold start (fallbackToCacheTimeout 0) - no mid-session reloads.
    runtimeVersion: { policy: 'appVersion' },
    updates: {
      url: 'https://u.expo.dev/' + (process.env.EAS_PROJECT_ID || '4d7d99e9-588c-4345-910f-0c8be1f41f1b'),
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
    },
    platforms: ['ios', 'android', 'web'],
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    jsEngine: 'hermes',
    icon: './assets/logo.png',
    // Same dark teal as the in-app boot screen (LaunchOverlay), so the native
    // splash hands over to it without a colour jump.
    splash: { image: './assets/logo.png', resizeMode: 'contain', backgroundColor: '#004C40' },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.neargfix.customer',
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          'We use your location to show pickup-enabled repair shops nearby and to set your default delivery address.',
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: true,
        },
      },
    },
    android: {
      package: 'com.neargfix.customer',
      // Google Maps (Android) key from env / EAS secret — never committed.
      config: { googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY } },
      adaptiveIcon: { foregroundImage: './assets/logo.png', backgroundColor: '#202124' },
      ...(googleServicesFile ? { googleServicesFile } : {}),
      // POST_NOTIFICATIONS: Android 13+ runtime permission for push banners.
      permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'POST_NOTIFICATIONS'],
    },
    plugins: [
      ['expo-local-authentication', { faceIDPermission: 'Use Face ID to unlock NearGFix.' }],
      ['expo-audio', { microphonePermission: 'We use your microphone to record voice notes for your repair complaint and chat.' }],
      ['expo-camera', { cameraPermission: 'NearGFix uses your camera to identify a device from a photo and to scan QR codes and barcodes.', recordAudioAndroid: false }],
      ['expo-image-picker', { photosPermission: 'NearGFix uses your photos only to identify a device from a picture you choose.', cameraPermission: 'NearGFix uses your camera to identify a device from a photo and to scan QR codes and barcodes.', microphonePermission: false }],
      // Cleartext HTTP for the plain-http backend. The bare android.usesCleartextTraffic
      // key is ignored by Expo prebuild — it must be set via expo-build-properties.
      [
        'expo-build-properties',
        {
          android: {
            usesCleartextTraffic: true,
            // Ship native libraries for real phones only (arm64-v8a). This drops the
            // emulator-only ABIs (x86/x86_64) and old 32-bit devices (armeabi-v7a),
            // shrinking the universal APK from ~114MB to ~50MB. buildArchs writes
            // `reactNativeArchitectures` into gradle.properties.
            buildArchs: ['arm64-v8a'],
          },
        },
      ],
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission:
            'We use your location to show pickup-enabled repair shops nearby.',
        },
      ],
      // Remote pushes without a channelId land on 'default', the HIGH-importance
      // channel lib/pushNotifications.js creates and the server targets.
      ['expo-notifications', { color: '#035C6C', defaultChannel: 'default' }],
      'expo-font',
      'expo-asset',
      'expo-sharing',
      'expo-status-bar',
    ],
    extra: {
      API_HOST: host,
      API_BASE_URL: null,
      AUTH_BASE: null,
      MASTER_BASE: masterBase,
      TICKET_BASE: null,
      TECHNICIAN_BASE: null,
      SHOP_BASE: null,
      INVENTORY_BASE: null,
      MARKETPLACE_BASE: null,
      PICKUP_BASE: null,
      ORDER_BASE: null,
      // Required for EAS builds. Get this value by running `npx eas init`
      // (it prints the ID), or copy it from expo.dev → your project → settings.
      eas: {
        projectId:
          process.env.EAS_PROJECT_ID ||
          '4d7d99e9-588c-4345-910f-0c8be1f41f1b',
      },
    },
  },
};
