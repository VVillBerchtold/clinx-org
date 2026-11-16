// Reads the sheets of an .xlsx or .xlsm workbook into the form the rules use (see grid.js).
//
// In plain words: the workbook is opened with the Cleaner Copy reader's own tools (its zip reader
// and its patterns for a workbook's parts), and every cell is noted with what it is stored as.
// Nothing is changed, nothing is written, and this file has no way to make a connection.

import { readZip, text as partText } from '../../cleaner-copy/engine/zip.js';
import { CELLS, FORMULA, HAS_FORMULA, RELATIONSHIPS, VALUE, attr, columnNumber, dateStyles, decodeXml, letters, readStrings, rx, stringText } from '../../cleaner-copy/engine/xml.js';
import { BOOL, DATE, ERROR, FORMAT, KIND, NUM, DIGITS, HASDIGIT, TOKEN, PLAIN, NUMTEXT, ZEROTEXT, DATETEXT, classify } from './classify.js';
import { newGrid, put } from './grid.js';

// Three small helpers copied from the Cleaner Copy workbook reader, which does not give them out.
const basename = (path) => path.slice(path.lastIndexOf('/') + 1);
/** Where a part's link leads, worked out from the part that holds the link. */
function resolve(from, target) {
  if (target.startsWith('/')) return target.slice(1);
  const steps = from.split('/').slice(0, -1);
  for (const step of target.split('/')) step === '..' ? steps.pop() : step !== '.' && steps.push(step);
  return steps.join('/');
}
const relsOf = (path) => `${path.slice(0, path.lastIndexOf('/') + 1)}_rels/${basename(path)}.rels`;

/** The built-in number formats that show an amount or a count. */
const NUMBER_FORMATS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 37, 38, 39, 40, 41, 42, 43, 44, 48]);

/** For each cell style in the workbook, whether it shows an amount or a count (and so is not General, Text or a date). */
function numberStyles(xml, dates) {
  const custom = new Map();
  for (const m of xml.matchAll(rx('<~numFmt\\b([^>]*?)\\/?>'))) custom.set(attr(m[1], 'numFmtId'), decodeXml(attr(m[1], 'formatCode') ?? ''));
  const block = rx('<~cellXfs\\b[^>]*>([\\s\\S]*?)<\\/~cellXfs>', '').exec(xml)?.[1] ?? '';
  return [...block.matchAll(rx('<~xf\\b([^>]*?)\\/?>'))].map((m, at) => {
    if (dates[at]) return false;
    const id = attr(m[1], 'numFmtId') ?? '0';
    const code = custom.get(id);
    return code === undefined ? NUMBER_FORMATS.has(Number(id)) : /[0#]/.test(code.replace(/"[^"]*"/g, ''));
  });
}

const SUMS = /^\s*=?\s*(?:SUM|SUBTOTAL|AGGREGATE)\s*\(/i;
/** True when a formula adds up cells above it in its own column: =SUM(D2:D40) written in D41. */
function addsUpOwnColumn(formula, column, row) {
  if (!SUMS.test(formula)) return false;
  for (const m of formula.matchAll(/\$?([A-Z]{1,3})\$?(\d+):\$?([A-Z]{1,3})\$?(\d+)/g)) {
    if (m[1] === column && m[3] === column && Number(m[4]) < row && Number(m[4]) > Number(m[2])) return true;
  }
  return false;
}

const TEXT_KINDS = new Set([PLAIN, NUMTEXT, ZEROTEXT, DATETEXT]);

/** Every sheet of a workbook, in the workbook's order. */
export async function readWorkbook(bytes) {
  const byName = new Map(readZip(bytes).map((part) => [part.name, part]));
  const read = async (name) => (byName.has(name) ? partText(byName.get(name)) : undefined);

  const strings = readStrings((await read('xl/sharedStrings.xml')) ?? '');
  // What each shared text reads as is worked out once, the first time a cell points at it.
  const stringCls = new Array(strings.length);
  const otherCls = new Map();
  const clsOf = (text) => {
    let cls = otherCls.get(text);
    if (cls === undefined) {
      cls = classify(text, false);
      if (otherCls.size < 200000) otherCls.set(text, cls);
    }
    return cls;
  };
  const stylesXml = (await read('xl/styles.xml')) ?? '';
  const dates = dateStyles(stylesXml);
  const numbers = numberStyles(stylesXml, dates);

  const workbook = (await read('xl/workbook.xml')) ?? '';
  const from1904 = rx('<~workbookPr\\b[^>]*\\sdate1904="(?:1|true)"', '').test(workbook);
  const workbookRels = (await read('xl/_rels/workbook.xml.rels')) ?? '';
  const target = new Map([...workbookRels.matchAll(RELATIONSHIPS)].map((m) => [attr(m[1], 'Id'), attr(m[1], 'Target')]));

  const grids = [];
  for (const m of workbook.matchAll(rx('<~sheet\\b([^>]*?)\\/?>'))) {
    const to = target.get(attr(m[1], 'r:id')) ?? '';
    const path = to.startsWith('/') ? to.slice(1) : `xl/${to}`;
    const grid = newGrid(decodeXml(attr(m[1], 'name') ?? ''));
    grid.hidden = (attr(m[1], 'state') ?? 'visible') !== 'visible';
    grid.from1904 = from1904;
    grids.push(grid);
    const xml = await read(path);
    if (xml === undefined) continue;

    // A sheet laid out as a table says which row holds its headings, and whether its last row is a row of totals.
    for (const rel of ((await read(relsOf(path))) ?? '').matchAll(RELATIONSHIPS)) {
      if (!/\/table$/.test(attr(rel[1], 'Type') ?? '')) continue;
      const tableXml = await read(resolve(path, attr(rel[1], 'Target') ?? ''));
      if (tableXml === undefined) continue;
      const root = rx('<~table\\b([^>]*)>', '').exec(tableXml)?.[1] ?? '';
      const ref = /[A-Z]+(\d+):[A-Z]+(\d+)/.exec(attr(root, 'ref') ?? '');
      if (!ref) continue;
      if ((attr(root, 'headerRowCount') ?? '1') !== '0') grid.tableRows.add(Number(ref[1]));
      if (Number(attr(root, 'totalsRowCount') ?? 0) > 0) grid.totalsRows.add(Number(ref[2]));
    }

    for (const merge of xml.matchAll(rx('<~mergeCell\\b([^>]*?)\\/?>'))) {
      const ref = attr(merge[1], 'ref') ?? '';
      const ends = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(ref);
      if (ends) grid.merges.push({ ref, top: Number(ends[2]), bottom: Number(ends[4] ?? ends[2]), left: columnNumber(ends[1]), right: columnNumber(ends[3] ?? ends[1]) });
    }

    // A formula filled across a row is written once and pointed at by the cells beside it.
    const sharedSums = new Map();
    let row = 0;
    let column = 0;
    for (const cell of xml.matchAll(CELLS)) {
      const cellAttrs = cell[2];
      if (cellAttrs === undefined) {
        row = Number(attr(cell[1], 'r') ?? row + 1);
        column = 0;
        continue;
      }
      const ref = attr(cellAttrs, 'r');
      column = ref ? columnNumber(ref.replace(/\d+/g, '')) : column + 1;
      if (ref) row = Number(ref.replace(/\D+/g, '')) || row;
      const inner = cell[3];
      if (inner === undefined) continue;

      if (HAS_FORMULA.test(inner)) {
        const written = FORMULA.exec(inner);
        let adds = false;
        if (written) {
          adds = addsUpOwnColumn(decodeXml(written[2]), letters(column), row);
          const shared = adds && /\st="shared"/.test(written[1]) ? attr(written[1], 'si') : undefined;
          if (shared !== undefined) sharedSums.set(shared, row);
        } else {
          const shared = rx('<~f\\b([^>]*)\\/>', '').exec(inner)?.[1];
          adds = shared !== undefined && sharedSums.get(attr(shared, 'si')) === row;
        }
        if (adds) grid.sumRows.set(row, (grid.sumRows.get(row) ?? 0) + 1);
      }

      const type = attr(cellAttrs, 't');
      const value = VALUE.exec(inner)?.[2];
      let cls;
      let text;
      if (type === 's') {
        const index = Number(value);
        text = strings[index] ?? '';
        cls = stringCls[index] ??= classify(text, false);
      } else if (type === 'inlineStr' || type === 'str') {
        text = type === 'str' ? decodeXml(value ?? '') : stringText(inner);
        cls = clsOf(text);
      } else if (value === undefined) {
        continue;
      } else if (type === 'b') {
        cls = BOOL;
        text = value === '1' ? 'TRUE' : 'FALSE';
      } else if (type === 'e') {
        cls = ERROR;
        text = decodeXml(value);
      } else if (type === 'd' || dates[Number(attr(cellAttrs, 's') ?? 0)]) {
        cls = DATE;
        text = value;
      } else {
        cls = /^\d+$/.test(value) ? NUM | DIGITS | TOKEN | HASDIGIT : NUM;
        text = value;
      }
      if (cls === 0) continue;
      if (TEXT_KINDS.has(cls & KIND) && numbers[Number(attr(cellAttrs, 's') ?? 0)]) cls |= FORMAT;
      put(grid, row, column, cls, text);
    }
  }
  return grids;
}
