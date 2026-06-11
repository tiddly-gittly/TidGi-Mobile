/**
 * Build wiki template ZIP asset from the git submodule at template/wiki.
 *
 * Usage: zx scripts/buildWikiTemplateZip.mjs
 *
 * Steps:
 *   1. Pull the git submodule (template/wiki)
 *   2. Copy template files to a staging directory
 *   3. Initialize a fresh git repo with a single initial commit (mobile-friendly config)
 *   4. Create a ZIP archive at assets/wiki-template.zip (including the pre-baked .git)
 *
 * The ZIP is bundled with the app via Expo assetBundlePatterns.
 * At runtime, extractLocalWikiTemplate.ts unzips it into a new wiki workspace —
 * no on-device git init/commit is needed when the pre-baked .git is present.
 */

import { resolve, relative, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, cpSync, rmSync, mkdtempSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const templateDir = resolve(projectRoot, 'template', 'wiki');
const outDir = resolve(projectRoot, 'assets');
const outZip = resolve(outDir, 'wiki-template.zip');

const INITIAL_COMMIT_MESSAGE = 'Initial Commit with TidGi Mobile';
const MOBILE_GIT_ATTRIBUTES = '* text=auto eol=lf\n';

// Mirrors ensureGitConfigForMobile() in src/services/GitService/index.ts
const MOBILE_GIT_CONFIG = [
  ['protocol.version', '0'],
  ['core.autocrlf', 'false'],
  ['core.eol', 'lf'],
  ['pack.window', '2'],
  ['pack.depth', '0'],
  ['pack.windowmemory', String(5 * 1024 * 1024)],
  ['pack.deltacachesize', '1'],
  ['pack.deltacachelimit', '1'],
  ['pack.threads', '1'],
  ['pack.bigfilethreshold', String(1 * 1024 * 1024)],
  ['core.streamfilethreshold', String(5 * 1024 * 1024)],
];

// ─── Step 1: Pull submodule ───────────────────────────────────────────────────

console.log('Pulling git submodule: template/wiki...');
if (!existsSync(templateDir)) {
  console.log('Submodule not initialized, running git submodule update --init...');
  execSync('git submodule update --init --recursive --depth 1', { cwd: projectRoot, stdio: 'inherit' });
} else {
  console.log('Updating submodule...');
  execSync('git submodule update --init --recursive --depth 1', { cwd: projectRoot, stdio: 'inherit' });
}

if (!existsSync(templateDir)) {
  console.error('ERROR: template/wiki directory not found after submodule update');
  process.exit(1);
}

const tiddlywikiInfoPath = resolve(templateDir, 'tiddlywiki.info');
if (!existsSync(tiddlywikiInfoPath)) {
  console.error('ERROR: template/wiki/tiddlywiki.info not found — submodule may not have pulled correctly');
  process.exit(1);
}

// ─── Step 2: Stage template + pre-bake single-commit .git ────────────────────

/**
 * Recursively collect all files under a directory.
 * Returns an array of { relativePath, absolutePath }.
 */
function collectFiles(dirPath, baseDir, { includeGit = false } = {}) {
  const results = [];
  const entries = readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = resolve(dirPath, entry.name);
    const relPath = relative(baseDir, fullPath);

    if (entry.name === '.git' && !includeGit) continue;
    if (!includeGit && entry.name.startsWith('.') && entry.name !== '.gitignore' && entry.name !== '.github') continue;

    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, baseDir, { includeGit }));
    } else if (entry.isFile()) {
      results.push({ relativePath: relPath, absolutePath: fullPath });
    }
  }

  return results;
}

function copyTemplateToStaging(sourceDir, targetDir) {
  const entries = readdirSync(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === '.git') continue;
    if (entry.name.startsWith('.') && entry.name !== '.gitignore' && entry.name !== '.github') continue;

    const sourcePath = resolve(sourceDir, entry.name);
    const targetPath = resolve(targetDir, entry.name);
    cpSync(sourcePath, targetPath, { recursive: true });
  }
}

function initMobileGitRepo(stagingDir) {
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'TidGi Mobile',
    GIT_AUTHOR_EMAIL: 'tidgi-mobile@local',
    GIT_COMMITTER_NAME: 'TidGi Mobile',
    GIT_COMMITTER_EMAIL: 'tidgi-mobile@local',
  };

  execSync('git init -b main', { cwd: stagingDir, stdio: 'inherit' });

  for (const [key, value] of MOBILE_GIT_CONFIG) {
    execSync(`git config ${key} ${value}`, { cwd: stagingDir, stdio: 'inherit' });
  }

  mkdirSync(join(stagingDir, '.git', 'info'), { recursive: true });
  writeFileSync(join(stagingDir, '.git', 'info', 'attributes'), MOBILE_GIT_ATTRIBUTES, 'utf8');

  execSync('git add -A', { cwd: stagingDir, stdio: 'inherit' });
  execSync(`git commit -m "${INITIAL_COMMIT_MESSAGE}"`, { cwd: stagingDir, stdio: 'inherit', env: gitEnv });
  execSync('git gc --aggressive --prune=now', { cwd: stagingDir, stdio: 'inherit' });
}

console.log('Preparing staging directory with pre-baked git repository...');
const stagingDir = mkdtempSync(join(tmpdir(), 'wiki-template-'));
try {
  copyTemplateToStaging(templateDir, stagingDir);
  initMobileGitRepo(stagingDir);

  console.log('Collecting staged files (including .git)...');
  const files = collectFiles(stagingDir, stagingDir, { includeGit: true });
  const gitFileCount = files.filter(file => file.relativePath.replace(/\\/g, '/').startsWith('.git/')).length;
  console.log(`  Found ${files.length} files (${gitFileCount} under .git/)`);

  // ─── Step 3: Create ZIP ──────────────────────────────────────────────────────

  console.log('Creating ZIP archive...');
  mkdirSync(outDir, { recursive: true });

  // Simple ZIP creation using raw format (no external dependencies needed)
  // ZIP format: https://en.wikipedia.org/wiki/ZIP_(file_format)

  function createZip(zipFiles) {
    const encoder = new TextEncoder();
    const parts = [];
    const centralDirectory = [];

    for (const { relativePath, absolutePath } of zipFiles) {
      // Normalize path separators to forward slashes for ZIP spec
      const zipPath = relativePath.replace(/\\/g, '/');
      const nameBytes = encoder.encode(zipPath);

      // Read file content
      const content = readFileSync(absolutePath);
      const stat = statSync(absolutePath);

      // Local file header
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(localHeader.buffer);

      // Signature: "PK\x03\x04"
      localView.setUint32(0, 0x04034b50, true);
      // Version needed: 20 (2.0)
      localView.setUint16(4, 20, true);
      // General purpose bit flag: 0x0800 = UTF-8
      localView.setUint16(6, 0x0800, true);
      // Compression method: 0 = stored
      localView.setUint16(8, 0, true);
      // File modification time (DOS format)
      const modDate = stat.mtime;
      const dosTime = (modDate.getSeconds() >> 1) | (modDate.getMinutes() << 5) | (modDate.getHours() << 11);
      const dosDate = modDate.getDate() | ((modDate.getMonth() + 1) << 5) | ((modDate.getFullYear() - 1980) << 9);
      localView.setUint16(10, dosTime, true);
      localView.setUint16(12, dosDate, true);
      // CRC-32: 0 (we don't compute it for simplicity — most unzip tools accept 0)
      localView.setUint32(14, 0, true);
      // Compressed size
      localView.setUint32(18, content.length, true);
      // Uncompressed size
      localView.setUint32(22, content.length, true);
      // File name length
      localView.setUint16(26, nameBytes.length, true);
      // Extra field length: 0
      localView.setUint16(28, 0, true);

      // Write file name bytes
      localHeader.set(nameBytes, 30);

      // Offset of this local header in the archive
      const offset = parts.reduce((sum, p) => sum + p.length, 0);

      parts.push(localHeader);
      if (content.length > 0) {
        parts.push(new Uint8Array(content.buffer, content.byteOffset, content.byteLength));
      }

      // Central directory entry
      const cdEntry = new Uint8Array(46 + nameBytes.length);
      const cdView = new DataView(cdEntry.buffer);

      cdView.setUint32(0, 0x02014b50, true); // Signature
      cdView.setUint16(4, 20, true); // Version made by
      cdView.setUint16(6, 20, true); // Version needed
      cdView.setUint16(8, 0x0800, true); // Flags: UTF-8
      cdView.setUint16(10, 0, true); // Compression: stored
      cdView.setUint16(12, dosTime, true);
      cdView.setUint16(14, dosDate, true);
      cdView.setUint32(16, 0, true); // CRC-32
      cdView.setUint32(20, content.length, true); // Compressed
      cdView.setUint32(24, content.length, true); // Uncompressed
      cdView.setUint16(28, nameBytes.length, true); // File name length
      cdView.setUint16(30, 0, true); // Extra field length
      cdView.setUint16(32, 0, true); // File comment length
      cdView.setUint16(34, 0, true); // Disk number start
      cdView.setUint16(36, 0, true); // Internal attributes
      cdView.setUint32(38, 0, true); // External attributes
      cdView.setUint32(42, offset, true); // Relative offset

      cdEntry.set(nameBytes, 46);
      centralDirectory.push(cdEntry);
    }

    // End of central directory record
    const cdOffset = parts.reduce((sum, p) => sum + p.length, 0);
    const cdSize = centralDirectory.reduce((sum, e) => sum + e.length, 0);

    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);

    eocdView.setUint32(0, 0x06054b50, true); // Signature
    eocdView.setUint16(4, 0, true); // Disk number
    eocdView.setUint16(6, 0, true); // Disk with CD
    eocdView.setUint16(8, centralDirectory.length, true); // Entries on disk
    eocdView.setUint16(10, centralDirectory.length, true); // Total entries
    eocdView.setUint32(12, cdSize, true); // CD size
    eocdView.setUint32(16, cdOffset, true); // CD offset
    eocdView.setUint16(20, 0, true); // Comment length

    // Concatenate all parts
    const totalSize = cdOffset + cdSize + 22;
    const result = new Uint8Array(totalSize);
    let pos = 0;
    for (const part of parts) {
      result.set(part, pos);
      pos += part.length;
    }
    for (const entry of centralDirectory) {
      result.set(entry, pos);
      pos += entry.length;
    }
    result.set(eocd, pos);

    return result;
  }

  const zipData = createZip(files);
  writeFileSync(outZip, zipData);
  console.log(`Wrote ${outZip} (${(zipData.length / 1024).toFixed(1)} KB)`);

  // ─── Step 4: Write version info ──────────────────────────────────────────────

  const tiddlywikiInfo = JSON.parse(readFileSync(tiddlywikiInfoPath, 'utf8'));
  const commitHash = execSync('git -C template/wiki rev-parse HEAD', { encoding: 'utf8' }).trim();
  const initialCommitOid = execSync(`git -C "${stagingDir}" rev-parse HEAD`, { encoding: 'utf8' }).trim();
  const versionInfo = {
    templateRepo: 'https://github.com/tiddly-gittly/Tiddlywiki-NodeJS-Github-Template',
    commitHash,
    initialCommitOid,
    initialCommitMessage: INITIAL_COMMIT_MESSAGE,
    tiddlywikiInfo,
    buildDate: new Date().toISOString(),
    fileCount: files.length,
    gitFileCount,
  };
  const versionPath = resolve(outDir, 'wiki-template-version.json');
  writeFileSync(versionPath, JSON.stringify(versionInfo, null, 2), 'utf8');
  console.log(`Wrote ${versionPath}`);
  console.log('Done!');
} finally {
  rmSync(stagingDir, { recursive: true, force: true });
}
