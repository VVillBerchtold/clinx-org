// What the File Check engine gives the page. The engine is plain JavaScript (index.js and the
// files beside it); this file describes it for the type check.

import type { Kind } from '../../cleaner-copy/engine/index.js';

export type { Kind };

export type RuleId =
  | 'number-as-text'
  | 'leading-zeros'
  | 'mixed-kinds'
  | 'mixed-dates'
  | 'stray-spaces'
  | 'near-duplicates'
  | 'merged-cells'
  | 'blank-rows'
  | 'total-row'
  | 'repeated-heading'
  | 'empty-heading'
  | 'two-heading-rows'
  | 'repeated-id'
  | 'error-cells'
  | 'uneven-rows'
  | 'decimal-comma';

export interface Finding {
  rule: RuleId;
  /** 'fix' = will break a script or a pivot table; 'look' = worth a look; 'note' = good to know, nothing wrong. */
  weight: 'fix' | 'look' | 'note';
  /** The sheet's name; 'CSV file' for a CSV file. */
  sheet: string;
  /** The column's letter, when the finding is about one column. */
  column?: string;
  /** That column's heading, when it has one. For the person's own screen: it is a guess when the sheet's `headingsSure` is false. */
  heading?: string;
  /** How many cells, rows, columns or merged ranges the finding concerns: the things listed in `where`. */
  count: number;
  /** One plain sentence with counts and places and NO value from the file. A sheet's name may appear, and a heading when the sheet's `headingsSure` is true. */
  say: string;
  /** What to do about it, in plain words, with no value from the file. */
  fix: string;
  /** Up to 5 places: 'B14', 'row 212', 'A1:C1'. No values. Empty when the finding has no one place. */
  where: string[];
  /** Up to 5 example values with their places, for the person's own screen only. Never used in `say`, `fix` or `asText`. */
  examples: { at: string; value: string }[];
}

export interface SheetSummary {
  /** The sheet's name; 'CSV file' for a CSV file. */
  name: string;
  /** How many rows under the headings hold something. */
  rows: number;
  /** How many columns have a heading or hold data. */
  columns: number;
  /** The row that holds the column headings, or null when none was found. */
  headingRow: number | null;
  /**
   * True when that row is plainly a row of headings: a table names it, or a heading made of words sits on
   * a column of numbers or dates. When false, the row may be a row of data (a list of names with no
   * headings), so no sentence quotes it: `say` and `asText` name the columns by letter alone.
   */
  headingsSure: boolean;
  /** True for a sheet the workbook keeps hidden. It is checked like any other. */
  hidden: boolean;
}

export interface CheckReport {
  kind: Kind;
  /** Every sheet, in the workbook's order; one entry for a CSV file. */
  sheets: SheetSummary[];
  /** Sorted: 'fix' first, then 'look', then 'note'; within a weight, by sheet order, then by column. */
  findings: Finding[];
}

/** Says what kind of file this is, or why it cannot be read, in a sentence for the person. The Cleaner Copy engine's own. */
export function kindOf(name: string, bytes: Uint8Array): { kind: Kind } | { problem: string };

/**
 * Looks through a file and gives back what was found. Changes nothing.
 * Throws an Error whose message is a sentence for the person when the file is not a workbook or a CSV file.
 */
export function checkFile(bytes: Uint8Array, kind: Kind): Promise<CheckReport>;

/** The findings as plain text for pasting into a chat: counts, places, headings and sheet names, no values. */
export function asText(report: CheckReport): string;
