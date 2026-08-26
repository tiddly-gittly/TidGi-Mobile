import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

const MAX_FAILURE_LOG_CHARACTERS = 64 * 1024;
const METRO_EXPORT_TIMEOUT_MILLISECONDS = 10 * 60 * 1000;
const require = createRequire(__filename);
const projectRoot = path.resolve(__dirname, '../..');
const expoCliPath = require.resolve('expo/bin/cli');

interface IExportResult {
  code: number | null;
  logTail: string;
  signal: NodeJS.Signals | null;
  truncated: boolean;
}

async function exportProductionAndroid(outputDirectory: string): Promise<IExportResult> {
  const environment = { ...process.env };
  delete environment.FORCE_COLOR;
  environment.EXPO_NO_TELEMETRY = '1';
  environment.NODE_ENV = 'production';
  environment.NODE_OPTIONS = [environment.NODE_OPTIONS, '--max-old-space-size=8192'].filter(Boolean).join(' ');

  const child = spawn(
    process.execPath,
    [
      expoCliPath,
      'export',
      '--platform',
      'android',
      '--output-dir',
      outputDirectory,
      '--max-workers',
      '2',
    ],
    {
      cwd: projectRoot,
      env: environment,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: METRO_EXPORT_TIMEOUT_MILLISECONDS,
    },
  );

  const stdoutDecoder = new StringDecoder('utf8');
  const stderrDecoder = new StringDecoder('utf8');
  let logTail = '';
  let truncated = false;
  const appendLog = (text: string): void => {
    logTail += text;
    if (logTail.length <= MAX_FAILURE_LOG_CHARACTERS) return;
    logTail = logTail.slice(-MAX_FAILURE_LOG_CHARACTERS);
    truncated = true;
  };
  child.stdout.on('data', (chunk: Buffer) => {
    appendLog(stdoutDecoder.write(chunk));
  });
  child.stderr.on('data', (chunk: Buffer) => {
    appendLog(stderrDecoder.write(chunk));
  });

  const result = await new Promise<Pick<IExportResult, 'code' | 'signal'>>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      resolve({ code, signal });
    });
  });
  appendLog(stdoutDecoder.end());
  appendLog(stderrDecoder.end());
  return { ...result, logTail, truncated };
}

async function main(): Promise<void> {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'tidgi-mobile-production-export-'));
  const outputDirectory = path.join(temporaryRoot, 'android');
  console.log('Validating the production Android Metro bundle in an isolated temporary directory...');

  try {
    const result = await exportProductionAndroid(outputDirectory);
    if (result.code === 0) {
      const moduleCountMatches = [...result.logTail.matchAll(/index\.js \(([\d,]+) modules\)/gu)];
      const moduleCount = moduleCountMatches.at(-1)?.[1];
      const moduleSummary = moduleCount === undefined ? '' : ` (${moduleCount} modules)`;
      console.log(`Production Android Metro bundle validation passed${moduleSummary}.`);
      return;
    }

    const termination = result.code === null
      ? `signal ${result.signal ?? 'unknown'}`
      : `exit code ${result.code}`;
    const truncationNotice = result.truncated ? '[earlier Metro output truncated]\n' : '';
    process.stderr.write(`Production Android Metro bundle validation failed (${termination}).\n${truncationNotice}${result.logTail}`);
    process.exitCode = result.code ?? 1;
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
