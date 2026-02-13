/**
 * Git operations for TidGi-Mobile using isomorphic-git
 * Handles clone, pull, push with Basic Auth
 */

import { Buffer } from 'buffer';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import git from 'isomorphic-git';
import { ExternalStorage, toPlainPath } from '../../../modules/external-storage';
import pTimeout from 'p-timeout';
import { IWikiWorkspace } from '../../store/workspace';

function toSafeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

// Polyfill Buffer globally for isomorphic-git
if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}

/**
 * Whether a file:// URI (or plain path) points to external/shared storage
 * and needs to go through the raw native module instead of Expo FS.
 */
function isExternalPath(filepath: string): boolean {
  const plain = toPlainPath(filepath);
  return plain.startsWith('/storage/') || plain.startsWith('/sdcard/');
}

/**
 * Git remote configuration with authentication
 */
export interface IGitRemote {
  baseUrl: string;
  /** Token is optional - empty/undefined means anonymous access (insecure) */
  token?: string;
  workspaceId: string;
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
          return await FileSystemLegacy.readAsStringAsync(filepath, { encoding: FileSystemLegacy.EncodingType.UTF8 });
        }
        const base64 = await FileSystemLegacy.readAsStringAsync(filepath, { encoding: FileSystemLegacy.EncodingType.Base64 });
        return Buffer.from(base64, 'base64');
      } catch {
        const info = await FileSystemLegacy.getInfoAsync(filepath).catch(() => ({ exists: false }));
        if (!info.exists) {
          const enoentError = new Error(`ENOENT: no such file or directory, open '${filepath}'`) as NodeJS.ErrnoException;
          enoentError.code = 'ENOENT';
          enoentError.errno = -2;
          enoentError.path = filepath;
          throw enoentError;
        }
        if (encoding === 'utf8') {
          return await FileSystemLegacy.readAsStringAsync(filepath, { encoding: FileSystemLegacy.EncodingType.UTF8 });
        }
        const base64 = await FileSystemLegacy.readAsStringAsync(filepath, { encoding: FileSystemLegacy.EncodingType.Base64 });
        return Buffer.from(base64, 'base64');
      }
    },

    async writeFile(filepath: string, data: string | Uint8Array | Buffer, _options?: { encoding?: 'utf8'; mode?: number }): Promise<void> {
      if (isExternalPath(filepath)) {
        const plain = toPlainPath(filepath);
        if (typeof data === 'string') {
          return ExternalStorage.writeFileUtf8(plain, data);
        }
        const base64 = Buffer.isBuffer(data)
          ? data.toString('base64')
          : Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64');
        return ExternalStorage.writeFileBase64(plain, base64);
      }

      // Internal path
      const lastSlash = filepath.lastIndexOf('/');
      if (lastSlash > 0) {
        const parentDirectory = filepath.substring(0, lastSlash);
        const parentInfo = await FileSystemLegacy.getInfoAsync(parentDirectory);
        if (!parentInfo.exists) {
          await FileSystemLegacy.makeDirectoryAsync(parentDirectory, { intermediates: true });
        }
      }
      if (typeof data === 'string') {
        await FileSystemLegacy.writeAsStringAsync(filepath, data, { encoding: FileSystemLegacy.EncodingType.UTF8 });
      } else {
        const base64 = Buffer.isBuffer(data)
          ? data.toString('base64')
          : Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64');
        await FileSystemLegacy.writeAsStringAsync(filepath, base64, { encoding: FileSystemLegacy.EncodingType.Base64 });
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

      const info = await FileSystemLegacy.getInfoAsync(filepath);
      if (!info.exists) {
        const enoentError = new Error(`ENOENT: no such file or directory, unlink '${filepath}'`) as NodeJS.ErrnoException;
        enoentError.code = 'ENOENT';
        throw enoentError;
      }
      await FileSystemLegacy.deleteAsync(filepath, { idempotent: true });
    },

    async readdir(filepath: string): Promise<string[]> {
      if (isExternalPath(filepath)) {
        return ExternalStorage.readDir(toPlainPath(filepath));
      }

      try {
        return await FileSystemLegacy.readDirectoryAsync(filepath);
      } catch {
        const info = await FileSystemLegacy.getInfoAsync(filepath).catch(() => ({ exists: false }));
        if (!info.exists) {
          const enoentError = new Error(`ENOENT: no such file or directory, scandir '${filepath}'`) as NodeJS.ErrnoException;
          enoentError.code = 'ENOENT';
          throw enoentError;
        }
        return await FileSystemLegacy.readDirectoryAsync(filepath);
      }
    },

    async mkdir(filepath: string, options?: { recursive?: boolean }): Promise<void> {
      if (isExternalPath(filepath)) {
        return ExternalStorage.mkdir(toPlainPath(filepath));
      }

      try {
        const info = await FileSystemLegacy.getInfoAsync(filepath);
        if (info.exists) return;
        await FileSystemLegacy.makeDirectoryAsync(filepath, { intermediates: options?.recursive ?? true });
      } catch (error) {
        if (!options?.recursive) throw error;
      }
    },

    async rmdir(filepath: string): Promise<void> {
      if (isExternalPath(filepath)) {
        return ExternalStorage.rmdir(toPlainPath(filepath));
      }

      const info = await FileSystemLegacy.getInfoAsync(filepath);
      if (!info.exists) return;
      await FileSystemLegacy.deleteAsync(filepath, { idempotent: true });
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
        const isDir = info.isDirectory;
        const fileSize = toSafeNumber(info.size, 0);
        const modifiedTimeMs = toSafeNumber(info.modificationTime, Date.now());

        return {
          isFile: () => !isDir,
          isDirectory: () => isDir,
          isSymbolicLink: () => false,
          dev: 0, ino: 0, mode: isDir ? 0o755 : 0o644, nlink: 1, uid: 0, gid: 0, rdev: 0,
          size: fileSize, blksize: 4096, blocks: Math.ceil(fileSize / 512),
          atimeMs: modifiedTimeMs, mtimeMs: modifiedTimeMs, ctimeMs: modifiedTimeMs, birthtimeMs: modifiedTimeMs,
        };
      }

      // Internal path
      const info = await FileSystemLegacy.getInfoAsync(filepath, { size: true });
      if (!info.exists) {
        const error = new Error(`ENOENT: no such file or directory, stat '${filepath}'`) as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
      const isDir = info.isDirectory;
      const fileSize = toSafeNumber(info.size, 0);
      const modifiedTimeMs = toSafeNumber(info.modificationTime, Date.now() / 1000) * 1000;

      return {
        isFile: () => !isDir,
        isDirectory: () => isDir,
        isSymbolicLink: () => false,
        dev: 0, ino: 0, mode: isDir ? 0o755 : 0o644, nlink: 1, uid: 0, gid: 0, rdev: 0,
        size: fileSize, blksize: 4096, blocks: Math.ceil(fileSize / 512),
        atimeMs: modifiedTimeMs, mtimeMs: modifiedTimeMs, ctimeMs: modifiedTimeMs, birthtimeMs: modifiedTimeMs,
      };
    },

    async lstat(filepath: string) {
      return fs.promises.stat(filepath);
    },

    async readlink(_filepath: string): Promise<string> {
      throw new Error('readlink not supported on mobile');
    },

    async symlink(_target: string, _filepath: string): Promise<void> {
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
      return {};
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

function getIterator<T>(iterable: AsyncIterableIterator<T> | Iterable<T> | Iterator<T>) {
  if ((iterable as AsyncIterableIterator<T>)[Symbol.asyncIterator]) {
    return (iterable as AsyncIterableIterator<T>)[Symbol.asyncIterator]();
  }
  if ((iterable as Iterable<T>)[Symbol.iterator]) {
    return (iterable as Iterable<T>)[Symbol.iterator]();
  }
  return iterable as Iterator<T>;
}

async function forAwait<T>(iterable: AsyncIterableIterator<T> | Iterable<T> | Iterator<T>, callback: (value: T) => void | Promise<void>) {
  const iterator = getIterator(iterable);

  while (true) {
    const { value, done } = await iterator.next();
    if (value !== undefined) await callback(value);
    if (done) break;
  }
  if ('return' in iterator && typeof iterator.return === 'function') {
    iterator.return();
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
      return {};
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

function toArrayBuffer(data: Uint8Array) {
  const { buffer, byteOffset, byteLength } = data;
  if (byteOffset === 0 && byteLength === buffer.byteLength) return buffer;
  return buffer.slice(byteOffset, byteOffset + byteLength);
}

// Keep HTTP diagnostics centralized to debug mobile sync connectivity issues.
const httpWithLogging = {
  async request(request: GitHttpRequest): Promise<GitHttpResponse> {
    const { url, method = 'GET', headers = {}, body } = request;
    console.log('Git HTTP request:', { url, method, headers });

    try {
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

      const responseBody = response.body && 'getReader' in response.body
        ? fromStream(response.body as ReadableStream<Uint8Array>)
        : fromValue(new Uint8Array(await response.arrayBuffer()));

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
 * Create auth header for git operations
 * Includes CSRF header to bypass TiddlyWiki's CSRF protection
 * If token is empty/undefined, still includes CSRF header but no Authorization
 */
function createAuthHeader(token?: string): { Authorization?: string; 'X-Requested-With': string } {
  const headers: { Authorization?: string; 'X-Requested-With': string } = {
    // TiddlyWiki expects a non-empty X-Requested-With to bypass CSRF for POST
    'X-Requested-With': 'TiddlyWiki',
  };

  if (token !== undefined && token !== '') {
    const credentials = Buffer.from(`:${token}`).toString('base64');
    headers.Authorization = `Basic ${credentials}`;
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
  const directory = workspace.wikiFolderLocation;

  console.log('Git clone URL:', url);
  console.log('Git clone directory:', directory);
  console.log('Git clone remote:', JSON.stringify(remote, null, 2));

  try {
    await preflightInfoReferences(url, normalizeHeaders(createAuthHeader(remote.token)));
    await git.clone({
      fs,
      http: httpWithLogging,
      dir: directory,
      url,
      singleBranch: true,
      depth: 1,
      headers: createAuthHeader(remote.token),
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
    console.error(`Git clone failed: ${message}`);
    throw new Error(`Failed to clone repository: ${message}`);
  }
}

/**
 * Pull latest changes from remote
 */
export async function gitPull(
  workspace: IWikiWorkspace,
  remote: IGitRemote,
  onProgress?: (phase: string, loaded: number, total: number) => void,
): Promise<void> {
  const directory = workspace.wikiFolderLocation;
  const branch = (await git.currentBranch({ fs, dir: directory, fullname: false })) ?? 'main';

  try {
    await git.pull({
      fs,
      http: httpWithLogging,
      dir: directory,
      ref: branch,
      singleBranch: true,
      headers: createAuthHeader(remote.token),
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
    console.error(`Git pull failed: ${(error as Error).message}`);
    throw new Error(`Failed to pull changes: ${(error as Error).message}`);
  }
}

/**
 * Commit local changes
 */
export async function gitCommit(
  workspace: IWikiWorkspace,
  message: string,
): Promise<string> {
  const directory = workspace.wikiFolderLocation;

  try {
    // Stage all changes using statusMatrix
    const status = await git.statusMatrix({ fs, dir: directory });
    for (const [filepath, headStatus, workdirStatus, stageStatus] of status) {
      // headStatus: 0 = absent in HEAD, 1 = present in HEAD
      // workdirStatus: 0 = absent in workdir, 2 = present in workdir
      // stageStatus: 0 = absent in stage, 2 = present in stage, 3 = modified-and-staged

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
 * Push local commits to remote
 */
export async function gitPush(
  workspace: IWikiWorkspace,
  remote: IGitRemote,
  onProgress?: (phase: string, loaded: number, total: number) => void,
): Promise<void> {
  const directory = workspace.wikiFolderLocation;
  const branch = (await git.currentBranch({ fs, dir: directory, fullname: false })) ?? 'main';

  try {
    await git.push({
      fs,
      http: httpWithLogging,
      dir: directory,
      remote: 'origin',
      ref: branch,
      headers: createAuthHeader(remote.token),
      ...createAuthCallbacks(remote.token),
      onProgress: (progress) => {
        onProgress?.(
          typeof progress.phase === 'string' ? progress.phase : '',
          toSafeNumber(progress.loaded, 0),
          toSafeNumber(progress.total, 0),
        );
      },
    });

    console.log('Successfully pushed changes');
  } catch (error) {
    console.error(`Git push failed: ${(error as Error).message}`);

    // Check if it's a conflict
    if ((error as Error).message.includes('failed to push') || (error as Error).message.includes('non-fast-forward')) {
      throw new Error('PUSH_CONFLICT');
    }

    throw new Error(`Failed to push: ${(error as Error).message}`);
  }
}

/**
 * Push local commits to a temporary conflict branch, then reset main to origin/main.
 * This avoids an infinite conflict loop where the same local commits keep conflicting.
 */
export async function gitPushToConflictBranch(
  workspace: IWikiWorkspace,
  remote: IGitRemote,
  deviceId: string,
): Promise<string> {
  const directory = workspace.wikiFolderLocation;
  const branch = (await git.currentBranch({ fs, dir: directory, fullname: false })) ?? 'main';
  const timestamp = Date.now();
  const branchName = `client/${deviceId}/${timestamp}`;

  try {
    // Create the conflict branch from current HEAD (which has local commits)
    await git.branch({ fs, dir: directory, ref: branchName });

    // Push the conflict branch to remote
    await git.push({
      fs,
      http: httpWithLogging,
      dir: directory,
      remote: 'origin',
      ref: branchName,
      headers: createAuthHeader(remote.token),
      ...createAuthCallbacks(remote.token),
    });

    // Fetch latest remote main so we have up-to-date origin/main
    await git.fetch({
      fs,
      http: httpWithLogging,
      dir: directory,
      remote: 'origin',
      ref: branch,
      singleBranch: true,
      headers: createAuthHeader(remote.token),
      ...createAuthCallbacks(remote.token),
    });

    // Hard-reset main to origin/main by checking out with force.
    // isomorphic-git checkout with force discards local changes.
    await git.checkout({ fs, dir: directory, ref: branch, force: true });

    // Clean untracked files that checkout --force doesn't remove.
    // Without this, new local tiddler files get re-committed next cycle.
    await cleanUntrackedFiles(directory);

    // Delete the local conflict branch (it already lives on remote)
    await git.deleteBranch({ fs, dir: directory, ref: branchName });

    console.log(`Pushed to conflict branch: ${branchName}, main reset to origin/main`);
    return branchName;
  } catch (error) {
    // Best-effort: try to get back to main
    try {
      await git.checkout({ fs, dir: directory, ref: branch, force: true });
    } catch { /* ignore */ }
    console.error(`Failed to push to conflict branch: ${(error as Error).message}`);
    throw error;
  }
}

/**
 * Resolve a git ref (e.g., 'HEAD') to its SHA, used for detecting pull changes
 */
export async function gitResolveReference(workspace: IWikiWorkspace, reference: string): Promise<string> {
  try {
    return await git.resolveRef({ fs, dir: workspace.wikiFolderLocation, ref: reference });
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
  const directory = workspace.wikiFolderLocation;
  try {
    const status = await git.statusMatrix({ fs, dir: directory });
    const changes: Array<{ path: string; type: 'add' | 'modify' | 'delete' }> = [];
    for (const [filepath, headStatus, workdirStatus] of status) {
      if (headStatus !== workdirStatus) {
        if (workdirStatus === 0) {
          changes.push({ path: filepath, type: 'delete' });
        } else if (headStatus === 0) {
          changes.push({ path: filepath, type: 'add' });
        } else {
          changes.push({ path: filepath, type: 'modify' });
        }
      }
    }
    return changes;
  } catch (error) {
    console.error(`Failed to diff: ${(error as Error).message}`);
    return [];
  }
}

/**
 * Remove untracked files from working directory (equivalent to git clean -fd).
 * Needed after force-checkout to prevent untracked files from being re-committed.
 */
async function cleanUntrackedFiles(directory: string): Promise<void> {
  try {
    const status = await git.statusMatrix({ fs, dir: directory });
    for (const [filepath, headStatus, workdirStatus] of status) {
      // headStatus=0, workdirStatus=2 means file exists in workdir but not in HEAD → untracked
      if (headStatus === 0 && workdirStatus === 2) {
        const fullPath = `${directory}/${filepath}`;
        try {
          const file = new File(fullPath);
          if (file.exists) {
            file.delete();
          }
        } catch {
          // Best-effort cleanup
        }
      }
    }
  } catch (error) {
    console.warn(`cleanUntrackedFiles failed: ${(error as Error).message}`);
  }
}

/**
 * Check if repository has uncommitted changes
 */
export async function gitHasChanges(workspace: IWikiWorkspace): Promise<boolean> {
  const directory = workspace.wikiFolderLocation;

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
 * Initialize a new git repository
 */
export async function gitInit(workspace: IWikiWorkspace): Promise<void> {
  const directory = workspace.wikiFolderLocation;

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
  const directory = workspace.wikiFolderLocation;
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
