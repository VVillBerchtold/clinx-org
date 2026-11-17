import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SITE_URL } from '../src/lib/site';
import core from '../worker/mcp/core.js?raw';

/**
 * The server for assistants names its icon by address: two pictures of the ClinX mark that this site
 * serves from public/brand/. The server's own tests cannot see this site's files, so this one checks
 * that each address it names is a file here, and that the PNG is the size the server says it is.
 * A picture that is renamed or moved fails here before a client is sent to an address that is gone.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const named = [...core.matchAll(/src: '(https:\/\/[^']+)', mimeType: '([^']+)', sizes: \['([^']+)'\]/g)].map((m) => ({ src: m[1]!, mimeType: m[2]!, size: m[3]! }));

describe('the icon the server for assistants names', () => {
  it('is two pictures on this site: a PNG first, then an SVG', () => {
    expect(named.map((icon) => icon.mimeType)).toEqual(['image/png', 'image/svg+xml']);
    for (const icon of named) expect(icon.src.startsWith(`${SITE_URL}/brand/`)).toBe(true);
  });

  it('names files this site serves', () => {
    for (const icon of named) expect(existsSync(join(root, 'public', icon.src.slice(SITE_URL.length))), icon.src).toBe(true);
  });

  it('gives the PNG the size it really is, and the SVG as any size', () => {
    const [png, svg] = named;
    // A PNG states its width and height in its first block, at fixed places: bytes 16 to 19 and 20 to 23, as hex.
    const hex = readFileSync(join(root, 'public', png!.src.slice(SITE_URL.length)), 'hex');
    const width = parseInt(hex.slice(32, 40), 16);
    const height = parseInt(hex.slice(40, 48), 16);
    expect(hex.slice(0, 16)).toBe('89504e470d0a1a0a');
    expect(`${width}x${height}`).toBe(png!.size);
    expect(png!.size).toBe('1024x1024');
    expect(svg!.size).toBe('any');
    expect(readFileSync(join(root, 'public', svg!.src.slice(SITE_URL.length)), 'utf8').startsWith('<svg ')).toBe(true);
  });
});
