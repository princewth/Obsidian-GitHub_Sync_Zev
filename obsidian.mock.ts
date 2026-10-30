import { vi } from 'vitest';
import type { CachedMetadata } from 'obsidian';

export function installDOM(): void {
  Object.assign(HTMLElement.prototype, {
    empty(this: HTMLElement) { this.replaceChildren(); },
    addClass(this: HTMLElement, ...classes: string[]) { this.classList.add(...classes); },
    setText(this: HTMLElement, text: string) { this.textContent = text; },
    createEl(this: HTMLElement, tag: string, options: { text?: string; cls?: string; attr?: Record<string, string> } = {}) {
      const element = document.createElement(tag);
      if (options.text) element.textContent = options.text;
      if (options.cls) element.className = options.cls;
      for (const [key, value] of Object.entries(options.attr ?? {})) element.setAttribute(key, value);
      this.append(element);
      return element;
    },
    createDiv(this: HTMLElement, options: { text?: string; cls?: string } = {}) { return this.createEl('div', options); }
  });
}

export class TAbstractFile {
  constructor(public path: string) {}
  get name(): string { return this.path.split('/').pop() ?? ''; }
}
export class TFolder extends TAbstractFile { children: TAbstractFile[] = []; }
export class TFile extends TAbstractFile {
  stat = { size: 0, mtime: 0, ctime: 0 };
  get extension(): string { return this.name.split('.').pop() ?? ''; }
}

export class MockVault {
  configDir = '.obsidian';
  items = new Map<string, TAbstractFile>([['', new TFolder('')]]);
  bytes = new Map<string, ArrayBuffer>();
  trashed = new Map<string, ArrayBuffer>();
  listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  getAbstractFileByPath(path: string): TAbstractFile | null { return this.items.get(path) ?? null; }
  getFiles(): TFile[] { return [...this.items.values()].filter((file): file is TFile => file instanceof TFile); }
  on(event: string, callback: (...args: unknown[]) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(callback);
    return () => this.listeners.get(event)!.delete(callback);
  }
  emit(event: string, ...args: unknown[]): void { for (const callback of this.listeners.get(event) ?? []) callback(...args); }
  private attach(item: TAbstractFile): void {
    if (this.items.has(item.path)) throw new Error('exists');
    const parent = this.items.get(item.path.split('/').slice(0, -1).join('/'));
    if (!(parent instanceof TFolder)) throw new Error('parent missing');
    parent.children.push(item); this.items.set(item.path, item);
    this.emit('create', item);
  }
  async createFolder(path: string): Promise<TFolder> { const folder = new TFolder(path); this.attach(folder); return folder; }
  async createBinary(path: string, data: ArrayBuffer): Promise<TFile> {
    const file = new TFile(path); file.stat.size = data.byteLength;
    this.bytes.set(path, data.slice(0)); this.attach(file); return file;
  }
  async readBinary(file: TFile): Promise<ArrayBuffer> { return this.bytes.get(file.path)!.slice(0); }
  async modifyBinary(file: TFile, data: ArrayBuffer): Promise<void> {
    this.bytes.set(file.path, data.slice(0)); file.stat.size = data.byteLength; file.stat.mtime++;
    this.emit('modify', file);
  }
  async process(file: TFile, callback: (data: string) => string): Promise<void> {
    const result = callback(new TextDecoder().decode(this.bytes.get(file.path)!));
    await this.modifyBinary(file, new TextEncoder().encode(result).buffer as ArrayBuffer);
  }
  async trash(file: TFile): Promise<void> {
    this.trashed.set(file.path, this.bytes.get(file.path)!);
    this.bytes.delete(file.path); this.items.delete(file.path);
    const parent = this.items.get(file.path.split('/').slice(0, -1).join('/')) as TFolder;
    parent.children = parent.children.filter(child => child !== file);
    this.emit('delete', file);
  }
}

export class MarkdownView {
  file: TFile | null = null;
  data = '';
  constructor(private readonly app: App) {}
  getViewType(): string { return 'markdown'; }
  getViewData(): string { return this.data; }
  async save(): Promise<void> { if (this.file) await this.app.vault.modifyBinary(this.file, new TextEncoder().encode(this.data).buffer as ArrayBuffer); }
}

export class App {
  vault = new MockVault();
  local = new Map<string, unknown>();
  secrets = new Map<string, string>();
  modals: Modal[] = [];
  secretStorage = {
    getSecret: (id: string): string | null => this.secrets.get(id) ?? null,
    setSecret: (id: string, value: string): void => { this.secrets.set(id, value); }
  };
  workspace = new Workspace(this);
  metadataCache = {
    getFileCache: (_file: TFile): CachedMetadata | null => ({}),
    getFirstLinkpathDest: (path: string, sourcePath: string): TFile | null => {
      const relative = sourcePath.split('/').slice(0, -1).concat(path).join('/');
      const found = this.vault.items.get(path) ?? this.vault.items.get(`${path}.md`) ?? this.vault.items.get(relative) ?? this.vault.items.get(`${relative}.md`);
      return found instanceof TFile ? found : null;
    }
  };
  loadLocalStorage(key: string): unknown { return this.local.get(key) ?? null; }
  saveLocalStorage(key: string, value: unknown): void { this.local.set(key, value); }
}

export class Workspace {
  leaves: WorkspaceLeaf[] = [];
  factories = new Map<string, (leaf: WorkspaceLeaf) => ItemView>();
  constructor(private readonly app: App) {}
  getLeavesOfType(type: string): WorkspaceLeaf[] { return this.leaves.filter(leaf => leaf.view?.getViewType() === type); }
  getLeaf(): WorkspaceLeaf { const leaf = new WorkspaceLeaf(this.app); this.leaves.push(leaf); return leaf; }
  getLeftLeaf(): WorkspaceLeaf { return this.getLeaf(); }
  async revealLeaf(): Promise<void> {}
  onLayoutReady(callback: () => void): void { callback(); }
}

export class WorkspaceLeaf {
  view: ItemView | MarkdownView | null = null;
  constructor(private readonly app: App) {}
  async setViewState(state: { type: string }): Promise<void> {
    this.view = this.app.workspace.factories.get(state.type)!(this);
    await (this.view as ItemView).onOpen();
  }
  async openFile(file: TFile): Promise<void> {
    const view = new MarkdownView(this.app);
    view.file = file; view.data = new TextDecoder().decode(await this.app.vault.readBinary(file));
    this.view = view;
  }
}

export class ItemView {
  app: App;
  contentEl = document.createElement('div');
  constructor(public leaf: WorkspaceLeaf) { this.app = (leaf as unknown as { app: App }).app; }
  getViewType(): string { return 'mock'; }
  async onOpen(): Promise<void> {}
}

export class Modal {
  modalEl = document.createElement('div');
  contentEl = document.createElement('div');
  constructor(public app: App) { this.modalEl.append(this.contentEl); }
  open(): void { document.body.append(this.modalEl); this.app.modals.push(this); this.onOpen(); }
  close(): void { this.onClose(); this.modalEl.remove(); this.app.modals = this.app.modals.filter(modal => modal !== this); }
  onOpen(): void {}
  onClose(): void {}
}

export class ButtonComponent {
  buttonEl: HTMLButtonElement;
  constructor(parent: HTMLElement) { this.buttonEl = document.createElement('button'); parent.append(this.buttonEl); }
  setButtonText(text: string): this { this.buttonEl.textContent = text; return this; }
  setDisabled(value: boolean): this { this.buttonEl.disabled = value; return this; }
  setCta(): this { this.buttonEl.classList.add('mod-cta'); return this; }
  onClick(callback: () => void): this { this.buttonEl.addEventListener('click', callback); return this; }
}

class TextComponent {
  inputEl: HTMLInputElement;
  constructor(parent: HTMLElement) { this.inputEl = document.createElement('input'); parent.append(this.inputEl); }
  setPlaceholder(text: string): this { this.inputEl.placeholder = text; return this; }
  setValue(value: string): this { this.inputEl.value = value; return this; }
  setDisabled(value: boolean): this { this.inputEl.disabled = value; return this; }
  onChange(callback: (value: string) => void): this { this.inputEl.addEventListener('input', () => callback(this.inputEl.value)); return this; }
}
class DropdownComponent {
  selectEl: HTMLSelectElement;
  constructor(parent: HTMLElement) { this.selectEl = document.createElement('select'); parent.append(this.selectEl); }
  addOption(value: string, label: string): this { const option = document.createElement('option'); option.value = value; option.text = label; this.selectEl.append(option); return this; }
  setValue(value: string): this { this.selectEl.value = value; return this; }
  setDisabled(value: boolean): this { this.selectEl.disabled = value; return this; }
  onChange(callback: (value: string) => void): this { this.selectEl.addEventListener('change', () => callback(this.selectEl.value)); return this; }
}
class ToggleComponent {
  toggleEl: HTMLInputElement;
  constructor(parent: HTMLElement) { this.toggleEl = document.createElement('input'); this.toggleEl.type = 'checkbox'; parent.append(this.toggleEl); }
  setValue(value: boolean): this { this.toggleEl.checked = value; return this; }
  setDisabled(value: boolean): this { this.toggleEl.disabled = value; return this; }
  onChange(callback: (value: boolean) => void): this { this.toggleEl.addEventListener('change', () => callback(this.toggleEl.checked)); return this; }
}

export class Setting {
  settingEl: HTMLElement;
  constructor(parent: HTMLElement) { this.settingEl = document.createElement('div'); this.settingEl.className = 'setting-item'; parent.append(this.settingEl); }
  setName(name: string): this { const label = document.createElement('label'); label.textContent = name; this.settingEl.append(label); return this; }
  setDesc(desc: string): this { const span = document.createElement('span'); span.textContent = desc; this.settingEl.append(span); return this; }
  setHeading(): this { return this; }
  addText(callback: (text: TextComponent) => void): this { callback(new TextComponent(this.settingEl)); return this; }
  addDropdown(callback: (dropdown: DropdownComponent) => void): this { callback(new DropdownComponent(this.settingEl)); return this; }
  addToggle(callback: (toggle: ToggleComponent) => void): this { callback(new ToggleComponent(this.settingEl)); return this; }
  addButton(callback: (button: ButtonComponent) => void): this { callback(new ButtonComponent(this.settingEl)); return this; }
}

export class PluginSettingTab {
  containerEl = document.createElement('div');
  constructor(public app: App, public plugin: Plugin) {}
}

export class Plugin {
  commands: Array<{ id: string; name: string; callback: () => void }> = [];
  settingTabs: PluginSettingTab[] = [];
  cleanup: Array<() => void> = [];
  saveData = vi.fn();
  constructor(public app: App, public manifest: { version: string }) {}
  registerView(type: string, factory: (leaf: WorkspaceLeaf) => ItemView): void { this.app.workspace.factories.set(type, factory); }
  addRibbonIcon(): HTMLElement { return document.createElement('div'); }
  addCommand(command: { id: string; name: string; callback: () => void }): void { this.commands.push(command); }
  addSettingTab(tab: PluginSettingTab): void { this.settingTabs.push(tab); }
  addStatusBarItem(): HTMLElement { return document.createElement('div'); }
  registerEvent(off: () => void): void { this.cleanup.push(off); }
  registerDomEvent(element: EventTarget, type: string, callback: EventListener): void { element.addEventListener(type, callback); this.cleanup.push(() => element.removeEventListener(type, callback)); }
  registerInterval(timer: number): void { this.cleanup.push(() => window.clearInterval(timer)); }
}

export class Notice {
  static messages: string[] = [];
  constructor(message: string) { Notice.messages.push(message); }
}

export const requestUrl = vi.fn();
export function parseLinktext(link: string): { path: string; subpath: string } {
  const index = link.indexOf('#');
  return index < 0 ? { path: link, subpath: '' } : { path: link.slice(0, index), subpath: link.slice(index) };
}
