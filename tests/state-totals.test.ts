import { describe, expect, it } from 'vitest';
import { buildDataset, buildReportViews, buildTotalsViews, buildViews, getDataset, pdfHref, totalsViewFor } from '../src/lib/data';
import { anyFormSpec, formSpec, reportFormSpec, totalsFormSpec } from '../src/lib/forms';

const data = getDataset();
const id = totalsViewFor(data, 'ID');
const REPORT = 'https://idaho-sco-central-registry-documents.s3.us-gov-west-1.amazonaws.com/340B+Program+Reports/CY2025+340B+Program+Report.pdf';

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

describe('the Idaho view', () => {
  it('is one statewide record of a seven-page report, with no entity and no measure', () => {
    expect(data.filings.filter((f) => f.state === 'ID').map((f) => [f.filingId, f.recordKind])).toEqual([['id-2025-statewide', 'state_report_totals']]);
    expect(data.entities.filter((e) => e.state === 'ID').map((e) => e.entityType)).toEqual(['state_total']);
    expect(id.filing.pageCount).toBe(7);
    expect(id.filing.sourceUrl).toBe(REPORT);
    expect(id.filing.periodAsFiled).toBe('January 1 through December 31, 2025 (Calendar Year 2025)');
    expect(data.measures.some((m) => m.filingId === 'id-2025-statewide')).toBe(false);
    expect(buildViews(data).some((v) => v.entity.state === 'ID')).toBe(false);
    expect(buildReportViews(data).map((v) => v.state)).toEqual(['MN']);
    expect(buildTotalsViews(data).map((v) => v.state)).toEqual(['ID']);
  });

  it('holds the four headline figures as printed, the rounded ones as the report rounds them', () => {
    expect(id.highlights.map((h) => [h.figure.label, h.cell.printed])).toEqual([
      ['Total Claims Dispensed', '1,916,995'],
      ['Aggregate Payments Received', '$812.9M'],
      ['340B Savings to Community', '$430.6M'],
      ['Unique Covered Entities', '62'],
    ]);
    expect(id.highlights.map((h) => h.cell.value)).toEqual([1916995, null, null, 62]);
    for (const h of id.highlights) expect(pdfHref(id.filing, h.cell.row.page)).toBe(`${REPORT}#page=3`);
  });

  it('holds the four labels of the chart in the order printed, in whole dollars', () => {
    expect(id.chart.title.labelAsFiled).toBe('CY2025 Key Financial Metrics (All Covered Entities)');
    expect(id.chart.figures.map((f) => [f.figure.label, f.cell.printed, f.cell.value])).toEqual([
      ['Payments to Contract Pharmacies', '$46,157,189', 4615718900],
      ['Aggregate Acquisition Cost', '$399,146,308', 39914630800],
      ['340B Savings Utilized', '$430,646,950', 43064695000],
      ['Aggregate Payments Received', '$812,855,945', 81285594500],
    ]);
  });

  it('says who reported: 62 submissions, 689 child sites, and one cell that prints a count and a percentage', () => {
    expect(id.count).toBe(62);
    expect(id.submissions.rows.map((r) => [r.row.label, r.count.printed, r.pct?.printed ?? null, r.notes?.printed ?? null])).toEqual([
      ['Total submissions received', '62', null, 'All submissions complete'],
      ['Total child sites', '689', null, null],
      ['Submissions with complete status', '62', '100%', 'Full compliance'],
    ]);
    expect(id.submissions.above.map((r) => r.labelAsFiled)[0]).toBe('For Calendar Year 2025, 62 submissions from covered entities were received.');
  });

  it('holds the four payer tables as printed, each ending in its TOTAL row, each on one page', () => {
    expect(id.payerTables.map((t) => [t.spec.heading, t.page, t.rows.length])).toEqual([
      ['Aggregate Acquisition Cost', 5, 7],
      ['Aggregate Payments Received', 5, 7],
      ['Aggregate Payments to Contract Pharmacies', 6, 7],
      ['Number of Claims by Payer Type', 6, 7],
    ]);
    for (const t of id.payerTables) {
      expect(t.rows.map((r) => r.row.label)).toEqual(['Commercial', 'Medicare', 'Medicaid', 'Self-Pay', 'Other', 'Uninsured', 'TOTAL']);
      expect(t.rows.at(-1)!.pct.printed).toBe('100.0%');
    }
    const [cost, paid, pharmacies, claims] = id.payerTables;
    expect(cost!.rows.map((r) => r.figure.printed)).toEqual(['$181,432,809.78', '$123,723,651.05', '$38,571,842.44', '$26,402,497.12', '$15,558,352.43', '$13,457,155.31', '$399,146,308.13']);
    expect(cost!.rows.map((r) => r.pct.printed)).toEqual(['45.5%', '31.0%', '9.7%', '6.6%', '3.9%', '3.4%', '100.0%']);
    expect(paid!.totalValue).toBe(81285594490);
    expect(pharmacies!.rows.at(-1)!.figure.printed).toBe('$46,157,188.85');
    expect(claims!.rows.map((r) => r.figure.printed)).toEqual(['870,039', '596,406', '185,822', '127,335', '75,021', '61,979', '1,916,995']);
    expect(claims!.rows[0]!.figure.value).toBe(870039);
  });

  it('holds the ten rows of the use of savings, with the note the report prints under them', () => {
    const t = id.usesTable;
    expect(t.spec.heading).toBe('340B Savings Utilization');
    expect(t.rows).toHaveLength(10);
    expect(t.rows[0]!.row.label).toBe('Offset financial loss due to under-reimbursement from government programs');
    expect(t.rows[0]!.figure.printed).toBe('$179,839,482.89');
    expect(t.rows[8]!.row.label).toBe('Additional / Other reported uses (10 entities*)');
    expect(t.rows[8]!.pct.printed).toBe('24.0%');
    expect(t.rows.at(-1)!.figure.printed).toBe('$430,646,950.35');
    expect(t.page).toBe(7);
    expect(t.below).toHaveLength(1);
    expect(t.below[0]!.labelAsFiled.startsWith('*Ten entities reported Additional/Other uses')).toBe(true);
  });

  it('adds the rows of each table, and finds the two tables whose rows do not add up to the printed total', () => {
    const [cost, paid, pharmacies, claims] = id.payerTables;
    expect(cost!.rowsSum).toBe(cost!.totalValue);
    expect(paid!.rowsSum).toBe(paid!.totalValue);
    expect(pharmacies!.rowsSum).toBe(pharmacies!.totalValue);
    expect([claims!.rowsSum, claims!.totalValue]).toEqual([1916602, 1916995]);
    expect([id.usesTable.rowsSum, id.usesTable.totalValue]).toEqual([43064694735, 43064695035]);
  });

  it('lists three differences, two the report states and one comparison', () => {
    expect(id.differences.map((d) => [d.rule, d.basis, d.unit, d.expected, d.filed, d.difference])).toEqual([
      ['claims.rows=total', 'form', 'count', '1916602', '1916995', '393'],
      ['savings_use.rows=total', 'form', 'usd', '430646947.35', '430646950.35', '3.00'],
      ['savings_use.total=payments_received.total-acquisition_cost.total', 'comparison', 'usd', '413709636.77', '430646950.35', '16937313.58'],
    ]);
  });

  it('quotes the report word for word and uses pages 2 to 7', () => {
    expect(id.summary.map((r) => r.labelAsFiled)[0]).toBe('Total aggregate payments received ($812.9 million) exceed aggregate acquisition costs ($399.1 million), yielding a gross program margin of approximately $413.7 million.');
    expect(id.closing).toHaveLength(1);
    expect(id.pages).toEqual({ first: 2, last: 7 });
  });

  it('draws or names every row of the record: 105 rows, two kept but not drawn', () => {
    const rows = data.lineItems.filter((r) => r.filingId === 'id-2025-statewide');
    expect(rows).toHaveLength(105);
    expect(id.spec.notes.notDrawn).toEqual(['note_1', 'note_5']);
  });

  it('holds no email address and no telephone number', () => {
    const text = data.lineItems
      .filter((r) => r.filingId === 'id-2025-statewide')
      .map((r) => `${r.labelAsFiled} ${r.answerAsFiled} ${r.note}`)
      .join('\n');
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}/);
  });
});

describe('a statewide report the site cannot read as printed', () => {
  it('knows the form as a report of statewide totals, and as nothing else', () => {
    expect(anyFormSpec('id-sco-340b-report').layout).toBe('state-totals');
    expect(totalsFormSpec('id-sco-340b-report').recordKinds).toEqual(['state_report_totals']);
    expect(() => formSpec('id-sco-340b-report')).toThrow(/not a filing/);
    expect(() => reportFormSpec('id-sco-340b-report')).toThrow(/row for each entity/);
    expect(() => totalsFormSpec('mn-mdh-340b-report')).toThrow(/statewide totals/);
  });

  it('stops when a row is not labelled the way the form names it', () => {
    const files = rawFiles();
    files['line_items.csv'] = files['line_items.csv']!.replace('commercial_amount,detail,Commercial,,,,Aggregate Acquisition Cost', 'commercial_amount,detail,Commercial plans,,,,Aggregate Acquisition Cost');
    expect(files['line_items.csv']).toContain('Commercial plans');
    expect(() => buildTotalsViews(buildDataset({ files }))).toThrow(/labelled/);
  });

  it('stops when a row is missing, and when the record carries a row the page does not know', () => {
    const missing = rawFiles();
    missing['line_items.csv'] = missing['line_items.csv']!
      .split('\n')
      .filter((line) => !line.startsWith('id-2025-statewide,claims,medicaid_pct,'))
      .join('\n');
    expect(() => buildTotalsViews(buildDataset({ files: missing }))).toThrow(/expected one row claims medicaid_pct/);

    const extra = rawFiles();
    const note = extra['line_items.csv']!.split('\n').find((line) => line.startsWith('id-2025-statewide,page_note,note_15,'))!;
    extra['line_items.csv'] = `${extra['line_items.csv']!.trimEnd()}\n${note.replace('note_15', 'note_16')}\n`;
    expect(() => buildTotalsViews(buildDataset({ files: extra }))).toThrow(/does not know/);
  });

  it('stops when the rows of a table stop adding up the way the dataset says', () => {
    const files = rawFiles();
    files['line_items.csv'] = files['line_items.csv']!.replace('"870,039",870039', '"870,040",870040');
    expect(files['line_items.csv']).toContain('"870,040",870040');
    expect(() => buildTotalsViews(buildDataset({ files }))).toThrow(/listed sum of claims/);

    const noLonger = rawFiles();
    noLonger['discrepancies.csv'] = noLonger['discrepancies.csv']!
      .split('\n')
      .filter((line) => !line.startsWith('id-2025-statewide,savings_use.rows=total,'))
      .join('\n');
    expect(() => buildTotalsViews(buildDataset({ files: noLonger }))).toThrow(/lists no difference/);
  });

  it('stops when a second statewide record appears for the state', () => {
    const files = rawFiles();
    const record = files['filings.csv']!.split('\n').find((line) => line.startsWith('id-2025-statewide,'))!;
    files['filings.csv'] = `${files['filings.csv']!.trimEnd()}\n${record.replace('id-2025-statewide', 'id-2025-statewide-b')}\n`;
    expect(() => buildTotalsViews(buildDataset({ files }))).toThrow(/expected one statewide record/);
  });
});
