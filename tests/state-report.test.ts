import { describe, expect, it } from 'vitest';
import { buildDataset, buildReportViews, buildViews, getDataset, pdfHref, reportViewFor } from '../src/lib/data';
import { anyFormSpec, formSpec, recordKind } from '../src/lib/forms';
import { sumCents } from '../src/lib/money';
import { barPercentOfScale } from '../src/lib/meter';

const data = getDataset();
const mn = reportViewFor(data, 'MN');

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

describe('the Minnesota view', () => {
  it('has 26 entities, listed A to Z by name as printed, with type and city as printed', () => {
    expect(mn.entities).toHaveLength(26);
    const names = mn.entities.map((e) => e.name);
    expect(names[0]).toBe('Abbott Northwestern Hospital');
    expect(names.at(-1)).toBe('United Hospital');
    expect(new Set(names).size).toBe(26);
    const abbott = mn.entities[0]!;
    expect(abbott.typeAsPrinted).toBe('Disproportionate Share Hospital');
    expect(abbott.cityAsPrinted).toBe('Minneapolis');
    expect(abbott.net.amountAsFiled).toBe('153,985,063');
    expect(abbott.netCents).toBe(15398506300);
    expect(abbott.pct.amountAsFiled).toBe('12.0%');
    expect(abbott.pctValue).toBe('12.0');
  });

  it('puts every figure on a page of the PDF between 42 and 44, and links it to that page', () => {
    for (const e of mn.entities) {
      expect(e.net.page).toBe(e.pct.page);
      expect(e.net.page).toBeGreaterThanOrEqual(42);
      expect(e.net.page).toBeLessThanOrEqual(44);
      expect(pdfHref(e.filing, e.net.page)).toBe(`https://www.health.mn.gov/data/340b/docs/2025report.pdf#page=${e.net.page}`);
    }
  });

  it('calls one entity not a hospital, by the printed type, and nothing else', () => {
    const others = mn.entities.filter((e) => e.entity.entityType === 'other');
    expect(others.map((e) => e.typeAsPrinted)).toEqual(['CHD Treatment Center']);
    expect(mn.entities.filter((e) => e.entity.entityType === 'hospital')).toHaveLength(25);
    for (const e of mn.entities) expect(mn.spec.typeFor(e.typeAsPrinted)).toBe(e.entity.entityType);
  });

  it('holds the six rows of the statewide table as printed, with the page each is on', () => {
    expect(mn.totals.map((t) => t.group.label)).toEqual(['Top 25, unadjusted', 'Remaining 156, unadjusted', 'Total, unadjusted', 'Top 25, adjusted', 'Remaining 156, adjusted', 'Total, adjusted']);
    expect(mn.totals.map((t) => t.net.amountAsFiled)).toEqual(['1,152,403,307', '123,840,474', '1,276,243,781', '1,199,240,413', '141,030,552', '1,340,270,964']);
    expect(mn.totals.map((t) => t.pct.amountAsFiled)).toEqual(['90.3%', '9.7%', '100%', '89.5%', '10.5%', '100%']);
    expect(mn.totals.map((t) => t.net.page)).toEqual([44, 44, 44, 45, 45, 45]);
    expect(mn.totals.filter((t) => t.group.adjusted)).toHaveLength(3);
  });

  it('keeps the six page notes word for word', () => {
    expect(mn.notes.aboveEntityTable.labelAsFiled).toContain('These net 340B revenue figures are not adjusted to account for the estimated missing administered drug reimbursements by Covered Entities.');
    expect(mn.notes.entityTableTitle.labelAsFiled).toBe('Appendix Table 6.1: Top net 340B revenue by Covered Entity, unadjusted');
    expect(mn.notes.totalsTableTitle.labelAsFiled).toBe('Appendix Table 6.2: Top net 340B revenue, unadjusted and adjusted');
    expect(mn.notes.totalsTableSource.labelAsFiled.endsWith('.')).toBe(false);
    expect(mn.notes.entityTableSource.labelAsFiled.endsWith('.')).toBe(true);
  });

  it('lists seven differences: three on the statewide totals, then four on named entities', () => {
    expect(mn.differences).toHaveLength(7);
    expect(mn.differences.slice(0, 3).every((x) => x.owner === null)).toBe(true);
    expect(mn.differences.slice(3).map((x) => x.owner)).toEqual([
      'Abbott Northwestern Hospital',
      'CentraCare - Rice Memorial Hospital',
      'M Health Fairview - University of Minnesota Medical Center',
      'Regions Hospital',
    ]);
    expect(mn.differences.slice(0, 3).map((x) => x.difference.basis)).toEqual(['form', 'form', 'form']);
    expect(mn.differences.slice(3).every((x) => x.difference.basis === 'comparison' && x.difference.unit === 'percent')).toBe(true);
    const rows = mn.differences[0]!.difference;
    expect([rows.expected, rows.filed, rows.difference, rows.unit]).toEqual(['26', '25', '-1', 'count']);
  });

  it('adds the 26 rows to 1,152,403,308, one more than the table prints, as the dataset says', () => {
    expect(mn.entitySumCents).toBe(115240330800);
    expect(mn.entitySumCents - mn.totals[0]!.netCents!).toBe(100);
    expect(sumCents(mn.entities.map((e) => e.netCents!))).toBe(mn.entitySumCents);
  });

  it('has no measure for any Minnesota record, and no Minnesota view among the filings', () => {
    const ids = new Set(data.filings.filter((f) => f.state === 'MN').map((f) => f.filingId));
    expect(ids.size).toBe(27);
    expect(data.measures.some((m) => ids.has(m.filingId))).toBe(false);
    expect(buildViews(data).some((v) => v.entity.state === 'MN')).toBe(false);
    expect(buildReportViews(data).map((v) => v.state)).toEqual(['MN']);
  });

  it('draws a bar to a scale and refuses a value beyond it', () => {
    expect(barPercentOfScale(15398506300, 35000000000)).toBe('44.0');
    expect(() => barPercentOfScale(35000000001, 35000000000)).toThrow(RangeError);
  });
});

describe('a form or record kind the site does not know', () => {
  it('stops on an unknown record kind', () => {
    const files = rawFiles();
    files['filings.csv'] = files['filings.csv']!.replace('state_report_totals', 'state_report_summary');
    expect(() => buildDataset({ files })).toThrow(/Unknown record kind/);
    expect(() => recordKind('something_else')).toThrow(/Unknown record kind/);
  });

  it('stops on an unknown form, and on a filing form read as a state publication', () => {
    const files = rawFiles();
    files['filings.csv'] = files['filings.csv']!.replaceAll('mn-mdh-340b-report', 'mn-another-form');
    expect(() => buildDataset({ files })).toThrow(/Unknown form/);
    expect(() => formSpec('mn-mdh-340b-report')).toThrow(/not a filing/);
    expect(anyFormSpec('mn-mdh-340b-report').layout).toBe('state-report');
  });

  it('stops when a kind of record is not one its form allows', () => {
    const files = rawFiles();
    files['filings.csv'] = files['filings.csv']!.replace(/^(mn-2024-abbott-northwestern,.*),state_report_row$/m, '$1,filing');
    expect(() => buildDataset({ files })).toThrow(/does not allow a record of kind/);
  });

  it('stops when an entity type does not follow its printed type', () => {
    const files = rawFiles();
    files['entities.csv'] = files['entities.csv']!.replace('hospital,Children’s Minnesota,,', 'other,Children’s Minnesota,,');
    expect(files['entities.csv']).toContain('other,Children’s Minnesota,,');
    expect(() => buildDataset({ files })).toThrow(/does not follow the printed type/);
  });

  it('stops when a measure belongs to a Minnesota record', () => {
    const files = rawFiles();
    files['measures.csv'] = `${files['measures.csv']!.trimEnd()}\nmn-2024-abbott-northwestern,gross_margin,x,1.00\n`;
    expect(() => buildDataset({ files })).toThrow(/not an entity's own filing/);
  });

  it('stops when a row is not the one the form names', () => {
    const files = rawFiles();
    files['line_items.csv'] = files['line_items.csv']!.replace('"Total, unadjusted",,,,Net 340B Revenue ($)', '"Total, unadjusted (all)",,,,Net 340B Revenue ($)');
    expect(() => buildReportViews(buildDataset({ files }))).toThrow(/labelled/);
  });

  it('stops when the dataset lists a sum that the rows do not give', () => {
    const files = rawFiles();
    files['line_items.csv'] = files['line_items.csv']!.replace('"153,985,063",153985063', '"153,985,064",153985064');
    expect(() => buildReportViews(buildDataset({ files }))).toThrow(/listed sum/);
  });
});
