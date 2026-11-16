// Reads a CSV file into the form the rules use (see grid.js).
//
// In plain words: the file's bytes are turned into text, the separator is found, and every row is
// split into its cells. Nothing is changed and nothing is written.
//
// `decode`, `findDelimiter` and `parse` are copied from the Cleaner Copy CSV reader
// (src/scripts/cleaner-copy/engine/csv.js), which does not give them out. They are the same
// lines, so both tools read a CSV file the same way.

import { classify } from './classify.js';
import { newGrid, put } from './grid.js';

export const CSV_NAME = 'CSV file';

/** The file's bytes as text. Most files are UTF-8; an older Windows file is read as Windows-1252. */
function decode(bytes) {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return new TextDecoder(bytes[0] === 0xff ? 'utf-16le' : 'utf-16be').decode(bytes.subarray(2));
  const mark = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(mark ? bytes.subarray(3) : bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Which character separates the cells: the one seen most in the first lines, outside quotation marks. */
function findDelimiter(text) {
  const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  let quoted = false;
  let lines = 0;
  for (let i = 0; i < text.length && lines < 30; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch]++;
    else if (!quoted && ch === '\n') lines++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

/** Every row as a list of cells. */
function parse(text, delimiter) {
  const rows = [];
  let row = [];
  let i = 0;
  const n = text.length;
  const plainEnd = (from) => {
    let at = from;
    while (at < n && text[at] !== delimiter && text[at] !== '\n' && text[at] !== '\r') at++;
    return at;
  };
  while (i < n) {
    let value = '';
    if (text[i] === '"') {
      i++;
      for (;;) {
        const q = text.indexOf('"', i);
        if (q === -1) {
          value += text.slice(i);
          i = n;
          break;
        }
        value += text.slice(i, q);
        if (text[q + 1] === '"') {
          value += '"';
          i = q + 2;
        } else {
          i = q + 1;
          break;
        }
      }
    }
    const end = plainEnd(i);
    value += text.slice(i, end);
    i = end;
    row.push(value);
    if (i >= n) break;
    if (text[i] === delimiter) {
      i++;
      if (i >= n) row.push('');
      continue;
    }
    i += text[i] === '\r' && text[i + 1] === '\n' ? 2 : 1;
    rows.push(row);
    row = [];
  }
  if (row.length) rows.push(row);
  return rows;
}

/** A CSV file as one sheet, named "CSV file". */
export function readCsv(bytes) {
  const text = decode(bytes);
  const rows = parse(text, findDelimiter(text));
  const grid = newGrid(CSV_NAME);
  grid.csv = true;
  grid.widths = [];
  const seen = new Map();
  rows.forEach((row, at) => {
    // A line with nothing on it is an empty row, and has no fields to count.
    grid.widths[at + 1] = row.length === 1 && row[0] === '' ? 0 : row.length;
    for (let c = 0; c < row.length; c++) {
      const value = row[c];
      if (value === '') continue;
      let cls = seen.get(value);
      if (cls === undefined) {
        cls = classify(value, true);
        if (seen.size < 200000) seen.set(value, cls);
      }
      put(grid, at + 1, c + 1, cls, value);
    }
  });
  return [grid];
}
