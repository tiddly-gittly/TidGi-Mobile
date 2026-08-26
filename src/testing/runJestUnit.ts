import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(__filename);
const projectRoot = path.resolve(__dirname, '../..');
const jestCliPath = require.resolve('jest/bin/jest');
const jestConfigPath = path.join(projectRoot, 'jest.config.js');
const runtimeIntegrationPath = path.join(
  projectRoot,
  'src/services/AgentLoopService/__tests__/runtime.integration.test.ts',
);
const rawForwardedArguments = process.argv.slice(2);
const forwardedArguments = rawForwardedArguments[0] === '--'
  ? rawForwardedArguments.slice(1)
  : rawForwardedArguments;

function runJest(arguments_: string[]): void {
  const result = spawnSync(process.execPath, [jestCliPath, ...arguments_], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error !== undefined) throw result.error;
  if (result.status === 0) return;

  const termination = result.status === null
    ? `signal ${result.signal ?? 'unknown'}`
    : `exit code ${result.status}`;
  throw new Error(`Jest failed with ${termination}.`);
}

// The runtime integration suite loads package-native MemeLoop values at a
// durable canonical-JSON boundary. Run it in a fresh VM process so the huge
// SQLite conformance suite cannot leak foreign-realm prototypes into it. This
// is still part of the default gate: either process failing fails this runner.
runJest(['--config', jestConfigPath, '--no-coverage', ...forwardedArguments]);
runJest([
  '--config',
  jestConfigPath,
  '--no-coverage',
  '--runInBand',
  '--runTestsByPath',
  runtimeIntegrationPath,
  '--testPathIgnorePatterns',
  '^$',
  ...forwardedArguments,
]);
