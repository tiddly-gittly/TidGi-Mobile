// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);
const {
  resolver: { sourceExts },
  resolver,
} = config;

module.exports = {
  ...config,
  resolver: {
    ...resolver,
    unstable_enableSymlinks: true,
    sourceExts: [...sourceExts, 'mjs', 'sql'],
    extraNodeModules: {
      stream: require.resolve('readable-stream'),
      // crypto: require.resolve('react-native-crypto-js'),
    },
  },
};
