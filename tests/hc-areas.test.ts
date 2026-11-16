import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/lib/csv';
import {
  AREAS_PATH,
  AREA_NAMES,
  EVENTS,
  NO_STATE,
  SERIES,
  SERIES_INFO,
  STATUSES,
  areaPath,
  changeViews,
  changesSentence,
  countiesText,
  eventCountsByKind,
  eventRows,
  getIndex,
  getState,
  nameOf,
  proposedRows,
  rawFile,
  scoreText,
  seriesOf,
  siteAddress,
  siteLists,
  size,
  stateCodes,
  stateDownload,
  tableDownload,
  type ChangeRow,
} from '../src/lib/hc-areas';
import { CHANGE_COLUMNS, PROPOSED_COLUMNS, RECENT_COLUMNS, SITE_COLUMNS, shapeProblems, windowStart } from '../scripts/hc/areas.mjs';

/**
 * The shortage area tracker. What these tests hold fixed: the pages' counts are the counts of the copied
 * files, every address is unique, a published value is printed as published, no list is shortened, and the
 * pages' own words keep the site's rules (no ranking word, no em dash, nothing printed as markup, no person).
 */
const index = getIndex();
const codes = index.states;

// The files are read through Vite, as the pages read them: the copied tables, the files of this part, and the last build.
const copied = import.meta.glob('../src/data/health-centers/areas/**/*.{json,csv}', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const owned = import.meta.glob(
  [
    '../src/components/hc/Areas*.astro',
    '../src/pages/health-centers/shortage-areas/**/*',
    '../src/pages/data/health-centers/areas/**/*',
    '../src/lib/hc-areas.ts',
    '../src/styles/hc-areas.css',
    '../src/scripts/hc-areas-filter.ts',
    '../scripts/hc/areas.mjs',
  ],
  { eager: true, query: '?raw', import: 'default' },
) as Record<string, string>;
const builtPages = import.meta.glob('../dist/health-centers/shortage-areas/**/index.html', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

const PREFIX = '../src/data/health-centers/areas/';
const read = (name: string): string | null => copied[PREFIX + name] ?? null;
const ownFiles = (): string[] => Object.keys(owned);
const text = (file: string): string => owned[file]!;
const builtPage = (path: string): string | undefined => builtPages[`../dist/health-centers/shortage-areas/${path}`];

describe('the copy of the tables', () => {
  it('is what the pages expect', () => {
    expect(shapeProblems(read)).toEqual([]);
  });

  it('covers 60 states and territories, all with a name, and the window is the 365 days before the day', () => {
    expect(codes).toHaveLength(60);
    expect(codes).toContain(NO_STATE);
    for (const code of codes) expect(AREA_NAMES[code], code).toBeTruthy();
    expect(index.window_start).toBe(windowStart(index.snapshot_day));
    expect(index.window_end).toBe(index.snapshot_day);
    expect(index.sources).toHaveLength(5);
  });

  it('is found out when it is wrong: a changed column, an email, a phone number, a web address, a count that does not agree', () => {
    const tamper = (name: string, change: (text: string) => string) => (n: string): string | null => {
      const t = read(n);
      return n === name && t !== null ? change(t) : t;
    };
    expect(shapeProblems(tamper('proposed.csv', (t) => t.replace('file,discipline', 'discipline,file'))).join()).toMatch(/proposed.csv: the columns/);
    expect(shapeProblems(tamper('states/RI.json', (t) => t.replace('Providence County, RI', 'a@b.org')))).not.toEqual([]);
    expect(shapeProblems(tamper('states/RI.json', (t) => t.replace('Woonsocket', '401-555-0100'))).join()).toMatch(/telephone/);
    expect(shapeProblems(tamper('states/RI.json', (t) => t.replace('Woonsocket', 'https://example.org'))).join()).toMatch(/web address/);
    expect(shapeProblems(tamper('recent.csv', (t) => t.split('\n').slice(0, -2).join('\n') + '\n')).join()).toMatch(/recent.csv: has/);
    expect(shapeProblems(tamper('index.json', (t) => t.replace('"window_start": "2025-11-16"', '"window_start": "2025-11-17"'))).join()).toMatch(/365 days/);
  });

  it('holds no email shape, no telephone shape and no web address in any copied file or any page file', () => {
    const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
    const phone = /(?:\(\d{3}\)\s?|\b\d{3}[-. ])\d{3}[-. ]\d{4}\b/;
    for (const [file, body] of [...Object.entries(copied), ...Object.entries(owned).filter(([f]) => /\.astro$/.test(f))]) {
      expect(email.test(body), file).toBe(false);
      expect(phone.test(body), file).toBe(false);
    }
  });
});

describe('the counts on the pages are the counts of the files', () => {
  const statesFile = JSON.parse(rawFile('states.json')) as { states: Record<string, { designations: unknown; recent_events: unknown; sites: unknown; sites_added_to_scope_in_window: number; sites_not_active: number; change_rows: number }> };

  it('says the same in states.json, in each state file and in the national counts', () => {
    for (const code of codes) {
      const counts = getState(code).counts;
      const fromStates = statesFile.states[code]!;
      expect(counts.designations, code).toEqual(fromStates.designations);
      expect(counts.recent_events, code).toEqual(fromStates.recent_events);
      expect(counts.sites, code).toEqual(fromStates.sites);
      expect(counts.sites_added_to_scope_in_window, code).toBe(fromStates.sites_added_to_scope_in_window);
    }
    for (const series of SERIES) {
      for (const status of STATUSES) {
        const sum = (field: 'designations' | 'file_rows') => codes.reduce((n, code) => n + getState(code).counts.designations[series][status][field], 0);
        expect(sum('designations'), `${series} ${status}`).toBe(index.national_counts.designations[series][status].designations);
        expect(sum('file_rows'), `${series} ${status}`).toBe(index.national_counts.designations[series][status].file_rows);
      }
      for (const event of EVENTS) {
        expect(codes.reduce((n, code) => n + getState(code).counts.recent_events[series][event], 0), `${series} ${event}`).toBe(index.national_counts.recent_events[series][event]);
      }
    }
  });

  it('lists as many proposed designations, events and sites as the counts say, for every state, and shortens nothing', () => {
    for (const code of codes) {
      const state = getState(code);
      const c = state.counts;
      const proposed = SERIES.reduce((n, s) => n + c.designations[s]['Proposed For Withdrawal'].designations, 0);
      expect(proposedRows(state), code).toHaveLength(proposed);
      for (const event of EVENTS) {
        const expected = SERIES.reduce((n, s) => n + c.recent_events[s][event], 0);
        expect(eventRows(state, event), `${code} ${event}`).toHaveLength(expected);
      }
      const { added, notActive } = siteLists(state);
      expect(added, code).toHaveLength(c.sites_added_to_scope_in_window);
      expect(notActive, code).toHaveLength(c.sites_not_active);
      const byKind = eventCountsByKind(eventRows(state, 'updated'));
      for (const s of SERIES) expect(byKind[s], `${code} ${s}`).toBe(c.recent_events[s].updated);
    }
  });

  it('has as many rows in each downloadable table as the state files hold together', () => {
    const total = (key: 'recent' | 'proposed' | 'sites_recent' | 'changes') => codes.reduce((n, code) => n + getState(code)[key].length, 0);
    expect(parseCsv(rawFile('recent.csv'))).toHaveLength(total('recent'));
    expect(parseCsv(rawFile('proposed.csv'))).toHaveLength(total('proposed'));
    expect(parseCsv(rawFile('sites-recent.csv'))).toHaveLength(total('sites_recent'));
    expect(parseCsv(rawFile('changes.csv'))).toHaveLength(total('changes'));
    expect(index.change_rows_so_far).toBe(total('changes'));
  });

  it('puts every designation under the state HRSA gives as its primary state, and no row under two', () => {
    const seen = new Set<string>();
    for (const code of codes) {
      for (const r of getState(code).proposed) {
        expect(r.state).toBe(code);
        expect(seen.has(r.key), r.key).toBe(false);
        seen.add(r.key);
      }
    }
  });
});

describe('every published value is printed as published', () => {
  const sample = ['RI', 'CA', 'XX', 'PR', 'KS', 'GU'];

  it('keeps each row of the state files as it is in the downloadable tables, column for column', () => {
    const tables = {
      proposed: parseCsv(rawFile('proposed.csv')),
      recent: parseCsv(rawFile('recent.csv')),
      sites: parseCsv(rawFile('sites-recent.csv')),
    };
    for (const code of sample) {
      const state = getState(code);
      const pick = (rows: Record<string, string>[], keyOf: (r: Record<string, string>) => string) => new Map(rows.filter((r) => r['state'] === code).map((r) => [keyOf(r), r]));
      const proposed = pick(tables.proposed, (r) => r['key']!);
      expect(proposed.size, code).toBe(state.proposed.length);
      for (const r of state.proposed) for (const column of PROPOSED_COLUMNS) expect((r as unknown as Record<string, string>)[column], `${code} ${r.key} ${column}`).toBe(proposed.get(r.key)![column]);
      const recent = pick(tables.recent, (r) => `${r['key']}|${r['event']}`);
      expect(recent.size, code).toBe(state.recent.length);
      for (const r of state.recent) for (const column of RECENT_COLUMNS) expect((r as unknown as Record<string, string>)[column], `${code} ${r.key} ${column}`).toBe(recent.get(`${r.key}|${r.event}`)![column]);
      const sites = pick(tables.sites, (r) => `${r['key']}|${r['reason']}`);
      expect(sites.size, code).toBe(state.sites_recent.length);
      for (const r of state.sites_recent) for (const column of SITE_COLUMNS) expect((r as unknown as Record<string, string>)[column], `${code} ${r.key} ${column}`).toBe(sites.get(`${r.key}|${r.reason}`)![column]);
    }
  });

  it('prints a score, a mark and a blank in HRSA’s words, never changed', () => {
    expect(scoreText('13')).toBe('13');
    expect(scoreText('12.50')).toBe('12.50');
    expect(scoreText('NA')).toBe('NA');
    expect(scoreText('Not Applicable')).toBe('Not Applicable');
    expect(scoreText('')).toBe('Blank in HRSA’s file');
  });

  it('prints counties as HRSA writes them, with a space after each separator, and an address from its parts', () => {
    expect(countiesText('Nevada County, CA;Placer County, CA')).toBe('Nevada County, CA; Placer County, CA');
    expect(countiesText('')).toBe('');
    expect(siteAddress({ address: '695 Eddy St, Suite 23', city: 'Providence', postal_code: '02903-4941' })).toBe('695 Eddy St, Suite 23, Providence, 02903-4941');
    expect(siteAddress({ address: '', city: '', postal_code: '' })).toBe('No address in HRSA’s file');
  });

  it('puts the row of a designation in one of the four kinds', () => {
    for (const code of sample) {
      for (const r of [...getState(code).proposed, ...getState(code).recent]) {
        const series = seriesOf(r);
        expect(SERIES).toContain(series);
        expect(r.key.startsWith(r.file === 'mua' ? '' : r.discipline + '/')).toBe(true);
      }
    }
    expect(Object.keys(SERIES_INFO)).toEqual([...SERIES]);
  });

  const decode = (t: string): string => t.replaceAll('&#39;', "'").replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  const built = builtPage('ri/index.html') !== undefined;
  // This part reads the pages of the last build; it runs whenever dist/ exists (npm run build makes it).
  it.skipIf(!built)('shows, on the built pages of a sample of states, every value of every row of every list as the file has it', () => {
    for (const code of sample) {
      const html = decode(builtPage(`${code.toLowerCase()}/index.html`)!);
      const state = getState(code);
      for (const r of state.proposed) {
        expect(html, `${code} ${r.key}`).toContain(`>${r.name}`);
        expect(html).toContain(`ID ${r.id}`);
        expect(html).toContain(`${r.designation_date_as_published}</td>`);
        expect(html).toContain(`${r.last_update_date_as_published}</td>`);
        expect(html).toContain(countiesText(r.counties));
      }
      for (const r of state.recent) {
        expect(html, `${code} ${r.key}`).toContain(`>${r.name}`);
        expect(html).toContain(`${r.event_date_as_published}</td>`);
      }
      for (const r of state.sites_recent) {
        expect(html, `${code} ${r.key}`).toContain(`Site ${r.key}`);
        expect(html).toContain(siteAddress(r));
      }
      // Each list is whole: the rows of each table are as many as the file's rows for it.
      const rowsOf = (table: string): number => {
        const m = new RegExp(`<table id="${table}"[\\s\\S]*?</table>`).exec(html);
        return m ? (m[0].match(/<tr role="row"/g) ?? []).length - 1 : 0;
      };
      expect(rowsOf('proposed-table'), `${code} proposed`).toBe(state.proposed.length);
      expect(rowsOf('designated-table'), `${code} designated`).toBe(eventRows(state, 'designated').length);
      expect(rowsOf('withdrawn-table'), `${code} withdrawn`).toBe(eventRows(state, 'withdrawn').length);
      expect(rowsOf('updated-table'), `${code} updated`).toBe(eventRows(state, 'updated').length);
      expect(rowsOf('sites-table'), `${code} sites`).toBe(siteLists(state).added.length);
    }
  });

  it.skipIf(!built)('names every state once on the front page, in A to Z order, with the counts of its file', () => {
    const html = decode(builtPage('index.html')!);
    const links = [...html.matchAll(/<a href="\/health-centers\/shortage-areas\/([a-z]{2})\/">/g)].map((m) => m[1]!.toUpperCase());
    expect(links).toEqual(stateCodes());
    expect(new Set(links).size).toBe(60);
  });
});

describe('the addresses', () => {
  it('gives each state one address, lower case and ending in a slash, and no two alike', () => {
    const paths = codes.map(areaPath);
    expect(new Set(paths).size).toBe(codes.length);
    for (const p of paths) expect(p).toMatch(/^\/health-centers\/shortage-areas\/[a-z]{2}\/$/);
    expect(AREAS_PATH).toBe('/health-centers/shortage-areas/');
    expect(areaPath('XX')).toBe('/health-centers/shortage-areas/xx/');
  });

  it('has a file endpoint for every download and gives the file as copied', () => {
    const pages = Object.keys(owned);
    for (const file of ['recent.csv', 'proposed.csv', 'sites-recent.csv', 'changes.csv', 'states.json']) {
      expect(pages.some((p) => p.endsWith(`/health-centers/areas/${file}.ts`)), file).toBe(true);
      expect(tableDownload(file)).toBe(`/data/health-centers/areas/${file}`);
      expect(rawFile(file)).toBe(read(file));
    }
    for (const code of codes) {
      expect(stateDownload(code)).toMatch(/^\/data\/health-centers\/areas\/states\/[a-z]{2}\.json$/);
      expect(rawFile(`states/${code}.json`)).toBe(read(`states/${code}.json`));
    }
    expect(pages.some((p) => p.endsWith('/areas/states/[st].json.ts'))).toBe(true);
  });

  it('lists the states A to Z by name, with the rows that name no state last', () => {
    const list = stateCodes();
    expect(list).toHaveLength(60);
    expect(list.at(-1)).toBe(NO_STATE);
    const names = list.slice(0, -1).map(nameOf);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
  });
});

describe('changes between ClinX’s copies', () => {
  const made: ChangeRow[] = [
    { from_day: '2026-11-16', to_day: '2026-11-17', file: 'hpsa', key: 'PC/1', state: 'RI', name: 'Bayside Family Healthcare', kind: 'withdrawn', field: 'status', before: 'Designated', after: 'Withdrawn' },
    { from_day: '2026-11-16', to_day: '2026-11-18', file: 'hpsa', key: 'DH/2', state: 'RI', name: 'LI - Woonsocket', kind: 'score changed', field: 'hpsa_score', before: '15', after: '16' },
    { from_day: '2026-11-16', to_day: '2026-11-18', file: 'sites', key: 'BPS-1', state: 'RI', name: 'A site', kind: 'site added', field: '', before: '', after: 'Active' },
  ];

  it('fills the table from made-up rows, newest copy first, values as in the file and empty values in words', () => {
    const views = changeViews(made);
    expect(views).toHaveLength(3);
    expect(views.map((v) => v.toIso)).toEqual(['2026-11-18', '2026-11-18', '2026-11-17']);
    const score = views.find((v) => v.kind === 'score changed')!;
    expect(score).toMatchObject({ before: '15', after: '16', from: '16 November 2026', to: '18 November 2026', ref: 'hpsa DH/2', beforeEmpty: false });
    const added = views.find((v) => v.kind === 'site added')!;
    expect(added.before).toBe('Empty in the earlier copy');
    expect(added.beforeEmpty).toBe(true);
    expect(added.after).toBe('Active');
    expect(changeViews([])).toEqual([]);
  });

  it('says on day one that the first copy was taken that day, and later says what the rows are', () => {
    expect(changesSentence('2026-11-16', 0)).toBe('ClinX took its first copy of HRSA’s files on 16 November 2026. Changes between copies will be listed here from the next copy on.');
    expect(changesSentence('2026-11-17', 0)).toContain('lists no change for this state');
    expect(changesSentence('2026-11-17', 3)).toContain('3 changes');
    expect(changesSentence('2026-11-17', 1)).toContain('1 change ');
    // The copy has no changes on day one, as the first sentence says.
    expect(index.change_rows_so_far).toBe(0);
    for (const code of codes) expect(getState(code).changes).toEqual([]);
    expect(CHANGE_COLUMNS).toHaveLength(10);
  });

  it('draws the table from the rows of the file in the page', () => {
    const page = text('../src/components/hc/AreasStatePage.astro');
    expect(page).toContain('changeViews(state.changes)');
    expect(page).toContain('state.changes.length > 0');
  });
});

describe('the words of the pages', () => {
  const banned = /\b(?:best|highest|lowest|worst|simply|just|seamless|powerful|unlock|dive|rank|ranked|ranking)\b|\btop\s/i;
  const files = ownFiles().filter((f) => /\.(astro|ts|mjs|css)$/.test(f));

  it('has files to read', () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it('uses no em dash and no word the site bans', () => {
    for (const file of files) {
      const body = text(file);
      expect(body.includes('—'), `${file}: em dash`).toBe(false);
      const stripped = body.replace(/\bnever rank(?:ed)?s? [^.\n]*|No state is ranked[^.\n]*|Nothing here ranks[^.\n]*|ranks? a state[^.\n]*/g, '');
      const hit = banned.exec(stripped);
      expect(hit, `${file}: ${hit?.[0]}`).toBeNull();
    }
  });

  it('prints nothing as markup', () => {
    for (const file of files) {
      const body = text(file);
      expect(/set:html|innerHTML|outerHTML|insertAdjacentHTML|document\.write|dangerouslySetInnerHTML/.test(body), file).toBe(false);
    }
  });

  it('asks nothing of another site and writes no inline script or style', () => {
    for (const file of files.filter((f) => f.endsWith('.astro'))) {
      const body = text(file);
      expect(/<style\b|style=|is:inline|<img\b|<iframe\b|fetch\(|XMLHttpRequest/.test(body), file).toBe(false);
    }
    const css = text('../src/styles/hc-areas.css');
    expect(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|url\(|@import/.test(css), 'colours only through the tokens').toBe(false);
  });

  it('gives no advice and no reason: the pages never say why a designation changed or what will happen', () => {
    const all = files
      .filter((f) => f.endsWith('.astro'))
      .map((f) => text(f))
      .join('\n');
    expect(/\byou should\b|\bwe recommend\b|\bshould apply\b|\bwill be withdrawn\b|\bwill take effect\b|\bbecause HRSA\b/i.test(all)).toBe(false);
  });

  it('has every table captioned and every list header a header cell', () => {
    for (const file of files.filter((f) => f.endsWith('.astro'))) {
      const body = text(file);
      const tables = (body.match(/<table\b/g) ?? []).length;
      const captions = (body.match(/<caption\b/g) ?? []).length;
      expect(captions, file).toBe(tables);
    }
  });

  it('formats a file size in plain units', () => {
    expect(size(12)).toBe('12 bytes');
    expect(size(2048)).toBe('2 KB');
    expect(size(5 * 1048576)).toBe('5.0 MB');
  });
});
