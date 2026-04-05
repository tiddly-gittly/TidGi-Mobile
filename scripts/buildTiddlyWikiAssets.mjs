/**
 * Pre-build TiddlyWiki empty HTML at development/CI time using TW's own render engine.
 * This renders `$:/core/save/empty` which produces a complete HTML with boot kernel + system tiddlers ($:/core, themes) embedded in the store area.
 *
 * Usage: zx scripts/buildTiddlyWikiAssets.mjs
 *
 * Output:
 *   assets/tiddlywiki/tiddlywiki-empty.html — complete boot HTML with $:/core + themes embedded
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { mkdirSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const require = createRequire(import.meta.url);

/**
 * Resolve the tiddlywiki npm package root directory.
 * Only uses npm — no workspace repo fallback, so CI works identically to local dev.
 */
function findTiddlyWikiPath() {
  const bootPath = require.resolve('tiddlywiki/boot/boot.js');
  const twPath = resolve(bootPath, '..', '..');
  console.log('Using TiddlyWiki npm package:', twPath);
  return twPath;
}

/**
 * Boot TiddlyWiki with the empty edition and return the $tw object.
 * The empty edition includes $:/core + vanilla/snowwhite themes.
 */
function bootTiddlyWiki(twPath) {
  return new Promise((resolve, reject) => {
    try {
      const $tw = require(twPath + '/boot/boot.js').TiddlyWiki();
      $tw.boot.argv = [twPath + '/editions/empty'];
      $tw.boot.boot(function() {
        resolve($tw);
      });
    } catch (error) {
      reject(error);
    }
  });
}

// ─── Main ──────────────────────────────────────────────────────────────────────

const twPath = findTiddlyWikiPath();
console.log('Booting TiddlyWiki from empty edition...');
const $tw = await bootTiddlyWiki(twPath);
console.log('TiddlyWiki booted, version:', $tw.version);

// Use TW's own rendering engine to render $:/core/save/empty
// This produces a complete HTML with: boot kernel + system tiddler store (core + themes)
const emptyHtml = $tw.wiki.renderTiddler('text/plain', '$:/core/save/empty');
console.log(`Rendered $:/core/save/empty: ${(emptyHtml.length / 1024).toFixed(1)} KB`);

// Write the single HTML asset
const outDir = resolve(projectRoot, 'assets', 'tiddlywiki');
mkdirSync(outDir, { recursive: true });

const htmlPath = resolve(outDir, 'tiddlywiki-empty.html');
writeFileSync(htmlPath, emptyHtml, 'utf8');
console.log(`Wrote ${htmlPath} (${(emptyHtml.length / 1024 / 1024).toFixed(2)} MB)`);

// Write version info for CopyDebugInfoButton
const versionInfo = {
  tiddlywikiVersion: $tw.version,
  buildDate: new Date().toISOString(),
};
const versionPath = resolve(outDir, 'version.json');
writeFileSync(versionPath, JSON.stringify(versionInfo, null, 2), 'utf8');
console.log(`Wrote ${versionPath}`);

console.log('Done!');

