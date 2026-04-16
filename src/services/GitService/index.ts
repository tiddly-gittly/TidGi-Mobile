/**
 * Git operations for TidGi-Mobile using native JGit (Android) / libgit2 (iOS, future).
 *
 * ALL git operations are delegated to the native module (ExternalStorage).
 * No isomorphic-git, no JS-side git FS adapter needed.
 */

import { Buffer } from 'buffer';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { ExternalStorage, toPlainPath } from 'expo-tiddlywiki-filesystem-android-external-storage';
import pTimeout from 'p-timeout';
import { IWikiWorkspace } from '../../store/workspace';

// ── Types ──────────────────────────────────────────────────────────

export interface IGitRemote {
  baseUrl: string;
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

export interface IGitFileContent {
  dataUri?: string;
  kind: 'binary' | 'image' | 'missing' | 'text';
  text?: string;
}

// ── Error sentinels ────────────────────────────────────────────────

export const GIT_CLONE_ERROR_OOM = 'WIKI_OOM';
export const GIT_CLONE_ERROR_TOO_LARGE_PREFIX = 'WIKI_TOO_LARGE:';
export const GIT_CLONE_ERROR_CONNECTION_ABORT = 'WIKI_CONNECTION_ABORT';

function isOOMError(message: string): boolean {
  return (
    message.includes('Failed to allocate') ||
    message.includes('OutOfMemoryError') ||
    message.includes('growth limit') ||
    /out of memory/i.test(message)
  );
}

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

// ── Constants ──────────────────────────────────────────────────────

const CLONE_MAX_RETRIES = 2;
const CLONE_RETRY_DELAY_MS = 3_000;
const MAX_SAFE_PACK_BYTES = 80 * 1024 * 1024;
const DEFAULT_TIDGI_TOKEN_AUTH_HEADER_PREFIX = 'x-tidgi-auth-token';
const DEFAULT_TIDGI_USER_NAME = 'TidGi User';

// ── Helpers ────────────────────────────────────────────────────────

function isExternalPath(filepath: string): boolean {
  const plain = toPlainPath(filepath.replace(/^file:\/(?!\/\/)/, 'file:///').replace(/^file:\/\/\//, '/'));
  return plain.startsWith('/storage/') || plain.startsWith('/sdcard/');
}

function toFileUri(plainPath: string): string {
  const uri = plainPath.startsWith('file://') ? plainPath : `file://${plainPath}`;
  try {
    return encodeURI(decodeURI(uri));
  } catch {
    return encodeURI(uri);
  }
}

function parseNativeResult<T>(json: string): T {
  return JSON.parse(json) as T;
}

function createAuthHeader(remote: Pick<IGitRemote, 'token' | 'tokenAuthHeaderName' | 'tokenAuthHeaderValue'>): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {
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

function normalizeHeaders(headers: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined)) as Record<string, string>;
}

function headersToJson(remote: IGitRemote): string | null {
  const headers = normalizeHeaders(createAuthHeader(remote));
  return Object.keys(headers).length > 0 ? JSON.stringify(headers) : null;
}

async function getCurrentBranch(directory: string): Promise<string> {
  try {
    const json = await ExternalStorage.gitCurrentBranch(directory);
    const result = parseNativeResult<{
      ok: boolean;
      branch?: string;
      isDetached?: boolean;
      localBranches?: string[];
      remoteBranches?: string[];
      error?: string;
    }>(json);
    if (result.ok && result.branch && result.branch.length > 0) {
      return result.branch;
    }
    if (result.ok) {
      if (result.localBranches?.includes('main')) return 'main';
      if (result.localBranches?.includes('master')) return 'master';
      if (result.localBranches && result.localBranches.length > 0) return result.localBranches[0];
      for (const rb of result.remoteBranches ?? []) {
        const name = rb.replace(/^origin\//, '');
        if (name === 'main' || name === 'master') return name;
      }
    }
  } catch (error) {
    console.warn(`[getCurrentBranch] native failed: ${(error as Error).message}`);
  }
  return 'main';
}

async function tryGetRemotePackSize(repoUrl: string, headers: Record<string, string>): Promise<number | null> {
  try {
    const sizeUrl = `${repoUrl}/pack-size`;
    const response = await pTimeout(fetch(sizeUrl, { method: 'GET', headers }), {
      milliseconds: 5_000,
      message: new Error('pack-size check timeout'),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { estimatedBytes?: number };
    return typeof data.estimatedBytes === 'number' ? data.estimatedBytes : null;
  } catch {
    return null;
  }
}

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

function deduplicateNFC(
  rawChanges: Array<{ path: string; type: 'add' | 'modify' | 'delete' }>,
): Array<{ path: string; type: 'add' | 'modify' | 'delete' }> {
  if (rawChanges.length === 0) return rawChanges;
  const deletesByNFC = new Set<string>();
  const addsByNFC = new Set<string>();
  for (const change of rawChanges) {
    const nfcPath = change.path.normalize('NFC');
    if (change.type === 'delete') deletesByNFC.add(nfcPath);
    else if (change.type === 'add') addsByNFC.add(nfcPath);
  }
  const artifactPaths = new Set([...deletesByNFC].filter(p => addsByNFC.has(p)));
  return rawChanges.filter(c => !artifactPaths.has(c.path.normalize('NFC')));
}

// ── File content helpers ───────────────────────────────────────────

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
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.bmp': return 'image/bmp';
    case '.svg': return 'image/svg+xml';
    default: return 'image/png';
  }
}

function isTextFile(filePath: string): boolean {
  return TEXT_FILE_EXTENSIONS.has(getFileExtension(filePath));
}

function isImageFile(filePath: string): boolean {
  return IMAGE_FILE_EXTENSIONS.has(getFileExtension(filePath));
}

// ── Clone ──────────────────────────────────────────────────────────

export async function gitClone(
  workspace: IWikiWorkspace,
  remote: IGitRemote,
  onProgress?: (phase: string, loaded: number, total: number) => void,
): Promise<void> {
  const baseUrl = remote.baseUrl.replace(/\/$/, '');
  const url = `${baseUrl}/tw-mobile-sync/git/${remote.workspaceId}`;
  const directory = toPlainPath(workspace.wikiFolderLocation);

  console.log('Git clone URL:', url);
  console.log('Git clone directory:', directory);

  // Fast path: tar archive download (TidGi Desktop only)
  if (typeof ExternalStorage.extractTar === 'function') {
    try {
      const didArchive = await tryArchiveClone(remote, url, directory, onProgress);
      if (didArchive) { console.log('[gitClone] Fast archive clone succeeded'); return; }
    } catch (error) {
      const message = (error as Error).message;
      if (isConnectionAbortError(message)) {
        console.warn('[gitClone] Archive download interrupted:', message);
      } else {
        console.warn('[gitClone] Archive clone failed, falling back to native git clone:', message);
      }
    }
  }

  // Native JGit clone
  console.log('Git clone strategy: native JGit');
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= CLONE_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.log(`[gitClone] Retry attempt ${attempt}/${CLONE_MAX_RETRIES}`);
      onProgress?.('Reconnecting…', attempt, CLONE_MAX_RETRIES);
      await new Promise<void>(resolve => setTimeout(resolve, CLONE_RETRY_DELAY_MS));
      try {
        if (isExternalPath(directory)) {
          const info = await ExternalStorage.getInfo(directory);
          if (info.exists) await ExternalStorage.rmdir(directory);
          await ExternalStorage.mkdir(directory);
        } else {
          await FileSystemLegacy.deleteAsync(toFileUri(directory), { idempotent: true });
          await FileSystemLegacy.makeDirectoryAsync(toFileUri(directory), { intermediates: true });
        }
      } catch (cleanupError) {
        console.warn('[gitClone] Failed to clean directory before retry:', cleanupError);
      }
    }
    try {
      await gitCloneNative(remote, url, directory, onProgress);
      return;
    } catch (error) {
      lastError = error as Error;
      const message = lastError.message;
      if (isConnectionAbortError(message) && attempt < CLONE_MAX_RETRIES) continue;
      throw error;
    }
  }
  throw lastError ?? new Error('Git clone failed');
}

async function gitCloneNative(
  remote: IGitRemote, url: string, directory: string,
  onProgress?: (phase: string, loaded: number, total: number) => void,
): Promise<void> {
  try {
    const headers = normalizeHeaders(createAuthHeader(remote));
    await preflightInfoReferences(url, headers);
    const estimatedBytes = await tryGetRemotePackSize(url, headers);
    if (estimatedBytes !== null) {
      const estimatedMB = Math.round(estimatedBytes / 1024 / 1024);
      console.log(`Git clone estimated pack size: ${estimatedMB} MB`);
      onProgress?.(`Estimated size: ${estimatedMB} MB`, 0, estimatedBytes);
      if (estimatedBytes > MAX_SAFE_PACK_BYTES) {
        throw new Error(`${GIT_CLONE_ERROR_TOO_LARGE_PREFIX}${estimatedMB}`);
      }
    }
    onProgress?.('Cloning repository…', 0, 0);
    const resultJson = await ExternalStorage.gitClone(url, directory, null, 1, true, true, JSON.stringify(headers));
    const result = parseNativeResult<{ ok: boolean; head?: string; error?: string }>(resultJson);
    if (!result.ok) throw new Error(result.error ?? 'Native git clone failed');
    console.log(`Successfully cloned repository to ${directory}, HEAD=${result.head}`);
    onProgress?.('Clone complete', 1, 1);
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith(GIT_CLONE_ERROR_TOO_LARGE_PREFIX) || message === GIT_CLONE_ERROR_OOM) throw error;
    if (isOOMError(message)) throw new Error(GIT_CLONE_ERROR_OOM);
    if (isConnectionAbortError(message)) throw new Error(GIT_CLONE_ERROR_CONNECTION_ABORT);
    throw new Error(`Failed to clone repository: ${message}`);
  }
}

// ── Archive clone ──────────────────────────────────────────────────

async function tryArchiveClone(
  remote: IGitRemote, gitUrl: string, directory: string,
  onProgress?: (phase: string, loaded: number, total: number) => void,
): Promise<boolean> {
  const archiveUrl = `${gitUrl}/full-archive`;
  const headers = normalizeHeaders(createAuthHeader(remote));
  headers['Accept-Encoding'] = 'identity';
  const tarPath = `${directory}.tar`;
  console.log('[archiveClone] Attempting full-archive download:', archiveUrl);
  onProgress?.('Downloading archive…', 0, 0);

  if (typeof ExternalStorage.downloadFileResumable !== 'function' || typeof ExternalStorage.extractTar !== 'function') return false;

  const downloadResult = await ExternalStorage.downloadFileResumable(archiveUrl, headers, tarPath);
  console.log('[archiveClone] Download result:', downloadResult);

  if (downloadResult.statusCode === 404) {
    try { await ExternalStorage.deleteFile(tarPath); } catch { /* ignore */ }
    return false;
  }
  if (downloadResult.statusCode !== 200 && downloadResult.statusCode !== 206) {
    try { await ExternalStorage.deleteFile(tarPath); } catch { /* ignore */ }
    return false;
  }

  console.log('[archiveClone] Extracting archive…');
  onProgress?.('Extracting files…', 0, 0);
  try {
    if (isExternalPath(directory)) {
      const info = await ExternalStorage.getInfo(directory);
      if (info.exists) await ExternalStorage.rmdir(directory);
      await ExternalStorage.mkdir(directory);
    } else {
      await FileSystemLegacy.deleteAsync(toFileUri(directory), { idempotent: true });
      await FileSystemLegacy.makeDirectoryAsync(toFileUri(directory), { intermediates: true });
    }
  } catch { /* directory might not exist yet */ }

  const extractResult = await ExternalStorage.extractTar(tarPath, directory);
  console.log('[archiveClone] Extracted', extractResult.filesExtracted, 'files');
  onProgress?.('Extracted files', extractResult.filesExtracted, extractResult.filesExtracted);
  try { await ExternalStorage.deleteFile(tarPath); } catch { /* ignore */ }

  await configureGitRemote(directory, remote);

  console.log('[archiveClone] Rebuilding .git/index…');
  onProgress?.('Building git index…', 0, 0);
  try {
    const indexResult = parseNativeResult<{ ok: boolean; entries?: number; error?: string }>(await ExternalStorage.buildGitIndex(directory));
    if (indexResult.ok) console.log(`[archiveClone] .git/index rebuilt: ${indexResult.entries} entries`);
    else console.warn(`[archiveClone] buildGitIndex failed: ${indexResult.error}`);
  } catch (error) {
    console.warn('[archiveClone] Failed to rebuild .git/index:', (error as Error).message);
  }
  return true;
}

async function configureGitRemote(directory: string, remote: IGitRemote): Promise<void> {
  const baseUrl = remote.baseUrl.replace(/\/$/, '');
  const remoteUrl = `${baseUrl}/tw-mobile-sync/git/${remote.workspaceId}`;
  try {
    const result = parseNativeResult<{ ok: boolean; error?: string }>(
      await ExternalStorage.gitSetConfig(directory, 'remote', 'origin', 'url', remoteUrl),
    );
    if (result.ok) {
      console.log('[configureGitRemote] Set remote origin to:', remoteUrl);
      await ExternalStorage.gitSetConfig(directory, 'remote', 'origin', 'fetch', '+refs/heads/*:refs/remotes/origin/*');
    } else {
      throw new Error(result.error ?? 'setConfig failed');
    }
  } catch (error) {
    console.warn('[configureGitRemote] Failed, writing config directly:', (error as Error).message);
    const configPath = `${directory}/.git/config`;
    const configContent = '[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = false\n[remote "origin"]\n\turl = ' + remoteUrl + '\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n';
    if (isExternalPath(directory)) {
      await ExternalStorage.writeFileUtf8(configPath, configContent);
    } else {
      await FileSystemLegacy.writeAsStringAsync(toFileUri(configPath), configContent);
    }
  }
}

// ── Commit ─────────────────────────────────────────────────────────

export async function gitCommit(workspace: IWikiWorkspace, message: string): Promise<string> {
  const directory = toPlainPath(workspace.wikiFolderLocation);
  try {
    console.log(`[gitCommit] using native gitAddAndCommit for ${directory}`);
    const resultJson = await ExternalStorage.gitAddAndCommit(directory, message, 'TidGi Mobile', 'mobile@tidgi.fun');
    const result = parseNativeResult<{ ok: boolean; commitId?: string; message?: string; error?: string }>(resultJson);
    if (!result.ok) throw new Error(`Native git commit failed: ${result.error ?? 'unknown'}`);
    if (result.commitId === '') { console.log(`[gitCommit] nothing to commit`); return ''; }
    console.log(`Committed changes (native): ${result.commitId}`);
    return result.commitId ?? '';
  } catch (error) {
    console.error(`Git commit failed: ${(error as Error).message}`);
    throw new Error(`Failed to commit: ${(error as Error).message}`);
  }
}

// ── Push ───────────────────────────────────────────────────────────

/**
 * Ensure git config has protocol.version=0 and low-memory pack settings.
 * - protocol.version=0: TidGi Desktop's git server only speaks V0/V1.
 * - pack.*: Limit memory for Android's ~268MB heap. JGit defaults
 *   (50MB delta cache, unlimited window memory) cause OOM on large repos.
 * These are set via gitSetConfig (JS-side) so changes take effect
 * immediately without rebuilding the native APK.
 */
async function ensureGitConfigForMobile(directory: string): Promise<void> {
  const settings: Array<[string, string | null, string, string]> = [
    ['protocol', null, 'version', '0'],
    // Disable delta compression entirely — mobile only pushes small changes,
    // and delta search over large object stores causes OOM.
    ['pack', null, 'window', '2'],
    ['pack', null, 'depth', '0'],
    ['pack', null, 'windowmemory', String(5 * 1024 * 1024)], // 5MB
    ['pack', null, 'deltacachesize', '1'], // effectively disabled
    ['pack', null, 'deltacachelimit', '1'], // 1 byte = disabled
    ['pack', null, 'threads', '1'],
    ['pack', null, 'bigfilethreshold', String(1 * 1024 * 1024)], // 1MB
    // core.streamFileThreshold: objects larger than this are streamed
    ['core', null, 'streamfilethreshold', String(5 * 1024 * 1024)], // 5MB
  ];
  for (const [section, subsection, name, value] of settings) {
    try {
      await ExternalStorage.gitSetConfig(directory, section, subsection, name, value);
    } catch (error) {
      console.warn(`[ensureGitConfig] Failed to set ${section}.${name}=${value}:`, (error as Error).message);
    }
  }
  console.log('[ensureGitConfig] Applied mobile git config settings');
}

export async function gitPushToIncoming(
  workspace: IWikiWorkspace, remote: IGitRemote,
  _onProgress?: (phase: string, loaded: number, total: number) => void,
): Promise<void> {
  const directory = toPlainPath(workspace.wikiFolderLocation);
  await ensureGitConfigForMobile(directory);
  const branch = await getCurrentBranch(directory);
  const headersJson = headersToJson(remote);

  // Use bundle-based push to avoid JGit's HTTP push protocol bug:
  // SmartHttpPushConnection's MultiRequestService throws
  // "Starting read stage without written request data pending is not supported"
  // because it doesn't mark finalRequest=true for push operations.
  //
  // Instead: JGit BundleWriter creates a git bundle locally, then we
  // HTTP POST it to desktop's /receive-bundle endpoint.
  console.log(`[gitPushToIncoming] creating git bundle for ${directory}`);
  const bundleResultJson = await ExternalStorage.gitCreateBundle(directory, 'origin', branch, branch);
  const bundleResult = parseNativeResult<{ ok: boolean; bundle?: string; bundleSize?: number; error?: string }>(bundleResultJson);
  if (!bundleResult.ok) throw new Error(`Git bundle creation failed: ${bundleResult.error ?? 'unknown'}`);
  console.log(`[gitPushToIncoming] bundle created: ${bundleResult.bundleSize} bytes`);

  // POST bundle to desktop's receive-bundle endpoint (send as base64 text, desktop will decode)
  const url = `${remote.baseUrl.replace(/\/$/, '')}/tw-mobile-sync/git/${remote.workspaceId}/receive-bundle`;
  const headers = normalizeHeaders(createAuthHeader(remote));
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/x-git-bundle-base64' },
    body: bundleResult.bundle!,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Desktop receive-bundle failed (${response.status}): ${body}`);
  }
  console.log('[gitPushToIncoming] bundle uploaded successfully, triggering merge');
}

// ── Merge trigger ──────────────────────────────────────────────────

export async function triggerDesktopMerge(remote: IGitRemote): Promise<void> {
  const url = `${remote.baseUrl.replace(/\/$/, '')}/tw-mobile-sync/git/${remote.workspaceId}/merge-incoming`;
  const headers = normalizeHeaders(createAuthHeader(remote));
  const response = await fetch(url, { method: 'POST', headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Desktop merge failed (${response.status}): ${body}`);
  }
  console.log('Desktop merge-incoming completed');
}

// ── Fetch + Reset ──────────────────────────────────────────────────

/**
 * Fetch from desktop using bundle protocol (private protocol).
 *
 * Instead of JGit's HTTP git-upload-pack (which triggers the "Starting read stage"
 * bug on multi-request transport), we:
 * 1. Ask desktop to create a bundle containing commits we don't have
 * 2. Download the bundle (base64-encoded)
 * 3. Write it to .git/incoming.bundle
 * 4. JGit fetches from the local bundle file (no HTTP transport issues)
 *
 * Standard git services (GitHub, etc.) do NOT implement the create-bundle endpoint.
 */
export async function gitFetchAndReset(
  workspace: IWikiWorkspace, remote: IGitRemote,
  _onProgress?: (phase: string, loaded: number, total: number) => void,
): Promise<boolean> {
  const directory = toPlainPath(workspace.wikiFolderLocation);
  const branch = await getCurrentBranch(directory);

  const headBeforeResult = parseNativeResult<{ ok: boolean; oid?: string }>(
    await ExternalStorage.gitResolveRef(directory, 'HEAD'),
  );
  const headBefore = headBeforeResult.ok ? (headBeforeResult.oid ?? '') : '';

  await ensureGitConfigForMobile(directory);

  // Request a bundle from the desktop containing commits we don't have
  const bundleUrl = `${remote.baseUrl}/tw-mobile-sync/git/${remote.workspaceId}/create-bundle`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/x-git-bundle-base64',
  };
  if (remote.token) {
    headers['Authorization'] = `Bearer ${remote.token}`;
  }

  console.log(`[gitFetchAndReset] requesting bundle from desktop, have=${headBefore.slice(0, 8)}`);
  const bundleResponse = await fetch(bundleUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ have: headBefore }),
  });

  if (bundleResponse.status === 204) {
    console.log('[gitFetchAndReset] desktop says already up-to-date');
    return false;
  }

  if (!bundleResponse.ok) {
    const errorText = await bundleResponse.text();
    throw new Error(`Desktop create-bundle failed (${bundleResponse.status}): ${errorText}`);
  }

  const bundleBase64 = await bundleResponse.text();
  const desktopHead = bundleResponse.headers.get('X-Git-Bundle-Head') ?? '';
  console.log(`[gitFetchAndReset] received bundle: ${bundleBase64.length} chars base64, desktopHead=${desktopHead.slice(0, 8)}`);

  // Write bundle to .git/incoming.bundle
  const bundleBytes = Uint8Array.from(atob(bundleBase64), c => c.charCodeAt(0));
  const bundlePath = `${directory}/.git/incoming.bundle`;
  if (isExternalPath(directory)) {
    await ExternalStorage.writeFileBase64(bundlePath, bundleBase64);
  } else {
    await FileSystemLegacy.writeAsStringAsync(toFileUri(bundlePath), bundleBase64, { encoding: FileSystemLegacy.EncodingType.Base64 });
  }

  // Fetch from the local bundle file using JGit
  console.log(`[gitFetchAndReset] JGit fetch from local bundle`);
  const fetchResultJson = await ExternalStorage.gitFetchFromBundle(directory, 'incoming.bundle', branch);
  const fetchResult = parseNativeResult<{ ok: boolean; updates?: unknown[]; error?: string }>(fetchResultJson);
  if (!fetchResult.ok) throw new Error(`Bundle fetch failed: ${fetchResult.error ?? 'unknown'}`);
  console.log(`[gitFetchAndReset] bundle fetch succeeded: ${JSON.stringify(fetchResult.updates)}`);

  const remoteRefResult = parseNativeResult<{ ok: boolean; oid?: string }>(
    await ExternalStorage.gitResolveRef(directory, `refs/remotes/origin/${branch}`),
  );
  const remoteOid = remoteRefResult.ok ? (remoteRefResult.oid ?? '') : '';

  if (remoteOid === headBefore) return false;

  console.log(`[gitFetchAndReset] checking out changed files ${headBefore.slice(0, 8)}..${remoteOid.slice(0, 8)}`);
  const checkoutResultJson = await ExternalStorage.gitCheckoutChangedFiles(directory, headBefore, remoteOid);
  const checkoutResult = parseNativeResult<{ ok: boolean; count?: number; files?: string[]; error?: string }>(checkoutResultJson);
  if (checkoutResult.ok) console.log(`[gitFetchAndReset] checked out ${checkoutResult.count} changed files`);
  else console.warn(`[gitFetchAndReset] gitCheckoutChangedFiles failed: ${checkoutResult.error}`);

  console.log(`[gitFetchAndReset] resetting to origin/${branch}`);
  const resetResultJson = await ExternalStorage.gitReset(directory, `origin/${branch}`, 'mixed');
  const resetResult = parseNativeResult<{ ok: boolean; ref?: string; error?: string }>(resetResultJson);
  if (resetResult.ok) {
    console.log(`[gitFetchAndReset] reset succeeded: ${resetResult.ref}`);
  } else {
    console.warn(`[gitFetchAndReset] gitReset failed: ${resetResult.error}`);
    const refContent = `${remoteOid}\n`;
    if (isExternalPath(directory)) {
      await ExternalStorage.writeFileUtf8(`${directory}/.git/refs/heads/${branch}`, refContent);
    } else {
      await FileSystemLegacy.writeAsStringAsync(toFileUri(`${directory}/.git/refs/heads/${branch}`), refContent);
    }
    try { await ExternalStorage.buildGitIndex(directory); }
    catch (error) { console.warn(`[gitFetchAndReset] buildGitIndex failed: ${(error as Error).message}`); }
  }
  return true;
}

// ── Resolve reference ──────────────────────────────────────────────

export async function gitResolveReference(workspace: IWikiWorkspace, reference: string): Promise<string> {
  try {
    const result = parseNativeResult<{ ok: boolean; oid?: string; error?: string }>(
      await ExternalStorage.gitResolveRef(toPlainPath(workspace.wikiFolderLocation), reference),
    );
    return result.ok ? (result.oid ?? '') : '';
  } catch (error) {
    console.error(`Failed to resolve ${reference}: ${String(error)}`);
    return '';
  }
}

// ── Diff changed files ─────────────────────────────────────────────

export async function gitDiffChangedFiles(workspace: IWikiWorkspace): Promise<Array<{ path: string; type: 'add' | 'modify' | 'delete' }>> {
  const directory = toPlainPath(workspace.wikiFolderLocation);
  console.log(`${new Date().toISOString()} [GitService] gitDiffChangedFiles starting for ${workspace.id}, dir=${directory}`);
  try {
    const startedAt = Date.now();
    const jsonString = await ExternalStorage.gitStatus(directory);
    const rawChanges = JSON.parse(jsonString) as Array<{ path: string; type: 'add' | 'modify' | 'delete' }>;
    console.log(`${new Date().toISOString()} [GitService] native gitStatus raw count=${rawChanges.length}`);
    if (rawChanges.length === 0) {
      console.log(`${new Date().toISOString()} [GitService] gitDiffChangedFiles took ${Date.now() - startedAt}ms, count=0`);
      return [];
    }
    const deduped = deduplicateNFC(rawChanges);
    console.log(`${new Date().toISOString()} [GitService] gitDiffChangedFiles took ${Date.now() - startedAt}ms, count=${deduped.length}`);
    return deduped.sort((a, b) => a.path.localeCompare(b.path));
  } catch (error) {
    console.error(`Failed to diff: ${(error as Error).message}`);
    return [];
  }
}

// ── Commit history ─────────────────────────────────────────────────

export async function gitGetCommitHistory(workspace: IWikiWorkspace, depth = 100): Promise<IGitCommitInfo[]> {
  const directory = toPlainPath(workspace.wikiFolderLocation);
  try {
    const resultJson = await ExternalStorage.gitLog(directory, null, depth);
    const result = parseNativeResult<{
      ok: boolean;
      commits?: Array<{ oid: string; message: string; authorName: string; authorEmail: string; timestamp: number; parentOids: string[] }>;
      error?: string;
    }>(resultJson);
    if (!result.ok || !result.commits) { console.warn(`[gitGetCommitHistory] failed: ${result.error}`); return []; }
    return result.commits.map(c => ({
      oid: c.oid, message: c.message, authorName: c.authorName,
      authorEmail: c.authorEmail, timestamp: c.timestamp, parentOids: c.parentOids,
    }));
  } catch (error) {
    console.error(`Failed to read git history: ${(error as Error).message}`);
    return [];
  }
}

// ── Ahead commit count ─────────────────────────────────────────────

/**
 * Get the set of commit OIDs that exist on the remote tracking branch (origin/<branch>).
 * Used by the commit history UI to mark which commits have been pushed.
 *
 * Git tracks this via the remote tracking ref `origin/<branch>`. After a successful
 * fetch or push, git updates this ref to point to the remote's branch tip. Any local
 * commit whose OID appears in the remote branch's history has been synced to at least
 * one desktop remote.
 */
export async function gitGetRemoteOids(workspace: IWikiWorkspace, depth = 300): Promise<Set<string>> {
  const directory = toPlainPath(workspace.wikiFolderLocation);
  try {
    const branch = await getCurrentBranch(directory);
    const remoteResult = parseNativeResult<{ ok: boolean; commits?: Array<{ oid: string }> }>(
      await ExternalStorage.gitLog(directory, `origin/${branch}`, depth),
    );
    const remoteCommits = remoteResult.ok ? (remoteResult.commits ?? []) : [];
    return new Set(remoteCommits.map(c => c.oid));
  } catch {
    return new Set();
  }
}

export async function gitGetAheadCommitCount(workspace: IWikiWorkspace): Promise<number> {
  const directory = toPlainPath(workspace.wikiFolderLocation);
  if (typeof workspace.deferStatusScanUntil === 'number' && Date.now() < workspace.deferStatusScanUntil) return 0;
  try {
    const branch = await getCurrentBranch(directory);
    let localResult = parseNativeResult<{ ok: boolean; commits?: Array<{ oid: string }>; error?: string }>(
      await ExternalStorage.gitLog(directory, branch, 300),
    );
    if (!localResult.ok || !localResult.commits) {
      localResult = parseNativeResult(await ExternalStorage.gitLog(directory, 'HEAD', 300));
    }
    const localCommits = localResult.ok ? (localResult.commits ?? []) : [];
    const remoteResult = parseNativeResult<{ ok: boolean; commits?: Array<{ oid: string }> }>(
      await ExternalStorage.gitLog(directory, `origin/${branch}`, 300),
    );
    const remoteCommits = remoteResult.ok ? (remoteResult.commits ?? []) : [];
    const remoteOids = new Set(remoteCommits.map(c => c.oid));
    let aheadCount = 0;
    for (const commit of localCommits) {
      if (remoteOids.has(commit.oid)) break;
      aheadCount += 1;
    }
    return aheadCount;
  } catch (error) {
    console.error(`Failed to get ahead commit count: ${(error as Error).message}`);
    return 0;
  }
}

// ── Changed files for commit ───────────────────────────────────────

export async function gitGetChangedFilesForCommit(
  workspace: IWikiWorkspace, commitOid: string, parentOid?: string,
): Promise<IGitCommitFileDiffResult> {
  const directory = toPlainPath(workspace.wikiFolderLocation);
  try {
    if (!parentOid) return { files: [], isShallowSnapshot: false };
    const parentResult = parseNativeResult<{ ok: boolean; error?: string }>(
      await ExternalStorage.gitResolveRef(directory, parentOid),
    );
    if (!parentResult.ok) return { files: [], isShallowSnapshot: true };
    const diffResultJson = await ExternalStorage.gitDiffTrees(directory, parentOid, commitOid);
    const diffResult = parseNativeResult<{
      ok: boolean; files?: Array<{ path: string; type: 'add' | 'modify' | 'delete' }>; error?: string;
    }>(diffResultJson);
    if (!diffResult.ok || !diffResult.files) {
      console.warn(`[gitGetChangedFilesForCommit] native diff failed: ${diffResult.error}`);
      return { files: [], isShallowSnapshot: false };
    }
    return { files: diffResult.files.sort((a, b) => a.path.localeCompare(b.path)), isShallowSnapshot: false };
  } catch (error) {
    console.warn(`Failed to read changed files for commit ${commitOid}: ${(error as Error).message}`);
    throw error;
  }
}

// ── File content at reference ──────────────────────────────────────

export async function gitGetFileContentAtReference(
  workspace: IWikiWorkspace, filePath: string, reference?: string,
): Promise<IGitFileContent> {
  const directory = toPlainPath(workspace.wikiFolderLocation);
  try {
    if (!reference) return await readWorkingTreeFile(directory, filePath);
    const isImage = isImageFile(filePath);
    const resultJson = await ExternalStorage.gitReadBlob(directory, reference, filePath, isImage);
    const result = parseNativeResult<{
      ok: boolean; content?: string; encoding?: 'base64' | 'utf8'; size?: number; error?: string;
    }>(resultJson);
    if (!result.ok || result.content === undefined) return { kind: 'missing' };
    if (isImage) {
      return { kind: 'image', dataUri: `data:${getImageMimeType(filePath)};base64,${result.content}` };
    }
    if (isTextFile(filePath)) {
      const text = result.encoding === 'base64'
        ? Buffer.from(result.content, 'base64').toString('utf-8')
        : result.content;
      return { kind: 'text', text };
    }
    return { kind: 'binary' };
  } catch (error) {
    console.warn(`Failed to read file content for ${filePath} at ${reference ?? 'working-tree'}: ${(error as Error).message}`);
    return { kind: 'missing' };
  }
}

async function readWorkingTreeFile(directory: string, filePath: string): Promise<IGitFileContent> {
  const fullPath = `${directory}/${filePath}`;
  try {
    if (isImageFile(filePath)) {
      let base64: string;
      if (isExternalPath(directory)) {
        base64 = await ExternalStorage.readFileBase64(fullPath);
      } else {
        base64 = await FileSystemLegacy.readAsStringAsync(toFileUri(fullPath), { encoding: FileSystemLegacy.EncodingType.Base64 });
      }
      return { kind: 'image', dataUri: `data:${getImageMimeType(filePath)};base64,${base64}` };
    }
    if (isTextFile(filePath)) {
      let text: string;
      if (isExternalPath(directory)) {
        text = await ExternalStorage.readFileUtf8(fullPath);
      } else {
        text = await FileSystemLegacy.readAsStringAsync(toFileUri(fullPath), { encoding: FileSystemLegacy.EncodingType.UTF8 });
      }
      return { kind: 'text', text };
    }
    return { kind: 'binary' };
  } catch {
    return { kind: 'missing' };
  }
}

// ── Has changes ────────────────────────────────────────────────────

export async function gitHasChanges(workspace: IWikiWorkspace): Promise<boolean> {
  const directory = toPlainPath(workspace.wikiFolderLocation);
  try {
    const jsonString = await ExternalStorage.gitStatus(directory);
    const rawChanges = JSON.parse(jsonString) as Array<{ path: string; type: string }>;
    return rawChanges.length > 0;
  } catch (error) {
    console.error(`Failed to check git status: ${(error as Error).message}`);
    throw new Error(`Cannot determine git status: ${(error as Error).message}`);
  }
}

// ── Unsynced commit count ──────────────────────────────────────────

export async function gitGetUnsyncedCommitCount(workspace: IWikiWorkspace): Promise<number> {
  const directory = toPlainPath(workspace.wikiFolderLocation);
  if (typeof workspace.deferStatusScanUntil === 'number' && Date.now() < workspace.deferStatusScanUntil) return 0;
  try {
    const aheadCount = await gitGetAheadCommitCount(workspace);
    const hasUncommittedChanges = await gitHasChanges(workspace).catch(() => false);
    return aheadCount + (hasUncommittedChanges ? 1 : 0);
  } catch (error) {
    console.error(`Failed to get unsynced commit count: ${(error as Error).message}`);
    return 0;
  }
}

// ── Discard file changes ───────────────────────────────────────────

export async function gitDiscardFileChanges(workspace: IWikiWorkspace, filePath: string): Promise<void> {
  const directory = toPlainPath(workspace.wikiFolderLocation);
  try {
    const resultJson = await ExternalStorage.gitDiscardFileChanges(directory, filePath);
    const result = parseNativeResult<{ ok: boolean; action?: string; error?: string }>(resultJson);
    if (!result.ok) throw new Error(result.error ?? 'Unknown error');
    console.log(`Discarded changes for ${filePath} (${result.action})`);
  } catch (error) {
    console.error(`Failed to discard changes for ${filePath}: ${(error as Error).message}`);
    throw new Error(`Failed to discard changes: ${(error as Error).message}`);
  }
}

// ── Gitignore ──────────────────────────────────────────────────────

export async function gitAddToGitignore(workspace: IWikiWorkspace, pattern: string): Promise<void> {
  const directory = toPlainPath(workspace.wikiFolderLocation);
  const gitignorePath = `${directory}/.gitignore`;
  try {
    let existing = '';
    try {
      if (isExternalPath(directory)) {
        existing = await ExternalStorage.readFileUtf8(gitignorePath);
      } else {
        existing = await FileSystemLegacy.readAsStringAsync(toFileUri(gitignorePath), { encoding: FileSystemLegacy.EncodingType.UTF8 });
      }
    } catch { /* file doesn't exist yet */ }
    const lines = existing.split('\n').map(l => l.trim());
    if (!lines.includes(pattern)) {
      const newContent = existing.endsWith('\n') || existing === ''
        ? `${existing}${pattern}\n`
        : `${existing}\n${pattern}\n`;
      if (isExternalPath(directory)) {
        await ExternalStorage.writeFileUtf8(gitignorePath, newContent);
      } else {
        await FileSystemLegacy.writeAsStringAsync(toFileUri(gitignorePath), newContent);
      }
    }
  } catch (error) {
    throw new Error(`Failed to add to .gitignore: ${(error as Error).message}`);
  }
}

// ── Init ───────────────────────────────────────────────────────────

export async function gitInit(workspace: IWikiWorkspace): Promise<void> {
  const directory = toPlainPath(workspace.wikiFolderLocation);
  try {
    const resultJson = await ExternalStorage.gitInit(directory, 'main');
    const result = parseNativeResult<{ ok: boolean; error?: string }>(resultJson);
    if (!result.ok) throw new Error(result.error ?? 'Unknown init error');
    console.log(`Initialized git repository at ${directory}`);
  } catch (error) {
    console.error(`Git init failed: ${(error as Error).message}`);
    throw new Error(`Failed to initialize repository: ${(error as Error).message}`);
  }
}

// ── Add remote ─────────────────────────────────────────────────────

export async function gitAddRemote(workspace: IWikiWorkspace, remote: IGitRemote): Promise<void> {
  const directory = toPlainPath(workspace.wikiFolderLocation);
  const url = `${remote.baseUrl}/tw-mobile-sync/git/${remote.workspaceId}`;
  try {
    const resultJson = await ExternalStorage.gitAddRemote(directory, 'origin', url);
    const result = parseNativeResult<{ ok: boolean; error?: string }>(resultJson);
    if (!result.ok) throw new Error(result.error ?? 'Unknown error');
    console.log(`Added remote: ${url}`);
  } catch (error) {
    console.error(`Failed to add remote: ${(error as Error).message}`);
    throw error;
  }
}
