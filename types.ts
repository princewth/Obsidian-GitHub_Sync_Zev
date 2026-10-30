export type Content = string | null; // Base64 bytes; null means absent, not an empty file.
export const MAX_WORKSPACE_BYTES = 100 * 1024 * 1024;

export interface Connection {
  id: string;
  owner: string;
  repo: string;
  branch: string;
  remotePath: string;
  localPath: string;
  access: 'read-only' | 'read-write';
  secretId: string;
  autoUpload: boolean;
  paused: boolean;
}

export interface RemoteFile {
  sha: string;
  size: number;
  mode: '100644' | '100755';
}

export interface RemoteSnapshot {
  head: string;
  tree: string;
  files: Record<string, RemoteFile>;
  folderMissing?: boolean;
}

export interface Baseline {
  sha: string;
  content: string;
}

export interface Conflict {
  path: string;
  base: Content;
  local: Content;
  remote: Content;
  remoteSha: string | null;
  kind: 'text' | 'binary' | 'delete';
}

export interface MountState {
  connection: Connection;
  baseline: Record<string, Baseline>;
  conflicts: Record<string, Conflict>;
  pending: number;
  lastSync: number | null;
  lastHead: string | null;
  allowMissingFolder?: boolean;
  deletionReview: { fingerprint: string; paths: string[] } | null;
  // Written before remote ref publication, recovered after ambiguous network outcomes.
  inFlight: { commit: string; changes: Record<string, Content>; emptiesFolder?: boolean } | null;
}

export interface Settings {
  pollSeconds: number;
  uploadDelaySeconds: number;
  maxFileMB: number;
}

export interface StoredState {
  schema: 1;
  settings: Settings;
  mounts: Record<string, MountState>;
  vaultExports?: Record<string, VaultExportRecord>;
}

export interface VaultExportRecord {
  id: string;
  prefix: string;
  target: Connection;
  commit: string | null;
  status: 'preparing' | 'pending' | 'published' | 'not-published';
  noteCount: number;
  linkCount: number;
  fileCount: number;
  createdAt: number;
}

export const DEFAULT_SETTINGS: Settings = {
  pollSeconds: 60,
  uploadDelaySeconds: 15,
  maxFileMB: 10
};

export function emptyState(): StoredState {
  return { schema: 1, settings: { ...DEFAULT_SETTINGS }, mounts: {} };
}

export interface StateRepository {
  data: StoredState;
  save(): Promise<void>;
}

export interface LocalFiles {
  exists(root: string): Promise<boolean>;
  scan(root: string): Promise<Record<string, string>>;
  read(root: string, path: string): Promise<Content>;
  // Must reject if content changed, including unsaved native editor content.
  replace(root: string, path: string, expected: Content, content: Content): Promise<void>;
}

export interface RemoteRepository {
  snapshot(connection: Connection, allowMissingFolder?: boolean): Promise<RemoteSnapshot>;
  read(connection: Connection, sha: string): Promise<string>;
  prepareCommit(connection: Connection, snapshot: RemoteSnapshot, changes: Record<string, Content>): Promise<string>;
  publish(connection: Connection, commit: string): Promise<void>;
  containsCommit(connection: Connection, ancestor: string, head: string): Promise<boolean>;
}

export type Phase = 'idle' | 'syncing' | 'pending' | 'conflict' | 'review' | 'error' | 'paused';
export interface SyncStatus {
  phase: Phase;
  message: string;
}

export class UserError extends Error {
  constructor(message: string) { super(message); this.name = 'UserError'; }
}

export class ConcurrentUpdate extends UserError {
  constructor() { super('The branch changed during upload. Refresh and retry.'); }
}

export class LocalChanged extends UserError {
  constructor() { super('A local file changed during sync. Your edits were kept; sync again.'); }
}
