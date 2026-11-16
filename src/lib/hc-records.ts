/**
 * Health center records: what each health center reported to HRSA in the Uniform Data System, one page
 * for each center and year. This file reads ClinX's copy of the tables (src/data/health-centers/records,
 * written by scripts/hc/records.mjs) and builds what the pages show. A published value is printed as
 * published; the only changes are the thousands separators and the dollar sign drawn around it.
 * Nothing here adds one value to another, ranks a health center or compares two of them.
 */
import { parseCsv } from './csv';
import { numberWord } from './site';
import { stateName } from './states';

const csvTexts = import.meta.glob('../data/health-centers/records/*.csv', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const centerTexts = import.meta.glob('../data/health-centers/records/centers/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const sourceDocs = import.meta.glob('../data/health-centers/records/SOURCE.json', { import: 'default', eager: true }) as Record<string, RecordsSource>;

export const RECORDS_PATH = '/health-centers/records/';
export const DATA_PATH = '/data/health-centers/records/';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface Workbook {
  file: string;
  url: string;
  retrieved_utc: string;
  bytes: number;
  sha256: string;
  report_last_refreshed: string;
  reads: 'two_reads' | 'one_read' | 'mixed';
}

export interface RecordsSource {
  part: string;
  years: number[];
  latest_year: number;
  states: string[];
  health_centers: number;
  workbooks: Record<string, Workbook>;
  source_commit: string | null;
}

export type MarkName = 'no_entry' | 'withheld_small' | 'withheld_confidential';
const MARK_OF: Record<string, MarkName> = { '-': 'no_entry', '--': 'withheld_small', '---': 'withheld_confidential' };

/** The three marks of HRSA's file, with the cover sheet's own words, and the words a cell shows. */
export const MARKS: readonly { mark: string; name: MarkName; cell: string; cover: string }[] = [
  { mark: '-', name: 'no_entry', cell: 'No entry', cover: 'no data entry by health center' },
  { mark: '--', name: 'withheld_small', cell: 'Withheld, small count', cover: 'suppressed patient counts between 1-15 to protect patient privacy' },
  { mark: '---', name: 'withheld_confidential', cell: 'Withheld, confidential', cover: 'suppressed health center confidential data' },
];
export const CLINX_WORDS = 'Withheld by ClinX';
export const TYPED_WORDS = 'Typed text, not kept';

/** HRSA's table codes with a plain label of ClinX's own beside each. */
export const TABLE_LABELS: Readonly<Record<string, string>> = {
  'Table 3A': 'Patients by age and sex assigned at birth',
  'Table 3B': 'Demographic characteristics of patients',
  'Table 4': 'Selected patient characteristics',
  'Table 5': 'Staffing and utilization',
  'Table 6A': 'Selected diagnoses and services rendered',
  'Table 6B': 'Quality of care measures',
  'Table 7': 'Health outcomes and disparities',
  'Table 8A': 'Financial costs',
  'Table 9D': 'Patient-related revenue',
  'Table 9E': 'Other revenue',
  'Table HIT': 'Health information technology',
  ODE: 'Other data elements',
  WFC: 'Workforce training',
};
/** Tables of questions with an answer beside each: each answer has its own column title, so they are listed cell by cell. */
const QUESTION_TABLES = new Set(['Table HIT', 'ODE', 'WFC']);
/** The tables readers open most, drawn open at first. */
const OPEN_TABLES = new Set(['Table 3A', 'Table 3B', 'Table 4']);

// ---------------------------------------------------------------------------------------------
// The files

const text = (name: string): string => {
  const hit = Object.entries(csvTexts).find(([path]) => path.endsWith(`/${name}`));
  if (!hit) throw new Error(`health-centers/records/${name} is missing from src/data`);
  return hit[1];
};

/** The text of a copied file by the name it has in the copy (centers/<key>.json, lines.csv, ...). Downloads are served from this. */
export function rawFile(name: string): string {
  if (name.startsWith('centers/')) {
    const hit = Object.entries(centerTexts).find(([path]) => path.endsWith(`/${name}`));
    if (!hit) throw new Error(`health-centers/records/${name} is missing from src/data`);
    return hit[1];
  }
  return text(name);
}

export function recordsSource(): RecordsSource {
  const doc = Object.values(sourceDocs)[0];
  if (!doc) throw new Error('src/data/health-centers/records/SOURCE.json is missing. Run: node scripts/sync-health-centers.mjs records');
  return doc;
}

export interface HeaderRow {
  key: string;
  /** The row of this health center in the HealthCenterInfo sheet of HRSA's workbook. */
  sheetRow: string;
  grant: string;
  year: number;
  name: string;
  street: string;
  addressLine2: string;
  city: string;
  state: string;
  zip: string;
  flags: Record<'chc' | 'mhc' | 'ho' | 'ph' | 'msaw' | 'hp' | 'rph', string>;
  urbanRural: string;
  sites: number;
}

export interface LineRow {
  year: number;
  uiid: string;
  table: string;
  sheet: string;
  sheetColumn: string;
  line: string;
  lineTitle: string;
  column: string;
  columnTitle: string;
  kind: string;
}

let headersCache: HeaderRow[] | undefined;
export function headerRows(): HeaderRow[] {
  headersCache ??= parseCsv(text('health-centers.csv')).map((r) => ({
    key: r['health_center']!,
    sheetRow: r['sheet_row']!,
    grant: r['grant_number']!,
    year: Number(r['year']),
    name: r['name_as_published']!,
    street: r['street']!,
    addressLine2: r['address_line_2']!,
    city: r['city']!,
    state: r['state']!,
    zip: r['zip']!,
    flags: { chc: r['funding_chc']!, mhc: r['funding_mhc']!, ho: r['funding_ho']!, ph: r['funding_ph']!, msaw: r['funding_msaw']!, hp: r['funding_hp']!, rph: r['funding_rph']! },
    urbanRural: r['urban_rural']!,
    sites: Number(r['sites']),
  }));
  return headersCache;
}

let linesCache: Map<number, LineRow[]> | undefined;
export function linesOf(year: number): LineRow[] {
  if (!linesCache) {
    linesCache = new Map();
    for (const r of parseCsv(text('lines.csv'))) {
      const y = Number(r['year']);
      const row: LineRow = { year: y, uiid: r['uiid']!, table: r['table_name']!, sheet: r['sheet']!, sheetColumn: r['sheet_column']!, line: r['line']!, lineTitle: r['line_title']!, column: r['column']!, columnTitle: r['column_title']!, kind: r['kind']! };
      const list = linesCache.get(y) ?? [];
      list.push(row);
      linesCache.set(y, list);
    }
  }
  return linesCache.get(year) ?? [];
}

let notesCache: Map<string, string> | undefined;
/** The notes on single cells (a number published with an exponent), by year, health center and cell. */
function noteOf(year: number, key: string, uiid: string): string | undefined {
  notesCache ??= new Map(parseCsv(text('notes.csv')).map((r) => [`${r['year']}/${r['health_center']}/${r['uiid']}`, r['note']!]));
  return notesCache.get(`${year}/${key}/${uiid}`);
}

interface SheetStatus {
  sheet_row: string | null;
  status: 'row_present' | 'row_withheld_unnamed' | 'row_absent';
}
interface CenterYearDoc {
  health_center: Record<string, string>;
  reads: string;
  source: { file: string; report_last_refreshed: string };
  tables: Record<string, SheetStatus>;
  values: Record<string, string | null>;
  sites: { columns: string[]; rows: string[][] };
  zip_codes: { columns: string[]; rows: string[][] };
}
interface CenterDoc {
  key: string;
  grant_number: string;
  years: Record<string, CenterYearDoc>;
}

const docCache = new Map<string, CenterDoc>();
function centerDoc(key: string): CenterDoc {
  let doc = docCache.get(key);
  if (!doc) {
    doc = JSON.parse(rawFile(`centers/${key}.json`)) as CenterDoc;
    docCache.set(key, doc);
  }
  return doc;
}

// ---------------------------------------------------------------------------------------------
// Addresses

/** The address segment of a health center: its key in lower case. */
export const slugOf = (key: string): string => key.toLowerCase();

/** The address of one report. A health center's short address shows the latest report HRSA's files hold for it. */
export function centerPath(key: string, year: number): string {
  return year === lastYearOf(key) ? `${RECORDS_PATH}${slugOf(key)}/` : `${RECORDS_PATH}${slugOf(key)}/${year}/`;
}
/** The places the records cover, in words: "eleven states and the District of Columbia". */
export function placesWords(codes: readonly string[]): string {
  const withDc = codes.includes('DC');
  const n = codes.length - (withDc ? 1 : 0);
  const states = `${numberWord(n)} ${n === 1 ? 'state' : 'states'}`;
  return withDc ? `${states} and the District of Columbia` : states;
}
/** The anchor of a state's part of the list of health centers. */
export const stateAnchor = (code: string): string => `in-${code.toLowerCase()}`;
/** The address of a state's part of the list. */
export const statePath = (code: string): string => `${RECORDS_PATH}#${stateAnchor(code)}`;
export const centerDownload = (key: string): string => `${DATA_PATH}centers/${slugOf(key)}.json`;
export const DOWNLOADS = {
  centers: `${DATA_PATH}health-centers.csv`,
  lines: `${DATA_PATH}lines.csv`,
  coverage: `${DATA_PATH}coverage.csv`,
};

export function centerKeys(): string[] {
  return [...new Set(headerRows().map((h) => h.key))];
}

let yearsCache: Map<string, number[]> | undefined;
/** The years HRSA's files list a health center, earliest first. */
export function yearsOf(key: string): number[] {
  if (!yearsCache) {
    yearsCache = new Map();
    for (const h of headerRows()) yearsCache.set(h.key, [...(yearsCache.get(h.key) ?? []), h.year]);
    for (const years of yearsCache.values()) years.sort((a, b) => a - b);
  }
  return yearsCache.get(key) ?? [];
}
/** The latest year HRSA's files list a health center. */
export function lastYearOf(key: string): number {
  const years = yearsOf(key);
  return years[years.length - 1] ?? recordsSource().latest_year;
}
/** The years of the records in which HRSA's files do not list a health center. */
export function yearsMissing(key: string): number[] {
  const has = new Set(yearsOf(key));
  return recordsSource().years.filter((y) => !has.has(y));
}

export interface ListRow {
  key: string;
  name: string;
  city: string;
  state: string;
  stateName: string;
  years: number[];
  /** The latest year HRSA's files list this health center: the year its name, city and short address come from. */
  lastYear: number;
  path: string;
}

let listCache: ListRow[] | undefined;
/**
 * The list: each health center as the latest file that lists it names it. The order is by state, A to Z,
 * then by name, A to Z. It is the order of the list on the page and of the steps at the foot of each report.
 */
export function listRows(): ListRow[] {
  listCache ??= headerRows()
    .filter((h) => h.year === lastYearOf(h.key))
    .map((h) => ({
      key: h.key,
      name: h.name,
      city: h.city,
      state: h.state,
      stateName: stateName(h.state),
      years: yearsOf(h.key),
      lastYear: h.year,
      path: centerPath(h.key, h.year),
    }))
    .sort((a, b) => a.stateName.localeCompare(b.stateName, 'en') || a.name.localeCompare(b.name, 'en') || a.key.localeCompare(b.key, 'en'));
  return listCache;
}

export interface StateGroup {
  code: string;
  name: string;
  rows: ListRow[];
}
/** The list in its groups: one for each state the records cover, A to Z by the state's name. */
export function listByState(): StateGroup[] {
  const groups: StateGroup[] = [];
  for (const row of listRows()) {
    const last = groups[groups.length - 1];
    if (last && last.code === row.state) last.rows.push(row);
    else groups.push({ code: row.state, name: row.stateName, rows: [row] });
  }
  return groups;
}

export interface CoverageRow {
  year: number;
  state: string;
  /** The number of health centers HRSA's file for the year lists in the state. */
  healthCenters: number;
  covered: boolean;
}
let coverageCache: CoverageRow[] | undefined;
/** How many health centers HRSA lists in each state and territory each year, and whether the records cover the state. */
export function coverageRows(): CoverageRow[] {
  coverageCache ??= parseCsv(text('coverage.csv')).map((r) => ({
    year: Number(r['year']),
    state: r['state']!,
    healthCenters: Number(r['health_centers']),
    covered: r['covered'] === 'yes',
  }));
  return coverageCache;
}

// ---------------------------------------------------------------------------------------------
// Words

export function formatDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new Error(`Not a day: ${iso}`);
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** "05/07/2026 12:00 AM EST" as the cover sheet prints it, to the day: 7 May 2026. */
export function refreshDay(published: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(published);
  if (!m) throw new Error(`Not a day: ${published}`);
  return `${Number(m[2])} ${MONTHS[Number(m[1]) - 1]} ${m[3]}`;
}

export function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function listOfYears(years: readonly number[]): string {
  if (years.length <= 1) return years.join('');
  return `${years.slice(0, -1).join(', ')} and ${years[years.length - 1]}`;
}

const group3 = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export interface Shown {
  text: string;
  /** True when the number is published with an exponent (1e+05): the text is HRSA's, character for character. */
  exponent: boolean;
}

/**
 * A published value for the page. The text is HRSA's. Whole numbers of patients, visits, dollars and
 * full-time equivalents get thousands separators, and dollars get a dollar sign. Nothing else changes.
 */
export function showValue(raw: string, kind: string, titles = ''): Shown {
  if (/^\d+(\.\d+)?e[+-]?\d+$/i.test(raw)) return { text: raw, exponent: true };
  // A number that names a thing (a product list number) is not a quantity and gets no separators.
  const grouped = ['patients', 'visits', 'dollars', 'fte', 'count', 'other'].includes(kind) && !/\b(list number|identifier|code)\b/i.test(titles);
  const m = /^(-?)(0|[1-9]\d*)(\.\d+)?$/.exec(raw);
  if (!m || !grouped) return { text: raw, exponent: false };
  const [, sign, whole, fraction = ''] = m;
  if (fraction !== '' && kind !== 'dollars' && kind !== 'fte' && kind !== 'other') return { text: raw, exponent: false };
  const body = `${group3(whole!)}${fraction}`;
  return { text: kind === 'dollars' ? `${sign}$${body}` : `${sign}${body}`, exponent: false };
}

const FLAG_WORDS: Record<string, string> = {
  chc: 'Community Health Center',
  mhc: 'Migrant Health Center',
  ho: 'Health Care for the Homeless',
  ph: 'Public Housing Primary Care',
  msaw: 'Migratory and Seasonal Agricultural Workers',
  hp: 'Homeless Population',
  rph: 'Residents of Public Housing',
};

/** The funding types HRSA's file marks TRUE for a center in a year, each with HRSA's flag and words. */
export function fundingTypes(h: HeaderRow): { flag: string; words: string }[] {
  return (Object.keys(h.flags) as (keyof HeaderRow['flags'])[])
    .filter((k) => h.flags[k] === 'TRUE')
    .map((k) => ({ flag: k.toUpperCase(), words: FLAG_WORDS[k]! }));
}

/** Where the name differs between years: one sentence, or an empty text. */
export function nameSentence(key: string): string {
  const rows = headerRows().filter((h) => h.key === key).sort((a, b) => a.year - b.year);
  const names = [...new Set(rows.map((r) => r.name))];
  if (names.length <= 1) return '';
  const parts = names.map((n) => `“${n}” in ${listOfYears(rows.filter((r) => r.name === n).map((r) => r.year))}`);
  return `HRSA's files print the name in more than one way: ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}.`;
}

// ---------------------------------------------------------------------------------------------
// One health center in one year

export type CellKind = 'value' | 'mark' | 'clinx' | 'typed' | 'empty' | 'unnamed' | 'absent';

export interface RCell {
  uiid: string;
  column: string;
  columnTitle: string;
  line: string;
  lineTitle: string;
  kind: CellKind;
  mark: MarkName | null;
  /** What the cell shows: the published value, or the mark in words. */
  text: string;
  exponent: boolean;
  /** The published text, before separators; empty for a mark or a withheld cell. */
  raw: string;
  /** Where the cell sits in HRSA's workbook: the column letter and the row (with the sheet when a table has two). */
  ref: string;
}

export interface RRow {
  line: string;
  title: string;
  cells: (RCell | null)[];
}

export interface RBlock {
  columns: { id: string; title: string }[];
  /** Each row's cells are aligned with the block's columns; a column the line does not have is null. */
  rows: RRow[];
  /** Set when a wide block was split by HRSA's column sections: which columns this part holds, as in "columns 1a to 1d". */
  part?: string;
}

export interface RTable {
  id: string;
  name: string;
  label: string;
  open: boolean;
  sheets: { sheet: string; row: string | null; status: SheetStatus['status'] }[];
  status: 'present' | 'unnamed' | 'absent';
  /** grid: one column for each column of HRSA's dictionary. list: the column titles differ from line to line, so each cell has its own line. */
  layout: 'grid' | 'list';
  /** The lines in HRSA's order, grouped in blocks. A block ends where a column code gets another title (Table 4 puts several small tables in one). */
  blocks: RBlock[];
  lineCount: number;
  cellCount: number;
  /** When every cell of a present table carries the same mark, that mark. */
  onlyMark: MarkName | null;
}

export interface GlanceBlock {
  id: string;
  heading: string;
  where: string;
  table: RTable;
  columns: { id: string; title: string }[];
  rows: RRow[];
}

export interface SiteRow {
  name: string;
  type: string;
  status: string;
  locationType: string;
  setting: string;
  schedule: string;
  calendar: string;
  hours: string;
  area: string;
  operatedBy: string;
  address: string;
}

export interface ZipRow {
  zip: string;
  type: string;
  cells: { label: string; text: string; mark: MarkName | null }[];
}

export interface YearView {
  key: string;
  year: number;
  header: HeaderRow;
  years: number[];
  path: string;
  tables: RTable[];
  glance: GlanceBlock[];
  sites: SiteRow[];
  /** The day of the site list as HRSA prints it (data_as_of of the first site), or empty. */
  sitesAsOf: string;
  zips: ZipRow[];
  zipColumns: string[];
  clinxWithheld: number;
  exponents: number;
  workbook: Workbook;
  reads: string;
}

const tableSlug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const GLANCE_SPECS: { id: string; heading: string; table: string; lines: string[]; columns: string[]; where: string }[] = [
  { id: 'glance-patients', heading: 'Total patients', table: 'Table 3B', lines: ['L8'], columns: ['Cd'], where: 'Table 3B, line 8' },
  { id: 'glance-income', heading: 'Patients by income as a share of the poverty guideline', table: 'Table 4', lines: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'], columns: ['Ca'], where: 'Table 4, lines 1 to 6' },
  { id: 'glance-insurance', heading: 'Patients by insurance', table: 'Table 4', lines: ['L7', 'L8', 'L9', 'L10', 'L11', 'L12'], columns: ['Ca', 'Cb'], where: 'Table 4, lines 7 to 12' },
  { id: 'glance-visits', heading: 'Total visits', table: 'Table 5', lines: ['L34'], columns: ['Cb', 'Cb2'], where: 'Table 5, line 34' },
];

/** The largest published figure in a glance block: the one scale for its bars. Zero when no cell holds a number. */
export function glanceScale(b: GlanceBlock): number {
  let max = 0;
  for (const r of b.rows) {
    for (const c of r.cells) {
      const n = c !== null && c.kind === 'value' ? Number(c.raw) : Number.NaN;
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max;
}

/** A bar's width as a percentage of the scale, to one decimal. A figure above zero keeps a sliver; a mark or a zero has no bar. */
export function glanceBar(c: RCell, scale: number): number {
  const n = Number(c.raw);
  if (c.kind !== 'value' || c.raw === '' || !Number.isFinite(n) || n <= 0 || scale <= 0) return 0;
  return Math.min(100, Math.max(1, Math.round((n / scale) * 1000) / 10));
}

/** A table with this many value columns or more is laid out as a dense table: short headings, and a key with HRSA's titles. */
export const DENSE_FROM = 6;

/** A dense table with more columns than this, holding a figure longer than WIDE_FIGURE_LENGTH characters, is shown as two tables. */
const WIDE_FIGURES_MAX_COLUMNS = 7;
const WIDE_FIGURE_LENGTH = 9;

/** Short headings for the columns of HRSA's widest tables. HRSA's own title of each column is printed in the key above the table. */
const SHORT_COLUMNS: Record<string, [RegExp, string][]> = {
  'Table 3B': [
    [/^Yes, Mexican/, 'Mexican'],
    [/^Yes, Puerto Rican/, 'Puerto Rican'],
    [/^Yes, Cuban/, 'Cuban'],
    [/^Yes, Another Hispanic/, 'Another Hispanic origin'],
    [/^Yes, Hispanic, Latino\/a, Spanish Origin, Combined/, 'Hispanic, combined'],
    [/^Total Hispanic/, 'Total Hispanic'],
    [/^Not Hispanic/, 'Not Hispanic'],
    [/^Unreported/, 'Unreported'],
    [/^Total \(d\)/, 'Total'],
  ],
  'Table 7': [
    [/^Prenatal Care Patients Who Delivered/, 'Delivered'],
    [/^Live Births: <1500 grams/, 'Births, <1500 g'],
    [/^Live Births: 1500–2499 grams/, 'Births, 1500–2499 g'],
    [/^Live Births: >= 2500 grams/, 'Births, >= 2500 g'],
    [/^Total Patients 18 through \d+ Years of Age with Hypertension/, 'Hypertension, patients'],
    [/^Patients with Hypertension Controlled/, 'Hypertension controlled'],
    [/^Total Patients 18 through \d+ Years of Age with Diabetes/, 'Diabetes, patients'],
    [/^Number of Records Reviewed/, 'Records reviewed'],
    [/^Number Charts Sampled or EHR Total/, 'Charts sampled or EHR total'],
    [/^Patients with HbA1c >9% or No Test/, 'HbA1c >9% or no test'],
    [/^Patients with Glycemic Status Assessment >9%, Missing, or No Test/, 'Glycemic status >9%, missing or no test'],
  ],
  'Table 9D': [
    [/^Full Charges This Period/, 'Full charges'],
    [/^Amount Collected This Period/, 'Collected'],
    [/^Collection of Reconciliation\/Wraparound Current Year/, 'Wraparound, current year'],
    [/^Collection of Reconciliation\/Wraparound Previous Years/, 'Wraparound, previous years'],
    [/^Collection of Other Payments/, 'Other payments'],
    [/^Penalty\/Payback/, 'Penalty or payback'],
    [/^Sliding Fee Discounts/, 'Sliding fee discounts'],
    [/^Bad Debt Write-Off/, 'Bad debt write-off'],
  ],
};

/** A column title in two parts: its words, and HRSA's column code when the title ends with one, as in "Yes, Cuban (a3)". */
export function columnParts(title: string): { words: string; code: string } {
  const m = /^(.*?)\s*\(([0-9]?[a-z][0-9]?)\)(\s*\(Sum Columns[^)]*\))?$/.exec(title);
  return m ? { words: m[1]!, code: m[2]! } : { words: title, code: '' };
}

/** The heading of a column in a dense table: a short one where ClinX has written it, else HRSA's words without the code. */
export function shortColumn(table: string, title: string): string {
  const hit = (SHORT_COLUMNS[table] ?? []).find(([re]) => re.test(title));
  return hit ? hit[1] : columnParts(title).words;
}

/**
 * Groups lines in blocks. A block ends where a column code that the block already has comes with another title,
 * and where a line shares no column with the block before it (Table 7 opens with two lines of their own).
 */
function makeBlocks(rows: { line: string; title: string; cells: RCell[] }[]): RBlock[] {
  const blocks: { titles: Map<string, string>; rows: typeof rows }[] = [];
  let cur: (typeof blocks)[number] | undefined;
  for (const row of rows) {
    const conflict = cur !== undefined && row.cells.some((c) => cur!.titles.has(c.column) && cur!.titles.get(c.column) !== c.columnTitle);
    const apart = cur !== undefined && cur.titles.size > 0 && row.cells.length > 0 && row.cells.every((c) => !cur!.titles.has(c.column));
    if (!cur || conflict || apart) {
      cur = { titles: new Map(), rows: [] };
      blocks.push(cur);
    }
    for (const c of row.cells) if (!cur.titles.has(c.column)) cur.titles.set(c.column, c.columnTitle);
    cur.rows.push(row);
  }
  return blocks.flatMap((b) => {
    const columns = [...b.titles.entries()].map(([id, title]) => ({ id, title }));
    const whole: RBlock = { columns, rows: b.rows.map((r) => ({ line: r.line, title: r.title, cells: columns.map((c) => r.cells.find((x) => x.column === c.id) ?? null) })) };
    return splitBySection(whole);
  });
}

/**
 * A dense block whose column codes all open with a section digit (1a, 1b, 2a, ...) becomes one block for each
 * section, in HRSA's order, each with the lines that have a cell in it. A dense block of long figures becomes two.
 * Any other block is returned as it is.
 */
export function splitBySection(block: RBlock): RBlock[] {
  if (block.columns.length < DENSE_FROM) return [block];
  const section = block.columns.map((c) => /^[0-9]/.exec(columnParts(c.title).code)?.[0] ?? '');
  const names = [...new Set(section)];
  const part = (keep: number[]): RBlock => {
    const columns = keep.map((i) => block.columns[i]!);
    const names = columns.map((c) => columnParts(c.title).code || columnParts(c.title).words);
    const rows = block.rows.map((r) => ({ line: r.line, title: r.title, cells: keep.map((i) => r.cells[i] ?? null) })).filter((r) => r.cells.some((c) => c !== null));
    return { columns, rows, part: names.length > 1 ? `columns ${names[0]} to ${names[names.length - 1]}` : `column ${names[0]}` };
  };
  const all = block.columns.map((_, i) => i);
  if (!names.includes('') && names.length >= 2) return names.map((name) => part(all.filter((i) => section[i] === name)));
  // Long figures (dollar amounts) in more than seven columns do not fit a page: two tables, cut where the letter of the column code changes, as near the middle as that allows.
  const longest = Math.max(0, ...block.rows.flatMap((r) => r.cells.map((c) => (c !== null && c.kind === 'value' ? c.text.length : 0))));
  if (block.columns.length <= WIDE_FIGURES_MAX_COLUMNS || longest <= WIDE_FIGURE_LENGTH) return [block];
  const letter = block.columns.map((c) => columnParts(c.title).code.replace(/[0-9]/g, ''));
  const cuts = all.slice(1).filter((i) => letter[i] !== letter[i - 1]);
  if (cuts.length === 0) return [block];
  const middle = block.columns.length / 2;
  const cut = cuts.reduce((near, i) => (Math.abs(i - middle) < Math.abs(near - middle) ? i : near));
  return [part(all.slice(0, cut)), part(all.slice(cut))];
}

export function buildYearView(key: string, year: number): YearView {
  const header = headerRows().find((h) => h.key === key && h.year === year);
  if (!header) throw new Error(`No ${year} report for ${key}`);
  const doc = centerDoc(key).years[String(year)];
  if (!doc) throw new Error(`centers/${key}.json has no ${year}`);
  const source = recordsSource();
  const workbook = source.workbooks[String(year)];
  if (!workbook) throw new Error(`No workbook facts for ${year}`);

  const lines = linesOf(year);
  const order: string[] = [];
  const byTable = new Map<string, LineRow[]>();
  for (const l of lines) {
    if (!byTable.has(l.table)) {
      byTable.set(l.table, []);
      order.push(l.table);
    }
    byTable.get(l.table)!.push(l);
  }

  let clinxWithheld = 0;
  let exponents = 0;
  const tables: RTable[] = order.map((name) => {
    const tableLines = byTable.get(name)!;
    const sheets = [...new Set(tableLines.map((l) => l.sheet))].map((sheet) => {
      const s = doc.tables[sheet];
      return { sheet, row: s?.sheet_row ?? null, status: s?.status ?? 'row_absent' };
    });
    const sheetStatus = (sheet: string) => sheets.find((s) => s.sheet === sheet)!;
    const present = sheets.some((s) => s.status === 'row_present');
    const status: RTable['status'] = present ? 'present' : sheets.every((s) => s.status === 'row_withheld_unnamed') ? 'unnamed' : 'absent';

    const rowOrder: string[] = [];
    const rowMap = new Map<string, RRow>();
    let cellCount = 0;
    const marksSeen = new Set<string>();
    let nonMark = 0;
    for (const l of tableLines) {
      const rowKey = `${l.line}\u0001${l.lineTitle}`;
      let row = rowMap.get(rowKey);
      if (!row) {
        row = { line: l.line, title: l.lineTitle, cells: [] };
        rowMap.set(rowKey, row);
        rowOrder.push(rowKey);
      }
      const st = sheetStatus(l.sheet);
      const where = `${l.sheetColumn}${st.row ?? ''}`;
      const ref = sheets.length > 1 ? `${l.sheet} ${where}` : where;
      const cell: RCell = { uiid: l.uiid, column: l.column, columnTitle: l.columnTitle, line: l.line, lineTitle: l.lineTitle, kind: 'value', mark: null, text: '', exponent: false, raw: '', ref };
      if (st.status !== 'row_present') {
        cell.kind = st.status === 'row_withheld_unnamed' ? 'unnamed' : 'absent';
        cell.ref = '';
      } else {
        const v = doc.values[l.uiid];
        if (v === undefined) cell.kind = 'typed';
        else if (v === null) {
          cell.kind = 'clinx';
          clinxWithheld += 1;
        } else if (v === '') cell.kind = 'empty';
        else if (MARK_OF[v]) {
          cell.kind = 'mark';
          cell.mark = MARK_OF[v]!;
          marksSeen.add(v);
        } else {
          const shown = showValue(v, l.kind, `${l.lineTitle} ${l.columnTitle}`);
          cell.raw = v;
          cell.text = shown.text;
          cell.exponent = shown.exponent || noteOf(year, key, l.uiid) === 'exponent_number';
          if (cell.exponent) exponents += 1;
          nonMark += 1;
        }
        cellCount += 1;
        if (cell.kind === 'clinx' || cell.kind === 'typed' || cell.kind === 'empty') nonMark += 1;
      }
      (row.cells as RCell[]).push(cell);
    }
    const ordered = rowOrder.map((k) => rowMap.get(k)!);
    const blocks = makeBlocks(ordered as unknown as { line: string; title: string; cells: RCell[] }[]);
    // Where nearly every line has its own column titles (questions, with an answer beside each), a list of cells reads better than a grid.
    const layout: RTable['layout'] = QUESTION_TABLES.has(name) || blocks.length * 2 > ordered.length ? 'list' : 'grid';
    const onlyMark = status === 'present' && cellCount > 0 && nonMark === 0 && marksSeen.size === 1 ? MARK_OF[[...marksSeen][0]!]! : null;
    return {
      id: tableSlug(name),
      name,
      label: TABLE_LABELS[name] ?? '',
      open: OPEN_TABLES.has(name),
      sheets,
      status,
      layout,
      blocks,
      lineCount: ordered.length,
      cellCount,
      onlyMark,
    };
  });

  const glance: GlanceBlock[] = [];
  for (const spec of GLANCE_SPECS) {
    const table = tables.find((t) => t.name === spec.table);
    if (!table) continue;
    // The block of the table that holds most of the wanted lines.
    const wanted = (b: RBlock) => b.rows.filter((r) => spec.lines.includes(r.line)).length;
    const block = [...table.blocks].sort((x, y) => wanted(y) - wanted(x))[0];
    if (!block || wanted(block) === 0) continue;
    const at = block.columns.map((c, i) => (spec.columns.includes(c.id) ? i : -1)).filter((i) => i >= 0);
    if (at.length === 0) continue;
    const columns = at.map((i) => block.columns[i]!);
    const rows = block.rows.filter((r) => spec.lines.includes(r.line)).map((r) => ({ ...r, cells: at.map((i) => r.cells[i] ?? null) }));
    glance.push({ id: spec.id, heading: spec.heading, where: spec.where, table, columns, rows });
  }

  const col = (columns: string[], row: string[], name: string): string => row[columns.indexOf(name)] ?? '';
  const sites: SiteRow[] = doc.sites.rows.map((r) => {
    const c = doc.sites.columns;
    const street = col(c, r, 'street');
    const city = col(c, r, 'city');
    return {
      name: col(c, r, 'site_name'),
      type: col(c, r, 'site_type'),
      status: col(c, r, 'site_status'),
      locationType: col(c, r, 'location_type'),
      setting: col(c, r, 'location_setting'),
      schedule: col(c, r, 'operational_schedule'),
      calendar: col(c, r, 'calendar_schedule'),
      hours: col(c, r, 'weekly_hours_as_published'),
      area: col(c, r, 'service_area_population'),
      operatedBy: col(c, r, 'operated_by'),
      address: [street, city, `${col(c, r, 'state')} ${col(c, r, 'zip')}`.trim()].filter((p) => p !== '').join(', '),
    };
  });

  const zipLabels: [string, string][] = [
    ['uninsured', 'None/Uninsured'],
    ['medicaid_chip_other_public', 'Medicaid, CHIP and other public'],
    ['medicare', 'Medicare'],
    ['private', 'Private'],
    ['total', 'Total'],
  ];
  const zips: ZipRow[] = doc.zip_codes.rows.map((r) => {
    const c = doc.zip_codes.columns;
    return {
      zip: col(c, r, 'zip'),
      type: col(c, r, 'zip_type'),
      cells: zipLabels.map(([stem, label]) => {
        const value = col(c, r, `${stem}_as_published`);
        const mark = MARK_OF[value] ?? null;
        return { label, mark, text: mark ? '' : showValue(value, 'patients').text };
      }),
    };
  });

  return { key, year, header, years: yearsOf(key), path: centerPath(key, year), tables, glance, sites, sitesAsOf: col(doc.sites.columns, doc.sites.rows[0] ?? [], 'data_as_of'), zips, zipColumns: zipLabels.map((z) => z[1]), clinxWithheld, exponents, workbook, reads: doc.reads };
}

/** The words a mark shows in a cell. */
export function markWords(mark: MarkName): string {
  return MARKS.find((m) => m.name === mark)!.cell;
}

/** The words a cell shows when it is not a published value. */
export function cellWords(cell: RCell): string {
  switch (cell.kind) {
    case 'mark':
      return markWords(cell.mark!);
    case 'clinx':
      return CLINX_WORDS;
    case 'typed':
      return TYPED_WORDS;
    case 'unnamed':
      return 'Not named in the file';
    case 'absent':
      return 'No row in the file';
    default:
      return '';
  }
}
