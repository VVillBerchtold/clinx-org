/**
 * How a cell of an Excel workbook (Ohio's reports) is shown.
 *
 * In plain words: a workbook stores each figure as a number the way a spreadsheet does, often with
 * many decimal places. A page shows the figure as stored, with commas between thousands and a dollar
 * sign or a percent sign where the cell is a dollar amount or a percentage, and never rounds it. A
 * cell that holds words where a figure belongs shows the words. A cell the small-number rule
 * withholds shows a mark and, in words, why. Nothing here adds two figures together.
 */
import type { LineItem } from './data';
import { shiftTwoPlaces } from './data';
import { drawFigure } from './money';

export type CellKind = 'figure' | 'words' | 'withheld' | 'none';

export interface ShownCell {
  kind: CellKind;
  /** What the page prints (empty for a cell the workbook does not have). */
  text: string;
  /** A short reason, in words, for a withheld cell. */
  why: string;
  /** A plain number to sort by, or empty. */
  sort: string;
  /** The workbook cell it was read from. */
  at: string;
}

/** Why a cell is withheld, in a few words for the cell and in a sentence for the page. */
export const WITHHELD_SHORT: Readonly<Record<string, string>> = {
  fewer_than_6: 'fewer than 6',
  beside_small: 'next to a small count',
  reveals_small: 'would show a small count',
};

export const WITHHELD_SENTENCE: Readonly<Record<string, string>> = {
  fewer_than_6: 'The count of prescriptions is 1 to 5. A count that small is never published, here or in the data files.',
  beside_small: 'The figure is not withheld because it is small. Next to the printed totals it would let a reader work out a count of 1 to 5 in another cell.',
  reveals_small: 'The percentage would let a reader work out a count of 1 to 5 in another cell.',
};

const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/;

/** The cell at a row, as the page shows it. */
export function showCell(row: LineItem | undefined, unit: 'usd' | 'count' | 'percent'): ShownCell {
  if (!row) return { kind: 'none', text: '', why: '', sort: '', at: '' };
  const at = row.sourceCell;
  if (row.claimsWithheld !== '') return { kind: 'withheld', text: 'Withheld', why: WITHHELD_SHORT[row.claimsWithheld] ?? row.claimsWithheld, sort: '', at };
  // A count is in the claims column; the one count that is not a prescription count (the number of contract pharmacies) is in the amount.
  const stored = unit === 'count' && row.claimsAsFiled !== '' ? row.claimsAsFiled : row.amountAsFiled;
  if (stored.trim() === '') return { kind: 'none', text: '', why: '', sort: '', at };
  const trimmed = stored.trim();
  if (!PLAIN_NUMBER.test(trimmed) && !/^-?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(trimmed)) return { kind: 'words', text: stored.trim(), why: '', sort: '', at };
  if (unit === 'usd') return { kind: 'figure', text: `${trimmed.startsWith('-') ? '-' : ''}$${drawFigure(trimmed.replace(/^-/, ''), 'money')}`, why: '', sort: trimmed, at };
  if (unit === 'count') return { kind: 'figure', text: drawFigure(trimmed, 'count'), why: '', sort: trimmed, at };
  // A percentage. A cell formatted as a percentage stores a fraction of one, and the row's note says so.
  const fraction = /fraction of one/.test(row.note);
  const shown = fraction ? shiftTwoPlaces(trimmed) : trimmed;
  if (shown === null) return { kind: 'words', text: trimmed, why: '', sort: '', at };
  return { kind: 'figure', text: `${drawFigure(shown, 'count')}%`, why: '', sort: shown, at };
}

/** The name of a cell, in the workbook's own words, for a cell that is not one of a table's. */
export const cellLabel = (row: LineItem): string => row.labelAsFiled || row.descriptionAsFiled || row.sourceCell;
