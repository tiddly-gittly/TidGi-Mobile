/* eslint-disable unicorn/no-null */
/* eslint-disable @typescript-eslint/require-await */
import * as fs from 'expo-file-system';
import { Observable } from 'rxjs';
import type { IChangedTiddlers, ITiddlerFieldsParam } from 'tiddlywiki';
import { getWikiTiddlerPathByTitle } from '../../constants/paths';
import i18n from '../../i18n';
import { useConfigStore } from '../../store/config';
import { useServerStore } from '../../store/server';
import { IWikiWorkspace } from '../../store/workspace';
import { backgroundSyncService } from '../BackgroundSyncService';
import { sqliteServiceService } from '../SQLiteService';
import { TiddlerChangeSQLModel, TiddlerSQLModel } from '../SQLiteService/orm';
import { IWikiServerStatusObject, TiddlersLogOperation } from '../WikiStorageService/types';
import { getFullSaveTiddlers, getSyncIgnoredTiddlers } from './ignoredTiddler';

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
  async saveTiddler(title: string, fields: ITiddlerFieldsParam): Promise<string> {
    try {
      let operation: TiddlersLogOperation = TiddlersLogOperation.INSERT;
      const saveFullTiddler = getFullSaveTiddlers(title).includes(title);
      const { text, title: _, ...fieldsToSave } = fields as (ITiddlerFieldsParam & { text?: string; title: string });

      // Get the database connection for the workspace
      const dataSource = await sqliteServiceService.getDatabase(this.#workspace);

      // Transaction
      await dataSource.transaction(async transactionalEntityManager => {
        // Get repositories
        const tiddlerRepo = transactionalEntityManager.getRepository(TiddlerSQLModel);
        const tiddlerChangeRepo = transactionalEntityManager.getRepository(TiddlerChangeSQLModel);

        /**
         * Save or update tiddler
         * See `BackgroundSyncService.#updateTiddlersFromServer` for a similar logic
         */
        const tiddler = new TiddlerSQLModel();
        tiddler.title = title;
        // for `$:/` tiddlers, if being skinny will throw error like `"Linked List only accepts string values, not " + value;`
        if (saveFullTiddler) {
          tiddler.fields = JSON.stringify({
            text,
            title,
            ...fieldsToSave,
          });
        } else {
          // prevent save huge duplicated content to SQLite, if not necessary
          if (text !== undefined && backgroundSyncService.checkIsLargeText(text, fieldsToSave.type as string)) {
            // save to fs instead of sqlite. See `WikiStorageService.#loadFromServer` for how we load it later.
            // `BackgroundSyncService.#updateTiddlersFromServer` will use saveToFSFromServer, but here we already have the text, so we can save it directly
            // don't set encoding here, otherwise read as utf8 will failed.
            await fs.writeAsStringAsync(getWikiTiddlerPathByTitle(this.#workspace, title), text);
            tiddler.text = null;
          } else {
            tiddler.text = text;
          }
          tiddler.fields = JSON.stringify({
            _is_skinny: '',
            title,
            ...fieldsToSave,
          });
        }
        await tiddlerRepo.save(tiddler);

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

  async deleteTiddler(title: string): Promise<boolean> {
    try {
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (!title) {
        console.warn(`Failed to delete tiddler with no title ${title}`);
        return false;
      }
      const dataSource = await sqliteServiceService.getDatabase(this.#workspace);
      // Begin a transaction
      await dataSource.transaction(async transactionalEntityManager => {
        const tiddlerRepo = transactionalEntityManager.getRepository(TiddlerSQLModel);

        // Fetch the tiddler with the specified title
        const tiddler = await tiddlerRepo.findOne({ where: { title } });
        if (tiddler === null) {
          throw new Error(`Failed to delete tiddler, Tiddler with title "${title}" not found.`);
        }

        // Delete the fetched tiddler
        await transactionalEntityManager.remove(tiddler);

        // Insert into tiddlers_changes_log
        const changeLog = new TiddlerChangeSQLModel();
        changeLog.title = title;
        changeLog.operation = TiddlersLogOperation.DELETE;
        await transactionalEntityManager.save(changeLog);
      });

      return true;
    } catch (error) {
      // for example, `Failed to delete tiddler, Tiddler with title "$:/Deck/new 1/study" not found.`
      console.error(`Failed to delete tiddler ${title}: ${(error as Error).message} ${(error as Error).stack ?? ''}`);
      throw error;
    }
  }

  async loadTiddlerText(title: string): Promise<string> {
    const tiddlerText = (await this.#loadFromSqlite(title)) ?? (await this.#loadFromFS(title)) ?? await this.#loadFromServerAndSaveToFS(title);
    if (tiddlerText === undefined) {
      throw new Error(`${title} ${i18n.t('Log.FileNotSyncedYet')}`);
    }
    return tiddlerText;
  }

  async #loadFromSqlite(title: string): Promise<string | undefined> {
    try {
      const dataSource = await sqliteServiceService.getDatabase(this.#workspace);
      const tiddlerRepo = dataSource.getRepository(TiddlerSQLModel);
      const tiddler = await tiddlerRepo.findOne({ where: { title } });
      return tiddler?.text ?? undefined;
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

  async #loadFromServerAndSaveToFS(title: string): Promise<string | undefined> {
    try {
      await backgroundSyncService.saveToFSFromServer(this.#workspace, title);
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
 * If you want some tiddlers not being skinny (For example, `$:/` tiddlers), make sure to save text field in the `fields` field when saving, in the plugins\src\expo-file-system-syncadaptor\file-system-syncadaptor.ts , see logic of `saveFullTiddler`
 * @returns json string same as what return from `tw-mobile-sync/get-skinny-tiddlywiki-tiddler-store-script`, with type `Promise<Array<Omit<ITiddlerFields, 'text'>> | undefined>`
 */
export async function getSkinnyTiddlersJSONFromSQLite(workspace: IWikiWorkspace): Promise<string> {
  try {
    const dataSource = await sqliteServiceService.getDatabase(workspace);
    const tiddlerRepo = dataSource.getRepository(TiddlerSQLModel);
    /** skinny tiddlers + full tiddlers judged by `saveFullTiddler` */
    const tiddlers = await tiddlerRepo.find({ select: ['fields'] });
    if (tiddlers.length === 0) {
      return '[]';
    }
    return `[${tiddlers.map(tiddler => tiddler.fields).filter((fields): fields is string => fields !== null).join(',')}]`;
  } catch (error) {
    throw new Error(`Error getting skinny tiddlers list from SQLite: ${(error as Error).message}`);
  }
}
