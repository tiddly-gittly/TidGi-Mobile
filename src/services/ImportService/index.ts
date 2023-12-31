import { Writable } from 'readable-stream';
import Chain, { chain } from 'stream-chain';
import JsonlParser from 'stream-json/jsonl/Parser';
import Batch from 'stream-json/utils/Batch';
import { DataSource, EntityManager } from 'typeorm';
import { getWikiTiddlerSkinnyStoreCachePath, getWikiTiddlerTextStoreCachePath } from '../../constants/paths';
import { sqliteServiceService } from '../../services/SQLiteService';
import { IWikiWorkspace } from '../../store/workspace';
import { createReadStream } from './ExpoReadStream';
import { ISkinnyTiddler, ISkinnyTiddlersJSONBatch, ITiddlerTextOnly, ITiddlerTextsJSONBatch } from './types';

/**
 * Service for importing wiki from TidGi Desktop or nodejs server
 */
export class ImportService {
  public async storeTiddlersToSQLite(workspace: IWikiWorkspace, setProgress: { fields: (progress: number) => void; text: (progress: number) => void }) {
    const database = await sqliteServiceService.getDatabase(workspace);
    // skinny tiddler >= skinny tiddler with text, so we insert skinny tiddlers first, and update text later with title as id
    await this.storeFieldsToSQLite(database, workspace, setProgress.fields);
    await this.storeTextToSQLite(database, workspace, setProgress.text);
    await sqliteServiceService.closeDatabase(workspace);
  }

  /** Max variable count is 999 by default, We divide by 2 as we have 2 fields to insert (title, text) each time for each row */
  BATCH_SIZE_2 = 499;

  private async storeFieldsToSQLite(database: DataSource, workspace: IWikiWorkspace, setProgress: (progress: number) => void = () => {}) {
    setProgress(0);
    await database.transaction(async tx => {
      let batchedTiddlerFieldsStream: Chain;
      try {
        const readStream = createReadStream(getWikiTiddlerSkinnyStoreCachePath(workspace));
        readStream.on('progress', (progress: number) => {
          setProgress(progress);
        });
        batchedTiddlerFieldsStream = chain([
          readStream,
          new JsonlParser(),
          new Batch({ batchSize: this.BATCH_SIZE_2 }),
        ]);
      } catch (error) {
        throw new Error(`storeFieldsToSQLite() Failed to read tiddler text store, ${(error as Error).message}`);
      }
      const sqliteWriteStream = new Writable({
        objectMode: true,
        write: async (chunk: ISkinnyTiddlersJSONBatch, encoding, callback) => {
          try {
            await this.insertTiddlerFieldsBatch(tx, chunk.map(item => item.value));
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

  private async storeTextToSQLite(database: DataSource, workspace: IWikiWorkspace, setProgress: (progress: number) => void = () => {}) {
    setProgress(0);
    await database.transaction(async tx => {
      let batchedTiddlerTextStream: Chain;
      try {
        // stream result to prevent OOM
        const readStream = createReadStream(getWikiTiddlerTextStoreCachePath(workspace));
        readStream.on('progress', (progress: number) => {
          setProgress(progress);
        });
        batchedTiddlerTextStream = chain([
          readStream,
          new JsonlParser(),
          new Batch({ batchSize: this.BATCH_SIZE_2 }),
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
            await this.insertTiddlerTextsBatch(tx, chunk.map(item => item.value));
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
  private async insertTiddlerFieldsBatch(tx: EntityManager, batch: ISkinnyTiddler[]) {
    const placeholders = batch.map(() => '(?, ?)').join(',');
    const query = `INSERT INTO tiddlers (title, fields) VALUES ${placeholders};`;

    // TODO: let server provide stringified row and title, so we don't need to stringify here
    const bindParameters = batch.flatMap(row => [row.title, JSON.stringify(row)]);

    await tx.query(query, bindParameters);
  }

  /**
   * Insert a single batch
   */
  private async insertTiddlerTextsBatch(tx: EntityManager, batch: ITiddlerTextOnly[]) {
    const placeholders = batch.map(() => '(?, ?)').join(',');
    const query = `INSERT INTO tempTiddlers (title, text) VALUES ${placeholders};`;
    const bindParameters = batch.flatMap(row => [row.title, row.text]);

    await tx.query(query, bindParameters);
  }
}

export const importService = new ImportService();
