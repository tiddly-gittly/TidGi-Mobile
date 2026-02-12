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
import { Directory, File } from 'expo-file-system';
import { startActivityAsync } from 'expo-intent-launcher';
import { Platform } from 'react-native';

const MANAGE_APP_ALL_FILES_ACCESS_ACTION = 'android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION';
const MANAGE_ALL_FILES_ACCESS_ACTION = 'android.settings.MANAGE_ALL_FILES_ACCESS_PERMISSION';

const EXTERNAL_WIKI_PATH_CANDIDATES = [
  'file:///storage/emulated/0/Documents/TidGi/',
  'file:///sdcard/Documents/TidGi/',
  `file:///storage/emulated/0/Android/media/${Application.applicationId}/TidGi/`,
] as const;

/** Default external storage path for TidGi wikis */
export const EXTERNAL_WIKI_PATH = EXTERNAL_WIKI_PATH_CANDIDATES[0];

let resolvedExternalWikiPath: string = EXTERNAL_WIKI_PATH;
let lastStorageAccessErrorMessage = '';

function canWriteToDirectoryUri(uri: string, createDirectoryWhenMissing: boolean): boolean {
  try {
    const directory = new Directory(uri);
    if (!directory.exists) {
      if (!createDirectoryWhenMissing) {
        return false;
      }
      directory.create({ intermediates: true, idempotent: true });
    }
    const probeName = `.probe_${Date.now()}`;
    const probe = new File(directory, probeName);
    probe.write('test');
    probe.delete();
    return true;
  } catch (error) {
    lastStorageAccessErrorMessage = `${uri} -> ${(error as Error).message}`;
    return false;
  }
}

function detectWritableExternalPath(): string | undefined {
  const failureMessages: string[] = [];

  for (const candidate of EXTERNAL_WIKI_PATH_CANDIDATES) {
    if (canWriteToDirectoryUri(candidate, true)) {
      resolvedExternalWikiPath = candidate;
      lastStorageAccessErrorMessage = '';
      return candidate;
    }
    if (lastStorageAccessErrorMessage) {
      failureMessages.push(lastStorageAccessErrorMessage);
    }
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
 * Check whether MANAGE_EXTERNAL_STORAGE permission has been granted.
 * We probe by attempting to create and delete a temp file in /sdcard/Documents/.
 */
export function isAllFilesAccessGranted(): boolean {
  if (Platform.OS !== 'android') return false;

  const writablePath = detectWritableExternalPath();
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
  if (isAllFilesAccessGranted()) return true;

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
  return isAllFilesAccessGranted();
}

/**
 * Normalize a directory URI to ensure it ends with '/'.
 */
export function normalizeDirectoryUri(uri: string): string {
  return uri.endsWith('/') ? uri : `${uri}/`;
}

/**
 * Safely ensure a directory exists (file:// URIs only).
 */
export function ensureDirectoryExists(directory: Directory): void {
  if (directory.exists) return;
  directory.create({ intermediates: true, idempotent: true });
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
 * Check whether a directory URI is writable by creating/deleting a probe file.
 */
export function checkStorageWriteAccess(uri: string): boolean {
  try {
    return canWriteToDirectoryUri(uri, true);
  } catch (error) {
    console.warn('[storage] Write check failed:', error);
    return false;
  }
}
