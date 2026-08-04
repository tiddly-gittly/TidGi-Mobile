import { IWikiWorkspace } from '../../store/workspace';
import { FileSystemWikiStorageService } from './FileSystemWikiStorageService';

/**
 * Registry that caches FileSystemWikiStorageService instances per workspace.
 *
 * Encapsulating the cache as a class keeps the mutable Map out of the module
 * closure and makes the lifecycle explicit. A single shared instance is
 * exported for callers that need the global workspace -> service mapping.
 */
export class WikiStorageServiceRegistry {
  readonly #cache = new Map<string, FileSystemWikiStorageService>();

  getOrCreate(workspace: IWikiWorkspace): FileSystemWikiStorageService {
    const cached = this.#cache.get(workspace.id);
    // Recreate when storage-affecting fields change (e.g. after migrating to/from external storage)
    if (
      cached !== undefined &&
      cached.getWorkspace().wikiFolderLocation === workspace.wikiFolderLocation
    ) {
      return cached;
    }
    const service = new FileSystemWikiStorageService(workspace);
    this.#cache.set(workspace.id, service);
    return service;
  }

  async getReady(workspace: IWikiWorkspace): Promise<FileSystemWikiStorageService> {
    const service = this.getOrCreate(workspace);
    service.indexReady = service.buildFileIndex();
    await service.indexReady;
    return service;
  }
}

export const wikiStorageServiceRegistry = new WikiStorageServiceRegistry();
