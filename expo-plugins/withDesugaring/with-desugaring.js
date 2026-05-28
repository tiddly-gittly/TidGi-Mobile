const { withAppBuildGradle } = require('@expo/config-plugins');

const DESUGAR_DEPENDENCY = "coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs:2.1.5'";

function applyCoreLibraryDesugaring(contents) {
  let modified = contents;

  if (!modified.includes('coreLibraryDesugaringEnabled')) {
    if (modified.includes('compileOptions {')) {
      modified = modified.replace(
        /(compileOptions\s*\{)/,
        '$1\n        coreLibraryDesugaringEnabled true',
      );
    } else {
      modified = modified.replace(
        /^(android\s*\{)/m,
        '$1\n    compileOptions {\n        coreLibraryDesugaringEnabled true\n    }',
      );
    }
  }

  if (!modified.includes('desugar_jdk_libs')) {
    modified = modified.replace(
      /^(dependencies\s*\{)/m,
      `$1\n    ${DESUGAR_DEPENDENCY}`,
    );
  }

  return modified;
}

const withDesugaring = (config) => {
  return withAppBuildGradle(config, (config) => {
    config.modResults.contents = applyCoreLibraryDesugaring(config.modResults.contents);
    return config;
  });
};

module.exports = withDesugaring;
