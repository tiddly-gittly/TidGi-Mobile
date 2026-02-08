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
      } catch {
        const error = new Error(`ENOENT: no such file or directory, open '${filepath}'`) as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        error.errno = -2;
        error.path = filepath;
        throw error;
      }
    },

    async writeFile(filepath: string, data: string | Uint8Array | Buffer, _options?: { encoding?: 'utf8'; mode?: number }): Promise<void> {
      try {
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
      } catch {
        const error = new Error(`ENOENT: failed to write file '${filepath}'`) as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
    },

    async unlink(filepath: string): Promise<void> {
      try {
        const file = new File(filepath);
        const fileExists = file.exists;

        if (fileExists) {
          file.delete();
        }
      } catch {
        const error = new Error(`ENOENT: no such file or directory, unlink '${filepath}'`) as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
    },

    async readdir(filepath: string): Promise<string[]> {
      try {
        const directory = new Directory(filepath);
        const entries = directory.list();
        // isomorphic-git expects plain filenames without trailing slashes
        return entries.map(entry => entry.name.replace(/\/$/, ''));
      } catch {
        const error = new Error(`ENOENT: no such file or directory, scandir '${filepath}'`) as NodeJS.ErrnoException;
        error.code = 'ENOENT';
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
      } catch {
        const error = new Error(`ENOENT: no such file or directory, rmdir '${filepath}'`) as NodeJS.ErrnoException;
        error.code = 'ENOENT';
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
          const dirInfo = directory.info();
          return {
            isFile: () => false,
            isDirectory: () => true,
            isSymbolicLink: () => false,
            size: 0,
            mode: 0o777,
            mtimeMs: dirInfo.modificationTime ?? Date.now(),
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
          size: file.size ?? 0,
          mode: 0o666,
          mtimeMs: file.modificationTime ?? Date.now(),
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw error;
        }
        const error_ = new Error(`stat failed: ${(error as Error).message}`) as NodeJS.ErrnoException;
        error_.code = 'ENOENT';
        throw error_;
      }
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
    // Stage all changes
    const status = await git.statusMatrix({ fs, dir: directory });
    for (const [filepath, _headStatus, workdirStatus, stageStatus] of status) {
      // workdirStatus 0 = absent, 2 = present
      // stageStatus 0 = absent, 2 = present, 3 = added
      if (workdirStatus !== stageStatus) {
        if (workdirStatus === 0) {
          // File deleted
          await git.remove({ fs, dir: directory, filepath });
        } else {
          // File added or modified
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
 * Check if repository has uncommitted changes
 */
export async function gitHasChanges(workspace: IWikiWorkspace): Promise<boolean> {
  const directory = workspace.wikiFolderLocation;

  try {
    const status = await git.statusMatrix({ fs, dir: directory });
    return status.some(([_filepath, headStatus, workdirStatus, stageStatus]) => workdirStatus !== headStatus || stageStatus !== headStatus);
  } catch (error) {
    console.error(`Failed to check git status: ${(error as Error).message}`);
    return false;
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
