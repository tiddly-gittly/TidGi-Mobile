import * as fs from 'expo-file-system';
import type { IWikiWorkspace } from '../store/wiki';

export const WIKI_FOLDER_PATH = fs.documentDirectory === null ? undefined : `${fs.documentDirectory}wikis/`;
export const WIKI_FILE_NAME = 'index.html';
export const getWikiFilePath = (workspace: IWikiWorkspace) => `${workspace.wikiFolderLocation}/${WIKI_FILE_NAME}`;
export const WIKI_STORE_NAME = 'store.html';
export const getWikiTiddlerStorePath = (workspace: IWikiWorkspace) => `${workspace.wikiFolderLocation}/${WIKI_STORE_NAME}`;
