/* eslint-disable unicorn/no-null */
/* eslint-disable @typescript-eslint/promise-function-async */
import * as BackgroundFetch from 'expo-background-fetch';
import * as Haptics from 'expo-haptics';
import * as SQLite from 'expo-sqlite';
import * as TaskManager from 'expo-task-manager';
import { sortedUniqBy, uniq } from 'lodash';
import { Alert } from 'react-native';
import type { ITiddlerFieldsParam } from 'tiddlywiki';
import { getWikiMainSqliteName } from '../../constants/paths';
import i18n from '../../i18n';
import { ISkinnyTiddlerWithText, ITiddlerChange, TiddlersLogOperation } from '../../pages/Importer/createTable';
import { useConfigStore } from '../../store/config';
import { IServerInfo, ServerStatus, useServerStore } from '../../store/server';
import { IWikiServerSync, IWikiWorkspace, useWikiStore } from '../../store/wiki';
import { getLogIgnoredTiddler } from './ignoredTiddler';
import { ISyncEndPointRequest, ISyncEndPointResponse } from './types';

export const BACKGROUND_SYNC_TASK_NAME = 'background-sync-task';
// 1. Define the task by providing a name and the function that should be executed
// Note: This needs to be called in the global scope (e.g outside of your React components)
TaskManager.defineTask(BACKGROUND_SYNC_TASK_NAME, async () => {
  const now = Date.now();

  console.log(`Got background fetch call at date: ${new Date(now).toISOString()}`);
  const haveUpdate = await backgroundSyncService.sync();

  // Be sure to return the successful result type!
  return haveUpdate ? BackgroundFetch.BackgroundFetchResult.NewData : BackgroundFetch.BackgroundFetchResult.NoData;
});

// 2. Register the task at some point in your app by providing the same name,
// and some configuration options for how the background fetch should behave
// Note: This does NOT need to be in the global scope and CAN be used in your React components!
export async function registerBackgroundSyncAsync() {
  await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK_NAME, {
    minimumInterval: useConfigStore.getState().syncIntervalBackground / 1000, // 30 minutes in second
    stopOnTerminate: false, // android only,
    startOnBoot: true, // android only
  });
  // immediately sync once
  await backgroundSyncService.sync();
}

// 3. (Optional) Unregister tasks by specifying the task name
// This will cancel any future background fetch calls that match the given name
// Note: This does NOT need to be in the global scope and CAN be used in your React components!
export async function unregisterBackgroundSyncAsync() {
  await BackgroundFetch.unregisterTaskAsync(BACKGROUND_SYNC_TASK_NAME);
}

class BackgroundSyncService {
  #serverStore = useServerStore;
  #configStore = useConfigStore;
  #wikiStore = useWikiStore;

  public startBackgroundSync() {
    const syncInterval = this.#configStore.getState().syncInterval;
    setInterval(this.sync.bind(this), syncInterval);
  }

  public async sync(): Promise<boolean> {
    const wikis = this.#wikiStore.getState().wikis;
    let haveUpdate = false;
    for (const wiki of wikis) {
      const server = this.getOnlineServerForWiki(wiki);
      if (server !== undefined) {
        haveUpdate ||= await this.syncWikiWithServer(wiki, server);
      }
    }
    return haveUpdate;
  }

  public getOnlineServerForWiki(wiki: IWikiWorkspace): (IServerInfo & { lastSync: number; syncActive: boolean }) | undefined {
    const onlineLastSyncServer = wiki.syncedServers
      .filter(serverInfoInWiki => serverInfoInWiki.syncActive)
      .sort((a, b) => b.lastSync - a.lastSync)
      .map(server => this.#serverStore.getState().servers[server.serverID])
      .find(server => server?.status === ServerStatus.online);
    const serverInfoInWiki = wiki.syncedServers.find(server => server.serverID === onlineLastSyncServer?.id);
    if (onlineLastSyncServer === undefined || serverInfoInWiki === undefined) return undefined;
    return {
      ...onlineLastSyncServer,
      lastSync: serverInfoInWiki.lastSync,
      syncActive: serverInfoInWiki.syncActive,
    };
  }

  public async getChangeLogsSinceLastSync(wiki: IWikiWorkspace, lastSync: number, newerFirst?: boolean): Promise<Array<{ fields?: ITiddlerFieldsParam } & ITiddlerChange>> {
    const database = SQLite.openDatabase(getWikiMainSqliteName(wiki));
    // Convert the JavaScript Date number to SQLite `DATETIME DEFAULT CURRENT_TIMESTAMP` 'YYYY-MM-DD HH:MM:SS' format
    const lastSyncTimestamp = new Date(lastSync).toISOString().slice(0, 19).replace('T', ' ');
    const resultSets = await database.execAsync(
      [{
        sql: `SELECT * FROM tiddlers_changes_log WHERE strftime('%s', timestamp) > strftime('%s', ?) ORDER BY timestamp ${newerFirst === true ? 'DESC' : 'ASC'};`,
        args: [lastSyncTimestamp],
      }],
      true,
    );

    try {
      const resultSet = resultSets[0];
      if (resultSet === undefined) return [];
      if ('error' in resultSet) {
        console.error(resultSet.error);
        return [];
      }
      if (resultSet.rows.length > 0) {
        const changeLogs = resultSet.rows as ITiddlerChange[];
        const changeWithTiddlerFields: Array<{ fields?: ITiddlerFieldsParam } & ITiddlerChange> = await Promise.all(
          changeLogs
            .filter(change => !(getLogIgnoredTiddler(change.title).includes(change.title)))
            .map(async change => {
              if (change.operation === 'DELETE') return change;
              const title = change.title;
              // get text and fields from sqlite
              const resultSet = await database.execAsync(
                [{
                  sql: `SELECT text, fields FROM tiddlers WHERE title = ?;`,
                  args: [title],
                }],
                true,
              );
              const result = resultSet[0];
              if (result === undefined) return change;
              if ('error' in result) {
                console.error(result.error);
                return change;
              }
              if (result.rows.length === 0) {
                return change;
              }
              const skinnyTiddlerWithText = result.rows[0] as ISkinnyTiddlerWithText;
              const fieldsWithoutText = JSON.parse(skinnyTiddlerWithText.fields) as ITiddlerFieldsParam;
              // delete skinny tiddler related fields
              if ('_is_skinny' in fieldsWithoutText) delete fieldsWithoutText._is_skinny;
              if ('bag' in fieldsWithoutText) delete fieldsWithoutText.bag;
              if ('revision' in fieldsWithoutText) delete fieldsWithoutText.revision;
              const fields = {
                ...fieldsWithoutText,
                text: skinnyTiddlerWithText.text,
              } satisfies ITiddlerFieldsParam;
              return {
                ...change,
                fields,
              };
            }),
        );
        return changeWithTiddlerFields;
      }
      return [];
    } catch (error) {
      console.error(error, (error as Error).stack);
      return [];
    } finally {
      database.closeAsync();
    }
  }

  public async syncWikiWithServer(wiki: IWikiWorkspace, server: IServerInfo & { lastSync: number }): Promise<boolean> {
    const changes = await this.getChangeLogsSinceLastSync(wiki, server.lastSync);
    const syncUrl = new URL(`tw-mobile-sync/sync`, server.uri);

    const request: ISyncEndPointRequest = {
      deleted: uniq(changes.filter(change => change.operation === TiddlersLogOperation.DELETE).map(change => change.title)),
      lastSync: String(server.lastSync),
      tiddlers: sortedUniqBy(
        changes.filter((change): change is { fields: ITiddlerFieldsParam } & ITiddlerChange =>
          (change.operation === TiddlersLogOperation.INSERT || change.operation === TiddlersLogOperation.UPDATE) && change.fields?.title !== undefined
        ).map(change => change.fields),
        'title',
      ),
    };

    try {
      const response = await fetch(syncUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'TiddlyWiki',
        },
        body: JSON.stringify(request),
      }).then(response => response.json() as Promise<ISyncEndPointResponse>);
      if (response === undefined) return false;
      const { deletes, updates } = response;
      await this.#updateTiddlersFromServer(wiki, deletes, updates);
      this.#updateLastSyncTimestamp(wiki, server);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return true;
    } catch (error) {
      console.error(error, (error as Error).stack);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(`${server.name} ${i18n.t('Log.SynchronizationFailed')}`, `${i18n.t('Log.SynchronizationFailedDetail')} Error: ${(error as Error).message}`, undefined, {
        cancelable: true,
      });
      return false;
    }
  }

  async #updateTiddlersFromServer(wiki: IWikiWorkspace, deletes: string[], updates: ITiddlerFieldsParam[]) {
    const database = SQLite.openDatabase(getWikiMainSqliteName(wiki));
    try {
      await database.transactionAsync(async (tx) => {
        await Promise.all(deletes.map(async title => {
          await tx.executeSqlAsync(
            'DELETE FROM tiddlers WHERE title = ?;',
            [title],
          );
        }));
        await Promise.all(updates.map(async tiddlerFields => {
          let { text = '', ...fields } = tiddlerFields as ITiddlerFieldsParam & { text?: string };
          // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
          if (!text) {
            const existingTextResult = await tx.executeSqlAsync(
              'SELECT text FROM tiddlers WHERE title = ?;',
              [tiddlerFields.title as string],
            );
            if ('rows' in existingTextResult) {
              text = (existingTextResult.rows[0]?.text as string | undefined) ?? '';
            } else {
              console.warn(`Cannot find text for tiddler ${tiddlerFields.title as string} ${(existingTextResult)?.error?.message}`);
            }
          }
          // make sure we store skinny fields to `fields` field of SQLite, so when we get all of them later, wiki can still lazy-loading
          fields = {
            _is_skinny: '',
            ...fields,
          };
          await tx.executeSqlAsync(
            'INSERT OR REPLACE INTO tiddlers (title, text, fields) VALUES (?, ?, ?);',
            [tiddlerFields.title as string, text, JSON.stringify(fields)],
          );
        }));
      }, false);
    } catch (error) {
      console.error(error, (error as Error).stack);
    } finally {
      database.closeAsync();
    }
  }

  #updateLastSyncTimestamp(wiki: IWikiWorkspace, server: IServerInfo & { lastSync: number }) {
    const syncedServer = wiki.syncedServers.find(syncedServer => syncedServer.serverID === server.id)!;
    const newSyncedServers: IWikiServerSync = { ...syncedServer, lastSync: Date.now() };
    const update = this.#wikiStore.getState().update;
    const newWiki = { ...wiki, syncedServers: wiki.syncedServers.map(syncedServer => syncedServer.serverID === server.id ? newSyncedServers : syncedServer) };
    update(wiki.id, newWiki);
  }
}

export const backgroundSyncService = new BackgroundSyncService();
