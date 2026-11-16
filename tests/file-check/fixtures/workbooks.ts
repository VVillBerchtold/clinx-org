// Small made-up workbooks for the File Check tests, written from plain XML.
// Every name, code and number in them is invented.

import { writeZip } from '../../../src/scripts/cleaner-copy/engine/zip.js';

/**
 * A cell to write: text, a number, nothing, or one of the kinds a spreadsheet program stores apart:
 * a real date, an error, a yes/no, a formula with the result it last gave, or a text that carries
 * the number format of an amount.
 */
export type Cell = string | number | null | { date: string } | { error: string } | { bool: boolean } | { formula: string; result: number | string } | { text: string; format: 'amount' };

export interface SheetSpec {
  name: string;
  rows: Cell[][];
  /** Merged ranges, as "A1:C1". */
  merges?: string[];
  hidden?: boolean;
  /** The sheet laid out as a table: its range, and whether its last row is a row of totals. */
  table?: { ref: string; totals?: boolean };
}

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const encode = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const letter = (column: number): string => {
  let out = '';
  for (let at = column + 1; at > 0; at = Math.floor((at - 1) / 26)) out = String.fromCharCode(65 + ((at - 1) % 26)) + out;
  return out;
};

/** The number a spreadsheet program stores for a date given as YYYY-MM-DD. */
export const serial = (date: string): number => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000);

/** Writes a workbook. Texts go into the shared list of strings, each written once, as a spreadsheet program does. */
export async function workbook(sheets: SheetSpec[]): Promise<Uint8Array> {
  const strings = new Map<string, number>();
  const indexOf = (value: string): number => {
    const at = strings.get(value);
    if (at !== undefined) return at;
    strings.set(value, strings.size);
    return strings.size - 1;
  };
  const parts: { name: string; text: string }[] = [];
  let tables = 0;
  sheets.forEach((sheet, at) => {
    const rows: string[] = [];
    sheet.rows.forEach((row, r) => {
      let cells = '';
      row.forEach((cell, c) => {
        const ref = `${letter(c)}${r + 1}`;
        if (cell === null) return;
        if (typeof cell === 'number') cells += `<c r="${ref}"><v>${cell}</v></c>`;
        else if (typeof cell === 'string') cells += `<c r="${ref}" t="s"><v>${indexOf(cell)}</v></c>`;
        else if ('date' in cell) cells += `<c r="${ref}" s="1"><v>${serial(cell.date)}</v></c>`;
        else if ('error' in cell) cells += `<c r="${ref}" t="e"><v>${encode(cell.error)}</v></c>`;
        else if ('bool' in cell) cells += `<c r="${ref}" t="b"><v>${cell.bool ? 1 : 0}</v></c>`;
        else if ('formula' in cell) cells += typeof cell.result === 'number' ? `<c r="${ref}"><f>${encode(cell.formula)}</f><v>${cell.result}</v></c>` : `<c r="${ref}" t="str"><f>${encode(cell.formula)}</f><v>${encode(cell.result)}</v></c>`;
        else cells += `<c r="${ref}" s="2" t="s"><v>${indexOf(cell.text)}</v></c>`;
      });
      if (cells) rows.push(`<row r="${r + 1}">${cells}</row>`);
    });
    const merges = sheet.merges?.length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : '';
    const tableParts = sheet.table ? '<tableParts count="1"><tablePart r:id="rId1"/></tableParts>' : '';
    parts.push({ name: `xl/worksheets/sheet${at + 1}.xml`, text: `${HEAD}<worksheet xmlns="${MAIN}" xmlns:r="${REL}"><sheetData>${rows.join('')}</sheetData>${merges}${tableParts}</worksheet>` });
    if (sheet.table) {
      tables++;
      parts.push({ name: `xl/worksheets/_rels/sheet${at + 1}.xml.rels`, text: `${HEAD}<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL}/table" Target="../tables/table${tables}.xml"/></Relationships>` });
      const width = sheet.rows[0]?.length ?? 0;
      const columns = Array.from({ length: width }, (_, c) => `<tableColumn id="${c + 1}" name="Column${c + 1}"/>`).join('');
      parts.push({ name: `xl/tables/table${tables}.xml`, text: `${HEAD}<table xmlns="${MAIN}" id="${tables}" name="Table${tables}" displayName="Table${tables}" ref="${sheet.table.ref}"${sheet.table.totals ? ' totalsRowCount="1"' : ''}><tableColumns count="${width}">${columns}</tableColumns></table>` });
    }
  });
  const sheetTags = sheets.map((sheet, at) => `<sheet name="${encode(sheet.name)}" sheetId="${at + 1}"${sheet.hidden ? ' state="hidden"' : ''} r:id="rId${at + 1}"/>`).join('');
  const sheetRels = sheets.map((_, at) => `<Relationship Id="rId${at + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${at + 1}.xml"/>`).join('');
  const sheetOverrides = sheets.map((_, at) => `<Override PartName="/xl/worksheets/sheet${at + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  parts.unshift(
    {
      name: '[Content_Types].xml',
      text: `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetOverrides}<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    { name: '_rels/.rels', text: `${HEAD}<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', text: `${HEAD}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>${sheetTags}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: `${HEAD}<Relationships xmlns="${PACKAGE_REL}">${sheetRels}<Relationship Id="rId90" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId91" Type="${REL}/styles" Target="styles.xml"/></Relationships>` },
    // Three cell styles: 0 is General, 1 shows a date, 2 shows an amount with two decimals.
    {
      name: 'xl/styles.xml',
      text: `${HEAD}<styleSheet xmlns="${MAIN}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="4" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    },
  );
  parts.push({ name: 'xl/sharedStrings.xml', text: `${HEAD}<sst xmlns="${MAIN}" count="${strings.size}" uniqueCount="${strings.size}">${[...strings.keys()].map((value) => `<si><t xml:space="preserve">${encode(value)}</t></si>`).join('')}</sst>` });
  return writeZip(parts);
}

/** Every value written under the first `headingRows` rows of a sheet, as the file holds it. Used to prove no value reaches a sentence. */
export function valuesOf(rows: Cell[][], headingRows = 1): string[] {
  const out: string[] = [];
  for (const row of rows.slice(headingRows)) {
    for (const cell of row) {
      if (cell === null) continue;
      if (typeof cell === 'string') out.push(cell);
      else if (typeof cell === 'number') out.push(String(cell));
      else if ('date' in cell) out.push(cell.date);
      else if ('error' in cell) out.push(cell.error);
      else if ('formula' in cell) out.push(String(cell.result));
      else if ('text' in cell) out.push(cell.text);
    }
  }
  return out;
}

const FIRST = ['Ada', 'Bram', 'Cleo', 'Dmitri', 'Esme', 'Finn', 'Greta', 'Hollis', 'Ines', 'Jarrah'];
const LAST = ['Marlowe', 'Okafor', 'Lindqvist', 'Castellano', 'Whitlock', 'Abernethy', 'Drummond', 'Solberg', 'Ferreira', 'Thistlewood'];
const PAYERS = ['Medicaid', 'Medicare', 'Commercial'];

export const HEADINGS = ['Claim ID', 'Patient', 'Fill date', 'Payer', 'Qty', 'Paid'];

/** One made-up claim: an ID, a name, a real date, a payer, a count and an amount. No two rows share an ID, a name or an amount. */
export function claim(at: number): Cell[] {
  const day = new Date(Date.UTC(2026, 0, 5 + at * 3)).toISOString().slice(0, 10);
  return [`C-${20417 + at * 7}`, `${FIRST[at % 10]} ${LAST[(at * 3 + Math.floor(at / 10)) % 10]}${at >= 100 ? ` ${at}` : ''}`, { date: day }, PAYERS[at % 3] ?? 'Medicaid', [30, 60, 90][at % 3] ?? 30, Number((1105.37 + at * 41.19).toFixed(2))];
}

/** A clean table of claims: one row of headings and `count` rows under it. Nothing in it should be reported. */
export function claims(count = 30): Cell[][] {
  return [HEADINGS.slice(), ...Array.from({ length: count }, (_, at) => claim(at))];
}

/** The same table as lines of a CSV file, with its dates written year first. */
export function claimsCsv(count = 30): string[][] {
  return claims(count).map((row) => row.map((cell) => (cell === null ? '' : typeof cell === 'object' && 'date' in cell ? cell.date : typeof cell === 'number' ? (Number.isInteger(cell) ? String(cell) : cell.toFixed(2)) : String(cell))));
}

/** Lines of cells as the bytes of a CSV file. A cell that holds the separator, a quotation mark or a line break is put in quotation marks. */
export function csv(rows: string[][], separator = ','): Uint8Array {
  const quote = (value: string): string => (value.includes(separator) || /["\r\n]/.test(value) || /^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return new TextEncoder().encode(rows.map((row) => row.map(quote).join(separator)).join('\r\n') + '\r\n');
}
