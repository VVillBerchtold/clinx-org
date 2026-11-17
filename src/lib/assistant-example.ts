import { getDataset, type LineItem } from './data';
import { buildYearView, centerPath, linesOf } from './hc-records';
import { showCell } from './workbook';

/**
 * The worked example on the page for AI assistants: two public records about one health center, read
 * with three questions. One record is the 340B report the health center filed with Ohio. The other is
 * its yearly report to HRSA (the Uniform Data System).
 *
 * Nothing here is typed in by hand except which two health centers are shown and how their names are
 * written. Every figure is read from the same files the two records' own pages are built from, so the
 * example changes when the files do. Two health centers are shown so the example does not lean one way:
 * at the first the filed payments are the larger figures, at the second the grant is.
 */
export const EXAMPLE_YEAR = 2025;

/** In the order of their names. `name` is the health center's name in ordinary capitals; tests hold it to HRSA's. */
export const EXAMPLE_CENTERS: readonly { name: string; filingId: string; key: string }[] = [
  { name: 'Family Health Services of Darke County', filingId: 'oh-2025-ch050640', key: '050640' },
  { name: 'Ohio North East Health Systems', filingId: 'oh-2025-ch056440', key: '056440' },
];

/** The three totals of payments received that Ohio's workbook holds: the schedule, and the words for the page. */
const FILED_LINES: readonly { schedule: string; label: string }[] = [
  { schedule: 'in_house_payments_received', label: 'Payments received, its own pharmacy' },
  { schedule: 'contract_payments_received', label: 'Payments received, contract pharmacies' },
  { schedule: 'administered_payments_total', label: 'Payments received, drugs it administered' },
];

/** The two lines of HRSA's report the example asks for. */
const REPORTED_LINES: readonly { table: string; line: string; where: string; label: string }[] = [
  { table: 'Table 9E', line: 'L1g', where: 'Table 9E, line 1g', label: 'Health Center Program grant' },
  { table: 'Table 8A', line: 'L8b', where: 'Table 8A, line 8b', label: 'Cost of pharmaceuticals' },
];

export interface ExampleFigure {
  label: string;
  /** The figure as the record's own page shows it, or HRSA's mark in words where no figure is published. */
  text: string;
  /** Where the figure sits in its record: a workbook cell, or a table and line. */
  where: string;
}

export interface ExampleCenter {
  name: string;
  city: string;
  /** The 340B ID as HRSA spells it, and the key HRSA's report knows the health center by. */
  id340b: string;
  key: string;
  filingPath: string;
  reportPath: string;
  filed: ExampleFigure[];
  reported: ExampleFigure[];
}

/** One line of HRSA's report for a health center, first column, as the record's page shows it. */
function reportedFigure(key: string, spec: (typeof REPORTED_LINES)[number]): ExampleFigure {
  const table = buildYearView(key, EXAMPLE_YEAR).tables.find((t) => t.name === spec.table);
  const row = table?.blocks.flatMap((b) => b.rows).find((r) => r.line === spec.line);
  const cell = row?.cells.find((c) => c !== null);
  if (!cell) throw new Error(`The worked example needs ${spec.where} for health center ${key} in ${EXAMPLE_YEAR}, and the records do not hold it`);
  return { label: spec.label, text: cell.text, where: spec.where };
}

/** The total of one schedule of an Ohio workbook, as the filing's page shows it. */
function filedFigure(lines: readonly LineItem[], filingId: string, spec: (typeof FILED_LINES)[number]): ExampleFigure {
  const row = lines.find((l) => l.filingId === filingId && l.schedule === spec.schedule && l.line === 'total' && l.rowKind === 'total');
  const cell = showCell(row, 'usd');
  if (!row || cell.kind !== 'figure') throw new Error(`The worked example needs the total of ${spec.schedule} in ${filingId}, and the filings do not hold it as a figure`);
  return { label: spec.label, text: cell.text, where: `cell ${row.sourceCell}` };
}

let cache: ExampleCenter[] | undefined;
export function assistantExample(): ExampleCenter[] {
  if (cache) return cache;
  const data = getDataset();
  cache = EXAMPLE_CENTERS.map((c) => {
    const filing = data.filings.find((f) => f.filingId === c.filingId);
    const entity = filing && data.entities.find((e) => e.entityId === filing.entityId);
    if (!filing || !entity) throw new Error(`The worked example needs the filing ${c.filingId}, and the filings do not hold it`);
    const view = buildYearView(c.key, EXAMPLE_YEAR);
    return {
      name: c.name,
      city: view.header.city,
      id340b: entity.hrsaIdSpelling,
      key: c.key,
      filingPath: filing.path,
      reportPath: centerPath(c.key, EXAMPLE_YEAR),
      filed: FILED_LINES.map((spec) => filedFigure(data.lineItems, c.filingId, spec)),
      reported: REPORTED_LINES.map((spec) => reportedFigure(c.key, spec)),
    };
  });
  return cache;
}

/** How many lines of HRSA's report name 340B. The page says there is none, and the build stops if that changes. */
export function reportLinesNaming340b(): number {
  return linesOf(EXAMPLE_YEAR).filter((l) => /340b/i.test(`${l.lineTitle} ${l.columnTitle} ${l.table}`)).length;
}
