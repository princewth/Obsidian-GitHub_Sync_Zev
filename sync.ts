import { blobSha } from './bytes';
import { mergeText } from './merge';
import { checkCollisions, isText, safePath, supported } from './paths';
import { Baseline, ConcurrentUpdate, Conflict, Connection, Content, LocalFiles, MountState, RemoteRepository, StateRepository, SyncStatus, UserError } from './types';

export class SyncEngine {
  private readonly running = new Set<string>();
  private stopped = false;
  readonly statuses = new Map<string, SyncStatus>();

  constructor(
    private readonly store: StateRepository,
    private readonly local: LocalFiles,
    private readonly remote: RemoteRepository,
    private readonly changed: () => void = () => undefined
  ) {}

  stop(): void { this.stopped = true; }
  isRunning(id: string): boolean { return this.running.has(id); }
  isStopped(): boolean { return this.stopped; }

  private check(): void { if (this.stopped) throw new UserError('Plugin is unloading. Your local changes are safe.'); }

  status(id: string): SyncStatus {
    const mount = this.store.data.mounts[id];
    if (mount?.connection.paused) return { phase: 'paused', message: 'Paused' };
    const current = this.statuses.get(id);
    if (current && ['syncing', 'error', 'review'].includes(current.phase)) return current;
    const conflicts = Object.keys(mount?.conflicts ?? {}).length;
    if (conflicts) return { phase: 'conflict', message: `${conflicts} conflict(s) need review. Uploads are paused.` };
    if (mount?.pending) return { phase: 'pending', message: mount.connection.access === 'read-only' ? `${mount.pending} local change(s) kept. This connection is read-only.` : `${mount.pending} change(s) waiting to upload.` };
    return current ?? { phase: 'idle', message: 'Ready' };
  }

  private setStatus(id: string, phase: SyncStatus['phase'], message: string): void {
    this.statuses.set(id, { phase, message });
    this.changed();
  }

  async sync(id: string, upload = true, deletionApproval?: string): Promise<void> {
    const mount = this.store.data.mounts[id];
    if (!mount || mount.connection.paused || this.running.has(id) || this.stopped) return;
    this.running.add(id);
    this.setStatus(id, 'syncing', 'Checking connected files…');
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await this.perform(mount, upload, deletionApproval); return; }
        catch (error) { if (!(error instanceof ConcurrentUpdate) || attempt === 2) throw error; }
      }
    } catch (error) {
      const message = error instanceof UserError ? error.message : 'Sync stopped safely. Local changes were kept. Retry, or use the recovery tools.';
      this.setStatus(id, 'error', message);
    } finally {
      this.running.delete(id);
      this.changed();
    }
  }

  private async recover(mount: MountState, head: string): Promise<void> {
    if (!mount.inFlight) return;
    const flight = mount.inFlight;
    if (await this.remote.containsCommit(mount.connection, flight.commit, head)) {
      // A previous ref update succeeded but its HTTP response or local journal write was lost.
      for (const [path, content] of Object.entries(flight.changes)) {
        if (content === null) delete mount.baseline[path];
        else mount.baseline[path] = { sha: await blobSha(content), content };
      }
      mount.allowMissingFolder = Boolean(flight.emptiesFolder);
    }
    mount.inFlight = null;
    await this.store.save();
  }

  private async perform(mount: MountState, upload: boolean, deletionApproval?: string): Promise<void> {
    this.check();
    const connection = mount.connection;
    if (!(await this.local.exists(connection.localPath))) throw new UserError('The local workspace folder is missing. Restore it or disconnect; remote files were kept.');
    const snapshot = await this.remote.snapshot(connection, Boolean(mount.allowMissingFolder || mount.inFlight?.emptiesFolder));
    this.check();
    await this.recover(mount, snapshot.head);
    if (snapshot.folderMissing && !mount.allowMissingFolder) throw new UserError('The remote folder is missing and its deletion was not confirmed. Restore it before syncing.');
    if (Object.keys(snapshot.files).length) mount.allowMissingFolder = false;
    const localFiles = await this.local.scan(connection.localPath);
    checkCollisions([...new Set([...Object.keys(localFiles), ...Object.keys(snapshot.files), ...Object.keys(mount.baseline)])]);
    const paths = [...new Set([...Object.keys(mount.baseline), ...Object.keys(localFiles), ...Object.keys(snapshot.files)])].sort();
    const outgoing: Record<string, Content> = {};
    const conflicts: Record<string, Conflict> = {};
    let processed = 0;
    let lastCheckpoint = Date.now();
    const checkpoint = async (): Promise<void> => {
      if (Date.now() - lastCheckpoint < 2000) return;
      await this.store.save();
      lastCheckpoint = Date.now();
    };

    for (const path of paths) {
      this.check();
      if (!supported(path)) throw new UserError('A tracked file is now excluded. Disconnect and reconnect to review the workspace.');
      const base = mount.baseline[path];
      const local: Content = localFiles[path] ?? null;
      const remoteFile = snapshot.files[path];
      const remoteContent: Content = remoteFile ? (base?.sha === remoteFile.sha ? base.content : await this.remote.read(connection, remoteFile.sha)) : null;
      const rememberRemote = (): void => {
        if (remoteContent === null || !remoteFile) delete mount.baseline[path];
        else mount.baseline[path] = { sha: remoteFile.sha, content: remoteContent };
      };

      if (local === remoteContent) {
        rememberRemote();
      } else if (!base) {
        if (local === null) {
          this.check();
          await this.local.replace(connection.localPath, path, null, remoteContent);
          rememberRemote();
          // Equal downloaded bytes recover without a baseline; checkpoint without rewriting
          // a growing database once per file. All outgoing changes are journaled below.
          await checkpoint();
        } else if (remoteContent === null) outgoing[path] = local;
        else conflicts[path] = this.conflict(path, null, local, remoteContent, remoteFile?.sha ?? null);
      } else if (local === base.content) {
        this.check();
        await this.local.replace(connection.localPath, path, local, remoteContent);
        rememberRemote();
        await checkpoint();
      } else if (remoteContent === base.content) {
        outgoing[path] = local;
      } else {
        const merged = local !== null && remoteContent !== null && isText(path) ? mergeText(local, base.content, remoteContent) : null;
        if (merged !== null) {
          this.check();
          await this.local.replace(connection.localPath, path, local, merged);
          rememberRemote();
          if (merged !== remoteContent) outgoing[path] = merged;
          await checkpoint();
        } else conflicts[path] = this.conflict(path, base.content, local, remoteContent, remoteFile?.sha ?? null);
      }
      if (++processed % 20 === 0) this.setStatus(connection.id, 'syncing', `Checked ${processed} of ${paths.length} files…`);
    }

    this.check();
    mount.conflicts = conflicts;
    mount.pending = Object.keys(outgoing).length;
    mount.lastHead = snapshot.head;
    const deletions = Object.keys(outgoing).filter(path => outgoing[path] === null).sort();
    const fingerprint = JSON.stringify(deletions.map(path => [path, snapshot.files[path]?.sha ?? null]));
    mount.deletionReview = deletions.length ? { fingerprint, paths: deletions } : null;
    await this.store.save();

    if (Object.keys(conflicts).length) {
      this.setStatus(connection.id, 'conflict', `${Object.keys(conflicts).length} conflict(s) need review. Uploads are paused.`);
      return;
    }
    if (mount.pending && connection.access === 'read-write' && upload) {
      if (deletions.length && deletionApproval !== fingerprint) {
        this.setStatus(connection.id, 'review', `${deletions.length} remote deletion(s) need your review.`);
        return;
      }
      this.setStatus(connection.id, 'syncing', `Uploading ${mount.pending} change(s)…`);
      this.check();
      const commit = await this.remote.prepareCommit(connection, snapshot, outgoing);
      this.check();
      const remaining = new Set(Object.keys(snapshot.files));
      for (const [path, content] of Object.entries(outgoing)) {
        if (content === null) remaining.delete(path); else remaining.add(path);
      }
      const emptiesFolder = Boolean(connection.remotePath) && remaining.size === 0;
      mount.inFlight = { commit, changes: outgoing, emptiesFolder };
      await this.store.save(); // Must be durable BEFORE publishing the branch ref.
      this.check();
      await this.remote.publish(connection, commit);
      for (const [path, content] of Object.entries(outgoing)) {
        if (content === null) delete mount.baseline[path];
        else mount.baseline[path] = { sha: await blobSha(content), content };
      }
      mount.inFlight = null;
      mount.allowMissingFolder = emptiesFolder;
      mount.lastHead = commit;
      mount.deletionReview = null;
      // Local edits during the request remain on disk and are detected by the next scan.
      const after = await this.local.scan(connection.localPath);
      mount.pending = [...new Set([...Object.keys(after), ...Object.keys(mount.baseline)])].filter(path => (after[path] ?? null) !== (mount.baseline[path]?.content ?? null)).length;
    }
    mount.lastSync = Date.now();
    await this.store.save();
    if (mount.pending) this.setStatus(connection.id, 'pending', connection.access === 'read-only' ? `${mount.pending} local change(s) kept. This connection is read-only.` : `${mount.pending} change(s) waiting to upload.`);
    else this.setStatus(connection.id, 'idle', 'Up to date');
  }

  private conflict(path: string, base: Content, local: Content, remote: Content, remoteSha: string | null): Conflict {
    return { path, base, local, remote, remoteSha, kind: local === null || remote === null ? 'delete' : isText(path) ? 'text' : 'binary' };
  }

  async resolve(id: string, path: string, content: Content, expected: Conflict): Promise<void> {
    this.check();
    if (this.running.has(id)) throw new UserError('Wait for the current sync to finish before resolving a conflict.');
    const mount = this.store.data.mounts[id];
    const conflict = mount?.conflicts[safePath(path)];
    if (!mount || !conflict || JSON.stringify(conflict) !== JSON.stringify(expected)) throw new UserError('The conflict changed. Reopen it to review the latest versions.');
    this.running.add(id);
    try {
      await this.local.replace(mount.connection.localPath, path, conflict.local, content);
      if (conflict.remote !== null && conflict.remoteSha) mount.baseline[path] = { sha: conflict.remoteSha, content: conflict.remote };
      else delete mount.baseline[path];
      delete mount.conflicts[path];
      mount.pending = Math.max(1, mount.pending);
      await this.store.save();
      this.setStatus(id, Object.keys(mount.conflicts).length ? 'conflict' : 'pending', 'Resolution saved locally. Sync to upload.');
    } finally { this.running.delete(id); }
  }

  async disconnect(id: string): Promise<void> {
    if (this.running.has(id)) throw new UserError('Wait for sync to finish before disconnecting.');
    delete this.store.data.mounts[id];
    this.statuses.delete(id);
    await this.store.save();
    this.changed();
  }

  async add(connection: Connection): Promise<void> {
    if (this.store.data.mounts[connection.id]) throw new UserError('This workspace is already connected.');
    this.store.data.mounts[connection.id] = {
      connection, baseline: {} as Record<string, Baseline>, conflicts: {}, pending: 0,
      lastSync: null, lastHead: null, allowMissingFolder: false, deletionReview: null, inFlight: null
    };
    await this.store.save();
    this.changed();
  }
}
