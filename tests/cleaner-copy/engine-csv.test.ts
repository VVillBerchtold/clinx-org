import { describe, expect, it } from 'vitest';
import { inspect, kindOf, makeCopy, sampleBytes } from '../../src/scripts/cleaner-copy/engine/index.js';
import { writeZip } from '../../src/scripts/cleaner-copy/engine/zip.js';
import { sameShape } from './fixtures/workbooks';

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);
const textOf = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

// A made-up file as a European spreadsheet program writes it: semicolons, Windows line endings, quotation marks where needed.
const LINES = [
  'Member ID;Patient name;ZIP;Payer;Paid;Note',
  '004100;"Marlowe; Ada";02860;Medicaid;12,50;"Said ""call back"" on Friday"',
  '004101;"Okafor; Bram";02861;Medicare;15,67;',
  '004102;"Lindqvist; Cleo";02862;Commercial;18,84;Prefers the morning',
  '004103;"Castellano; Esme";02863;Medicaid;22,01;"Two lines\r\nin one cell"',
  '000007;"Whitlock; Finn";02864;Medicare;25,18;',
];
const source = LINES.join('\r\n') + '\r\n';

/** The cells of one written line, read the simple way: these lines hold no separator outside quotation marks but the ones that split them. */
const split = (line: string): string[] => line.match(/("(?:[^"]|"")*"|[^;]*)(?:;|$)/g)?.map((cell) => cell.replace(/;$/, '')).slice(0, 6) ?? [];

describe('Cleaner Copy engine: a CSV file', () => {
  it('is recognised and reported in the same form as a workbook', async () => {
    expect(kindOf('panel.csv', bytesOf(source))).toEqual({ kind: 'csv' });
    const report = await inspect(bytesOf(source), 'csv');
    expect(report.sheets.length).toBe(1);
    const sheet = report.sheets[0];
    expect(sheet?.name).toBe('CSV file');
    expect(sheet?.headingRow).toBe(1);
    expect(sheet?.columns.map((column) => [column.column, column.heading, column.holds, column.kept, column.headingAlsoValue])).toEqual([
      ['A', 'Member ID', 'text', false, 0],
      ['B', 'Patient name', 'text', false, 0],
      ['C', 'ZIP', 'text', false, 0],
      ['D', 'Payer', 'text', false, 0],
      // An amount written with a decimal comma is read as text, and keeps its shape: digits for digits around the comma.
      ['E', 'Paid', 'text', false, 0],
      ['F', 'Note', 'text', false, 0],
    ]);
    expect(report.extras).toEqual({ parts: 0, queries: false });
    expect(report.outsideTheCells).toEqual([]);
    expect(report.forALook).toEqual([]);
    expect(report.csv).toEqual({ separator: 'semicolon', written: 'UTF-8', rows: 6 });
  });

  it('comes back with the same separator, quotation marks and line endings', async () => {
    const copy = await makeCopy(bytesOf(source), 'csv', { keep: { 'CSV file': ['D'] } });
    const written = textOf(copy.bytes);
    expect(written.endsWith('\r\n')).toBe(true);
    // The one line break that is not a Windows one would be a sign of a changed ending.
    expect(written.replace(/\r\n/g, '').includes('\n')).toBe(false);
    expect(written.split('\r\n').length).toBe(source.split('\r\n').length);
    expect(written.split(';').length).toBe(source.split(';').length);
    expect(written.split('"').length).toBe(source.split('"').length);
    expect(written.split('\r\n')[0]).toBe(LINES[0]);
    // The cell with a line break inside it is still one cell, in quotation marks.
    expect(/;"[A-Za-z]{3} [a-z]{5}\r\n[a-z]{2} [a-z]{3} [a-z]{4}"\r\n/.test(written)).toBe(true);
  });

  it('keeps the shape of every value: leading zeros, a separator inside a name, doubled quotation marks', async () => {
    const copy = await makeCopy(bytesOf(source), 'csv', { keep: { 'CSV file': ['D'] } });
    const lines = textOf(copy.bytes).split('\r\n');
    // The fifth line of the file holds a line break inside a cell, so the line after it is the seventh as written.
    for (const [at, writtenAt] of [[1, 1], [2, 2], [3, 3], [5, 6]] as const) {
      const was = split(LINES[at] ?? '');
      const now = split(lines[writtenAt] ?? '');
      expect(now.length).toBe(6);
      // The ID and the ZIP code keep the zeros they start with.
      expect(now[0], `ID on line ${at + 1}`).toMatch(at === 5 ? /^00000[1-9]$/ : /^00\d{4}$/);
      expect(now[0]).not.toBe(was[0]);
      expect(now[2]).toMatch(/^0\d{4}$/);
      expect(now[1]).not.toBe(was[1]);
      expect(sameShape(was[1] ?? '', now[1] ?? ''), `name on line ${at + 1}`).toBe(true);
      // The column the person kept is as it was.
      expect(now[3]).toBe(was[3]);
      expect(now[4]).toMatch(/^\d\d,\d\d$/);
      expect(sameShape(was[5] ?? '', now[5] ?? ''), `note on line ${at + 1}`).toBe(true);
    }
    expect(split(lines[1] ?? '')[5]).toMatch(/^"[A-Za-z]{4} ""[a-z]{4} [a-z]{4}"" [a-z]{2} [A-Za-z]{6}"$/);
  });

  it('is searched afterwards, and described', async () => {
    const copy = await makeCopy(bytesOf(source), 'csv', { keep: { 'CSV file': ['D'] } });
    expect(Object.keys(copy).sort()).toEqual(['bytes', 'check', 'described', 'legend', 'report']);
    expect(copy.legend).toEqual([]);
    expect(copy.check.ran).toBe(true);
    expect(copy.check.searched).toBeGreaterThan(10);
    expect(copy.check.items).toEqual([]);
    expect(copy.report.replaced.kept).toBe(5);
    const described = copy.described[0];
    expect(copy.described.length).toBe(1);
    expect(described?.name).toBe('CSV file');
    expect(described?.headingRow).toBe(1);
    expect(described?.columns.map((column) => [column.column, column.heading, column.kept, column.formula])).toEqual([
      ['A', 'Member ID', false, null],
      ['B', 'Patient name', false, null],
      ['C', 'ZIP', false, null],
      ['D', 'Payer', true, null],
      ['E', 'Paid', false, null],
      ['F', 'Note', false, null],
    ]);
    expect(described?.rows.length).toBe(3);
    expect(described?.rows.map((row) => row[3])).toEqual(['Medicaid', 'Medicare', 'Commercial']);
    const lines = textOf(copy.bytes).split('\r\n');
    expect(described?.rows[1]?.[0]).toBe(split(lines[2] ?? '')[0]);
    expect(described?.rows[0]?.[1]).not.toBe('Marlowe; Ada');
  });

  it('keeps plain line endings and commas, and the absence of a last line ending', async () => {
    const plain = 'Code,Person,Count\nZX41Q,Corwin Ashdale,12\nKP7-22,Odalys Brenner,7';
    const copy = await makeCopy(bytesOf(plain), 'csv', {});
    const written = textOf(copy.bytes);
    expect(written.includes('\r')).toBe(false);
    expect(written.endsWith('\n')).toBe(false);
    const lines = written.split('\n');
    expect(lines.length).toBe(3);
    expect(lines[0]).toBe('Code,Person,Count');
    expect(lines[1]).toMatch(/^[A-Z]{2}\d{2}[A-Z],[A-Z][a-z]{5} [A-Z][a-z]{6},\d+$/);
    expect(lines[2]).toMatch(/^[A-Z]{2}\d-\d{2},[A-Z][a-z]{5} [A-Z][a-z]{6},\d+$/);
    for (const original of ['ZX41Q', 'Corwin Ashdale', 'KP7-22', 'Odalys Brenner']) expect(written).not.toContain(original);
    expect(copy.check.items).toEqual([]);
  });

  it('gives the same original the same stand-in on every row', async () => {
    const repeated = 'Person,Seen by\nCorwin Ashdale,Tavish Mcallen\nOdalys Brenner,Tavish Mcallen\nCorwin Ashdale,Ines Okonjo\n';
    const lines = textOf((await makeCopy(bytesOf(repeated), 'csv', {})).bytes).split('\n');
    const cell = (row: number, column: number): string => lines[row]?.split(',')[column] ?? '';
    expect(cell(1, 0)).toBe(cell(3, 0));
    expect(cell(1, 1)).toBe(cell(2, 1));
    expect(cell(1, 0)).not.toBe(cell(2, 0));
  });

  it('counts a heading that is also a value, keeps the heading and replaces the cell', async () => {
    const withHeading = 'Person,Status,Note\nCorwin Ashdale,Opened,Called\nOdalys Brenner,Status,Person\nTavish Mcallen,Closed,Status\n';
    const report = await inspect(bytesOf(withHeading), 'csv');
    expect(report.sheets[0]?.columns.map((column) => column.headingAlsoValue)).toEqual([0, 1, 2]);
    const lines = textOf((await makeCopy(bytesOf(withHeading), 'csv', {})).bytes).split('\n');
    expect(lines[0]).toBe('Person,Status,Note');
    const made = lines[2]?.split(',')[1] ?? '';
    expect(made).not.toBe('Status');
    expect(sameShape('Status', made)).toBe(true);
    expect(lines[3]?.split(',')[2]).toBe(made);
    expect(lines[2]?.split(',')[2]).not.toBe('Person');
    const kept = textOf((await makeCopy(bytesOf(withHeading), 'csv', { keep: { 'CSV file': ['b'] } })).bytes).split('\n');
    expect(kept.map((line) => line.split(',')[1])).toEqual(['Status', 'Opened', 'Status', 'Closed', undefined]);
    expect(kept[3]?.split(',')[2]).not.toBe('Status');
  });
});

describe('Cleaner Copy engine: stand-ins that can be read aloud', () => {
  it('give a vowel for a vowel, a consonant for a consonant, a digit for a digit, and keep everything else', async () => {
    const values = ['Marisol Reyes', 'Dr. Okonkwo-Bell', "O'Dell, Dov", 'ada.marlowe' + '@' + 'example.org', '401-555-0142', 'MRN 00417-B', '114 Benefit St, Apt 2B', 'Quinn', 'AEIOU bcdfg'];
    const file = `Value\n${values.map((value) => `"${value}"`).join('\n')}\n`;
    for (let run = 0; run < 5; run++) {
      const lines = textOf((await makeCopy(bytesOf(file), 'csv', {})).bytes).split('\n');
      values.forEach((value, at) => {
        const made = (lines[at + 1] ?? '').replace(/^"|"$/g, '');
        expect(made, value).not.toBe(value);
        expect(sameShape(value, made), `${value} became ${made}`).toBe(true);
      });
    }
  });

  it('are made afresh each time, with no pattern to turn one back', async () => {
    const file = 'Person\nCorwin Ashdale\nOdalys Brenner\n';
    const first = textOf((await makeCopy(bytesOf(file), 'csv', {})).bytes);
    const second = textOf((await makeCopy(bytesOf(file), 'csv', {})).bytes);
    expect(first).not.toBe(second);
  });
});

describe('Cleaner Copy engine: kindOf', () => {
  const problemOf = (name: string, bytes: Uint8Array): string => {
    const said = kindOf(name, bytes);
    return 'problem' in said ? said.problem : `kind: ${said.kind}`;
  };

  it('knows a workbook by what is inside it, whatever it is called', () => {
    expect(kindOf('report.xlsx', sampleBytes())).toEqual({ kind: 'workbook' });
    expect(kindOf('report.csv', sampleBytes())).toEqual({ kind: 'workbook' });
  });

  it('knows a CSV file, with or without a mark at its start', () => {
    expect(kindOf('panel.csv', bytesOf('Code,Count\nZX41Q,3\n'))).toEqual({ kind: 'csv' });
    // A zip file starts with the letters PK; so can a heading.
    expect(kindOf('keys.csv', bytesOf('PK,Count\nZX41Q,3\n'))).toEqual({ kind: 'csv' });
    expect(kindOf('panel.txt', new Uint8Array([0xef, 0xbb, 0xbf, ...bytesOf('Code;Count\r\nZX41Q;3\r\n')]))).toEqual({ kind: 'csv' });
  });

  it('asks for an older Excel file to be saved as .xlsx first', () => {
    const old = new Uint8Array(512);
    old.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(problemOf('report.xls', old)).toBe('This is an older Excel file (.xls), or a workbook locked with a password. Open it in your spreadsheet program and save it as .xlsx first.');
  });

  it('says an empty file is empty', () => {
    expect(problemOf('nothing.xlsx', new Uint8Array(0))).toBe('This file is empty.');
  });

  it('turns away a zip that is not a workbook, a picture, and a cut-off file, each in a sentence', async () => {
    const zip = await writeZip([{ name: 'notes.txt', text: 'made up' }]);
    expect(problemOf('notes.zip', zip)).toBe('This is a zip file, not a workbook. Choose an .xlsx or .xlsm workbook, or a .csv file.');
    expect(problemOf('letter.docx', await writeZip([{ name: 'word/document.xml', text: '<w:document/>' }]))).toBe('This is a Word document, not a spreadsheet.');
    expect(problemOf('scan.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]))).toBe('This is not a workbook or a CSV file. Choose an .xlsx or .xlsm workbook, or a .csv file.');
    expect(problemOf('cut.xlsx', sampleBytes().subarray(0, 900))).toMatch(/^This file could not be opened\. .+\.$/);
    expect(problemOf('page.xls', bytesOf('<html><body><table><tr><td>ZX41Q</td></tr></table></body></html>'))).toContain('a web page or XML');
  });
});

describe('Cleaner Copy engine: a file too large to search', () => {
  it('still gives the copy, and says the check did not run', async () => {
    // Long made-up notes, repeated until the file is just over the size at which the check is left out.
    const note = (n: number): string => `Visit ${String(n % 500).padStart(4, '0')} ${'was moved to the afternoon after a call with the front desk '.repeat(3)}end`;
    const rows: string[] = ['Code,Note'];
    for (let n = 0, size = 0; size < 20_100_000; n++) size += rows[rows.push(`ZX${String(n % 900).padStart(3, '0')}Q,${note(n)}`) - 1]?.length ?? 0;
    const big = bytesOf(rows.join('\n') + '\n');
    expect(big.length).toBeGreaterThan(20_000_000);
    const copy = await makeCopy(big, 'csv', {});
    expect(copy.check).toEqual({ ran: false, searched: 0, items: [] });
    expect(copy.bytes.length).toBe(big.length);
    expect(copy.described[0]?.rows.length).toBe(3);
    expect(new TextDecoder().decode(copy.bytes.subarray(0, 400))).not.toContain('front desk');
  }, 60_000);
});
