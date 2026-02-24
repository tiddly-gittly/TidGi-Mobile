/**
 * Expo Config Plugin: withDetox
 *
 * Injects the Detox E2E testing hooks into the Android native project during
 * `expo prebuild`. This survives `expo prebuild --clean` and ensures CI builds
 * include the Detox instrumentation runner without any manual android/ edits.
 *
 * What it does:
 *  1. Adds `testInstrumentationRunner` + `testBuildType` to defaultConfig in
 *     android/app/build.gradle.
 *  2. Adds `androidTestImplementation('com.wix:detox:+')` to dependencies.
 *  3. Copies DetoxTest.java (with package-name substitution) into the
 *     androidTest source set.
 *  4. Copies an androidTest AndroidManifest.xml that fixes the
 *     `android:exported` merge error on SDK 31+.
 *
 * The template files live next to this plugin:
 *   expo-plugins/withDetox/DetoxTest.java
 *   expo-plugins/withDetox/AndroidManifest.xml
 *
 * Usage in app.json:
 *   "plugins": ["./expo-plugins/withDetox/with-detox.js"]
 */

const { withAppBuildGradle, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PLUGIN_DIR = __dirname;

/** Patch android/app/build.gradle to add Detox test config. */
function applyDetoxBuildGradle(contents) {
  // ── 1. testInstrumentationRunner + testBuildType in defaultConfig ──────────
  if (!contents.includes('testInstrumentationRunner')) {
    contents = contents.replace(
      /(versionName\s+"[^"]*")/,
      [
        '$1',
        "        testBuildType System.getProperty('testBuildType', 'debug')",
        "        testInstrumentationRunner 'androidx.test.runner.AndroidJUnitRunner'",
      ].join('\n'),
    );
  }

  // ── 2. androidTestImplementation in dependencies ───────────────────────────
  if (!contents.includes('com.wix:detox')) {
    contents = contents.replace(
      /^(dependencies\s*\{)/m,
      "$1\n    androidTestImplementation('com.wix:detox:+')",
    );
  }

  return contents;
}

const withDetox = (config) => {
  // ── Step 1: patch build.gradle ─────────────────────────────────────────────
  config = withAppBuildGradle(config, (gradleConfig) => {
    gradleConfig.modResults.contents = applyDetoxBuildGradle(
      gradleConfig.modResults.contents,
    );
    return gradleConfig;
  });

  // ── Step 2: copy DetoxTest.java + androidTest AndroidManifest.xml ──────────
  config = withDangerousMod(config, [
    'android',
    async (dangerousConfig) => {
      const packageName =
        dangerousConfig.android?.package ?? 'com.tidgi';
      const projectRoot = dangerousConfig.modRequest.projectRoot;

      // ── DetoxTest.java ─────────────────────────────────────────────────────
      const testJavaDir = path.join(
        projectRoot, 'android', 'app', 'src', 'androidTest', 'java',
        ...packageName.split('.'),
      );
      await fs.promises.mkdir(testJavaDir, { recursive: true });

      const templateJava = await fs.promises.readFile(
        path.join(PLUGIN_DIR, 'DetoxTest.java'), 'utf8',
      );
      const finalJava = templateJava.replace(/__PACKAGE__/g, packageName);
      await fs.promises.writeFile(
        path.join(testJavaDir, 'DetoxTest.java'), finalJava, 'utf8',
      );

      // ── AndroidManifest.xml for androidTest ────────────────────────────────
      const manifestDir = path.join(
        projectRoot, 'android', 'app', 'src', 'androidTest',
      );
      await fs.promises.mkdir(manifestDir, { recursive: true });
      await fs.promises.copyFile(
        path.join(PLUGIN_DIR, 'AndroidManifest.xml'),
        path.join(manifestDir, 'AndroidManifest.xml'),
      );

      return dangerousConfig;
    },
  ]);

  return config;
};

module.exports = withDetox;
