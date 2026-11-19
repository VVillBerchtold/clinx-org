import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import savedCopies from '../../src/lib/saved-copies.json';
import page from '../../src/pages/tools/file-check/index.astro?raw';
import headers from '../../public/_headers?raw';
import { SAMPLE_ANSWER } from '../../src/scripts/file-check/selftest';

// The saved copy of File Check is one file that holds the whole tool. It is kept in public/ and
// is not remade by a build, so it stays the same until someone replaces it on purpose. These
// checks hold the file to its record: the fingerprint, and the rule that it can open no connection.
const record = savedCopies['file-check'];
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bytes = readFileSync(join(root, 'public', record.file));
const text = new TextDecoder().decode(bytes);
const sha256 = (data: string | Uint8Array, how: 'hex' | 'base64'): string => createHash('sha256').update(data).digest(how);
const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(text)?.[1] ?? '';

describe('File Check: the saved copy', () => {
  it('is the file on record, byte for byte', () => {
    expect(sha256(bytes, 'hex')).toBe(record.sha256);
    expect(bytes.length).toBe(record.bytes);
    expect(record.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('may open no connection, and may run only what is written into it', () => {
    for (const rule of ["default-src 'none'", "connect-src 'none'", "base-uri 'none'", "form-action 'none'", 'font-src data:', 'worker-src blob:']) expect(policy, rule).toContain(rule);
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval|https?:|\*|'self'/);
    const scripts = [...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, attrs, code] of scripts) {
      expect(attrs).toBe(' type="module"');
      expect(policy).toContain(`'sha256-${sha256(code ?? '', 'base64')}'`);
    }
    const styles = [...text.matchAll(/<style>([\s\S]*?)<\/style>/g)];
    expect(styles.length).toBe(1);
    expect(policy).toContain(`style-src 'sha256-${sha256(styles[0]?.[1] ?? '', 'base64')}'`);
  });

  it('names no other file', () => {
    expect(text).not.toMatch(/\ssrc=/);
    expect(text).not.toContain('/_astro/');
    expect(text).not.toMatch(/\b(?:href|action)="\/(?!\/)/);
    expect(text).not.toMatch(/<link\b[^>]*rel="(?:stylesheet|icon|preload)"/);
    for (const [, address] of text.matchAll(/url\(([^)]*)\)/g)) expect(address?.startsWith('data:font/woff2;base64,')).toBe(true);
  });

  it('says what it is, and carries the test it runs on itself', () => {
    expect(text).toContain(`<strong>Saved copy.</strong> File Check, version ${record.version}, made `);
    expect(text).toContain('https://clinx.org/tools/file-check/');
    expect(text).not.toContain('id="fc-keep"');
    expect(text).toContain('Passed its own test on the built-in sample');
    // The copy on record may be older than the tool. When the answer the tool expects changes, the copy is due to be remade.
    expect(text, 'the saved copy expects another answer from its sample than the tool does now: remake it with a new version').toContain(SAMPLE_ANSWER);
  });

  it('is offered on the page with its fingerprint, and is sent as a download under its own name', () => {
    expect(page).toContain('<a class="btn" href={saved.file} download={saved.savedAs}>');
    expect(page).toContain('{saved.sha256}');
    expect(record.file).toBe('/tools/file-check/clinx-file-check.html.bin');
    const rule = headers.slice(headers.indexOf(`\n${record.file}\n`));
    expect(rule).toContain('Content-Type: application/octet-stream');
    expect(rule).toContain(`Content-Disposition: attachment; filename="${record.savedAs}"`);
  });
});
