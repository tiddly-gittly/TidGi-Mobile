import debounce from 'lodash/debounce';
import type { IChangedTiddlers, ITiddlerFields, Syncer, Tiddler, Wiki } from 'tiddlywiki';
import type { AppDataService } from '../../../src/services/AppDataService/index.js';
import type { GitBackgroundSyncService } from '../../../src/services/BackgroundSyncService/index.js';
import type { NativeService } from '../../../src/services/NativeService/index.js';
import type { WikiHookService } from '../../../src/services/WikiHookService/index.js';
import type { FileSystemWikiStorageService as WikiStorageService } from '../../../src/services/WikiStorageService/FileSystemWikiStorageService.js';

interface Logger {
  alert: (message: string) => void;
  log: (...arguments_: any[]) => void;
  setSaveBuffer?: (logger: Logger) => void;
}

type ISyncAdaptorGetStatusCallback = (error: Error | null, isLoggedIn?: boolean, username?: string, isReadOnly?: boolean, isAnonymous?: boolean) => void;
// type ISyncAdaptorGetTiddlersJSONCallback = (error: Error | null, tiddler?: Array<Omit<ITiddlerFields, 'text'>>) => void;
type ISyncAdaptorPutTiddlersCallback = (error: Error | null | string, etag?: {
  bag: string;
}, version?: string) => void;
type ISyncAdaptorLoadTiddlerCallback = (error: Error | null, tiddler?: ITiddlerFields) => void;
type ISyncAdaptorDeleteTiddlerCallback = (error: Error | null, adaptorInfo?: { bag?: string } | null) => void;

interface IRelatedWorkspaceRoutingConfig {
  fileSystemPathFilter: string | null;
  fileSystemPathFilterEnable: boolean;
  id: string;
  includeTagTree: boolean;
  isSubWiki: boolean;
  mainWikiID: string | null;
  name: string;
  order: number;
  tagNames: string[];
}

declare global {
  interface Window {
    isInTidGi?: boolean;
    service?: {
      appDataService: AppDataService;
      backgroundSyncService: GitBackgroundSyncService;
      nativeService: NativeService;
      wikiHookService: WikiHookService;
      wikiStorageService: WikiStorageService;
    };
  }
}

class TidGiMobileFileSystemSyncAdaptor {
  name = 'tidgi-mobile-fs';
  supportsLazyLoading = true;
  wiki: Wiki;
  hasStatus: boolean;
  logger: Logger;
  isLoggedIn: boolean;
  isAnonymous: boolean;
  isReadOnly: boolean;
  logoutIsAvailable: boolean;
  wikiStorageService: WikiStorageService;
  workspaceID: string;
  recipe?: string;
  tiddlersToNotSave: string[];
  routingConfigCache?: {
    fetchedAt: number;
    items: IRelatedWorkspaceRoutingConfig[];
  };

  constructor(options: { wiki: Wiki }) {
    if (window.service?.wikiStorageService === undefined) {
      throw new Error("TidGi-Mobile wikiStorageService is undefined, can't load wiki.");
    }
    this.wikiStorageService = window.service.wikiStorageService;
    if (window.meta?.()?.workspaceID === undefined) {
      throw new Error("TidGi-Mobile workspaceID is undefined, can't load wiki.");
    }
    this.workspaceID = window.meta?.()?.workspaceID;
    this.wiki = options.wiki;
    this.hasStatus = false;
    this.isAnonymous = false;
    this.logger = new $tw.utils.Logger('TidGiMobileFileSystemSyncAdaptor') as any;
    this.isLoggedIn = false;
    this.isReadOnly = false;
    this.logoutIsAvailable = true;
    this.tiddlersToNotSave = $tw.utils.parseStringArray(this.wiki.getTiddlerText('$:/plugins/linonetwo/expo-file-system-syncadaptor/TiddlersToNotSave') ?? '');
    // React-Native don't have fs monitor, so no SSE on mobile
    // this.setupSSE();
  }

  setupSSE() {
    if (this.wikiStorageService.getWikiChangeObserver$ === undefined) {
      console.error("getWikiChangeObserver$ is undefined in wikiStorageService, can't subscribe to server changes.");
      return;
    }
    const debouncedSync = debounce(() => {
      if ($tw.syncer === undefined) {
        console.error('Syncer is undefined in TidGiMobileFileSystemSyncAdaptor. Abort the `syncFromServer` in `setupSSE debouncedSync`.');
        return;
      }
      $tw.syncer.syncFromServer();
      this.clearUpdatedTiddlers();
    }, 500);
    this.logger.log('setupSSE');

    // After SSE is enabled, we can disable polling and else things that related to syncer. (build up complexer behavior with syncer.)
    this.configSyncer();

    this.wikiStorageService.getWikiChangeObserver$().subscribe((change: IChangedTiddlers) => {
      // `$tw.syncer.syncFromServer` calling `this.getUpdatedTiddlers`, so we need to update `this.updatedTiddlers` before it do so. See `core/modules/syncer.js` in the core
      Object.keys(change).forEach(title => {
        if (!change[title]) {
          return;
        }
        if (change[title].deleted && !this.recentUpdatedTiddlersFromClient.deletions.includes(title)) {
          this.updatedTiddlers.deletions.push(title);
        } else if (change[title].modified && !this.recentUpdatedTiddlersFromClient.modifications.includes(title)) {
          this.updatedTiddlers.modifications.push(title);
        }
      });
      debouncedSync();
    });
  }

  updatedTiddlers: { deletions: string[]; modifications: string[] } = {
    // use $:/StoryList to trigger a initial sync, otherwise it won't do lazy load for Index tiddler after init, don't know why, maybe because we disabled the polling by changing pollTimerInterval.
    modifications: [],
    deletions: [],
  };

  /**
   * We will get echo from the server, for these tiddler changes caused by the client, we remove them from the `updatedTiddlers` so that the client won't get them again from server, which will usually get outdated tiddler (lack 1 or 2 words that user just typed).
   */
  recentUpdatedTiddlersFromClient: { deletions: string[]; modifications: string[] } = {
    modifications: [],
    deletions: [],
  };

  /**
   * Add a title as lock to prevent sse echo back. This will auto clear the lock after 2s (this number still needs testing).
   * And it only clear one title after 2s, so if you add the same title rapidly, it will prevent sse echo after 2s of last operation, which can prevent last echo, which is what we want.
   */
  addRecentUpdatedTiddlersFromClient(type: 'modifications' | 'deletions', title: string) {
    this.recentUpdatedTiddlersFromClient[type].push(title);
    setTimeout(() => {
      const index = this.recentUpdatedTiddlersFromClient[type].indexOf(title);
      if (index !== -1) {
        this.recentUpdatedTiddlersFromClient[type].splice(index, 1);
      }
    }, 2000);
  }

  clearUpdatedTiddlers() {
    this.updatedTiddlers = {
      modifications: [],
      deletions: [],
    };
  }

  private configSyncer() {
    if ($tw.syncer === undefined) {
      console.error('Syncer is undefined in TidGiMobileFileSystemSyncAdaptor. Abort the configSyncer.');
      return;
    }
    $tw.syncer.pollTimerInterval = 2_147_483_647;
  }

  getUpdatedTiddlers(_syncer: Syncer, callback: (error: Error | null | undefined, changes: { deletions: string[]; modifications: string[] }) => void): void {
    this.logger.log('getUpdatedTiddlers');
    callback(null, this.updatedTiddlers);
  }

  setLoggerSaveBuffer(loggerForSaving: Logger) {
    this.logger.setSaveBuffer?.(loggerForSaving);
  }

  isReady() {
    // We ipc sync adaptor is always ready to work! (Otherwise this will be false for first lazy-load event.) Seems first lazy load happened before the first status ipc call returns.
    return true;
  }

  getTiddlerInfo(tiddler: Tiddler) {
    return {
      bag: tiddler.fields.bag,
    };
  }

  getTiddlerRevision(title: string) {
    const tiddler = this.wiki.getTiddler(title);
    return tiddler?.fields?.revision;
  }

  /**
   * Get the current status of the TiddlyWeb connection
   */
  async getStatus(callback?: ISyncAdaptorGetStatusCallback) {
    this.logger.log('Getting status');
    try {
      const status = await this.wikiStorageService.getStatus();
      if (status === undefined) {
        throw new Error('No status returned from callWikiIpcServerRoute getStatus');
      }
      this.hasStatus = true;
      // Record the recipe
      this.recipe = status.space?.recipe;
      // Check if we're logged in
      this.isLoggedIn = status.username !== 'GUEST';
      this.isReadOnly = !!status.read_only;
      this.isAnonymous = !!status.anonymous;
      // this.logoutIsAvailable = 'logout_is_available' in status ? !!status.logout_is_available : true;

      callback?.(null, this.isLoggedIn, status.username, this.isReadOnly, this.isAnonymous);
    } catch (error) {
      // eslint-disable-next-line n/no-callback-literal
      callback?.(error as Error);
    }
  }

  /**
   * Get an array of skinny tiddler fields from the server
   * But HTML wiki already have all skinny tiddlers, so omit this. If this is necessary, maybe need mobile-sync plugin provide this, and store in asyncStorage, then provided here.
   */
  // async getSkinnyTiddlers(callback: ISyncAdaptorGetTiddlersJSONCallback) {
  //   this.logger.log('getSkinnyTiddlers');
  //   try {
  //     // const selector = 'script.tiddlywiki-tiddler-store.skinnyTiddlers'
  //     // this.logger.log(`getSkinnyTiddlers from ${selector}`);
  //     // const tiddlersJSONPreloadInScriptTag = document.querySelector(selector)
  //     // if (tiddlersJSONPreloadInScriptTag === null) {
  //     //   callback?.(new Error('No tiddler store in HTML.'));
  //     //   return;
  //     // }

  //     const skinnyTiddlerStoreString = await this.wikiStorageService.getSkinnyTiddlers();
  //     if (skinnyTiddlerStoreString === undefined) {
  //       callback?.(new Error('Load tiddler store failed'));
  //       return;
  //     }
  //     const skinnyTiddlers = JSON.parse(skinnyTiddlerStoreString) as Array<Omit<ITiddlerFields, 'text'>> | undefined;
  //     if (skinnyTiddlers === undefined) {
  //       throw new Error('No tiddlers returned from callWikiIpcServerRoute getTiddlersJSON in getSkinnyTiddlers');
  //     }
  //     this.logger.log('skinnyTiddlers.length', skinnyTiddlers.length);
  //     // Invoke the callback with the skinny tiddlers
  //     callback(null, skinnyTiddlers);
  //   } catch (error) {
  //     // eslint-disable-next-line n/no-callback-literal
  //     callback?.(error as Error);
  //   }
  // }

  /*
  Save a tiddler and invoke the callback with (err,adaptorInfo,revision)
  */
  async saveTiddler(tiddler: Tiddler, callback: ISyncAdaptorPutTiddlersCallback, _options?: unknown) {
    if (this.isReadOnly) {
      callback(null);
      return;
    }
    try {
      // Similar to https://github.com/TiddlyWiki/TiddlyWiki5/blob/master/core/modules/server/routes/put-tiddler.js#L36 but we just stop saving, and wait for lazy-load on client to complete, and let client to save again later.
      if (tiddler.fields._is_skinny) {
        return;
      }
      const title = tiddler.fields.title;
      if (this.tiddlersToNotSave.includes(title)) {
        this.logger.log(`Ignore saveTiddler ${title}, config in TiddlersToNotSave`);
        // if not calling callback in sync adaptor, will cause it waiting forever
        callback(null);
        return;
      }
      this.logger.log(`saveTiddler ${title}`);
      this.addRecentUpdatedTiddlersFromClient('modifications', title);
      const targetWorkspaceId = await this.routeTiddlerToWorkspace(tiddler);
      const etag = await this.wikiStorageService.saveTiddler(title, tiddler.getFieldStrings(), targetWorkspaceId);
      if (etag === undefined) {
        callback(new Error('Response from server is missing required `etag` header'));
      } else {
        const etagInfo = this.parseEtag(etag);
        if (etagInfo === undefined) {
          callback(new Error(`Response from server etag header failed to parsed from ${etag}`));
        } else {
          // Invoke the callback
          callback(null, {
            bag: etagInfo.bag,
          }, etagInfo.revision);
        }
      }
    } catch (error) {
      // eslint-disable-next-line n/no-callback-literal
      callback?.(error as Error);
    }
  }

  /**
   * Load a tiddler and invoke the callback with (err,tiddlerFields)
   * Need a tiddler with `_is_skinny: ""` to trigger this.
   */
  async loadTiddler(title: string, callback?: ISyncAdaptorLoadTiddlerCallback) {
    this.logger.log(`loadTiddler ${title}`);
    try {
      const tiddler = this.wiki.getTiddler(title);
      if (tiddler === undefined) {
        throw new Error(`Tiddler "${title}" not exist`);
      }
      const tiddlerText = await this.wikiStorageService.loadTiddlerText(title);
      const tiddlerFields: ITiddlerFields = {
        ...tiddler.fields,
        text: tiddlerText ?? '',
        type: tiddler.fields.type ?? 'text/vnd.tiddlywiki',
        _is_skinny: undefined,
        revision: undefined,
        bag: undefined,
      };

      // only add revision if it > 0 or exists

      // if (this.wiki.getChangeCount(title)) {
      //   tiddlerFields.revision = String(this.wiki.getChangeCount(title));
      // }
      callback?.(null, tiddlerFields);
    } catch (error) {
      // eslint-disable-next-line n/no-callback-literal
      callback?.(error as Error);
    }
  }

  /*
  Delete a tiddler and invoke the callback with (err)
  options include:
  tiddlerInfo: the syncer's tiddlerInfo for this tiddler
  */
  async deleteTiddler(title: string, callback: ISyncAdaptorDeleteTiddlerCallback, _options: { tiddlerInfo: { adaptorInfo: { bag?: string } } }) {
    if (this.isReadOnly) {
      callback(null);
      return;
    }
    this.logger.log('deleteTiddler', title);
    try {
      this.addRecentUpdatedTiddlersFromClient('deletions', title);
      await this.wikiStorageService.deleteTiddler(title);
      callback(null, null);
    } catch (error) {
      // eslint-disable-next-line n/no-callback-literal
      callback?.(error as Error);
    }
  }

  /*
  Split a TiddlyWeb Etag into its constituent parts. For example:

  ```
  "system-images_public/unsyncedIcon/946151:9f11c278ccde3a3149f339f4a1db80dd4369fc04"
  ```

  Note that the value includes the opening and closing double quotes.

  The parts are:

  ```
  <bag>/<title>/<revision>:<hash>
  ```
  */
  parseEtag(etag: string) {
    const firstSlash = etag.indexOf('/');
    const lastSlash = etag.lastIndexOf('/');
    const colon = etag.lastIndexOf(':');
    if (!(firstSlash === -1 || lastSlash === -1 || colon === -1)) {
      return {
        bag: $tw.utils.decodeURIComponentSafe(etag.substring(1, firstSlash)),
        title: $tw.utils.decodeURIComponentSafe(etag.substring(firstSlash + 1, lastSlash)),
        revision: etag.substring(lastSlash + 1, colon),
      };
    }
  }

  async getRoutingConfigs(): Promise<IRelatedWorkspaceRoutingConfig[]> {
    const cacheTTL = 2000;
    if (this.routingConfigCache && Date.now() - this.routingConfigCache.fetchedAt < cacheTTL) {
      return this.routingConfigCache.items;
    }

    if (typeof this.wikiStorageService.getRelatedWorkspacesRoutingConfig !== 'function') {
      return [];
    }

    const configs = await this.wikiStorageService.getRelatedWorkspacesRoutingConfig() as IRelatedWorkspaceRoutingConfig[];
    this.routingConfigCache = {
      fetchedAt: Date.now(),
      items: Array.isArray(configs) ? configs : [],
    };
    return this.routingConfigCache.items;
  }

  getTiddlerTags(tiddler: Tiddler): string[] {
    const rawTags = tiddler.fields.tags;
    if (Array.isArray(rawTags)) {
      return rawTags.filter((tag): tag is string => typeof tag === 'string');
    }
    if (typeof rawTags === 'string') {
      return $tw.utils.parseStringArray(rawTags);
    }
    return [];
  }

  matchesDirectTag(tiddlerTitle: string, tiddlerTags: string[], workspaceTagNames: string[]): boolean {
    if (workspaceTagNames.length === 0) {
      return false;
    }
    const hasMatchingTag = workspaceTagNames.some(tagName => tiddlerTags.includes(tagName));
    const isTitleATagName = workspaceTagNames.includes(tiddlerTitle);
    return hasMatchingTag || isTitleATagName;
  }

  matchesTagTree(tiddlerTitle: string, workspaceTagNames: string[]): boolean {
    if (!$tw.rootWidget?.makeFakeWidgetWithVariables) {
      return false;
    }
    for (const tagName of workspaceTagNames) {
      const result = this.wiki.filterTiddlers(
        '[in-tagtree-of:inclusive<tagName>]',
        $tw.rootWidget.makeFakeWidgetWithVariables({ tagName }),
        this.wiki.makeTiddlerIterator([tiddlerTitle]),
      );
      if (result.length > 0) {
        return true;
      }
    }
    return false;
  }

  matchesCustomFilter(tiddlerTitle: string, filterExpression: string): boolean {
    const filters = filterExpression
      .split('\n')
      .map(filter => filter.trim())
      .filter(filter => filter.length > 0);

    for (const filter of filters) {
      const result = this.wiki.filterTiddlers(filter, undefined, this.wiki.makeTiddlerIterator([tiddlerTitle]));
      if (result.length > 0) {
        return true;
      }
    }
    return false;
  }

  async routeTiddlerToWorkspace(tiddler: Tiddler): Promise<string | undefined> {
    const routingConfigs = await this.getRoutingConfigs();
    if (routingConfigs.length === 0) {
      return undefined;
    }

    const sortedConfigs = [...routingConfigs].sort((workspaceA, workspaceB) => workspaceA.order - workspaceB.order);
    const tiddlerTitle = tiddler.fields.title;
    const tiddlerTags = this.getTiddlerTags(tiddler);

    for (const workspaceConfig of sortedConfigs) {
      if (this.matchesDirectTag(tiddlerTitle, tiddlerTags, workspaceConfig.tagNames)) {
        return workspaceConfig.id;
      }

      if (workspaceConfig.includeTagTree && workspaceConfig.tagNames.length > 0) {
        if (this.matchesTagTree(tiddlerTitle, workspaceConfig.tagNames)) {
          return workspaceConfig.id;
        }
      }

      if (workspaceConfig.fileSystemPathFilterEnable && typeof workspaceConfig.fileSystemPathFilter === 'string' && workspaceConfig.fileSystemPathFilter.length > 0) {
        if (this.matchesCustomFilter(tiddlerTitle, workspaceConfig.fileSystemPathFilter)) {
          return workspaceConfig.id;
        }
      }
    }

    return sortedConfigs.find(workspaceConfig => !workspaceConfig.isSubWiki)?.id;
  }
}

declare var exports: {
  adaptorClass: typeof TidGiMobileFileSystemSyncAdaptor;
};

if ($tw.browser && typeof window !== 'undefined') {
  const isInTidGi = typeof document !== 'undefined' && window.isInTidGi;
  const servicesExposed = Boolean(window.service?.wikiStorageService);
  const hasWorkspaceIDinMeta = Boolean(window.meta?.()?.workspaceID);
  if (isInTidGi && servicesExposed && hasWorkspaceIDinMeta) {
    exports.adaptorClass = TidGiMobileFileSystemSyncAdaptor;
  }
}
