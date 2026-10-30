import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const rootFiles = [
  '.gitattributes', '.gitignore', 'package.json', 'package-lock.json', 'manifest.json',
  'versions.json', 'LICENSE', 'README.md', 'README.zh-HK.md', 'PRIVACY.md',
  'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'THIRD_PARTY_NOTICES.md',
  'esbuild.config.mjs', 'tsconfig.json', 'vitest.config.ts', 'styles.css'
];
export const releaseFiles = ['main.js', 'manifest.json', 'styles.css', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'README.zh-HK.md', 'PRIVACY.md'];

export async function publicFiles() {
  const files = [...rootFiles];
  async function walk(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name).replaceAll('\\', '/');
      if (item.isSymbolicLink()) throw new Error('Public source cannot contain symbolic links.');
      if (item.isDirectory()) await walk(path);
      else files.push(path);
    }
  }
  for (const directory of ['src', 'tests', 'scripts', 'docs', '.github']) await walk(directory);
  return files.sort();
}
