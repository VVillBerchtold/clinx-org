// The rules. Each one looks at a sheet for something that trips up a script or a pivot table.
//
// In plain words: a sheet is read once (see read-workbook.js and read-csv.js). Then every rule
// here counts what it is looking for and, when the count passes the rule's threshold, writes one
// finding: how many, where, and what to do. The thresholds are set so that a rule speaks only when
// the thing is plainly there. A finding's sentences are built from counts, places and headings
// only. The values themselves go into `examples`, which the page shows on the person's own screen.

import { letters } from '../../cleaner-copy/engine/xml.js';
import { AMOUNT, BOOL, COMMANUM, DATE, DATETEXT, DIGITS, DOUBLE, EDGE, ERROR, FORMAT, FORMS, HASDIGIT, KIND, NBSP, NUM, NUMTEXT, PLAIN, SPACES, TOKEN, ZEROTEXT, formOf } from './classify.js';
import { headingRowOf } from './grid.js';
import { list, n, places, plural, short } from './words.js';

// ---- The thresholds ----

/** A column is "mostly" one kind when at least 80% of its filled cells are of that kind. */
const MOSTLY = 0.8;
/** number-as-text, whole column: at least 3 such cells, and at least 90% of the column's filled cells. */
const WHOLE_COLUMN = 0.9;
const WHOLE_COLUMN_CELLS = 3;
/** leading-zeros: at least 2 cells start with a zero, in a column that is mostly (80%) digits only. */
const ZERO_CELLS = 2;
/** near-duplicates: only in a column with at most 50 different values (compared without case, spaces or a final full stop), each at most 60 characters. */
const FEW_VALUES = 50;
const SHORT_VALUE = 60;
/** repeated-id: at least 20 filled cells, at least 95% of them shaped like an ID, and the repeats are at most 5% of the cells. */
const ID_CELLS = 20;
const ID_SHAPED = 0.95;
const ID_REPEATS = 0.05;
/** decimal-comma: at least 2 such cells, in a column that is mostly (80%) numbers. */
const COMMA_CELLS = 2;
/** two-heading-rows: the row under the headings is all words (2 cells or more), and sits on top of at least 2 columns that are 90% numbers or dates below it. */
const SECOND_ROW_COLUMNS = 2;
const SECOND_ROW_UNDER = 0.9;
/** repeated-heading, inside the data: a row where at least 2 cells, and at least 60% of its cells, repeat the heading of their own column. */
const HEADING_AGAIN = 0.6;
/** Every finding lists at most 5 places and 5 examples. */
const SHOWN = 5;

/** total-row: the first filled cell of the row is one of these words and nothing else. "Total cholesterol" is a value, so longer wordings are left alone. */
const TOTAL_WORD = /^(?:(?:grand\s+totals?|totals?|sub[\s-]?totals?|sum)(?:\s+(?:for|of)\s+\S.*)?|\S.*\s(?:sub[\s-]?)?totals?)\s*:?$/i;
/** A row of headings is taken as one for certain when a heading made of words sits on a column of at least 3 filled cells that are mostly (80%) numbers or dates. */
const SURE_CELLS = 3;
/** Words people type where a value is missing. A first row of these on top of numbers is a row of data, not of headings. */
const NO_VALUE = /^(?:n\/?a|none|null|nil|unknown|unk|tbd|missing|blank|-+|\?+|\.+)$/i;

/** repeated-id: a heading that says the column is an ID, and headings of columns that repeat for ordinary reasons. */
const ID_HEADING = /(?:\b(?:id|no|number|num|nbr|code|key|mrn|npi)\.?|#)\s*$|^(?:id|mrn|npi)\b/i;
const NOT_ID_HEADING = /\b(?:phone|fax|tel|zip|postal|date|dob|year|amount|qty|quantity|price|cost|charge|paid|count|age|days|units)\b/i;

/** One wording for a count of 1, another for any other count. */
const one = (count, single, many) => (count === 1 ? single : many);

/** True when `part` is at least `share` of `whole`. Written this way so that 12 of 15 counts as 80%. */
const atLeast = (part, share, whole) => part + 1e-9 >= share * whole;

/** Marks a cell that holds nothing but spaces, beside the marks from classify.js. */
const ONLY = 1;
const SPACE_MARKS = EDGE | DOUBLE | NBSP;

const RULE_ORDER = ['number-as-text', 'leading-zeros', 'mixed-kinds', 'mixed-dates', 'stray-spaces', 'near-duplicates', 'merged-cells', 'blank-rows', 'total-row', 'repeated-heading', 'empty-heading', 'two-heading-rows', 'repeated-id', 'error-cells', 'uneven-rows', 'decimal-comma'];
export const ruleRank = (rule) => RULE_ORDER.indexOf(rule);

/** Two texts compared the way near-duplicates and headings are: without case, extra spaces or a final full stop. */
const fold = (text) => text.replace(/\s+/g, ' ').trim().replace(/\.+$/, '').trimEnd().toLowerCase();

/** A date cell's number as a date a person can read. Used only for the examples. */
function dateText(serial, from1904) {
  const days = Number(serial) + (from1904 ? 1462 : 0);
  const date = new Date(Date.UTC(1899, 11, 30) + Math.round(days * 86400000));
  return Number.isFinite(days) && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, days % 1 === 0 ? 10 : 16).replace('T', ' ') : serial;
}

/** Counts what a column holds, from a row down, leaving out the rows in `skip`. */
function tally(cells, from, skip) {
  const s = { n: 0, plain: 0, num: 0, numText: 0, zero: 0, date: 0, dateText: 0, bool: 0, comma: 0, errors: 0, spaces: 0, spaceMarks: 0, digits: 0, amount: 0, format: 0, tokens: 0, forms: [0, 0, 0, 0, 0, 0] };
  const check = skip.size > 0;
  for (let i = 0; i < cells.rows.length; i++) {
    const row = cells.rows[i];
    if (row < from) continue;
    const cls = cells.cls[i];
    const kind = cls & KIND;
    if (kind === ERROR) {
      s.errors++;
      continue;
    }
    if (check && skip.has(row)) continue;
    if (kind === SPACES) {
      s.spaces++;
      s.spaceMarks |= ONLY;
      continue;
    }
    if (cls & SPACE_MARKS) {
      s.spaces++;
      s.spaceMarks |= cls & SPACE_MARKS;
    }
    s.n++;
    if (kind === PLAIN) s.plain++;
    else if (kind === NUM) s.num++;
    else if (kind === NUMTEXT) s.numText++;
    else if (kind === ZEROTEXT) s.zero++;
    else if (kind === DATE) s.date++;
    else if (kind === DATETEXT) {
      s.dateText++;
      s.forms[formOf(cls)]++;
    } else if (kind === BOOL) s.bool++;
    else if (kind === COMMANUM) s.comma++;
    if (cls & DIGITS) s.digits++;
    if (cls & AMOUNT) s.amount++;
    if (cls & FORMAT) s.format++;
    if (cls & TOKEN) s.tokens++;
  }
  return s;
}

/**
 * near-duplicates: the values of a column that are written in more than one way.
 * Gives nothing back when the column has more than FEW_VALUES different values.
 */
function nearDuplicates(cells, from, skip) {
  const groups = new Map();
  const keys = new Map();
  for (let i = 0; i < cells.rows.length; i++) {
    const row = cells.rows[i];
    if (row < from || (cells.cls[i] & KIND) !== PLAIN || skip.has(row)) continue;
    const text = cells.text[i];
    if (text.length > SHORT_VALUE) continue;
    let key = keys.get(text);
    if (key === undefined) keys.set(text, (key = fold(text)));
    let group = groups.get(key);
    if (!group) {
      if (groups.size === FEW_VALUES) return null;
      groups.set(key, (group = new Map()));
    }
    const seen = group.get(text);
    if (seen) seen.count++;
    else group.set(text, { text, count: 1, row });
  }
  const split = [...groups.values()].filter((group) => group.size > 1);
  if (split.length === 0) return null;
  const others = new Set();
  const examples = [];
  let count = 0;
  for (const group of split) {
    const ways = [...group.values()].sort((a, b) => b.count - a.count || a.row - b.row);
    for (const way of ways.slice(1)) {
      others.add(way.text);
      count += way.count;
    }
    for (const way of ways) examples.push({ row: way.row, value: way.text });
  }
  return { values: split.length, count, others, examples };
}

/**
 * repeated-id: a column where nearly every value appears once and a few appear more than once.
 * Gives nothing back for a column that does not look like a column of IDs.
 */
function repeatedId(cells, from, skip, s, heading) {
  if (s.n < ID_CELLS || !atLeast(s.tokens, ID_SHAPED, s.n) || NOT_ID_HEADING.test(heading)) return null;
  const seen = new Map();
  const lengths = new Map();
  let extra = 0;
  let codes = 0;
  let numbers = 0;
  for (let i = 0; i < cells.rows.length; i++) {
    const row = cells.rows[i];
    const cls = cells.cls[i];
    if (row < from || !(cls & TOKEN) || skip.has(row)) continue;
    const text = cells.text[i].trim();
    const times = seen.get(text) ?? 0;
    // More repeats than the threshold allows: this is a column of ordinary values, and the look ends here.
    if (times && !atLeast(s.n, 1 / ID_REPEATS, ++extra)) return null;
    seen.set(text, times + 1);
    if ((cls & KIND) === NUM) {
      numbers++;
      lengths.set(text.length, (lengths.get(text.length) ?? 0) + 1);
    } else if (cls & HASDIGIT) codes++;
  }
  if (extra === 0) return null;
  // What an ID looks like: its heading says so; or it is a code with a digit in it ("C-10442"); or
  // it is a whole number of 5 digits or more, the same length in nearly every cell.
  const sameLength = Math.max(0, ...[...lengths].filter(([length]) => length >= 5).map(([, count]) => count));
  if (!ID_HEADING.test(heading) && !atLeast(codes, 0.9, s.n) && !atLeast(sameLength, 0.9, s.n)) return null;
  let values = 0;
  let count = 0;
  for (const times of seen.values()) {
    if (times < 2) continue;
    values++;
    count += times;
  }
  return { values, count, seen };
}

/**
 * Runs every rule over one sheet.
 * Gives back what the sheet is (for the report's list of sheets) and its findings, not yet sorted.
 */
export function checkGrid(grid) {
  const csv = grid.csv;
  const info = { name: grid.name, rows: 0, columns: 0, headingRow: null, headingsSure: false, hidden: grid.hidden };
  const findings = [];
  if (grid.lastRow === 0) return { info, findings };
  const here = csv ? 'This file' : 'This sheet';
  const hereLower = csv ? 'this file' : 'this sheet';
  const columnNumbers = [...grid.columns.keys()].sort((a, b) => a - b);

  const add = (rule, weight, column, count, say, fix, where, examples = []) => {
    const heading = column ? headings.get(column) : undefined;
    findings.push({
      rule,
      weight,
      sheet: grid.name,
      ...(column ? { column: letters(column) } : {}),
      ...(heading ? { heading } : {}),
      count,
      say: where.length ? `${say} (${places(where, count)}).` : `${say}.`,
      fix,
      where,
      examples: examples.slice(0, SHOWN).map(({ at, value }) => ({ at, value: value.length > 80 ? `${value.slice(0, 79)}…` : value })),
      // For sorting only; taken off before the report is given back.
      order: column,
    });
  };

  /** The filled cells of one row, left to right. */
  const cellsOfRow = (row) => {
    const out = [];
    if (row < 1) return out;
    for (const column of columnNumbers) {
      const cells = grid.columns.get(column);
      const at = cells.rows.indexOf(row);
      if (at >= 0 && (cells.cls[at] & KIND) !== SPACES) out.push({ column, cls: cells.cls[at], text: cells.text[at] });
    }
    return out;
  };
  const allWords = (cells) => cells.every((cell) => (cell.cls & KIND) === PLAIN);

  // ---- The row of headings ----
  const H = headingRowOf(grid);
  info.headingRow = H || null;
  const headings = new Map();
  const headingFold = new Map();
  const headingCells = H ? cellsOfRow(H) : [];
  for (const cell of headingCells) {
    const heading = cell.text.replace(/\s+/g, ' ').trim();
    if (heading === '') continue;
    headings.set(cell.column, heading);
    headingFold.set(cell.column, fold(heading));
  }
  // A CSV file's columns are those of its row of headings. A field beyond them belongs to uneven-rows.
  const headWidth = csv && H ? grid.widths[H] : Infinity;
  const columns = columnNumbers.filter((column) => column <= headWidth);

  // Is that row plainly a row of headings? A table says so itself. Otherwise the row has to differ from
  // the rows under it: at least one heading made of words sits on top of a column of numbers or dates.
  // On a sheet that holds words only, the first row may be a row of data (a list of names with no
  // headings), so its texts are kept out of every sentence and the columns are named by letter alone.
  let sure = grid.tableRows.size > 0;
  if (H && !sure) {
    for (const cell of headingCells) {
      if ((cell.cls & KIND) !== PLAIN || NO_VALUE.test(cell.text.trim())) continue;
      const cells = grid.columns.get(cell.column);
      let filled = 0;
      let notWords = 0;
      for (let i = 0; i < cells.rows.length; i++) {
        const kind = cells.cls[i] & KIND;
        if (cells.rows[i] <= H || kind === SPACES || kind === ERROR) continue;
        filled++;
        if (kind !== PLAIN) notWords++;
      }
      if (filled >= SURE_CELLS && atLeast(notWords, MOSTLY, filled)) {
        sure = true;
        break;
      }
    }
  }
  info.headingsSure = sure;
  /** A column's heading as a sentence may show it: nothing when the row of headings is only a guess. */
  const named = (column) => (sure ? (headings.get(column) ?? '') : '');

  // two-heading-rows. Under the headings: a row of words only that sits on top of columns of numbers or dates.
  // Above the headings: a row of 2 or more cells, words only, with a range merged across columns (a heading
  // over a group of columns). A line of title text above the headings is left alone, and so is any row above
  // a table's own row of headings.
  let headingRows = H ? [H] : [];
  if (H) {
    const below = cellsOfRow(H + 1);
    if (below.length >= 2 && allWords(below)) {
      let under = 0;
      for (const cell of below) {
        const cells = grid.columns.get(cell.column);
        let filled = 0;
        let notWords = 0;
        for (let i = 0; i < cells.rows.length; i++) {
          const kind = cells.cls[i] & KIND;
          if (cells.rows[i] <= H + 1 || kind === SPACES || kind === ERROR) continue;
          filled++;
          if (kind !== PLAIN) notWords++;
        }
        if (filled >= 3 && atLeast(notWords, SECOND_ROW_UNDER, filled)) under++;
      }
      if (under >= SECOND_ROW_COLUMNS) headingRows = [H, H + 1];
    }
    if (headingRows.length === 1 && H > 1 && grid.tableRows.size === 0) {
      const above = cellsOfRow(H - 1);
      const merged = grid.merges.some((merge) => merge.top <= H - 1 && merge.bottom >= H - 1 && merge.right > merge.left);
      if (above.length >= 2 && allWords(above) && merged) headingRows = [H - 1, H];
    }
  }
  const headTop = headingRows[0] ?? 0;
  const headBottom = headingRows[headingRows.length - 1] ?? 0;
  const dataStart = headBottom + 1;

  // ---- One pass over the rows of data: the first cell of each row, and cells that repeat their column's heading ----
  const started = [];
  const sameAsHeading = [];
  for (const column of columns) {
    const cells = grid.columns.get(column);
    const heading = headingFold.get(column);
    for (let i = 0; i < cells.rows.length; i++) {
      const row = cells.rows[i];
      if (row < dataStart) continue;
      const kind = cells.cls[i] & KIND;
      if (kind === SPACES) continue;
      const text = cells.text[i];
      if (!started[row]) {
        started[row] = { column, text: kind === PLAIN && text.length <= 16 ? text : '' };
      }
      if (heading !== undefined && kind === PLAIN && Math.abs(text.length - heading.length) <= 4 && fold(text) === heading) sameAsHeading[row] = (sameAsHeading[row] ?? 0) + 1;
    }
  }

  const blankRows = [];
  const totalRows = [];
  const totalLabels = [];
  const headingAgain = [];
  const skip = new Set();
  for (let row = dataStart; row <= grid.lastRow; row++) {
    const filled = grid.rowFill[row] ?? 0;
    if (filled === 0) {
      blankRows.push(row);
      continue;
    }
    info.rows++;
    const first = started[row];
    const word = first?.text && filled >= 2 && TOTAL_WORD.test(first.text.trim());
    if (word || grid.totalsRows.has(row) || (grid.sumRows.get(row) ?? 0) >= 1) {
      totalRows.push(row);
      if (word) totalLabels.push({ at: `${letters(first.column)}${row}`, value: first.text });
      skip.add(row);
    } else if ((sameAsHeading[row] ?? 0) >= 2 && atLeast(sameAsHeading[row], HEADING_AGAIN, filled)) {
      headingAgain.push(row);
      skip.add(row);
    }
  }

  // ---- The rules that look at one column ----
  const empty = [];
  for (const column of columns) {
    const cells = grid.columns.get(column);
    const letter = letters(column);
    const heading = headings.get(column) ?? '';
    const Label = `Column ${letter}${named(column) ? ` (${short(named(column))})` : ''}`;
    const s = tally(cells, dataStart, skip);
    if (heading || s.n + s.errors > 0) info.columns++;
    if (s.n === 0 && s.errors === 0 && s.spaces === 0) continue;
    if (H && !heading && s.n + s.errors > 0) empty.push(column);

    /** The first places where a cell of this column fits, with the values for the person's own screen. */
    const collect = (fits) => {
      const where = [];
      const examples = [];
      for (let i = 0; i < cells.rows.length && where.length < SHOWN; i++) {
        const row = cells.rows[i];
        const cls = cells.cls[i];
        if (row < dataStart || !fits(cls & KIND, cls, cells.text[i], row)) continue;
        const at = `${letter}${row}`;
        where.push(at);
        examples.push({ at, value: (cls & KIND) === DATE ? dateText(cells.text[i], grid.from1904) : cells.text[i] });
      }
      return [where, examples];
    };
    const inData = (row) => !skip.has(row);

    const numberLike = s.num + s.numText + s.zero + s.comma;
    const dateLike = s.date + s.dateText;
    const storedText = s.plain + s.numText + s.zero + s.dateText + s.comma;
    const mostlyNumbers = s.n > 0 && atLeast(numberLike, MOSTLY, s.n);
    const mostlyDates = s.n > 0 && !mostlyNumbers && atLeast(dateLike, MOSTLY, s.n);
    // The whole column is numbers stored as text. In a workbook it must also look like an amount or a count: by its number format, or by how it is written.
    const wholeAsText = mostlyNumbers && s.num === 0 && s.numText >= WHOLE_COLUMN_CELLS && atLeast(s.numText, WHOLE_COLUMN, s.n) && (csv || s.amount * 2 >= s.numText || s.format * 2 >= s.numText);

    // number-as-text. In a workbook, a text of digits with a zero in front counts too: it sits in a column of numbers.
    const asText = s.numText + (csv ? 0 : s.zero);
    if (mostlyNumbers && s.num >= 1 && asText >= 1) {
      const [where, examples] = collect((kind, cls, text, row) => (kind === NUMTEXT || (!csv && kind === ZEROTEXT)) && inData(row));
      add(
        'number-as-text',
        'fix',
        column,
        asText,
        csv ? `${Label} has ${plural(asText, 'cell')} where a number is written with extra marks, such as a currency sign or a thousands separator` : `${Label} has ${plural(asText, 'cell')} where a number is stored as text`,
        csv ? one(asText, 'Write that number the way the others in the column are written, with digits and a decimal point only.', 'Write those numbers the way the others in the column are written, with digits and a decimal point only.') : 'Make every cell in the column the same kind: numbers if you add the column up, text if it holds an ID or a code.',
        where,
        examples,
      );
    } else if (wholeAsText) {
      const [where, examples] = collect((kind, cls, text, row) => kind === NUMTEXT && inData(row));
      add(
        'number-as-text',
        'fix',
        column,
        s.numText,
        csv ? `${Label} writes its numbers with extra marks, such as a currency sign or a thousands separator, in ${plural(s.numText, 'cell')}` : `${Label} stores its numbers as text in ${plural(s.numText, 'cell')}, so a sum of the column comes to zero`,
        csv ? 'Write the numbers with digits and a decimal point only, or tell your script how they are written.' : 'Convert the column to numbers before you add it up or build a pivot table.',
        where,
        examples,
      );
    }

    // leading-zeros. A note: nothing is wrong, and the column must stay text.
    if (s.zero >= ZERO_CELLS && atLeast(s.digits, MOSTLY, s.n) && (csv || s.num === 0)) {
      const [where, examples] = collect((kind, cls, text, row) => kind === ZEROTEXT && inData(row));
      add(
        'leading-zeros',
        'note',
        column,
        s.zero,
        `${Label} holds codes made of digits, and ${plural(s.zero, 'of them starts', 'of them start')} with a zero`,
        csv ? 'Import this column as text when you open the file in a spreadsheet program, or the zeros in front are lost.' : 'Keep this column as text. If it is turned into numbers, the zeros in front are lost.',
        where,
        examples,
      );
    }

    // mixed-kinds. Mostly one kind, with at least 1 cell of another. In a CSV file a column of text is left alone.
    // In a workbook, a column of codes made of digits and stored as text is a column of text.
    if (s.n > 0) {
      let most = '';
      let odd = [];
      let fits = null;
      let fix = ['', ''];
      if (mostlyNumbers && (csv || s.num > 0 || wholeAsText)) {
        most = 'numbers';
        odd = [[s.plain, 'text'], [dateLike, 'a date'], [s.bool, 'a yes/no value']];
        fits = (kind) => kind === PLAIN || kind === DATE || kind === DATETEXT || kind === BOOL;
        fix = ['Clear that cell or replace it with a number, so the whole column can be added up.', 'Clear those cells or replace them with numbers, so the whole column can be added up.'];
      } else if (mostlyDates) {
        most = 'dates';
        odd = [[s.plain, 'text'], [numberLike, 'a number'], [s.bool, 'a yes/no value']];
        fits = (kind) => kind === PLAIN || kind === NUM || kind === NUMTEXT || kind === ZEROTEXT || kind === COMMANUM || kind === BOOL;
        fix = ['Replace it with a date, so the whole column sorts and groups by date.', 'Replace them with dates, so the whole column sorts and groups by date.'];
      } else if (!csv && atLeast(storedText, MOSTLY, s.n)) {
        most = 'text';
        odd = [[s.num, 'a number'], [s.date, 'a date'], [s.bool, 'a yes/no value']];
        fits = (kind) => kind === NUM || kind === DATE || kind === BOOL;
        fix = ['Store that cell as text as well, so every cell in the column is the same kind.', 'Store those cells as text as well, so every cell in the column is the same kind.'];
      } else if (atLeast(s.bool, MOSTLY, s.n)) {
        most = 'yes/no values';
        odd = [[storedText, 'text'], [s.num, 'a number'], [s.date, 'a date']];
        fits = (kind) => kind !== BOOL && kind !== ERROR && kind !== SPACES;
        fix = ['Make that cell a yes/no value as well, so every cell in the column is the same kind.', 'Make those cells yes/no values as well, so every cell in the column is the same kind.'];
      }
      const count = odd.reduce((sum, [cells]) => sum + cells, 0);
      if (count > 0) {
        const [where, examples] = collect((kind, cls, text, row) => fits(kind) && inData(row));
        const holds = list(odd.filter(([cells]) => cells > 0).map(([, word]) => word), 'or');
        add('mixed-kinds', most === 'numbers' || most === 'dates' ? 'fix' : 'look', column, count, `${Label} is mostly ${most}, and ${plural(count, 'cell holds', 'cells hold')} ${holds}`, one(count, fix[0], fix[1]), where, examples);
      }
    }

    // mixed-dates. A column that is mostly dates, where some are real dates and some are typed as text,
    // or where none is a real date and the text is written in 2 forms or more.
    if (mostlyDates && s.dateText >= 1) {
      if (s.date >= 1) {
        const [where, examples] = collect((kind, cls, text, row) => kind === DATETEXT && inData(row));
        add('mixed-dates', 'fix', column, s.dateText, `${Label} has real dates, and ${plural(s.dateText, 'cell')} where a date is typed as text`, one(s.dateText, 'Turn that cell into a real date, so it sorts and groups with the others.', 'Turn those cells into real dates, so they sort and group with the others.'), where, examples);
      } else {
        const used = s.forms.map((cells, form) => ({ cells, form })).filter((form) => form.cells > 0).sort((a, b) => b.cells - a.cells);
        if (used.length >= 2) {
          const count = s.dateText - used[0].cells;
          const usual = used[0].form;
          const [where, examples] = collect((kind, cls, text, row) => kind === DATETEXT && formOf(cls) !== usual && inData(row));
          add(
            'mixed-dates',
            'fix',
            column,
            count,
            `${Label} ${csv ? 'writes its dates' : 'holds dates typed as text'} ${list(used.map((form) => FORMS[form.form]))}; ${plural(count, 'cell differs', 'cells differ')} from the form the column uses the most`,
            'Write every date in the column the same way, with the year first, then the month, then the day.',
            where,
            examples,
          );
        }
      }
    }

    // stray-spaces. At least 1 cell, counted only in values of 60 characters or fewer.
    if (s.spaces >= 1) {
      const [where, examples] = collect((kind, cls, text, row) => (kind === SPACES || (cls & SPACE_MARKS && kind !== ERROR)) && inData(row));
      const kinds = [];
      if (s.spaceMarks & EDGE) kinds.push('a space before or after the text');
      if (s.spaceMarks & DOUBLE) kinds.push('two spaces in a row');
      if (s.spaceMarks & NBSP) kinds.push('a non-breaking space (the kind copied from a web page)');
      if (s.spaceMarks & ONLY) kinds.push('nothing but spaces');
      add('stray-spaces', 'look', column, s.spaces, `${Label} has ${plural(s.spaces, 'cell')} with stray spaces: ${list(kinds, 'or')}`, 'Remove the stray spaces, so that values which look the same also match in a lookup, a filter or a pivot table.', where, examples);
    }

    // near-duplicates.
    if (s.plain >= 2) {
      const found = nearDuplicates(cells, dataStart, skip);
      if (found) {
        const [where] = collect((kind, cls, text, row) => kind === PLAIN && found.others.has(text) && inData(row));
        add(
          'near-duplicates',
          'fix',
          column,
          found.count,
          `${Label} has ${plural(found.values, 'value that is', 'values that are each')} written in more than one way, differing in a final full stop, in spaces or in capital letters; ${plural(found.count, 'cell differs', 'cells differ')} from the usual spelling`,
          one(found.values, 'Pick one spelling for that value and use it in every cell, or a pivot table lists each spelling as its own row.', 'Pick one spelling for each value and use it in every cell, or a pivot table lists each spelling as its own row.'),
          where,
          found.examples.map((example) => ({ at: `${letter}${example.row}`, value: example.value })),
        );
      }
    }

    // repeated-id.
    const repeats = repeatedId(cells, dataStart, skip, s, heading);
    if (repeats) {
      const [where, examples] = collect((kind, cls, text, row) => Boolean(cls & TOKEN) && (repeats.seen.get(text.trim()) ?? 0) >= 2 && inData(row));
      add(
        'repeated-id',
        'look',
        column,
        repeats.count,
        `In column ${letter}${named(column) ? ` (${short(named(column))})` : ''}, ${plural(repeats.values, 'value appears', 'values appear')} more than once, in ${plural(repeats.count, 'cell')}, while every other value appears once`,
        'If each row should have its own value here, check those rows: one of them may have been entered twice.',
        where,
        examples,
      );
    }

    // error-cells. At least 1 cell.
    if (s.errors >= 1) {
      const [where, examples] = collect((kind) => kind === ERROR);
      add('error-cells', 'fix', column, s.errors, `${Label} has ${plural(s.errors, 'cell')} that ${s.errors === 1 ? 'shows' : 'show'} an error code where a value should be`, csv ? one(s.errors, 'Fix that cell in the program the file came from, or clear it, so a script does not read the code as a value.', 'Fix those cells in the program the file came from, or clear them, so a script does not read the codes as values.') : one(s.errors, 'Fix the formula or clear that cell. One error cell turns a sum of the whole column into an error.', 'Fix the formulas or clear those cells. One error cell turns a sum of the whole column into an error.'), where, examples);
    }

    // decimal-comma (CSV only).
    if (csv && s.comma >= COMMA_CELLS && atLeast(s.comma + s.num, MOSTLY, s.n)) {
      const [where, examples] = collect((kind, cls, text, row) => kind === COMMANUM && inData(row));
      add('decimal-comma', 'fix', column, s.comma, `${Label} has ${plural(s.comma, 'cell')} where the decimal point is written as a comma`, 'Tell your spreadsheet program or script that this file uses a decimal comma, or rewrite the amounts with a decimal point.', where, examples);
    }
  }

  // ---- The rules that look at the whole sheet ----
  const rowsNamed = (rows) => rows.slice(0, SHOWN).map((row) => `row ${n(row)}`);

  // merged-cells. At least 1 merged range. Above the headings only: worth a look. In the headings or the data: to fix.
  if (grid.merges.length) {
    const above = grid.merges.filter((merge) => H && merge.bottom < headTop).length;
    const inHeadings = grid.merges.filter((merge) => H && merge.top <= headBottom && merge.bottom >= headTop).length;
    const inData = grid.merges.length - above - inHeadings;
    const parts = [[above, 'above the headings'], [inHeadings, 'in the headings'], [inData, 'in the rows of data']].filter(([count]) => count > 0);
    const count = grid.merges.length;
    add(
      'merged-cells',
      inHeadings + inData > 0 ? 'fix' : 'look',
      0,
      count,
      parts.length === 1 ? `${here} has ${plural(count, 'merged range')} ${parts[0][1]}` : `${here} has ${plural(count, 'merged range')}: ${list(parts.map(([cells, where]) => `${n(cells)} ${where}`))}`,
      `Unmerge ${one(count, 'it', 'them')}${inHeadings + inData > 0 ? ' and give each cell its own value. A merged range keeps its value in one cell and leaves the others empty.' : ', or tell your script which row holds the headings.'}`,
      grid.merges.slice(0, SHOWN).map((merge) => merge.ref),
    );
  }

  // blank-rows. At least 1 fully empty row between the headings and the last row that holds something.
  if (blankRows.length) {
    add('blank-rows', 'fix', 0, blankRows.length, `${here} has ${plural(blankRows.length, 'fully empty row')} inside the data`, `Delete the empty ${one(blankRows.length, 'row', 'rows')}. A spreadsheet program takes the first empty row as the end of the data.`, rowsNamed(blankRows));
  }

  // total-row. A row that a table names as its totals, or that adds up its own columns, or that starts with a word like "Total".
  if (totalRows.length) {
    add('total-row', 'fix', 0, totalRows.length, `${here} has ${plural(totalRows.length, 'row that adds', 'rows that add')} up other rows`, `Delete or move ${one(totalRows.length, 'that row', 'those rows')} before you build a pivot table or run a script, so each amount is counted once.`, rowsNamed(totalRows), totalLabels);
  }

  // repeated-heading. The same heading on 2 columns or more; or the row of headings written again inside the data.
  const sameHeading = new Map();
  for (const column of columns) {
    const key = headingFold.get(column);
    if (key !== undefined) sameHeading.set(key, [...(sameHeading.get(key) ?? []), column]);
  }
  const shared = [...sameHeading.values()].filter((group) => group.length > 1);
  if (shared.length) {
    const cells = shared.flat();
    const names = shared.map((group) => `"${short(headings.get(group[0]))}"`);
    add(
      'repeated-heading',
      'fix',
      0,
      cells.length,
      !sure
        ? `${here} uses ${shared.length === 1 ? 'the same heading' : `${plural(shared.length, 'heading')}`} on ${shared.length === 1 ? plural(cells.length, 'column') : 'more than one column each'}`
        : shared.length === 1
          ? `${here} uses the heading ${names[0]} on ${plural(cells.length, 'column')}`
          : `${here} uses ${plural(shared.length, 'heading')} on more than one column each: ${list(names.slice(0, SHOWN))}${names.length > SHOWN ? ' and others' : ''}`,
      'Give each column its own heading. A pivot table or a script picks a column by its heading.',
      cells.slice(0, SHOWN).map((column) => `${letters(column)}${H}`),
    );
  }
  if (headingAgain.length) {
    add('repeated-heading', 'fix', 0, headingAgain.length, `${here} repeats its row of headings inside the data in ${plural(headingAgain.length, 'row')}`, one(headingAgain.length, 'Delete that row. A script reads it as a row of data.', 'Delete those rows. A script reads them as rows of data.'), rowsNamed(headingAgain));
  }

  // empty-heading. A column that holds at least 1 cell of data and has no heading; or a sheet with no row of headings at all.
  if (!H) {
    add('empty-heading', 'fix', 0, columns.length, `This check found no row of headings on ${hereLower}, which has ${plural(columns.length, 'column')} of data`, 'Put one row of headings above the data, with a heading for each column.', []);
  } else if (empty.length) {
    add('empty-heading', 'fix', empty.length === 1 ? empty[0] : 0, empty.length, `${here} has ${plural(empty.length, 'column that holds', 'columns that hold')} data under an empty heading`, `Type a heading above ${one(empty.length, 'it', 'each of them')}. A pivot table refuses a range that has an empty heading.`, empty.slice(0, SHOWN).map((column) => `${letters(column)}${H}`));
  }

  // two-heading-rows.
  if (headingRows.length === 2) {
    add('two-heading-rows', 'fix', 0, 2, `${here} has two rows of headings`, 'Join them into one row, so each column has a single heading. A pivot table and most scripts read one row of headings.', rowsNamed(headingRows));
  }

  // uneven-rows (CSV only). At least 1 row under the headings with more or fewer fields than the row of headings.
  if (csv) {
    let width = headWidth;
    if (!H) {
      // With no row of headings, the width most rows have is the one to compare with.
      const seen = new Map();
      for (const fields of grid.widths) if (fields) seen.set(fields, (seen.get(fields) ?? 0) + 1);
      width = [...seen].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    }
    const uneven = [];
    for (let row = dataStart; row < grid.widths.length; row++) if (grid.widths[row] && grid.widths[row] !== width) uneven.push(row);
    if (uneven.length) {
      add(
        'uneven-rows',
        'fix',
        0,
        uneven.length,
        `This file has ${plural(uneven.length, 'row')} with more or fewer fields than the ${H ? 'row of headings, which has' : 'other rows, which have'} ${n(width)}`,
        `Look on ${one(uneven.length, 'that row', 'those rows')} for a stray separator or a line break inside a value. A value that holds the separator must sit inside quotation marks.`,
        rowsNamed(uneven),
      );
    }
  }

  return { info, findings };
}
