import { format } from 'date-fns';
import { Camera, PermissionStatus } from 'expo-camera';
import { Directory, File } from 'expo-file-system';
import type { ShareIntent } from 'expo-share-intent';
import { compact } from 'lodash';

import type { ITiddlerFieldsParameter } from 'tiddlywiki';
import { getWikiFilesPathByCanonicalUri } from '../../constants/paths';
import i18n from '../../i18n';
import { useConfigStore } from '../../store/config';
import { IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';
import { navigateIfNotAlreadyThere, navigationReference } from '../../utils/RootNavigation';
import type { WikiHookService } from '../WikiHookService';
import { FileSystemWikiStorageService as WikiStorageService } from '../WikiStorageService/FileSystemWikiStorageService';
import { getReadyWikiStorageService } from '../WikiStorageService/registry';
import { importBinaryTiddlers, importTextTiddlers } from './wikiOperations';

/**
 * Service for using native ability like Location based Geofencing in the wiki todo system.
 */
export class NativeService {
  // async getLocationWithTimeout(timeout = 1000): Promise<Location.LocationObjectCoords | undefined> {
  //   const { status } = await Location.requestForegroundPermissionsAsync();
  //   if (status !== 'granted') {
  //     return;
  //   }

  //   try {
  //     const timeoutPromise = new Promise<Location.LocationObject['coords'] | undefined>((resolve) => {
  //       setTimeout(() => {
  //         resolve(undefined);
  //       }, timeout); // resolve as undefined after 1 second
  //     });

  //     // this usually last for a very long time. So we use a timeout to prevent it from blocking the app
  //     const locationPromise = (async () => {
  //       const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest });
  //       return location.coords;
  //     })();

  //     return await Promise.race([timeoutPromise, locationPromise]);
  //   } catch (error) {
  //     console.error('Error fetching location:', error);
  //     return undefined;
  //   }
  // }

  async requestCameraPermission(): Promise<boolean> {
    const { status } = await Camera.requestCameraPermissionsAsync();
    return status === PermissionStatus.GRANTED;
  }

  async requestMicrophonePermission(): Promise<boolean> {
    const { status } = await Camera.requestMicrophonePermissionsAsync();
    return status === PermissionStatus.GRANTED;
  }

  #wikiHookServices?: WikiHookService;
  #currentWikiStorageService?: WikiStorageService;

  setCurrentWikiServices(wikiHookServices: WikiHookService, wikiStorageService: WikiStorageService) {
    this.#wikiHookServices = wikiHookServices;
    this.#currentWikiStorageService = wikiStorageService;
  }

  clearCurrentWikiServices() {
    this.#wikiHookServices = undefined;
    this.#currentWikiStorageService = undefined;
  }

  #getDefaultWiki(): IWikiWorkspace | undefined {
    const { workspaces, defaultWorkspaceId } = useWorkspaceStore.getState();
    return defaultWorkspaceId !== null
      ? workspaces.find((w): w is IWikiWorkspace => w.type === 'wiki' && w.id === defaultWorkspaceId)
      : compact(workspaces).find((w): w is IWikiWorkspace => w.type === 'wiki');
  }

  #getWikiById(id?: string): IWikiWorkspace | undefined {
    if (typeof id !== 'string' || id.length === 0) return;
    return compact(useWorkspaceStore.getState().workspaces).find((w): w is IWikiWorkspace => w.type === 'wiki' && w.id === id);
  }

  #getCurrentRouteWiki(): IWikiWorkspace | undefined {
    if (!navigationReference.isReady()) return;
    const currentRoute = navigationReference.getCurrentRoute();
    if (currentRoute?.name !== 'WikiWebView') return;
    return this.#getWikiById(currentRoute.params.id);
  }

  #resolveShareTargetWorkspace(): IWikiWorkspace | undefined {
    return this.#getCurrentRouteWiki() ?? this.#getDefaultWiki();
  }

  async #getStorageServiceForWorkspace(workspace: IWikiWorkspace): Promise<WikiStorageService> {
    const currentWikiStorageService = this.#currentWikiStorageService;
    const currentRouteWiki = this.#getCurrentRouteWiki();
    if (currentWikiStorageService !== undefined && currentRouteWiki?.id === workspace.id) {
      return currentWikiStorageService;
    }
    return await getReadyWikiStorageService(workspace);
  }

  public async getCurrentWikiHookServices() {
    if (this.#wikiHookServices === undefined) {
      return await new Promise<WikiHookService>((resolve) => {
        const interval = setInterval(() => {
          if (this.#wikiHookServices) {
            clearInterval(interval);
            resolve(this.#wikiHookServices);
          }
        }, 100);
      });
    } else {
      return this.#wikiHookServices;
    }
  }

  async receivingShareIntent(shareIntent: ShareIntent) {
    const targetWorkspace = this.#resolveShareTargetWorkspace();
    if (targetWorkspace === undefined) return;
    const configs = useConfigStore.getState();
    if (configs.fastImport) {
      await this.storeSharedContentToStorage(shareIntent, targetWorkspace);
    } else {
      await this.importSharedContentToWiki(shareIntent, targetWorkspace);
    }
  }

  /**
   * If wiki has not started, android will store files in a queue, wait for getReceivedFiles to be called.
   * Even wiki previously loaded, but after go background for a while, it may be unloaded too. We need to wait not only webview loaded, need wiki core loaded, then call this.
   */
  async importSharedContentToWiki(shareIntent: ShareIntent, targetWorkspace: IWikiWorkspace) {
    const { text, files } = shareIntent;
    let script = '';
    switch (shareIntent.type) {
      case 'text':
      case 'weburl': {
        if (text) {
          script = importTextTiddlers([text]);
        }
        break;
      }
      case 'media':
      case 'file': {
        if (files && files.length > 0) {
          const filesWithFileLoadedToText = await Promise.all(files.map(async (file) => {
            const filePath = file.path.startsWith('file://') ? file.path : `file://${file.path}`;
            const fileHandle = new File(filePath);
            const arrayBuffer = await fileHandle.arrayBuffer();
            const text = Buffer.from(arrayBuffer).toString('base64');
            return { ...file, text, type: file.mimeType };
          }));
          script = importBinaryTiddlers(filesWithFileLoadedToText);
        }
        break;
      }
    }
    if (!script) return;
    const currentRouteWiki = this.#getCurrentRouteWiki();
    if (currentRouteWiki?.id !== targetWorkspace.id) {
      navigateIfNotAlreadyThere('WikiWebView', {
        id: targetWorkspace.id,
        quickLoad: targetWorkspace.enableQuickLoad,
      });
    }
    const wikiHookService = await this.getCurrentWikiHookServices();
    await wikiHookService.executeAfterTwReady(script);
  }

  /**
   * Directly store shared content into the default workspace's filesystem-backed storage,
   * so imports do not need to wait for the wiki WebView to load.
   */
  async storeSharedContentToStorage(shareIntent: ShareIntent, targetWorkspace: IWikiWorkspace) {
    const storageOfTargetWorkspace = await this.#getStorageServiceForWorkspace(targetWorkspace);
    const configs = useConfigStore.getState();
    const tagForSharedContent = configs.tagForSharedContent;
    const newTagForSharedContent = tagForSharedContent ?? i18n.t('Share.Clipped');
    // Put into the target workspace storage with a random title when the share payload does not provide one.
    const randomTitle = `${i18n.t('Share.SharedContent')}-${Date.now()}`;
    const created = format(new Date(), 'yyyyMMddHHmmssSSS');
    let fields: ITiddlerFieldsParameter = {
      created,
      modified: created,
      creator: i18n.t('Share.TidGiMobileShare'),
      tags: newTagForSharedContent,
    };
    if (shareIntent.webUrl) fields = { ...fields, url: shareIntent.webUrl };
    switch (shareIntent.type) {
      case 'text':
      case 'weburl': {
        if (shareIntent.text) fields = { ...fields, text: shareIntent.text };
        await storageOfTargetWorkspace.saveTiddler(shareIntent.meta?.title ?? randomTitle, fields);
        break;
      }
      case 'media':
      case 'file': {
        if (shareIntent.files) {
          for (const file of shareIntent.files) {
            if (configs.saveMediaAsAttachment) {
              // Save file to filesystem and create tiddler with _canonical_uri
              const canonicalUri = `files/${file.fileName || randomTitle}`;
              const filePath = getWikiFilesPathByCanonicalUri(targetWorkspace, canonicalUri);
              const filesDirectory = `${targetWorkspace.wikiFolderLocation}/files`;
              const directory = new Directory(filesDirectory);
              if (!directory.exists) {
                directory.create({ idempotent: true, intermediates: true });
              }
              const sourceFile = new File(file.path.startsWith('file://') ? file.path : `file://${file.path}`);
              const destinationFile = new File(filePath);
              sourceFile.copy(destinationFile);

              const fileFields = {
                ...fields,
                type: file.mimeType,
                _canonical_uri: canonicalUri,
              };
              await storageOfTargetWorkspace.saveTiddler(file.fileName || randomTitle, fileFields);
            } else {
              // Original behavior: embed file content as base64
              const filePath = file.path.startsWith('file://') ? file.path : `file://${file.path}`;
              const fileHandle = new File(filePath);
              const arrayBuffer = await fileHandle.arrayBuffer();
              const fileContent = Buffer.from(arrayBuffer).toString('base64');
              const fileFields = {
                ...fields,
                type: file.mimeType,
                text: fileContent,
              };
              await storageOfTargetWorkspace.saveTiddler(file.fileName || randomTitle, fileFields);
            }
          }
        }
        break;
      }
    }
  }

  saveFileToFs(filename: string, text: string, _mimeType?: string): Promise<string | false> {
    try {
      // Save to /sdcard/Documents/TidGi/exports/ (requires MANAGE_EXTERNAL_STORAGE)
      const exportDirectory = new Directory('file:///sdcard/Documents/TidGi/exports/');
      if (!exportDirectory.exists) {
        exportDirectory.create({ intermediates: true, idempotent: true });
      }
      const file = new File(exportDirectory, filename);
      file.write(text);
      console.log(`File saved to ${file.uri}`);
      return Promise.resolve(file.uri);
    } catch (error) {
      console.error('Error saving file:', error);
      return Promise.resolve(false);
    }
  }
}

/**
 * Only need a singleton instance for all wikis.
 */
export const nativeService = new NativeService();
