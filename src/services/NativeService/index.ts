import { format } from 'date-fns';
import { Camera, PermissionStatus } from 'expo-camera';
import { Directory, File } from 'expo-file-system';
import type { ShareIntent } from 'expo-share-intent';
import { compact } from 'lodash';

import type { ITiddlerFieldsParameter } from 'tiddlywiki';
import { getWikiFilesPathByCanonicalUri } from '../../constants/paths';
import { openDefaultWikiIfNotAlreadyThere } from '../../hooks/useAutoOpenDefaultWiki';
import i18n from '../../i18n';
import { useConfigStore } from '../../store/config';
import { IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';
import type { WikiHookService } from '../WikiHookService';
import { FileSystemWikiStorageService as WikiStorageService } from '../WikiStorageService/FileSystemWikiStorageService';
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
  setCurrentWikiHookServices(wikiHookServices: WikiHookService) {
    this.#wikiHookServices = wikiHookServices;
  }

  clearCurrentWikiHookServices() {
    this.#wikiHookServices = undefined;
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
    const configs = useConfigStore.getState();
    if (configs.fastImport) {
      await this.storeSharedContentToStorage(shareIntent);
    } else {
      await this.importSharedContentToWiki(shareIntent);
    }
  }

  /**
   * If wiki has not started, android will store files in a queue, wait for getReceivedFiles to be called.
   * Even wiki previously loaded, but after go background for a while, it may be unloaded too. We need to wait not only webview loaded, need wiki core loaded, then call this.
   */
  async importSharedContentToWiki(shareIntent: ShareIntent) {
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
    openDefaultWikiIfNotAlreadyThere();
    const wikiHookService = await this.getCurrentWikiHookServices();
    await wikiHookService.executeAfterTwReady(script);
  }

  /**
   * Directly store shared content to default workspace's sqlite, very fast, don't need to wait for wiki to load.
   */
  async storeSharedContentToStorage(shareIntent: ShareIntent) {
    const defaultWiki = compact(useWorkspaceStore.getState().workspaces).find((w): w is IWikiWorkspace => w.type === 'wiki');
    if (defaultWiki === undefined) return;
    const storageOfDefaultWorkspace = new WikiStorageService(defaultWiki);
    const configs = useConfigStore.getState();
    const tagForSharedContent = configs.tagForSharedContent;
    const newTagForSharedContent = tagForSharedContent ?? i18n.t('Share.Clipped');
    // put into default workspace's database, with random title
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
        await storageOfDefaultWorkspace.saveTiddler(shareIntent.meta?.title ?? randomTitle, fields);
        break;
      }
      case 'media':
      case 'file': {
        if (shareIntent.files) {
          for (const file of shareIntent.files) {
            if (configs.saveMediaAsAttachment) {
              // Save file to filesystem and create tiddler with _canonical_uri
              const canonicalUri = `files/${file.fileName || randomTitle}`;
              const filePath = getWikiFilesPathByCanonicalUri(defaultWiki, canonicalUri);
              const filesDirectory = `${defaultWiki.wikiFolderLocation}/files`;
              const directory = new Directory(filesDirectory);
              if (!directory.exists) {
                directory.create();
              }
              const sourceFile = new File(file.path.startsWith('file://') ? file.path : `file://${file.path}`);
              const destinationFile = new File(filePath);
              sourceFile.copy(destinationFile);

              const fileFields = {
                ...fields,
                type: file.mimeType,
                _canonical_uri: canonicalUri,
              };
              await storageOfDefaultWorkspace.saveTiddler(file.fileName || randomTitle, fileFields);
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
              await storageOfDefaultWorkspace.saveTiddler(file.fileName || randomTitle, fileFields);
            }
          }
        }
        break;
      }
    }
  }

  async saveFileToFs(filename: string, text: string, _mimeType?: string): Promise<string | false> {
    try {
      // Save to /sdcard/Documents/TidGi/exports/ (requires MANAGE_EXTERNAL_STORAGE)
      const exportDirectory = new Directory('file:///sdcard/Documents/TidGi/exports/');
      if (!exportDirectory.exists) {
        exportDirectory.create({ intermediates: true, idempotent: true });
      }
      const file = new File(exportDirectory, filename);
      file.write(text);
      console.log(`File saved to ${file.uri}`);
      return file.uri;
    } catch (error) {
      console.error('Error saving file:', error);
      return false;
    }
  }
}

/**
 * Only need a singleton instance for all wikis.
 */
export const nativeService = new NativeService();
