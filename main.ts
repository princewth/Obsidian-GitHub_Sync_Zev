import { Notice, Plugin, requestUrl, TAbstractFile } from 'obsidian';
import { GitHubClient } from './github';
import { DeviceStore } from './storage';
import { SyncEngine } from './sync';
import { VaultBridge } from './vault';
import { inFolder, safePath, supported } from './paths';
import { Connection, UserError } from './types';
import { ConnectModal, ExplorerView, PluginSettings, VIEW_TYPE, DiagnosticModal } from './ui';
import { VaultExportService } from './export-service';
import { VaultExportPlan } from './vault-export';
import { VaultExportModal } from './export-ui';

export default class GitHubSyncZev extends Plugin {
  store!: DeviceStore;
  client!: GitHubClient;
  engine!: SyncEngine;
  bridge!: VaultBridge;
  exporter!: VaultExportService;
  secretId = '';
  private ready = false;
  private readonly uploadTimers = new Map<string, number>();
  private lastPoll = 0;
  private statusEl: HTMLElement | null = null;
  private changedTimer: number | null = null;
  private syncAllRunning = false;

  async onload(): Promise<void> {
    try {
      let deviceKey: unknown = this.app.loadLocalStorage('github-sync-zev-device-key');
      if (typeof deviceKey !== 'string' || !/^[a-z0-9-]+$/.test(deviceKey)) {
        deviceKey = crypto.randomUUID();
        this.app.saveLocalStorage('github-sync-zev-device-key', deviceKey);
      }
      this.secretId = `github-sync-zev-${String(deviceKey)}`;
      this.store = new DeviceStore(String(deviceKey));
      await this.store.open();
      this.bridge = new VaultBridge(this.app, () => this.store.data.settings.maxFileMB * 1024 * 1024);
      this.client = new GitHubClient(async params => {
        const response = await requestUrl({ ...params, throw: false });
        let json: unknown;
        try { json = response.json; } catch { json = null; }
        return { status: response.status, headers: response.headers, json };
      }, id => this.app.secretStorage.getSecret(id), () => this.store.data.settings.maxFileMB * 1024 * 1024);
      this.engine = new SyncEngine(this.store, this.bridge, this.client, () => this.emit());
      this.exporter = new VaultExportService(this.store, this.client, () => this.emit());
      // Revalidate on every startup, including after changes to Obsidian's config directory.
      for (const mount of Object.values(this.store.data.mounts)) this.validateConnection(mount.connection, mount.connection.id);
      this.registerView(VIEW_TYPE, leaf => new ExplorerView(leaf, this));
      this.addRibbonIcon('github', 'Open GitHub workspace', () => this.run(() => this.openExplorer()));
      this.addCommand({ id: 'open-workspaces', name: 'Open workspace browser', callback: () => this.run(() => this.openExplorer()) });
      this.addCommand({ id: 'connect-folder', name: 'Open or connect a GitHub folder', callback: () => new ConnectModal(this).open() });
      this.addCommand({ id: 'sync-all', name: 'Sync all connected folders', callback: () => this.run(() => this.syncAll(true)) });
      this.addCommand({ id: 'refresh-all', name: 'Download remote updates', callback: () => this.run(() => this.syncAll(false)) });
      this.addCommand({ id: 'safe-diagnostics', name: 'Show private-data-free diagnostics', callback: () => new DiagnosticModal(this).open() });
      this.addCommand({ id: 'save-full-vault', name: 'Save standalone vault to GitHub', callback: () => new VaultExportModal(this).open() });
      this.addSettingTab(new PluginSettings(this));
      this.statusEl = this.addStatusBarItem();
      this.statusEl.addClass('gsz-statusbar');
      this.statusEl.addEventListener('click', () => this.run(() => this.openExplorer()));
      this.registerEvent(this.app.vault.on('modify', file => this.fileChanged(file)));
      this.registerEvent(this.app.vault.on('create', file => this.fileChanged(file)));
      this.registerEvent(this.app.vault.on('delete', file => this.fileChanged(file)));
      this.registerEvent(this.app.vault.on('rename', (file, oldPath) => { this.fileChanged(file); this.pathChanged(oldPath); }));
      this.registerDomEvent(window, 'online', () => { this.lastPoll = 0; this.emit(); this.backgroundSync(); });
      this.registerDomEvent(window, 'offline', () => this.emit());
      this.registerDomEvent(document, 'visibilitychange', () => {
        if (document.visibilityState === 'visible') { this.lastPoll = 0; this.backgroundSync(); }
      });
      this.registerInterval(window.setInterval(() => this.backgroundSync(), 5000));
      this.ready = true;
      this.app.workspace.onLayoutReady(() => {
        if (!this.ready) return;
        this.emit();
        this.backgroundSync();
      });
    } catch (error) {
      this.ready = false;
      this.store?.close();
      this.showError(error);
    }
  }

  onunload(): void {
    this.ready = false;
    this.engine?.stop();
    this.exporter?.stop();
    for (const timer of this.uploadTimers.values()) window.clearTimeout(timer);
    this.uploadTimers.clear();
    if (this.changedTimer !== null) window.clearTimeout(this.changedTimer);
    // Native Markdown tabs stay open. IndexedDB transactions already queued are allowed to finish.
    if (this.store) void this.store.flush().catch(() => undefined).finally(() => this.store.close());
  }

  run(task: () => Promise<unknown>): void { void task().catch(error => this.showError(error)); }

  showError(error: unknown): void {
    new Notice(error instanceof UserError ? error.message : 'The operation could not finish. Local files were kept. Retry or reopen the workspace browser.', 8000);
  }

  storeToken(token: string): void {
    const value = token.trim();
    if (value.length < 20 || value.length > 255 || /\s/.test(value)) throw new UserError('Paste a valid GitHub personal access token.');
    this.app.secretStorage.setSecret(this.secretId, value);
  }

  private fileChanged(file: TAbstractFile): void { this.pathChanged(file.path); }

  private pathChanged(path: string): void {
    if (!this.ready) return;
    for (const mount of Object.values(this.store.data.mounts)) {
      const connection = mount.connection;
      if (!inFolder(path, connection.localPath)) continue;
      const relative = path.slice(connection.localPath.length + 1);
      if (relative && !supported(relative) && path !== connection.localPath) {
        // A folder rename/delete still affects tracked descendants.
        if (!Object.keys(mount.baseline).some(p => inFolder(p, relative))) continue;
      }
      mount.pending = Math.max(1, mount.pending);
      if (this.changedTimer === null) this.changedTimer = window.setTimeout(() => {
        this.changedTimer = null;
        this.run(() => this.store.save());
        this.emit();
      }, 400);
      if (connection.paused || !connection.autoUpload || connection.access !== 'read-write' || this.engine.isRunning(connection.id)) continue;
      const previous = this.uploadTimers.get(connection.id);
      if (previous !== undefined) window.clearTimeout(previous);
      this.uploadTimers.set(connection.id, window.setTimeout(() => {
        this.uploadTimers.delete(connection.id);
        this.run(() => this.syncOne(connection.id, true));
      }, this.store.data.settings.uploadDelaySeconds * 1000));
    }
  }

  private backgroundSync(): void {
    if (!this.ready || this.engine.isStopped() || document.visibilityState === 'hidden' || navigator.onLine === false) return;
    if (Date.now() - this.lastPoll < this.store.data.settings.pollSeconds * 1000) return;
    this.lastPoll = Date.now();
    this.run(() => this.syncAll());
  }

  async syncOne(id: string, upload?: boolean, approval?: string): Promise<void> {
    const mount = this.store.data.mounts[id];
    if (!mount || mount.connection.paused || this.engine.isRunning(id) || this.exporter?.busy) return;
    await this.bridge.flushEditors(mount.connection.localPath);
    await this.engine.sync(id, upload ?? mount.connection.autoUpload, approval);
    this.emit();
  }

  async syncAll(upload?: boolean): Promise<void> {
    if (this.syncAllRunning || this.exporter?.busy) return;
    this.syncAllRunning = true;
    try { for (const id of Object.keys(this.store.data.mounts)) { if (!this.ready) break; await this.syncOne(id, upload); } }
    finally { this.syncAllRunning = false; }
  }

  validateConnection(connection: Connection, except?: string): void {
    this.bridge.validateRoot(connection.localPath);
    safePath(connection.remotePath, true);
    const canonical = (path: string): string => path.normalize('NFC').toLowerCase();
    const overlaps = (a: string, b: string): boolean => !a || !b || inFolder(a, b) || inFolder(b, a);
    for (const mount of Object.values(this.store.data.mounts)) {
      const other = mount.connection;
      if (other.id === except) continue;
      if (overlaps(canonical(connection.localPath), canonical(other.localPath))) throw new UserError('Connected local folders cannot overlap. Choose a separate workspace folder.');
      if (connection.owner.toLowerCase() === other.owner.toLowerCase() && connection.repo.toLowerCase() === other.repo.toLowerCase() && connection.branch === other.branch && overlaps(connection.remotePath, other.remotePath)) {
        throw new UserError('This GitHub folder overlaps another connection on the same branch.');
      }
    }
  }

  async connect(connection: Connection): Promise<void> {
    this.validateConnection(connection);
    await this.bridge.ensureFolder(connection.localPath);
    await this.engine.add(connection);
    await this.openExplorer();
    await this.syncOne(connection.id, false);
  }

  async saveVault(connectionId: string, plan: VaultExportPlan): Promise<void> {
    const mount = this.store.data.mounts[connectionId];
    if (!mount) throw new UserError('Select an existing writable repository connection.');
    if (this.syncAllRunning || Object.keys(this.store.data.mounts).some(id => this.engine.isRunning(id))) throw new UserError('Wait for folder sync to finish, then save the vault.');
    await this.exporter.publish(mount.connection, plan);
  }

  async openExplorer(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      const next = this.app.workspace.getLeftLeaf(false);
      if (!next) throw new UserError('Cannot open a workspace pane.');
      leaf = next;
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  emit(): void {
    if (!this.ready) return;
    let pending = 0, conflicts = 0, syncing = false, errors = 0;
    for (const mount of Object.values(this.store.data.mounts)) {
      pending += mount.pending;
      conflicts += Object.keys(mount.conflicts).length;
      syncing ||= this.engine.isRunning(mount.connection.id);
      errors += this.engine.status(mount.connection.id).phase === 'error' ? 1 : 0;
    }
    const summary = this.exporter?.busy ? 'Saving vault…' : syncing ? 'Syncing…' : conflicts ? `${conflicts} conflicts` : errors ? 'Needs attention' : pending ? `${pending} pending` : 'Ready';
    this.statusEl?.setText(`GitHub · ${summary}`);
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof ExplorerView) leaf.view.render();
  }
}
