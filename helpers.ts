import { blobSha } from '../src/bytes';
import { ConcurrentUpdate, Connection, Content, emptyState, LocalChanged, LocalFiles, RemoteRepository, RemoteSnapshot, StateRepository, StoredState } from '../src/types';

export function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'sample-workspace', owner: 'example', repo: 'notes', branch: 'main',
    remotePath: 'docs', localPath: 'GitHub/notes', access: 'read-write',
    secretId: 'test-secret-id', autoUpload: false, paused: false, ...overrides
  };
}

export class MemoryStore implements StateRepository {
  data = emptyState();
  durable: StoredState = structuredClone(this.data);
  fail = false;
  async save(): Promise<void> {
    if (this.fail) throw new Error('storage failure');
    this.durable = structuredClone(this.data);
  }
}

export class MemoryLocal implements LocalFiles {
  files: Record<string, string> = {};
  present = true;
  beforeReplace: (() => void) | null = null;
  async exists(): Promise<boolean> { return this.present; }
  async scan(): Promise<Record<string, string>> { return { ...this.files }; }
  async read(_root: string, path: string): Promise<Content> { return this.files[path] ?? null; }
  async replace(_root: string, path: string, expected: Content, content: Content): Promise<void> {
    this.beforeReplace?.();
    this.beforeReplace = null;
    if ((this.files[path] ?? null) !== expected) throw new LocalChanged();
    if (content === null) delete this.files[path];
    else this.files[path] = content;
  }
}

interface Commit { parent: string | null; files: Record<string, string>; }
export class MemoryRemote implements RemoteRepository {
  commits = new Map<string, Commit>();
  contents = new Map<string, string>();
  head = 'initial';
  preparations = 0;
  publishes = 0;
  offline = false;
  failAfterPublish = false;
  beforePublish: (() => Promise<void> | void) | null = null;
  beforeRead: (() => void) | null = null;

  constructor(files: Record<string, string> = {}) { this.commits.set(this.head, { parent: null, files: { ...files } }); }
  get files(): Record<string, string> { return this.commits.get(this.head)!.files; }

  async external(files: Record<string, string>): Promise<void> {
    const next = `external-${this.commits.size}`;
    this.commits.set(next, { parent: this.head, files: { ...files } });
    this.head = next;
  }

  async snapshot(): Promise<RemoteSnapshot> {
    if (this.offline) throw new Error('offline');
    const snapshot: RemoteSnapshot = { head: this.head, tree: `tree-${this.head}`, files: {} };
    for (const [path, content] of Object.entries(this.files)) {
      const sha = await blobSha(content);
      this.contents.set(sha, content);
      snapshot.files[path] = { sha, size: atob(content).length, mode: '100644' };
    }
    return snapshot;
  }

  async read(_connection: Connection, sha: string): Promise<string> {
    this.beforeRead?.(); this.beforeRead = null;
    return this.contents.get(sha)!;
  }

  async prepareCommit(_connection: Connection, snapshot: RemoteSnapshot, changes: Record<string, Content>): Promise<string> {
    this.preparations++;
    const files = { ...this.commits.get(snapshot.head)!.files };
    for (const [path, content] of Object.entries(changes)) {
      if (content === null) delete files[path]; else files[path] = content;
    }
    const sha = `prepared-${this.commits.size}`;
    this.commits.set(sha, { parent: snapshot.head, files });
    return sha;
  }

  async publish(_connection: Connection, commit: string): Promise<void> {
    const hook = this.beforePublish; this.beforePublish = null;
    await hook?.();
    if (this.commits.get(commit)!.parent !== this.head) throw new ConcurrentUpdate();
    this.head = commit;
    this.publishes++;
    if (this.failAfterPublish) { this.failAfterPublish = false; throw new Error('lost HTTP response'); }
  }

  async containsCommit(_connection: Connection, ancestor: string, head: string): Promise<boolean> {
    let cursor: string | null = head;
    while (cursor) {
      if (cursor === ancestor) return true;
      cursor = this.commits.get(cursor)?.parent ?? null;
    }
    return false;
  }
}
