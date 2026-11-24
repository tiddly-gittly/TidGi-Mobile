import { randomUUID } from 'expo-crypto';

export type DurableIdFactory = (namespace: string) => string;

/** Durable identifiers must be unpredictable and independent of wall-clock time. */
export const createSecureDurableId: DurableIdFactory = (namespace) => {
  const normalized = namespace.trim();
  if (normalized === '') throw new Error('durable_id_namespace_required');
  return `${normalized}:${randomUUID()}`;
};
