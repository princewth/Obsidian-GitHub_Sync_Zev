import { StoredState } from './types';

// Intentionally constructed from an allowlist. Never serialize the runtime state itself.
export function diagnostics(state: StoredState, version: string): string {
  const mounts = Object.values(state.mounts);
  return JSON.stringify({
    plugin: 'github-sync-zev',
    version,
    schema: state.schema,
    connections: mounts.length,
    readOnlyConnections: mounts.filter(m => m.connection.access === 'read-only').length,
    pendingChanges: mounts.reduce((total, m) => total + m.pending, 0),
    conflicts: mounts.reduce((total, m) => total + Object.keys(m.conflicts).length, 0),
    recoveringUploads: mounts.filter(m => m.inFlight !== null).length,
    vaultSnapshots: Object.keys(state.vaultExports ?? {}).length,
    pendingVaultSnapshots: Object.values(state.vaultExports ?? {}).filter(record => record.status === 'pending' || record.status === 'preparing').length
  }, null, 2);
}
