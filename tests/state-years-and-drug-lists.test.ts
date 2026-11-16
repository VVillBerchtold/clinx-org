/**
 * Tests for the two things dataset 0.7.0 added to the site: Minnesota's earlier year (the report of
 * 25 November 2024, 2023 data, at /scorecard/mn/2023/) and Maine's report of totals and drug lists
 * (/scorecard/me/). They check the figures against the printed text, the way the pages are read from the
 * form and not from the state's code, and that a changed row stops the build.
 */
import { describe, expect, it } from 'vitest';
import { buildDataset, buildDrugReportViews, buildEarlierReportViews, buildReportViews, buildTotalsViews, buildViews, drugReportViewFor, earlierReportViewFor, getDataset, hospitalNames, pdfHref, reportPath, reportViewFor } from '../src/lib/data';
import { FORMS, anyFormSpec, drugListsFormSpec, formSpec, reportFormSpec, totalsFormSpec } from '../src/lib/forms';
import { KNOWN_FORMS } from '../scripts/dataset-shape.mjs';
import { STATE_REGISTRY } from '../src/lib/states';

const data = getDataset();
const mn24 = reportViewFor(data, 'MN');
const mn23 = earlierReportViewFor(data, 'MN');
const me = drugReportViewFor(data, 'ME');

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

describe('the forms the site reads', () => {
  it('knows the Maine form, in the copy-in check and in forms.ts, and reads it by its layout', () => {
    expect(KNOWN_FORMS).toContain('me-mhdo-340b-report');
    expect(anyFormSpec('me-mhdo-340b-report').layout).toBe('state-drug-lists');
    expect(drugListsFormSpec('me-mhdo-340b-report').recordKinds).toEqual(['state_report_totals']);
    expect(() => drugListsFormSpec('id-sco-340b-report')).toThrow(/lists of drugs/);
    expect(() => totalsFormSpec('me-mhdo-340b-report')).toThrow(/statewide totals/);
    expect(() => formSpec('me-mhdo-340b-report')).toThrow(/not a filing/);
    expect([...KNOWN_FORMS].sort()).toEqual(Object.keys(FORMS).sort());
  });

  it('gives each state one kind of page: Idaho totals, Maine drug lists, Minnesota a report of two years', () => {
    expect(buildTotalsViews(data).map((v) => v.state)).toEqual(['ID']);
    expect(buildDrugReportViews(data).map((v) => v.state)).toEqual(['ME']);
    expect(buildReportViews(data).map((v) => v.state)).toEqual(['MN']);
    expect(buildEarlierReportViews(data).map((v) => v.state)).toEqual(['MN']);
    expect(buildViews(data).some((v) => ['ME', 'MN', 'ID'].includes(v.entity.state))).toBe(false);
  });
});

describe('the Maine view', () => {
  it('is one statewide record of a 26-page report with no entity and no measure', () => {
    expect(data.filings.filter((f) => f.state === 'ME').map((f) => [f.filingId, f.recordKind, f.form])).toEqual([['me-2024-statewide', 'state_report_totals', 'me-mhdo-340b-report']]);
    expect(data.entities.filter((e) => e.state === 'ME').map((e) => e.entityType)).toEqual(['state_total']);
    expect(me.filing.pageCount).toBe(26);
    expect(me.filing.sourceUrl).toBe('https://mhdo.maine.gov/_pdf/340B_Annual_Report_260402.pdf');
    expect(data.measures.some((m) => m.filingId === 'me-2024-statewide')).toBe(false);
  });

  it('holds the four summary figures as printed, the two dollar totals as text', () => {
    expect(me.summary.map((s) => [s.figure.line, s.printed, s.row.page])).toEqual([
      ['hospitals_reporting', '27', 3],
      ['acquisition_cost', '$409.9M', 3],
      ['pct_of_drug_spend', '60.0%', 3],
      ['estimated_savings', '$325.8M', 3],
    ]);
    expect(me.summary[1]!.row.amountCents).toBeNull();
    expect(me.summary[3]!.row.amountCents).toBeNull();
    for (const s of me.summary) expect(s.sentence).toContain(s.printed);
    expect(me.count).toBe(27);
  });

  it('has 37 most costly and 54 most frequently dispensed drugs, three figures each, NDCs with their zeros', () => {
    expect(me.lists.map((l) => [l.spec.schedule, l.rows.length])).toEqual([['top3_costly', 37], ['top3_frequent', 54]]);
    const first = me.lists[0]!.rows[0]!;
    expect(first.ndc).toBe('00006302604');
    expect(first.drug).toBe('Pembrolizumab 100 MG/4ML Solution 4.000 ML UD');
    expect(first.drugClass).toBe('Antineoplastics and Adjunctive Therapies');
    expect([first.cost.amountAsFiled, first.savings.amountAsFiled, first.hospitals.amountAsFiled]).toEqual(['28,553,467', '10,750,171', '9']);
    expect(first.page).toBe(5);
    for (const list of me.lists) {
      expect(new Set(list.rows.map((r) => r.ndc)).size).toBe(list.rows.length);
      for (const r of list.rows) expect(r.ndc).toMatch(/^\d{11}$/);
      // Each hospital names three drugs, so the hospital figures add up to three times the number of hospitals.
      expect(list.rows.reduce((n, r) => n + r.hospitalCount, 0)).toBe(3 * 27);
    }
    expect(me.lists[0]!.share.amountAsFiled).toBe('15.6%');
    expect(me.lists[1]!.share.amountAsFiled).toBe('2.4%');
    expect(me.lists[0]!.pages).toEqual({ first: 5, last: 6 });
    expect(me.lists[1]!.pages).toEqual({ first: 7, last: 9 });
  });

  it('names the 27 hospitals from the attachment, in the printed order, with the pages of their descriptions', () => {
    expect(me.hospitals).toHaveLength(27);
    expect(me.hospitals[0]).toBe('Bridgton Hospital');
    expect(me.hospitals.at(-1)).toBe('St. Mary’s Regional Medical Center');
    expect(me.hospitals).toContain('Northern Light A.R. Gould Hospital');
    expect([me.descriptions.firstPage, me.descriptions.lastPage]).toEqual([10, 25]);
    expect(pdfHref(me.filing, me.descriptions.firstPage)).toBe('https://mhdo.maine.gov/_pdf/340B_Annual_Report_260402.pdf#page=10');
    expect(() => hospitalNames('No list here.')).toThrow(/does not list the hospitals/);
  });

  it('is on the Scorecard as a live state of the totals kind', () => {
    const entry = STATE_REGISTRY['ME']!;
    expect(entry.status).toBe('live');
    expect(entry.group).toBe('state-totals');
    expect(entry.href).toBe('/scorecard/me/');
    expect(entry.publicNow).not.toMatch(/does not show/i);
  });

  it('stops when a drug has a figure missing, a count is not a count or a hospital is named twice', () => {
    const files = rawFiles();
    const dropped = files['line_items.csv']!.split('\n').filter((l) => !l.startsWith('me-2024-statewide,top3_costly,00006302604_estimated_savings,')).join('\n');
    expect(() => buildDrugReportViews(buildDataset({ files: { ...files, 'line_items.csv': dropped } }))).toThrow(/expected one row top3_costly 00006302604_estimated_savings/);

    const twice = { ...files, 'attachments.csv': files['attachments.csv']!.replace('Calais Community Hospital', 'Bridgton Hospital') };
    expect(() => buildDrugReportViews(buildDataset({ files: twice }))).toThrow(/named twice/);

    const lines = files['line_items.csv']!.split('\n');
    const at = lines.findIndex((l) => l.startsWith('me-2024-statewide,summary,hospitals_reporting,'));
    lines[at] = lines[at]!.replace(',27,27,count,', ',27 hospitals,27,count,');
    expect(() => buildDrugReportViews(buildDataset({ files: { ...files, 'line_items.csv': lines.join('\n') } }))).toThrow();
  });

  it('stops on a row the page does not know', () => {
    const files = rawFiles();
    const extra = `${files['line_items.csv']!.trimEnd()}\nme-2024-statewide,summary,extra_row,detail,An extra sentence,,,,,,,,,,0,none,,,3,text_and_image,\n`;
    expect(() => buildDrugReportViews(buildDataset({ files: { ...files, 'line_items.csv': extra } }))).toThrow(/does not know|schedule|expected/);
  });
});

describe('Minnesota, two years', () => {
  it('keeps the latest year at the state address and puts the earlier year one level below it', () => {
    expect(mn24.years).toEqual([
      { year: '2024', path: '/scorecard/mn/' },
      { year: '2023', path: '/scorecard/mn/2023/' },
    ]);
    expect(mn23.years).toEqual(mn24.years);
    expect(mn24.filing.reportingYear).toBe('2024');
    expect(mn23.year).toBe('2023');
    expect(reportPath('MN', '2023', '2024')).toBe('/scorecard/mn/2023/');
    expect(reportPath('MN', '2024', '2024')).toBe('/scorecard/mn/');
    expect(reportFormSpec('mn-mdh-340b-report').earlier?.year).toBe('2023');
  });

  it('leaves the 2024 view as it was: 26 entities and the six statewide rows', () => {
    expect(mn24.entities).toHaveLength(26);
    expect(mn24.totals).toHaveLength(6);
    expect(mn24.filing.filingId).toBe('mn-2024-statewide');
    expect(mn24.differences.every((d) => d.difference.filingId.startsWith('mn-2024-'))).toBe(true);
  });

  it('has 26 entities in the 2023 report, with the four columns it prints, as printed', () => {
    expect(mn23.entities).toHaveLength(26);
    const names = mn23.entities.map((e) => e.name);
    expect(names[0]).toBe('Abbott Northwestern Hospital');
    expect(new Set(names).size).toBe(26);
    const abbott = mn23.entities[0]!;
    expect([abbott.scope.answerAsFiled, abbott.net.amountAsFiled, abbott.pct.amountAsFiled, abbott.programs.amountAsFiled]).toEqual(['Dispensed Only', '31,773,835', '5%', '24%']);
    expect(abbott.netCents).toBe(3177383500);
    expect(abbott.pctValue).toBe('5');
    expect(abbott.cite.net).toContain('page 42 of the report PDF');
    const scopes = mn23.entities.map((e) => e.scope.answerAsFiled);
    expect(scopes.filter((s) => s === 'Dispensed Only')).toHaveLength(21);
    expect(scopes.filter((s) => s === 'Administered & Dispensed')).toHaveLength(5);
  });

  it('carries no figure from one year into the other: the 2023 rows come from the 2023 records only', () => {
    for (const e of mn23.entities) {
      expect(e.filing.reportingYear).toBe('2023');
      for (const row of [e.scope, e.net, e.pct, e.programs]) expect(row.filingId).toBe(e.filing.filingId);
    }
    for (const e of mn24.entities) expect(e.filing.reportingYear).toBe('2024');
    expect(mn23.filing.pdfSha256).not.toBe(mn24.filing.pdfSha256);
    expect(mn23.filing.sourceUrl).toBe('https://www.health.mn.gov/data/340b/docs/2024report.pdf');
  });

  it('has Table 6: five groupings, a major type for each, four payers and a total, and the Total row', () => {
    expect(mn23.groupings.map((g) => g.grouping.id)).toEqual(['general_acute_care', 'critical_access', 'other_hospitals', 'disease_specific_grantees', 'safety_net_grantees', 'total']);
    expect(mn23.groupings.map((g) => g.majorType?.answerAsFiled ?? null)).toEqual(['Hospital', 'Hospital', 'Hospital', 'Grantee', 'Grantee', null]);
    const total = mn23.groupings.at(-1)!;
    expect(total.cells.map((c) => c.row.amountAsFiled)).toEqual(['343,236,687', '197,064,198', '86,587,184', '3,374,283', '630,262,352']);
    const negative = mn23.groupings[3]!.cells.find((c) => c.payer.id === 'other')!;
    expect(negative.row.amountAsFiled).toBe('-1,481,489');
    expect(negative.row.amountCents).toBe(-148148900);
  });

  it('lists the six one-dollar differences with their notes, all on the statewide record', () => {
    expect(mn23.differences).toHaveLength(6);
    for (const d of mn23.differences) {
      expect(d.filingId).toBe('mn-2023-statewide');
      expect(Math.abs(Number(d.difference))).toBe(1);
      expect(d.note).not.toBe('');
    }
  });

  it('links the 15 entities named in both years to each other, and no other', () => {
    const linked23 = mn23.entities.filter((e) => e.otherYear);
    const linked24 = mn24.entities.filter((e) => e.otherYear);
    expect(linked23).toHaveLength(15);
    expect(linked24).toHaveLength(15);
    expect(new Set(linked23.map((e) => e.entity.entityId))).toEqual(new Set(linked24.map((e) => e.entity.entityId)));
    const abbott = linked23.find((e) => e.name === 'Abbott Northwestern Hospital')!;
    expect(abbott.otherYear).toEqual({ year: '2024', href: '/scorecard/mn/#entity-abbott-northwestern' });
    expect(linked24.find((e) => e.entity.entityId === abbott.entity.entityId)!.otherYear).toEqual({ year: '2023', href: '/scorecard/mn/2023/#entity-abbott-northwestern' });
    // Two entities that are in the same city and are not the same entity (METHODS) are not linked.
    expect(mn23.entities.find((e) => e.name === 'Fairview Range')!.otherYear).toBeNull();
    // Every link leads to an anchor that exists on the other page.
    const anchors23 = new Set(mn23.entities.map((e) => e.anchor));
    const anchors24 = new Set(mn24.entities.map((e) => e.anchor));
    for (const e of linked24) expect(anchors23.has(e.anchor)).toBe(true);
    for (const e of linked23) expect(anchors24.has(e.anchor)).toBe(true);
  });

  it('keeps the entity address and the year address apart', () => {
    for (const v of buildViews(data)) expect(v.entity.path).not.toMatch(/\/\d{4}\/$/);
  });

  it('stops when a 2023 row is not the one the form names', () => {
    const files = rawFiles();
    files['line_items.csv'] = files['line_items.csv']!.replace('Covered Entity Major Type', 'Major Type');
    expect(() => buildEarlierReportViews(buildDataset({ files }))).toThrow(/major type/);
  });

  it('stops when the dataset lists a 2023 sum that the rows do not give', () => {
    const files = rawFiles();
    files['discrepancies.csv'] = files['discrepancies.csv']!.replace('197064199,197064198', '197064198,197064198');
    expect(files['discrepancies.csv']).toContain('197064198,197064198');
    expect(() => buildEarlierReportViews(buildDataset({ files }))).toThrow(/listed sum of medicare/);
  });

  it('says in the registry that two years are shown', () => {
    const entry = STATE_REGISTRY['MN']!;
    expect(entry.publicNow).toMatch(/two years/);
    expect(entry.summary).toMatch(/2024 data and 2023 data/);
    expect(entry.sources?.map((s) => s.href)).toContain('https://www.health.mn.gov/data/340b/docs/2024report.pdf');
  });
});
