/**
 * Install tracked git hooks into Git's resolved hooks directory (no git config
 * changes). This supports both ordinary clones and linked worktrees, where
 * `.git` is a file and the hooks directory belongs to the common Git dir.
 *
 * Usage: zx scripts/setupGitHooks.mjs
 */

import { spawnSync } from 'child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceHooksDir = join(projectRoot, '.githooks');
const gitMarkerPath = join(projectRoot, '.git');

if (!existsSync(gitMarkerPath)) {
  console.log('[setupGitHooks] Not a git repository, skipping.');
  process.exit(0);
}

if (!existsSync(sourceHooksDir)) {
  console.log('[setupGitHooks] No .githooks directory found, skipping.');
  process.exit(0);
}

const gitPathResult = spawnSync('git', ['rev-parse', '--git-path', 'hooks'], {
  cwd: projectRoot,
  encoding: 'utf8',
  shell: false,
  windowsHide: true,
});
if (gitPathResult.error !== undefined) {
  throw new Error('[setupGitHooks] Failed to run git while resolving the hooks directory.', {
    cause: gitPathResult.error,
  });
}
if (gitPathResult.status !== 0) {
  const termination = gitPathResult.status === null
    ? `signal ${gitPathResult.signal ?? 'unknown'}`
    : `exit code ${gitPathResult.status}`;
  const detail = gitPathResult.stderr.trim();
  throw new Error(
    `[setupGitHooks] Failed to resolve Git hooks directory (${termination}).${detail.length > 0 ? ` ${detail}` : ''}`,
  );
}

const reportedHooksPath = gitPathResult.stdout.trim();
if (reportedHooksPath.length === 0) {
  throw new Error('[setupGitHooks] Git returned an empty hooks directory path.');
}
const targetHooksDir = isAbsolute(reportedHooksPath)
  ? reportedHooksPath
  : resolve(projectRoot, reportedHooksPath);

mkdirSync(targetHooksDir, { recursive: true });

const hookNames = readdirSync(sourceHooksDir).filter(name => !name.startsWith('.'));
for (const hookName of hookNames) {
  const sourcePath = join(sourceHooksDir, hookName);
  const targetPath = join(targetHooksDir, hookName);
  copyFileSync(sourcePath, targetPath);
  try {
    chmodSync(targetPath, 0o755);
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : undefined;
    const unsupportedOnWindows = process.platform === 'win32'
      && ['EINVAL', 'ENOSYS', 'ENOTSUP', 'EPERM'].includes(code);
    if (!unsupportedOnWindows) throw error;
    // Git for Windows runs the copied hook even when the filesystem does not
    // implement POSIX executable bits. Keep that narrow exception visible.
    console.warn(`[setupGitHooks] Could not mark ${hookName} executable on Windows (${code}); continuing.`);
  }
  console.log(`[setupGitHooks] Installed ${hookName}`);
}
