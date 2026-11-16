import { describe, expect, it } from 'vitest';
import { inspect, kindOf, makeCopy } from '../../src/scripts/cleaner-copy/engine/index.js';
import { EDGE_WORKBOOK } from './fixtures/edge';
import { allText, cellsOf, formulaOf, part, partsOf, shown } from './fixtures/workbooks';

// A small workbook that holds the hard cases in one place. Its codes (ZX41Q, KP7-22, MR88T, VN30B) and
// its people (Corwin Ashdale, Odalys Brenner) are invented.
const bytes = Uint8Array.from(atob(EDGE_WORKBOOK), (c) => c.charCodeAt(0));
const before = await partsOf(bytes);
const report = await inspect(bytes, 'workbook');
const copy = await makeCopy(bytes, 'workbook', {});
const after = await partsOf(copy.bytes);

describe('Cleaner Copy engine: the workbook of hard cases', () => {
  it('is read as a workbook with its two sheets', () => {
    expect(kindOf('edge.xlsx', bytes)).toEqual({ kind: 'workbook' });
    expect(report.sheets.map((sheet) => [sheet.name, sheet.headingRow])).toEqual([['Data', 1], ['Lookup', 4]]);
  });

  it('lists the messages that match no cell for the person to look at', () => {
    expect(report.forALook.map((item) => item.text).sort()).toEqual(['Ask Corwin Ashdale', 'Not VN30B']);
  });

  it('finds no text it cannot account for when it searches the copy', () => {
    expect(copy.check.ran).toBe(true);
    expect(copy.check.items.filter((item) => item.kind === 'unexplained')).toEqual([]);
    expect([...new Set(copy.check.items.map((item) => item.kind))].sort()).toEqual(['listed', 'name']);
  });

  it('gives the same code the same stand-in in a cell, in text typed in several runs, and in a saved result', () => {
    const data = cellsOf(after, 'Data');
    const lookup = cellsOf(after, 'Lookup');
    expect(shown(cellsOf(before, 'Data'), 'A2')).toBe('ZX41Q');
    const made = shown(data, 'A2');
    expect(made).not.toBe('ZX41Q');
    expect(made).toMatch(/^[A-Z]{2}\d{2}[A-Z]$/);
    expect(shown(lookup, 'D5')).toBe(made);
    expect(shown(lookup, 'C10')).toBe(made);
    // A person on both sheets is the same stand-in on both.
    expect(shown(lookup, 'A5')).toBe(shown(data, 'B2'));
    expect(shown(lookup, 'A5')).not.toBe('Odalys Brenner');
  });

  it('keeps formulas, and clears what they last worked out', () => {
    const lookup = cellsOf(after, 'Lookup');
    expect(formulaOf(lookup, 'B5')).toBe('VLOOKUP(A5,Data!A:B,1,0)');
    expect(formulaOf(lookup, 'E6')).toBe('INDEX(Data!A2:A7,2)');
    expect(shown(lookup, 'B5')).toBe('');
    expect(shown(lookup, 'E6')).toBe('');
    // A heading worked out by a formula is not kept as wording.
    expect(formulaOf(lookup, 'D4')).toBe('Data!A2');
    expect(shown(lookup, 'D4')).toBe('');
  });

  it('describes the copy with each formula as it reads on its own row', () => {
    const lookup = copy.described[1];
    expect(lookup?.name).toBe('Lookup');
    expect(lookup?.headingRow).toBe(4);
    expect(lookup?.columns.map((column) => column.formula)).toEqual([null, '=VLOOKUP(A5,Data!A:B,1,0)', null, null, '=INDEX(Data!A2:A7,1)', '=1/0']);
    // Formulas that share one definition are written out for the row they sit on.
    expect(lookup?.rows.map((row) => row[1])).toEqual(['=VLOOKUP(A5,Data!A:B,1,0)', '=VLOOKUP(A6,Data!A:B,1,0)', '=VLOOKUP(A7,Data!A:B,1,0)']);
    const cells = cellsOf(after, 'Lookup');
    expect(lookup?.rows[0]?.[0]).toBe(shown(cells, 'A5'));
    expect(lookup?.rows[0]?.[3]).toBe(shown(cells, 'D5'));
    expect(copy.described[0]?.rows[0]).toEqual([shown(cellsOf(after, 'Data'), 'A2'), shown(cellsOf(after, 'Data'), 'B2'), shown(cellsOf(after, 'Data'), 'C2')]);
  });

  it('takes out the saved "what if" values and the name on a protected range', () => {
    const sheet = part(after, 'xl/worksheets/sheet2.xml');
    expect(part(before, 'xl/worksheets/sheet2.xml')).toContain('<scenario ');
    expect(sheet).not.toContain('<scenario');
    expect(sheet).toContain('<protectedRange sqref="A5:A10" name="Range1"/>');
    expect(allText(after)).not.toContain('Odalys Brenner');
  });

  it('replaces the listed messages too when the person asks', async () => {
    const swapped = await makeCopy(bytes, 'workbook', { swapText: report.forALook.map((item) => item.text) });
    const said = allText(await partsOf(swapped.bytes));
    for (const original of ['Corwin Ashdale', 'VN30B', 'ZX41Q', 'KP7-22', 'Q4-26X', 'TT9-01', 'Tavish Mcallen']) expect(said, original).not.toContain(original);
    expect(swapped.check.items.filter((item) => item.kind !== 'name')).toEqual([]);
    expect(swapped.report.forALook).toEqual([]);
  });
});
