/* eslint-disable security-node/detect-crlf */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import { format } from 'date-fns';
import * as fs from 'expo-file-system';
import type { useShareIntent as IUseShareIntent } from 'expo-share-intent';
import { compact } from 'lodash';
import { useEffect, useMemo, useState } from 'react';
import { Snackbar } from 'react-native-paper';
import { useRegisterProxy } from 'react-native-postmessage-cat';
import { ITiddlerFieldsParam } from 'tiddlywiki';

import i18n from '../../i18n';
import { useConfigStore } from '../../store/config';
import { IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';
import { WikiStorageService } from '../WikiStorageService';
import { nativeService } from '.';
import { NativeServiceIPCDescriptor } from './descriptor';

export function useNativeService() {
  const [webViewReference, onMessageReference] = useRegisterProxy(nativeService, NativeServiceIPCDescriptor);
  return [webViewReference, onMessageReference] as const;
}

export function useRequestNativePermissions() {
  useEffect(() => {
    void (async () => {
      await nativeService.requestCameraPermission();
      // await nativeService.requestMicrophonePermission();
    })();
  }, []);
}

export function useRegisterReceivingShareIntent() {
  const [importSuccessSnackBarVisible, setImportSuccessSnackBarVisible] = useState(false);
  const importSuccessSnackBar = (
    <Snackbar
      visible={importSuccessSnackBarVisible}
      onDismiss={() => {
        setImportSuccessSnackBarVisible(false);
      }}
    >
      {i18n.t('Share.ImportSuccess')}
    </Snackbar>
  );
  const [tagForSharedContent] = useConfigStore(state => [state.tagForSharedContent]);
  const newTagForSharedContent = useMemo(() => tagForSharedContent ?? i18n.t('Share.Clipped'), [tagForSharedContent]);

  /** If you get error on development:
   * ```
   *  Error: Cannot find native module 'ExpoShareIntentModule', js engine: hermes
   * Invariant Violation: "main" has not been registered. This can happen if:
   * Metro (the local dev server) is run from the wrong folder. Check if Metro is running, stop it and restart it in the current project.
   * A module failed to load due to an error and `AppRegistry.registerComponent` wasn't called., js engine: hermes
   * ```
   *
   * Comment out this import will work.
   *
   * Also comment out all code inside `useRegisterReceivingShareIntent`.
   */
  if (process.env.NODE_ENV === 'development') {
    return { importSuccessSnackBar };
  }
  const { useShareIntent } = require('expo-share-intent') as { useShareIntent: typeof IUseShareIntent };
  /* eslint-disable react-hooks/rules-of-hooks */
  const { hasShareIntent, shareIntent, resetShareIntent, error } = useShareIntent({
    debug: true,
  });

  useEffect(() => {
    if (error !== undefined) {
      console.log(
        `Failed to get ShareIntent, This is normal if you are using Expo Go for dev. To debug sharing feature, create a dev build "pnpm start:devClient" instead. ${error}`,
      );
    }
    void (async () => {
      try {
        if (!hasShareIntent) return;
        const defaultWiki = compact(useWorkspaceStore.getState().workspaces).find((w): w is IWikiWorkspace => w.type === 'wiki');
        if (defaultWiki === undefined) return;
        await nativeService.receivingShareIntent(shareIntent);
        resetShareIntent();
        // put into default workspace's database, with random title
        const storageOfDefaultWorkspace = new WikiStorageService(defaultWiki);
        const randomTitle = `${i18n.t('Share.SharedContent')}-${Date.now()}`;
        const created = format(new Date(), 'yyyyMMddHHmmssSSS');
        let fields: ITiddlerFieldsParam = {
          created,
          modified: created,
          creator: i18n.t('Share.TidGiMobileShare'),
          tags: newTagForSharedContent,
        };
        switch (shareIntent.type) {
          case 'text':
          case 'weburl': {
            if (shareIntent.text) fields = { ...fields, text: shareIntent.text };
            if (shareIntent.webUrl) fields = { ...fields, url: shareIntent.webUrl };
            break;
          }
          case 'media':
          case 'file': {
            if (shareIntent.files) {
              for (const file of shareIntent.files) {
                const fileContent = await fs.readAsStringAsync(file.path, { encoding: fs.EncodingType.Base64 });
                fields = {
                  ...fields,
                  type: file.mimeType,
                  size: file.size,
                  width: file.width,
                  height: file.height,
                  duration: file.duration,
                  text: fileContent,
                };
                await storageOfDefaultWorkspace.saveTiddler(file.fileName, fields);
              }
            }
            break;
          }
        }
        await storageOfDefaultWorkspace.saveTiddler(shareIntent.meta?.title ?? randomTitle, fields);
        setImportSuccessSnackBarVisible(true);
      } catch (error) {
        console.log(
          `Failed to registerReceivingShareIntent, This is normal if you are using Expo Go for dev. To debug sharing feature, create a dev build "pnpm start:devClient" instead. ${
            (error as Error).message
          }`,
        );
      }
    })();
  }, [hasShareIntent, shareIntent, resetShareIntent, error, newTagForSharedContent]);

  return { importSuccessSnackBar };
}
