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
 */
const fs = {
  async readFile(filepath: string, options?: { encoding?: string }) {
    try {
      const file = new File(filepath);
      if (options?.encoding === 'utf8') {
        return await file.text();
      }
      // For binary, read as base64
      const arrayBuffer = await file.arrayBuffer();
      return Buffer.from(arrayBuffer).toString('base64');
    } catch (error) {
      throw new Error(`readFile failed: ${(error as Error).message}`);
    }
  },

  async writeFile(filepath: string, data: string | Uint8Array) {
    try {
      const file = new File(filepath);
      const dir = file.parentDirectory;
      const dirExists = dir.exists;
      if (!dirExists) {
        await dir.create();
      }

      if (typeof data === 'string') {
        await file.write(data);
      } else {
        // For Uint8Array, write directly
        await file.write(new Uint8Array(data));
      }
    } catch (error) {
      throw new Error(`writeFile failed: ${(error as Error).message}`);
    }
  },

  async unlink(filepath: string) {
    try {
      const file = new File(filepath);
      const fileExists = file.exists;
      if (fileExists) {
        await file.delete();
      }
    } catch (error) {
      throw new Error(`unlink failed: ${(error as Error).message}`);
    }
  },

  async readdir(filepath: string) {
    try {
      const dir = new Directory(filepath);
      const entries = await dir.list();
      return entries.map(entry => entry.name);
    } catch (error) {
      throw new Error(`readdir failed: ${(error as Error).message}`);
    }
  },

  async mkdir(filepath: string) {
    try {
      const dir = new Directory(filepath);
      await dir.create();
    } catch (error) {
      throw new Error(`mkdir failed: ${(error as Error).message}`);
    }
  },

  async rmdir(filepath: string) {
    try {
      const dir = new Directory(filepath);
      const dirExists = dir.exists;
      if (dirExists) {
        await dir.delete();
      }
    } catch (error) {
      throw new Error(`rmdir failed: ${(error as Error).message}`);
    }
  },

  async stat(filepath: string) {
    try {
      const file = new File(filepath);
      const exists = file.exists;
      if (!exists) {
        throw new Error('ENOENT');
      }
      const info = await file.info();
      const isDir = (info as any).type === 'directory';
      return {
        isFile: () => !isDir,
        isDirectory: () => isDir,
        isSymbolicLink: () => false,
        size: info.size ?? 0,
        mode: 0o666,
        mtimeMs: info.modificationTime ?? 0,
      };
    } catch (error) {
      throw new Error(`stat failed: ${(error as Error).message}`);
    }
  },

  async lstat(filepath: string) {
    return this.stat(filepath);
  },

  async readlink(filepath: string) {
    throw new Error('readlink not supported');
  },

  async symlink(target: string, filepath: string) {
    throw new Error('symlink not supported');
  },

  async chmod(filepath: string, mode: number) {
    // No-op on mobile
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
  const dir = workspace.wikiFolderLocation;

  try {
    await git.clone({
      fs,
      http,
      dir,
      url,
      ref: 'main',
      singleBranch: true,
      depth: 1,
      headers: createAuthHeader(remote.token),
      onProgress: (progress) => {
        onProgress?.(progress.phase, progress.loaded, progress.total);
      },
    });

    console.log(`Successfully cloned repository to ${dir}`);
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
  const dir = workspace.wikiFolderLocation;

  try {
    await git.pull({
      fs,
      http,
      dir,
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
  const dir = workspace.wikiFolderLocation;

  try {
    // Stage all changes
    const status = await git.statusMatrix({ fs, dir });
    for (const [filepath, headStatus, workdirStatus, stageStatus] of status) {
      // workdirStatus 0 = absent, 2 = present
      // stageStatus 0 = absent, 2 = present, 3 = added
      if (workdirStatus !== stageStatus) {
        if (workdirStatus === 0) {
          // File deleted
          await git.remove({ fs, dir, filepath });
        } else {
          // File added or modified
          await git.add({ fs, dir, filepath });
        }
      }
    }

    // Commit
    const sha = await git.commit({
      fs,
      dir,
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
  const dir = workspace.wikiFolderLocation;

  try {
    await git.push({
      fs,
      http,
      dir,
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
 * Push to temporary conflict branch
 */
export async function gitPushToConflictBranch(
  workspace: IWikiWorkspace,
  remote: IGitRemote,
  deviceId: string,
): Promise<string> {
  const dir = workspace.wikiFolderLocation;
  const timestamp = Date.now();
  const branchName = `client/${deviceId}/${timestamp}`;

  try {
    // Create and checkout new branch
    await git.branch({ fs, dir, ref: branchName, checkout: true });

    // Push to remote
    await git.push({
      fs,
      http,
      dir,
      remote: 'origin',
      ref: branchName,
      headers: createAuthHeader(remote.token),
    });

    // Switch back to main
    await git.checkout({ fs, dir, ref: 'main' });

    console.log(`Pushed to conflict branch: ${branchName}`);
    return branchName;
  } catch (error) {
    console.error(`Failed to push to conflict branch: ${(error as Error).message}`);
    throw error;
  }
}

/**
 * Check if repository has uncommitted changes
 */
export async function gitHasChanges(workspace: IWikiWorkspace): Promise<boolean> {
  const dir = workspace.wikiFolderLocation;

  try {
    const status = await git.statusMatrix({ fs, dir });
    return status.some(([_, headStatus, workdirStatus, stageStatus]) => workdirStatus !== headStatus || stageStatus !== headStatus);
  } catch (error) {
    console.error(`Failed to check git status: ${(error as Error).message}`);
    return false;
  }
}

/**
 * Initialize a new git repository
 */
export async function gitInit(workspace: IWikiWorkspace): Promise<void> {
  const dir = workspace.wikiFolderLocation;

  try {
    await git.init({ fs, dir, defaultBranch: 'main' });
    console.log(`Initialized git repository at ${dir}`);
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
  const dir = workspace.wikiFolderLocation;
  const url = `${remote.baseUrl}/tw-mobile-sync/git/${remote.workspaceId}`;

  try {
    await git.addRemote({
      fs,
      dir,
      remote: 'origin',
      url,
    });
    console.log(`Added remote: ${url}`);
  } catch (error) {
    console.error(`Failed to add remote: ${(error as Error).message}`);
    throw error;
  }
}
