/* eslint-disable @typescript-eslint/require-await */
import * as SQLite from 'expo-sqlite';
import omit from 'lodash/omit';
import { useRegisterProxy } from 'react-native-postmessage-cat';
import type { ITiddlerFields } from 'tiddlywiki';
import { getWikiSkinnyTiddlerTextSqliteName } from '../../../constants/paths';
import { useConfigStore } from '../../../store/config';
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
 * Don't forget to register method in WikiStorageServiceIPCDescriptor.
 * All methods must be async.
 */
export class WikiStorageService {
  #workspace: IWikiWorkspace;
  #sqlite: SQLite.SQLiteDatabase;
  #configStore = useConfigStore;

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

  /**
   * Return the e-tag
   */
  async saveTiddler(title: string, fields: ITiddlerFields): Promise<string> {
    const tiddlerFieldsToPut = omit(fields, ['fields', 'revision', '_is_skinny']) as Record<string, string | number>;
    // If this is a skinny tiddler, it means the client never got the full
    // version of the tiddler to edit. So we must preserve whatever text
    // already exists on the server, or else we'll inadvertently delete it.
    // if (fields._is_skinny !== undefined) {
    //   const tiddler = this.wikiInstance.wiki.getTiddler(title);
    //   if (tiddler !== undefined) {
    //     tiddlerFieldsToPut.text = tiddler.fields.text;
    //   }
    // }
    // tiddlerFieldsToPut.title = title;
    // this.wikiInstance.wiki.addTiddler(new this.wikiInstance.Tiddler(tiddlerFieldsToPut));
    // TODO: save tiddler fields other than text field, to `getWikiTiddlerStorePath(workspace, true)`
    await this.#sqlite.execAsync([{ sql: 'INSERT OR REPLACE INTO tiddlers (title, text) VALUES (?, ?);', args: [title, tiddlerFieldsToPut.text] }], false);
    const changeCount = '0'; // this.wikiInstance.wiki.getChangeCount(title).toString();
    const Etag = `"default/${encodeURIComponent(title)}/${changeCount}:"`;
    return Etag;
  }

  async loadTiddlerText(title: string): Promise<string | undefined> {
    const queryResult = await this.#sqlite.execAsync([{ sql: 'SELECT text FROM tiddlers WHERE title = ?;', args: [title] }], true);
    const result = queryResult[0];
    if (result === undefined) return undefined;
    if ('error' in result) {
      console.error(result.error);
      return undefined;
    }
    if (result.rows.length === 0) {
      return undefined;
    }
    return (result.rows as ITiddlerTextJSON)[0]?.text;
  }

  async deleteTiddler(title: string): Promise<boolean> {
    await this.#sqlite.execAsync([{ sql: 'DELETE FROM tiddlers WHERE title = ?;', args: [title] }], false);
    return true;
  }
}

export function useWikiStorageService(workspace: IWikiWorkspace) {
  const wikiStorageService = new WikiStorageService(workspace);
  const [webViewReference, onMessageReference] = useRegisterProxy(wikiStorageService, WikiStorageServiceIPCDescriptor);
  return [webViewReference, onMessageReference, registerWikiStorageServiceOnWebView] as const;
}
