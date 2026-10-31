/**
 * The narrow SQLite port used by MobileAgentStorage.
 *
 * Keeping the persistence adapter contract outside the storage implementation
 * makes the query/projection code testable without coupling it to Expo's
 * concrete SQLite object.  Implementations intentionally expose only the
 * operations required by the mobile store.
 */
export type AgentSqlValue = string | number | null | Uint8Array;

export interface AgentSqlDatabase {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, parameters?: AgentSqlValue[]): Promise<{ changes: number }>;
  getFirstAsync<T>(source: string, parameters?: AgentSqlValue[]): Promise<T | null>;
  getAllAsync<T>(source: string, parameters?: AgentSqlValue[]): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

export type AgentSqlDatabaseFactory = () => Promise<AgentSqlDatabase>;
