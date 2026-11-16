// A CSV file read and written back with stand-in values. It gives the same kind of report as the
// workbook reader (workbook.js), so the page can show both in the same way.
import { makeFaker } from './fake.js';
import { codeLabel, makeCoder } from './code.js';

const NAME = 'CSV file';
const letters = (number) => {
  let out = '';
  for (let n = number; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return out;
};
const columnNumber = (name) => [...name].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

/** The file's bytes as text. Most files are UTF-8; an older Windows file is read as Windows-1252. */
function decode(bytes) {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return { text: new TextDecoder(bytes[0] === 0xff ? 'utf-16le' : 'utf-16be').decode(bytes.subarray(2)), mark: true, written: 'UTF-16' };
  const mark = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(mark ? bytes.subarray(3) : bytes), mark, written: 'UTF-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), mark: false, written: 'Windows-1252' };
  }
}

const DELIMITERS = { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'bar' };

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

/** Every row as a list of cells. A cell remembers whether it was written inside quotation marks. */
function parse(text, delimiter) {
  const rows = [];
  let row = [];
  let newline = null;
  let i = 0;
  const n = text.length;
  const plainEnd = (from) => {
    let at = from;
    while (at < n && text[at] !== delimiter && text[at] !== '\n' && text[at] !== '\r') at++;
    return at;
  };
  while (i < n) {
    let value = '';
    const quoted = text[i] === '"';
    if (quoted) {
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
    row.push({ value, quoted });
    if (i >= n) break;
    if (text[i] === delimiter) {
      i++;
      if (i >= n) row.push({ value: '', quoted: false });
      continue;
    }
    const ending = text[i] === '\r' && text[i + 1] === '\n' ? '\r\n' : text[i];
    newline ??= ending;
    i += ending.length;
    rows.push(row);
    row = [];
  }
  if (row.length) rows.push(row);
  return { rows, newline: newline ?? '\n', endsWithNewline: /[\r\n]$/.test(text) };
}

/** What a cell holds, judged by how it is written. A number with leading zeros (an ID, a ZIP code) is text. */
function kindOf(value) {
  const v = value.trim();
  if (v === '') return 'blank';
  if (/^-?\d+(\.\d+)?$/.test(v) && !/^-?0\d/.test(v)) return 'number';
  if (/^\d{1,2}([/.-])\d{1,2}\1(\d{4}|\d{2})$/.test(v) || /^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(v)) return 'date';
  return 'text';
}

/** The row of headings: the first row that is mostly words and about as wide as the table. */
function findHeaderRow(rows) {
  const early = rows.slice(0, 60).map((row, i) => ({ row: i + 1, cells: row.filter((c) => kindOf(c.value) !== 'blank').length, text: row.filter((c) => kindOf(c.value) === 'text').length }));
  const widest = Math.max(0, ...early.map((r) => r.cells));
  return early.find((r) => r.text >= Math.max(1, Math.ceil(widest * 0.6)) && r.text >= r.cells * 0.8)?.row ?? 0;
}

/**
 * Reads a CSV file and gives back a report of what is in it and, unless only the report is wanted
 * (`only: 'report'`), the same file with stand-in values. `keep` names the columns to leave alone: { 'CSV file': ['A', 'D'] }.
 * `code` names, in the same way, the columns whose values are to become short codes; the legend that says
 * which code is which original is given back beside the copy and never written into it.
 */
export async function standInCsv(bytes, { only, keep = {}, code = {} } = {}) {
  const { text, mark, written } = decode(bytes);
  const delimiter = findDelimiter(text);
  const { rows, newline, endsWithNewline } = parse(text, delimiter);
  const headerRow = findHeaderRow(rows);
  const kept = new Set((keep[NAME] ?? []).map((name) => columnNumber(String(name).toUpperCase())));
  const faker = makeFaker();
  const done = { text: 0, number: 0, date: 0, formulaResults: 0, kept: 0, coded: 0 };
  // A column named both to be left alone and to be coded is left alone.
  const wantCode = new Set((code[NAME] ?? []).map((name) => columnNumber(String(name).toUpperCase())).filter((column) => !kept.has(column)));
  const coder = makeCoder();
  const codes = new Map();
  const columns = {};
  const headings = {};
  const keptTexts = new Set();
  const keepValues = new Set();
  const worthKnowing = [];
  let above = 0;
  let formulaLike = 0;
  let uneven = 0;
  const width = headerRow ? rows[headerRow - 1].length : Math.max(0, ...rows.slice(0, 60).map((r) => r.length));

  // No stand-in may equal a real value from this file.
  const real = new Set();
  for (const row of rows) for (const cell of row) if (cell.value !== '') real.add(cell.value);
  faker.avoid(real);

  // The columns to be coded are read through first: a column that holds a date cannot be coded, and is
  // given randomized values instead. Every other value in it is noted, and the codes are then drawn.
  if (wantCode.size) {
    const asked = new Map();
    const realWhole = new Set();
    rows.forEach((row, at) => {
      row.forEach((cell, c) => {
        const kind = kindOf(cell.value);
        if (kind === 'number' && Number.isInteger(Number(cell.value.trim())) && Number(cell.value.trim()) > 0) realWhole.add(Number(cell.value.trim()));
        if (at + 1 <= headerRow || kind === 'blank' || !wantCode.has(c + 1)) return;
        const found = asked.get(c + 1) ?? asked.set(c + 1, { texts: new Set(), numbers: new Set(), dates: 0 }).get(c + 1);
        if (kind === 'date') found.dates++;
        else (kind === 'number' ? found.numbers : found.texts).add(kind === 'number' ? cell.value.trim() : cell.value);
      });
    });
    for (const [column, found] of asked) {
      if (found.dates) continue;
      const set = coder.setFor(codeLabel(headerRow ? rows[headerRow - 1][column - 1]?.value : '', letters(column)));
      codes.set(column, set);
      set.places.push(`column ${letters(column)}`);
      for (const value of found.texts) set.wantText(value);
      for (const written of found.numbers) set.wantNumber(written);
    }
    // No code may equal a real value of this file, and no randomized value may equal a code.
    coder.assign((value) => real.has(value), (whole) => realWhole.has(whole));
    faker.avoid(coder.textCodes());
  }

  rows.forEach((row, at) => {
    const number = at + 1;
    if (number === headerRow) {
      row.forEach((cell, c) => {
        headings[c + 1] = cell.value;
        if (cell.value !== '') keptTexts.add(cell.value);
      });
      return;
    }
    if (number > headerRow && row.length !== width && !(row.length === 1 && row[0].value === '')) uneven++;
    row.forEach((cell, c) => {
      const kind = kindOf(cell.value);
      if (kind === 'blank') return;
      const column = c + 1;
      if (/^[=@]/.test(cell.value.trim()) || /^[+-]\s*[A-Za-z]/.test(cell.value.trim())) {
        formulaLike++;
        if (formulaLike <= 20) worthKnowing.push({ what: 'A cell that a spreadsheet program would run as a formula', where: `${letters(column)}${number}`, detail: cell.value.slice(0, 120) });
      }
      if (number < headerRow) {
        above++;
      } else {
        const stats = (columns[column] ??= { text: 0, number: 0, date: 0, first: number, last: number, different: new Set(), alsoHeading: 0 });
        stats[kind]++;
        // A cell under the headings that holds the very words of a heading is a value like any other, and is counted.
        if (keptTexts.has(cell.value)) stats.alsoHeading++;
        stats.last = number;
        if (stats.different.size < 5000) stats.different.add(cell.value);
        if (kept.has(column)) {
          done.kept++;
          keepValues.add(cell.value);
          return;
        }
        // A column the person asked to have coded: a number gets a whole number, any other value a short label.
        const made = kind === 'number' ? codes.get(column)?.number(cell.value.trim()) : codes.get(column)?.text(cell.value);
        if (made !== undefined) {
          done.coded++;
          cell.value = kind === 'number' ? cell.value.replace(cell.value.trim(), made) : made;
          return;
        }
      }
      done[kind]++;
      cell.value = kind === 'number' ? cell.value.replace(cell.value.trim(), faker.number(cell.value.trim())) : faker.text(cell.value);
    });
  });
  if (formulaLike > 20) worthKnowing.push({ what: 'More cells that a spreadsheet program would run as a formula', where: '', detail: `${(formulaLike - 20).toLocaleString('en-US')} more` });
  if (uneven) worthKnowing.push({ what: 'Rows with more or fewer cells than the row of headings', where: '', detail: `${uneven === 1 ? '1 row' : `${uneven.toLocaleString('en-US')} rows`}; often a stray separator or a line break inside a cell` });

  const report = {
    parts: 1,
    csv: { separator: DELIMITERS[delimiter], written, rows: rows.length },
    sheets: [
      {
        name: NAME,
        state: 'visible',
        headingRow: headerRow || null,
        headingRows: headerRow ? [headerRow] : [],
        headingsFrom: headerRow ? 'guess' : 'none',
        tables: 0,
        cellsAboveHeadings: above,
        columns: Object.entries(columns).map(([number, s]) => ({
          column: letters(Number(number)),
          kept: kept.has(Number(number)),
          heading: headings[number] ?? '',
          cells: s.text + s.number + s.date,
          formulas: 0,
          holds: ['text', 'number', 'date'].filter((k) => s[k] > 0).join(', '),
          different: s.different.size,
          from: `${letters(Number(number))}${s.first}`,
          to: `${letters(Number(number))}${s.last}`,
          headingAlsoValue: s.alsoHeading,
          coded: codes.has(Number(number)),
          canCode: s.date === 0 && s.text + s.number > 0,
        })),
      },
    ],
    strings: { inAll: real.size, keptAsHeadings: keptTexts.size },
    replaced: { ...done, differentTexts: faker.originals().length },
    outsideTheCells: [],
    forALook: [],
    worthKnowing,
    extras: { parts: 0, queries: false },
  };
  if (only === 'report') return { report };

  // What the copy looks like: its headings and its first rows, as they are about to be written.
  const listed = report.sheets[0].columns;
  const firstRows = [];
  for (let at = headerRow; at < rows.length && firstRows.length < 3; at++) if (rows[at].some((cell) => cell.value !== '')) firstRows.push(rows[at]);
  const described = [
    {
      name: NAME,
      headingRow: headerRow || null,
      columns: listed.map((c) => ({ column: c.column, heading: c.heading, holds: c.holds, kept: c.kept, coded: c.coded, formula: null })),
      rows: firstRows.map((row) => listed.map((c) => row[columnNumber(c.column) - 1]?.value ?? '')),
    },
  ];

  const needsQuotes = (value) => value.includes(delimiter) || value.includes('"') || /[\r\n]/.test(value) || /^\s|\s$/.test(value);
  const out = rows.map((row) => row.map((cell) => (cell.quoted || needsQuotes(cell.value) ? `"${cell.value.replace(/"/g, '""')}"` : cell.value)).join(delimiter)).join(newline) + (endsWithNewline ? newline : '');
  // Written back as UTF-8. The mark at the start is kept, or added when the file was in an older form, so that Excel reads accents rightly.
  const body = new TextEncoder().encode(out);
  const withMark = mark || written !== 'UTF-8';
  const outBytes = new Uint8Array(body.length + (withMark ? 3 : 0));
  if (withMark) outBytes.set([0xef, 0xbb, 0xbf]);
  outBytes.set(body, withMark ? 3 : 0);
  // Dates are left out of the list to search for, as numbers are: a randomized date can equal a real one by chance.
  // Every text that was given a code is searched for afterwards too. The words the codes are built from are in the copy on purpose.
  const originals = [...new Set([...faker.originals().filter((value) => kindOf(value) !== 'date'), ...coder.textOriginals()])];
  return { report, bytes: outBytes, described, legend: coder.legend(), originals, kept: [...new Set([...keptTexts, ...coder.labels()])], keptByChoice: keepValues, madeUp: faker.madeUp(), oldNames: [], names: [] };
}

/** Searches a CSV file for values that should no longer be in it. Same answer shape as the workbook's check. */
export async function leftoversCsv(bytes, originals, { shortest = 5, madeUp = new Set(), kept = new Set() } = {}) {
  const { text } = decode(bytes);
  const whole = new Set();
  for (const row of parse(text, findDelimiter(text)).rows) for (const cell of row) if (cell.value !== '') whole.add(cell.value);
  const wanted = originals.filter((value) => value.trim().length >= shortest);
  const byStart = new Map();
  for (const value of wanted) {
    const start = value.slice(0, shortest);
    if (!byStart.has(start)) byStart.set(start, []);
    byStart.get(start).push(value);
  }
  const inside = new Set();
  for (const said of whole) {
    if (said.length <= shortest || madeUp.has(said) || kept.has(said) || /^[\d.eE+-]+$/.test(said)) continue;
    for (let at = 0; at + shortest <= said.length; at++) {
      const hits = byStart.get(said.substr(at, shortest));
      if (hits) for (const value of hits) if (value !== said && said.startsWith(value, at)) inside.add(value);
    }
  }
  const found = [];
  for (const value of wanted) {
    const how = whole.has(value) ? 'whole' : inside.has(value) ? 'inside' : null;
    if (how) found.push({ value, part: 'csv', how, madeUp: madeUp.has(value), sits: how === 'whole' ? 'a cell' : 'a longer text in a cell' });
  }
  return found;
}
