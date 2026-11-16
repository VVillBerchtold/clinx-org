// Small made-up workbooks, written from plain XML, and a reader for the copies the engine gives back.
// Every name, code and number in these tests is invented.

import { readZip, text, writeZip } from '../../../src/scripts/cleaner-copy/engine/zip.js';

/** A cell to write: text, a number, a formula with the result it last gave, or nothing. */
export type Cell = string | number | { f: string; v?: string } | null;

export interface SheetSpec {
  name: string;
  rows: Cell[][];
  /** XML written after the cells: a list, a rule, a filter, a link. */
  after?: string;
  /** The sheet's own links to other parts, as <Relationship> tags. */
  rels?: string;
  /** Settings written on the sheet's <sheetPr>. */
  sheetPr?: string;
}

export interface WorkbookSpec {
  sheets: SheetSpec[];
  /** <definedName> tags. */
  definedNames?: string;
  /** XML written at the end of the workbook's own part, after the names. */
  workbookAfter?: string;
  /** Any other parts, by name. */
  parts?: Record<string, string>;
  /** More <Override> tags for [Content_Types].xml. */
  overrides?: string;
  /** More <Relationship> tags for _rels/.rels and for the workbook's own links. */
  rootRels?: string;
  workbookRels?: string;
}

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

export const encode = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const decode = (value: string): string => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const letter = (column: number): string => String.fromCharCode(65 + column);

/** Writes a workbook. Texts go into the shared list of strings, each written once, as a spreadsheet program does. */
export async function workbook(spec: WorkbookSpec): Promise<Uint8Array> {
  const strings: string[] = [];
  const indexOf = (value: string): number => {
    const at = strings.indexOf(value);
    return at >= 0 ? at : strings.push(value) - 1;
  };
  const parts: { name: string; text: string }[] = [];
  spec.sheets.forEach((sheet, at) => {
    const rows = sheet.rows
      .map((row, r) => {
        const cells = row
          .map((cell, c) => {
            const ref = `${letter(c)}${r + 1}`;
            if (cell === null) return '';
            if (typeof cell === 'number') return `<c r="${ref}"><v>${cell}</v></c>`;
            if (typeof cell === 'string') return `<c r="${ref}" t="s"><v>${indexOf(cell)}</v></c>`;
            return `<c r="${ref}" t="str"><f>${encode(cell.f)}</f><v>${encode(cell.v ?? '')}</v></c>`;
          })
          .join('');
        return cells ? `<row r="${r + 1}">${cells}</row>` : '';
      })
      .join('');
    const sheetPr = sheet.sheetPr ? `<sheetPr ${sheet.sheetPr}/>` : '';
    parts.push({ name: `xl/worksheets/sheet${at + 1}.xml`, text: `${HEAD}<worksheet xmlns="${MAIN}" xmlns:r="${REL}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main">${sheetPr}<sheetData>${rows}</sheetData>${sheet.after ?? ''}</worksheet>` });
    if (sheet.rels) parts.push({ name: `xl/worksheets/_rels/sheet${at + 1}.xml.rels`, text: `${HEAD}<Relationships xmlns="${PACKAGE_REL}">${sheet.rels}</Relationships>` });
  });
  const sheetTags = spec.sheets.map((sheet, at) => `<sheet name="${encode(sheet.name)}" sheetId="${at + 1}" r:id="rId${at + 1}"/>`).join('');
  const sheetRels = spec.sheets.map((_, at) => `<Relationship Id="rId${at + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${at + 1}.xml"/>`).join('');
  const sheetOverrides = spec.sheets.map((_, at) => `<Override PartName="/xl/worksheets/sheet${at + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  parts.unshift(
    {
      name: '[Content_Types].xml',
      text: `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetOverrides}<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${spec.overrides ?? ''}</Types>`,
    },
    { name: '_rels/.rels', text: `${HEAD}<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/>${spec.rootRels ?? ''}</Relationships>` },
    { name: 'xl/workbook.xml', text: `${HEAD}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>${sheetTags}</sheets>${spec.definedNames ? `<definedNames>${spec.definedNames}</definedNames>` : ''}${spec.workbookAfter ?? ''}</workbook>` },
    {
      name: 'xl/_rels/workbook.xml.rels',
      text: `${HEAD}<Relationships xmlns="${PACKAGE_REL}">${sheetRels}<Relationship Id="rId90" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId91" Type="${REL}/styles" Target="styles.xml"/>${spec.workbookRels ?? ''}</Relationships>`,
    },
    { name: 'xl/styles.xml', text: `${HEAD}<styleSheet xmlns="${MAIN}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf/></cellXfs></styleSheet>` },
  );
  parts.push({ name: 'xl/sharedStrings.xml', text: `${HEAD}<sst xmlns="${MAIN}" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((value) => `<si><t xml:space="preserve">${encode(value)}</t></si>`).join('')}</sst>` });
  for (const [name, body] of Object.entries(spec.parts ?? {})) parts.push({ name, text: body });
  return writeZip(parts);
}

/** Every part of a workbook as text, by name. */
export async function partsOf(bytes: Uint8Array): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const part of readZip(bytes)) out.set(part.name, await text(part));
  return out;
}

/** One part, or a failed test when it is not there. */
export function part(parts: Map<string, string>, name: string): string {
  const found = parts.get(name);
  if (found === undefined) throw new Error(`the copy has no part named ${name}`);
  return found;
}

/** Everything the file says, as one text. */
export const allText = (parts: Map<string, string>): string => [...parts.entries()].map(([name, body]) => `${name}\n${body}`).join('\n');

export interface ReadCell {
  text: string;
  formula: string | null;
}

/** The cells of one sheet, by address: what each shows and the formula it holds, if any. */
export function cellsOf(parts: Map<string, string>, sheetName: string): Map<string, ReadCell> {
  const book = part(parts, 'xl/workbook.xml');
  const rels = part(parts, 'xl/_rels/workbook.xml.rels');
  let id = '';
  for (const m of book.matchAll(/<sheet\b[^>]*>/g)) if (decode(/\sname="([^"]*)"/.exec(m[0])?.[1] ?? '') === sheetName) id = /\sr:id="([^"]*)"/.exec(m[0])?.[1] ?? '';
  let target = '';
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) if (/\sId="([^"]*)"/.exec(m[0])?.[1] === id) target = /\sTarget="([^"]*)"/.exec(m[0])?.[1] ?? '';
  if (!id || !target) throw new Error(`the copy has no sheet named ${sheetName}`);
  const xml = part(parts, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  const strings = [...(parts.get('xl/sharedStrings.xml') ?? '').matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((m) =>
    [...(m[1] ?? '').replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decode(t[1] ?? '')).join(''),
  );
  const out = new Map<string, ReadCell>();
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1] ?? '';
    const body = m[2] ?? '';
    const ref = /\sr="([^"]*)"/.exec(attrs)?.[1] ?? '';
    const type = /\st="([^"]*)"/.exec(attrs)?.[1] ?? '';
    const value = decode(/<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
    const formula = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(body)?.[1];
    let shown = value;
    if (type === 's') shown = strings[Number(value)] ?? '';
    if (type === 'inlineStr') shown = [...body.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decode(t[1] ?? '')).join('');
    out.set(ref, { text: shown, formula: formula === undefined ? (/<f\b/.test(body) ? '' : null) : decode(formula) });
  }
  return out;
}

/** What one cell shows; an empty text when the sheet has no such cell. */
export const shown = (cells: Map<string, ReadCell>, ref: string): string => cells.get(ref)?.text ?? '';
/** The formula one cell holds; an empty text when it holds none. */
export const formulaOf = (cells: Map<string, ReadCell>, ref: string): string => cells.get(ref)?.formula ?? '';

/** The rows of one column, from a row down, as [row number, what the cell shows], leaving out cells that are not there. */
export function columnOf(cells: Map<string, ReadCell>, column: string, fromRow: number): [number, string][] {
  const out: [number, string][] = [];
  for (const [ref, cell] of cells) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    if (m && m[1] === column && Number(m[2]) >= fromRow) out.push([Number(m[2]), cell.text]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** True when a stand-in has the shape of its original: a vowel for a vowel, a consonant for a consonant, a digit for a digit, the same case, every other mark unchanged. */
export function sameShape(original: string, standIn: string): boolean {
  const kind = (ch: string): string => {
    if (/[0-9]/.test(ch)) return '9';
    if (/[aeiou]/.test(ch)) return 'v';
    if (/[AEIOU]/.test(ch)) return 'V';
    if (/[a-z]/.test(ch)) return 'c';
    if (/[A-Z]/.test(ch)) return 'C';
    return ch;
  };
  return original.length === standIn.length && [...original].map(kind).join('') === [...standIn].map(kind).join('');
}
