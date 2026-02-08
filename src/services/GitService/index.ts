/**
 * Git operations for TidGi-Mobile using isomorphic-git
 * Handles clone, pull, push with Basic Auth
 */

import { Directory, File } from 'expo-file-system';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import { IWikiWorkspace } from '../../store/workspace';

/**
 * Git remote configuration with authentication
 */
export interface IGitRemote {
  baseUrl: string;
  token: string;
  workspaceId: string;
}

/**
 * Get the FS adapter for isomorphic-git
 * Maps Expo FileSystem to isomorphic-git's FS interface
 * Follows Node.js fs.promises API structure
 * Note: Many Expo FileSystem operations are synchronous but wrapped in async for API compatibility
 */
/* eslint-disable @typescript-eslint/require-await */
const fs = {
  promises: {
    async readFile(filepath: string, options?: { encoding?: 'utf8' } | 'utf8'): Promise<string | Buffer> {
      try {
        const file = new File(filepath);
        const encoding = typeof options === 'string' ? options : options?.encoding;

        if (encoding === 'utf8') {
          return await file.text();
        }

        // For binary, return Buffer
        const arrayBuffer = await file.arrayBuffer();
        return Buffer.from(arrayBuffer);
      } catch (error) {
        // Only throw ENOENT if file doesn't exist; preserve permission errors, encoding errors, etc.
        if (!new File(filepath).exists) {
          const enoentError = new Error(`ENOENT: no such file or directory, open '${filepath}'`) as NodeJS.ErrnoException;
          enoentError.code = 'ENOENT';
          enoentError.errno = -2;
          enoentError.path = filepath;
          throw enoentError;
        }
        // Re-throw permission errors, encoding errors, etc.
        throw error;
      }
    },

    async writeFile(filepath: string, data: string | Uint8Array | Buffer, _options?: { encoding?: 'utf8'; mode?: number }): Promise<void> {
      const file = new File(filepath);
      const directory = file.parentDirectory;
      const directoryExists = directory.exists;

      if (!directoryExists) {
        directory.create();
      }

      if (typeof data === 'string') {
        file.write(data);
      } else if (Buffer.isBuffer(data)) {
        // Convert Buffer to Uint8Array
        file.write(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      } else {
        file.write(data);
      }
    },

    async unlink(filepath: string): Promise<void> {
      try {
        const file = new File(filepath);
        const fileExists = file.exists;

        if (fileExists) {
          file.delete();
        }
      } catch (error) {
        // Only throw ENOENT if file doesn't exist
        if (!new File(filepath).exists) {
          const enoentError = new Error(`ENOENT: no such file or directory, unlink '${filepath}'`) as NodeJS.ErrnoException;
          enoentError.code = 'ENOENT';
          throw enoentError;
        }
        throw error;
      }
    },

    async readdir(filepath: string): Promise<string[]> {
      try {
        const directory = new Directory(filepath);
        const entries = directory.list();
        // isomorphic-git expects plain filenames without trailing slashes
        return entries.map(entry => entry.name.replace(/\/$/, ''));
      } catch (error) {
        // Only throw ENOENT if directory doesn't exist
        if (!new Directory(filepath).exists) {
          const enoentError = new Error(`ENOENT: no such file or directory, scandir '${filepath}'`) as NodeJS.ErrnoException;
          enoentError.code = 'ENOENT';
          throw enoentError;
        }
        throw error;
      }
    },

    async mkdir(filepath: string, options?: { recursive?: boolean }): Promise<void> {
      try {
        const directory = new Directory(filepath);
        directory.create();
      } catch (error) {
        if (!options?.recursive) {
          throw error;
        }
      }
    },

    async rmdir(filepath: string): Promise<void> {
      try {
        const directory = new Directory(filepath);
        const directoryExists = directory.exists;

        if (directoryExists) {
          directory.delete();
        }
      } catch (error) {
        // Only throw ENOENT if directory doesn't exist
        if (!new Directory(filepath).exists) {
          const enoentError = new Error(`ENOENT: no such file or directory, rmdir '${filepath}'`) as NodeJS.ErrnoException;
          enoentError.code = 'ENOENT';
          throw enoentError;
        }
        throw error;
      }
    },

    async stat(filepath: string): Promise<{
      isFile: () => boolean;
      isDirectory: () => boolean;
      isSymbolicLink: () => boolean;
      size: number;
      mode: number;
      mtimeMs: number;
    }> {
      try {
        // Check directory first since File class is for files only
        const directory = new Directory(filepath);
        if (directory.exists) {
          const directoryInfo = directory.info();
          return {
            isFile: () => false,
            isDirectory: () => true,
            isSymbolicLink: () => false,
            size: 0,
            mode: 0o755,
            mtimeMs: directoryInfo.modificationTime ?? Date.now(),
          };
        }

        const file = new File(filepath);
        if (!file.exists) {
          const error = new Error(`ENOENT: no such file or directory, stat '${filepath}'`) as NodeJS.ErrnoException;
          error.code = 'ENOENT';
          throw error;
        }

        return {
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => false,
          size: file.size,
          mode: 0o644,
          mtimeMs: file.modificationTime ?? Date.now(),
        };
      } catch (error) {
        // Re-throw ENOENT as-is; for other errors check if path actually exists
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw error;
        }
        // If neither file nor directory exists, produce ENOENT; otherwise preserve real error
        if (!new File(filepath).exists && !new Directory(filepath).exists) {
          const enoentError = new Error(`ENOENT: no such file or directory, stat '${filepath}'`) as NodeJS.ErrnoException;
          enoentError.code = 'ENOENT';
          throw enoentError;
        }
        throw error;
      }
    },

    async lstat(filepath: string) {
      // Expo FS doesn't support symlinks, so lstat behaves the same as stat.
      // isSymbolicLink always returns false since mobile FS doesn't have symlinks.
      return fs.promises.stat(filepath);
    },

    async readlink(_filepath: string): Promise<string> {
      throw new Error('readlink not supported on mobile');
    },

    async symlink(_target: string, _filepath: string): Promise<void> {
      throw new Error('symlink not supported on mobile');
    },

    async chmod(_filepath: string, _mode: number): Promise<void> {
      // No-op on mobile - Expo FileSystem doesn't support chmod
    },
  },
};

/**
 * Create auth header for git operations
 * Includes CSRF header to bypass TiddlyWiki's CSRF protection
 */
function createAuthHeader(token: string): { Authorization: string; 'X-Requested-With': string } {
  const credentials = Buffer.from(`:${token}`).toString('base64');
  return {
    Authorization: `Basic ${credentials}`,
    'X-Requested-With': 'TiddlyWiki-TidGi-Mobile',
  };
}

/**
 * Clone a git repository
 */
export async function gitClone(
  workspace: IWikiWorkspace,
  remote: IGitRemote,
  onProgress?: (phase: string, loaded: number, total: number) => void,
): Promise<void> {
  const url = `${remote.baseUrl}/tw-mobile-sync/git/${remote.workspaceId}`;
  const directory = workspace.wikiFolderLocation;

  try {
    await git.clone({
      fs,
      http,
      dir: directory,
      url,
      ref: 'main',
      singleBranch: true,
      depth: 1,
      headers: createAuthHeader(remote.token),
      onProgress: (progress) => {
        onProgress?.(progress.phase, progress.loaded, progress.total);
      },
    });

    console.log(`Successfully cloned repository to ${directory}`);
  } catch (error) {
    console.error(`Git clone failed: ${(error as Error).message}`);
    throw new Error(`Failed to clone repository: ${(error as Error).message}`);
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

  try {
    await git.pull({
      fs,
      http,
      dir: directory,
      ref: 'main',
      singleBranch: true,
      headers: createAuthHeader(remote.token),
      author: {
        name: 'TidGi Mobile',
        email: 'mobile@tidgi.fun',
      },
      onProgress: (progress) => {
        onProgress?.(progress.phase, progress.loaded, progress.total);
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

  try {
    await git.push({
      fs,
      http,
      dir: directory,
      remote: 'origin',
      ref: 'main',
      headers: createAuthHeader(remote.token),
      onProgress: (progress) => {
        onProgress?.(progress.phase, progress.loaded, progress.total);
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
  const timestamp = Date.now();
  const branchName = `client/${deviceId}/${timestamp}`;

  try {
    // Create the conflict branch from current HEAD (which has local commits)
    await git.branch({ fs, dir: directory, ref: branchName });

    // Push the conflict branch to remote
    await git.push({
      fs,
      http,
      dir: directory,
      remote: 'origin',
      ref: branchName,
      headers: createAuthHeader(remote.token),
    });

    // Fetch latest remote main so we have up-to-date origin/main
    await git.fetch({
      fs,
      http,
      dir: directory,
      remote: 'origin',
      ref: 'main',
      singleBranch: true,
      headers: createAuthHeader(remote.token),
    });

    // Hard-reset main to origin/main by checking out with force.
    // isomorphic-git checkout with force discards local changes.
    await git.checkout({ fs, dir: directory, ref: 'main', force: true });

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
      await git.checkout({ fs, dir: directory, ref: 'main', force: true });
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
