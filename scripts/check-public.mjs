import { readFile } from 'node:fs/promises';
import { publicFiles, releaseFiles } from './public-files.mjs';

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const versions = JSON.parse(await readFile('versions.json', 'utf8'));
if (typeof manifest.name !== 'string' || manifest.name !== manifest.name.trim() || !/^[A-Za-z0-9 ()+-]+$/.test(manifest.name) || /\b(?:obsidian|plugin)\b|\bobsi-|-sidian\b/i.test(manifest.name)) {
  throw new Error('Plugin display name must follow the Obsidian manifest naming guidelines. Use Basic Latin letters/numbers/spaces and only hyphens, plus signs, or parentheses as punctuation.');
}
if (!/^[a-z]+(?:-[a-z]+)*$/.test(manifest.id) || manifest.id.includes('obsidian') || manifest.id.endsWith('plugin')) throw new Error('Plugin ID must follow the Obsidian manifest guidelines.');
if (manifest.id !== 'github-sync-zev' || manifest.author !== 'Zev' || manifest.name !== 'GitHub Sync - Zev') throw new Error('Unexpected public plugin identity.');
if (manifest.version !== pkg.version || versions[manifest.version] !== manifest.minAppVersion) throw new Error('Release version metadata is inconsistent.');
if (manifest.minAppVersion !== '1.11.4' || manifest.isDesktopOnly !== false) throw new Error('Recheck runtime compatibility before changing the manifest.');

const patterns = [
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /github_pat_[A-Za-z0-9_]{30,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /AKIA[A-Z0-9]{16}/,
  /https?:\/\/[^\s/]+:[^\s/@]+@/,
  /\/(?:Users|home|workspace)\/[A-Za-z0-9_.-]+\//,
  /(?:api[_-]?key|access[_-]?token|password)\s*[:=]\s*["'][A-Za-z0-9_+/=-]{24,}["']/i
];
const sourceFiles = await publicFiles();
const files = [...new Set([...sourceFiles, ...releaseFiles])];
for (const file of files) {
  if (/(^|\/)(?:data\.json|\.env(?:\..*)?|\.npmrc)$|\.(?:pem|key|log|map)$/.test(file)) throw new Error('A private or generated file is in the public source allowlist.');
  const text = await readFile(file, 'utf8');
  if (patterns.some(pattern => pattern.test(text))) throw new Error(`Potential sensitive material detected in ${file}. Values are intentionally not printed.`);
}
const runtime = (await Promise.all(sourceFiles.filter(file => file.startsWith('src/')).map(file => readFile(file, 'utf8')))).join('\n');
if (/console\.(log|warn|error|debug)\s*\(|\.saveData\s*\(/.test(runtime)) throw new Error('Runtime logs or vault-backed settings require privacy review.');
console.log(`Public identity, release metadata, and ${files.length} allowlisted files passed privacy checks.`);
