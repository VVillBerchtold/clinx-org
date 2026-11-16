import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { parseCsv } from '../src/lib/csv';
import {
  MARKS,
  buildYearView,
  centerKeys,
  centerPath,
  fundingTypes,
  columnParts,
  glanceBar,
  shortColumn,
  splitBySection,
  glanceScale,
  coverageRows,
  NEXT_STATES,
  listWords,
  headerRows,
  lastYearOf,
  linesOf,
  listByState,
  listRows,
  nameSentence,
  placesWords,
  rawFile,
  stateAnchor,
  yearsMissing,
  recordsSource,
  refreshDay,
  formatDay,
  showValue,
  slugOf,
  yearsOf,
} from '../src/lib/hc-records';
import { MAP_PLACES } from '../src/lib/state-map';
import { problems, shapeProblems, parseCsv as nodeParseCsv } from '../scripts/hc/records.mjs';
import centerPage from '../src/components/hc/RecordsCenterPage.astro?raw';
import listPage from '../src/components/hc/RecordsListPage.astro?raw';
import tableComponent from '../src/components/hc/RecordsTable.astro?raw';
import yearSwitch from '../src/components/hc/RecordsYearSwitch.astro?raw';
import lib from '../src/lib/hc-records.ts?raw';
import styles from '../src/styles/hc-records.css?raw';
import routeList from '../src/pages/health-centers/records/index.astro?raw';
import routeLatest from '../src/pages/health-centers/records/[key]/index.astro?raw';
import routeEarlier from '../src/pages/health-centers/records/[key]/[year]/index.astro?raw';
import dataCenter from '../src/pages/data/health-centers/records/centers/[key].json.ts?raw';
import dataCenters from '../src/pages/data/health-centers/records/health-centers.csv.ts?raw';
import dataLines from '../src/pages/data/health-centers/records/lines.csv.ts?raw';

// These tests read every published cell of every health center; a hosted runner needs more than the default five seconds.
vi.setConfig({ testTimeout: 60_000 });

/**
 * Health center records: one page for each health center and year, built from HRSA's Uniform Data System
 * workbooks. What these tests hold fixed: the counts on the pages are the counts in the copied files, a
 * published value is printed as published, a mark is shown in words, every address is unique, and the
 * pages' own words keep the site's rules. No page ranks or compares health centers.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const copy = (name: string): string => readFileSync(join(root, 'src', 'data', 'health-centers', 'records', name), 'utf8');
const source = recordsSource();
const keys = centerKeys();
const latest = source.latest_year;
const ownFiles: Record<string, string> = {
  'RecordsCenterPage.astro': centerPage,
  'RecordsListPage.astro': listPage,
  'RecordsTable.astro': tableComponent,
  'RecordsYearSwitch.astro': yearSwitch,
  'hc-records.ts': lib,
  'hc-records.css': styles,
  'records/index.astro': routeList,
  'records/[key]/index.astro': routeLatest,
  'records/[key]/[year]/index.astro': routeEarlier,
  'centers/[key].json.ts': dataCenter,
  'health-centers.csv.ts': dataCenters,
  'lines.csv.ts': dataLines,
};

const views = keys.flatMap((key) => yearsOf(key).map((year) => buildYearView(key, year)));

describe('the copied tables', () => {
  it('are what the pages expect, and match their record', () => {
    expect(problems({ siteRoot: root })).toEqual([]);
  });

  const PLACES = ['CT', 'DC', 'DE', 'MA', 'MD', 'ME', 'NH', 'NJ', 'NY', 'PA', 'RI', 'VT'];

  it('hold 258 health centers in twelve places from the District of Columbia to Maine for 2021 to 2025', () => {
    expect(keys).toHaveLength(258);
    expect(source.years).toEqual([2021, 2022, 2023, 2024, 2025]);
    expect(source.states).toEqual(PLACES);
    // One row for each health center and year HRSA's file lists it: 256, 255, 255, 254 and 253.
    expect(headerRows()).toHaveLength(1273);
    expect(source.years.map((y) => headerRows().filter((h) => h.year === y).length)).toEqual([256, 255, 255, 254, 253]);
    expect(new Set(headerRows().map((h) => h.state))).toEqual(new Set(PLACES));
  });

  it('give a health center a report only for the years HRSA lists it: seven are not in all five files', () => {
    const partial = keys.filter((k) => yearsOf(k).length < source.years.length);
    expect(partial).toHaveLength(7);
    for (const k of keys) {
      const years = yearsOf(k);
      // No gap: the years a health center is listed are next to one another.
      expect(years[years.length - 1]! - years[0]!).toBe(years.length - 1);
      expect(lastYearOf(k)).toBe(years[years.length - 1]);
      expect([...yearsOf(k), ...yearsMissing(k)].sort()).toEqual(source.years);
      expect(Object.keys(JSON.parse(rawFile(`centers/${k}.json`)).years).map(Number).sort()).toEqual(years);
    }
  });

  it('count the health centers HRSA lists in every state and territory, and agree with the list where the records cover a state', () => {
    const rows = coverageRows();
    expect(rows).toHaveLength(59 * 5);
    const latestRows = rows.filter((c) => c.year === latest);
    expect(latestRows.reduce((n, c) => n + c.healthCenters, 0)).toBe(1356);
    expect(latestRows.filter((c) => c.covered).map((c) => c.state)).toEqual(PLACES);
    for (const c of rows.filter((x) => x.covered)) expect(headerRows().filter((h) => h.state === c.state && h.year === c.year), `${c.state} ${c.year}`).toHaveLength(c.healthCenters);
    // Every code in the file has a tile on the map.
    for (const c of latestRows) expect(MAP_PLACES.some((p) => p.code === c.state), c.state).toBe(true);
  });

  it('name the states coming next: each is in HRSA\'s file and none has its reports here yet', () => {
    const latestRows = coverageRows().filter((c) => c.year === latest);
    expect(NEXT_STATES.length).toBeGreaterThan(0);
    for (const code of NEXT_STATES) {
      const row = latestRows.find((c) => c.state === code);
      expect(row, code).toBeDefined();
      expect(row!.covered, `${code} has its reports here, so it is no longer coming next`).toBe(false);
    }
    expect(listWords(['Florida'])).toBe('Florida');
    expect(listWords(['Florida', 'Georgia'])).toBe('Florida and Georgia');
    expect(listWords(['Florida', 'Georgia', 'Virginia'])).toBe('Florida, Georgia and Virginia');
  });

  it('say where each workbook came from, with a SHA-256 and a day', () => {
    for (const year of source.years) {
      const w = source.workbooks[String(year)]!;
      expect(w.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(w.url).toBe(`https://data.hrsa.gov/DataDownload/StaticDocuments/H80-${year}.xlsx`);
      expect(w.retrieved_utc).toMatch(/^2026-11-16T/);
      expect(w.reads).toBe('two_reads');
    }
  });

  it('never carry something shaped like an email address or a telephone number', () => {
    const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/;
    const phone = /(?<![0-9])\(?[0-9]{3}\)?[-. ][0-9]{3}[-. ][0-9]{4}(?![0-9])/;
    const names = ['health-centers.csv', 'lines.csv', 'notes.csv', 'coverage.csv', 'SOURCE.json', ...keys.map((k) => `centers/${k}.json`)];
    for (const name of names) {
      const text = copy(name);
      expect(email.test(text), name).toBe(false);
      expect(phone.test(text), name).toBe(false);
    }
  });

  it('leave out the files that are not shown', () => {
    const folder = join(root, 'src', 'data', 'health-centers', 'records');
    const have = readdirSync(folder);
    for (const name of ['differences.csv', 'sum_rules.csv', 'values.csv', 'line_comparison.csv', 'index.json']) expect(have).not.toContain(name);
  });

  it('are refused by the checks when a file is changed', () => {
    const files: Record<string, string> = { 'health-centers.csv': copy('health-centers.csv'), 'lines.csv': copy('lines.csv'), 'notes.csv': copy('notes.csv'), 'coverage.csv': copy('coverage.csv') };
    for (const k of keys) files[`centers/${k}.json`] = copy(`centers/${k}.json`);
    expect(shapeProblems({ ...files })).toEqual([]);
    expect(shapeProblems({ ...files, 'lines.csv': files['lines.csv']!.replace('year,uiid', 'year,id') }).length).toBeGreaterThan(0);
    const withEmail = { ...files, 'notes.csv': `${files['notes.csv']}\n2021,x,y,z,a@b.org,e` };
    expect(shapeProblems(withEmail).some((p) => /email/.test(p))).toBe(true);
    const missing = { ...files };
    delete missing['centers/010030.json'];
    expect(shapeProblems(missing).some((p) => /010030/.test(p))).toBe(true);
    // A count that differs from the list, and a state marked covered that the pages do not cover.
    const miscounted = { ...files, 'coverage.csv': files['coverage.csv']!.replace('2025,RI,8,yes', '2025,RI,9,yes') };
    expect(shapeProblems(miscounted).some((p) => /2025\/RI counts 9/.test(p))).toBe(true);
    const overclaimed = { ...files, 'coverage.csv': files['coverage.csv']!.replace('2025,AK,27,no', '2025,AK,27,yes') };
    expect(shapeProblems(overclaimed).some((p) => /2025\/AK/.test(p))).toBe(true);
  }, 60_000);

  it('read the same with the sync script and the site', () => {
    expect(nodeParseCsv(copy('lines.csv')).records).toHaveLength(parseCsv(copy('lines.csv')).length);
  });
});

describe('the addresses', () => {
  const paths = views.map((v) => v.path);

  it('are one for each health center and year, each unique, lower case and ending with a slash', () => {
    expect(views).toHaveLength(1273);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of paths) expect(p).toMatch(/^\/health-centers\/records\/[0-9a-z]+\/(20(2[1-4])\/)?$/);
    for (const k of keys) {
      // The short address is the latest report HRSA's files hold for the health center.
      expect(centerPath(k, lastYearOf(k))).toBe(`/health-centers/records/${slugOf(k)}/`);
      for (const y of yearsOf(k).filter((x) => x !== lastYearOf(k))) expect(centerPath(k, y)).toBe(`/health-centers/records/${slugOf(k)}/${y}/`);
    }
  });

  it('give the latest year no year in the address, and every other year its own', () => {
    expect(paths.filter((p) => !/\/20\d\d\/$/.test(p))).toHaveLength(258);
    expect(paths.filter((p) => /\/2025\/$/.test(p))).toHaveLength(0);
  });
});

describe('the list', () => {
  const list = listRows();

  it('has the 258 health centers, by state A to Z and by name A to Z within a state', () => {
    expect(list).toHaveLength(258);
    const order = (a: (typeof list)[number], b: (typeof list)[number]) => a.stateName.localeCompare(b.stateName, 'en') || a.name.localeCompare(b.name, 'en') || a.key.localeCompare(b.key, 'en');
    expect([...list].sort(order).map((r) => r.key)).toEqual(list.map((r) => r.key));
    for (const r of list) {
      // The name and city are those of the latest file that lists the health center.
      const h = headerRows().find((x) => x.key === r.key && x.year === lastYearOf(r.key))!;
      expect(r.name).toBe(h.name);
      expect(r.city).toBe(h.city);
      expect(r.lastYear).toBe(h.year);
      expect(r.years).toEqual(yearsOf(r.key));
      expect(r.path).toBe(centerPath(r.key, r.lastYear));
    }
  });

  it('groups the list by state, one group for each place, with every health center in one group', () => {
    const groups = listByState();
    expect(groups.map((g) => g.name)).toEqual([...groups.map((g) => g.name)].sort((a, b) => a.localeCompare(b, 'en')));
    expect(groups).toHaveLength(12);
    expect(groups.reduce((n, g) => n + g.rows.length, 0)).toBe(list.length);
    for (const g of groups) {
      expect(g.rows.every((r) => r.state === g.code)).toBe(true);
      expect(g.rows).toHaveLength(new Set(headerRows().filter((h) => h.state === g.code).map((h) => h.key)).size);
      expect(stateAnchor(g.code)).toBe(`in-${g.code.toLowerCase()}`);
    }
    expect(placesWords(groups.map((g) => g.code))).toBe('eleven states and the District of Columbia');
    expect(placesWords(['MA', 'RI'])).toBe('two states');
  });
});

describe('a page: counts', () => {
  it('has a table for each table of the dictionary of its year, with every line of it', () => {
    for (const v of views) {
      const lines = linesOf(v.year);
      expect(new Set(v.tables.map((t) => t.name)), `${v.key} ${v.year}`).toEqual(new Set(lines.map((l) => l.table)));
      let cells = 0;
      for (const t of v.tables) for (const b of t.blocks) for (const r of b.rows) cells += r.cells.filter((c) => c !== null).length;
      expect(cells, `${v.key} ${v.year}`).toBe(lines.length);
      expect(v.tables.reduce((n, t) => n + t.cellCount, 0)).toBeLessThanOrEqual(lines.length);
    }
  });

  it('lists as many sites as the file says, and as many ZIP code rows as the file holds', () => {
    for (const v of views) {
      expect(v.sites, `${v.key} ${v.year}`).toHaveLength(v.header.sites);
      const doc = JSON.parse(rawFile(`centers/${v.key}.json`)).years[String(v.year)];
      expect(v.zips).toHaveLength(doc.zip_codes.rows.length);
      expect(v.sites).toHaveLength(doc.sites.rows.length);
    }
  });

  it('withholds by ClinX the 188 cells the data says it withheld, and no others', () => {
    const total = views.reduce((n, v) => n + v.clinxWithheld, 0);
    expect(total).toBe(188);
    expect(views.filter((v) => v.clinxWithheld > 0).every((v) => v.year === 2021 || v.year === 2022)).toBe(true);
  });

  it('says an unnamed row in one sentence for each table of a year that has them', () => {
    const v2021 = views.filter((v) => v.year === 2021);
    // HRSA's 2021 file has a named row for 16 of the 256 health centers and none for the other 240 (table_status.csv).
    for (const name of ['Table 5', 'Table 8A', 'Table 9D']) expect(v2021.filter((v) => v.tables.find((t) => t.name === name)!.status === 'unnamed'), name).toHaveLength(240);
    const v2025 = views.filter((v) => v.year === 2025);
    expect(v2025.every((v) => v.tables.every((t) => t.status === 'present'))).toBe(true);
    // A table where every cell is one mark is one sentence, not a grid of marks.
    const confidential = v2025.flatMap((v) => v.tables.filter((t) => t.onlyMark === 'withheld_confidential'));
    expect(confidential.length).toBeGreaterThan(30);
    for (const t of confidential) expect(['Table 5', 'Table 8A', 'Table 9D']).toContain(t.name);
  });
});

describe('a page: published values', () => {
  it('prints every value as published: only separators and a dollar sign are drawn', () => {
    let checked = 0;
    let marks = 0;
    let withheld = 0;
    let held = 0;
    for (const v of views) {
      const doc = JSON.parse(rawFile(`centers/${v.key}.json`)).years[String(v.year)];
      held += Object.keys(doc.values).length;
      for (const t of v.tables) {
        for (const b of t.blocks) {
          for (const r of b.rows) {
            for (const c of r.cells) {
              if (!c || c.kind === 'unnamed' || c.kind === 'absent') continue;
              const published = doc.values[c.uiid];
              if (c.kind === 'value') {
                expect(c.raw).toBe(published);
                // Only a plain number gets separators and a sign; any other text is as published.
                const plainNumber = /^-?(0|[1-9]\d*)(\.\d+)?$/.test(published);
                const undrawn = plainNumber ? c.text.replace(/[$,]/g, '') : c.text;
                expect(undrawn, `${v.key} ${v.year} ${c.uiid}`).toBe(published);
                checked += 1;
              } else if (c.kind === 'mark') {
                expect(['-', '--', '---']).toContain(published);
                expect(c.text).toBe('');
                marks += 1;
              } else if (c.kind === 'clinx') {
                expect(published).toBeNull();
                withheld += 1;
              }
              else if (c.kind === 'typed') expect(published).toBeUndefined();
            }
          }
        }
      }
    }
    // Every cell of the files is on a page: a value, a mark or a cell ClinX withheld (1,847,014 cells in all, 682,666 of them marks).
    expect(checked + marks + withheld).toBe(held);
    expect(held).toBe(1847014);
    expect(marks).toBe(457734 + 176038 + 48894);
    expect(withheld).toBe(188);
  });

  it('matches the values of the engine file for a sample of cells', () => {
    // Example row of the engine: 2021,010030,T3a_L10_Ca,3,165,165,,two_reads
    const v = buildYearView('010030', 2021);
    const cell = v.tables.find((t) => t.name === 'Table 3A')!.blocks[0]!.rows.flatMap((r) => r.cells).find((c) => c?.uiid === 'T3a_L10_Ca')!;
    expect(cell.text).toBe('165');
    expect(cell.ref).toBe('U3');
    const total = buildYearView('010030', 2025).glance.find((g) => g.id === 'glance-patients')!.rows[0]!.cells[0]!;
    expect(total.text.replace(/,/g, '')).toBe(JSON.parse(rawFile('centers/010030.json')).years['2025'].values['T3b_L8_Cd']);
  });

  it('shows the cells that hold a total as the file holds them, and never a sum of its own', () => {
    for (const v of views) {
      for (const g of v.glance) {
        for (const r of g.rows) {
          expect(r.cells.length).toBe(g.columns.length);
          r.cells.forEach((c, i) => {
            if (c) expect(c.columnTitle, `${v.key} ${v.year} ${g.id}`).toBe(g.columns[i]!.title);
          });
        }
      }
    }
    expect(buildYearView('010030', 2025).glance.map((g) => g.id)).toEqual(['glance-patients', 'glance-income', 'glance-insurance', 'glance-visits']);
    // The bars of a block share one scale, the largest published figure in it; a mark or a zero has no bar.
    for (const g of buildYearView('011820', 2025).glance) {
      const scale = glanceScale(g);
      const cells = g.rows.flatMap((r) => r.cells).filter((c) => c !== null);
      const figures = cells.filter((c) => c!.kind === 'value').map((c) => Number(c!.raw));
      expect(scale).toBe(figures.length > 0 ? Math.max(...figures) : 0);
      for (const c of cells) {
        const w = glanceBar(c!, scale);
        if (c!.kind !== 'value' || Number(c!.raw) === 0) expect(w).toBe(0);
        else expect(w).toBeGreaterThanOrEqual(1);
        expect(w).toBeLessThanOrEqual(100);
      }
    }
  });

  it('draws separators and the dollar sign, and leaves everything else as published', () => {
    expect(showValue('20407', 'other').text).toBe('20,407');
    expect(showValue('1234567', 'patients').text).toBe('1,234,567');
    expect(showValue('1234567', 'dollars').text).toBe('$1,234,567');
    expect(showValue('-1234', 'dollars').text).toBe('-$1,234');
    expect(showValue('1234.50', 'dollars').text).toBe('$1,234.50');
    expect(showValue('12.34', 'fte').text).toBe('12.34');
    expect(showValue('007', 'patients').text).toBe('007');
    expect(showValue('0', 'patients').text).toBe('0');
    expect(showValue('Yes', 'text').text).toBe('Yes');
    expect(showValue('1234', 'text').text).toBe('1234');
    expect(showValue('16004600', 'other', 'ONC-certified Health IT Product List Number HIT Column B').text).toBe('16004600');
    expect(showValue('1e+05', 'dollars')).toEqual({ text: '1e+05', exponent: true });
  });

  it('marks every number published with an exponent', () => {
    const notes = parseCsv(copy('notes.csv'));
    expect(notes.length).toBeGreaterThan(0);
    let marked = 0;
    for (const n of notes) {
      const v = buildYearView(n['health_center']!, Number(n['year']));
      const cell = v.tables.flatMap((t) => t.blocks.flatMap((b) => b.rows.flatMap((r) => r.cells))).find((c) => c?.uiid === n['uiid']);
      expect(cell?.text).toBe(n['value_as_published']);
      expect(cell?.exponent).toBe(true);
      marked += 1;
    }
    expect(marked).toBe(notes.length);
  });
});

describe('marks', () => {
  it('are HRSA\'s three, with the cover sheet\'s words', () => {
    expect(MARKS.map((m) => m.mark)).toEqual(['-', '--', '---']);
    expect(MARKS.map((m) => m.cover)).toEqual([
      'no data entry by health center',
      'suppressed patient counts between 1-15 to protect patient privacy',
      'suppressed health center confidential data',
    ]);
  });

  it('are shown in words by the page and never as a bare dash', () => {
    expect(tableComponent).toContain('cellWords(c)');
    expect(tableComponent).not.toMatch(/>\s*-\s*</);
    expect(centerPage).toContain('MARKS.map');
  });
});

describe('the head of a page', () => {
  it('says in one sentence where a name differs between years', () => {
    const renamed = keys.filter((k) => nameSentence(k) !== '');
    expect(renamed).toHaveLength(10);
    for (const k of renamed) {
      const sentence = nameSentence(k);
      let rest = sentence;
      for (const h of headerRows().filter((x) => x.key === k)) {
        expect(sentence).toContain(h.name);
        rest = rest.replaceAll(h.name, '');
      }
      // One sentence. A name can hold a full stop of its own (ST. ..., INC.), so the names are taken out first.
      expect(rest.split('. ').length).toBe(1);
    }
    expect(nameSentence('010030')).toBe('');
  });

  it('names the funding types HRSA marks TRUE, with its flag', () => {
    for (const h of headerRows()) {
      const types = fundingTypes(h);
      expect(types).toHaveLength(Object.values(h.flags).filter((f) => f === 'TRUE').length);
      for (const t of types) expect(t.words).not.toBe('');
    }
    expect(fundingTypes(headerRows().find((h) => h.key === '010030' && h.year === 2025)!)).toEqual([{ flag: 'CHC', words: 'Community Health Center' }]);
  });

  it('writes days the way the site does', () => {
    expect(formatDay('2026-11-16')).toBe('16 November 2026');
    expect(refreshDay('05/07/2026 12:00 AM EST')).toBe('7 May 2026');
  });
});

describe('the pages\' own words', () => {
  const banned = /\b(best|highest|lowest|worst|simply|just|seamless|seamlessly|powerful|unlock|dive)\b|\btop[ \t]/i;
  const dash = /—/;

  it('hold no banned word and no em dash', () => {
    for (const [name, text] of Object.entries(ownFiles)) {
      expect(dash.test(text), `${name} has an em dash`).toBe(false);
      // The words of the page are in the markup and the strings; code and comments are read too, which is stricter.
      const hit = banned.exec(text);
      expect(hit, `${name}: ${hit?.[0]}`).toBeNull();
    }
  });

  it('print nothing as markup', () => {
    for (const [name, text] of Object.entries(ownFiles)) {
      expect(/set:html|innerHTML|is:inline|dangerouslySetInnerHTML|outerHTML|insertAdjacentHTML/.test(text), name).toBe(false);
    }
  });

  it('use colours only through the tokens', () => {
    expect(/#[0-9a-fA-F]{3,8}\b/.test(styles)).toBe(false);
    expect(/\brgba?\(|\bhsla?\(/.test(styles)).toBe(false);
  });

  it('give no advice and no comparison', () => {
    for (const [name, text] of Object.entries({ centerPage, listPage, tableComponent, yearSwitch })) {
      expect(/\byou\b|\byour\b|\bshould\b|\bmust\b|\bcompare[sd]? with\b|\brank(ed|ing|s)?\b/i.test(text.replace(/(No health center|Nothing) is ranked( or compared with another)?/g, '')), name).toBe(false);
    }
  });
});

describe('the built pages', () => {
  const dist = join(root, 'dist', 'health-centers', 'records');
  const built = existsSync(dist);
  const pages = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (n === 'index.html') out.push(p);
      }
    };
    walk(dist);
    return out;
  };

  it.runIf(built)('are 1,274, none over 1.5 MB, with no email or telephone shape and no em dash', () => {
    const all = pages();
    expect(all).toHaveLength(1274);
    const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/;
    const phone = /(?<![0-9])\(?[0-9]{3}\)?[-. ][0-9]{3}[-. ][0-9]{4}(?![0-9])/;
    for (const p of all) {
      const html = readFileSync(p, 'utf8');
      expect(html.length, p).toBeLessThan(1_500_000);
      const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]*>/g, ' ');
      expect(email.test(text), p).toBe(false);
      expect(phone.test(text), p).toBe(false);
      expect(dash.test(html), p).toBe(false);
      expect(/<script\b(?![^>]*\bsrc=)[^>]*>(?!\s*<\/script>)/.test(html.replace(/<script[^>]*type="application\/ld\+json"[\s\S]*?<\/script>/g, '')), p).toBe(false);
    }
  });

  it.runIf(built)('print the counts the data holds', () => {
    const html = readFileSync(join(dist, '010030', 'index.html'), 'utf8');
    const v = buildYearView('010030', 2025);
    expect(html).toContain(`<dt>Sites listed</dt><dd>${v.sites.length}</dd>`);
    expect(html).toContain(`HRSA's file lists ${v.zips.length} ZIP code rows`);
    expect(html).toContain('<h1>HOLYOKE HEALTH CENTER, INC.</h1>');
    const list = readFileSync(join(dist, 'index.html'), 'utf8');
    expect((list.match(/<tr role="row" data-search=/g) ?? []).length).toBe(258);
    // Each state's group has its anchor, and each filled tile of the map leads to one.
    for (const g of listByState()) {
      expect(list).toContain(`id="${stateAnchor(g.code)}"`);
      expect(list).toContain(`href="#${stateAnchor(g.code)}"`);
    }
  });

  const dash = /—/;
});

describe('wide record tables', () => {
  const cell = (text: string) => ({ kind: 'value', text, raw: text, ref: 'A1', mark: null, exponent: false, column: 'x', columnTitle: 'x' }) as never;
  const block = (titles: string[], text = '1') => ({ columns: titles.map((title, i) => ({ id: `c${i}`, title })), rows: [{ line: 'L1', title: 'A line', cells: titles.map(() => cell(text)) }] });

  it('reads the code at the end of a column title', () => {
    expect(columnParts('Yes, Cuban (a3)')).toEqual({ words: 'Yes, Cuban', code: 'a3' });
    expect(columnParts('Total (d) (Sum Columns a+b+c)')).toEqual({ words: 'Total', code: 'd' });
    expect(columnParts('Others')).toEqual({ words: 'Others', code: '' });
  });

  it('shortens only the headings it has a short form for', () => {
    expect(shortColumn('Table 3B', 'Yes, Puerto Rican (a2)')).toBe('Puerto Rican');
    expect(shortColumn('Table 5', 'Clinic Visits (b)')).toBe('Clinic Visits');
  });

  it('splits a wide block by the section digit of its column codes', () => {
    const parts = splitBySection(block(['A (1a)', 'B (1b)', 'C (2a)', 'D (2b)', 'E (3a)', 'F (3b)']));
    expect(parts.map((p) => p.part)).toEqual(['columns 1a to 1b', 'columns 2a to 2b', 'columns 3a to 3b']);
    expect(parts.every((p) => p.rows.length === 1 && p.rows[0]!.cells.length === 2)).toBe(true);
  });

  it('splits a wide block of long figures in two where the code letter changes, and leaves short figures alone', () => {
    const titles = ['A (a)', 'B (b)', 'C (c1)', 'D (c2)', 'E (c3)', 'F (c4)', 'G (d)', 'H (e)', 'I (f)'];
    expect(splitBySection(block(titles, '$24,733,376')).map((p) => p.columns.length)).toEqual([6, 3]);
    expect(splitBySection(block(titles, '70'))).toHaveLength(1);
    expect(splitBySection(block(titles.slice(0, 4), '$24,733,376'))).toHaveLength(1);
  });
});
