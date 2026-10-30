import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { fromText } from '../src/bytes';
import { DeviceStore, validateState } from '../src/storage';
import { diagnostics } from '../src/privacy';
import { emptyState } from '../src/types';
import { connection } from './helpers';

describe('device-only persistent state', () => {
  it('recovers baselines, conflicts, and upload journals after closing the database', async () => {
    const database = `test-${crypto.randomUUID()}`;
    const store = new DeviceStore('vault-one', database);
    await store.open();
    store.data.mounts.sample = {
      connection: connection({ id: 'sample' }),
      baseline: { 'a.md': { sha: 'a'.repeat(40), content: fromText('private note') } },
      conflicts: {}, pending: 1, lastHead: null, lastSync: null, deletionReview: null,
      inFlight: { commit: 'b'.repeat(40), changes: { 'a.md': fromText('offline edit') } }
    };
    await store.save(); store.close();
    const restarted = new DeviceStore('vault-one', database);
    await restarted.open();
    expect(restarted.data).toEqual(store.data);
    restarted.close();
  });

  it('isolates vault records and serializes multiple writes', async () => {
    const database = `test-${crypto.randomUUID()}`;
    const store = new DeviceStore('one', database);
    await store.open();
    store.data.settings.pollSeconds = 90;
    const first = store.save();
    store.data.settings.pollSeconds = 120;
    const second = store.save();
    await Promise.all([first, second]); store.close();
    const other = new DeviceStore('two', database); await other.open();
    expect(other.data.settings.pollSeconds).toBe(60); other.close();
    const reopened = new DeviceStore('one', database); await reopened.open();
    expect(reopened.data.settings.pollSeconds).toBe(120); reopened.close();
  });

  it('stops on incompatible or malformed state instead of resetting sync history', () => {
    expect(() => validateState({ schema: 99 })).toThrow('unsupported');
    expect(() => validateState(null)).toThrow('unreadable');
    const invalid = emptyState(); invalid.settings.pollSeconds = 0;
    expect(() => validateState(invalid)).toThrow('invalid');
  });

  it('exports diagnostics from explicit counts without including private identifiers or contents', () => {
    const state = emptyState();
    state.mounts.sample = {
      connection: connection({ id: 'sample', owner: 'private-owner', repo: 'private-repo', localPath: 'Private/local', secretId: 'private-secret-id' }),
      baseline: { 'sensitive.md': { sha: 'private-sha', content: fromText('private content') } },
      conflicts: {}, pending: 2, lastHead: 'private-head', lastSync: Date.now(), deletionReview: null, inFlight: null
    };
    state.vaultExports = {
      'snapshot-private-example': {
        id: 'snapshot-private-example', prefix: 'Obsidian-Vaults/snapshot-private-example',
        target: connection({ owner: 'private-owner', repo: 'private-repo' }),
        commit: 'private-export-sha', status: 'pending', noteCount: 1, linkCount: 0, fileCount: 1, createdAt: Date.now()
      }
    };
    const report = diagnostics(state, '1.0.0');
    for (const privateValue of ['private', 'sensitive', 'Private/local', 'lastSync', fromText('private content')]) expect(report).not.toContain(privateValue);
    expect(JSON.parse(report)).toMatchObject({ connections: 1, pendingChanges: 2, version: '1.0.0', vaultSnapshots: 1, pendingVaultSnapshots: 1 });
  });
});
