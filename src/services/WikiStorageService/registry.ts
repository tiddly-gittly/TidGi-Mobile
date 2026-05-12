import { IWikiWorkspace } from '../../store/workspace';
import { FileSystemWikiStorageService } from './FileSystemWikiStorageService';

const wikiStorageServiceCache = new Map<string, FileSystemWikiStorageService>();

export function getOrCreateWikiStorageService(workspace: IWikiWorkspace): FileSystemWikiStorageService {
  const cached = wikiStorageServiceCache.get(workspace.id);
  // Recreate when storage-affecting fields change (e.g. after migrating to/from external storage)
  if (cached !== undefined && cached.getWorkspace().wikiFolderLocation === workspace.wikiFolderLocation) {
    return cached;
  }
  const service = new FileSystemWikiStorageService(workspace);
  wikiStorageServiceCache.set(workspace.id, service);
  return service;
}

export async function getReadyWikiStorageService(workspace: IWikiWorkspace): Promise<FileSystemWikiStorageService> {
  const service = getOrCreateWikiStorageService(workspace);
  service.indexReady ||= service.buildFileIndex();
  await service.indexReady;
  return service;
}
