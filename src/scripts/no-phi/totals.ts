/**
 * Running totals. This file only knows the five columns it needs. It has no
 * code path that could read any other column: the caller picks those five
 * values out of a row with makeColumnPicker(), and add() receives only them.
 * The totals object holds numbers and fixed labels, never any row content.
 */

/** The only columns this module reads. */
export const NEEDED_COLUMNS = [
  "fill_date",
  "payer_type",
  "amount_paid",
  "acquisition_cost",
  "dispensing_fee",
] as const;

export interface TotalsInput {
  fillDate: string;
  payerType: string;
  amountPaid: string;
  acquisitionCost: string;
  dispensingFee: string;
}

export type SkipReason = "missingColumn" | "unparseableAmount" | "unparseableDate";

export const SKIP_LABELS: Record<SkipReason, string> = {
  missingColumn: "Missing column",
  unparseableAmount: "Unparseable amount",
  unparseableDate: "Unparseable date",
};

/** All money is integer cents. */
export interface Sums {
  rows: number;
  paid: number;
  cost: number;
  fee: number;
  margin: number; // paid minus acquisition cost
}

export interface TotalsState {
  rowsRead: number;
  total: Sums;
  byPayer: Record<string, Sums>;
  byMonth: Record<string, Sums>;
  skipped: Record<SkipReason, number>;
}

export const PAYER_LABELS = ["Commercial", "Medicaid", "Medicare", "Self-pay"] as const;
const OTHER_PAYER = "Other";

const emptySums = (): Sums => ({ rows: 0, paid: 0, cost: 0, fee: 0, margin: 0 });

export function newTotals(): TotalsState {
  return {
    rowsRead: 0,
    total: emptySums(),
    byPayer: {},
    byMonth: {},
    skipped: { missingColumn: 0, unparseableAmount: 0, unparseableDate: 0 },
  };
}

/**
 * Money text to integer cents, or null. Accepts 1234.56, 1,234.56, $1,234.56,
 * (12.00) and -12.00 as negative. Blank is an error. No floating point.
 */
export function parseCents(text: string): number | null {
  let s = text.trim();
  if (s === "") return null;
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith("-")) {
    if (negative) return null;
    negative = true;
    s = s.slice(1).trim();
  }
  if (s.startsWith("$")) s = s.slice(1).trim();
  if (s.startsWith("-")) {
    if (negative) return null;
    negative = true;
    s = s.slice(1).trim();
  }
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const whole = Number((m[1] ?? "").replace(/,/g, ""));
  const frac = Number((m[2] ?? "").padEnd(2, "0") || "0");
  const cents = whole * 100 + frac;
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** "YYYY-MM-DD" to "YYYY-MM", or null if it is not a real calendar date. */
export function monthOf(text: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return null;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1] ?? 0;
  if (d > days) return null;
  return `${m[1]}-${m[2]}`;
}

export function payerLabel(text: string): string {
  const t = text.trim().toLowerCase();
  for (const p of PAYER_LABELS) if (p.toLowerCase() === t) return p;
  return OTHER_PAYER;
}

function addTo(s: Sums, paid: number, cost: number, fee: number): void {
  s.rows += 1;
  s.paid += paid;
  s.cost += cost;
  s.fee += fee;
  s.margin += paid - cost;
}

/** Count a row as read and skipped. Takes a reason only, never row content. */
export function addSkipped(t: TotalsState, reason: SkipReason): void {
  t.rowsRead += 1;
  t.skipped[reason] += 1;
}

/** Add one row. Receives only the five needed values. */
export function addRow(t: TotalsState, input: TotalsInput): void {
  const month = monthOf(input.fillDate);
  if (month === null) return addSkipped(t, "unparseableDate");
  const paid = parseCents(input.amountPaid);
  const cost = parseCents(input.acquisitionCost);
  const fee = parseCents(input.dispensingFee);
  if (paid === null || cost === null || fee === null) return addSkipped(t, "unparseableAmount");

  t.rowsRead += 1;
  addTo(t.total, paid, cost, fee);
  const payer = payerLabel(input.payerType);
  addTo((t.byPayer[payer] ??= emptySums()), paid, cost, fee);
  addTo((t.byMonth[month] ??= emptySums()), paid, cost, fee);
}

export type PickResult = { ok: true; input: TotalsInput } | { ok: false; reason: "missingColumn" };

/**
 * Looks at the header once and remembers the positions of the five needed
 * columns only. pick() copies those five cells out of a row and nothing else.
 */
export function makeColumnPicker(header: readonly string[]): (row: readonly string[]) => PickResult {
  const names = header.map((h) => h.trim().toLowerCase());
  const idx = NEEDED_COLUMNS.map((c) => names.indexOf(c));
  const missingHeader = idx.some((i) => i < 0);
  const [iDate = -1, iPayer = -1, iPaid = -1, iCost = -1, iFee = -1] = idx;
  return (row) => {
    if (missingHeader) return { ok: false, reason: "missingColumn" };
    const fillDate = row[iDate];
    const payerType = row[iPayer];
    const amountPaid = row[iPaid];
    const acquisitionCost = row[iCost];
    const dispensingFee = row[iFee];
    if (
      fillDate === undefined ||
      payerType === undefined ||
      amountPaid === undefined ||
      acquisitionCost === undefined ||
      dispensingFee === undefined
    ) {
      return { ok: false, reason: "missingColumn" };
    }
    return { ok: true, input: { fillDate, payerType, amountPaid, acquisitionCost, dispensingFee } };
  };
}

/** Integer cents to "1,234.56" (with a leading "-" if negative). */
export function formatCents(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}
