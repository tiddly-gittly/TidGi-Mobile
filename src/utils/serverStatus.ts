/**
 * Apply asynchronous reachability results to the latest server state.
 *
 * Status probes start with a snapshot that may be stale by the time the
 * network request finishes. Only status belongs to the probe; user-edited
 * configuration must always come from `currentServers`.
 */
export function mergeServerStatuses<TServer extends { status: string }>(
  currentServers: Record<string, TServer>,
  statuses: Readonly<Partial<Record<string, TServer['status']>>>,
): Record<string, TServer> {
  let mergedServers: Record<string, TServer> | undefined;
  for (const [id, currentServer] of Object.entries(currentServers)) {
    const status = statuses[id];
    if (status === undefined || status === currentServer.status) continue;
    mergedServers ??= { ...currentServers };
    mergedServers[id] = { ...currentServer, status };
  }
  // Store subscribers use object identity. Returning the original map when
  // every status is unchanged prevents status polling from retriggering the
  // effect that started it.
  return mergedServers ?? currentServers;
}
