import { describe, expect, it } from 'vitest';
import page from '../../src/pages/tools/cleaner-copy/index.astro?raw';
import css from '../../src/styles/cleaner-copy.css?raw';
import article from '../../src/content/cleaner-copy.md?raw';

// Cleaner Copy promises that a file never leaves the computer and that nothing is kept.
// This scan reads the page, its scripts and its styles as text and looks for anything that could break that.
const scriptSources = import.meta.glob<string>('../../src/scripts/cleaner-copy/*.ts', { query: '?raw', import: 'default', eager: true });
const sources = new Map<string, string>();
for (const [path, text] of Object.entries(scriptSources)) sources.set(path.replace('../../', ''), text);
const scripts = [...sources.keys()];
sources.set('src/pages/tools/cleaner-copy/index.astro', page);
sources.set('src/styles/cleaner-copy.css', css);
const files = [...sources.keys()];
const read = (f: string): string => {
  const text = sources.get(f);
  if (text === undefined) throw new Error(`not loaded: ${f}`);
  return text;
};

describe('Cleaner Copy: source scan of the page', () => {
  it('finds the page scripts', () => {
    expect(scripts.sort()).toEqual(['src/scripts/cleaner-copy/main.ts', 'src/scripts/cleaner-copy/protocol.ts', 'src/scripts/cleaner-copy/worker.ts']);
  });

  for (const word of ['fetch' + '(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'EventSource', 'importScripts', 'import(', 'localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'innerHTML', 'eval(']) {
    it(`no file contains ${word}`, () => {
      for (const f of files) expect(read(f).includes(word), `${f} contains ${word}`).toBe(false);
    });
  }

  it('the page has no style attribute, on* attribute or outside address', () => {
    const text = read('src/pages/tools/cleaner-copy/index.astro');
    expect(/\sstyle=/.test(text)).toBe(false);
    expect(/\son[a-z]+=/.test(text)).toBe(false);
    expect(/https?:\/\//.test(text)).toBe(false);
  });

  it('the styles take every colour from the tokens', () => {
    const text = read('src/styles/cleaner-copy.css');
    expect(/#[0-9a-fA-F]{3,8}\b/.test(text)).toBe(false);
    expect(/\brgba?\(|\bhsla?\(/.test(text)).toBe(false);
    expect(/url\(/.test(text)).toBe(false);
  });

  it('the only worker is the one from this folder', () => {
    const main = read('src/scripts/cleaner-copy/main.ts');
    expect(main.split('new Worker(').length - 1).toBe(1);
    expect(main).toContain("new Worker(new URL('./worker.ts', import.meta.url)");
  });

  it('the page and the article never promise more than the tool does', () => {
    for (const text of [page, article, read('src/scripts/cleaner-copy/main.ts')]) {
      expect(/anonymi[sz]ed|de-identified|HIPAA|\bsafe\b|\bsecure\b|guarantee/i.test(text)).toBe(false);
    }
  });
});
