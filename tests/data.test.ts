import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/lib/csv';
import {
  buildDataset,
  buildViews,
  comparabilityParagraph,
  getDataset,
  groupTotals,
  pdfHref,
  viewsInGroup,
} from '../src/lib/data';
import { formatPercentMicro, formatUsd } from '../src/lib/money';

const data = getDataset();
const allViews = buildViews(data);
const views = allViews.filter((v) => v.entity.state === 'RI');
const vtViews = allViews.filter((v) => v.entity.state === 'VT');

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

describe('csv reader', () => {
  it('reads quotes, doubled quotes and line breaks inside quotes', () => {
    const rows = parseCsv('a,b\n"x, y","say ""hi"""\n"two\nlines",z\n');
    expect(rows).toEqual([
      { a: 'x, y', b: 'say "hi"' },
      { a: 'two\nlines', b: 'z' },
    ]);
  });
  it('refuses a row with the wrong number of cells', () => {
    expect(() => parseCsv('a,b\n1\n')).toThrow();
  });
});

describe('dataset loaders', () => {
  it('has 27 filings: 14 for Rhode Island (7 health centers and 7 hospital filings) and 13 for Vermont, and 27 records of the Minnesota state publication', () => {
    expect(data.filings).toHaveLength(27 + 27);
    expect(data.filings.filter((f) => f.recordKind === 'filing')).toHaveLength(27);
    expect(allViews).toHaveLength(27);
    expect(views).toHaveLength(14);
    expect(vtViews).toHaveLength(13);
    expect(viewsInGroup(views, 'health_center')).toHaveLength(7);
    expect(viewsInGroup(views, 'hospital')).toHaveLength(7);
  });

  it('rounds the health center total share to 36.8% and the hospital share to 12.9%', () => {
    const hc = groupTotals(viewsInGroup(views, 'health_center'));
    const hosp = groupTotals(viewsInGroup(views, 'hospital'));
    expect(formatPercentMicro(hc.shareMicro!, 1)).toBe('36.8%');
    expect(formatPercentMicro(hosp.shareMicro!, 1)).toBe('12.9%');
    expect(hc.grossMarginCents).toBe(4782768611);
  });

  it('gives every filing a source URL and a page number for each row', () => {
    for (const v of allViews) {
      expect(v.filing.sourceUrl).toMatch(/^https:\/\//);
      expect(v.printedRows).toHaveLength(v.spec.layout === 'schedules' ? 6 : 12);
      for (const line of v.printedRows) expect(Number.isInteger(line.page) && line.page >= 1).toBe(true);
      expect(pdfHref(v.filing, v.marginPage)).toBe(`${v.filing.sourceUrl}#page=${v.marginPage}`);
    }
  });

  it('keeps Schedule G rows and claim counts out of the loaded rows', () => {
    const riSchedules = data.lineItems.filter((r) => r.filingId.startsWith('ri-')).map((r) => r.schedule);
    expect(new Set(riSchedules)).toEqual(new Set(['A', 'D', 'E']));
    const vtSchedules = data.lineItems.filter((r) => r.filingId.startsWith('vt-')).map((r) => r.schedule);
    expect(new Set(vtSchedules)).toEqual(new Set(['payments', 'acquisition', 'expenses', 'result', 'page_note']));
    expect(Object.keys(data.lineItems[0]!)).not.toContain('claims');
  });

  it('shows differences between claim totals with their figures, and no count of 1 to 5', () => {
    const claimRules = data.discrepancies.filter((x) => x.rule.includes('claims'));
    expect(claimRules.length).toBeGreaterThan(0);
    for (const d of claimRules) {
      expect(d.unit).toBe('count');
      // Each figure is a printed total of a whole schedule, never one drug row's count.
      for (const figure of [d.expected, d.filed]) expect(Number(figure.replace(/,/g, ''))).toBeGreaterThan(5);
      expect(d.note).not.toBe('');
    }
  });

  it('counts rows and differences from the data', () => {
    expect(data.rowCount).toBe(2989 + 157 + 70);
    expect(data.discrepancies).toHaveLength(22 + 4 + 7);
  });

  it('finds the comparability paragraph in METHODS.md', () => {
    expect(comparabilityParagraph(data)).toContain('own pharmacy');
  });

  it('records the dataset version, commit and a hash for each file', () => {
    expect(data.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(data.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(data.hashes).length).toBeGreaterThan(8);
  });
});

describe('Vermont reports', () => {
  const byName = (name: string) => {
    const v = vtViews.find((x) => x.entity.nameAsFiled === name);
    if (!v) throw new Error(`no Vermont view for ${name}`);
    return v;
  };
  const rowsOf = (v: (typeof vtViews)[number]) => data.lineItems.filter((r) => r.filingId === v.filing.filingId);

  it('reads the 13 reports on the Vermont form, 12 figure rows each, all on page 1', () => {
    expect(vtViews.every((v) => v.spec.id === 'vt-gmcb-340b-financial')).toBe(true);
    for (const v of vtViews) {
      expect(v.printedRows.map((r) => r.labelAsFiled)).toEqual(v.spec.figureRows.map((k) => k.label));
      expect(v.printedRows.every((r) => r.page === 1)).toBe(true);
      expect(pdfHref(v.filing, v.marginPage)).toBe(`${v.filing.sourceUrl}#page=1`);
    }
    expect(vtViews.every((v) => v.entity.entityType === 'hospital')).toBe(true);
  });

  it('works the measures from the Vermont rows, and they agree with measures.csv (buildViews checks every one)', () => {
    for (const v of vtViews) {
      const rows = rowsOf(v);
      const cents = (label: string) => rows.find((r) => r.labelAsFiled === label)!.amountCents!;
      expect(v.grossMarginCents).toBe(cents('Total 340B Payments Received') - cents('340B Prescription Drug Acquisition Costs'));
      expect(v.externalCostCents).toBe(cents('Payments Made to Contract Pharmacies') + cents('Payments Made to Outside Vendors'));
    }
    const gifford = byName('Gifford Medical Center');
    expect(formatUsd(gifford.grossMarginCents)).toBe('$2,996,906.00');
    expect(formatPercentMicro(gifford.shareMicro!, 1)).toBe('5.7%');
  });

  it('gives Northwestern Medical Center no share, because its margin is not above zero', () => {
    const v = byName('Northwestern Medical Center');
    expect(v.grossMarginCents).toBe(-362700);
    expect(v.externalCostCents).toBe(31851100);
    expect(v.shareMicro).toBeNull();
    expect(vtViews.filter((x) => x.shareMicro === null)).toHaveLength(1);
  });

  it('keeps N/R cells as printed with no amount, and the page note word for word', () => {
    const rows = rowsOf(byName('Northwestern Medical Center'));
    const nr = rows.filter((r) => r.amountAsFiled === 'N/R');
    expect(nr.map((r) => r.labelAsFiled)).toEqual(['Administered Drugs Paid Separately', 'Administered Drugs Bundled Payments']);
    expect(nr.every((r) => r.amountCents === null)).toBe(true);
    const notes = rows.filter((r) => r.schedule === 'page_note');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.labelAsFiled).toMatch(/^NMC did not report 340B administered drug revenue/);
    expect(notes[0]!.unit).toBe('none');
  });

  it('reads a percentage as text with its unit, and a figure printed without cents as printed', () => {
    const rows = rowsOf(byName('Northwestern Medical Center'));
    const margin = rows.find((r) => r.labelAsFiled === '340B Operating Margin')!;
    expect(margin.unit).toBe('percent');
    expect(margin.amountAsFiled).toBe('-33.30%');
    expect(margin.amountCents).toBeNull();
    expect(rowsOf(byName('Gifford Medical Center')).find((r) => r.labelAsFiled === 'Contract Pharmacy Dispensed')!.amountAsFiled).toBe('764,691');
  });

  it('carries the draft status, notice, period, submission line and cover page for every report', () => {
    for (const v of vtViews) {
      expect(v.filing.statusAsFiled).toBe('draft');
      expect(v.filing.statusNoticeAsFiled).toBe('NOTE: This is draft and may be adjusted for accuracy in the final GMCB dashboard publication.');
      expect(v.filing.periodAsFiled).toBe('FY2025');
      expect(v.filing.submissionAsFiled).toBe('As Submitted to the Green Mountain Care Board in 2026');
      expect(v.filing.coverPageUrl).toMatch(/^https:\/\/gmcboard\.vermont\.gov\/document\//);
    }
    expect(views.every((v) => v.filing.statusAsFiled === '' && v.filing.statusNoticeAsFiled === '')).toBe(true);
  });

  it('lists four differences, in three reports, with their unit', () => {
    const vt = data.discrepancies.filter((d) => d.filingId.startsWith('vt-'));
    expect(vt).toHaveLength(4);
    expect(new Set(vt.map((d) => d.filingId)).size).toBe(3);
    expect(vt.filter((d) => d.unit === 'percent')).toHaveLength(1);
    expect(vt.every((d) => d.note !== '')).toBe(true);
  });

  it('lists each narrative as a separate document with its address and SHA-256', () => {
    const narratives = data.attachments.filter((a) => a.kind === 'narrative');
    expect(narratives).toHaveLength(13);
    for (const a of narratives) {
      expect(a.documentUrl).toMatch(/^https:\/\//);
      expect(a.documentCoverPageUrl).toMatch(/^https:\/\/gmcboard\.vermont\.gov\/document\//);
      expect(a.documentSha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('stops on a form it does not know', () => {
    const files = rawFiles();
    files['filings.csv'] = files['filings.csv']!.replaceAll('vt-gmcb-340b-financial', 'vt-another-form');
    expect(() => buildDataset({ files })).toThrow(/Unknown form/);
  });

  it('stops when a row is not the one the form names', () => {
    const files = rawFiles();
    files['line_items.csv'] = files['line_items.csv']!.replace('Total 340B Payments Received', 'Total Payments');
    expect(() => buildViews(buildDataset({ files }))).toThrow(/labelled/);
  });

  it('stops when a schedule is not on the form', () => {
    const files = rawFiles();
    files['line_items.csv'] = files['line_items.csv']!.replace('vt-2025-copley,payments,in_house_pharmacy', 'vt-2025-copley,schedule_x,in_house_pharmacy');
    expect(() => buildDataset({ files })).toThrow(/not on the form/);
  });

  it('stops when the measures file disagrees with the rows', () => {
    const files = rawFiles();
    const lines = files['measures.csv']!.split('\n').map((l) => (l.startsWith('vt-2025-copley,gross_margin,') ? l.replace(/,[^,]*$/, ',1.00') : l));
    files['measures.csv'] = lines.join('\n');
    expect(() => buildViews(buildDataset({ files }))).toThrow(/gross margin differs/);
  });
});
