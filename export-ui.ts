import { ButtonComponent, Modal, Setting } from 'obsidian';
import type GitHubSyncZev from './main';
import { buildVaultExport, VaultExportPlan } from './vault-export';
import { vaultExportURL } from './export-service';
import { UserError } from './types';

export class VaultExportModal extends Modal {
  private selected = '';
  private plan: VaultExportPlan | null = null;
  private reviewed = false;
  private busy = false;
  private message = '';

  constructor(private readonly plugin: GitHubSyncZev, connectionId?: string) {
    super(plugin.app);
    this.selected = connectionId ?? Object.values(plugin.store.data.mounts).find(mount => mount.connection.access === 'read-write')?.connection.id ?? '';
  }
  onOpen(): void { this.modalEl.addClass('gsz-modal', 'gsz-export-modal'); this.render(); }
  onClose(): void { this.plan = null; this.contentEl.empty(); }

  private async perform(task: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.message = ''; this.render();
    try { await task(); }
    catch (error) { this.message = error instanceof UserError ? error.message : 'The vault save could not finish. Check publication status before creating another snapshot.'; }
    finally { this.busy = false; this.render(); }
  }

  private button(parent: HTMLElement, label: string, task: () => Promise<void>, primary = false): ButtonComponent {
    const button = new ButtonComponent(parent).setButtonText(label).setDisabled(this.busy || this.plugin.exporter.busy).onClick(() => void this.perform(task));
    if (primary) button.setCta();
    return button;
  }

  private render(): void {
    const root = this.contentEl; root.empty();
    root.createDiv({ text: 'ZEV // VAULT ARCHIVE', cls: 'gsz-eyebrow' });
    root.createEl('h2', { text: 'Save a standalone vault' });
    root.createEl('p', { text: 'Capture all supported notes and attachments from this vault, preserving folders and Obsidian links. A separate GitHub reading copy includes clickable links and backlink lists.', cls: 'gsz-muted' });
    const writable = Object.values(this.plugin.store.data.mounts).filter(mount => mount.connection.access === 'read-write');
    if (!writable.length) {
      root.createEl('p', { text: 'Connect a repository with read and write access first, then open this archive panel again.' });
    } else {
      new Setting(root).setName('Destination repository').setDesc('Each save creates a new folder under Obsidian-Vaults/. Snapshots stay separate from normal folder sync.').addDropdown(dropdown => {
        for (const { connection } of writable) dropdown.addOption(connection.id, `${connection.owner}/${connection.repo} · ${connection.branch}`);
        dropdown.setValue(this.selected).setDisabled(this.busy || this.plugin.exporter.busy).onChange(value => { this.selected = value; this.reviewed = false; this.render(); });
      });
      const controls = root.createDiv({ cls: 'gsz-actions' });
      this.button(controls, this.busy ? 'Working…' : 'Preview full vault', async () => {
        const capture = await this.plugin.bridge.captureVault();
        this.plan = buildVaultExport(capture, this.plugin.store.data.settings.maxFileMB * 1024 * 1024);
        this.reviewed = false;
      });
      if (this.plan) {
        const plan = this.plan;
        const metrics = root.createDiv({ cls: 'gsz-archive-metrics' });
        metrics.createDiv({ text: `${plan.noteCount} notes` });
        metrics.createDiv({ text: `${plan.fileCount} source files` });
        metrics.createDiv({ text: `${plan.linkCount} linked references` });
        metrics.createDiv({ text: `${(plan.uploadBytes / 1024 / 1024).toFixed(2)} MB upload` });
        root.createEl('p', { text: `${plan.excludedCount} unsupported or private/configuration files excluded · ${plan.unresolvedCount} missing or excluded link targets.`, cls: 'gsz-muted' });
        root.createEl('p', { text: 'Original vault + GitHub reading copy + fresh core settings for Backlinks, Outgoing links, and Graph. Original plugin settings, workspace history, tokens, and caches are excluded.' });
        const files = root.createDiv({ cls: 'gsz-preview-list' });
        for (const path of plan.sourcePaths.slice(0, 300)) files.createDiv({ text: path, cls: 'gsz-archive-path' });
        if (plan.sourcePaths.length > 300) files.createEl('p', { text: `Showing 300 of ${plan.sourcePaths.length} source files.` });
        const fullList = root.createEl('details'); fullList.createEl('summary', { text: 'Review the complete source file list' });
        fullList.createEl('pre', { text: plan.sourcePaths.join('\n'), cls: 'gsz-preview-content' });
        root.createEl('p', { text: 'This includes notes from the entire vault, beyond your connected folder. If the destination repository is public, the snapshot and its note history will be public. Edits made after this preview require a new preview.' });
        new Setting(root).setName('I reviewed the full-vault file list and destination').addToggle(toggle => toggle.setValue(this.reviewed).setDisabled(this.busy).onChange(value => { this.reviewed = value; this.render(); }));
        this.button(root, 'Save vault to repository', async () => {
          if (!this.reviewed || !this.plan) throw new UserError('Review the vault and destination before saving.');
          await this.plugin.saveVault(this.selected, this.plan);
          this.message = 'Vault snapshot saved. Open it below, or download the repository and open its vault folder in Obsidian.';
          this.plan = null; this.reviewed = false;
        }, true).setDisabled(this.busy || this.plugin.exporter.busy || !this.reviewed || Boolean(this.plugin.store.data.vaultExports?.[plan.id]));
      }
    }
    if (this.message) root.createEl('p', { text: this.message, cls: 'gsz-state' });
    const history = Object.values(this.plugin.store.data.vaultExports ?? {}).sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
    if (history.length) {
      root.createEl('h3', { text: 'Recent snapshots' });
      for (const record of history) {
        const card = root.createDiv({ cls: 'gsz-export-record' });
        card.createDiv({ text: `${record.target.owner}/${record.target.repo} · ${record.target.branch}` });
        card.createDiv({ text: `${record.noteCount} notes · ${record.linkCount} links · ${record.status.replace('-', ' ')} · ${new Date(record.createdAt).toLocaleString()}`, cls: 'gsz-muted' });
        if (record.status === 'published') {
          const link = card.createEl('a', { text: 'Open snapshot on GitHub' });
          link.href = vaultExportURL(record); link.target = '_blank'; link.rel = 'noopener noreferrer';
        } else if (record.commit || record.status === 'preparing') {
          this.button(card, 'Check publication status', async () => {
            const checked = await this.plugin.exporter.checkPublication(record.id);
            this.message = checked.status === 'published' ? 'GitHub confirms this snapshot was published. It was not uploaded again.' : 'This snapshot is not on the current branch. Create a new preview to save a new snapshot.';
          });
        }
      }
    }
  }
}
