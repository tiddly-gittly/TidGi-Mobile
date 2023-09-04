/* eslint-disable @typescript-eslint/require-await */
import * as fs from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import omit from 'lodash/omit';
import { useRegisterProxy } from 'react-native-postmessage-cat';
import type { ITiddlerFields } from 'tiddlywiki';
import { getWikiSkinnyTiddlerTextSqliteName, getWikiTiddlerPathByTitle } from '../../../constants/paths';
import { useConfigStore } from '../../../store/config';
import { ServerStatus, useServerStore } from '../../../store/server';
import { IWikiWorkspace } from '../../../store/wiki';
import { ITiddlerTextJSON } from '../../Importer/storeTextToSQLite';
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
    this.#sqlite = SQLite.openDatabase(getWikiSkinnyTiddlerTextSqliteName(this.#workspace));
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
  async saveTiddler(title: string, fields: ITiddlerFields): Promise<string> {
    // we separate the text and fields in sqlite
    const tiddlerFieldsToPut = omit(fields, ['text']) as Record<string, string | number>;
    // incase the title mismatch...
    tiddlerFieldsToPut.title = title;
    await this.#sqlite.execAsync([{
      sql: 'INSERT OR REPLACE INTO tiddlers (title, text, fields) VALUES (?, ?, ?);',
      args: [title, fields.text, JSON.stringify(tiddlerFieldsToPut)],
    }], false);
    const changeCount = '0'; // this.wikiInstance.wiki.getChangeCount(title).toString();
    const Etag = `"default/${encodeURIComponent(title)}/${changeCount}:"`;
    return Etag;
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

  async deleteTiddler(title: string): Promise<boolean> {
    await this.#sqlite.execAsync([{ sql: 'DELETE FROM tiddlers WHERE title = ?;', args: [title] }], false);
    return true;
  }

  destroy() {
    // TODO: close db on leaving a wiki
    this.#sqlite.closeAsync();
  }
}

export function useWikiStorageService(workspace: IWikiWorkspace) {
  const wikiStorageService = new WikiStorageService(workspace);
  const [webViewReference, onMessageReference] = useRegisterProxy(wikiStorageService, WikiStorageServiceIPCDescriptor);
  return [webViewReference, onMessageReference, registerWikiStorageServiceOnWebView] as const;
}

/**
 * get skinny tiddlers json array from sqlite, without text field to speedup initial loading and memory usage
 * @returns json string same as what return from `tw-mobile-sync/get-skinny-tiddlywiki-tiddler-store-script`, with type `Promise<Array<Omit<ITiddlerFields, 'text'>> | undefined>`
 */
export async function getSkinnyTiddlersJSONFromSQLite(workspace: IWikiWorkspace): Promise<string> {
  const database = SQLite.openDatabase(getWikiSkinnyTiddlerTextSqliteName(workspace));
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