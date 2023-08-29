import * as fs from 'expo-file-system';

export const WIKI_FOLDER_PATH = fs.documentDirectory === null ? undefined : `${fs.documentDirectory}wikis/`;
