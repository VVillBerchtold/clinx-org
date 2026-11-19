// The workbook for a schedule with working hours and support staff: the working-hours line on a
// person's sheet, a support person's sheet, the Overview roster, and the "Care teams" sheet.

import { describe, expect, it } from 'vitest';
import { addPerson, paint } from '../../src/scripts/schedule-designer/engine/edit';
import { addWorksWith } from '../../src/scripts/schedule-designer/engine/team';
import type { Schedule } from '../../src/scripts/schedule-designer/engine/types';
import { fromWorkbook, toWorkbook } from '../../src/scripts/schedule-designer/engine/workbook';
import { setWork } from '../../src/scripts/schedule-designer/engine/work';
import { hasRow, openBook, rowWith, savedValue, sheetNamed } from './fixtures/book';
import { activity, block, deepFreeze, room, small, visit, withBlocks, withTime } from './fixtures/small';
import { team, visits } from './fixtures/team';
import { child, childrenOf, everywhere, parseXml } from './fixtures/xml';
import type { SheetCell } from './fixtures/xml';

const ELM = room('s1', null);
const ANNEX = room('s2', null);
const CONSULT = room('s2', 'r3');
const BANNED = /\b(?:highest|lowest|worst|best)\b|\btop\s/i;
const DASHES = /[—–]| - /;

/**
 * Avery sees patients on Monday, 8:00 am to 10:00 am at Elm Street and 1:00 pm to 3:00 pm at the
 * Annex, and works Monday 8:00 am to 5:00 pm and a split Tuesday. Blake has one appointment on
 * Tuesday at 8:15 am and no working hours entered. Sage, a medical assistant, is with Avery for
 * those four hours and with Blake for 45 minutes, has an hour of admin and an hour of lunch, and
 * works Monday 8:00 am to 4:00 pm and Tuesday 8:00 am to 12:00 pm. Teal lists Avery and has
 * nothing on their week.
 */
function teamWeek(): Schedule {
  let s: Schedule = withBlocks(team(), [...visits('m', 'pA', 0, 480, 6), block('lunch', 'pA', 0, 720, 60, activity('aLunch'), ELM), ...visits('n', 'pA', 0, 780, 6, CONSULT), block('b1', 'pB', 1, 495, 30, visit('v30'), CONSULT)]);
  s = setWork(s, 'pA', 0, [{ from: 480, to: 1020 }]);
  s = setWork(s, 'pA', 1, [{ from: 480, to: 720 }, { from: 780, to: 1020 }]);
  s = paint(s, { personId: 'pS', day: 0, from: 480, to: 600, what: withTime('pA'), where: ELM });
  s = paint(s, { personId: 'pS', day: 0, from: 780, to: 900, what: withTime('pA'), where: ANNEX });
  s = paint(s, { personId: 'pS', day: 1, from: 495, to: 540, what: withTime('pB'), where: ANNEX });
  s = paint(s, { personId: 'pS', day: 0, from: 600, to: 660, what: activity('aAdmin'), where: ELM });
  s = paint(s, { personId: 'pS', day: 0, from: 720, to: 780, what: activity('aLunch'), where: ELM });
  s = setWork(s, 'pS', 0, [{ from: 480, to: 960 }]);
  s = setWork(s, 'pS', 1, [{ from: 480, to: 720 }]);
  s = addWorksWith(s, 'pT', 'pA');
  return deepFreeze(s);
}

const week = teamWeek();
const bytes = await toWorkbook(week);
const book = await openBook(bytes);

/** A row of a sheet from one column to another, as the numbers or words its cells show. */
function across(cells: Map<string, SheetCell>, row: number, from: string, to: string): (string | number | undefined)[] {
  const out: (string | number | undefined)[] = [];
  for (let code = from.charCodeAt(0); code <= to.charCodeAt(0); code++) {
    const cell = cells.get(`${String.fromCharCode(code)}${row}`);
    out.push(cell?.text ?? cell?.number);
  }
  return out;
}

describe('Schedule Designer: a workbook with support staff is one Excel opens without repair', () => {
  it('has a sheet for every person, then Care teams, then the rest, each with its own part', () => {
    expect(book.sheets.map((sheet) => sheet.name)).toEqual(['Overview', 'Avery Quill', 'Blake Rowan', 'Sage Marlow', 'Teal Ostrander', 'Care teams', 'Rooms', 'Kinds of time', 'ClinX data']);
    expect(book.sheets.map((sheet) => sheet.hidden)).toEqual([false, false, false, false, false, false, false, false, true]);
    expect(new Set(book.sheets.map((sheet) => sheet.path)).size).toBe(9);
    for (const sheet of book.sheets) expect(book.parts.has(sheet.path), sheet.path).toBe(true);
    expect([...book.parts.keys()]).toHaveLength(5 + 9);
    const types = parseXml(book.parts.get('[Content_Types].xml') ?? '');
    const overrides = new Map(childrenOf(types, 'Override').map((o) => [o.attrs['PartName'], o.attrs['ContentType']]));
    for (const sheet of book.sheets) expect(overrides.get(`/${sheet.path}`), sheet.path).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml');
    const ids = childrenOf(child(parseXml(book.parts.get('xl/workbook.xml') ?? ''), 'sheets'), 'sheet').map((sheet) => sheet.attrs['sheetId']);
    expect(ids).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  });

  it('every part is well-formed XML, and every worksheet keeps its parts in the order the file format asks for', () => {
    const order = ['sheetPr', 'dimension', 'sheetViews', 'sheetFormatPr', 'cols', 'sheetData', 'mergeCells', 'pageMargins', 'pageSetup'];
    for (const [name, part] of book.parts) expect(() => parseXml(part), name).not.toThrow();
    for (const sheet of book.sheets) {
      const found = sheet.xml.children.map((part) => part.name);
      expect(found, sheet.name).toEqual(order.filter((name) => found.includes(name)));
      expect(found, sheet.name).toContain('sheetData');
    }
  });

  it('gives every formula the value it last had, and no formula an error', () => {
    let formulas = 0;
    for (const sheet of book.sheets) {
      for (const cell of sheet.cells.values()) {
        if (cell.formula === undefined) continue;
        formulas++;
        expect(cell.text !== undefined || Number.isFinite(cell.number), `${sheet.name} ${cell.ref}`).toBe(true);
        expect(cell.formula, `${sheet.name} ${cell.ref}`).not.toMatch(/#REF|#DIV|#VALUE|#NAME|#N\/A/);
        expect(cell.text ?? '', `${sheet.name} ${cell.ref}`).not.toMatch(/^#/);
        // Every cell a formula names is on its own sheet and inside the sheet's cells or its empty roster cells.
        expect(cell.formula, `${sheet.name} ${cell.ref}`).not.toContain('!');
      }
    }
    expect(formulas).toBeGreaterThan(60);
  });

  it('keeps every cell inside the sheet\'s stated range, with rows and cells in order and no cell twice', () => {
    for (const sheet of book.sheets) {
      const seen = new Set<string>();
      let lastRow = 0;
      for (const row of childrenOf(child(sheet.xml, 'sheetData'), 'row')) {
        const number = Number(row.attrs['r']);
        expect(number, sheet.name).toBeGreaterThan(lastRow);
        lastRow = number;
        let lastColumn = 0;
        for (const c of childrenOf(row, 'c')) {
          const ref = c.attrs['r'] ?? '';
          expect(seen.has(ref), `${sheet.name} ${ref}`).toBe(false);
          seen.add(ref);
          expect(ref.replace(/[A-Z]+/, ''), `${sheet.name} ${ref}`).toBe(String(number));
          const column = [...ref.replace(/\d+/, '')].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
          expect(column, `${sheet.name} ${ref}`).toBeGreaterThan(lastColumn);
          lastColumn = column;
        }
      }
    }
  });

  it('merges no cell twice', () => {
    for (const sheet of book.sheets) {
      const taken = new Set<string>();
      for (const merge of everywhere(sheet.xml, 'mergeCell')) {
        const [from = '', to = from] = (merge.attrs['ref'] ?? '').split(':');
        const column = (ref: string): number => [...ref.replace(/\d+/, '')].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
        const row = (ref: string): number => Number(ref.replace(/[A-Z]+/, ''));
        for (let r = row(from); r <= row(to); r++) {
          for (let c = column(from); c <= column(to); c++) {
            expect(taken.has(`${r}:${c}`), `${sheet.name} ${merge.attrs['ref']}`).toBe(false);
            taken.add(`${r}:${c}`);
          }
        }
      }
    }
  });

  it('uses only styles the style sheet has', () => {
    const styles = parseXml(book.parts.get('xl/styles.xml') ?? '');
    const count = Number(child(styles, 'cellXfs')?.attrs['count']);
    expect(count).toBeGreaterThan(10);
    for (const sheet of book.sheets) for (const cell of sheet.cells.values()) expect(cell.style, `${sheet.name} ${cell.ref}`).toBeLessThan(count);
  });

  it('uses no word or dash the site does not allow in any text it writes of its own', () => {
    for (const sheet of book.sheets.slice(0, -1)) {
      for (const cell of sheet.cells.values()) {
        if (cell.text === undefined) continue;
        expect(BANNED.test(cell.text), `${sheet.name} ${cell.ref}: ${cell.text}`).toBe(false);
        expect(DASHES.test(cell.text), `${sheet.name} ${cell.ref}: ${cell.text}`).toBe(false);
        expect(/\bpaint|palette/i.test(cell.text), `${sheet.name} ${cell.ref}: ${cell.text}`).toBe(false);
      }
    }
  });

  it('opens again as the same schedule, and the hidden sheet carries the new fields', async () => {
    expect(await fromWorkbook(bytes)).toEqual({ schedule: week });
    const saved = savedValue(book) as unknown as Schedule;
    expect(saved.version).toBe(1);
    expect(saved.people.map((person) => [person.id, person.kind, person.worksWith, person.work.length])).toEqual([['pA', 'provider', [], 3], ['pB', 'provider', [], 0], ['pS', 'support', ['pA', 'pB'], 2], ['pT', 'support', ['pA'], 0]]);
    expect(saved.blocks.filter((one) => one.what.kind === 'with')).toHaveLength(3);
    // The same bytes each time.
    const again = await toWorkbook(week);
    expect(again.length).toBe(bytes.length);
    expect(again.every((byte, at) => byte === bytes[at])).toBe(true);
  });
});

describe('Schedule Designer: working hours on a person\'s sheet', () => {
  const avery = sheetNamed(book, 'Avery Quill');
  const cells = avery.cells;

  it('has a line under the day names with each day\'s working hours, a split day in full, and "Day off"', () => {
    expect(across(cells, 4, 'A', 'F')).toEqual(['Time', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
    expect(across(cells, 5, 'A', 'F')).toEqual(['Working hours', '8:00 am to 5:00 pm', '8:00 am to 12:00 pm and 1:00 pm to 5:00 pm', 'Day off', 'Day off', 'Day off']);
    // The grid starts on the row after, and one more row is frozen.
    expect(cells.get('A6')?.text).toBe('8:00 am');
    expect(cells.get('B6')?.text).toBe('Standard, Exam 1');
    const pane = child(child(child(avery.xml, 'sheetViews'), 'sheetView'), 'pane');
    expect(pane?.attrs).toEqual({ xSplit: '1', ySplit: '5', topLeftCell: 'B6', activePane: 'bottomRight', state: 'frozen' });
    // The long split-day text gets a taller row to wrap in.
    const row5 = childrenOf(child(avery.xml, 'sheetData'), 'row').find((row) => row.attrs['r'] === '5');
    expect(Number(row5?.attrs['ht'])).toBe(30);
  });

  it('a person with no working hours entered has no such line, and the sheet is laid out as before', () => {
    const blake = sheetNamed(book, 'Blake Rowan');
    expect(hasRow(blake.cells, 'Working hours')).toBe(false);
    expect(blake.cells.get('A5')?.text).toBe('8:00 am');
    const pane = child(child(child(blake.xml, 'sheetViews'), 'sheetView'), 'pane');
    expect(pane?.attrs).toEqual({ xSplit: '1', ySplit: '4', topLeftCell: 'B5', activePane: 'bottomRight', state: 'frozen' });
    expect(hasRow(blake.cells, 'Hours at work')).toBe(false);
    expect(hasRow(blake.cells, 'Open hours at work')).toBe(false);
  });

  it('adds the hours at work and the open hours at work for each day, with a real sum for the week', () => {
    const work = rowWith(cells, 'Hours at work');
    const open = rowWith(cells, 'Open hours at work');
    expect(open).toBe(work + 1);
    // Monday: 9 hours at work less 4 of appointments and 1 of lunch. Tuesday: both stretches, all open.
    expect(across(cells, work, 'B', 'G')).toEqual([9, 8, 0, 0, 0, 17]);
    expect(across(cells, open, 'B', 'G')).toEqual([4, 8, 0, 0, 0, 12]);
    expect(cells.get(`G${work}`)?.formula).toBe(`SUM(B${work}:F${work})`);
    expect(cells.get(`G${open}`)?.formula).toBe(`SUM(B${open}:F${open})`);
    // The rows above keep their formulas: paid hours are still patient care and other paid hours.
    const paid = rowWith(cells, 'Paid hours');
    expect(cells.get(`B${paid}`)?.formula).toBe(`B${paid - 2}+B${paid - 1}`);
    expect(cells.get(`C${rowWith(cells, 'Contract hours')}`)?.formula).toBe(`G${paid}`);
  });

  it('a provider\'s sheet ends with the support staff who have time with them, and the hours', () => {
    const head = rowWith(cells, 'Support staff with this provider');
    expect(across(cells, head, 'A', 'G')).toEqual(['Support staff with this provider', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Week']);
    expect(across(cells, head + 1, 'A', 'G')).toEqual(['Sage Marlow, Medical assistant', 4, 0, 0, 0, 0, 4]);
    expect(cells.get(`G${head + 1}`)?.formula).toBe(`SUM(B${head + 1}:F${head + 1})`);
    // Teal lists Avery and has no time with them, so Teal is not on the sheet. Nothing follows.
    expect(cells.has(`A${head + 2}`)).toBe(false);
    // Blake's sheet has Sage for the 45 minutes on Tuesday.
    const blake = sheetNamed(book, 'Blake Rowan').cells;
    const theirs = rowWith(blake, 'Support staff with this provider');
    expect(across(blake, theirs + 1, 'A', 'G')).toEqual(['Sage Marlow, Medical assistant', 0, 0.75, 0, 0, 0, 0.75]);
  });
});

describe('Schedule Designer: a support person\'s sheet', () => {
  const sage = sheetNamed(book, 'Sage Marlow');
  const cells = sage.cells;

  it('draws time with a provider like other blocks, merged over its rows, with a row for a start off the grid', () => {
    expect(cells.get('A2')?.text).toBe('Medical assistant, Primary care, lines every 20 minutes');
    expect(across(cells, 5, 'A', 'F')).toEqual(['Working hours', '8:00 am to 4:00 pm', '8:00 am to 12:00 pm', 'Day off', 'Day off', 'Day off']);
    expect(cells.get('B6')?.text).toBe('With Avery Quill, Elm Street');
    // 8:15 am is off Sage's 20 minute grid, so the grid gains a row for it.
    expect([cells.get('A6')?.text, cells.get('A7')?.text, cells.get('A8')?.text]).toEqual(['8:00 am', '8:15 am', '8:20 am']);
    expect(cells.get('C7')?.text).toBe('With Blake Rowan, Annex');
    const admin = rowWith(cells, '10:00 am');
    expect(cells.get(`B${admin}`)?.text).toBe('Admin time, Elm Street');
    const one = rowWith(cells, '1:00 pm');
    expect(cells.get(`B${one}`)?.text).toBe('With Avery Quill, Annex');
    const merges = everywhere(sage.xml, 'mergeCell').map((merge) => merge.attrs['ref']);
    // 8:00 am to 10:00 am is seven rows with the extra one, and 1:00 pm to 3:00 pm is six.
    expect(merges).toContain(`B6:B${admin - 1}`);
    expect(merges).toContain(`B${one}:B${one + 5}`);
    // The two providers are drawn in different fills, and time with one provider in one fill.
    expect(cells.get('B6')?.style).toBe(cells.get(`B${one}`)?.style);
    expect(cells.get('B6')?.style).not.toBe(cells.get('C7')?.style);
  });

  it('has no slots, no patient care rows and no target: hours with providers, other paid hours and their sum', () => {
    for (const words of ['Slots', 'Appointments', 'Patient care hours', 'Appointments on site', 'Clinical factor', 'Patient care target', 'Slots a week', 'Slots against target', 'Patient care hours short']) {
      expect(hasRow(cells, words), words).toBe(false);
    }
    const head = rowWith(cells, 'This week');
    expect(across(cells, head, 'A', 'G')).toEqual(['This week', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Week']);
    expect(['A', 'A', 'A', 'A', 'A', 'A'].map((column, at) => cells.get(`${column}${head + 1 + at}`)?.text)).toEqual(['Hours with providers', 'Other paid hours', 'Paid hours', 'Unpaid hours', 'Hours at work', 'Open hours at work']);
    expect(across(cells, head + 1, 'B', 'G')).toEqual([4, 0.75, 0, 0, 0, 4.75]);
    expect(across(cells, head + 2, 'B', 'G')).toEqual([1, 0, 0, 0, 0, 1]);
    expect(across(cells, head + 3, 'B', 'G')).toEqual([5, 0.75, 0, 0, 0, 5.75]);
    expect(across(cells, head + 4, 'B', 'G')).toEqual([1, 0, 0, 0, 0, 1]);
    expect(across(cells, head + 5, 'B', 'G')).toEqual([8, 4, 0, 0, 0, 12]);
    expect(across(cells, head + 6, 'B', 'G')).toEqual([2, 3.25, 0, 0, 0, 5.25]);
    for (const column of ['B', 'C', 'D', 'E', 'F']) expect(cells.get(`${column}${head + 3}`)?.formula).toBe(`${column}${head + 1}+${column}${head + 2}`);
    for (let row = head + 1; row <= head + 6; row++) expect(cells.get(`G${row}`)?.formula).toBe(`SUM(B${row}:F${row})`);
  });

  it('sets the paid hours beside the contract, then lists the hours with each provider', () => {
    const paid = rowWith(cells, 'Paid hours');
    const contract = rowWith(cells, 'Contract hours');
    expect(across(cells, contract - 1, 'A', 'C')).toEqual(['Hours a week', 'Allowed', 'On the week']);
    expect(across(cells, contract, 'A', 'C')).toEqual(['Contract hours', 40, 5.75]);
    expect(cells.get(`C${contract}`)?.formula).toBe(`G${paid}`);
    const head = rowWith(cells, 'Hours with each provider');
    expect(head).toBe(contract + 2);
    expect(across(cells, head, 'A', 'G')).toEqual(['Hours with each provider', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Week']);
    expect(across(cells, head + 1, 'A', 'G')).toEqual(['Avery Quill', 4, 0, 0, 0, 0, 4]);
    expect(across(cells, head + 2, 'A', 'G')).toEqual(['Blake Rowan', 0, 0.75, 0, 0, 0, 0.75]);
    expect(cells.get(`G${head + 1}`)?.formula).toBe(`SUM(B${head + 1}:F${head + 1})`);
    expect(cells.has(`A${head + 3}`)).toBe(false);
  });

  it('a support person with an empty week and a provider on their list has a row of zeros for that provider', () => {
    const teal = sheetNamed(book, 'Teal Ostrander').cells;
    expect(hasRow(teal, 'Working hours')).toBe(false);
    expect(hasRow(teal, 'Hours at work')).toBe(false);
    const head = rowWith(teal, 'Hours with each provider');
    expect(across(teal, head + 1, 'A', 'G')).toEqual(['Avery Quill', 0, 0, 0, 0, 0, 0]);
    expect(across(teal, rowWith(teal, 'Contract hours'), 'A', 'C')).toEqual(['Contract hours', 20, 0]);
  });

  it('a support person who holds appointments has them counted, still with no slots', async () => {
    const nurse = paint(week, { personId: 'pT', day: 2, from: 480, to: 540, what: visit('v20'), where: room('s1', 'r2') });
    const teal = sheetNamed(await openBook(await toWorkbook(nurse)), 'Teal Ostrander').cells;
    const head = rowWith(teal, 'This week');
    expect(['A', 'A', 'A', 'A', 'A', 'A'].map((column, at) => teal.get(`${column}${head + 1 + at}`)?.text)).toEqual(['Appointments', 'Patient care hours', 'Hours with providers', 'Other paid hours', 'Paid hours', 'Unpaid hours']);
    expect(across(teal, head + 1, 'B', 'G')).toEqual([0, 0, 3, 0, 0, 3]);
    expect(across(teal, head + 2, 'B', 'G')).toEqual([0, 0, 1, 0, 0, 1]);
    expect(teal.get(`D${head + 5}`)?.formula).toBe(`D${head + 2}+D${head + 3}+D${head + 4}`);
    expect(across(teal, head + 5, 'B', 'G')).toEqual([0, 0, 1, 0, 0, 1]);
    expect(hasRow(teal, 'Slots')).toBe(false);
    expect(hasRow(teal, 'Slots against target')).toBe(false);
    expect(hasRow(teal, 'Appointments on site')).toBe(true);
  });
});

describe('Schedule Designer: support staff on the Overview', () => {
  const cells = sheetNamed(book, 'Overview').cells;

  it('has a column for the kind and one for the working hours in a week', () => {
    expect(across(cells, 4, 'A', 'O')).toEqual(['Person', 'Role', 'Department', 'Kind', 'Contract hours', 'Working hours', 'Clinical factor', 'Set-aside hours', 'Capacity hours', 'Slots in an hour', 'Target slots', 'Actual slots', 'Variance', 'Status', 'Ramping']);
    expect(across(cells, 6, 'A', 'F')).toEqual(['Avery Quill', 'Physician', 'Primary care', 'Provider', 34, 17]);
    // Blake has no working hours entered, so the cell is empty.
    expect(across(cells, 7, 'A', 'F')).toEqual(['Blake Rowan', 'Counsellor', 'Counselling', 'Provider', 40, undefined]);
    expect(across(cells, 8, 'A', 'F')).toEqual(['Sage Marlow', 'Medical assistant', 'Primary care', 'Support staff', 40, 12]);
    expect(across(cells, 9, 'A', 'F')).toEqual(['Teal Ostrander', 'Nurse', 'Primary care', 'Support staff', 20, undefined]);
  });

  it('leaves the slot columns of a support row empty, with no formula in them', () => {
    for (const row of [8, 9]) {
      for (const column of ['G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O']) {
        const cell = cells.get(`${column}${row}`);
        expect([cell?.formula, cell?.text, cell?.number], `${column}${row}`).toEqual([undefined, undefined, undefined]);
      }
    }
    // A provider's row keeps its formulas, moved two columns to the right.
    expect(cells.get('I6')?.formula).toBe('MAX(0,E6*G6-H6)');
    expect(cells.get('K6')?.formula).toBe('ROUND(I6*J6,0)');
    expect(cells.get('M6')?.formula).toBe('ROUND(L6-K6,1)');
    expect(cells.get('N6')?.formula).toBe('IF(O6="Yes","Ramping",IF(E6<=0,"Needs contract",IF(L6<=0,"Needs schedule",IF(ABS(M6)<=$B$3,"On target",IF(M6>0,"Over","Under")))))');
    expect([cells.get('K6')?.number, cells.get('L6')?.number, cells.get('M6')?.number, cells.get('N6')?.text]).toEqual([84, 12, -72, 'Under']);
  });

  it('totals the providers only, with a formula that reads the kind column', () => {
    expect(cells.get('A10')?.text).toBe('All providers');
    for (const column of ['E', 'F', 'H', 'I', 'K', 'L', 'M']) expect(cells.get(`${column}10`)?.formula, column).toBe(`SUMIF($D$6:$D$9,"Provider",${column}6:${column}9)`);
    // Contract 34 + 40, working hours 17, set aside 6 + 10, capacity 28 + 30, target 84 + 120, actual 12 + 2.
    expect(['E', 'F', 'H', 'I', 'K', 'L', 'M'].map((column) => cells.get(`${column}10`)?.number)).toEqual([74, 17, 16, 58, 204, 14, -190]);
    for (const column of ['G', 'J', 'N', 'O']) expect(cells.get(`${column}10`)?.formula, column).toBeUndefined();
  });

  it('shows a support person\'s half days by the provider they are with', () => {
    expect(across(cells, 4, 'P', 'R')).toEqual(['Monday', undefined, 'Tuesday']);
    expect(across(cells, 8, 'P', 'R')).toEqual(['With Avery Quill, Elm Street', 'With Avery Quill, Annex', 'With Blake Rowan, Annex']);
  });

  it('leaves the working hours total out when no provider has working hours', async () => {
    const s = setWork(withBlocks(team(), visits('a', 'pA', 0, 480, 3)), 'pS', 0, [{ from: 480, to: 960 }]);
    const overview = sheetNamed(await openBook(await toWorkbook(s)), 'Overview').cells;
    expect(overview.get('F8')?.number).toBe(8);
    expect(overview.get('F10')?.formula).toBeUndefined();
    expect(overview.get('E10')?.formula).toBe('SUMIF($D$6:$D$9,"Provider",E6:E9)');
  });
});

describe('Schedule Designer: the Care teams sheet', () => {
  const sheet = sheetNamed(book, 'Care teams');
  const cells = sheet.cells;

  it('has one row for a provider and a support person who has time with them, with hours on each day and a real sum', () => {
    expect(cells.get('A1')?.text).toBe('Care teams');
    expect(cells.get('A2')?.text).toBe('Test week, Invented Clinic');
    expect(across(cells, 4, 'A', 'I')).toEqual(['Provider', 'Support staff', 'Role', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Week']);
    expect(across(cells, 5, 'A', 'I')).toEqual(['Avery Quill', 'Sage Marlow', 'Medical assistant', 4, 0, 0, 0, 0, 4]);
    expect(across(cells, 6, 'A', 'I')).toEqual(['Blake Rowan', 'Sage Marlow', 'Medical assistant', 0, 0.75, 0, 0, 0, 0.75]);
    expect(cells.get('I5')?.formula).toBe('SUM(D5:H5)');
    expect(cells.get('I6')?.formula).toBe('SUM(D6:H6)');
    // Teal has no time with a provider, so there is no row for Teal, and nothing after the last row.
    expect([...cells.keys()].filter((ref) => Number(ref.replace(/[A-Z]+/, '')) > 6)).toEqual([]);
    const pane = child(child(child(sheet.xml, 'sheetViews'), 'sheetView'), 'pane');
    expect(pane?.attrs['ySplit']).toBe('4');
    expect(pane?.attrs['state']).toBe('frozen');
  });

  it('lists a provider\'s support staff in the order of the people list, provider by provider', async () => {
    let s: Schedule = paint(week, { personId: 'pT', day: 3, from: 480, to: 570, what: withTime('pA'), where: ELM });
    s = paint(s, { personId: 'pT', day: 4, from: 480, to: 540, what: withTime('pB'), where: ANNEX });
    const teams = sheetNamed(await openBook(await toWorkbook(s)), 'Care teams').cells;
    expect([5, 6, 7, 8].map((row) => across(teams, row, 'A', 'I'))).toEqual([
      ['Avery Quill', 'Sage Marlow', 'Medical assistant', 4, 0, 0, 0, 0, 4],
      ['Avery Quill', 'Teal Ostrander', 'Nurse', 0, 0, 0, 1.5, 0, 1.5],
      ['Blake Rowan', 'Sage Marlow', 'Medical assistant', 0, 0.75, 0, 0, 0, 0.75],
      ['Blake Rowan', 'Teal Ostrander', 'Nurse', 0, 0, 0, 0, 1, 1],
    ]);
  });

  it('says so in a sentence when there are support staff and nobody has time with a provider yet', async () => {
    const empty = await openBook(await toWorkbook(team()));
    expect(empty.sheets.map((one) => one.name)).toContain('Care teams');
    const teams = sheetNamed(empty, 'Care teams').cells;
    expect(across(teams, 4, 'A', 'C')).toEqual(['Provider', 'Support staff', 'Role']);
    expect(teams.has('A5')).toBe(false);
    expect(teams.get('A6')?.text).toBe('Nobody has time with a provider on this schedule yet. Add it to a support person in Design.');
    expect(await fromWorkbook(await toWorkbook(team()))).toEqual({ schedule: team() });
  });

  it('is left out when the schedule has no support staff, and so is the extra line on Kinds of time', async () => {
    const plain = await openBook(await toWorkbook(withBlocks(small(), visits('a', 'pA', 0, 480, 3))));
    expect(plain.sheets.map((one) => one.name)).toEqual(['Overview', 'Avery Quill', 'Blake Rowan', 'Rooms', 'Kinds of time', 'ClinX data']);
    expect(hasRow(sheetNamed(plain, 'Kinds of time').cells, 'Time with a provider', 'B')).toBe(false);
    // The Overview still has the kind column, and its totals still read it.
    const overview = sheetNamed(plain, 'Overview').cells;
    expect([overview.get('D6')?.text, overview.get('D7')?.text, overview.get('A8')?.text]).toEqual(['Provider', 'Provider', 'All providers']);
    expect(overview.get('E8')?.formula).toBe('SUMIF($D$6:$D$7,"Provider",E6:E7)');
  });

  it('keeps its name to itself: a person called "Care teams" gets another sheet name, with or without support staff', async () => {
    const named = addPerson(week, { name: 'Care teams' });
    const names = (await openBook(await toWorkbook(named))).sheets.map((one) => one.name);
    expect(names).toEqual(['Overview', 'Avery Quill', 'Blake Rowan', 'Sage Marlow', 'Teal Ostrander', 'Care teams (2)', 'Care teams', 'Rooms', 'Kinds of time', 'ClinX data']);
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(names.length);
    const alone = addPerson(small(), { name: 'CARE TEAMS' });
    expect((await openBook(await toWorkbook(alone))).sheets.map((one) => one.name)).toEqual(['Overview', 'Avery Quill', 'Blake Rowan', 'CARE TEAMS (2)', 'Rooms', 'Kinds of time', 'ClinX data']);
  });
});

describe('Schedule Designer: time with a provider on Kinds of time and Rooms', () => {
  it('Kinds of time gains one line for time with a provider', () => {
    const cells = sheetNamed(book, 'Kinds of time').cells;
    const row = rowWith(cells, 'Time with a provider', 'B');
    expect(across(cells, row, 'A', 'G')).toEqual(['Other time', 'Time with a provider', undefined, undefined, 'One for each provider', 'Paid time', undefined]);
    expect(cells.has(`A${row + 1}`)).toBe(false);
  });

  it('time with a provider holds no room, so the Rooms sheet is the same with and without it', async () => {
    const rooms = sheetNamed(book, 'Rooms');
    const without = { ...week, blocks: week.blocks.filter((one) => one.what.kind !== 'with') };
    const other = sheetNamed(await openBook(await toWorkbook(without)), 'Rooms');
    expect([...rooms.cells.values()].map((cell) => [cell.ref, cell.text, cell.number, cell.formula])).toEqual([...other.cells.values()].map((cell) => [cell.ref, cell.text, cell.number, cell.formula]));
  });
});
