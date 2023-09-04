import * as SQLite from 'expo-sqlite';
import { getWikiSkinnyTiddlerTextSqliteName } from '../../constants/paths';
import { IWikiWorkspace } from '../../store/wiki';

export async function createTable(workspace: IWikiWorkspace) {
  const database = SQLite.openDatabase(getWikiSkinnyTiddlerTextSqliteName(workspace));

  // table for storing skinny tiddlers that will change frequently and will be synced to server
  await database.execAsync([{ sql: 'CREATE TABLE IF NOT EXISTS tiddlers (title TEXT PRIMARY KEY, text TEXT, fields TEXT);', args: [] }], false);
  database.closeAsync();
}
