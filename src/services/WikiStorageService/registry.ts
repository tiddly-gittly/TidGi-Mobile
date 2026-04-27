import { IWikiWorkspace } from '../../store/workspace';
import { FileSystemWikiStorageService } from './FileSystemWikiStorageService';

const wikiStorageServiceCache = new Map<string, FileSystemWikiStorageService>();

export function getOrCreateWikiStorageService(workspace: IWikiWorkspace): FileSystemWikiStorageService {
  let service = wikiStorageServiceCache.get(workspace.id);
  if (service === undefined) {
    service = new FileSystemWikiStorageService(workspace);
    wikiStorageServiceCache.set(workspace.id, service);
  }
  return service;
}

export async function getReadyWikiStorageService(workspace: IWikiWorkspace): Promise<FileSystemWikiStorageService> {
  const service = getOrCreateWikiStorageService(workspace);
  service.indexReady = service.buildFileIndex();
  await service.indexReady;
  return service;
}