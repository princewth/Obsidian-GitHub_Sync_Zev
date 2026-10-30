import { UserError } from './types';
export const VAULT_ARCHIVE_ROOT = 'Obsidian-Vaults';

const TEXT = new Set(['md', 'markdown', 'txt', 'csv', 'canvas', 'base']);
const ASSETS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg', 'pdf', 'mp3', 'mp4', 'wav', 'ogg', 'webm', 'm4a']);
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i;
const SENSITIVE = /^(?:credentials?|secrets?|id_rsa|id_ed25519|service[-_]account)(?:\.|$)/i;

export function safePath(value: string, allowEmpty = false): string {
  const path = value.replace(/\/$/, '');
  if (!path && allowEmpty) return '';
  if (!path || path.length > 1000 || /[\\\u0000-\u001f\u007f]/.test(path)) throw new UserError('Use a relative folder or file path.');
  for (const part of path.split('/')) {
    if (!part || part === '.' || part === '..' || part.startsWith('.') || /[<>:"|?*]/.test(part) || /[. ]$/.test(part) || RESERVED.test(part)) {
      throw new UserError('Hidden, reserved, absolute, or unsafe paths cannot be connected.');
    }
  }
  return path;
}

export function extension(path: string): string { return path.split('.').pop()?.toLowerCase() ?? ''; }
export function isText(path: string): boolean { return TEXT.has(extension(path)); }

export function supported(path: string): boolean {
  try { safePath(path); } catch { return false; }
  if (path.split('/').some(part => part.toLowerCase() === VAULT_ARCHIVE_ROOT.toLowerCase())) return false;
  if (path.split('/').some(part => SENSITIVE.test(part))) return false;
  return TEXT.has(extension(path)) || ASSETS.has(extension(path));
}

export function inFolder(path: string, root: string): boolean { return path === root || path.startsWith(`${root}/`); }
export function join(root: string, path: string): string { return root ? `${root}/${path}` : path; }

export function checkCollisions(paths: string[]): void {
  const seen = new Set<string>();
  const files = new Set(paths.map(path => path.normalize('NFC').toLowerCase()));
  for (const path of paths) {
    safePath(path);
    const canonical = path.normalize('NFC').toLowerCase();
    if (seen.has(canonical)) throw new UserError('Case or Unicode filename collisions must be resolved before sync.');
    seen.add(canonical);
    const parts = canonical.split('/');
    parts.pop();
    while (parts.length) {
      if (files.has(parts.join('/'))) throw new UserError('A file and a folder use the same path. Resolve the collision before sync.');
      parts.pop();
    }
  }
}

export function validateIdentity(owner: string, repo: string): void {
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/.test(owner) || !/^[a-zA-Z0-9_.-]{1,100}$/.test(repo) || repo === '.' || repo === '..') {
    throw new UserError('Enter a valid GitHub owner and repository.');
  }
}

export function validateBranch(branch: string): void {
  if (!branch || branch.length > 255 || /[\s~^:?*\[\\\u0000-\u001f\u007f]/.test(branch) || branch.includes('..') || branch.includes('@{') || branch.startsWith('/') || branch.endsWith('/') || branch.endsWith('.') || branch.split('/').some(p => !p || p.startsWith('.') || p.endsWith('.lock'))) {
    throw new UserError('Enter a valid branch name.');
  }
}

export interface ParsedRepo { owner: string; repo: string; treeTail: string[]; }
export function parseRepoURL(input: string): ParsedRepo {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new UserError('Paste an HTTPS github.com repository or folder URL.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash) {
    throw new UserError('Use an HTTPS github.com URL without credentials, query parameters, or fragments.');
  }
  let parts: string[];
  try { parts = url.pathname.replace(/\/$/, '').split('/').slice(1).map(decodeURIComponent); } catch { throw new UserError('The GitHub URL contains invalid encoding.'); }
  const [owner = '', rawRepo = '', kind, ...tail] = parts;
  const repo = rawRepo.replace(/\.git$/, '');
  validateIdentity(owner, repo);
  if (kind && kind !== 'tree') throw new UserError('Use a repository URL or a /tree/ branch folder URL.');
  if (kind === 'tree' && !tail.length) throw new UserError('The folder URL is missing its branch.');
  return { owner, repo, treeTail: tail };
}

// Branch names may contain slashes: match real branches, longest first.
export function resolveTreeURL(tail: string[], branches: string[], defaultBranch: string): { branch: string; remotePath: string } {
  if (!tail.length) return { branch: defaultBranch, remotePath: '' };
  const full = tail.join('/');
  const branch = [...branches].sort((a, b) => b.length - a.length).find(b => full === b || full.startsWith(`${b}/`));
  if (!branch) throw new UserError('The folder URL does not match a repository branch. Select the branch explicitly.');
  return { branch, remotePath: safePath(full.slice(branch.length).replace(/^\//, ''), true) };
}
