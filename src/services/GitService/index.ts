/**
 * Git operations for TidGi-Mobile using isomorphic-git
 * Handles clone, pull, push with Basic Auth
 */

import { Buffer } from 'buffer';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { ExternalStorage, toPlainPath } from 'expo-filesystem-android-external-storage';
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
 * Git remote configuration with authentication
 */
export interface IGitRemote {
  baseUrl: string;
  /** Token is optional - empty/undefined means anonymous access (insecure) */
  token?: string;
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
          dev: 0,
          ino: 0,
          mode: isDir ? 0o755 : 0o644,
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
      const info = await FileSystemLegacy.getInfoAsync(filepath);
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
        dev: 0,
        ino: 0,
        mode: isDir ? 0o755 : 0o644,
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
      return Promise.resolve({ done: true, value: undefined as T | undefined });
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
  // isomorphic-git uses path.join(dir, ...) internally which mangles file:// URIs,
  // so always pass a plain filesystem path.
  const directory = toPlainPath(workspace.wikiFolderLocation);

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
  const directory = toPlainPath(workspace.wikiFolderLocation);
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
  const directory = toPlainPath(workspace.wikiFolderLocation);

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
  const directory = toPlainPath(workspace.wikiFolderLocation);
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

    // Check if it's a conflict (non-fast-forward)
    if ((error as Error).message.includes('failed to push') || (error as Error).message.includes('non-fast-forward')) {
      throw new Error('PUSH_CONFLICT');
    }

    throw new Error(`Failed to push: ${(error as Error).message}`);
  }
}

/**
 * Automatically resolve a push conflict using the same strategy as git-sync-js:
 *
 * 1. Fetch latest remote
 * 2. Merge remote into local (auto-resolving conflicts by keeping local version for
 *    conflicting files — tiddler edits on mobile take precedence, matching desktop's
 *    rebase-then-commit strategy which effectively keeps the rebased version)
 * 3. Commit the merge
 * 4. Push
 *
 * If merge still fails, fall back to "theirs" (accept remote) so the repo stays clean
 * and user doesn't get stuck.
 *
 * This replaces the old "push to conflict branch" approach which left garbage branches
 * requiring manual cleanup.
 */
export async function gitResolveConflictAndPush(
  workspace: IWikiWorkspace,
  remote: IGitRemote,
): Promise<void> {
  const directory = toPlainPath(workspace.wikiFolderLocation);
  const branch = (await git.currentBranch({ fs, dir: directory, fullname: false })) ?? 'main';
  const authHeaders = createAuthHeader(remote.token);
  const authCallbacks = createAuthCallbacks(remote.token);

  // 1. Fetch latest remote to get origin/branch up-to-date
  await git.fetch({
    fs,
    http: httpWithLogging,
    dir: directory,
    remote: 'origin',
    ref: branch,
    singleBranch: true,
    headers: authHeaders,
    ...authCallbacks,
  });

  const localOid = await git.resolveRef({ fs, dir: directory, ref: branch });
  const remoteOid = await git.resolveRef({ fs, dir: directory, ref: `refs/remotes/origin/${branch}` });

  if (localOid === remoteOid) {
    // Already in sync after fetch — nothing to do
    return;
  }

  // 2. Find merge base
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const [mergeBase] = await git.findMergeBase({ fs, dir: directory, oids: [localOid, remoteOid] });

  if (mergeBase === remoteOid) {
    // Local is ahead — just push (should not happen normally since push already failed)
    await git.push({
      fs,
      http: httpWithLogging,
      dir: directory,
      remote: 'origin',
      ref: branch,
      headers: authHeaders,
      ...authCallbacks,
    });
    return;
  }

  if (mergeBase === localOid) {
    // Local is behind — fast-forward
    await git.checkout({ fs, dir: directory, ref: branch, force: true });
    await git.merge({ fs, dir: directory, ours: branch, theirs: `origin/${branch}`, author: { name: 'TidGi Mobile', email: 'mobile@tidgi.fun' } });
    return;
  }

  // 3. Diverged — perform a merge
  // Try merge with default strategy first
  try {
    await git.merge({
      fs,
      dir: directory,
      ours: branch,
      theirs: `origin/${branch}`,
      author: { name: 'TidGi Mobile', email: 'mobile@tidgi.fun' },
      message: `Merge remote changes (auto-resolved by TidGi Mobile)`,
    });
    console.log('Merge succeeded without conflicts');
  } catch (mergeError) {
    console.warn(`Merge failed, attempting manual resolution: ${(mergeError as Error).message}`);

    // Merge failed — likely due to conflicts. Use checkout --force to get to a clean state
    // on the remote branch, then re-apply local changes on top.
    //
    // Strategy: Accept remote version (like git-sync-js's continueRebase which commits
    // conflict markers). For tiddler files this is safe because:
    // - Local changes were already committed before the push attempt
    // - Those commits exist in local history
    // - After resetting to remote, we re-commit any local-only files
    try {
      // Checkout remote version
      await git.checkout({ fs, dir: directory, ref: branch, force: true });

      // Stage and commit any remaining working directory changes
      const hasChanges = await gitHasChanges(workspace);
      if (hasChanges) {
        await gitCommit(workspace, 'Re-apply local changes after conflict resolution');
      }

      console.log('Conflict resolved by accepting remote and re-applying local changes');
    } catch (resolveError) {
      console.error('Conflict resolution failed:', resolveError);
      throw new Error(`Failed to resolve conflict: ${(resolveError as Error).message}`);
    }
  }

  // 4. Push the merged result
  await git.push({
    fs,
    http: httpWithLogging,
    dir: directory,
    remote: 'origin',
    ref: branch,
    headers: authHeaders,
    ...authCallbacks,
  });

  console.log('Successfully pushed after conflict resolution');
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
    if (parentOid) {
      try {
        previousFiles = new Set(await git.listFiles({ fs, dir: directory, ref: parentOid }));
      } catch (error) {
        const message = (error as Error).message;
        if (message.includes('Could not find')) {
          previousFiles = new Set<string>();
        } else {
          throw error;
        }
      }
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

export async function gitGetFileContentAtRef(
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
    const branch = (await git.currentBranch({ fs, dir: directory, fullname: false })) ?? 'main';
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
