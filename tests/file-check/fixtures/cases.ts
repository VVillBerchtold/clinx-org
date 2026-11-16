// One made-up file for each rule of File Check: a clean table of claims with one thing wrong in it.
// The tests run every one of them, both to see that the rule speaks and to see how it words what it says.

import type { RuleId } from '../../../src/scripts/file-check/engine/index.js';
import { type Cell, type SheetSpec, HEADINGS, claims, claimsCsv, csv, valuesOf, workbook } from './workbooks';

export interface Case {
  name: string;
  kind: 'workbook' | 'csv';
  bytes: () => Promise<Uint8Array>;
  /** Every value the file holds under its headings. None of them may reach a sentence. */
  values: string[];
  /** The rules that must speak, and no others. */
  rules: RuleId[];
}

/** The cell at a row and a column, counted from 0. */
export function get(rows: Cell[][], row: number, column: number): Cell {
  const cell = rows[row]?.[column];
  if (cell === undefined) throw new Error(`the fixture has no cell at row ${row}, column ${column}`);
  return cell;
}
export function set(rows: Cell[][], row: number, column: number, value: Cell): void {
  const cells = rows[row];
  if (!cells) throw new Error(`the fixture has no row ${row}`);
  cells[column] = value;
}
const text = (cell: Cell): string => (typeof cell === 'string' ? cell : typeof cell === 'number' ? String(cell) : '');

interface Options {
  count?: number;
  headingRows?: number;
}

function book(name: string, rules: RuleId[], change: (rows: Cell[][]) => Partial<SheetSpec> | void, { count = 30, headingRows = 1 }: Options = {}): Case {
  const rows = claims(count);
  const extra = change(rows) ?? {};
  const sheet: SheetSpec = { name: 'Claims', rows, ...extra };
  return { name, kind: 'workbook', bytes: () => workbook([sheet]), values: valuesOf(rows, headingRows).filter((value) => !HEADINGS.includes(value)), rules };
}

function file(name: string, rules: RuleId[], change: (lines: string[][]) => void, separator = ','): Case {
  const lines = claimsCsv();
  change(lines);
  return { name, kind: 'csv', bytes: async () => csv(lines, separator), values: lines.slice(1).flat().filter((value) => value !== ''), rules };
}

const CODES = ['00093714601', '00173068220', '00169413212', '00006027731', '00456120030'];

export const CASES: Case[] = [
  book('a clean workbook', [], () => {}),
  file('a clean CSV file', [], () => {}),

  book('number-as-text: three amounts stored as text', ['number-as-text'], (rows) => {
    for (const row of [5, 12, 23]) set(rows, row, 5, text(get(rows, row, 5)));
  }),
  book('number-as-text: a whole column of amounts stored as text', ['number-as-text'], (rows) => {
    for (let row = 1; row < rows.length; row++) set(rows, row, 5, Number(get(rows, row, 5)).toFixed(2));
  }),
  book('number-as-text: a whole column of counts stored as text, formatted as numbers', ['number-as-text'], (rows) => {
    for (let row = 1; row < rows.length; row++) set(rows, row, 4, { text: text(get(rows, row, 4)), format: 'amount' });
  }),
  book('leading-zeros: a column of drug codes', ['leading-zeros'], (rows) => {
    rows.forEach((row, at) => row.push(at === 0 ? 'NDC' : (CODES[at % 5] ?? '')));
  }),
  book('mixed-kinds: words among amounts, and a number among dates', ['mixed-kinds'], (rows) => {
    set(rows, 4, 5, 'n/a');
    set(rows, 9, 5, 'TBD');
    set(rows, 12, 2, 46117);
  }),
  book('mixed-dates: dates typed as text among real dates', ['mixed-dates'], (rows) => {
    set(rows, 3, 2, '3/4/2026');
    set(rows, 8, 2, '2026-03-04');
    set(rows, 20, 2, '4 Mar 2026');
  }),
  book('stray-spaces: before, doubled, non-breaking and nothing else', ['stray-spaces'], (rows) => {
    set(rows, 2, 1, ` ${text(get(rows, 2, 1))}`);
    set(rows, 6, 1, text(get(rows, 6, 1)).replace(' ', '  '));
    set(rows, 11, 1, text(get(rows, 11, 1)).replace(' ', ' '));
    set(rows, 15, 1, '   ');
  }),
  book('near-duplicates: a payer written three ways', ['near-duplicates'], (rows) => {
    set(rows, 4, 3, 'medicaid');
    set(rows, 7, 3, 'MEDICAID');
    set(rows, 10, 3, 'Medicare.');
  }),
  book('merged-cells: two cells merged inside the data', ['merged-cells'], (rows) => {
    set(rows, 5, 3, null);
    return { merges: ['D5:D6'] };
  }),
  book('blank-rows: an empty row inside the data', ['blank-rows'], (rows) => {
    rows.splice(10, 0, []);
  }),
  book('total-row: a row of sums under the data', ['total-row'], (rows) => {
    rows.push(['Total', null, null, null, { formula: 'SUM(E2:E31)', result: 1800 }, { formula: 'SUM(F2:F31)', result: 51079.65 }]);
  }),
  book('total-row: a typed row that starts with the word, in the middle of the data', ['total-row'], (rows) => {
    rows.splice(16, 0, ['Grand total:', null, null, null, 870, 24266.4]);
  }),
  book('total-row: sums with no word beside them', ['total-row'], (rows) => {
    rows.push([null, null, null, null, { formula: 'SUBTOTAL(109,E2:E31)', result: 1800 }, null]);
  }),
  book('repeated-heading: two columns with the same heading', ['repeated-heading'], (rows) => {
    rows.forEach((row, at) => row.push(at === 0 ? 'Paid' : 12.25 + at));
  }),
  book('repeated-heading: the row of headings written again inside the data', ['repeated-heading'], (rows) => {
    rows.splice(15, 0, HEADINGS.slice());
  }),
  book('empty-heading: a column of data with no heading', ['empty-heading'], (rows) => {
    set(rows, 0, 4, null);
  }),
  book(
    'two-heading-rows: a row of units under the headings',
    ['two-heading-rows'],
    (rows) => {
      rows.splice(1, 0, ['(code)', '(full name)', '(day)', '(plan)', '(units)', '(dollars)']);
    },
    { headingRows: 2 },
  ),
  book(
    'two-heading-rows: merged group headings above the headings',
    ['merged-cells', 'two-heading-rows'],
    (rows) => {
      rows.unshift(['Who', null, 'What was filled', null, null, null]);
      return { merges: ['A1:B1', 'C1:F1'] };
    },
    { headingRows: 2 },
  ),
  book(
    'repeated-id: two claim IDs that appear twice',
    ['repeated-id'],
    (rows) => {
      set(rows, 12, 0, get(rows, 5, 0));
      set(rows, 30, 0, get(rows, 22, 0));
    },
    { count: 40 },
  ),
  book('error-cells: two cells that show an error', ['error-cells'], (rows) => {
    set(rows, 6, 5, { error: '#DIV/0!' });
    set(rows, 19, 5, { error: '#N/A' });
  }),

  file('uneven-rows: one row too long and one too short', ['uneven-rows'], (lines) => {
    lines[7]?.push('extra');
    lines[12]?.pop();
  }),
  file(
    'decimal-comma: amounts written 1.234,56',
    ['decimal-comma'],
    (lines) => {
      for (const line of lines.slice(1)) line[5] = Number(line[5]).toLocaleString('de-DE', { minimumFractionDigits: 2 });
    },
    ';',
  ),
  file('number-as-text in a CSV file: amounts with a currency sign', ['number-as-text'], (lines) => {
    for (const at of [5, 12, 23]) {
      const line = lines[at];
      if (line) line[5] = `$${Number(line[5]).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    }
  }),
  file('leading-zeros in a CSV file: ZIP codes', ['leading-zeros'], (lines) => {
    lines.forEach((line, at) => line.push(at === 0 ? 'ZIP' : (['02860', '02861', '02903', '02907'][at % 4] ?? '')));
  }),
  file('mixed-dates in a CSV file: two ways of writing a date', ['mixed-dates'], (lines) => {
    for (const at of [3, 8, 20]) {
      const line = lines[at];
      const [year, month, day] = (line?.[2] ?? '').split('-');
      if (line) line[2] = `${Number(month)}/${Number(day)}/${year}`;
    }
  }),
  file('blank-rows and total-row in a CSV file', ['blank-rows', 'total-row'], (lines) => {
    lines.splice(10, 0, ['']);
    lines.push(['Total', '', '', '', '1800', '51079.65']);
  }),
  file('error-cells and mixed-kinds in a CSV file', ['mixed-kinds', 'error-cells'], (lines) => {
    const first = lines[6];
    const second = lines[9];
    if (first) first[5] = '#VALUE!';
    if (second) second[5] = 'pending';
  }),
];
