// Says what a sheet of the finished copy looks like: its headings, the first formula of each
// column, and its first few rows. It reads the copy as it was written, never the original, so
// that what a person sees described is what they would be sharing.

import { CELLS, FORMULA, HAS_FORMULA, STRING_ITEMS, VALUE, attr, columnNumber, decodeXml, letters, stringText } from './xml.js';

const ROWS = 3;
const two = (number) => String(number).padStart(2, '0');

/** A workbook's day number as a date a person can read. `from1904` is the older Mac way of counting days. */
export function dayText(written, from1904) {
  const value = Number(written);
  if (!Number.isFinite(value)) return written;
  const day = Math.floor(value);
  const seconds = Math.round((value - day) * 86400);
  const clock = `${two(Math.floor(seconds / 3600) % 24)}:${two(Math.floor(seconds / 60) % 60)}`;
  if (day === 0 && seconds > 0) return clock;
  // The workbook counts 29 February 1900, a day that never was; days before it are one further on.
  const start = from1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, day < 60 ? 31 : 30);
  const date = new Date(start + day * 86400000);
  if (Number.isNaN(date.getTime())) return written;
  const text = `${String(date.getUTCFullYear()).padStart(4, '0')}-${two(date.getUTCMonth() + 1)}-${two(date.getUTCDate())}`;
  return seconds > 0 ? `${text} ${clock}` : text;
}

// A cell named in a formula (B2, $B$2), a piece of text in quotation marks, or a sheet named in apostrophes.
const CELL_NAMES = /"(?:[^"]|"")*"|'(?:[^']|'')*'|(?<![\p{L}\p{N}_.$])(\$?)([A-Z]{1,3})(\$?)(\d{1,7})(?![\p{L}\p{N}_.(])/gu;

/** A formula moved down and across, the way a spreadsheet program fills one formula into many cells. */
function moved(formula, down, across) {
  return formula.replace(CELL_NAMES, (all, fixedColumn, column, fixedRow, row) => {
    if (column === undefined) return all;
    const nextColumn = fixedColumn ? column : letters(columnNumber(column) + across);
    const nextRow = fixedRow ? row : String(Number(row) + down);
    return nextColumn === '' || Number(nextRow) < 1 ? all : `${fixedColumn}${nextColumn}${fixedRow}${nextRow}`;
  });
}

/**
 * Describes one sheet. `xml` is the sheet as the copy holds it; `stringsXml` the copy's list of
 * text; `info` says where the headings are and which columns the report lists.
 */
export function describeSheet(xml, stringsXml, info) {
  const { name, headingRow, headingRows, columns, dates, from1904 } = info;
  const listed = new Map(columns.map((c, at) => [columnNumber(c.column), at]));
  const waiting = new Set(columns.filter((c) => c.formulas > 0).map((c) => columnNumber(c.column)));
  const headings = new Map();
  const firstFormula = new Map();
  const rows = new Map();
  const shared = new Map();
  const wanted = new Set();

  let row = 0;
  let column = 0;
  for (const m of xml.matchAll(CELLS)) {
    const [, rowAttrs, cellAttrs, inner] = m;
    if (cellAttrs === undefined) {
      row = Number(attr(rowAttrs, 'r') ?? row + 1);
      column = 0;
      // Enough has been read once the first rows are whole and every column of formulas has shown one.
      if (rows.size >= ROWS && !rows.has(row) && waiting.size === 0 && row > Math.max(0, ...headingRows)) break;
      continue;
    }
    const ref = attr(cellAttrs, 'r');
    column = ref ? columnNumber(ref.replace(/\d+/g, '')) : column + 1;
    if (ref) row = Number(ref.replace(/\D+/g, '')) || row;
    if (inner === undefined) continue;

    const type = attr(cellAttrs, 't');
    const value = VALUE.exec(inner)?.[2];
    let shown;
    if (HAS_FORMULA.test(inner)) {
      const tag = /<(?:\w+:)?f\b([^>]*?)\/?>/.exec(inner)?.[1] ?? '';
      let written = decodeXml(FORMULA.exec(inner)?.[2] ?? '');
      const group = attr(tag, 't') === 'shared' ? attr(tag, 'si') : undefined;
      if (group !== undefined) {
        // One formula filled into many cells is written once; the other cells only point at it.
        if (written !== '') shared.set(group, { written, row, column });
        else if (shared.has(group)) {
          const first = shared.get(group);
          written = moved(first.written, row - first.row, column - first.column);
        }
      }
      shown = { text: `=${written}` };
      if (written !== '' && row > headingRow && !headingRows.has(row) && !firstFormula.has(column)) {
        firstFormula.set(column, `=${written}`);
        waiting.delete(column);
      }
    } else if (type === 's') {
      shown = { index: Number(value) };
    } else if (type === 'inlineStr') shown = { text: stringText(inner) };
    else if (value === undefined) shown = { text: '' };
    else if (type === 'b') shown = { text: value === '1' ? 'TRUE' : 'FALSE' };
    else if (type === 'str' || type === 'e' || type === 'd') shown = { text: decodeXml(value) };
    else shown = { text: dates[Number(attr(cellAttrs, 's') ?? 0)] ? dayText(value, from1904) : value };

    const keep = () => {
      if (shown.index !== undefined) wanted.add(shown.index);
      return shown;
    };
    if (headingRows.has(row)) {
      if (!headings.has(column)) headings.set(column, keep());
    } else if (row > headingRow && listed.has(column) && (rows.has(row) || rows.size < ROWS)) {
      if (!rows.has(row)) rows.set(row, new Map());
      rows.get(row).set(column, keep());
    }
  }

  // Only the entries of the list of text that are shown are read out of it.
  const texts = new Map();
  if (wanted.size) {
    const last = Math.max(...wanted);
    let index = -1;
    for (const m of stringsXml.matchAll(STRING_ITEMS)) {
      index++;
      if (wanted.has(index)) texts.set(index, stringText(m[1] ?? ''));
      if (index >= last) break;
    }
  }
  const say = (shown) => (shown === undefined ? '' : shown.index !== undefined ? (texts.get(shown.index) ?? '') : shown.text);

  return {
    name,
    headingRow: headingRow || null,
    columns: columns.map((c) => ({ column: c.column, heading: say(headings.get(columnNumber(c.column))), holds: c.holds, kept: c.kept, coded: c.coded === true, formula: firstFormula.get(columnNumber(c.column)) ?? null })),
    rows: [...rows.values()].map((cells) => columns.map((c) => say(cells.get(columnNumber(c.column))))),
  };
}
