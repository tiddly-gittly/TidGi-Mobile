/* eslint-disable unicorn/no-null */
/* eslint-disable @typescript-eslint/require-await */
import { desc, eq } from 'drizzle-orm';
import * as fs from 'expo-file-system';
import { Observable } from 'rxjs';
import type { IChangedTiddlers, ITiddlerFieldsParam } from 'tiddlywiki';
import { getWikiFilesPathByTitle, getWikiTiddlerPathByTitle } from '../../constants/paths';
import { useConfigStore } from '../../store/config';
import { IWikiWorkspace } from '../../store/workspace';
import { backgroundSyncService } from '../BackgroundSyncService';
import { sqliteServiceService } from '../SQLiteService';
import { TiddlerChangeSQLModel, TiddlersSQLModel } from '../SQLiteService/orm';
import { IWikiServerStatusObject, TiddlersLogOperation } from '../WikiStorageService/types';
import { getFullSaveTiddlers } from './ignoredTiddler';

/**
 * Service that can be used to save/load wiki data
 *
 * - proxy by `react-native-postmessage-cat` to be `window.service.wikiStorageService`
 * - then used in `plugins/src/expo-file-system-syncadaptor/file-system-syncadaptor.ts` inside webview
 *
 * Don't forget to register method in WikiStorageServiceIPCDescriptor. Otherwise you will get `window.service.wikiStorageService.methodName is not a function` error.
 * All methods must be async.
 */
export class WikiStorageService {
  readonly #workspace: IWikiWorkspace;
  readonly #configStore = useConfigStore;

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

  /**
   * Save tiddler. Return the e-tag.
   * `tags` field should be string, and fields can't contain `null` or number or array, otherwise TW won't boot.
   */
  async saveTiddler(title: string, fields: ITiddlerFieldsParam): Promise<string> {
    try {
      /** Tiddlers that should save to SQLite as full tiddlers. Like plugins that starts with `$:/` */
      const saveFullTiddler = getFullSaveTiddlers(title).includes(title);
      const { text, title: _, ...fieldsObjectToSave } = fields as (ITiddlerFieldsParam & { text?: string; title: string });
      // if there is `null` in a field, it will cause TW silent fail when booting
      (Object.keys(fieldsObjectToSave) as Array<keyof typeof fieldsObjectToSave>).forEach(key => {
        if (fieldsObjectToSave[key] === null || fieldsObjectToSave[key] === undefined) {
          // @ts-expect-error Index signature in type '{ readonly [x: string]: unknown; readonly [x: number]: unknown; created?: string | undefined; modified?: string | undefined; }' only permits reading.ts(2542)
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete fieldsObjectToSave[key];
        }
      });
      const changeCount = '0'; // this.wikiInstance.wiki.getChangeCount(title).toString();
      const Etag = `"default/${encodeURIComponent(title)}/${changeCount}:"`;

      // Get the database connection for the workspace
      const { orm } = await sqliteServiceService.getDatabase(this.#workspace);
      await orm.transaction(async transaction => {
        let textToSave: string | null = null;
        let fieldsStringToSave: string;
        // for `$:/` tiddlers, if being skinny will throw error like `"Linked List only accepts string values, not " + value;`
        if (saveFullTiddler) {
          fieldsStringToSave = JSON.stringify({
            text,
            title,
            ...fieldsObjectToSave,
          });
        } else {
          // prevent save huge duplicated content to SQLite, if not necessary
          if (text !== undefined && backgroundSyncService.checkIsLargeText(text, fieldsObjectToSave.type as string)) {
            // save to fs instead of sqlite. See `WikiStorageService.#loadFromServer` for how we load it later.
            // `BackgroundSyncService.#updateTiddlersFromServer` will use saveToFSFromServer, but here we already have the text, so we can save it directly
            // don't set encoding here, otherwise read as utf8 will failed.
            await fs.writeAsStringAsync(getWikiTiddlerPathByTitle(this.#workspace, title), text);
            textToSave = null;
          } else {
            textToSave = text ?? null;
          }
          fieldsStringToSave = JSON.stringify({
            _is_skinny: '',
            title,
            ...fieldsObjectToSave,
          });
        }
        /**
         * Save or update tiddler
         * See `BackgroundSyncService.#updateTiddlersFromServer` for a similar logic
         */
        const newTiddler = {
          title,
          text: textToSave,
          fields: fieldsStringToSave,
        } satisfies typeof TiddlersSQLModel.$inferInsert;

        // Check if a tiddler with the same title already exists
        const existingTiddler = await transaction.query.TiddlersSQLModel.findFirst({
          columns: {
            title: true,
          },
          where: eq(TiddlersSQLModel.title, title),
        });
        let operation: TiddlersLogOperation = TiddlersLogOperation.INSERT;
        if (existingTiddler !== undefined) {
          // If tiddler exists, set operation to 'UPDATE'
          operation = TiddlersLogOperation.UPDATE;
        }
        const newOperation = {
          title,
          operation,
          timestamp: Date.now(),
        } satisfies typeof TiddlerChangeSQLModel.$inferInsert;
        if (operation === TiddlersLogOperation.UPDATE) {
          await transaction.update(TiddlersSQLModel).set(newTiddler).where(eq(TiddlersSQLModel.title, title));
          // Find the most recent update operation for this title
          const recentUpdate = await transaction.query.TiddlerChangeSQLModel.findFirst({
            columns: {
              id: true,
              operation: true,
              title: true,
            },
            orderBy: desc(TiddlerChangeSQLModel.timestamp),
          });

          if (recentUpdate !== undefined && recentUpdate.operation as TiddlersLogOperation === TiddlersLogOperation.UPDATE && recentUpdate.title === title) {
            // If we are frequently update same title, then update the timestamp of last update, instead of put a new UPDATE log.
            await transaction.update(TiddlerChangeSQLModel)
              .set({ timestamp: newOperation.timestamp })
              .where(eq(TiddlerChangeSQLModel.id, recentUpdate.id));
          } else {
            // Otherwise, insert the new update operation
            await transaction.insert(TiddlerChangeSQLModel).values(newOperation);
          }
        } else {
          await transaction.insert(TiddlersSQLModel).values(newTiddler);
          // For operations other than UPDATE, insert the operation as usual
          await transaction.insert(TiddlerChangeSQLModel).values(newOperation);
        }
      });

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
      const { orm } = await sqliteServiceService.getDatabase(this.#workspace);
      // Begin a transaction
      await orm.transaction(async transaction => {
        // Delete the fetched tiddler
        await transaction.delete(TiddlersSQLModel).where(eq(TiddlersSQLModel.title, title));

        // Insert into tiddlers_changes_log
        const newOperation = {
          title,
          operation: TiddlersLogOperation.DELETE,
          timestamp: Date.now(),
        } satisfies typeof TiddlerChangeSQLModel.$inferInsert;
        await transaction.insert(TiddlerChangeSQLModel).values(newOperation);
      });

      return true;
    } catch (error) {
      // for example, `Failed to delete tiddler, Tiddler with title "$:/Deck/new 1/study" not found.`
      console.error(`Failed to delete tiddler ${title}: ${(error as Error).message} ${(error as Error).stack ?? ''}`);
      throw error;
    }
  }

  async loadTiddlerText(title: string): Promise<string | undefined> {
    // try load from local, then from server. But usually, user sync full tiddlers store to here, so it this gives nothing, means that tiddler just don't have text, like calendar tiddlers may not have text.
    const tiddlerText = (await this.#loadFromSqlite(title)) ?? (await this.#loadFromFS(title)) ?? await this.#loadFromServerAndSaveToFS(title);
    return tiddlerText;
  }

  async #loadFromSqlite(title: string): Promise<string | undefined> {
    try {
      const { orm } = await sqliteServiceService.getDatabase(this.#workspace);
      const tiddlers = await orm.select().from(TiddlersSQLModel).where(eq(TiddlersSQLModel.title, title)).limit(1);
      return tiddlers[0]?.text ?? undefined;
    } catch (error) {
      console.error(`SQL error when getting ${title} : ${(error as Error).message} ${(error as Error).stack ?? ''}`);
      return undefined;
    }
  }

  async #loadFromFS(title: string): Promise<string | undefined> {
    // DEBUG: console title
    console.log(`title`, title);
    try {
      return await fs.readAsStringAsync(getWikiTiddlerPathByTitle(this.#workspace, title));
    } catch {
      try {
        return await fs.readAsStringAsync(getWikiFilesPathByTitle(this.#workspace, title));
      } catch {
        return undefined;
      }
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
