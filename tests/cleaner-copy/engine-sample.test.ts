import { describe, expect, it } from 'vitest';
import { SAMPLE_NAME, inspect, kindOf, makeCopy, sampleBytes } from '../../src/scripts/cleaner-copy/engine/index.js';
import { allText, cellsOf, columnOf, formulaOf, partsOf, sameShape, shown } from './fixtures/workbooks';

// The made-up clinic report the page offers for a first try, taken through the engine from end to end.
const bytes = sampleBytes();
const before = await partsOf(bytes);
const report = await inspect(bytes, 'workbook');
const copy = await makeCopy(bytes, 'workbook', { keep: { Claims: ['E'] } });
const after = await partsOf(copy.bytes);

describe('Cleaner Copy engine: the sample report', () => {
  it('is named and recognised as a workbook', () => {
    expect(SAMPLE_NAME).toBe('sample-clinic-report.xlsx');
    expect(kindOf(SAMPLE_NAME, bytes)).toEqual({ kind: 'workbook' });
  });

  it('is reported sheet by sheet, with the row of headings found on each', () => {
    expect(report.sheets.map((sheet) => sheet.name)).toEqual(['Claims', 'Patients', 'Notes', 'Summary', 'Panel']);
    expect(report.sheets.map((sheet) => sheet.headingRow)).toEqual([3, 1, 1, 3, 2]);
    expect(report.sheets.map((sheet) => sheet.state)).toEqual(['visible', 'visible', 'hidden', 'visible', 'visible']);
    expect(report.sheets[4]?.headingsFrom).toBe('table');
    expect(report.sheets[0]?.columns.map((column) => column.heading).slice(0, 5)).toEqual(['Patient ID', 'Patient name', 'Date of birth', 'Fill date', 'Payer']);
    expect(report.sheets[0]?.columns.every((column) => !column.kept && column.headingAlsoValue === 0)).toBe(true);
    expect(report.extras).toEqual({ parts: 0, queries: false });
    expect(report.outsideTheCells.length).toBeGreaterThan(5);
    expect(report.forALook.map((item) => item.text)).toContain('Ask Dana Whitlock');
    expect(report.worthKnowing.some((item) => item.what === 'A hidden sheet' && item.where === 'Notes')).toBe(true);
  });

  it('looking gives back the report and nothing else', () => {
    expect(Object.keys(report).sort()).toEqual(['extras', 'forALook', 'outsideTheCells', 'parts', 'replaced', 'sheets', 'strings', 'worthKnowing']);
  });

  it('the copy gives back the copy, the report, the check and the description, and an empty legend when no column is coded', () => {
    expect(Object.keys(copy).sort()).toEqual(['bytes', 'check', 'described', 'legend', 'report']);
    expect(copy.legend).toEqual([]);
    expect(copy.report.replaced.coded).toBe(0);
    expect(kindOf('copy.xlsx', copy.bytes)).toEqual({ kind: 'workbook' });
  });

  it('leaves the kept column unchanged on every row', () => {
    const was = columnOf(cellsOf(before, 'Claims'), 'E', 4);
    const now = columnOf(cellsOf(after, 'Claims'), 'E', 4);
    expect(was.length).toBeGreaterThan(100);
    expect(now).toEqual(was);
    expect(copy.report.sheets[0]?.columns.find((column) => column.column === 'E')?.kept).toBe(true);
    expect(copy.report.replaced.kept).toBe(was.length);
  });

  it('keeps every heading', () => {
    for (const [name, row] of [['Claims', 3], ['Patients', 1], ['Notes', 1], ['Summary', 3], ['Panel', 2]] as const) {
      const was = cellsOf(before, name);
      const now = cellsOf(after, name);
      for (const column of 'ABCDEFGHIJKLMNO') expect(shown(now, `${column}${row}`), `${name}!${column}${row}`).toBe(shown(was, `${column}${row}`));
    }
  });

  it('gives every text cell of the other columns a stand-in of the same shape', () => {
    const was = cellsOf(before, 'Claims');
    const now = cellsOf(after, 'Claims');
    for (const column of ['B', 'F', 'J', 'L']) {
      const rows = columnOf(was, column, 4).filter(([, value]) => value !== '');
      expect(rows.length).toBeGreaterThan(100);
      for (const [row, value] of rows) {
        const made = shown(now, `${column}${row}`);
        expect(made, `${column}${row}`).not.toBe(value);
        expect(sameShape(value, made), `${column}${row} keeps its shape`).toBe(true);
      }
    }
  });

  it('changes the numbers and the dates too', () => {
    const was = cellsOf(before, 'Claims');
    const now = cellsOf(after, 'Claims');
    for (const column of ['A', 'C', 'I']) {
      const rows = columnOf(was, column, 4);
      const same = rows.filter(([row, value]) => shown(now, `${column}${row}`) === value).length;
      expect(same, `column ${column}`).toBeLessThan(rows.length / 20);
    }
  });

  it('keeps the lookups between sheets working: the same original gets the same stand-in on every sheet', () => {
    const people = (parts: Map<string, string>): Map<string, string> => {
      const cells = cellsOf(parts, 'Patients');
      return new Map(columnOf(cells, 'A', 2).map(([row, id]) => [id, shown(cells, `B${row}`)]));
    };
    const wasPeople = people(before);
    const nowPeople = people(after);
    const was = cellsOf(before, 'Claims');
    const now = cellsOf(after, 'Claims');
    const matching = columnOf(was, 'A', 4).filter(([row, id]) => wasPeople.get(id) === shown(was, `B${row}`));
    expect(matching.length).toBeGreaterThan(100);
    for (const [row] of matching) {
      const id = shown(now, `A${row}`);
      expect(nowPeople.has(id), `A${row} is still a patient on the other sheet`).toBe(true);
      expect(nowPeople.get(id), `B${row} still matches the other sheet`).toBe(shown(now, `B${row}`));
    }
    expect(formulaOf(now, 'M4')).toBe(formulaOf(was, 'M4'));
    expect(formulaOf(now, 'M4')).toContain('VLOOKUP(A4,Patients!A:B');
  });

  it('keeps a formula that compares against a kept column as it was', () => {
    const was = cellsOf(before, 'Claims');
    const now = cellsOf(after, 'Claims');
    expect(formulaOf(was, 'N5')).toContain('"Medicaid"');
    expect(formulaOf(now, 'N5')).toBe(formulaOf(was, 'N5'));
  });

  it('finds no text it cannot account for when it searches the copy', () => {
    expect(copy.check.ran).toBe(true);
    expect(copy.check.searched).toBeGreaterThan(100);
    expect(copy.check.items.filter((item) => item.kind === 'unexplained')).toEqual([]);
    for (const item of copy.check.items) {
      expect(item.where).not.toBe('');
      expect(item.shape).not.toContain(item.value);
    }
  });

  it('holds none of the names of the sheet of patients, apart from what the check itself lists', () => {
    const names = columnOf(cellsOf(before, 'Patients'), 'B', 2).map(([, value]) => value);
    expect(names.length).toBeGreaterThan(20);
    const said = allText(after);
    const still = [...new Set(names.filter((name) => said.includes(name)))];
    const listed = new Set(copy.check.items.map((item) => item.value));
    expect(still.filter((name) => !listed.has(name))).toEqual([]);
    expect(still.length).toBeLessThan(3);
  });

  it('describes the copy, not the file that was given', () => {
    expect(copy.described.map((sheet) => sheet.name)).toEqual(['Claims', 'Patients', 'Notes', 'Summary', 'Panel']);
    const claims = copy.described[0];
    expect(claims?.headingRow).toBe(3);
    expect(claims?.columns.map((column) => column.kept)).toEqual(report.sheets[0]?.columns.map((column) => column.column === 'E'));
    expect(claims?.columns.find((column) => column.column === 'M')?.formula).toBe('=VLOOKUP(A4,Patients!A:B,2,FALSE)');
    expect(claims?.columns.find((column) => column.column === 'B')?.formula).toBeNull();
    expect(claims?.rows.length).toBe(3);
    const now = cellsOf(after, 'Claims');
    const first = claims?.rows[0] ?? [];
    expect(first[1]).toBe(shown(now, 'B4'));
    expect(first[4]).toBe(shown(cellsOf(before, 'Claims'), 'E4'));
    expect(first[2]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first[12]).toBe('=VLOOKUP(A4,Patients!A:B,2,FALSE)');
    // A ZIP code keeps the zero it starts with.
    const zips = columnOf(cellsOf(after, 'Patients'), 'G', 2).map(([, value]) => value);
    expect(zips.every((zip) => /^0\d{4}$/.test(zip))).toBe(true);
  });

  it('with no column kept, a formula that names a value follows the cells', async () => {
    const plain = await makeCopy(bytes, 'workbook', {});
    const now = cellsOf(await partsOf(plain.bytes), 'Claims');
    const was = cellsOf(before, 'Claims');
    expect(shown(was, 'E5')).toBe('Medicaid');
    expect(shown(now, 'E5')).not.toBe('Medicaid');
    expect(formulaOf(now, 'N5')).toContain(`E5="${shown(now, 'E5')}"`);
    expect(plain.check.items.filter((item) => item.kind === 'unexplained')).toEqual([]);
  });
});
