import { Paths } from 'expo-file-system';
import type { IWikiWorkspace } from '../store/workspace';

/**
 * Wiki storage base path. Uses app-internal document directory which is always
 * writable without extra permissions. Users can migrate to a user-accessible
 * location via the Storage Location settings.
 */
export const WIKI_FOLDER_PATH = `${Paths.document.uri}wikis/`;

/**
 * Get the effective wiki folder path, considering user's custom selection.
 * Must be called at runtime (not module init) to access store state.
 */
export function getEffectiveWikiFolderPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
  const { useWorkspaceStore } = require('../store/workspace');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
  const customPath = useWorkspaceStore.getState().customWikiFolderPath;
  if (customPath) {
    // Ensure the custom path ends with '/' for proper directory handling
    return customPath.endsWith('/') ? customPath : `${customPath}/`;
  }
  return WIKI_FOLDER_PATH;
}

export const APP_CACHE_FOLDER_PATH = `${Paths.cache.uri}/`;
export const getWikiTiddlerFolderPath = (workspace: IWikiWorkspace) => `${workspace.wikiFolderLocation}/tiddlers/`;
export const getWikiFilesFolderPath = (workspace: IWikiWorkspace) => `${workspace.wikiFolderLocation}/files/`;
/**
 * Get file path like `file:///data/user/0/host.exp.exponent/files/wikis/wiki_88370/tiddlers/TiddlyWikiIconBlack.png`
 * Will make sure filename don't have invalid characters.
 */
const INVALID_CHARACTERS_REGEX = /["#%&'*/:<=>?\\{}]/g;
export const getWikiTiddlerPathByTitle = (workspace: IWikiWorkspace, title: string) => `${getWikiTiddlerFolderPath(workspace)}${title.replaceAll(INVALID_CHARACTERS_REGEX, '_')}`;
export const getWikiFilesPathByTitle = (workspace: IWikiWorkspace, title: string) => `${getWikiFilesFolderPath(workspace)}${title.replaceAll(INVALID_CHARACTERS_REGEX, '_')}`;
/**
 * Return file path like `file:///data/user/0/host.exp.exponent/files/wikis/wiki_88370/files/TiddlyWikiIconBlack.png`, similar to `getWikiFilesFolderPath`, but canonicalUri should bring its own `files/` prefix.
 */
export const getWikiFilesPathByCanonicalUri = (workspace: IWikiWorkspace, canonicalUri: string) => `${workspace.wikiFolderLocation}/${canonicalUri}`;
export const SYSTEM_STORE_CACHE_NAME = 'system-tiddlerStore.json';
/**
 * non-skinny tiddlers, like system tiddlers and state tiddlers.
 */
export const getWikiTiddlerStorePath = (workspace: IWikiWorkspace) => `${getWikiCacheFolderPath(workspace)}${workspace.id}-${SYSTEM_STORE_CACHE_NAME}`;
export const WIKI_SMALL_TEXT_STORE_CACHE_NAME = 'text-tiddlerStore.json';
export const WIKI_SKINNY_TIDDLER_STORE_CACHE_NAME = 'skinny-tiddlerStore.json';
export const WIKI_BINARY_TIDDLERS_LIST_CACHE_NAME = 'binaryTiddlersList.json';
export const getWikiCacheFolderPath = (workspace: IWikiWorkspace) => `${Paths.cache.uri}/${workspace.id}/`;
export const PERSIST_STORAGE_PATH = `${Paths.document.uri}persistStorage/`;
/**
 * We download json to the cache folder (batch download as a single json is faster), then move it to the sqlite later.
 */
export const getWikiTiddlerSkinnyStoreCachePath = (workspace: IWikiWorkspace) => `${getWikiCacheFolderPath(workspace)}${workspace.id}-${WIKI_SKINNY_TIDDLER_STORE_CACHE_NAME}`;
export const getWikiTiddlerTextStoreCachePath = (workspace: IWikiWorkspace) => `${getWikiCacheFolderPath(workspace)}${workspace.id}-${WIKI_SMALL_TEXT_STORE_CACHE_NAME}`;
export const getWikiBinaryTiddlersListCachePath = (workspace: IWikiWorkspace) => `${getWikiCacheFolderPath(workspace)}${workspace.id}-${WIKI_BINARY_TIDDLERS_LIST_CACHE_NAME}`;
export const TEMPLATE_LIST_NAME = 'templateList.json';
export const HELP_PAGE_LIST_NAME = 'helpPageList.json';
export const templateListCachePath = `${APP_CACHE_FOLDER_PATH}${TEMPLATE_LIST_NAME}`;
export const helpPageListCachePath = `${APP_CACHE_FOLDER_PATH}${HELP_PAGE_LIST_NAME}`;
