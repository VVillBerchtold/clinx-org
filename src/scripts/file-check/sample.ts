// The sample report the page offers for a first try: a small workbook with the kinds of mess a
// real report picks up over the years. Every name, ID, phone number and amount in it is invented.
// It is written here, in the browser's memory, so the page needs no connection to fetch it.
import { storeZip } from '../cleaner-copy/engine/zip.js';

export const SAMPLE_NAME = 'sample-messy-report.xlsx';

type Cell = string | number | null | { date: string } | { error: string };

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const TYPES = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const encode = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function letter(column: number): string {
  let out = '';
  for (let at = column + 1; at > 0; at = Math.floor((at - 1) / 26)) out = String.fromCharCode(65 + ((at - 1) % 26)) + out;
  return out;
}

/** The number a spreadsheet program stores for a date given as YYYY-MM-DD. */
const serial = (date: string): number => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000);

function sheetXml(rows: Cell[][], merges: string[]): string {
  const out: string[] = [];
  rows.forEach((row, r) => {
    let cells = '';
    row.forEach((cell, c) => {
      const ref = `${letter(c)}${r + 1}`;
      if (cell === null) return;
      if (typeof cell === 'number') cells += `<c r="${ref}"><v>${cell}</v></c>`;
      else if (typeof cell === 'string') cells += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${encode(cell)}</t></is></c>`;
      else if ('date' in cell) cells += `<c r="${ref}" s="1"><v>${serial(cell.date)}</v></c>`;
      else cells += `<c r="${ref}" t="e"><v>${encode(cell.error)}</v></c>`;
    });
    if (cells) out.push(`<row r="${r + 1}">${cells}</row>`);
  });
  const merged = merges.length ? `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : '';
  return `${HEAD}<worksheet xmlns="${MAIN}"><sheetData>${out.join('')}</sheetData>${merged}</worksheet>`;
}

// ---- The first sheet: visits, with a title across the top and a row of totals at the bottom ----

const CLINICS = ['North Clinic', 'South Clinic', 'East Clinic'];
const STATUSES = ['Paid', 'Paid', 'Denied', 'Pending'];

function visits(): Cell[][] {
  const rows: Cell[][] = [['Visits, first quarter (sample)'], ['Visit ID', 'Patient ID', 'Clinic', 'Visit date', 'Charge', 'Units', 'Status']];
  let charges = 0;
  let units = 0;
  for (let at = 0; at < 36; at++) {
    const day = new Date(Date.UTC(2026, 0, 5 + at * 2)).toISOString().slice(0, 10);
    const charge = 85 + ((at * 37) % 240) + 0.5 * (at % 2);
    const count = 1 + (at % 4);
    charges += charge;
    units += count;
    rows.push([`V-${20411 + at * 7}`, String(4500 + at * 13).padStart(6, '0'), CLINICS[at % 3] ?? '', { date: day }, charge, count, STATUSES[at % 4] ?? '']);
  }
  const change = (row: number, column: number, value: Cell): void => {
    const cells = rows[row];
    if (cells) cells[column] = value;
  };
  // The mess. Rows are counted as the sheet shows them, less one.
  change(9, 0, 'V-20425'); // a visit entered twice
  change(6, 2, 'north clinic'); // the same clinic, written a second way
  change(15, 2, 'north clinic');
  change(21, 2, 'South Clinic '); // a space after the name
  change(11, 3, '1/23/2026'); // dates typed as text among real dates
  change(12, 3, '1/25/2026');
  change(27, 3, '2/24/2026');
  change(13, 4, '125.00'); // amounts stored as text
  change(30, 4, '310.50');
  change(18, 4, 'pending'); // a word in a column of amounts
  change(24, 5, { error: '#N/A' }); // a lookup that found nothing
  rows.splice(19, 0, []); // an empty row inside the data
  rows.push(['Total', null, null, null, Math.round(charges * 100) / 100, units, null]);
  return rows;
}

// ---- The second sheet: a short list of providers, with headings that need work ----

const FAMILY = ['Marlowe', 'Okafor', 'Lindqvist', 'Castellano', 'Whitlock', 'Abernethy', 'Drummond', 'Solberg', 'Ferreira', 'Thistlewood', 'Varga', 'Quimby'];

function providers(): Cell[][] {
  const rows: Cell[][] = [['Provider', 'ID number', 'Phone', 'Phone', null, 'Start date']];
  FAMILY.forEach((name, at) => {
    const month = String(1 + (at % 12)).padStart(2, '0');
    const start = at % 3 === 0 ? `${Number(month)}/1/2024` : `2024-${month}-01`;
    rows.push([`Dr. ${name} (sample)`, 1900000000 + at * 104729, `401-555-01${String(10 + at)}`, at % 4 === 0 ? `401-555-01${String(60 + at)}` : null, at % 2 === 0 ? 'Yes' : 'No', start]);
  });
  return rows;
}

/** The sample workbook's bytes. */
export function sampleBytes(): Uint8Array {
  const sheets = [
    { name: 'Visits', rows: visits(), merges: ['A1:G1'] },
    { name: 'Providers', rows: providers(), merges: [] as string[] },
  ];
  const overrides = sheets.map((_, at) => `<Override PartName="/xl/worksheets/sheet${at + 1}.xml" ContentType="${TYPES}.worksheet+xml"/>`).join('');
  const tags = sheets.map((sheet, at) => `<sheet name="${sheet.name}" sheetId="${at + 1}" r:id="rId${at + 1}"/>`).join('');
  const rels = sheets.map((_, at) => `<Relationship Id="rId${at + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${at + 1}.xml"/>`).join('');
  return storeZip([
    {
      name: '[Content_Types].xml',
      text: `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${TYPES}.sheet.main+xml"/>${overrides}<Override PartName="/xl/styles.xml" ContentType="${TYPES}.styles+xml"/></Types>`,
    },
    { name: '_rels/.rels', text: `${HEAD}<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', text: `${HEAD}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>${tags}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: `${HEAD}<Relationships xmlns="${PACKAGE_REL}">${rels}<Relationship Id="rId90" Type="${REL}/styles" Target="styles.xml"/></Relationships>` },
    // Two cell styles: 0 is General, 1 shows a date.
    {
      name: 'xl/styles.xml',
      text: `${HEAD}<styleSheet xmlns="${MAIN}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    },
    ...sheets.map((sheet, at) => ({ name: `xl/worksheets/sheet${at + 1}.xml`, text: sheetXml(sheet.rows, sheet.merges) })),
  ]);
}
