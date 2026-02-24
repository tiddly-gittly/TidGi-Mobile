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
 *  3. Writes DetoxTest.java into the androidTest source set.
 *  4. Writes a test AndroidManifest.xml that adds `android:exported="false"`
 *     to androidx.test.core activities (required for Android 12+).
 *
 * Usage in app.json:
 *   "plugins": ["./expo-plugins/withDetox/with-detox.js"]
 */

const { withAppBuildGradle, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/** Generate DetoxTest.java content for the given Android package name. */
function detoxTestJava(packageName) {
  return `package ${packageName};

import com.wix.detox.Detox;
import com.wix.detox.config.DetoxConfig;

import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.filters.LargeTest;
import androidx.test.rule.ActivityTestRule;

@RunWith(AndroidJUnit4.class)
@LargeTest
public class DetoxTest {

    @Rule
    // Replace MainActivity.class with your own Main Activity
    public ActivityTestRule<MainActivity> mActivityRule =
        new ActivityTestRule<>(MainActivity.class, false, false);

    @Test
    public void runDetoxTests() {
        DetoxConfig detoxConfig = new DetoxConfig();
        detoxConfig.idlePolicyConfig.masterTimeoutSec = 90;
        detoxConfig.idlePolicyConfig.idleResourceTimeoutSec = 60;
        detoxConfig.rnContextLoadTimeoutSec = (BuildConfig.DEBUG ? 180 : 60);

        Detox.runTests(mActivityRule, detoxConfig);
    }
}
`;
}

/** Patch android/app/build.gradle to add Detox test config. */
function applyDetoxBuildGradle(contents) {
  // ── 1. testInstrumentationRunner + testBuildType in defaultConfig ──────────
  // Insert after the last line of defaultConfig that we can anchor to.
  // We look for `versionName` which is always present in Expo-generated gradle.
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
  if (!contents.includes("com.wix:detox")) {
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

  // ── Step 2: write DetoxTest.java ───────────────────────────────────────────
  config = withDangerousMod(config, [
    'android',
    async (dangerousConfig) => {
      const packageName =
        dangerousConfig.android?.package ??
        dangerousConfig.modRequest.packageName ??
        'com.tidgi';
      const packagePath = packageName.split('.').join('/');

      const testDir = path.join(
        dangerousConfig.modRequest.projectRoot,
        'android',
        'app',
        'src',
        'androidTest',
        'java',
        ...packageName.split('.'),
      );

      await fs.promises.mkdir(testDir, { recursive: true });

      const destPath = path.join(testDir, 'DetoxTest.java');
      // Only write if not already present (idempotent)
      if (!fs.existsSync(destPath)) {
        await fs.promises.writeFile(destPath, detoxTestJava(packageName), 'utf8');
      }

      return dangerousConfig;
    },
  ]);

  // ── Step 3: write test AndroidManifest.xml (Android 12+ compatibility) ────
  // androidx.test.core adds EmptyActivity / EmptyFloatingActivity with intent
  // filters but without android:exported, which is required for API 31+.
  // A manifest override in the androidTest source set silences the merger error.
  config = withDangerousMod(config, [
    'android',
    async (dangerousConfig) => {
      const androidTestDir = path.join(
        dangerousConfig.modRequest.projectRoot,
        'android',
        'app',
        'src',
        'androidTest',
      );

      await fs.promises.mkdir(androidTestDir, { recursive: true });

      const manifestPath = path.join(androidTestDir, 'AndroidManifest.xml');
      const manifestContent = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">
    <application>
        <!-- Fix Android 12+ manifest merger error: androidx.test.core activities
             declare intent filters without android:exported. -->
        <activity
            android:name="androidx.test.core.app.InstrumentationActivityInvoker$EmptyActivity"
            android:exported="false"
            tools:node="mergeOnlyAttributes" />
        <activity
            android:name="androidx.test.core.app.InstrumentationActivityInvoker$EmptyFloatingActivity"
            android:exported="false"
            tools:node="mergeOnlyAttributes" />
    </application>
</manifest>
`;
      await fs.promises.writeFile(manifestPath, manifestContent, 'utf8');

      return dangerousConfig;
    },
  ]);

  return config;
};

module.exports = withDetox;
