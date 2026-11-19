import { describe, expect, it } from 'vitest';
import { legendWorkbook } from '../../src/scripts/cleaner-copy/engine/code.js';
import { readZip, storeZip, text, writeZip } from '../../src/scripts/cleaner-copy/engine/zip.js';
import type { ZipPart } from '../../src/scripts/cleaner-copy/engine/zip.js';
import { addPerson, newSchedule, removeSetAside, setAsideHours, setDepartmentStandards, setPerson, setTolerance } from '../../src/scripts/schedule-designer/engine/edit';
import { overview } from '../../src/scripts/schedule-designer/engine/overview';
import { roomHours } from '../../src/scripts/schedule-designer/engine/rooms';
import { sampleSchedule } from '../../src/scripts/schedule-designer/engine/sample';
import { VERDICT_NAMES, tallyPerson } from '../../src/scripts/schedule-designer/engine/tally';
import type { Block, Day, Schedule } from '../../src/scripts/schedule-designer/engine/types';
import { validate } from '../../src/scripts/schedule-designer/engine/validate';
import { fromWorkbook, toWorkbook } from '../../src/scripts/schedule-designer/engine/workbook';
import { REMOTE, activity, block, room, small, visit, withBlocks } from './fixtures/small';
import { cellsOf, child, childrenOf, columnLetters, everywhere, parseXml, rangeOf } from './fixtures/xml';
import type { SheetCell, XmlNode } from './fixtures/xml';

/** One more sheet, "Care teams", when a schedule has support staff. */
const teamSheets = (s: Schedule): number => (s.people.some((person) => person.kind === 'support') ? 1 : 0);

const BANNED = /\b(?:highest|lowest|worst|best)\b|\btop\s/i;
const DASHES = /[—–]| - /;

/** A workbook opened for the tests: every part as text, and the sheets by name. */
interface Opened {
  parts: Map<string, string>;
  /** The sheets in tab order. */
  sheets: { name: string; hidden: boolean; path: string; xml: XmlNode; cells: Map<string, SheetCell> }[];
}

async function open(bytes: Uint8Array): Promise<Opened> {
  const parts = new Map<string, string>();
  for (const part of readZip(bytes)) parts.set(part.name, await text(part));
  const book = parseXml(parts.get('xl/workbook.xml') ?? '');
  const rels = parseXml(parts.get('xl/_rels/workbook.xml.rels') ?? '');
  const sheets = childrenOf(child(book, 'sheets'), 'sheet').map((sheet) => {
    const target = childrenOf(rels, 'Relationship').find((rel) => rel.attrs['Id'] === sheet.attrs['r:id'])?.attrs['Target'] ?? '';
    const path = `xl/${target}`;
    const xml = parseXml(parts.get(path) ?? '');
    return { name: sheet.attrs['name'] ?? '', hidden: sheet.attrs['state'] === 'hidden', path, xml, cells: cellsOf(xml) };
  });
  return { parts, sheets };
}

const sheetNamed = (book: Opened, name: string) => {
  const sheet = book.sheets.find((s) => s.name === name);
  if (!sheet) throw new Error(`no sheet named ${name}`);
  return sheet;
};

/** The row whose cell in a column holds these words. */
function rowWith(cells: Map<string, SheetCell>, words: string, column = 'A'): number {
  for (const cell of cells.values()) if (cell.text === words && cell.ref.replace(/\d+/, '') === column) return Number(cell.ref.replace(/[A-Z]+/, ''));
  throw new Error(`no cell in column ${column} says ${words}`);
}

/** The column whose cell in a row holds these words. */
function columnWith(cells: Map<string, SheetCell>, words: string, row: number): string {
  for (const cell of cells.values()) if (cell.text === words && cell.ref.replace(/[A-Z]+/, '') === String(row)) return cell.ref.replace(/\d+/, '');
  throw new Error(`no cell in row ${row} says ${words}`);
}

// A schedule with awkward names: marks XML cares about, marks a sheet name may not hold, two people with one name.
function awkward(): Schedule {
  let s = newSchedule();
  s = addPerson(s, { name: 'Zoë "Q" <b> & _x0041_ [a]:b*c?d/e\\f \u{1f600}' });
  s = addPerson(s, { name: 'Sam Reed' });
  s = addPerson(s, { name: 'sam reed' });
  s = addPerson(s, { name: 'Sam Reed' });
  s = addPerson(s, { name: '[]:*?/\\' });
  s = addPerson(s, { name: 'History' });
  s = addPerson(s, { name: "'Overview'" });
  s = addPerson(s, { name: 'A person whose name is a good deal longer than a sheet name may be' });
  s = addPerson(s, { name: 'A person whose name is a good deal longer than a sheet name may be' });
  return { ...s, name: 'Tabs\tand\nlines & <marks>', clinic: '  spaces kept  ' };
}

const sample = sampleSchedule();
const sampleBytes = await toWorkbook(sample);
const sampleBook = await open(sampleBytes);
const awkwardSchedule = awkward();
const awkwardBook = await open(await toWorkbook(awkwardSchedule));

describe('Schedule Designer: the workbook is one Excel and Numbers open without repair', () => {
  for (const [label, book, schedule] of [['the sample', sampleBook, sample], ['awkward names', awkwardBook, awkwardSchedule]] as const) {
    it(`${label}: has the parts a workbook needs, each listed with its kind`, () => {
      const names = [...book.parts.keys()];
      expect(names.slice(0, 5)).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml']);
      expect(names.length).toBe(5 + schedule.people.length + 4 + teamSheets(schedule));
      const types = parseXml(book.parts.get('[Content_Types].xml') ?? '');
      const overrides = new Map(childrenOf(types, 'Override').map((o) => [o.attrs['PartName'], o.attrs['ContentType']]));
      expect(overrides.get('/xl/workbook.xml')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml');
      expect(overrides.get('/xl/styles.xml')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml');
      for (const sheet of book.sheets) expect(overrides.get(`/${sheet.path}`), sheet.path).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml');
      expect(childrenOf(types, 'Default').map((d) => d.attrs['Extension']).sort()).toEqual(['rels', 'xml']);
      const top = parseXml(book.parts.get('_rels/.rels') ?? '');
      expect(childrenOf(top, 'Relationship').map((r) => r.attrs['Target'])).toEqual(['xl/workbook.xml']);
      const rels = childrenOf(parseXml(book.parts.get('xl/_rels/workbook.xml.rels') ?? ''), 'Relationship');
      expect(rels.filter((r) => r.attrs['Type']?.endsWith('/styles')).map((r) => r.attrs['Target'])).toEqual(['styles.xml']);
      expect(new Set(rels.map((r) => r.attrs['Id'])).size).toBe(rels.length);
      for (const rel of rels) expect(book.parts.has(`xl/${rel.attrs['Target']}`), rel.attrs['Target']).toBe(true);
    });

    it(`${label}: every part is well-formed XML that starts with the XML line`, () => {
      for (const [name, part] of book.parts) {
        expect(part.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'), name).toBe(true);
        expect(() => parseXml(part), name).not.toThrow();
      }
    });

    it(`${label}: sheet names are ones Excel takes, and no two are alike`, () => {
      const names = book.sheets.map((sheet) => sheet.name);
      expect(names[0]).toBe('Overview');
      expect(names.slice(-3)).toEqual(['Rooms', 'Kinds of time', 'ClinX data']);
      expect(names.length).toBe(schedule.people.length + 4 + teamSheets(schedule));
      for (const name of names) {
        expect(name.length, name).toBeGreaterThan(0);
        expect(name.length, name).toBeLessThanOrEqual(31);
        expect(/[[\]:*?/\\\x00-\x1f]/.test(name), name).toBe(false);
        expect(name.startsWith("'") || name.endsWith("'"), name).toBe(false);
        expect(name.trim(), name).toBe(name);
      }
      expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(names.length);
      expect(names.filter((name) => name.toLowerCase() === 'history')).toEqual([]);
      expect(book.sheets.map((sheet) => sheet.hidden)).toEqual(names.map((name) => name === 'ClinX data'));
      const book2 = parseXml(book.parts.get('xl/workbook.xml') ?? '');
      const ids = childrenOf(child(book2, 'sheets'), 'sheet').map((sheet) => sheet.attrs['sheetId']);
      expect(ids).toEqual(names.map((_, at) => String(at + 1)));
    });

    it(`${label}: every worksheet keeps its parts in the order the file format asks for`, () => {
      const order = ['sheetPr', 'dimension', 'sheetViews', 'sheetFormatPr', 'cols', 'sheetData', 'mergeCells', 'pageMargins', 'pageSetup'];
      for (const [at, sheet] of book.sheets.entries()) {
        expect(sheet.xml.name).toBe('worksheet');
        expect(sheet.xml.attrs['xmlns']).toBe('http://schemas.openxmlformats.org/spreadsheetml/2006/main');
        const found = sheet.xml.children.map((part) => part.name);
        expect(found.every((name) => order.includes(name)), `${sheet.name}: ${found.join(' ')}`).toBe(true);
        expect([...found].sort((a, b) => order.indexOf(a) - order.indexOf(b)), sheet.name).toEqual(found);
        expect(new Set(found).size, sheet.name).toBe(found.length);
        for (const needed of ['sheetPr', 'dimension', 'sheetViews', 'sheetFormatPr', 'sheetData', 'pageMargins', 'pageSetup']) expect(found, sheet.name).toContain(needed);
        expect(found.indexOf('mergeCells') === -1 || found.indexOf('mergeCells') === found.indexOf('sheetData') + 1, sheet.name).toBe(true);
        // Only the first sheet is the one in front.
        const view = child(child(sheet.xml, 'sheetViews'), 'sheetView');
        expect(view?.attrs['tabSelected'], sheet.name).toBe(at === 0 ? '1' : undefined);
        expect(child(child(sheet.xml, 'sheetPr'), 'pageSetUpPr')?.attrs['fitToPage']).toBe('1');
        expect(child(sheet.xml, 'pageSetup')?.attrs).toMatchObject({ orientation: 'landscape', fitToWidth: '1', fitToHeight: '0' });
        const cols = child(sheet.xml, 'cols');
        if (cols) expect(cols.children.length, sheet.name).toBeGreaterThan(0);
      }
    });

    it(`${label}: rows and cells are in order, each cell in its own row, inside the stated size`, () => {
      for (const sheet of book.sheets) {
        const size = rangeOf(child(sheet.xml, 'dimension')?.attrs['ref'] ?? '');
        let lastRow = 0;
        for (const row of childrenOf(child(sheet.xml, 'sheetData'), 'row')) {
          const r = Number(row.attrs['r']);
          expect(r, sheet.name).toBeGreaterThan(lastRow);
          lastRow = r;
          let lastColumn = 0;
          for (const c of row.children) {
            expect(c.name).toBe('c');
            const at = rangeOf(c.attrs['r'] ?? '');
            expect(at.r1, `${sheet.name} ${c.attrs['r']}`).toBe(r);
            expect(at.c1, `${sheet.name} ${c.attrs['r']}`).toBeGreaterThan(lastColumn);
            lastColumn = at.c1;
            expect(at.c1 <= size.c2 && at.r1 <= size.r2, `${sheet.name} ${c.attrs['r']}`).toBe(true);
          }
        }
      }
    });

    it(`${label}: merged cells never overlap, and each one starts on a cell that is there`, () => {
      for (const sheet of book.sheets) {
        const merges = child(sheet.xml, 'mergeCells');
        if (!merges) continue;
        expect(merges.attrs['count'], sheet.name).toBe(String(merges.children.length));
        expect(merges.children.length, sheet.name).toBeGreaterThan(0);
        const taken = new Set<string>();
        for (const merge of merges.children) {
          expect(merge.name).toBe('mergeCell');
          const ref = merge.attrs['ref'] ?? '';
          const range = rangeOf(ref);
          expect(range.r2 > range.r1 || range.c2 > range.c1, `${sheet.name} ${ref}`).toBe(true);
          expect(sheet.cells.has(ref.split(':')[0] ?? ''), `${sheet.name} ${ref}`).toBe(true);
          for (let r = range.r1; r <= range.r2; r++) {
            for (let c = range.c1; c <= range.c2; c++) {
              const key = `${columnLetters(c)}${r}`;
              expect(taken.has(key), `${sheet.name} ${key} is merged twice`).toBe(false);
              taken.add(key);
              // Every cell of a merged block is written, so its border shows on every side, and only the first holds words.
              expect(sheet.cells.has(key), `${sheet.name} ${key}`).toBe(true);
              if (key !== ref.split(':')[0]) expect(sheet.cells.get(key)?.text, `${sheet.name} ${key}`).toBeUndefined();
            }
          }
        }
      }
    });

    it(`${label}: text is kept as written, and formulas have no equals sign and a value beside them`, () => {
      for (const sheet of book.sheets) {
        for (const c of everywhere(sheet.xml, 'c')) {
          const kinds = c.children.map((inner) => inner.name).join(' ');
          expect(['', 'is', 'v', 'f v'], `${sheet.name} ${c.attrs['r']}`).toContain(kinds);
          // A formula that gives words is marked t="str"; nothing else carries a type.
          if (kinds === 'is') expect(c.attrs['t']).toBe('inlineStr');
          else if (kinds === 'f v' && c.attrs['t'] !== undefined) expect(c.attrs['t']).toBe('str');
          else expect(c.attrs['t']).toBeUndefined();
        }
        for (const t of everywhere(sheet.xml, 't')) expect(t.attrs['xml:space']).toBe('preserve');
        for (const cell of sheet.cells.values()) {
          if (cell.formula === undefined) continue;
          expect(cell.formula.startsWith('='), `${sheet.name} ${cell.ref}`).toBe(false);
          if (cell.text !== undefined) {
            expect(Object.values(VERDICT_NAMES), `${sheet.name} ${cell.ref}`).toContain(cell.text);
            expect(cell.number, `${sheet.name} ${cell.ref}`).toBeUndefined();
            continue;
          }
          expect(Number.isFinite(cell.number), `${sheet.name} ${cell.ref}`).toBe(true);
          // A plain sum must already hold what Excel will work out, so the sheet reads right before anything is recalculated.
          const sum = /^SUM\(([A-Z]+\d+:[A-Z]+\d+)\)$/.exec(cell.formula);
          if (!sum) continue;
          const range = rangeOf(sum[1] ?? '');
          let total = 0;
          for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) total += sheet.cells.get(`${columnLetters(c)}${r}`)?.number ?? 0;
          expect(cell.number, `${sheet.name} ${cell.ref}`).toBeCloseTo(total, 9);
        }
      }
    });

    it(`${label}: the styles are complete, and every cell points at one that exists`, () => {
      const styles = parseXml(book.parts.get('xl/styles.xml') ?? '');
      expect(styles.children.map((part) => part.name)).toEqual(['fonts', 'fills', 'borders', 'cellStyleXfs', 'cellXfs', 'cellStyles']);
      for (const part of styles.children) expect(part.attrs['count'], part.name).toBe(String(part.children.length));
      const count = (name: string) => child(styles, name)?.children.length ?? 0;
      // Excel keeps the first two fills for itself.
      expect(child(styles, 'fills')?.children.slice(0, 2).map((fill) => child(fill, 'patternFill')?.attrs['patternType'])).toEqual(['none', 'gray125']);
      for (const border of child(styles, 'borders')?.children ?? []) expect(border.children.map((side) => side.name)).toEqual(['left', 'right', 'top', 'bottom', 'diagonal']);
      for (const xf of child(styles, 'cellXfs')?.children ?? []) {
        expect(Number(xf.attrs['fontId'])).toBeLessThan(count('fonts'));
        expect(Number(xf.attrs['fillId'])).toBeLessThan(count('fills'));
        expect(Number(xf.attrs['borderId'])).toBeLessThan(count('borders'));
        expect(xf.attrs['xfId']).toBe('0');
        expect([0, 1, 2, 49]).toContain(Number(xf.attrs['numFmtId']));
      }
      for (const colour of everywhere(styles, 'color').concat(everywhere(styles, 'fgColor'))) expect(colour.attrs['rgb']).toMatch(/^FF[0-9A-F]{6}$/);
      for (const sheet of book.sheets) for (const cell of sheet.cells.values()) expect(cell.style, `${sheet.name} ${cell.ref}`).toBeLessThan(count('cellXfs'));
    });
  }

  it('gives two people with one name their own sheets, and trims a long or awkward name', () => {
    expect(awkwardBook.sheets.map((sheet) => sheet.name)).toEqual([
      'Overview',
      // A sheet name keeps none of [ ] : * ? / \\, and no underscore that Excel would read as the start of a character code.
      'Zoë "Q" <b> & x0041_ abcdef \u{1f600}',
      'Sam Reed',
      'sam reed (2)',
      'Sam Reed (3)',
      'Person',
      'History (2)',
      'Overview (2)',
      'A person whose name is a good d',
      'A person whose name is a go (2)',
      'Rooms',
      'Kinds of time',
      'ClinX data',
    ]);
  });

  it('writes awkward text so that it reads back as it was typed', () => {
    const person = awkwardBook.sheets[1];
    expect(person?.cells.get('A1')?.text).toBe('Zoë "Q" <b> & _x005F_x0041_ [a]:b*c?d/e\\f \u{1f600}');
    expect(awkwardBook.parts.get(person?.path ?? '')).toContain('Zoë "Q" &lt;b&gt; &amp; _x005F_x0041_ [a]:b*c?d/e\\f \u{1f600}');
    expect(awkwardBook.sheets[0]?.cells.get('A1')?.text).toBe('Tabs\tand\nlines & <marks>');
    expect(awkwardBook.sheets[0]?.cells.get('A2')?.text).toBe('  spaces kept  ');
    expect(awkwardBook.parts.get('xl/workbook.xml')).toContain('name="Zoë &quot;Q&quot; &lt;b&gt; &amp; x0041_ abcdef \u{1f600}"');
  });

  it('uses no word or dash the site does not allow in any text it writes of its own', () => {
    for (const sheet of sampleBook.sheets.slice(0, -1)) {
      for (const cell of sheet.cells.values()) {
        if (cell.text === undefined) continue;
        expect(BANNED.test(cell.text), `${sheet.name} ${cell.ref}: ${cell.text}`).toBe(false);
        expect(DASHES.test(cell.text), `${sheet.name} ${cell.ref}: ${cell.text}`).toBe(false);
      }
    }
  });
});

describe('Schedule Designer: a person\'s sheet', () => {
  const tobin = sheetNamed(sampleBook, 'Tobin Achterberg');
  const cells = tobin.cells;
  const tally = tallyPerson(sample, 'p-tobin');
  const words = (ref: string) => cells.get(ref)?.text;
  const merges = childrenOf(child(tobin.xml, 'mergeCells'), 'mergeCell').map((m) => m.attrs['ref']);

  it('names the person, then has times down the side at their grid and the days across', () => {
    expect(words('A1')).toBe('Tobin Achterberg');
    expect(words('A2')).toBe('Nurse practitioner, Primary care, lines every 20 minutes');
    expect(words('A3')).toBe('Sample week, Alderwick Community Health (a made-up sample)');
    expect(['A4', 'B4', 'C4', 'D4', 'E4', 'F4'].map(words)).toEqual(['Time', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
    // Under the day names, his working hours for each day.
    expect(['A5', 'B5', 'C5', 'D5', 'E5', 'F5'].map(words)).toEqual(['Working hours', '8:00 am to 5:00 pm', '8:00 am to 5:00 pm', '8:00 am to 5:00 pm', '8:00 am to 5:00 pm', '8:00 am to 12:00 pm']);
    // The sample shows 6:00 am to 9:00 pm, so the rows run from 6:00 am to the row that starts at 8:40 pm.
    expect(['A6', 'A7', 'A8', 'A12', 'A24', 'A38', 'A50'].map(words)).toEqual(['6:00 am', '6:20 am', '6:40 am', '8:00 am', '12:00 pm', '4:40 pm', '8:40 pm']);
    expect(cells.has('A51')).toBe(false);
  });

  it('draws each block as a filled cell with its name and place, a longer one merged over its rows', () => {
    // His day starts at 8:00 am, which is row 12: six rows of 20 minutes under the 6:00 am row, which is row 6.
    expect(['B6', 'B11'].map(words)).toEqual([undefined, undefined]);
    expect(words('B12')).toBe('Huddle, Tannery Row');
    expect(words('B13')).toBe('New patient, Exam 2');
    expect(merges).toContain('B13:B14');
    expect(words('B15')).toBe('Standard, Exam 2');
    expect(merges.some((ref) => ref?.startsWith('B15:'))).toBe(false);
    expect(words('B24')).toBe('Lunch');
    expect(merges).toContain('B24:B26');
    expect(words('D27')).toBe('Team meeting, Group room');
    expect(merges).toContain('D27:D29');
    // Thursday 3:00 to 4:00 pm is empty, and an empty cell still has its border.
    expect(['E33', 'E34', 'E35'].map(words)).toEqual([undefined, undefined, undefined]);
    expect(cells.get('E33')?.style).toBe(cells.get('F27')?.style);
    // Blocks of different kinds are filled differently, and a filled cell is not styled like an empty one.
    const styles = new Set([cells.get('B12')?.style, cells.get('B13')?.style, cells.get('B15')?.style, cells.get('B24')?.style, cells.get('E33')?.style]);
    expect(styles.size).toBe(5);
    expect(cells.get('B14')?.style).toBe(cells.get('B13')?.style);
  });

  it('freezes the header rows, with the working hours, and the time column', () => {
    const pane = child(child(child(tobin.xml, 'sheetViews'), 'sheetView'), 'pane');
    expect(pane?.attrs).toEqual({ xSplit: '1', ySplit: '5', topLeftCell: 'B6', activePane: 'bottomRight', state: 'frozen' });
    const widths = childrenOf(child(tobin.xml, 'cols'), 'col');
    expect(widths.every((col) => col.attrs['customWidth'] === '1' && Number(col.attrs['width']) >= 8)).toBe(true);
  });

  it('adds up each day and the week under the grid, with a real sum for the week', () => {
    const row = rowWith(cells, 'Appointments');
    expect(row).toBeGreaterThan(50);
    expect(['B', 'C', 'D', 'E', 'F'].map((column) => cells.get(`${column}${row}`)?.number)).toEqual(tally?.days.map((day) => day.appointments));
    expect(cells.get(`G${row}`)).toMatchObject({ formula: `SUM(B${row}:F${row})`, number: tally?.week.appointments });
    expect(['B', 'G'].map((column) => words(`${column}${row - 1}`))).toEqual(['Monday', 'Week']);

    const slots = rowWith(cells, 'Slots');
    const care = rowWith(cells, 'Patient care hours');
    const other = rowWith(cells, 'Other paid hours');
    const paid = rowWith(cells, 'Paid hours');
    const unpaid = rowWith(cells, 'Unpaid hours');
    expect([slots, care, other, paid, unpaid]).toEqual([row + 1, row + 2, row + 3, row + 4, row + 5]);
    expect(cells.get(`B${care}`)?.number).toBeCloseTo((tally?.days[0]?.careMinutes ?? 0) / 60, 9);
    expect(cells.get(`G${care}`)?.formula).toBe(`SUM(B${care}:F${care})`);
    expect(cells.get(`G${care}`)?.number).toBeCloseTo(80 / 3, 9);
    expect(cells.get(`C${paid}`)).toMatchObject({ formula: `C${care}+C${other}`, number: 8 });
    expect(cells.get(`G${paid}`)).toMatchObject({ formula: `SUM(B${paid}:F${paid})`, number: 35 });
    expect(cells.get(`G${unpaid}`)?.number).toBe(4);
    expect(cells.get(`G${rowWith(cells, 'Appointments on site')}`)?.number).toBe(tally?.week.onSite);
    expect(cells.get(`G${rowWith(cells, 'Appointments remote')}`)?.number).toBe(0);
  });

  it('counts each day and the week in slots, as formulas on the patient care hours and the slots in an hour', () => {
    const slots = rowWith(cells, 'Slots');
    const care = rowWith(cells, 'Patient care hours');
    const standard = rowWith(cells, 'Slots against target');
    for (const [n, column] of ['B', 'C', 'D', 'E', 'F'].entries()) expect(cells.get(`${column}${slots}`)).toEqual({ ref: `${column}${slots}`, style: cells.get(`B${slots}`)?.style, formula: `ROUND(${column}${care}*$B$${standard},1)`, number: tally?.days[n]?.slots });
    expect(tally?.days.map((day) => day.slots)).toEqual([20, 21, 11, 18, 10]);
    expect(cells.get(`G${slots}`)).toMatchObject({ formula: `ROUND(G${care}*$B$${standard},1)`, number: 80 });
    // The formula gives what is beside it: hours x slots in an hour, to one decimal.
    for (const column of ['B', 'C', 'D', 'E', 'F', 'G']) expect(Math.round((cells.get(`${column}${care}`)?.number ?? 0) * (cells.get(`B${standard}`)?.number ?? 0) * 10) / 10, column).toBe(cells.get(`${column}${slots}`)?.number);
  });

  it('shows the contract, the clinical factor, each set-aside line and the target as a formula: contract x factor less the hours set aside', () => {
    const care = rowWith(cells, 'Patient care hours');
    const paid = rowWith(cells, 'Paid hours');
    const contract = rowWith(cells, 'Contract hours');
    expect([words(`A${contract - 1}`), words(`B${contract - 1}`), words(`C${contract - 1}`)]).toEqual(['Hours a week', 'Allowed', 'On the week']);
    expect(cells.get(`B${contract}`)?.number).toBe(36);
    expect(cells.get(`C${contract}`)).toMatchObject({ formula: `G${paid}`, number: 35 });
    expect([words(`A${contract + 1}`), cells.get(`B${contract + 1}`)?.number, cells.get(`B${contract + 1}`)?.formula]).toEqual(['Clinical factor', 0.8, undefined]);
    expect([words(`A${contract + 2}`), cells.get(`B${contract + 2}`)?.number, cells.get(`C${contract + 2}`)?.number]).toEqual(['Set aside for Team meeting', 1, 1]);
    const target = rowWith(cells, 'Patient care target');
    expect(target).toBe(contract + 3);
    expect(cells.get(`B${target}`)).toMatchObject({ formula: `MAX(0,B${contract}*B${contract + 1}-SUM(B${contract + 2}:B${contract + 2}))`, number: 27.8 });
    expect(cells.get(`C${target}`)?.formula).toBe(`G${care}`);
    expect(cells.get(`C${target}`)?.number).toBeCloseTo(80 / 3, 9);
    const short = rowWith(cells, 'Patient care hours short');
    expect(cells.get(`B${short}`)?.formula).toBe(`MAX(0,B${target}-C${target})`);
    expect(cells.get(`B${short}`)?.number).toBeCloseTo(27.8 - 80 / 3, 9);
    expect([...cells.values()].some((cell) => cell.text?.includes('still needed'))).toBe(false);

    // Dalia Pemberthy has two lines set aside, and the sum takes both.
    const dalia = sheetNamed(sampleBook, 'Dalia Pemberthy').cells;
    const hers = rowWith(dalia, 'Contract hours');
    expect([2, 3].map((n) => [dalia.get(`A${hers + n}`)?.text, dalia.get(`B${hers + n}`)?.number, dalia.get(`C${hers + n}`)?.number])).toEqual([['Set aside for Team meeting', 1, 1], ['Set aside for Training', 1, 0]]);
    expect(dalia.get(`B${hers + 4}`)).toMatchObject({ formula: `MAX(0,B${hers}*B${hers + 1}-SUM(B${hers + 2}:B${hers + 3}))`, number: 30 });
  });

  it('sets the slots beside the hours: in an hour, target, actual and variance, each a formula but the standard', () => {
    const row = rowWith(cells, 'Slots against target');
    const target = rowWith(cells, 'Patient care target');
    expect(row).toBe(target + 4);
    expect(['A', 'B', 'C', 'D', 'E'].map((column) => words(`${column}${row - 1}`))).toEqual(['Slots a week', 'In an hour', 'Target', 'Actual', 'Variance']);
    expect(cells.get(`B${row}`)).toMatchObject({ number: 3 });
    expect(cells.get(`B${row}`)?.formula).toBeUndefined();
    expect(cells.get(`C${row}`)).toMatchObject({ formula: `ROUND(B${target}*B${row},0)`, number: 83 });
    expect(cells.get(`D${row}`)).toMatchObject({ formula: `G${rowWith(cells, 'Slots')}`, number: 80 });
    expect(cells.get(`E${row}`)).toMatchObject({ formula: `ROUND(D${row}-C${row},1)`, number: -3 });
    expect([cells.get(`C${row}`)?.number, cells.get(`D${row}`)?.number, cells.get(`E${row}`)?.number]).toEqual([tally?.slots.target, tally?.slots.actual, tally?.slots.variance]);
    // Every provider's sheet agrees with the tally. Support staff have no slots on their sheets.
    for (const person of sample.people) {
      const sheet = sheetNamed(sampleBook, person.name).cells;
      if (person.kind === 'support') {
        expect([...sheet.values()].some((cell) => cell.text?.includes('Slots') || cell.text === 'Clinical factor' || cell.text === 'Patient care target'), person.name).toBe(false);
        continue;
      }
      const at = rowWith(sheet, 'Slots against target');
      const theirs = tallyPerson(sample, person.id);
      expect(['C', 'D', 'E'].map((column) => sheet.get(`${column}${at}`)?.number), person.name).toEqual([theirs?.slots.target, theirs?.slots.actual, theirs?.slots.variance]);
    }
  });

  it('keeps the old sheet\'s arithmetic: 79 appointments of 20 minutes are 26.33 hours and 79 slots, 5 under a target of 84', async () => {
    // Avery Quill: contract 34 hours, factor 1, 6 set aside, so 28 of patient care and 84 slots at 3 an hour. 79 appointments, 13 of them remote.
    const blocks: Block[] = [];
    for (let n = 0; n < 79; n++) blocks.push(block(`a${n}`, 'pA', (n % 5) as Day, 480 + Math.floor(n / 5) * 20, 20, visit('v20'), n < 13 ? REMOTE : room('s1', 'r1')));
    const book = await open(await toWorkbook(withBlocks(small(), blocks)));
    const avery = sheetNamed(book, 'Avery Quill').cells;
    const count = rowWith(avery, 'Appointments');
    const care = rowWith(avery, 'Patient care hours');
    const slots = rowWith(avery, 'Slots against target');
    expect(avery.get(`G${count}`)?.number).toBe(79);
    expect(avery.get(`G${care}`)?.number).toBeCloseTo(26.3333333, 6);
    expect(avery.get(`G${rowWith(avery, 'Appointments remote')}`)?.number).toBe(13);
    expect(avery.get(`G${rowWith(avery, 'Appointments on site')}`)?.number).toBe(66);
    expect(avery.get(`B${rowWith(avery, 'Patient care target')}`)?.number).toBe(28);
    expect(avery.get(`B${rowWith(avery, 'Patient care hours short')}`)?.number).toBeCloseTo(1.6666667, 6);
    expect(['B', 'C', 'D', 'E'].map((column) => avery.get(`${column}${slots}`)?.number)).toEqual([3, 84, 79, -5]);
    // Hours are shown to two places; counts are whole; slots are shown as they are.
    const styles = parseXml(book.parts.get('xl/styles.xml') ?? '');
    const format = (ref: string) => child(styles, 'cellXfs')?.children[avery.get(ref)?.style ?? 0]?.attrs['numFmtId'];
    expect(format(`G${care}`)).toBe('2');
    expect(format(`G${count}`)).toBe('1');
    expect(format(`D${slots}`)).toBe('0');
    expect(format(`G${rowWith(avery, 'Slots')}`)).toBe('0');
  });

  it('works the method\'s own case on the sheets: 34 x 0.8 - 1 is 26.2 hours, a target of 79 slots at 3 an hour', async () => {
    let s = setDepartmentStandards(small(), 'd1', { careFactor: 0.8, slotsPerHour: 3 });
    s = setAsideHours(removeSetAside(removeSetAside(s, 'pA', 'aAdmin'), 'pA', 'aMeet'), 'pA', 'aMeet', 1);
    const blocks: Block[] = [];
    for (let n = 0; n < 77; n++) blocks.push(block(`a${n}`, 'pA', (n % 5) as Day, 480 + Math.floor(n / 5) * 20, 20, visit('v20'), REMOTE));
    const book = await open(await toWorkbook(withBlocks(s, blocks)));
    const avery = sheetNamed(book, 'Avery Quill').cells;
    const contract = rowWith(avery, 'Contract hours');
    expect([0, 1, 2].map((n) => avery.get(`B${contract + n}`)?.number)).toEqual([34, 0.8, 1]);
    expect(avery.get(`B${contract + 3}`)).toMatchObject({ formula: `MAX(0,B${contract}*B${contract + 1}-SUM(B${contract + 2}:B${contract + 2}))`, number: 26.2 });
    const slots = rowWith(avery, 'Slots against target');
    expect(['B', 'C', 'D', 'E'].map((column) => avery.get(`${column}${slots}`)?.number)).toEqual([3, 79, 77, -2]);
    const roster = book.sheets[0]?.cells ?? new Map<string, SheetCell>();
    const row = rowWith(roster, 'Avery Quill');
    expect(['E', 'G', 'H', 'I', 'J', 'K', 'L', 'M'].map((column) => roster.get(`${column}${row}`)?.number)).toEqual([34, 0.8, 1, 26.2, 3, 79, 77, -2]);
    expect(roster.get(`N${row}`)?.text).toBe('Under');
    // No working hours are entered, so that cell is empty.
    expect([roster.get(`D${row}`)?.text, roster.get(`F${row}`)?.number, roster.get(`F${row}`)?.text]).toEqual(['Provider', undefined, undefined]);
  });

  it('adds a row where a block starts or ends off the grid, and shows time outside the hours', async () => {
    // Blake Rowan is on the 15 minute grid. A 20 minute visit at 9:10 am cuts rows at 9:10 and 9:30; an early meeting adds rows from 7:00 am.
    const s = withBlocks(small(), [block('b1', 'pB', 0, 550, 20, visit('v20'), room('s1', 'r1')), block('b2', 'pB', 1, 420, 60, activity('aMeet'), REMOTE)]);
    const blake = sheetNamed(await open(await toWorkbook(s)), 'Blake Rowan').cells;
    expect(blake.get('A5')?.text).toBe('7:00 am');
    expect(blake.get('C5')?.text).toBe('Meeting, Remote');
    const at = rowWith(blake, '9:10 am');
    expect([blake.get(`A${at - 1}`)?.text, blake.get(`A${at + 1}`)?.text, blake.get(`A${at + 2}`)?.text, blake.get(`A${at + 3}`)?.text]).toEqual(['9:00 am', '9:15 am', '9:30 am', '9:45 am']);
    expect(blake.get(`B${at}`)?.text).toBe('Standard, Exam 1');
    expect(blake.get(`B${at + 1}`)?.text).toBeUndefined();
    expect(blake.get(`B${at + 2}`)?.style).not.toBe(blake.get(`B${at}`)?.style);
  });

  it('makes the target the contract itself when nothing is set aside', async () => {
    const s = addPerson(newSchedule(), { name: 'Rowan Pike' });
    const cells2 = sheetNamed(await open(await toWorkbook(s)), 'Rowan Pike').cells;
    const contract = rowWith(cells2, 'Contract hours');
    expect(cells2.get(`A${contract + 1}`)?.text).toBe('Clinical factor');
    expect(cells2.get(`B${contract + 1}`)?.number).toBe(1);
    expect(rowWith(cells2, 'Patient care target')).toBe(contract + 2);
    expect(cells2.get(`B${contract + 2}`)).toMatchObject({ formula: `B${contract}*B${contract + 1}`, number: 40 });
  });
});

describe('Schedule Designer: the Overview, Rooms and Kinds of time sheets', () => {
  it('Overview: a roster of people down, slots against target, then a morning and an afternoon for each day', () => {
    const cells = sampleBook.sheets[0]?.cells ?? new Map<string, SheetCell>();
    expect(cells.get('A1')?.text).toBe('Sample week');
    expect(cells.get('A2')?.text).toBe('Alderwick Community Health (a made-up sample)');
    expect(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'].map((column) => cells.get(`${column}4`)?.text)).toEqual([
      'Person', 'Role', 'Department', 'Kind', 'Contract hours', 'Working hours', 'Clinical factor', 'Set-aside hours', 'Capacity hours', 'Slots in an hour', 'Target slots', 'Actual slots', 'Variance', 'Status', 'Ramping',
    ]);
    expect(['Contract hours', 'Capacity hours', 'Target slots', 'Status', 'Monday'].map((words) => columnWith(cells, words, 4))).toEqual(['E', 'I', 'K', 'N', 'P']);
    expect(['P4', 'R4', 'X4'].map((ref) => cells.get(ref)?.text)).toEqual(['Monday', 'Tuesday', 'Friday']);
    expect(['P5', 'Q5', 'Y5'].map((ref) => cells.get(ref)?.text)).toEqual(['Morning', 'Afternoon', 'Afternoon']);
    const row = rowWith(cells, 'Tobin Achterberg');
    expect(row).toBe(7);
    expect([`B${row}`, `C${row}`, `D${row}`, `P${row}`, `T${row}`, `U${row}`, `Y${row}`].map((ref) => cells.get(ref)?.text)).toEqual(['Nurse practitioner', 'Primary care', 'Provider', 'Patient care, Tannery Row', 'Patient care, Tannery Row', 'Admin time, Tannery Row', undefined]);
    // Tobin Achterberg is at work four days of nine hours and a Friday morning: 40 hours.
    expect(cells.get(`F${row}`)?.number).toBe(40);
    // The sums count the eight providers and leave the three support staff out, whose rows are 14 to 16.
    const all = rowWith(cells, 'All providers');
    expect(all).toBe(17);
    for (const [column, number] of [['E', 274], ['F', 307], ['H', 10], ['I', 215.4], ['K', 651], ['L', 638], ['M', -13]] as const) {
      expect(cells.get(`${column}${all}`)?.formula, column).toBe(`SUMIF($D$6:$D$16,"Provider",${column}6:${column}16)`);
      expect(cells.get(`${column}${all}`)?.number, column).toBeCloseTo(number, 9);
    }
    for (const column of ['G', 'J', 'N', 'O']) expect(cells.has(`${column}${all}`), column).toBe(false);
    const pane = child(child(child(sampleBook.sheets[0]?.xml, 'sheetViews'), 'sheetView'), 'pane');
    expect(pane?.attrs).toMatchObject({ xSplit: '1', ySplit: '5', topLeftCell: 'B6', state: 'frozen' });
  });

  it('Overview: capacity, target, variance and status are real formulas, and the status points at the tolerance cell', () => {
    const cells = sampleBook.sheets[0]?.cells ?? new Map<string, SheetCell>();
    expect([cells.get('A3')?.text, cells.get('B3')?.number, cells.get('B3')?.formula]).toEqual(['Tolerance, in slots', 2, undefined]);
    expect(cells.get('C3')?.text).toBe('A week this many slots over or under its target still counts as on target.');
    const rows = overview(sample);
    expect(rows.length).toBe(11);
    for (const [n, person] of rows.entries()) {
      const r = 6 + n;
      const at = (column: string) => cells.get(`${column}${r}`);
      expect(at('A')?.text).toBe(person.name);
      expect(at('D')?.text, person.name).toBe(person.kind === 'support' ? 'Support staff' : 'Provider');
      expect([at('E')?.number, at('E')?.formula], person.name).toEqual([person.contractHours, undefined]);
      expect([at('F')?.number, at('F')?.formula], person.name).toEqual([(person.workMinutes ?? 0) / 60, undefined]);
      if (person.kind === 'support') {
        // A support person's slot cells are there, with their borders, and hold nothing: no number, no words, no formula.
        for (const column of ['G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O']) expect(at(column), `${person.name} ${column}`).toEqual({ ref: `${column}${r}`, style: at(column)?.style });
        continue;
      }
      // What is typed: contract, factor, set-aside, slots in an hour, the actual slots of the designed week, and the ramping mark.
      expect(['G', 'H', 'J', 'L'].map((column) => [at(column)?.number, at(column)?.formula]), person.name).toEqual([
        [person.careFactor, undefined], [person.setAsideHours, undefined], [person.slotsPerHour, undefined], [person.actual, undefined],
      ]);
      expect(at('O')?.text, person.name).toBe(person.ramping ? 'Yes' : undefined);
      // What is worked out, with the number Excel will give already beside each formula.
      expect(at('I'), person.name).toMatchObject({ formula: `MAX(0,E${r}*G${r}-H${r})`, number: person.capacityHours });
      expect(at('K'), person.name).toMatchObject({ formula: `ROUND(I${r}*J${r},0)`, number: person.target });
      expect(at('M'), person.name).toMatchObject({ formula: `ROUND(L${r}-K${r},1)`, number: person.variance });
      expect(at('N'), person.name).toMatchObject({
        formula: `IF(O${r}="Yes","Ramping",IF(E${r}<=0,"Needs contract",IF(L${r}<=0,"Needs schedule",IF(ABS(M${r})<=$B$3,"On target",IF(M${r}>0,"Over","Under")))))`,
        text: VERDICT_NAMES[person.verdict],
      });
      expect(at('N')?.number).toBeUndefined();
      // The same sums done here from the typed cells give the numbers beside the formulas.
      const typed = (column: string) => at(column)?.number ?? 0;
      const capacity = Math.max(0, typed('E') * typed('G') - typed('H'));
      expect(capacity, person.name).toBeCloseTo(typed('I'), 9);
      expect(Math.round(Number((capacity * typed('J')).toFixed(6))), person.name).toBe(typed('K'));
      expect(Math.round((typed('L') - typed('K')) * 10) / 10, person.name).toBe(typed('M'));
    }
    expect(rows.map((person) => cells.get(`N${6 + rows.indexOf(person)}`)?.text)).toEqual(['On target', 'Under', 'On target', 'Over', 'On target', 'Ramping', 'On target', 'On target', undefined, undefined, undefined]);
  });

  it('Overview: the status says what the tally says for every verdict, and the tolerance cell holds the tolerance', async () => {
    // Avery: 79 slots against 84. Blake: nothing planned. Then no contract, then ramping.
    const blocks: Block[] = [];
    for (let n = 0; n < 79; n++) blocks.push(block(`a${n}`, 'pA', (n % 5) as Day, 480 + Math.floor(n / 5) * 20, 20, visit('v20'), REMOTE));
    const week = withBlocks(small(), blocks);
    const status = async (s: Schedule) => {
      const cells = (await open(await toWorkbook(s))).sheets[0]?.cells ?? new Map<string, SheetCell>();
      return [cells.get('B3')?.number, cells.get('N6')?.text, cells.get('O6')?.text, cells.get('N7')?.text];
    };
    expect(await status(week)).toEqual([0, 'Under', undefined, 'Needs schedule']);
    expect(await status(setTolerance(week, 5))).toEqual([5, 'On target', undefined, 'Needs schedule']);
    expect(await status(setPerson(week, 'pA', { slotsPerHour: 4 }))).toEqual([0, 'Under', undefined, 'Needs schedule']);
    expect(await status(setPerson(week, 'pA', { careFactor: 0.9 }))).toEqual([0, 'Over', undefined, 'Needs schedule']);
    expect(await status(setPerson(week, 'pA', { contractHours: 0 }))).toEqual([0, 'Needs contract', undefined, 'Needs schedule']);
    expect(await status(setPerson(setPerson(week, 'pA', { contractHours: 0 }), 'pA', { ramping: true }))).toEqual([0, 'Ramping', 'Yes', 'Needs schedule']);
  });

  it('Rooms: each room\'s hours in use and free, then for each day who is in each room, clashes said in words', () => {
    const rooms = sheetNamed(sampleBook, 'Rooms');
    const cells = rooms.cells;
    const exam2 = rowWith(cells, 'Exam 2, Tannery Row');
    const hours = roomHours(sample, 'site-tannery').find((r) => r.name === 'Exam 2');
    expect(cells.get(`B${exam2}`)?.number).toBeCloseTo((hours?.usedMinutes ?? 0) / 60, 9);
    expect(cells.get(`C${exam2}`)?.number).toBeCloseTo((hours?.freeMinutes ?? 0) / 60, 9);
    expect([cells.get(`B${exam2 - 2}`)?.text, cells.get(`C${exam2 - 2}`)?.text]).toEqual(['Hours in use', 'Hours free']);
    const all = rowWith(cells, 'All rooms');
    expect(cells.get(`B${all}`)?.formula).toBe(`SUM(B${all - 10}:B${all - 1})`);

    const texts = [...cells.values()].map((cell) => cell.text);
    expect(texts.filter((t) => t === 'Clash: Tobin Achterberg, Linnea Farrowby').length).toBe(1);
    expect(texts.filter((t) => t === 'Maren Castellane, Tobin Achterberg, Osric Vandermeer, Linnea Farrowby, Kofi Brantwood, Briony Halvard, Emrys Tolliver').length).toBe(1);
    expect(texts.filter((t) => t?.startsWith('Clash')).length).toBe(1);
    // Five days, each with its name, the sites, the rooms, and a time column.
    const tuesday = rowWith(cells, 'Tuesday');
    expect(cells.get(`B${tuesday + 1}`)?.text).toBe('Tannery Row');
    expect(cells.get(`I${tuesday + 1}`)?.text).toBe('Coldbrook Annex');
    expect(['A', 'B', 'C', 'H', 'I', 'K'].map((column) => cells.get(`${column}${tuesday + 2}`)?.text)).toEqual(['Time', 'Exam 1', 'Exam 2', 'Group room', 'Exam 1', 'Consult B']);
    // The rows start at 6:00 am: one for each hour, and one where somebody comes or goes. 8:00 am is the third.
    expect(cells.get(`A${tuesday + 3}`)?.text).toBe('6:00 am');
    expect(cells.get(`A${tuesday + 4}`)?.text).toBe('7:00 am');
    expect(cells.get(`A${tuesday + 5}`)?.text).toBe('8:00 am');
    expect(cells.get(`A${tuesday + 6}`)?.text).toBe('8:15 am');
    expect(cells.get(`B${tuesday + 3}`)?.text).toBeUndefined();
    expect(cells.get(`B${tuesday + 5}`)?.text).toBe('Maren Castellane');
    expect(cells.get(`C${tuesday + 6}`)?.text).toBe('Clash: Tobin Achterberg, Linnea Farrowby');
    expect(cells.get(`C${tuesday + 5}`)?.text).toBe('Tobin Achterberg');
    expect(cells.get(`C${tuesday + 6}`)?.style).not.toBe(cells.get(`C${tuesday + 5}`)?.style);
    const pane = child(child(child(rooms.xml, 'sheetViews'), 'sheetView'), 'pane');
    expect(pane?.attrs).toEqual({ xSplit: '1', topLeftCell: 'B1', activePane: 'topRight', state: 'frozen' });
  });

  it('Kinds of time: every visit type and activity with its colour, length and what it counts as', () => {
    const cells = sheetNamed(sampleBook, 'Kinds of time').cells;
    const head = rowWith(cells, 'Department');
    expect(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((column) => cells.get(`${column}${head}`)?.text)).toEqual(['Department', 'Name', 'Code', 'Minutes', 'Colour', 'Counts as', 'Appointments this week']);
    const group = rowWith(cells, 'Group', 'B');
    expect([cells.get(`A${group}`)?.text, cells.get(`C${group}`)?.text, cells.get(`D${group}`)?.number, cells.get(`E${group}`)?.text, cells.get(`F${group}`)?.text, cells.get(`G${group}`)?.number]).toEqual(['Behavioral health', 'GRP', 60, 'Lime', 'Patient care', 0]);
    const lunch = rowWith(cells, 'Lunch', 'B');
    expect([cells.get(`A${lunch}`)?.text, cells.get(`D${lunch}`)?.number, cells.get(`E${lunch}`)?.text, cells.get(`F${lunch}`)?.text]).toEqual(['Other time', undefined, 'Grey', 'Unpaid time']);
    expect(cells.get(`F${rowWith(cells, 'Huddle', 'B')}`)?.text).toBe('Paid time');
    // The name cell is filled with the kind's own colour: twelve swatches, so Group and Lunch differ.
    expect(cells.get(`B${group}`)?.style).not.toBe(cells.get(`B${lunch}`)?.style);
    expect(lunch - head).toBe(10 + 5);
  });

  it('writes a workbook for a schedule with nobody and nothing in it', async () => {
    const empty: Schedule = { ...newSchedule(), sites: [], departments: [], activities: [], people: [], blocks: [] };
    const book = await open(await toWorkbook(empty));
    expect(book.sheets.map((sheet) => sheet.name)).toEqual(['Overview', 'Rooms', 'Kinds of time', 'ClinX data']);
    for (const part of book.parts.values()) expect(() => parseXml(part)).not.toThrow();
    expect(await fromWorkbook(await toWorkbook(empty))).toEqual({ schedule: empty });
  });
});

describe('Schedule Designer: the hidden data sheet', () => {
  const data = sampleBook.sheets[sampleBook.sheets.length - 1];
  const cells = data?.cells ?? new Map<string, SheetCell>();

  it('says what it is for, then holds the schedule as plain text in pieces of at most 30,000 characters', () => {
    expect(data?.name).toBe('ClinX data');
    expect(data?.hidden).toBe(true);
    expect(cells.get('A1')?.text).toBe('This sheet holds the schedule in the form the Schedule Designer page reads when this workbook is opened there. Please leave it as it is: a change here can keep the workbook from opening on that page.');
    expect(cells.get('A2')?.text).toBe('clinx-schedule');
    expect(cells.get('B2')?.number).toBe(1);
    const count = cells.get('C2')?.number ?? 0;
    expect(count).toBeGreaterThan(2);
    const pieces: string[] = [];
    for (let n = 0; n < count; n++) pieces.push(cells.get(`A${3 + n}`)?.text ?? '');
    expect(cells.has(`A${3 + count}`)).toBe(false);
    for (const piece of pieces) {
      expect(piece.length).toBeGreaterThan(0);
      expect(piece.length).toBeLessThanOrEqual(30000);
      expect(/^[\x21-\x7e][\x20-\x7e]*[\x21-\x7e]$/.test(piece)).toBe(true);
      expect(/[<>&]|_x/.test(piece)).toBe(false);
    }
    expect(cells.get('D2')?.number).toBe(pieces.join('').length);
    expect(JSON.parse(pieces.join(''))).toEqual(sample);
  });

  it('keeps awkward text out of harm\'s way: nothing but plain letters reaches the sheet', () => {
    const awkwardData = awkwardBook.sheets[awkwardBook.sheets.length - 1];
    const raw = awkwardBook.parts.get(awkwardData?.path ?? '') ?? '';
    expect(/^[\x0a\x20-\x7e]*$/.test(raw)).toBe(true);
    expect(raw).not.toContain('_x0041_');
    expect(raw).toContain('\\u005fx0041_');
  });
});

describe('Schedule Designer: a saved workbook opens again as the same schedule', () => {
  it('the sample', async () => {
    expect(await fromWorkbook(sampleBytes)).toEqual({ schedule: sample });
  });

  it('a new schedule, and one with blocks of every kind and place', async () => {
    const fresh = newSchedule();
    expect(await fromWorkbook(await toWorkbook(fresh))).toEqual({ schedule: fresh });
    const s = withBlocks(small(), [
      block('a1', 'pA', 0, 480, 20, visit('v20'), room('s1', 'r1')),
      block('a2', 'pA', 0, 500, 40, visit('v40'), room('s1', null)),
      block('a3', 'pA', 0, 545, 60, activity('aAdmin'), REMOTE),
      block('a4', 'pA', 4, 720, 30, activity('aLunch'), { kind: 'none' }),
      block('b1', 'pB', 2, 30, 60, visit('v60'), room('s2', 'r3')),
      block('b2', 'pB', 2, 1380, 60, visit('v60'), room('s2', 'r3')),
    ]);
    expect(validate(s)).toEqual({ schedule: s });
    expect(await fromWorkbook(await toWorkbook(s))).toEqual({ schedule: s });
  });

  it('the standards: care factors, slots in an hour, a person\'s own values, the ramping mark and the tolerance', async () => {
    let s = setDepartmentStandards(small(), 'd1', { careFactor: 0.825, slotsPerHour: 2.75 });
    s = setPerson(s, 'pB', { careFactor: 0.01, slotsPerHour: 12, ramping: true });
    s = setTolerance(s, 1.5);
    expect(validate(s)).toEqual({ schedule: s });
    const back = await fromWorkbook(await toWorkbook(s));
    expect(back).toEqual({ schedule: s });
    expect('schedule' in back && [back.schedule.tolerance, back.schedule.departments[0]?.careFactor, back.schedule.departments[0]?.slotsPerHour, back.schedule.people[1]?.ramping, back.schedule.people[0]?.careFactor]).toEqual([1.5, 0.825, 2.75, true, null]);
  });

  it('awkward names and text, character for character', async () => {
    expect(validate(awkwardSchedule)).toEqual({ schedule: awkwardSchedule });
    const back = await fromWorkbook(await toWorkbook(awkwardSchedule));
    expect(back).toEqual({ schedule: awkwardSchedule });
    expect('schedule' in back && back.schedule.people[0]?.name).toBe('Zoë "Q" <b> & _x0041_ [a]:b*c?d/e\\f \u{1f600}');
  });

  it('does not change the schedule it is given, and writes the same bytes each time', async () => {
    const frozen = small();
    const first = await toWorkbook(frozen);
    const second = await toWorkbook(frozen);
    expect(first).toBeInstanceOf(Uint8Array);
    expect(first.length === second.length && first.every((byte, at) => byte === second[at])).toBe(true);
    // A workbook is a zip: it starts with the letters PK.
    expect([first[0], first[1]]).toEqual([0x50, 0x4b]);
  });

  it('a large schedule: many people and long days', async () => {
    let s = newSchedule();
    for (let n = 0; n < 40; n++) s = addPerson(s, { name: `Person ${n + 1}` });
    const type = s.departments[0]?.visitTypes[0];
    const site = s.sites[0];
    const blocks: Block[] = [];
    for (const [p, person] of s.people.entries()) {
      for (const day of s.days) for (let start = 480; start < 1020; start += 20) blocks.push(block(`x${blocks.length}`, person.id, day, start, 20, visit(type?.id ?? ''), room(site?.id ?? '', site?.rooms[p % 2]?.id ?? null)));
    }
    s = { ...s, blocks };
    expect(validate(s)).toEqual({ schedule: s });
    const bytes = await toWorkbook(s);
    expect(await fromWorkbook(bytes)).toEqual({ schedule: s });
  });
});

describe('Schedule Designer: opening a workbook that Excel has saved again', () => {
  const dataPath = sampleBook.sheets[sampleBook.sheets.length - 1]?.path ?? '';
  const dataCells = sampleBook.sheets[sampleBook.sheets.length - 1]?.cells ?? new Map<string, SheetCell>();
  const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const START = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
  const inXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  async function resaved(change: (part: ZipPart) => { name: string; text: string } | ZipPart | null, more: { name: string; text: string }[] = []): Promise<Uint8Array> {
    const parts: (ZipPart | { name: string; text: string })[] = [];
    for (const part of readZip(sampleBytes)) {
      const next = change(part);
      if (next) parts.push(next);
    }
    return writeZip([...parts, ...more]);
  }

  it('reads text kept in the shared list, in runs, with the cells in Excel\'s own form', async () => {
    // Excel moves every text into one shared list and points each cell at its place there.
    const shared: string[] = [];
    let rows = '';
    let lastRow = 0;
    let open2 = false;
    for (const cell of dataCells.values()) {
      const row = Number(cell.ref.replace(/[A-Z]+/, ''));
      if (row !== lastRow) {
        rows += `${open2 ? '</row>' : ''}<row r="${row}" spans="1:4" x14ac:dyDescent="0.2">`;
        open2 = true;
        lastRow = row;
      }
      if (cell.text !== undefined) {
        // One piece in three: written as two runs, as text typed over in Excel can be.
        const half = Math.floor(cell.text.length / 2);
        shared.push(shared.length % 3 === 1 ? `<si><r><rPr><sz val="11"/></rPr><t xml:space="preserve">${inXml(cell.text.slice(0, half))}</t></r><r><t xml:space="preserve">${inXml(cell.text.slice(half))}</t></r><rPh sb="0" eb="1"><t>not part of the text</t></rPh></si>` : `<si><t>${inXml(cell.text)}</t></si>`);
        rows += `<c r="${cell.ref}" s="4" t="s"><v>${shared.length - 1}</v></c>`;
      } else rows += `<c r="${cell.ref}"><v>${cell.number}</v></c>`;
    }
    const sheet = `${START}<worksheet xmlns="${MAIN}" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac"><dimension ref="A1:D9"/><sheetData>${rows}</row></sheetData></worksheet>`;
    const strings = `${START}<sst xmlns="${MAIN}" count="${shared.length}" uniqueCount="${shared.length}">${shared.join('')}</sst>`;
    const bytes = await resaved((part) => (part.name === dataPath ? { name: part.name, text: sheet } : part), [{ name: 'xl/sharedStrings.xml', text: strings }]);
    expect(await fromWorkbook(bytes)).toEqual({ schedule: sample });
  });

  it('reads a sheet written with a prefix on every tag, and a path that starts at the top', async () => {
    let rows = '';
    for (const cell of dataCells.values()) {
      const row = Number(cell.ref.replace(/[A-Z]+/, ''));
      rows += `<x:row r="${row}">${cell.text !== undefined ? `<x:c t="inlineStr" r="${cell.ref}"><x:is><x:t>${inXml(cell.text)}</x:t></x:is></x:c>` : `<x:c r="${cell.ref}"><x:v>${cell.number}</x:v></x:c>`}</x:row>`;
    }
    const sheet = `${START}<x:worksheet xmlns:x="${MAIN}"><x:sheetData>${rows}</x:sheetData></x:worksheet>`;
    const bytes = await resaved((part) => {
      if (part.name === dataPath) return { name: part.name, text: sheet };
      if (part.name === 'xl/_rels/workbook.xml.rels') return { name: part.name, text: (sampleBook.parts.get(part.name) ?? '').replace(/Target="worksheets\//g, 'Target="/xl/worksheets/') };
      return part;
    });
    expect(await fromWorkbook(bytes)).toEqual({ schedule: sample });
  });
});

describe('Schedule Designer: a file that cannot be opened gets a plain reason, never an error', () => {
  const problemOf = async (bytes: unknown): Promise<string> => {
    const result = await fromWorkbook(bytes as Uint8Array);
    expect(Object.keys(result)).toEqual(['problem']);
    const problem = 'problem' in result ? result.problem : '';
    expect(problem.length).toBeGreaterThan(40);
    expect(/^[A-Z].*\.$/.test(problem), problem).toBe(true);
    expect(BANNED.test(problem), problem).toBe(false);
    expect(DASHES.test(problem), problem).toBe(false);
    return problem;
  };
  const encoder = new TextEncoder();
  const dataPath = sampleBook.sheets[sampleBook.sheets.length - 1]?.path ?? '';
  const dataXml = sampleBook.parts.get(dataPath) ?? '';

  async function withData(xml: string | Uint8Array): Promise<Uint8Array> {
    return writeZip(readZip(sampleBytes).map((part) => (part.name !== dataPath ? part : typeof xml === 'string' ? { name: part.name, text: xml } : { name: part.name, data: xml })));
  }

  it('something that is not a workbook at all', async () => {
    const NOT = 'This file is not a workbook this page can open. Choose a workbook that was saved from this page, with a name ending in .xlsx.';
    expect(await problemOf(new Uint8Array(0))).toBe(NOT);
    expect(await problemOf(new Uint8Array(5))).toBe(NOT);
    expect(await problemOf(encoder.encode('Name,Role\nAvery,Nurse\n'.repeat(40)))).toBe(NOT);
    const noise = new Uint8Array(5000);
    for (let at = 0; at < noise.length; at++) noise[at] = (at * 7919 + 13) % 251;
    expect(await problemOf(noise)).toBe(NOT);
    expect(await problemOf(sampleBytes.subarray(0, sampleBytes.length - 40))).toBe(NOT);
    for (const wrong of [null, undefined, 'a workbook', 42, {}, []]) expect(await problemOf(wrong)).toBe(NOT);
    expect(await fromWorkbook(sampleBytes.buffer.slice(sampleBytes.byteOffset, sampleBytes.byteOffset + sampleBytes.byteLength) as unknown as Uint8Array)).toEqual({ schedule: sample });
  });

  it('an old .xls file or a workbook locked with a password', async () => {
    const old = new Uint8Array(4096);
    old.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(await problemOf(old)).toBe('This file is an older .xls workbook, or a workbook locked with a password. In Excel, save it as an .xlsx workbook with no password, then open that here.');
  });

  it('a zip or a workbook that this page did not save', async () => {
    const NOT_OURS = 'This workbook was not saved from this page, or its hidden sheet named ClinX data has been removed. Choose a workbook saved from this page, or start a new schedule.';
    expect(await problemOf(storeZip([{ name: 'notes.txt', text: 'hello' }]))).toBe(NOT_OURS);
    expect(await problemOf(legendWorkbook([]))).toBe(NOT_OURS);
    const without = await writeZip(readZip(sampleBytes).filter((part) => part.name !== dataPath));
    expect(await problemOf(without)).toBe(NOT_OURS);
    const renamed = await writeZip(readZip(sampleBytes).map((part) => (part.name === 'xl/workbook.xml' ? { name: part.name, text: (sampleBook.parts.get(part.name) ?? '').replace('ClinX data', 'Sheet 12') } : part)));
    expect(await problemOf(renamed)).toBe(NOT_OURS);
    expect(await problemOf(await withData(dataXml.replace('clinx-schedule', 'something else')))).toBe(NOT_OURS);
  });

  it('a data sheet that is damaged', async () => {
    const DAMAGED = 'The schedule inside this workbook is damaged and cannot be read. Open an earlier copy of the workbook saved from this page, or start a new schedule.';
    // A piece is missing.
    expect(await problemOf(await withData(dataXml.replace(/<row r="4">.*?<\/row>/, '')))).toBe(DAMAGED);
    // Some of the text was typed over.
    expect(await problemOf(await withData(dataXml.replace('"sites":', '"sites""')))).toBe(DAMAGED);
    expect(await problemOf(await withData(dataXml.replace('{"format"', 'x{"format"')))).toBe(DAMAGED);
    // The sheet is empty, is not XML, or is cut short.
    expect(await problemOf(await withData('<worksheet/>'))).toContain('not saved from this page');
    expect(await problemOf(await withData(new Uint8Array([0xff, 0xfe, 0x00, 0x01, 0x02])))).toContain('not saved from this page');
    expect(await problemOf(await withData(dataXml.slice(0, 600)))).toContain('not saved from this page');
    expect(await problemOf(await withData(dataXml.slice(0, dataXml.indexOf('<row r="4">') + 200)))).toBe(DAMAGED);
    // The packed bytes of the sheet are spoiled.
    const parts = readZip(sampleBytes).map((part) => {
      if (part.name !== dataPath) return part;
      const packed = part.packed.slice();
      for (let at = 20; at < packed.length; at += 3) packed[at] = (packed[at] ?? 0) ^ 0x5a;
      return { ...part, packed };
    });
    expect(await problemOf(await writeZip(parts))).toBe(DAMAGED);
  });

  it('a schedule that is whole text but not a schedule this tool can use says what is wrong with it', async () => {
    const edit = (change: (value: Record<string, unknown>) => void): Promise<Uint8Array> => {
      const value = JSON.parse(JSON.stringify(small())) as Record<string, unknown>;
      change(value);
      const json = JSON.stringify(value);
      return withData(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="2"><c r="A2" t="inlineStr"><is><t>clinx-schedule</t></is></c><c r="B2"><v>1</v></c><c r="C2"><v>1</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>${json.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></is></c></row></sheetData></worksheet>`);
    };
    expect(await fromWorkbook(await edit(() => undefined))).toEqual({ schedule: small() });
    expect(await problemOf(await edit((value) => (value['days'] = [0, 0])))).toContain('This schedule cannot be opened because');
    expect(await problemOf(await edit((value) => (value['people'] = 'nobody')))).toContain('This schedule cannot be opened because');
  });

  it('a workbook saved by a newer version of the tool', async () => {
    const NEWER = 'This schedule was saved by a newer version of this tool than the one on this page. Reload the page to get the current version, then open the file again.';
    expect(await problemOf(await withData(dataXml.replace('<c r="B2" s="0"><v>1</v></c>', '<c r="B2"><v>2</v></c>')))).toBe(NEWER);
    expect(dataXml).toContain('"version":1,');
    expect(await problemOf(await withData(dataXml.replace('"version":1,', '"version":7,')))).toBe(NEWER);
  });

  it('a data sheet far too large to be a schedule, without unpacking all of it', async () => {
    const huge = encoder.encode(`<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${'a'.repeat(50 * 1024 * 1024)}</t></is></c></row></sheetData></worksheet>`);
    const bytes = await withData(huge);
    expect(bytes.length).toBeLessThan(2 * 1024 * 1024);
    expect(await problemOf(bytes)).toBe('This file is too large to be a schedule from this page. Choose a workbook that was saved from this page.');
    // A part that lies about its size is still stopped while it is being unpacked.
    const lying = readZip(bytes).map((part) => (part.name === dataPath ? { ...part, size: 100 } : part));
    expect(await problemOf(await writeZip(lying))).toBe('This file is too large to be a schedule from this page. Choose a workbook that was saved from this page.');
  });
});
