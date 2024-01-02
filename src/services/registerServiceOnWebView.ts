import { useMergedReference } from 'react-native-postmessage-cat';
import { IWikiWorkspace } from '../store/workspace';
import { AppDataServiceIPCDescriptor } from './AppDataService/descriptor';
import { useAppDataService } from './AppDataService/hooks';
import { BackgroundSyncServiceIPCDescriptor } from './BackgroundSyncService/descriptor';
import { useBackgroundSyncService } from './BackgroundSyncService/hooks';
import { ImportServiceIPCDescriptor } from './ImportService/descriptor';
import { useImportService } from './ImportService/hooks';
import { NativeServiceIPCDescriptor } from './NativeService/descriptor';
import { useNativeService } from './NativeService/hooks';
import { WikiHookServiceIPCDescriptor } from './WikiHookService/descriptor';
import { useWikiHookService } from './WikiHookService/hooks';
import { WikiStorageServiceIPCDescriptor } from './WikiStorageService/descriptor';
import { useWikiStorageService } from './WikiStorageService/hooks';

const registerServiceOnWebView = `
window.service = window.service || {};
var wikiStorageService = window.PostMessageCat(${JSON.stringify(WikiStorageServiceIPCDescriptor)});
window.service.wikiStorageService = wikiStorageService;
var backgroundSyncService = window.PostMessageCat(${JSON.stringify(BackgroundSyncServiceIPCDescriptor)});
window.service.backgroundSyncService = backgroundSyncService;
var importService = window.PostMessageCat(${JSON.stringify(ImportServiceIPCDescriptor)});
window.service.importService = importService;
var nativeService = window.PostMessageCat(${JSON.stringify(NativeServiceIPCDescriptor)});
window.service.nativeService = nativeService;
var appDataService = window.PostMessageCat(${JSON.stringify(AppDataServiceIPCDescriptor)});
window.service.appDataService = appDataService;
var wikiHookService = window.PostMessageCat(${JSON.stringify(WikiHookServiceIPCDescriptor)});
window.service.wikiHookService = wikiHookService;
`;

export function useRegisterService(workspace: IWikiWorkspace) {
  const [wikiStorageServiceWebViewReference, wikiStorageServiceOnMessageReference, wikiStorageService] = useWikiStorageService(workspace);
  const [backgroundSyncServiceWebViewReference, backgroundSyncServiceOnMessageReference] = useBackgroundSyncService();
  const [importServiceWebViewReference, importServiceOnMessageReference] = useImportService();
  const [nativeServiceWebViewReference, nativeServiceOnMessageReference] = useNativeService();
  const [appDataServiceWebViewReference, appDataServiceOnMessageReference] = useAppDataService();
  const [wikiHookServiceWebViewReference, wikiHookServiceOnMessageReference, wikiHookService] = useWikiHookService(workspace);

  const mergedWebViewReference = useMergedReference(
    wikiStorageServiceWebViewReference,
    backgroundSyncServiceWebViewReference,
    importServiceWebViewReference,
    nativeServiceWebViewReference,
    appDataServiceWebViewReference,
    wikiHookServiceWebViewReference,
  );

  const mergedOnMessageReference = useMergedReference(
    wikiStorageServiceOnMessageReference,
    backgroundSyncServiceOnMessageReference,
    importServiceOnMessageReference,
    nativeServiceOnMessageReference,
    appDataServiceOnMessageReference,
    wikiHookServiceOnMessageReference,
  );

  /**
   * Services that are limited to the workspace. Can not be accessed globally.
   */
  const servicesOfWorkspace = {
    wikiStorageService,
    wikiHookService,
  };

  return [mergedWebViewReference, mergedOnMessageReference, registerServiceOnWebView, servicesOfWorkspace] as const;
}
