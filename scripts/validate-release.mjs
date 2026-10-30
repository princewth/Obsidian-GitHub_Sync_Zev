import { readFile } from 'node:fs/promises';
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Use a plain semantic version.');
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== manifest.version) throw new Error('The Git tag must exactly match manifest.json, without a v prefix.');
console.log('Release tag matches the plugin version.');
