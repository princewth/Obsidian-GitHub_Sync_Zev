export function encode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function decode(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
}

export function fromText(text: string): string { return encode(new TextEncoder().encode(text)); }
export function toText(base64: string): string { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(decode(base64)); }
export function asBuffer(bytes: Uint8Array): ArrayBuffer { return bytes.slice().buffer as ArrayBuffer; }

export async function blobSha(base64: string): Promise<string> {
  const bytes = decode(base64);
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const data = new Uint8Array(header.length + bytes.length);
  data.set(header); data.set(bytes, header.length);
  const hash = await crypto.subtle.digest('SHA-1', asBuffer(data));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}
