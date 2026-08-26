const expoPreset = require('jest-expo/jest-preset');

module.exports = {
  ...expoPreset,
  setupFiles: [],
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
  testPathIgnorePatterns: ['<rootDir>/src/services/AgentLoopService/__tests__/runtime.integration.test.ts'],
  // Jest executes a dependency's untransformed `.cjs` entry in a process-wide
  // realm. MemeLoop intentionally rejects foreign-realm prototypes at durable
  // boundaries, so a later test file would otherwise observe the encoder from
  // whichever suite loaded the package first. Route the application entrypoints
  // through their equivalent ESM builds; babel-jest evaluates those inside each
  // suite's VM, which matches the single-realm React Native runtime.
  moduleNameMapper: {
    '^memeloop$': '<rootDir>/node_modules/memeloop/dist/mobile.js',
    '^memeloop/mobile$': '<rootDir>/node_modules/memeloop/dist/mobile.js',
    '^memeloop/mobile/providers$': '<rootDir>/node_modules/memeloop/dist/mobile-providers.js',
    '^memeloop/testing$': '<rootDir>/node_modules/memeloop/dist/testing.js',
  },
  // MemeLoop's canonical encoder deliberately rejects foreign-realm object
  // prototypes. Transform it inside Jest's VM so application-owned arrays and
  // records have the same intrinsics as the encoder, matching React Native.
  transformIgnorePatterns: expoPreset.transformIgnorePatterns.map(pattern =>
    pattern.replace('native-base)', 'native-base|memeloop|@memeloop)'),
  ),
};
