import { describe, expect, it } from 'vitest';
import { fromText, toText } from '../src/bytes';
import { buildVaultExport, CORE_VAULT_FILES, relativeURL, validateExportFiles, VaultCapture, VaultLink } from '../src/vault-export';
import { supported } from '../src/paths';

const MAX = 10 * 1024 * 1024;
function capture(files: Record<string, string>, links: VaultLink[] = []): VaultCapture {
  return { files: Object.fromEntries(Object.entries(files).map(([path, content]) => [path, fromText(content)])), links, blocks: {}, excluded: 0 };
}
function ref(source: string, text: string, original: string, target: string | null, label: string, subpath = '', embed = false): VaultLink {
  const start = text.indexOf(original);
  return { source, target, label, subpath, embed, start, end: start + original.length, original };
}

describe('standalone vault snapshot and GitHub link view', () => {
  it('preserves original bytes and folder structure while creating an independent reading copy', () => {
    const text = '\ufeff# Note\r\n[[nested/Other|Alias]]\r\n';
    const input = capture({ 'Note.md': text, 'nested/Other.md': '# Other\n' }, [ref('Note.md', text, '[[nested/Other|Alias]]', 'nested/Other.md', 'Alias')]);
    const plan = buildVaultExport(input, MAX);
    expect(toText(plan.files['vault/Note.md']!)).toBe(text);
    expect(toText(plan.files['browse/Note.md']!)).toContain('[Alias](nested/Other.md)');
    expect(toText(plan.files['browse/nested/Other.md']!)).toContain('[Note.md](../Note.md)');
    expect(plan.files['vault/nested/Other.md']).toBe(fromText('# Other\n'));
    expect(plan.prefix).toMatch(/^Obsidian-Vaults\/snapshot-/);
    expect(plan.noteCount).toBe(2);
  });

  it('builds multiple outgoing and backlinks with duplicates collapsed in navigation but counted in the graph', () => {
    const input = capture({ 'a.md': '# A', 'b.md': '# B', 'c.md': '# C' }, [
      { source: 'a.md', target: 'b.md', label: 'b', subpath: '', embed: false },
      { source: 'a.md', target: 'b.md', label: 'b', subpath: '', embed: false },
      { source: 'c.md', target: 'b.md', label: 'b', subpath: '', embed: false }
    ]);
    const plan = buildVaultExport(input, MAX);
    const page = toText(plan.files['browse/b.md']!);
    expect(page).toContain('### Backlinks\n\n- [a.md](a.md)\n- [c.md](c.md)');
    const graph = JSON.parse(toText(plan.files['link-map.json']!));
    expect(graph.edges).toContainEqual({ source: 'a.md', target: 'b.md', count: 2 });
    expect(plan.linkCount).toBe(3);
  });

  it('converts image embeds to the original attachment and note embeds to navigable notes', () => {
    const text = '![[images/pic.png]]\n![[nested/b]]';
    const input = capture({ 'a.md': text, 'images/pic.png': 'binary fixture', 'nested/b.md': 'B' }, [
      ref('a.md', text, '![[images/pic.png]]', 'images/pic.png', 'pic.png', '', true),
      ref('a.md', text, '![[nested/b]]', 'nested/b.md', 'b', '', true)
    ]);
    const plan = buildVaultExport(input, MAX), page = toText(plan.files['browse/a.md']!);
    expect(page).toContain('![pic.png](../vault/images/pic.png)');
    expect(page).toContain('[Embedded note: b](nested/b.md)');
    expect(plan.files['browse/images/pic.png']).toBeUndefined();
    expect(plan.files['vault/images/pic.png']).toBe(input.files['images/pic.png']);
  });

  it('supports nested relative paths, spaces, Unicode names, headings, and block anchors', () => {
    const text = '[[../中文 note#A heading]]\n[[../中文 note#^block-id]]';
    const target = 'Paragraph ^block-id\n';
    const input = capture({ 'nested/a.md': text, '中文 note.md': target }, [
      ref('nested/a.md', text, '[[../中文 note#A heading]]', '中文 note.md', 'Heading', '#A heading'),
      ref('nested/a.md', text, '[[../中文 note#^block-id]]', '中文 note.md', 'Block', '#^block-id')
    ]);
    input.blocks['中文 note.md'] = [{ offset: 0, id: 'block-id' }];
    const plan = buildVaultExport(input, MAX);
    expect(toText(plan.files['browse/nested/a.md']!)).toContain('../%E4%B8%AD%E6%96%87%20note.md#a-heading');
    expect(toText(plan.files['browse/nested/a.md']!)).toContain('#block-block-id');
    expect(toText(plan.files['browse/中文 note.md']!)).toContain('<a name="block-block-id"></a>\nParagraph');
  });

  it('keeps code examples untouched because only cached link positions are rewritten', () => {
    const text = '```md\n[[b]]\n```\n\nUse [[b]].';
    const original = '[[b]]', start = text.lastIndexOf(original);
    const input = capture({ 'a.md': text, 'b.md': 'B' }, [{ source: 'a.md', target: 'b.md', label: 'b', subpath: '', embed: false, start, end: start + original.length, original }]);
    const plan = buildVaultExport(input, MAX);
    const page = toText(plan.files['browse/a.md']!);
    expect(page).toContain('```md\n[[b]]\n```');
    expect(page).toContain('Use [b](b.md).');
  });

  it('preserves unresolved wiki-links and counts missing/excluded targets without leaking excluded target paths into the graph', () => {
    const text = '[[Missing]]';
    const input = capture({ 'a.md': text }, [ref('a.md', text, '[[Missing]]', '.obsidian/plugins/private/data.json', 'Missing')]);
    const plan = buildVaultExport(input, MAX);
    expect(plan.unresolvedCount).toBe(1);
    expect(toText(plan.files['browse/a.md']!)).toContain('[[Missing]]');
    expect(toText(plan.files['link-map.json']!)).not.toContain('.obsidian');
  });

  it('generates only fixed core configuration and enables native link/graph features', () => {
    const plan = buildVaultExport(capture({ 'a.md': 'A' }), MAX);
    const plugins = JSON.parse(toText(plan.files['vault/.obsidian/core-plugins.json']!));
    expect(plugins).toEqual(expect.arrayContaining(['backlink', 'outgoing-link', 'graph']));
    expect(Object.keys(plan.files).filter(path => path.includes('/.obsidian/')).sort()).toEqual(Object.keys(CORE_VAULT_FILES).sort());
    expect(JSON.stringify(plan.files)).not.toContain('workspace.json');
  });

  it('refuses source configuration, hidden files, sensitive paths, or recursively exported snapshots', () => {
    for (const path of ['.obsidian/app.json', '.env', 'credentials.txt', 'Obsidian-Vaults/snapshot-12345678/vault/a.md', 'nested/Obsidian-Vaults/a.md']) {
      expect(supported(path)).toBe(false);
      expect(() => buildVaultExport(capture({ [path]: 'private' }), MAX)).toThrow();
    }
  });

  it('refuses replacing generated configuration with original or arbitrary settings', () => {
    const plan = buildVaultExport(capture({ 'a.md': 'A' }), MAX);
    plan.files['vault/.obsidian/app.json'] = fromText('{"token":"should-never-be-copied"}');
    expect(() => validateExportFiles(plan, MAX)).toThrow('freshly generated');
  });

  it('refuses arbitrary destination prefixes and hidden files in a forged export plan', () => {
    const plan = buildVaultExport(capture({ 'a.md': 'A' }), MAX);
    expect(() => validateExportFiles({ ...plan, prefix: 'other/path' }, MAX)).toThrow('destination');
    expect(() => validateExportFiles({ ...plan, files: { 'vault/.obsidian/plugins/plugin/data.json': fromText('private') } }, MAX)).toThrow();
  });

  it('stops on stale metadata, unsafe block anchors, filename collisions, and invalid text', () => {
    const input = capture({ 'a.md': 'A', 'b.md': 'B' }, [{ source: 'a.md', target: 'b.md', label: 'B', subpath: '', embed: false, start: 0, end: 1, original: 'old' }]);
    expect(() => buildVaultExport(input, MAX)).toThrow('index');
    input.links = []; input.blocks['a.md'] = [{ offset: 0, id: 'bad"id' }];
    expect(() => buildVaultExport(input, MAX)).toThrow('block');
    expect(() => buildVaultExport(capture({ 'A.md': 'a', 'a.md': 'b' }), MAX)).toThrow('collisions');
    expect(() => buildVaultExport({ files: { 'a.md': btoa('\xff') }, links: [], blocks: {}, excluded: 0 }, MAX)).toThrow('UTF-8');
  });

  it('distinguishes empty notes from an empty vault and enforces generated output limits', () => {
    expect(buildVaultExport(capture({ 'a.md': '' }), MAX).files['vault/a.md']).toBe('');
    expect(() => buildVaultExport(capture({}), MAX)).toThrow('no supported');
    expect(() => buildVaultExport(capture({ 'a.md': 'A' }), 5)).toThrow('size limit');
  });

  it('escapes Markdown labels and encodes URL punctuation instead of emitting unsafe links', () => {
    const text = '[[b|<img> [x]]]';
    const input = capture({ 'a.md': text, 'b.md': 'B' }, [ref('a.md', text, text, 'b.md', '<img> [x]')]);
    const plan = buildVaultExport(input, MAX);
    expect(toText(plan.files['browse/a.md']!)).toContain('[&lt;img&gt; \\[x\\]](b.md)');
    expect(relativeURL('browse/a.md', 'browse/a (b)#.md')).toBe('a%20%28b%29%23.md');
  });
});
