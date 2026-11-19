// Opens a workbook the engine wrote, for the tests: every part as text and the sheets by name.
// The XML reader is strict, so a part that is not well formed fails here first.

import { readZip, text, writeZip } from '../../../src/scripts/cleaner-copy/engine/zip.js';
import { cellsOf, child, childrenOf, parseXml } from './xml';
import type { SheetCell, XmlNode } from './xml';

export interface OpenedSheet {
  name: string;
  hidden: boolean;
  path: string;
  xml: XmlNode;
  cells: Map<string, SheetCell>;
}

export interface Opened {
  parts: Map<string, string>;
  /** The sheets in tab order. */
  sheets: OpenedSheet[];
}

export async function openBook(bytes: Uint8Array): Promise<Opened> {
  const parts = new Map<string, string>();
  for (const part of readZip(bytes)) parts.set(part.name, await text(part));
  const book = parseXml(parts.get('xl/workbook.xml') ?? '');
  const rels = parseXml(parts.get('xl/_rels/workbook.xml.rels') ?? '');
  const sheets = childrenOf(child(book, 'sheets'), 'sheet').map((sheet) => {
    const target = childrenOf(rels, 'Relationship').find((rel) => rel.attrs['Id'] === sheet.attrs['r:id'])?.attrs['Target'] ?? '';
    const path = `xl/${target}`;
    const xml = parseXml(parts.get(path) ?? '');
    return { name: sheet.attrs['name'] ?? '', hidden: sheet.attrs['state'] === 'hidden', path, xml, cells: cellsOf(xml) };
  });
  return { parts, sheets };
}

export function sheetNamed(book: Opened, name: string): OpenedSheet {
  const sheet = book.sheets.find((s) => s.name === name);
  if (!sheet) throw new Error(`no sheet named ${name}`);
  return sheet;
}

/** The row whose cell in a column holds these words. */
export function rowWith(cells: Map<string, SheetCell>, words: string, column = 'A'): number {
  for (const cell of cells.values()) if (cell.text === words && cell.ref.replace(/\d+/, '') === column) return Number(cell.ref.replace(/[A-Z]+/, ''));
  throw new Error(`no cell in column ${column} says ${words}`);
}

/** True when a cell in a column holds these words. */
export function hasRow(cells: Map<string, SheetCell>, words: string, column = 'A'): boolean {
  for (const cell of cells.values()) if (cell.text === words && cell.ref.replace(/\d+/, '') === column) return true;
  return false;
}

/** The column whose cell in a row holds these words. */
export function columnWith(cells: Map<string, SheetCell>, words: string, row: number): string {
  for (const cell of cells.values()) if (cell.text === words && cell.ref.replace(/[A-Z]+/, '') === String(row)) return cell.ref.replace(/\d+/, '');
  throw new Error(`no cell in row ${row} says ${words}`);
}

/**
 * A workbook the engine wrote, with its hidden data sheet replaced by one that holds this value
 * as plain text in one piece, the way a workbook saved with other content would hold it.
 */
export async function withSavedValue(bytes: Uint8Array, value: unknown): Promise<Uint8Array> {
  const book = await openBook(bytes);
  const dataPath = book.sheets[book.sheets.length - 1]?.path ?? '';
  const json = JSON.stringify(value);
  const xml = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="2"><c r="A2" t="inlineStr"><is><t>clinx-schedule</t></is></c><c r="B2"><v>1</v></c><c r="C2"><v>1</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>${json.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></is></c></row></sheetData></worksheet>`;
  return writeZip(readZip(bytes).map((part) => (part.name !== dataPath ? part : { name: part.name, text: xml })));
}

/** The schedule as the hidden data sheet of a workbook holds it: the text of its pieces put together and read. */
export function savedValue(book: Opened): Record<string, unknown> {
  const data = book.sheets[book.sheets.length - 1];
  const pieces = [...(data?.cells.values() ?? [])].filter((cell) => /^A\d+$/.test(cell.ref) && Number(cell.ref.slice(1)) >= 3).sort((a, b) => Number(a.ref.slice(1)) - Number(b.ref.slice(1)));
  return JSON.parse(pieces.map((cell) => cell.text ?? '').join('')) as Record<string, unknown>;
}
