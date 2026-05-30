import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const configuration = process.argv[2];
const forwardedArgs = process.argv.slice(3);
const normalizedForwardedArgs = forwardedArgs[0] === '--' ? forwardedArgs.slice(1) : forwardedArgs;

if (typeof configuration !== 'string' || configuration.length === 0) {
  console.error('Missing Detox configuration name.');
  process.exit(1);
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  });

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }

  if (result.error) {
    throw result.error;
  }
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeDetoxArgs(args) {
  const normalizedArgs = [...args];
  const nameIndex = normalizedArgs.findIndex(arg => arg === '--name');
  if (nameIndex >= 0 && typeof normalizedArgs[nameIndex + 1] === 'string') {
    const exactNamePattern = normalizedArgs[nameIndex + 1]
      .trim()
      .split(/\s+/)
      .filter(part => part.length > 0)
      .map(escapeRegex)
      .join('\\s+');
    normalizedArgs[nameIndex + 1] = `^${exactNamePattern}$`;
  }
  return normalizedArgs;
}

if (configuration.startsWith('android.')) {
  runCommand('adb', ['reverse', '--remove-all']);
  runCommand('adb', ['reverse', 'tcp:8081', 'tcp:8081']);
}

const detoxPackageJsonPath = require.resolve('detox/package.json');
const detoxCliPath = path.join(path.dirname(detoxPackageJsonPath), 'local-cli', 'cli.js');

runCommand(process.execPath, [
  detoxCliPath,
  'test',
  '--configuration',
  configuration,
  ...normalizeDetoxArgs(normalizedForwardedArgs),
], {
  env: {
    ...process.env,
    TS_NODE_PROJECT: 'tsconfig.e2e.json',
  },
});