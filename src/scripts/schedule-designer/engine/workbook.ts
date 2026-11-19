// Saving a schedule as an Excel workbook, and opening a saved one again.
//
// In plain words: an .xlsx workbook is a zip file holding small text files, one for each sheet.
// `toWorkbook` writes those files itself, with no outside code, so the schedule never leaves the
// computer. The workbook is made for people first: an Overview that is a slot tracker's roster
// (contract hours, clinical factor, set-aside hours, capacity, slots in an hour, target, actual,
// variance and status, worked out by real formulas so it stays live in Excel), one sheet for each
// person laid out like a paper week (times down the side, days across, a filled cell for each
// block, the tallies underneath with real formulas), a Care teams sheet when the schedule has support
// staff (each provider with the support staff who have time with them), a Rooms sheet and a list of
// the kinds of time. A last, hidden
// sheet named "ClinX data" holds the whole schedule as text. `fromWorkbook` reads only that sheet,
// so nothing a person changes on the other sheets can confuse the page, and whatever it is given
// it answers with a schedule or with one plain sentence, never an error.
//
// The twelve swatches become fixed fill and ink colours here and nowhere else: a schedule itself
// only ever holds the swatch number. The addresses below that start with http are the names the
// file format gives its parts. They are written into the file as text and nothing is ever fetched.

import { readZip, writeZip } from '../../cleaner-copy/engine/zip.js';
import type { ZipPart } from '../../cleaner-copy/engine/zip.js';
import { blocksOn, departmentOf, endOf, factsOf } from './find';
import { overview } from './overview';
import { roomHours, roomUse } from './rooms';
import { VERDICT_NAMES, capacityHours, standardsOf, tallyClinic, tallyPerson } from './tally';
import type { Counts } from './tally';
import { supportStaffIn, teamHours } from './team';
import { clock, dayName } from './time';
import { COLOUR_NAMES } from './types';
import type { Colour, Person, Schedule } from './types';
import { VERSION, validate } from './validate';
import { workText } from './work';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELATIONSHIPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELATIONSHIPS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CONTENT_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
const SHEET_KIND = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
const START = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** The name of the hidden sheet that holds the schedule. */
const DATA_SHEET = 'ClinX data';
const TEAMS_SHEET = 'Care teams';
const DATA_NOTE =
  'This sheet holds the schedule in the form the Schedule Designer page reads when this workbook is opened there. Please leave it as it is: a change here can keep the workbook from opening on that page.';
/** The most characters one cell of the data sheet holds. A cell in Excel takes 32,767. */
const PIECE = 30000;

// How large a file, and how large one unpacked part of it, this tool will read. A schedule at the
// limits in types.ts is a few megabytes; anything far beyond that is not one.
const MOST_FILE = 64 * 1024 * 1024;
const MOST_PART = 32 * 1024 * 1024;

const NOT_A_WORKBOOK = 'This file is not a workbook this page can open. Choose a workbook that was saved from this page, with a name ending in .xlsx.';
const OLD_OR_LOCKED = 'This file is an older .xls workbook, or a workbook locked with a password. In Excel, save it as an .xlsx workbook with no password, then open that here.';
const NOT_FROM_HERE = 'This workbook was not saved from this page, or its hidden sheet named ClinX data has been removed. Choose a workbook saved from this page, or start a new schedule.';
const DAMAGED = 'The schedule inside this workbook is damaged and cannot be read. Open an earlier copy of the workbook saved from this page, or start a new schedule.';
const TOO_LARGE = 'This file is too large to be a schedule from this page. Choose a workbook that was saved from this page.';

// ---------------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------------

/** Column letters for a column number: 1 is A, 27 is AA. */
function letters(column: number): string {
  let out = '';
  for (let left = column; left > 0; left = Math.floor((left - 1) / 26)) out = String.fromCharCode(65 + ((left - 1) % 26)) + out;
  return out;
}

/** Replaces what XML cannot hold at all: half of a character pair, and two code points it forbids. */
function wellFormed(value: string): string {
  if (!/[\ud800-\udfff￾￿]/.test(value)) return value;
  let out = '';
  for (let at = 0; at < value.length; at++) {
    const code = value.charCodeAt(at);
    const next = value.charCodeAt(at + 1);
    if (code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      out += value.slice(at, at + 2);
      at++;
    } else if ((code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff) out += '�';
    else out += value.charAt(at);
  }
  return out;
}

/**
 * Text made safe to sit inside a cell. Excel reads "_x0041_" in a cell as a code for one
 * character, so an underscore that starts such a pattern is itself written as a code, and so is
 * a control character XML does not allow.
 */
function inXml(value: string): string {
  return wellFormed(value)
    .replace(/_(?=x[0-9a-fA-F]{4}_)/g, '_x005F_')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\x00-\x08\x0b-\x1f]/g, (mark) => `_x${mark.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`);
}

/** Text made safe to sit inside an attribute, in double quotes. */
function inAttribute(value: string): string {
  return wellFormed(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A number as a cell holds it. */
function plainNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : '0';
}

/** Cuts text to a number of characters without splitting a character pair, and tidies the end. */
function cut(value: string, most: number): string {
  let end = Math.min(value.length, most);
  const last = value.charCodeAt(end - 1);
  if (end < value.length && last >= 0xd800 && last <= 0xdbff) end--;
  return value.slice(0, end).replace(/[' ]+$/, '');
}

/**
 * A sheet name for each person, in order. Excel allows 31 characters, none of [ ] : * ? / \,
 * no apostrophe at either end, and no two names alike whatever their capitals. Two people with one
 * name get "Name" and "Name (2)". The names of this workbook's own sheets ("Care teams" among
 * them, whether or not this workbook has that sheet), and "History", which Excel keeps for
 * itself, are never given to a person.
 */
function sheetNames(people: readonly Person[]): string[] {
  const taken = new Set(['overview', 'rooms', 'kinds of time', TEAMS_SHEET.toLowerCase(), DATA_SHEET.toLowerCase(), 'history']);
  return people.map((person) => {
    const base =
      wellFormed(person.name)
        .replace(/[\x00-\x1f\x7f�]/g, ' ')
        .replace(/[[\]:*?/\\]/g, '')
        .replace(/_(?=x[0-9a-fA-F]{4}_)/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^[' ]+|[' ]+$/g, '') || 'Person';
    let name = cut(base, 31) || 'Person';
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${cut(base, 31 - ` (${n})`.length)} (${n})`;
    taken.add(name.toLowerCase());
    return name;
  });
}

// ---------------------------------------------------------------------------------------------
// Looks: fonts, fills, borders
// ---------------------------------------------------------------------------------------------

/** The fill and the ink for each swatch, as Excel wants them. They are chosen to fit the names in COLOUR_NAMES. */
const SWATCHES: Readonly<Record<Colour, readonly [fill: string, ink: string]>> = {
  1: ['E4DAFB', '3B1F8C'],
  2: ['D6E6FB', '123F7A'],
  3: ['CFEFEC', '0B4F4A'],
  4: ['D5EFD5', '1C5221'],
  5: ['E6F3C2', '3F5208'],
  6: ['FBF0BE', '5C4700'],
  7: ['FCDDBF', '7A3A05'],
  8: ['F9D3D0', '7D1A14'],
  9: ['F9D4E7', '7A1750'],
  10: ['EDE3D0', '54432A'],
  11: ['D8DEE8', '2D3A4D'],
  12: ['E4E4E4', '3A3A3A'],
};
const INK = '000000';
const MUTED = '595959';
const LINE = 'A6A6A6';
const HEAD_FILL = 'EFEBF7';
const WHO_FILL = 'ECE7F8';

/** How a cell looks. Everything left out is plain. */
interface Look {
  bold?: boolean;
  size?: number;
  ink?: string;
  fill?: string;
  border?: boolean;
  /** 0 as typed, 1 a whole number, 2 two decimal places, 49 text. All four are built into Excel. */
  format?: 0 | 1 | 2 | 49;
  across?: 'left' | 'center' | 'right';
  down?: 'top' | 'center';
  wrap?: boolean;
}

/** Gathers the looks a workbook uses and writes them as its styles part. Each look gets a number a cell points at. */
function makeStyles(): { style(look: Look): number; xml(): string } {
  const fonts: string[] = [];
  // Excel keeps the first two fills for itself.
  const fills: string[] = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const borders: string[] = [];
  const formats: string[] = [];
  const place = (list: string[], xml: string): number => {
    const at = list.indexOf(xml);
    if (at >= 0) return at;
    list.push(xml);
    return list.length - 1;
  };
  const style = (look: Look): number => {
    const font = place(fonts, `<font>${look.bold ? '<b/>' : ''}<sz val="${look.size ?? 11}"/><color rgb="FF${look.ink ?? INK}"/><name val="Calibri"/><family val="2"/></font>`);
    const fill = look.fill ? place(fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${look.fill}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    const side = (name: string): string => (look.border ? `<${name} style="thin"><color rgb="FF${LINE}"/></${name}>` : `<${name}/>`);
    const border = place(borders, `<border>${side('left')}${side('right')}${side('top')}${side('bottom')}<diagonal/></border>`);
    const format = look.format ?? 0;
    const alignment = look.across || look.down || look.wrap ? `<alignment${look.across ? ` horizontal="${look.across}"` : ''}${look.down ? ` vertical="${look.down}"` : ''}${look.wrap ? ' wrapText="1"' : ''}/>` : '';
    const applied = `${format ? ' applyNumberFormat="1"' : ''} applyFont="1"${fill ? ' applyFill="1"' : ''}${look.border ? ' applyBorder="1"' : ''}${alignment ? ' applyAlignment="1"' : ''}`;
    return place(formats, `<xf numFmtId="${format}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${applied}${alignment ? `>${alignment}</xf>` : '/>'}`);
  };
  // The plain look comes first: Excel uses number 0 for every cell that names no look.
  style({});
  const group = (name: string, list: string[]): string => `<${name} count="${list.length}">${list.join('')}</${name}>`;
  return {
    style,
    xml: () =>
      `${START}<styleSheet xmlns="${MAIN}">${group('fonts', fonts)}${group('fills', fills)}${group('borders', borders)}` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>${group('cellXfs', formats)}` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
  };
}

/** The looks the sheets share, by what they are for. */
function looksOf(style: (look: Look) => number) {
  const swatch = {} as Record<Colour, number>;
  for (const key of Object.keys(SWATCHES)) {
    const colour = Number(key) as Colour;
    const [fill, ink] = SWATCHES[colour];
    swatch[colour] = style({ fill, ink, border: true, across: 'center', down: 'center', wrap: true });
  }
  return {
    plain: style({}),
    title: style({ bold: true, size: 14 }),
    section: style({ bold: true, size: 12 }),
    sub: style({ ink: MUTED }),
    head: style({ bold: true, fill: HEAD_FILL, border: true, across: 'center', down: 'center', wrap: true }),
    headLeft: style({ bold: true, fill: HEAD_FILL, border: true, down: 'center', wrap: true }),
    /** A line under the day names that is not a heading: a person's working hours for the day. */
    under: style({ fill: HEAD_FILL, border: true, across: 'center', down: 'center', wrap: true }),
    time: style({ ink: MUTED, border: true, across: 'right', down: 'center' }),
    /** An empty cell of a grid: nothing but its border. */
    cell: style({ border: true }),
    label: style({ border: true, down: 'center', wrap: true }),
    /** A number shown as it is: 0.8, 79, 78.5. */
    number: style({ border: true, down: 'center' }),
    numberSum: style({ border: true, bold: true, down: 'center' }),
    count: style({ border: true, format: 1, down: 'center' }),
    hours: style({ border: true, format: 2, down: 'center' }),
    countSum: style({ border: true, format: 1, bold: true, down: 'center' }),
    hoursSum: style({ border: true, format: 2, bold: true, down: 'center' }),
    /** A room with someone in it. */
    who: style({ fill: WHO_FILL, border: true, across: 'center', down: 'center', wrap: true }),
    /** A room with a clash in it. The cell also says so in words. */
    clash: style({ bold: true, fill: SWATCHES[8][0], ink: SWATCHES[8][1], border: true, across: 'center', down: 'center', wrap: true }),
    /** A cell of the data sheet: kept as text, whatever it looks like. */
    data: style({ format: 49, down: 'top' }),
    swatch,
  };
}
type Looks = ReturnType<typeof looksOf>;

// ---------------------------------------------------------------------------------------------
// One sheet
// ---------------------------------------------------------------------------------------------

/** What a cell holds: words, a number, a formula with the number or the words it gives, or nothing but its look. */
type Value = string | number | { formula: string; value: number } | { formula: string; text: string } | null;

interface Sheet {
  name: string;
  hidden: boolean;
  put(row: number, column: number, value: Value, look: number): void;
  /** Makes one cell of a block of cells. Every cell of the block must have been put, so the border shows all round. */
  merge(row: number, column: number, lastRow: number, lastColumn: number): void;
  width(column: number, characters: number): void;
  height(row: number, points: number): void;
  xml(inFront: boolean): string;
}

function makeSheet(name: string, options: { frozenColumns?: number; frozenRows?: number; hidden?: boolean; gridLines?: boolean } = {}): Sheet {
  const rows = new Map<number, Map<number, string>>();
  const heights = new Map<number, number>();
  const widths = new Map<number, number>();
  const merges: string[] = [];
  let lastRow = 1;
  let lastColumn = 1;

  const pane = (): string => {
    const columns = options.frozenColumns ?? 0;
    const frozenRows = options.frozenRows ?? 0;
    if (columns === 0 && frozenRows === 0) return '';
    const corner = `${letters(columns + 1)}${frozenRows + 1}`;
    const active = columns > 0 && frozenRows > 0 ? 'bottomRight' : columns > 0 ? 'topRight' : 'bottomLeft';
    const others = columns > 0 && frozenRows > 0 ? '<selection pane="topRight"/><selection pane="bottomLeft"/>' : '';
    return `<pane${columns > 0 ? ` xSplit="${columns}"` : ''}${frozenRows > 0 ? ` ySplit="${frozenRows}"` : ''} topLeftCell="${corner}" activePane="${active}" state="frozen"/>${others}<selection pane="${active}" activeCell="${corner}" sqref="${corner}"/>`;
  };

  return {
    name,
    hidden: options.hidden ?? false,
    put(row, column, value, look) {
      const ref = `${letters(column)}${row}`;
      let xml: string;
      if (value === null || value === '') xml = `<c r="${ref}" s="${look}"/>`;
      else if (typeof value === 'string') xml = `<c r="${ref}" s="${look}" t="inlineStr"><is><t xml:space="preserve">${inXml(value)}</t></is></c>`;
      else if (typeof value === 'number') xml = `<c r="${ref}" s="${look}"><v>${plainNumber(value)}</v></c>`;
      else if ('text' in value) xml = `<c r="${ref}" s="${look}" t="str"><f>${inXml(value.formula)}</f><v>${inXml(value.text)}</v></c>`;
      else xml = `<c r="${ref}" s="${look}"><f>${inXml(value.formula)}</f><v>${plainNumber(value.value)}</v></c>`;
      let cells = rows.get(row);
      if (!cells) rows.set(row, (cells = new Map()));
      cells.set(column, xml);
      lastRow = Math.max(lastRow, row);
      lastColumn = Math.max(lastColumn, column);
    },
    merge(row, column, endRow, endColumn) {
      if (endRow > row || endColumn > column) merges.push(`${letters(column)}${row}:${letters(endColumn)}${endRow}`);
    },
    width(column, characters) {
      widths.set(column, characters);
    },
    height(row, points) {
      heights.set(row, points);
    },
    xml(inFront) {
      // The file format wants these parts in exactly this order.
      const out: string[] = [`${START}<worksheet xmlns="${MAIN}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="${lastColumn === 1 && lastRow === 1 ? 'A1' : `A1:${letters(lastColumn)}${lastRow}`}"/>`];
      out.push(`<sheetViews><sheetView${options.gridLines ? '' : ' showGridLines="0"'}${inFront ? ' tabSelected="1"' : ''} workbookViewId="0">${pane()}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>`);
      if (widths.size > 0) {
        out.push('<cols>');
        for (const [column, characters] of [...widths].sort((a, b) => a[0] - b[0])) out.push(`<col min="${column}" max="${column}" width="${characters}" customWidth="1"/>`);
        out.push('</cols>');
      }
      out.push('<sheetData>');
      for (const [row, cells] of [...rows].sort((a, b) => a[0] - b[0])) {
        const height = heights.get(row);
        out.push(height === undefined ? `<row r="${row}">` : `<row r="${row}" ht="${height}" customHeight="1">`);
        for (const [, xml] of [...cells].sort((a, b) => a[0] - b[0])) out.push(xml);
        out.push('</row>');
      }
      out.push('</sheetData>');
      if (merges.length > 0) out.push(`<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`);
      out.push('<pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>');
      return out.join('');
    },
  };
}

const hours = (minutes: number): number => minutes / 60;
const total = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0);
const joined = (...parts: string[]): string => parts.filter((part) => part !== '').join(', ');

/**
 * The times that start a row, from the first minute to the last: a line every `step` minutes
 * counted from the start of the day, and one more wherever something starts or ends between
 * lines, so that everything drawn covers whole rows. The last time only ends the last row.
 */
function rowTimes(dayStart: number, dayEnd: number, step: number, marks: readonly number[]): number[] {
  let first = dayStart;
  let last = dayEnd;
  for (const mark of marks) {
    first = Math.min(first, mark);
    last = Math.max(last, mark);
  }
  const times = new Set<number>([first, last, ...marks]);
  for (let time = dayStart; time < last; time += step) times.add(time);
  for (let time = dayStart - step; time > first; time -= step) times.add(time);
  return [...times].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------
// The sheets
// ---------------------------------------------------------------------------------------------

/**
 * One person's week, laid out like a paper week, with the tallies under it. When working hours
 * are entered, a line under the day names gives them for each day, or "Day off". Time with a
 * provider is drawn like any other block. A provider's sheet ends with the support staff who have
 * time with them. A support person's sheet has no slots: it gives their hours with each provider.
 */
function personSheet(s: Schedule, person: Person, name: string, look: Looks): Sheet {
  const hasHours = person.work.length > 0;
  const support = person.kind === 'support';
  const headRows = hasHours ? 5 : 4;
  const sheet = makeSheet(name, { frozenColumns: 1, frozenRows: headRows });
  const days = s.days;
  const weekColumn = days.length + 2;
  const firstDay = letters(2);
  const lastDay = letters(days.length + 1);
  const department = departmentOf(s, person.departmentId);

  sheet.put(1, 1, person.name, look.title);
  sheet.height(1, 22);
  const about = joined(person.role, department?.name ?? '');
  sheet.put(2, 1, about === '' ? `Lines every ${person.step} minutes` : `${about}, lines every ${person.step} minutes`, look.sub);
  sheet.put(3, 1, joined(s.name, s.clinic), look.sub);
  sheet.width(1, 30);
  for (let at = 0; at < days.length; at++) sheet.width(at + 2, 20);
  sheet.width(weekColumn, 12);

  // The grid: times down the side, days across.
  const week = days.map((day) => blocksOn(s, person.id, day));
  const times = rowTimes(s.dayStart, s.dayEnd, person.step, week.flatMap((blocks) => blocks.flatMap((block) => [block.start, endOf(block)])));
  const firstRow = headRows + 1;
  const rowAt = new Map(times.map((time, at) => [time, firstRow + at]));
  const gridRows = times.length - 1;
  sheet.put(4, 1, 'Time', look.head);
  for (const [at, day] of days.entries()) sheet.put(4, at + 2, dayName(day), look.head);
  if (hasHours) {
    const texts = days.map((day) => workText(s, person.id, day));
    sheet.put(5, 1, 'Working hours', look.head);
    for (const [at, text] of texts.entries()) sheet.put(5, at + 2, text, look.under);
    // A split day needs two lines.
    if (texts.some((text) => text.length > 20)) sheet.height(5, 30);
  }
  for (let at = 0; at < gridRows; at++) {
    sheet.put(firstRow + at, 1, clock(times[at] ?? 0), look.time);
    for (let column = 2; column <= days.length + 1; column++) sheet.put(firstRow + at, column, null, look.cell);
  }
  for (const [at, blocks] of week.entries()) {
    for (const block of blocks) {
      const facts = factsOf(s, block);
      const from = rowAt.get(block.start) ?? firstRow;
      const to = (rowAt.get(endOf(block)) ?? from + 1) - 1;
      for (let row = from; row <= to; row++) sheet.put(row, at + 2, row === from ? joined(facts.name, facts.placeShort) : null, look.swatch[facts.colour]);
      sheet.merge(from, at + 2, to, at + 2);
    }
  }

  // The tallies: a column for each day and the week's sum.
  const tally = tallyPerson(s, person.id);
  if (!tally) return sheet;
  let row = firstRow + gridRows + 1;
  const label = (words: string): void => {
    sheet.put(row, 1, words, look.label);
    if (words.length > 34) sheet.height(row, 30);
  };
  sheet.put(row, 1, 'This week', look.headLeft);
  for (const [at, day] of days.entries()) sheet.put(row, at + 2, dayName(day), look.head);
  sheet.put(row, weekColumn, 'Week', look.head);
  // The week's cell is a real sum. The number written beside the formula is worked out from whole minutes, so it is exact.
  const sumOfDays = (weekValue: number, sumLook: number): void => {
    sheet.put(row, weekColumn, days.length > 0 ? { formula: `SUM(${firstDay}${row}:${lastDay}${row})`, value: weekValue } : weekValue, sumLook);
  };
  const counts = (words: string, pick: (counts: Counts) => number): number => {
    row++;
    label(words);
    for (const [at, day] of tally.days.entries()) sheet.put(row, at + 2, pick(day), look.count);
    sumOfDays(pick(tally.week), look.countSum);
    return row;
  };
  const hourLine = (words: string, pick: (counts: Counts) => number): number => {
    row++;
    label(words);
    for (const [at, day] of tally.days.entries()) sheet.put(row, at + 2, hours(pick(day)), look.hours);
    sumOfDays(hours(pick(tally.week)), look.hoursSum);
    return row;
  };
  /** A line of hours whose days are given as minutes, with the week's sum. */
  const minuteLine = (words: string, perDay: readonly number[], week: number): void => {
    row++;
    label(words);
    for (let at = 0; at < days.length; at++) sheet.put(row, at + 2, hours(perDay[at] ?? 0), look.hours);
    sumOfDays(hours(week), look.hoursSum);
  };
  // A support person's sheet shows appointments and patient care only when they have some (a nurse's visits, say).
  const showCare = !support || tally.week.appointments > 0;
  if (showCare) counts('Appointments', (day) => day.appointments);
  // The slots row is written further down, once the row that holds the slots in an hour is known. Support staff have no slots.
  let slotsRow = 0;
  if (!support) {
    row++;
    slotsRow = row;
  }
  const careRow = showCare ? hourLine('Patient care hours', (day) => day.careMinutes) : 0;
  // Time with providers is paid time. On a support person's sheet it has a line to itself, and the other paid hours are what is left.
  const withRow = support ? hourLine('Hours with providers', (day) => day.withMinutes) : 0;
  const otherRow = hourLine('Other paid hours', (day) => day.otherPaidMinutes - (support ? day.withMinutes : 0));
  row++;
  const paidRow = row;
  label('Paid hours');
  const paidParts = [careRow, withRow, otherRow].filter((part) => part > 0);
  for (const [at, day] of tally.days.entries()) sheet.put(row, at + 2, { formula: paidParts.map((part) => `${letters(at + 2)}${part}`).join('+'), value: hours(day.paidMinutes) }, look.hours);
  sumOfDays(hours(tally.week.paidMinutes), look.hoursSum);
  hourLine('Unpaid hours', (day) => day.unpaidMinutes);
  if (showCare) {
    counts('Appointments on site', (day) => day.onSite);
    counts('Appointments remote', (day) => day.remote);
    if (tally.week.noPlace > 0) counts('Appointments with no place set', (day) => day.noPlace);
  }
  if (hasHours) {
    minuteLine('Hours at work', tally.days.map((day) => day.workMinutes ?? 0), tally.workMinutes ?? 0);
    minuteLine('Open hours at work', tally.days.map((day) => day.openMinutes ?? 0), tally.openMinutes ?? 0);
  }

  // The hours: what the contract allows against what is on the week. The target is worked out, never typed.
  const standards = standardsOf(s, person.id);
  const capacity = capacityHours(s, person.id);
  const weekLetter = letters(weekColumn);
  row += 2;
  sheet.put(row, 1, 'Hours a week', look.headLeft);
  sheet.put(row, 2, 'Allowed', look.head);
  sheet.put(row, 3, 'On the week', look.head);
  row++;
  const contractRow = row;
  label('Contract hours');
  sheet.put(row, 2, hours(tally.contractMinutes), look.hours);
  sheet.put(row, 3, { formula: `${weekLetter}${paidRow}`, value: hours(tally.week.paidMinutes) }, look.hours);
  /** A block under the tallies: a name down the side, hours for each day, the week's sum. */
  const hoursBlock = (heading: string, lines: readonly { name: string; byDay: readonly number[]; minutes: number }[]): void => {
    row += 2;
    sheet.put(row, 1, heading, look.headLeft);
    for (const [at, day] of days.entries()) sheet.put(row, at + 2, dayName(day), look.head);
    sheet.put(row, weekColumn, 'Week', look.head);
    for (const line of lines) minuteLine(line.name, line.byDay, line.minutes);
  };
  if (support) {
    // No clinical factor, no target and no slots: a support person's week is their paid hours against the contract, and their hours with each provider.
    if (tally.withProviders.length > 0) hoursBlock('Hours with each provider', tally.withProviders);
    return sheet;
  }
  row++;
  const factorRow = row;
  label('Clinical factor');
  sheet.put(row, 2, standards.careFactor, look.number);
  sheet.put(row, 3, null, look.cell);
  for (const setAside of tally.setAside) {
    row++;
    label(`Set aside for ${setAside.name}`);
    sheet.put(row, 2, hours(setAside.allowedMinutes), look.hours);
    sheet.put(row, 3, hours(setAside.scheduledMinutes), look.hours);
  }
  const setAsideRows = tally.setAside.length;
  row++;
  const targetRow = row;
  label('Patient care target');
  const share = `B${contractRow}*B${factorRow}`;
  const targetFormula = setAsideRows > 0 ? `MAX(0,${share}-SUM(B${factorRow + 1}:B${factorRow + setAsideRows}))` : share;
  sheet.put(row, 2, { formula: targetFormula, value: capacity }, look.hoursSum);
  sheet.put(row, 3, { formula: `${weekLetter}${careRow}`, value: hours(tally.week.careMinutes) }, look.hoursSum);
  row++;
  label('Patient care hours short');
  sheet.put(row, 2, { formula: `MAX(0,B${targetRow}-C${targetRow})`, value: Math.max(0, capacity - hours(tally.week.careMinutes)) }, look.hours);
  sheet.put(row, 3, null, look.cell);

  // The slots: the same target and week counted in standard slots.
  row += 2;
  sheet.put(row, 1, 'Slots a week', look.headLeft);
  for (const [at, words] of ['In an hour', 'Target', 'Actual', 'Variance'].entries()) sheet.put(row, at + 2, words, look.head);
  row++;
  label('Slots against target');
  sheet.put(row, 2, standards.slotsPerHour, look.number);
  sheet.put(row, 3, { formula: `ROUND(B${targetRow}*B${row},0)`, value: tally.slots.target }, look.numberSum);
  sheet.put(row, 4, { formula: `${weekLetter}${slotsRow}`, value: tally.slots.actual }, look.numberSum);
  sheet.put(row, 5, { formula: `ROUND(D${row}-C${row},1)`, value: tally.slots.variance }, look.numberSum);

  // Each day's patient care in slots, and the week's, from the hours above and the slots in an hour.
  sheet.put(slotsRow, 1, 'Slots', look.label);
  for (const [at, day] of tally.days.entries()) sheet.put(slotsRow, at + 2, { formula: `ROUND(${letters(at + 2)}${careRow}*$B$${row},1)`, value: day.slots }, look.number);
  sheet.put(slotsRow, weekColumn, { formula: `ROUND(${weekLetter}${careRow}*$B$${row},1)`, value: tally.slots.actual }, look.numberSum);

  // The support staff who have time with this provider, and the hours.
  const team = teamHours(s, person.id);
  if (team.length > 0) hoursBlock('Support staff with this provider', team.map((line) => ({ name: joined(line.name, line.role), byDay: line.byDay, minutes: line.minutes })));
  return sheet;
}

/** The row of the Overview that holds the tolerance. The status formulas point at its second cell. */
const TOLERANCE_ROW = 3;

/**
 * The roster of a slot tracker, then everyone's week at a glance. For each person: whether they
 * are a provider or support staff, contract hours, working hours in the week, clinical factor,
 * set-aside hours, capacity hours, slots in an hour, target slots, actual slots, variance and
 * status. Capacity, target, variance and status are real formulas, and the status reads the
 * tolerance from its own labelled cell, so the sheet stays live when a number is changed in
 * Excel. A support person's row has their kind and hours, and its slot cells are empty: no
 * formula is written there. The sums at the foot count providers only. To the right, a morning
 * and an afternoon for each day.
 */
function overviewSheet(s: Schedule, look: Looks): Sheet {
  const sheet = makeSheet('Overview', { frozenColumns: 1, frozenRows: 5 });
  const days = s.days;
  sheet.put(1, 1, s.name === '' ? 'Schedule' : s.name, look.title);
  sheet.height(1, 22);
  if (s.clinic !== '') sheet.put(2, 1, s.clinic, look.sub);
  sheet.put(TOLERANCE_ROW, 1, 'Tolerance, in slots', look.label);
  sheet.put(TOLERANCE_ROW, 2, s.tolerance, look.number);
  sheet.put(TOLERANCE_ROW, 3, 'A week this many slots over or under its target still counts as on target.', look.sub);

  const tall = (column: number, words: string, width: number): void => {
    sheet.put(4, column, words, column === 1 ? look.headLeft : look.head);
    sheet.put(5, column, null, look.head);
    sheet.merge(4, column, 5, column);
    sheet.width(column, width);
  };
  tall(1, 'Person', 26);
  tall(2, 'Role', 22);
  tall(3, 'Department', 22);
  const [kind, contract, working, factor, setAside, capacity, perHour, target, actual, variance, status, ramping] = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const KINDS = { provider: 'Provider', support: 'Support staff' } as const;
  tall(kind, 'Kind', 14);
  tall(contract, 'Contract hours', 11);
  tall(working, 'Working hours', 11);
  tall(factor, 'Clinical factor', 11);
  tall(setAside, 'Set-aside hours', 11);
  tall(capacity, 'Capacity hours', 11);
  tall(perHour, 'Slots in an hour', 11);
  tall(target, 'Target slots', 11);
  tall(actual, 'Actual slots', 11);
  tall(variance, 'Variance', 11);
  tall(status, 'Status', 16);
  tall(ramping, 'Ramping', 11);
  const firstDay = ramping + 1;
  for (const [at, day] of days.entries()) {
    const column = firstDay + at * 2;
    sheet.put(4, column, dayName(day), look.head);
    sheet.put(4, column + 1, null, look.head);
    sheet.merge(4, column, 4, column + 1);
    sheet.put(5, column, 'Morning', look.head);
    sheet.put(5, column + 1, 'Afternoon', look.head);
    sheet.width(column, 24);
    sheet.width(column + 1, 24);
  }

  const people = overview(s);
  const cell = (column: number, row: number): string => `${letters(column)}${row}`;
  const said = (words: string): string => `"${words}"`;
  let row = 5;
  for (const person of people) {
    row++;
    sheet.put(row, 1, person.name, look.label);
    sheet.put(row, 2, person.role, look.label);
    sheet.put(row, 3, person.departmentName, look.label);
    sheet.put(row, kind, KINDS[person.kind], look.label);
    sheet.put(row, contract, person.contractHours, look.hours);
    // Empty when no working hours are entered.
    sheet.put(row, working, person.workMinutes === null ? null : hours(person.workMinutes), look.hours);
    const halves = (): void => {
      for (const [at, day] of person.days.entries()) {
        for (const [side, half] of [day.morning, day.afternoon].entries()) {
          if (half.kind === 'empty') sheet.put(row, firstDay + at * 2 + side, null, look.cell);
          else sheet.put(row, firstDay + at * 2 + side, half.say, look.swatch[half.colour ?? 12]);
        }
      }
    };
    if (person.kind === 'support') {
      // Support staff have no slot target. The cells are left empty, with no formula in them.
      for (let column = factor; column <= ramping; column++) sheet.put(row, column, null, column === status || column === ramping ? look.label : look.cell);
      halves();
      continue;
    }
    sheet.put(row, factor, person.careFactor, look.number);
    sheet.put(row, setAside, person.setAsideHours, look.hours);
    sheet.put(row, capacity, { formula: `MAX(0,${cell(contract, row)}*${cell(factor, row)}-${cell(setAside, row)})`, value: person.capacityHours }, look.hours);
    sheet.put(row, perHour, person.slotsPerHour, look.number);
    sheet.put(row, target, { formula: `ROUND(${cell(capacity, row)}*${cell(perHour, row)},0)`, value: person.target }, look.number);
    sheet.put(row, actual, person.actual, look.number);
    sheet.put(row, variance, { formula: `ROUND(${cell(actual, row)}-${cell(target, row)},1)`, value: person.variance }, look.number);
    // The same order of questions as the verdict in tally.ts.
    const formula =
      `IF(${cell(ramping, row)}="Yes",${said(VERDICT_NAMES.ramping)},IF(${cell(contract, row)}<=0,${said(VERDICT_NAMES['needs-contract'])},IF(${cell(actual, row)}<=0,${said(VERDICT_NAMES['needs-schedule'])},` +
      `IF(ABS(${cell(variance, row)})<=$B$${TOLERANCE_ROW},${said(VERDICT_NAMES['on-target'])},IF(${cell(variance, row)}>0,${said(VERDICT_NAMES.over)},${said(VERDICT_NAMES.under)})))))`;
    sheet.put(row, status, { formula, text: VERDICT_NAMES[person.verdict] }, look.label);
    sheet.put(row, ramping, person.ramping ? 'Yes' : null, look.label);
    halves();
  }
  const providers = people.filter((person) => person.kind === 'provider');
  if (providers.length > 0) {
    // Each sum counts the rows whose kind is "Provider", so support staff are never part of a slot total. It is
    // written with the number it gives, worked out here so the sheet reads right before Excel recalculates.
    const sums: [number, number, number][] = [
      [contract, total(providers.map((person) => person.contractHours)), look.hoursSum],
      ...(providers.some((person) => person.workMinutes !== null) ? [[working, hours(total(providers.map((person) => person.workMinutes ?? 0))), look.hoursSum] as [number, number, number]] : []),
      [setAside, total(providers.map((person) => person.setAsideHours)), look.hoursSum],
      [capacity, total(providers.map((person) => person.capacityHours)), look.hoursSum],
      [target, total(providers.map((person) => person.target)), look.numberSum],
      [actual, Math.round(total(providers.map((person) => person.actual)) * 10) / 10, look.numberSum],
      [variance, Math.round(total(providers.map((person) => person.variance)) * 10) / 10, look.numberSum],
    ];
    const kinds = `$${letters(kind)}$6:$${letters(kind)}$${row}`;
    sheet.put(row + 1, 1, 'All providers', look.headLeft);
    for (const [column, value, sumLook] of sums) {
      sheet.put(row + 1, column, { formula: `SUMIF(${kinds},"${KINDS.provider}",${letters(column)}6:${letters(column)}${row})`, value: Math.round(value * 1e6) / 1e6 }, sumLook);
    }
  }
  return sheet;
}

/**
 * Care teams: a row for each provider and each support person who has time with them, with the
 * hours on each day and in the week. Only written when the schedule has support staff.
 */
function teamsSheet(s: Schedule, look: Looks): Sheet {
  const sheet = makeSheet(TEAMS_SHEET, { frozenRows: 4 });
  const days = s.days;
  const weekColumn = days.length + 4;
  sheet.put(1, 1, 'Care teams', look.title);
  sheet.height(1, 22);
  sheet.put(2, 1, joined(s.name, s.clinic), look.sub);
  const headings: [string, number][] = [['Provider', 26], ['Support staff', 26], ['Role', 22]];
  for (const [at, [words, width]] of headings.entries()) {
    sheet.put(4, at + 1, words, look.headLeft);
    sheet.width(at + 1, width);
  }
  for (const [at, day] of days.entries()) {
    sheet.put(4, at + 4, dayName(day), look.head);
    sheet.width(at + 4, 12);
  }
  sheet.put(4, weekColumn, 'Week', look.head);
  sheet.width(weekColumn, 12);
  let row = 4;
  for (const provider of s.people) {
    if (provider.kind !== 'provider') continue;
    for (const line of teamHours(s, provider.id)) {
      row++;
      sheet.put(row, 1, provider.name, look.label);
      sheet.put(row, 2, line.name, look.label);
      sheet.put(row, 3, line.role, look.label);
      for (let at = 0; at < days.length; at++) sheet.put(row, at + 4, hours(line.byDay[at] ?? 0), look.hours);
      sheet.put(row, weekColumn, days.length > 0 ? { formula: `SUM(${letters(4)}${row}:${letters(days.length + 3)}${row})`, value: hours(line.minutes) } : hours(line.minutes), look.hoursSum);
    }
  }
  if (row === 4) sheet.put(6, 1, 'Nobody has time with a provider on this schedule yet. Add it to a support person in Design.', look.plain);
  return sheet;
}

/** Each room's hours in use and free through the week, then for each day who is in each room and when. */
function roomsSheet(s: Schedule, look: Looks): Sheet {
  const sheet = makeSheet('Rooms', { frozenColumns: 1 });
  sheet.put(1, 1, 'Rooms', look.title);
  sheet.height(1, 22);
  sheet.put(2, 1, joined(s.name, s.clinic), look.sub);
  sheet.width(1, 30);
  const sites = s.sites.filter((site) => site.rooms.length > 0);
  const roomCount = total(sites.map((site) => site.rooms.length));
  if (roomCount === 0) {
    sheet.put(4, 1, 'No rooms are set up in this schedule.', look.plain);
    return sheet;
  }
  for (let column = 2; column <= Math.max(3, roomCount + 1); column++) sheet.width(column, 22);

  // The week: hours in use and hours free, inside the hours the schedule shows.
  let row = 4;
  sheet.put(row, 1, 'Room', look.headLeft);
  sheet.put(row, 2, 'Hours in use', look.head);
  sheet.put(row, 3, 'Hours free', look.head);
  let used = 0;
  let free = 0;
  for (const site of sites) {
    for (const room of roomHours(s, site.id)) {
      row++;
      sheet.put(row, 1, joined(room.name, site.name), look.label);
      sheet.put(row, 2, hours(room.usedMinutes), look.hours);
      sheet.put(row, 3, hours(room.freeMinutes), look.hours);
      used += room.usedMinutes;
      free += room.freeMinutes;
    }
  }
  row++;
  sheet.put(row, 1, 'All rooms', look.headLeft);
  sheet.put(row, 2, { formula: `SUM(B5:B${row - 1})`, value: hours(used) }, look.hoursSum);
  sheet.put(row, 3, { formula: `SUM(C5:C${row - 1})`, value: hours(free) }, look.hoursSum);

  // Each day: time down the side, rooms across, the people in each.
  const rank = new Map(s.people.map((person, at) => [person.id, at]));
  const nameOf = new Map(s.people.map((person) => [person.id, person.name]));
  for (const day of s.days) {
    row += 2;
    sheet.put(row, 1, dayName(day), look.section);
    row++;
    sheet.put(row, 1, null, look.head);
    sheet.put(row + 1, 1, 'Time', look.head);
    const uses = sites.flatMap((site) => roomUse(s, day, site.id));
    let column = 2;
    for (const site of sites) {
      for (const [at, room] of site.rooms.entries()) {
        sheet.put(row, column + at, at === 0 ? site.name : null, look.head);
        sheet.put(row + 1, column + at, room.name, look.head);
      }
      sheet.merge(row, column, row, column + site.rooms.length - 1);
      column += site.rooms.length;
    }
    row++;
    const times = rowTimes(s.dayStart, s.dayEnd, 60, uses.flatMap((use) => [...use.stays, ...use.clashes].flatMap((stretch) => [stretch.from, stretch.to])));
    const firstRow = row + 1;
    const rowAt = new Map(times.map((time, at) => [time, firstRow + at]));
    for (let at = 0; at + 1 < times.length; at++) {
      sheet.put(firstRow + at, 1, clock(times[at] ?? 0), look.time);
      for (let c = 2; c <= roomCount + 1; c++) sheet.put(firstRow + at, c, null, look.cell);
    }
    for (const [at, use] of uses.entries()) {
      // Cut the room's day wherever someone comes or goes or a clash starts or ends, then join neighbours that read the same.
      const marks = [...new Set([...use.stays, ...use.clashes].flatMap((stretch) => [stretch.from, stretch.to]))].sort((a, b) => a - b);
      let run: { from: number; to: number; words: string; clash: boolean } | undefined;
      const write = (): void => {
        if (!run) return;
        const from = rowAt.get(run.from) ?? firstRow;
        const to = (rowAt.get(run.to) ?? from + 1) - 1;
        for (let r = from; r <= to; r++) sheet.put(r, at + 2, r === from ? run.words : null, run.clash ? look.clash : look.who);
        sheet.merge(from, at + 2, to, at + 2);
        run = undefined;
      };
      for (let mark = 0; mark + 1 < marks.length; mark++) {
        const from = marks[mark] ?? 0;
        const to = marks[mark + 1] ?? 0;
        const here = use.stays.filter((stay) => stay.from <= from && to <= stay.to).sort((a, b) => (rank.get(a.personId) ?? 0) - (rank.get(b.personId) ?? 0));
        if (here.length === 0) {
          write();
          continue;
        }
        const clash = use.clashes.some((stretch) => stretch.from <= from && to <= stretch.to);
        const words = `${clash ? 'Clash: ' : ''}${here.map((stay) => nameOf.get(stay.personId) ?? '').join(', ')}`;
        if (run && run.to === from && run.words === words && run.clash === clash) run.to = to;
        else {
          write();
          run = { from, to, words, clash };
        }
      }
      write();
    }
    row = firstRow + times.length - 2;
  }
  return sheet;
}

/** The visit types and the other kinds of time, each with its colour. */
function kindsSheet(s: Schedule, look: Looks): Sheet {
  const sheet = makeSheet('Kinds of time');
  sheet.put(1, 1, 'Kinds of time', look.title);
  sheet.height(1, 22);
  sheet.put(2, 1, joined(s.name, s.clinic), look.sub);
  const headings: [string, number][] = [['Department', 24], ['Name', 26], ['Code', 10], ['Minutes', 10], ['Colour', 12], ['Counts as', 16], ['Appointments this week', 14]];
  for (const [at, [words, width]] of headings.entries()) {
    sheet.put(4, at + 1, words, at < 2 ? look.headLeft : look.head);
    sheet.width(at + 1, width);
  }
  let row = 4;
  for (const type of tallyClinic(s).types) {
    row++;
    sheet.put(row, 1, type.departmentName, look.label);
    sheet.put(row, 2, type.name, look.swatch[type.colour]);
    sheet.put(row, 3, type.code, look.label);
    sheet.put(row, 4, type.minutes, look.count);
    sheet.put(row, 5, COLOUR_NAMES[type.colour], look.label);
    sheet.put(row, 6, 'Patient care', look.label);
    sheet.put(row, 7, type.week, look.count);
  }
  for (const activity of s.activities) {
    row++;
    sheet.put(row, 1, 'Other time', look.label);
    sheet.put(row, 2, activity.name, look.swatch[activity.colour]);
    sheet.put(row, 3, null, look.label);
    sheet.put(row, 4, null, look.count);
    sheet.put(row, 5, COLOUR_NAMES[activity.colour], look.label);
    sheet.put(row, 6, activity.paid ? 'Paid time' : 'Unpaid time', look.label);
    sheet.put(row, 7, null, look.count);
  }
  if (supportStaffIn(s).length > 0) {
    // Time a support person spends with a provider. It has no swatch of its own: each provider has one.
    row++;
    sheet.put(row, 1, 'Other time', look.label);
    sheet.put(row, 2, 'Time with a provider', look.label);
    sheet.put(row, 3, null, look.label);
    sheet.put(row, 4, null, look.count);
    sheet.put(row, 5, 'One for each provider', look.label);
    sheet.put(row, 6, 'Paid time', look.label);
    sheet.put(row, 7, null, look.count);
  }
  return sheet;
}

/**
 * The schedule as text for the hidden sheet. Every character outside plain keyboard letters is
 * written as a \u code, and so are the marks <, > and & and an underscore before an x, so the
 * text needs no special care from XML, from Excel, or from any program that saves the workbook again.
 */
function dataText(s: Schedule): string {
  return JSON.stringify(s).replace(/[^\x20-\x7e]|[<>&]|_(?=x)/g, (mark) => `\\u${mark.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** The hidden sheet: a line saying what it is, a line of facts about the text, then the text in pieces. */
function dataSheet(s: Schedule, look: Looks): Sheet {
  const sheet = makeSheet(DATA_SHEET, { hidden: true, gridLines: true });
  const text = dataText(s);
  const pieces: string[] = [];
  for (let at = 0; at < text.length; ) {
    let end = Math.min(text.length, at + PIECE);
    // A piece never starts or ends with a space, so a program that trims cells cannot change it.
    while (end < text.length && end > at + 1 && (text.charAt(end - 1) === ' ' || text.charAt(end) === ' ')) end--;
    pieces.push(text.slice(at, end));
    at = end;
  }
  sheet.width(1, 120);
  sheet.put(1, 1, DATA_NOTE, look.data);
  sheet.put(2, 1, 'clinx-schedule', look.data);
  sheet.put(2, 2, VERSION, look.plain);
  sheet.put(2, 3, pieces.length, look.plain);
  sheet.put(2, 4, text.length, look.plain);
  for (const [at, piece] of pieces.entries()) sheet.put(3 + at, 1, piece, look.data);
  return sheet;
}

/**
 * Writes a schedule as an .xlsx workbook and gives back its bytes, ready to save as a file.
 * The schedule is not changed, and the same schedule always gives the same bytes.
 *
 * Sheets, in order: "Overview", the roster with live formulas for capacity, target, variance and
 * status; one for each person, named after them; "Care teams" when the schedule has support
 * staff; "Rooms"; "Kinds of time"; and "ClinX data", hidden, which is the only sheet
 * `fromWorkbook` reads.
 */
export async function toWorkbook(s: Schedule): Promise<Uint8Array> {
  const styles = makeStyles();
  const look = looksOf(styles.style);
  const names = sheetNames(s.people);
  const sheets = [
    overviewSheet(s, look),
    ...s.people.map((person, at) => personSheet(s, person, names[at] ?? 'Person', look)),
    ...(supportStaffIn(s).length > 0 ? [teamsSheet(s, look)] : []),
    roomsSheet(s, look),
    kindsSheet(s, look),
    dataSheet(s, look),
  ];
  const numbered = sheets.map((sheet, at) => ({ sheet, n: at + 1 }));
  return writeZip([
    {
      name: '[Content_Types].xml',
      text:
        `${START}<Types xmlns="${CONTENT_TYPES}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="${SHEET_KIND}.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="${SHEET_KIND}.styles+xml"/>` +
        `${numbered.map(({ n }) => `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="${SHEET_KIND}.worksheet+xml"/>`).join('')}</Types>`,
    },
    { name: '_rels/.rels', text: `${START}<Relationships xmlns="${PACKAGE_RELATIONSHIPS}"><Relationship Id="rId1" Type="${RELATIONSHIPS}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    {
      name: 'xl/workbook.xml',
      text:
        `${START}<workbook xmlns="${MAIN}" xmlns:r="${RELATIONSHIPS}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>` +
        `${numbered.map(({ sheet, n }) => `<sheet name="${inAttribute(sheet.name)}" sheetId="${n}"${sheet.hidden ? ' state="hidden"' : ''} r:id="rId${n}"/>`).join('')}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      text:
        `${START}<Relationships xmlns="${PACKAGE_RELATIONSHIPS}">${numbered.map(({ n }) => `<Relationship Id="rId${n}" Type="${RELATIONSHIPS}/worksheet" Target="worksheets/sheet${n}.xml"/>`).join('')}` +
        `<Relationship Id="rId${sheets.length + 1}" Type="${RELATIONSHIPS}/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: 'xl/styles.xml', text: styles.xml() },
    ...numbered.map(({ sheet, n }) => ({ name: `xl/worksheets/sheet${n}.xml`, text: sheet.xml(n === 1) })),
  ]);
}

// ---------------------------------------------------------------------------------------------
// Opening a workbook
// ---------------------------------------------------------------------------------------------

/** A reason a file cannot be opened. It carries the sentence for the person. */
class Stop extends Error {}

function stop(problem: string): never {
  throw new Stop(problem);
}

// A tag's name may carry a prefix, as in <x:c>: some programs write every tag that way.
const PREFIX = '(?:[\\w.-]+:)?';
/** The inside of a tag's opening, when it is not one that closes itself. */
const OPEN = '(?:\\s[^>]*[^>/])?';
const within = (tag: string): RegExp => new RegExp(`<${PREFIX}${tag}${OPEN}>([\\s\\S]*?)</${PREFIX}${tag}>`, 'g');

/** The value of an attribute in a tag's opening, entities read. */
function attribute(opening: string, name: string): string | undefined {
  const found = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(opening);
  return found ? decoded(found[1] ?? found[2] ?? '') : undefined;
}

/** Text as it was before it was written into XML: entities read, then Excel's "_x0041_" codes. */
function decoded(text: string): string {
  return text
    .replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos);/g, (whole, name: string) => {
      if (name === 'amp') return '&';
      if (name === 'lt') return '<';
      if (name === 'gt') return '>';
      if (name === 'quot') return '"';
      if (name === 'apos') return "'";
      const code = name.startsWith('#x') ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    })
    .replace(/_x([0-9a-fA-F]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** The words of a cell or of one shared text: every run together, without the reading aids some languages add. */
function wordsIn(xml: string): string {
  const main = xml.replace(within('rPh'), '');
  let out = '';
  for (const found of main.matchAll(within('t'))) out += found[1] ?? '';
  return decoded(out);
}

/** One part unpacked, stopping as soon as it grows past what a schedule could be. */
async function unpacked(part: ZipPart, most: number): Promise<Uint8Array> {
  if (part.method === 0) {
    if (part.packed.length > most) stop(TOO_LARGE);
    return part.packed;
  }
  if (part.method !== 8) stop(NOT_A_WORKBOOK);
  if (part.size > most) stop(TOO_LARGE);
  const reader = new Blob([part.packed as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > most) {
      await reader.cancel().catch(() => undefined);
      stop(TOO_LARGE);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

async function textOf(part: ZipPart): Promise<string> {
  return new TextDecoder().decode(await unpacked(part, MOST_PART));
}

/** The cells of the first four columns of a sheet, by place ("A2"): each with its kind and what is inside its tag. */
function cellsOf(xml: string): Map<string, { kind: string; body: string }> {
  const cells = new Map<string, { kind: string; body: string }>();
  const open = new RegExp(`<${PREFIX}c(\\s[^>]*?)?(/)?>`, 'g');
  const close = new RegExp(`</${PREFIX}c>`, 'g');
  for (let found = open.exec(xml); found; found = open.exec(xml)) {
    if (found[2]) continue;
    close.lastIndex = open.lastIndex;
    const end = close.exec(xml);
    if (!end) break;
    const ref = attribute(found[1] ?? '', 'r') ?? '';
    if (/^[A-D]\d{1,7}$/.test(ref)) cells.set(ref, { kind: attribute(found[1] ?? '', 't') ?? 'n', body: xml.slice(open.lastIndex, end.index) });
    open.lastIndex = close.lastIndex;
  }
  return cells;
}

async function read(input: unknown): Promise<{ schedule: Schedule } | { problem: string }> {
  const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : undefined;
  if (!bytes) stop(NOT_A_WORKBOOK);
  if (bytes.length > MOST_FILE) stop(TOO_LARGE);
  // An .xls file and a workbook locked with a password both start with these eight bytes.
  if ([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((byte, at) => bytes[at] === byte)) stop(OLD_OR_LOCKED);

  let parts: ZipPart[];
  try {
    parts = readZip(bytes);
  } catch {
    stop(NOT_A_WORKBOOK);
  }
  const byName = new Map(parts.map((part) => [part.name.replace(/^\/+/, '').toLowerCase(), part]));
  const book = byName.get('xl/workbook.xml');
  const links = byName.get('xl/_rels/workbook.xml.rels');
  if (!book || !links) stop(NOT_FROM_HERE);

  // Find the data sheet by its name, then the file that holds it.
  let linkId: string | undefined;
  for (const found of (await textOf(book)).matchAll(new RegExp(`<${PREFIX}sheet(\\s[^>]*)>`, 'g'))) {
    if (attribute(found[1] ?? '', 'name') === DATA_SHEET) linkId = attribute(found[1] ?? '', '[\\w.-]+:id');
  }
  if (linkId === undefined) stop(NOT_FROM_HERE);
  let target: string | undefined;
  for (const found of (await textOf(links)).matchAll(new RegExp(`<${PREFIX}Relationship(\\s[^>]*)>`, 'g'))) {
    if (attribute(found[1] ?? '', 'Id') === linkId) target = attribute(found[1] ?? '', 'Target');
  }
  if (target === undefined) stop(NOT_FROM_HERE);
  const path = (target.startsWith('/') ? target.replace(/^\/+/, '') : `xl/${target.replace(/^\.\//, '')}`).toLowerCase();
  const sheet = byName.get(path);
  if (!sheet) stop(NOT_FROM_HERE);

  const cells = cellsOf(await textOf(sheet));
  // Excel keeps every text of a workbook in one shared list once it has saved the file. It is read only if a cell points into it.
  let shared: string[] | undefined;
  const valueOf = async (ref: string): Promise<string | undefined> => {
    const cell = cells.get(ref);
    if (!cell) return undefined;
    if (cell.kind === 'inlineStr') return wordsIn(cell.body);
    const value = decoded(within('v').exec(cell.body)?.[1] ?? '');
    if (cell.kind !== 's') return value;
    if (!shared) {
      const list = byName.get('xl/sharedstrings.xml');
      if (!list) stop(DAMAGED);
      shared = [];
      for (const found of (await textOf(list)).matchAll(new RegExp(`<${PREFIX}si${OPEN}>([\\s\\S]*?)</${PREFIX}si>|<${PREFIX}si(?:\\s[^>]*)?/>`, 'g'))) shared.push(found[1] === undefined ? '' : wordsIn(found[1]));
    }
    return shared[Number(value)] ?? stop(DAMAGED);
  };

  if ((await valueOf('A2')) !== 'clinx-schedule') stop(NOT_FROM_HERE);
  const version = Number(await valueOf('B2'));
  // A newer version may keep the text in another way, so say so before trying to read it.
  if (Number.isInteger(version) && version > VERSION) return validate({ format: 'clinx-schedule', version });
  const count = Number(await valueOf('C2'));
  if (!Number.isInteger(count) || count < 1 || count > 100000) stop(DAMAGED);
  let text = '';
  for (let at = 0; at < count; at++) text += (await valueOf(`A${3 + at}`)) ?? stop(DAMAGED);
  const length = await valueOf('D2');
  if (length !== undefined && Number(length) !== text.length) stop(DAMAGED);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    stop(DAMAGED);
  }
  return validate(value);
}

/**
 * Opens a workbook that `toWorkbook` wrote. Gives back `{ schedule }`, checked by `validate`, or
 * `{ problem }`: one plain sentence saying what is wrong and what to do. It never throws, whatever
 * the bytes are: not a workbook, a workbook from somewhere else, a damaged or enormous data sheet,
 * or a schedule saved by a newer version of the tool.
 *
 * Only the hidden "ClinX data" sheet is read. A change made in Excel to any other sheet is not
 * read back: the page is where a schedule is edited.
 */
export async function fromWorkbook(bytes: Uint8Array): Promise<{ schedule: Schedule } | { problem: string }> {
  try {
    return await read(bytes);
  } catch (error) {
    return { problem: error instanceof Stop ? error.message : DAMAGED };
  }
}
