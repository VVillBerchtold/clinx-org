import { describe, expect, it } from 'vitest';
import page from '../../src/pages/tools/file-check/index.astro?raw';
import css from '../../src/styles/file-check.css?raw';

// File Check promises that a file never leaves the computer, that nothing in it is changed and
// that nothing is kept. This scan reads the page, its scripts and its styles as text and looks for
// anything that could break that.
const scriptSources = import.meta.glob<string>('../../src/scripts/file-check/*.ts', { query: '?raw', import: 'default', eager: true });
const sources = new Map<string, string>();
for (const [path, text] of Object.entries(scriptSources)) sources.set(path.replace('../../', ''), text);
const scripts = [...sources.keys()];
sources.set('src/pages/tools/file-check/index.astro', page);
sources.set('src/styles/file-check.css', css);
const files = [...sources.keys()];
const read = (f: string): string => {
  const text = sources.get(f);
  if (text === undefined) throw new Error(`not loaded: ${f}`);
  return text;
};

describe('File Check: source scan of the page', () => {
  it('finds the page scripts', () => {
    expect(scripts.sort()).toEqual(['src/scripts/file-check/main.ts', 'src/scripts/file-check/protocol.ts', 'src/scripts/file-check/sample.ts', 'src/scripts/file-check/worker.ts']);
  });

  for (const word of ['fetch' + '(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'EventSource', 'importScripts', 'import(', 'localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'innerHTML', 'eval(']) {
    it(`no file contains ${word}`, () => {
      for (const f of files) expect(read(f).includes(word), `${f} contains ${word}`).toBe(false);
    });
  }

  it('the page has no style attribute, on* attribute or outside address', () => {
    expect(/\sstyle=/.test(page)).toBe(false);
    expect(/\son[a-z]+=/.test(page)).toBe(false);
    expect(/https?:\/\//.test(page)).toBe(false);
  });

  it('the only outside addresses in the scripts are the names of two file formats', () => {
    // These are names written inside a workbook or a drawing. Nothing is fetched from them.
    const formatNames = ['http://schemas.openxmlformats.org/', 'http://www.w3.org/2000/svg'];
    for (const f of scripts) {
      const addresses = read(f).match(/https?:\/\/[^\s'"`<]+/g) ?? [];
      for (const address of addresses) expect(formatNames.some((name) => address.startsWith(name)), `${f} names ${address}`).toBe(true);
    }
  });

  it('the styles take every colour from the tokens', () => {
    expect(/#[0-9a-fA-F]{3,8}\b/.test(css)).toBe(false);
    expect(/\brgba?\(|\bhsla?\(/.test(css)).toBe(false);
    expect(/url\(/.test(css)).toBe(false);
  });

  it('the only worker is the one from this folder', () => {
    const main = read('src/scripts/file-check/main.ts');
    expect(main.split('new Worker(').length - 1).toBe(1);
    expect(main).toContain("new Worker(new URL('./worker.ts', import.meta.url)");
  });

  it('the worker asks for the kind of file without loading the other tool', () => {
    const worker = read('src/scripts/file-check/worker.ts');
    expect(worker).toContain("from '../cleaner-copy/engine/kind.js'");
    expect(worker).not.toContain("cleaner-copy/engine/index");
  });

  it('every element the script asks for by id is on the page', () => {
    const main = read('src/scripts/file-check/main.ts');
    const asked = new Set([...main.matchAll(/byId(?:<[^>]+>)?\('([a-z0-9-]+)'/g)].map((m) => m[1] ?? ''));
    expect(asked.size).toBeGreaterThan(15);
    for (const id of asked) expect(page.includes(`id="${id}"`), `the page has no #${id}`).toBe(true);
  });

  it('the page never promises more than the tool does', () => {
    for (const text of [page, read('src/scripts/file-check/main.ts')]) {
      expect(/anonymi[sz]ed|de-identified|HIPAA|\bsafe\b|\bsecure\b|guarantee|virus/i.test(text)).toBe(false);
    }
  });
});
