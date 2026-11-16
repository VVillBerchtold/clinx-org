import { describe, expect, it } from 'vitest';
import { buildWorkbookViews, getDataset, kindOfId, shiftTwoPlaces, type LineItem } from '../src/lib/data';
import { FORMS, workbookFormSpec } from '../src/lib/forms';
import { STATE_REGISTRY } from '../src/lib/states';
import { showCell } from '../src/lib/workbook';
import filingPage from '../src/components/WorkbookFilingPage.astro?raw';
import statePage from '../src/components/WorkbookStatePage.astro?raw';
import cellLib from '../src/lib/workbook.ts?raw';

/**
 * Ohio's workbooks: one Excel workbook for each filer, a 340B ID and no name. What these tests hold fixed is
 * what the pages must never do: change a printed figure, show a count of 1 to 5, rank the filers, or
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

describe('a cell, as the page draws it', () => {
  it('shows a dollar amount as stored, with commas and a dollar sign, and never rounds it', () => {
    expect(showCell(row({ amountAsFiled: '57713925.520000003' }), 'usd').text).toBe('$57,713,925.520000003');
    expect(showCell(row({ amountAsFiled: '1103.3800000000001' }), 'usd').text).toBe('$1,103.3800000000001');
    expect(showCell(row({ amountAsFiled: '0' }), 'usd').text).toBe('$0');
    expect(showCell(row({ amountAsFiled: '-12.5' }), 'usd').text).toBe('-$12.50');
  });

  it('shows a count from the claims column, and the count of contract pharmacies from the amount', () => {
    expect(showCell(row({ unit: 'count', claimsAsFiled: '474702' }), 'count').text).toBe('474,702');
    expect(showCell(row({ unit: 'count', amountAsFiled: '364' }), 'count').text).toBe('364');
  });

  it('shows a percentage as the dataset note says: stored as typed, or a fraction of one moved two places', () => {
    expect(showCell(row({ unit: 'percent', amountAsFiled: '86.204608364826768' }), 'percent').text).toBe('86.204608364826768%');
    const note = 'The cell is formatted as a percentage, so the stored number is a fraction of one (0.25 shows as 25%).';
    expect(showCell(row({ unit: 'percent', amountAsFiled: '0.25', note }), 'percent').text).toBe('25%');
    expect(showCell(row({ unit: 'percent', amountAsFiled: '7.2222E-2', note }), 'percent').text).toBe('7.2222%');
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
});

describe('the pages\' own words', () => {
  const own = [filingPage, statePage, cellLib, STATE_REGISTRY['OH']!.publicNow, STATE_REGISTRY['OH']!.stands];
  it('rank nothing, add nothing up and use no em dash', () => {
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
