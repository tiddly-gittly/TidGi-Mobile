/**
 * Git operations for TidGi-Mobile using isomorphic-git
 * Handles clone, pull, push with Basic Auth
 */

import { Buffer } from 'buffer';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { ExternalStorage, toPlainPath } from 'expo-filesystem-android-external-storage';
import git from 'isomorphic-git';
import pTimeout from 'p-timeout';
import { Platform } from 'react-native';
import { IWikiWorkspace } from '../../store/workspace';

function toSafeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

// Polyfill Buffer globally for isomorphic-git
if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}

// ─── Runtime detection of new native streaming API ────────────────────
// Added in expo-filesystem-android-external-storage@1.0.6
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
}

/**
 * Whether the native `ExternalStorage.httpPostToFile` streaming method is
 * available.  On iOS or when the native module isn't linked this will be false
 * and we fall back to the regular `fetch()` path (which may OOM on very large
 * repos).
 */
const hasNativeStreamingHttp: boolean = Platform.OS === 'android' &&
  typeof (ExternalStorage as unknown as Partial<IExternalStorageExtended>).httpPostToFile === 'function' &&
  typeof (ExternalStorage as unknown as Partial<IExternalStorageExtended>).readFileChunk === 'function' &&
  typeof (ExternalStorage as unknown as Partial<IExternalStorageExtended>).deleteFile === 'function';

/** 64 KB — chunk size for streaming a temp file back into JS. */
const FILE_CHUNK_SIZE = 64 * 1024;

/**
 * Whether a file:// URI (or plain path) points to external/shared storage
 * and needs to go through the raw native module instead of Expo FS.
 */
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
  if (plainPath.startsWith('file://')) return plainPath;
  return `file://${plainPath}`;
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
  return (
    Platform.OS === 'android' &&
    isExternalPath(filepath) &&
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

/**
 * Helper: get current branch name, defaulting to 'main'.
 * `git.currentBranch()` returns `string | void`; the `void` case
 * happens when HEAD is detached.
 */
async function getCurrentBranch(directory: string): Promise<string> {
  const branch = await git.currentBranch({ fs, dir: directory, fullname: false });
  return typeof branch === 'string' ? branch : 'main';
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
      const base64 = typeof data === 'string'
        ? Buffer.from(data, 'utf8').toString('base64')
        : Buffer.isBuffer(data)
        ? data.toString('base64')
        : Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64');

      if (canUseAndroidNativeBatchWrite(filepath)) {
        return scheduleNativeBatchWrite(filepath, base64);
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
    const { url, method = 'GET', headers = {}, body } = request;
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
 * Clone a git repository
 */
export async function gitClone(
  workspace: IWikiWorkspace,
  remote: IGitRemote,
  onProgress?: (phase: string, loaded: number, total: number) => void,
): Promise<void> {
  // Remove trailing slash from baseUrl to avoid double slashes
  const baseUrl = remote.baseUrl.replace(/\/$/, '');
  const url = `${baseUrl}/tw-mobile-sync/git/${remote.workspaceId}`;
  // isomorphic-git uses path.join(dir, ...) internally which mangles file:// URIs,
  // so always pass a plain filesystem path.
  const directory = toPlainPath(workspace.wikiFolderLocation);

  console.log('Git clone URL:', url);
  console.log('Git clone directory:', directory);
  console.log('Git clone remote:', JSON.stringify(remote, null, 2));
  console.log('Git clone strategy:', { depth: 1, noTags: true, singleBranch: true });

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
        onProgress?.(
          typeof progress.phase === 'string' ? progress.phase : '',
          toSafeNumber(progress.loaded, 0),
          toSafeNumber(progress.total, 0),
        );
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

    console.error(`Git clone failed: ${message}`);
    throw new Error(`Failed to clone repository: ${message}`);
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
    // Stage all changes using statusMatrix
    const status = await git.statusMatrix({ fs, dir: directory });

    // Detect NFC/NFD Unicode normalization artifact pairs before staging.
    // On Android (FAT32/ExFAT), filenames with Chinese/multi-byte characters may be
    // transparently converted from NFC (git index) to NFD (filesystem), causing statusMatrix
    // to report a spurious delete+add for the same logical file.
    const deletesByNFC = new Map<string, string>(); // nfc → original filepath
    const addsByNFC = new Map<string, string>(); // nfc → original filepath
    for (const [filepath, headStatus, workdirStatus] of status) {
      const nfcPath = filepath.normalize('NFC');
      if (headStatus !== workdirStatus) {
        if (workdirStatus === 0) deletesByNFC.set(nfcPath, filepath);
        else if (headStatus === 0) addsByNFC.set(nfcPath, filepath);
      }
    }
    const artifactNFCPaths = new Set([...deletesByNFC.keys()].filter(p => addsByNFC.has(p)));

    for (const [filepath, headStatus, workdirStatus, stageStatus] of status) {
      // headStatus: 0 = absent in HEAD, 1 = present in HEAD
      // workdirStatus: 0 = absent in workdir, 2 = present in workdir
      // stageStatus: 0 = absent in stage, 2 = present in stage, 3 = modified-and-staged
      const nfcPath = filepath.normalize('NFC');

      // Skip NFC/NFD normalization artifacts — the file hasn't actually changed
      if (artifactNFCPaths.has(nfcPath)) continue;

      // Stage changes when workdir differs from HEAD or stage differs from HEAD
      if (headStatus !== workdirStatus || headStatus !== stageStatus) {
        if (workdirStatus === 0) {
          // File deleted in workdir, stage deletion
          await git.remove({ fs, dir: directory, filepath });
        } else {
          // File added or modified in workdir, stage addition/modification
          await git.add({ fs, dir: directory, filepath });
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
  try {
    const status = await git.statusMatrix({ fs, dir: directory });
    const changes: Array<{ path: string; type: 'add' | 'modify' | 'delete' }> = [];
    // Track deletes and adds by NFC-normalized path to detect Unicode normalization artifacts.
    // On Android (FAT32/ExFAT), git checks out files with NFC paths but the filesystem may
    // convert them to NFD, causing a spurious delete (NFC path gone) + add (NFD path new)
    // for every file whose name contains multi-byte Unicode characters (e.g. Chinese).
    const deletesByNFC = new Set<string>();
    const addsByNFC = new Set<string>();
    for (const [filepath, headStatus, workdirStatus] of status) {
      if (headStatus !== workdirStatus) {
        const nfcPath = filepath.normalize('NFC');
        if (workdirStatus === 0) {
          deletesByNFC.add(nfcPath);
          changes.push({ path: filepath, type: 'delete' });
        } else if (headStatus === 0) {
          addsByNFC.add(nfcPath);
          changes.push({ path: filepath, type: 'add' });
        } else {
          changes.push({ path: filepath, type: 'modify' });
        }
      }
    }
    // Remove NFC/NFD artifact pairs: same NFC path appearing as both delete and add
    // means the file itself is unchanged — only its Unicode normalization form differs.
    const artifactPaths = new Set([...deletesByNFC].filter(p => addsByNFC.has(p)));
    const deduped = changes.filter(c => !artifactPaths.has(c.path.normalize('NFC')));
    return deduped.sort((a, b) => a.path.localeCompare(b.path));
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

export async function gitGetChangedFilesForCommit(
  workspace: IWikiWorkspace,
  commitOid: string,
  parentOid?: string,
): Promise<Array<{ path: string; type: 'add' | 'modify' | 'delete' }>> {
  const directory = toPlainPath(workspace.wikiFolderLocation);
  try {
    const currentFiles = new Set(await git.listFiles({ fs, dir: directory, ref: commitOid }));
    let previousFiles = new Set<string>();
    let isShallowSnapshot = false;
    if (parentOid) {
      try {
        previousFiles = new Set(await git.listFiles({ fs, dir: directory, ref: parentOid }));
      } catch (error) {
        const message = (error as Error).message;
        if (message.includes('Could not find')) {
          // Parent commit doesn't exist locally — this is a shallow clone snapshot.
          // Return empty diff instead of treating all files as "added", which is misleading.
          isShallowSnapshot = true;
        } else {
          throw error;
        }
      }
    }

    if (isShallowSnapshot) {
      return [];
    }

    const allPaths = new Set<string>([...currentFiles, ...previousFiles]);
    const result: Array<{ path: string; type: 'add' | 'modify' | 'delete' }> = [];
    for (const path of allPaths) {
      const inCurrent = currentFiles.has(path);
      const inPrevious = previousFiles.has(path);
      if (inCurrent && !inPrevious) {
        result.push({ path, type: 'add' });
      } else if (!inCurrent && inPrevious) {
        result.push({ path, type: 'delete' });
      } else if (inCurrent && inPrevious) {
        result.push({ path, type: 'modify' });
      }
    }
    return result.sort((left, right) => left.path.localeCompare(right.path));
  } catch (error) {
    console.warn(`Failed to read changed files for commit ${commitOid}: ${(error as Error).message}`);
    return [];
  }
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
 * Check if repository has uncommitted changes
 */
export async function gitHasChanges(workspace: IWikiWorkspace): Promise<boolean> {
  const directory = toPlainPath(workspace.wikiFolderLocation);

  try {
    const status = await git.statusMatrix({ fs, dir: directory });
    return status.some(([_filepath, headStatus, workdirStatus, stageStatus]) => workdirStatus !== headStatus || stageStatus !== headStatus);
  } catch (error) {
    console.error(`Failed to check git status: ${(error as Error).message}`);
    // Throw error to caller instead of silently returning false to prevent potential data loss
    throw new Error(`Cannot determine git status: ${(error as Error).message}`);
  }
}

/**
 * Count unsynced local commits against the tracked remote branch.
 * Adds 1 when working tree has uncommitted changes.
 */
export async function gitGetUnsyncedCommitCount(workspace: IWikiWorkspace): Promise<number> {
  const directory = toPlainPath(workspace.wikiFolderLocation);

  try {
    const branch = await getCurrentBranch(directory);
    const localCommits = await git.log({ fs, dir: directory, ref: branch, depth: 300 });

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
