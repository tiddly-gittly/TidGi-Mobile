import { Paths } from 'expo-file-system';
import { toPlainPath } from 'expo-filesystem-android-external-storage';
import { useWorkspaceStore } from '../../store/workspace';
import { deleteFileOrDirectory, ensureDirectory, listDirectory, readTextFile, writeTextFile } from '../WikiStorageService/fileOperations';

let initialized = false;

type LogScope = 'app' | 'workspace';

interface ILogEntry {
  line: string;
  scope: LogScope;
  workspaceID?: string;
}

export interface IScopedLogger {
  error: (...arguments_: unknown[]) => void;
  log: (...arguments_: unknown[]) => void;
  warn: (...arguments_: unknown[]) => void;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function getDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function getTimestamp(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/**
 * Get the base path for the TidGi data directory (external or internal).
 * This is the parent of both `wikis/` and `logs/`.
 */
function getBasePath(): string {
  const customPath = useWorkspaceStore.getState().customWikiFolderPath;
  if (typeof customPath === 'string' && customPath.length > 0) {
    const normalized = customPath.endsWith('/') ? customPath : `${customPath}/`;
    return normalized;
  }
  return Paths.document.uri;
}

export function getLogDirectory(): string {
  return `${getBasePath()}logs/`;
}

export function getWorkspaceLogFilePrefix(workspaceID: string): string {
  return `workspace-${workspaceID}-`;
}

export function getAppLogFilePrefix(): string {
  return 'mobile-';
}

function getLogFileName(scope: LogScope, date: Date, workspaceID?: string): string {
  const dateKey = getDateKey(date);
  if (scope === 'workspace' && workspaceID) {
    return `${getWorkspaceLogFilePrefix(workspaceID)}${dateKey}.log`;
  }
  return `${getAppLogFilePrefix()}${dateKey}.log`;
}

/**
 * Buffered log writer.
 * Accumulates log lines in memory and flushes them to disk periodically
 * (or when the buffer exceeds a threshold), avoiding the O(n²) penalty
 * of reading the entire file for every single log line.
 */
const logBuffer: ILogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let flushPromise: Promise<void> | undefined;
const FLUSH_INTERVAL_MS = 2000;
const FLUSH_THRESHOLD = 50; // lines

async function flushLogBuffer(): Promise<void> {
  // If a flush is already in progress, wait for it first
  if (flushPromise !== undefined) {
    await flushPromise;
    if (logBuffer.length === 0) return;
  }

  if (logBuffer.length === 0) return;

  const doFlush = async (): Promise<void> => {
    const entries = logBuffer.splice(0, logBuffer.length);
    const now = new Date();

    const chunksByFileName = entries.reduce<Record<string, string[]>>((accumulator, entry) => {
      const fileName = getLogFileName(entry.scope, now, entry.workspaceID);
      accumulator[fileName] = accumulator[fileName] ?? [];
      accumulator[fileName].push(entry.line);
      return accumulator;
    }, {});

    try {
      const logDirectory = getLogDirectory();
      await ensureDirectory(logDirectory);
      await Promise.all(
        Object.entries(chunksByFileName).map(async ([fileName, lines]) => {
          const filePath = `${toPlainPath(logDirectory)}/${fileName}`;
          let previousContent = '';
          try {
            previousContent = await readTextFile(filePath);
          } catch {
            // File doesn't exist yet — that's fine
          }
          await writeTextFile(filePath, `${previousContent}${lines.join('')}`);
        }),
      );
    } catch {
      // Best-effort; don't break the app
    }
  };

  flushPromise = doFlush();
  try {
    await flushPromise;
  } finally {
    flushPromise = undefined;
    if (logBuffer.length > 0) {
      scheduleFlush();
    }
  }
}

function scheduleFlush(): void {
  if (flushTimer !== undefined) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    void flushLogBuffer();
  }, FLUSH_INTERVAL_MS);
}

function appendLogLine(level: 'LOG' | 'WARN' | 'ERROR', message: string, scope: LogScope = 'app', workspaceID?: string): void {
  const now = new Date();
  logBuffer.push({
    line: `[${getTimestamp(now)}] [${level}] ${message}\n`,
    scope,
    workspaceID,
  });
  if (logBuffer.length >= FLUSH_THRESHOLD) {
    void flushLogBuffer();
  } else {
    scheduleFlush();
  }
}

function formatArguments(arguments_: unknown[]): string {
  return arguments_.map((argument) => {
    if (typeof argument === 'string') return argument;
    if (argument instanceof Error) return `${argument.name}: ${argument.message}\n${argument.stack ?? ''}`;
    try {
      return JSON.stringify(argument);
    } catch {
      return String(argument);
    }
  }).join(' ');
}

export function initializeMobileLogger(): void {
  if (initialized) return;
  initialized = true;

  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  console.log = (...arguments_: unknown[]) => {
    originalLog(...arguments_);
    appendLogLine('LOG', formatArguments(arguments_), 'app');
  };

  console.warn = (...arguments_: unknown[]) => {
    originalWarn(...arguments_);
    appendLogLine('WARN', formatArguments(arguments_), 'app');
  };

  console.error = (...arguments_: unknown[]) => {
    originalError(...arguments_);
    appendLogLine('ERROR', formatArguments(arguments_), 'app');
  };

  appendLogLine('LOG', 'Mobile logger initialized', 'app');
}

export function logFor(workspaceID: string): IScopedLogger {
  const write = (level: 'LOG' | 'WARN' | 'ERROR', arguments_: unknown[]) => {
    appendLogLine(level, formatArguments(arguments_), 'workspace', workspaceID);
  };

  return {
    log: (...arguments_: unknown[]) => {
      write('LOG', arguments_);
    },
    warn: (...arguments_: unknown[]) => {
      write('WARN', arguments_);
    },
    error: (...arguments_: unknown[]) => {
      write('ERROR', arguments_);
    },
  };
}

// ─── Log File Management ────────────────────────────────────────────

/**
 * List all available log files. Returns filenames sorted alphabetically.
 */
export async function listLogFiles(): Promise<string[]> {
  await flushLogBuffer();
  const directory = getLogDirectory();
  const names = await listDirectory(directory);
  return names.filter(name => name.endsWith('.log')).sort();
}

/**
 * List app-level log files (not workspace-specific).
 */
export async function listAppLogFiles(): Promise<string[]> {
  const allFiles = await listLogFiles();
  const prefix = getAppLogFilePrefix();
  return allFiles.filter(name => name.startsWith(prefix));
}

/**
 * List log files for a specific workspace.
 */
export async function listWorkspaceLogFiles(workspaceID: string): Promise<string[]> {
  const allFiles = await listLogFiles();
  const prefix = getWorkspaceLogFilePrefix(workspaceID);
  return allFiles.filter(name => name.startsWith(prefix));
}

/**
 * Get the absolute path for a log file by its filename.
 */
export function getLogFilePath(fileName: string): string {
  const directory = getLogDirectory();
  return `${toPlainPath(directory)}/${fileName}`;
}

/**
 * Read contents of a specific log file by its filename.
 */
export async function readLogFile(fileName: string): Promise<string | undefined> {
  await flushLogBuffer();
  const directory = getLogDirectory();
  const filePath = `${toPlainPath(directory)}/${fileName}`;
  try {
    return await readTextFile(filePath);
  } catch {
    return undefined;
  }
}

/**
 * Delete a specific log file by its filename.
 */
export async function deleteLogFile(fileName: string): Promise<void> {
  const directory = getLogDirectory();
  const filePath = `${toPlainPath(directory)}/${fileName}`;
  await deleteFileOrDirectory(filePath);
}

/**
 * Delete all log files (app + all workspaces).
 */
export async function clearAllLogs(): Promise<void> {
  const files = await listLogFiles();
  await Promise.all(files.map(deleteLogFile));
}

async function readLatestLogByPrefix(prefix: string): Promise<string | undefined> {
  const allFiles = await listLogFiles();
  const matched = allFiles.filter(name => name.startsWith(prefix));
  const latestName = matched[matched.length - 1];
  if (!latestName) return undefined;
  return readLogFile(latestName);
}

export async function readLatestAppLog(): Promise<string | undefined> {
  return readLatestLogByPrefix(getAppLogFilePrefix());
}

export async function readLatestWorkspaceLog(workspaceID: string): Promise<string | undefined> {
  return readLatestLogByPrefix(getWorkspaceLogFilePrefix(workspaceID));
}

export function getPendingLogBufferLength(): number {
  return logBuffer.length;
}
