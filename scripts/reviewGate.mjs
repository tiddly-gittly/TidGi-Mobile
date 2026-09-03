#!/usr/bin/env node

/**
 * Lightweight review-class gate for the mobile boundary code.
 *
 * Policy:
 *  - production source (src, excluding tests) may not contain an empty catch
 *    or empty promise rejection handler;
 *  - MemeLoop integration/storage modules may not use `as unknown as` or
 *    `as never` to bypass their typed ports;
 *  - E2E fixed sleeps are rejected. Polling helpers with a variable interval
 *    are not fixed sleeps and are left alone;
 *  - review-gate exception markers are forbidden. Empty and comment-only
 *    handlers must report or otherwise handle their failure.
 *
 * The escape-hatch scan covers all production source; JSON/runtime decoding
 * should use a guard or typed adapter, while tests remain free to construct
 * fixtures with assertions.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);
const FORBIDDEN_REVIEW_MARKER = /review-gate:\s*allow-[\w-]+\b/giu;
const TEST_PATH = /(?:^|[/\\])(?:__tests__|e2e|tests?)(?:[/\\]|$)|(?:\.(?:test|spec))\.[^.]+$/iu;
const PRODUCTION_ROOTS = ['src', 'app', 'lib', 'plugins/src']
  .map(directory => path.join(ROOT, directory))
  .filter(directory => fs.existsSync(directory));

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(fullPath);
  }
  return files;
}

function relative(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/');
}

function lineNumber(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function lineAt(source, offset) {
  const start = source.lastIndexOf('\n', offset - 1) + 1;
  const end = source.indexOf('\n', offset);
  return source.slice(start, end < 0 ? source.length : end);
}

function stripComments(value) {
  return value
    .replace(/\/\/[^\n]*/gu, '')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .trim();
}

function addFinding(findings, filePath, source, offset, rule, detail) {
  findings.push(`${relative(filePath)}:${lineNumber(source, offset)} ${rule}: ${detail}`);
}

function scanProductionSource(filePath, source, findings) {
  for (const match of source.matchAll(FORBIDDEN_REVIEW_MARKER)) {
    addFinding(findings, filePath, source, match.index ?? 0, 'forbidden-review-marker', 'remove review-gate allow markers and handle the failure explicitly');
  }

  // Truly empty and comment-only catch bodies are blocked.
  for (const match of source.matchAll(/\bcatch\s*(?:\([^)]*\))?\s*\{(?<body>[^{}]*)\}/gu)) {
    const body = match.groups?.body ?? '';
    if (stripComments(body).trim() !== '') continue;
    const offset = match.index ?? 0;
    if (lineAt(source, offset).trim().startsWith('//')) continue;
    addFinding(findings, filePath, source, offset, 'empty-catch', 'add observable handling');
  }

  // Empty promise rejection handlers are the equivalent fail-open pattern.
  for (const match of source.matchAll(/\.catch\(\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{(?<body>[^{}]*)\}\s*\)/gu)) {
    const body = match.groups?.body ?? '';
    if (stripComments(body).trim() !== '') continue;
    const offset = match.index ?? 0;
    if (lineAt(source, offset).trim().startsWith('//')) continue;
    addFinding(findings, filePath, source, offset, 'empty-rejection', 'add observable handling');
  }

  for (const match of source.matchAll(/\bas\s+(?:unknown\s+as|never|any)\b/gu)) {
    const offset = match.index ?? 0;
    const line = lineAt(source, offset);
    if (line.trim().startsWith('//')) continue;
    addFinding(findings, filePath, source, offset, 'escape-hatch', 'replace with a typed adapter');
  }
}

const findings = [];
const productionFiles = PRODUCTION_ROOTS
  .flatMap(directory => walk(directory))
  .filter(filePath => !TEST_PATH.test(relative(filePath)));
const e2eRoot = path.join(ROOT, 'e2e');
const allSourceFiles = [...productionFiles, ...(fs.existsSync(e2eRoot) ? walk(e2eRoot) : [])];

for (const filePath of allSourceFiles) {
  const source = fs.readFileSync(filePath, 'utf8');
  const isProduction = productionFiles.includes(filePath);

  if (isProduction) {
    scanProductionSource(filePath, source, findings);
  } else {
    for (const match of source.matchAll(FORBIDDEN_REVIEW_MARKER)) {
      addFinding(findings, filePath, source, match.index ?? 0, 'forbidden-review-marker', 'remove review-gate exception markers and handle the failure explicitly');
    }
  }
}

// Fixed waits are checked only in E2E code. A variable-interval polling loop
// is intentionally not matched; direct literal sleeps must be replaced with
// an observable event wait.
for (const filePath of fs.existsSync(e2eRoot) ? walk(e2eRoot) : []) {
  const source = fs.readFileSync(filePath, 'utf8');
  for (const match of source.matchAll(/new\s+Promise(?:<[^>]+>)?\s*\(\s*(?:resolve|r)\s*=>\s*setTimeout\(\s*(?:resolve|r)\s*,\s*\d[\d_]*\s*\)\s*\)/gu)) {
    const offset = match.index ?? 0;
    addFinding(findings, filePath, source, offset, 'fixed-e2e-sleep', 'wait for an observable event');
  }
}

function runSelfTests() {
  const cases = [
    ['comment-only catch', 'try { work(); } catch (error) { /* ignored */ }', 'empty-catch'],
    ['parameterized catch', 'try { work(); } catch (error) { /* ignored */ }', 'empty-catch'],
    ['async promise rejection', 'void promise.catch(async (error) => { /* ignored */ });', 'empty-rejection'],
    ['handled catch', 'try { work(); } catch (error) { logger.warn(error); }', undefined],
  ];
  for (const [name, source, expectedRule] of cases) {
    const localFindings = [];
    scanProductionSource(path.join(ROOT, `${name}.ts`), source, localFindings);
    if (expectedRule === undefined) {
      assert.equal(localFindings.length, 0, `${name} should be accepted`);
    } else {
      assert.ok(localFindings.some(finding => finding.includes(` ${expectedRule}:`)), `${name} should be rejected`);
    }
  }
  const markerFindings = [];
  scanProductionSource(path.join(ROOT, 'marker.ts'), 'try { work(); } catch { /* review-gate: allow-empty-catch reason */ }', markerFindings);
  assert.ok(markerFindings.some(finding => finding.includes('forbidden-review-marker:')), 'allow marker should be rejected');
}

if (process.argv.includes('--self-test')) {
  runSelfTests();
  console.log('[review-gate] self-tests passed (comment-only catch, parameterized catch, async rejection, markers)');
}

const forbiddenProductionTokens = [
  ['migrateLegacyMobileGitAttributes', 'old mobile Git attributes migration was removed'],
  ['removeLegacyMobileLfAttributesRule', 'old mobile Git attributes rule was removed'],
];
for (const filePath of productionFiles) {
  const source = fs.readFileSync(filePath, 'utf8');
  for (const [token, detail] of forbiddenProductionTokens) {
    const offset = source.indexOf(token);
    if (offset >= 0) addFinding(findings, filePath, source, offset, 'removed-compatibility-token', detail);
  }
}

if (findings.length > 0) {
  console.error('[review-gate] blocked:\n' + findings.sort().map(item => `  - ${item}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('[review-gate] passed (empty handlers, unsafe casts, fixed E2E sleeps, and removed compatibility tokens)');
}
