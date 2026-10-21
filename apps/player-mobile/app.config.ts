import type { ExpoConfig } from "expo/config";

/**
 * Native player app configuration. Values that differ per deployment come
 * from environment variables (see .env.example and docs/mobile.md).
 */
const webHost = (() => {
  try {
    return new URL(process.env.EXPO_PUBLIC_SITE_URL ?? "https://crowdquiz.example.com").host;
  } catch {
    return "crowdquiz.example.com";
  }
})();
const iosBundleId = process.env.IOS_BUNDLE_ID ?? "com.crowdquiz.player";
const androidPackage = process.env.ANDROID_PACKAGE_NAME ?? "com.crowdquiz.player";

const config: ExpoConfig = {
  name: "CrowdQuiz",
  slug: "crowdquiz-player",
  version: "1.0.0",
  orientation: "portrait",
  scheme: "crowdquiz",
  userInterfaceStyle: "dark",
  backgroundColor: "#0B1020",
  ios: {
    bundleIdentifier: iosBundleId,
    supportsTablet: true,
    associatedDomains: [`applinks:${webHost}`],
    infoPlist: {
      NSCameraUsageDescription: "CrowdQuiz uses the camera only to scan the game's QR code.",
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: androidPackage,
    permissions: ["android.permission.CAMERA"],
    blockedPermissions: ["android.permission.RECORD_AUDIO"],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [{ scheme: "https", host: webHost, pathPrefix: "/j/" }],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    [
      "expo-camera",
      {
        cameraPermission: "CrowdQuiz uses the camera only to scan the game's QR code.",
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
  ],
  experiments: { typedRoutes: true },
  extra: {
    webHost,
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
  },
};

export default config;
