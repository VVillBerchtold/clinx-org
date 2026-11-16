// A sheet with no row of headings: its first row is a row of data, and nothing from that row may
// reach a sentence a person could copy out of the page.

import { describe, expect, it } from 'vitest';
import { type CheckReport, asText, checkFile } from '../../src/scripts/file-check/engine/index.js';
import { type Cell, claims, csv, workbook } from './fixtures/workbooks';

const book = async (rows: Cell[][]): Promise<CheckReport> => checkFile(await workbook([{ name: 'List', rows }]), 'workbook');
const copied = (report: CheckReport): string => [...report.findings.flatMap((finding) => [finding.say, finding.fix, ...finding.where]), asText(report)].join('\n');

const FIRST = ['Zqxada', 'Zqxbram', 'Zqxcleo', 'Zqxfinn', 'Zqxgreta', 'Zqxines'];
const TOWNS = ['Zqxford', 'Zqxham', 'Zqxton'];

/** Thirty rows of names and towns, all words, with no headings. Two towns are written in two ways and one name has a space in front. */
function namesOnly(): Cell[][] {
  const rows: Cell[][] = [];
  for (let at = 0; at < 30; at++) rows.push([`${FIRST[at % 6]} Zqx${at}`, TOWNS[at % 3] ?? '', TOWNS[at % 3] ?? '']);
  const fourth = rows[4];
  const ninth = rows[9];
  if (fourth) fourth[1] = 'zqxham';
  if (ninth) ninth[0] = ' Zqxfinn Zqx9';
  return rows;
}

describe('File Check engine: a row of headings that is only a guess', () => {
  it('a sheet of words only has its columns named by letter, and no text of its first row is in any sentence', async () => {
    const report = await book(namesOnly());
    expect(report.sheets[0]).toMatchObject({ headingRow: 1, headingsSure: false });
    expect(report.findings.length).toBeGreaterThan(0);
    expect(copied(report)).not.toMatch(/zqx/i);
    // The first row has the same town in two columns: the sentence says so without quoting it.
    const repeated = report.findings.find((finding) => finding.rule === 'repeated-heading');
    expect(repeated?.say).toBe('This sheet uses the same heading on 2 columns (B1 and C1).');
    // The person's own screen may still show what the cells hold.
    expect(report.findings.some((finding) => finding.examples.some((example) => /zqx/i.test(example.value)))).toBe(true);
  });

  it('the same is true of a CSV file of words only', async () => {
    const lines = namesOnly().map((row) => row.map((cell) => (typeof cell === 'string' ? cell : '')));
    const report = await checkFile(csv(lines), 'csv');
    expect(report.sheets[0]).toMatchObject({ headingsSure: false });
    expect(copied(report)).not.toMatch(/zqx/i);
  });

  it('a first row of words that stand for a missing value, on top of numbers, is not taken as headings for certain', async () => {
    const rows: Cell[][] = [['N/A', 'unknown', '-']];
    for (let at = 0; at < 10; at++) rows.push([at + 1, 20 + at, 300 + at]);
    expect((await book(rows)).sheets[0]).toMatchObject({ headingsSure: false });
  });

  it('headings on top of numbers or dates are named in the sentences', async () => {
    const rows = claims();
    const tenth = rows[10];
    if (tenth) tenth[5] = '412.50';
    const report = await book(rows);
    expect(report.sheets[0]).toMatchObject({ headingRow: 1, headingsSure: true });
    expect(report.findings.find((finding) => finding.rule === 'number-as-text')?.say).toContain('(Paid)');
  });

  it('a sheet with fewer than three rows of data keeps its headings out of the sentences', async () => {
    const rows = claims(2);
    expect((await book(rows)).sheets[0]).toMatchObject({ headingRow: 1, headingsSure: false });
  });
});

describe('File Check engine: rows of totals with a longer label', () => {
  it.each(['Total for March', 'North Total', 'Subtotal of Q1', 'Clinic subtotal:'])('finds a row that starts with "%s"', async (label) => {
    const rows = claims();
    rows.push([label, null, null, null, 90, 1234.5]);
    const report = await book(rows);
    const found = report.findings.find((finding) => finding.rule === 'total-row');
    expect(found?.where).toEqual(['row 32']);
    expect(found?.say).not.toContain(label);
  });

  it('leaves a row of data alone when its first cell only holds the word inside a longer name', async () => {
    const rows = claims();
    rows.push(['Totalcare 17', 'Zqx Name', { date: '2031-02-03' }, 'Medicaid', 30, 12.5]);
    const report = await book(rows);
    expect(report.findings.find((finding) => finding.rule === 'total-row')).toBeUndefined();
  });
});
