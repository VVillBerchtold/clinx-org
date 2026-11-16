import { describe, expect, it } from 'vitest';
import { buildWorkbookViews, getDataset, kindOfId, shiftTwoPlaces, type LineItem } from '../src/lib/data';
import { FORMS, workbookFormSpec } from '../src/lib/forms';
import { STATE_REGISTRY } from '../src/lib/states';
import { formatDollars, formatPercent, roundDecimal, showCell } from '../src/lib/workbook';
import { chooseWorkbooks, countedWorkbooks, payerCellsAgree, repeatedFilers, sumCells, CHANNELS, PAYERS } from '../src/lib/workbook-totals';
import filingsCsv from '../src/data/dataset/filings.csv?raw';
import lineItemsCsv from '../src/data/dataset/line_items.csv?raw';
import { parseCsv } from '../src/lib/csv';
import filingPage from '../src/components/WorkbookFilingPage.astro?raw';
import statePage from '../src/components/WorkbookStatePage.astro?raw';
import cellLib from '../src/lib/workbook.ts?raw';
import totalsLib from '../src/lib/workbook-totals.ts?raw';
import totalsPage from '../src/components/WorkbookTotals.astro?raw';

/**
 * Ohio's workbooks: one Excel workbook for each filer, a 340B ID and no name. What these tests hold fixed is
 * what the pages must never do: change a figure beyond the rounding of its display, show a count of 1 to 5, rank the filers, or
 * let two workbooks share an address.
 */
const data = getDataset();
const books = buildWorkbookViews(data);
const spec = workbookFormSpec('oh-odh-340b-report');

const row = (over: Partial<LineItem>): LineItem => ({
  filingId: 'x', schedule: 's', line: 'l', rowKind: 'detail', labelAsFiled: '', nameAsFiled: '', normalizedVendor: '', category: '', descriptionAsFiled: '', ndcAsFiled: '',
  amountAsFiled: '', amountCents: null, answerAsFiled: '', unit: 'usd', page: 1, note: '', claimsAsFiled: '', claimsWithheld: '', sourceCell: 'C1', verification: 'two_file_reads', ...over,
});

describe('the Ohio workbook form', () => {
  it('is the only form of its layout, and the pages choose it by the form', () => {
    expect(Object.values(FORMS).filter((f) => f.layout === 'workbook').map((f) => f.id)).toEqual(['oh-odh-340b-report']);
    expect(books).toHaveLength(241);
    for (const b of books) expect(b.filing.form).toBe(spec.id);
  });

  it('names the kind of entity from the letters of HRSA\'s spelling of the ID, in one map, and has a kind for every ID HRSA lists', () => {
    expect(kindOfId(spec, 'CAH361326-00').name).toBe('Critical access hospital');
    expect(kindOfId(spec, 'FQHCLA415').code).toBe('FQHCLA');
    expect(kindOfId(spec, 'CHC08753-00').code).toBe('CHC');
    expect(kindOfId(spec, 'CH050560').code).toBe('CH');
    expect(kindOfId(spec, 'RWII44102').code).toBe('RWII');
    expect(kindOfId(spec, 'XYZ123')).toEqual({ code: '', name: '' });
    expect(kindOfId(spec, '')).toEqual({ code: '', name: '' });
    for (const b of books) {
      for (const e of b.entities) {
        if (e.entity.hrsaIdSpelling === '') expect(e.kindName, e.entity.entityId).toBe('');
        else expect(e.kindName, `${e.entity.entityId}: ${e.entity.hrsaIdSpelling}`).not.toBe('');
      }
    }
  });

  it('gives each workbook an address of its own that no other page uses', () => {
    const paths = books.map((b) => b.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const b of books) {
      expect(b.path).toMatch(/^\/scorecard\/oh\/[a-z0-9-]+\/$/);
      expect(b.filing.slug).not.toBe('drugs');
      expect(b.filing.slug).not.toMatch(/^\d{4}$/);
    }
    // Two entities have two workbooks each: an address from the entity would put two workbooks on one page.
    expect(books.filter((b) => b.filing.entityId === 'oh-dsh360059')).toHaveLength(2);
  });

  it('titles a workbook with HRSA\'s name and every ID it covers, or the ID alone', () => {
    const two = books.find((b) => b.filing.filingId === 'oh-2025-dsh360059-and-fqhcla415')!;
    expect(two.title).toContain('DSH360059 and FQHCLA415');
    const unnamed = books.filter((b) => b.name === '');
    expect(unnamed.length).toBeGreaterThan(0);
    for (const b of unnamed) expect(b.title).toBe(b.entities.map((e) => e.id).join(' and '));
  });

  it('keeps no count of 1 to 5 and no figure in a cell marked withheld', () => {
    const own = data.lineItems.filter((r) => r.filingId.startsWith('oh-'));
    expect(own.length).toBeGreaterThan(40000);
    for (const r of own) {
      if (r.claimsWithheld !== '') {
        expect(r.claimsAsFiled, `${r.filingId} ${r.sourceCell}`).toBe('');
        if (r.unit === 'count' || r.unit === 'percent') expect(r.amountAsFiled, `${r.filingId} ${r.sourceCell}`).toBe('');
      } else if (r.unit === 'count') {
        expect(r.claimsAsFiled.replace(/,/g, '')).not.toMatch(/^[1-5]$/);
      }
    }
  });
});

describe('rounding, on the decimal text', () => {
  it('rounds half away from zero, with carries, negatives and long tails', () => {
    expect(roundDecimal('0.995', 2)).toBe('1.00');
    expect(roundDecimal('999.999', 2)).toBe('1000.00');
    expect(roundDecimal('9.995', 2)).toBe('10.00');
    expect(roundDecimal('2.345', 2)).toBe('2.35');
    expect(roundDecimal('-2.345', 2)).toBe('-2.35');
    expect(roundDecimal('2.344999', 2)).toBe('2.34');
    expect(roundDecimal('0.005', 2)).toBe('0.01');
    expect(roundDecimal('0.004', 2)).toBe('0.00');
    expect(roundDecimal('-0.004', 2)).toBe('0.00');
    expect(roundDecimal('12', 2)).toBe('12.00');
    expect(roundDecimal('12.5', 2)).toBe('12.50');
    expect(roundDecimal('2.5', 0)).toBe('3');
    expect(roundDecimal('-2.5', 0)).toBe('-3');
    expect(roundDecimal('99.5', 0)).toBe('100');
    expect(roundDecimal('9764.98509282327', 2)).toBe('9764.99');
    expect(roundDecimal('57713925.520000003', 2)).toBe('57713925.52');
    expect(roundDecimal('0.14999999999999999', 2)).toBe('0.15');
    expect(roundDecimal('123456789012345678.995', 2)).toBe('123456789012345679.00');
    expect(roundDecimal('1.31457589E7', 2)).toBe('13145758.90');
    expect(roundDecimal('7.2222E-2', 4)).toBe('0.0722');
    expect(roundDecimal('N/A', 2)).toBeNull();
    expect(roundDecimal('', 2)).toBeNull();
    expect(roundDecimal('2.224,544.14', 2)).toBeNull();
  });

  it('shows dollars to the cent, and a number filed whole with no decimals', () => {
    expect(formatDollars('57713925')).toBe('$57,713,925');
    expect(formatDollars('57713925.0')).toBe('$57,713,925');
    expect(formatDollars('0')).toBe('$0');
    expect(formatDollars('9764.98509282327')).toBe('$9,764.99');
    expect(formatDollars('515852.60999999993')).toBe('$515,852.61');
    expect(formatDollars('34397777.8')).toBe('$34,397,777.80');
    expect(formatDollars('866338.30')).toBe('$866,338.30');
    expect(formatDollars('0.995')).toBe('$1.00');
    expect(formatDollars('999.999')).toBe('$1,000.00');
    expect(formatDollars('-12.5')).toBe('-$12.50');
    expect(formatDollars('-0.001')).toBe('$0.00');
    expect(formatDollars('12345678901234567')).toBe('$12,345,678,901,234,567');
    expect(formatDollars('N/A')).toBe('N/A');
  });

  it('shows a percentage to at most two decimals, trailing zeros dropped', () => {
    expect(formatPercent('72.6611162503854')).toBe('72.66');
    expect(formatPercent('86.204608364826768')).toBe('86.2');
    expect(formatPercent('15')).toBe('15');
    expect(formatPercent('15.000')).toBe('15');
    expect(formatPercent('99.999')).toBe('100');
    expect(formatPercent('0.004')).toBe('0');
    expect(formatPercent('12.50')).toBe('12.5');
    expect(formatPercent('1234.5678')).toBe('1,234.57');
  });
});

describe('a cell, as the page draws it', () => {
  it('shows a dollar amount to the cent, with commas and a dollar sign', () => {
    expect(showCell(row({ amountAsFiled: '57713925.520000003' }), 'usd').text).toBe('$57,713,925.52');
    expect(showCell(row({ amountAsFiled: '57713925' }), 'usd').text).toBe('$57,713,925');
    expect(showCell(row({ amountAsFiled: '1103.3800000000001' }), 'usd').text).toBe('$1,103.38');
    expect(showCell(row({ amountAsFiled: '515852.60999999993' }), 'usd').text).toBe('$515,852.61');
    expect(showCell(row({ amountAsFiled: '9764.9850928232718' }), 'usd').text).toBe('$9,764.99');
    expect(showCell(row({ amountAsFiled: '866338.30' }), 'usd').text).toBe('$866,338.30');
    expect(showCell(row({ amountAsFiled: '1.31457589E7' }), 'usd').text).toBe('$13,145,758.90');
    expect(showCell(row({ amountAsFiled: '0' }), 'usd').text).toBe('$0');
    expect(showCell(row({ amountAsFiled: '-12.5' }), 'usd').text).toBe('-$12.50');
  });

  it('sorts by the full stored value', () => {
    expect(showCell(row({ amountAsFiled: '9764.9850928232718' }), 'usd').sort).toBe('9764.9850928232718');
    expect(showCell(row({ amountAsFiled: '1.31457589E7' }), 'usd').sort).toBe('13145758.9');
    expect(showCell(row({ unit: 'percent', amountAsFiled: '86.204608364826768' }), 'percent').sort).toBe('86.204608364826768');
  });

  it('shows a count from the claims column, and the count of contract pharmacies from the amount, as filed', () => {
    expect(showCell(row({ unit: 'count', claimsAsFiled: '474702' }), 'count').text).toBe('474,702');
    expect(showCell(row({ unit: 'count', amountAsFiled: '364' }), 'count').text).toBe('364');
  });

  it('shows a percentage as the dataset note says: stored as typed, or a fraction of one moved two places, to two decimals', () => {
    expect(showCell(row({ unit: 'percent', amountAsFiled: '86.204608364826768' }), 'percent').text).toBe('86.2%');
    expect(showCell(row({ unit: 'percent', amountAsFiled: '72.6611162503854' }), 'percent').text).toBe('72.66%');
    const note = 'The cell is formatted as a percentage, so the stored number is a fraction of one (0.25 shows as 25%).';
    expect(showCell(row({ unit: 'percent', amountAsFiled: '0.14999999999999999', note }), 'percent').text).toBe('15%');
    expect(showCell(row({ unit: 'percent', amountAsFiled: '0.25', note }), 'percent').text).toBe('25%');
    expect(showCell(row({ unit: 'percent', amountAsFiled: '7.2222E-2', note }), 'percent').text).toBe('7.22%');
    expect(shiftTwoPlaces('1')).toBe('100');
    expect(shiftTwoPlaces('0.005')).toBe('0.5');
    expect(shiftTwoPlaces('abc')).toBeNull();
  });

  it('shows words where a figure belongs, exactly as typed, and marks a withheld cell with its reason in words', () => {
    expect(showCell(row({ amountAsFiled: 'N/A' }), 'usd')).toMatchObject({ kind: 'words', text: 'N/A' });
    expect(showCell(row({ unit: 'percent', amountAsFiled: '#DIV/0!' }), 'percent')).toMatchObject({ kind: 'words', text: '#DIV/0!' });
    expect(showCell(row({ unit: 'count', claimsWithheld: 'fewer_than_6' }), 'count')).toMatchObject({ kind: 'withheld', text: 'Withheld', why: 'fewer than 6' });
    expect(showCell(row({ unit: 'count', claimsWithheld: 'beside_small' }), 'count').why).toBe('next to a small count');
    expect(showCell(row({ unit: 'percent', claimsWithheld: 'reveals_small' }), 'percent').why).toBe('would show a small count');
    expect(showCell(undefined, 'usd').kind).toBe('none');
    expect(showCell(row({}), 'usd').kind).toBe('none');
  });

  it('prints no dollar figure with more than two decimals and no percentage with more than two, for every Ohio cell', () => {
    const own = data.lineItems.filter((r) => r.filingId.startsWith('oh-'));
    let dollars = 0;
    for (const r of own) {
      if (r.unit === 'usd') {
        const t = showCell(r, 'usd');
        if (t.kind === 'figure') {
          dollars += 1;
          expect(t.text, `${r.filingId} ${r.sourceCell}`).toMatch(/^-?\$[\d,]+(\.\d{2})?$/);
        }
      } else if (r.unit === 'percent') {
        const t = showCell(r, 'percent');
        if (t.kind === 'figure') expect(t.text, `${r.filingId} ${r.sourceCell}`).toMatch(/^-?[\d,]+(\.\d{1,2})?%$/);
      }
    }
    expect(dollars).toBeGreaterThan(10000);
  });
});

/**
 * The totals again, worked out here from the CSV files and not from the page's code. A figure is split
 * at the point and the exponent by hand and added as whole numbers over 10^30.
 */
describe('the totals of a state of workbooks', () => {
  const filings = parseCsv(filingsCsv).filter((r) => r['state'] === 'OH' && r['record_kind'] === 'filing');
  const items = parseCsv(lineItemsCsv).filter((r) => r['filing_id']!.startsWith('oh-'));
  const cell = new Map(items.map((r) => [`${r['filing_id']}|${r['schedule']}|${r['line']}`, r]));
  const D = 30;
  const FIGURE = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

  /** A filed figure over 10^30, or null for empty, words and withheld cells. */
  const scaled = (filing: string, schedule: string, line: string): bigint | null | 'words' | 'empty' | 'withheld' => {
    const r = cell.get(`${filing}|${schedule}|${line}`);
    if (!r) return 'empty';
    if (r['claims_withheld'] !== '') return 'withheld';
    const t = r['amount_as_filed']!.trim();
    if (t === '') return 'empty';
    const m = FIGURE.exec(t);
    if (!m) return 'words';
    const frac = m[3] ?? '';
    const exp = Number(m[4] ?? 0);
    const mantissa = BigInt(m[2]! + frac);
    const power = D - frac.length + exp;
    const v = mantissa * 10n ** BigInt(power);
    return m[1] === '-' ? -v : v;
  };

  // The workbooks counted: a filer with several keeps the one whose file name is the ID typed inside it.
  const byEntity = new Map<string, typeof filings>();
  for (const f of filings) byEntity.set(f['entity_id']!, [...(byEntity.get(f['entity_id']!) ?? []), f]);
  const counted = [...byEntity.values()].map((list) => {
    if (list.length === 1) return list[0]!;
    const hit = list.filter((f) => f['source_file']!.replace(/\.xlsx$/i, '').toUpperCase() === (cell.get(`${f['filing_id']}|identity|hrsa_id`)?.['answer_as_filed'] ?? '').trim().toUpperCase());
    expect(hit).toHaveLength(1);
    return hit[0]!;
  });

  const shown = (v: bigint): string => {
    const unit = 10n ** BigInt(D);
    const neg = v < 0n;
    const a = neg ? -v : v;
    const whole = a % unit === 0n;
    const places = whole ? 0 : 2;
    const q = 10n ** BigInt(D - places);
    const r = (a + q / 2n) / q;
    let text = r.toString().padStart(places + 1, '0');
    const int = places ? text.slice(0, -places) : text;
    const grouped = int.split('').reverse().map((c, i) => (i > 0 && i % 3 === 0 ? `${c},` : c)).reverse().join('');
    text = places ? `${grouped}.${r.toString().padStart(places + 1, '0').slice(-places)}` : grouped;
    return `${neg && r !== 0n ? '-' : ''}$${text}`;
  };

  const expected = (cells: ReadonlyArray<readonly [string, string]>) => {
    let sum = 0n;
    let added = 0;
    const left = { empty: 0, words: 0, withheld: 0 };
    for (const f of counted) {
      for (const [sch, line] of cells) {
        const v = scaled(f['filing_id']!, sch, line);
        if (typeof v === 'bigint') {
          sum += v;
          added += 1;
        } else left[v as 'empty' | 'words' | 'withheld'] += 1;
      }
    }
    return { sum, added, left };
  };

  const pageViews = buildWorkbookViews(data).filter((v) => v.filing.state === 'OH');
  const { counted: pageCounted, leftOut } = countedWorkbooks(pageViews);

  it('counts each filer once: two filers have two workbooks, and the file name equal to the typed ID picks one of each', () => {
    const repeated = repeatedFilers(pageViews);
    expect(repeated.map((g) => g.entityId).sort()).toEqual(['oh-dsh360059', 'oh-dsh360137']);
    expect(repeated.every((g) => g.views.length === 2)).toBe(true);
    const chosen = Object.fromEntries(chooseWorkbooks(pageViews).map((c) => [c.group.entityId, c.used.filing.sourceFile]));
    expect(chosen).toEqual({ 'oh-dsh360059': 'DSH360059.xlsx', 'oh-dsh360137': 'DSH360137.xlsx' });
    expect(leftOut.map((v) => v.filing.sourceFile).sort()).toEqual(['DSH360059_and_FQHCLA415.xlsx', 'DSH361307.xlsx']);
    expect(pageCounted).toHaveLength(counted.length);
    expect(new Set(pageCounted.map((v) => v.filing.entityId)).size).toBe(pageCounted.length);
    expect(pageCounted.map((v) => v.filing.filingId).sort()).toEqual(counted.map((f) => f['filing_id']!).sort());
    expect(pageViews.length - pageCounted.length).toBe(2);
  });

  it('adds the six totals by kind of dispensing exactly, and says how many cells it leaves out', () => {
    for (const ch of CHANNELS) {
      for (const sched of [ch.cost, ch.paid]) {
        const got = sumCells(pageCounted, [[sched, 'total']]);
        const want = expected([[sched, 'total']]);
        expect(got.shown, sched).toBe(shown(want.sum));
        expect(got.cells, sched).toBe(want.added);
        expect(got.workbooks, sched).toBe(want.added);
        expect(got.left, sched).toEqual(want.left);
        expect(got.cells + got.left.empty + got.left.words + got.left.withheld).toBe(pageCounted.length);
      }
    }
  });

  it('adds each payer across the three kinds of dispensing exactly', () => {
    for (const key of ['cost', 'paid'] as const) {
      for (const p of [...PAYERS.map((x) => x.line)]) {
        const cells = CHANNELS.map((ch) => [ch[key], p] as const);
        const got = sumCells(pageCounted, cells);
        const want = expected(cells);
        expect(got.shown, `${key} ${p}`).toBe(shown(want.sum));
        expect(got.cells).toBe(want.added);
        expect(got.left).toEqual(want.left);
      }
      const ind = [[CHANNELS[1]![key], 'indeterminate']] as const;
      expect(sumCells(pageCounted, ind).shown).toBe(shown(expected(ind).sum));
    }
  });

  it('leaves out a cell with words and a cell that is empty, and never reads either as a zero', () => {
    const got = sumCells(pageCounted, [['contract_acquisition_cost', 'total']]);
    expect(got.left.empty + got.left.words).toBeGreaterThan(0);
    expect(got.workbooks).toBeLessThan(pageCounted.length);
  });

  it('compares each table\'s payer cells with its own total cell and reports how many differ, without changing any', () => {
    const { compared, differ } = payerCellsAgree(pageCounted);
    expect(compared).toBeGreaterThan(500);
    expect(differ).toBeGreaterThanOrEqual(0);
    expect(differ).toBeLessThan(compared);
  });
});

describe('the pages\' own words', () => {
  const own = [filingPage, statePage, cellLib, totalsLib, totalsPage, STATE_REGISTRY['OH']!.publicNow, STATE_REGISTRY['OH']!.stands];
  it('rank nothing, set no filer against another and use no em dash', () => {
    for (const text of own) {
      expect(text).not.toMatch(/\b(best|highest|lowest|worst)\b/i);
      expect(text).not.toMatch(/\btop /i);
      expect(text).not.toContain('—');
    }
  });

  it('print the filer\'s text as text, never as markup', () => {
    expect(filingPage).not.toContain('set:html');
    expect(statePage).not.toContain('set:html');
    expect(filingPage).not.toContain('innerHTML');
  });

  it('say how many workbooks the registry counts, as the data has them', () => {
    expect(STATE_REGISTRY['OH']!.publicNow).toContain(`${books.length} Excel workbooks`);
    expect(STATE_REGISTRY['OH']!.summary).toContain(`${books.length} workbooks`);
  });
});
