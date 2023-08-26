const tsEslintConfig = require('./tsconfig.eslint.json');

module.exports = {
  root: true,
  ignorePatterns: tsEslintConfig.exclude,
  parserOptions: {
    project: './tsconfig.eslint.json',
    tsconfigRootDir: __dirname,
  },
  extends: ['eslint-config-tidgi', 'plugin:react-native/all'],
  plugins: [
    'react-native',
  ],
  settings: {
    'import/ignore': ['node_modules/react-native/index\\.js$'],
  },
  env: {
    'react-native/react-native': true,
  },
};
