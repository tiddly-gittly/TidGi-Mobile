/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import { SQLiteDatabase, SQLiteStatement } from 'expo-sqlite';
import { Dispatch, SetStateAction } from 'react';
import { Writable } from 'readable-stream';
import Chain, { chain } from 'stream-chain';
import JsonlParser from 'stream-json/jsonl/Parser';
import StreamArray from 'stream-json/streamers/StreamArray';
import Batch from 'stream-json/utils/Batch';
import { getWikiBinaryTiddlersListCachePath, getWikiTiddlerSkinnyStoreCachePath, getWikiTiddlerStorePath, getWikiTiddlerTextStoreCachePath } from '../../constants/paths';
import { sqliteServiceService } from '../../services/SQLiteService';
import { IWikiWorkspace } from '../../store/workspace';
import { backgroundSyncService } from '../BackgroundSyncService';
import { createReadStream, ExpoReadStream } from './ExpoReadStream';
import { ISkinnyTiddler, ISkinnyTiddlersJSONBatch, ITiddlerTextOnly, ITiddlerTextsJSONBatch } from './types';

/**
 * Service for importing wiki from TidGi Desktop or nodejs server
 */
export class ImportService {
  public async storeTiddlersToSQLite(
    workspace: IWikiWorkspace,
    setProgress: {
      fields: (progress: number) => void;
      setError: Dispatch<SetStateAction<string | undefined>>;
      system: (progress: number) => void;
      text: (progress: number) => void;
    },
  ) {
    const { db } = await sqliteServiceService.getDatabase(workspace);
    await db.execAsync('PRAGMA journal_mode = OFF');
    // skinny tiddler >= skinny tiddler with text, so we insert skinny tiddlers first, and update text later with title as id
    // plugin files might be large, so store 10 by 10 to save memory
    try {
      await this.storeFieldsToSQLite(db, getWikiTiddlerStorePath(workspace), setProgress.system, { batchSize: 10 });
      await this.storeFieldsToSQLite(db, getWikiTiddlerSkinnyStoreCachePath(workspace), setProgress.fields);
    } finally {
      try {
        // will cause `Access to closed resource`, if this is created in a transaction
        // await Promise.all([...this.preparedForInsertTiddlerFieldsBatch].map(async ([_index, statement]) => {
        //   await statement.finalizeAsync();
        // }));
        this.preparedForInsertTiddlerFieldsBatch.clear();
      } catch (error) {
        console.error(`Failed to finalize prepared statement for InsertTiddlerFields ${(error as Error).message}`);
      }
    }
    try {
      await this.storeTextToSQLite(db, getWikiTiddlerTextStoreCachePath(workspace), setProgress.text);
    } finally {
      try {
        // await Promise.all([...this.preparedForInsertTiddlerTextsBatch].map(async ([_index, statement]) => {
        //   await statement.finalizeAsync();
        // }));
        this.preparedForInsertTiddlerTextsBatch.clear();
      } catch (error) {
        console.error(`Failed to finalize prepared statement for InsertTiddlerTexts ${(error as Error).message}`);
      }
    }
  }

  /** Max variable count is 999 by default, We divide by 2 as we have 2 fields to insert (title, text) each time for each row */
  BATCH_SIZE_2 = 499;

  /**
   * Store full json content as-is to `fields` in the sqlite.
   *
   * If json provided is skinny, `fields` won't include `text` field too, and should have `is_skinny` when preparing the JSON on serve side. Need to call `storeTextToSQLite` to store text later.
   * If json is full tiddler json, `fields` will have the full tiddler.
   */
  private async storeFieldsToSQLite(
    database: SQLiteDatabase,
    filePath: string,
    setProgress: (progress: number) => void = () => {},
    configs?: { batchSize?: number; jsonl?: boolean },
  ) {
    setProgress(0);
    let batchedTiddlerFieldsStream: Chain;
    let readStream: ExpoReadStream;
    try {
      readStream = createReadStream(filePath);
      readStream.on('progress', (progress: number) => {
        setProgress(progress);
      });
      await readStream.init();
      batchedTiddlerFieldsStream = chain([
        readStream,
        (configs?.jsonl ?? true) ? new JsonlParser() : StreamArray.withParser(),
        new Batch({ batchSize: configs?.batchSize ?? this.BATCH_SIZE_2 }),
      ]);
    } catch (error) {
      throw new Error(`storeFieldsToSQLite() Failed to read tiddler text store, ${(error as Error).message}`);
    }
    const sqliteWriteStream = new Writable({
      objectMode: true,
      write: async (chunk: ISkinnyTiddlersJSONBatch, encoding, next) => {
        try {
          await this.insertTiddlerFieldsBatch(database, chunk.map(item => item.value));
          next();
        } catch (error) {
          // if have any error, end the batch, not calling `next()`, to prevent dirty data
          sqliteWriteStream.emit('error', new Error(`storeFieldsToSQLite() error: ${(error as Error).message} ${(error as Error).stack ?? ''}`));
          readStream.destroy();
        }
      },
    });
    batchedTiddlerFieldsStream.pipe(sqliteWriteStream);
    // wait for stream to finish before exit the method
    let readEnded = false;
    let writeEnded = false;
    await new Promise<void>((resolve, reject) => {
      batchedTiddlerFieldsStream.on('end', () => {
        readEnded = true;
        if (writeEnded) resolve();
      });
      sqliteWriteStream.on('finish', () => {
        writeEnded = true;
        if (readEnded) resolve();
      });
      batchedTiddlerFieldsStream.on('error', (error) => {
        const newError = new Error(`storeFieldsToSQLite batchedTiddlerFieldsStream("${filePath}") error: ${(error).message} ${(error).stack ?? ''}`);
        reject(newError);
      });
      sqliteWriteStream.on('error', (error) => {
        const newError = new Error(`storeFieldsToSQLite sqliteWriteStream error: ${(error).message} ${(error).stack ?? ''}`);
        reject(newError);
      });
    });
  }

  private async storeTextToSQLite(database: SQLiteDatabase, filePath: string, setProgress: (progress: number) => void = () => {}) {
    setProgress(0);
    let batchedTiddlerTextStream: Chain;
    let readStream: ExpoReadStream;
    try {
      // stream result to prevent OOM
      readStream = createReadStream(filePath);
      readStream.on('progress', (progress: number) => {
        setProgress(progress);
      });
      await readStream.init();
      batchedTiddlerTextStream = chain([
        readStream,
        new JsonlParser(),
        new Batch({ batchSize: this.BATCH_SIZE_2 }),
      ]);
    } catch (error) {
      throw new Error(`storeTextToSQLite() Failed to read tiddler text store JSON file, ${(error as Error).message}`);
    }
    // Use temp table to speed up update. Can't directly batch update existing rows, SQLite can only batch insert non-existing rows.
    // await database.execAsync('CREATE TEMPORARY TABLE temp_tiddlers (title TEXT PRIMARY KEY, text TEXT);');
    const sqliteWriteStream = new Writable({
      objectMode: true,
      write: async (chunk: ITiddlerTextsJSONBatch, encoding, next) => {
        try {
          await this.insertTiddlerTextsBatch(database, chunk.map(item => item.value));
          next();
        } catch (error) {
          // if have any error, end the batch, not calling `next()`, to prevent dirty data
          sqliteWriteStream.emit('error', new Error(`storeTextToSQLite() Insert text to SQLite batch error: ${(error as Error).message} ${(error as Error).stack ?? ''}`));
          readStream.destroy();
        }
      },
    });
    batchedTiddlerTextStream.pipe(sqliteWriteStream);
    // wait for stream to finish before exit the method
    let readEnded = false;
    let writeEnded = false;
    await new Promise<void>((resolve, reject) => {
      batchedTiddlerTextStream.on('end', () => {
        readEnded = true;
        if (writeEnded) resolve();
      });
      sqliteWriteStream.on('finish', () => {
        writeEnded = true;
        if (readEnded) resolve();
      });
      batchedTiddlerTextStream.on('error', (error) => {
        const newError = new Error(`storeTextToSQLite batchedTiddlerTextStream("${filePath}") error: ${(error).message} ${(error).stack ?? ''}`);
        reject(newError);
      });
      sqliteWriteStream.on('error', (error) => {
        const newError = new Error(`storeTextToSQLite sqliteWriteStream error: ${(error).message} ${(error).stack ?? ''}`);
        reject(newError);
      });
    });
    await database.execAsync(`
          UPDATE tiddlers 
          SET text = (SELECT text FROM temp_tiddlers WHERE temp_tiddlers.title = tiddlers.title)
          WHERE title IN (SELECT title FROM temp_tiddlers)
      `);
    await database.execAsync('DROP TABLE temp_tiddlers;');
    setProgress(1);
  }

  private readonly preparedForInsertTiddlerFieldsBatch = new Map<number, SQLiteStatement>();
  /**
   * Insert a single batch
   */
  private async insertTiddlerFieldsBatch(database: SQLiteDatabase, batch: ISkinnyTiddler[]) {
    // TODO: let server provide stringified row and title, so we don't need to stringify here
    // TODO: Or store fields to a fields table. https://github.com/Jermolene/TiddlyWiki5/discussions/7931
    const bindParameters = batch.flatMap(row => [row.title, JSON.stringify(row)]);

    let statement = this.preparedForInsertTiddlerFieldsBatch.get(batch.length);
    if (statement === undefined) {
      const placeholders = batch.map(() => '(?, ?)').join(',');
      const query = `INSERT INTO tiddlers (title, fields) VALUES ${placeholders}
      ON CONFLICT(title) DO UPDATE SET
      fields = excluded.fields;
      `;
      statement = await database.prepareAsync(query);
      this.preparedForInsertTiddlerFieldsBatch.set(batch.length, statement);
    }
    await statement.executeAsync(bindParameters);
  }

  private readonly preparedForInsertTiddlerTextsBatch = new Map<number, SQLiteStatement>();

  /**
   * Insert a single batch
   */
  private async insertTiddlerTextsBatch(database: SQLiteDatabase, batch: ITiddlerTextOnly[]) {
    let statement = this.preparedForInsertTiddlerTextsBatch.get(batch.length);
    if (statement === undefined) {
      const placeholders = batch.map(() => '(?, ?)').join(',');
      const query = `INSERT INTO temp_tiddlers (title, text) VALUES ${placeholders};`;
      statement = await database.prepareAsync(query);
      this.preparedForInsertTiddlerTextsBatch.set(batch.length, statement);
    }
    const bindParameters = batch.flatMap(row => [row.title, row.text]);
    await statement.executeAsync(bindParameters);
  }

  /**
   * Load tiddler's text as file, save to file system.
   * This usually used for preloading all binary files when importing wiki.
   * @param tiddlers skinny tiddlers json array
   */
  public async loadBinaryTiddlersAsFilesFromServer(
    workspace: IWikiWorkspace,
    setProgress: { setFetchAndWritProgress: (progress: number) => void; setReadListProgress: (progress: number) => void; setWarning: (latestWarning: string) => void },
    options?: { chunkSize?: number },
  ): Promise<void> {
    /**
     * We can concurrently load multiple binary files from server.
     * Concurrency is determined by the read stream and chunk number.
     */
    const MAX_CHUNK_SIZE = options?.chunkSize ?? 50;
    /** Read 0.5M each time, to slow down the progress of fs read, because the bottom neck is net request. */
    const JSON_READ_LENGTH = 512 * 1024;
    // get content length use first pass
    let dataCount = 0;
    const binaryFileListPath = getWikiBinaryTiddlersListCachePath(workspace);
    try {
      const readStream = createReadStream(binaryFileListPath, { length: JSON_READ_LENGTH * 2 });
      readStream.on('progress', (progress: number) => {
        setProgress.setReadListProgress(progress);
      });
      const fileSize = await readStream.init();
      if (fileSize <= 2) {
        // 2 means `[]`, empty array
        console.log('loadBinaryTiddlersAsFilesFromServer: No binary tiddlers to load.');
        return;
      }
      const countBinaryTiddlerFieldsStream = chain([
        readStream,
        StreamArray.withParser(),
      ]);
      let lastData: ISkinnyTiddlersJSONBatch[number] | undefined;
      countBinaryTiddlerFieldsStream.on('data', (data: ISkinnyTiddlersJSONBatch[number]) => {
        lastData = data;
      });
      await new Promise<void>((resolve, reject) => {
        countBinaryTiddlerFieldsStream.on('end', () => {
          const lastIndex = lastData?.key;
          if (lastIndex === undefined) {
            reject(new Error('loadBinaryTiddlersAsFilesFromServer() Failed to count task, no data'));
          } else {
            dataCount = lastIndex + 1;
            resolve();
          }
        });
        countBinaryTiddlerFieldsStream.on('error', (error) => {
          reject(error);
        });
      });
    } catch (error) {
      throw new Error(`loadBinaryTiddlersAsFilesFromServer() Failed to read tiddler text store ${binaryFileListPath}, ${(error as Error).message}`);
    }
    // reset progress, start really processing data.
    setProgress.setReadListProgress(0);
    let batchedBinaryTiddlerFieldsStream: Chain;
    try {
      const readStream = createReadStream(binaryFileListPath, { length: JSON_READ_LENGTH });
      readStream.on('progress', (progress: number) => {
        setProgress.setReadListProgress(progress);
      });
      await readStream.init();
      batchedBinaryTiddlerFieldsStream = chain([
        readStream,
        StreamArray.withParser(),
        new Batch({ batchSize: MAX_CHUNK_SIZE }),
      ]);
    } catch (error) {
      throw new Error(`loadBinaryTiddlersAsFilesFromServer() Failed to read tiddler text store, ${(error as Error).message}`);
    }
    let completedCount = 0;
    const onlineLastSyncServer = backgroundSyncService.getOnlineServerForWiki(workspace);
    setProgress.setFetchAndWritProgress(0);
    const fetchAndWriteStream = new Writable({
      objectMode: true,
      write: async (tiddlerListChunk: ISkinnyTiddlersJSONBatch, encoding, next) => {
        await Promise.all(
          tiddlerListChunk.map(item => item.value).map(async tiddler => {
            try {
              // TODO: check if file already exists, skip importing. Maybe read the folder, and use that list to compare? Or can skip the compare if folder is empty (first time import)
              if (!tiddler.title) return;
              // Load external attachment binary from server
              if (typeof tiddler._canonical_uri === 'string' && tiddler._canonical_uri.length > 0) {
                await backgroundSyncService.saveCanonicalUriToFSFromServer(workspace, tiddler.title, tiddler._canonical_uri, onlineLastSyncServer);
                return;
              }
              // Load tiddler binary from server
              await backgroundSyncService.saveToFSFromServer(workspace, tiddler.title, onlineLastSyncServer);
            } catch (error) {
              console.error(`loadTiddlersAsFileFromServer: Failed to load tiddler ${tiddler.title} from server: ${(error as Error).message} ${(error as Error).stack ?? ''}`);
              setProgress.setWarning((error as Error).message);
            } finally {
              completedCount += 1;
              setProgress.setFetchAndWritProgress(completedCount / dataCount);
            }
          }),
        );
        // don't forget to call the `next()` to let stream go to next batch
        next();
      },
    });
    batchedBinaryTiddlerFieldsStream.pipe(fetchAndWriteStream);
    let readEnded = false;
    let writeEnded = false;
    // wait for stream to finish before exit the method
    await new Promise<void>((resolve, reject) => {
      batchedBinaryTiddlerFieldsStream.on('end', () => {
        readEnded = true;
        if (writeEnded) resolve();
      });
      fetchAndWriteStream.on('finish', () => {
        writeEnded = true;
        if (readEnded) resolve();
      });
      batchedBinaryTiddlerFieldsStream.on('error', (error) => {
        const newError = new Error(
          `loadBinaryTiddlersAsFilesFromServer batchedBinaryTiddlerFieldsStream("${binaryFileListPath}") error: ${(error).message} ${(error).stack ?? ''}`,
        );
        reject(newError);
      });
    });
  }
}

export const importService = new ImportService();
