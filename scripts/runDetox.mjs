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

// ── E2E Infrastructure Setup ──────────────────────────────────────────────────
// Cucumber worker processes cannot reliably run shell commands (cmd.exe /
// powershell.exe may not be available). We handle all shell-dependent setup
// HERE, in the main Node.js process, before spawning the test runner.

console.log('\n══════════════════════════════════════════');
console.log('  Setting up E2E infrastructure...');
console.log('══════════════════════════════════════════\n');

const setupInfraScript = path.resolve(path.dirname(import.meta.url.replace('file:///', '')), 'setup-infra.mjs');
runCommand(process.execPath, [setupInfraScript], {
  stdio: 'inherit',
  env: { ...process.env },
});

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