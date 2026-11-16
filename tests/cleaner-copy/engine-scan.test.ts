import { describe, expect, it } from 'vitest';

// The engine promises that it cannot send anything anywhere and keeps nothing. This scan reads every file of it as text.
const loaded = import.meta.glob<string>('../../src/scripts/cleaner-copy/engine/*', { query: '?raw', import: 'default', eager: true });
const sources = new Map<string, string>();
for (const [path, text] of Object.entries(loaded)) sources.set(path.replace('../../src/scripts/cleaner-copy/engine/', ''), text);
const files = [...sources.keys()].sort();
const read = (f: string): string => {
  const text = sources.get(f);
  if (text === undefined) throw new Error(`not loaded: ${f}`);
  return text;
};
// The sample workbook is stored as one long line of letters and digits; it is read for the banned code, not for wording.
const written = files.filter((f) => f !== 'sample.js');

describe('Cleaner Copy engine: source scan', () => {
  it('finds every file of the engine', () => {
    expect(files).toEqual(['check.js', 'code.js', 'connections.js', 'csv.js', 'describe.js', 'fake.js', 'index.d.ts', 'index.js', 'kind.js', 'rename.js', 'sample.js', 'workbook.js', 'xml.js', 'zip.d.ts', 'zip.js']);
  });

  // Each of these could send something out of the page, or keep something after it closes.
  for (const word of ['fetch' + '(', 'XMLHttp' + 'Request', 'Web' + 'Socket', 'send' + 'Beacon', 'Event' + 'Source', 'import' + 'Scripts', 'document' + '.cookie', 'local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB']) {
    it(`no file contains ${word}`, () => {
      for (const f of files) expect(read(f).includes(word), `${f} contains ${word}`).toBe(false);
    });
  }

  it('no file loads code or data from anywhere but the engine itself', () => {
    for (const f of files) {
      for (const m of read(f).matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) expect(/^\.\/[\w-]+\.js$/.test(m[1] ?? ''), `${f} loads ${m[1]}`).toBe(true);
      expect(/\bimport\s*\(/.test(read(f)), `${f} loads code while running`).toBe(false);
      expect(/\b(?:eval|Function)\s*\(/.test(read(f)), `${f} runs text as code`).toBe(false);
      expect(/https?:\/\/(?!example\.invalid\/|schemas\.)/.test(read(f)), `${f} names a web address`).toBe(false);
    }
  });

  it('no message or comment uses a word the site does not use', () => {
    const banned = /\b(?:best|worst|highest|lowest|anonymi[sz]ed|de-identified|safe|HIPAA|proof)\b|\btop\s/i;
    for (const f of written) {
      const hit = banned.exec(read(f));
      expect(hit === null, `${f} says "${hit?.[0]}"`).toBe(true);
    }
  });

  it('no file holds an email address', () => {
    for (const f of written) expect(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(read(f)), `${f} holds an email address`).toBe(false);
  });
});
