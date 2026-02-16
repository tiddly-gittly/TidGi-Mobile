import { Paths } from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { useWorkspaceStore } from '../../store/workspace';

let initialized = false;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function getDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function getTimestamp(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function getLogDirectory(): string {
  const customPath = useWorkspaceStore.getState().customWikiFolderPath;
  if (typeof customPath === 'string' && customPath.length > 0) {
    return `${customPath.endsWith('/') ? customPath : `${customPath}/`}logs/`;
  }
  return `${Paths.document.uri}logs/`;
}

/**
 * Buffered log writer.
 * Accumulates log lines in memory and flushes them to disk periodically
 * (or when the buffer exceeds a threshold), avoiding the O(n²) penalty
 * of reading the entire file for every single log line.
 */
const logBuffer: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let isFlushing = false;
const FLUSH_INTERVAL_MS = 2000;
const FLUSH_THRESHOLD = 50; // lines

async function flushLogBuffer(): Promise<void> {
  if (isFlushing || logBuffer.length === 0) return;
  isFlushing = true;

  // Grab current buffer contents and clear
  const lines = logBuffer.splice(0, logBuffer.length);
  const chunk = lines.join('');

  try {
    const logDirectory = getLogDirectory();
    await FileSystemLegacy.makeDirectoryAsync(logDirectory, { intermediates: true }).catch(() => {});
    const now = new Date();
    const filePath = `${logDirectory}mobile-${getDateKey(now)}.log`;

    // Read existing file and append (expo-file-system has no native append mode)
    const previousContent = await FileSystemLegacy.readAsStringAsync(filePath, {
      encoding: FileSystemLegacy.EncodingType.UTF8,
    }).catch(() => '');
    await FileSystemLegacy.writeAsStringAsync(filePath, `${previousContent}${chunk}`, {
      encoding: FileSystemLegacy.EncodingType.UTF8,
    });
  } catch {
    // Best-effort; don't break the app
  } finally {
    isFlushing = false;
    // If more lines accumulated while we were flushing, schedule another flush
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

function appendLogLine(level: 'LOG' | 'WARN' | 'ERROR', message: string): void {
  const now = new Date();
  logBuffer.push(`[${getTimestamp(now)}] [${level}] ${message}\n`);
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
    appendLogLine('LOG', formatArguments(arguments_));
  };

  console.warn = (...arguments_: unknown[]) => {
    originalWarn(...arguments_);
    appendLogLine('WARN', formatArguments(arguments_));
  };

  console.error = (...arguments_: unknown[]) => {
    originalError(...arguments_);
    appendLogLine('ERROR', formatArguments(arguments_));
  };

  appendLogLine('LOG', 'Mobile logger initialized');
}
