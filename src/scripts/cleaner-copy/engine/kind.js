// Says what kind of file a person has chosen: a workbook, a CSV file, or something this site's
// file tools cannot read.
//
// In plain words: the first few bytes of a file say what it is, whatever its name ends in. This
// file looks at those bytes and answers with the kind, or with a sentence for the person that
// says why the file cannot be read and what to do about it. It sits on its own so that a tool
// which only needs this question answered does not have to load the rest of the engine.

import { readZip } from './zip.js';

const SAVE_FIRST = 'Open it in your spreadsheet program and save it as .xlsx first.';

/** True when the start of a file is plainly not text: it holds bytes no written text uses. */
function looksBinary(bytes) {
  // A file in two-byte text says so with a mark at its start; every other letter of it is a zero byte.
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return false;
  const start = bytes.subarray(0, 4096);
  let odd = 0;
  for (const byte of start) {
    if (byte === 0) return true;
    if (byte < 9 || (byte > 13 && byte < 32 && byte !== 27)) odd++;
  }
  return odd > start.length / 50;
}

/** Says what kind of file this is, or why it cannot be read, in a sentence for the person. */
export function kindOf(name, bytes) {
  if (!bytes || bytes.length === 0) return { problem: 'This file is empty.' };
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return { problem: `This is an older Excel file (.xls), or a workbook locked with a password. ${SAVE_FIRST}` };
  // A workbook is a zip file, and a zip file starts with the letters PK and two marks no written text has.
  // (A CSV file whose first heading starts with PK is still a CSV file.)
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] <= 8 && bytes[3] <= 8) {
    let names;
    try {
      names = readZip(bytes).map((part) => part.name);
    } catch (error) {
      return { problem: `This file could not be opened. ${error instanceof Error ? error.message : ''}`.trim() };
    }
    if (names.includes('xl/workbook.xml')) return { kind: 'workbook' };
    if (names.includes('xl/workbook.bin')) return { problem: `This is a binary workbook (.xlsb). ${SAVE_FIRST}` };
    if (names.includes('mimetype') && names.includes('content.xml')) return { problem: `This is an OpenDocument file (.ods). ${SAVE_FIRST}` };
    if (names.some((part) => part.startsWith('word/'))) return { problem: 'This is a Word document, not a spreadsheet.' };
    if (names.some((part) => part.startsWith('ppt/'))) return { problem: 'This is a presentation, not a spreadsheet.' };
    return { problem: 'This is a zip file, not a workbook. Choose an .xlsx or .xlsm workbook, or a .csv file.' };
  }
  const start = String.fromCharCode(...bytes.subarray(0, 64));
  if (/^(?:%PDF|\x89PNG|\xff\xd8\xff|GIF8|Rar!|7z\xbc\xaf|\x1f\x8b)/.test(start) || looksBinary(bytes)) return { problem: 'This is not a workbook or a CSV file. Choose an .xlsx or .xlsm workbook, or a .csv file.' };
  // Some programs save a web page or XML under a spreadsheet's name. Read as a CSV file it would be nonsense.
  if (/^(?:\xef\xbb\xbf)?\s*<(?:\?xml|!doctype|html|head|body|meta|style|table|div|workbook|ss:workbook)\b/i.test(String.fromCharCode(...bytes.subarray(0, 512)))) {
    return { problem: `This file holds a web page or XML, not a workbook or a CSV file${/\.xls$/i.test(name ?? '') ? ', though it is named .xls' : ''}. ${SAVE_FIRST}` };
  }
  return { kind: 'csv' };
}
