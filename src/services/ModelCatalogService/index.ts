import { Directory, File, Paths } from 'expo-file-system';
import { type ModelCatalog, type ModelCatalogCache, ModelCatalogManager, parseModelCatalog } from 'memeloop/model-catalog';

const directory = new Directory(Paths.document, 'memeloop');
const cacheFile = new File(directory, 'official-model-catalog-v1.json');
const MAXIMUM_CACHE_BYTES = 8 * 1024 * 1024;

class ExpoModelCatalogCache implements ModelCatalogCache {
  public async load(signal: AbortSignal): Promise<ModelCatalog | undefined> {
    signal.throwIfAborted();
    if (!cacheFile.exists || cacheFile.size > MAXIMUM_CACHE_BYTES) return undefined;
    const value = parseModelCatalog(JSON.parse(await cacheFile.text()) as unknown);
    signal.throwIfAborted();
    return value;
  }

  public prepareSave(catalog: ModelCatalog, signal: AbortSignal) {
    signal.throwIfAborted();
    const serialized = JSON.stringify(catalog);
    const shouldWrite = new TextEncoder().encode(serialized).byteLength <= MAXIMUM_CACHE_BYTES;
    let active = true;
    return {
      commit(commitSignal: AbortSignal) {
        commitSignal.throwIfAborted();
        if (!active) return;
        active = false;
        if (!shouldWrite) return;
        if (!directory.exists) directory.create({ intermediates: true });
        commitSignal.throwIfAborted();
        cacheFile.write(serialized);
      },
      discard() {
        active = false;
      },
    };
  }
}

const manager = new ModelCatalogManager({
  cache: new ExpoModelCatalogCache(),
  onError(operation, error) {
    console.warn(`[MobileModelCatalog] ${operation} failed`, error);
  },
});

/** Resolve synchronously available cache/embedded data and start SWR refresh. */
export async function loadCachedModelCatalog(): Promise<ModelCatalog> {
  return (await manager.resolve()).catalog;
}

export async function refreshModelCatalog(signal?: AbortSignal): Promise<ModelCatalog> {
  return (await manager.refresh(signal)).catalog;
}
