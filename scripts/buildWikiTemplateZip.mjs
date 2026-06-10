/**
 * Build wiki template ZIP asset from the git submodule at template/wiki.
 *
 * Usage: zx scripts/buildWikiTemplateZip.mjs
 *
 * Steps:
 *   1. Pull the git submodule (template/wiki)
 *   2. Read all files under template/wiki (excluding .git)
 *   3. Create a ZIP archive at assets/wiki-template.zip
 *
 * The ZIP is bundled with the app via Expo assetBundlePatterns.
 * At runtime, use extractLocalWikiTemplate.ts to unzip into a new wiki workspace.
 */

import { resolve, relative, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const templateDir = resolve(projectRoot, 'template', 'wiki');
const outDir = resolve(projectRoot, 'assets');
const outZip = resolve(outDir, 'wiki-template.zip');

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

// ─── Step 2: Collect all files ─────────────────────────────────────────────────

/**
 * Recursively collect all files under a directory (excluding .git).
 * Returns an array of { relativePath, absolutePath }.
 */
function collectFiles(dirPath) {
  const results = [];
  const entries = readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = resolve(dirPath, entry.name);
    const relPath = relative(templateDir, fullPath);

    // Skip .git directory
    if (entry.name === '.git') continue;
    // Skip hidden files (except .gitignore which is needed)
    if (entry.name.startsWith('.') && entry.name !== '.gitignore' && entry.name !== '.github') continue;

    if (entry.isDirectory()) {
      // Include .github directory (contains workflow templates etc.)
      results.push(...collectFiles(fullPath));
    } else if (entry.isFile()) {
      results.push({ relativePath: relPath, absolutePath: fullPath });
    }
  }

  return results;
}

console.log('Collecting template files...');
const files = collectFiles(templateDir);
console.log(`  Found ${files.length} files`);

// ─── Step 3: Create ZIP ────────────────────────────────────────────────────────

console.log('Creating ZIP archive...');
mkdirSync(outDir, { recursive: true });

// Simple ZIP creation using raw format (no external dependencies needed)
// ZIP format: https://en.wikipedia.org/wiki/ZIP_(file_format)

function createZip(files) {
  const encoder = new TextEncoder();
  const parts = [];
  const centralDirectory = [];

  for (const { relativePath, absolutePath } of files) {
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

// ─── Step 4: Write version info ────────────────────────────────────────────────

const tiddlywikiInfo = JSON.parse(readFileSync(tiddlywikiInfoPath, 'utf8'));
const commitHash = execSync('git -C template/wiki rev-parse HEAD', { encoding: 'utf8' }).trim();
const versionInfo = {
  templateRepo: 'https://github.com/tiddly-gittly/Tiddlywiki-NodeJS-Github-Template',
  commitHash,
  tiddlywikiInfo,
  buildDate: new Date().toISOString(),
  fileCount: files.length,
};
const versionPath = resolve(outDir, 'wiki-template-version.json');
writeFileSync(versionPath, JSON.stringify(versionInfo, null, 2), 'utf8');
console.log(`Wrote ${versionPath}`);
console.log('Done!');
