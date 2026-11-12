import { describe, expect, it } from 'vitest';
import page from '../../src/pages/writing/no-phi/demo.astro?raw';
import css from '../../src/styles/no-phi-demo.css?raw';

// The demo's promise is that it cannot send anything. This scan reads its source as text.
const scriptSources = import.meta.glob<string>('../../src/scripts/no-phi/*.ts', { query: '?raw', import: 'default', eager: true });
const sources = new Map<string, string>();
for (const [path, text] of Object.entries(scriptSources)) sources.set(path.replace('../../', ''), text);
const scripts = [...sources.keys()];
sources.set('src/pages/writing/no-phi/demo.astro', page);
sources.set('src/styles/no-phi-demo.css', css);
const files = [...sources.keys()];
const read = (f: string): string => {
  const text = sources.get(f);
  if (text === undefined) throw new Error(`not loaded: ${f}`);
  return text;
};
const MAIN = 'src/scripts/no-phi/main.ts';

describe('no-PHI demo: source scan', () => {
  it('finds the files', () => {
    expect(scripts.length).toBe(4);
  });

  for (const word of ['XMLHttpRequest', 'WebSocket', 'sendBeacon', 'EventSource', 'import(', 'localStorage', 'sessionStorage', 'indexedDB', 'document.cookie']) {
    it(`no file contains ${word}`, () => {
      for (const f of files) expect(read(f).includes(word), `${f} contains ${word}`).toBe(false);
    });
  }

  it('exactly one call to the network function, in main.ts, to the reserved address', () => {
    const needle = 'fetch' + '(';
    const hits = files.filter((f) => read(f).includes(needle));
    expect(hits).toEqual([MAIN]);
    expect(read(MAIN).split(needle).length - 1).toBe(1);
    expect(read(MAIN)).toContain(needle + '"https://example.invalid/"');
  });

  it('the page has no style attribute, on* attribute or outside address', () => {
    const page = read('src/pages/writing/no-phi/demo.astro');
    expect(page).not.toMatch(/\sstyle\s*=/i);
    expect(page).not.toMatch(/\son[a-z]+\s*=/i);
    expect(page).not.toMatch(/(?:src|href)\s*=\s*"(?:https?:)?\/\//i);
  });

  it('the sample generator is seeded, not random', () => {
    for (const f of scripts) expect(read(f).includes('Math.random'), f).toBe(false);
  });
});
