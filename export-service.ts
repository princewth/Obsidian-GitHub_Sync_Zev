import { ConcurrentUpdate, Connection, StateRepository, UserError, VaultExportRecord } from './types';
import { VaultExportPlan } from './vault-export';

export interface VaultExportRemote {
  revision(target: Connection): Promise<{ head: string; tree: string }>;
  prepareVaultExport(target: Connection, revision: { head: string; tree: string }, plan: VaultExportPlan, check?: () => void): Promise<string>;
  publish(target: Connection, commit: string): Promise<void>;
  containsCommit(target: Connection, ancestor: string, head: string): Promise<boolean>;
}

export class VaultExportService {
  busy = false;
  private stopped = false;
  constructor(private readonly store: StateRepository, private readonly remote: VaultExportRemote, private readonly changed: () => void = () => undefined) {}

  stop(): void { this.stopped = true; }
  private check(): void { if (this.stopped) throw new UserError('Plugin is unloading. Check the snapshot status after reopening Obsidian.'); }

  async publish(connection: Connection, plan: VaultExportPlan): Promise<VaultExportRecord> {
    if (this.busy) throw new UserError('A vault export is already running.');
    if (connection.access !== 'read-write') throw new UserError('Choose a writable connection for vault export.');
    this.check();
    const records = this.store.data.vaultExports ??= {};
    if (records[plan.id]) throw new UserError('This snapshot has already been submitted. Check its status or create a new preview.');
    const target: Connection = { ...connection, id: plan.id, remotePath: '', localPath: 'Vault', autoUpload: false, paused: false };
    const record: VaultExportRecord = {
      id: plan.id, prefix: plan.prefix, target, commit: null, status: 'preparing',
      noteCount: plan.noteCount, linkCount: plan.linkCount, fileCount: plan.fileCount, createdAt: Date.now()
    };
    records[record.id] = record;
    this.busy = true;
    this.changed();
    try {
      await this.store.save();
      for (let attempt = 0; attempt < 3; attempt++) {
        this.check();
        const revision = await this.remote.revision(target);
        const commit = await this.remote.prepareVaultExport(target, revision, plan, () => this.check());
        this.check();
        record.commit = commit; record.status = 'pending';
        await this.store.save();
        this.check();
        try { await this.remote.publish(target, commit); }
        catch (error) {
          if (error instanceof ConcurrentUpdate && attempt < 2) {
            const latest = await this.remote.revision(target);
            if (await this.remote.containsCommit(target, commit, latest.head)) break;
            continue;
          }
          throw error;
        }
        break;
      }
      record.status = 'published';
      const old = Object.values(records).filter(item => item.status === 'published').sort((a, b) => b.createdAt - a.createdAt).slice(20);
      for (const item of old) delete records[item.id];
      await this.store.save();
      return record;
    } catch (error) {
      if (!record.commit) {
        record.status = 'not-published';
        await this.store.save().catch(() => undefined);
      }
      throw error;
    } finally { this.busy = false; this.changed(); }
  }

  async checkPublication(id: string): Promise<VaultExportRecord> {
    if (this.busy) throw new UserError('Wait for the current vault export to finish.');
    this.check();
    const record = this.store.data.vaultExports?.[id];
    if (!record) throw new UserError('The snapshot record is unavailable on this device.');
    if (!record.commit) {
      record.status = 'not-published';
      await this.store.save();
      return record;
    }
    this.busy = true; this.changed();
    try {
      const revision = await this.remote.revision(record.target);
      record.status = await this.remote.containsCommit(record.target, record.commit, revision.head) ? 'published' : 'not-published';
      await this.store.save();
      return record;
    } finally { this.busy = false; this.changed(); }
  }
}

export function vaultExportURL(record: VaultExportRecord): string {
  const { owner, repo } = record.target;
  // Pin the URL to the commit: slash-containing branch names remain unambiguous.
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tree/${encodeURIComponent(record.commit ?? record.target.branch)}/${record.prefix.split('/').map(encodeURIComponent).join('/')}`;
}
