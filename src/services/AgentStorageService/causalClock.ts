import type { AgentSqlDatabase } from './storagePort';

interface MaximumRow {
  maximum: number | null;
}

interface FrontierRow {
  frontier: number | null;
}

export interface CausalClockHighWatermarks {
  lamportClock: number;
  originSequence: number;
  contiguousOriginSequence: number;
}

export interface CausalClockPosition {
  conversationId: string;
  originNodeId: string;
  lamportClock: number;
  originSequence: number;
}

function counterValue(value: number | null | undefined, name: string): number {
  if (value === null || value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid_${name}_counter`);
  return value;
}

/** Read the durable Lamport high-water mark for one conversation. */
export async function readMaxLamportClock(
  database: AgentSqlDatabase,
  conversationId: string,
): Promise<number> {
  const row = await database.getFirstAsync<MaximumRow>(
    `SELECT MAX(maximum) AS maximum FROM (
       SELECT MAX(lamportClock) AS maximum FROM conversation_events WHERE conversationId = ?
       UNION ALL SELECT clock AS maximum FROM lamport_clocks WHERE conversationId = ?
     )`,
    [conversationId, conversationId],
  );
  return counterValue(row?.maximum, 'lamport');
}

/** Read the durable per-origin sequence high-water mark. */
export async function readMaxOriginSequence(
  database: AgentSqlDatabase,
  conversationId: string,
  originNodeId: string,
): Promise<number> {
  const row = await database.getFirstAsync<MaximumRow>(
    `SELECT MAX(maximum) AS maximum FROM (
       SELECT MAX(originSequence) AS maximum FROM conversation_events
         WHERE conversationId = ? AND originNodeId = ?
       UNION ALL SELECT sequence AS maximum FROM origin_sequences
         WHERE conversationId = ? AND originNodeId = ?
     )`,
    [conversationId, originNodeId, conversationId, originNodeId],
  );
  return counterValue(row?.maximum, 'origin_sequence');
}

/**
 * Return only the contiguous prefix of an origin's sequence stream.
 * Synchronization must never advertise a high-water mark that skips a gap.
 */
export async function readContiguousOriginSequence(
  database: AgentSqlDatabase,
  conversationId: string,
  originNodeId: string,
): Promise<number> {
  const row = await database.getFirstAsync<FrontierRow>(
    `WITH ordered AS (
       SELECT originSequence,
         LAG(originSequence, 1, 0) OVER (ORDER BY originSequence) AS previousSequence
       FROM conversation_events WHERE conversationId = ? AND originNodeId = ?
     )
     SELECT COALESCE(
       MIN(CASE WHEN originSequence <> previousSequence + 1 THEN previousSequence END),
       MAX(originSequence), 0
     ) AS frontier FROM ordered`,
    [conversationId, originNodeId],
  );
  return counterValue(row?.frontier, 'origin_frontier');
}

/** Read all counters needed before allocating a local event identity. */
export async function readCausalClockHighWatermarks(
  database: AgentSqlDatabase,
  conversationId: string,
  originNodeId: string,
): Promise<CausalClockHighWatermarks> {
  const [lamportClock, originSequence] = await Promise.all([
    readMaxLamportClock(database, conversationId),
    readMaxOriginSequence(database, conversationId, originNodeId),
  ]);
  const contiguousOriginSequence = await readContiguousOriginSequence(database, conversationId, originNodeId);
  return { contiguousOriginSequence, lamportClock, originSequence };
}

/** Persist monotonic high-water marks in the same transaction as their event. */
export async function persistCausalClock(
  database: AgentSqlDatabase,
  position: CausalClockPosition,
): Promise<void> {
  if (
    !Number.isSafeInteger(position.lamportClock) || position.lamportClock <= 0 ||
    !Number.isSafeInteger(position.originSequence) || position.originSequence <= 0
  ) throw new Error('invalid_causal_clock_position');
  await Promise.all([
    database.runAsync(
      `INSERT INTO lamport_clocks (conversationId, clock) VALUES (?, ?)
       ON CONFLICT(conversationId) DO UPDATE SET clock = MAX(clock, excluded.clock)`,
      [position.conversationId, position.lamportClock],
    ),
    database.runAsync(
      `INSERT INTO origin_sequences (conversationId, originNodeId, sequence) VALUES (?, ?, ?)
       ON CONFLICT(conversationId, originNodeId) DO UPDATE SET sequence = MAX(sequence, excluded.sequence)`,
      [position.conversationId, position.originNodeId, position.originSequence],
    ),
  ]);
}
