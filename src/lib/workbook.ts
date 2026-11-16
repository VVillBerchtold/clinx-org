/**
 * How a cell of an Excel workbook (Ohio's reports) is shown.
 *
 * In plain words: a workbook stores each figure as a number the way a spreadsheet does, often with
 * many decimal places. A page shows a dollar amount to the cent (a whole number of dollars with no
 * cents) and a percentage to at most two decimal places, with commas between thousands. The rounding
 * is done on the digits of the stored text, half away from zero, and never through a floating-point
 * number. The dataset and the downloads keep the text as filed. A cell that holds words where a figure
 * belongs shows the words. A cell the small-number rule withholds shows a mark and, in words, why.
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
  /** A plain number to sort by (the full stored value), or empty. */
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

/** A stored number read as digits: its sign, all its digits, and how many of them follow the decimal point. */
export interface DecimalParts {
  negative: boolean;
  digits: string;
  scale: number;
}

const DECIMAL = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/** Reads plain or exponent text ("12.5", "-3", "1.31457589E7") without a floating-point number. Null for anything else. */
export function decimalParts(text: string): DecimalParts | null {
  const m = DECIMAL.exec(text.trim());
  if (!m) return null;
  let digits = `${m[2]}${m[3] ?? ''}`;
  let scale = (m[3] ?? '').length - Number(m[4] ?? 0);
  if (scale < 0) {
    digits += '0'.repeat(-scale);
    scale = 0;
  }
  return { negative: m[1] === '-', digits: digits.replace(/^0+(?=\d)/, ''), scale };
}

/** The same number as plain text with no exponent ("1.31457589E7" is "13145758.9"). Text that is not a number comes back as it went in. */
export function plainDecimal(text: string): string {
  const p = decimalParts(text);
  if (!p) return text;
  const padded = p.digits.padStart(p.scale + 1, '0');
  const whole = padded.slice(0, padded.length - p.scale);
  const fraction = padded.slice(padded.length - p.scale);
  return `${p.negative ? '-' : ''}${whole}${fraction === '' ? '' : `.${fraction}`}`;
}

/**
 * A decimal text rounded to a number of decimal places, half away from zero, on the digits of the
 * text: "0.995" to 2 places is "1.00", "999.999" is "1000.00", "-2.345" is "-2.35". A result of zero
 * has no minus sign. Null when the text is not a number.
 */
export function roundDecimal(text: string, places: number): string | null {
  const p = decimalParts(text);
  if (!p) return null;
  let digits = p.digits;
  if (p.scale <= places) digits += '0'.repeat(places - p.scale);
  else {
    const cut = p.scale - places;
    const padded = digits.padStart(cut + 1, '0');
    const kept = padded.slice(0, padded.length - cut);
    const next = padded.charAt(padded.length - cut);
    digits = (BigInt(kept) + (next >= '5' ? 1n : 0n)).toString();
  }
  digits = digits.padStart(places + 1, '0');
  const whole = digits.slice(0, digits.length - places);
  const fraction = digits.slice(digits.length - places);
  const body = places > 0 ? `${whole}.${fraction}` : whole;
  return p.negative && /[1-9]/.test(digits) ? `-${body}` : body;
}

/** Commas between thousands in a plain decimal text such as "-1234567.8". */
function withCommas(plain: string): string {
  const m = /^(-?)(\d+)(\.\d+)?$/.exec(plain)!;
  return `${m[1]}${m[2]!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${m[3] ?? ''}`;
}

/**
 * A dollar amount as the page prints it. A number filed with no decimals (or only zeros after the
 * point) prints with none: "$57,713,925". Any other number prints with exactly two decimals, rounded
 * half away from zero: "$9,764.99". Text that is not a number comes back as it went in.
 */
export function formatDollars(text: string): string {
  const p = decimalParts(text);
  if (!p) return text;
  const whole = p.scale === 0 || /^0*$/.test(p.digits.slice(p.digits.length - p.scale));
  const rounded = roundDecimal(text, whole ? 0 : 2)!;
  return rounded.startsWith('-') ? `-$${withCommas(rounded.slice(1))}` : `$${withCommas(rounded)}`;
}

/** A percentage (the number, without the sign) to at most two decimal places, trailing zeros dropped: "72.6611162503854" is "72.66", "15.000" is "15". */
export function formatPercent(text: string): string {
  const rounded = roundDecimal(text, 2);
  if (rounded === null) return text;
  return withCommas(rounded.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''));
}

/** The cell at a row, as the page shows it. */
export function showCell(row: LineItem | undefined, unit: 'usd' | 'count' | 'percent'): ShownCell {
  if (!row) return { kind: 'none', text: '', why: '', sort: '', at: '' };
  const at = row.sourceCell;
  if (row.claimsWithheld !== '') return { kind: 'withheld', text: 'Withheld', why: WITHHELD_SHORT[row.claimsWithheld] ?? row.claimsWithheld, sort: '', at };
  // A count is in the claims column; the one count that is not a prescription count (the number of contract pharmacies) is in the amount.
  const stored = unit === 'count' && row.claimsAsFiled !== '' ? row.claimsAsFiled : row.amountAsFiled;
  const trimmed = stored.trim();
  if (trimmed === '') return { kind: 'none', text: '', why: '', sort: '', at };
  if (decimalParts(trimmed) === null) return { kind: 'words', text: trimmed, why: '', sort: '', at };
  if (unit === 'usd') return { kind: 'figure', text: formatDollars(trimmed), why: '', sort: plainDecimal(trimmed), at };
  if (unit === 'count') return { kind: 'figure', text: drawFigure(trimmed, 'count'), why: '', sort: plainDecimal(trimmed), at };
  // A percentage. A cell formatted as a percentage stores a fraction of one, and the row's note says so.
  const fraction = /fraction of one/.test(row.note);
  const shown = fraction ? shiftTwoPlaces(trimmed) : plainDecimal(trimmed);
  if (shown === null) return { kind: 'words', text: trimmed, why: '', sort: '', at };
  return { kind: 'figure', text: `${formatPercent(shown)}%`, why: '', sort: shown, at };
}

/** The name of a cell, in the workbook's own words, for a cell that is not one of a table's. */
export const cellLabel = (row: LineItem): string => row.labelAsFiled || row.descriptionAsFiled || row.sourceCell;
