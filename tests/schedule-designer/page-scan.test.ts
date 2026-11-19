import { describe, expect, it } from 'vitest';
import page from '../../src/pages/tools/schedule-designer/index.astro?raw';
import css from '../../src/styles/schedule-designer.css?raw';
import article from '../../src/content/schedule-designer.md?raw';
import standalone from '../../scripts/standalone.mjs?raw';
import headers from '../../public/_headers?raw';

// Schedule Designer says that it opens no connection and keeps nothing unless the person chooses
// otherwise. The one thing they can choose is for the browser to remember their file: one record
// with three fields, written by one module (remember.ts).
// This scan reads the page, its scripts and its styles as text and looks for anything that could break that.
// The engine in the folder below has its own scan (source-scan.test.ts).
const scriptSources = import.meta.glob<string>('../../src/scripts/schedule-designer/*.ts', { query: '?raw', import: 'default', eager: true });
const sources = new Map<string, string>();
for (const [path, text] of Object.entries(scriptSources)) sources.set(path.replace('../../', ''), text);
const scripts = [...sources.keys()];
sources.set('src/pages/tools/schedule-designer/index.astro', page);
sources.set('src/styles/schedule-designer.css', css);
const files = [...sources.keys()];
const read = (f: string): string => {
  const text = sources.get(f);
  if (text === undefined) throw new Error(`not loaded: ${f}`);
  return text;
};

describe('Schedule Designer: source scan of the page', () => {
  it('finds the page scripts', () => {
    expect(scripts.map((f) => f.replace('src/scripts/schedule-designer/', '')).sort()).toEqual([
      'add-say.ts',
      'check-say.ts',
      'design-palette.ts',
      'design-tally.ts',
      'design-views.ts',
      'design-week.ts',
      'design.ts',
      'dom.ts',
      'dropdown-keys.ts',
      'dropdown.ts',
      'group.ts',
      'intent.ts',
      'kept.ts',
      'main.ts',
      'people-say.ts',
      'print.ts',
      'remember.ts',
      'same.ts',
      'setup-kinds.ts',
      'setup-parts.ts',
      'setup-people.ts',
      'setup-work.ts',
      'slots.ts',
      'state.ts',
      'step-save.ts',
      'step-setup.ts',
      'step-start.ts',
      'team-say.ts',
      'week-draw.ts',
      'wire.ts',
      'work-say.ts',
    ]);
  });

  // No connection, no storage, and nothing that turns text into code or markup. The browser's
  // database is the one exception, in the one module named below.
  const REMEMBER = 'src/scripts/schedule-designer/remember.ts';
  const DATABASE_WORD = 'indexed' + 'DB';
  const words = [
    'fetch' + '(',
    'XMLHttpRequest',
    'WebSocket',
    'sendBeacon',
    'EventSource',
    'importScripts',
    'import(',
    'new Worker',
    'localStorage',
    'sessionStorage',
    DATABASE_WORD,
    'document.cookie',
    'cookieStore',
    'caches.',
    'serviceWorker',
    'innerHTML',
    'outerHTML',
    'insertAdjacentHTML',
    'document.write',
    'eval(',
    'new Function',
  ];
  for (const word of words) {
    it(`no file contains ${word}`, () => {
      for (const f of files) {
        if (word === DATABASE_WORD && f === REMEMBER) continue;
        expect(read(f).includes(word), `${f} contains ${word}`).toBe(false);
      }
    });
  }

  it('one module names the database, and it writes one record with three fields', () => {
    const text = read(REMEMBER);
    expect(text.includes(DATABASE_WORD)).toBe(true);
    // One database, by one name, opened in one place.
    expect([...text.matchAll(/'clinx-[^']*'/g)].map((m) => m[0])).toEqual(["'clinx-schedule-designer'"]);
    expect(text.split('.open(').length - 1).toBe(1);
    expect(text.includes('.open(DATABASE, 1)')).toBe(true);
    expect(text.split('createObjectStore(').length - 1).toBe(1);
    // One write, and what it writes is spelled out field by field: the handle, the name, the time.
    const writes = [...text.matchAll(/\.(?:put|add)\(([^;]*)\);/g)].map((m) => m[1]);
    expect(writes).toEqual(['{ handle: record.handle, name: record.name, when: record.when }, KEY)']);
    // Nothing is spread or copied whole into the record.
    expect(/\.\.\.|Object\.assign|structuredClone|JSON\./.test(text)).toBe(false);
    // The schedule never comes near this module: it knows the file handle type and nothing else.
    expect([...text.matchAll(/from '([^']+)'/g)].map((m) => m[1])).toEqual(['./state']);
    expect(/import type \{ FileHandle \} from '\.\/state';/.test(text)).toBe(true);
    expect(/import \{/.test(text)).toBe(false);
  });

  it('no other file writes to a database', () => {
    for (const f of scripts) {
      if (f === REMEMBER) continue;
      expect(/\.put\(|createObjectStore|deleteDatabase|IDB[A-Z]/.test(read(f)), f).toBe(false);
    }
  });

  it('the promise about keeping is in the words the owner chose', () => {
    expect(page.split('Keeps nothing unless you choose otherwise').length - 1).toBe(1);
    expect(/Keeps nothing afterwards/.test(page)).toBe(false);
  });

  it('the scripts reach the engine only through its front door', () => {
    for (const f of scripts) {
      const from = [...read(f).matchAll(/from '([^']+)'/g)].map((m) => m[1] ?? '');
      for (const path of from) {
        expect(path.startsWith('./'), `${f} imports ${path}`).toBe(true);
        if (path.startsWith('./engine/')) expect(path, `${f} imports ${path}`).toBe('./engine/index');
      }
    }
  });

  it('the page has no style attribute, on* attribute, inline script or outside address', () => {
    expect(/\sstyle=/.test(page)).toBe(false);
    expect(/\son[a-z]+=/.test(page)).toBe(false);
    expect(/https?:\/\//.test(page)).toBe(false);
    const inline = [...page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(inline.length).toBe(1);
    expect((inline[0]?.[2] ?? '').trim()).toBe("import '../../../scripts/schedule-designer/main';");
  });

  it('the scripts write no style attribute as text', () => {
    for (const f of scripts) {
      expect(/setAttribute\(\s*'style'/.test(read(f)), f).toBe(false);
      expect(/\bstyle:\s*['`]/.test(read(f)), f).toBe(false);
      expect(/cssText/.test(read(f)), f).toBe(false);
    }
  });

  it('the styles take every colour from the tokens', () => {
    expect(/#[0-9a-fA-F]{3,8}\b/.test(css)).toBe(false);
    expect(/\brgba?\(|\bhsla?\(/.test(css)).toBe(false);
    expect(/url\(/.test(css)).toBe(false);
    expect(/@import/.test(css)).toBe(false);
  });

  it('the page never promises more than the tool does', () => {
    for (const f of [...scripts, 'src/pages/tools/schedule-designer/index.astro']) {
      expect(/anonymi[sz]ed|de-identified|HIPAA|\bsafe\b|\bsecure\b|guarantee/i.test(read(f)), f).toBe(false);
    }
  });

  it('the words on the page rank nothing and use no dash as punctuation', () => {
    for (const f of [...scripts, 'src/pages/tools/schedule-designer/index.astro']) {
      expect(/\b(?:highest|lowest|worst|best)\b/i.test(read(f)), f).toBe(false);
      expect(/[–—]/.test(read(f)), f).toBe(false);
    }
  });

  // Every list of choices on the page is the one dropdown in dropdown.ts, so they look and behave the same.
  it('has no native select, and one module makes the dropdown', () => {
    expect(/<select\b/i.test(page)).toBe(false);
    for (const f of scripts) {
      const text = read(f);
      expect(/['"`]select['"`]|<select\b|HTMLSelectElement|createElement\(\s*['"`]select/.test(text), f).toBe(false);
      if (!f.endsWith('/dropdown.ts')) expect(/role:\s*'(?:combobox|listbox)'/.test(text), f).toBe(false);
    }
    expect(read('src/scripts/schedule-designer/dropdown.ts')).toContain("role: 'combobox'");
  });

  it('writes a length of time one way: no page script turns minutes into decimal hours', () => {
    for (const f of scripts) {
      expect(read(f), f).not.toMatch(/\bhoursText\(|\bhoursOf\(/);
      // A number of hours followed by the word is the old way of writing a length.
      expect(read(f), f).not.toMatch(/\$\{(hrs|hourNum|hoursOf|hoursText)\([^`]*?\)\} (h|hours?)\b/);
    }
  });

  it('says once that changes typed in Excel are not read back', () => {
    const all = scripts.map(read).join('\n') + page;
    expect(all.split('are not read back').length - 1).toBe(1);
  });
});

describe('Schedule Designer: its article and its copy', () => {
  it('the article never promises more than the tool does, ranks nothing and uses no dash as punctuation', () => {
    expect(/anonymi[sz]ed|de-identified|HIPAA|\bsafe\b|\bsecure\b|guarantee/i.test(article)).toBe(false);
    expect(/\b(?:highest|lowest|worst|best)\b/i.test(article)).toBe(false);
    expect(/[–—]/.test(article)).toBe(false);
  });

  it('the page links to its article in the two places Cleaner Copy does', () => {
    expect(page).toContain('<p id="sd-off" class="panel cc-off">This tool works in your browser, so it needs scripts turned on. <a href="/writing/saved-as-a-workbook/">The article</a> explains what it does.</p>');
    expect(page.split('<a class="cc-read" href="/writing/saved-as-a-workbook/">').length - 1).toBe(1);
    expect(page.split('/writing/').length - 1).toBe(2);
  });

  it('the copy leaves both links out, since they lead to the site', () => {
    expect(standalone).toContain(`one(body, /<p id="sd-off" class="panel cc-off">[\\s\\S]*?<\\/p>/g, 'scripts-off line')`);
    expect(standalone).toContain(`body.replace(one(body, /<a class="cc-read"[\\s\\S]*?<\\/a>/g, 'article card')[0], '')`);
    expect(standalone).toContain("if (!m[1].startsWith('#')) stop(");
  });

  it('the host is told to hand the copy over as a download', () => {
    expect(headers).toContain('\n/tools/schedule-designer/clinx-schedule-designer.html\n  Content-Disposition: attachment; filename="clinx-schedule-designer.html"\n');
  });
});
