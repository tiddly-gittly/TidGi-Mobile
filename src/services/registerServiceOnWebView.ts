import { useMergedReference } from 'react-native-postmessage-cat';
import { IWikiWorkspace } from '../store/wiki';
import { AppDataServiceIPCDescriptor } from './AppDataService/descriptor';
import { useAppDataService } from './AppDataService/hooks';
import { BackgroundSyncServiceIPCDescriptor } from './BackgroundSyncService/descriptor';
import { useBackgroundSyncService } from './BackgroundSyncService/hooks';
import { NativeServiceIPCDescriptor } from './NativeService/descriptor';
import { useNativeService } from './NativeService/hooks';
import { WikiStorageServiceIPCDescriptor } from './WikiStorageService/descriptor';
import { useWikiStorageService } from './WikiStorageService/hooks';

const registerServiceOnWebView = `
window.service = window.service || {};
var wikiStorageService = window.PostMessageCat(${JSON.stringify(WikiStorageServiceIPCDescriptor)});
window.service.wikiStorageService = wikiStorageService;
var backgroundSyncService = window.PostMessageCat(${JSON.stringify(BackgroundSyncServiceIPCDescriptor)});
window.service.backgroundSyncService = backgroundSyncService;
var nativeService = window.PostMessageCat(${JSON.stringify(NativeServiceIPCDescriptor)});
window.service.nativeService = nativeService;
var appDataService = window.PostMessageCat(${JSON.stringify(AppDataServiceIPCDescriptor)});
window.service.appDataService = appDataService;
`;

export function useRegisterService(workspace: IWikiWorkspace) {
  const [wikiStorageServiceWebViewReference, wikiStorageServiceOnMessageReference] = useWikiStorageService(workspace);
  const [backgroundSyncServiceWebViewReference, backgroundSyncServiceOnMessageReference] = useBackgroundSyncService();
  const [nativeServiceWebViewReference, nativeServiceOnMessageReference] = useNativeService();
  const [appDataServiceWebViewReference, appDataServiceOnMessageReference] = useAppDataService();

  const mergedWebViewReference = useMergedReference(
    wikiStorageServiceWebViewReference,
    backgroundSyncServiceWebViewReference,
    nativeServiceWebViewReference,
    appDataServiceWebViewReference,
  );

  const mergedOnMessageReference = useMergedReference(
    wikiStorageServiceOnMessageReference,
    backgroundSyncServiceOnMessageReference,
    nativeServiceOnMessageReference,
    appDataServiceOnMessageReference,
  );

  return [mergedWebViewReference, mergedOnMessageReference, registerServiceOnWebView] as const;
}
