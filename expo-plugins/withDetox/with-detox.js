/**
 * Expo Config Plugin: withDetox
 *
 * Injects the Detox E2E testing hooks into the Android native project during
 * `expo prebuild`. This survives `expo prebuild --clean` and ensures CI builds
 * include the Detox instrumentation runner without any manual android/ edits.
 *
 * What it does:
 *  1. Adds the local Detox Maven repo (Detox-android/) to allprojects repos in
 *     android/build.gradle — using an absolute path resolved at prebuild time.
 *  2. Adds `testInstrumentationRunner` + `testBuildType` to defaultConfig in
 *     android/app/build.gradle.
 *  3. Adds `androidTestImplementation('com.wix:detox:+')` to dependencies.
 *  4. Copies DetoxTest.java (with package-name substitution) into the
 *     androidTest source set.
 *  5. Copies an androidTest AndroidManifest.xml that fixes the
 *     `android:exported` merge error on SDK 31+.
 *
 * IMPORTANT: `detox` must be a direct devDependency in the root package.json
 * so that pnpm creates the node_modules/detox symlink and require.resolve works.
 *
 * Usage in app.json:
 *   "plugins": ["./expo-plugins/withDetox/with-detox.js"]
 */

const { withAppBuildGradle, withDangerousMod, withProjectBuildGradle } = require('@expo/config-plugins');
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

  // ── 2. androidTestImplementation ──────────────────────────────────────────
  if (!contents.includes('com.wix:detox')) {
    contents = contents.replace(
      /^(dependencies\s*\{)/m,
      "$1\n    androidTestImplementation('com.wix:detox:+')",
    );
  }

  return contents;
}

const withDetox = (config) => {
  // ── Step 1: add Detox local Maven repo to root build.gradle ───────────────
  // detox must be a direct devDependency (root package.json) so that pnpm
  // creates node_modules/detox as a symlink. Then this Gradle-relative path
  // works on any machine (local and CI alike).
  config = withProjectBuildGradle(config, (gradleConfig) => {
    if (!gradleConfig.modResults.contents.includes('Detox-android')) {
      gradleConfig.modResults.contents = gradleConfig.modResults.contents.replace(
        /(allprojects\s*\{\s*\n\s*repositories\s*\{)/,
        '$1\n    // Detox local Maven repo (shipped with the npm package)\n    maven { url "$rootDir/../node_modules/detox/Detox-android" }',
      );
    }

    if (!gradleConfig.modResults.contents.includes('Detox duplicate native lib workaround')) {
      gradleConfig.modResults.contents += `

// Detox duplicate native lib workaround
// Some RN libraries (e.g. react-native-gesture-handler androidTest variant)
// package libfbjni.so while react-android also contributes the same file.
// Keep the first one to avoid :mergeDebugAndroidTestNativeLibs failures.
subprojects {
  afterEvaluate { p ->
    if (p.hasProperty('android')) {
      p.android {
        packagingOptions {
          jniLibs {
            pickFirsts += ['**/libfbjni.so']
          }
        }
      }
    }
  }
}
`;
    }

    return gradleConfig;
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
