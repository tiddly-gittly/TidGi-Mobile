import tidgiConfig from 'eslint-config-tidgi';
import reactNative from 'eslint-plugin-react-native';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default [
  ...tidgiConfig,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    plugins: {
      'react-native': reactNative,
    },
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['./*.js', './*.mjs'],
        },
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // React Native specific rules
      'react-native/no-unused-styles': 'error',
      'react-native/split-platform-components': 'error',
      'react-native/no-inline-styles': 'warn',
      'react-native/no-color-literals': 'warn',
      'react-native/no-raw-text': 'off', // Allow raw text in Text components
      'react-native/no-single-element-style-arrays': 'error',
      // Allow necessary patterns for type definitions
      '@typescript-eslint/no-empty-object-type': ['error', { allowObjectTypes: 'always' }],
    },
  },
  {
    files: ['**/*.d.ts'],
    rules: {
      // Relax rules for type definition files
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
];
