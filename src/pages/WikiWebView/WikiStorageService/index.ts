/* eslint-disable @typescript-eslint/require-await */
import omit from 'lodash/omit';
import { useRegisterProxy } from 'react-native-postmessage-cat';
import type { ITiddlerFields } from 'tiddlywiki';
import { useConfigStore } from '../../../store/config';
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
  #id: string;
  #configStore = useConfigStore;
  constructor(id: string) {
    this.#id = id;
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
    const changeCount = '0' //this.wikiInstance.wiki.getChangeCount(title).toString();
    const Etag = `"default/${encodeURIComponent(title)}/${changeCount}:"`;
    return Etag;
  }

  async loadTiddler(title: string): Promise<ITiddlerFields> {
    // const tiddler = this.wikiInstance.wiki.getTiddler(title);
    // if (tiddler === undefined) {
    //   return { statusCode: 404, headers: { 'Content-Type': 'text/plain' }, data: `Tiddler "${title}" not exist` };
    // }
    // // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    // const tiddlerFields = { ...tiddler.fields };

    // // only add revision if it > 0 or exists
    // // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    // if (this.wikiInstance.wiki.getChangeCount(title)) {
    //   tiddlerFields.revision = String(this.wikiInstance.wiki.getChangeCount(title));
    // }
    // tiddlerFields.bag = 'default';
    // tiddlerFields.type = tiddlerFields.type ?? 'text/vnd.tiddlywiki';
    // return tiddlerFields;
    return {}
  }

  async deleteTiddler(title: string): Promise<boolean> {
    return true;
  }
}

export function useWikiStorageService(id: string) {
  const wikiStorageService = new WikiStorageService(id);
  const [webViewReference, onMessageReference] = useRegisterProxy(wikiStorageService, WikiStorageServiceIPCDescriptor);
  return [webViewReference, onMessageReference, registerWikiStorageServiceOnWebView] as const;
}
