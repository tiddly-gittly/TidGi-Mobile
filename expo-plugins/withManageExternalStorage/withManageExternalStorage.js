/**
 * Expo config plugin to add MANAGE_EXTERNAL_STORAGE permission to AndroidManifest.xml.
 * This allows the app to access all files on the device's external storage,
 * similar to how Obsidian accesses /sdcard/Documents/.
 *
 * The permission still needs to be granted by the user at runtime via system settings.
 * Use expo-intent-launcher to redirect users to the settings page.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const withManageExternalStorage = (config) => {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    // Ensure uses-permission array exists
    if (!manifest['uses-permission']) {
      manifest['uses-permission'] = [];
    }

    // Add MANAGE_EXTERNAL_STORAGE permission if not already present
    const alreadyExists = manifest['uses-permission'].some(
      (perm) => perm.$?.['android:name'] === 'android.permission.MANAGE_EXTERNAL_STORAGE',
    );

    if (!alreadyExists) {
      manifest['uses-permission'].push({
        $: { 'android:name': 'android.permission.MANAGE_EXTERNAL_STORAGE' },
      });
    }

    return config;
  });
};

module.exports = withManageExternalStorage;
