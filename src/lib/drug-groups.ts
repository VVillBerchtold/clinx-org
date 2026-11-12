import { LEFT_OUT_SORT, amountScale, type AmountScale, type ClaimsStatus } from './drugs';
import { sumCents, type Cents } from './money';

/**
 * Pure helpers for the page that puts every filer's drug rows side by side (one state, one reporting year).
 *
 * Grouping: rows are put together only when each one's NDC cell is filed as one 11-digit code, written as
 * eleven digits or as 5-4-2 with dashes. Nothing is guessed: a shorter code is not padded with zeros and a
 * cell that lists several codes is not split. Such a row stays on its own, with its cell as filed.
 *
 * Nothing filed is changed. A group's name is one of the names filed with its code; its amount is the filed
 * amounts added in whole cents; its claims figure is the shown counts added. A count of 1 to 5 is never held
 * (see drugs.ts), so a group whose rows leave a count out says so instead of printing a number.
 */

/** What a row must carry to be grouped. The site's DrugRow has all of it. */
export interface GroupableRow {
  filingId: string;
  line: string;
  nameAsFiled: string;
  ndcAsFiled: string;
  amountAsFiled: string;
  amountCents: Cents;
  claims: number | null;
  claimsStatus: ClaimsStatus;
}

/** The 11 digits of a cell filed as one NDC (eleven digits, or 5-4-2 with dashes); null for anything else. */
export function ndcKey(cell: string): string | null {
  const text = cell.trim();
  if (/^[0-9]{11}$/.test(text)) return text;
  if (/^[0-9]{5}-[0-9]{4}-[0-9]{2}$/.test(text)) return text.replaceAll('-', '');
  return null;
}

/** Eleven digits written 5-4-2: `61958-2501-01`. */
export function formatNdc(key: string): string {
  if (!/^[0-9]{11}$/.test(key)) throw new RangeError(`Not an 11-digit code: ${key}`);
  return `${key.slice(0, 5)}-${key.slice(5, 9)}-${key.slice(9)}`;
}

/** A name for comparing: capitals and runs of spaces do not count. */
export function foldName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The name shown for a group: the name filed most often with the code (capitals and spacing ignored). When
 * names are filed equally often, the shortest; then the first in A to Z order. It is written as it stands on
 * the first row that carries it. Blank names are passed over; '' when every name is blank.
 */
export function pickGroupName(namesInRowOrder: readonly string[]): string {
  const seen = new Map<string, { count: number; written: string }>();
  for (const name of namesInRowOrder) {
    const key = foldName(name);
    if (key === '') continue;
    const entry = seen.get(key);
    if (entry) entry.count++;
    else seen.set(key, { count: 1, written: name.trim().replace(/\s+/g, ' ') });
  }
  let best: { key: string; count: number; written: string } | null = null;
  for (const [key, entry] of seen) {
    if (
      best === null ||
      entry.count > best.count ||
      (entry.count === best.count && (key.length < best.key.length || (key.length === best.key.length && key < best.key)))
    ) {
      best = { key, ...entry };
    }
  }
  return best?.written ?? '';
}

/** The shown counts of a group's rows, added, and how many rows leave their count out. */
export interface ClaimsSum {
  /** The sum of the counts that are shown. Each is 0 or 6 or more, so the sum is never 1 to 5. */
  sum: number;
  counted: number;
  leftOut: number;
}

export function sumClaims(rows: readonly Pick<GroupableRow, 'claims' | 'claimsStatus'>[]): ClaimsSum {
  let sum = 0;
  let counted = 0;
  let leftOut = 0;
  for (const row of rows) {
    if (row.claimsStatus !== 'count') {
      leftOut++;
      continue;
    }
    const n = row.claims;
    if (n === null || !Number.isInteger(n) || n < 0 || (n >= 1 && n <= 5)) throw new RangeError(`A shown claim count must be 0 or 6 or more, not ${n}`);
    sum += n;
    counted++;
  }
  return { sum, counted, leftOut };
}

/**
 * How a group's claims are written.
 * `count`: every row shows its count; the figure is their sum.
 * `at_least`: some rows leave their count out; the figure is the sum of the others (6 or more).
 * `left_out`: no row shows a count of 6 or more and at least one leaves its count out; no figure.
 */
export type ClaimsShown = { kind: 'count'; value: number } | { kind: 'at_least'; value: number } | { kind: 'left_out' };

export function claimsShown(c: ClaimsSum): ClaimsShown {
  if (c.sum >= 1 && c.sum <= 5) throw new RangeError(`A claims sum of 1 to 5 cannot be shown: ${c.sum}`);
  if (c.leftOut === 0) return { kind: 'count', value: c.sum };
  if (c.sum >= 6) return { kind: 'at_least', value: c.sum };
  return { kind: 'left_out' };
}

/** The value a group sorts by in the claims order. A group with no figure gets LEFT_OUT_SORT, like a row. */
export function groupClaimsSortValue(c: ClaimsSum): string {
  const shown = claimsShown(c);
  return shown.kind === 'left_out' ? LEFT_OUT_SORT : String(shown.value);
}

export interface DrugGroup<T extends GroupableRow> {
  /** The 11 digits the rows share; null for a row that stays on its own. */
  key: string | null;
  /** A page-unique id: `ndc-61958250101`, or `row-<filing>-<line>` for a row on its own. */
  id: string;
  /** The code written 5-4-2; for a row on its own, its NDC cell as filed. */
  ndcText: string;
  /** The name shown for the group (pickGroupName); '' when no row prints a name. */
  name: string;
  /** Every different name as filed, as written, in row order. */
  names: string[];
  /** The rows, by filer (in the order given) and then by line as filed. */
  rows: T[];
  /** The filings the rows come from, each once, in filer order. */
  filingIds: string[];
  /** The filed amounts, added. */
  amountCents: Cents;
  /** Cents when any row prints cents; whole dollars when none does. */
  scale: AmountScale;
  claims: ClaimsSum;
}

/**
 * Puts rows into groups. `filingOrder` lists the filings in the order their rows should stand inside a group;
 * a row of a filing that is not listed stops the build. The result is in the page's first order (see byFilers).
 */
export function groupDrugRows<T extends GroupableRow>(rows: readonly T[], filingOrder: readonly string[]): DrugGroup<T>[] {
  const position = new Map(filingOrder.map((id, i) => [id, i]));
  if (position.size !== filingOrder.length) throw new Error('A filing is listed twice in the order');
  const placed = rows.map((row, index) => {
    const at = position.get(row.filingId);
    if (at === undefined) throw new Error(`Row of a filing that is not in the order: ${row.filingId}`);
    return { row, at, index };
  });
  placed.sort((a, b) => a.at - b.at || a.index - b.index);

  const byKey = new Map<string, T[]>();
  const alone: T[] = [];
  for (const { row } of placed) {
    const key = ndcKey(row.ndcAsFiled);
    if (key === null) {
      alone.push(row);
      continue;
    }
    const list = byKey.get(key);
    if (list) list.push(row);
    else byKey.set(key, [row]);
  }

  const make = (key: string | null, id: string, ndcText: string, own: T[]): DrugGroup<T> => {
    const names: string[] = [];
    const folded = new Set<string>();
    for (const row of own) {
      const f = foldName(row.nameAsFiled);
      if (f === '' || folded.has(f)) continue;
      folded.add(f);
      names.push(row.nameAsFiled.trim().replace(/\s+/g, ' '));
    }
    return {
      key,
      id,
      ndcText,
      name: pickGroupName(own.map((r) => r.nameAsFiled)),
      names,
      rows: own,
      filingIds: [...new Set(own.map((r) => r.filingId))],
      amountCents: sumCents(own.map((r) => r.amountCents)),
      scale: amountScale(own.map((r) => r.amountAsFiled)),
      claims: sumClaims(own),
    };
  };

  const groups: DrugGroup<T>[] = [];
  for (const [key, own] of byKey) groups.push(make(key, `ndc-${key}`, formatNdc(key), own));
  for (const row of alone) groups.push(make(null, `row-${slugPart(row.filingId)}-${slugPart(row.line)}`, row.ndcAsFiled.trim(), [row]));

  const ids = new Set(groups.map((g) => g.id));
  if (ids.size !== groups.length) throw new Error('Two drug groups share an id');
  return groups.sort(byFilers);
}

function slugPart(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** The page's first order: most filers first, then name A to Z (no name last), then code. */
export function byFilers<T extends GroupableRow>(a: DrugGroup<T>, b: DrugGroup<T>): number {
  return (
    b.filingIds.length - a.filingIds.length ||
    Number(a.name === '') - Number(b.name === '') ||
    foldName(a.name).localeCompare(foldName(b.name), 'en') ||
    (a.key ?? a.id).localeCompare(b.key ?? b.id, 'en')
  );
}

// ---------------------------------------------------------------------------
// The download: one line per row as filed, with the group's code and name beside it.

/** One CSV field. Quoted when it holds a comma, a quote or a line break. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function toCsv(header: readonly string[], lines: readonly (readonly string[])[]): string {
  for (const line of lines) if (line.length !== header.length) throw new Error(`A CSV line has ${line.length} fields, the header has ${header.length}`);
  return [header, ...lines].map((line) => line.map(csvField).join(',')).join('\n') + '\n';
}

/** Whole cents as a plain decimal: `508090.64`. */
export function centsToDecimal(cents: Cents): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`Not whole cents: ${cents}`);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
