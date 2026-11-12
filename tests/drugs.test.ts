import { describe, expect, it } from 'vitest';
import { buildDataset, buildDrugViews, getDataset } from '../src/lib/data';
import { FORMS } from '../src/lib/forms';
import {
  CLAIMS_WORDS,
  LEFT_OUT_SORT,
  addCents,
  amountScale,
  claimsKey,
  claimsSortValue,
  countCodes,
  formatAtScale,
  largestBy,
  matchRanges,
  ndcSplit,
  queryTokens,
  rowMatches,
  searchKey,
} from '../src/lib/drugs';
import { parseCents } from '../src/lib/money';
import { readCsv } from '../scripts/dataset-shape.mjs';

const data = getDataset();
const views = buildDrugViews(data);

/** The copied files as text, for tests that change one of them. */
function rawFiles(): Record<string, string> {
  const modules = import.meta.glob(['../src/data/dataset/*.csv', '../src/data/dataset/*.json', '../src/data/dataset/*.md'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;
  const files: Record<string, string> = {};
  for (const [path, text] of Object.entries(modules)) files[path.slice(path.lastIndexOf('/') + 1)] = text;
  return files;
}

/** Schedule G rows read straight from the CSV text, without the site's loader. */
function scheduleG(): Record<string, string>[] {
  const [header, ...rows] = readCsv(rawFiles()['line_items.csv']!) as string[][];
  return rows.map((r) => Object.fromEntries(header!.map((h, i) => [h, r[i] ?? '']))).filter((r) => r['schedule'] === 'G');
}

describe('the drug schedule is part of the form', () => {
  it('belongs to Rhode Island only, and Schedule G is no longer withheld', () => {
    const withSchedule = Object.values(FORMS).filter((f) => 'drugSchedule' in f && f.drugSchedule !== undefined);
    expect(withSchedule.map((f) => f.id)).toEqual(['ri-oag-340b']);
    const ri = FORMS['ri-oag-340b']!;
    expect(ri.withheldSchedules).not.toContain('G');
    expect(ri.shownSchedules).not.toContain('G');
  });

  it('keeps the drug rows out of the other rows', () => {
    expect(data.lineItems.some((r) => r.schedule === 'G')).toBe(false);
    expect(data.drugRows).toHaveLength(2391);
  });

  it('gives Vermont and Minnesota no drug page', () => {
    expect(views.every((v) => v.filing.state === 'RI')).toBe(true);
    expect(views.some((v) => v.filing.state !== 'RI')).toBe(false);
  });
});

describe('row counts per filing', () => {
  it('match the rows of Schedule G in the data, filing by filing', () => {
    const rows = scheduleG();
    expect(views).toHaveLength(14);
    for (const v of views) {
      const own = rows.filter((r) => r['filing_id'] === v.filing.filingId);
      expect(v.rows, v.filing.filingId).toHaveLength(own.filter((r) => r['row_kind'] === 'detail').length);
      expect(v.below !== null, v.filing.filingId).toBe(own.some((r) => r['row_kind'] === 'below_threshold'));
      expect(own.filter((r) => r['row_kind'] === 'total'), v.filing.filingId).toHaveLength(1);
    }
    const counts = views.map((v) => v.rows.length).sort((a, b) => a - b);
    expect(counts[0]).toBe(2);
    expect(counts.at(-1)).toBe(973);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(2364);
  });

  it('keeps the rows in the order filed', () => {
    const rows = scheduleG();
    for (const v of views) {
      const filed = rows.filter((r) => r['filing_id'] === v.filing.filingId && r['row_kind'] === 'detail').map((r) => r['line']);
      expect(v.rows.map((r) => r.line)).toEqual(filed);
    }
  });

  it('puts each page at the filing path and counts the rows that say "fewer than 6"', () => {
    for (const v of views) expect(v.path).toBe(`/scorecard/ri/${v.entity.slug}/drugs/`);
    expect(views.reduce((n, v) => n + v.fewerThan6, 0)).toBe(310);
    expect(views.reduce((n, v) => n + v.notShown, 0)).toBe(0);
  });
});

describe('the five largest amounts', () => {
  it('are right for the largest filing, checked against the CSV text', () => {
    const v = views.find((x) => x.filing.filingId === 'ri-2025-rhode-island-hospital')!;
    const detail = scheduleG().filter((r) => r['filing_id'] === v.filing.filingId && r['row_kind'] === 'detail');
    const expected = detail
      .map((r, index) => ({ line: r['line']!, cents: parseCents(r['amount_as_filed']!)!, index }))
      .sort((a, b) => b.cents - a.cents || a.index - b.index)
      .slice(0, 5);
    expect(v.largest).toHaveLength(5);
    expect(v.largest.map((r) => r.line)).toEqual(expected.map((e) => e.line));
    expect(v.largest.map((r) => r.amountCents)).toEqual(expected.map((e) => e.cents));
    expect(v.maxCents).toBe(expected[0]!.cents);
    // Largest first.
    for (let i = 1; i < 5; i++) expect(v.largest[i - 1]!.amountCents).toBeGreaterThanOrEqual(v.largest[i]!.amountCents);
  });

  it('keep the order filed when amounts are equal, and give a small filing fewer than five', () => {
    expect(largestBy([{ amountCents: 5, id: 'a' }, { amountCents: 9, id: 'b' }, { amountCents: 5, id: 'c' }], 2).map((r) => r.id)).toEqual(['b', 'a']);
    const smallest = views.find((x) => x.rows.length === 2)!;
    expect(smallest.largest).toHaveLength(2);
  });
});

describe('searching', () => {
  it('ignores case, spaces and dashes', () => {
    expect(searchKey('00002-1434-80')).toBe('00002143480');
    expect(searchKey(' 00002 1434–80 ')).toBe('00002143480');
    expect(searchKey('ADALIMUMAB-AATY')).toBe('adalimumabaaty');
    expect(queryTokens('  Insulin   00002-1434 ')).toEqual(['insulin', '000021434']);
    expect(queryTokens(' - ')).toEqual([]);
  });

  it('finds a code however it is typed', () => {
    const ndc = '00002-1434-80, 2143380, 2223680';
    for (const typed of ['00002-1434-80', '00002 1434 80', '000021434', '1434-80', '2143380', '2223680']) {
      expect(rowMatches(queryTokens(typed), 'INSULIN LISPRO', ndc), typed).toBe(true);
    }
    expect(rowMatches(queryTokens('00003'), 'INSULIN LISPRO', ndc)).toBe(false);
  });

  it('needs every word, in the name or in the NDC text', () => {
    expect(rowMatches(queryTokens('insulin 2143380'), 'INSULIN LISPRO', '00002-1434-80, 2143380')).toBe(true);
    expect(rowMatches(queryTokens('insulin 999'), 'INSULIN LISPRO', '00002-1434-80, 2143380')).toBe(false);
    expect(rowMatches([], 'x', 'y')).toBe(true);
    expect(rowMatches(queryTokens('cosentyx'), '', 'secukinumab (Cosentyx UnoReady Pen) 300 mg/2 mL PnIj00078107068')).toBe(true);
  });

  it('marks where a match is, across a dash, and joins marks that touch', () => {
    expect(matchRanges('00002-1434-80', queryTokens('21434'))).toEqual([[4, 10]]);
    expect(matchRanges('INSULIN LISPRO', queryTokens('lis'))).toEqual([[8, 11]]);
    expect(matchRanges('ABAB', queryTokens('ab'))).toEqual([[0, 4]]);
    expect(matchRanges('ABC', [])).toEqual([]);
  });

  it('splits NDC text: three codes shown, the rest behind "N more"', () => {
    expect(ndcSplit('169418113, 169413013, 169477212')).toEqual({ shown: '169418113, 169413013, 169477212', rest: '' });
    const six = ndcSplit('00006027731, 6027754, 00006022131, 6022154, 6011231, 6011254')!;
    expect(six.shown).toBe('00006027731, 6027754, 00006022131');
    expect(six.rest).toBe('6022154, 6011231, 6011254');
    expect(countCodes(six.rest)).toBe(3);
    // Text that is not a list of codes stays whole, commas and all.
    const text = 'adalimumab-adbm (Cyltezo,CF, Pen) 40 mg/0.8 mL PnKt 00597037597';
    expect(ndcSplit(text)).toEqual({ shown: text, rest: '' });
    expect(ndcSplit('  ')).toBeNull();
  });
});

describe('adding amounts', () => {
  it('adds whole cents exactly, where floating-point dollars would not', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(addCents([parseCents('0.10')!, parseCents('0.20')!])).toBe(30);
    expect(addCents([])).toBe(0);
  });

  it('adds a whole filing to the cent', () => {
    for (const v of views) {
      const text = scheduleG().filter((r) => r['filing_id'] === v.filing.filingId && r['row_kind'] === 'detail').map((r) => r['amount_as_filed']!);
      const big = text.reduce((n, a) => n + BigInt(a.replace(/[,.]/g, '') + (a.includes('.') ? '' : '00')), 0n);
      expect(BigInt(addCents(v.rows.map((r) => r.amountCents))), v.filing.filingId).toBe(big);
    }
  });

  it('prints a sum at the scale the filer used', () => {
    expect(formatAtScale(123456789, 2)).toBe('$1,234,567.89');
    expect(formatAtScale(123456700, 0)).toBe('$1,234,567');
    expect(formatAtScale(0, 2)).toBe('$0.00');
    expect(formatAtScale(0, 0)).toBe('$0');
    expect(amountScale(['1,234', '56'])).toBe(0);
    expect(amountScale(['1,234', '56.10'])).toBe(2);
    const whole = views.filter((v) => v.scale === 0).map((v) => v.filing.filingId);
    expect(whole).toContain('ri-2025-wellone');
    expect(whole).toContain('ri-2025-wood-river');
    expect(views.find((v) => v.filing.filingId === 'ri-2025-thundermist')!.scale).toBe(2);
  });
});

describe('the small-number rule on the drug pages', () => {
  it('holds no claim count of 1 to 5 in any drug row', () => {
    for (const v of views) {
      for (const r of [...v.rows, ...(v.below ? [v.below] : []), v.total]) {
        if (r.claimsStatus === 'count') {
          expect(r.claims === 0 || r.claims! >= 6, `${v.filing.filingId} line ${r.line}`).toBe(true);
          expect(r.claimsAsFiled).not.toBe('');
        } else {
          expect(r.claims).toBeNull();
          expect(r.claimsAsFiled).toBe('');
        }
      }
    }
  });

  it('gives every row whose count is left out the same sort value, which is not a count', () => {
    const left = views.flatMap((v) => v.rows).filter((r) => r.claimsStatus !== 'count');
    expect(left).toHaveLength(310);
    for (const r of left) expect(claimsSortValue(r.claimsStatus, r.claims)).toBe(LEFT_OUT_SORT);
    expect(Number(LEFT_OUT_SORT)).toBeGreaterThan(0);
    expect(Number(LEFT_OUT_SORT)).toBeLessThan(6);
    expect(Number.isInteger(Number(LEFT_OUT_SORT))).toBe(false);
  });

  it('says the words, and nothing else, for a count that is left out', () => {
    expect(CLAIMS_WORDS.fewer_than_6).toBe('fewer than 6');
    expect(CLAIMS_WORDS.beside_small).toBe('not shown');
    expect(claimsKey('count')).toBe('s');
    expect(claimsKey('fewer_than_6')).toBe('f');
    expect(claimsKey('beside_small')).toBe('n');
  });

  it('refuses a shown count of 1 to 5', () => {
    for (const n of [1, 3, 5]) expect(() => claimsSortValue('count', n)).toThrow();
    expect(claimsSortValue('count', 0)).toBe('0');
    expect(claimsSortValue('count', 6)).toBe('6');
  });

  it('stops the build on a row with a count of 1 to 5 that the dataset did not leave out', () => {
    const files = rawFiles();
    const [header, ...rows] = readCsv(files['line_items.csv']!) as string[][];
    const col = (name: string) => header!.indexOf(name);
    const at = rows.findIndex((r) => r[col('schedule')] === 'G' && r[col('claims_withheld')] === 'fewer_than_6');
    const row = rows[at]!;
    row[col('claims')] = '3';
    row[col('claims_as_filed')] = '3';
    row[col('claims_withheld')] = '';
    const text = [header, ...rows].map((r) => r!.map((c) => (/[",\n]/.test(c) ? `"${c.replaceAll('"', '""')}"` : c)).join(',')).join('\n') + '\n';
    expect(() => buildDataset({ files: { ...files, 'line_items.csv': text } })).toThrow(/claim count of 1 to 5/);
  });

  it('stops the build on an amount it cannot read, naming the filing and the line', () => {
    const files = rawFiles();
    const [header, ...rows] = readCsv(files['line_items.csv']!) as string[][];
    const col = (name: string) => header!.indexOf(name);
    const row = rows.find((r) => r[col('schedule')] === 'G' && r[col('row_kind')] === 'detail')!;
    const line = row[col('line')];
    row[col('amount_as_filed')] = 'twelve';
    const text = [header, ...rows].map((r) => r!.map((c) => (/[",\n]/.test(c) ? `"${c.replaceAll('"', '""')}"` : c)).join(',')).join('\n') + '\n';
    expect(() => buildDataset({ files: { ...files, 'line_items.csv': text } })).toThrow(new RegExp(`Schedule G line ${line}: the amount "twelve" cannot be read`));
  });
});
