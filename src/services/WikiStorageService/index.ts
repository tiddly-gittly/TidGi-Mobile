/* eslint-disable @typescript-eslint/require-await */
import * as fs from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { useMemo } from 'react';
import { useRegisterProxy } from 'react-native-postmessage-cat';
import { Observable } from 'rxjs';
import type { IChangedTiddlers } from 'tiddlywiki';
import { getWikiMainSqliteName, getWikiTiddlerPathByTitle } from '../../constants/paths';
import { TiddlersLogOperation } from '../../pages/Importer/createTable';
import { ITiddlerTextJSON } from '../../pages/Importer/storeTextToSQLite';
import { useConfigStore } from '../../store/config';
import { ServerStatus, useServerStore } from '../../store/server';
import { IWikiWorkspace } from '../../store/wiki';
import { getLogIgnoredTiddler } from '../BackgroundSyncService/ignoredTiddler';
import { WikiStorageServiceIPCDescriptor } from './descriptor';
import { registerWikiStorageServiceOnWebView } from './registerWikiStorageServiceOnWebView';
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
  #sqlite: SQLite.SQLiteDatabase;
  #configStore = useConfigStore;
  #serverStore = useServerStore;

  constructor(workspace: IWikiWorkspace) {
    this.#workspace = workspace;
    this.#sqlite = SQLite.openDatabase(getWikiMainSqliteName(this.#workspace));
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
  async saveTiddler(title: string, text: string, fieldStrings: string): Promise<string> {
    try {
      let operation: TiddlersLogOperation = TiddlersLogOperation.INSERT;

      await this.#sqlite.transactionAsync(async tx => {
        // Check if a tiddler with the same title already exists
        const result = await tx.executeSqlAsync(
          'SELECT title FROM tiddlers WHERE title = ?;',
          [title],
        );

        if ('error' in result) {
          throw result.error;
        }
        if (result.rows.length > 0) {
          // If tiddler exists, set operation to 'UPDATE'
          operation = TiddlersLogOperation.UPDATE;
        }

        await tx.executeSqlAsync(
          'INSERT OR REPLACE INTO tiddlers (title, text, fields) VALUES (?, ?, ?);',
          [title, text, fieldStrings],
        );

        if (!(getLogIgnoredTiddler(title).includes(title))) {
          await tx.executeSqlAsync(
            'INSERT INTO tiddlers_changes_log (title, operation) VALUES (?, ?);',
            [title, operation],
          );
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

  async deleteTiddler(title: string): Promise<boolean> {
    try {
      await this.#sqlite.transactionAsync(async tx => {
        await tx.executeSqlAsync(
          'DELETE FROM tiddlers WHERE title = ?;',
          [title],
        );

        await tx.executeSqlAsync(
          'INSERT INTO tiddlers_changes_log (title, operation) VALUES (?, ?);',
          [title, TiddlersLogOperation.DELETE],
        );
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
      const resultSet = await this.#sqlite.execAsync([{ sql: 'SELECT text FROM tiddlers WHERE title = ?;', args: [title] }], true);
      const result = resultSet[0];
      if (result === undefined) return undefined;
      if ('error' in result) {
        console.error(result.error);
        return undefined;
      }
      if (result.rows.length === 0) {
        return undefined;
      }
      return (result.rows as ITiddlerTextJSON)[0]?.text;
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

  destroy() {
    // TODO: close db on leaving a wiki
    this.#sqlite.closeAsync();
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

export function useWikiStorageService(workspace: IWikiWorkspace) {
  const wikiStorageService = useMemo(() => new WikiStorageService(workspace), [workspace]);
  const [webViewReference, onMessageReference] = useRegisterProxy(wikiStorageService, WikiStorageServiceIPCDescriptor);
  return [webViewReference, onMessageReference, registerWikiStorageServiceOnWebView] as const;
}

/**
 * get skinny tiddlers json array from sqlite, without text field to speedup initial loading and memory usage
 * @returns json string same as what return from `tw-mobile-sync/get-skinny-tiddlywiki-tiddler-store-script`, with type `Promise<Array<Omit<ITiddlerFields, 'text'>> | undefined>`
 */
export async function getSkinnyTiddlersJSONFromSQLite(workspace: IWikiWorkspace): Promise<string> {
  const database = SQLite.openDatabase(getWikiMainSqliteName(workspace));
  const resultSet = await database.execAsync([{ sql: 'SELECT fields FROM tiddlers;', args: [] }], true);
  const result = resultSet[0];
  database.closeAsync();
  if (result === undefined) return '[]';
  if ('error' in result) {
    throw new Error(`Error getting skinny tiddlers list from SQLite: ${result.error.message}`);
  }
  if (result.rows.length === 0) {
    return '[]';
  }
  return `[${result.rows.map(row => row.fields as string | null).filter((fields): fields is string => fields !== null).join(',')}]`;
}
