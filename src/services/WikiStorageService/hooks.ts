import { useEffect, useMemo } from 'react';
import { useRegisterProxy } from 'react-native-postmessage-cat';
import { IWikiWorkspace } from '../../store/workspace';
import { WikiStorageServiceIPCDescriptor } from './descriptor';
import { WikiStorageService } from './FileSystemWikiStorageService';

export function useWikiStorageService(workspace: IWikiWorkspace) {
  const wikiStorageService = useMemo(() => new WikiStorageService(workspace), [workspace]);
  // Build the file index (≈ desktop boot.files population) once after creation.
  // Must complete before any save/delete. We store the promise so callers
  // could await it if needed, but in practice the WebView boot takes longer
  // so the index is ready before the first IPC call arrives.
  useEffect(() => {
    const indexPromise = wikiStorageService.buildFileIndex();
    // Store on the service instance so it can be awaited if needed
    (wikiStorageService as unknown as { indexReady: Promise<void> }).indexReady = indexPromise;
  }, [wikiStorageService]);
  const [webViewReference, onMessageReference] = useRegisterProxy(wikiStorageService, WikiStorageServiceIPCDescriptor);
  return [webViewReference, onMessageReference, wikiStorageService] as const;
}
