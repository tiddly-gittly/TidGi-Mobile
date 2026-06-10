// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);
const {
  resolver: { sourceExts, assetExts },
  resolver,
} = config;

// Get the project root
const projectRoot = __dirname;

module.exports = {
  ...config,
  projectRoot,
  watchFolders: [projectRoot],
  resolver: {
    ...resolver,
    unstable_enableSymlinks: true,
    sourceExts: [...sourceExts, 'mjs', 'sql'],
    assetExts: [...assetExts, 'zip'],
    extraNodeModules: new Proxy(
      {
        buffer: require.resolve('buffer'),
        stream: require.resolve('readable-stream'),
        // crypto: require.resolve('react-native-crypto-js'),
      },
      {
        get: (target, name) => {
          if (target[name]) {
            return target[name];
          }
          // Fallback to node_modules
          return path.join(projectRoot, `node_modules/${name}`);
        },
      }
    ),
  },
};
