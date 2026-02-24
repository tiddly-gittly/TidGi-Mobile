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

const { withAppBuildGradle, withDangerousMod, withSettingsGradle } = require('@expo/config-plugins');
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

  // ── 2. androidTestImplementation as a LOCAL project reference ─────────────
  // Using project(':detox') instead of 'com.wix:detox:+' (Maven coordinate)
  // because the local node_modules copy is the authoritative source and the
  // Maven artifact may not align with the installed version.
  if (!contents.includes('project(\':detox\')')) {
    contents = contents.replace(
      /^(dependencies\s*\{)/m,
      "$1\n    androidTestImplementation(project(':detox'))",
    );
  }

  return contents;
}

const withDetox = (config) => {
  // ── Step 1: add :detox local project to settings.gradle ───────────────────
  // The detox Android library lives in node_modules/detox/android/detox.
  // Including it as a local Gradle project (rather than a Maven coordinate)
  // guarantees the version matches the JS package and avoids network fetches.
  config = withSettingsGradle(config, (settingsConfig) => {
    if (!settingsConfig.modResults.contents.includes("include ':detox'")) {
      settingsConfig.modResults.contents += [
        '',
        '// Detox E2E testing — include local Android library from node_modules',
        "include ':detox'",
        "project(':detox').projectDir = new File(rootProject.projectDir, '../node_modules/detox/android/detox')",
      ].join('\n');
    }
    return settingsConfig;
  });

  // ── Step 2: patch app/build.gradle ────────────────────────────────────────
  config = withAppBuildGradle(config, (gradleConfig) => {
    gradleConfig.modResults.contents = applyDetoxBuildGradle(
      gradleConfig.modResults.contents,
    );
    return gradleConfig;
  });

  // ── Step 3: copy DetoxTest.java + androidTest AndroidManifest.xml ──────────
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
