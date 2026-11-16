/**
 * Totals across the workbooks of a state (Ohio), added by ClinX.
 *
 * In plain words: a filer's own cells are added exactly. Each cell's text is read as a number made of
 * whole digits (scaled to 20 decimal places), so no floating-point number is ever used and the sum is
 * the exact sum of the filed figures. A cell that is empty, holds words where a figure belongs, or is
 * withheld is left out and counted by reason. Each filer counts once: where a filer has more than one
 * workbook, the totals use the workbook whose file name is the 340B ID typed inside it.
 */
import type { LineItem, WorkbookView } from './data';
import { decimalParts, formatDollars } from './workbook';

/** Decimal places the sums are kept to. A filed figure has at most 17 digits, so this holds every one exactly. */
export const SUM_SCALE = 20;
const UNIT = 10n ** BigInt(SUM_SCALE);

/** A filed figure as a whole number of 10^-20. Null when the text is not a number. */
export function toScaled(text: string): bigint | null {
  const p = decimalParts(text);
  if (!p) return null;
  if (p.scale > SUM_SCALE) throw new RangeError(`Figure with more than ${SUM_SCALE} decimals: ${text}`);
  const n = BigInt(p.digits) * 10n ** BigInt(SUM_SCALE - p.scale);
  return p.negative ? -n : n;
}

/** A scaled sum as plain decimal text, with the trailing zeros after the point dropped. */
export function scaledToText(value: bigint): string {
  const negative = value < 0n;
  const abs = (negative ? -value : value).toString().padStart(SUM_SCALE + 1, '0');
  const whole = abs.slice(0, abs.length - SUM_SCALE);
  const fraction = abs.slice(abs.length - SUM_SCALE).replace(/0+$/, '');
  return `${negative && /[1-9]/.test(abs) ? '-' : ''}${whole}${fraction === '' ? '' : `.${fraction}`}`;
}

export type LeftOutKind = 'empty' | 'words' | 'withheld';

/** What one cell is for a sum: a figure (exact), or the reason it is left out. */
export type CellRead = { kind: 'figure'; value: bigint } | { kind: LeftOutKind };

export function readCell(row: LineItem | undefined): CellRead {
  if (!row) return { kind: 'empty' };
  if (row.claimsWithheld !== '') return { kind: 'withheld' };
  const text = row.amountAsFiled.trim();
  if (text === '') return { kind: 'empty' };
  const value = toScaled(text);
  return value === null ? { kind: 'words' } : { kind: 'figure', value };
}

export interface SumResult {
  /** The exact sum. */
  value: bigint;
  /** The sum as plain decimal text. */
  text: string;
  /** The sum as the page prints it. */
  shown: string;
  /** Cells added. */
  cells: number;
  /** Workbooks that gave at least one cell to the sum. */
  workbooks: number;
  /** Cells left out, by reason. */
  left: Record<LeftOutKind, number>;
  /** All cells looked at: those added plus those left out. */
  looked: number;
}

/** Adds the figures of the named cells ([schedule, line]) of each workbook. */
export function sumCells(views: readonly WorkbookView[], cells: ReadonlyArray<readonly [string, string]>): SumResult {
  let value = 0n;
  let added = 0;
  let books = 0;
  const left: Record<LeftOutKind, number> = { empty: 0, words: 0, withheld: 0 };
  for (const v of views) {
    let own = 0;
    for (const [schedule, line] of cells) {
      const read = readCell(v.cell(schedule, line));
      if (read.kind === 'figure') {
        value += read.value;
        added += 1;
        own += 1;
      } else left[read.kind] += 1;
    }
    if (own > 0) books += 1;
  }
  const text = scaledToText(value);
  return { value, text, shown: formatDollars(text), cells: added, workbooks: books, left, looked: views.length * cells.length };
}

/** The cells left out, in words: "2 empty and 1 with words". Empty text when none. */
export function leftOutWords(left: Record<LeftOutKind, number>): string {
  const parts = [
    left.empty > 0 ? `${left.empty} empty` : '',
    left.words > 0 ? `${left.words} with words where a figure belongs` : '',
    left.withheld > 0 ? `${left.withheld} withheld` : '',
  ].filter((p) => p !== '');
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** The file name without its extension. */
export const fileStem = (sourceFile: string): string => sourceFile.replace(/\.[^.]+$/, '');

/** The 340B ID typed inside a workbook (the identity cell), or empty. */
export const typedId = (v: WorkbookView): string => (v.cell('identity', 'hrsa_id')?.answerAsFiled ?? '').trim();

export interface FilerGroup {
  entityId: string;
  views: WorkbookView[];
}

/** The filers that have more than one workbook, found from the data (entities with more than one filing). */
export function repeatedFilers(views: readonly WorkbookView[]): FilerGroup[] {
  const byEntity = new Map<string, WorkbookView[]>();
  for (const v of views) {
    const list = byEntity.get(v.filing.entityId) ?? [];
    list.push(v);
    byEntity.set(v.filing.entityId, list);
  }
  return [...byEntity.entries()].filter(([, list]) => list.length > 1).map(([entityId, list]) => ({ entityId, views: list }));
}

export interface OneWorkbook {
  group: FilerGroup;
  /** The workbook the totals use. */
  used: WorkbookView;
  /** The others, left out. */
  leftOut: WorkbookView[];
}

/**
 * For each filer with more than one workbook, the one whose file name equals the 340B ID typed inside
 * it. A filer for whom that is not exactly one workbook stops the build: the rule would be guessing.
 */
export function chooseWorkbooks(views: readonly WorkbookView[]): OneWorkbook[] {
  return repeatedFilers(views).map((group) => {
    const matching = group.views.filter((v) => fileStem(v.filing.sourceFile).toUpperCase() === typedId(v).toUpperCase() && typedId(v) !== '');
    if (matching.length !== 1) {
      throw new Error(`${group.entityId}: ${matching.length} of ${group.views.length} workbooks have a file name equal to the typed ID (${group.views.map((v) => `${v.filing.sourceFile} types "${typedId(v)}"`).join('; ')})`);
    }
    return { group, used: matching[0]!, leftOut: group.views.filter((v) => v !== matching[0]) };
  });
}

/** The workbooks the totals add: every workbook, except those left out where a filer has more than one. */
export function countedWorkbooks(views: readonly WorkbookView[]): { counted: WorkbookView[]; leftOut: WorkbookView[]; rule: OneWorkbook[] } {
  const rule = chooseWorkbooks(views);
  const out = new Set(rule.flatMap((r) => r.leftOut));
  return { counted: views.filter((v) => !out.has(v)), leftOut: [...out], rule };
}

/** The five payers every table has, in the template's order, with the words for the page. */
export const PAYERS: ReadonlyArray<{ line: string; label: string }> = [
  { line: 'commercial', label: 'Commercial insurance' },
  { line: 'medicare', label: 'Medicare' },
  { line: 'medicaid', label: 'Medicaid' },
  { line: 'other_third_party', label: 'Other third-party payers' },
  { line: 'uninsured', label: 'Uninsured or self-pay' },
];

/** The schedules of each kind of figure, for the three ways a drug reaches a patient. */
export const CHANNELS: ReadonlyArray<{ id: string; label: string; cost: string; paid: string }> = [
  { id: 'in-house', label: 'Dispensed in house', cost: 'in_house_acquisition_cost', paid: 'in_house_payments_received' },
  { id: 'contract', label: 'Dispensed through contract pharmacies', cost: 'contract_acquisition_cost', paid: 'contract_payments_received' },
  { id: 'administered', label: 'Administered', cost: 'administered_acquisition_cost', paid: 'administered_payments_total' },
];

/**
 * Tables in which a workbook's total cell and its five payer cells all hold figures, and how many of
 * those do not add to the table's own total cell (more than a tenth of a cent apart, the tolerance
 * the dataset's own checks use).
 */
export function payerCellsAgree(views: readonly WorkbookView[]): { compared: number; differ: number } {
  const tolerance = UNIT / 1000n;
  let compared = 0;
  let differ = 0;
  for (const v of views) {
    for (const ch of CHANNELS) {
      for (const schedule of [ch.cost, ch.paid]) {
        const total = readCell(v.cell(schedule, 'total'));
        const parts = PAYERS.map((p) => readCell(v.cell(schedule, p.line)));
        if (total.kind !== 'figure' || parts.some((p) => p.kind !== 'figure')) continue;
        compared += 1;
        const added = parts.reduce((s, p) => s + (p.kind === 'figure' ? p.value : 0n), 0n);
        const gap = added - total.value;
        if ((gap < 0n ? -gap : gap) > tolerance) differ += 1;
      }
    }
  }
  return { compared, differ };
}

/** A bar's width as a percentage of a scale, to one decimal place, from exact integers. Never below 0 or above 100. */
export function barWidth(value: bigint, scale: bigint): string {
  if (scale <= 0n || value <= 0n) return '0.0';
  const tenths = (value * 1000n + scale / 2n) / scale;
  const capped = tenths > 1000n ? 1000n : tenths;
  return `${capped / 10n}.${capped % 10n}`;
}
