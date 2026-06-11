/**
 * Install tracked git hooks into .git/hooks (no git config changes).
 *
 * Usage: zx scripts/setupGitHooks.mjs
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceHooksDir = join(projectRoot, '.githooks');
const gitDir = join(projectRoot, '.git');
const targetHooksDir = join(gitDir, 'hooks');

if (!existsSync(gitDir)) {
  console.log('[setupGitHooks] Not a git repository, skipping.');
  process.exit(0);
}

if (!existsSync(sourceHooksDir)) {
  console.log('[setupGitHooks] No .githooks directory found, skipping.');
  process.exit(0);
}

mkdirSync(targetHooksDir, { recursive: true });

const hookNames = readdirSync(sourceHooksDir).filter(name => !name.startsWith('.'));
for (const hookName of hookNames) {
  const sourcePath = join(sourceHooksDir, hookName);
  const targetPath = join(targetHooksDir, hookName);
  copyFileSync(sourcePath, targetPath);
  try {
    chmodSync(targetPath, 0o755);
  } catch {
    // Windows may not support chmod; Git for Windows still runs the hook.
  }
  console.log(`[setupGitHooks] Installed ${hookName}`);
}
