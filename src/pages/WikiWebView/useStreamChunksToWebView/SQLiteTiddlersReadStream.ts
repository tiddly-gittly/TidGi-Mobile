/* eslint-disable unicorn/no-null */
import { max } from 'drizzle-orm';
import { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { SQLiteDatabase, SQLiteStatement } from 'expo-sqlite/next';
import { Readable } from 'readable-stream';
import { sqliteServiceService } from '../../../services/SQLiteService';
import { TiddlersSQLModel } from '../../../services/SQLiteService/orm';
import * as schema from '../../../services/SQLiteService/orm';
import { IWikiWorkspace } from '../../../store/workspace';

/**
 * If quickLoad, only load small amount of recent tiddlers, speed up loading time for huge wiki.
 */
const QUICK_LOAD_LIMIT = 300;
export interface ISQLiteTiddlersReadStreamOptions {
  additionalContent?: string[];
  chunkSize?: number;
  quickLoad?: boolean;
}
/**
 * get (skinny tiddlers + full tiddlers judged by `saveFullTiddler` + full tiddlers when importing system tiddlers) json array from sqlite, without text field to speedup initial loading and memory usage
 * If you want some tiddlers not being skinny (For example, `$:/` tiddlers), make sure to save text field in the `fields` field when saving, in the plugins\src\expo-file-system-syncadaptor\file-system-syncadaptor.ts , see logic of `saveFullTiddler`
 * @returns json string same as what return from `tw-mobile-sync/get-skinny-tiddlywiki-tiddler-store-script`, with type `Promise<Array<Omit<ITiddlerFields, 'text'>> | undefined>`
 */
export class SQLiteTiddlersReadStream extends Readable {
  private readonly workspace: IWikiWorkspace;
  /**
   * Row count of results
   */
  private listSize: number;
  private currentPosition: number;
  /**
   * Default chunk size in rows.
   * Usually 1 row is about 1kB, so 5000 rows is about 5MB. But if some row contains plugins, this will be bigger, need to reduce at runtime to prevent `SQLite: Row too big to fit into CursorWindow` error of expo-sqlite.
   */
  private readonly defaultChunkSize: number;
  private orm?: ExpoSQLiteDatabase<typeof schema>;
  private db?: SQLiteDatabase;
  private readonly emptyChunk = '[]';
  private readonly additionalContent?: string[];
  /**
   * How many user tiddlers will we load. `-1` means no limit.
   */
  private readonly quickLoadLimit: number = -1;
  private hasReachQuickLoadLimit = false;
  private readonly preparedReadStatements = new Map<string, SQLiteStatement>();

  constructor(workspace: IWikiWorkspace, options?: ISQLiteTiddlersReadStreamOptions) {
    super({ encoding: 'utf8' });
    this.workspace = workspace;
    this.listSize = 0;
    this.currentPosition = 0;

    this.defaultChunkSize = options?.chunkSize ?? 5000;
    this.additionalContent = options?.additionalContent;
    if (options?.quickLoad === true) {
      this.quickLoadLimit = QUICK_LOAD_LIMIT;
    }
  }

  async init() {
    try {
      const { orm, db } = await sqliteServiceService.getDatabase(this.workspace);
      this.orm = orm;
      this.db = db;
      this.listSize = (await this.orm.select({ listSize: max(TiddlersSQLModel.id) }).from(TiddlersSQLModel))[0]?.listSize ?? 0;
    } catch (error) {
      console.error();
      console.error(`SQLiteTiddlersReadStream init error: ${(error as Error).message} ${(error as Error).stack ?? ''}`);
      this.emit('error', error);
    }
  }

  destroy(error?: Error | undefined): this {
    this.preparedReadStatements.forEach(statement => {
      statement.finalizeSync();
    });
    this.preparedReadStatements.clear();
    return super.destroy(error);
  }

  _read() {
    if (this.orm === undefined || this.db === undefined) {
      throw new Error('database is undefined (not ready) in SQLiteTiddlersReadStream when reading.');
    }

    const readMethod = this.quickLoadLimit === -1 ? this.readWithChunkSize(this.db, this.defaultChunkSize) : this.readWithLimit(this.db, this.defaultChunkSize);

    readMethod.then(({ chunk, size }) => {
      if (chunk === this.emptyChunk || size === 0 || this.hasReachQuickLoadLimit) {
        // End of the stream
        this.emit('progress', 1);
        if (this.additionalContent !== undefined) {
          this.push(`[${this.additionalContent.join(',')}]`);
        }
        this.push(null);
      } else {
        this.currentPosition = size + this.currentPosition;
        this.emit('progress', this.listSize === 0 ? 0.5 : (this.currentPosition / this.listSize));
        this.push(chunk);
      }
    }).catch(error => {
      this.emit('error', error);
    });
  }

  /**
   * Read sqlite with `this.currentPosition` and given chunkSize (won't read from `this.chunkSize`, so you can try with different chunk size)
   * @returns stringified json array of tiddlers
   */
  private async readWithChunkSize(database: SQLiteDatabase, chunkSize: number): Promise<{ chunk: string; size: number }> {
    if (chunkSize <= 0) {
      throw new Error(`Read tiddlers from SQLite retry down to chunkSize ${chunkSize}, which is a bug.`);
    }
    try {
      console.info(`Loading tiddlers from sqlite, chunkSize: ${chunkSize}, currentPosition: ${this.currentPosition}`);
      let statement = this.preparedReadStatements.get('SELECT');
      if (statement === undefined) {
        const query = `SELECT * FROM tiddlers WHERE id > (?) LIMIT (?)`;
        statement = await database.prepareAsync(query);
        this.preparedReadStatements.set('SELECT', statement);
      }
      const result = await statement.executeAsync<typeof TiddlersSQLModel.$inferSelect>(this.currentPosition, chunkSize);
      const rows = await result.getAllAsync();
      if (rows.length === 0) {
        return { chunk: this.emptyChunk, size: 0 };
      }
      const chunk = `[${rows.map(row => row.fields).join(',')}]`;
      return {
        chunk,
        size: rows.length,
      };
    } catch (error) {
      // if (error instanceof TypeORMError) {
      //   // 1 / ( 1 - 0.618) to fast reduce to possible site
      //   const newChunkSize = Math.floor(chunkSize / 2.617);
      //   console.warn(`SQLiteTiddlersReadStream readWithChunkSize error: ${(error as Error).message} ${(error as Error).stack ?? ''}, now retry with chunkSize ${newChunkSize}`);
      //   // reduce chunk size and retry
      //   return await this.readWithChunkSize(sqlRepo, newChunkSize);
      // } else {
      console.warn(`SQLiteTiddlersReadStream readWithChunkSize error: ${(error as Error).message} ${(error as Error).stack ?? ''}, now retry with chunkSize`);
      throw error;
      // }
    }
  }

  private async readWithLimit(database: SQLiteDatabase, chunkSize: number): Promise<{ chunk: string; size: number }> {
    if (this.hasReachQuickLoadLimit) {
      // Already read text rows, indicating end of stream
      return { chunk: this.emptyChunk, size: 0 };
    }

    let query: string;
    let parameters: number[] = [this.currentPosition, chunkSize];
    if (this.currentPosition === 0) {
      // First, read rows where text IS NULL with pagination
      query = `SELECT * FROM tiddlers WHERE text IS NULL AND id > (?) LIMIT (?)`;
    } else {
      // Next, read rows where text IS NOT NULL, only once because of QUICK_LOAD_LIMIT
      query = `SELECT * FROM tiddlers WHERE text IS NOT NULL ORDER BY id DESC LIMIT ${QUICK_LOAD_LIMIT}`;
      parameters = []; // No pagination for this part
      this.hasReachQuickLoadLimit = true; // Indicate that we have attempted to read text rows
    }

    try {
      console.info(`Quick Loading tiddlers from sqlite, with ${query} ${parameters.join(',')}`);

      const statement = await database.prepareAsync(query);
      const result = await statement.executeAsync<typeof TiddlersSQLModel.$inferSelect>(...parameters);
      const rows = await result.getAllAsync();
      statement.finalizeSync();

      if (rows.length === 0 && this.currentPosition !== 0) {
        // If no rows and currentPosition is not 0, switch to text rows
        this.currentPosition = 0; // Reset for reading text rows
        return await this.readWithLimit(database, chunkSize); // Attempt to read text rows
      }

      const chunk = `[${rows.map(row => row.fields).join(',')}]`;
      this.currentPosition += rows.length; // Update currentPosition for pagination
      return {
        chunk,
        size: rows.length,
      };
    } catch (error) {
      console.error(`readWithLimit error: ${(error as Error).message}`);
      throw error;
    }
  }
}

export function createSQLiteTiddlersReadStream(workspace: IWikiWorkspace, options?: ISQLiteTiddlersReadStreamOptions): SQLiteTiddlersReadStream {
  return new SQLiteTiddlersReadStream(workspace, options);
}
