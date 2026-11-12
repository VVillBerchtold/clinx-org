import { formatUsd, sumCents, type Cents } from './money';

/**
 * Pure helpers for the drug pages: reading a claims cell, splitting NDC text, searching, adding, and the five
 * largest amounts. The page script (src/scripts/drug-table.ts) and the tests use the same functions.
 *
 * The small-number rule: a claim count of 1 to 5 is never held here. A row whose count is left out has no number
 * at all, and every such row has the same sort value.
 */

/** What a row's claims cell is. `count`: a number (0 or 6 and more). `fewer_than_6` and `beside_small`: no number. */
export type ClaimsStatus = 'count' | 'fewer_than_6' | 'beside_small';

/**
 * Sort value of every row whose count is left out. It sits between 0 and 6 and is not a whole number, so it
 * is never read as a count of 1 to 5 and is the same for every such row.
 */
export const LEFT_OUT_SORT = '0.5';

/** Words for a count that is left out. */
export const CLAIMS_WORDS: Record<Exclude<ClaimsStatus, 'count'>, string> = {
  fewer_than_6: 'fewer than 6',
  beside_small: 'not shown',
};

/** The `data-k` value of a row: `s` a count is shown, `f` "fewer than 6", `n` "not shown". */
export type ClaimsKey = 's' | 'f' | 'n';

export function claimsKey(status: ClaimsStatus): ClaimsKey {
  return status === 'count' ? 's' : status === 'fewer_than_6' ? 'f' : 'n';
}

/** The value a row sorts by in the claims order. A left-out count gets LEFT_OUT_SORT, whatever it was. */
export function claimsSortValue(status: ClaimsStatus, claims: number | null): string {
  if (status !== 'count') return LEFT_OUT_SORT;
  if (claims === null || !Number.isInteger(claims) || claims < 0 || (claims >= 1 && claims <= 5)) throw new RangeError(`A shown claim count must be 0 or 6 or more, not ${claims}`);
  return String(claims);
}

/** NDC text: up to `show` codes first, the rest behind a "N more". Text that is not a list of codes stays whole. */
export function ndcSplit(text: string, show = 3): { shown: string; rest: string } | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const parts = trimmed.split(/\s*,\s*/);
  const allCodes = parts.every((p) => /^[0-9][0-9-]*$/.test(p));
  if (!allCodes || parts.length <= show) return { shown: trimmed, rest: '' };
  return { shown: parts.slice(0, show).join(', '), rest: parts.slice(show).join(', ') };
}

/** How many codes are in `rest` (a ", " list from ndcSplit). */
export function countCodes(rest: string): number {
  return rest === '' ? 0 : rest.split(', ').length;
}

// ---------------------------------------------------------------------------
// Search. Case does not matter. Spaces and dashes are ignored, in the text and in what is typed, so
// "00002-1434-80", "00002 1434 80" and "000021434 80" all find the same code.

const SEPARATORS = /[\s \-‐-―]/;

/** Lower case, with spaces and dashes taken out. */
export function searchKey(text: string): string {
  let out = '';
  for (const ch of text) if (!SEPARATORS.test(ch)) out += ch.toLowerCase();
  return out;
}

/** What was typed, as the keys that must all be found. Words are separated by spaces. */
export function queryTokens(query: string): string[] {
  const keys = query.split(/\s+/).map(searchKey).filter((k) => k !== '');
  return [...new Set(keys)];
}

/** True when every token is found in the name or in the NDC text. No tokens matches every row. */
export function rowMatches(tokens: readonly string[], name: string, ndcText: string): boolean {
  if (tokens.length === 0) return true;
  const nameKey = searchKey(name);
  const ndcKey = searchKey(ndcText);
  return tokens.every((t) => nameKey.includes(t) || ndcKey.includes(t));
}

/** Where the tokens are found in `text`, as [start, end) positions in the text as written, joined where they touch. */
export function matchRanges(text: string, tokens: readonly string[]): [number, number][] {
  if (tokens.length === 0) return [];
  let key = '';
  const at: number[] = []; // position in `text` of each character of `key`
  let i = 0;
  for (const ch of text) {
    if (!SEPARATORS.test(ch)) {
      for (const c of ch.toLowerCase()) {
        key += c;
        at.push(i);
      }
    }
    i += ch.length;
  }
  const found: [number, number][] = [];
  for (const token of tokens) {
    let from = 0;
    for (;;) {
      const k = key.indexOf(token, from);
      if (k < 0) break;
      const last = at[k + token.length - 1]!;
      found.push([at[k]!, last + (text.codePointAt(last)! > 0xffff ? 2 : 1)]);
      from = k + 1;
    }
  }
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const joined: [number, number][] = [];
  for (const r of found) {
    const prev = joined[joined.length - 1];
    if (prev && r[0] <= prev[1]) prev[1] = Math.max(prev[1], r[1]);
    else joined.push([r[0], r[1]]);
  }
  return joined;
}

// ---------------------------------------------------------------------------
// Adding amounts. Whole cents, as integers: no floating-point amount of money anywhere.

/** Amounts as the filer printed them: whole dollars (no decimal point anywhere) or cents. */
export type AmountScale = 0 | 2;

export function amountScale(amountsAsFiled: readonly string[]): AmountScale {
  return amountsAsFiled.every((a) => !a.includes('.')) ? 0 : 2;
}

/** Whole cents as dollars, at the scale the filer printed: `$1,234.50`, or `$1,234` for a filer of whole dollars. */
export function formatAtScale(cents: Cents, scale: AmountScale): string {
  const text = formatUsd(cents);
  return scale === 0 && cents % 100 === 0 ? text.replace(/\.00$/, '') : text;
}

/** The sum of whole-cent amounts, exact. */
export function addCents(values: readonly Cents[]): Cents {
  return sumCents(values);
}

/** The `count` rows with the largest amounts, largest first. Equal amounts keep the order they were filed in. */
export function largestBy<T extends { amountCents: Cents }>(rows: readonly T[], count: number): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => b.row.amountCents - a.row.amountCents || a.index - b.index)
    .slice(0, count)
    .map((x) => x.row);
}
