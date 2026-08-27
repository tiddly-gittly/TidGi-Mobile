import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

const repositoryRoot = resolve(__dirname, '../../..');
const sourceScriptPath = join(repositoryRoot, 'scripts/setupGitHooks.mjs');
const hookContents = '#!/usr/bin/env sh\necho fixture-hook\n';
const temporaryRoots: string[] = [];

function createTemporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'tidgi-setup-hooks-'));
  temporaryRoots.push(root);
  return root;
}

function createFixtureProject(projectRoot: string): void {
  mkdirSync(join(projectRoot, 'scripts'), { recursive: true });
  mkdirSync(join(projectRoot, '.githooks'), { recursive: true });
  copyFileSync(sourceScriptPath, join(projectRoot, 'scripts/setupGitHooks.mjs'));
  writeFileSync(join(projectRoot, '.githooks/pre-commit'), hookContents);
}

function run(command: string, arguments_: string[], cwd: string) {
  return spawnSync(command, arguments_, {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
}

function runGit(cwd: string, arguments_: string[]): string {
  const result = run('git', arguments_, cwd);
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${arguments_.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function initializeRepository(projectRoot: string): void {
  runGit(projectRoot, ['init']);
  runGit(projectRoot, ['config', 'user.email', 'test@tidgi.local']);
  runGit(projectRoot, ['config', 'user.name', 'TidGi Test']);
  runGit(projectRoot, ['add', '.']);
  runGit(projectRoot, ['commit', '-m', 'test fixture']);
}

function runSetupScript(projectRoot: string) {
  return run(process.execPath, [join(projectRoot, 'scripts/setupGitHooks.mjs')], projectRoot);
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop()!, { force: true, recursive: true });
  }
});

describe('setupGitHooks', () => {
  it('installs hooks in an ordinary clone', () => {
    const root = createTemporaryRoot();
    const projectRoot = join(root, 'main');
    createFixtureProject(projectRoot);
    initializeRepository(projectRoot);

    const result = runSetupScript(projectRoot);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[setupGitHooks] Installed pre-commit');
    const installedHook = join(projectRoot, '.git/hooks/pre-commit');
    expect(readFileSync(installedHook, 'utf8')).toBe(hookContents);
    if (process.platform !== 'win32') {
      expect(statSync(installedHook).mode & 0o111).not.toBe(0);
    }
  });

  it('uses the common hooks directory from a linked worktree .git file', () => {
    const root = createTemporaryRoot();
    const mainProject = join(root, 'main');
    const linkedProject = join(root, 'linked');
    createFixtureProject(mainProject);
    initializeRepository(mainProject);
    runGit(mainProject, ['worktree', 'add', '-b', 'linked-test', linkedProject]);

    expect(statSync(join(linkedProject, '.git')).isFile()).toBe(true);
    const result = runSetupScript(linkedProject);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    const reportedHooksPath = runGit(linkedProject, ['rev-parse', '--git-path', 'hooks']);
    const hooksPath = isAbsolute(reportedHooksPath)
      ? reportedHooksPath
      : resolve(linkedProject, reportedHooksPath);
    expect(readFileSync(join(hooksPath, 'pre-commit'), 'utf8')).toBe(hookContents);
    expect(hooksPath).toBe(join(mainProject, '.git/hooks'));
  });

  it('skips safely when installed outside a Git repository', () => {
    const root = createTemporaryRoot();
    const projectRoot = join(root, 'production-install');
    createFixtureProject(projectRoot);

    const result = runSetupScript(projectRoot);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[setupGitHooks] Not a git repository, skipping.');
    expect(existsSync(join(projectRoot, '.git'))).toBe(false);
  });

  it('fails visibly when a present .git marker is invalid', () => {
    const root = createTemporaryRoot();
    const projectRoot = join(root, 'broken-repository');
    createFixtureProject(projectRoot);
    writeFileSync(join(projectRoot, '.git'), 'gitdir: /definitely/missing/tidgi-git-dir\n');

    const result = runSetupScript(projectRoot);

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('[setupGitHooks] Failed to resolve Git hooks directory');
  });
});
