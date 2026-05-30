/**
 * Expo config plugin: mark Google Play Services for AR (ARCore) as optional.
 *
 * expo-camera v17 references ARCore in the manifest, which causes Android
 * to show "Please install Google Play Services for AR" on devices that don't
 * have ARCore when the app launches. Since we only use the camera for QR
 * scanning (no AR needed), marking it optional silences this dialog.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * @param {import('@expo/config-plugins').ExpoConfig} config
 * @returns {import('@expo/config-plugins').ExpoConfig}
 */
module.exports = function withArOptional(config) {
  return withAndroidManifest(config, (modConfig) => {
    const androidManifest = modConfig.modResults;
    const application = androidManifest.manifest.application?.[0];
    if (!application) return modConfig;

    if (!Array.isArray(application['meta-data'])) {
      application['meta-data'] = [];
    }

    const existing = application['meta-data'].find(
      (item) => item.$?.['android:name'] === 'com.google.ar.core',
    );

    if (existing) {
      // Update to optional if already present
      existing.$['android:value'] = 'optional';
    } else {
      application['meta-data'].push({
        $: {
          'android:name': 'com.google.ar.core',
          'android:value': 'optional',
        },
      });
    }

    return modConfig;
  });
};
