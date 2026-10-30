import { describe, expect, it } from 'vitest';
import { fromText, toText } from '../src/bytes';
import { SyncEngine } from '../src/sync';
import { Connection, RemoteSnapshot, UserError } from '../src/types';
import { connection, MemoryLocal, MemoryRemote, MemoryStore } from './helpers';

async function setup(remoteFiles: Record<string, string> = {}, localFiles: Record<string, string> = {}) {
  const store = new MemoryStore(), local = new MemoryLocal(), remote = new MemoryRemote(remoteFiles);
  local.files = { ...localFiles };
  const engine = new SyncEngine(store, local, remote);
  await engine.add(connection());
  return { store, local, remote, engine, mount: store.data.mounts['sample-workspace']! };
}

describe('connected-folder synchronization', () => {
  it('hydrates an existing GitHub subtree without publishing or interpreting local absence as deletion', async () => {
    const { engine, local, remote, mount } = await setup({ 'a.md': fromText('你好\n'), 'nested/b.md': fromText('B') });
    await engine.sync('sample-workspace', false);
    expect(toText(local.files['a.md']!)).toBe('你好\n');
    expect(Object.keys(mount.baseline)).toHaveLength(2);
    expect(remote.publishes).toBe(0);
    expect(mount.pending).toBe(0);
  });

  it('does not upload existing local-only notes during the initial download', async () => {
    const { engine, local, remote, mount } = await setup({ 'remote.md': fromText('remote') }, { 'local.md': fromText('private draft') });
    await engine.sync('sample-workspace', false);
    expect(Object.keys(local.files)).toHaveLength(2);
    expect(remote.files['local.md']).toBeUndefined();
    expect(mount.pending).toBe(1);
  });

  it('turns initial differing files into conflicts without overwriting either side', async () => {
    const { engine, local, remote, mount } = await setup({ 'a.md': fromText('remote') }, { 'a.md': fromText('local') });
    await engine.sync('sample-workspace');
    expect(local.files['a.md']).toBe(fromText('local'));
    expect(remote.files['a.md']).toBe(fromText('remote'));
    expect(mount.conflicts['a.md']?.base).toBeNull();
    expect(engine.status('sample-workspace').phase).toBe('conflict');
  });

  it('batches local edits and additions into one commit', async () => {
    const { engine, local, remote, mount } = await setup({ 'a.md': fromText('old') });
    await engine.sync('sample-workspace', false);
    local.files['a.md'] = fromText('new'); local.files['b.md'] = fromText('B');
    await engine.sync('sample-workspace');
    expect(remote.publishes).toBe(1);
    expect(remote.files).toEqual(local.files);
    expect(mount.pending).toBe(0);
  });

  it('pulls remote-only changes and keeps local-only changes pending when uploads are disabled', async () => {
    const { engine, local, remote, mount } = await setup({ 'a.md': fromText('a'), 'b.md': fromText('b') });
    await engine.sync('sample-workspace', false);
    local.files['a.md'] = fromText('local');
    await remote.external({ ...remote.files, 'b.md': fromText('remote') });
    await engine.sync('sample-workspace', false);
    expect(toText(local.files['a.md']!)).toBe('local');
    expect(toText(local.files['b.md']!)).toBe('remote');
    expect(mount.pending).toBe(1);
    expect(remote.publishes).toBe(0);
  });

  it('merges non-overlapping text edits while preserving line endings', async () => {
    const { engine, local, remote, mount } = await setup({ 'a.md': fromText('one\r\ntwo\r\nthree\r\n') });
    await engine.sync('sample-workspace', false);
    local.files['a.md'] = fromText('ONE\r\ntwo\r\nthree\r\n');
    await remote.external({ 'a.md': fromText('one\r\ntwo\r\nTHREE\r\n') });
    await engine.sync('sample-workspace');
    expect(toText(local.files['a.md']!)).toBe('ONE\r\ntwo\r\nTHREE\r\n');
    expect(remote.files).toEqual(local.files);
    expect(mount.conflicts).toEqual({});
  });

  it('blocks the entire upload batch on an overlapping conflict', async () => {
    const { engine, local, remote, mount } = await setup({ 'a.md': fromText('base\n') });
    await engine.sync('sample-workspace', false);
    local.files['a.md'] = fromText('local\n'); local.files['b.md'] = fromText('new');
    await remote.external({ 'a.md': fromText('remote\n') });
    await engine.sync('sample-workspace');
    expect(mount.conflicts['a.md']?.base).toBe(fromText('base\n'));
    expect(remote.files['b.md']).toBeUndefined();
    expect(local.files['a.md']).toBe(fromText('local\n'));
  });

  it('persists a resolution locally and uploads it on the next sync', async () => {
    const { engine, remote, mount } = await setup({ 'a.md': fromText('remote') }, { 'a.md': fromText('local') });
    await engine.sync('sample-workspace');
    await engine.resolve('sample-workspace', 'a.md', fromText('merged'), structuredClone(mount.conflicts['a.md']!));
    expect(remote.files['a.md']).toBe(fromText('remote'));
    await engine.sync('sample-workspace');
    expect(remote.files['a.md']).toBe(fromText('merged'));
  });

  it('rejects a stale conflict resolution if local content changed after review', async () => {
    const { engine, local, mount } = await setup({ 'a.md': fromText('remote') }, { 'a.md': fromText('local') });
    await engine.sync('sample-workspace');
    const reviewed = structuredClone(mount.conflicts['a.md']!);
    local.files['a.md'] = fromText('new edit');
    await expect(engine.resolve('sample-workspace', 'a.md', reviewed.remote, reviewed)).rejects.toThrow('changed');
    expect(local.files['a.md']).toBe(fromText('new edit'));
  });

  it('requires exact deletion review and publishes a rename atomically', async () => {
    const { engine, local, remote, mount } = await setup({ 'old.md': fromText('content') });
    await engine.sync('sample-workspace', false);
    delete local.files['old.md']; local.files['new.md'] = fromText('content');
    await engine.sync('sample-workspace');
    expect(remote.publishes).toBe(0);
    expect(mount.deletionReview?.paths).toEqual(['old.md']);
    await engine.sync('sample-workspace', true, mount.deletionReview!.fingerprint);
    expect(remote.publishes).toBe(1);
    expect(remote.files).toEqual({ 'new.md': fromText('content') });
  });

  it('rejects deletion approval when the affected remote version changed', async () => {
    const { engine, local, remote, mount } = await setup({ 'a.md': fromText('a'), 'b.md': fromText('b') });
    await engine.sync('sample-workspace', false);
    delete local.files['a.md'];
    await engine.sync('sample-workspace');
    const approval = mount.deletionReview!.fingerprint;
    await remote.external({ ...remote.files, 'a.md': fromText('a updated remotely') });
    await engine.sync('sample-workspace', true, approval);
    expect(remote.files['a.md']).toBe(fromText('a updated remotely'));
    expect(mount.conflicts['a.md']?.kind).toBe('delete');
  });

  it('applies a remote deletion only when local content is unchanged', async () => {
    const { engine, local, remote, mount } = await setup({ 'a.md': fromText('a'), 'b.md': fromText('b') });
    await engine.sync('sample-workspace', false);
    local.files['b.md'] = fromText('local b');
    await remote.external({});
    await engine.sync('sample-workspace');
    expect(local.files['a.md']).toBeUndefined();
    expect(local.files['b.md']).toBe(fromText('local b'));
    expect(mount.conflicts['b.md']?.kind).toBe('delete');
  });

  it('keeps binary conflicts without trying to decode or merge the bytes', async () => {
    const base = btoa('\0\x01\xff');
    const { engine, local, remote, mount } = await setup({ 'image.png': base });
    await engine.sync('sample-workspace', false);
    local.files['image.png'] = btoa('\0\x02\xff');
    await remote.external({ 'image.png': btoa('\0\x03\xff') });
    await engine.sync('sample-workspace');
    expect(mount.conflicts['image.png']?.kind).toBe('binary');
    expect(local.files['image.png']).toBe(btoa('\0\x02\xff'));
  });

  it('keeps offline edits and discovers them after restarting from the durable journal', async () => {
    const { engine, local, remote, store } = await setup({ 'a.md': fromText('a') });
    await engine.sync('sample-workspace', false);
    local.files['a.md'] = fromText('offline edit');
    remote.offline = true;
    await engine.sync('sample-workspace');
    expect(local.files['a.md']).toBe(fromText('offline edit'));
    const restartedStore = new MemoryStore(); restartedStore.data = structuredClone(store.durable);
    remote.offline = false;
    const restarted = new SyncEngine(restartedStore, local, remote);
    await restarted.sync('sample-workspace');
    expect(remote.files['a.md']).toBe(fromText('offline edit'));
  });

  it('recovers an upload that succeeded remotely but lost its HTTP response without a duplicate commit', async () => {
    const { engine, local, remote, store, mount } = await setup({ 'a.md': fromText('a') });
    await engine.sync('sample-workspace', false);
    local.files['a.md'] = fromText('published');
    remote.failAfterPublish = true;
    await engine.sync('sample-workspace');
    expect(mount.inFlight).not.toBeNull();
    const restartedStore = new MemoryStore(); restartedStore.data = structuredClone(store.durable);
    const restarted = new SyncEngine(restartedStore, local, remote);
    await restarted.sync('sample-workspace');
    expect(remote.publishes).toBe(1);
    expect(restartedStore.data.mounts['sample-workspace']!.inFlight).toBeNull();
    expect(restarted.status('sample-workspace').phase).toBe('idle');
  });

  it('recovers a lost response even if another device committed afterwards', async () => {
    const { engine, local, remote, mount } = await setup({ 'a.md': fromText('a') });
    await engine.sync('sample-workspace', false);
    local.files['a.md'] = fromText('published'); remote.failAfterPublish = true;
    await engine.sync('sample-workspace');
    await remote.external({ ...remote.files, 'other.md': fromText('other device') });
    await engine.sync('sample-workspace');
    expect(remote.publishes).toBe(1);
    expect(local.files['other.md']).toBe(fromText('other device'));
    expect(mount.conflicts).toEqual({});
  });

  it('retries a racing branch and retains the other device’s commit', async () => {
    const { engine, local, remote } = await setup({ 'a.md': fromText('a') });
    await engine.sync('sample-workspace', false);
    local.files['a.md'] = fromText('local edit');
    remote.beforePublish = () => remote.external({ ...remote.files, 'other.md': fromText('other') });
    await engine.sync('sample-workspace');
    expect(remote.preparations).toBe(2);
    expect(remote.files['a.md']).toBe(fromText('local edit'));
    expect(remote.files['other.md']).toBe(fromText('other'));
  });

  it('retains edits made while a commit is uploading as pending changes', async () => {
    const { engine, local, remote, mount } = await setup({ 'a.md': fromText('a') });
    await engine.sync('sample-workspace', false);
    local.files['a.md'] = fromText('first');
    remote.beforePublish = () => { local.files['a.md'] = fromText('second'); };
    await engine.sync('sample-workspace');
    expect(remote.files['a.md']).toBe(fromText('first'));
    expect(local.files['a.md']).toBe(fromText('second'));
    expect(mount.pending).toBe(1);
    await engine.sync('sample-workspace');
    expect(remote.files['a.md']).toBe(fromText('second'));
  });

  it('refuses to overwrite a local edit made during remote download', async () => {
    const { engine, local, remote } = await setup({ 'a.md': fromText('a') });
    await engine.sync('sample-workspace', false);
    await remote.external({ 'a.md': fromText('remote') });
    local.beforeReplace = () => { local.files['a.md'] = fromText('just typed'); };
    await engine.sync('sample-workspace');
    expect(local.files['a.md']).toBe(fromText('just typed'));
    expect(engine.status('sample-workspace').phase).toBe('error');
  });

  it('never uploads or deletes remote files on a read-only connection', async () => {
    const { engine, local, remote, mount } = await setup({ 'a.md': fromText('a') });
    mount.connection.access = 'read-only';
    await engine.sync('sample-workspace', false);
    delete local.files['a.md']; local.files['b.md'] = fromText('b');
    await engine.sync('sample-workspace', true);
    expect(remote.publishes).toBe(0);
    expect(remote.files['a.md']).toBe(fromText('a'));
    expect(mount.pending).toBe(2);
  });

  it('does not interpret a missing local root folder as deletion of every remote note', async () => {
    const { engine, local, remote } = await setup({ 'a.md': fromText('a') });
    await engine.sync('sample-workspace', false);
    local.present = false; local.files = {};
    await engine.sync('sample-workspace');
    expect(engine.status('sample-workspace').phase).toBe('error');
    expect(remote.publishes).toBe(0);
  });

  it('does not publish if the durable journal cannot be saved', async () => {
    const { engine, local, remote, store } = await setup({ 'a.md': fromText('a') });
    await engine.sync('sample-workspace', false);
    local.files['a.md'] = fromText('new'); store.fail = true;
    await engine.sync('sample-workspace');
    expect(remote.publishes).toBe(0);
    expect(engine.status('sample-workspace').phase).toBe('error');
  });

  it('pauses connections and stops work after plugin unload', async () => {
    const { engine, local, mount } = await setup({ 'a.md': fromText('a') });
    mount.connection.paused = true;
    await engine.sync('sample-workspace');
    expect(local.files).toEqual({});
    mount.connection.paused = false; engine.stop();
    await engine.sync('sample-workspace');
    expect(local.files).toEqual({});
  });

  it('disconnects without deleting either the local files or GitHub content', async () => {
    const { engine, local, remote, store } = await setup({ 'a.md': fromText('a') });
    await engine.sync('sample-workspace', false);
    await engine.disconnect('sample-workspace');
    expect(store.data.mounts).toEqual({});
    expect(local.files['a.md']).toBe(fromText('a'));
    expect(remote.files['a.md']).toBe(fromText('a'));
  });

  it('refuses paths that collide on case-insensitive filesystems', async () => {
    const { engine, local, remote } = await setup({ 'A.md': fromText('a') }, { 'a.md': fromText('b') });
    await engine.sync('sample-workspace');
    expect(local.files).toEqual({ 'a.md': fromText('b') });
    expect(remote.publishes).toBe(0);
    expect(engine.status('sample-workspace').phase).toBe('error');
  });

  it('does not expose arbitrary upstream errors through status messages', async () => {
    const { engine, remote } = await setup();
    remote.snapshot = async () => { throw new Error('token and repository details must stay private'); };
    await engine.sync('sample-workspace');
    expect(engine.status('sample-workspace').message).not.toContain('token and repository');
    expect(engine.status('sample-workspace').phase).toBe('error');
  });

  it('keeps uploads stopped on branch protection failures', async () => {
    const { engine, local, remote, mount } = await setup({ 'a.md': fromText('a') });
    await engine.sync('sample-workspace', false);
    local.files['a.md'] = fromText('new');
    remote.publish = async () => { throw new UserError('Branch requires a pull request.'); };
    await engine.sync('sample-workspace');
    expect(mount.inFlight).not.toBeNull();
    expect(remote.files['a.md']).toBe(fromText('a'));
    expect(engine.status('sample-workspace').phase).toBe('error');
  });

  it('can add notes after an approved deletion removed the last file from a Git folder', async () => {
    const { engine, local, remote, mount } = await setup({ 'a.md': fromText('a') });
    const snapshot = remote.snapshot.bind(remote);
    remote.snapshot = async function (_connection?: Connection, allowMissing = false): Promise<RemoteSnapshot> {
      if (!Object.keys(remote.files).length) {
        if (!allowMissing) throw new UserError('Remote folder missing');
        return { ...(await snapshot()), folderMissing: true };
      }
      return snapshot();
    };
    await engine.sync('sample-workspace', false);
    delete local.files['a.md'];
    await engine.sync('sample-workspace');
    await engine.sync('sample-workspace', true, mount.deletionReview!.fingerprint);
    expect(mount.allowMissingFolder).toBe(true);
    await engine.sync('sample-workspace');
    expect(engine.status('sample-workspace').phase).toBe('idle');
    local.files['new.md'] = fromText('new note');
    await engine.sync('sample-workspace');
    expect(remote.files['new.md']).toBe(fromText('new note'));
    expect(mount.allowMissingFolder).toBe(false);
  });

  it('recovers a lost response when the approved upload emptied the remote folder', async () => {
    const { engine, local, remote, mount } = await setup({ 'a.md': fromText('a') });
    const snapshot = remote.snapshot.bind(remote);
    remote.snapshot = async function (_connection?: Connection, allowMissing = false): Promise<RemoteSnapshot> {
      if (!Object.keys(remote.files).length) {
        if (!allowMissing) throw new UserError('Remote folder missing');
        return { ...(await snapshot()), folderMissing: true };
      }
      return snapshot();
    };
    await engine.sync('sample-workspace', false);
    delete local.files['a.md'];
    await engine.sync('sample-workspace');
    remote.failAfterPublish = true;
    await engine.sync('sample-workspace', true, mount.deletionReview!.fingerprint);
    expect(mount.inFlight?.emptiesFolder).toBe(true);
    await engine.sync('sample-workspace');
    expect(mount.inFlight).toBeNull();
    expect(mount.allowMissingFolder).toBe(true);
    expect(remote.publishes).toBe(1);
    expect(engine.status('sample-workspace').phase).toBe('idle');
  });

  it('safely resumes a partially hydrated workspace after an interrupted download', async () => {
    const { engine, local, remote, store } = await setup({ 'a.md': fromText('a'), 'b.md': fromText('b') });
    const read = remote.read.bind(remote);
    remote.read = async (con, sha) => {
      if (local.files['a.md']) throw new Error('download interrupted');
      return read(con, sha);
    };
    await engine.sync('sample-workspace', false);
    expect(local.files['a.md']).toBe(fromText('a'));
    remote.read = read;
    const restartedStore = new MemoryStore(); restartedStore.data = structuredClone(store.durable);
    const restarted = new SyncEngine(restartedStore, local, remote);
    await restarted.sync('sample-workspace', false);
    expect(local.files).toEqual(remote.files);
    expect(remote.publishes).toBe(0);
  });
});
