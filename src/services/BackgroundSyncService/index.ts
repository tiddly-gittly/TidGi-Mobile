/* eslint-disable @typescript-eslint/promise-function-async */
import * as SQLite from 'expo-sqlite';
import type { ITiddlerFieldsParam } from 'tiddlywiki';
import { getWikiMainSqliteName } from '../../constants/paths';
import { ISkinnyTiddlerWithText, ITiddlerChange, TiddlersLogOperation } from '../../pages/Importer/createTable';
import { useConfigStore } from '../../store/config';
import { IServerInfo, ServerStatus, useServerStore } from '../../store/server';
import { IWikiServerSync, IWikiWorkspace, useWikiStore } from '../../store/wiki';
import { ISyncEndPointRequest, ISyncEndPointResponse } from './types';

class BackgroundSyncService {
  #serverStore = useServerStore;
  #configStore = useConfigStore;
  #wikiStore = useWikiStore;

  public startBackgroundSync() {
    const syncInterval = this.#configStore.getState().syncInterval;
    setInterval(this.sync.bind(this), syncInterval);
  }

  public async sync() {
    const wikis = this.#wikiStore.getState().wikis;

    for (const wiki of wikis) {
      const server = this.#getOnlineServerForWiki(wiki);
      if (server !== undefined) {
        await this.syncWikiWithServer(wiki, server);
      }
    }
  }

  #getOnlineServerForWiki(wiki: IWikiWorkspace): (IServerInfo & { lastSync: number }) | undefined {
    const onlineLastSyncServer = wiki.syncedServers.sort((a, b) => b.lastSync - a.lastSync)
      .map(server => this.#serverStore.getState().servers[server.serverID])
      .find(server => server?.status === ServerStatus.online);
    const lastSync = wiki.syncedServers.find(server => server.serverID === onlineLastSyncServer?.id)?.lastSync;
    if (onlineLastSyncServer === undefined || lastSync === undefined) return undefined;
    return {
      ...onlineLastSyncServer,
      lastSync,
    };
  }

  async #getChangeLogsSinceLastSync(wiki: IWikiWorkspace, server: IServerInfo & { lastSync: number }): Promise<Array<{ fields?: ITiddlerFieldsParam } & ITiddlerChange>> {
    const database = SQLite.openDatabase(getWikiMainSqliteName(wiki));
    const lastSyncTimestamp = new Date(server.lastSync).toISOString();
    const resultSets = await database.execAsync(
      [{
        sql: `SELECT * FROM tiddlers_changes_log WHERE timestamp > ? ORDER BY timestamp ASC;`,
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
        const changeWithTiddlerFields: Array<{ fields?: ITiddlerFieldsParam } & ITiddlerChange> = await Promise.all(changeLogs.map(async change => {
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
          const fields = {
            ...fieldsWithoutText,
            text: skinnyTiddlerWithText.text,
          } satisfies ITiddlerFieldsParam;
          return {
            ...change,
            fields,
          };
        }));
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

  public async syncWikiWithServer(wiki: IWikiWorkspace, server: IServerInfo & { lastSync: number }) {
    const changes = await this.#getChangeLogsSinceLastSync(wiki, server);
    const syncUrl = new URL(`tw-mobile-sync/sync`, server.uri);

    const request: ISyncEndPointRequest = {
      deleted: changes.filter(change => change.operation === TiddlersLogOperation.DELETE).map(change => change.title),
      lastSync: new Date().toISOString(),
      tiddlers: changes.filter((change): change is { fields: ITiddlerFieldsParam } & ITiddlerChange =>
        (change.operation === TiddlersLogOperation.INSERT || change.operation === TiddlersLogOperation.UPDATE) && change.fields !== undefined
      ).map(change => change.fields),
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
      if (response === undefined) return;
      const { deletes, updates } = response;
      await this.#updateTiddlersFromServer(wiki, deletes, updates);
      this.#updateLastSyncTimestamp(wiki, server);
    } catch (error) {
      console.error(error, (error as Error).stack);
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
          const { text, ...fields } = tiddlerFields;
          if (typeof text === 'string') {
            await tx.executeSqlAsync(
              'INSERT OR REPLACE INTO tiddlers (title, text, fields) VALUES (?, ?, ?);',
              [tiddlerFields.title as string, text, JSON.stringify(fields)],
            );
          } else {
            await tx.executeSqlAsync(
              'INSERT OR REPLACE INTO tiddlers (title, fields) VALUES (?, ?);',
              [tiddlerFields.title as string, JSON.stringify(fields)],
            );
          }
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
