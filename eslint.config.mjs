import tidgiConfig from 'eslint-config-tidgi';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default [
  ...tidgiConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['./*.js', './*.mjs'],
        },
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      'react-native/no-inline-styles': 'off',
      'react-native/no-raw-text': 'off',
    },
  },
];
