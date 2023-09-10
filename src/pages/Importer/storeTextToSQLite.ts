import * as fs from 'expo-file-system';
import type { ITiddlerFields } from 'tiddlywiki';
import { DataSource, EntityManager } from 'typeorm';
import { getWikiTiddlerSkinnyStoreCachePath, getWikiTiddlerTextStoreCachePath } from '../../constants/paths';
import { sqliteServiceService } from '../../services/SQLiteService';
import { IWikiWorkspace } from '../../store/wiki';

export interface ITiddlerTextOnly {
  text: string;
  title: string;
}
export type ITiddlerTextJSON = ITiddlerTextOnly[];

export async function storeTiddlersToSQLite(workspace: IWikiWorkspace, setProgress: { fields: (progress: number) => void; text: (progress: number) => void }) {
  const database = await sqliteServiceService.getDatabase(workspace);
  // skinny tiddler >= skinny tiddler with text, so we insert skinny tiddlers first, and update text later with title as id
  await storeFieldsToSQLite(database, workspace, setProgress.fields);
  await storeTextToSQLite(database, workspace, setProgress.text);
  await sqliteServiceService.closeDatabase(workspace);
}

const BATCH_SIZE_2 = 499; // Max variable count is 999 by default, We divide by 2 as we have 2 fields to insert (title, text) each time for each row

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

export type ISkinnyTiddler = ITiddlerFields & { _is_skinny: ''; bag: 'default'; revision: '0' };
export type ISkinnyTiddlersJSON = ISkinnyTiddler[];

async function storeFieldsToSQLite(database: DataSource, workspace: IWikiWorkspace, setProgress: (progress: number) => void = () => {}) {
  await database.transaction(async tx => {
    let tiddlerFieldsJSON: ISkinnyTiddlersJSON;
    try {
      const skinnyTiddlerFields = await fs.readAsStringAsync(getWikiTiddlerSkinnyStoreCachePath(workspace));
      // TODO: stream result to prevent OOM
      tiddlerFieldsJSON = JSON.parse(skinnyTiddlerFields) as ISkinnyTiddlersJSON;
    } catch (error) {
      throw new Error(`Failed to read tiddler text store, ${(error as Error).message}`);
    }
    setProgress(0);
    const batches = createTiddlerArrayBatches(tiddlerFieldsJSON, BATCH_SIZE_2);
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
async function storeTextToSQLite(database: DataSource, workspace: IWikiWorkspace, setProgress: (progress: number) => void = () => {}) {
  await database.transaction(async tx => {
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
    // Use temp table to speed up update. Can't directly batch update existing rows, SQLite can only batch insert non-existing rows.
    await tx.query('CREATE TEMPORARY TABLE tempTiddlers (title TEXT PRIMARY KEY, text TEXT);');
    for (let index = 0; index < batchLength; index++) {
      try {
        await insertTiddlerTextsBatch(tx, batches[index]);
        setProgress((index + 1) / batchLength);
      } catch (error) {
        throw new Error(`Insert text to SQLite batch error: ${(error as Error).message} ${(error as Error).stack ?? ''}`);
      }
    }
    await tx.query(`
        UPDATE tiddlers 
        SET text = (SELECT text FROM tempTiddlers WHERE tempTiddlers.title = tiddlers.title)
        WHERE title IN (SELECT title FROM tempTiddlers)
    `);
    await tx.query('DROP TABLE tempTiddlers;');
  });
}

/**
 * Insert a single batch
 */
async function insertTiddlerFieldsBatch(tx: EntityManager, batch: ISkinnyTiddler[]) {
  const placeholders = batch.map(() => '(?, ?)').join(',');
  const query = `INSERT INTO tiddlers (title, fields) VALUES ${placeholders};`;

  const bindParameters = batch.flatMap(row => [row.title, JSON.stringify(row)]);

  await tx.query(query, bindParameters);
}
/**
 * Insert a single batch
 */
async function insertTiddlerTextsBatch(tx: EntityManager, batch: ITiddlerTextOnly[]) {
  const placeholders = batch.map(() => '(?, ?)').join(',');
  const query = `INSERT INTO tempTiddlers (title, text) VALUES ${placeholders};`;
  const bindParameters = batch.flatMap(row => [row.title, row.text]);
  await tx.query(query, bindParameters);
}
