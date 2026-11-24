import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(__filename);
const projectRoot = path.resolve(__dirname, '../..');
const modulePath = process.argv[2];
if (!modulePath) throw new Error('Usage: tsx src/testing/runCrossHostSqliteSync.ts /absolute/path/to/memeloop-cli/src/storage/sqliteStorage.ts');
const mapping = {
  '^memeloop$': path.join(projectRoot, 'node_modules/memeloop/dist/index.js'),
  '^memeloop/mobile$': path.join(projectRoot, 'node_modules/memeloop/dist/mobile.js'),
  '^(\\.{1,2}/.*)\\.js$': '$1',
};
const result = spawnSync(process.execPath, [
  require.resolve('jest/bin/jest'),
  '--runInBand',
  '--testMatch',
  '**/src/testing/crossHostSqliteSync.integration.ts',
  '--testPathIgnorePatterns',
  'NOT_A_TEST_PATH',
  '--runTestsByPath',
  path.join(projectRoot, 'src/testing/crossHostSqliteSync.integration.ts'),
  '--moduleNameMapper',
  JSON.stringify(mapping),
  '--modulePaths',
  path.join(projectRoot, 'node_modules'),
], {
  cwd: projectRoot,
  env: { ...process.env, MEMELOOP_CLI_SQLITE_MODULE: path.resolve(modulePath) },
  stdio: 'inherit',
  shell: false,
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Cross-host SQLite acceptance failed: ${result.status ?? result.signal}`);
