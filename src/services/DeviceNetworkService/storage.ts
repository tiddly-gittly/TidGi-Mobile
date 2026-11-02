import type { TrustedDeviceRecord } from 'memeloop/device-network';

export interface StoredIdentity {
  peerId: string;
  publicKeyMultibase: string;
  encryptedPrivateKey: string;
  deviceName: string;
  platform: 'mobile';
  createdAt: number;
}

export interface StoredTrustedDeviceStoreEnvelope {
  epoch: string;
  generation: number;
  records: TrustedDeviceRecord[];
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function isStoredIdentity(value: unknown): value is StoredIdentity {
  const record = value as Record<string, unknown> | undefined;
  return Boolean(
    record &&
      typeof record.peerId === 'string' &&
      typeof record.publicKeyMultibase === 'string' &&
      typeof record.encryptedPrivateKey === 'string' &&
      typeof record.deviceName === 'string' &&
      record.platform === 'mobile' &&
      typeof record.createdAt === 'number' &&
      Number.isFinite(record.createdAt),
  );
}

function isTrustedDeviceRecord(value: unknown): value is TrustedDeviceRecord {
  const record = value as Record<string, unknown> | undefined;
  return Boolean(
    record &&
      typeof record.peerId === 'string' &&
      typeof record.publicKeyMultibase === 'string' &&
      typeof record.deviceName === 'string' &&
      typeof record.platform === 'string' &&
      typeof record.trustMode === 'string' &&
      typeof record.createdAt === 'number',
  );
}

export function parseStoredIdentity(value: string): StoredIdentity | undefined {
  const parsed = parseJson(value);
  return isStoredIdentity(parsed) ? parsed : undefined;
}

export function parseTrustedDeviceRecords(value: string): TrustedDeviceRecord[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed.filter(isTrustedDeviceRecord) : [];
}

/**
 * Treat SecureStore as an untrusted persistence boundary. Interrupted writes,
 * old development builds and manual edits must not prevent device networking
 * (and therefore the application) from starting.
 */
export function parseTrustedDeviceStoreEnvelope(value: string): StoredTrustedDeviceStoreEnvelope | undefined {
  const parsed = parseJson(value) as Record<string, unknown> | undefined;
  if (
    !parsed ||
    typeof parsed.epoch !== 'string' ||
    typeof parsed.generation !== 'number' ||
    !Number.isSafeInteger(parsed.generation) ||
    !Array.isArray(parsed.records)
  ) return undefined;
  return {
    epoch: parsed.epoch,
    generation: parsed.generation,
    records: parsed.records.filter(isTrustedDeviceRecord),
  };
}
