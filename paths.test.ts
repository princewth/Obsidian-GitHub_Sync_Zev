import { describe, expect, it } from 'vitest';
import { checkCollisions, parseRepoURL, resolveTreeURL, safePath, supported, validateBranch } from '../src/paths';

describe('repository URL and path boundaries', () => {
  it('accepts HTTPS repository and folder URLs without assuming the default branch is main', () => {
    expect(parseRepoURL('https://github.com/example/notes.git')).toEqual({ owner: 'example', repo: 'notes', treeTail: [] });
    expect(resolveTreeURL([], ['trunk'], 'trunk')).toEqual({ branch: 'trunk', remotePath: '' });
    const parsed = parseRepoURL('https://github.com/example/notes/tree/feature/docs/notes');
    expect(resolveTreeURL(parsed.treeTail, ['feature', 'feature/docs'], 'trunk')).toEqual({ branch: 'feature/docs', remotePath: 'notes' });
  });

  it.each([
    'http://github.com/example/notes',
    'https://example.com/example/notes',
    'https://token@github.com/example/notes',
    'https://github.com/example/notes?token=hidden',
    'https://github.com/example/notes#fragment',
    'https://github.com/example/notes/blob/main/a.md',
    'obsidian://show-plugin?id=github-sync',
    'https://github.com/example/notes/tree'
  ])('rejects credential-bearing or unsupported URL %s', url => {
    expect(() => parseRepoURL(url)).toThrow();
  });

  it.each(['../a.md', '/a.md', 'a/../../b.md', 'a\\b.md', '.obsidian/settings.json', 'a/.git/config', 'a//b.md', 'CON.md', 'a/NUL', 'a.md ', 'a\0.md', 'a:b.md'])('rejects unsafe path %s', path => {
    expect(() => safePath(path)).toThrow();
  });

  it('supports Markdown and ordinary attachments but excludes secrets and executable/configuration files', () => {
    for (const path of ['notes/你好.md', 'a.markdown', 'board.canvas', 'table.base', 'assets/image.png', 'manual.pdf']) expect(supported(path)).toBe(true);
    for (const path of ['.env', '.env.local', '.obsidian/plugins/plugin/data.json', '.ssh/id_rsa', 'credentials.txt', 'secret.md', 'secrets.csv', 'private.key', 'run.js', 'settings.json', 'node_modules/.bin/run']) expect(supported(path)).toBe(false);
  });

  it('blocks case, Unicode-normalization, and file/folder collisions', () => {
    expect(() => checkCollisions(['A.md', 'a.md'])).toThrow();
    expect(() => checkCollisions(['é.md', 'e\u0301.md'])).toThrow();
    expect(() => checkCollisions(['a.md', 'a.md/b.md'])).toThrow();
    expect(() => checkCollisions(['a.md', 'nested/b.md'])).not.toThrow();
  });

  it.each(['', '../main', 'main..backup', 'main.lock', 'main/../docs', 'main@{0}', 'main with space', 'main?', '/main', 'main/'])('rejects invalid branch %s', branch => {
    expect(() => validateBranch(branch)).toThrow();
  });
});
