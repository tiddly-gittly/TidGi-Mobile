// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const fs = require('fs');
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);
const {
  resolver: { sourceExts, assetExts },
  resolver,
} = config;

// Get the project root
const projectRoot = __dirname;
const linkedPackageRoots = [
  '@memeloop/libp2p',
  '@memeloop/react-ui',
  'memeloop',
].flatMap((packageName) => {
  try {
    return [fs.realpathSync(path.join(projectRoot, 'node_modules', packageName))];
  } catch {
    return [];
  }
});

module.exports = {
  ...config,
  projectRoot,
  // pnpm links our shared MemeLoop packages outside this worktree. Metro must
  // watch their real roots to resolve their exported subpaths on native.
  watchFolders: [projectRoot, ...linkedPackageRoots],
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
          if (typeof name !== 'string') return undefined;
          if (target[name]) {
            return target[name];
          }
          // Let Metro resolve package export subpaths (for example
          // @memeloop/react-ui/native). Mapping a missing subpath directly
          // would bypass the package's exports map.
          const fallback = path.join(projectRoot, `node_modules/${name}`);
          return fs.existsSync(fallback) ? fallback : undefined;
        },
      }
    ),
  },
};
