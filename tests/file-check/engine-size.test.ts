// A large file: 50,000 rows by 12 columns. The check runs in the person's browser, so it has to finish in a few seconds.

import { describe, expect, it } from 'vitest';
import { checkFile } from '../../src/scripts/file-check/engine/index.js';
import { type Cell, csv, workbook } from './fixtures/workbooks';

const ROWS = 50_000;
const HEADINGS = ['Claim ID', 'Patient', 'Fill date', 'Payer', 'Qty', 'Paid', 'Prescriber', 'Clinic', 'Days supply', 'Billed', 'Copay', 'Status'];
const FIRST = ['Ada', 'Bram', 'Cleo', 'Dmitri', 'Esme', 'Finn', 'Greta', 'Hollis', 'Ines', 'Jarrah'];
const LAST = ['Marlowe', 'Okafor', 'Lindqvist', 'Castellano', 'Whitlock', 'Abernethy', 'Drummond', 'Solberg', 'Ferreira', 'Thistlewood'];

/** One clean row of 12 cells: an ID no other row has, a name, a real date, and amounts and counts stored as numbers. */
function row(at: number): Cell[] {
  const day = new Date(Date.UTC(2024, 0, 1 + (at % 700))).toISOString().slice(0, 10);
  return [
    `C-${100000 + at}`,
    `${FIRST[at % 10]} ${LAST[Math.floor(at / 10) % 10]}`,
    { date: day },
    ['Medicaid', 'Medicare', 'Commercial'][at % 3] ?? '',
    [30, 60, 90][at % 3] ?? 30,
    Number((12.4 + (at % 9000) * 0.37).toFixed(2)),
    `Dr ${LAST[at % 10]} ${at % 200}`,
    ['North', 'South', 'East', 'West', 'Central'][at % 5] ?? '',
    [28, 30, 84, 90][at % 4] ?? 30,
    Number((15.1 + (at % 9000) * 0.41).toFixed(2)),
    [0, 5.5, 10.25, 20.75][at % 4] ?? 0,
    ['Paid', 'Denied', 'Pending', 'Reversed'][at % 4] ?? '',
  ];
}

function rows(): Cell[][] {
  const out: Cell[][] = [HEADINGS.slice()];
  for (let at = 0; at < ROWS; at++) out.push(row(at));
  return out;
}

describe('File Check engine: a large file', () => {
  it('a workbook of 50,000 rows by 12 columns is checked in a few seconds, and one wrong cell in it is found', async () => {
    const cells = rows();
    // One amount stored as text, far down the sheet, and one claim entered twice.
    const amount = cells[40_000];
    const again = cells[45_001];
    if (amount) amount[5] = '412.50';
    if (again) again[0] = 'C-100123';
    const bytes = await workbook([{ name: 'Claims', rows: cells }]);
    const started = performance.now();
    const report = await checkFile(bytes, 'workbook');
    const took = performance.now() - started;
    console.log(`File Check, workbook of ${ROWS.toLocaleString('en-US')} rows by 12 columns (${(bytes.length / 1e6).toFixed(1)} MB): ${Math.round(took)} ms`);
    expect(report.sheets).toEqual([{ name: 'Claims', rows: ROWS, columns: 12, headingRow: 1, headingsSure: true, hidden: false }]);
    expect(report.findings.map((finding) => [finding.rule, finding.column, finding.count, finding.where])).toEqual([
      ['number-as-text', 'F', 1, ['F40001']],
      ['repeated-id', 'A', 2, ['A125', 'A45002']],
    ]);
    expect(report.findings[1]?.say).toBe('In column A (Claim ID), 1 value appears more than once, in 2 cells, while every other value appears once (A125 and A45002).');
    expect(took).toBeLessThan(5000);
  }, 60_000);

  it('a CSV file of the same size is checked in a few seconds', async () => {
    const lines = rows().map((cells) => cells.map((cell) => (cell === null ? '' : typeof cell === 'object' ? ('date' in cell ? cell.date : '') : String(cell))));
    const line = lines[30_000];
    if (line) line[9] = 'pending';
    lines[48_000]?.push('extra');
    const bytes = csv(lines);
    const started = performance.now();
    const report = await checkFile(bytes, 'csv');
    const took = performance.now() - started;
    console.log(`File Check, CSV file of ${ROWS.toLocaleString('en-US')} rows by 12 columns (${(bytes.length / 1e6).toFixed(1)} MB): ${Math.round(took)} ms`);
    expect(report.sheets).toEqual([{ name: 'CSV file', rows: ROWS, columns: 12, headingRow: 1, headingsSure: true, hidden: false }]);
    expect(report.findings.map((finding) => [finding.rule, finding.column ?? '', finding.count, finding.where])).toEqual([
      ['uneven-rows', '', 1, ['row 48,001']],
      ['mixed-kinds', 'J', 1, ['J30001']],
    ]);
    expect(took).toBeLessThan(5000);
  }, 60_000);
});
