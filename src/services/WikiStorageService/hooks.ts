import { useEffect, useMemo } from 'react';
import { useRegisterProxy } from 'react-native-postmessage-cat';
import { IWikiWorkspace } from '../../store/workspace';
import { WikiStorageServiceIPCDescriptor } from './descriptor';
import { WikiStorageService as FileSystemWikiStorageService } from './FileSystemWikiStorageService';
import { getOrCreateWikiStorageService } from './registry';

export function useWikiStorageService(workspace: IWikiWorkspace) {
  const wikiStorageService = useMemo(() => getOrCreateWikiStorageService(workspace), [workspace]);

  useEffect(() => {
    // Build the file index (≈ desktop boot.files population) once after creation.
    // If already indexing/indexed, the method returns early or returns the pending promise.
    // We assign it to indexReady to gate operations.
    wikiStorageService.indexReady = wikiStorageService.buildFileIndex();
  }, [wikiStorageService]);

  const [webViewReference, onMessageReference] = useRegisterProxy(wikiStorageService, WikiStorageServiceIPCDescriptor);
  return [webViewReference, onMessageReference, wikiStorageService] as const;
}
