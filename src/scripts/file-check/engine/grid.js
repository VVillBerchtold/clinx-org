// One sheet as the rules read it: its cells held column by column, and what else was seen on it.
//
// In plain words: a workbook's sheet and a CSV file are both turned into this one form, so that
// every rule is written once and works on both.

import { DATETEXT, KIND, NUM, PLAIN, NUMTEXT, SPACES, ZEROTEXT, formOf } from './classify.js';

/** An empty sheet, ready to be filled by a reader. */
export function newGrid(name) {
  return {
    name,
    csv: false,
    hidden: false,
    /** Column number to its cells, as three lists of the same length: the row, what the cell reads as, and its text. */
    columns: new Map(),
    /** Row number to how many of its cells hold something. */
    rowFill: [],
    lastRow: 0,
    /** Merged ranges: { ref, top, bottom, left, right }. */
    merges: [],
    /** Row number to how many of its cells add up the cells above them in their own column. */
    sumRows: new Map(),
    /** Rows a table names as its row of totals, and as its row of headings. */
    totalsRows: new Set(),
    tableRows: new Set(),
    /** CSV only: row number to how many fields the row has. */
    widths: null,
    /** True when the workbook counts its dates from 1904. */
    from1904: false,
  };
}

/** Adds one cell that holds something. */
export function put(grid, row, column, cls, text) {
  let cells = grid.columns.get(column);
  if (!cells) grid.columns.set(column, (cells = { rows: [], cls: [], text: [] }));
  cells.rows.push(row);
  cells.cls.push(cls);
  cells.text.push(text);
  if ((cls & KIND) !== SPACES) {
    grid.rowFill[row] = (grid.rowFill[row] ?? 0) + 1;
    if (row > grid.lastRow) grid.lastRow = row;
  }
}

/** True when a cell counts as words for finding the row of headings. It matches what the Cleaner Copy reader counts. */
function wordy(cls, csv) {
  const kind = cls & KIND;
  if (!csv) return kind === PLAIN || kind === NUMTEXT || kind === ZEROTEXT || kind === DATETEXT;
  return kind !== NUM && kind !== SPACES && !(kind === DATETEXT && formOf(cls) !== 5);
}

/**
 * The row that holds the column headings; 0 when none is found. A table says for itself which row
 * that is. Otherwise it is the first of the first 60 rows that is mostly words and about as wide
 * as the widest of them: the same rule the Cleaner Copy reader uses (its findHeaderRow), copied
 * here because that reader does not give it out.
 */
export function headingRowOf(grid) {
  if (grid.tableRows.size) return Math.min(...grid.tableRows);
  const early = [];
  for (const cells of grid.columns.values()) {
    for (let i = 0; i < cells.rows.length; i++) {
      const row = cells.rows[i];
      if (row > 60 || (cells.cls[i] & KIND) === SPACES) continue;
      const tally = (early[row] ??= { row, cells: 0, text: 0 });
      tally.cells++;
      if (wordy(cells.cls[i], grid.csv)) tally.text++;
    }
  }
  const rows = early.filter(Boolean);
  const widest = Math.max(0, ...rows.map((r) => r.cells));
  return rows.find((r) => r.text >= Math.max(1, Math.ceil(widest * 0.6)) && r.text >= r.cells * 0.8)?.row ?? 0;
}
