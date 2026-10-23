import { Directory, File } from 'expo-file-system';
import { logFor } from '../../../services/LoggerService';
import { IWorkspace } from '../../../store/workspace';

const cleanupLogger = logFor('workspace-cleanup');

/**
 * Recursively delete a directory by first deleting all files,
 * then sub-directories bottom-up. This works around Expo FS
 * `Directory.delete()` failures on directories with locked or
 * permission-restricted files (e.g. .git/objects/pack).
 */
export function recursiveDeleteDirectory(directory: Directory): void {
  if (!directory.exists) return;
  // Always delete contents first before removing the directory itself.
  // Expo FS on Android logs a native ERROR for `Directory.delete()` on non-empty
  // directories even when JS catches it, so we avoid the fast-path attempt.
  const entries = directory.list();
  for (const entry of entries) {
    if (entry instanceof File) {
      try {
        entry.delete();
      } catch (error) {
        cleanupLogger.warn('Failed to remove workspace file during cleanup', error);
      }
    } else if (entry instanceof Directory) {
      recursiveDeleteDirectory(entry);
    }
  }
  // After emptying, delete the now-empty directory
  try {
    directory.delete();
  } catch (error) {
    cleanupLogger.warn('Failed to remove workspace directory during cleanup', error);
  }
}

export const deleteWikiFile = (wikiWorkspace: IWorkspace): void => {
  if (wikiWorkspace.type === 'wiki') {
    const directory = new Directory(wikiWorkspace.wikiFolderLocation);
    if (directory.exists) {
      recursiveDeleteDirectory(directory);
    }
  } else if (wikiWorkspace.type === 'html') {
    const file = new File(wikiWorkspace.htmlFileLocation);
    if (file.exists) {
      file.delete();
    }
  }
};
