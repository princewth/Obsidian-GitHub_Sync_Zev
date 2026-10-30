import { App, MarkdownView, parseLinktext, TFile, TFolder } from 'obsidian';
import { asBuffer, decode, encode, fromText, toText } from './bytes';
import { checkCollisions, inFolder, isText, join, safePath, supported } from './paths';
import { Content, LocalChanged, LocalFiles, MAX_WORKSPACE_BYTES, UserError } from './types';
import { isMarkdown, VaultCapture, VaultLink } from './vault-export';

export class VaultBridge implements LocalFiles {
  constructor(private readonly app: App, private readonly maxBytes: () => number) {}

  validateRoot(root: string): void {
    safePath(root);
    const config = this.app.vault.configDir.toLowerCase();
    if (inFolder(root.toLowerCase(), config) || inFolder(config, root.toLowerCase())) throw new UserError('The Obsidian configuration folder cannot be connected.');
  }

  async exists(root: string): Promise<boolean> {
    this.validateRoot(root);
    return this.app.vault.getAbstractFileByPath(root) instanceof TFolder;
  }

  async ensureFolder(root: string): Promise<void> {
    this.validateRoot(root);
    let current = '';
    for (const segment of root.split('/')) {
      current = join(current, segment);
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing && !(existing instanceof TFolder)) throw new UserError('A file is blocking the workspace folder.');
      if (!existing) {
        try { await this.app.vault.createFolder(current); }
        catch { if (!(this.app.vault.getAbstractFileByPath(current) instanceof TFolder)) throw new UserError('Cannot create the workspace folder.'); }
      }
    }
  }

  private full(root: string, path: string): string {
    this.validateRoot(root);
    return join(root, safePath(path));
  }

  async scan(root: string): Promise<Record<string, string>> {
    this.validateRoot(root);
    const result: Record<string, string> = {};
    const folder = this.app.vault.getAbstractFileByPath(root);
    if (!(folder instanceof TFolder)) throw new UserError('The workspace folder is missing.');
    const queue = [...folder.children];
    let totalBytes = 0;
    let count = 0;
    while (queue.length) {
      const item = queue.shift()!;
      const relative = item.path.slice(root.length + 1);
      if (item instanceof TFolder) {
        try { safePath(relative); queue.push(...item.children); } catch { /* Ignore hidden folders. */ }
      } else if (item instanceof TFile && supported(relative)) {
        if (item.stat.size > this.maxBytes()) throw new UserError('A local file exceeds the configured size limit. Increase the limit or move it outside this workspace.');
        result[relative] = await this.readFile(item);
        totalBytes += decode(result[relative]!).length;
        if (totalBytes > MAX_WORKSPACE_BYTES) throw new UserError('The selected files exceed the 100 MB workspace limit. Connect a smaller folder.');
        if (++count > 20000) throw new UserError('Connect a folder containing fewer than 20,000 supported files.');
      }
    }
    checkCollisions(Object.keys(result));
    return result;
  }

  private async readFile(file: TFile): Promise<string> {
    const bytes = new Uint8Array(await this.app.vault.readBinary(file));
    if (bytes.length > this.maxBytes()) throw new UserError('A local file exceeds the configured size limit.');
    return encode(bytes);
  }

  async read(root: string, path: string): Promise<Content> {
    const file = this.app.vault.getAbstractFileByPath(this.full(root, path));
    if (!file) return null;
    if (!(file instanceof TFile)) throw new UserError('A folder is blocking a connected file.');
    return this.readFile(file);
  }

  private checkEditors(file: TFile, expected: Content): void {
    if (!isText(file.path) || expected === null) return;
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === file.path && fromText(view.getViewData()) !== expected) throw new LocalChanged();
    }
  }

  async flushEditors(root?: string): Promise<void> {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      if (leaf.view instanceof MarkdownView && leaf.view.file && (!root || inFolder(leaf.view.file.path, root))) await leaf.view.save();
    }
  }

  async captureVault(): Promise<VaultCapture> {
    await this.flushEditors();
    const allFiles = this.app.vault.getFiles();
    const configRoot = this.app.vault.configDir.normalize('NFC').toLowerCase();
    const selected = allFiles.filter(file => supported(file.path) && !inFolder(file.path.normalize('NFC').toLowerCase(), configRoot));
    if (selected.length > 20000) throw new UserError('A vault export supports up to 20,000 source files.');
    checkCollisions(selected.map(file => file.path));
    const capture: VaultCapture = { files: {}, links: [], blocks: {}, excluded: allFiles.length - selected.length };
    const stamps = new Map(selected.map(file => [file.path, `${file.stat.mtime}:${file.stat.size}`]));
    let totalBytes = 0;
    for (const file of selected) {
      if (file.stat.size > this.maxBytes()) throw new UserError('A vault file exceeds the configured size limit.');
      const content = await this.readFile(file);
      totalBytes += decode(content).length;
      if (totalBytes > MAX_WORKSPACE_BYTES) throw new UserError('The vault exceeds the 100 MB source-content limit.');
      this.checkEditors(file, content);
      capture.files[file.path] = content;
    }
    const allowed = new Set(Object.keys(capture.files));
    for (const file of selected.filter(file => isMarkdown(file.path))) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) throw new UserError('Obsidian is still indexing notes. Wait briefly and preview the vault again.');
      const source = toText(capture.files[file.path]!);
      const addLink = (link: string, displayText: string | undefined, embed: boolean, position?: { start: { offset: number }; end: { offset: number } }, original?: string): void => {
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(link)) return;
        const parsed = parseLinktext(link);
        let destination = parsed.path ? this.app.metadataCache.getFirstLinkpathDest(parsed.path, file.path) : file;
        if (!destination && parsed.path.includes('%')) {
          try { destination = this.app.metadataCache.getFirstLinkpathDest(decodeURIComponent(parsed.path), file.path); } catch { /* Keep unresolved malformed links unchanged. */ }
        }
        const entry: VaultLink = {
          source: file.path, target: destination && allowed.has(destination.path) ? destination.path : null,
          label: displayText || parsed.path || parsed.subpath || file.name,
          subpath: parsed.subpath, embed
        };
        if (position) {
          entry.start = position.start.offset; entry.end = position.end.offset;
          entry.original = original ?? source.slice(entry.start, entry.end);
          if (source.slice(entry.start, entry.end) !== entry.original) throw new UserError('The link index is updating. Preview the vault again after indexing finishes.');
        }
        capture.links.push(entry);
      };
      for (const link of cache.links ?? []) addLink(link.link, link.displayText, false, link.position, link.original);
      for (const link of cache.embeds ?? []) addLink(link.link, link.displayText, true, link.position, link.original);
      for (const link of cache.frontmatterLinks ?? []) {
        const frontmatter = cache.frontmatterPosition;
        if (!frontmatter || !source.slice(frontmatter.start.offset, frontmatter.end.offset).includes(link.original)) throw new UserError('The note properties index is updating. Preview again after indexing finishes.');
        addLink(link.link, link.displayText, false);
      }
      capture.blocks[file.path] = Object.values(cache.blocks ?? {}).map(block => ({ offset: block.position.start.offset, id: block.id }));
    }
    const after = this.app.vault.getFiles().filter(file => supported(file.path) && !inFolder(file.path.normalize('NFC').toLowerCase(), configRoot));
    if (after.length !== selected.length || after.some(file => stamps.get(file.path) !== `${file.stat.mtime}:${file.stat.size}`)) throw new LocalChanged();
    for (const file of selected) this.checkEditors(file, capture.files[file.path]!);
    return capture;
  }

  async replace(root: string, path: string, expected: Content, content: Content): Promise<void> {
    const fullPath = this.full(root, path);
    if (!supported(path)) throw new UserError('This file type or path is excluded from sync.');
    if (content !== null && decode(content).length > this.maxBytes()) throw new UserError('The file exceeds the configured size limit.');
    if (content !== null && isText(path)) {
      try { toText(content); } catch { throw new UserError('A text file contains invalid UTF-8. No local content was replaced.'); }
    }
    const current = this.app.vault.getAbstractFileByPath(fullPath);
    if (current && !(current instanceof TFile)) throw new UserError('A folder is blocking a connected file.');
    if (current instanceof TFile) this.checkEditors(current, expected);
    if (await this.read(root, path) !== expected) throw new LocalChanged();
    if (content === expected) return;
    if (content === null) {
      if (current instanceof TFile) {
        this.checkEditors(current, expected);
        // Use Obsidian's local trash so downloaded deletions can be restored.
        await this.app.vault.trash(current, false);
      }
      return;
    }
    if (!current) {
      const parent = fullPath.split('/').slice(0, -1).join('/');
      await this.ensureFolder(parent);
      // createBinary rejects if an editor/user created the file in the meantime.
      try { await this.app.vault.createBinary(fullPath, asBuffer(decode(content))); }
      catch { throw new LocalChanged(); }
    } else if (isText(path)) {
      let nextText: string;
      try { nextText = toText(content); } catch { throw new UserError('A text file contains invalid UTF-8. No local content was replaced.'); }
      await this.app.vault.process(current, data => {
        this.checkEditors(current, expected);
        if (fromText(data) !== expected) throw new LocalChanged();
        return nextText;
      });
    } else {
      // The public API has no binary compare-and-swap. Recheck immediately before writing.
      if (await this.read(root, path) !== expected) throw new LocalChanged();
      await this.app.vault.modifyBinary(current, asBuffer(decode(content)));
    }
  }
}
