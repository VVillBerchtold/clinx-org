// Gives the values of a column short codes, and keeps the legend that says which code is which.
//
// In plain words: in a column the person asked to have coded, every different value becomes a
// short label built from the column's heading ("Payer A", "Payer B") or, for a number, a whole
// number counting from 1. The same original always gets the same code, and columns with the same
// heading share one set of codes, so a lookup between two sheets still matches. Which original gets
// which code is drawn by chance, so the codes do not follow the order the values come in. The legend
// is handed back for the person to save; it is never written into the copy. `legendWorkbook` writes
// a legend as a small workbook of its own, every cell as text.

import { letters } from './xml.js';
import { storeZip } from './zip.js';

/** Whole numbers from the computer's own source of randomness, a batch at a time. */
function randomSource() {
  const pool = new Uint32Array(1024);
  let next = pool.length;
  return (below) => {
    if (next === pool.length) {
      crypto.getRandomValues(pool);
      next = 0;
    }
    return pool[next++] % below;
  };
}

/** The same list in an order drawn by chance. */
function shuffled(list, random) {
  const out = [...list];
  for (let at = out.length - 1; at > 0; at--) {
    const other = random(at + 1);
    [out[at], out[other]] = [out[other], out[at]];
  }
  return out;
}

/** One number however it is written: 12, 12.0 and 1.2E1 are the same number. */
const numberKey = (written) => {
  const value = Number(String(written).trim());
  return String(written).trim() !== '' && Number.isFinite(value) ? String(value) : String(written).trim();
};

export function makeCoder() {
  const random = randomSource();
  // One set of codes for each heading, whatever its capitals and the spaces around it.
  const sets = new Map();

  function makeSet(label) {
    const wantedTexts = new Set();
    const wantedNumbers = new Map();
    const texts = new Map();
    const numbers = new Map();
    const places = [];
    return {
      label,
      places,
      /** Notes a value to be given a code. Nothing has a code until `assign` is called. */
      wantText(value) {
        if (value !== '' && !/^\s+$/.test(value)) wantedTexts.add(value);
      },
      wantNumber(written) {
        const key = numberKey(written);
        if (!wantedNumbers.has(key)) wantedNumbers.set(key, String(written).trim());
      },
      /** The code for a text, or undefined when it has none. */
      text: (value) => texts.get(value),
      /** The code for a number, as it is to be written, or undefined when it has none. */
      number: (written) => numbers.get(numberKey(written))?.code,
      assign(isRealText, isRealNumber) {
        // A code is passed over when it is a real text of the file, or when a real text would be found
        // inside it running from the heading's words into the code's letters ("Type B" in "Blood Type B").
        const taken = (code) => {
          for (let from = 0; from <= label.length; from++) for (let to = label.length + 2; to <= code.length; to++) if (isRealText(code.slice(from, to))) return true;
          return false;
        };
        let at = 0;
        for (const value of shuffled(wantedTexts, random)) {
          let code;
          do code = `${label} ${letters(++at)}`;
          while (taken(code));
          texts.set(value, code);
        }
        let count = 0;
        for (const [key, original] of shuffled(wantedNumbers, random)) {
          do count++;
          while (isRealNumber(count));
          numbers.set(key, { code: String(count), original });
        }
      },
      textCodes: () => [...texts.values()],
      textOriginals: () => [...texts.keys()],
      entries: () => [...[...texts].map(([original, code]) => ({ code, original })), ...[...numbers.values()].map(({ code, original }) => ({ code, original }))],
    };
  }

  return {
    get size() {
      return sets.size;
    },
    /** The set of codes for a heading, made when first asked for. */
    setFor(label) {
      const key = label.toLowerCase();
      if (!sets.has(key)) sets.set(key, makeSet(label));
      return sets.get(key);
    },
    /** Gives every noted value its code, in an order drawn by chance. A code never equals a real value of the file. */
    assign(isRealText, isRealNumber) {
      for (const set of sets.values()) set.assign(isRealText, isRealNumber);
    },
    /** The code of a text met where no column is named: the first set that knows it. */
    textFor(value) {
      for (const set of sets.values()) {
        const code = set.text(value);
        if (code !== undefined) return code;
      }
      return null;
    },
    numberFor(written) {
      for (const set of sets.values()) {
        const code = set.number(written);
        if (code !== undefined) return code;
      }
      return null;
    },
    textCodes: () => [...sets.values()].flatMap((set) => set.textCodes()),
    /** Every text that was given a code, for searching the copy afterwards. */
    textOriginals: () => [...sets.values()].flatMap((set) => set.textOriginals()),
    labels: () => [...sets.values()].map((set) => set.label),
    /** The legend: for each heading, where its codes are used and which original each code stands for. */
    legend: () => [...sets.values()].map((set) => ({ label: set.label, columns: [...set.places], entries: set.entries() })),
  };
}

/** The words a column's codes are built from: its heading, or "Column E" where it has none. */
export const codeLabel = (heading, letter) => String(heading ?? '').replace(/\s+/g, ' ').trim() || `Column ${letter}`;

/** A text as it is written inside a workbook's XML. A mark no XML file may hold is written the way spreadsheet programs write it. */
const inXml = (value) =>
  String(value)
    .replace(/_(?=x[0-9A-Fa-f]{4}_)/g, '_x005F_')
    .replace(/[&<>]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&gt;'))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, (ch) => `_x${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`)
    .replace(/\r/g, '&#13;');

/**
 * Writes a legend as a small workbook for the person to save: one sheet named "Legend", a row of
 * headings, then one row for each code. Every cell is written as text, so a value such as 007 keeps
 * its zeros when the file is opened. Nothing is kept, and nothing goes anywhere but into the bytes given back.
 */
export function legendWorkbook(legend) {
  const rows = [['Heading', 'Where', 'Code', 'Original']];
  for (const group of legend ?? []) for (const entry of group.entries) rows.push([group.label, group.columns.join('; '), entry.code, entry.original]);
  const cell = (value, column, row) => `<c r="${letters(column + 1)}${row + 1}" t="inlineStr" s="${row === 0 ? 1 : 2}"><is><t xml:space="preserve">${inXml(value)}</t></is></c>`;
  const widths = [0, 1, 2, 3].map((column) => Math.min(60, Math.max(10, ...rows.map((row) => Math.max(...String(row[column]).split('\n').map((line) => line.length)) + 2))));
  const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const relationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const packageRelationships = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const start = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  return storeZip([
    {
      name: '[Content_Types].xml',
      text: `${start}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    { name: '_rels/.rels', text: `${start}<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="${relationships}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', text: `${start}<workbook xmlns="${main}" xmlns:r="${relationships}"><sheets><sheet name="Legend" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: `${start}<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="${relationships}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${relationships}/styles" Target="styles.xml"/></Relationships>` },
    {
      // Three looks: plain, the heading row (bold), and a cell of text. All but the first mark the cell as text.
      name: 'xl/styles.xml',
      text: `${start}<styleSheet xmlns="${main}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>`,
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      text: `${start}<worksheet xmlns="${main}"><cols>${widths.map((width, at) => `<col min="${at + 1}" max="${at + 1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.map((row, at) => `<row r="${at + 1}">${row.map((value, column) => cell(value, column, at)).join('')}</row>`).join('')}</sheetData></worksheet>`,
    },
  ]);
}
