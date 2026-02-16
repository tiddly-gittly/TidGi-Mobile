import { useEffect, useMemo } from 'react';
import { useRegisterProxy } from 'react-native-postmessage-cat';
import { IWikiWorkspace } from '../../store/workspace';
import { WikiStorageServiceIPCDescriptor } from './descriptor';
import { WikiStorageService } from './FileSystemWikiStorageService';

export function useWikiStorageService(workspace: IWikiWorkspace) {
  const wikiStorageService = useMemo(() => new WikiStorageService(workspace), [workspace]);
  // Build the file index (≈ desktop boot.files population) once after creation.
  // This must complete before any save/delete, but the WebView boot takes longer
  // anyway, so the index is ready in time.
  useEffect(() => {
    void wikiStorageService.buildFileIndex();
  }, [wikiStorageService]);
  const [webViewReference, onMessageReference] = useRegisterProxy(wikiStorageService, WikiStorageServiceIPCDescriptor);
  return [webViewReference, onMessageReference, wikiStorageService] as const;
}
