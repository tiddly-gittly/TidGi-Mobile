/**
 * Storage permission and location management for TidGi-Mobile.
 *
 * Uses MANAGE_EXTERNAL_STORAGE permission to allow direct file:// access to
 * /sdcard/Documents/TidGi/ (similar to how Obsidian stores vaults).
 *
 * This avoids all SAF (content://) issues — isomorphic-git, path utilities,
 * and all existing code work directly with file:// URIs.
 */

import * as Application from 'expo-application';
import { startActivityAsync } from 'expo-intent-launcher';
import { Platform } from 'react-native';
import { ExternalStorage, toPlainPath } from 'expo-filesystem-android-external-storage';

const MANAGE_APP_ALL_FILES_ACCESS_ACTION = 'android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION';
const MANAGE_ALL_FILES_ACCESS_ACTION = 'android.settings.MANAGE_ALL_FILES_ACCESS_PERMISSION';

const EXTERNAL_WIKI_PATH_CANDIDATES = [
  'file:///storage/emulated/0/Documents/TidGi/',
  'file:///sdcard/Documents/TidGi/',
  `file:///storage/emulated/0/Android/data/${Application.applicationId}/files/TidGi/`,
  `file:///storage/emulated/0/Android/media/${Application.applicationId}/TidGi/`,
] as const;

/** Default external storage path for TidGi wikis */
export const EXTERNAL_WIKI_PATH = EXTERNAL_WIKI_PATH_CANDIDATES[0];

let resolvedExternalWikiPath: string = EXTERNAL_WIKI_PATH;
let lastStorageAccessErrorMessage = '';

/**
 * Probe external directory using the raw native module (bypasses Expo FS whitelist).
 */
async function tryWriteToExternalDirectoryAsync(
  uri: string,
  createDirectoryWhenMissing: boolean,
): Promise<{ ok: boolean; exists: boolean; errorMessage?: string }> {
  try {
    const plainPath = toPlainPath(uri.endsWith('/') ? uri : `${uri}/`);
    const info = await ExternalStorage.getInfo(plainPath);
    const existedBefore = info.exists;

    if (!existedBefore) {
      if (!createDirectoryWhenMissing) {
        return { ok: false, exists: false, errorMessage: 'Directory does not exist' };
      }
      await ExternalStorage.mkdir(plainPath);
    }

    // Write + delete a probe file
    const probePath = `${plainPath}.probe_${Date.now()}`;
    await ExternalStorage.writeFileUtf8(probePath, 'test');
    await ExternalStorage.deleteFile(probePath);

    return { ok: true, exists: true };
  } catch (error) {
    return { ok: false, exists: false, errorMessage: (error as Error).message };
  }
}

async function detectWritableExternalPathAsync(): Promise<string | undefined> {
  const failureMessages: string[] = [];

  // Extra diagnostics
  try {
    const isWritable = await ExternalStorage.isExternalStorageWritable();
    const externalStorageDirectory = await ExternalStorage.getExternalStorageDirectory();
    const isManager = await ExternalStorage.isExternalStorageManager();
    console.log('[storage] Native storage check:', { isWritable, externalStorageDirectory, isManager });
    if (!isManager) {
      // On many devices/ROMs apps can write to shared storage (e.g. Documents/) even
      // without MANAGE_EXTERNAL_STORAGE.  The actual probe below is authoritative.
      console.log('[storage] MANAGE_EXTERNAL_STORAGE not formally granted — will probe actual write access');
    }
  } catch (error) {
    console.log('[storage] Native storage check failed (module not available?):', (error as Error).message);
  }

  for (const candidate of EXTERNAL_WIKI_PATH_CANDIDATES) {
    const probeResult = await tryWriteToExternalDirectoryAsync(candidate, true);

    if (probeResult.ok) {
      resolvedExternalWikiPath = candidate;
      lastStorageAccessErrorMessage = '';
      console.log('[storage] Selected writable external path:', candidate);
      return candidate;
    }

    const failureMessage = `${candidate} -> ${probeResult.errorMessage ?? 'Unknown error'}`;
    failureMessages.push(failureMessage);
    console.log('[storage] External path probe failed:', failureMessage);
  }

  lastStorageAccessErrorMessage = failureMessages.join('\n');
  return undefined;
}

export function getPreferredExternalWikiPath(): string {
  return resolvedExternalWikiPath;
}

export function getStorageAccessErrorMessage(): string {
  return lastStorageAccessErrorMessage;
}

/**
 * Async check whether MANAGE_EXTERNAL_STORAGE is effectively usable.
 * Uses legacy FS API to probe writable external paths.
 */
export async function isAllFilesAccessGrantedAsync(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;

  const writablePath = await detectWritableExternalPathAsync();
  if (writablePath !== undefined) {
    return true;
  }

  console.log('[storage] All-files-access check failed: no writable external path found', lastStorageAccessErrorMessage);
  return false;
}

/**
 * Open the system settings page for MANAGE_EXTERNAL_STORAGE.
 * The user must manually toggle the permission.
 * Returns true if permission was granted after returning from settings.
 */
export async function requestAllFilesAccess(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;

  console.log('[storage] requestAllFilesAccess: checking current state…');
  if (await isAllFilesAccessGrantedAsync()) return true;

  try {
    const applicationId = Application.applicationId;

    try {
      // Try app-specific settings page first
      await startActivityAsync(
        MANAGE_APP_ALL_FILES_ACCESS_ACTION,
        { data: `package:${applicationId}` },
      );
    } catch {
      // Fall back to generic all-files-access settings list
      await startActivityAsync(
        MANAGE_ALL_FILES_ACCESS_ACTION,
      );
    }
  } catch (error) {
    console.error('[storage] Failed to open settings:', error);
  }

  // Wait briefly for system to update permission state, then check
  await new Promise(resolve => setTimeout(resolve, 500));
  return isAllFilesAccessGrantedAsync();
}

/**
 * Normalize a directory URI to ensure it ends with '/'.
 */
export function normalizeDirectoryUri(uri: string): string {
  return uri.endsWith('/') ? uri : `${uri}/`;
}

/**
 * Decode and format a storage URI for display.
 */
export function formatStorageUri(uri: string): string {
  try {
    const decoded = decodeURIComponent(uri);
    // Strip file:// prefix for display
    if (decoded.startsWith('file:///')) {
      return decoded.replace('file://', '');
    }
    return decoded;
  } catch {
    return uri;
  }
}

/**
 * Async check whether a directory URI is writable (uses native module for external paths).
 */
export async function checkStorageWriteAccessAsync(uri: string): Promise<boolean> {
  const result = await tryWriteToExternalDirectoryAsync(uri, true);
  return result.ok;
}
