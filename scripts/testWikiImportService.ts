import {
  buildGitCloneCacheDirectory,
  normalizeGitCloneUrl,
  toFileCloneUrl,
} from '../src/services/WikiImportService/gitCloneCacheUtils';

function assertEqual(actual: string, expected: string, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

assertEqual(
  normalizeGitCloneUrl('https://github.com/tiddly-gittly/Tiddlywiki-NodeJS-Github-Template/'),
  'https://github.com/tiddly-gittly/Tiddlywiki-NodeJS-Github-Template.git',
  'GitHub repo URL normalization',
);

assertEqual(
  normalizeGitCloneUrl('https://github.com/foo/bar.git'),
  'https://github.com/foo/bar.git',
  'GitHub .git URL unchanged',
);

assertEqual(
  toFileCloneUrl('file:///data/user/0/app/cache/git-clone-cache/abc/'),
  'file:///data/user/0/app/cache/git-clone-cache/abc',
  'file clone URL strips trailing slash',
);

const cacheA = buildGitCloneCacheDirectory('/cache/git-clone-cache/', 'https://github.com/foo/bar.git');
const cacheB = buildGitCloneCacheDirectory('/cache/git-clone-cache/', 'https://github.com/foo/bar/');
assertEqual(cacheA, cacheB, 'Cache directory stable across trailing slash variants');

console.log('WikiImportService checks passed.');
