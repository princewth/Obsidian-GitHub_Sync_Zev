// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { App, installDOM, MarkdownView, Notice, TFile } from './obsidian.mock';
import GitHubSyncZev from '../src/main';
import { ConnectModal, PluginSettings, VIEW_TYPE } from '../src/ui';
import { blobSha, fromText } from '../src/bytes';
import { diagnostics } from '../src/privacy';
import { connection } from './helpers';
import { VaultExportModal } from '../src/export-ui';

const plugins: GitHubSyncZev[] = [];

beforeEach(() => {
  installDOM();
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  Notice.messages = [];
});

afterEach(async () => {
  for (const plugin of plugins.splice(0)) {
    plugin.onunload();
    for (const cleanup of (plugin as unknown as { cleanup: Array<() => void> }).cleanup) cleanup();
    await plugin.store?.flush().catch(() => undefined);
  }
  document.body.replaceChildren();
});

async function loadPlugin() {
  const app = new App();
  const plugin = new GitHubSyncZev(app as never, { id: 'github-sync-zev', version: '1.0.0' } as never);
  plugins.push(plugin);
  await plugin.onload();
  return { app, plugin };
}

function click(root: HTMLElement, label: string): void {
  const button = [...root.querySelectorAll('button')].find(element => element.textContent === label);
  expect(button, `button ${label}`).toBeTruthy();
  expect(button!.disabled, `button ${label} enabled`).toBe(false);
  button!.click();
}

function fill(input: HTMLInputElement, value: string): void { input.value = value; input.dispatchEvent(new Event('input')); }

describe('Obsidian plugin UI and lifecycle integration', () => {
  it('registers commands and a workspace view without writing vault settings or making GitHub requests', async () => {
    const { app, plugin } = await loadPlugin();
    const mock = plugin as unknown as { commands: Array<{ id: string }>; saveData: ReturnType<typeof vi.fn> };
    expect(mock.commands.map(command => command.id)).toContain('connect-folder');
    expect(app.workspace.factories.has(VIEW_TYPE)).toBe(true);
    expect(mock.saveData).not.toHaveBeenCalled();
    expect(Notice.messages).toEqual([]);
    await plugin.openExplorer();
    expect(app.workspace.getLeavesOfType(VIEW_TYPE)).toHaveLength(1);
  });

  it('opens an existing GitHub folder, previews files, downloads, and opens a native Markdown tab', async () => {
    const { app, plugin } = await loadPlugin();
    const content = fromText('# Connected note\n'), sha = await blobSha(content);
    vi.spyOn(plugin.client, 'repoInfo').mockResolvedValue({ default_branch: 'trunk' });
    vi.spyOn(plugin.client, 'branches').mockResolvedValue(['trunk', 'feature/docs']);
    vi.spyOn(plugin.client, 'snapshot').mockResolvedValue({ head: 'a'.repeat(40), tree: 'b'.repeat(40), files: { 'a.md': { sha, size: 17, mode: '100644' } } });
    vi.spyOn(plugin.client, 'read').mockResolvedValue(content);
    const modal = new ConnectModal(plugin); modal.open();
    fill(modal.contentEl.querySelector('input')!, 'https://github.com/example/notes/tree/feature/docs/reference');
    click(modal.contentEl, 'Load repository');
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain('Preview connection'));
    const branch = modal.contentEl.querySelector('select')!;
    expect(branch.value).toBe('feature/docs');
    click(modal.contentEl, 'Preview connection');
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain('1 supported remote files'));
    click(modal.contentEl, 'Connect and download');
    await vi.waitFor(() => expect(app.vault.items.has('GitHub/notes/reference/a.md')).toBe(true));
    await vi.waitFor(() => expect(app.modals).not.toContain(modal));
    const mount = Object.values(plugin.store.data.mounts)[0]!;
    expect(mount.connection.branch).toBe('feature/docs');
    expect(mount.connection.remotePath).toBe('reference');
    expect(mount.connection.autoUpload).toBe(false);
    const view = app.workspace.getLeavesOfType(VIEW_TYPE)[0]!.view as unknown as { contentEl: HTMLElement };
    click(view.contentEl, 'a.md');
    await vi.waitFor(() => expect(app.workspace.getLeavesOfType('markdown')).toHaveLength(1));
    expect((app.workspace.getLeavesOfType('markdown')[0]!.view as MarkdownView).data).toBe('# Connected note\n');
  });

  it('stores a token only through SecretStorage, never in device state or diagnostics', async () => {
    const { app, plugin } = await loadPlugin();
    const settings = new PluginSettings(plugin); settings.display();
    const token = 'test-token-placeholder-only';
    const input = settings.containerEl.querySelector('input[type="password"]')! as HTMLInputElement;
    fill(input, token); click(settings.containerEl, 'Store token');
    await vi.waitFor(() => expect(app.secrets.get(plugin.secretId)).toBe(token));
    expect(JSON.stringify(plugin.store.data)).not.toContain(token);
    expect(diagnostics(plugin.store.data, '1.0.0')).not.toContain(token);
    expect((settings.containerEl.querySelector('input[type="password"]') as HTMLInputElement).value).toBe('');
    click(settings.containerEl, 'Remove token');
    expect(app.secrets.get(plugin.secretId)).toBe('');
  });

  it('rejects overlapping local or remote mounts before making any writes', async () => {
    const { plugin } = await loadPlugin();
    await plugin.engine.add(connection());
    expect(() => plugin.validateConnection(connection({ id: 'two', localPath: 'github/NOTES/nested', remotePath: 'other' }))).toThrow('overlap');
    expect(() => plugin.validateConnection(connection({ id: 'two', localPath: 'Other', remotePath: 'docs/nested' }))).toThrow('overlap');
  });

  it('saves native editor changes before a manual upload', async () => {
    const { app, plugin } = await loadPlugin();
    const base = fromText('base'), sha = await blobSha(base);
    vi.spyOn(plugin.client, 'snapshot').mockResolvedValue({ head: 'a'.repeat(40), tree: 'b'.repeat(40), files: { 'a.md': { sha, size: 4, mode: '100644' } } });
    vi.spyOn(plugin.client, 'read').mockResolvedValue(base);
    vi.spyOn(plugin.client, 'prepareCommit').mockResolvedValue('c'.repeat(40));
    vi.spyOn(plugin.client, 'publish').mockResolvedValue();
    await plugin.bridge.ensureFolder('GitHub/notes');
    await plugin.engine.add(connection());
    await plugin.syncOne('sample-workspace', false);
    const leaf = app.workspace.getLeaf();
    await leaf.openFile(app.vault.items.get('GitHub/notes/a.md') as TFile);
    (leaf.view as MarkdownView).data = 'edited in Obsidian';
    await plugin.syncOne('sample-workspace', true);
    expect(plugin.client.prepareCommit).toHaveBeenCalledWith(expect.anything(), expect.anything(), { 'a.md': fromText('edited in Obsidian') });
  });

  it('renders the sci-fi console with state counters and a full-vault archive entry', async () => {
    const { app, plugin } = await loadPlugin();
    await plugin.engine.add(connection());
    await plugin.bridge.ensureFolder('GitHub/notes/Projects');
    await plugin.bridge.replace('GitHub/notes', 'Welcome.md', null, fromText('Welcome'));
    await plugin.bridge.replace('GitHub/notes', 'Ideas.md', null, fromText('Ideas'));
    await plugin.bridge.replace('GitHub/notes', 'Projects/Orbit.md', null, fromText('Orbit'));
    plugin.store.data.mounts['sample-workspace']!.pending = 3;
    await plugin.openExplorer();
    const view = app.workspace.getLeavesOfType(VIEW_TYPE)[0]!.view as unknown as { contentEl: HTMLElement };
    expect(view.contentEl.querySelector('.gsz-console-header')?.textContent).toContain('ORBITAL SYNC');
    expect(view.contentEl.querySelectorAll('.gsz-console-value')[1]?.textContent).toBe('03');
    expect(view.contentEl.querySelector('.gsz-workspace-topline')?.textContent).toContain('REMOTE 01');
    expect(view.contentEl.querySelector('.gsz-phase')?.textContent).toBe('PENDING');
    if (process.env.GSZ_UI_PREVIEW) {
      const css = await readFile('styles.css', 'utf8');
      const base = `*{box-sizing:border-box}body{margin:0;padding:28px;background:#080d19;font:14px/1.5 system-ui;color:#dce7f6}h1{font-size:22px;margin:0 0 5px}body>p{color:#a4b7ca;margin:0 0 22px}.previews{display:flex;align-items:flex-start;gap:22px}.sample{width:340px;flex:none}.sample.narrow{width:250px}.sample>p{font:11px/1.4 monospace;letter-spacing:.1em;color:#a4b7ca}.frame{border:1px solid #28364b;border-radius:12px;overflow:hidden}button{font-family:inherit;border-radius:5px;padding:6px 9px;cursor:pointer}h3,h4,p{line-height:1.5}.theme-dark{--text-error:#ff8190;--text-warning:#f2cb6d;--text-muted:#a4b7ca;--background-modifier-border:#28364b;--background-modifier-hover:#16253b}.theme-light{--text-error:#b72745;--text-warning:#875500;--text-muted:#4b6578;--background-modifier-border:#c6d9e4;--background-modifier-hover:#e3f0f6}.frame{--font-monospace:ui-monospace,monospace;--font-smaller:12px;--radius-m:8px;--radius-s:5px}.gsz-explorer{min-height:820px}`;
      const html = view.contentEl.outerHTML;
      await writeFile(process.env.GSZ_UI_PREVIEW, `<!doctype html><html><head><meta charset="utf-8"><title>GitHub Sync - Zev 1.1 — simulated Obsidian UI</title><style>${base}\n${css}</style></head><body><h1>GitHub Sync - Zev / 1.1</h1><p>Actual plugin markup and styles · simulated Obsidian host · sample data</p><main class="previews"><section class="sample"><p>DARK / 340 PX</p><div class="frame theme-dark">${html}</div></section><section class="sample"><p>LIGHT / 340 PX</p><div class="frame theme-light">${html}</div></section><section class="sample narrow"><p>NARROW / 250 PX</p><div class="frame theme-dark">${html}</div></section></main></body></html>`);
    }
    click(view.contentEl, 'Save full vault');
    expect(app.modals.at(-1)?.contentEl.textContent).toContain('Save a standalone vault');
  });

  it('requires preview and explicit full-vault review before publishing files beyond the synced folder', async () => {
    const { plugin } = await loadPlugin();
    await plugin.engine.add(connection());
    await plugin.bridge.ensureFolder('Notes'); await plugin.bridge.ensureFolder('Personal');
    await plugin.bridge.replace('Notes', 'a.md', null, fromText('A'));
    await plugin.bridge.replace('Personal', 'b.md', null, fromText('B'));
    vi.spyOn(plugin.client, 'revision').mockResolvedValue({ head: 'a'.repeat(40), tree: 'b'.repeat(40) });
    vi.spyOn(plugin.client, 'prepareVaultExport').mockResolvedValue('c'.repeat(40));
    vi.spyOn(plugin.client, 'publish').mockResolvedValue();
    const modal = new VaultExportModal(plugin); modal.open();
    expect(modal.contentEl.textContent).not.toContain('Save vault to repository');
    click(modal.contentEl, 'Preview full vault');
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain('2 notes'));
    const save = [...modal.contentEl.querySelectorAll('button')].find(button => button.textContent === 'Save vault to repository')!;
    expect(save.disabled).toBe(true);
    expect(modal.contentEl.textContent).toContain('entire vault');
    const reviewed = modal.contentEl.querySelector('input[type="checkbox"]') as HTMLInputElement;
    reviewed.checked = true; reviewed.dispatchEvent(new Event('change'));
    click(modal.contentEl, 'Save vault to repository');
    await vi.waitFor(() => expect(Object.values(plugin.store.data.vaultExports ?? {})[0]?.status).toBe('published'));
    const plan = vi.mocked(plugin.client.prepareVaultExport).mock.calls[0]![2];
    expect(plan.sourcePaths).toEqual(['Notes/a.md', 'Personal/b.md']);
    expect(plan.files['vault/.obsidian/core-plugins.json']).toBeTruthy();
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain('Open snapshot on GitHub'));
  });

  it('clears a token pasted into the URL field and provides a masked token setup dialog', async () => {
    const { app, plugin } = await loadPlugin();
    const modal = new ConnectModal(plugin); modal.open();
    fill(modal.contentEl.querySelector('input')!, 'github_pat_placeholder-only-for-ui-test');
    expect(modal.contentEl.querySelector('input')!.value).toBe('');
    expect(modal.contentEl.textContent).toContain('That is a token');
    expect(modal.contentEl.textContent).not.toContain('github_pat_placeholder');
    click(modal.contentEl, 'Set GitHub token');
    const tokenModal = app.modals.at(-1)!;
    fill(tokenModal.contentEl.querySelector('input[type="password"]')!, 'test-token-placeholder-only');
    click(tokenModal.contentEl, 'Store token');
    await vi.waitFor(() => expect(app.secrets.get(plugin.secretId)).toBe('test-token-placeholder-only'));
    expect(modal.contentEl.textContent).toContain('Token stored');
    expect(JSON.stringify(plugin.store.data)).not.toContain('test-token-placeholder-only');
  });
});
