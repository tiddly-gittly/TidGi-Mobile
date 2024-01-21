import { Camera } from 'expo-camera';
import * as fs from 'expo-file-system';
import * as Location from 'expo-location';
import ReceiveSharingIntent from 'react-native-receive-sharing-intent';
import { openDefaultWikiIfNotAlreadyThere } from '../../hooks/useAutoOpenDefaultWiki';
import type { WikiHookService } from '../WikiHookService';
import { ISharedFile } from './types';
import { importBinaryTiddlers, importTextTiddlers } from './wikiOperations';

/**
 * Service for using native ability like Location based Geofencing in the wiki todo system.
 */
export class NativeService {
  async getLocationWithTimeout(timeout = 1000): Promise<Location.LocationObjectCoords | undefined> {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      return;
    }

    try {
      const timeoutPromise = new Promise<Location.LocationObject['coords'] | undefined>((resolve) => {
        setTimeout(() => {
          resolve(undefined);
        }, timeout); // resolve as undefined after 1 second
      });

      // this usually last for a very long time. So we use a timeout to prevent it from blocking the app
      const locationPromise = (async () => {
        const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest });
        return location.coords;
      })();

      return await Promise.race([timeoutPromise, locationPromise]);
    } catch (error) {
      console.error('Error fetching location:', error);
      return undefined;
    }
  }

  async requestCameraPermission(): Promise<boolean> {
    const { status } = await Camera.requestCameraPermissionsAsync();
    return status === 'granted';
  }

  async requestMicrophonePermission(): Promise<boolean> {
    const { status } = await Camera.requestMicrophonePermissionsAsync();
    return status === 'granted';
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
          // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
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

  /**
   * If wiki has not started, android will store files in a queue, wait for getReceivedFiles to be called.
   * Even wiki previously loaded, but after go background for a while, it may be unloaded too. We need to wait not only webview loaded, need wiki core loaded, then call this.
   */
  registerReceivingShareIntent() {
    // wait for wiki start, and use injectJavascript to add tiddler, for user to edit.
    // To get All Recived Urls
    ReceiveSharingIntent.getReceivedFiles(
      async (
        files: ISharedFile[],
      ) => {
        // files returns as JSON Array example
        // [{ filePath: null, text: null, weblink: null, mimeType: null, contentUri: null, fileName: null, extension: null }]
        console.log(files);
        if (files.length === 0) return;
        let script = '';
        if (files.every(item => (item.mimeType ?? 'text/plain') === 'text/plain')) {
          script = importTextTiddlers(files);
        } else {
          const filesWithFileLoadedToText = await Promise.all(files.map(async (file) => {
            if (file.filePath === null) return file;
            /**
             * based on tiddlywiki file type parsers `$tw.utils.registerFileType("image/jpeg","base64",[".jpg",".jpeg"],{flags:["image"]});`
             * we need to use base64 encoding to load file
             */
            const text = await fs.readAsStringAsync(file.filePath.startsWith('file://') ? file.filePath : `file://${file.filePath}`, { encoding: 'base64' });
            return { ...file, text };
          }));
          script = importBinaryTiddlers(filesWithFileLoadedToText);
        }
        openDefaultWikiIfNotAlreadyThere();
        const wikiHookService = await this.getCurrentWikiHookServices();
        await wikiHookService.executeAfterTwReady(script);
      },
      (error: Error) => {
        console.log(error);
      },
      'fun.tidgi.mobile', // share url protocol (must be unique to your app, suggest using your apple bundle id)
    );
    // Fully unregister Intents, actually it is not clearReceivedFiles
    // ReceiveSharingIntent.clearReceivedFiles();
  }
}

/**
 * Only need a singleton instance for all wikis.
 */
export const nativeService = new NativeService();
