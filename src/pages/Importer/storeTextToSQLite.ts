import * as fs from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import type { ITiddlerFields } from 'tiddlywiki';
import { getWikiSkinnyTiddlerTextSqliteName, getWikiTiddlerSkinnyStoreCachePath, getWikiTiddlerTextStoreCachePath } from '../../constants/paths';
import { IWikiWorkspace } from '../../store/wiki';

export interface ITiddlerTextOnly {
  text: string;
  title: string;
}
export type ITiddlerTextJSON = ITiddlerTextOnly[];

export async function storeTiddlersToSQLite(workspace: IWikiWorkspace, setProgress: { fields: (progress: number) => void; text: (progress: number) => void }) {
  const database = SQLite.openDatabase(getWikiSkinnyTiddlerTextSqliteName(workspace));
  // skinny tiddler >= skinny tiddler with text, so we insert skinny tiddlers first, and update text later with title as id
  await storeFieldsToSQLite(database, workspace, setProgress.fields);
  await storeTextToSQLite(database, workspace, setProgress.text);
  database.closeAsync();
}
async function storeTextToSQLite(database: SQLite.SQLiteDatabase, workspace: IWikiWorkspace, setProgress: (progress: number) => void = () => {}) {
  await database.transactionAsync(async tx => {
    let tiddlerTextsJSON: ITiddlerTextJSON;
    try {
      const tiddlerTexts = await fs.readAsStringAsync(getWikiTiddlerTextStoreCachePath(workspace));
      // TODO: stream result to prevent OOM
      tiddlerTextsJSON = JSON.parse(tiddlerTexts) as ITiddlerTextJSON;
    } catch (error) {
      throw new Error(`Failed to read tiddler text store, ${(error as Error).message}`);
    }
    setProgress(0);
    const batches = createTiddlerArrayBatches(tiddlerTextsJSON, BATCH_SIZE_2);
    const batchLength = batches.length;
    for (let index = 0; index < batchLength; index++) {
      try {
        await insertTiddlerTextsBatch(tx, batches[index]);
        setProgress((index + 1) / batchLength);
      } catch (error) {
        throw new Error(`Insert text to SQLite batch error: ${(error as Error).message} ${(error as Error).stack ?? ''}`);
      }
    }
  });
}

const BATCH_SIZE_2 = 499; // Max is 999, We divide by 2 as we have 2 fields to insert (title, text) each time for each row
const BATCH_SIZE_3 = 333; // Max is 333, We divide by 3 as we have 3 fields to insert (title, text) each time for each row

/**
 * Split the data into batches
 */
function createTiddlerArrayBatches(data: ISkinnyTiddlersJSON, batchSize: number): ISkinnyTiddler[][];
function createTiddlerArrayBatches(data: ITiddlerTextJSON, batchSize: number): ITiddlerTextOnly[][];
function createTiddlerArrayBatches(data: ITiddlerTextJSON | ISkinnyTiddlersJSON, batchSize: number) {
  const batches = [];
  for (let index = 0; index < data.length; index += batchSize) {
    batches.push(data.slice(index, index + batchSize));
  }
  return batches;
}
/**
 * Insert a single batch
 */
async function insertTiddlerTextsBatch(tx: SQLite.SQLTransactionAsync, batch: ITiddlerTextOnly[]) {
  const simpleUpdateQuery = `UPDATE tiddlers SET text = ? WHERE title = ?;`;
  for (const tiddler of batch) {
    await tx.executeSqlAsync(simpleUpdateQuery, [tiddler.text, tiddler.title]);
  }
}

export type ISkinnyTiddler = ITiddlerFields & { _is_skinny: ''; bag: 'default'; revision: '0' };
export type ISkinnyTiddlersJSON = ISkinnyTiddler[];

async function storeFieldsToSQLite(database: SQLite.SQLiteDatabase, workspace: IWikiWorkspace, setProgress: (progress: number) => void = () => {}) {
  await database.transactionAsync(async tx => {
    let tiddlerFieldsJSON: ISkinnyTiddlersJSON;
    try {
      const skinnyTiddlerFields = await fs.readAsStringAsync(getWikiTiddlerSkinnyStoreCachePath(workspace));
      // TODO: stream result to prevent OOM
      tiddlerFieldsJSON = JSON.parse(skinnyTiddlerFields) as ISkinnyTiddlersJSON;
    } catch (error) {
      throw new Error(`Failed to read tiddler text store, ${(error as Error).message}`);
    }
    setProgress(0);
    const batches = createTiddlerArrayBatches(tiddlerFieldsJSON, BATCH_SIZE_3);
    const batchLength = batches.length;
    for (let index = 0; index < batchLength; index++) {
      try {
        await insertTiddlerFieldsBatch(tx, batches[index]);
        setProgress((index + 1) / batchLength);
      } catch (error) {
        throw new Error(`Insert text to SQLite batch error: ${(error as Error).message} ${(error as Error).stack ?? ''}`);
      }
    }
  });
}
/**
 * Insert a single batch
 */
async function insertTiddlerFieldsBatch(tx: SQLite.SQLTransactionAsync, batch: ISkinnyTiddler[]) {
  const placeholders = batch.map(() => '(?, ?)').join(',');
  const query = `INSERT INTO tiddlers (title, fields) VALUES ${placeholders};`;

  const bindParameters = batch.flatMap(row => [row.title, JSON.stringify(row)]);

  return await tx.executeSqlAsync(query, bindParameters);
}
