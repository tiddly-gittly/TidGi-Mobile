import { useEffect, useMemo } from 'react';
import { useRegisterProxy } from 'react-native-postmessage-cat';
import { IWikiWorkspace } from '../../store/workspace';
import { WikiStorageServiceIPCDescriptor } from './descriptor';
import { WikiStorageService as FileSystemWikiStorageService } from './FileSystemWikiStorageService';

const wikiStorageServiceCache = new Map<string, FileSystemWikiStorageService>();

function getOrCreateWikiStorageService(workspace: IWikiWorkspace): FileSystemWikiStorageService {
  let service = wikiStorageServiceCache.get(workspace.id);
  if (service === undefined) {
    service = new FileSystemWikiStorageService(workspace);
    wikiStorageServiceCache.set(workspace.id, service);
  } else {
    // If the workspace object changes (e.g. settings updated), we want to inject the fresh reference
    // so any internal checks use the latest user config. We do this by re-assigning, assuming
    // FileSystemWikiStorageService can handle it or just replacing the JS reference.
    // However, FileSystemWikiStorageService stores it as `#workspace`. We can't access private fields.
    // Since id and folder path don't change, using the old reference is usually fine for storage.
  }
  return service;
}

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
