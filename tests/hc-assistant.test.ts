import { describe, expect, it } from 'vitest';
import { ASSISTANT_FILES, LINE_COLUMNS, linesIndex, recordsIndex, setsIndex } from '../src/lib/hc-assistant';
import { getIndex } from '../src/lib/hc-areas';
import { getFunding } from '../src/lib/hc-funding';
import { fileGroups } from '../src/lib/hc-hub';
import { centerKeys, headerRows, linesOf, recordsSource } from '../src/lib/hc-records';
import setsRoute from '../src/pages/data/health-centers/index.json.ts?raw';
import indexRoute from '../src/pages/data/health-centers/records/index.json.ts?raw';
import linesRoute from '../src/pages/data/health-centers/records/lines.json.ts?raw';

describe('the three files for the server that answers assistants', () => {
  it('lists every health center that has a records page, as its latest file prints it', () => {
    const index = recordsIndex();
    const source = recordsSource();
    expect(index.health_centers.map((c) => c.key)).toEqual([...centerKeys()].sort((a, b) => a.localeCompare(b, 'en')));
    expect(index.health_centers).toHaveLength(source.health_centers);
    expect(index.latest_year).toBe(source.latest_year);
    for (const center of index.health_centers) {
      const own = headerRows().filter((h) => h.key === center.key);
      const latest = own.find((h) => h.year === Math.max(...own.map((h) => h.year)))!;
      expect(center.name).toBe(latest.name);
      expect(center.grant_number).toBe(latest.grant);
      expect(center.city).toBe(latest.city);
      expect(center.state).toBe(latest.state);
      expect(center.sites).toBe(latest.sites);
      expect(center.years).toEqual(own.map((h) => h.year).sort((a, b) => a - b));
      expect(center.page).toBe(`/health-centers/records/${center.key.toLowerCase()}/`);
      expect(center.file).toBe(`/data/health-centers/records/centers/${center.key.toLowerCase()}.json`);
      for (const earlier of center.earlier_names ?? []) expect(earlier.name).not.toBe(center.name);
    }
    for (const year of source.years) {
      expect(index.workbooks[String(year)]!.read_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(index.workbooks[String(year)]!.hrsa_last_refreshed).toBe(source.workbooks[String(year)]!.report_last_refreshed);
    }
  });

  it('holds no address, and is small', () => {
    const index = recordsIndex();
    const allowed = ['key', 'grant_number', 'name', 'earlier_names', 'city', 'state', 'years', 'funding_types', 'urban_rural', 'sites', 'page', 'file'];
    for (const center of index.health_centers) expect(Object.keys(center).filter((k) => !allowed.includes(k))).toEqual([]);
    expect(JSON.stringify(index).includes('@')).toBe(false);
    // About 390 characters for each health center: 1,377 of them make about 530,000.
    expect(JSON.stringify(index).length).toBeLessThan(800_000);
  });

  it('writes the dictionary of lines so that every row can be read back as lines.csv has it', () => {
    const lines = linesIndex();
    expect(lines.columns).toEqual(LINE_COLUMNS);
    expect(new Set(lines.texts).size).toBe(lines.texts.length);
    const at = (name: string) => lines.columns.indexOf(name);
    const word = (row: (string | number)[], name: string) => (lines.text_columns.includes(name) ? lines.texts[row[at(name)] as number] : row[at(name)]);
    for (const year of recordsSource().years) {
      const rows = lines.years[String(year)]!;
      const csv = linesOf(year);
      expect(rows).toHaveLength(csv.length);
      rows.forEach((row, i) => {
        const l = csv[i]!;
        expect([word(row, 'uiid'), word(row, 'table'), word(row, 'sheet'), word(row, 'line'), word(row, 'line_title'), word(row, 'column'), word(row, 'column_title'), word(row, 'kind')]).toEqual([l.uiid, l.table, l.sheet, l.line, l.lineTitle, l.column, l.columnTitle, l.kind]);
      });
    }
    const tables = new Set(recordsSource().years.flatMap((year) => linesOf(year).map((l) => l.table)));
    for (const table of tables) expect(lines.table_labels[table], table).toBeTruthy();
    expect(JSON.stringify(lines).length).toBeLessThan(600_000);
  });

  it('gives the day each set was read and the national counts as the copied file states them', () => {
    const sets = setsIndex();
    expect(sets.funding['read_on']).toBe(getFunding().day);
    expect(sets.funding['opportunities']).toBe(getFunding().opportunities.length);
    expect(sets.funding['dated_lines']).toBe(getFunding().events.length);
    expect(sets.areas['read_on']).toBe(getIndex().snapshot_day);
    expect(sets.areas['national_counts']).toEqual(getIndex().national_counts);
    expect(sets.records['health_centers']).toBe(recordsSource().health_centers);
    expect(sets.records['read_on']).toBe(recordsSource().workbooks[String(recordsSource().latest_year)]!.retrieved_utc.slice(0, 10));
  });

  it('is served at the addresses the server asks for, and is not one of the downloads listed for people', () => {
    expect(ASSISTANT_FILES).toEqual({ sets: '/data/health-centers/index.json', records: '/data/health-centers/records/index.json', lines: '/data/health-centers/records/lines.json' });
    expect(setsRoute).toContain('setsIndex()');
    expect(indexRoute).toContain('recordsIndex()');
    expect(linesRoute).toContain('linesIndex()');
    const listed = fileGroups().flatMap((g) => g.files.map((f) => f.href));
    for (const address of Object.values(ASSISTANT_FILES)) expect(listed).not.toContain(address);
  });

  it('uses none of the words the site does not print', () => {
    const own = JSON.stringify({ ...recordsIndex(), health_centers: [] }) + JSON.stringify({ ...linesIndex(), texts: [], years: {} }) + JSON.stringify({ ...setsIndex() });
    expect(own).not.toMatch(/\b(?:highest|lowest|worst|best)\b|\btop\s/i);
  });
});
