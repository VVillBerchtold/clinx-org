// Reads an .xlsx workbook, says what is in it, and writes a stand-in copy.
//
// In plain words: the stand-in copy has the same sheets, column headings, formats and formulas as
// the original, but every value under the headings is randomized (see fake.js). The parts of a
// workbook that sit outside its cells are handled too: the pivot table's own copy of the data, the
// saved results of formulas, comments, the author's name, links to other files. The report lists
// what was found, where, how much, and what was done with it. Nothing is sent anywhere: this file
// has no way to make a connection.
//
// The parts are read with patterns (see xml.js), not with a full reader of the format.

import { readZip, text as partText, unpack, writeZip } from './zip.js';
import { makeFaker } from './fake.js';
import { codeLabel, makeCoder } from './code.js';
import { scrubConnections } from './connections.js';
import { describeSheet } from './describe.js';
import { nameProblem, sheetRenamer } from './rename.js';
import { CELLS, FORMULA, HAS_FORMULA, RELATIONSHIPS, STRING_ITEMS, TEXT_RUNS, VALUE, attr, columnNumber, dateStyles, decodeXml, dropAttr, encodeAttr, encodeXml, letters, readStrings, rx, setAttr, stringText, swap } from './xml.js';

/** Formulas that reach outside the workbook or run a program. Listed, never run. */
const REACHES_OUT = [
  [/\bWEBSERVICE\s*\(/i, 'asks a web address for data (WEBSERVICE)'],
  [/\bFILTERXML\s*\(/i, 'reads data fetched from the web (FILTERXML)'],
  [/\bRTD\s*\(/i, 'asks another program for live data (RTD)'],
  [/\b(?:CALL|REGISTER|EXEC)\s*\(/i, 'can run code outside the workbook (CALL, REGISTER or EXEC)'],
  [/(?:^|[=+\-(,])\s*'?[A-Za-z][\w.]*'?\|[^!]+!/, 'asks another program to run a command (a DDE link)'],
];

/** One pass over a sheet. With `change`, returns the rewritten sheet; without, only what was found. */
function walkSheet(xml, ctx, sheet, change) {
  let row = 0;
  let column = 0;
  const visit = (all, rowAttrs, cellAttrs, inner) => {
    if (cellAttrs === undefined) {
      row = Number(attr(rowAttrs, 'r') ?? row + 1);
      column = 0;
      return all;
    }
    const ref = attr(cellAttrs, 'r');
    column = ref ? columnNumber(ref.replace(/\d+/g, '')) : column + 1;
    if (ref) row = Number(ref.replace(/\D+/g, '')) || row;
    if (inner === undefined) return all;
    const type = attr(cellAttrs, 't');
    const formula = HAS_FORMULA.test(inner);
    const value = VALUE.exec(inner)?.[2];
    const kind = formula ? 'formula' : type === 's' || type === 'inlineStr' || type === 'str' ? 'text' : type === 'b' ? 'yes/no' : type === 'e' ? 'error' : value === undefined ? 'blank' : type === 'd' || ctx.dates[Number(attr(cellAttrs, 's') ?? 0)] ? 'date' : 'number';
    // Text typed into the cell itself, in one or more pieces of formatting; a reading guide (rPh) is not part of it.
    const inlineText = () => stringText(inner);
    const shown = () => (type === 's' ? ctx.strings[Number(value)] ?? '' : type === 'inlineStr' ? inlineText() : decodeXml(value ?? ''));

    if (!change) {
      // Finding out: which row holds the headings, and what each column under it holds.
      if (sheet.headerRows === undefined) {
        if (row <= 60) {
          const tally = (sheet.early[row] ??= { cells: 0, text: 0 });
          if (kind !== 'blank') tally.cells++;
          if (kind === 'text') tally.text++;
        }
        // The early rows, and any row a table names as its headings, are remembered: one of them holds the headings.
        if (row <= 60 || sheet.tableRows.has(row)) (sheet.seen[row] ??= []).push({ column, text: shown(), index: type === 's' ? Number(value) : -1, formula });
        return all;
      }
      if (sheet.headerRows.has(row)) {
        sheet.headings[column] ??= shown();
        // A heading worked out by a formula is not kept as wording: its saved result may be a value from a cell.
        if (!formula) {
          if (type === 's') ctx.keptStrings.add(Number(value));
          ctx.keptTexts.add(shown());
        }
      } else if (row < sheet.headerRow) {
        sheet.above++;
        if (kind === 'text') {
          ctx.replValues.add(shown());
          if (type === 's') ctx.replIdx.add(Number(value));
        }
      } else if (kind !== 'blank') {
        const stats = (sheet.columns[column] ??= { text: 0, number: 0, date: 0, formula: 0, 'yes/no': 0, error: 0, first: row, last: row, different: new Set(), alsoHeading: 0 });
        if (kind === 'text') {
          const text = shown();
          if (sheet.keep.has(column)) {
            ctx.keepValues.add(text);
            if (type === 's') ctx.keepIdx.add(Number(value));
          } else if (sheet.wantCode.has(column)) {
            // Asked to be coded. Whether the column can be is known only once all of it has been read.
            const asked = (sheet.asked[column] ??= { texts: new Set(), idx: new Set(), numbers: new Set() });
            asked.texts.add(text);
            if (type === 's') asked.idx.add(Number(value));
          } else {
            ctx.replValues.add(text);
            if (type === 's') ctx.replIdx.add(Number(value));
          }
          // A cell under the headings that holds the very words of a heading: it is a value, and is counted so the person can be told.
          if (text !== '' && ctx.keptTexts.has(text)) stats.alsoHeading++;
        }
        if (kind === 'number' && ctx.coding) {
          if (sheet.wantCode.has(column)) (sheet.asked[column] ??= { texts: new Set(), idx: new Set(), numbers: new Set() }).numbers.add(value);
          // Whole numbers that are really in the file: a code that counts from 1 passes over them.
          const whole = Number(value);
          if (Number.isInteger(whole) && whole > 0 && whole < 10000000) ctx.realWhole.add(whole);
        }
        stats[kind]++;
        stats.last = row;
        if (kind !== 'formula' && stats.different.size < 5000) stats.different.add(value ?? inlineText());
        if (kind === 'date' && type !== 'd') {
          ctx.dateFirst = Math.min(ctx.dateFirst, Number(value));
          ctx.dateLast = Math.max(ctx.dateLast, Number(value));
        }
      }
      if (formula) {
        const written = decodeXml(FORMULA.exec(inner)?.[2] ?? '');
        for (const [pattern, meaning] of REACHES_OUT) if (pattern.test(written)) ctx.sniff.push({ what: `A formula that ${meaning}`, where: `${sheet.name}!${letters(column)}${row}`, detail: written.slice(0, 120) });
      }
      return all;
    }

    // Changing: everything that is not the heading row gets a stand-in.
    if (sheet.headerRows.has(row) && !formula) return all;
    if (sheet.keep.has(column) && row > sheet.headerRow && !formula) {
      if (kind !== 'blank') ctx.done.kept++;
      return all;
    }
    const open = all.slice(0, all.indexOf('>') + 1);
    const close = all.slice(all.lastIndexOf('</'));
    if (formula) {
      ctx.done.formulaResults += value === undefined ? 0 : 1;
      const kept = inner.replace(VALUE, '').replace(FORMULA, (_, a, body, c) => a + encodeXml(ctx.formula(decodeXml(body), `${sheet.name}!${letters(column)}${row}`)) + c);
      return open + kept + close;
    }
    // A column the person asked to have coded: each different value gets its code. A cell with no code
    // (a date, an empty text) falls through and is given a randomized value like any other.
    const codes = row > sheet.headerRow ? sheet.code.get(column) : undefined;
    if (codes && kind === 'text') {
      const code = codes.text(shown());
      const to = type === 's' ? ctx.codeIdx.get(code) : code;
      if (code !== undefined && to !== undefined) {
        ctx.done.coded++;
        if (type === 'inlineStr') return open + inner.replace(rx('<(~)is\\b[^>]*>[\\s\\S]*<\\/~is>', ''), (_, prefix) => `<${prefix}is><${prefix}t xml:space="preserve">${encodeXml(code)}</${prefix}t></${prefix}is>`) + close;
        return open + inner.replace(VALUE, (_, a, body, c) => a + (type === 's' ? to : encodeXml(code)) + c) + close;
      }
    }
    if (codes && kind === 'number') {
      const code = codes.number(value);
      if (code !== undefined) {
        ctx.done.coded++;
        return open + inner.replace(VALUE, (_, a, body, c) => a + code + c) + close;
      }
    }
    if (kind === 'text') {
      ctx.done.text++;
      if (type === 's') {
        // The shared list of strings is rewritten once, for every sheet. A text that a heading or a kept
        // column also uses stays in that list for them; this cell is pointed at the stand-in added for it.
        const to = ctx.repoint.get(Number(value));
        return to === undefined ? all : open + inner.replace(VALUE, (_, a, body, c) => a + to + c) + close;
      }
      // The whole text gets one stand-in, the same one it has everywhere else, written as a single piece.
      if (type === 'inlineStr') return open + inner.replace(rx('<(~)is\\b[^>]*>[\\s\\S]*<\\/~is>', ''), (_, prefix) => `<${prefix}is><${prefix}t xml:space="preserve">${encodeXml(ctx.faker.text(inlineText()))}</${prefix}t></${prefix}is>`) + close;
      return open + inner.replace(VALUE, (_, a, body, c) => a + encodeXml(ctx.faker.text(decodeXml(body))) + c) + close;
    }
    if (kind === 'date') {
      ctx.done.date++;
      return open + inner.replace(VALUE, (_, a, body, c) => a + (type === 'd' ? ctx.faker.text(body) : ctx.faker.date(body)) + c) + close;
    }
    if (kind === 'number') {
      ctx.done.number++;
      return open + inner.replace(VALUE, (_, a, body, c) => a + ctx.faker.number(body) + c) + close;
    }
    return all;
  };
  if (change) return xml.replace(CELLS, visit);
  for (const m of xml.matchAll(CELLS)) visit(m[0], m[1], m[2], m[3]);
  return xml;
}

/** True when a column can be coded: it holds text or numbers, and no dates or formulas. */
const canCode = (stats) => Boolean(stats) && stats.date === 0 && stats.formula === 0 && stats.text + stats.number > 0;

/** The row that holds the column headings: the first row that is mostly text and about as wide as the table. */
function findHeaderRow(early) {
  const rows = Object.entries(early).map(([r, t]) => ({ row: Number(r), ...t }));
  const widest = Math.max(0, ...rows.map((r) => r.cells));
  const found = rows.sort((a, b) => a.row - b.row).find((r) => r.text >= Math.max(1, Math.ceil(widest * 0.6)) && r.text >= r.cells * 0.8);
  return found?.row ?? 0;
}

/** Power Query: the queries built into a workbook, pulled out as the text they were written in. */
async function readQueries(xml) {
  const packed = /<DataMashup\b[^>]*>([^<]+)<\/DataMashup>/.exec(xml)?.[1];
  if (!packed) return [];
  const bytes = Uint8Array.from(atob(packed.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  const length = new DataView(bytes.buffer).getUint32(4, true);
  const inner = readZip(bytes.subarray(8, 8 + length));
  const code = inner.find((part) => /^Formulas\/.*\.m$/i.test(part.name));
  if (!code) return [];
  const written = await partText(code);
  const names = [...written.matchAll(/^\s*shared\s+(#"[^"]+"|[\w.]+)\s*=/gm)].map((m) => m[1].replace(/^#"|"$/g, ''));
  return [{ names, code: written }];
}

const basename = (path) => path.slice(path.lastIndexOf('/') + 1);
/** Where a part's link leads, worked out from the part that holds the link. */
function resolve(from, target) {
  if (target.startsWith('/')) return target.slice(1);
  const steps = from.split('/').slice(0, -1);
  for (const step of target.split('/')) step === '..' ? steps.pop() : step !== '.' && steps.push(step);
  return steps.join('/');
}
const relsOf = (path) => `${path.slice(0, path.lastIndexOf('/') + 1)}_rels/${basename(path)}.rels`;
/** The part a file of links belongs to: xl/_rels/workbook.xml.rels belongs to xl/workbook.xml. */
const ownerOf = (rels) => rels.replace(/(^|\/)_rels\/([^/]*)\.rels$/, '$1$2');

/**
 * Reads a workbook. Returns the report and, unless `only` is "report", the bytes of the stand-in copy.
 *
 * `keep` names the columns to leave alone, by sheet: { Claims: ['E', 'G'] }. `code` names, in the
 * same way, the columns whose values are to become short codes; the legend that says which code is
 * which original is given back beside the copy and never written into it. `rename` gives sheets
 * new names: { Claims: 'Sheet A' }. `swapText` lists texts from the report's "for a look" list to
 * replace wherever they are written. `dropExtras` takes out data another program stored in the file.
 */
export async function standInWorkbook(bytes, { only, keep = {}, code = {}, rename = {}, swapText = [], dropExtras = true } = {}) {
  const parts = readZip(bytes);
  const byName = new Map(parts.map((part) => [part.name, part]));
  const read = async (name) => (byName.has(name) ? partText(byName.get(name)) : undefined);
  const changed = new Map();
  // When only the report is wanted, the same work is done, so that the report is whole, but nothing of it is held on to.
  const put = (name, value) => {
    if (only !== 'report') changed.set(name, value);
  };
  // Parts left out of the copy altogether.
  const dropped = new Set();

  const ctx = {
    strings: readStrings((await read('xl/sharedStrings.xml')) ?? ''),
    dates: dateStyles((await read('xl/styles.xml')) ?? ''),
    keptStrings: new Set(),
    keptTexts: new Set(),
    dateFirst: Infinity,
    dateLast: -Infinity,
    sniff: [],
    flagged: [],
    done: { text: 0, number: 0, date: 0, formulaResults: 0 },
    faker: makeFaker(),
  };
  // No stand-in may equal a real text from this workbook.
  ctx.faker.avoid(ctx.strings);
  // Columns the person chose to leave alone. A text is left alone outside the cells too only if it
  // sits in such a column and in no column that is being replaced.
  Object.assign(ctx, { keepValues: new Set(), replValues: new Set(), keepIdx: new Set(), replIdx: new Set(), keptByChoice: new Set(), repoint: new Map() });
  // A heading's words are kept where they are a heading. The same words in a cell of a replaced column are a value, and are not kept.
  ctx.isKept = (value) => (ctx.keptTexts.has(value) && !ctx.replValues.has(value)) || ctx.keptByChoice.has(value);
  // Text written in a formula, a drop-down list or a filter is the workbook's own wording, not a row of data:
  // it stays if it is a heading or a value of any column the person chose to keep.
  ctx.inKeptColumn = (value) => ctx.keptTexts.has(value) || ctx.keepValues.has(value);
  ctx.done.kept = 0;
  ctx.done.coded = 0;
  // Columns the person asked to have coded, and the legend of their codes.
  Object.assign(ctx, { coder: makeCoder(), coding: Object.keys(code).length > 0, realWhole: new Set(), codeIdx: new Map() });
  // Texts the person asked to have replaced wherever they are written (from the report's list for a look).
  ctx.swap = new Set(swapText);
  /** The stand-in for a text met outside the cells: one is given when the text is also a cell's value, or the person asked. */
  // (A formula can also name a saved connection; where a connection gets a new name, that text follows it.)
  ctx.standIn = (value) => ctx.coder.textFor(value) ?? (ctx.faker.knows(value) || ctx.swap.has(value) ? ctx.faker.text(value) : (ctx.connectionNames.get(value) ?? null));
  // A value met outside the cells. `tie` says which column it belongs to, where the file says so: a value
  // of a coded column gets that column's code, and a value of any other column a randomized value. Where
  // the file does not say, a value that has a code anywhere gets that code.
  ctx.outsideText = (value, tie) => (tie?.set ? tie.set.text(value) : tie ? undefined : (ctx.coder.textFor(value) ?? undefined)) ?? ctx.faker.text(value);
  ctx.outsideNumber = (written, tie) => (tie?.set ? tie.set.number(written) : tie ? undefined : (ctx.coder.numberFor(written) ?? undefined)) ?? ctx.faker.number(written);
  ctx.tie = (sheet, column) => (sheet.code.has(column) ? { set: sheet.code.get(column) } : { random: true });
  ctx.flag = (what, where, detail) => ctx.flagged.push({ what, where, detail });
  // A piece of text written inside a formula is replaced only when the same text is also a value
  // in a cell, so that =IF(E4="Medicaid",…) still agrees with the cells. Anything else is left
  // alone (it may be a number format) and listed for a person to look at.
  ctx.literals = (formula, where) =>
    formula.replace(/"((?:[^"]|"")*)"/g, (all, body) => {
      const value = body.replace(/""/g, '"');
      if (value === '' || ctx.inKeptColumn(value)) return all;
      const made = ctx.standIn(value);
      if (made !== null) return `"${made.replace(/"/g, '""')}"`;
      ctx.flag('Text written inside a formula or a name', where, value);
      return all;
    });
  /** One choice of a list typed into the sheet. Spaces around a choice are not part of it. */
  ctx.choice = (written, where) => {
    const choice = written.trim();
    if (choice === '' || ctx.inKeptColumn(choice)) return written;
    const made = ctx.standIn(choice);
    if (made !== null) return written.replace(choice, () => made);
    ctx.flag('A choice in a list typed into the sheet', where, choice);
    return written;
  };

  const outside = [];
  const note = (what, where, count, action) => outside.push({ what, where, count, action });

  // The sheets, by name.
  const workbook = (await read('xl/workbook.xml')) ?? '';
  const workbookRels = (await read('xl/_rels/workbook.xml.rels')) ?? '';
  const target = new Map([...workbookRels.matchAll(RELATIONSHIPS)].map((m) => [attr(m[1], 'Id'), attr(m[1], 'Target')]));
  const sheets = [...workbook.matchAll(rx('<~sheet\\b([^>]*?)\\/?>'))].map((m) => {
    const to = target.get(attr(m[1], 'r:id')) ?? '';
    return { name: decodeXml(attr(m[1], 'name') ?? ''), state: attr(m[1], 'state') ?? 'visible', path: to.startsWith('/') ? to.slice(1) : `xl/${to}`, early: {}, seen: {}, tableRows: new Set(), headings: {}, labels: {}, headingsFrom: 'none', columns: {}, above: 0, tables: 0, keep: new Set(), wantCode: new Set(), asked: {}, code: new Map() };
  });
  const sheetNamed = (name) => sheets.find((sheet) => sheet.name.toLowerCase() === name.toLowerCase());
  for (const sheet of sheets) sheet.keep = new Set((keep[sheet.name] ?? []).map((letter) => columnNumber(String(letter).toUpperCase())));
  // A column named both to be left alone and to be coded is left alone.
  for (const sheet of sheets) sheet.wantCode = new Set((code[sheet.name] ?? []).map((letter) => columnNumber(String(letter).toUpperCase())).filter((column) => !sheet.keep.has(column)));
  // New names for sheets. Every formula, list, chart and link that names a renamed sheet follows.
  const renamer = sheetRenamer(sheets.map((sheet) => sheet.name), rename);
  for (const sheet of sheets) sheet.newName = renamer.one(sheet.name) ?? sheet.name;
  // A renaming that cannot be carried out stops the work: a copy that kept the old name would not be what was asked for.
  for (const [from, to] of Object.entries(rename)) {
    const sheet = sheets.find((s) => s.name.toLowerCase() === from.toLowerCase());
    if (!sheet) throw new Error(`There is no sheet named "${from}" in this workbook.`);
    const problem = to === sheet.name ? null : nameProblem(to, sheets.filter((s) => s !== sheet).map((s) => s.newName));
    if (problem) throw new Error(`The sheet "${sheet.name}" cannot be given that name. ${problem}`);
  }
  ctx.formula = (formula, where) => ctx.literals(renamer.inFormula(formula), where);
  // Saved connections are read before the sheets, so that a formula that names one can follow its new name.
  const connectionsXml = await read('xl/connections.xml');
  const connections = connectionsXml === undefined ? undefined : scrubConnections(connectionsXml, { inFormula: renamer.inFormula });
  ctx.connectionNames = connections?.names ?? new Map();
  const leftBehind = new Set(connections?.originals ?? []);
  const hasMacros = parts.some((part) => /vbaProject\.bin$/i.test(part.name));

  // First look: where the headings are. The headings of every sheet are found before any value is
  // looked at, so that a cell holding the same words as a heading can be told from the heading.
  const sheetXml = new Map();
  const tableSheet = new Map();
  for (const sheet of sheets) {
    const xml = await read(sheet.path);
    if (xml === undefined) {
      Object.assign(sheet, { headerRows: new Set(), headerRow: 0, headingsFrom: 'none' });
      continue;
    }
    sheetXml.set(sheet.path, xml);
    // A sheet laid out as a table says for itself which row holds the headings. That is trusted
    // over a guess, and the table's column names are kept so the table still matches its sheet.
    const tableRows = sheet.tableRows;
    for (const m of ((await read(relsOf(sheet.path))) ?? '').matchAll(RELATIONSHIPS)) {
      if (!/\/table$/.test(attr(m[1], 'Type') ?? '')) continue;
      const tableXml = await read(resolve(sheet.path, attr(m[1], 'Target') ?? ''));
      if (tableXml === undefined) continue;
      tableSheet.set(resolve(sheet.path, attr(m[1], 'Target') ?? ''), sheet);
      const root = rx('<~table\\b([^>]*)>', '').exec(tableXml)?.[1] ?? '';
      const first = Number(/[A-Z]+(\d+)/.exec(attr(root, 'ref') ?? '')?.[1]);
      if ((attr(root, 'headerRowCount') ?? '1') !== '0' && first) tableRows.add(first);
      for (const c of tableXml.matchAll(rx('<~tableColumn\\b([^>]*?)\\/?>'))) ctx.keptTexts.add(decodeXml(attr(c[1], 'name') ?? '').replace(/_x000[aAdD]_/g, '\n'));
      sheet.tables++;
    }
    walkSheet(xml, ctx, sheet, false);
    const guessed = findHeaderRow(sheet.early);
    sheet.headerRows = tableRows.size ? tableRows : new Set(guessed ? [guessed] : []);
    sheet.headerRow = sheet.headerRows.size ? Math.min(...sheet.headerRows) : 0;
    sheet.headingsFrom = tableRows.size ? 'table' : guessed ? 'guess' : 'none';
    for (const row of sheet.headerRows) {
      for (const cell of sheet.seen[row] ?? []) {
        sheet.headings[cell.column] ??= cell.text;
        // A heading worked out by a formula is not kept as wording: its saved result may be a value from a cell.
        if (cell.formula) continue;
        sheet.labels[cell.column] ??= cell.text;
        if (cell.index >= 0) ctx.keptStrings.add(cell.index);
        ctx.keptTexts.add(cell.text);
      }
    }
    sheet.seen = {};
  }
  // Second look: what sits under the headings.
  for (const sheet of sheets) {
    const xml = sheetXml.get(sheet.path);
    if (xml === undefined) continue;
    walkSheet(xml, ctx, sheet, false);
    if (sheet.state !== 'visible') ctx.sniff.push({ what: sheet.state === 'veryHidden' ? 'A sheet hidden so that the menus cannot show it' : 'A hidden sheet', where: sheet.name, detail: Object.keys(sheet.columns).length === 1 ? '1 column of values' : `${Object.keys(sheet.columns).length} columns of values` });
  }
  ctx.faker.setDateRange(ctx.dateFirst, ctx.dateLast);
  // The columns to be coded. A column that holds dates or formulas cannot be, and is given randomized values instead.
  const sharedCodes = [];
  for (const sheet of sheets) {
    for (const [number, asked] of Object.entries(sheet.asked)) {
      const column = Number(number);
      if (!canCode(sheet.columns[column])) {
        for (const text of asked.texts) ctx.replValues.add(text);
        for (const index of asked.idx) ctx.replIdx.add(index);
        continue;
      }
      // The codes are built from the heading as it is written. A heading worked out by a formula is not used: it may show a value.
      const set = ctx.coder.setFor(codeLabel(sheet.labels[column], letters(column)));
      sheet.code.set(column, set);
      set.places.push(`${sheet.name}, column ${letters(column)}`);
      for (const text of asked.texts) {
        set.wantText(text);
        ctx.replValues.add(text);
      }
      for (const written of asked.numbers) set.wantNumber(written);
      for (const index of asked.idx) sharedCodes.push([set, index]);
    }
  }
  if (ctx.coder.size) {
    // No code may equal a real text or a real whole number of this workbook, and no randomized value may equal a code.
    const real = new Set([...ctx.strings, ...ctx.replValues, ...ctx.keepValues, ...ctx.keptTexts]);
    ctx.coder.assign((text) => real.has(text), (whole) => ctx.realWhole.has(whole));
    ctx.faker.avoid(ctx.coder.textCodes());
  }
  for (const value of ctx.keepValues) if (!ctx.replValues.has(value)) ctx.keptByChoice.add(value);

  // The shared list of strings: everything that is not a heading gets a stand-in.
  const stringsXml = await read('xl/sharedStrings.xml');
  let keptAsHeading = 0;
  if (stringsXml !== undefined) {
    let index = -1;
    const added = [];
    const item = (tag, value) => `<${tag}><${tag.replace('si', 't')} xml:space="preserve">${encodeXml(ctx.faker.text(value))}</${tag.replace('si', 't')}></${tag}>`;
    let tag;
    let rewritten = stringsXml.replace(STRING_ITEMS, (all) => {
      index++;
      tag ??= all.slice(1, all.search(/[\s>/]/));
      const value = ctx.strings[index] ?? '';
      const heading = ctx.keptStrings.has(index);
      const replaced = ctx.replIdx.has(index);
      if (heading || ctx.keepIdx.has(index)) {
        if (heading) keptAsHeading++;
        if (replaced) {
          // Used by a heading or a kept column, and by a cell that is replaced: the original stays here
          // for the first, and a stand-in is added at the end for the second.
          ctx.repoint.set(index, ctx.strings.length + added.length);
          added.push(item(all.slice(1, all.search(/[\s>/]/)), value));
        }
        return all;
      }
      // An entry no replaced cell points at stays when its words are a heading's or a kept column's.
      if (!replaced && ctx.isKept(value)) {
        keptAsHeading += ctx.keptByChoice.has(value) ? 0 : 1;
        return all;
      }
      return item(all.slice(1, all.search(/[\s>/]/)), value);
    });
    // The codes that cells of this list will point at are added at its end, each once.
    for (const [set, at] of sharedCodes) {
      const made = set.text(ctx.strings[at] ?? '');
      if (made === undefined || ctx.codeIdx.has(made)) continue;
      ctx.codeIdx.set(made, ctx.strings.length + added.length);
      added.push(`<${tag}><${tag.replace('si', 't')} xml:space="preserve">${encodeXml(made)}</${tag.replace('si', 't')}></${tag}>`);
    }
    if (added.length) rewritten = rewritten.replace(/<\/[\w:]*sst>\s*$/, (end) => added.join('') + end).replace(/\buniqueCount="(\d+)"/, (_, was) => `uniqueCount="${Number(was) + added.length}"`);
    put('xl/sharedStrings.xml', rewritten);
  }

  // The values ticked in a filter. A filter sits on one column, and its values are treated as that column's cells are.
  const oneFilter = (all, attrs, tie, count) => {
    const value = attr(attrs, 'val');
    if (value === undefined || ctx.inKeptColumn(decodeXml(value))) return all;
    count();
    return swap(all, attrs, setAttr(attrs, 'val', encodeAttr(/^-?\d+(\.\d+)?$/.test(value) ? ctx.outsideNumber(value, tie) : ctx.outsideText(decodeXml(value), tie))));
  };
  const filterValues = (xml, sheet, count) =>
    xml.replace(rx('<~autoFilter\\b([^>]*?)(?<!\\/)>[\\s\\S]*?<\\/~autoFilter>|<~(?:filter|customFilter)\\b([^>]*?)(\\/?)>'), (all, filterAttrs, attrs) => {
      if (attrs !== undefined) return oneFilter(all, attrs, undefined, count);
      const first = columnNumber(/^\$?([A-Z]+)/.exec(attr(filterAttrs, 'ref') ?? '')?.[1] ?? 'A');
      return all.replace(rx('<~filterColumn\\b([^>]*?)(?<!\\/)>[\\s\\S]*?<\\/~filterColumn>|<~(?:filter|customFilter)\\b([^>]*?)(\\/?)>'), (block, columnAttrs, loose) => {
        if (loose !== undefined) return oneFilter(block, loose, undefined, count);
        const tie = sheet ? ctx.tie(sheet, first + Number(attr(columnAttrs, 'colId') ?? 0)) : undefined;
        return block.replace(rx('<~(?:filter|customFilter)\\b([^>]*?)(\\/?)>'), (one, oneAttrs) => oneFilter(one, oneAttrs, tie, count));
      });
    });

  // The sheets themselves.
  for (const sheet of sheets) {
    const xml = sheetXml.get(sheet.path);
    if (xml === undefined) continue;
    let out = walkSheet(xml, ctx, sheet, true);
    let cleared = 0;
    out = out.replace(rx('(<~(?:odd|even|first)(?:Header|Footer)>)([\\s\\S]*?)(<\\/~(?:odd|even|first)(?:Header|Footer)>)'), (_, a, body, c) => {
      if (body !== '') cleared++;
      return a + c;
    });
    if (cleared) note('Text printed on every page (headers and footers)', sheet.name, cleared, 'cleared');
    let lists = 0;
    let filters = 0;
    let rules = 0;
    let messages = 0;
    let scenarios = 0;
    let ranges = 0;
    const flaggedBefore = ctx.flagged.length;
    // A drop-down list typed into the sheet: each choice that is also a cell value gets that value's stand-in.
    // Any other formula of a drop-down or a checked cell is treated as a formula is.
    out = out.replace(rx('(<~formula[12]>)([\\s\\S]*?)(<\\/~formula[12]>)'), (all, a, body, c) => {
      if (body.includes('<')) return all; // the newer form wraps its formula in a tag of its own, handled below
      const written = decodeXml(body);
      if (!/^"[^"]*"$/.test(written)) {
        const next = ctx.formula(written, `a rule or a list on ${sheet.name}`);
        return next === written ? all : a + encodeXml(next) + c;
      }
      lists++;
      return `${a}${encodeXml(`"${written.slice(1, -1).split(',').map((choice) => ctx.choice(choice, sheet.name)).join(',')}"`)}${c}`;
    });
    // The newer form of the same things, kept in the sheet's extension list: a drop-down's choices, a colour rule's text.
    out = out.replace(/(<xm:f>)([\s\S]*?)(<\/xm:f>)/g, (all, a, body, c) => {
      const written = decodeXml(body);
      if (!written.includes('"')) {
        const next = renamer.inFormula(written);
        return next === written ? all : a + encodeXml(next) + c;
      }
      const single = /^"[^"]*"$/.test(written) ? written.slice(1, -1) : null;
      if (single !== null && single.includes(',') && !ctx.faker.knows(single)) {
        lists++;
        return `${a}${encodeXml(`"${single.split(',').map((choice) => ctx.choice(choice, sheet.name)).join(',')}"`)}${c}`;
      }
      return a + encodeXml(ctx.formula(written, `a rule or a list on ${sheet.name}`)) + c;
    });
    // A colour rule of the kind "the cell contains this text" holds the text a second time, as a setting.
    out = out.replace(rx('<~cfRule\\b([^>]*?)(\\/?)>'), (all, attrs) => {
      const value = attr(attrs, 'text');
      if (value === undefined) return all;
      const plain = decodeXml(value);
      if (plain === '' || ctx.inKeptColumn(plain)) return all;
      const made = ctx.standIn(plain);
      if (made !== null) {
        rules++;
        return swap(all, attrs, setAttr(attrs, 'text', encodeAttr(made)));
      }
      ctx.flag('Text a colour rule looks for', sheet.name, plain);
      return all;
    });
    // A sort order typed in as a list.
    out = out.replace(rx('<~sortCondition\\b([^>]*?)(\\/?)>'), (all, attrs) => {
      const value = attr(attrs, 'customList');
      if (value === undefined) return all;
      lists++;
      return swap(all, attrs, setAttr(attrs, 'customList', encodeAttr(decodeXml(value).split(',').map((choice) => ctx.choice(choice, sheet.name)).join(','))));
    });
    // The messages a drop-down or a checked cell shows: a title and a line of text, for the prompt and for the error.
    out = out.replace(rx('<~dataValidation\\b([^>]*?)(\\/?)>'), (all, attrs) => {
      let next = attrs;
      for (const name of ['promptTitle', 'prompt', 'errorTitle', 'error']) {
        const value = attr(next, name);
        if (value === undefined || value === '') continue;
        const plain = decodeXml(value);
        if (ctx.inKeptColumn(plain)) continue;
        const made = ctx.standIn(plain);
        if (made !== null) {
          messages++;
          next = setAttr(next, name, encodeAttr(made));
        } else ctx.flag('A message a cell shows when it is chosen or filled in wrongly', sheet.name, plain);
      }
      return next === attrs ? all : swap(all, attrs, next);
    });
    // Saved "what if" sets of values, with the name of the person who saved each: taken out whole.
    out = out.replace(rx('<~scenarios\\b[^>]*?(?:\\/>|>[\\s\\S]*?<\\/~scenarios>)'), () => {
      scenarios++;
      return '';
    });
    // Ranges some people may edit: each has a name someone typed, and can hold the accounts allowed to edit.
    let range = 0;
    out = out.replace(rx('<~protectedRange\\b([^>]*?)(\\/?)>'), (all, attrs) => {
      ranges++;
      range++;
      return swap(all, attrs, setAttr(attrs.replace(/\s(?:securityDescriptor)="[^"]*"/g, ''), 'name', `Range${range}`));
    });
    // A filter remembers the values that were ticked. They are values like any other.
    out = filterValues(out, sheet, () => filters++);
    // A rule that colours cells can hold text to compare against.
    out = out.replace(rx('(<~formula>)([\\s\\S]*?)(<\\/~formula>)'), (all, a, body, c) => (body.includes('<') ? all : a + encodeXml(ctx.formula(decodeXml(body), `a colour rule on ${sheet.name}`)) + c));
    // A link can carry its address a second time, as the text to show. A link to a place in this workbook names a sheet.
    out = out.replace(rx('<~hyperlink\\b([^>]*?)(\\/?)>'), (all, attrs) => {
      let next = attrs.replace(/\s(?:display|tooltip)="[^"]*"/g, '');
      const place = attr(next, 'location');
      if (place !== undefined && renamer.size) next = setAttr(next, 'location', encodeAttr(renamer.inFormula(decodeXml(place))));
      return swap(all, attrs, next);
    });
    if (renamer.size) {
      // Values gathered from other sheets name those sheets.
      out = out.replace(rx('<~dataRef\\b([^>]*?)(\\/?)>'), (all, attrs) => {
        const next = renamer.one(decodeXml(attr(attrs, 'sheet') ?? ''));
        return next === undefined ? all : swap(all, attrs, setAttr(attrs, 'sheet', encodeAttr(next)));
      });
      // A sheet can carry a second name that only macros use. Where there are no macros and it repeats the old name, it goes.
      if (!hasMacros && sheet.newName !== sheet.name) out = out.replace(rx('<~sheetPr\\b([^>]*?)(\\/?)>', ''), (all, attrs) => (decodeXml(attr(attrs, 'codeName') ?? '').toLowerCase() === sheet.name.toLowerCase() ? swap(all, attrs, dropAttr(attrs, 'codeName')) : all));
    }
    const unknownChoices = ctx.flagged.slice(flaggedBefore).filter((f) => f.what === 'A choice in a list typed into the sheet').map((f) => f.detail);
    if (lists) note('A drop-down list typed into the sheet', sheet.name, lists, unknownChoices.length ? `choices that match a cell value replaced; for a look: ${unknownChoices.join(', ').slice(0, 80)}` : 'choices given the same replacements as the cells');
    if (filters) note('Values ticked in a filter', sheet.name, filters, 'given the same replacements as the cells');
    if (rules) note('Text a colour rule looks for', sheet.name, rules, 'given the same replacements as the cells');
    if (messages) note('Messages shown by a drop-down or a checked cell', sheet.name, messages, 'given the same replacements as the cells');
    if (scenarios) note('Saved "what if" sets of values', sheet.name, scenarios, 'taken out');
    if (ranges) note('Named ranges that some people may edit', sheet.name, ranges, 'renamed; the list of people allowed to edit taken out');
    put(sheet.path, out);

    const rels = await read(relsOf(sheet.path));
    if (rels !== undefined) {
      let links = 0;
      put(
        relsOf(sheet.path),
        rels.replace(RELATIONSHIPS, (all, attrs) => {
          if (attr(attrs, 'TargetMode') !== 'External' || !/\/hyperlink$/.test(attr(attrs, 'Type') ?? '')) return all;
          links++;
          return swap(all, attrs, setAttr(attrs, 'Target', 'https://example.invalid/'));
        }),
      );
      if (links) note('Links in cells (web or email addresses)', sheet.name, links, 'pointed at a placeholder address');
    }
  }

  // Words typed into a chart, a text box or a shape. Words that are also a cell's value get its stand-in; the rest are listed.
  const typedWords = (xml, where, count) =>
    xml.replace(/(<a:t>)([^<]*)(<\/a:t>)/g, (all, a, body, c) => {
      const plain = decodeXml(body);
      if (plain.trim() === '' || ctx.inKeptColumn(plain)) return all;
      const made = ctx.standIn(plain);
      if (made !== null) {
        count.replaced++;
        return a + encodeXml(made) + c;
      }
      count.listed++;
      ctx.flag('Words typed into a chart, a text box or a shape', where, plain);
      return all;
    });
  const wordsAction = (count) => (!count.listed ? 'given the same replacements as the cells' : !count.replaced ? 'kept as typed; each is on the list for a look' : 'those that match a cell value replaced; the others are on the list for a look');

  // Which column of which sheet each column of a pivot table's data comes from, where the file says.
  const definitionOf = new Map();
  for (const part of parts) {
    if (!/^xl\/pivotCache\/_rels\/pivotCacheDefinition\d*\.xml\.rels$/.test(part.name)) continue;
    for (const m of (await read(part.name)).matchAll(RELATIONSHIPS)) if (/\/pivotCacheRecords$/.test(attr(m[1], 'Type') ?? '')) definitionOf.set(resolve(ownerOf(part.name), decodeXml(attr(m[1], 'Target') ?? '')), ownerOf(part.name));
  }
  const pivotFields = async (definition) => {
    const xml = (await read(definition)) ?? '';
    const source = rx('<~worksheetSource\\b([^>]*?)\\/?>', '').exec(xml)?.[1] ?? '';
    const sheet = sheetNamed(decodeXml(attr(source, 'sheet') ?? ''));
    const first = /^\$?([A-Z]+)\$?\d+/.exec(attr(source, 'ref') ?? '')?.[1];
    let column = first ? columnNumber(first) - 1 : 0;
    // A column worked out by the pivot table itself has no column on the sheet and no place in the rows.
    return [...xml.matchAll(rx('<~cacheField\\b([^>]*?)\\/?>'))].map((m) => (attr(m[1], 'databaseField') === '0' ? { inRows: false } : { inRows: true, tie: sheet && first ? ctx.tie(sheet, ++column) : undefined }));
  };

  // Outside the cells.
  const extras = { parts: 0, queries: false };
  let queryNames = 0;
  const queryParts = [];
  let pictures = 0;
  for (const part of parts) {
    const name = part.name;
    if (/^xl\/pivotCache\/pivotCache(Definition|Records)\d*\.xml$/.test(name)) {
      let values = 0;
      const item = (all, prefix, kind, attrs, slash, tie) => {
        const value = attr(attrs, 'v');
        if (value === undefined) return all;
        const plain = decodeXml(value);
        if (kind === 's' && ctx.isKept(plain)) return all;
        values++;
        const made = kind === 'n' ? ctx.outsideNumber(value, tie) : encodeAttr(ctx.outsideText(plain, tie));
        return `<${prefix}${kind}${setAttr(attrs, 'v', made)}${slash}>`;
      };
      const ITEM = '<(~)([snd])\\b([^>]*?)(\\/?)>';
      // Each column of a pivot table's data comes from one column of a sheet, and is treated as that column is.
      const fields = await pivotFields(name.includes('Definition') ? name : (definitionOf.get(name) ?? name.replace('Records', 'Definition')));
      let xml = await read(name);
      if (name.includes('Definition')) {
        let field = -1;
        xml = xml.replace(rx(`<~cacheField\\b[^>]*?(?:\\/>|>[\\s\\S]*?<\\/~cacheField>)|${ITEM}`), (all, prefix, kind, attrs, slash) => {
          if (kind !== undefined) return item(all, prefix, kind, attrs, slash, undefined);
          const tie = fields[++field]?.tie;
          return all.replace(rx(ITEM), (one, p, k, a, s) => item(one, p, k, a, s, tie));
        });
      } else {
        // A row of the data holds one value for each column, in the columns' order.
        const ties = fields.filter((f) => f.inRows).map((f) => f.tie);
        xml = xml.replace(rx(`<~r>[\\s\\S]*?<\\/~r>|${ITEM}`), (all, prefix, kind, attrs, slash) => {
          if (kind !== undefined) return item(all, prefix, kind, attrs, slash, undefined);
          let at = -2;
          return all.replace(rx('<(~)(\\w+)\\b([^>]*?)(\\/?)>'), (one, p, k, a, s) => (at++, k === 's' || k === 'n' || k === 'd' ? item(one, p, k, a, s, ties[at]) : one));
        });
      }
      xml = xml.replace(/\s(?:minValue|maxValue|minDate|maxDate)="[^"]*"/g, '');
      if (name.includes('Definition')) {
        xml = xml.replace(rx('<~pivotCacheDefinition\\b([^>]*)>', ''), (all, attrs) => swap(all, attrs, setAttr(setAttr(attrs, 'refreshOnLoad', '1'), 'refreshedBy', 'Author')));
        // The pivot table names the sheet its data comes from.
        if (renamer.size) {
          xml = xml.replace(rx('<~(?:worksheetSource|rangeSet)\\b([^>]*?)(\\/?)>'), (all, attrs) => {
            const next = renamer.one(decodeXml(attr(attrs, 'sheet') ?? ''));
            return next === undefined ? all : swap(all, attrs, setAttr(attrs, 'sheet', encodeAttr(next)));
          });
        }
      }
      put(name, xml);
      note(name.includes('Records') ? "A pivot table's own copy of its data, row by row" : "A pivot table's list of the values in each column", basename(name), values, 'given the same replacements as the cells');
    } else if (/^xl\/comments\d*\.xml$/.test(name)) {
      let count = 0;
      const xml = (await read(name))
        .replace(rx('(<~author>)[\\s\\S]*?(<\\/~author>)'), '$1Author$2')
        .replace(rx('<~comment\\b[^>]*>[\\s\\S]*?<\\/~comment>'), (all) => {
          count++;
          let first = true;
          return all.replace(TEXT_RUNS, (_, a, body, c) => a + (first ? ((first = false), '(comment removed)') : '') + c);
        });
      put(name, xml);
      note('Comments on cells, and who wrote them', basename(name), count, 'cleared');
    } else if (/^xl\/threadedComments\//.test(name)) {
      let count = 0;
      put(name, (await read(name)).replace(rx('(<~text\\b[^>]*>)[\\s\\S]*?(<\\/~text>)'), (_, a, c) => (count++, `${a}(comment removed)${c}`)));
      note('Comment threads', basename(name), count, 'cleared');
    } else if (/^xl\/persons\//.test(name)) {
      let count = 0;
      put(name, (await read(name)).replace(rx('<~person\\b([^>]*?)(\\/?)>'), (all, attrs, slash) => (count++, swap(all, attrs, setAttr(setAttr(setAttr(attrs, 'displayName', 'Author'), 'userId', ''), 'providerId', 'None')))));
      note('The people named in comment threads', basename(name), count, 'cleared');
    } else if (name === 'docProps/core.xml' || name === 'docProps/app.xml') {
      let count = 0;
      const fields = name.endsWith('core.xml') ? 'creator|lastModifiedBy|title|subject|description|keywords|category' : 'Company|Manager|HyperlinkBase';
      let xml = (await read(name)).replace(new RegExp(`(<(?:\\w+:)?(?:${fields})\\b[^>]*>)([^<]+)(</(?:\\w+:)?(?:${fields})>)`, 'g'), (_, a, body, c) => (count++, a + c));
      // The file's details list every sheet by name, and the named ranges with the sheet each is on.
      if (renamer.size && name.endsWith('app.xml')) {
        xml = xml.replace(rx('<~TitlesOfParts\\b[^>]*>[\\s\\S]*?<\\/~TitlesOfParts>', ''), (titles) =>
          titles.replace(rx('(<~lpstr>)([^<]*)(<\\/~lpstr>)'), (_, a, body, c) => {
            const title = decodeXml(body);
            return a + encodeXml(renamer.one(title) ?? renamer.inFormula(title)) + c;
          }),
        );
      }
      put(name, xml);
      if (count) note(name.endsWith('core.xml') ? 'Who made the file and who saved it last, its title and keywords' : 'The company and manager recorded in the file', name, count, 'cleared');
    } else if (name === 'docProps/custom.xml') {
      extras.parts++;
      if (dropExtras) dropped.add(name);
      note('Extra details another program added to the file (labels, a document library\'s fields)', name, ((await read(name)).match(rx('<~property\\b')) ?? []).length, dropExtras ? 'taken out' : 'kept, as you chose');
    } else if (/^xl\/externalLinks\/externalLink\d*\.xml$/.test(name)) {
      let cells = 0;
      put(name, (await read(name)).replace(rx('<~sheetDataSet\\b[^>]*>([\\s\\S]*?)<\\/~sheetDataSet>'), (all, body) => ((cells += (body.match(rx('<~cell\\b')) ?? []).length), all.slice(0, all.indexOf('>')) + '/>')));
      const rels = await read(relsOf(name));
      let where = '';
      if (rels !== undefined) put(relsOf(name), rels.replace(RELATIONSHIPS, (all, attrs) => (attr(attrs, 'TargetMode') === 'External' ? ((where = decodeXml(attr(attrs, 'Target') ?? '')), swap(all, attrs, setAttr(attrs, 'Target', 'stand-in.xlsx'))) : all)));
      note('Values saved from another workbook this one is linked to', basename(name), cells, 'cleared, and the link pointed at a placeholder file');
      ctx.sniff.push({ what: 'A link to another file', where: basename(name), detail: where });
    } else if (name === 'xl/connections.xml' && connections) {
      // The connections stay, so that the workbook opens and each saved query still finds its connection by its number.
      put(name, connections.xml);
      for (const found of connections.listed) {
        ctx.sniff.push({ what: 'A saved connection to a database or a web address', where: found.name, detail: 'it stays in the copy, with server, database, user and file names replaced with placeholders' });
        for (const query of found.queries) ctx.sniff.push({ what: 'The request a saved connection sends (a query)', where: found.name, detail: query.slice(0, 200) });
      }
      note('Saved connections', name, connections.count, 'server, database, user and file names replaced with placeholders');
    } else if (/^xl\/queryTables\/[^/]+\.xml$/.test(name) && connections) {
      // A saved query finds its connection by number, so nothing has to follow. Its own name is often the
      // connection's name over again. It gets a plain one, unless a named range goes by the same name:
      // an older workbook finds the query's cells through that range, and the two must go on matching.
      const said = [...workbook.matchAll(rx('<~definedName\\b([^>]*)>'))].map((m) => decodeXml(attr(m[1], 'name') ?? '').toLowerCase());
      put(name, (await read(name)).replace(rx('<~queryTable\\b([^>]*)>', ''), (all, attrs) => {
        const own = decodeXml(attr(attrs, 'name') ?? '');
        const tells = ctx.connectionNames.has(own) || connections.originals.some((original) => original.length >= 3 && own.toLowerCase().includes(original.toLowerCase()));
        if (!tells || said.includes(own.toLowerCase()) || said.includes(own.replace(/[^\p{L}\p{N}_.]/gu, '_').toLowerCase())) return all;
        leftBehind.add(own);
        return swap(all, attrs, setAttr(attrs, 'name', `ExternalData_${++queryNames}`));
      }));
    } else if (/^customXml\/item\d+\.xml$/.test(name)) {
      const xml = await read(name);
      extras.parts++;
      if (/<DataMashup\b/.test(xml)) {
        // A Power Query lives here. It stays, with the parts it needs, so that the queries still work.
        extras.queries = true;
        queryParts.push(name);
        let found = [];
        try {
          found = await readQueries(xml);
        } catch {
          ctx.sniff.push({ what: 'Queries built into the workbook (Power Query)', where: name, detail: 'the queries could not be read by this tool' });
        }
        for (const query of found) ctx.sniff.push({ what: 'Queries built into the workbook (Power Query)', where: query.names.join(', ') || name, detail: query.code });
        note('Queries built into the workbook (Power Query)', name, Math.max(1, found.reduce((sum, query) => sum + query.names.length, 0)), 'kept, so that the queries still work; listed for a look');
      } else note("Extra data another program stored in the file (a document library's labels, a form)", name, 1, dropExtras ? 'taken out' : 'kept, as you chose');
    } else if (/vbaProject\.bin$/i.test(name)) ctx.sniff.push({ what: 'Macros: a program stored inside the workbook', where: name, detail: `${part.size.toLocaleString('en-US')} bytes; not read by this tool` });
    else if (/^xl\/macrosheets\//.test(name)) ctx.sniff.push({ what: 'An old-style macro sheet', where: name, detail: 'can run commands when the workbook opens' });
    else if (/^xl\/(embeddings|activeX)\//.test(name)) ctx.sniff.push({ what: name.includes('activeX') ? 'A control that runs code (ActiveX)' : 'Another file stored inside the workbook', where: name, detail: `${part.size.toLocaleString('en-US')} bytes` });
    else if (/^xl\/revisions\//.test(name)) ctx.sniff.push({ what: 'A history of tracked changes (it holds earlier values)', where: name, detail: 'not changed by this tool' });
    else if (/^xl\/charts\/[^/]+\.xml$/.test(name)) {
      // A chart keeps its own copy of the values it draws. Each gets the stand-in its cell has; the
      // spreadsheet program draws the chart again from the cells when the copy is opened.
      let values = 0;
      const text = (a, body, c, tie) => {
        const plain = decodeXml(body);
        if (plain === '' || ctx.isKept(plain)) return a + body + c;
        values++;
        return a + encodeXml(ctx.outsideText(plain, tie)) + c;
      };
      const number = (a, body, c, tie) => (body.trim() === '' ? a + body + c : (values++, a + ctx.outsideNumber(body.trim(), tie) + c));
      // A saved copy says which cells it was taken from. Where that is one column of one sheet, its values are treated as that column is.
      const columnOf = (written) => {
        const m = /^'?((?:[^'!]|'')+?)'?!\$?([A-Z]{1,3})\$?\d+(?::\$?([A-Z]{1,3})\$?\d+)?$/.exec(written.trim());
        const sheet = m && (m[3] === undefined || m[3] === m[2]) ? sheetNamed(m[1].replace(/''/g, "'")) : undefined;
        return sheet ? ctx.tie(sheet, columnNumber(m[2])) : undefined;
      };
      const saved = (block, tie) => block.replace(/<c:(numCache|numLit)>[\s\S]*?<\/c:\1>|(<c:v>)([^<]*)(<\/c:v>)/g, (all, numbers, a, body, c) => (numbers ? all.replace(/(<c:v>)([^<]*)(<\/c:v>)/g, (_, a2, body2, c2) => number(a2, body2, c2, tie)) : text(a, body, c, tie)));
      let xml = (await read(name)).replace(/<c:(strRef|numRef|multiLvlStrRef)>[\s\S]*?<\/c:\1>|<c:(numCache|numLit)>[\s\S]*?<\/c:\2>|<c:v>[^<]*<\/c:v>/g, (all, pointer) => saved(all, pointer ? columnOf(decodeXml(/<c:f>([^<]*)<\/c:f>/.exec(all)?.[1] ?? '')) : undefined));
      // The newer kinds of chart keep the same copy under other tags.
      xml = xml.replace(/<cx:(numDim|strDim)\b[^>]*>[\s\S]*?<\/cx:\1>/g, (block, kind) => block.replace(/(<cx:pt\b[^>]*>)([^<]*)(<\/cx:pt>)/g, (_, a, body, c) => (kind === 'numDim' ? number(a, body, c) : text(a, body, c))));
      if (renamer.size) xml = xml.replace(/(<(c|cx):f\b[^>]*>)([^<]*)(<\/\2:f>)/g, (_, a, prefix, body, c) => a + encodeXml(renamer.inFormula(decodeXml(body))) + c);
      const words = { replaced: 0, listed: 0 };
      xml = typedWords(xml, basename(name), words);
      put(name, xml);
      if (values) note("A chart's saved copy of the values it draws", basename(name), values, 'given the same replacements as the cells');
      if (words.replaced + words.listed) note('Words typed into a chart (a title, a label)', basename(name), words.replaced + words.listed, wordsAction(words));
    } else if (/^xl\/printerSettings\//.test(name)) note('Printer settings (they can name a printer)', basename(name), 1, 'listed for a look');
    else if (/^xl\/media\//.test(name)) pictures++;
    else if (/^xl\/tables\/table\d*\.xml$/.test(name)) {
      let filters = 0;
      const before = await read(name);
      let xml = filterValues(before, tableSheet.get(name), () => filters++);
      // A table writes out, a second time, the formula of a worked-out column and of its totals row.
      xml = xml.replace(rx('(<~(calculatedColumnFormula|totalsRowFormula)\\b[^>]*>)([\\s\\S]*?)(<\\/~\\2>)'), (_, a, tag, body, c) => a + encodeXml(ctx.formula(decodeXml(body), `a table on ${basename(name)}`)) + c);
      if (xml !== before) put(name, xml);
      if (filters) note("Values ticked in a table's filter", basename(name), filters, 'given the same replacements as the cells');
    } else if (/^xl\/drawings\/drawing\d*\.xml$/.test(name)) {
      const words = { replaced: 0, listed: 0 };
      const before = await read(name);
      let xml = typedWords(before, basename(name), words);
      // A picture or a shape can carry a description someone typed for it.
      let altTexts = 0;
      xml = xml.replace(rx('<~cNvPr\\b([^>]*?)(\\/?)>'), (all, attrs) => {
        const next = attrs.replace(/\s(?:descr|title)="([^"]*)"/g, (whole, value) => (value === '' ? whole : (altTexts++, '')));
        return next === attrs ? all : swap(all, attrs, next);
      });
      // A text box can show a cell, and so name its sheet.
      if (renamer.size) xml = xml.replace(/(\stextlink=")([^"]*)(")/g, (_, a, value, c) => a + encodeAttr(renamer.inFormula(decodeXml(value))) + c);
      if (xml !== before) put(name, xml);
      if (words.replaced + words.listed) note('Words typed into text boxes and shapes', basename(name), words.replaced + words.listed, wordsAction(words));
      if (altTexts) note('Descriptions typed for pictures and shapes', basename(name), altTexts, 'cleared');
    }
    if (name.endsWith('.rels')) {
      for (const m of (await read(name)).matchAll(RELATIONSHIPS)) {
        const type = basename(attr(m[1], 'Type') ?? '');
        if (attr(m[1], 'TargetMode') === 'External' && type !== 'hyperlink' && type !== 'externalLinkPath') ctx.sniff.push({ what: `Something fetched from outside the file (${type})`, where: name, detail: decodeXml(attr(m[1], 'Target') ?? '') });
      }
    }
  }
  if (pictures) note('Pictures stored in the workbook', 'xl/media', pictures, 'kept as they are: this tool cannot read a picture, so look at each one before sharing');

  // Data another program stored in the file goes, with everything that only it needs. A query's own parts stay.
  if (dropExtras) {
    const staying = new Set();
    for (const item of queryParts) {
      staying.add(item).add(relsOf(item));
      for (const m of ((await read(relsOf(item))) ?? '').matchAll(RELATIONSHIPS)) if (attr(m[1], 'TargetMode') !== 'External') staying.add(resolve(item, decodeXml(attr(m[1], 'Target') ?? '')));
    }
    for (const part of parts) if (part.name.startsWith('customXml/') && !staying.has(part.name)) dropped.add(part.name);
  }

  // Names, and the instruction to work every formula out again when the copy is opened.
  if (workbook) {
    let names = 0;
    let xml = workbook.replace(rx('(<~definedName\\b([^>]*)>)([\\s\\S]*?)(<\\/~definedName>)'), (_, a, attrs, body, c) => {
      names++;
      const name = attr(attrs, 'name') ?? '';
      if (/^(auto_open|auto_close|workbook_open)/i.test(name)) ctx.sniff.push({ what: 'A name that runs something when the workbook opens', where: name, detail: decodeXml(body).slice(0, 120) });
      const written = decodeXml(body);
      // A name that holds nothing but one piece of text is data, like a cell.
      if (/^"(?:[^"]|"")*"$/.test(written) && written.length > 2) return `${a}${encodeXml(`"${ctx.outsideText(written.slice(1, -1).replace(/""/g, '"')).replace(/"/g, '""')}"`)}${c}`;
      return a + encodeXml(ctx.formula(written, `the name ${name}`)) + c;
    });
    if (names) note('Named ranges and named values', 'xl/workbook.xml', names, 'a name that holds text gets a randomized value; ranges are kept');
    // A table of the workbook's data model names its connection, and follows the connection's new name.
    if (ctx.connectionNames.size) xml = xml.replace(rx('<~modelTable\\b([^>]*?)(\\/?)>'), (all, attrs) => {
      const next = ctx.connectionNames.get(decodeXml(attr(attrs, 'connection') ?? ''));
      return next === undefined ? all : swap(all, attrs, setAttr(attrs, 'connection', encodeAttr(next)));
    });
    if (renamer.size) {
      xml = xml.replace(rx('<~sheet\\b([^>]*?)(\\/?)>'), (all, attrs) => {
        const next = renamer.one(decodeXml(attr(attrs, 'name') ?? ''));
        return next === undefined ? all : swap(all, attrs, setAttr(attrs, 'name', encodeAttr(next)));
      });
      note('Sheet names', 'xl/workbook.xml', renamer.size, 'changed to the names you chose; the formulas, lists, charts and links that name a sheet follow');
    }
    if (rx('<~calcPr\\b', '').test(xml)) xml = xml.replace(rx('<~calcPr\\b([^>]*?)(\\/?)>', ''), (all, attrs) => swap(all, attrs, setAttr(attrs, 'fullCalcOnLoad', '1')));
    else xml = xml.replace(rx('<~(?:oleSize|customWorkbookViews|pivotCaches|smartTagPr|smartTagTypes|webPublishing|fileRecoveryPr|webPublishObjects|extLst)\\b|<\\/~workbook>', ''), (at) => `<calcPr fullCalcOnLoad="1"/>${at}`);
    put('xl/workbook.xml', xml);
  }
  if (ctx.done.formulaResults) note('The saved results of formulas', 'every sheet', ctx.done.formulaResults, 'cleared; the spreadsheet program works them out again from the new values');

  // What is left out of the copy is also taken off the file's own lists of its parts.
  if (dropped.size && only !== 'report') {
    for (const part of parts) {
      const name = part.name;
      if (dropped.has(name)) continue;
      if (name.endsWith('.rels')) {
        const before = changed.get(name) ?? (await read(name));
        const after = before.replace(rx('<~Relationship\\b([^>]*?)(?:\\/>|>\\s*<\\/~Relationship>)'), (all, attrs) => (attr(attrs, 'TargetMode') !== 'External' && dropped.has(resolve(ownerOf(name), decodeXml(attr(attrs, 'Target') ?? ''))) ? '' : all));
        if (after !== before) put(name, after);
      } else if (name === '[Content_Types].xml') {
        const before = await read(name);
        const after = before.replace(rx('<~Override\\b([^>]*?)(?:\\/>|>\\s*<\\/~Override>)'), (all, attrs) => (dropped.has(decodeXml(attr(attrs, 'PartName') ?? '').replace(/^\//, '')) ? '' : all));
        if (after !== before) put(name, after);
      }
    }
  }

  const report = {
    parts: parts.length,
    sheets: sheets.map((sheet) => ({
      name: sheet.name,
      ...(sheet.newName === sheet.name ? {} : { newName: sheet.newName }),
      state: sheet.state,
      headingRow: sheet.headerRow || null,
      headingRows: [...sheet.headerRows].sort((a, b) => a - b),
      headingsFrom: sheet.headingsFrom,
      tables: sheet.tables,
      cellsAboveHeadings: sheet.above,
      columns: Object.entries(sheet.columns).map(([number, s]) => ({
        column: letters(Number(number)),
        kept: sheet.keep.has(Number(number)),
        heading: sheet.headings[number] ?? '',
        cells: s.text + s.number + s.date + s['yes/no'] + s.error,
        formulas: s.formula,
        holds: ['text', 'number', 'date', 'yes/no'].filter((k) => s[k] > 0).join(', ') || (s.formula ? 'formulas' : ''),
        different: s.different.size,
        from: `${letters(Number(number))}${s.first}`,
        to: `${letters(Number(number))}${s.last}`,
        headingAlsoValue: s.alsoHeading,
        coded: sheet.code.has(Number(number)),
        canCode: canCode(s),
      })),
    })),
    strings: { inAll: ctx.strings.length, keptAsHeadings: keptAsHeading },
    replaced: { ...ctx.done, differentTexts: ctx.faker.originals().length },
    outsideTheCells: outside,
    forALook: [...ctx.flagged.reduce((seen, f) => seen.set(f.detail, { what: f.what, text: f.detail, times: (seen.get(f.detail)?.times ?? 0) + 1, first: seen.get(f.detail)?.first ?? f.where }), new Map()).values()],
    worthKnowing: ctx.sniff,
    extras,
  };
  if (only === 'report') return { report };

  // What the copy looks like, read from the copy's own parts.
  const from1904 = rx('<~workbookPr\\b[^>]*\\sdate1904="(?:1|true)"', '').test(workbook);
  const described = sheets.map((sheet, at) => describeSheet(changed.get(sheet.path) ?? '', changed.get('xl/sharedStrings.xml') ?? '', { name: sheet.newName, headingRow: sheet.headerRow, headingRows: sheet.headerRows, columns: report.sheets[at].columns, dates: ctx.dates, from1904 }));

  const out = await writeZip(parts.filter((part) => !dropped.has(part.name)).map((part) => (changed.has(part.name) ? { name: part.name, text: changed.get(part.name) } : part)));
  return {
    report,
    bytes: out,
    described,
    // Every text that was replaced, by a randomized value or by a code: each is searched for in the copy afterwards.
    // So is everything a saved connection said that was replaced with a placeholder.
    originals: [...new Set([...ctx.faker.originals(), ...ctx.coder.textOriginals(), ...leftBehind])],
    // Headings, and the words the codes are built from: they are in the copy on purpose.
    kept: [...new Set([...ctx.keptTexts, ...ctx.coder.labels()])],
    legend: ctx.coder.legend(),
    keptByChoice: ctx.keepValues,
    madeUp: ctx.faker.madeUp(),
    // The names renamed sheets used to have, and the names the copy's sheets have now.
    oldNames: sheets.filter((sheet) => sheet.newName !== sheet.name).map((sheet) => sheet.name),
    names: sheets.map((sheet) => sheet.newName),
  };
}

/** In plain words, what a part of a workbook is. */
export function partMeaning(name) {
  const known = [
    [/^xl\/worksheets\/_rels\//, 'the links of a sheet'],
    [/^xl\/worksheets\//, 'a sheet (outside its ordinary cells: a rule, a filter, a formula, a message)'],
    [/^xl\/sharedStrings\.xml$/, "the workbook's list of text"],
    [/^xl\/tables\//, "a table's column names or filter"],
    [/^xl\/pivotCache\//, "a pivot table's own copy of the data"],
    [/^xl\/pivotTables\//, "a pivot table's layout"],
    [/^xl\/slicerCaches\//, "a slicer's list of choices"],
    [/^xl\/drawings\//, 'a text box, shape or picture frame'],
    [/^xl\/charts\//, "a chart's saved values"],
    [/^xl\/(comments|threadedComments|persons)/, 'comments'],
    [/^xl\/externalLinks\//, 'a link to another workbook'],
    [/^xl\/connections\.xml$/, 'saved connections'],
    [/^xl\/queryTables\//, 'a saved query'],
    [/^xl\/workbook\.xml$/, 'the names of sheets and named ranges'],
    [/^xl\/styles\.xml$/, 'number formats and style names'],
    [/^xl\/theme\//, 'the colour and font theme'],
    [/^docProps\//, 'details about the file (author, sheet names)'],
    [/^customXml\//, 'extra data added by another program'],
    [/^csv$/, 'the cells of the file'],
    [/^xl\/revisions\//, 'a history of tracked changes'],
  ];
  return known.find(([pattern]) => pattern.test(name))?.[1] ?? 'another part of the file';
}

/**
 * Looks through every part of a file for values that should no longer be there. It reads what
 * the file says (its text and its settings), not the names of the format's own tags.
 * Returns each one found, with the part it was found in. `exact` lists values of any length to
 * look for only as the whole of something.
 */
export async function leftovers(bytes, originals, { shortest = 5, madeUp = new Set(), kept = new Set(), exact = [] } = {}) {
  const wanted = originals.filter((value) => value.trim().length >= shortest);
  // Every wanted value, filed under its first few characters, so that a long text is read through once and not once per value.
  const byStart = new Map();
  for (const value of wanted) {
    const start = value.slice(0, shortest);
    if (!byStart.has(start)) byStart.set(start, []);
    byStart.get(start).push(value);
  }
  const found = [];
  for (const part of readZip(bytes)) {
    if (/\.(bin|png|jpe?g|gif|emf|wmf|vml)$/i.test(part.name)) continue;
    // What the part says, and where each piece sits in the format's own words (a tag, a setting): never a value.
    const whole = new Map();
    const say = (piece, where) => {
      if (!piece.trim()) return;
      const said = decodeXml(piece);
      if (!whole.has(said)) whole.set(said, new Set());
      whole.get(said).add(where);
    };
    // A cell's address (B12, AA310) is the format's own wording, not something the file says. It is passed
    // over only in the places the format keeps an address, so that a code shaped like one (J1100) is still found elsewhere.
    const address = /^\$?[A-Z]{1,3}\$?\d{1,7}$/;
    const holdsAddress = /^(?:r|ref|sqref|activeCell|topLeftCell|location|cellRange)$/;
    const holdsFormula = /^(?:\w+:)?(?:f|formula|formula1|formula2|sqref|definedName)$/;
    // The format's own wording, the same in every workbook: the kinds of its parts and the addresses that name its vocabulary.
    const formatsOwn = (setting, onTag) => setting === 'xmlns' || setting.startsWith('xmlns:') || setting === 'mc:Ignorable' || setting === 'ContentType' || (setting === 'Type' && /Relationship$/.test(onTag)) || (setting === 'uri' && /ext$/.test(onTag));
    let tag = '';
    let cellType = '';
    for (const m of (await partText(part)).matchAll(/<[^>]*>|[^<]+/g)) {
      if (m[0][0] !== '<') {
        if (!(holdsFormula.test(tag) && address.test(m[0].trim()))) say(m[0], /^(?:\w+:)?v$/.test(tag) ? `the text inside <v> of a cell of type "${cellType || 'number'}"` : `the text inside <${tag}>`);
        continue;
      }
      if (m[0][1] === '/') continue;
      tag = /^<([\w:.-]+)/.exec(m[0])?.[1] ?? '';
      if (/^(?:\w+:)?c$/.test(tag)) cellType = / t="([^"]*)"/.exec(m[0])?.[1] ?? '';
      for (const a of m[0].matchAll(/([\w:.-]+)="([^"]*)"/g)) if (!(holdsAddress.test(a[1]) && address.test(a[2])) && !formatsOwn(a[1], tag)) say(a[2], `the setting ${a[1]} on <${tag}>`);
    }
    // "inside": the value is part of something longer. Plain numbers and the stand-ins themselves are not read through.
    const inside = new Map();
    for (const [said, places] of whole) {
      if (said.length <= shortest || madeUp.has(said) || kept.has(said) || /^[\d.eE+-]+$/.test(said)) continue;
      for (let at = 0; at + shortest <= said.length; at++) {
        const hits = byStart.get(said.substr(at, shortest));
        if (!hits) continue;
        for (const value of hits) {
          if (value === said || !said.startsWith(value, at)) continue;
          if (!inside.has(value)) inside.set(value, new Set());
          for (const place of places) inside.get(value).add(place);
        }
      }
    }
    for (const value of wanted) {
      for (const sits of whole.get(value) ?? []) found.push({ value, part: part.name, how: 'whole', madeUp: madeUp.has(value), sits });
      if (!whole.has(value)) for (const sits of inside.get(value) ?? []) found.push({ value, part: part.name, how: 'inside', madeUp: madeUp.has(value), sits });
    }
    for (const value of exact) for (const sits of whole.get(value) ?? []) found.push({ value, part: part.name, how: 'whole', madeUp: madeUp.has(value), sits });
  }
  return found;
}

export { unpack };
