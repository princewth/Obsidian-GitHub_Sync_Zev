import { describe, expect, it, vi } from 'vitest';
import { VaultExportService, VaultExportRemote, vaultExportURL } from '../src/export-service';
import { buildVaultExport } from '../src/vault-export';
import { fromText } from '../src/bytes';
import { ConcurrentUpdate } from '../src/types';
import { connection, MemoryStore } from './helpers';

const HEAD = 'a'.repeat(40), TREE = 'b'.repeat(40), COMMIT = 'c'.repeat(40);
function setup() {
  const store = new MemoryStore();
  const remote = {
    revision: vi.fn(async () => ({ head: HEAD, tree: TREE })),
    prepareVaultExport: vi.fn(async () => COMMIT),
    publish: vi.fn(async () => undefined),
    containsCommit: vi.fn(async () => false)
  } satisfies VaultExportRemote;
  const service = new VaultExportService(store, remote);
  const plan = buildVaultExport({ files: { 'a.md': fromText('A') }, links: [], blocks: {}, excluded: 0 }, 10 * 1024 * 1024);
  return { store, remote, service, plan };
}

describe('vault snapshot publication and recovery', () => {
  it('saves a durable publication journal before updating the branch', async () => {
    const { store, remote, service, plan } = setup();
    remote.publish.mockImplementation(async () => {
      expect(store.durable.vaultExports?.[plan.id]).toMatchObject({ commit: COMMIT, status: 'pending' });
    });
    const record = await service.publish(connection(), plan);
    expect(record.status).toBe('published');
    expect(record.target.remotePath).toBe('');
    expect(record.target.localPath).toBe('Vault');
    expect(store.durable.vaultExports?.[plan.id]?.status).toBe('published');
  });

  it('recovers a lost publication response without uploading the snapshot again', async () => {
    const { store, remote, service, plan } = setup();
    remote.publish.mockRejectedValue(new Error('network lost'));
    await expect(service.publish(connection(), plan)).rejects.toThrow('network lost');
    expect(store.durable.vaultExports?.[plan.id]?.status).toBe('pending');
    const restartedStore = new MemoryStore(); restartedStore.data = structuredClone(store.durable);
    const restarted = new VaultExportService(restartedStore, remote);
    remote.containsCommit.mockResolvedValue(true);
    expect((await restarted.checkPublication(plan.id)).status).toBe('published');
    expect(remote.prepareVaultExport).toHaveBeenCalledTimes(1);
    expect(remote.publish).toHaveBeenCalledTimes(1);
  });

  it('reports an unpublished snapshot when its commit is absent from the branch', async () => {
    const { remote, service, plan } = setup();
    remote.publish.mockRejectedValue(new Error('network lost'));
    await expect(service.publish(connection(), plan)).rejects.toThrow();
    expect((await service.checkPublication(plan.id)).status).toBe('not-published');
  });

  it('retries a concurrent branch update without changing the snapshot identity', async () => {
    const { remote, service, plan } = setup();
    remote.publish.mockRejectedValueOnce(new ConcurrentUpdate());
    const record = await service.publish(connection(), plan);
    expect(record.id).toBe(plan.id);
    expect(remote.prepareVaultExport).toHaveBeenCalledTimes(2);
    expect(remote.publish).toHaveBeenCalledTimes(2);
  });

  it('stops after three concurrent failures and keeps the journal checkable', async () => {
    const { remote, service, plan, store } = setup();
    remote.publish.mockRejectedValue(new ConcurrentUpdate());
    await expect(service.publish(connection(), plan)).rejects.toBeInstanceOf(ConcurrentUpdate);
    expect(remote.publish).toHaveBeenCalledTimes(3);
    expect(store.durable.vaultExports?.[plan.id]?.status).toBe('pending');
  });

  it('does not upload when the journal cannot save or the connection is read-only', async () => {
    const { remote, service, plan, store } = setup();
    await expect(service.publish(connection({ access: 'read-only' }), plan)).rejects.toThrow('writable');
    expect(remote.prepareVaultExport).not.toHaveBeenCalled();
    store.fail = true;
    await expect(service.publish(connection(), plan)).rejects.toThrow();
    expect(remote.prepareVaultExport).not.toHaveBeenCalled();
    expect(remote.publish).not.toHaveBeenCalled();
  });

  it('rejects publishing the same submitted snapshot twice and respects plugin unload', async () => {
    const { service, plan, remote } = setup();
    await service.publish(connection(), plan);
    await expect(service.publish(connection(), plan)).rejects.toThrow('already');
    service.stop();
    await expect(service.checkPublication(plan.id)).rejects.toThrow('unloading');
    expect(remote.publish).toHaveBeenCalledTimes(1);
  });

  it('marks pre-commit failures as unpublished and creates commit-pinned GitHub links', async () => {
    const { remote, service, plan, store } = setup();
    remote.prepareVaultExport.mockRejectedValueOnce(new Error('network'));
    await expect(service.publish(connection(), plan)).rejects.toThrow();
    const record = store.data.vaultExports![plan.id]!;
    expect(record.status).toBe('not-published');
    record.commit = COMMIT;
    record.target.branch = 'feature/docs';
    expect(vaultExportURL(record)).toContain(`/tree/${COMMIT}/Obsidian-Vaults/`);
    expect(vaultExportURL(record)).not.toContain('feature/docs');
  });
});
