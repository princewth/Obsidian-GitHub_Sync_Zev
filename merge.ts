import { diff3Merge } from 'node-diff3';
import { fromText, toText } from './bytes';

export function mergeText(local: string, base: string, remote: string): string | null {
  try {
    const lines = (content: string): string[] => toText(content).match(/[^\n]*\n|[^\n]+$/g) ?? [];
    const blocks = diff3Merge(lines(local), lines(base), lines(remote));
    let merged = '';
    for (const block of blocks) {
      if (block.conflict || !block.ok) return null;
      merged += block.ok.join('');
    }
    return fromText(merged);
  } catch { return null; }
}
