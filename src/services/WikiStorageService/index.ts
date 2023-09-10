/* eslint-disable @typescript-eslint/require-await */
import * as fs from 'expo-file-system';
import { Observable } from 'rxjs';
import type { IChangedTiddlers } from 'tiddlywiki';
import { getWikiTiddlerPathByTitle } from '../../constants/paths';
import { TiddlersLogOperation } from '../../pages/Importer/createTable';
import { useConfigStore } from '../../store/config';
import { ServerStatus, useServerStore } from '../../store/server';
import { IWikiWorkspace } from '../../store/wiki';
import { sqliteServiceService } from '../SQLiteService';
import { TiddlerChangeSQLModel, TiddlerSQLModel } from '../SQLiteService/orm';
import { getSyncIgnoredTiddlers } from './ignoredTiddler';
import { IWikiServerStatusObject } from './types';

/**
 * Service that can be used to save/load wiki data
 *
 * - proxy by `src/pages/WikiWebView/WikiStorageService/registerWikiStorageServiceOnWebView.ts` to be `window.service.wikiStorageService`
 * - then used in `plugins/src/expo-file-system-syncadaptor/file-system-syncadaptor.ts` inside webview
 *
 * Don't forget to register method in WikiStorageServiceIPCDescriptor. Otherwise you will get `window.service.wikiStorageService.methodName is not a function` error.
 * All methods must be async.
 */
export class WikiStorageService {
  #workspace: IWikiWorkspace;
  #configStore = useConfigStore;
  #serverStore = useServerStore;

  constructor(workspace: IWikiWorkspace) {
    this.#workspace = workspace;
  }

  async getStatus(): Promise<IWikiServerStatusObject> {
    return {
      anonymous: false,
      read_only: false,
      space: {
        recipe: 'default',
      },
      // tiddlywiki_version: '5.1.23',
      username: this.#configStore.getState().userName,
    };
  }

  async getSkinnyTiddlers(): Promise<string> {
    const skinnyTiddlerStore = await getSkinnyTiddlersJSONFromSQLite(this.#workspace);
    return skinnyTiddlerStore;
  }

  /**
   * Return the e-tag
   */
  async saveTiddler(workspace: IWikiWorkspace, title: string, text: string, fieldStrings: string): Promise<string> {
    try {
      let operation: TiddlersLogOperation = TiddlersLogOperation.INSERT;

      // Get the database connection for the workspace
      const dataSource = await sqliteServiceService.getDatabase(workspace);

      // Transaction
      await dataSource.transaction(async transactionalEntityManager => {
        // Get repositories
        const tiddlerRepo = transactionalEntityManager.getRepository(TiddlerSQLModel);
        const tiddlerChangeRepo = transactionalEntityManager.getRepository(TiddlerChangeSQLModel);

        // Save or update tiddler
        await tiddlerRepo.save({
          title,
          text,
          fields: fieldStrings,
        });
        if (!(getSyncIgnoredTiddlers(title).includes(title))) {
          // Check if a tiddler with the same title already exists
          const existingTiddler = await tiddlerRepo.findOne({ where: { title } });
          if (existingTiddler !== null) {
            // If tiddler exists, set operation to 'UPDATE'
            operation = TiddlersLogOperation.UPDATE;
          }
          await tiddlerChangeRepo.save({
            title,
            operation,
          });
        }
      });

      const changeCount = '0'; // this.wikiInstance.wiki.getChangeCount(title).toString();
      const Etag = `"default/${encodeURIComponent(title)}/${changeCount}:"`;
      return Etag;
    } catch (error) {
      console.error(`Failed to save tiddler ${title}: ${(error as Error).message} ${(error as Error).stack ?? ''}`);
      throw error;
    }
  }

  async deleteTiddler(workspace: IWikiWorkspace, title: string): Promise<boolean> {
    try {
      const dataSource = await sqliteServiceService.getDatabase(workspace);
      // Begin a transaction
      await dataSource.transaction(async transactionalEntityManager => {
        const tiddlerRepo = transactionalEntityManager.getRepository(TiddlerSQLModel);

        // Delete the tiddler with the specified title
        await transactionalEntityManager.remove(tiddlerRepo.create({ title }));

        // Insert into tiddlers_changes_log
        const changeLog = new TiddlerChangeSQLModel();
        changeLog.title = title;
        changeLog.operation = TiddlersLogOperation.DELETE;
        await transactionalEntityManager.save(changeLog);
      });

      return true;
    } catch (error) {
      console.error(`Failed to delete tiddler ${title}: ${(error as Error).message} ${(error as Error).stack ?? ''}`);
      throw error;
    }
  }

  async loadTiddlerText(title: string): Promise<string | undefined> {
    return (await this.#loadFromSqlite(title)) ?? (await this.#loadFromFS(title)) ?? await this.#loadFromServer(title);
  }

  async #loadFromSqlite(title: string): Promise<string | undefined> {
    try {
      const dataSource = await sqliteServiceService.getDatabase(this.#workspace);
      const tiddlerRepo = dataSource.getRepository(TiddlerSQLModel);
      const tiddler = await tiddlerRepo.findOne({ where: { title } });
      return tiddler?.text;
    } catch (error) {
      console.error(`SQL error when getting ${title} : ${(error as Error).message} ${(error as Error).stack ?? ''}`);
      return undefined;
    }
  }

  async #loadFromFS(title: string): Promise<string | undefined> {
    try {
      const tiddlerFileContent = await fs.readAsStringAsync(getWikiTiddlerPathByTitle(this.#workspace, title));
      return tiddlerFileContent;
    } catch {
      return undefined;
    }
  }

  async #loadFromServer(title: string): Promise<string | undefined> {
    try {
      const onlineLastSyncServer = this.#workspace.syncedServers.sort((a, b) => b.lastSync - a.lastSync).map(server => this.#serverStore.getState().servers[server.serverID]).find(
        server => server?.status === ServerStatus.online,
      );
      if (onlineLastSyncServer === undefined) return;
      const getTiddlerUrl = new URL(`/tw-mobile-sync/get-tiddler-text/${encodeURIComponent(title)}`, onlineLastSyncServer.uri);
      await fs.downloadAsync(getTiddlerUrl.toString(), getWikiTiddlerPathByTitle(this.#workspace, title));
      return await this.#loadFromFS(title);
    } catch (error) {
      console.error(`Failed to load tiddler ${title} from server: ${(error as Error).message} ${(error as Error).stack ?? ''}`);
      return undefined;
    }
  }

  // ████████ ██     ██       ███████ ███████ ███████
  //    ██    ██     ██       ██      ██      ██
  //    ██    ██  █  ██ █████ ███████ ███████ █████
  //    ██    ██ ███ ██            ██      ██ ██
  //    ██     ███ ███        ███████ ███████ ███████
  getWikiChangeObserver$() {
    return new Observable<IChangedTiddlers>((observer) => {
      // TODO: react on connected active server change
      // this.wikiInstance.wiki.addEventListener('change', (changes) => {
      //   observer.next(changes);
      // });
    });
  }
}

/**
 * get skinny tiddlers json array from sqlite, without text field to speedup initial loading and memory usage
 * @returns json string same as what return from `tw-mobile-sync/get-skinny-tiddlywiki-tiddler-store-script`, with type `Promise<Array<Omit<ITiddlerFields, 'text'>> | undefined>`
 */
export async function getSkinnyTiddlersJSONFromSQLite(workspace: IWikiWorkspace): Promise<string> {
  try {
    const dataSource = await sqliteServiceService.getDatabase(workspace);
    const tiddlerRepo = dataSource.getRepository(TiddlerSQLModel);

    const tiddlers = await tiddlerRepo.find({ select: ['fields'] });
    if (tiddlers.length === 0) {
      return '[]';
    }
    return `[${tiddlers.map(tiddler => tiddler.fields).filter((fields): fields is string => fields !== null).join(',')}]`;
  } catch (error) {
    throw new Error(`Error getting skinny tiddlers list from SQLite: ${(error as Error).message}`);
  }
}
