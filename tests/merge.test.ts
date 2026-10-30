import { describe, expect, it } from 'vitest';
import { blobSha, decode, encode, fromText, toText } from '../src/bytes';
import { mergeText } from '../src/merge';

describe('byte and text merge fidelity', () => {
  it('round-trips Unicode and binary bytes, including empty files', () => {
    expect(toText(fromText('廣東話 📝\r\n'))).toBe('廣東話 📝\r\n');
    expect(toText(fromText(''))).toBe('');
    const binary = Uint8Array.from([0, 1, 127, 128, 255]);
    expect(decode(encode(binary))).toEqual(binary);
  });

  it('uses Git blob hashing rather than a plain file-content hash', async () => {
    expect(await blobSha(fromText(''))).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    expect(await blobSha(fromText('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });

  it('preserves a UTF-8 byte order mark and a missing terminal newline', () => {
    expect(toText(fromText('\ufeffhello'))).toBe('\ufeffhello');
    const merged = mergeText(fromText('ONE\ntwo\nthree'), fromText('one\ntwo\nthree'), fromText('one\ntwo\nTHREE'));
    expect(toText(merged!)).toBe('ONE\ntwo\nTHREE');
  });

  it('does not treat identical edits on both sides as a conflict', () => {
    const merged = mergeText(fromText('same\n'), fromText('base\n'), fromText('same\n'));
    expect(toText(merged!)).toBe('same\n');
  });

  it('retains overlapping edits and invalid UTF-8 as conflicts', () => {
    expect(mergeText(fromText('local'), fromText('base'), fromText('remote'))).toBeNull();
    expect(mergeText(btoa('\xff'), fromText('base'), fromText('remote'))).toBeNull();
  });
});
