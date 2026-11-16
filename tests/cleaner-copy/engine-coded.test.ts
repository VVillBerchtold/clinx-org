import { describe, expect, it } from 'vitest';
import { inspect, kindOf, legendWorkbook, makeCopy, sampleBytes } from '../../src/scripts/cleaner-copy/engine/index.js';
import type { LegendGroup } from '../../src/scripts/cleaner-copy/engine/index.js';
import { allText, cellsOf, columnOf, formulaOf, part, partsOf, shown, workbook } from './fixtures/workbooks';

// Columns the person asked to have coded: every different value becomes a short code, and the legend that
// says which code is which original is given back beside the copy. Every name and number here is invented.

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);
const textOf = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/** One group of a legend by its heading, or a failed test when it is not there. */
function group(legend: LegendGroup[], label: string): LegendGroup {
  const found = legend.find((g) => g.label === label);
  if (!found) throw new Error(`the legend has no group named ${label}`);
  return found;
}
/** A legend group as a lookup from original to code. */
const codeOf = (g: LegendGroup): Map<string, string> => new Map(g.entries.map((entry) => [entry.original, entry.code]));

const sample = sampleBytes();
const before = await partsOf(sample);
const claimsBefore = cellsOf(before, 'Claims');
const payers = new Set(columnOf(claimsBefore, 'E', 4).map(([, value]) => value));

describe('Cleaner Copy engine: a coded text column', () => {
  it('can be chosen for a column of text or numbers, and not for one of dates or formulas', async () => {
    const report = await inspect(sample, 'workbook');
    const claims = report.sheets[0]?.columns ?? [];
    const can = (letter: string): boolean | undefined => claims.find((column) => column.column === letter)?.canCode;
    expect(can('A')).toBe(true); // numbers
    expect(can('E')).toBe(true); // text
    expect(can('C')).toBe(false); // dates
    expect(can('M')).toBe(false); // formulas
    expect(report.sheets.flatMap((sheet) => sheet.columns).every((column) => column.coded === false)).toBe(true);
    expect(report.replaced.coded).toBe(0);
  });

  it('gives each different value one short code, the same on every row', async () => {
    const copy = await makeCopy(sample, 'workbook', { code: { Claims: ['E'] } });
    const after = await partsOf(copy.bytes);
    const claims = cellsOf(after, 'Claims');
    const written = columnOf(claims, 'E', 4);
    expect(written.length).toBe(200);
    expect([...new Set(written.map(([, value]) => value))].sort()).toEqual(['Payer A', 'Payer B', 'Payer C']);
    expect(shown(claims, 'E3')).toBe('Payer');

    // The legend covers the originals exactly, in code order, and says where the codes are.
    expect(copy.legend.length).toBe(1);
    const legend = group(copy.legend, 'Payer');
    expect(legend.columns).toEqual(['Claims, column E']);
    expect(legend.entries.map((entry) => entry.code)).toEqual(['Payer A', 'Payer B', 'Payer C']);
    expect(new Set(legend.entries.map((entry) => entry.original))).toEqual(payers);
    const codes = codeOf(legend);
    for (const [row, value] of written) expect(value, `row ${row}`).toBe(codes.get(shown(claimsBefore, `E${row}`)));

    // The report and the description say which column was coded.
    expect(copy.report.replaced.coded).toBe(200);
    expect(copy.report.sheets.flatMap((sheet) => sheet.columns.filter((column) => column.coded).map((column) => `${sheet.name} ${column.column}`))).toEqual(['Claims E']);
    const described = copy.described[0];
    expect(described?.columns.filter((column) => column.coded).map((column) => column.column)).toEqual(['E']);
    expect(described?.rows[0]?.[4]).toMatch(/^Payer [ABC]$/);

    // A sheet that was not coded gets randomized values, as before.
    const summary = columnOf(cellsOf(after, 'Summary'), 'A', 4).map(([, value]) => value);
    expect(summary.length).toBeGreaterThan(0);
    for (const value of summary) {
      expect(value).not.toMatch(/^Payer [A-Z]+$/);
      expect(payers.has(value)).toBe(false);
    }
  });

  it('carries the code into a formula that names the value, and into the pivot table\'s copy of the data', async () => {
    const copy = await makeCopy(sample, 'workbook', { code: { Claims: ['E'] } });
    const after = await partsOf(copy.bytes);
    const codes = codeOf(group(copy.legend, 'Payer'));
    expect(formulaOf(claimsBefore, 'N5')).toBe('IF(E5="Medicaid","Yes","")');
    expect(formulaOf(cellsOf(after, 'Claims'), 'N5')).toBe(`IF(E5="${codes.get('Medicaid')}","Yes","")`);
    const cache = part(after, 'xl/pivotCache/pivotCacheDefinition1.xml');
    const field = /<cacheField name="Payer"[^>]*>([\s\S]*?)<\/cacheField>/.exec(cache)?.[1] ?? '';
    expect([...field.matchAll(/<s v="([^"]*)"/g)].map((m) => m[1]).sort()).toEqual(['Payer A', 'Payer B', 'Payer C']);
  });

  it('leaves no original of the coded column, and nothing of the legend, in the copy', async () => {
    const copy = await makeCopy(sample, 'workbook', { code: { Claims: ['E'] } });
    const everything = allText(await partsOf(copy.bytes)).replaceAll('Medicaid flag', '');
    for (const original of payers) expect(everything.includes(original), original).toBe(false);
    expect(everything).not.toContain('legend');
    expect(copy.check.ran).toBe(true);
    expect(copy.check.items.filter((item) => payers.has(item.value))).toEqual([]);
    expect(copy.check.items.filter((item) => item.kind === 'unexplained' || item.kind === 'chance')).toEqual([]);
  });

  it('shares one set of codes between columns with the same heading', async () => {
    const copy = await makeCopy(sample, 'workbook', { code: { Claims: ['E'], Summary: ['A'] } });
    expect(copy.legend.length).toBe(1);
    const legend = group(copy.legend, 'Payer');
    expect(legend.columns).toEqual(['Claims, column E', 'Summary, column A']);
    const codes = codeOf(legend);
    const summaryBefore = cellsOf(before, 'Summary');
    const summary = columnOf(cellsOf(await partsOf(copy.bytes), 'Summary'), 'A', 4);
    expect(summary.length).toBeGreaterThan(0);
    for (const [row, value] of summary) expect(value, `row ${row}`).toBe(codes.get(shown(summaryBefore, `A${row}`)));
  });

  it('names the sheet in the legend as the person knows it, when the copy gives the sheet a new name', async () => {
    const copy = await makeCopy(sample, 'workbook', { code: { Claims: ['E'] }, rename: { Claims: 'Sheet one' } });
    expect(group(copy.legend, 'Payer').columns).toEqual(['Claims, column E']);
    const codes = codeOf(group(copy.legend, 'Payer'));
    const cells = cellsOf(await partsOf(copy.bytes), 'Sheet one');
    expect(shown(cells, 'E4')).toBe(codes.get(shown(claimsBefore, 'E4')));
    expect(copy.check.items.filter((item) => item.kind === 'unexplained')).toEqual([]);
  });

  it('draws the codes by chance, not in the order the values come in', async () => {
    const book = await workbook({ sheets: [{ name: 'Sites', rows: [['Site'], ['Alder Court'], ['Birchfield'], ['Cedar Row'], ['Dunmore'], ['Elm Hollow'], ['Foxglove']] }] });
    const first = new Set<string>();
    for (let run = 0; run < 12; run++) {
      const copy = await makeCopy(book, 'workbook', { code: { Sites: ['A'] } });
      first.add(codeOf(group(copy.legend, 'Site')).get('Alder Court') ?? '');
      expect(copy.legend[0]?.entries.map((entry) => entry.code)).toEqual(['Site A', 'Site B', 'Site C', 'Site D', 'Site E', 'Site F']);
    }
    expect(first.size).toBeGreaterThan(1);
  });
});

describe('Cleaner Copy engine: a coded number column', () => {
  it('gets whole numbers that stay numbers, so a lookup between two sheets still matches', async () => {
    const copy = await makeCopy(sample, 'workbook', { code: { Claims: ['A'], Patients: ['A'] } });
    const after = await partsOf(copy.bytes);
    const legend = group(copy.legend, 'Patient ID');
    expect(legend.columns).toEqual(['Claims, column A', 'Patients, column A']);
    const codes = codeOf(legend);
    const numbers = legend.entries.map((entry) => Number(entry.code));
    expect(numbers.every((code) => Number.isInteger(code) && code >= 1)).toBe(true);
    expect([...numbers].sort((a, b) => a - b)).toEqual(numbers);
    expect(new Set(numbers).size).toBe(numbers.length);

    const patientsBefore = cellsOf(before, 'Patients');
    const claims = cellsOf(after, 'Claims');
    const patients = cellsOf(after, 'Patients');
    for (const [row, value] of columnOf(claims, 'A', 4)) expect(value, `Claims row ${row}`).toBe(codes.get(shown(claimsBefore, `A${row}`)));
    for (const [row, value] of columnOf(patients, 'A', 2)) expect(value, `Patients row ${row}`).toBe(codes.get(shown(patientsBefore, `A${row}`)));
    // No code is one of the real numbers.
    const real = new Set([...columnOf(claimsBefore, 'A', 4), ...columnOf(patientsBefore, 'A', 2)].map(([, value]) => value));
    for (const entry of legend.entries) expect(real.has(entry.code), entry.code).toBe(false);
    expect(new Set(legend.entries.map((entry) => entry.original))).toEqual(real);

    // Still number cells: none is written as text.
    const sheet = part(after, 'xl/worksheets/sheet1.xml');
    const cell = /<c r="A4"([^>]*)>([\s\S]*?)<\/c>/.exec(sheet);
    expect(cell?.[1]).not.toMatch(/\st="/);
    expect(cell?.[2]).toMatch(/<v>\d+<\/v>/);

    // The lookup formula is as it was, and every number it looks up is on the other sheet.
    expect(formulaOf(claims, 'M4')).toBe(formulaOf(claimsBefore, 'M4'));
    const listed = new Set(columnOf(patients, 'A', 2).map(([, value]) => value));
    for (const [row, value] of columnOf(claims, 'A', 4)) expect(listed.has(value), `row ${row}`).toBe(true);
    expect(copy.report.replaced.coded).toBe(columnOf(claims, 'A', 4).length + columnOf(patients, 'A', 2).length);
  });

  it('passes over a code that is a real value of the file', async () => {
    const book = await workbook({
      sheets: [
        { name: 'Plans', rows: [['Plan', 'Rank', 'Seen as'], ['Harbor Gold', 410, 'Plan A'], ['Harbor Silver', 520, 'Plan C'], ['Northgate Basic', 630, 'other'], ['Northgate Plus', 740, 'other']] },
        { name: 'Counts', rows: [['Visits'], [1], [3]] },
      ],
    });
    const copy = await makeCopy(book, 'workbook', { code: { Plans: ['A', 'B'] } });
    expect(group(copy.legend, 'Plan').entries.map((entry) => entry.code)).toEqual(['Plan B', 'Plan D', 'Plan E', 'Plan F']);
    expect(group(copy.legend, 'Rank').entries.map((entry) => entry.code)).toEqual(['2', '4', '5', '6']);
  });

  it('keeps text codes and number codes apart in a column that holds both', async () => {
    const book = await workbook({ sheets: [{ name: 'Mixed', rows: [['Ref'], ['Corwin Ashdale'], [88123], ['Odalys Brenner'], [88123], [90455]] }] });
    const copy = await makeCopy(book, 'workbook', { code: { Mixed: ['A'] } });
    const legend = group(copy.legend, 'Ref');
    expect(legend.entries.map((entry) => entry.code)).toEqual(['Ref A', 'Ref B', '1', '2']);
    const cells = cellsOf(await partsOf(copy.bytes), 'Mixed');
    const codes = codeOf(legend);
    expect(shown(cells, 'A2')).toBe(codes.get('Corwin Ashdale'));
    expect(shown(cells, 'A3')).toBe(codes.get('88123'));
    expect(shown(cells, 'A5')).toBe(shown(cells, 'A3'));
    expect(shown(cells, 'A6')).toBe(codes.get('90455'));
    expect(copy.report.replaced.coded).toBe(5);
  });
});

describe('Cleaner Copy engine: a column that cannot be coded, or was also kept', () => {
  it('gives a column of dates randomized values when it is asked to be coded', async () => {
    const copy = await makeCopy(sample, 'workbook', { code: { Claims: ['C', 'M'] } });
    expect(copy.legend).toEqual([]);
    expect(copy.report.replaced.coded).toBe(0);
    const columns = copy.report.sheets[0]?.columns ?? [];
    expect(columns.find((column) => column.column === 'C')).toMatchObject({ coded: false, canCode: false });
    expect(columns.find((column) => column.column === 'M')).toMatchObject({ coded: false, canCode: false });
    const claims = cellsOf(await partsOf(copy.bytes), 'Claims');
    const changed = columnOf(claims, 'C', 4).filter(([row, value]) => value !== shown(claimsBefore, `C${row}`)).length;
    expect(changed).toBeGreaterThan(190);
  });

  it('leaves a column alone when it is named both to be left alone and to be coded', async () => {
    const copy = await makeCopy(sample, 'workbook', { keep: { Claims: ['E'] }, code: { Claims: ['E'] } });
    expect(copy.legend).toEqual([]);
    expect(copy.report.replaced.coded).toBe(0);
    expect(copy.report.sheets[0]?.columns.find((column) => column.column === 'E')).toMatchObject({ kept: true, coded: false });
    const claims = cellsOf(await partsOf(copy.bytes), 'Claims');
    for (const [row, value] of columnOf(claims, 'E', 4)) expect(value, `row ${row}`).toBe(shown(claimsBefore, `E${row}`));
  });

  it('gives back an empty legend when no column is coded', async () => {
    expect((await makeCopy(sample, 'workbook', {})).legend).toEqual([]);
    expect((await makeCopy(sample, 'workbook', { code: {} })).legend).toEqual([]);
    expect((await makeCopy(bytesOf('Name,Count\r\nCorwin Ashdale,4\r\n'), 'csv', {})).legend).toEqual([]);
  });
});

describe('Cleaner Copy engine: a coded value outside the cells', () => {
  // "Harbor Clinic" sits in a coded column (A) and in a randomized one (B). A place that belongs to one
  // column follows that column; a text that belongs to no column gets the code.
  const cache = (field: (name: string) => string): string =>
    `${HEAD}<pivotCacheDefinition xmlns="${MAIN}" recordCount="3"><cacheSource type="worksheet"><worksheetSource ref="A1:C4" sheet="Visits"/></cacheSource><cacheFields count="3">${field('Clinic')}${field('Referred to')}<cacheField name="Member"><sharedItems containsSemiMixedTypes="0" containsString="0" containsNumber="1" minValue="70411" maxValue="70413"/></cacheField></cacheFields></pivotCacheDefinition>`;
  const items = '<sharedItems count="2"><s v="Harbor Clinic"/><s v="Pinewood Practice"/></sharedItems>';
  const definition = cache((name) => `<cacheField name="${name}">${items}</cacheField>`);
  const records = `${HEAD}<pivotCacheRecords xmlns="${MAIN}" count="2"><r><s v="Harbor Clinic"/><s v="Harbor Clinic"/><n v="70411"/></r><r><x v="1"/><s v="Pinewood Practice"/><n v="70412"/></r></pivotCacheRecords>`;
  const points = (values: (string | number)[]): string => `<c:ptCount val="${values.length}"/>${values.map((value, at) => `<c:pt idx="${at}"><c:v>${value}</c:v></c:pt>`).join('')}`;
  const chart = `${HEAD}<c:chartSpace xmlns:c="${C}"><c:chart><c:plotArea><c:barChart><c:ser><c:cat><c:strRef><c:f>Visits!$A$2:$A$4</c:f><c:strCache>${points(['Harbor Clinic', 'Pinewood Practice', 'Harbor Clinic'])}</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>Visits!$C$2:$C$4</c:f><c:numCache><c:formatCode>General</c:formatCode>${points([70411, 70412, 70413])}</c:numCache></c:numRef></c:val></c:ser><c:ser><c:cat><c:strRef><c:f>'Visits'!$B$2:$B$4</c:f><c:strCache>${points(['Harbor Clinic', 'Pinewood Practice', 'Tamarack House'])}</c:strCache></c:strRef></c:cat></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>`;
  const build = (): Promise<Uint8Array> =>
    workbook({
      sheets: [
        {
          name: 'Visits',
          rows: [
            ['Clinic', 'Referred to', 'Member', 'Same'],
            ['Harbor Clinic', 'Harbor Clinic', 70411, { f: 'IF(B2="Harbor Clinic","same","")', v: 'same' }],
            ['Pinewood Practice', 'Pinewood Practice', 70412, { f: 'IF(A3="Tamarack House","same","")', v: '' }],
            ['Harbor Clinic', 'Tamarack House', 70413, null],
          ],
          after: '<autoFilter ref="A1:D4"><filterColumn colId="0"><filters><filter val="Harbor Clinic"/></filters></filterColumn><filterColumn colId="1"><filters><filter val="Harbor Clinic"/></filters></filterColumn><filterColumn colId="2"><customFilters><customFilter operator="greaterThan" val="70412"/></customFilters></filterColumn></autoFilter>',
        },
      ],
      parts: { 'xl/pivotCache/pivotCacheDefinition1.xml': definition, 'xl/pivotCache/pivotCacheRecords1.xml': records, 'xl/charts/chart1.xml': chart },
      overrides: '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>',
    });

  it('follows the column the place belongs to, and gets the code where no column is named', async () => {
    const copy = await makeCopy(await build(), 'workbook', { code: { Visits: ['A', 'C'] } });
    const after = await partsOf(copy.bytes);
    const cells = cellsOf(after, 'Visits');
    const clinic = codeOf(group(copy.legend, 'Clinic'));
    const member = codeOf(group(copy.legend, 'Member'));
    const harbor = clinic.get('Harbor Clinic') ?? '';
    const pinewood = clinic.get('Pinewood Practice') ?? '';
    expect([harbor, pinewood].sort()).toEqual(['Clinic A', 'Clinic B']);

    // The cells: the coded column shows codes; the other column shows randomized values, never a code or an original.
    expect(shown(cells, 'A2')).toBe(harbor);
    expect(shown(cells, 'A3')).toBe(pinewood);
    expect(shown(cells, 'A4')).toBe(harbor);
    const referred = shown(cells, 'B2');
    expect(referred).not.toBe('Harbor Clinic');
    expect(referred).not.toMatch(/^Clinic [A-Z]+$/);
    expect(shown(cells, 'C2')).toBe(member.get('70411'));

    // A formula's text names no column of its own: one that matches a coded value gets the code.
    expect(formulaOf(cells, 'D2')).toBe(`IF(B2="${harbor}","same","")`);
    // A text only the randomized column holds follows that column.
    expect(formulaOf(cells, 'D3')).toBe(`IF(A3="${shown(cells, 'B4')}","same","")`);

    // The filter: each ticked value follows the column the filter sits on.
    const sheet = part(after, 'xl/worksheets/sheet1.xml');
    const ticked = [...sheet.matchAll(/<(?:filter|customFilter)\b[^>]*\sval="([^"]*)"/g)].map((m) => m[1]);
    expect(ticked).toEqual([harbor, referred, member.get('70412')]);

    // The pivot table's list of values, and its rows.
    const fields = [...part(after, 'xl/pivotCache/pivotCacheDefinition1.xml').matchAll(/<cacheField\b[^>]*>([\s\S]*?)<\/cacheField>/g)].map((m) => [...(m[1] ?? '').matchAll(/<s v="([^"]*)"/g)].map((s) => s[1]));
    expect(fields[0]).toEqual([harbor, pinewood]);
    expect(fields[1]).toEqual([referred, shown(cells, 'B3')]);
    expect(part(after, 'xl/pivotCache/pivotCacheDefinition1.xml')).not.toMatch(/minValue|maxValue/);
    const rows = [...part(after, 'xl/pivotCache/pivotCacheRecords1.xml').matchAll(/<r>([\s\S]*?)<\/r>/g)].map((m) => [...(m[1] ?? '').matchAll(/<[snx] v="([^"]*)"/g)].map((v) => v[1]));
    expect(rows).toEqual([[harbor, referred, member.get('70411')], ['1', shown(cells, 'B3'), member.get('70412')]]);

    // The chart's saved values: each list follows the column it was taken from.
    const lists = [...part(after, 'xl/charts/chart1.xml').matchAll(/<c:(?:strCache|numCache)>([\s\S]*?)<\/c:(?:strCache|numCache)>/g)].map((m) => [...(m[1] ?? '').matchAll(/<c:v>([^<]*)<\/c:v>/g)].map((v) => v[1]));
    expect(lists).toEqual([
      [harbor, pinewood, harbor],
      [member.get('70411'), member.get('70412'), member.get('70413')],
      [referred, shown(cells, 'B3'), shown(cells, 'B4')],
    ]);

    // No original is left anywhere, and the check agrees.
    const everything = allText(after);
    for (const original of ['Harbor Clinic', 'Pinewood Practice', 'Tamarack House', '70411', '70412', '70413']) expect(everything.includes(original), original).toBe(false);
    expect(copy.check.items).toEqual([]);
    expect(copy.report.replaced.coded).toBe(6);
  });

  it('uses "Column" and the letter where the column has no heading', async () => {
    const copy = await makeCopy(bytesOf('4411,Harbor Mutual\r\n4412,Northgate Health\r\n4413,Harbor Mutual\r\n'), 'csv', { code: { 'CSV file': ['B'] } });
    expect(copy.legend.map((g) => g.label)).toEqual(['Column B']);
    expect(copy.legend[0]?.entries.map((entry) => entry.code)).toEqual(['Column B A', 'Column B B']);
    expect(copy.check.items).toEqual([]);
  });
});

describe('Cleaner Copy engine: a coded column in a CSV file', () => {
  const lines = [
    'Member ID,Payer,Seen on,Plan,Visits,Note',
    '00412,"Harbor Mutual, Inc.",2026-01-04,Gold,31,first visit',
    '00977,Northgate Health,2026-01-09,Silver,12,"said ""later"""',
    '00412,"Harbor Mutual, Inc.",2026-02-11,Gold,44,follow up',
    '01530,Northgate Health,2026-02-12,Gold,31,',
  ];
  const source = lines.join('\r\n') + '\r\n';

  it('says at a look which columns can be coded', async () => {
    const report = await inspect(bytesOf(source), 'csv');
    expect(report.sheets[0]?.columns.map((column) => [column.column, column.canCode, column.coded])).toEqual([
      ['A', true, false],
      ['B', true, false],
      ['C', false, false],
      ['D', true, false],
      ['E', true, false],
      ['F', true, false],
    ]);
  });

  it('gets labels for text and whole numbers for numbers, with the file still well formed', async () => {
    const copy = await makeCopy(bytesOf(source), 'csv', { code: { 'CSV file': ['A', 'B', 'C', 'D', 'E'] }, keep: { 'CSV file': ['D'] } });
    const written = textOf(copy.bytes).split('\r\n');
    expect(written.length).toBe(6);
    expect(written[0]).toBe(lines[0]);
    const rows = written.slice(1, 5).map((line) => line.match(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g)?.map((cell) => cell.replace(/,$/, '')).slice(0, 6) ?? []);

    const member = codeOf(group(copy.legend, 'Member ID'));
    const payer = codeOf(group(copy.legend, 'Payer'));
    const visits = codeOf(group(copy.legend, 'Visits'));
    expect(copy.legend.map((g) => [g.label, g.columns])).toEqual([
      ['Member ID', ['column A']],
      ['Payer', ['column B']],
      ['Visits', ['column E']],
    ]);
    // An ID with leading zeros is text: it gets a label, and the legend keeps its zeros.
    expect([...member.keys()].sort()).toEqual(['00412', '00977', '01530']);
    expect([...member.values()].sort()).toEqual(['Member ID A', 'Member ID B', 'Member ID C']);
    expect([...payer.keys()].sort()).toEqual(['Harbor Mutual, Inc.', 'Northgate Health']);
    expect([...visits.keys()].sort()).toEqual(['12', '31', '44']);
    expect([...visits.values()].every((code) => /^\d+$/.test(code) && !['12', '31', '44'].includes(code))).toBe(true);

    expect(rows.map((row) => row[0])).toEqual([member.get('00412'), member.get('00977'), member.get('00412'), member.get('01530')]);
    // A cell that was in quotation marks stays in them.
    expect(rows.map((row) => row[1])).toEqual([`"${payer.get('Harbor Mutual, Inc.')}"`, payer.get('Northgate Health'), `"${payer.get('Harbor Mutual, Inc.')}"`, payer.get('Northgate Health')]);
    expect(rows.map((row) => row[4])).toEqual([visits.get('31'), visits.get('12'), visits.get('44'), visits.get('31')]);
    // The date column cannot be coded and gets randomized dates; the kept column is as it was.
    for (const row of rows) expect(row[2]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rows.map((row) => row[3])).toEqual(['Gold', 'Silver', 'Gold', 'Gold']);

    const columns = copy.report.sheets[0]?.columns ?? [];
    expect(columns.map((column) => column.coded)).toEqual([true, true, false, false, true, false]);
    expect(copy.described[0]?.columns.map((column) => column.coded)).toEqual([true, true, false, false, true, false]);
    expect(copy.described[0]?.rows[0]?.[1]).toBe(payer.get('Harbor Mutual, Inc.'));
    expect(copy.report.replaced.coded).toBe(12);
    expect(copy.report.replaced.kept).toBe(4);

    const everything = textOf(copy.bytes);
    for (const original of ['00412', '00977', '01530', 'Harbor Mutual', 'Northgate Health', 'first visit']) expect(everything.includes(original), original).toBe(false);
    expect(copy.check.ran).toBe(true);
    expect(copy.check.items).toEqual([]);
  });
});

describe('Cleaner Copy engine: the legend as a workbook', () => {
  const legend: LegendGroup[] = [
    { label: 'NDC', columns: ['Claims, column F', 'Fills, column B'], entries: [{ code: 'NDC A', original: '00093714656' }, { code: 'NDC B', original: '007' }] },
    { label: 'Note <internal> & "quoted"', columns: ['column K'], entries: [{ code: 'Note <internal> & "quoted" A', original: 'Ask <Corwin> & "Odalys"\nsecond line \'here\'' }, { code: '1', original: '  0042  ' }, { code: '2', original: '1.50' }] },
  ];

  it('is written at once, as a workbook with one sheet named Legend', () => {
    const bytes = legendWorkbook(legend);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(kindOf('legend.xlsx', bytes)).toEqual({ kind: 'workbook' });
  });

  it('reads back as it was given: headings, then one row for each code', async () => {
    const parts = await partsOf(legendWorkbook(legend));
    expect(part(parts, 'xl/workbook.xml')).toContain('<sheet name="Legend"');
    const cells = cellsOf(parts, 'Legend');
    const row = (n: number): string[] => ['A', 'B', 'C', 'D'].map((column) => shown(cells, `${column}${n}`));
    expect(row(1)).toEqual(['Heading', 'Where', 'Code', 'Original']);
    expect(row(2)).toEqual(['NDC', 'Claims, column F; Fills, column B', 'NDC A', '00093714656']);
    expect(row(3)).toEqual(['NDC', 'Claims, column F; Fills, column B', 'NDC B', '007']);
    expect(row(4)).toEqual(['Note <internal> & "quoted"', 'column K', 'Note <internal> & "quoted" A', 'Ask <Corwin> & "Odalys"\nsecond line \'here\'']);
    expect(row(5)).toEqual(['Note <internal> & "quoted"', 'column K', '1', '  0042  ']);
    expect(row(6)).toEqual(['Note <internal> & "quoted"', 'column K', '2', '1.50']);
    expect(cells.size).toBe(24);
  });

  it('writes every cell as text, so zeros at the start are kept', async () => {
    const sheet = part(await partsOf(legendWorkbook(legend)), 'xl/worksheets/sheet1.xml');
    const cells = [...sheet.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)];
    expect(cells.length).toBe(24);
    for (const cell of cells) {
      expect(cell[1]).toContain('t="inlineStr"');
      expect(cell[2]).toMatch(/^<is><t xml:space="preserve">[^<]*<\/t><\/is>$/);
    }
    expect(sheet).not.toMatch(/<v>/);
    expect(sheet).toContain('<t xml:space="preserve">00093714656</t>');
    expect(sheet).toContain('<t xml:space="preserve">  0042  </t>');
    expect(sheet).toContain('Ask &lt;Corwin&gt; &amp; "Odalys"\nsecond line');
  });

  it('writes only the headings for an empty legend', async () => {
    const cells = cellsOf(await partsOf(legendWorkbook([])), 'Legend');
    expect(cells.size).toBe(4);
    expect(shown(cells, 'D1')).toBe('Original');
  });

  it('takes the legend a copy gives back', async () => {
    const copy = await makeCopy(sample, 'workbook', { code: { Claims: ['E', 'F'] } });
    const cells = cellsOf(await partsOf(legendWorkbook(copy.legend)), 'Legend');
    const entries = copy.legend.flatMap((g) => g.entries.map((entry) => [g.label, g.columns.join('; '), entry.code, entry.original]));
    expect(cells.size).toBe(4 * (entries.length + 1));
    entries.forEach((entry, at) => expect(['A', 'B', 'C', 'D'].map((column) => shown(cells, `${column}${at + 2}`))).toEqual(entry));
    // The NDC column of the sample is text with zeros at the start of some values; each is in the legend as written.
    const ndc = new Set(columnOf(claimsBefore, 'F', 4).map(([, value]) => value));
    expect(new Set(group(copy.legend, 'NDC').entries.map((entry) => entry.original))).toEqual(ndc);
  });
});
