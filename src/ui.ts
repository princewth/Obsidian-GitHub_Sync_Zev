import { App, ButtonComponent, ItemView, Modal, PluginSettingTab, Setting, TFile, TFolder, WorkspaceLeaf } from 'obsidian';
import type GitHubSyncZev from './main';
import { blobSha, decode, fromText, toText } from './bytes';
import { diagnostics } from './privacy';
import { isText, join, parseRepoURL, resolveTreeURL, safePath, supported, validateBranch } from './paths';
import { Conflict, Connection, Content, MountState, RemoteSnapshot, UserError } from './types';
import { VaultExportModal } from './export-ui';

export const VIEW_TYPE = 'github-sync-zev-explorer';

function action(parent: HTMLElement, label: string, callback: () => void, primary = false): ButtonComponent {
  const button = new ButtonComponent(parent).setButtonText(label).onClick(callback);
  if (primary) button.setCta();
  return button;
}

function readable(content: Content): string {
  if (content === null) return '[File deleted]';
  try { return toText(content); } catch { return `[Binary file: ${decode(content).length} bytes]`; }
}

function errorText(error: unknown): string {
  return error instanceof UserError ? error.message : 'The operation could not finish. Retry without changing your local files.';
}

export class ConnectModal extends Modal {
  private url = '';
  private owner = '';
  private repo = '';
  private branch = '';
  private branches: string[] = [];
  private remotePath = '';
  private localPath = '';
  private access: Connection['access'] = 'read-write';
  private preview: RemoteSnapshot | null = null;
  private localCount = 0;
  private differentCount = 0;
  private busy = false;
  private message = '';
  private autoUpload = false;
  private readonly connectionId = crypto.randomUUID();

  constructor(private readonly plugin: GitHubSyncZev) { super(plugin.app); }
  onOpen(): void { this.modalEl.addClass('gsz-modal'); this.render(); }
  onClose(): void { this.contentEl.empty(); }

  private draft(): Connection {
    return {
      id: this.connectionId, owner: this.owner, repo: this.repo, branch: this.branch,
      remotePath: safePath(this.remotePath, true), localPath: safePath(this.localPath),
      access: this.access, secretId: this.plugin.secretId, autoUpload: this.autoUpload, paused: false
    };
  }

  private async perform(task: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.message = ''; this.render();
    try { await task(); } catch (error) { this.message = errorText(error); }
    finally { this.busy = false; this.render(); }
  }

  private async load(): Promise<void> {
    const parsed = parseRepoURL(this.url);
    const info = await this.plugin.client.repoInfo(parsed.owner, parsed.repo, this.plugin.secretId);
    const branches = await this.plugin.client.branches(parsed.owner, parsed.repo, this.plugin.secretId);
    const resolved = resolveTreeURL(parsed.treeTail, branches, info.default_branch);
    this.owner = parsed.owner; this.repo = parsed.repo;
    this.branches = branches;
    this.branch = resolved.branch;
    this.remotePath = resolved.remotePath;
    if (!this.localPath) this.localPath = `GitHub/${this.repo}${this.remotePath ? `/${this.remotePath}` : ''}`;
    this.preview = null;
  }

  private async previewConnection(): Promise<void> {
    validateBranch(this.branch);
    const connection = this.draft();
    this.plugin.validateConnection(connection);
    const preview = await this.plugin.client.snapshot(connection);
    const local = await this.plugin.bridge.exists(connection.localPath) ? await this.plugin.bridge.scan(connection.localPath) : {};
    this.localCount = Object.keys(local).length;
    this.differentCount = 0;
    for (const [path, content] of Object.entries(local)) {
      if (preview.files[path] && await blobSha(content) !== preview.files[path].sha) this.differentCount++;
    }
    this.preview = preview;
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.createEl('h2', { text: 'Open a GitHub folder' });
    root.createEl('p', { text: 'Connect a repository folder to this vault. Markdown opens in the native editor; selected notes and supported attachments are kept locally for offline use.', cls: 'gsz-muted' });
    new Setting(root).setName('GitHub sign-in').setDesc(this.plugin.app.secretStorage.getSecret(this.plugin.secretId) ? 'Token stored in Obsidian SecretStorage.' : 'Private repositories and uploads require a token. Use Contents: Read and write for saving notes.').addButton(button => button.setButtonText('Set GitHub token').onClick(() => new TokenModal(this.plugin, () => this.render()).open()));
    new Setting(root).setName('Repository or folder URL').setDesc('HTTPS github.com URL. Credentials do not belong in the URL.').addText(text => text
      .setPlaceholder('https://github.com/example/notes/tree/main/docs')
      .setValue(this.url).setDisabled(this.busy)
      .onChange(value => {
        if (/^(?:github_pat_|gh[pousr]_)/.test(value.trim())) {
          text.setValue(''); this.url = ''; this.preview = null;
          this.message = 'That is a token. Use Set GitHub token above; this field needs your repository URL.';
          this.render(); return;
        }
        this.url = value; this.owner = ''; this.repo = ''; this.preview = null;
      }));
    action(root, this.busy ? 'Working…' : 'Load repository', () => void this.perform(() => this.load())).setDisabled(this.busy);
    if (!this.plugin.app.secretStorage.getSecret(this.plugin.secretId)) {
      root.createEl('p', { text: 'Private repositories require a token. Add a fine-grained token in this plugin’s settings, then load the repository again.', cls: 'gsz-muted' });
    }
    if (this.owner && this.repo) {
      root.createEl('h3', { text: `${this.owner}/${this.repo}` });
      new Setting(root).setName('Branch').addDropdown(dropdown => {
        for (const branch of this.branches) dropdown.addOption(branch, branch);
        dropdown.setValue(this.branch).setDisabled(this.busy).onChange(value => { this.branch = value; this.preview = null; this.render(); });
      });
      new Setting(root).setName('Remote folder').setDesc('Leave empty to connect the repository root. Hidden folders are excluded.').addText(text => text
        .setValue(this.remotePath).setDisabled(this.busy).onChange(value => { this.remotePath = value.trim(); this.preview = null; }));
      new Setting(root).setName('Local folder in this vault').setDesc('Choose a new folder, or connect an existing folder. Connected folders cannot overlap.').addText(text => text
        .setValue(this.localPath).setDisabled(this.busy).onChange(value => { this.localPath = value.trim(); this.preview = null; }));
      new Setting(root).setName('Access').addDropdown(dropdown => dropdown
        .addOption('read-write', 'Read and write').addOption('read-only', 'Read-only')
        .setValue(this.access).setDisabled(this.busy).onChange(value => { this.access = value as Connection['access']; this.render(); }));
      new Setting(root).setName('Upload changes automatically').setDesc('Off by default. Turn on after reviewing your files. Remote updates still download automatically.').addToggle(toggle => toggle
        .setValue(this.autoUpload).setDisabled(this.busy || this.access === 'read-only').onChange(value => { this.autoUpload = value; }));
      const controls = root.createDiv({ cls: 'gsz-actions' });
      action(controls, 'Preview connection', () => void this.perform(() => this.previewConnection())).setDisabled(this.busy);
      if (this.preview) {
        const preview = this.preview;
        root.createEl('p', { text: `${Object.keys(preview.files).length} supported remote files · ${this.localCount} local files · ${this.differentCount} matching paths with different contents.` });
        root.createEl('p', { text: 'Connecting downloads remote files. Different contents at the same path need conflict review. Local-only files are kept; nothing uploads during the first download.', cls: 'gsz-muted' });
        const list = root.createDiv({ cls: 'gsz-preview-list' });
        for (const path of Object.keys(preview.files).sort().slice(0, 100)) {
          const row = list.createDiv({ cls: 'gsz-file-row' });
          const button = action(row, path, () => {
            const file = preview.files[path]!;
            this.plugin.run(async () => {
              const content = await this.plugin.client.read(this.draft(), file.sha);
              new RemotePreviewModal(this.app, path, content).open();
            });
          });
          button.buttonEl.addClass('gsz-file-button');
        }
        if (Object.keys(preview.files).length > 100) list.createEl('p', { text: 'Showing the first 100 files. All supported files in this folder will download.' });
        action(controls, 'Connect and download', () => void this.perform(async () => {
          if (!this.preview) throw new UserError('Preview the current connection before continuing.');
          await this.plugin.connect(this.draft());
          this.close();
        }), true).setDisabled(this.busy);
      }
    }
    if (this.message) root.createEl('p', { text: this.message, cls: 'gsz-error' });
  }
}

class TokenModal extends Modal {
  private value = '';
  private input: HTMLInputElement | null = null;
  constructor(private readonly plugin: GitHubSyncZev, private readonly done: () => void) { super(plugin.app); }
  onOpen(): void {
    this.modalEl.addClass('gsz-modal');
    this.contentEl.createEl('h2', { text: 'Set GitHub token' });
    this.contentEl.createEl('p', { text: 'Create a fine-grained token for your chosen repository. Set Contents to Read and write; Metadata stays Read-only. Store the token here, then paste the repository URL in the connection dialog.' });
    new Setting(this.contentEl).setName('GitHub token').addText(text => {
      text.inputEl.type = 'password'; text.inputEl.autocomplete = 'off'; text.inputEl.spellcheck = false;
      text.setPlaceholder('Paste token here').onChange(value => { this.value = value; });
      this.input = text.inputEl;
    });
    action(this.contentEl, 'Store token', () => this.plugin.run(async () => {
      this.plugin.storeToken(this.value);
      this.close(); this.done();
    }), true);
  }
  onClose(): void { this.value = ''; if (this.input) this.input.value = ''; this.input = null; this.contentEl.empty(); }
}

class RemotePreviewModal extends Modal {
  constructor(app: App, private readonly path: string, private readonly content: string) { super(app); }
  onOpen(): void {
    this.modalEl.addClass('gsz-modal');
    this.contentEl.createEl('h2', { text: this.path });
    this.contentEl.createEl('p', { text: 'Remote preview · connect this folder to edit in Obsidian.' });
    this.contentEl.createEl('pre', { text: isText(this.path) ? readable(this.content) : `Attachment · ${decode(this.content).length} bytes`, cls: 'gsz-preview-content' });
  }
  onClose(): void { this.contentEl.empty(); }
}

export class ExplorerView extends ItemView {
  private readonly expanded = new Set<string>();
  constructor(leaf: WorkspaceLeaf, private readonly plugin: GitHubSyncZev) { super(leaf); }
  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return 'GitHub workspaces'; }
  getIcon(): string { return 'github'; }
  async onOpen(): Promise<void> { this.contentEl.addClass('gsz-explorer'); this.render(); }
  async onClose(): Promise<void> { this.contentEl.empty(); }

  render(): void {
    const root = this.contentEl;
    root.empty();
    if (!this.plugin.engine) return;
    const header = root.createDiv({ cls: 'gsz-console-header' });
    header.createDiv({ text: 'ZEV // ORBITAL SYNC', cls: 'gsz-eyebrow' });
    const title = header.createDiv({ cls: 'gsz-console-title' });
    title.createEl('h3', { text: 'GitHub workspaces' });
    title.createDiv({ cls: 'gsz-orbit', attr: { 'aria-hidden': 'true' } });
    const online = navigator.onLine !== false;
    header.createDiv({ text: online ? 'SYSTEM ONLINE' : 'OFFLINE · LOCAL MODE', cls: `gsz-system-chip${online ? '' : ' gsz-system-offline'}` });
    const mounts = Object.values(this.plugin.store.data.mounts);
    const stats = root.createDiv({ cls: 'gsz-console-stats' });
    const metrics: Array<[string, number]> = [
      ['WORKSPACES', mounts.length],
      ['PENDING', mounts.reduce((sum, mount) => sum + mount.pending, 0)],
      ['CONFLICTS', mounts.reduce((sum, mount) => sum + Object.keys(mount.conflicts).length, 0)]
    ];
    for (const [label, count] of metrics) {
      const metric = stats.createDiv({ cls: 'gsz-console-stat' });
      metric.createDiv({ text: String(count).padStart(2, '0'), cls: 'gsz-console-value' });
      metric.createDiv({ text: label, cls: 'gsz-console-label' });
    }
    const toolbar = root.createDiv({ cls: 'gsz-actions' });
    action(toolbar, 'Connect folder', () => new ConnectModal(this.plugin).open(), true);
    action(toolbar, 'Sync all', () => this.plugin.run(() => this.plugin.syncAll(true))).setDisabled(this.plugin.exporter?.busy ?? false);
    const archive = root.createDiv({ cls: 'gsz-archive-card' });
    archive.createDiv({ text: 'VAULT ARCHIVE', cls: 'gsz-eyebrow' });
    archive.createEl('h4', { text: 'Keep your knowledge connected' });
    archive.createEl('p', { text: 'Save an independent vault with original wiki-links, plus a GitHub copy with outgoing links and backlinks.', cls: 'gsz-muted' });
    action(archive, this.plugin.exporter?.busy ? 'Saving vault…' : 'Save full vault', () => new VaultExportModal(this.plugin).open()).setDisabled(this.plugin.exporter?.busy ?? false);
    if (!mounts.length) {
      const empty = root.createDiv({ cls: 'gsz-empty-state' });
      empty.createDiv({ text: 'AWAITING CONNECTION', cls: 'gsz-eyebrow' });
      empty.createEl('p', { text: 'Connect a GitHub folder to start editing notes, working offline, and sending changes from this console.', cls: 'gsz-muted' });
      return;
    }
    for (const [index, mount] of mounts.entries()) this.mount(root, mount, index);
  }

  private mount(parent: HTMLElement, mount: MountState, index: number): void {
    const connection = mount.connection;
    const status = this.plugin.engine.status(connection.id);
    const card = parent.createDiv({ cls: `gsz-workspace gsz-workspace-${status.phase}` });
    const line = card.createDiv({ cls: 'gsz-workspace-topline' });
    line.createDiv({ text: `REMOTE ${String(index + 1).padStart(2, '0')}`, cls: 'gsz-eyebrow' });
    line.createDiv({ text: status.phase.toUpperCase(), cls: `gsz-phase gsz-phase-${status.phase}` });
    card.createEl('h4', { text: connection.localPath });
    card.createDiv({ text: `${connection.owner}/${connection.repo}`, cls: 'gsz-remote-label' });
    const route = card.createDiv({ cls: 'gsz-route' });
    route.createSpan({ text: connection.branch, cls: 'gsz-branch-chip' });
    route.createSpan({ text: `/${connection.remotePath}`, cls: 'gsz-muted' });
    card.createDiv({ text: status.message, cls: `gsz-state gsz-state-${status.phase}` });
    card.createDiv({ cls: 'gsz-signal-line', attr: { 'aria-hidden': 'true' } });
    if (mount.lastSync) card.createDiv({ text: `Last completed: ${new Date(mount.lastSync).toLocaleString()}`, cls: 'gsz-muted' });
    const buttons = card.createDiv({ cls: 'gsz-actions' });
    action(buttons, 'Sync', () => this.plugin.run(() => this.plugin.syncOne(connection.id, true))).setDisabled(this.plugin.engine.isRunning(connection.id) || connection.paused || (this.plugin.exporter?.busy ?? false));
    action(buttons, 'New note', () => new NewNoteModal(this.plugin, connection).open());
    if (mount.deletionReview && connection.access === 'read-write') action(buttons, 'Review deletions', () => new DeletionModal(this.plugin, mount).open());
    for (const [path, conflict] of Object.entries(mount.conflicts)) {
      const row = card.createDiv({ cls: 'gsz-conflict-row' });
      action(row, `Resolve: ${path}`, () => new ConflictModal(this.plugin, connection.id, structuredClone(conflict)).open());
    }
    const folder = this.app.vault.getAbstractFileByPath(connection.localPath);
    if (folder instanceof TFolder) this.folder(card, folder, connection.localPath, true);
  }

  private folder(parent: HTMLElement, folder: TFolder, root: string, top = false): void {
    const container = top ? parent.createDiv({ cls: 'gsz-tree' }) : parent.createEl('details', { cls: 'gsz-tree-folder' });
    let loaded = false;
    const populate = (): void => {
      if (loaded) return;
      loaded = true;
      const children = folder.children.filter(item => item instanceof TFolder ? this.visibleFolder(item, root) : supported(item.path.slice(root.length + 1)))
        .sort((a, b) => Number(b instanceof TFolder) - Number(a instanceof TFolder) || a.name.localeCompare(b.name));
      for (const item of children.slice(0, 300)) {
        if (item instanceof TFolder) this.folder(container, item, root);
        else if (item instanceof TFile) {
          const row = container.createDiv({ cls: 'gsz-file-row' });
          action(row, item.name, () => this.plugin.run(() => this.app.workspace.getLeaf(false).openFile(item))).buttonEl.addClass('gsz-file-button');
        }
      }
      if (children.length > 300) container.createEl('p', { text: 'Use Obsidian’s file explorer for the remaining files.', cls: 'gsz-muted' });
      if (!children.length && top) container.createDiv({ text: 'Files appear here as they download.', cls: 'gsz-muted' });
    };
    if (container instanceof HTMLDetailsElement) {
      container.createEl('summary', { text: folder.name });
      container.open = this.expanded.has(folder.path);
      if (container.open) populate();
      container.addEventListener('toggle', () => {
        if (container.open) { this.expanded.add(folder.path); populate(); }
        else this.expanded.delete(folder.path);
      });
    } else populate();
  }

  private visibleFolder(folder: TFolder, root: string): boolean {
    try { safePath(folder.path.slice(root.length + 1)); return true; } catch { return false; }
  }
}

class NewNoteModal extends Modal {
  constructor(private readonly plugin: GitHubSyncZev, private readonly connection: Connection) { super(plugin.app); }
  onOpen(): void {
    this.contentEl.createEl('h2', { text: 'New connected note' });
    let path = '';
    new Setting(this.contentEl).setName('Path inside this workspace').addText(text => text.setPlaceholder('projects/idea.md').onChange(value => { path = value.trim(); }));
    action(this.contentEl, 'Create note', () => this.plugin.run(async () => {
      if (!/\.(md|markdown)$/i.test(path)) path += '.md';
      safePath(path);
      await this.plugin.bridge.replace(this.connection.localPath, path, null, fromText(''));
      const file = this.app.vault.getAbstractFileByPath(join(this.connection.localPath, path));
      if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
      this.close();
      this.plugin.emit();
    }), true);
  }
  onClose(): void { this.contentEl.empty(); }
}

class DeletionModal extends Modal {
  private readonly fingerprint: string;
  private readonly paths: string[];
  constructor(private readonly plugin: GitHubSyncZev, private readonly mount: MountState) {
    super(plugin.app);
    this.fingerprint = mount.deletionReview!.fingerprint;
    this.paths = [...mount.deletionReview!.paths];
  }
  onOpen(): void {
    this.contentEl.createEl('h2', { text: 'Review remote deletions' });
    this.contentEl.createEl('p', { text: 'The following files are missing locally and will be deleted from the connected GitHub branch. Other pending edits are included in the same commit. Git history retains previous versions.' });
    const list = this.contentEl.createEl('ul');
    for (const path of this.paths) list.createEl('li', { text: path });
    action(this.contentEl, 'Delete listed files and sync', () => this.plugin.run(async () => {
      await this.plugin.syncOne(this.mount.connection.id, true, this.fingerprint);
      this.close();
    }), true);
  }
  onClose(): void { this.contentEl.empty(); }
}

class ConflictModal extends Modal {
  constructor(private readonly plugin: GitHubSyncZev, private readonly id: string, private readonly conflict: Conflict) { super(plugin.app); }
  onOpen(): void {
    this.modalEl.addClass('gsz-modal', 'gsz-conflict-modal');
    const { conflict, contentEl: root } = this;
    root.createEl('h2', { text: `Resolve ${conflict.path}` });
    root.createEl('p', { text: 'Uploads for this workspace wait until every conflict is resolved. Your chosen result is saved locally first.' });
    const versions = root.createDiv({ cls: 'gsz-versions' });
    for (const [title, value] of [['Common version', conflict.base], ['Local', conflict.local], ['GitHub', conflict.remote]] as const) {
      const column = versions.createDiv();
      column.createEl('h4', { text: title });
      const text = column.createEl('textarea', { cls: 'gsz-version' });
      text.readOnly = true;
      text.setAttribute('aria-label', title);
      text.value = conflict.kind === 'binary' && value !== null ? `[Binary file: ${decode(value).length} bytes]` : readable(value);
    }
    const controls = root.createDiv({ cls: 'gsz-actions' });
    const resolve = (content: Content): void => this.plugin.run(async () => {
      await this.plugin.bridge.flushEditors(this.plugin.store.data.mounts[this.id]?.connection.localPath);
      await this.plugin.engine.resolve(this.id, conflict.path, content, conflict);
      this.close();
    });
    action(controls, conflict.local === null ? 'Keep local deletion' : 'Keep local version', () => resolve(conflict.local));
    action(controls, conflict.remote === null ? 'Accept GitHub deletion' : 'Use GitHub version', () => resolve(conflict.remote));
    if (conflict.kind !== 'binary') {
      root.createEl('h4', { text: 'Merged result' });
      const editor = root.createEl('textarea', { cls: 'gsz-merge-editor' });
      editor.setAttribute('aria-label', 'Merged result');
      editor.value = conflict.local === null ? readable(conflict.remote) : readable(conflict.local);
      action(root, 'Save merged result', () => resolve(fromText(editor.value)), true);
    }
  }
  onClose(): void { this.contentEl.empty(); }
}

export class DiagnosticModal extends Modal {
  constructor(private readonly plugin: GitHubSyncZev) { super(plugin.app); }
  onOpen(): void {
    this.contentEl.createEl('h2', { text: 'Safe diagnostics' });
    this.contentEl.createEl('p', { text: 'This report includes only version numbers and counts. It excludes tokens, account names, repositories, paths, commit IDs, note contents, and timestamps.' });
    const text = this.contentEl.createEl('textarea', { cls: 'gsz-diagnostics' });
    text.value = diagnostics(this.plugin.store.data, this.plugin.manifest.version);
    text.readOnly = true;
    text.setAttribute('aria-label', 'Safe diagnostic report');
    action(this.contentEl, 'Select report', () => { text.focus(); text.select(); });
  }
  onClose(): void { this.contentEl.empty(); }
}

export class PluginSettings extends PluginSettingTab {
  constructor(private readonly plugin: GitHubSyncZev) { super(plugin.app, plugin); }

  display(): void {
    const root = this.containerEl;
    root.empty();
    new Setting(root).setName('Connection').setHeading();
    root.createEl('p', { text: 'Open GitHub folders in your vault. Connection state and conflict history stay in this device’s IndexedDB. This plugin does not write a data.json settings file.', cls: 'gsz-muted' });
    this.tokenSetting(root);
    new Setting(root).setName('Remote refresh interval').setDesc('Seconds, from 30 to 3600. Refresh runs while Obsidian is visible. Mobile background execution is controlled by the operating system.').addText(text => text
      .setValue(String(this.plugin.store.data.settings.pollSeconds)).onChange(value => this.settingNumber('pollSeconds', value, 30, 3600)));
    new Setting(root).setName('Automatic upload delay').setDesc('Seconds after edits settle, from 5 to 300. Enabled separately for each connection.').addText(text => text
      .setValue(String(this.plugin.store.data.settings.uploadDelaySeconds)).onChange(value => this.settingNumber('uploadDelaySeconds', value, 5, 300)));
    new Setting(root).setName('Maximum file size').setDesc('MB per file, from 1 to 25. Files above this limit stop sync; they are never mistaken for deletions.').addText(text => text
      .setValue(String(this.plugin.store.data.settings.maxFileMB)).onChange(value => this.settingNumber('maxFileMB', value, 1, 25)));
    new Setting(root).setName('Connected folders').setHeading();
    action(root, 'Connect folder', () => new ConnectModal(this.plugin).open(), true);
    for (const mount of Object.values(this.plugin.store.data.mounts)) this.connection(root, mount);
    new Setting(root).setName('Diagnostics').setDesc('Share a report containing only version numbers and counts.').addButton(button => button.setButtonText('Show safe report').onClick(() => new DiagnosticModal(this.plugin).open()));
  }

  private tokenSetting(root: HTMLElement): void {
    let token = '';
    let field: HTMLInputElement | null = null;
    const stored = Boolean(this.app.secretStorage.getSecret(this.plugin.secretId));
    const setting = new Setting(root).setName('GitHub token').setDesc(`${stored ? 'A token is stored.' : 'No token is stored.'} Use a fine-grained token limited to selected repositories, with Contents read/write (or read for read-only use). The token stays in Obsidian SecretStorage.`);
    setting.addText(text => {
      text.inputEl.type = 'password';
      text.inputEl.autocomplete = 'off';
      text.inputEl.spellcheck = false;
      text.setPlaceholder('Paste a new token').onChange(value => { token = value.trim(); });
      field = text.inputEl;
    });
    setting.addButton(button => button.setButtonText('Store token').onClick(() => {
      this.plugin.run(async () => {
        this.plugin.storeToken(token);
        token = '';
        if (field) field.value = '';
        this.display();
      });
    }));
    if (stored) setting.addButton(button => button.setButtonText('Remove token').onClick(() => {
      this.app.secretStorage.setSecret(this.plugin.secretId, '');
      this.display();
    }));
  }

  private settingNumber(key: 'pollSeconds' | 'uploadDelaySeconds' | 'maxFileMB', value: string, min: number, max: number): void {
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max) return;
    this.plugin.store.data.settings[key] = number;
    this.plugin.run(() => this.plugin.store.save());
  }

  private updateConnection(mount: MountState, change: Partial<Pick<Connection, 'autoUpload' | 'paused' | 'access'>>): void {
    this.plugin.run(async () => {
      if (this.plugin.engine.isRunning(mount.connection.id)) { this.display(); throw new UserError('Wait for the current sync to finish before changing this connection.'); }
      Object.assign(mount.connection, change);
      await this.plugin.store.save();
      this.plugin.emit();
      this.display();
    });
  }

  private connection(root: HTMLElement, mount: MountState): void {
    const connection = mount.connection;
    const card = root.createDiv({ cls: 'gsz-settings-workspace' });
    new Setting(card).setName(connection.localPath).setHeading();
    card.createEl('p', { text: `${connection.owner}/${connection.repo} · ${connection.branch} · /${connection.remotePath}` });
    new Setting(card).setName('Paused').setDesc('Keep local files and stop network sync for this connection.').addToggle(toggle => toggle.setValue(connection.paused).onChange(value => this.updateConnection(mount, { paused: value })));
    new Setting(card).setName('Access').addDropdown(dropdown => dropdown.addOption('read-write', 'Read and write').addOption('read-only', 'Read-only').setValue(connection.access).onChange(value => this.updateConnection(mount, { access: value as Connection['access'] })));
    new Setting(card).setName('Upload automatically').setDesc('Commit local changes after the upload delay. Deletions still require review.').addToggle(toggle => toggle.setDisabled(connection.access === 'read-only').setValue(connection.autoUpload).onChange(value => this.updateConnection(mount, { autoUpload: value })));
    new Setting(card).setName('Disconnect').setDesc('Keep all local and GitHub files. Device-only baselines and unresolved conflict snapshots for this connection are removed.').addButton(button => button.setButtonText('Disconnect…').onClick(() => new DisconnectModal(this.plugin, mount, () => this.display()).open()));
  }
}

class DisconnectModal extends Modal {
  constructor(private readonly plugin: GitHubSyncZev, private readonly mount: MountState, private readonly done: () => void) { super(plugin.app); }
  onOpen(): void {
    this.contentEl.createEl('h2', { text: 'Disconnect this folder?' });
    this.contentEl.createEl('p', { text: 'All local and GitHub files stay in place. The device-only synchronization baseline and conflict snapshots for this connection will be removed. Resolve any conflicts you want to keep first.' });
    action(this.contentEl, 'Disconnect and keep files', () => this.plugin.run(async () => {
      await this.plugin.engine.disconnect(this.mount.connection.id);
      this.done(); this.close();
    }));
  }
  onClose(): void { this.contentEl.empty(); }
}
