import { decode, fromText, toText } from './bytes';
import { checkCollisions, extension, isText, safePath, supported, VAULT_ARCHIVE_ROOT } from './paths';
import { MAX_WORKSPACE_BYTES, UserError } from './types';

export const EXPORT_ROOT = VAULT_ARCHIVE_ROOT;
export const CORE_VAULT_FILES: Readonly<Record<string, string>> = Object.freeze({
  'vault/.obsidian/app.json': fromText(JSON.stringify({ useMarkdownLinks: false, newLinkFormat: 'relative', alwaysUpdateLinks: true }, null, 2)),
  'vault/.obsidian/core-plugins.json': fromText(JSON.stringify(['file-explorer', 'global-search', 'switcher', 'graph', 'backlink', 'outgoing-link', 'tag-pane', 'page-preview', 'properties'], null, 2)),
  'vault/.obsidian/graph.json': fromText(JSON.stringify({ showAttachments: true, showOrphans: true }, null, 2))
});

export interface VaultLink {
  source: string;
  target: string | null;
  label: string;
  subpath: string;
  embed: boolean;
  start?: number;
  end?: number;
  original?: string;
}

export interface VaultCapture {
  files: Record<string, string>;
  links: VaultLink[];
  blocks: Record<string, Array<{ offset: number; id: string }>>;
  excluded: number;
}

export interface VaultExportPlan {
  id: string;
  prefix: string;
  files: Record<string, string>;
  sourcePaths: string[];
  fileCount: number;
  noteCount: number;
  linkCount: number;
  unresolvedCount: number;
  excludedCount: number;
  sourceBytes: number;
  uploadBytes: number;
}

export function isMarkdown(path: string): boolean { return ['md', 'markdown'].includes(extension(path)); }

export function markdownLabel(text: string): string {
  return text.replace(/[\r\n]/g, ' ').replace(/\\/g, '\\\\').replace(/[\[\]*_`]/g, '\\$&').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function relativeURL(source: string, target: string): string {
  const from = source.split('/'); from.pop();
  const to = target.split('/');
  while (from.length && to.length && from[0] === to[0]) { from.shift(); to.shift(); }
  return [...from.map(() => '..'), ...to].map(part => part === '..' ? part : encodeURIComponent(part).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/') || './';
}

function fragment(subpath: string): string {
  if (!subpath) return '';
  if (subpath.startsWith('#^')) return `#block-${encodeURIComponent(subpath.slice(2))}`;
  const heading = subpath.split('#').filter(Boolean).pop() ?? '';
  return `#${encodeURIComponent(heading.toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/\s/g, '-'))}`;
}

function destination(path: string): string { return `${isMarkdown(path) ? 'browse' : 'vault'}/${path}`; }

function renderNote(path: string, capture: VaultCapture, outgoingLinks: VaultLink[], incomingPaths: string[]): string {
  const original = toText(capture.files[path]!);
  const source = `browse/${path}`;
  const operations: Array<{ start: number; end: number; replacement: string }> = [];
  const seenSpans = new Set<string>();
  for (const link of outgoingLinks) {
    if (link.start === undefined || link.end === undefined || !link.target) continue;
    const key = `${link.start}:${link.end}`;
    if (seenSpans.has(key)) continue;
    seenSpans.add(key);
    if (link.start < 0 || link.end > original.length || link.start >= link.end || !link.original || original.slice(link.start, link.end) !== link.original) {
      throw new UserError('The link index is updating. Wait briefly and preview the vault again.');
    }
    const href = relativeURL(source, destination(link.target)) + fragment(link.subpath);
    const image = link.embed && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'].includes(extension(link.target));
    const label = link.embed && isMarkdown(link.target) ? `Embedded note: ${link.label}` : link.label;
    operations.push({ start: link.start, end: link.end, replacement: `${image ? '!' : ''}[${markdownLabel(label)}](${href})` });
  }
  for (const block of capture.blocks[path] ?? []) {
    if (!/^[A-Za-z0-9-]+$/.test(block.id) || block.offset < 0 || block.offset > original.length) throw new UserError('The block index is updating. Preview the vault again.');
    operations.push({ start: block.offset, end: block.offset, replacement: `<a name="block-${block.id}"></a>\n` });
  }
  operations.sort((a, b) => b.start - a.start || b.end - a.end);
  let content = original, boundary = original.length;
  for (const operation of operations) {
    if (operation.end > boundary) throw new UserError('The link index contains overlapping ranges. Preview again after indexing finishes.');
    content = content.slice(0, operation.start) + operation.replacement + content.slice(operation.end);
    boundary = operation.start;
  }
  const outgoing = [...new Set(outgoingLinks.filter(link => link.target).map(link => link.target!))].sort();
  const incoming = [...new Set(incomingPaths)].sort();
  const list = (paths: string[]): string => paths.length ? paths.map(target => `- [${markdownLabel(target)}](${relativeURL(source, destination(target))})`).join('\n') : '_None._';
  return `${content}\n\n---\n\n## Linked notes\n\n### Outgoing links\n\n${list(outgoing)}\n\n### Backlinks\n\n${list(incoming)}\n\n[Snapshot index](${relativeURL(source, 'README.md')}) · [Original Obsidian note](${relativeURL(source, `vault/${path}`)})\n`;
}

export function buildVaultExport(capture: VaultCapture, maxFileBytes: number, id = `snapshot-${crypto.randomUUID()}`): VaultExportPlan {
  if (!/^snapshot-[a-z0-9-]{8,80}$/.test(id)) throw new UserError('Invalid vault snapshot identifier.');
  const sourcePaths = Object.keys(capture.files).sort();
  if (!sourcePaths.length) throw new UserError('This vault has no supported notes or attachments to export.');
  if (sourcePaths.length > 20000) throw new UserError('A vault export supports up to 20,000 source files.');
  checkCollisions(sourcePaths);
  let sourceBytes = 0;
  const files: Record<string, string> = { ...CORE_VAULT_FILES };
  for (const path of sourcePaths) {
    if (!supported(path)) throw new UserError('An excluded source file cannot be included in a vault snapshot.');
    const content = capture.files[path]!;
    const size = decode(content).length;
    if (size > maxFileBytes) throw new UserError('A source file exceeds the configured file size limit.');
    sourceBytes += size;
    if (isText(path)) {
      try { toText(content); } catch { throw new UserError('A vault text file contains invalid UTF-8.'); }
    }
    files[`vault/${path}`] = content;
  }
  if (sourceBytes > MAX_WORKSPACE_BYTES) throw new UserError('The vault exceeds the 100 MB source-content limit.');
  const validPaths = new Set(sourcePaths);
  const links = capture.links.filter(link => validPaths.has(link.source)).map(link => ({ ...link, target: link.target && validPaths.has(link.target) ? link.target : null }));
  const resolved = links.filter(link => link.target !== null);
  const notes = sourcePaths.filter(isMarkdown);
  const outgoing = new Map<string, VaultLink[]>(), incoming = new Map<string, string[]>();
  for (const link of resolved) {
    const from = outgoing.get(link.source) ?? []; from.push(link); outgoing.set(link.source, from);
    const to = incoming.get(link.target!) ?? []; to.push(link.source); incoming.set(link.target!, to);
  }
  for (const path of notes) files[`browse/${path}`] = fromText(renderNote(path, capture, outgoing.get(path) ?? [], incoming.get(path) ?? []));
  const edges = new Map<string, { source: string; target: string; count: number }>();
  for (const link of resolved) {
    const key = JSON.stringify([link.source, link.target]);
    const previous = edges.get(key);
    if (previous) previous.count++;
    else edges.set(key, { source: link.source, target: link.target!, count: 1 });
  }
  files['link-map.json'] = fromText(JSON.stringify({ format: 'github-sync-zev-vault-v1', nodes: sourcePaths, edges: [...edges.values()], unresolvedLinks: links.length - resolved.length }, null, 2));
  const index = notes.slice(0, 1000).map(path => `- [${markdownLabel(path)}](${relativeURL('README.md', `browse/${path}`)})`).join('\n');
  files['README.md'] = fromText(`# Obsidian vault snapshot\n\n${notes.length} notes · ${sourcePaths.length} source files · ${resolved.length} resolved links.\n\n## Open in Obsidian\n\nDownload this repository, extract it, and use **Open folder as vault** to open this snapshot's **vault** folder. Keep the generated **.obsidian** folder inside it. Original note bytes, relative paths, wiki-links, aliases, embeds, headings, and block IDs are preserved. The generated core settings enable Backlinks, Outgoing links, and Graph. Obsidian rebuilds the link index after opening. Community plugins, credentials, workspace history, and original application settings are not included.\n\n## Read on GitHub\n\nUse the **browse** folder for Markdown links and per-note outgoing/backlink lists. Images and attachments link to the originals in **vault**. Note embeds open the referenced note; live transclusion and the interactive Obsidian graph require Obsidian. Heading anchors follow GitHub conventions; duplicate/complex headings can differ. Missing or excluded targets remain unresolved.\n\n${links.length - resolved.length} unresolved or excluded link references. See **link-map.json** for the complete resolved link graph. This is an independent snapshot; later local edits require another export.\n\n## Notes\n\n${index}${notes.length > 1000 ? '\n\nShowing the first 1,000 notes; browse the directory for the rest.' : ''}\n`);
  const plan: VaultExportPlan = {
    id, prefix: `${EXPORT_ROOT}/${id}`, files, sourcePaths, fileCount: sourcePaths.length,
    noteCount: notes.length, linkCount: resolved.length, unresolvedCount: links.length - resolved.length,
    excludedCount: capture.excluded, sourceBytes, uploadBytes: 0
  };
  validateExportFiles(plan, maxFileBytes);
  plan.uploadBytes = Object.values(files).reduce((sum, content) => sum + decode(content).length, 0);
  return plan;
}

export function validateExportFiles(plan: Pick<VaultExportPlan, 'id' | 'prefix' | 'files'>, maxFileBytes: number): void {
  if (!/^snapshot-[a-z0-9-]{8,80}$/.test(plan.id) || plan.prefix !== `${EXPORT_ROOT}/${plan.id}`) throw new UserError('Invalid vault snapshot destination.');
  let total = 0;
  for (const [path, content] of Object.entries(plan.files)) {
    const generated = CORE_VAULT_FILES[path];
    if (generated !== undefined) {
      if (generated !== content) throw new UserError('Only freshly generated core vault settings can be exported.');
    } else if (path !== 'README.md' && path !== 'link-map.json') {
      const [category, ...parts] = path.split('/');
      const relative = parts.join('/');
      safePath(relative);
      if (!['vault', 'browse'].includes(category!) || !supported(relative) || (category === 'browse' && !isMarkdown(relative))) throw new UserError('An excluded file cannot be exported.');
    }
    const size = decode(content).length;
    if (size > maxFileBytes) throw new UserError('An exported file or generated link index exceeds the file size limit.');
    total += size;
    if (total > MAX_WORKSPACE_BYTES * 2 + 5 * 1024 * 1024) throw new UserError('The generated snapshot exceeds the export size limit.');
  }
  if (!Object.keys(plan.files).length) throw new UserError('The vault snapshot is empty.');
}
