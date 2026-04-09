/**
 * Git operations for TidGi-Mobile using isomorphic-git
 * Handles clone, pull, push with Basic Auth
 */

import { Buffer } from 'buffer';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { ExternalStorage, toPlainPath } from 'expo-tiddlywiki-filesystem-android-external-storage';
import git from 'isomorphic-git';
import pTimeout from 'p-timeout';
import { IWikiWorkspace } from '../../store/workspace';

function toSafeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

// Polyfill Buffer globally for isomorphic-git
if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}

// ─── Runtime detection of new native streaming API ────────────────────
// Added in expo-tiddlywiki-filesystem-android-external-storage@1.0.6
interface HttpPostToFileResult {
  statusCode: number;
  headers: Record<string, string>;
  bytesWritten: number;
}

interface ReadFileChunkResult {
  data: string; // Base64
  bytesRead: number;
}

interface IExternalStorageExtended {
  httpPostToFile(
    url: string,
    headers: Record<string, string>,
    bodyBase64: string,
    destinationPath: string,
    contentType: string,
  ): Promise<HttpPostToFileResult>;
  readFileChunk(path: string, offset: number, length: number): Promise<ReadFileChunkResult>;
  deleteFile(path: string): Promise<void>;
  appendFileBase64(path: string, base64Content: string, truncateFirst: boolean): Promise<void>;
}

/**
 * Whether the native `ExternalStorage.httpPostToFile` streaming method is
 * available.  On iOS or when the native module isn't linked this will be false
 * and we fall back to the regular `fetch()` path (which may OOM on very large
 * repos).
 */
const hasNativeStreamingHttp: boolean =
  typeof (ExternalStorage as unknown as Partial<IExternalStorageExtended>).httpPostToFile === 'function' &&
  typeof (ExternalStorage as unknown as Partial<IExternalStorageExtended>).readFileChunk === 'function' &&
  typeof (ExternalStorage as unknown as Partial<IExternalStorageExtended>).deleteFile === 'function';

/**
 * Whether the native `ExternalStorage.appendFileBase64` chunked-write method
 * is available.  When true we can stream large binary data to disk in small
 * chunks without ever allocating the full base64 string or decoded byte array
 * in the JVM heap — preventing OOM for 50+ MB git pack files.
 */
const hasNativeAppendFile: boolean =
  typeof (ExternalStorage as unknown as Partial<IExternalStorageExtended>).appendFileBase64 === 'function';

/** 64 KB — chunk size for streaming the HTTP temp file back into JS. */
const FILE_CHUNK_SIZE = 64 * 1024;

/**
 * 2 MB — chunk size for reading large files (e.g. pack files) back into JS
 * via readFileChunk.  Larger than FILE_CHUNK_SIZE to reduce bridge
 * round-trips: 116 MB / 2 MB = 58 calls vs 116 MB / 64 KB = 1,812 calls.
 */
const LARGE_READ_CHUNK_SIZE = 2 * 1024 * 1024;

/**
 * 2 MB — files larger than this threshold are written in chunks via
 * `appendFileBase64` to avoid allocating the full base64 string + decoded
 * byte array in JVM heap simultaneously (which causes OOM for 50+ MB files).
 */
const STREAMING_WRITE_THRESHOLD = 2 * 1024 * 1024;

/**
 * Whether a file:// URI (or plain path) points to external/shared storage
 * and needs to go through the raw native module instead of Expo FS.
 */
/**
 * Module-level hooks for progress reporting during git clone.
 *
 * - `onLargeFileRead`: called by readFile when a large binary file finishes
 *   reading (for pack files stored on disk).
 * - `onPackStreamConsumed`: called by the file chunk iterator when all HTTP
 *   response data has been read.  This is the LAST async point before
 *   isomorphic-git starts CPU-intensive synchronous pack indexing.
 */
let onLargeFileRead: ((filepath: string, sizeBytes: number) => void) | undefined;
let onPackStreamConsumed: ((totalBytes: number) => void) | undefined;

function isExternalPath(filepath: string): boolean {
  // path.join('file:///storage/...', 'x') collapses the triple slash to 'file:/storage/...'
  // so we also strip that single-slash variant.
  const plain = toPlainPath(filepath.replace(/^file:\/(?!\/\/)/, 'file:///').replace(/^file:\/\/\//, '/'));
  return plain.startsWith('/storage/') || plain.startsWith('/sdcard/');
}

/**
 * Ensure a filesystem path has the `file://` URI prefix required by Expo FS.
 * isomorphic-git passes plain paths (via path.join(dir, ...)) so we must
 * re-add the scheme before calling any FileSystemLegacy API.
 */
function toFileUri(plainPath: string): string {
  const uri = plainPath.startsWith('file://') ? plainPath : `file://${plainPath}`;
  try {
    return encodeURI(decodeURI(uri));
  } catch {
    return encodeURI(uri);
  }
}

const CHECKOUT_BATCH_SIZE = 200;
const NATIVE_WRITE_BATCH_SIZE = 64;
const DEFAULT_TIDGI_TOKEN_AUTH_HEADER_PREFIX = 'x-tidgi-auth-token';

// React Native's fetch (OkHttp) buffers the entire HTTP response in the JVM heap
// before exposing it to JavaScript via JSI. On mid-range Android devices the Hermes
// heap has ~80-100 MB available for a single allocation after app baseline usage.
// Packs larger than this will cause an OOM crash during clone.
const MAX_SAFE_PACK_BYTES = 80 * 1024 * 1024;

/** Structured sentinels thrown by gitClone so callers can show targeted UI. */
export const GIT_CLONE_ERROR_OOM = 'WIKI_OOM';
export const GIT_CLONE_ERROR_TOO_LARGE_PREFIX = 'WIKI_TOO_LARGE:';

// Detect Android/Hermes OOM patterns in error messages.
function isOOMError(message: string): boolean {
  return (
    message.includes('Failed to allocate') ||
    message.includes('OutOfMemoryError') ||
    message.includes('growth limit') ||
    /out of memory/i.test(message)
  );
}

/**
 * Detect connection-abort errors typically caused by Android suspending the app
 * (user switches to another app, screen off, etc.) which kills the TCP socket.
 */
export const GIT_CLONE_ERROR_CONNECTION_ABORT = 'WIKI_CONNECTION_ABORT';
function isConnectionAbortError(message: string): boolean {
  return (
    message.includes('SocketException') ||
    message.includes('connection abort') ||
    message.includes('Connection reset') ||
    message.includes('Software caused connection abort') ||
    message.includes('network request failed') ||
    message.includes('ECONNRESET') ||
    message.includes('ECONNABORTED') ||
    message.includes('The Internet connection appears to be offline')
  );
}

/** Maximum number of automatic retries for connection-abort during clone. */
const CLONE_MAX_RETRIES = 2;
/** Delay (ms) before retrying clone after a connection abort. */
const CLONE_RETRY_DELAY_MS = 3_000;

/**
 * Query the TidGi Desktop optional pack-size endpoint before downloading.
 * Returns estimated bytes, or null when the endpoint is not available
 * (Desktop < the version that added this endpoint — silently skips).
 */
async function tryGetRemotePackSize(
  repoUrl: string,
  headers: Record<string, string>,
): Promise<number | null> {
  try {
    const sizeUrl = `${repoUrl}/pack-size`;
    const response = await pTimeout(fetch(sizeUrl, { method: 'GET', headers }), {
      milliseconds: 5_000,
      message: new Error('pack-size check timeout'),
    });
    if (!response.ok) return null; // endpoint not available yet
    const data = (await response.json()) as { estimatedBytes?: number };
    return typeof data.estimatedBytes === 'number' ? data.estimatedBytes : null;
  } catch {
    return null; // non-fatal, proceed with clone
  }
}
const DEFAULT_TIDGI_USER_NAME = 'TidGi User';

interface INativeWriteTask {
  base64Content: string;
  path: string;
  reject: (reason?: unknown) => void;
  resolve: () => void;
}

const pendingNativeWriteTasks: INativeWriteTask[] = [];
let nativeWriteFlushScheduled = false;
let nativeWriteFlushPromise: Promise<void> | undefined;

function canUseAndroidNativeBatchWrite(filepath: string): boolean {
  // Use native batch writes for ALL Android paths (internal + external).
  // java.io.File can write to the app's own internal directory too, and
  // routing through ExternalStorage avoids Expo FS's JVM-heap buffering.
  void filepath; // kept for call-site clarity
  return (
    typeof ExternalStorage.writeFilesBase64 === 'function'
  );
}

function scheduleNativeBatchWrite(path: string, base64Content: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    pendingNativeWriteTasks.push({ path, base64Content, resolve, reject });
    if (nativeWriteFlushScheduled) {
      return;
    }
    nativeWriteFlushScheduled = true;
    void Promise.resolve().then(() => {
      nativeWriteFlushScheduled = false;
      if (!nativeWriteFlushPromise) {
        nativeWriteFlushPromise = flushPendingNativeWrites().finally(() => {
          nativeWriteFlushPromise = undefined;
        });
      }
    });
  });
}

async function flushPendingNativeWrites(): Promise<void> {
  while (pendingNativeWriteTasks.length > 0) {
    const batch = pendingNativeWriteTasks.splice(0, NATIVE_WRITE_BATCH_SIZE);
    try {
      await ExternalStorage.writeFilesBase64(
        batch.map(task => toPlainPath(task.path)),
        batch.map(task => task.base64Content),
      );
      batch.forEach(task => {
        task.resolve();
      });
    } catch (error) {
      batch.forEach(task => {
        task.reject(error);
      });
    }
    await Promise.resolve();
  }
}

/**
 * Git remote configuration with authentication
 */
export interface IGitRemote {
  baseUrl: string;
  /** Token is optional - empty/undefined means anonymous access (insecure) */
  token?: string;
  tokenAuthHeaderName?: string;
  tokenAuthHeaderValue?: string;
  workspaceId: string;
}

export interface IGitCommitInfo {
  authorEmail: string;
  authorName: string;
  message: string;
  oid: string;
  parentOids: string[];
  timestamp: number;
}

export interface IGitCommitFileDiffResult {
  files: Array<{ path: string; type: 'add' | 'modify' | 'delete' }>;
  isShallowSnapshot: boolean;
}

/**
 * Helper: get current branch name, defaulting to 'main'.
 * `git.currentBranch()` returns `string | void`; the `void` case
 * happens when HEAD is detached.
 */
async function getCurrentBranch(directory: string): Promise<string> {
  const hasLocalBranch = async (branch: string): Promise<boolean> => {
    try {
      await git.resolveRef({ fs, dir: directory, ref: `refs/heads/${branch}` });
      return true;
    } catch {
      return false;
    }
  };

  const hasRemoteBranch = async (branch: string): Promise<boolean> => {
    try {
      await git.resolveRef({ fs, dir: directory, ref: `refs/remotes/origin/${branch}` });
      return true;
    } catch {
      return false;
    }
  };

  try {
    const branch = await git.currentBranch({ fs, dir: directory, fullname: false });
    if (typeof branch === 'string' && branch.length > 0 && (await hasLocalBranch(branch) || await hasRemoteBranch(branch))) {
      return branch;
    }
  } catch {
    // Fall through to branch enumeration below.
  }

  try {
    const branches = await git.listBranches({ fs, dir: directory, remote: undefined });
    if (branches.includes('main')) return 'main';
    if (branches.includes('master')) return 'master';
    if (branches.length > 0) return branches[0];
  } catch {
    // Fall back to the modern default below.
  }

  try {
    const remoteBranches = await git.listBranches({ fs, dir: directory, remote: 'origin' });
    if (remoteBranches.includes('main')) return 'main';
    if (remoteBranches.includes('master')) return 'master';
    if (remoteBranches.length > 0) return remoteBranches[0];
  } catch {
    // Fall back to the modern default below.
  }

  return 'main';
}

export interface IGitFileContent {
  dataUri?: string;
  kind: 'binary' | 'image' | 'missing' | 'text';
  text?: string;
}

/**
 * FS adapter for isomorphic-git.
 *
 * For paths on external/shared storage (/storage/emulated/0/…) we use a local
 * native module (`ExternalStorage`) that uses raw `java.io.File` — Expo's own
 * FileSystem rejects writes to those paths.
 *
 * For internal paths we keep using the legacy Expo FS API which works fine.
 */
const fs = {
  promises: {
    async readFile(filepath: string, options?: { encoding?: 'utf8' } | 'utf8'): Promise<string | Buffer> {
      const encoding = typeof options === 'string' ? options : options?.encoding;

      if (isExternalPath(filepath)) {
        const plain = toPlainPath(filepath);
        if (encoding === 'utf8') {
          return ExternalStorage.readFileUtf8(plain);
        }
        const base64 = await ExternalStorage.readFileBase64(plain);
        return Buffer.from(base64, 'base64');
      }

      // ── Android internal path: chunked binary read for large files ──
      // ExponentFileSystem.readAsStringAsync loads the entire file as a
      // base64 string into JVM heap.  For 50+ MB pack files this causes
      // OOM.  Use ExternalStorage.readFileChunk instead (java.io.File
      // can read internal paths too).
      if (encoding !== 'utf8' && hasNativeStreamingHttp) {
        const plain = toPlainPath(filepath);
        try {
          const info = await ExternalStorage.getInfo(plain);
          if (!info.exists) {
            const enoentError = new Error(`ENOENT: no such file or directory, open '${filepath}'`) as NodeJS.ErrnoException;
            enoentError.code = 'ENOENT';
            enoentError.errno = -2;
            enoentError.path = filepath;
            throw enoentError;
          }
          if (info.size > STREAMING_WRITE_THRESHOLD) {
            // Large file — read in chunks to avoid JVM OOM
            const extension = ExternalStorage as unknown as IExternalStorageExtended;
            const buffers: Buffer[] = [];
            let offset = 0;
            while (offset < info.size) {
              const chunk = await extension.readFileChunk(plain, offset, LARGE_READ_CHUNK_SIZE);
              if (chunk.bytesRead === 0) break;
              buffers.push(Buffer.from(chunk.data, 'base64'));
              offset += chunk.bytesRead;
              // Yield to event loop every 8 MB to prevent UI freeze
              if (buffers.length % 4 === 0) {
                await new Promise<void>(r => setTimeout(r, 0));
              }
            }
            const result = Buffer.concat(buffers);
            // For very large files (packs), fire the hook and yield so React
            // can render the "Indexing pack" message *before* isomorphic-git
            // starts CPU-intensive synchronous pack indexing (which will
            // freeze the JS thread for minutes on large repos).
            if (info.size > 10 * 1024 * 1024) {
              onLargeFileRead?.(filepath, info.size);
              await new Promise<void>(r => setTimeout(r, 100));
            }
            return result;
          }
          // Small file — single native read is fine
          const base64 = await ExternalStorage.readFileBase64(plain);
          return Buffer.from(base64, 'base64');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error;
          // Fall through to legacy Expo FS on unexpected native errors
        }
      }

      // Internal path — use legacy Expo FS
      try {
        if (encoding === 'utf8') {
          return await FileSystemLegacy.readAsStringAsync(toFileUri(filepath), { encoding: FileSystemLegacy.EncodingType.UTF8 });
        }
        const base64 = await FileSystemLegacy.readAsStringAsync(toFileUri(filepath), { encoding: FileSystemLegacy.EncodingType.Base64 });
        return Buffer.from(base64, 'base64');
      } catch {
        const info = await FileSystemLegacy.getInfoAsync(toFileUri(filepath)).catch(() => ({ exists: false }));
        if (!info.exists) {
          const enoentError = new Error(`ENOENT: no such file or directory, open '${filepath}'`) as NodeJS.ErrnoException;
          enoentError.code = 'ENOENT';
          enoentError.errno = -2;
          enoentError.path = filepath;
          throw enoentError;
        }
        if (encoding === 'utf8') {
          return await FileSystemLegacy.readAsStringAsync(toFileUri(filepath), { encoding: FileSystemLegacy.EncodingType.UTF8 });
        }
        const base64 = await FileSystemLegacy.readAsStringAsync(toFileUri(filepath), { encoding: FileSystemLegacy.EncodingType.Base64 });
        return Buffer.from(base64, 'base64');
      }
    },

    async writeFile(filepath: string, data: string | Uint8Array | Buffer, _options?: { encoding?: 'utf8'; mode?: number }): Promise<void> {
      // Debug: log .git/index writes
      const isGitIndex = filepath.endsWith('.git/index');
      if (isGitIndex) {
        const size = typeof data === 'string' ? data.length : data.byteLength;
        console.log(`[fs.writeFile] .git/index write requested: path=${filepath}, dataSize=${size}, dataType=${typeof data === 'string' ? 'string' : 'binary'}, hasNativeAppendFile=${hasNativeAppendFile}, canBatchWrite=${canUseAndroidNativeBatchWrite(filepath)}`);
      }
      // ── Android: chunked streaming for large binary data ──────────
      // For files above STREAMING_WRITE_THRESHOLD, avoid converting the
      // entire content to a single base64 string.  Instead, send it in
      // small chunks via appendFileBase64.  This keeps JVM-heap peak to
      // ~1 MB regardless of file size, preventing OOM on 50+ MB packs.
      if (hasNativeAppendFile && typeof data !== 'string') {
        const rawBytes = Buffer.isBuffer(data)
          ? data
          : Buffer.from(data.buffer, data.byteOffset, data.byteLength);

        if (rawBytes.byteLength > STREAMING_WRITE_THRESHOLD) {
          const plain = toPlainPath(filepath);
          const extension = ExternalStorage as unknown as IExternalStorageExtended;
          const CHUNK = 512 * 1024; // 512 KB per round-trip
          let chunkIndex = 0;
          for (let offset = 0; offset < rawBytes.byteLength; offset += CHUNK) {
            const end = Math.min(offset + CHUNK, rawBytes.byteLength);
            // Buffer.subarray() returns a plain Uint8Array in the RN polyfill,
            // whose toString('base64') produces decimal CSV instead of base64.
            // Wrap with Buffer.from() to get a proper Buffer before encoding.
            const chunkBase64 = Buffer.from(rawBytes.subarray(offset, end)).toString('base64');
            await extension.appendFileBase64(plain, chunkBase64, offset === 0);
            chunkIndex++;
            // Yield to event loop every 4 MB to prevent UI freeze
            if (chunkIndex % 8 === 0) {
              await new Promise<void>(r => setTimeout(r, 0));
            }
          }
          return;
        }
      }

      const base64 = typeof data === 'string'
        ? Buffer.from(data, 'utf8').toString('base64')
        : Buffer.isBuffer(data)
        ? data.toString('base64')
        : Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64');

      if (canUseAndroidNativeBatchWrite(filepath)) {
        if (isGitIndex) {
          console.log(`[fs.writeFile] .git/index going through scheduleNativeBatchWrite, base64.length=${base64.length}`);
        }
        const result = scheduleNativeBatchWrite(filepath, base64);
        if (isGitIndex) {
          result.then(() => {
            console.log(`[fs.writeFile] .git/index batch write completed successfully`);
            // Verify the file exists after writing
            ExternalStorage.getInfo(toPlainPath(filepath)).then((info: Record<string, unknown>) => {
              console.log(`[fs.writeFile] .git/index post-write verify: exists=${info.exists}, size=${info.size}`);
            }).catch((verifyError: Error) => {
              console.log(`[fs.writeFile] .git/index post-write verify error: ${verifyError.message}`);
            });
          }).catch((error: Error) => {
            console.log(`[fs.writeFile] .git/index batch write FAILED: ${error.message}`);
          });
        }
        return result;
      }

      if (isExternalPath(filepath)) {
        const plain = toPlainPath(filepath);
        if (typeof data === 'string') {
          return ExternalStorage.writeFileUtf8(plain, data);
        }
        return ExternalStorage.writeFileBase64(plain, base64);
      }

      // Internal path
      const lastSlash = filepath.lastIndexOf('/');
      if (lastSlash > 0) {
        const parentDirectory = filepath.substring(0, lastSlash);
        const parentInfo = await FileSystemLegacy.getInfoAsync(toFileUri(parentDirectory));
        if (!parentInfo.exists) {
          await FileSystemLegacy.makeDirectoryAsync(toFileUri(parentDirectory), { intermediates: true });
        }
      }
      if (typeof data === 'string') {
        await FileSystemLegacy.writeAsStringAsync(toFileUri(filepath), data, { encoding: FileSystemLegacy.EncodingType.UTF8 });
      } else {
        await FileSystemLegacy.writeAsStringAsync(toFileUri(filepath), base64, { encoding: FileSystemLegacy.EncodingType.Base64 });
      }
    },

    async unlink(filepath: string): Promise<void> {
      if (isExternalPath(filepath)) {
        const plain = toPlainPath(filepath);
        const exists = await ExternalStorage.exists(plain);
        if (!exists) {
          const enoentError = new Error(`ENOENT: no such file or directory, unlink '${filepath}'`) as NodeJS.ErrnoException;
          enoentError.code = 'ENOENT';
          throw enoentError;
        }
        return ExternalStorage.deleteFile(plain);
      }

      const info = await FileSystemLegacy.getInfoAsync(toFileUri(filepath));
      if (!info.exists) {
        const enoentError = new Error(`ENOENT: no such file or directory, unlink '${filepath}'`) as NodeJS.ErrnoException;
        enoentError.code = 'ENOENT';
        throw enoentError;
      }
      await FileSystemLegacy.deleteAsync(toFileUri(filepath), { idempotent: true });
    },

    async readdir(filepath: string): Promise<string[]> {
      if (isExternalPath(filepath)) {
        return ExternalStorage.readDir(toPlainPath(filepath));
      }

      try {
        return await FileSystemLegacy.readDirectoryAsync(toFileUri(filepath));
      } catch {
        const info = await FileSystemLegacy.getInfoAsync(toFileUri(filepath)).catch(() => ({ exists: false }));
        if (!info.exists) {
          const enoentError = new Error(`ENOENT: no such file or directory, scandir '${filepath}'`) as NodeJS.ErrnoException;
          enoentError.code = 'ENOENT';
          throw enoentError;
        }
        return await FileSystemLegacy.readDirectoryAsync(toFileUri(filepath));
      }
    },

    async mkdir(filepath: string, options?: { recursive?: boolean }): Promise<void> {
      if (isExternalPath(filepath)) {
        return ExternalStorage.mkdir(toPlainPath(filepath));
      }

      try {
        const info = await FileSystemLegacy.getInfoAsync(toFileUri(filepath));
        if (info.exists) return;
        await FileSystemLegacy.makeDirectoryAsync(toFileUri(filepath), { intermediates: options?.recursive ?? true });
      } catch (error) {
        if (!options?.recursive) throw error;
      }
    },

    async rmdir(filepath: string): Promise<void> {
      if (isExternalPath(filepath)) {
        return ExternalStorage.rmdir(toPlainPath(filepath));
      }

      const info = await FileSystemLegacy.getInfoAsync(toFileUri(filepath));
      if (!info.exists) return;
      await FileSystemLegacy.deleteAsync(toFileUri(filepath), { idempotent: true });
    },

    async stat(filepath: string): Promise<{
      isFile: () => boolean;
      isDirectory: () => boolean;
      isSymbolicLink: () => boolean;
      dev: number;
      ino: number;
      mode: number;
      nlink: number;
      uid: number;
      gid: number;
      rdev: number;
      size: number;
      blksize: number;
      blocks: number;
      atimeMs: number;
      mtimeMs: number;
      ctimeMs: number;
      birthtimeMs: number;
    }> {
      if (isExternalPath(filepath)) {
        const info = await ExternalStorage.getInfo(toPlainPath(filepath));
        if (!info.exists) {
          const error = new Error(`ENOENT: no such file or directory, stat '${filepath}'`) as NodeJS.ErrnoException;
          error.code = 'ENOENT';
          throw error;
        }
        const isDirectory = info.isDirectory;
        const fileSize = toSafeNumber(info.size, 0);
        const modifiedTimeMs = toSafeNumber(info.modificationTime, Date.now());

        return {
          isFile: () => !isDirectory,
          isDirectory: () => isDirectory,
          isSymbolicLink: () => false,
          dev: 0,
          ino: 0,
          mode: isDirectory ? 0o755 : 0o644,
          nlink: 1,
          uid: 0,
          gid: 0,
          rdev: 0,
          size: fileSize,
          blksize: 4096,
          blocks: Math.ceil(fileSize / 512),
          atimeMs: modifiedTimeMs,
          mtimeMs: modifiedTimeMs,
          ctimeMs: modifiedTimeMs,
          birthtimeMs: modifiedTimeMs,
        };
      }

      // Internal path
      const plainInternalPath = toPlainPath(filepath);
      if (plainInternalPath.startsWith('/')) {
        try {
          const nativeInfo = await ExternalStorage.getInfo(plainInternalPath);
          if (nativeInfo.exists) {
            const isDirectory = nativeInfo.isDirectory;
            const fileSize = toSafeNumber(nativeInfo.size, 0);
            const modifiedTimeMs = toSafeNumber(nativeInfo.modificationTime, Date.now());

            return {
              isFile: () => !isDirectory,
              isDirectory: () => isDirectory,
              isSymbolicLink: () => false,
              dev: 0,
              ino: 0,
              mode: isDirectory ? 0o755 : 0o644,
              nlink: 1,
              uid: 0,
              gid: 0,
              rdev: 0,
              size: fileSize,
              blksize: 4096,
              blocks: Math.ceil(fileSize / 512),
              atimeMs: modifiedTimeMs,
              mtimeMs: modifiedTimeMs,
              ctimeMs: modifiedTimeMs,
              birthtimeMs: modifiedTimeMs,
            };
          }
        } catch {
          // Fall back to Expo legacy FS below.
        }
      }

      const info = await FileSystemLegacy.getInfoAsync(toFileUri(filepath));
      if (!info.exists) {
        const error = new Error(`ENOENT: no such file or directory, stat '${filepath}'`) as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
      const isDirectory = info.isDirectory;
      const fileSize = toSafeNumber(info.size, 0);
      const modifiedTimeMs = toSafeNumber(info.modificationTime, Date.now() / 1000) * 1000;

      return {
        isFile: () => !isDirectory,
        isDirectory: () => isDirectory,
        isSymbolicLink: () => false,
        dev: 0,
        ino: 0,
        mode: isDirectory ? 0o755 : 0o644,
        nlink: 1,
        uid: 0,
        gid: 0,
        rdev: 0,
        size: fileSize,
        blksize: 4096,
        blocks: Math.ceil(fileSize / 512),
        atimeMs: modifiedTimeMs,
        mtimeMs: modifiedTimeMs,
        ctimeMs: modifiedTimeMs,
        birthtimeMs: modifiedTimeMs,
      };
    },

    async lstat(filepath: string) {
      return fs.promises.stat(filepath);
    },

    readlink(_filepath: string): never {
      throw new Error('readlink not supported on mobile');
    },

    symlink(_target: string, _filepath: string): never {
      throw new Error('symlink not supported on mobile');
    },

    async chmod(_filepath: string, _mode: number): Promise<void> {
      // No-op on mobile
    },
  },
};

type GitHttpRequest = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: AsyncIterableIterator<Uint8Array> | Iterable<Uint8Array> | Uint8Array;
};

type GitHttpResponse = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: AsyncIterableIterator<Uint8Array>;
  statusCode: number;
  statusMessage: string;
};

function fromValue<T>(value: T) {
  let queue = [value];
  return {
    next() {
      return Promise.resolve({ done: queue.length === 0, value: queue.pop() });
    },
    return() {
      queue = [];
      return Promise.resolve({ done: true, value: undefined as T | undefined });
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

function getIterator<T>(iterable: AsyncIterableIterator<T> | Iterable<T> | Iterator<T>): AsyncIterableIterator<T> | Iterator<T> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime: TS union types don't guarantee protocol support at runtime
  if (typeof iterable === 'object' && iterable !== null && Symbol.asyncIterator in iterable) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- runtime cast needed
    return (iterable as AsyncIterableIterator<T>)[Symbol.asyncIterator]();
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime: same as above
  if (typeof iterable === 'object' && iterable !== null && Symbol.iterator in iterable) {
    return (iterable)[Symbol.iterator]();
  }
  return iterable;
}

async function forAwait<T>(iterable: AsyncIterableIterator<T> | Iterable<T> | Iterator<T>, callback: (value: T) => void | Promise<void>) {
  const iterator = getIterator(iterable);

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- iterator protocol: loop until done
  while (true) {
    const result = await iterator.next();
    if (result.value !== undefined) await callback(result.value as T);
    if (result.done === true) break;
  }
  if ('return' in iterator && typeof iterator.return === 'function') {
    void iterator.return();
  }
}

async function collect(iterable: AsyncIterableIterator<Uint8Array> | Iterable<Uint8Array> | Iterator<Uint8Array>) {
  let size = 0;
  const buffers: Uint8Array[] = [];
  await forAwait(iterable, (value) => {
    buffers.push(value);
    size += value.byteLength;
  });
  const result = new Uint8Array(size);
  let offset = 0;
  for (const buffer of buffers) {
    result.set(buffer, offset);
    offset += buffer.byteLength;
  }
  return result;
}

function fromStream(stream: ReadableStream<Uint8Array>) {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime: ReadableStream may be async-iterable in some environments
  if ((stream as unknown as AsyncIterableIterator<Uint8Array>)[Symbol.asyncIterator]) {
    return stream as unknown as AsyncIterableIterator<Uint8Array>;
  }
  const reader = stream.getReader();
  return {
    next() {
      return reader.read();
    },
    return() {
      reader.releaseLock();
      return Promise.resolve({ done: true, value: undefined as Uint8Array | undefined });
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

function toArrayBuffer(data: Uint8Array) {
  const { buffer, byteOffset, byteLength } = data;
  if (byteOffset === 0 && byteLength === buffer.byteLength) return buffer as ArrayBuffer;
  return buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer;
}

// Keep HTTP diagnostics centralized to debug mobile sync connectivity issues.
const httpWithLogging = {
  async request(request: GitHttpRequest): Promise<GitHttpResponse> {
    const { url, method = 'GET', body } = request;
    // Tell the server we prefer no compression.  On LAN this saves mobile CPU
    // (gzip decompression of large packs is expensive on Hermes) while adding
    // negligible transfer overhead.  OkHttp normally adds "Accept-Encoding: gzip"
    // automatically; setting "identity" overrides that.
    const headers: Record<string, string> = { ...request.headers, 'Accept-Encoding': 'identity' };
    console.log('Git HTTP request:', { url, method, headers });

    try {
      // ── Streaming path for large POST (git-upload-pack) ───────────
      // Android OkHttp buffers the entire HTTP response in JVM heap before
      // exposing it to JS.  For git-upload-pack this can easily be 100+ MB
      // and triggers OOM.
      //
      // Solution: use a native Kotlin method that performs the POST and
      // streams the response body directly to a temp file on disk using
      // Okio, never holding more than 64 KB in memory.  JS then reads the
      // temp file back in chunks via `readFileChunk`.
      const isGitUploadPackPost = method === 'POST' && url.includes('git-upload-pack');
      if (isGitUploadPackPost && hasNativeStreamingHttp) {
        return await nativeStreamingPost(url, headers, body);
      }

      // ── Regular fetch path (GET, small POST) ─────────────────────
      const timeoutMs = method === 'POST' ? 120_000 : 30_000;
      let payload: ArrayBuffer | undefined;

      if (body !== undefined) {
        const bytes = body instanceof Uint8Array ? body : await collect(body);
        payload = toArrayBuffer(bytes);
      }

      const response = await pTimeout(fetch(url, { method, headers, body: payload }), {
        milliseconds: timeoutMs,
        message: new Error(`Git HTTP request timeout: ${method} ${url}`),
      });

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const responseBody = (response.body && 'getReader' in response.body
        ? fromStream(response.body as ReadableStream<Uint8Array>)
        : fromValue(new Uint8Array(await response.arrayBuffer()))) as AsyncIterableIterator<Uint8Array>;

      console.log('Git HTTP response:', {
        url: response.url,
        statusCode: response.status,
        statusMessage: response.statusText,
      });

      return {
        url: response.url,
        method: response.type === 'opaque' ? undefined : method,
        statusCode: response.status,
        statusMessage: response.statusText,
        body: responseBody,
        headers: responseHeaders,
      };
    } catch (error) {
      console.error('Git HTTP request failed:', {
        url,
        method,
        message: (error as Error).message,
      });
      throw error;
    }
  },
};

/**
 * Perform an HTTP POST via the native OkHttp streaming path:
 * 1. POST body is sent as-is.
 * 2. Response body is streamed to a temp file (never fully in memory).
 * 3. The temp file is read back as an async iterator of 64 KB chunks.
 * 4. The temp file is deleted once fully consumed.
 */
async function nativeStreamingPost(
  url: string,
  headers: Record<string, string>,
  body?: AsyncIterableIterator<Uint8Array> | Iterable<Uint8Array> | Uint8Array,
): Promise<GitHttpResponse> {
  // Collect the request body (git protocol payload, typically < 1 KB).
  let bodyBytes: Uint8Array;
  if (body === undefined) {
    bodyBytes = new Uint8Array(0);
  } else if (body instanceof Uint8Array) {
    bodyBytes = body;
  } else {
    bodyBytes = await collect(body);
  }

  const bodyBase64 = Buffer.from(bodyBytes).toString('base64');
  const contentType = Object.entries(headers)
    .find(([key]) => key.toLowerCase() === 'content-type')?.[1] ?? 'application/x-git-upload-pack-request';

  // Use the app's cache dir for the temp file (auto-cleaned by Android).
  const cacheDirectory = FileSystemLegacy.cacheDirectory;
  if (cacheDirectory === null) {
    throw new Error('FileSystem cache directory unavailable');
  }
  const temporaryPath = `${toPlainPath(cacheDirectory)}/git-pack-${Date.now()}.tmp`;

  console.log('Git HTTP (native streaming):', { url, temporaryPath });

  const externalStorageExtension = ExternalStorage as unknown as IExternalStorageExtended;
  const result = await externalStorageExtension.httpPostToFile(
    url,
    headers,
    bodyBase64,
    temporaryPath,
    contentType,
  );

  console.log('Git HTTP response (native):', {
    url,
    statusCode: result.statusCode,
    bytesWritten: result.bytesWritten,
  });

  // Create an async iterator that reads the temp file in 64 KB chunks,
  // then deletes the file when done.
  const responseBody = createFileChunkIterator(temporaryPath, result.bytesWritten);

  return {
    url,
    method: 'POST',
    statusCode: result.statusCode,
    statusMessage: result.statusCode === 200 ? 'OK' : `HTTP ${result.statusCode}`,
    body: responseBody,
    headers: result.headers,
  };
}

/**
 * Async iterator that reads a file in chunks via the native module,
 * yielding Uint8Array pieces and deleting the temp file when exhausted.
 */
function createFileChunkIterator(filePath: string, totalBytes: number): AsyncIterableIterator<Uint8Array> {
  let offset = 0;
  let iteratorDone = false;

  const externalStorageExtension = ExternalStorage as unknown as IExternalStorageExtended;

  return {
    async next(): Promise<IteratorResult<Uint8Array>> {
      if (iteratorDone || offset >= totalBytes) {
        if (!iteratorDone) {
          iteratorDone = true;
          // Fire the hook BEFORE cleanup — this is the last async point
          // before isomorphic-git's synchronous pack processing.
          if (totalBytes > 1024 * 1024) {
            onPackStreamConsumed?.(totalBytes);
            // Yield 200ms so React can render the progress message
            // before the JS thread gets blocked by pack indexing.
            await new Promise<void>(r => setTimeout(r, 200));
          }
          // Clean up temp file
          try {
            await externalStorageExtension.deleteFile(filePath);
          } catch {
            // non-fatal
          }
        }
        return { done: true, value: undefined as unknown as Uint8Array };
      }

      const chunk = await externalStorageExtension.readFileChunk(filePath, offset, FILE_CHUNK_SIZE);
      offset += chunk.bytesRead;

      if (chunk.bytesRead === 0) {
        iteratorDone = true;
        try {
          await externalStorageExtension.deleteFile(filePath);
        } catch {
          // non-fatal
        }
        return { done: true, value: undefined as unknown as Uint8Array };
      }

      const bytes = Buffer.from(chunk.data, 'base64');
      return { done: false, value: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
    },
    return() {
      iteratorDone = true;
      // Best-effort cleanup
      try {
        void externalStorageExtension.deleteFile(filePath).catch(() => {});
      } catch {
        // non-fatal
      }
      return Promise.resolve({ done: true, value: undefined as unknown as Uint8Array });
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

/**
 * Create auth header for git operations
 * Includes CSRF header to bypass TiddlyWiki's CSRF protection
 * If token is empty/undefined, still includes CSRF header but no Authorization
 */
function createAuthHeader(remote: Pick<IGitRemote, 'token' | 'tokenAuthHeaderName' | 'tokenAuthHeaderValue'>): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {
    // TiddlyWiki expects a non-empty X-Requested-With to bypass CSRF for POST
    'X-Requested-With': 'TiddlyWiki',
  };

  if (remote.token !== undefined && remote.token !== '') {
    const credentials = Buffer.from(`:${remote.token}`).toString('base64');
    headers.Authorization = `Basic ${credentials}`;
  }

  const tokenAuthHeaderName = typeof remote.tokenAuthHeaderName === 'string' && remote.tokenAuthHeaderName.length > 0
    ? remote.tokenAuthHeaderName
    : (remote.token ? `${DEFAULT_TIDGI_TOKEN_AUTH_HEADER_PREFIX}-${remote.token}` : undefined);
  const tokenAuthHeaderValue = typeof remote.tokenAuthHeaderValue === 'string' && remote.tokenAuthHeaderValue.length > 0
    ? remote.tokenAuthHeaderValue
    : (remote.token ? DEFAULT_TIDGI_USER_NAME : undefined);

  if (tokenAuthHeaderName && tokenAuthHeaderValue) {
    headers[tokenAuthHeaderName] = tokenAuthHeaderValue;
  }

  return headers;
}

// Avoid undefined header values when passing to fetch.
function normalizeHeaders(headers: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined)) as Record<string, string>;
}

// Keep auth handling consistent across git operations to simplify retries.
function createAuthCallbacks(token?: string): { onAuth?: () => { username: string; password: string }; onAuthFailure?: () => void } {
  if (token === undefined || token === '') return {};

  return {
    onAuth: () => ({
      username: 'tidgi',
      password: token,
    }),
    onAuthFailure: () => {
      console.warn('Git auth failed, token may be invalid or expired');
    },
  };
}

// Fail fast on unreachable endpoints to avoid silent hangs during clone.
async function preflightInfoReferences(url: string, headers: Record<string, string>): Promise<void> {
  const infoReferencesUrl = `${url.replace(/\/$/, '')}/info/refs?service=git-upload-pack`;
  const response = await pTimeout(fetch(infoReferencesUrl, { headers }), {
    milliseconds: 15_000,
    message: new Error(`Git info/refs timeout: ${infoReferencesUrl}`),
  });

  if (!response.ok) {
    throw new Error(`Git info/refs failed: ${response.status} ${response.statusText}`);
  }
}

/**
 * Clone a git repository.
 *
 * Strategy:
 * 1. Try the TidGi Desktop "full-archive" endpoint (tar download + native extract).
 *    This is ~10-50x faster than git protocol because it skips delta resolution
 *    and JS→Native file-by-file checkout.  Supports resumable download.
 * 2. If the endpoint returns 404 (not TidGi Desktop / old version / GitHub),
 *    fall back to standard isomorphic-git clone.
 */
export async function gitClone(
  workspace: IWikiWorkspace,
  remote: IGitRemote,
  onProgress?: (phase: string, loaded: number, total: number) => void,
): Promise<void> {
  // Remove trailing slash from baseUrl to avoid double slashes
  const baseUrl = remote.baseUrl.replace(/\/$/, '');
  const url = `${baseUrl}/tw-mobile-sync/git/${remote.workspaceId}`;
  const directory = toPlainPath(workspace.wikiFolderLocation);

  console.log('Git clone URL:', url);
  console.log('Git clone directory:', directory);
  console.log('Git clone remote:', JSON.stringify(remote, null, 2));

  // ── Fast path: tar archive download (TidGi Desktop only) ──────────
  if (typeof ExternalStorage.extractTar === 'function') {
    try {
      const didArchive = await tryArchiveClone(remote, url, directory, onProgress);
      if (didArchive) {
        console.log('[gitClone] Fast archive clone succeeded');
        return;
      }
      // didArchive === false means endpoint not available → fall through
    } catch (error) {
      const message = (error as Error).message;
      // Connection aborts during archive download are retryable on next attempt
      if (isConnectionAbortError(message)) {
        console.warn('[gitClone] Archive download interrupted, will retry:', message);
        // Fall through to retry with archive again below
      } else {
        console.warn('[gitClone] Archive clone failed, falling back to git protocol:', message);
        // Non-retryable archive errors → fall through to git protocol
      }
    }
  }

  // ── Standard path: isomorphic-git clone (works with any git server) ──
  console.log('Git clone strategy:', { depth: 1, noTags: true, singleBranch: true });

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= CLONE_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.log(`[gitClone] Retry attempt ${attempt}/${CLONE_MAX_RETRIES} after connection abort`);
      onProgress?.('Reconnecting…', attempt, CLONE_MAX_RETRIES);
      await new Promise<void>(resolve => setTimeout(resolve, CLONE_RETRY_DELAY_MS));

      // Clean the directory before retry — partial clone data is unusable.
      try {
        if (isExternalPath(directory)) {
          const info = await ExternalStorage.getInfo(toPlainPath(directory));
          if (info.exists) await ExternalStorage.rmdir(toPlainPath(directory));
          await ExternalStorage.mkdir(toPlainPath(directory));
        } else {
          await FileSystemLegacy.deleteAsync(toFileUri(directory), { idempotent: true });
          await FileSystemLegacy.makeDirectoryAsync(toFileUri(directory), { intermediates: true });
        }
      } catch (cleanupError) {
        console.warn('[gitClone] Failed to clean directory before retry:', cleanupError);
      }
    }

    try {
      await gitCloneOnce(workspace, remote, url, directory, onProgress);
      return; // success
    } catch (error) {
      lastError = error as Error;
      const message = lastError.message;

      // Only retry on connection-abort; other errors are not transient.
      if (isConnectionAbortError(message) && attempt < CLONE_MAX_RETRIES) {
        console.warn(`[gitClone] Connection aborted (attempt ${attempt + 1}), will retry: ${message}`);
        continue;
      }

      // Not retryable or retries exhausted — propagate.
      throw error;
    }
  }

  // Should not reach here, but just in case.
  throw lastError ?? new Error('Git clone failed');
}

// ── Fast archive clone ─────────────────────────────────────────────────

/**
 * Try to clone via the TidGi Desktop full-archive endpoint.
 *
 * Returns `true` if the archive was downloaded and extracted successfully.
 * Returns `false` if the endpoint is not available (404) — caller should
 * fall back to git protocol.
 * Throws on download/extraction errors.
 */
async function tryArchiveClone(
  remote: IGitRemote,
  gitUrl: string,
  directory: string,
  onProgress?: (phase: string, loaded: number, total: number) => void,
): Promise<boolean> {
  const archiveUrl = `${gitUrl}/full-archive`;
  const headers = normalizeHeaders(createAuthHeader(remote));
  // Add Accept-Encoding: identity to skip gzip (saves CPU on mobile for LAN)
  headers['Accept-Encoding'] = 'identity';

  // Download the tar file with native resumable download
  const tarPath = `${directory}.tar`;
  console.log('[archiveClone] Attempting full-archive download:', archiveUrl);
  onProgress?.('Downloading archive…', 0, 0);

  // Use the native module for resumable download
  const externalStorageExtended = ExternalStorage as unknown as {
    downloadFileResumable?: (url: string, headers: Record<string, string>, destinationPath: string) => Promise<{ statusCode: number; totalBytes: number; resumed: boolean }>;
    extractTar?: (tarPath: string, destinationDirectory: string) => Promise<{ filesExtracted: number }>;
  };

  if (typeof externalStorageExtended.downloadFileResumable !== 'function' || typeof externalStorageExtended.extractTar !== 'function') {
    console.log('[archiveClone] Native downloadFileResumable/extractTar not available');
    return false;
  }

  const downloadResult = await externalStorageExtended.downloadFileResumable(archiveUrl, headers, tarPath);
  console.log('[archiveClone] Download result:', downloadResult);

  if (downloadResult.statusCode === 404) {
    console.log('[archiveClone] full-archive endpoint not available (404)');
    try {
      await ExternalStorage.deleteFile(tarPath);
    } catch {
      // ignore cleanup failure
    }
    return false;
  }

  if (downloadResult.statusCode !== 200 && downloadResult.statusCode !== 206) {
    console.warn('[archiveClone] Download failed with status:', downloadResult.statusCode);
    // Clean up partial tar
    try {
      await ExternalStorage.deleteFile(tarPath);
    } catch { /* ignore */ }
    return false;
  }

  // Extract the tar archive
  console.log('[archiveClone] Extracting archive…');
  onProgress?.('Extracting files…', 0, 0);

  // Ensure the directory exists and is empty
  try {
    if (isExternalPath(directory)) {
      const info = await ExternalStorage.getInfo(directory);
      if (info.exists) await ExternalStorage.rmdir(directory);
      await ExternalStorage.mkdir(directory);
    } else {
      await FileSystemLegacy.deleteAsync(toFileUri(directory), { idempotent: true });
      await FileSystemLegacy.makeDirectoryAsync(toFileUri(directory), { intermediates: true });
    }
  } catch { /* directory might not exist yet, that's fine */ }

  const extractResult = await externalStorageExtended.extractTar(tarPath, directory);
  console.log('[archiveClone] Extracted', extractResult.filesExtracted, 'files');
  onProgress?.('Extracted files', extractResult.filesExtracted, extractResult.filesExtracted);

  // Clean up the tar file
  try {
    await ExternalStorage.deleteFile(tarPath);
  } catch { /* ignore */ }

  // Configure git remote URL so future push/fetch works
  await configureGitRemote(directory, remote);

  // The archive from TidGi Desktop is a bare-style export that does NOT
  // include .git/index.  Without the index, native gitStatus (and many
  // isomorphic-git operations) cannot detect changes.
  // We try native buildGitIndex first (fast, pure Kotlin), then fall back
  // to isomorphic-git checkout.
  console.log('[archiveClone] Rebuilding .git/index…');
  onProgress?.('Building git index…', 0, 0);
  try {
    await rebuildGitIndex(directory);
    console.log('[archiveClone] .git/index rebuilt successfully');
  } catch (indexError) {
    console.warn('[archiveClone] Failed to rebuild .git/index:', (indexError as Error).message);
    // Non-fatal: the wiki still works, but gitStatus will fall back to
    // the slow isomorphic-git statusMatrix path.
  }

  return true;
}

/**
 * Rebuild .git/index for a repository that's missing it (e.g. from archive clone).
 *
 * Strategy: use native buildGitIndex if available (parses pack file natively,
 * stats files natively — no JS↔Kotlin bridge per file). Falls back to
 * isomorphic-git checkout if native is unavailable.
 */
async function rebuildGitIndex(directory: string): Promise<void> {
  if (typeof ExternalStorage.buildGitIndex === 'function') {
    try {
      const result = await ExternalStorage.buildGitIndex(directory);
      console.log('[rebuildGitIndex] native result:', result);
      const parsed = JSON.parse(result) as { ok: boolean; entries?: number; error?: string };
      if (parsed.ok) {
        return;
      }
      console.warn('[rebuildGitIndex] native buildGitIndex failed:', parsed.error);
      // Fall through to isomorphic-git fallback
    } catch (nativeError) {
      console.warn('[rebuildGitIndex] native buildGitIndex threw:', (nativeError as Error).message);
    }
  }

  // Fallback: isomorphic-git checkout (slow — may crash on large repos)
  console.log('[rebuildGitIndex] using isomorphic-git checkout fallback');
  await git.checkout({
    fs,
    dir: directory,
    ref: 'HEAD',
    force: true,
    nonBlocking: true,
    batchSize: CHECKOUT_BATCH_SIZE,
  });
}

/**
 * After extracting the tar archive, configure the git remote URL
 * so that subsequent push/fetch operations work correctly.
 * The archive contains a placeholder remote URL that we need to replace.
 */
async function configureGitRemote(directory: string, remote: IGitRemote): Promise<void> {
  const baseUrl = remote.baseUrl.replace(/\/$/, '');
  const remoteUrl = `${baseUrl}/tw-mobile-sync/git/${remote.workspaceId}`;

  try {
    // Use isomorphic-git to set the remote URL
    await git.setConfig({
      fs,
      dir: directory,
      path: 'remote.origin.url',
      value: remoteUrl,
    });
    console.log('[configureGitRemote] Set remote origin to:', remoteUrl);
  } catch (error) {
    console.warn('[configureGitRemote] Failed to set remote, writing config directly:', (error as Error).message);
    // Fallback: write the config file directly
    const configPath = `${directory}/.git/config`;
    const configContent = [
      '[core]',
      '\trepositoryformatversion = 0',
      '\tfilemode = false',
      '\tbare = false',
      '[remote "origin"]',
      `\turl = ${remoteUrl}`,
      '\tfetch = +refs/heads/*:refs/remotes/origin/*',
      '',
    ].join('\n');
    if (isExternalPath(directory)) {
      await ExternalStorage.writeFileUtf8(configPath, configContent);
    } else {
      await FileSystemLegacy.writeAsStringAsync(toFileUri(configPath), configContent);
    }
  }
}

/** Single clone attempt (extracted for retry wrapper). */
async function gitCloneOnce(
  _workspace: IWikiWorkspace,
  remote: IGitRemote,
  url: string,
  directory: string,
  onProgress?: (phase: string, loaded: number, total: number) => void,
): Promise<void> {
  try {
    await preflightInfoReferences(url, normalizeHeaders(createAuthHeader(remote)));

    // Optional pre-download size check. Gracefully no-ops on Desktop versions
    // that don't yet have the /pack-size endpoint.
    const authHeaders = normalizeHeaders(createAuthHeader(remote));
    const estimatedBytes = await tryGetRemotePackSize(url, authHeaders);
    if (estimatedBytes !== null) {
      const estimatedMB = Math.round(estimatedBytes / 1024 / 1024);
      console.log(`Git clone estimated pack size: ${estimatedMB} MB`);
      onProgress?.(`Estimated size: ${estimatedMB} MB`, 0, estimatedBytes);
      if (estimatedBytes > MAX_SAFE_PACK_BYTES) {
        throw new Error(`${GIT_CLONE_ERROR_TOO_LARGE_PREFIX}${estimatedMB}`);
      }
    }

    // Track the last reported phase so we can detect "gaps" where
    // isomorphic-git is busy processing the pack without emitting progress.
    let lastPhase = '';
    let packDownloadReported = false;

    // Set module-level hooks so the FS layer can fire progress events at
    // key moments that isomorphic-git doesn't expose via onProgress.
    onLargeFileRead = (_filepath, sizeBytes) => {
      const mb = Math.round(sizeBytes / 1024 / 1024);
      onProgress?.(`Indexing pack (${mb} MB)`, 0, 0);
    };
    onPackStreamConsumed = (totalBytes) => {
      const mb = Math.round(totalBytes / 1024 / 1024);
      console.log(`Pack stream fully consumed: ${mb} MB — indexing will start`);
      onProgress?.(`Indexing pack (${mb} MB)`, 0, 0);
    };

    // Tell the UI the download is starting (native HTTP has no JS progress).
    onProgress?.('Downloading pack', 0, 0);

    await git.clone({
      fs,
      http: httpWithLogging,
      dir: directory,
      url,
      singleBranch: true,
      depth: 1,
      noTags: true,
      nonBlocking: true,
      batchSize: CHECKOUT_BATCH_SIZE,
      headers: normalizeHeaders(createAuthHeader(remote)),
      ...createAuthCallbacks(remote.token),
      onProgress: (progress) => {
        const phase = typeof progress.phase === 'string' ? progress.phase : '';
        const loaded = toSafeNumber(progress.loaded, 0);
        const total = toSafeNumber(progress.total, 0);

        // When transitioning from a server-side phase ("Compressing objects")
        // to a client-side phase ("Receiving objects"), inject a bridging
        // message so the user knows the app is still working.
        if (!packDownloadReported && lastPhase.startsWith('Compressing') && !phase.startsWith('Compressing')) {
          packDownloadReported = true;
          onProgress?.('Receiving pack data', 0, 0);
        }
        lastPhase = phase;

        onProgress?.(phase, loaded, total);
      },
    });

    console.log(`Successfully cloned repository to ${directory}`);
  } catch (error) {
    const message = (error as Error).message;

    // Re-throw structured sentinels as-is so callers can act on them.
    if (message.startsWith(GIT_CLONE_ERROR_TOO_LARGE_PREFIX) || message === GIT_CLONE_ERROR_OOM) {
      throw error;
    }

    // Convert Android/Hermes OOM into a clean sentinel.
    // React Native buffers the full response in the JVM heap; large packs exceed
    // the per-app growth limit (~256 MB) after baseline JS heap usage.
    if (isOOMError(message)) {
      console.error(`Git clone OOM — mobile-side heap exhausted: ${message}`);
      throw new Error(GIT_CLONE_ERROR_OOM);
    }

    // Tag connection-abort errors so the UI can show a specific message.
    if (isConnectionAbortError(message)) {
      console.error(`Git clone connection aborted: ${message}`);
      throw new Error(GIT_CLONE_ERROR_CONNECTION_ABORT);
    }

    console.error(`Git clone failed: ${message}`);
    throw new Error(`Failed to clone repository: ${message}`);
  } finally {
    // Always clean up module-level hooks to avoid leaking closures.
    onLargeFileRead = undefined;
    onPackStreamConsumed = undefined;
  }
}

/**
 * Pull latest changes from remote.
 * After desktop merge, this is a simple fast-forward (no conflicts possible).
 * Kept for backward compatibility with direct clone-from-desktop workflows.
 */
export async function gitPull(
  workspace: IWikiWorkspace,
  remote: IGitRemote,
  onProgress?: (phase: string, loaded: number, total: number) => void,
): Promise<void> {
  const directory = toPlainPath(workspace.wikiFolderLocation);
  const branch = await getCurrentBranch(directory);

  try {
    await git.pull({
      fs,
      http: httpWithLogging,
      dir: directory,
      ref: branch,
      singleBranch: true,
      headers: normalizeHeaders(createAuthHeader(remote)),
      ...createAuthCallbacks(remote.token),
      author: {
        name: 'TidGi Mobile',
        email: 'mobile@tidgi.fun',
      },
      onProgress: (progress) => {
        onProgress?.(
          typeof progress.phase === 'string' ? progress.phase : '',
          toSafeNumber(progress.loaded, 0),
          toSafeNumber(progress.total, 0),
        );
      },
    });

    console.log('Successfully pulled latest changes');
  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error(`Git pull failed: ${errorMessage}`);
    throw new Error(`Failed to pull changes: ${errorMessage}`);
  }
}

/**
 * Commit local changes
 */
export async function gitCommit(
  workspace: IWikiWorkspace,
  message: string,
): Promise<string> {
  const directory = toPlainPath(workspace.wikiFolderLocation);

  try {
    // Prefer native gitStatus to discover changed files — avoids the OOM crash
    // caused by isomorphic-git's statusMatrix doing full SHA-1 re-hash on 26K+ files.
    const nativeModule = ExternalStorage as unknown as Record<string, unknown>;
    let changedFiles: Array<{ path: string; type: 'add' | 'modify' | 'delete' }> | undefined;

    if (typeof nativeModule.gitStatus === 'function') {
      const nativeGitStatus = nativeModule.gitStatus as (directory: string) => Promise<string>;
      const jsonString = await nativeGitStatus(directory);
      const rawChanges = JSON.parse(jsonString) as Array<{ path: string; type: 'add' | 'modify' | 'delete' }>;

      // NFC/NFD deduplication
      const deletesByNFC = new Set<string>();
      const addsByNFC = new Set<string>();
      for (const change of rawChanges) {
        const nfcPath = change.path.normalize('NFC');
        if (change.type === 'delete') deletesByNFC.add(nfcPath);
        else if (change.type === 'add') addsByNFC.add(nfcPath);
      }
      const artifactPaths = new Set([...deletesByNFC].filter(p => addsByNFC.has(p)));
      changedFiles = rawChanges.filter(c => !artifactPaths.has(c.path.normalize('NFC')));
    }

    if (changedFiles !== undefined) {
      // Stage only the changed files identified by native gitStatus
      for (const change of changedFiles) {
        if (change.type === 'delete') {
          await git.remove({ fs, dir: directory, filepath: change.path });
        } else {
          await git.add({ fs, dir: directory, filepath: change.path });
        }
      }
    } else {
      // Fallback: isomorphic-git statusMatrix (JS-side, slower)
      const status = await git.statusMatrix({ fs, dir: directory });

      const deletesByNFC = new Map<string, string>();
      const addsByNFC = new Map<string, string>();
      for (const [filepath, headStatus, workdirStatus] of status) {
        const nfcPath = filepath.normalize('NFC');
        if (headStatus !== workdirStatus) {
          if (workdirStatus === 0) deletesByNFC.set(nfcPath, filepath);
          else if (headStatus === 0) addsByNFC.set(nfcPath, filepath);
        }
      }
      const artifactNFCPaths = new Set([...deletesByNFC.keys()].filter(p => addsByNFC.has(p)));

      for (const [filepath, headStatus, workdirStatus, stageStatus] of status) {
        const nfcPath = filepath.normalize('NFC');
        if (artifactNFCPaths.has(nfcPath)) continue;
        if (headStatus !== workdirStatus || headStatus !== stageStatus) {
          if (workdirStatus === 0) {
            await git.remove({ fs, dir: directory, filepath });
          } else {
            await git.add({ fs, dir: directory, filepath });
          }
        }
      }
    }

    // Commit
    const sha = await git.commit({
      fs,
      dir: directory,
      message,
      author: {
        name: 'TidGi Mobile',
        email: 'mobile@tidgi.fun',
      },
    });

    console.log(`Committed changes: ${sha}`);
    return sha;
  } catch (error) {
    console.error(`Git commit failed: ${(error as Error).message}`);
    throw new Error(`Failed to commit: ${(error as Error).message}`);
  }
}

/**
 * Push local commits to the desktop's mobile-incoming branch (force push).
 * Desktop handles merging into main via the merge-incoming endpoint.
 */
export async function gitPushToIncoming(
  workspace: IWikiWorkspace,
  remote: IGitRemote,
  onProgress?: (phase: string, loaded: number, total: number) => void,
): Promise<void> {
  const directory = toPlainPath(workspace.wikiFolderLocation);
  const branch = await getCurrentBranch(directory);

  await git.push({
    fs,
    http: httpWithLogging,
    dir: directory,
    remote: 'origin',
    ref: branch,
    remoteRef: 'refs/heads/mobile-incoming',
    force: true,
    headers: normalizeHeaders(createAuthHeader(remote)),
    ...createAuthCallbacks(remote.token),
    onProgress: (progress) => {
      onProgress?.(
        typeof progress.phase === 'string' ? progress.phase : '',
        toSafeNumber(progress.loaded, 0),
        toSafeNumber(progress.total, 0),
      );
    },
  });

  console.log('Successfully pushed to mobile-incoming branch');
}

/**
 * Ask desktop to merge mobile-incoming into main.
 * This is a simple POST to the merge-incoming endpoint.
 */
export async function triggerDesktopMerge(
  remote: IGitRemote,
): Promise<void> {
  const url = `${remote.baseUrl.replace(/\/$/, '')}/tw-mobile-sync/git/${remote.workspaceId}/merge-incoming`;
  const headers = normalizeHeaders(createAuthHeader(remote));

  const response = await fetch(url, { method: 'POST', headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Desktop merge failed (${response.status}): ${body}`);
  }
  console.log('Desktop merge-incoming completed');
}

/**
 * Fetch latest main from desktop and reset local branch to match.
 * After desktop merges mobile-incoming into main, mobile's local main
 * has diverged (it's a sibling, not ancestor). Reset --hard to adopt
 * the desktop's merged result.
 */
export async function gitFetchAndReset(
  workspace: IWikiWorkspace,
  remote: IGitRemote,
  onProgress?: (phase: string, loaded: number, total: number) => void,
): Promise<boolean> {
  const directory = toPlainPath(workspace.wikiFolderLocation);
  const branch = await getCurrentBranch(directory);

  const headBefore = await git.resolveRef({ fs, dir: directory, ref: 'HEAD' });

  await git.fetch({
    fs,
    http: httpWithLogging,
    dir: directory,
    remote: 'origin',
    ref: branch,
    singleBranch: true,
    headers: normalizeHeaders(createAuthHeader(remote)),
    ...createAuthCallbacks(remote.token),
    onProgress: (progress) => {
      onProgress?.(
        typeof progress.phase === 'string' ? progress.phase : '',
        toSafeNumber(progress.loaded, 0),
        toSafeNumber(progress.total, 0),
      );
    },
  });

  const remoteOid = await git.resolveRef({ fs, dir: directory, ref: `refs/remotes/origin/${branch}` });

  // Point local branch to remote's merged result
  await fs.promises.writeFile(
    `${directory}/.git/refs/heads/${branch}`,
    `${remoteOid}\n`,
    { encoding: 'utf8' },
  );
  // Checkout the new HEAD to update the working tree
  await git.checkout({ fs, dir: directory, ref: branch, force: true, nonBlocking: true, batchSize: CHECKOUT_BATCH_SIZE });

  const headAfter = await git.resolveRef({ fs, dir: directory, ref: 'HEAD' });
  return headBefore !== headAfter;
}

/**
 * Resolve a git ref (e.g., 'HEAD') to its SHA, used for detecting pull changes
 */
export async function gitResolveReference(workspace: IWikiWorkspace, reference: string): Promise<string> {
  try {
    return await git.resolveRef({ fs, dir: toPlainPath(workspace.wikiFolderLocation), ref: reference });
  } catch (error) {
    console.error(`Failed to resolve ${reference}: ${String(error)}`);
    return '';
  }
}

/**
 * Get list of changed files via git status, with change type.
 * Returns files that differ between HEAD and working directory.
 */
export async function gitDiffChangedFiles(workspace: IWikiWorkspace): Promise<Array<{ path: string; type: 'add' | 'modify' | 'delete' }>> {
  const directory = toPlainPath(workspace.wikiFolderLocation);
  console.log(`${new Date().toISOString()} [GitService] gitDiffChangedFiles starting for ${workspace.id}, dir=${directory}, isSubWiki=${workspace.isSubWiki ?? false}`);
  try {
    const startedAt = Date.now();

    // Try the native Kotlin gitStatus first — it parses .git/index directly
    // and uses stat-cache (size+mtime) comparison instead of SHA-1 re-hashing,
    // making it orders of magnitude faster than isomorphic-git's statusMatrix.
    const nativeModule = ExternalStorage as unknown as Record<string, unknown>;
    if (typeof nativeModule.gitStatus === 'function') {
      const nativeGitStatus = nativeModule.gitStatus as (directory: string) => Promise<string>;
      const jsonString = await nativeGitStatus(directory);
      const rawChanges = JSON.parse(jsonString) as Array<{ path: string; type: 'add' | 'modify' | 'delete' }>;
      console.log(`${new Date().toISOString()} [GitService] native gitStatus raw count=${rawChanges.length}, dir=${directory}`);

      // If native returns 0, trust the result and return immediately.
      // Native gitStatus compares stat-cache (size+mtime) which is accurate
      // after a correct extractTar + buildGitIndex.
      if (rawChanges.length === 0) {
        const elapsedMs = Date.now() - startedAt;
        console.log(`${new Date().toISOString()} [GitService] gitDiffChangedFiles (native) for ${workspace.id} took ${elapsedMs}ms, count=0 (no changes)`);
        return [];
      } else {
        // Native returned >0 changes — apply NFC/NFD deduplication
        const deletesByNFC = new Set<string>();
        const addsByNFC = new Set<string>();
        const changes: Array<{ path: string; type: 'add' | 'modify' | 'delete' }> = [];
        for (const change of rawChanges) {
          const nfcPath = change.path.normalize('NFC');
          if (change.type === 'delete') {
            deletesByNFC.add(nfcPath);
          } else if (change.type === 'add') {
            addsByNFC.add(nfcPath);
          }
          changes.push(change);
        }
        const artifactPaths = new Set([...deletesByNFC].filter(p => addsByNFC.has(p)));
        const deduped = changes.filter(c => !artifactPaths.has(c.path.normalize('NFC')));
        console.log(`${new Date().toISOString()} [GitService] after NFC dedup: ${rawChanges.length} → ${deduped.length}, removed ${artifactPaths.size} NFC/NFD pairs`);

        const elapsedMs = Date.now() - startedAt;
        console.log(
          `${new Date().toISOString()} [GitService] gitDiffChangedFiles (native) for ${workspace.id} took ${elapsedMs}ms, count=${deduped.length}, sample=${
            deduped.slice(0, 8).map(change => `${change.type}:${change.path}`).join(' | ')
          }`,
        );
        return deduped.sort((a, b) => a.path.localeCompare(b.path));
      }
    }

    // Native gitStatus not available — return empty.
    // iOS native module will be implemented in expo-tiddlywiki-filesystem.
    console.warn(`${new Date().toISOString()} [GitService] gitDiffChangedFiles: native gitStatus not available for ${workspace.id}, returning empty`);
    return [];
  } catch (error) {
    console.error(`Failed to diff: ${(error as Error).message}`);
    return [];
  }
}

export async function gitGetCommitHistory(workspace: IWikiWorkspace, depth = 100): Promise<IGitCommitInfo[]> {
  const directory = toPlainPath(workspace.wikiFolderLocation);
  try {
    const commits = await git.log({ fs, dir: directory, depth });
    return commits.map((entry) => {
      const commit = entry.commit;
      return {
        oid: entry.oid,
        message: commit.message,
        authorName: commit.author.name,
        authorEmail: commit.author.email,
        timestamp: commit.author.timestamp * 1000,
        parentOids: [...commit.parent],
      };
    });
  } catch (error) {
    console.error(`Failed to read git history: ${(error as Error).message}`);
    return [];
  }
}

export async function gitGetAheadCommitCount(workspace: IWikiWorkspace): Promise<number> {
  const directory = toPlainPath(workspace.wikiFolderLocation);

  if (typeof workspace.deferStatusScanUntil === 'number' && Date.now() < workspace.deferStatusScanUntil) {
    return 0;
  }

  try {
    const branch = await getCurrentBranch(directory);
    let localCommits: Array<{ oid: string }> = [];
    try {
      localCommits = await git.log({ fs, dir: directory, ref: branch, depth: 300 });
    } catch {
      localCommits = await git.log({ fs, dir: directory, ref: 'HEAD', depth: 300 });
    }

    let remoteCommits: Array<{ oid: string }> = [];
    try {
      remoteCommits = await git.log({ fs, dir: directory, ref: `origin/${branch}`, depth: 300 });
    } catch {
      remoteCommits = [];
    }

    const remoteCommitOids = new Set(remoteCommits.map(commit => commit.oid));
    let aheadCount = 0;
    for (const commit of localCommits) {
      if (remoteCommitOids.has(commit.oid)) {
        break;
      }
      aheadCount += 1;
    }

    return aheadCount;
  } catch (error) {
    console.error(`Failed to get ahead commit count: ${(error as Error).message}`);
    return 0;
  }
}

export async function gitGetChangedFilesForCommit(
  workspace: IWikiWorkspace,
  commitOid: string,
  parentOid?: string,
): Promise<IGitCommitFileDiffResult> {
  const directory = toPlainPath(workspace.wikiFolderLocation);
  try {
    if (!parentOid) {
      return { files: [], isShallowSnapshot: false };
    }

    try {
      await git.resolveRef({ fs, dir: directory, ref: parentOid });
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('Could not find')) {
        return { files: [], isShallowSnapshot: true };
      }
      throw error;
    }
    const result = await diffCommitTrees(directory, parentOid, commitOid);

    return {
      files: result.sort((left, right) => left.path.localeCompare(right.path)),
      isShallowSnapshot: false,
    };
  } catch (error) {
    console.warn(`Failed to read changed files for commit ${commitOid}: ${(error as Error).message}`);
    throw error;
  }
}

type GitTreeEntry = {
  mode: string;
  oid: string;
  path: string;
  type: 'blob' | 'commit' | 'tree';
};

function joinGitPath(parentPath: string, childPath: string): string {
  return parentPath.length > 0 ? `${parentPath}/${childPath}` : childPath;
}

async function readTreeEntries(directory: string, oid: string, filepath = ''): Promise<GitTreeEntry[]> {
  const result = await git.readTree({
    fs,
    dir: directory,
    oid,
    ...(filepath.length > 0 ? { filepath } : {}),
  });
  return result.tree as GitTreeEntry[];
}

async function collectTreeFiles(
  directory: string,
  oid: string,
  filepath: string,
  type: 'add' | 'delete',
): Promise<Array<{ path: string; type: 'add' | 'modify' | 'delete' }>> {
  const entries = await readTreeEntries(directory, oid, filepath);
  const result: Array<{ path: string; type: 'add' | 'modify' | 'delete' }> = [];
  for (const entry of entries) {
    const fullPath = joinGitPath(filepath, entry.path);
    if (entry.type === 'tree') {
      result.push(...await collectTreeFiles(directory, oid, fullPath, type));
    } else {
      result.push({ path: fullPath, type });
    }
  }
  return result;
}

async function diffCommitTrees(
  directory: string,
  beforeOid: string,
  afterOid: string,
  filepath = '',
): Promise<Array<{ path: string; type: 'add' | 'modify' | 'delete' }>> {
  const [beforeEntries, afterEntries] = await Promise.all([
    readTreeEntries(directory, beforeOid, filepath),
    readTreeEntries(directory, afterOid, filepath),
  ]);

  const beforeMap = new Map(beforeEntries.map(entry => [entry.path, entry]));
  const afterMap = new Map(afterEntries.map(entry => [entry.path, entry]));
  const entryNames = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const result: Array<{ path: string; type: 'add' | 'modify' | 'delete' }> = [];

  for (const entryName of entryNames) {
    const beforeEntry = beforeMap.get(entryName);
    const afterEntry = afterMap.get(entryName);
    const fullPath = joinGitPath(filepath, entryName);

    if (beforeEntry === undefined && afterEntry !== undefined) {
      if (afterEntry.type === 'tree') {
        result.push(...await collectTreeFiles(directory, afterOid, fullPath, 'add'));
      } else {
        result.push({ path: fullPath, type: 'add' });
      }
      continue;
    }

    if (beforeEntry !== undefined && afterEntry === undefined) {
      if (beforeEntry.type === 'tree') {
        result.push(...await collectTreeFiles(directory, beforeOid, fullPath, 'delete'));
      } else {
        result.push({ path: fullPath, type: 'delete' });
      }
      continue;
    }

    if (beforeEntry === undefined || afterEntry === undefined) {
      continue;
    }

    if (beforeEntry.type === 'tree' && afterEntry.type === 'tree') {
      if (beforeEntry.oid !== afterEntry.oid) {
        result.push(...await diffCommitTrees(directory, beforeOid, afterOid, fullPath));
      }
      continue;
    }

    if (beforeEntry.type !== afterEntry.type) {
      if (beforeEntry.type === 'tree') {
        result.push(...await collectTreeFiles(directory, beforeOid, fullPath, 'delete'));
      } else {
        result.push({ path: fullPath, type: 'delete' });
      }

      if (afterEntry.type === 'tree') {
        result.push(...await collectTreeFiles(directory, afterOid, fullPath, 'add'));
      } else {
        result.push({ path: fullPath, type: 'add' });
      }
      continue;
    }

    if (beforeEntry.oid !== afterEntry.oid || beforeEntry.mode !== afterEntry.mode) {
      result.push({ path: fullPath, type: 'modify' });
    }
  }

  return result;
}

const IMAGE_FILE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
const TEXT_FILE_EXTENSIONS = new Set(['.tid', '.js', '.ts', '.tsx', '.json', '.md', '.txt', '.css', '.html', '.xml', '.yml', '.yaml', '.meta']);

function getFileExtension(filePath: string): string {
  const dotIndex = filePath.lastIndexOf('.');
  if (dotIndex < 0) return '';
  return filePath.slice(dotIndex).toLowerCase();
}

function getImageMimeType(filePath: string): string {
  const extension = getFileExtension(filePath);
  switch (extension) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.bmp':
      return 'image/bmp';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'image/png';
  }
}

function isTextFile(filePath: string): boolean {
  const extension = getFileExtension(filePath);
  return TEXT_FILE_EXTENSIONS.has(extension);
}

function isImageFile(filePath: string): boolean {
  const extension = getFileExtension(filePath);
  return IMAGE_FILE_EXTENSIONS.has(extension);
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

async function readFileBytesAtReference(directory: string, filePath: string, reference?: string): Promise<Uint8Array | undefined> {
  try {
    if (reference) {
      const { blob } = await git.readBlob({ fs, dir: directory, oid: reference, filepath: filePath });
      return blob;
    }
    const fileContent = await fs.promises.readFile(`${directory}/${filePath}`);
    if (typeof fileContent === 'string') {
      return new TextEncoder().encode(fileContent);
    }
    return Uint8Array.from(fileContent);
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes('Could not find') || message.includes('ENOENT') || message.includes('Not Found')) {
      return undefined;
    }
    throw error;
  }
}

export async function gitGetFileContentAtReference(
  workspace: IWikiWorkspace,
  filePath: string,
  reference?: string,
): Promise<IGitFileContent> {
  const directory = toPlainPath(workspace.wikiFolderLocation);
  try {
    const bytes = await readFileBytesAtReference(directory, filePath, reference);
    if (!bytes) {
      return { kind: 'missing' };
    }

    if (isImageFile(filePath)) {
      const base64 = Buffer.from(bytes).toString('base64');
      return {
        kind: 'image',
        dataUri: `data:${getImageMimeType(filePath)};base64,${base64}`,
      };
    }

    if (isTextFile(filePath)) {
      return {
        kind: 'text',
        text: decodeUtf8(bytes),
      };
    }

    return { kind: 'binary' };
  } catch (error) {
    console.warn(`Failed to read file content for ${filePath} at ${reference ?? 'working-tree'}: ${(error as Error).message}`);
    return { kind: 'missing' };
  }
}

/**
 * Check if repository has uncommitted changes.
 *
 * NOTE: isomorphic-git's statusMatrix stats every tracked file individually,
 * which is very slow on large repos (26K+ files = 30s+ on Android).
 * If any file triggers ENOENT (e.g. filenames with special characters), we
 * conservatively return true so the caller commits — a no-op commit is safe,
 * but missing a dirty commit could lose data.
 */
export async function gitHasChanges(workspace: IWikiWorkspace): Promise<boolean> {
  const directory = toPlainPath(workspace.wikiFolderLocation);

  try {
    // Prefer native gitStatus which uses stat-cache (size+mtime) comparison,
    // avoiding the OOM-inducing full SHA-1 re-hash that isomorphic-git's
    // statusMatrix performs on every file in the repo.
    const nativeModule = ExternalStorage as unknown as Record<string, unknown>;
    if (typeof nativeModule.gitStatus === 'function') {
      const nativeGitStatus = nativeModule.gitStatus as (directory: string) => Promise<string>;
      const jsonString = await nativeGitStatus(directory);
      const rawChanges = JSON.parse(jsonString) as Array<{ path: string; type: string }>;
      return rawChanges.length > 0;
    }

    // Fallback: isomorphic-git statusMatrix (JS-side, slower)
    const status = await git.statusMatrix({ fs, dir: directory });
    return status.some(([_filepath, headStatus, workdirStatus, stageStatus]) => workdirStatus !== headStatus || stageStatus !== headStatus);
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes('ENOENT')) {
      console.warn(`[gitHasChanges] ENOENT during statusMatrix, assuming changes exist: ${message}`);
      return true;
    }
    console.error(`Failed to check git status: ${message}`);
    throw new Error(`Cannot determine git status: ${message}`);
  }
}

/**
 * Count unsynced local commits against the tracked remote branch.
 * Adds 1 when working tree has uncommitted changes.
 */
export async function gitGetUnsyncedCommitCount(workspace: IWikiWorkspace): Promise<number> {
  const directory = toPlainPath(workspace.wikiFolderLocation);

  if (typeof workspace.deferStatusScanUntil === 'number' && Date.now() < workspace.deferStatusScanUntil) {
    return 0;
  }

  try {
    const branch = await getCurrentBranch(directory);
    let localCommits: Array<{ oid: string }> = [];
    try {
      localCommits = await git.log({ fs, dir: directory, ref: branch, depth: 300 });
    } catch {
      localCommits = await git.log({ fs, dir: directory, ref: 'HEAD', depth: 300 });
    }

    let remoteCommits: Array<{ oid: string }> = [];
    try {
      remoteCommits = await git.log({ fs, dir: directory, ref: `origin/${branch}`, depth: 300 });
    } catch {
      remoteCommits = [];
    }

    const remoteCommitOids = new Set(remoteCommits.map(commit => commit.oid));
    let aheadCount = 0;
    for (const commit of localCommits) {
      if (remoteCommitOids.has(commit.oid)) {
        break;
      }
      aheadCount += 1;
    }

    const hasUncommittedChanges = await gitHasChanges(workspace).catch(() => false);
    return aheadCount + (hasUncommittedChanges ? 1 : 0);
  } catch (error) {
    console.error(`Failed to get unsynced commit count: ${(error as Error).message}`);
    return 0;
  }
}

/**
 * Discard uncommitted changes for a specific file by checking out the HEAD version.
 * For newly added files (not in HEAD), delete them from the working directory.
 */
export async function gitDiscardFileChanges(
  workspace: IWikiWorkspace,
  filePath: string,
): Promise<void> {
  const directory = toPlainPath(workspace.wikiFolderLocation);
  try {
    // Check if the file exists in HEAD
    try {
      await git.readBlob({ fs, dir: directory, oid: await git.resolveRef({ fs, dir: directory, ref: 'HEAD' }), filepath: filePath });
      // File exists in HEAD — checkout the HEAD version
      await git.checkout({ fs, dir: directory, ref: 'HEAD', filepaths: [filePath], force: true, nonBlocking: true, batchSize: CHECKOUT_BATCH_SIZE });
    } catch {
      // File doesn't exist in HEAD — it's a new file, delete from working tree
      const fullPath = `${directory}/${filePath}`;
      await fs.promises.unlink(fullPath);
    }
    console.log(`Discarded changes for ${filePath}`);
  } catch (error) {
    console.error(`Failed to discard changes for ${filePath}: ${(error as Error).message}`);
    throw new Error(`Failed to discard changes: ${(error as Error).message}`);
  }
}

export async function gitAddToGitignore(
  workspace: IWikiWorkspace,
  pattern: string,
): Promise<void> {
  const directory = toPlainPath(workspace.wikiFolderLocation);
  const gitignorePath = `${directory}/.gitignore`;
  try {
    let existing = '';
    try {
      existing = await fs.promises.readFile(gitignorePath, 'utf8') as string;
    } catch {
      // file doesn't exist yet – start fresh
    }
    const lines = existing.split('\n').map(l => l.trim());
    if (!lines.includes(pattern)) {
      const newContent = existing.endsWith('\n') || existing === ''
        ? `${existing}${pattern}\n`
        : `${existing}\n${pattern}\n`;
      await fs.promises.writeFile(gitignorePath, newContent, 'utf8');
    }
  } catch (error) {
    throw new Error(`Failed to add to .gitignore: ${(error as Error).message}`);
  }
}

/**
 * Initialize a new git repository
 */
export async function gitInit(workspace: IWikiWorkspace): Promise<void> {
  const directory = toPlainPath(workspace.wikiFolderLocation);

  try {
    await git.init({ fs, dir: directory, defaultBranch: 'main' });
    console.log(`Initialized git repository at ${directory}`);
  } catch (error) {
    console.error(`Git init failed: ${(error as Error).message}`);
    throw new Error(`Failed to initialize repository: ${(error as Error).message}`);
  }
}

/**
 * Add remote to repository
 */
export async function gitAddRemote(
  workspace: IWikiWorkspace,
  remote: IGitRemote,
): Promise<void> {
  const directory = toPlainPath(workspace.wikiFolderLocation);
  const url = `${remote.baseUrl}/tw-mobile-sync/git/${remote.workspaceId}`;

  try {
    await git.addRemote({
      fs,
      dir: directory,
      remote: 'origin',
      url,
    });
    console.log(`Added remote: ${url}`);
  } catch (error) {
    console.error(`Failed to add remote: ${(error as Error).message}`);
    throw error;
  }
}
