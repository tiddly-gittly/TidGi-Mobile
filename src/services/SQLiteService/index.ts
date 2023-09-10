import * as SQLite from 'expo-sqlite';
import { Tiddler } from 'tw5-typed';
import { DataSource, Repository } from 'typeorm';
import { getWikiMainSqliteName } from '../../constants/paths';
import { IWikiWorkspace } from '../../store/wiki';
import { TiddlerChangeSQLModel } from './orm';

/**
 * Get app stores in wiki.
 */
export class SQLiteServiceService {
  private readonly dataSources = new Map<string, DataSource>();
  private readonly tiddlerRepo = new Map<string, Repository<Tiddler>>();
  private readonly tiddlerChangeRepo = new Map<string, Repository<TiddlerChangeSQLModel>>();

  async getDatabase(workspace: IWikiWorkspace): Promise<DataSource> {
    const name = getWikiMainSqliteName(workspace);
    if (!this.dataSources.has(name)) {
      const dataSource = new DataSource({
        database: name,
        entities: [Tiddler, TiddlerChangeSQLModel],
        synchronize: false,
        type: 'expo',
        driver: SQLite,
      });

      await dataSource.initialize();

      this.dataSources.set(name, dataSource);
      this.tiddlerRepo.set(name, dataSource.getRepository(Tiddler));
      this.tiddlerChangeRepo.set(name, dataSource.getRepository(TiddlerChangeSQLModel));
    }

    return this.dataSources.get(name)!;
  }

  async closeDatabase(workspace: IWikiWorkspace, drop?: boolean) {
    const name = getWikiMainSqliteName(workspace);
    if (this.dataSources.has(name)) {
      const dataSource = this.dataSources.get(name)!;
      this.tiddlerRepo.delete(name);
      this.tiddlerChangeRepo.delete(name);
      this.dataSources.delete(name);
      if (drop === true) {
        await dataSource.dropDatabase();
      } else {
        await dataSource.destroy();
      }
    }
  }
}

/**
 * Only need a singleton instance for all wikis.
 */
export const sqliteServiceService = new SQLiteServiceService();
