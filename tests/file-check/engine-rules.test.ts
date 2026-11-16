import { describe, expect, it } from 'vitest';
import { kindOf as cleanerCopyKindOf, sampleBytes } from '../../src/scripts/cleaner-copy/engine/index.js';
import { type CheckReport, type Finding, type RuleId, checkFile, kindOf } from '../../src/scripts/file-check/engine/index.js';
import { CASES, get, set } from './fixtures/cases';
import { type Cell, claims, claimsCsv, csv, workbook } from './fixtures/workbooks';

const rulesOf = (report: CheckReport): RuleId[] => [...new Set(report.findings.map((finding) => finding.rule))].sort();
const one = (report: CheckReport, rule: RuleId): Finding => {
  const found = report.findings.filter((finding) => finding.rule === rule);
  if (found.length !== 1 || !found[0]) throw new Error(`expected one ${rule} finding, got ${found.length}`);
  return found[0];
};
const check = async (rows: Cell[][], more: { merges?: string[]; table?: { ref: string; totals?: boolean } } = {}): Promise<CheckReport> => checkFile(await workbook([{ name: 'Sheet1', rows, ...more }]), 'workbook');

describe('File Check engine: one made-up file for each rule', () => {
  for (const made of CASES) {
    it(`${made.name}: ${made.rules.length ? made.rules.join(' and ') : 'nothing is reported'}`, async () => {
      const bytes = await made.bytes();
      const told = kindOf(made.kind === 'csv' ? 'claims.csv' : 'claims.xlsx', bytes);
      expect(told).toEqual({ kind: made.kind });
      const report = await checkFile(bytes, made.kind);
      expect(report.kind).toBe(made.kind);
      expect(rulesOf(report)).toEqual([...made.rules].sort());
      expect(report.sheets.map((sheet) => sheet.name)).toEqual([made.kind === 'csv' ? 'CSV file' : 'Claims']);
    });
  }
});

describe('File Check engine: what each finding says', () => {
  const report = async (name: string): Promise<CheckReport> => {
    const made = CASES.find((item) => item.name.startsWith(name));
    if (!made) throw new Error(`no fixture named ${name}`);
    return checkFile(await made.bytes(), made.kind);
  };

  it('number-as-text gives the column, its heading, the count and the cells', async () => {
    const finding = one(await report('number-as-text: three'), 'number-as-text');
    expect(finding).toMatchObject({ weight: 'fix', sheet: 'Claims', column: 'F', heading: 'Paid', count: 3, where: ['F6', 'F13', 'F24'] });
    expect(finding.say).toBe('Column F (Paid) has 3 cells where a number is stored as text (F6, F13 and F24).');
    expect(finding.examples.map((example) => example.at)).toEqual(['F6', 'F13', 'F24']);
    expect(finding.examples[0]?.value).toBe('1270.13');
  });

  it('number-as-text for a whole column counts every cell and lists five', async () => {
    const amounts = one(await report('number-as-text: a whole column of amounts'), 'number-as-text');
    expect(amounts.count).toBe(30);
    expect(amounts.where).toEqual(['F2', 'F3', 'F4', 'F5', 'F6']);
    expect(amounts.say).toBe('Column F (Paid) stores its numbers as text in 30 cells, so a sum of the column comes to zero (F2, F3, F4, F5, F6 and 25 more).');
    const counts = one(await report('number-as-text: a whole column of counts'), 'number-as-text');
    expect(counts).toMatchObject({ column: 'E', heading: 'Qty', count: 30 });
  });

  it('leading-zeros is a note, and says the column must stay text', async () => {
    const finding = one(await report('leading-zeros: a column'), 'leading-zeros');
    expect(finding).toMatchObject({ weight: 'note', column: 'G', heading: 'NDC', count: 30 });
    expect(finding.say).toBe('Column G (NDC) holds codes made of digits, and 30 of them start with a zero (G2, G3, G4, G5, G6 and 25 more).');
    expect(finding.fix).toBe('Keep this column as text. If it is turned into numbers, the zeros in front are lost.');
  });

  it('mixed-kinds names the kind most cells have and the kind the others have', async () => {
    const found = (await report('mixed-kinds')).findings;
    expect(found.map((finding) => [finding.column, finding.count, finding.weight, finding.say])).toEqual([
      ['C', 1, 'fix', 'Column C (Fill date) is mostly dates, and 1 cell holds a number (C13).'],
      ['F', 2, 'fix', 'Column F (Paid) is mostly numbers, and 2 cells hold text (F5 and F10).'],
    ]);
    expect(found[1]?.examples).toEqual([
      { at: 'F5', value: 'n/a' },
      { at: 'F10', value: 'TBD' },
    ]);
  });

  it('mixed-dates counts the dates typed as text among real dates', async () => {
    const finding = one(await report('mixed-dates: dates typed'), 'mixed-dates');
    expect(finding).toMatchObject({ weight: 'fix', column: 'C', count: 3, where: ['C4', 'C9', 'C21'] });
    expect(finding.say).toBe('Column C (Fill date) has real dates, and 3 cells where a date is typed as text (C4, C9 and C21).');
  });

  it('mixed-dates in a CSV file names the forms and counts the cells in the less common one', async () => {
    const finding = one(await report('mixed-dates in a CSV file'), 'mixed-dates');
    expect(finding).toMatchObject({ sheet: 'CSV file', column: 'C', count: 3, where: ['C4', 'C9', 'C21'] });
    expect(finding.say).toBe('Column C (Fill date) writes its dates with the year first and with slashes; 3 cells differ from the form the column uses the most (C4, C9 and C21).');
  });

  it('stray-spaces says which kinds of stray space it saw', async () => {
    const finding = one(await report('stray-spaces'), 'stray-spaces');
    expect(finding).toMatchObject({ weight: 'look', column: 'B', count: 4, where: ['B3', 'B7', 'B12', 'B16'] });
    expect(finding.say).toBe('Column B (Patient) has 4 cells with stray spaces: a space before or after the text, two spaces in a row, a non-breaking space (the kind copied from a web page) or nothing but spaces (B3, B7, B12 and B16).');
  });

  it('near-duplicates counts the values and the cells, and shows each spelling as an example', async () => {
    const finding = one(await report('near-duplicates'), 'near-duplicates');
    expect(finding).toMatchObject({ weight: 'fix', column: 'D', heading: 'Payer', count: 3, where: ['D5', 'D8', 'D11'] });
    expect(finding.say).toBe('Column D (Payer) has 2 values that are each written in more than one way, differing in a final full stop, in spaces or in capital letters; 3 cells differ from the usual spelling (D5, D8 and D11).');
    expect(finding.examples.map((example) => example.value).sort()).toEqual(['MEDICAID', 'Medicaid', 'Medicare', 'Medicare.', 'medicaid']);
  });

  it('merged-cells gives the ranges', async () => {
    const finding = one(await report('merged-cells'), 'merged-cells');
    expect(finding).toMatchObject({ weight: 'fix', count: 1, where: ['D5:D6'] });
    expect(finding.column).toBeUndefined();
    expect(finding.say).toBe('This sheet has 1 merged range in the rows of data (D5:D6).');
  });

  it('merged-cells above the headings only is worth a look', async () => {
    const rows = claims();
    rows.unshift(['Claims for the quarter'], []);
    const finding = one(await check(rows, { merges: ['A1:F1'] }), 'merged-cells');
    expect(finding.weight).toBe('look');
    expect(finding.say).toBe('This sheet has 1 merged range above the headings (A1:F1).');
  });

  it('blank-rows gives the rows', async () => {
    const finding = one(await report('blank-rows:'), 'blank-rows');
    expect(finding).toMatchObject({ weight: 'fix', count: 1, where: ['row 11'] });
    expect(finding.say).toBe('This sheet has 1 fully empty row inside the data (row 11).');
  });

  it('total-row finds a row of sums, a typed row that starts with the word, and sums with no word', async () => {
    const sums = one(await report('total-row: a row of sums'), 'total-row');
    expect(sums).toMatchObject({ weight: 'fix', count: 1, where: ['row 32'], examples: [{ at: 'A32', value: 'Total' }] });
    expect(sums.say).toBe('This sheet has 1 row that adds up other rows (row 32).');
    expect(one(await report('total-row: a typed row'), 'total-row').where).toEqual(['row 17']);
    expect(one(await report('total-row: sums with no word'), 'total-row').where).toEqual(['row 32']);
  });

  it('total-row trusts a table that names its own row of totals', async () => {
    const rows = claims(6);
    rows.push(['All', null, null, null, 300, 7250.44]);
    expect(one(await check(rows, { table: { ref: 'A1:F8', totals: true } }), 'total-row').where).toEqual(['row 8']);
  });

  it('total-row leaves a value that only starts with the word alone', async () => {
    const rows: Cell[][] = [['Test', 'Result']];
    for (let at = 0; at < 12; at++) rows.push([['Total cholesterol', 'Total bilirubin', 'Total protein'][at % 3] ?? '', 140.5 + at]);
    expect((await check(rows)).findings).toEqual([]);
  });

  it('repeated-heading names the heading and the columns that share it', async () => {
    const finding = one(await report('repeated-heading: two columns'), 'repeated-heading');
    expect(finding).toMatchObject({ weight: 'fix', count: 2, where: ['F1', 'G1'] });
    expect(finding.say).toBe('This sheet uses the heading "Paid" on 2 columns (F1 and G1).');
    const again = one(await report('repeated-heading: the row of headings'), 'repeated-heading');
    expect(again.where).toEqual(['row 16']);
    expect(again.say).toBe('This sheet repeats its row of headings inside the data in 1 row (row 16).');
  });

  it('empty-heading gives the place where the heading should be', async () => {
    const finding = one(await report('empty-heading'), 'empty-heading');
    expect(finding).toMatchObject({ weight: 'fix', column: 'E', count: 1, where: ['E1'] });
    expect(finding.heading).toBeUndefined();
    expect(finding.say).toBe('This sheet has 1 column that holds data under an empty heading (E1).');
  });

  it('empty-heading speaks for a sheet with no row of headings at all', async () => {
    const rows: Cell[][] = Array.from({ length: 12 }, (_, at) => [1000 + at, 20.5 + at, 3 + at]);
    const report = await check(rows);
    expect(report.sheets[0]?.headingRow).toBeNull();
    expect(one(report, 'empty-heading').say).toBe('This check found no row of headings on this sheet, which has 3 columns of data.');
  });

  it('two-heading-rows gives both rows, and the data is read from the row under them', async () => {
    const under = await report('two-heading-rows: a row of units');
    expect(one(under, 'two-heading-rows')).toMatchObject({ weight: 'fix', count: 2, where: ['row 1', 'row 2'] });
    expect(under.sheets[0]).toEqual({ name: 'Claims', rows: 30, columns: 6, headingRow: 1, headingsSure: true, hidden: false });
    const above = await report('two-heading-rows: merged group headings');
    expect(one(above, 'two-heading-rows').where).toEqual(['row 1', 'row 2']);
    expect(above.sheets[0]?.headingRow).toBe(2);
    expect(one(above, 'merged-cells').say).toBe('This sheet has 2 merged ranges in the headings (A1:B1 and C1:F1).');
  });

  it('two-heading-rows leaves a line of title text above the headings alone', async () => {
    const rows = claims();
    rows.unshift(['Claims for the quarter', 'Prepared in March', 'Draft']);
    expect((await check(rows)).findings).toEqual([]);
  });

  it('repeated-id counts the values and the cells that hold them', async () => {
    const finding = one(await report('repeated-id'), 'repeated-id');
    expect(finding).toMatchObject({ weight: 'look', column: 'A', heading: 'Claim ID', count: 4, where: ['A6', 'A13', 'A23', 'A31'] });
    expect(finding.say).toBe('In column A (Claim ID), 2 values appear more than once, in 4 cells, while every other value appears once (A6, A13, A23 and A31).');
  });

  it('error-cells counts cells that show an error, and never names the error in its sentence', async () => {
    const finding = one(await report('error-cells: two'), 'error-cells');
    expect(finding).toMatchObject({ weight: 'fix', column: 'F', count: 2, where: ['F7', 'F20'] });
    expect(finding.say).toBe('Column F (Paid) has 2 cells that show an error code where a value should be (F7 and F20).');
    expect(finding.examples).toEqual([
      { at: 'F7', value: '#DIV/0!' },
      { at: 'F20', value: '#N/A' },
    ]);
  });

  it('uneven-rows gives the rows and the number of fields the headings have', async () => {
    const finding = one(await report('uneven-rows'), 'uneven-rows');
    expect(finding).toMatchObject({ weight: 'fix', sheet: 'CSV file', count: 2, where: ['row 8', 'row 13'], examples: [] });
    expect(finding.say).toBe('This file has 2 rows with more or fewer fields than the row of headings, which has 6 (row 8 and row 13).');
  });

  it('decimal-comma counts the amounts written with a comma', async () => {
    const finding = one(await report('decimal-comma'), 'decimal-comma');
    expect(finding).toMatchObject({ weight: 'fix', column: 'F', heading: 'Paid', count: 30 });
    expect(finding.say).toBe('Column F (Paid) has 30 cells where the decimal point is written as a comma (F2, F3, F4, F5, F6 and 25 more).');
    expect(finding.examples[0]).toEqual({ at: 'F2', value: '1.105,37' });
  });
});

describe('File Check engine: thresholds', () => {
  /** A table of two columns: a label, and the values under test. */
  const column = (values: Cell[], heading = 'Value'): Cell[][] => [['Item', heading], ...values.map((value, at): Cell[] => [`Item ${String.fromCharCode(65 + (at % 26))}${at}`, value])];
  const numbers = (count: number): Cell[] => Array.from({ length: count }, (_, at) => 210.5 + at * 3);
  const has = async (values: Cell[], rule: RuleId, heading?: string): Promise<boolean> => (await check(column(values, heading))).findings.some((finding) => finding.rule === rule);

  it('number-as-text: speaks when 80% of the column reads as a number, and not at 70%', async () => {
    expect(await has([...numbers(6), '412.50', '388.25', 'pending', 'on hold'], 'number-as-text')).toBe(true);
    expect(await has([...numbers(5), '412.50', '388.25', 'pending', 'on hold', 'waiting'], 'number-as-text')).toBe(false);
  });

  it('number-as-text: one text among numbers is enough, and a column of numbers alone is silent', async () => {
    expect(await has([...numbers(9), '412.50'], 'number-as-text')).toBe(true);
    expect(await has(numbers(10), 'number-as-text')).toBe(false);
  });

  it('number-as-text, whole column: speaks at 90% of the cells, and not at 80%', async () => {
    const texts = (count: number): Cell[] => Array.from({ length: count }, (_, at) => (210.5 + at * 3).toFixed(2));
    expect(await has([...texts(9), 'pending'], 'number-as-text')).toBe(true);
    expect(await has([...texts(8), 'pending', 'on hold'], 'number-as-text')).toBe(false);
  });

  it('number-as-text, whole column: codes made of digits, in General format, are left alone', async () => {
    expect((await check(column(Array.from({ length: 12 }, (_, at) => String(48213 + (at % 4))), 'Site'))).findings).toEqual([]);
  });

  it('leading-zeros: speaks at 2 cells that start with a zero, and not at 1', async () => {
    const codes = (zeros: number): Cell[] => Array.from({ length: 12 }, (_, at) => (at < zeros ? `0${4410 + (at % 3)}` : String(54410 + (at % 3))));
    expect(await has(codes(2), 'leading-zeros', 'Site')).toBe(true);
    expect(await has(codes(1), 'leading-zeros', 'Site')).toBe(false);
  });

  it('mixed-kinds: speaks when 80% of the column is one kind, and not at 70%', async () => {
    expect(await has([...numbers(8), 'pending', 'on hold'], 'mixed-kinds')).toBe(true);
    expect(await has([...numbers(7), 'pending', 'on hold', 'waiting'], 'mixed-kinds')).toBe(false);
  });

  it('near-duplicates: speaks in a column of 50 different values, and not in one of 51', async () => {
    const sites = (different: number): Cell[] => [...Array.from({ length: different * 2 }, (_, at) => `Clinic ${String.fromCharCode(65 + (at % different) % 26)}${Math.floor((at % different) / 26)}`), 'CLINIC A0'];
    expect(await has(sites(50), 'near-duplicates')).toBe(true);
    expect(await has(sites(51), 'near-duplicates')).toBe(false);
  });

  it('repeated-id: speaks when the repeats are 5% of the cells, and not when they are more', async () => {
    const ids = (count: number, repeats: number): Cell[] => Array.from({ length: count }, (_, at) => `RX-${70311 + (at < repeats ? count - 1 - at : at) * 3}`);
    expect(await has(ids(40, 2), 'repeated-id', 'Rx number')).toBe(true);
    expect(await has(ids(40, 3), 'repeated-id', 'Rx number')).toBe(false);
    expect(await has(ids(40, 0), 'repeated-id', 'Rx number')).toBe(false);
  });

  it('repeated-id: needs at least 20 filled cells', async () => {
    const ids = (count: number): Cell[] => Array.from({ length: count }, (_, at) => `RX-${70311 + (at === 0 ? count - 1 : at) * 3}`);
    expect(await has(ids(20), 'repeated-id', 'Rx number')).toBe(true);
    expect(await has(ids(19), 'repeated-id', 'Rx number')).toBe(false);
  });

  it('repeated-id: amounts, names and counts that happen to repeat are left alone', async () => {
    const rows = claims(40);
    // Two patients share a name, two claims share an amount, and a column of whole dollars has a repeat.
    set(rows, 12, 1, get(rows, 5, 1));
    set(rows, 30, 5, get(rows, 22, 5));
    rows.forEach((row, at) => row.push(at === 0 ? 'Billed' : at === 9 ? 1403 : 1400 + at * 3));
    expect((await check(rows)).findings).toEqual([]);
  });

  it('decimal-comma: speaks at 2 such cells, and not at 1', async () => {
    const file = (commas: number) => {
      const lines = claimsCsv();
      for (let at = 1; at <= commas; at++) {
        const line = lines[at];
        if (line) line[5] = (line[5] ?? '').replace('.', ',');
      }
      return checkFile(csv(lines, ';'), 'csv');
    };
    expect((await file(2)).findings.some((finding) => finding.rule === 'decimal-comma')).toBe(true);
    expect((await file(1)).findings.some((finding) => finding.rule === 'decimal-comma')).toBe(false);
  });
});

describe('File Check engine: the report as a whole', () => {
  it('sorts to fix first, then worth a look, then good to know; within each, by sheet and then by column', async () => {
    const first = claims();
    set(first, 3, 5, 'n/a'); // F: mixed-kinds, to fix
    set(first, 4, 1, ` ${String(get(first, 4, 1))}`); // B: stray-spaces, worth a look
    set(first, 6, 3, 'medicaid'); // D: near-duplicates, to fix
    const second = claims();
    second.forEach((row, at) => row.push(at === 0 ? 'ZIP' : `0286${at % 4}`)); // G: leading-zeros, good to know
    set(second, 8, 4, { error: '#REF!' }); // E: error-cells, to fix
    second.splice(20, 0, []); // blank-rows, to fix, about no one column
    const report = await checkFile(
      await workbook([
        { name: 'January', rows: first },
        { name: 'February', rows: second, hidden: true },
      ]),
      'workbook',
    );
    expect(report.findings.map((finding) => [finding.weight, finding.sheet, finding.column ?? '', finding.rule])).toEqual([
      ['fix', 'January', 'D', 'near-duplicates'],
      ['fix', 'January', 'F', 'mixed-kinds'],
      ['fix', 'February', '', 'blank-rows'],
      ['fix', 'February', 'E', 'error-cells'],
      ['look', 'January', 'B', 'stray-spaces'],
      ['note', 'February', 'G', 'leading-zeros'],
    ]);
    expect(report.sheets).toEqual([
      { name: 'January', rows: 30, columns: 6, headingRow: 1, headingsSure: true, hidden: false },
      { name: 'February', rows: 30, columns: 7, headingRow: 1, headingsSure: true, hidden: true },
    ]);
  });

  it('gives a finding only the fields the contract names', async () => {
    const made = CASES.find((item) => item.name.startsWith('number-as-text: three'));
    const report = await checkFile((await made?.bytes()) ?? new Uint8Array(), 'workbook');
    expect(Object.keys(report).sort()).toEqual(['findings', 'kind', 'sheets']);
    expect(Object.keys(report.findings[0] ?? {}).sort()).toEqual(['column', 'count', 'examples', 'fix', 'heading', 'rule', 'say', 'sheet', 'weight', 'where']);
  });

  it('lists at most 5 places and 5 examples, however many cells there are', async () => {
    for (const made of CASES) {
      const report = await checkFile(await made.bytes(), made.kind);
      for (const finding of report.findings) {
        expect(finding.where.length).toBeLessThanOrEqual(5);
        expect(finding.examples.length).toBeLessThanOrEqual(5);
        expect(finding.count).toBeGreaterThanOrEqual(Math.max(1, finding.where.length));
      }
    }
  });

  it('changes nothing in the file it is given', async () => {
    const bytes = await workbook([{ name: 'Claims', rows: claims() }]);
    const before = bytes.slice();
    await checkFile(bytes, 'workbook');
    expect(bytes).toEqual(before);
  });

  it('reads an empty sheet and a sheet of one cell without a finding about cells', async () => {
    const report = await checkFile(
      await workbook([
        { name: 'Empty', rows: [] },
        { name: 'Title', rows: [['Notes for the team']] },
      ]),
      'workbook',
    );
    expect(report.sheets).toEqual([
      { name: 'Empty', rows: 0, columns: 0, headingRow: null, headingsSure: false, hidden: false },
      { name: 'Title', rows: 0, columns: 1, headingRow: 1, headingsSure: false, hidden: false },
    ]);
    expect(report.findings).toEqual([]);
  });

  it('uses the Cleaner Copy engine to tell the kinds of file apart, and refuses what that engine refuses', async () => {
    expect(kindOf).toBe(cleanerCopyKindOf);
    const pdf = new TextEncoder().encode('%PDF-1.7 not a spreadsheet');
    const told = kindOf('report.pdf', pdf);
    expect('problem' in told).toBe(true);
    await expect(checkFile(pdf, 'csv')).rejects.toThrow('problem' in told ? told.problem : '');
    await expect(checkFile(new Uint8Array(), 'workbook')).rejects.toThrow('This file is empty.');
  });
});

describe('File Check engine: the Cleaner Copy sample workbook', () => {
  it('reports what is truly in it: a row of totals on Summary and ZIP codes with zeros in front on Patients', async () => {
    const report = await checkFile(sampleBytes(), 'workbook');
    expect(report.sheets).toEqual([
      { name: 'Claims', rows: 200, columns: 15, headingRow: 3, headingsSure: true, hidden: false },
      { name: 'Patients', rows: 40, columns: 7, headingRow: 1, headingsSure: true, hidden: false },
      { name: 'Notes', rows: 6, columns: 1, headingRow: 1, headingsSure: false, hidden: true },
      { name: 'Summary', rows: 4, columns: 2, headingRow: 3, headingsSure: true, hidden: false },
      { name: 'Panel', rows: 4, columns: 3, headingRow: 2, headingsSure: true, hidden: false },
    ]);
    expect(report.findings.map((finding) => [finding.weight, finding.sheet, finding.column ?? '', finding.rule, finding.count, finding.where])).toEqual([
      ['fix', 'Summary', '', 'total-row', 1, ['row 7']],
      ['note', 'Patients', 'G', 'leading-zeros', 40, ['G2', 'G3', 'G4', 'G5', 'G6']],
    ]);
  });
});
