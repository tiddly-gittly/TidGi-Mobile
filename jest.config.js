const expoPreset = require('jest-expo/jest-preset');

module.exports = {
  ...expoPreset,
  setupFiles: [],
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
};
