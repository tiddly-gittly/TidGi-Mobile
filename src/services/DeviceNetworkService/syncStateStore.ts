import { Directory, File, Paths } from 'expo-file-system';
import type { DeviceSyncStateStore, VersionVector } from 'memeloop/device-network';

const MAXIMUM_ORIGINS = 4_096;

export function parseVersionVector(value: unknown): VersionVector {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value);
  if (entries.length > MAXIMUM_ORIGINS) return {};
  const versionVector: VersionVector = {};
  for (const [originNodeId, clock] of entries) {
    if (!originNodeId || originNodeId.length > 512 || !Number.isSafeInteger(clock) || (clock as number) < 0) return {};
    versionVector[originNodeId] = clock as number;
  }
  return versionVector;
}

/** Durable version vector used by the shared device sync protocol. */
export class MobileDeviceSyncStateStore implements DeviceSyncStateStore {
  private readonly directory = new Directory(Paths.document, 'memeloop');
  private readonly file = new File(this.directory, 'device-sync-state-v2.json');
  private versionVector?: VersionVector;
  private mutationQueue = Promise.resolve();

  public async loadVersionVector(): Promise<VersionVector> {
    if (this.versionVector) return { ...this.versionVector };
    if (!this.directory.exists) this.directory.create({ intermediates: true });
    if (!this.file.exists) {
      this.versionVector = {};
      return {};
    }
    try {
      this.versionVector = parseVersionVector(JSON.parse(await this.file.text()));
    } catch (error) {
      console.warn('[MobileDeviceSyncStateStore] invalid state file; starting with an empty vector', error);
      this.versionVector = {};
    }
    return { ...this.versionVector };
  }

  public async saveVersionVector(versionVector: VersionVector): Promise<void> {
    const validated = parseVersionVector(versionVector);
    const operation = this.mutationQueue.then(() => {
      if (!this.directory.exists) this.directory.create({ intermediates: true });
      this.versionVector = { ...validated };
      this.file.write(JSON.stringify(this.versionVector));
    });
    this.mutationQueue = operation.catch(() => undefined);
    await operation;
  }
}

export const mobileDeviceSyncStateStore = new MobileDeviceSyncStateStore();
