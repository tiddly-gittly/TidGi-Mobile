/* eslint-disable unicorn/no-null */
/* eslint-disable @typescript-eslint/promise-function-async */
import { asc, desc, eq, gt } from 'drizzle-orm';
import * as BackgroundFetch from 'expo-background-fetch';
import Constants from 'expo-constants';
import * as fs from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as TaskManager from 'expo-task-manager';
import { sortedUniqBy, uniq } from 'lodash';
import pTimeout from 'p-timeout';
import { Alert } from 'react-native';
import type { ITiddlerFieldsParam } from 'tiddlywiki';
import { getWikiFilesPathByCanonicalUri, getWikiTiddlerPathByTitle } from '../../constants/paths';
import i18n from '../../i18n';
import { useConfigStore } from '../../store/config';
import { IServerInfo, ServerStatus, useServerStore } from '../../store/server';
import { IWikiServerSync, IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';
import { sqliteServiceService } from '../SQLiteService';
import { TiddlerChangeSQLModel, TiddlersSQLModel } from '../SQLiteService/orm';
import { getFullSaveTiddlers, getSyncIgnoredTiddlers } from '../WikiStorageService/ignoredTiddler';
import { ITiddlerChange, TiddlersLogOperation } from '../WikiStorageService/types';
import { ISyncEndPointRequest, ISyncEndPointResponse, ITiddlywikiServerStatus } from './types';

export const BACKGROUND_SYNC_TASK_NAME = 'background-sync-task';
// 1. Define the task by providing a name and the function that should be executed
// Note: This needs to be called in the global scope (e.g outside of your React components)
TaskManager.defineTask(BACKGROUND_SYNC_TASK_NAME, async () => {
  const now = Date.now();

  console.log(`Got background fetch call at date: ${new Date(now).toISOString()}`);
  const { haveUpdate } = await backgroundSyncService.sync();

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
  readonly #serverStore = useServerStore;
  readonly #configStore = useConfigStore;
  readonly #workspacestore = useWorkspaceStore;

  public startBackgroundSync() {
    const syncInterval = this.#configStore.getState().syncInterval;
    setInterval(this.sync.bind(this), syncInterval);
  }

  public async sync() {
    const workspaces = this.#workspacestore.getState().workspaces;
    let haveUpdate = false;
    let haveConnectedServer = false;
    await this.updateServerOnlineStatus();
    for (const wiki of workspaces) {
      if (wiki.type === 'wiki') {
        const server = this.getOnlineServerForWiki(wiki);
        if (server !== undefined) {
          haveConnectedServer ||= true;
          haveUpdate ||= await this.syncWikiWithServer(wiki, server);
        }
      }
    }
    return { haveUpdate, haveConnectedServer };
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
    try {
      const { orm } = await sqliteServiceService.getDatabase(wiki);
      const lastSyncTimestamp: number = new Date(lastSync).getTime();
      const changeLogs = await orm.select().from(TiddlerChangeSQLModel).where(gt(TiddlerChangeSQLModel.timestamp, lastSyncTimestamp)).orderBy(
        newerFirst === true ? desc(TiddlerChangeSQLModel.timestamp) : asc(TiddlerChangeSQLModel.timestamp),
      );

      const filteredChangeLogs = changeLogs.filter(change => !getSyncIgnoredTiddlers(change.title).includes(change.title));

      const changeWithTiddlerFields: Array<{ fields?: ITiddlerFieldsParam } & ITiddlerChange> = await Promise.all(
        filteredChangeLogs.map(async change => {
          const result: { fields?: ITiddlerFieldsParam } & ITiddlerChange = {
            id: change.id,
            title: change.title,
            operation: change.operation as TiddlersLogOperation,
            timestamp: new Date(change.timestamp).toISOString(), // Convert Date to string
          };
          if (change.operation as TiddlersLogOperation === TiddlersLogOperation.DELETE) return result;
          // for update and insert, add text and fields to it
          const title = change.title;
          // const skinnyTiddlerWithText = await tiddlerRepo.findOne({ where: { title } });
          const [skinnyTiddlerWithText] = await orm.select().from(TiddlersSQLModel).where(eq(TiddlersSQLModel.title, title)).limit(1);
          if (skinnyTiddlerWithText === undefined) return result;

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
    const syncUrl = new URL('tw-mobile-sync/sync', server.uri);

    const request: ISyncEndPointRequest = {
      deleted: uniq(changes.filter(change => change.operation === TiddlersLogOperation.DELETE).map(change => change.title)),
      lastSync: server.lastSync,
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
          'User-Agent': `${await Constants.getWebViewUserAgentAsync() ?? `TidGi-Mobile`} ${wiki.name}`,
        },
        body: JSON.stringify(request),
      }).then(async response => {
        switch (response.status) {
          case 201:
          case 200: {
            return await (response.json() as Promise<ISyncEndPointResponse>);
          }
          case 401: {
            throw new Error(i18n.t('Log.Unauthorized'));
          }
          default: {
            throw new Error(`${i18n.t('Log.SyncFailedSystemError')} ${response.status} ${await response.text()}`);
          }
        }
      });
      if (response === undefined) return false;
      const { deletes, updates } = response;
      await this.#updateTiddlersFromServer(wiki, deletes, updates);
      this.#updateLastSyncTimestamp(wiki, server);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return true;
    } catch (error) {
      console.error(error, (error as Error).stack);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(`${server.name} ${i18n.t('Log.SynchronizationFailed')}`, `${(error as Error).message} ${i18n.t('Log.SynchronizationFailedDetail')}`, undefined, {
        cancelable: true,
      });
      return false;
    }
  }

  async #updateTiddlersFromServer(workspace: IWikiWorkspace, deletes: string[], updates: ITiddlerFieldsParam[]) {
    try {
      const dataSource = (await sqliteServiceService.getDatabase(workspace)).orm;
      await dataSource.transaction(async (transaction) => {
        // Delete Tiddlers
        for (const title of deletes) {
          // await tiddlerRepo.delete({ title });
          await transaction.delete(TiddlersSQLModel).where(eq(TiddlersSQLModel.title, title));
        }

        // Update Tiddlers
        for (const tiddlerFields of updates) {
          const { text, title, ...fieldsObjectToSave } = tiddlerFields as ITiddlerFieldsParam & { text?: string; title: string };
          const ignore = getSyncIgnoredTiddlers(title).includes(title);
          if (ignore) continue;
          const saveFullTiddler = getFullSaveTiddlers(title).includes(title);

          /**
           * If no text, or text is saved to fs, this will be null.
           */
          let textToSaveToSQLite: string | null = null;
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
              await fs.writeAsStringAsync(getWikiTiddlerPathByTitle(workspace, title), text);
              textToSaveToSQLite = null;
            } else {
              textToSaveToSQLite = text ?? null;
            }
            fieldsStringToSave = JSON.stringify({
              _is_skinny: '',
              title,
              ...fieldsObjectToSave,
            });
          }
          // Check if a tiddler with the same title already exists
          const existingTiddler = await transaction.query.TiddlersSQLModel.findFirst({
            columns: {
              title: true,
            },
            where: eq(TiddlersSQLModel.title, title),
          });
          /**
           * Save or update tiddler
           */
          const newTiddler = {
            title,
            text: textToSaveToSQLite,
            fields: fieldsStringToSave,
          } satisfies typeof TiddlersSQLModel.$inferInsert;
          if (existingTiddler === undefined) {
            await transaction.insert(TiddlersSQLModel).values(newTiddler);
          } else {
            await transaction.update(TiddlersSQLModel).set(newTiddler).where(eq(TiddlersSQLModel.title, title));
          }
        }
      });
    } catch (error) {
      console.error(error, (error as Error).stack);
    }
  }

  public checkIsLargeText(text: string, mimeType = 'text/plain') {
    const blob = new Blob([text], { type: mimeType });
    return blob.size > 2 * 1024 * 1024; // 2MB
  }

  public async saveToFSFromServer(workspace: IWikiWorkspace, title: string, onlineLastSyncServer = this.getOnlineServerForWiki(workspace)) {
    try {
      if (onlineLastSyncServer === undefined) {
        console.error(`saveToFSFromServer: Cannot find online server for workspace ${workspace.id}`);
        return;
      }
      const getTiddlerUrl = new URL(`/tw-mobile-sync/get-tiddler-text/${encodeURIComponent(title)}`, onlineLastSyncServer.uri);
      const filePath = getWikiTiddlerPathByTitle(workspace, title);
      const downloadPromise = this.#downloadTextContentToFs(getTiddlerUrl.toString(), filePath);
      await pTimeout(downloadPromise, { milliseconds: 20_000, message: `${i18n.t('AddWorkspace.DownloadBinaryTimeout')}: ${title}` });
    } catch (error) {
      console.error(`Failed to load tiddler ${title} from server: ${(error as Error).message} ${(error as Error).stack ?? ''}`);
      throw error;
    }
  }

  public async saveCanonicalUriToFSFromServer(workspace: IWikiWorkspace, title: string, canonicalUri: string, onlineLastSyncServer = this.getOnlineServerForWiki(workspace)) {
    let uri = canonicalUri;
    // Not support file:// or open://, which only works on server side, we can't access the filesystem of server. Server should migrate to use relative path.
    if (uri.startsWith('file:') || uri.startsWith('open:')) return;
    if (!uri.startsWith('http')) {
      uri = `${onlineLastSyncServer?.uri}/${uri}`;
    }
    try {
      const filePath = getWikiFilesPathByCanonicalUri(workspace, canonicalUri);
      const downloadPromise = this.#downloadTextContentToFs(uri, filePath);
      await pTimeout(downloadPromise, { milliseconds: 20_000, message: `${i18n.t('AddWorkspace.DownloadBinaryTimeout')}: ${title}` });
    } catch (error) {
      console.error(`Failed to load CanonicalUri tiddler ${title} from server: ${(error as Error).message} ${(error as Error).stack ?? ''}`);
      throw error;
    }
  }

  /**
   * Download content from url, handle delete content if download fail with 40x
   * @param url that will return a string content, or have error message in string content when 404/400
   */
  async #downloadTextContentToFs(url: string, filePath: string) {
    const result = await fs.downloadAsync(url, filePath);
    if (result.status !== 200) {
      // delete text file if have server error like 404
      const content = await fs.readAsStringAsync(filePath);
      const errorMessage = `${content} Status: ${result.status}`;
      await fs.deleteAsync(filePath);
      throw new Error(errorMessage);
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
