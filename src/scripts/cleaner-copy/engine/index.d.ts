// What the Cleaner Copy engine gives the page. The engine is plain JavaScript (index.js and the
// files beside it); this file describes it for the type check.

export type Kind = 'workbook' | 'csv';

export interface ColumnInfo {
  /** The column's letter, for example "C". */
  column: string;
  /** True when the person chose to leave this column alone. */
  kept: boolean;
  heading: string;
  cells: number;
  formulas: number;
  /** In words: "text", "number", "date", "yes/no", "formulas", or several joined by ", ". */
  holds: string;
  /** How many different values the column holds. */
  different: number;
  from: string;
  to: string;
  /** How many cells under the heading hold the same text as the heading. 0 for most columns. */
  headingAlsoValue: number;
  /** False at inspect; true in makeCopy's report for a column whose values were given codes. */
  coded: boolean;
  /** True when the column can be coded: it holds text or numbers, and no dates or formulas. Filled at inspect. */
  canCode: boolean;
}

export interface SheetInfo {
  /** The name the sheet has in the file the person gave. */
  name: string;
  /** The name the sheet has in the copy. Present only when the person chose a new name for it. */
  newName?: string;
  state: 'visible' | 'hidden' | 'veryHidden';
  headingRow: number | null;
  headingRows: number[];
  headingsFrom: 'table' | 'guess' | 'none';
  tables: number;
  cellsAboveHeadings: number;
  columns: ColumnInfo[];
}

export interface OutsideItem {
  what: string;
  where: string;
  count: number;
  action: string;
}

/** A text written inside a formula, a colour rule or a message that matches no cell. */
export interface FormulaText {
  what: string;
  text: string;
  times: number;
  first: string;
}

export interface Finding {
  what: string;
  where: string;
  detail: string;
}

export interface Report {
  parts: number;
  sheets: SheetInfo[];
  strings: { inAll: number; keptAsHeadings: number };
  /** Cells given a stand-in, by what they hold; `kept` counts the cells of the columns left alone; `coded` the cells that got a code. */
  replaced: { text: number; number: number; date: number; formulaResults: number; kept: number; coded: number; differentTexts: number };
  outsideTheCells: OutsideItem[];
  forALook: FormulaText[];
  worthKnowing: Finding[];
  /** Data another program stored in the file: how many parts, and whether one holds a Power Query. */
  extras: { parts: number; queries: boolean };
  /** For a CSV file only: its separator in words, how its text was written, and how many rows it has. */
  csv?: { separator: string; written: string; rows: number };
}

export interface Choices {
  /** Sheet name to the letters of the columns to leave alone. */
  keep?: Record<string, string[]>;
  /**
   * Sheet name (the original name; 'CSV file' for a CSV) to the letters of the columns to code.
   * A column listed in both `keep` and `code` is left alone.
   */
  code?: Record<string, string[]>;
  /** Present sheet name to the new name. */
  rename?: Record<string, string>;
  /** Texts from Report.forALook to replace with a stand-in wherever they are written. */
  swapText?: string[];
  /** Take out data another program stored in the file. Defaults to true. */
  dropExtras?: boolean;
}

export interface CheckItem {
  /** The original text that can still be found. Shown only to the person, on their own machine. */
  value: string;
  part: string;
  /** partMeaning(part): what that part of the file is, in plain words. */
  where: string;
  /** The tag or setting the value sits in. */
  sits: string;
  how: 'whole' | 'inside';
  kind: 'unexplained' | 'symbols' | 'untouched' | 'name' | 'listed' | 'chance' | 'digits';
  /** What the value looks like, said without saying it: "one word, letters only, 7 to 10 long". */
  shape: string;
  /** A for a capital, a for a small letter, 9 for a digit; "longer than 12" for a long value. */
  pattern: string;
}

export interface Check {
  /** False when the file was too large for the check to run. */
  ran: boolean;
  /** How many different texts were searched for. */
  searched: number;
  items: CheckItem[];
}

export interface DescribedSheet {
  name: string;
  headingRow: number | null;
  columns: { column: string; heading: string; holds: string; kept: boolean; coded: boolean; formula: string | null }[];
  /** The first few rows under the headings, as the copy holds them, one text per column. */
  rows: string[][];
}

export interface Copy {
  bytes: Uint8Array;
  report: Report;
  check: Check;
  described: DescribedSheet[];
  /** The legend of the coded columns, for the person to save. Empty when nothing is coded. Never written into the copy. */
  legend: LegendGroup[];
}

/** One set of codes: every coded column with the same heading shares it. */
export interface LegendGroup {
  /** The heading the codes are built from ("Payer" gives "Payer A", "Payer B"). */
  label: string;
  /** Where the codes are used, for a person to read: "Claims, column E" in a workbook, "column E" in a CSV file. */
  columns: string[];
  /** In code order: A, B ... Z, AA, AB ...; then numbers, ascending. */
  entries: { code: string; original: string }[];
}

/** Says what kind of file this is, or why it cannot be read, in a sentence for the person. */
export function kindOf(name: string, bytes: Uint8Array): { kind: Kind } | { problem: string };

/** Looks only. Changes nothing. */
export function inspect(bytes: Uint8Array, kind: Kind): Promise<Report>;

/** A sentence saying why a sheet cannot have this name, or null when it can. */
export function nameProblem(name: string, others: string[]): string | null;

/** Makes the copy, then searches it for every text that was replaced. */
export function makeCopy(bytes: Uint8Array, kind: Kind, choices: Choices): Promise<Copy>;

/**
 * Writes a legend as a small workbook: one sheet named "Legend" with the columns Heading, Where,
 * Code and Original. Every cell is written as text, so leading zeros are kept.
 */
export function legendWorkbook(legend: LegendGroup[]): Uint8Array;

/** The sample clinic report that the page offers for a first try. */
export const SAMPLE_NAME: string;
export function sampleBytes(): Uint8Array;
