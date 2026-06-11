export function normalizeGitCloneUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  if (parsed.hostname.toLowerCase() === 'github.com' && !parsed.pathname.endsWith('.git')) {
    parsed.pathname = `${parsed.pathname}.git`;
  }
  return parsed.toString();
}

export function hashGitCloneUrl(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

export function buildGitCloneCacheDirectory(cacheRoot: string, cloneUrl: string): string {
  const normalizedUrl = normalizeGitCloneUrl(cloneUrl);
  const root = cacheRoot.endsWith('/') ? cacheRoot : `${cacheRoot}/`;
  return `${root}${hashGitCloneUrl(normalizedUrl)}/`;
}

export function toFileCloneUrl(directory: string): string {
  const plainPath = directory.replace(/^file:\/\//, '').replace(/\/+$/, '');
  return `file://${plainPath.startsWith('/') ? plainPath : `/${plainPath}`}`;
}
