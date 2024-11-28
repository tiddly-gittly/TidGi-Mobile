import { drizzle, ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import * as fs from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { getWikiMainSqliteName, getWikiMainSqlitePath } from '../../constants/paths';
import { IWikiWorkspace } from '../../store/workspace';
import * as schema from './orm';
import migrations from './orm/migrations/migrations';

/**
 * Get app stores in wiki.
 */
export class SQLiteServiceService {
  private readonly rawDatabases = new Map<string, SQLite.SQLiteDatabase>();
  private readonly databases = new Map<string, ExpoSQLiteDatabase<typeof schema>>();

  async getDatabase(workspace: IWikiWorkspace, isRetry = false): Promise<{ db: SQLite.SQLiteDatabase; orm: ExpoSQLiteDatabase<typeof schema> }> {
    const name = getWikiMainSqliteName(workspace);
    if (!this.rawDatabases.has(name) && !this.databases.has(name)) {
      try {
        const expoSqlite = await SQLite.openDatabaseAsync(name);
        const dataSource = drizzle(expoSqlite, { schema });
        await migrate(dataSource, migrations);
        this.rawDatabases.set(name, expoSqlite);
        this.databases.set(name, dataSource);
        return {
          db: expoSqlite,
          orm: dataSource,
        };
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
          const existingDatabase = this.rawDatabases.get(name);
          if (existingDatabase !== undefined) {
            existingDatabase.closeSync();
            this.databases.delete(name);
            this.rawDatabases.delete(name);
          }
        } catch (error) {
          console.error(`Failed to destroy in getDatabase ${name}: ${(error as Error).message} ${(error as Error).stack ?? ''}`);
        }
        throw error;
      }
    }

    return {
      db: this.rawDatabases.get(name)!,
      orm: this.databases.get(name)!,
    };
  }

  async closeDatabase(workspace: IWikiWorkspace, drop?: boolean) {
    const name = getWikiMainSqliteName(workspace);
    if (this.rawDatabases.has(name)) {
      try {
        const rawDatabase = this.rawDatabases.get(name)!;
        this.databases.delete(name);
        this.rawDatabases.delete(name);
        await rawDatabase.closeAsync();
        if (drop === true) {
          // need to delete the file. May encounter SQLITE_BUSY error if not deleted.
          await fs.deleteAsync(getWikiMainSqlitePath(workspace));
        }
      } catch (error) {
        console.error(`Failed to closeDatabase ${name}: ${(error as Error).message} ${(error as Error).stack ?? ''}`);
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
