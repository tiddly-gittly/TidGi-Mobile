import { Writable } from 'readable-stream';
import Chain, { chain } from 'stream-chain';
import JsonlParser from 'stream-json/jsonl/Parser';
import Batch from 'stream-json/utils/Batch';
import type { ITiddlerFields } from 'tiddlywiki';
import { DataSource, EntityManager } from 'typeorm';
import { getWikiTiddlerSkinnyStoreCachePath, getWikiTiddlerTextStoreCachePath } from '../../constants/paths';
import { sqliteServiceService } from '../../services/SQLiteService';
import { IWikiWorkspace } from '../../store/workspace';
import { createReadStream } from './ExpoReadStream';

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

export type ISkinnyTiddler = ITiddlerFields & { _is_skinny: ''; bag: 'default'; revision: '0' };
export type ISkinnyTiddlersJSON = ISkinnyTiddler[];
export type ISkinnyTiddlersJSONBatch = Array<{ key: number; value: ISkinnyTiddler }>;
export type ITiddlerTextsJSONBatch = Array<{ key: number; value: Pick<ITiddlerFields, 'title' | 'text'> }>;

async function storeFieldsToSQLite(database: DataSource, workspace: IWikiWorkspace, setProgress: (progress: number) => void = () => {}) {
  setProgress(0);
  await database.transaction(async tx => {
    let batchedTiddlerFieldsStream: Chain;
    try {
      batchedTiddlerFieldsStream = chain([
        createReadStream(getWikiTiddlerSkinnyStoreCachePath(workspace)),
        new JsonlParser(),
        new Batch({ batchSize: BATCH_SIZE_2 }),
      ]);
    } catch (error) {
      throw new Error(`storeFieldsToSQLite() Failed to read tiddler text store, ${(error as Error).message}`);
    }
    const sqliteWriteStream = new Writable({
      objectMode: true,
      write: async (chunk: ISkinnyTiddlersJSONBatch, encoding, callback) => {
        try {
          await insertTiddlerFieldsBatch(tx, chunk.map(item => item.value));
          callback();
        } catch (error) {
          throw new Error(`storeFieldsToSQLite() Insert text to SQLite batch error: ${(error as Error).message} ${(error as Error).stack ?? ''}`);
        }
      },
    });
    batchedTiddlerFieldsStream.pipe(sqliteWriteStream);
    // wait for stream to finish before exit the transaction
    await new Promise<void>((resolve, reject) => {
      batchedTiddlerFieldsStream.on('end', () => {
        resolve();
      });
      batchedTiddlerFieldsStream.on('error', (error) => {
        reject(error);
      });
    });
  });
}
async function storeTextToSQLite(database: DataSource, workspace: IWikiWorkspace, setProgress: (progress: number) => void = () => {}) {
  setProgress(0);
  await database.transaction(async tx => {
    let batchedTiddlerTextStream: Chain;
    try {
      // stream result to prevent OOM
      batchedTiddlerTextStream = chain([
        createReadStream(getWikiTiddlerTextStoreCachePath(workspace)),
        new JsonlParser(),
        new Batch({ batchSize: BATCH_SIZE_2 }),
      ]);
    } catch (error) {
      throw new Error(`storeTextToSQLite() Failed to read tiddler text store, ${(error as Error).message}`);
    }
    // Use temp table to speed up update. Can't directly batch update existing rows, SQLite can only batch insert non-existing rows.
    await tx.query('CREATE TEMPORARY TABLE tempTiddlers (title TEXT PRIMARY KEY, text TEXT);');
    const sqliteWriteStream = new Writable({
      objectMode: true,
      write: async (chunk: ITiddlerTextsJSONBatch, encoding, callback) => {
        try {
          await insertTiddlerTextsBatch(tx, chunk.map(item => item.value));
          callback();
        } catch (error) {
          throw new Error(`storeTextToSQLite() Insert text to SQLite batch error: ${(error as Error).message} ${(error as Error).stack ?? ''}`);
        }
      },
    });
    batchedTiddlerTextStream.pipe(sqliteWriteStream);
    // wait for stream to finish before exit the transaction
    await new Promise<void>((resolve, reject) => {
      batchedTiddlerTextStream.on('end', () => {
        resolve();
      });
      batchedTiddlerTextStream.on('error', (error) => {
        reject(error);
      });
    });
    await tx.query(`
        UPDATE tiddlers 
        SET text = (SELECT text FROM tempTiddlers WHERE tempTiddlers.title = tiddlers.title)
        WHERE title IN (SELECT title FROM tempTiddlers)
    `);
    await tx.query('DROP TABLE tempTiddlers;');
    setProgress(1);
  });
}

/**
 * Insert a single batch
 */
async function insertTiddlerFieldsBatch(tx: EntityManager, batch: ISkinnyTiddler[]) {
  const placeholders = batch.map(() => '(?, ?)').join(',');
  const query = `INSERT INTO tiddlers (title, fields) VALUES ${placeholders};`;

  // TODO: let server provide stringified row and title, so we don't need to stringify here
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
