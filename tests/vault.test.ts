// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App, installDOM, MarkdownView, TFile } from './obsidian.mock';
import { asBuffer, decode, fromText } from '../src/bytes';
import { VaultBridge } from '../src/vault';

beforeEach(installDOM);

describe('native vault bridge', () => {
  it('creates nested folders and UTF-8 notes through native vault APIs', async () => {
    const app = new App(), bridge = new VaultBridge(app as never, () => 1024 * 1024);
    await bridge.ensureFolder('GitHub/notes');
    await bridge.replace('GitHub/notes', 'nested/你好.md', null, fromText('你好'));
    expect(await bridge.scan('GitHub/notes')).toEqual({ 'nested/你好.md': fromText('你好') });
  });

  it('protects unsaved Markdown editor contents against a remote overwrite', async () => {
    const app = new App(), bridge = new VaultBridge(app as never, () => 1024 * 1024);
    await bridge.ensureFolder('Notes');
    await bridge.replace('Notes', 'a.md', null, fromText('base'));
    const leaf = app.workspace.getLeaf(); await leaf.openFile(app.vault.items.get('Notes/a.md') as TFile);
    (leaf.view as MarkdownView).data = 'unsaved edit';
    await expect(bridge.replace('Notes', 'a.md', fromText('base'), fromText('remote'))).rejects.toThrow('changed');
    expect(await bridge.read('Notes', 'a.md')).toBe(fromText('base'));
  });

  it('flushes native editor changes before a manual sync', async () => {
    const app = new App(), bridge = new VaultBridge(app as never, () => 1024 * 1024);
    await bridge.ensureFolder('Notes'); await bridge.replace('Notes', 'a.md', null, fromText('base'));
    const leaf = app.workspace.getLeaf(); await leaf.openFile(app.vault.items.get('Notes/a.md') as TFile);
    (leaf.view as MarkdownView).data = 'saved by sync';
    await bridge.flushEditors();
    expect(await bridge.read('Notes', 'a.md')).toBe(fromText('saved by sync'));
  });

  it('moves remote deletions to local trash and keeps the removed bytes', async () => {
    const app = new App(), bridge = new VaultBridge(app as never, () => 1024 * 1024);
    await bridge.ensureFolder('Notes'); await bridge.replace('Notes', 'a.md', null, fromText('recover me'));
    await bridge.replace('Notes', 'a.md', fromText('recover me'), null);
    expect(await bridge.read('Notes', 'a.md')).toBeNull();
    expect(new Uint8Array(app.vault.trashed.get('Notes/a.md')!)).toEqual(decode(fromText('recover me')));
  });

  it('excludes hidden settings and sensitive files from local uploads', async () => {
    const app = new App(), bridge = new VaultBridge(app as never, () => 1024 * 1024);
    await bridge.ensureFolder('Notes');
    await app.vault.createBinary('Notes/.env', asBuffer(decode(fromText('secret'))));
    await app.vault.createBinary('Notes/credentials.txt', asBuffer(decode(fromText('secret'))));
    await bridge.replace('Notes', 'a.md', null, fromText('note'));
    expect(await bridge.scan('Notes')).toEqual({ 'a.md': fromText('note') });
  });

  it('blocks hidden and custom configuration roots', () => {
    const app = new App(), bridge = new VaultBridge(app as never, () => 1024 * 1024);
    expect(() => bridge.validateRoot('.obsidian/plugins')).toThrow();
    app.vault.configDir = 'Config';
    expect(() => bridge.validateRoot('Config')).toThrow();
    expect(() => bridge.validateRoot('config/notes')).toThrow();
    expect(() => bridge.validateRoot('Config/../Notes')).toThrow();
  });

  it('does not save editors outside the selected workspace', async () => {
    const app = new App(), bridge = new VaultBridge(app as never, () => 1024 * 1024);
    await bridge.ensureFolder('Notes'); await bridge.ensureFolder('Personal');
    await bridge.replace('Notes', 'a.md', null, fromText('a'));
    await bridge.replace('Personal', 'b.md', null, fromText('b'));
    const leaf = app.workspace.getLeaf(); await leaf.openFile(app.vault.items.get('Personal/b.md') as TFile);
    (leaf.view as MarkdownView).data = 'unsaved personal note';
    await bridge.flushEditors('Notes');
    expect(await bridge.read('Personal', 'b.md')).toBe(fromText('b'));
  });

  it('rejects invalid UTF-8 before creating a new Markdown file', async () => {
    const app = new App(), bridge = new VaultBridge(app as never, () => 1024 * 1024);
    await bridge.ensureFolder('Notes');
    await expect(bridge.replace('Notes', 'a.md', null, btoa('\xff'))).rejects.toThrow('UTF-8');
    expect(await bridge.read('Notes', 'a.md')).toBeNull();
  });

  it('captures the whole vault while excluding original settings, sensitive files, and previous snapshots', async () => {
    const app = new App(), bridge = new VaultBridge(app as never, () => 1024 * 1024);
    await bridge.ensureFolder('Notes'); await bridge.ensureFolder('Other');
    await bridge.replace('Notes', 'a.md', null, fromText('A'));
    await bridge.replace('Other', 'b.md', null, fromText('B'));
    await app.vault.createFolder('.obsidian'); await app.vault.createBinary('.obsidian/app.json', asBuffer(decode(fromText('private settings'))));
    await app.vault.createFolder('Obsidian-Vaults'); await app.vault.createBinary('Obsidian-Vaults/old.md', asBuffer(decode(fromText('old backup'))));
    await app.vault.createBinary('credentials.txt', asBuffer(decode(fromText('credential fixture'))));
    const capture = await bridge.captureVault();
    expect(Object.keys(capture.files).sort()).toEqual(['Notes/a.md', 'Other/b.md']);
    expect(capture.excluded).toBe(3);
  });

  it('uses native metadata to resolve aliases and ignores wiki-link examples in code', async () => {
    const app = new App(), bridge = new VaultBridge(app as never, () => 1024 * 1024);
    await bridge.ensureFolder('Notes');
    const text = '```md\n[[b]]\n```\n[[b|Alias]]';
    await bridge.replace('Notes', 'a.md', null, fromText(text)); await bridge.replace('Notes', 'b.md', null, fromText('B'));
    const start = text.indexOf('[[b|Alias]]');
    vi.spyOn(app.metadataCache, 'getFileCache').mockImplementation(file => file.path.endsWith('a.md') ? {
      links: [{ link: 'b', original: '[[b|Alias]]', displayText: 'Alias', position: { start: { line: 3, col: 0, offset: start }, end: { line: 3, col: 11, offset: start + 11 } } }]
    } : {});
    const capture = await bridge.captureVault();
    expect(capture.links).toHaveLength(1);
    expect(capture.links[0]).toMatchObject({ source: 'Notes/a.md', target: 'Notes/b.md', label: 'Alias' });
  });

  it('fails conservatively if the native index is missing or has stale positions', async () => {
    const app = new App(), bridge = new VaultBridge(app as never, () => 1024 * 1024);
    await bridge.ensureFolder('Notes'); await bridge.replace('Notes', 'a.md', null, fromText('[[b]]'));
    vi.spyOn(app.metadataCache, 'getFileCache').mockReturnValue(null);
    await expect(bridge.captureVault()).rejects.toThrow('indexing');
    vi.mocked(app.metadataCache.getFileCache).mockReturnValue({ links: [{ link: 'b', original: '[[old]]', position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 5, offset: 5 } } }] });
    await expect(bridge.captureVault()).rejects.toThrow('index');
  });

  it('excludes a custom non-hidden configuration directory and rejects edits during capture', async () => {
    const app = new App(), bridge = new VaultBridge(app as never, () => 1024 * 1024);
    await bridge.ensureFolder('Notes'); await bridge.replace('Notes', 'a.md', null, fromText('A'));
    app.vault.configDir = 'Config'; await app.vault.createFolder('Config'); await app.vault.createBinary('Config/history.md', asBuffer(decode(fromText('private'))));
    expect(Object.keys((await bridge.captureVault()).files)).toEqual(['Notes/a.md']);
    const read = app.vault.readBinary.bind(app.vault);
    vi.spyOn(app.vault, 'readBinary').mockImplementation(async file => { const result = await read(file); file.stat.mtime++; return result; });
    await expect(bridge.captureVault()).rejects.toThrow('changed');
  });
});
