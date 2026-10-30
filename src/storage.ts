import { emptyState, StoredState, StateRepository, UserError } from './types';
import { safePath, validateBranch, validateIdentity } from './paths';
import { EXPORT_ROOT } from './vault-export';

export function validateState(value: unknown): StoredState {
  if (!value || typeof value !== 'object') throw new UserError('Device storage is unreadable. Sync is stopped to protect your files.');
  const state = value as StoredState;
  if (state.schema !== 1 || !state.settings || !state.mounts || Array.isArray(state.mounts)) {
    throw new UserError('This device has an unsupported workspace database. Keep it intact and use a compatible plugin version.');
  }
  const { pollSeconds, uploadDelaySeconds, maxFileMB } = state.settings;
  if (![pollSeconds, uploadDelaySeconds, maxFileMB].every(Number.isFinite) || pollSeconds < 30 || pollSeconds > 3600 || uploadDelaySeconds < 5 || uploadDelaySeconds > 300 || maxFileMB < 1 || maxFileMB > 25) {
    throw new UserError('Device settings are invalid. Sync is stopped.');
  }
  for (const [id, mount] of Object.entries(state.mounts)) {
    if (!mount || !mount.connection || mount.connection.id !== id || !mount.baseline || !mount.conflicts) throw new UserError('A workspace record is unreadable. Sync is stopped.');
    const connection = mount.connection;
    validateIdentity(connection.owner, connection.repo);
    validateBranch(connection.branch);
    safePath(connection.localPath); safePath(connection.remotePath, true);
    if (!['read-only', 'read-write'].includes(connection.access) || !/^[a-z0-9-]+$/.test(connection.secretId)) throw new UserError('A workspace record is invalid.');
    for (const path of Object.keys(mount.baseline)) safePath(path);
    for (const path of Object.keys(mount.conflicts)) safePath(path);
  }
  if (state.vaultExports !== undefined) {
    if (!state.vaultExports || typeof state.vaultExports !== 'object' || Array.isArray(state.vaultExports)) throw new UserError('Vault export history is unreadable.');
    for (const [id, record] of Object.entries(state.vaultExports)) {
      if (!record || record.id !== id || !/^snapshot-[a-z0-9-]{8,80}$/.test(id) || record.prefix !== `${EXPORT_ROOT}/${id}` || !['preparing', 'pending', 'published', 'not-published'].includes(record.status)) throw new UserError('A vault export record is invalid.');
      validateIdentity(record.target.owner, record.target.repo);
      validateBranch(record.target.branch);
      if (!/^[a-z0-9-]+$/.test(record.target.secretId) || (record.commit !== null && !/^[0-9a-f]{40,64}$/.test(record.commit))) throw new UserError('A vault export record is invalid.');
    }
  }
  return state;
}

export class DeviceStore implements StateRepository {
  data = emptyState();
  private db: IDBDatabase | null = null;
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly key: string, private readonly databaseName = 'github-sync-zev-device-v1') {}

  async open(): Promise<void> {
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('workspaces');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new UserError('Device database is unavailable. No sync was started.'));
      request.onblocked = () => reject(new UserError('Close other Obsidian windows using this workspace and retry.'));
    });
    this.db.onversionchange = () => this.close();
    const stored = await new Promise<unknown>((resolve, reject) => {
      const request = this.db!.transaction('workspaces').objectStore('workspaces').get(this.key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new UserError('Cannot read the device database.'));
    });
    if (stored !== undefined) this.data = validateState(stored);
    else await this.save();
  }

  save(): Promise<void> {
    const snapshot = structuredClone(this.data);
    const operation = this.writes.catch(() => undefined).then(() => new Promise<void>((resolve, reject) => {
      if (!this.db) { reject(new UserError('Device storage is closed. Sync is stopped.')); return; }
      const transaction = this.db.transaction('workspaces', 'readwrite');
      transaction.objectStore('workspaces').put(snapshot, this.key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(new UserError('Cannot save the device journal. Check free storage; sync was stopped.'));
    }));
    this.writes = operation;
    return operation;
  }

  async flush(): Promise<void> { await this.writes; }
  close(): void { this.db?.close(); this.db = null; }
}
