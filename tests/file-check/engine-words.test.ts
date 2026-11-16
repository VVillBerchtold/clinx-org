// What File Check says, read as a person would read it: no value from the file in any sentence,
// none of the words the site does not use, and counts that agree with their nouns.

import { describe, expect, it } from 'vitest';
import { sampleBytes } from '../../src/scripts/cleaner-copy/engine/index.js';
import { type CheckReport, type RuleId, asText, checkFile } from '../../src/scripts/file-check/engine/index.js';
import { CASES, get, set } from './fixtures/cases';
import { type Cell, type SheetSpec, claims, claimsCsv, csv, workbook } from './fixtures/workbooks';

const book = async (rows: Cell[][], more: Partial<SheetSpec> = {}): Promise<CheckReport> => checkFile(await workbook([{ name: 'Claims', rows, ...more }]), 'workbook');
const file = (lines: string[][], separator = ','): Promise<CheckReport> => checkFile(csv(lines, separator), 'csv');
const text = (cell: Cell): string => (typeof cell === 'string' ? cell : typeof cell === 'number' ? String(cell) : '');
const only = (report: CheckReport, rule: RuleId) => {
  const found = report.findings.filter((finding) => finding.rule === rule);
  if (found.length !== 1 || !found[0]) throw new Error(`expected one ${rule} finding, got ${found.length}: ${report.findings.map((finding) => finding.rule).join(', ')}`);
  return found[0];
};

/** Every sentence a report holds that a person may copy out of the page: each `say`, each `fix`, each place, and the text for pasting. */
const sentences = (report: CheckReport): string[] => [...report.findings.flatMap((finding) => [finding.say, finding.fix, ...finding.where]), asText(report)];

// ---- A file where every value under the headings carries a mark, and nearly every rule speaks ----

/** No sentence may hold "zqx", "9753", "2031" or "#": every text, number, date and error in the two files below has one of them. */
const MARK = /zqx|9753|2031|#/i;

function markedRows(): Cell[][] {
  const rows: Cell[][] = [['Visit ID', 'Clinic', 'Seen on', 'Amount', 'Units', 'Site code', 'Paid in full']];
  for (let at = 0; at < 40; at++) {
    const day = new Date(Date.UTC(2031, 0, 2 + at * 2)).toISOString().slice(0, 10);
    rows.push([`ZQX-${5100 + at * 3}`, `Zqx ${['North', 'South', 'East'][at % 3]}`, { date: day }, 9753.25 + at, { text: String(97530 + at), format: 'amount' }, `09753${at % 4}`, { bool: at % 2 === 0 }]);
  }
  set(rows, 9, 0, get(rows, 4, 0)); // repeated-id
  set(rows, 6, 1, 'zqx north'); // near-duplicates
  set(rows, 7, 1, ' Zqx South'); // stray-spaces
  set(rows, 11, 2, '3/4/2031'); // mixed-dates
  set(rows, 12, 2, 'zqx unknown'); // mixed-kinds among dates
  set(rows, 14, 3, '9753.50'); // number-as-text
  set(rows, 15, 3, 'zqx pending'); // mixed-kinds among numbers
  set(rows, 16, 3, { error: '#DIV/0!' }); // error-cells
  set(rows, 18, 6, 'zqx maybe'); // mixed-kinds among yes/no values
  rows.splice(20, 0, []); // blank-rows
  rows.splice(30, 0, rows[0]?.slice() ?? []); // repeated-heading
  rows.push(['Total', null, null, { formula: 'SUM(D2:D43)', result: 397531.5 }]); // total-row
  for (const row of rows) if (row.length) row.push(row === rows[0] ? 'Amount' : 9753); // repeated-heading on two columns
  for (const row of rows) if (row.length > 4) row.push(row === rows[0] ? null : 'zqx note'); // empty-heading
  return rows;
}

function markedLines(): string[][] {
  const lines: string[][] = [['Visit ID', 'Clinic', 'Seen on', 'Amount', 'Site code']];
  for (let at = 0; at < 40; at++) {
    const day = new Date(Date.UTC(2031, 0, 2 + at * 2)).toISOString().slice(0, 10);
    lines.push([`ZQX-${5100 + at * 3}`, `Zqx ${['North', 'South', 'East'][at % 3]}`, day, `${9753 + at}.25`, `09753${at % 4}`]);
  }
  const at = (row: number): string[] => lines[row] ?? [];
  at(9)[0] = at(4)[0] ?? '';
  at(6)[1] = 'ZQX NORTH';
  at(7)[1] = 'Zqx  South';
  at(11)[2] = '3/4/2031';
  at(14)[3] = '$9,753.50';
  at(15)[3] = 'zqx pending';
  at(16)[3] = '#N/A';
  at(17)[3] = '9753,75';
  at(18)[3] = '9753,80';
  at(22).push('zqx extra');
  lines.splice(25, 0, ['']);
  lines.push(['Total', '', '', '397531.50', '']);
  return lines;
}

describe('File Check wording: no value from the file reaches a sentence', () => {
  it('a workbook where 13 rules speak: every sentence is free of the marked values, and the examples hold them', async () => {
    const report = await book(markedRows(), { merges: ['B24:B25'] });
    const rules = [...new Set(report.findings.map((finding) => finding.rule))].sort();
    expect(rules).toEqual(['blank-rows', 'empty-heading', 'error-cells', 'leading-zeros', 'merged-cells', 'mixed-dates', 'mixed-kinds', 'near-duplicates', 'number-as-text', 'repeated-heading', 'repeated-id', 'stray-spaces', 'total-row']);
    for (const sentence of sentences(report)) expect(sentence).not.toMatch(MARK);
    // The values are there to be leaked: the examples, which stay on the person's own screen, show them.
    const examples = report.findings.flatMap((finding) => finding.examples.map((example) => example.value));
    expect(examples.filter((value) => MARK.test(value)).length).toBeGreaterThan(20);
    expect(examples).toEqual(expect.arrayContaining(['#DIV/0!', 'zqx pending', '9753.50', '3/4/2031', ' Zqx South', 'zqx north']));
  });

  it('a CSV file where 12 rules speak: the same', async () => {
    const report = await file(markedLines(), ';');
    const rules = [...new Set(report.findings.map((finding) => finding.rule))].sort();
    expect(rules).toEqual(['blank-rows', 'decimal-comma', 'error-cells', 'leading-zeros', 'mixed-dates', 'mixed-kinds', 'near-duplicates', 'number-as-text', 'repeated-id', 'stray-spaces', 'total-row', 'uneven-rows']);
    for (const sentence of sentences(report)) expect(sentence).not.toMatch(MARK);
    const examples = report.findings.flatMap((finding) => finding.examples.map((example) => example.value));
    expect(examples).toEqual(expect.arrayContaining(['#N/A', 'zqx pending', '$9,753.50', '9753,75', '3/4/2031', 'Zqx  South', 'ZQX NORTH']));
  });

  it('every made-up file of the rule tests: none of its values, and none of the examples, is in a sentence', async () => {
    let checked = 0;
    for (const made of CASES) {
      const report = await checkFile(await made.bytes(), made.kind);
      const said = sentences(report).join('\n').toLowerCase();
      const headings = new Set(report.findings.map((finding) => finding.heading?.toLowerCase()));
      const values = [...made.values, ...report.findings.flatMap((finding) => finding.examples.map((example) => example.value))];
      // A value of 1 or 2 characters, such as a count of 30, is left out: the sentences hold counts of their own.
      for (const value of new Set(values.map((item) => item.trim().toLowerCase()).filter((item) => item.length >= 3 && !headings.has(item)))) {
        if (said.includes(value)) throw new Error(`"${value}" from the file "${made.name}" is in a sentence`);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(3000);
  });

  it('the text for pasting is built from the sentences alone', async () => {
    const report = await book(markedRows(), { merges: ['B24:B25'] });
    const pasted = asText(report);
    for (const finding of report.findings) {
      expect(pasted).toContain(finding.say);
      expect(pasted).toContain(finding.fix);
    }
    // Handing it a report whose examples were changed gives the same text: it never reads them.
    const changed: CheckReport = { ...report, findings: report.findings.map((finding) => ({ ...finding, examples: [{ at: 'A1', value: 'zqx changed' }] })) };
    expect(asText(changed)).toBe(pasted);
  });
});

// ---- Every sentence the engine can write, for the checks on wording ----

interface Told {
  name: string;
  report: CheckReport;
}

async function everyReport(): Promise<Told[]> {
  const out: Told[] = [];
  for (const made of CASES) out.push({ name: made.name, report: await checkFile(await made.bytes(), made.kind) });
  out.push({ name: 'marked workbook', report: await book(markedRows(), { merges: ['B24:B25'] }) });
  out.push({ name: 'marked CSV file', report: await file(markedLines(), ';') });
  out.push({ name: 'the sample', report: await checkFile(sampleBytes(), 'workbook') });
  for (const [name, report] of Object.entries(await variants())) out.push({ name, report });
  return out;
}

/** The same findings with other counts, so each sentence is seen with 1 and with more than 1. */
async function variants(): Promise<Record<string, CheckReport>> {
  const change = (edit: (rows: Cell[][]) => void, count = 30): Cell[][] => {
    const rows = claims(count);
    edit(rows);
    return rows;
  };
  const lines = (edit: (rows: string[][]) => void): string[][] => {
    const rows = claimsCsv();
    edit(rows);
    return rows;
  };
  return {
    'one number as text': await book(change((rows) => set(rows, 5, 5, text(get(rows, 5, 5))))),
    'one date as text': await book(change((rows) => set(rows, 3, 2, '3/4/2026'))),
    'dates as text in two forms': await book(change((rows) => rows.forEach((_, at) => at && set(rows, at, 2, at === 7 ? '2026-03-04' : `${(at % 12) + 1}/${(at % 27) + 1}/2026`)))),
    'one stray space': await book(change((rows) => set(rows, 2, 1, `${text(get(rows, 2, 1))} `))),
    'one spelling apart': await book(change((rows) => set(rows, 4, 3, 'medicaid'))),
    'one repeated ID': await book(change((rows) => set(rows, 12, 0, get(rows, 5, 0)), 40)),
    'one error': await book(change((rows) => set(rows, 6, 5, { error: '#REF!' }))),
    'a number among text, text among yes/no values': await book(
      change((rows) => {
        set(rows, 8, 3, 4417);
        rows.forEach((row, at) => row.push(at === 0 ? 'Refill' : at === 14 ? 'unknown' : { bool: at % 2 === 0 }));
      }),
    ),
    'two merged ranges in the data, one above': await book(
      change((rows) => {
        rows.unshift(['Claims for the quarter'], []);
        set(rows, 7, 3, null);
        set(rows, 12, 3, null);
      }),
      { merges: ['A1:F1', 'D7:D8', 'D12:D13'] },
    ),
    'two empty rows, two rows of sums, the headings twice more': await book(
      change((rows) => {
        rows.splice(8, 0, [], ['Subtotal', null, null, null, 210, 4421.48]);
        rows.splice(16, 0, rows[0]?.slice() ?? []);
        rows.splice(24, 0, [], rows[0]?.slice() ?? []);
        rows.push(['Grand Total', null, null, null, 1800, 51079.65]);
      }),
    ),
    'two headings on two columns each, two columns with no heading': await book(
      change((rows) => {
        rows.forEach((row, at) => row.push(at === 0 ? 'Paid' : 10.5 + at, at === 0 ? 'Payer' : 'Self-pay', at === 0 ? null : 3.5 + at, at === 0 ? null : 7.25 + at));
      }),
    ),
    'no row of headings': await book(Array.from({ length: 12 }, (_, at): Cell[] => [1000 + at, 20.5 + at, 3 + at])),
    'one column and no row of headings': await book(Array.from({ length: 12 }, (_, at): Cell[] => [1000.5 + at])),
    'a CSV file with one uneven row, one error, one amount with a sign': await file(
      lines((rows) => {
        rows[7]?.push('extra');
        const first = rows[9];
        const second = rows[12];
        if (first) first[5] = '#REF!';
        if (second) second[5] = '$1,599.65';
      }),
    ),
    'a CSV file with every amount written with a sign': await file(lines((rows) => rows.forEach((row, at) => at && (row[5] = `$${row[5]}`)))),
    'a CSV file with no row of headings and an uneven row': await file(Array.from({ length: 12 }, (_, at) => (at === 5 ? ['1005', '20.5'] : [String(1000 + at), (20.5 + at).toFixed(2), String(3 + at)]))),
  };
}

describe('File Check wording: the words themselves', () => {
  it('every sentence is plain: no word the site does not use, no neat contrast, no leftovers of the code', async () => {
    const seen = new Set<string>();
    for (const { name, report } of await everyReport()) {
      for (const finding of report.findings) {
        for (const sentence of [finding.say, finding.fix]) {
          seen.add(sentence);
          const at = `${name}: ${sentence}`;
          // The words the site never uses in a sentence about a file.
          expect(at).not.toMatch(/\b(?:best|highest|lowest|worst)\b/i);
          expect(sentence.toLowerCase()).not.toContain('top ');
          expect(at).not.toMatch(/safe|anonymi[sz]ed|de-?identified/i);
          // Neat contrasts: "not X, but Y" and "X, not Y".
          expect(at).not.toMatch(/\bnot\b[^.;:]*\bbut\b/i);
          expect(at).not.toMatch(/,\s+not\s/i);
          expect(at).not.toMatch(/\bnot (?:just|only)\b/i);
          // A whole sentence, on one line, with nothing left over from the code.
          expect(sentence).toMatch(/^[A-Z].*\.$/);
          expect(sentence).toMatch(/^[\x20-\x7E]+$/);
          expect(sentence).not.toMatch(/ {2}|undefined|NaN|\bnull\b|\[object|\( ?\)|,,|\.\.| \.| ,/);
          // No mark that asks for attention.
          expect(sentence).not.toMatch(/[!*_]/);
        }
        // `say` is one sentence. `fix` is one or two.
        expect(finding.say.replace(/\([^)]*\)/g, '').match(/\.(?: |$)/g)?.length).toBe(1);
        expect(finding.fix.match(/\.(?: |$)/g)?.length).toBeLessThanOrEqual(2);
      }
    }
    // The variants are there so that many different sentences are read.
    expect(seen.size).toBeGreaterThan(60);
  });

  it('every count agrees with its noun', async () => {
    const NOUNS = 'cell|row|column|value|merged range|sheet|heading|field';
    for (const { name, report } of await everyReport()) {
      for (const sentence of sentences(report)) {
        const at = `${name}: ${sentence}`;
        expect(at).not.toMatch(new RegExp(`(?<![\\d,])1 (?:fully empty )?(?:${NOUNS})s\\b`));
        expect(at).not.toMatch(new RegExp(`(?<![\\d,])(?:0|[2-9]|\\d[\\d,]+) (?:fully empty )?(?:${NOUNS})\\b`));
        expect(at).not.toMatch(/\b1 cells?\b[^.(]*\b(?:hold|show|differ|start)\b(?!s)/);
        expect(at).not.toMatch(/(?<![\d,])1 (?:cell|row|value|column) [^.(]*\b(?:those|them)\b/);
      }
    }
  });

  it('one cell, one row and one range are spoken of as one', async () => {
    const all = await variants();
    const of = (name: string): CheckReport => {
      const report = all[name];
      if (!report) throw new Error(`no variant named ${name}`);
      return report;
    };
    expect(only(of('one number as text'), 'number-as-text').say).toBe('Column F (Paid) has 1 cell where a number is stored as text (F6).');
    const date = only(of('one date as text'), 'mixed-dates');
    expect(date.say).toBe('Column C (Fill date) has real dates, and 1 cell where a date is typed as text (C4).');
    expect(date.fix).toBe('Turn that cell into a real date, so it sorts and groups with the others.');
    const space = only(of('one stray space'), 'stray-spaces');
    expect(space.say).toBe('Column B (Patient) has 1 cell with stray spaces: a space before or after the text (B3).');
    expect(space.fix).toBe('Remove the stray spaces, so that values which look the same also match in a lookup, a filter or a pivot table.');
    const spelling = only(of('one spelling apart'), 'near-duplicates');
    expect(spelling.say).toBe('Column D (Payer) has 1 value that is written in more than one way, differing in a final full stop, in spaces or in capital letters; 1 cell differs from the usual spelling (D5).');
    expect(spelling.fix).toBe('Pick one spelling for that value and use it in every cell, or a pivot table lists each spelling as its own row.');
    expect(only(of('one repeated ID'), 'repeated-id').say).toBe('In column A (Claim ID), 1 value appears more than once, in 2 cells, while every other value appears once (A6 and A13).');
    const error = only(of('one error'), 'error-cells');
    expect(error.say).toBe('Column F (Paid) has 1 cell that shows an error code where a value should be (F7).');
    expect(error.fix).toBe('Fix the formula or clear that cell. One error cell turns a sum of the whole column into an error.');
    const csvFile = of('a CSV file with one uneven row, one error, one amount with a sign');
    expect(only(csvFile, 'uneven-rows').say).toBe('This file has 1 row with more or fewer fields than the row of headings, which has 6 (row 8).');
    expect(only(csvFile, 'uneven-rows').fix).toBe('Look on that row for a stray separator or a line break inside a value. A value that holds the separator must sit inside quotation marks.');
    expect(only(csvFile, 'error-cells').fix).toBe('Fix that cell in the program the file came from, or clear it, so a script does not read the code as a value.');
    expect(only(csvFile, 'number-as-text').say).toBe('Column F (Paid) has 1 cell where a number is written with extra marks, such as a currency sign or a thousands separator (F13).');
    expect(only(csvFile, 'number-as-text').fix).toBe('Write that number the way the others in the column are written, with digits and a decimal point only.');
  });

  it('more than one is spoken of as many', async () => {
    const all = await variants();
    const of = (name: string): CheckReport => {
      const report = all[name];
      if (!report) throw new Error(`no variant named ${name}`);
      return report;
    };
    const merged = only(of('two merged ranges in the data, one above'), 'merged-cells');
    expect(merged).toMatchObject({ weight: 'fix', count: 3 });
    expect(merged.say).toBe('This sheet has 3 merged ranges: 1 above the headings and 2 in the rows of data (A1:F1, D7:D8 and D12:D13).');
    expect(merged.fix).toBe('Unmerge them and give each cell its own value. A merged range keeps its value in one cell and leaves the others empty.');
    const rows = of('two empty rows, two rows of sums, the headings twice more');
    expect(only(rows, 'blank-rows').say).toBe('This sheet has 2 fully empty rows inside the data (row 9 and row 25).');
    expect(only(rows, 'blank-rows').fix).toBe('Delete the empty rows. A spreadsheet program takes the first empty row as the end of the data.');
    expect(only(rows, 'total-row').say).toBe('This sheet has 2 rows that add up other rows (row 10 and row 37).');
    expect(only(rows, 'total-row').fix).toBe('Delete or move those rows before you build a pivot table or run a script, so each amount is counted once.');
    expect(only(rows, 'repeated-heading').say).toBe('This sheet repeats its row of headings inside the data in 2 rows (row 17 and row 26).');
    expect(only(rows, 'repeated-heading').fix).toBe('Delete those rows. A script reads them as rows of data.');
    const headings = of('two headings on two columns each, two columns with no heading');
    expect(only(headings, 'repeated-heading').say).toBe('This sheet uses 2 headings on more than one column each: "Payer" and "Paid" (D1, H1, F1 and G1).');
    const empty = only(headings, 'empty-heading');
    expect(empty.say).toBe('This sheet has 2 columns that hold data under an empty heading (I1 and J1).');
    expect(empty.fix).toBe('Type a heading above each of them. A pivot table refuses a range that has an empty heading.');
    expect(empty.column).toBeUndefined();
    const kinds = of('a number among text, text among yes/no values').findings.filter((finding) => finding.rule === 'mixed-kinds');
    expect(kinds.map((finding) => [finding.weight, finding.say, finding.fix])).toEqual([
      ['look', 'Column D (Payer) is mostly text, and 1 cell holds a number (D9).', 'Store that cell as text as well, so every cell in the column is the same kind.'],
      ['look', 'Column G (Refill) is mostly yes/no values, and 1 cell holds text (G15).', 'Make that cell a yes/no value as well, so every cell in the column is the same kind.'],
    ]);
    const forms = only(of('dates as text in two forms'), 'mixed-dates');
    expect(forms.say).toBe('Column C (Fill date) holds dates typed as text with slashes and with the year first; 1 cell differs from the form the column uses the most (C8).');
    expect(only(of('a CSV file with every amount written with a sign'), 'number-as-text').say).toBe('Column F (Paid) writes its numbers with extra marks, such as a currency sign or a thousands separator, in 30 cells (F2, F3, F4, F5, F6 and 25 more).');
    expect(only(of('one column and no row of headings'), 'empty-heading').say).toBe('This check found no row of headings on this sheet, which has 1 column of data.');
    const bare = of('a CSV file with no row of headings and an uneven row');
    expect(only(bare, 'uneven-rows').say).toBe('This file has 1 row with more or fewer fields than the other rows, which have 3 (row 6).');
    expect(only(bare, 'empty-heading').say).toBe('This check found no row of headings on this file, which has 3 columns of data.');
  });

  it('a long heading is cut short in a sentence, and kept whole in the finding', async () => {
    const long = 'Amount paid by the plan after adjustments and before the patient share';
    const rows = claims();
    set(rows, 0, 5, long);
    set(rows, 4, 5, 'n/a');
    const finding = only(await book(rows), 'mixed-kinds');
    expect(finding.heading).toBe(long);
    expect(finding.say).toBe('Column F (Amount paid by the plan after…) is mostly numbers, and 1 cell holds text (F5).');
  });
});

describe('File Check wording: the text for pasting', () => {
  it('a workbook with two sheets: a line for each sheet, then the findings in their three groups, each with its sheet', async () => {
    const first = claims();
    set(first, 3, 5, 'n/a');
    set(first, 4, 1, ` ${text(get(first, 4, 1))}`);
    const second = claims(12);
    second.forEach((row, at) => row.push(at === 0 ? 'ZIP' : `0286${at % 4}`));
    const report = await checkFile(
      await workbook([
        { name: 'January', rows: first },
        { name: 'February', rows: second, hidden: true },
        { name: 'Notes', rows: [] },
      ]),
      'workbook',
    );
    expect(asText(report)).toBe(
      [
        'File check of a workbook with 3 sheets: 1 to fix, 1 worth a look and 1 good to know.',
        'Sheet "January": 30 rows of data, 6 columns, headings in row 1.',
        'Sheet "February" (hidden): 12 rows of data, 7 columns, headings in row 1.',
        'Sheet "Notes": empty.',
        '',
        'To fix:',
        '1. January: Column F (Paid) is mostly numbers, and 1 cell holds text (F4).',
        '   What to do: Clear that cell or replace it with a number, so the whole column can be added up.',
        '',
        'Worth a look:',
        '1. January: Column B (Patient) has 1 cell with stray spaces: a space before or after the text (B5).',
        '   What to do: Remove the stray spaces, so that values which look the same also match in a lookup, a filter or a pivot table.',
        '',
        'Good to know:',
        '1. February: Column G (ZIP) holds codes made of digits, and 12 of them start with a zero (G2, G3, G4, G5, G6 and 7 more).',
        '   What to do: Keep this column as text. If it is turned into numbers, the zeros in front are lost.',
      ].join('\n'),
    );
  });

  it('a CSV file: one line for the file, and no sheet named', async () => {
    const lines = claimsCsv();
    lines[7]?.push('extra');
    lines.splice(10, 0, ['']);
    expect(asText(await file(lines))).toBe(
      [
        'File check of a CSV file: 2 to fix.',
        'The file: 30 rows of data, 6 columns, headings in row 1.',
        '',
        'To fix:',
        '1. This file has 1 fully empty row inside the data (row 11).',
        '   What to do: Delete the empty row. A spreadsheet program takes the first empty row as the end of the data.',
        '2. This file has 1 row with more or fewer fields than the row of headings, which has 6 (row 8).',
        '   What to do: Look on that row for a stray separator or a line break inside a value. A value that holds the separator must sit inside quotation marks.',
      ].join('\n'),
    );
  });

  it('a file with nothing to report says so', async () => {
    expect(asText(await book(claims()))).toBe(['File check of a workbook with 1 sheet.', 'Sheet "Claims": 30 rows of data, 6 columns, headings in row 1.', '', 'This check found nothing that would trip up a script or a pivot table.'].join('\n'));
    expect(asText(await file(claimsCsv()))).toBe(['File check of a CSV file.', 'The file: 30 rows of data, 6 columns, headings in row 1.', '', 'This check found nothing that would trip up a script or a pivot table.'].join('\n'));
  });

  it('a sheet with no row of headings is described as such', async () => {
    const pasted = asText(await book(Array.from({ length: 12 }, (_, at): Cell[] => [1000 + at, 20.5 + at, 3 + at])));
    expect(pasted.split('\n')[1]).toBe('Sheet "Claims": 12 rows of data, 3 columns, no row of headings found.');
  });
});
