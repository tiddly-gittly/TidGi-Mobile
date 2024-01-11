import * as fs from 'expo-file-system';
import type { IWikiWorkspace } from '../store/workspace';

export const WIKI_FOLDER_PATH = fs.documentDirectory === null ? undefined : `${fs.documentDirectory}wikis/`;
export const WIKI_FILE_NAME = 'index.html';
export const getWikiFilePath = (workspace: IWikiWorkspace) => `${workspace.wikiFolderLocation}/${WIKI_FILE_NAME}`;
export const getWikiTiddlerFolderPath = (workspace: IWikiWorkspace) => `${workspace.wikiFolderLocation}/tiddlers/`;
/**
 * Get file path like `file:///data/user/0/host.exp.exponent/files/wikis/wiki_88370/tiddlers/TiddlyWikiIconBlack.png`
 * Will make sure filename don't have invalid characters.
 */
export const getWikiTiddlerPathByTitle = (workspace: IWikiWorkspace, title: string) => `${getWikiTiddlerFolderPath(workspace)}${title.replaceAll(/["'*/:<>?\\{}]/g, '_')}`;
export const WIKI_STORE_NAME = 'tiddlerStore.json';
/**
 * This JSON is used as-is, so should be a valid JSON, instead of JSON-Line.
 */
export const getWikiTiddlerStorePath = (workspace: IWikiWorkspace) => `${workspace.wikiFolderLocation}/${WIKI_STORE_NAME}`;
export const WIKI_SMALL_TEXT_STORE_CACHE_NAME = 'text-tiddlerStore.json';
export const WIKI_SKINNY_TIDDLER_STORE_CACHE_NAME = 'skinny-tiddlerStore.json';
export const WIKI_BINARY_TIDDLERS_LIST_CACHE_NAME = 'binaryTiddlersList.json';
export const getWikiCacheFolderPath = (workspace: IWikiWorkspace) => `${fs.cacheDirectory ?? `${workspace.wikiFolderLocation}/cache/`}`;
/**
 * We download json to the cache folder (batch download as a single json is faster), then move it to the sqlite later.
 */
export const getWikiTiddlerSkinnyStoreCachePath = (workspace: IWikiWorkspace) => `${getWikiCacheFolderPath(workspace)}${workspace.id}-${WIKI_SKINNY_TIDDLER_STORE_CACHE_NAME}`;
export const getWikiTiddlerTextStoreCachePath = (workspace: IWikiWorkspace) => `${getWikiCacheFolderPath(workspace)}${workspace.id}-${WIKI_SMALL_TEXT_STORE_CACHE_NAME}`;
export const getWikiBinaryTiddlersListCachePath = (workspace: IWikiWorkspace) => `${getWikiCacheFolderPath(workspace)}${workspace.id}-${WIKI_BINARY_TIDDLERS_LIST_CACHE_NAME}`;
export const WIKI_MAIN_SQLITE_NAME = 'sqlite.db';
/**
 * Will be store to `${fs.documentDirectory}/SQLite/${name}`
 * @url https://docs.expo.dev/versions/latest/sdk/sqlite/#sqliteopendatabasename-version-description-size-callback
 */
export const getWikiMainSqliteName = (workspace: IWikiWorkspace) => `${workspace.id}-${WIKI_MAIN_SQLITE_NAME}`;
export const getWikiMainSqlitePath = (workspace: IWikiWorkspace) => `${fs.documentDirectory!}/SQLite/${getWikiMainSqliteName(workspace)}`;
