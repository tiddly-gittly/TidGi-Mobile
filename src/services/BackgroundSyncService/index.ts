/* eslint-disable unicorn/no-null */
/* eslint-disable @typescript-eslint/promise-function-async */
import * as BackgroundFetch from 'expo-background-fetch';
import * as fs from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as TaskManager from 'expo-task-manager';
import { sortedUniqBy, uniq } from 'lodash';
import { Alert } from 'react-native';
import type { ITiddlerFieldsParam } from 'tiddlywiki';
import { getWikiTiddlerPathByTitle } from '../../constants/paths';
import i18n from '../../i18n';
import { useConfigStore } from '../../store/config';
import { IServerInfo, ServerStatus, useServerStore } from '../../store/server';
import { IWikiServerSync, IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';
import { sqliteServiceService } from '../SQLiteService';
import { TiddlerChangeSQLModel, TiddlerSQLModel } from '../SQLiteService/orm';
import { getFullSaveTiddlers, getSyncIgnoredTiddlers } from '../WikiStorageService/ignoredTiddler';
import { ITiddlerChange, TiddlersLogOperation } from '../WikiStorageService/types';
import { ISyncEndPointRequest, ISyncEndPointResponse, ITiddlywikiServerStatus } from './types';

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

export class BackgroundSyncService {
  #serverStore = useServerStore;
  #configStore = useConfigStore;
  #workspacestore = useWorkspaceStore;

  public startBackgroundSync() {
    const syncInterval = this.#configStore.getState().syncInterval;
    setInterval(this.sync.bind(this), syncInterval);
  }

  public async sync(): Promise<boolean> {
    const workspaces = this.#workspacestore.getState().workspaces;
    let haveUpdate = false;
    await this.updateServerOnlineStatus();
    for (const wiki of workspaces) {
      if (wiki.type === 'wiki') {
        const server = await this.getOnlineServerForWiki(wiki);
        if (server !== undefined) {
          haveUpdate ||= await this.syncWikiWithServer(wiki, server);
        }
      }
    }
    return haveUpdate;
  }

  public async updateServerOnlineStatus() {
    const newServers: Record<string, IServerInfo> = {};
    await Promise.all(
      Object.values(this.#serverStore.getState().servers).map(async server => {
        try {
          // TODO: add fetched server version to store
          await this.#fetchServerStatus(server);
          newServers[server.id] = { ...server, status: ServerStatus.online };
        } catch {
          newServers[server.id] = { ...server, status: ServerStatus.disconnected };
        }
      }),
    );
    this.#serverStore.setState({ servers: newServers });
  }

  async #fetchServerStatus(server: IServerInfo) {
    const statusUrl = new URL(`status`, server.uri);
    const controller = new AbortController();
    const abortTimeoutID = setTimeout(() => {
      controller.abort();
    }, 1000);
    const response = await fetch(statusUrl, { signal: controller.signal }).then(response => response.json() as Promise<{ status: ITiddlywikiServerStatus }>);
    clearTimeout(abortTimeoutID);
    return response;
  }

  public async getOnlineServerForWiki(wiki: IWikiWorkspace, updated?: boolean): Promise<(IServerInfo & { lastSync: number; syncActive: boolean }) | undefined> {
    if (updated === true) {
      await this.updateServerOnlineStatus();
    }
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
    try {
      const dataSource = await sqliteServiceService.getDatabase(wiki);
      const tiddlerChangeRepo = dataSource.getRepository(TiddlerChangeSQLModel);
      const tiddlerRepo = dataSource.getRepository(TiddlerSQLModel);

      const lastSyncTimestamp = new Date(lastSync).toISOString().slice(0, 19).replace('T', ' ');

      const changeLogs = await tiddlerChangeRepo.createQueryBuilder('change')
        .where("strftime('%s', change.timestamp) > strftime('%s', :lastSyncTimestamp)", { lastSyncTimestamp })
        .orderBy('change.timestamp', newerFirst === true ? 'DESC' : 'ASC')
        .getMany();

      const filteredChangeLogs = changeLogs.filter(change => !getSyncIgnoredTiddlers(change.title).includes(change.title));

      const changeWithTiddlerFields: Array<{ fields?: ITiddlerFieldsParam } & ITiddlerChange> = await Promise.all(
        filteredChangeLogs.map(async change => {
          const result: { fields?: ITiddlerFieldsParam } & ITiddlerChange = {
            id: change.id,
            title: change.title,
            operation: change.operation,
            timestamp: change.timestamp.toISOString(), // Convert Date to string
          };
          if (change.operation === TiddlersLogOperation.DELETE) return result;
          // for update and insert, add text and fields to it
          const title = change.title;
          const skinnyTiddlerWithText = await tiddlerRepo.findOne({ where: { title } });
          if (skinnyTiddlerWithText === null) return result;

          /**
           * This may have text if it is `getFullSaveTiddlers` tiddler, otherwise it is skinny tiddler without text.
           */
          const fieldsParameter = JSON.parse(skinnyTiddlerWithText.fields ?? '{}') as ITiddlerFieldsParam;
          // @ts-expect-error Index signature in type 'ITiddlerFieldsParam' only permits reading.ts(2542)
          if ('_is_skinny' in fieldsParameter) delete fieldsParameter._is_skinny;
          // @ts-expect-error Index signature in type 'ITiddlerFieldsParam' only permits reading.ts(2542)
          if ('bag' in fieldsParameter) delete fieldsParameter.bag;
          // @ts-expect-error Index signature in type 'ITiddlerFieldsParam' only permits reading.ts(2542)
          if ('revision' in fieldsParameter) delete fieldsParameter.revision;

          let text;
          try {
            text = skinnyTiddlerWithText.text ?? fieldsParameter.text ?? (await fs.readAsStringAsync(getWikiTiddlerPathByTitle(wiki, title)));
          } catch (error) {
            console.error(`Failed to load file ${title} in getChangeLogsSinceLastSync ${(error as Error).message}`);
          }
          const fields = {
            ...fieldsParameter,
            text,
          } satisfies ITiddlerFieldsParam;

          result.fields = fields;
          return result;
        }),
      );

      return changeWithTiddlerFields;
    } catch (error) {
      console.error(error, (error as Error).stack);
      return [];
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
    try {
      const dataSource = await sqliteServiceService.getDatabase(wiki);
      await dataSource.transaction(async (transactionalEntityManager) => {
        const tiddlerRepo = transactionalEntityManager.getRepository(TiddlerSQLModel);
        // Delete Tiddlers
        for (const title of deletes) {
          await tiddlerRepo.delete({ title });
        }

        // Update Tiddlers
        for (const tiddlerFields of updates) {
          const { text, title, ...fieldsToSave } = tiddlerFields as ITiddlerFieldsParam & { text?: string; title: string };
          const ignore = getSyncIgnoredTiddlers(title).includes(title);
          if (ignore) continue;
          const saveFullTiddler = getFullSaveTiddlers(title).includes(title);

          // If no text is provided, means user delete the text on the Desktop. But not deleting this tiddler. fixes #18
          // // If no text is provided, fetch from existing tiddler. This should not happened in tw-mobile-sync, just in case.
          // // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
          // if (!text) {
          //   const existingTiddler = await tiddlerRepo.findOne({ where: { title } });
          //   if (existingTiddler === null) {
          //     console.warn(`Cannot find text for tiddler ${title}`);
          //   } else {
          //     text = existingTiddler.text ?? '';
          //   }
          // }

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
            if (text !== undefined && this.checkIsLargeText(text, fieldsToSave.type as string)) {
              // save to fs instead of sqlite. See `WikiStorageService.#loadFromServer` for how we load it later.
              await this.saveToFSFromServer(wiki, title);
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
        }
      });
    } catch (error) {
      console.error(error, (error as Error).stack);
    }
  }

  public checkIsLargeText(text: string, mimeType = 'text/plain') {
    const blob = new Blob([text], { type: mimeType });
    return blob.size > 200 * 1024; // 200KB
  }

  public async saveToFSFromServer(workspace: IWikiWorkspace, title: string) {
    try {
      const onlineLastSyncServer = await this.getOnlineServerForWiki(workspace);
      if (onlineLastSyncServer === undefined) return;
      const getTiddlerUrl = new URL(`/tw-mobile-sync/get-tiddler-text/${encodeURIComponent(title)}`, onlineLastSyncServer.uri);
      await fs.downloadAsync(getTiddlerUrl.toString(), getWikiTiddlerPathByTitle(workspace, title));
    } catch (error) {
      console.error(`Failed to load tiddler ${title} from server: ${(error as Error).message} ${(error as Error).stack ?? ''}`);
      throw error;
    }
  }

  #updateLastSyncTimestamp(wiki: IWikiWorkspace, server: IServerInfo & { lastSync: number }) {
    const syncedServer = wiki.syncedServers.find(syncedServer => syncedServer.serverID === server.id)!;
    const newSyncedServers: IWikiServerSync = { ...syncedServer, lastSync: Date.now() };
    const update = this.#workspacestore.getState().update;
    const newWiki = { ...wiki, syncedServers: wiki.syncedServers.map(syncedServer => syncedServer.serverID === server.id ? newSyncedServers : syncedServer) };
    update(wiki.id, newWiki);
  }
}

export const backgroundSyncService = new BackgroundSyncService();
