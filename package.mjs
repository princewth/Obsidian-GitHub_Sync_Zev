import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';
import { publicFiles, releaseFiles } from './public-files.mjs';

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const prefix = `${manifest.id}-${manifest.version}`;
await mkdir('dist', { recursive: true });
const release = {}, source = {};
const fixedDate = new Date('2026-01-01T00:00:00Z');
const zipEntry = bytes => [bytes, { mtime: fixedDate }];
for (const file of releaseFiles) {
  const bytes = new Uint8Array(await readFile(file));
  release[`${manifest.id}/${file}`] = zipEntry(bytes);
  await writeFile(`dist/${file}`, bytes);
}
for (const file of await publicFiles()) source[`${manifest.id}-source/${file}`] = zipEntry(new Uint8Array(await readFile(file)));
release[`${manifest.id}/INSTALL.txt`] = zipEntry(strToU8('Close Obsidian. Copy this folder into <vault>/.obsidian/plugins/, then enable GitHub Sync - Zev under Community plugins. Minimum Obsidian: 1.11.4.\n'));
await writeFile(`dist/${prefix}.zip`, zipSync(release, { level: 9 }));
await writeFile(`dist/${prefix}-source.zip`, zipSync(source, { level: 9 }));
const artifacts = [...releaseFiles, `${prefix}.zip`, `${prefix}-source.zip`];
const sums = [];
for (const file of artifacts.sort()) sums.push(`${createHash('sha256').update(await readFile(`dist/${file}`)).digest('hex')}  ${file}`);
await writeFile('dist/SHA256SUMS', `${sums.join('\n')}\n`);
console.log(`Created installable and source archives for ${manifest.name} ${manifest.version}. Only allowlisted files were included.`);
