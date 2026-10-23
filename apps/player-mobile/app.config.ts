import type { ExpoConfig } from "expo/config";

/**
 * Buzzavid app configuration. Values that differ per deployment come from
 * environment variables (see .env.example and docs/app-store.md).
 */
const siteUrl = process.env.EXPO_PUBLIC_SITE_URL ?? "https://example.com";
const webHost = (() => {
  try {
    return new URL(siteUrl).host;
  } catch {
    return "example.com";
  }
})();
const iosBundleId = process.env.IOS_BUNDLE_ID ?? "com.buzzavid.app";
const androidPackage = process.env.ANDROID_PACKAGE_NAME ?? "com.buzzavid.app";
const CAMERA = "Buzzavid uses the camera only to scan a game's QR code. Nothing is recorded or saved.";
const PHOTOS = "Buzzavid needs your photos only when you choose a picture to put on a quiz question.";

const config: ExpoConfig = {
  name: "Buzzavid",
  slug: "buzzavid",
  version: "1.0.0",
  orientation: "portrait",
  scheme: ["buzzavid", "crowdquiz"],
  userInterfaceStyle: "dark",
  backgroundColor: "#080B18",
  icon: "./assets/icon.png",
  ios: {
    bundleIdentifier: iosBundleId,
    buildNumber: "1",
    supportsTablet: false,
    requireFullScreen: false,
    associatedDomains: [`applinks:${webHost}`],
    infoPlist: {
      NSCameraUsageDescription: CAMERA,
      NSPhotoLibraryUsageDescription: PHOTOS,
      ITSAppUsesNonExemptEncryption: false,
      CFBundleDisplayName: "Buzzavid",
    },
    // Apple's privacy manifest: which system APIs the app uses and what data it collects.
    // Keep in step with docs/app-store.md (the App Privacy answers in App Store Connect).
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyAccessedAPITypes: [
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults", NSPrivacyAccessedAPITypeReasons: ["CA92.1"] },
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp", NSPrivacyAccessedAPITypeReasons: ["C617.1", "0A2A.1", "3B52.1"] },
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategorySystemBootTime", NSPrivacyAccessedAPITypeReasons: ["35F9.1"] },
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryDiskSpace", NSPrivacyAccessedAPITypeReasons: ["E174.1", "85F4.1"] },
      ],
      NSPrivacyCollectedDataTypes: [
        { NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeEmailAddress", NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] },
        { NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeName", NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] },
        { NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeUserID", NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] },
        { NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypePhotosorVideos", NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] },
        { NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeOtherUserContent", NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] },
        { NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeGameplayContent", NSPrivacyCollectedDataTypeLinked: false, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] },
      ],
    },
  },
  android: {
    package: androidPackage,
    versionCode: 1,
    permissions: ["android.permission.CAMERA", "android.permission.VIBRATE"],
    blockedPermissions: ["android.permission.RECORD_AUDIO", "android.permission.READ_EXTERNAL_STORAGE", "android.permission.WRITE_EXTERNAL_STORAGE"],
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#080B18" },
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
    "expo-web-browser",
    ["expo-camera", { cameraPermission: CAMERA, microphonePermission: false, recordAudioAndroid: false }],
    ["expo-image-picker", { photosPermission: PHOTOS, cameraPermission: false, microphonePermission: false }],
    ["expo-splash-screen", { image: "./assets/splash-icon.png", imageWidth: 200, resizeMode: "contain", backgroundColor: "#080B18" }],
  ],
  experiments: { typedRoutes: true },
  extra: {
    webHost,
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
  },
};

export default config;
