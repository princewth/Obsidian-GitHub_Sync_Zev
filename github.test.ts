import { describe, expect, it, vi } from 'vitest';
import { blobSha, fromText } from '../src/bytes';
import { GitHubClient, HTTPRequest, HTTPResponse } from '../src/github';
import { ConcurrentUpdate } from '../src/types';
import { connection } from './helpers';
import { buildVaultExport } from '../src/vault-export';

const HEAD = 'a'.repeat(40), TREE = 'b'.repeat(40), SUBTREE = 'c'.repeat(40), NEXT = 'd'.repeat(40);
const ok = (json: unknown): HTTPResponse => ({ status: 200, headers: {}, json });

function clientWith(handler: (request: HTTPRequest) => HTTPResponse | Promise<HTTPResponse>, token: string | null = 'test-token-placeholder-only') {
  const transport = vi.fn(async (request: HTTPRequest) => handler(request));
  return { client: new GitHubClient(transport, () => token, () => 1024 * 1024, 0), transport };
}

describe('GitHub REST integration contracts', () => {
  it('pins reads to a commit and traverses only the selected subtree', async () => {
    const { client, transport } = clientWith(request => {
      const path = new URL(request.url).pathname;
      if (path.endsWith('/git/ref/heads/feature/docs')) return ok({ object: { sha: HEAD } });
      if (path.endsWith(`/git/commits/${HEAD}`)) return ok({ sha: HEAD, tree: { sha: TREE }, parents: [] });
      if (path.endsWith(`/git/trees/${TREE}`)) return ok({ tree: [{ path: 'docs', type: 'tree', sha: SUBTREE }] });
      if (path.endsWith(`/git/trees/${SUBTREE}`)) return ok({ tree: [
        { path: 'a.md', type: 'blob', mode: '100644', sha: NEXT, size: 2 },
        { path: '.env', type: 'blob', mode: '100644', sha: NEXT, size: 2 },
        { path: '.obsidian/plugin.js', type: 'blob', mode: '100644', sha: NEXT, size: 2 }
      ] });
      throw new Error('Unexpected endpoint');
    });
    const snapshot = await client.snapshot(connection({ branch: 'feature/docs' }));
    expect(snapshot).toEqual({ head: HEAD, tree: TREE, files: { 'a.md': { sha: NEXT, size: 2, mode: '100644' } } });
    expect(transport.mock.calls.every(([request]) => request.url.startsWith('https://api.github.com/repos/example/notes/'))).toBe(true);
    expect(transport.mock.calls.some(([request]) => request.url.includes('recursive=1'))).toBe(true);
  });

  it('falls back to complete directory traversal when GitHub truncates a recursive tree', async () => {
    const { client } = clientWith(request => {
      const url = new URL(request.url), path = url.pathname;
      if (path.endsWith('/git/ref/heads/main')) return ok({ object: { sha: HEAD } });
      if (path.endsWith(`/git/commits/${HEAD}`)) return ok({ tree: { sha: TREE } });
      if (path.endsWith(`/git/trees/${TREE}`) && url.search) return ok({ truncated: true, tree: [] });
      if (path.endsWith(`/git/trees/${TREE}`)) return ok({ tree: [{ path: 'nested', type: 'tree', sha: SUBTREE }] });
      if (path.endsWith(`/git/trees/${SUBTREE}`)) return ok({ tree: [{ path: 'a.md', type: 'blob', mode: '100644', sha: NEXT, size: 2 }] });
      throw new Error('Unexpected endpoint');
    });
    const snapshot = await client.snapshot(connection({ remotePath: '' }));
    expect(Object.keys(snapshot.files)).toEqual(['nested/a.md']);
  });

  it('stops safely if even a non-recursive tree is incomplete', async () => {
    const { client } = clientWith(request => {
      if (request.url.includes('/git/ref/')) return ok({ object: { sha: HEAD } });
      if (request.url.includes('/git/commits/')) return ok({ tree: { sha: TREE } });
      return ok({ truncated: true, tree: [] });
    });
    await expect(client.snapshot(connection({ remotePath: '' }))).rejects.toThrow('incomplete');
  });

  it('refuses missing remote folders instead of treating them as an empty tree', async () => {
    const { client } = clientWith(request => {
      if (request.url.includes('/git/ref/')) return ok({ object: { sha: HEAD } });
      if (request.url.includes('/git/commits/')) return ok({ tree: { sha: TREE } });
      return ok({ tree: [] });
    });
    await expect(client.snapshot(connection())).rejects.toThrow('no longer exists');
  });

  it('accepts a known intentionally emptied folder only with explicit engine permission', async () => {
    const { client } = clientWith(request => {
      if (request.url.includes('/git/ref/')) return ok({ object: { sha: HEAD } });
      if (request.url.includes('/git/commits/')) return ok({ tree: { sha: TREE } });
      return ok({ tree: [] });
    });
    expect(await client.snapshot(connection(), true)).toEqual({ head: HEAD, tree: TREE, files: {}, folderMissing: true });
  });

  it('rejects a file replacing the folder even when intentional empty folders are allowed', async () => {
    const { client } = clientWith(request => {
      if (request.url.includes('/git/ref/')) return ok({ object: { sha: HEAD } });
      if (request.url.includes('/git/commits/')) return ok({ tree: { sha: TREE } });
      return ok({ tree: [{ path: 'docs', type: 'blob', mode: '100644', sha: NEXT, size: 1 }] });
    });
    await expect(client.snapshot(connection(), true)).rejects.toThrow('file now occupies');
  });

  it.each([
    { path: 'a.md', mode: '120000', size: 10 },
    { path: 'a.md', mode: '100644', size: 2000000 }
  ])('blocks unsafe or oversized remote objects before returning a snapshot', async entry => {
    const { client } = clientWith(request => {
      if (request.url.includes('/git/ref/')) return ok({ object: { sha: HEAD } });
      if (request.url.includes('/git/commits/')) return ok({ tree: { sha: TREE } });
      return ok({ tree: [{ ...entry, type: 'blob', sha: NEXT }] });
    });
    await expect(client.snapshot(connection({ remotePath: '' }))).rejects.toThrow();
  });

  it('verifies downloaded bytes against their immutable Git blob SHA', async () => {
    const content = fromText('你好\n'), sha = await blobSha(content);
    const { client } = clientWith(() => ok({ encoding: 'base64', content: `${content}\n`, size: atob(content).length }));
    expect(await client.read(connection(), sha)).toBe(content);
    await expect(client.read(connection(), HEAD)).rejects.toThrow('verification');
  });

  it('creates one tree and one commit, preserves unrelated paths, and uses a generic commit identity', async () => {
    const content = fromText('note'), contentSha = await blobSha(content);
    const { client, transport } = clientWith(request => {
      if (request.url.endsWith('/git/blobs')) return ok({ sha: contentSha });
      if (request.url.endsWith('/git/trees')) return ok({ sha: SUBTREE });
      if (request.url.endsWith('/git/commits')) return ok({ sha: NEXT });
      throw new Error('Unexpected endpoint');
    });
    await client.prepareCommit(connection(), {
      head: HEAD, tree: TREE, files: { 'old.md': { sha: HEAD, mode: '100755', size: 3 } }
    }, { 'nested/a.md': content, 'old.md': null });
    const treeRequest = transport.mock.calls.find(([request]) => request.url.endsWith('/git/trees'))![0];
    expect(JSON.parse(treeRequest.body!)).toEqual({ base_tree: TREE, tree: [
      { path: 'docs/nested/a.md', type: 'blob', mode: '100644', sha: contentSha },
      { path: 'docs/old.md', type: 'blob', mode: '100755', sha: null }
    ] });
    const commitRequest = transport.mock.calls.find(([request]) => request.url.endsWith('/git/commits'))![0];
    expect(JSON.parse(commitRequest.body!)).toMatchObject({
      parents: [HEAD], message: 'Update connected notes',
      author: { name: 'GitHub Sync', email: 'github-sync@users.noreply.github.com' },
      committer: { name: 'GitHub Sync', email: 'github-sync@users.noreply.github.com' }
    });
  });

  it('publishes only a fast-forward update and never force-pushes', async () => {
    const { client, transport } = clientWith(request => {
      if (request.url.endsWith(`/git/commits/${NEXT}`)) return ok({ parents: [{ sha: HEAD }] });
      if (request.url.includes('/git/ref/heads/')) return ok({ object: { sha: HEAD } });
      if (request.method === 'PATCH') return ok({ object: { sha: NEXT } });
      throw new Error('Unexpected endpoint');
    });
    await client.publish(connection(), NEXT);
    expect(JSON.parse(transport.mock.calls.find(([request]) => request.method === 'PATCH')![0].body!)).toEqual({ sha: NEXT, force: false });
  });

  it('does not send a ref update after discovering a concurrent commit', async () => {
    const { client, transport } = clientWith(request => request.url.includes('/git/commits/') ? ok({ parents: [{ sha: HEAD }] }) : ok({ object: { sha: SUBTREE } }));
    await expect(client.publish(connection(), NEXT)).rejects.toBeInstanceOf(ConcurrentUpdate);
    expect(transport.mock.calls.some(([request]) => request.method === 'PATCH')).toBe(false);
  });

  it('allows anonymous public reads but requires a token before any write', async () => {
    const { client, transport } = clientWith(() => ok({ default_branch: 'trunk' }), null);
    await client.repoInfo('example', 'notes', 'secret-id');
    expect(transport.mock.calls[0]![0].headers.Authorization).toBeUndefined();
    await expect(client.prepareCommit(connection(), { head: HEAD, tree: TREE, files: {} }, { 'a.md': fromText('a') })).rejects.toThrow('token');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 404, 422, 500])('uses static redacted errors for HTTP %s', async status => {
    const { client } = clientWith(() => ({ status, headers: {}, json: { message: 'private repository name, token, and note contents' } }));
    await expect(client.repoInfo('example', 'notes', 'secret-id')).rejects.not.toThrow('private repository');
  });

  it('handles exhausted rate limits with an actionable static message', async () => {
    const { client } = clientWith(() => ({ status: 403, headers: { 'X-RateLimit-Remaining': '0' }, json: {} }));
    await expect(client.repoInfo('example', 'notes', 'secret-id')).rejects.toThrow('rate limit');
  });

  it('reports protected-branch ref failures without exposing upstream details or retrying as a race', async () => {
    const { client } = clientWith(request => {
      if (request.method === 'PATCH') return { status: 422, headers: {}, json: { message: 'Protected branch private-path requires a pull request' } };
      if (request.url.includes('/git/commits/')) return ok({ parents: [{ sha: HEAD }] });
      return ok({ object: { sha: HEAD } });
    });
    await expect(client.publish(connection(), NEXT)).rejects.toThrow('requires a pull request');
    await expect(client.publish(connection(), NEXT)).rejects.not.toThrow('private-path');
  });

  it('reads all branch pages', async () => {
    const { client } = clientWith(request => ok(request.url.endsWith('page=1') ? Array.from({ length: 100 }, (_, i) => ({ name: `branch-${i}` })) : [{ name: 'last' }]));
    expect(await client.branches('example', 'notes', 'secret-id')).toHaveLength(101);
  });

  it('exports text inline in one Git tree without a blob request per note, retaining original Unicode bytes', async () => {
    const text = '\ufeff# 你好\r\n';
    const plan = buildVaultExport({ files: { 'nested/a.md': fromText(text), 'b.md': fromText('B') }, links: [], blocks: {}, excluded: 0 }, 1024 * 1024);
    const { client, transport } = clientWith(request => {
      if (request.method === 'GET') return ok({ tree: [] });
      if (request.url.endsWith('/git/trees')) return ok({ sha: SUBTREE });
      if (request.url.endsWith('/git/commits')) return ok({ sha: NEXT });
      throw new Error('Unexpected per-file blob upload');
    });
    await client.prepareVaultExport(connection(), { head: HEAD, tree: TREE }, plan);
    const trees = transport.mock.calls.filter(([request]) => request.url.endsWith('/git/trees') && request.method === 'POST');
    expect(trees).toHaveLength(1);
    const body = JSON.parse(trees[0]![0].body!);
    expect(body.base_tree).toBe(TREE);
    expect(body.tree).toContainEqual({ path: `${plan.prefix}/vault/nested/a.md`, mode: '100644', type: 'blob', content: text });
    expect(body.tree.every((entry: { path: string }) => entry.path.startsWith(`${plan.prefix}/`))).toBe(true);
    const commit = JSON.parse(transport.mock.calls.find(([request]) => request.url.endsWith('/git/commits'))![0].body!);
    expect(commit).toMatchObject({ message: 'Save standalone Obsidian vault', parents: [HEAD], tree: SUBTREE });
  });

  it('uploads binary attachments as verified base64 blobs, deduplicating identical bytes', async () => {
    const binary = btoa('\x00\xff'), sha = await blobSha(binary);
    const plan = buildVaultExport({ files: { 'a.md': fromText('A'), 'one.png': binary, 'two.png': binary }, links: [], blocks: {}, excluded: 0 }, 1024 * 1024);
    const { client, transport } = clientWith(request => {
      if (request.method === 'GET') return ok({ tree: [] });
      if (request.url.endsWith('/git/blobs')) return ok({ sha });
      if (request.url.endsWith('/git/trees')) return ok({ sha: SUBTREE });
      return ok({ sha: NEXT });
    });
    await client.prepareVaultExport(connection(), { head: HEAD, tree: TREE }, plan);
    expect(transport.mock.calls.filter(([request]) => request.url.endsWith('/git/blobs'))).toHaveLength(1);
    const tree = JSON.parse(transport.mock.calls.find(([request]) => request.url.endsWith('/git/trees') && request.method === 'POST')![0].body!).tree;
    expect(tree).toContainEqual({ path: `${plan.prefix}/vault/one.png`, mode: '100644', type: 'blob', sha });
    expect(tree).toContainEqual({ path: `${plan.prefix}/vault/two.png`, mode: '100644', type: 'blob', sha });
  });

  it('never overwrites an existing snapshot directory', async () => {
    const plan = buildVaultExport({ files: { 'a.md': fromText('A') }, links: [], blocks: {}, excluded: 0 }, 1024 * 1024);
    const { client, transport } = clientWith(request => request.url.endsWith(TREE) ? ok({ tree: [{ path: 'Obsidian-Vaults', type: 'tree', sha: SUBTREE }] }) : ok({ tree: [{ path: plan.id, type: 'tree', sha: NEXT }] }));
    await expect(client.prepareVaultExport(connection(), { head: HEAD, tree: TREE }, plan)).rejects.toThrow('already exists');
    expect(transport.mock.calls.some(([request]) => request.method !== 'GET')).toBe(false);
  });

  it('rejects modified generated configuration before making requests and honors cancellation', async () => {
    const plan = buildVaultExport({ files: { 'a.md': fromText('A') }, links: [], blocks: {}, excluded: 0 }, 1024 * 1024);
    const { client, transport } = clientWith(() => ok({ tree: [] }));
    await expect(client.prepareVaultExport(connection(), { head: HEAD, tree: TREE }, plan, () => { throw new Error('cancelled'); })).rejects.toThrow('cancelled');
    expect(transport).not.toHaveBeenCalled();
    plan.files['vault/.obsidian/app.json'] = fromText('private settings');
    await expect(client.prepareVaultExport(connection(), { head: HEAD, tree: TREE }, plan)).rejects.toThrow('freshly generated');
    expect(transport).not.toHaveBeenCalled();
  });

  it('splits large reading copies into bounded trees and parents the final commit to the original HEAD', async () => {
    const files = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`note-${index}.md`, fromText('a'.repeat(250000))]));
    const plan = buildVaultExport({ files, links: [], blocks: {}, excluded: 0 }, 1024 * 1024);
    let trees = 0;
    const { client, transport } = clientWith(request => {
      if (request.method === 'GET') return ok({ tree: [] });
      if (request.url.endsWith('/git/trees')) return ok({ sha: ++trees === 1 ? SUBTREE : NEXT });
      return ok({ sha: 'e'.repeat(40) });
    });
    await client.prepareVaultExport(connection(), { head: HEAD, tree: TREE }, plan);
    const requests = transport.mock.calls.filter(([request]) => request.method === 'POST' && request.url.endsWith('/git/trees')).map(([request]) => JSON.parse(request.body!));
    expect(requests).toHaveLength(2);
    expect(requests[0].base_tree).toBe(TREE);
    expect(requests[1].base_tree).toBe(SUBTREE);
    const entries = requests.flatMap(request => request.tree);
    expect(entries).toHaveLength(Object.keys(plan.files).length);
    const commit = JSON.parse(transport.mock.calls.find(([request]) => request.url.endsWith('/git/commits'))![0].body!);
    expect(commit).toMatchObject({ parents: [HEAD], tree: NEXT });
  });

  it('paces export writes while leaving ordinary read requests immediate', async () => {
    vi.useFakeTimers(); vi.setSystemTime(10000);
    try {
      const plan = buildVaultExport({ files: { 'a.md': fromText('A') }, links: [], blocks: {}, excluded: 0 }, 1024 * 1024);
      const times: number[] = [];
      const client = new GitHubClient(async request => {
        if (request.method === 'GET') return ok({ tree: [] });
        times.push(Date.now());
        return ok({ sha: request.url.endsWith('/git/trees') ? SUBTREE : NEXT });
      }, () => 'test-token-placeholder-only', () => 1024 * 1024);
      const pending = client.prepareVaultExport(connection(), { head: HEAD, tree: TREE }, plan);
      await vi.runAllTimersAsync();
      await pending;
      expect(times).toHaveLength(2);
      expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(800);
    } finally { vi.useRealTimers(); }
  });
});
