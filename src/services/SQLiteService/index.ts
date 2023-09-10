import * as fs from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { DataSource } from 'typeorm';
import { getWikiMainSqliteName, getWikiMainSqlitePath } from '../../constants/paths';
import { IWikiWorkspace } from '../../store/wiki';
import { TiddlerChangeSQLModel, TiddlerSQLModel } from './orm';
import { migrations } from './orm/migrations';

/**
 * Get app stores in wiki.
 */
export class SQLiteServiceService {
  private readonly dataSources = new Map<string, DataSource>();

  async getDatabase(workspace: IWikiWorkspace, isRetry = false): Promise<DataSource> {
    const name = getWikiMainSqliteName(workspace);
    if (!this.dataSources.has(name)) {
      try {
        const dataSource = new DataSource({
          database: name,
          entities: [TiddlerSQLModel, TiddlerChangeSQLModel],
          synchronize: false,
          type: 'expo',
          driver: SQLite,
          migrations,
          migrationsTableName: 'migrations',
        });
        /**
         * Error `TypeError: Cannot read property 'transaction' of undefined` will show if run any query without initialize.
         */
        await dataSource.initialize();
        await dataSource.runMigrations();

        this.dataSources.set(name, dataSource);
        return dataSource;
      } catch (error) {
        console.error(`Failed to getDatabase ${name}: ${(error as Error).message} ${(error as Error).stack ?? ''}`);
        if (!isRetry) {
          try {
            await this.#fixLock(workspace);
            return await this.getDatabase(workspace, true);
          } catch (error) {
            console.error(`Failed to retry getDatabase ${name}: ${(error as Error).message} ${(error as Error).stack ?? ''}`);
          }
        }
        try {
          await this.dataSources.get(name)?.destroy();
        } catch (error) {
          console.error(`Failed to destroy in getDatabase ${name}: ${(error as Error).message} ${(error as Error).stack ?? ''}`);
        }
        throw error;
      }
    }

    return this.dataSources.get(name)!;
  }

  async closeDatabase(workspace: IWikiWorkspace, drop?: boolean) {
    const name = getWikiMainSqliteName(workspace);
    if (this.dataSources.has(name)) {
      try {
        const dataSource = this.dataSources.get(name)!;
        this.dataSources.delete(name);
        if (drop === true) {
          await dataSource.dropDatabase();
          // need to delete the file. May encounter SQLITE_BUSY error if not deleted.
          await fs.deleteAsync(getWikiMainSqlitePath(workspace));
        } else {
          await dataSource.destroy();
          console.log(`closeDatabase ${name}`);
        }
      } catch (error) {
        console.error(`Failed to closeDatabase ${name}: ${(error as Error).message} ${(error as Error).stack ?? ''}`);
        throw error;
      }
    }
  }

  /**
   * Fix SQLite busy by move the file.
   * @url https://stackoverflow.com/a/1226850
   *
   * Fixes this:
   *
   * ```error
   * [Error: Error getting skinny tiddlers list from SQLite: Call to function 'ExpoSQLite.exec' has been rejected.
   *  → Caused by: android.database.sqlite.SQLiteDatabaseLockedException: database is locked (code 5 SQLITE_BUSY): , while compiling: PRAGMA journal_mode] Error: Error getting skinny tiddlers list from SQLite: Call to function 'ExpoSQLite.exec' has been rejected.
   *  → Caused by: android.database.sqlite.SQLiteDatabaseLockedException: database is locked (code 5 SQLITE_BUSY): , while compiling: PRAGMA journal_mode
   * ```
   */
  async #fixLock(workspace: IWikiWorkspace) {
    const oldSqlitePath = getWikiMainSqlitePath(workspace);
    const temporarySqlitePath = `${oldSqlitePath}.temp`;
    await fs.copyAsync({ from: oldSqlitePath, to: temporarySqlitePath });
    await fs.deleteAsync(oldSqlitePath);
    await fs.copyAsync({ from: temporarySqlitePath, to: oldSqlitePath });
    await fs.deleteAsync(temporarySqlitePath);
  }
}

/**
 * Only need a singleton instance for all wikis.
 */
export const sqliteServiceService = new SQLiteServiceService();
