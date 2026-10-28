import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Configuración de la app. Todo lo nativo se configura aquí o con config plugins:
 * android/ e ios/ los genera `expo prebuild` y no se suben al repo.
 *
 * Disfraz: el nombre visible, el esquema de enlaces y el identificador del paquete son neutrales
 * a propósito. Nada en el launcher, en Ajustes del sistema ni en el selector de apps menciona
 * el proyecto.
 */
const PAPEL = "#FBFCFE";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Cuaderno",
  slug: "cuaderno",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "cuaderno",
  userInterfaceStyle: "light",
  backgroundColor: PAPEL,
  ios: {
    bundleIdentifier: "pe.bodega.cuaderno",
    supportsTablet: false,
    infoPlist: {
      NSMicrophoneUsageDescription: "Para grabar notas de voz.",
      NSCameraUsageDescription: "Para tomar fotos.",
      NSPhotoLibraryUsageDescription: "Para elegir una foto.",
    },
  },
  android: {
    package: "pe.bodega.cuaderno",
    // Sin copias de seguridad: ni adb backup ni la nube del sistema se llevan datos de la app.
    allowBackup: false,
    adaptiveIcon: {
      backgroundColor: PAPEL,
      foregroundImage: "./assets/images/android-icon-foreground.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
    softwareKeyboardLayoutMode: "resize",
    permissions: ["android.permission.RECORD_AUDIO", "android.permission.CAMERA"],
    // Cero notificaciones y nada de acceso amplio a archivos.
    blockedPermissions: [
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO",
      "android.permission.READ_MEDIA_AUDIO",
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_MICROPHONE",
      "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
      "android.permission.RECEIVE_BOOT_COMPLETED",
      "android.permission.USE_BIOMETRIC",
      "android.permission.USE_FINGERPRINT",
    ],
  },
  plugins: [
    "expo-router",
    [
      "expo-splash-screen",
      {
        backgroundColor: PAPEL,
        image: "./assets/images/splash-icon.png",
        imageWidth: 96,
      },
    ],
    // Base local cifrada con SQLCipher (requiere build nativo, no funciona en Expo Go).
    ["expo-sqlite", { useSQLCipher: true }],
    ["expo-secure-store", { configureAndroidBackup: false }],
    [
      "expo-audio",
      {
        microphonePermission: "Para grabar notas de voz.",
        enableBackgroundRecording: false,
        enableBackgroundPlayback: false,
      },
    ],
    [
      "expo-camera",
      {
        cameraPermission: "Para tomar fotos.",
        recordAudioAndroid: false,
        barcodeScannerEnabled: false,
      },
    ],
    ["expo-image-picker", { photosPermission: "Para elegir una foto." }],
    [
      "expo-share-intent",
      {
        androidIntentFilters: ["text/*", "image/*", "audio/*", "video/*"],
        disableIOS: true,
      },
    ],
  ],
  experiments: {
    typedRoutes: false,
    reactCompiler: false,
  },
});
