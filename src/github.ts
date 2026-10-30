import { blobSha, decode, toText } from './bytes';
import { checkCollisions, isText, join, safePath, supported, validateBranch, validateIdentity } from './paths';
import { ConcurrentUpdate, Connection, Content, MAX_WORKSPACE_BYTES, RemoteFile, RemoteRepository, RemoteSnapshot, UserError } from './types';
import { EXPORT_ROOT, validateExportFiles, VaultExportPlan } from './vault-export';

export interface HTTPResponse { status: number; headers: Record<string, string>; json: unknown; }
export interface HTTPRequest { url: string; method: string; headers: Record<string, string>; body?: string; }
export type Transport = (request: HTTPRequest) => Promise<HTTPResponse>;
interface TreeEntry { path: string; type: string; mode: string; sha: string; size?: number; }
interface TreeResponse { tree: TreeEntry[]; truncated?: boolean; }
interface CommitResponse { sha: string; tree: { sha: string }; parents: Array<{ sha: string }>; }
interface RepoInfo { default_branch: string; permissions?: { push?: boolean }; }
interface TreeWriteEntry { path: string; mode: string; type: string; sha?: Content; content?: string; }

export class GitHubClient implements RemoteRepository {
  private lastExportWrite = 0;
  constructor(
    private readonly transport: Transport,
    private readonly getToken: (secretId: string) => string | null,
    private readonly maxBytes: () => number,
    private readonly exportWriteSpacingMs = 800
  ) {}

  private root(connection: Pick<Connection, 'owner' | 'repo'>): string {
    validateIdentity(connection.owner, connection.repo);
    return `/repos/${encodeURIComponent(connection.owner)}/${encodeURIComponent(connection.repo)}`;
  }

  private async request<T>(path: string, secretId: string, method = 'GET', body?: unknown): Promise<T> {
    if (!path.startsWith('/repos/') || /[\r\n]/.test(path)) throw new UserError('Invalid GitHub request.');
    const token = this.getToken(secretId);
    if (method !== 'GET' && !token) throw new UserError('Add a repository token in settings before uploading.');
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response: HTTPResponse;
    try { response = await this.transport({ url: `https://api.github.com${path}`, method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
    catch { throw new UserError('GitHub is unreachable. Local changes are safe; retry when online.'); }
    if (response.status < 200 || response.status >= 300) {
      // Never expose upstream messages, URLs, headers, tokens, repository names or note contents.
      if (response.status === 401) throw new UserError('GitHub authentication failed. Replace the token in settings.');
      if (response.status === 404) throw new UserError('Repository, branch, or folder was not found. Check the connection and token access.');
      if (response.status === 409) {
        if (method === 'GET') throw new UserError('Initialize this GitHub repository with a README before connecting.');
        throw new ConcurrentUpdate();
      }
      const remaining = Object.entries(response.headers).find(([key]) => key.toLowerCase() === 'x-ratelimit-remaining')?.[1];
      if (response.status === 429 || (response.status === 403 && remaining === '0')) throw new UserError('GitHub rate limit reached. Pause sync and retry later, or add a token.');
      if (response.status === 403) throw new UserError('GitHub denied access. Check token permissions and branch rules; use a writable branch.');
      if (response.status === 422 && method === 'PATCH') {
        const message = response.json && typeof response.json === 'object' && 'message' in response.json ? String(response.json.message) : '';
        if (/protect|rule|pull request/i.test(message)) throw new UserError('This branch requires a pull request or another repository rule. Use a writable branch or read-only access.');
        throw new ConcurrentUpdate();
      }
      if (response.status === 422) throw new UserError('GitHub rejected the update. Check branch rules, file sizes, and repository settings.');
      throw new UserError(`GitHub request failed (HTTP ${response.status}). Local changes were kept.`);
    }
    return response.json as T;
  }

  async repoInfo(owner: string, repo: string, secretId: string): Promise<RepoInfo> {
    return this.request(this.root({ owner, repo }), secretId);
  }

  async branches(owner: string, repo: string, secretId: string): Promise<string[]> {
    const result: string[] = [];
    for (let page = 1; page <= 100; page++) {
      const data = await this.request<Array<{ name: string }>>(`${this.root({ owner, repo })}/branches?per_page=100&page=${page}`, secretId);
      result.push(...data.map(branch => branch.name));
      if (data.length < 100) return result;
    }
    throw new UserError('This repository has too many branches to list. Use a smaller repository.');
  }

  private async head(connection: Connection): Promise<string> {
    validateBranch(connection.branch);
    const ref = await this.request<{ object: { sha: string } }>(`${this.root(connection)}/git/ref/heads/${connection.branch.split('/').map(encodeURIComponent).join('/')}`, connection.secretId);
    return ref.object.sha;
  }

  private tree(connection: Connection, sha: string, recursive = false): Promise<TreeResponse> {
    this.sha(sha);
    return this.request(`${this.root(connection)}/git/trees/${sha}${recursive ? '?recursive=1' : ''}`, connection.secretId);
  }

  private sha(sha: string): void {
    if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new UserError('GitHub returned an invalid object identifier.');
  }

  async revision(connection: Connection): Promise<{ head: string; tree: string }> {
    const head = await this.head(connection);
    this.sha(head);
    const commit = await this.request<CommitResponse>(`${this.root(connection)}/git/commits/${head}`, connection.secretId);
    this.sha(commit.tree.sha);
    return { head, tree: commit.tree.sha };
  }

  async snapshot(connection: Connection, allowMissingFolder = false): Promise<RemoteSnapshot> {
    const revision = await this.revision(connection);
    const { head } = revision;
    let folderTree = revision.tree;
    const path = safePath(connection.remotePath, true);
    for (const part of path ? path.split('/') : []) {
      const listing = await this.tree(connection, folderTree);
      if (listing.truncated) throw new UserError('The remote folder listing is incomplete. Choose a smaller folder.');
      const entry = listing.tree.find(entry => entry.path === part);
      if (entry && entry.type !== 'tree') throw new UserError('A file now occupies the remote folder path. Restore the folder before syncing.');
      if (!entry) {
        if (allowMissingFolder) return { head, tree: revision.tree, files: {}, folderMissing: true };
        throw new UserError('The connected remote folder no longer exists. Restore it or disconnect this workspace.');
      }
      folderTree = entry.sha;
    }
    let entries = await this.tree(connection, folderTree, true);
    if (entries.truncated) {
      // An incomplete recursive tree must never be interpreted as remote deletions.
      const complete: TreeEntry[] = [];
      const queue = [{ sha: folderTree, prefix: '' }];
      let traversed = 0;
      while (queue.length) {
        if (++traversed > 2000) throw new UserError('The remote tree is too large. Connect a smaller folder.');
        const current = queue.shift()!;
        const listing = await this.tree(connection, current.sha);
        if (listing.truncated) throw new UserError('GitHub returned an incomplete directory. Sync stopped before changing files.');
        for (const entry of listing.tree) {
          const full = join(current.prefix, entry.path);
          if (entry.type === 'tree') {
            try { safePath(full); queue.push({ sha: entry.sha, prefix: full }); } catch { /* Hidden folders are intentionally excluded. */ }
          } else complete.push({ ...entry, path: full });
        }
      }
      entries = { tree: complete };
    }
    const files: Record<string, RemoteFile> = {};
    let totalBytes = 0;
    for (const entry of entries.tree) {
      if (!supported(entry.path)) continue;
      if (entry.type !== 'blob' || (entry.mode !== '100644' && entry.mode !== '100755')) throw new UserError('A connected file is a symbolic link or unsupported Git object. Remove it from the selected folder.');
      if (!Number.isFinite(entry.size) || entry.size! < 0 || entry.size! > this.maxBytes()) throw new UserError('A remote file exceeds the configured size limit. Increase the limit or choose a smaller folder.');
      this.sha(entry.sha);
      totalBytes += entry.size!;
      if (totalBytes > MAX_WORKSPACE_BYTES) throw new UserError('The selected files exceed the 100 MB workspace limit. Connect a smaller folder.');
      files[entry.path] = { sha: entry.sha, size: entry.size!, mode: entry.mode };
    }
    if (Object.keys(files).length > 20000) throw new UserError('Connect a folder containing fewer than 20,000 supported files.');
    checkCollisions(Object.keys(files));
    return { head, tree: revision.tree, files };
  }

  async read(connection: Connection, sha: string): Promise<string> {
    this.sha(sha);
    const blob = await this.request<{ encoding: string; content: string; size: number }>(`${this.root(connection)}/git/blobs/${sha}`, connection.secretId);
    if (blob.encoding !== 'base64' || blob.size > this.maxBytes()) throw new UserError('The remote file cannot be downloaded within the size limit.');
    const content = blob.content.replace(/\s/g, '');
    let bytes: Uint8Array;
    try { bytes = decode(content); } catch { throw new UserError('GitHub returned invalid file content.'); }
    if (bytes.length !== blob.size || bytes.length > this.maxBytes() || await blobSha(content) !== sha) throw new UserError('Remote file verification failed. No local file was replaced.');
    return content;
  }

  async prepareCommit(connection: Connection, snapshot: RemoteSnapshot, changes: Record<string, Content>): Promise<string> {
    if (!this.getToken(connection.secretId)) throw new UserError('Add a repository token in settings before uploading.');
    const tree: Array<{ path: string; mode: string; type: string; sha: Content }> = [];
    for (const [path, content] of Object.entries(changes)) {
      if (!supported(path)) throw new UserError('An excluded file cannot be uploaded.');
      let sha: Content = null;
      if (content !== null) {
        if (decode(content).length > this.maxBytes()) throw new UserError('A local file exceeds the configured size limit.');
        const result = await this.request<{ sha: string }>(`${this.root(connection)}/git/blobs`, connection.secretId, 'POST', { content, encoding: 'base64' });
        sha = result.sha;
        if (sha !== await blobSha(content)) throw new UserError('GitHub did not confirm the expected file content.');
      }
      tree.push({ path: join(connection.remotePath, safePath(path)), mode: snapshot.files[path]?.mode ?? '100644', type: 'blob', sha });
    }
    return this.commitTree(connection, snapshot, tree, 'Update connected notes');
  }

  async prepareVaultExport(connection: Connection, revision: { head: string; tree: string }, plan: VaultExportPlan, check: () => void = () => undefined): Promise<string> {
    validateExportFiles(plan, this.maxBytes());
    if (connection.access !== 'read-write') throw new UserError('Choose a writable repository connection for vault export.');
    if (!this.getToken(connection.secretId)) throw new UserError('Store a GitHub token with Contents read and write access before saving a vault.');
    check();
    const root = await this.tree(connection, revision.tree);
    if (root.truncated) throw new UserError('Cannot verify the snapshot destination from an incomplete repository tree.');
    const namespace = root.tree.find(entry => entry.path.normalize('NFC').toLowerCase() === EXPORT_ROOT.toLowerCase());
    if (namespace) {
      if (namespace.path !== EXPORT_ROOT) throw new UserError('A differently cased path uses the reserved vault archive name. Rename it before exporting.');
      if (namespace.type !== 'tree') throw new UserError('A file is blocking the vault export directory.');
      const directory = await this.tree(connection, namespace.sha);
      if (directory.truncated) throw new UserError('The snapshot directory is too large to verify safely.');
      if (directory.tree.some(entry => entry.path.toLowerCase() === plan.id.toLowerCase())) throw new UserError('This snapshot already exists. Check its publication result or create a new preview.');
    }
    const tree: TreeWriteEntry[] = [];
    const uploaded = new Set<string>();
    for (const [path, content] of Object.entries(plan.files)) {
      check();
      if (isText(path) || path.endsWith('.json')) {
        tree.push({ path: `${plan.prefix}/${path}`, mode: '100644', type: 'blob', content: toText(content) });
        continue;
      }
      const sha = await blobSha(content);
      if (!uploaded.has(sha)) {
        const result = await this.exportWrite<{ sha: string }>(`${this.root(connection)}/git/blobs`, connection.secretId, { content, encoding: 'base64' }, check);
        if (result.sha !== sha) throw new UserError('GitHub did not confirm the expected snapshot content.');
        uploaded.add(sha);
      }
      tree.push({ path: `${plan.prefix}/${path}`, mode: '100644', type: 'blob', sha });
    }
    let baseTree = revision.tree, batch: TreeWriteEntry[] = [], batchBytes = 0;
    const flush = async (): Promise<void> => {
      if (!batch.length) return;
      const next = await this.exportWrite<{ sha: string }>(`${this.root(connection)}/git/trees`, connection.secretId, { base_tree: baseTree, tree: batch }, check);
      this.sha(next.sha); baseTree = next.sha; batch = []; batchBytes = 0;
    };
    for (const entry of tree) {
      const bytes = new TextEncoder().encode(JSON.stringify(entry)).length;
      if (batch.length && (batchBytes + bytes > 2 * 1024 * 1024 || batch.length >= 2000)) await flush();
      batch.push(entry); batchBytes += bytes;
    }
    await flush();
    const identity = { name: 'GitHub Sync', email: 'github-sync@users.noreply.github.com' };
    const commit = await this.exportWrite<{ sha: string }>(`${this.root(connection)}/git/commits`, connection.secretId, {
      message: 'Save standalone Obsidian vault', tree: baseTree, parents: [revision.head], author: identity, committer: identity
    }, check);
    this.sha(commit.sha);
    return commit.sha;
  }

  private async exportWrite<T>(path: string, secretId: string, body: unknown, check: () => void): Promise<T> {
    check();
    const wait = this.lastExportWrite + this.exportWriteSpacingMs - Date.now();
    if (wait > 0) await new Promise<void>(resolve => window.setTimeout(resolve, wait));
    check();
    this.lastExportWrite = Date.now();
    return this.request<T>(path, secretId, 'POST', body);
  }

  private async commitTree(connection: Connection, revision: { head: string; tree: string }, tree: Array<{ path: string; mode: string; type: string; sha: Content }>, message: string): Promise<string> {
    const nextTree = await this.request<{ sha: string }>(`${this.root(connection)}/git/trees`, connection.secretId, 'POST', { base_tree: revision.tree, tree });
    const identity = { name: 'GitHub Sync', email: 'github-sync@users.noreply.github.com' };
    const commit = await this.request<{ sha: string }>(`${this.root(connection)}/git/commits`, connection.secretId, 'POST', {
      message,
      tree: nextTree.sha,
      parents: [revision.head],
      author: identity,
      committer: identity
    });
    this.sha(commit.sha);
    return commit.sha;
  }

  async publish(connection: Connection, commit: string): Promise<void> {
    this.sha(commit);
    const prepared = await this.request<CommitResponse>(`${this.root(connection)}/git/commits/${commit}`, connection.secretId);
    const current = await this.head(connection);
    if (current === commit) return;
    if (prepared.parents.length !== 1 || prepared.parents[0]?.sha !== current) throw new ConcurrentUpdate();
    await this.request(`${this.root(connection)}/git/refs/heads/${connection.branch.split('/').map(encodeURIComponent).join('/')}`, connection.secretId, 'PATCH', { sha: commit, force: false });
  }

  async containsCommit(connection: Connection, ancestor: string, head: string): Promise<boolean> {
    if (ancestor === head) return true;
    this.sha(ancestor); this.sha(head);
    const comparison = await this.request<{ status: string }>(`${this.root(connection)}/compare/${ancestor}...${head}`, connection.secretId);
    return comparison.status === 'ahead' || comparison.status === 'identical';
  }
}
