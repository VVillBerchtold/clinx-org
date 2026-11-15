/**
 * The forms this site can show, one entry per `form` value in filings.csv.
 *
 * The form (never the state) decides which rows a view reads, how the three measures are worked
 * out, and the words that depend on the form ("filing" or "report", "calendar year" or "fiscal
 * year"). A form this file does not know stops the build: `anyFormSpec` throws.
 * scripts/dataset-shape.mjs holds the same list of ids for the copy-in checks.
 */

export type RowKind = 'detail' | 'total';

/**
 * What a record in filings.csv is. `filing`: an entity's own filing. `state_report_row`: a row a state
 * printed about one entity. `state_report_totals`: the record that holds a state report's totals and
 * running text. A kind not listed here stops the build. scripts/dataset-shape.mjs holds the same list.
 */
export const RECORD_KINDS = ['filing', 'state_report_row', 'state_report_totals'] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

/** The entity types of entities.csv. scripts/dataset-shape.mjs holds the same list. */
export const ENTITY_TYPES = ['health_center', 'hospital', 'other', 'state_total'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export function recordKind(text: string): RecordKind {
  const found = RECORD_KINDS.find((k) => k === text);
  if (!found) throw new Error(`Unknown record kind "${text}": this site does not know how to read it`);
  return found;
}

export function entityType(text: string): EntityType {
  const found = ENTITY_TYPES.find((t) => t === text);
  if (!found) throw new Error(`Unknown entity type "${text}"`);
  return found;
}

/** A row of the form, named the way the dataset keys it. `label` is the printed label, checked when given. */
export interface RowKey {
  schedule: string;
  line: string;
  kind: RowKind;
  label?: string;
}

/** What every form says, whoever made the record. */
export interface FormBase {
  id: string;
  /** 'schedules': a cover page and lettered schedules. 'one-page': a single page of figures. 'state-report': tables in a state's own report, one row per entity. 'state-totals': a state's own report that prints statewide totals only. */
  layout: 'schedules' | 'one-page' | 'state-report' | 'state-totals';
  /** The kinds of record a filing of this form may be. */
  recordKinds: readonly RecordKind[];
  /** One filing of this form, and the word for the period it covers. */
  noun: string;
  nounPlural: string;
  periodWord: string;
  /** "filed" or "printed": how the dataset's `_as_filed` values are described on the pages. */
  asWord: string;
  /** Where the PDF is hosted, for the link text in the source block. */
  publisher: string;
  /** Rows of these schedules are loaded. */
  shownSchedules: readonly string[];
  /** Schedules of the form that are never loaded (not shown for now). The drug schedule is loaded apart (see drugSchedule). Any other schedule is an error. */
  withheldSchedules: readonly string[];
  /** Short page title suffix, for example "340B filing, 2025". */
  titleSuffix: (year: string) => string;
}

/**
 * A schedule that lists drugs: one row per drug, an amount and a number of claims, then the rows that close it.
 * The form says which schedule it is and the words the drug page uses for it. A form without one has no drug page.
 */
export interface DrugScheduleSpec {
  /** The schedule letter in line_items.csv. */
  schedule: string;
  /** How the page names the schedule, for example "Schedule G". */
  scheduleName: string;
  /** What one row is, for the counts: "drug" and "drugs". */
  noun: string;
  nounPlural: string;
  /** Column headings, in the form's own words. */
  nameHeading: string;
  amountHeading: string;
  claimsHeading: string;
  /** The `line` of the row that adds up the rows below the form's threshold, and of the printed total. */
  belowThresholdLine: string;
  totalLine: string;
}

/** A form on which an entity files its own figures: three measures can be worked out from it. */
export interface FormSpec extends FormBase {
  layout: 'schedules' | 'one-page';
  /** The rows the page of figures is made of, in the order the form prints them. */
  figureRows: readonly RowKey[];
  /** Row kinds that count as figure rows when checking a filing has exactly these rows. */
  figureKinds: readonly RowKind[];
  /** Gross margin = plus minus minus. */
  margin: { plus: RowKey; minus: RowKey };
  /** External cost = the sum of these. */
  external: readonly RowKey[];
  /** Says which rows a figure was read from, for a link's description. */
  describe: (keys: readonly RowKey[]) => string;
  /** The schedule of drugs, when the form has one. Its rows are loaded apart from the other rows. */
  drugSchedule?: DrugScheduleSpec;
}

/** One group of rows in a state report's totals table: a net revenue row and a percentage row. */
export interface ReportGroup {
  /** Prefix of the two lines, for example `top_unadjusted`. */
  id: string;
  /** The row's label exactly as the report prints it. */
  label: string;
  kind: RowKind;
  adjusted: boolean;
}

/**
 * A form on which a state prints figures about the entities it names: one row per entity and one
 * record of totals. It has no cost rows, so none of the three measures exists for it.
 */
export interface ReportFormSpec extends FormBase {
  layout: 'state-report';
  /** The state body that prints the report, as the dataset names it. */
  agency: string;
  /** The table with one row per entity. */
  entityTable: { schedule: string; netLine: string; pctLine: string; netHeading: string; pctHeading: string };
  /** The totals table, in the order it prints its rows. */
  totalsTable: { schedule: string; netSuffix: string; pctSuffix: string; netHeading: string; pctHeading: string; groups: readonly ReportGroup[] };
  /** The report's own words around the tables, kept word for word: the line of each. */
  notes: { schedule: string; aboveEntityTable: string; entityTableTitle: string; entityTableSource: string; aboveTotalsTable: string; totalsTableTitle: string; totalsTableSource: string };
  /** The entity type that follows from a printed type. */
  typeFor: (printedType: string) => EntityType;
}

/** A row of a table in a statewide report: a figure cell and a percentage cell under the same label. */
export interface TotalsRow {
  /** Prefix of the two lines, for example `commercial`. */
  id: string;
  /** The row's label exactly as the report prints it. */
  label: string;
  kind: RowKind;
}

/** One table of a statewide report: a label column, a figure column and a percentage column. */
export interface TotalsTableSpec {
  /** The schedule in line_items.csv; also the table's anchor on the page. */
  schedule: string;
  /** The heading the report prints above the table. */
  heading: string;
  /** The three column headings as the report prints them. */
  rowHeading: string;
  figureHeading: string;
  pctHeading: string;
  /** The figure cell's line is `<row>_<figureSuffix>`, the percentage cell's `<row>_<pctSuffix>`. */
  figureSuffix: string;
  pctSuffix: string;
  figureUnit: 'usd' | 'count';
  rows: readonly TotalsRow[];
  /** Lines of the note schedule: the report's sentences printed above the table and below it, in order. */
  above: readonly string[];
  below: readonly string[];
}

/** A figure a statewide report prints by itself (a tile, a chart label): one line and its printed label. */
export interface TotalsFigure {
  line: string;
  label: string;
}

/** A row of the table that says who reported: a count, a percentage printed in the same cell (when there is one) and a note. */
export interface SubmissionRow {
  label: string;
  countLine: string;
  pctLine?: string;
  notesLine?: string;
}

/**
 * A form on which a state prints statewide totals only: no row names an entity. It has one record,
 * the statewide one, and none of the three measures exists for it.
 */
export interface TotalsFormSpec extends FormBase {
  layout: 'state-totals';
  /** The state body that prints the report. */
  agency: string;
  /** The headline figures printed apart from the tables, in the order printed. */
  highlights: { schedule: string; heading: string; figures: readonly TotalsFigure[] };
  /** The report's chart of totals: whole-dollar labels, in the order printed. `title` is a line of the note schedule. */
  chart: { schedule: string; title: string; figures: readonly TotalsFigure[] };
  /** The table that says who reported. */
  submissions: { schedule: string; rowHeading: string; countHeading: string; notesHeading: string; rows: readonly SubmissionRow[]; above: readonly string[] };
  /** The line whose count the site's lists give for the state, and the word for what is counted. */
  countOf: { schedule: string; line: string; noun: string };
  /** The tables that split a total by payer, in the order printed. */
  payerTables: readonly TotalsTableSpec[];
  /** The table of what the savings were used for. */
  usesTable: TotalsTableSpec;
  /** Lines of the note schedule: the report's summary, its closing paragraph, and the lines kept in the data but not drawn on the page. */
  notes: { schedule: string; summary: readonly string[]; closing: readonly string[]; notDrawn: readonly string[] };
}

export type AnyFormSpec = FormSpec | ReportFormSpec | TotalsFormSpec;

const A = (line: string): RowKey => ({ schedule: 'A', line, kind: 'detail' });

const riLines = (keys: readonly RowKey[]): string => {
  const lines = keys.map((k) => k.line);
  if (lines.length === 2) return `Schedule A, lines ${lines[0]} and ${lines[1]}`;
  return `Schedule A, lines ${lines[0]} to ${lines[lines.length - 1]}`;
};

const RI: FormSpec = {
  id: 'ri-oag-340b',
  layout: 'schedules',
  recordKinds: ['filing'],
  noun: 'filing',
  nounPlural: 'filings',
  periodWord: 'calendar year',
  asWord: 'filed',
  publisher: "State of Rhode Island's website",
  shownSchedules: ['A', 'D', 'E'],
  withheldSchedules: ['B', 'C', 'F', 'H', 'I'],
  drugSchedule: {
    schedule: 'G',
    scheduleName: 'Schedule G',
    noun: 'drug',
    nounPlural: 'drugs',
    nameHeading: 'Drug',
    amountHeading: 'Amount as filed',
    claimsHeading: 'Claims as filed',
    belowThresholdLine: 'under_5000',
    totalLine: 'total',
  },
  figureRows: ['1', '2', '3', '4', '5', '6'].map(A),
  figureKinds: ['detail'],
  margin: { plus: A('2'), minus: A('1') },
  external: [A('3'), A('4')],
  describe: riLines,
  titleSuffix: (year) => `340B filing, ${year}`,
};

const V = (schedule: string, line: string, label: string, kind: RowKind = 'detail'): RowKey => ({ schedule, line, kind, label });
const VT_PAYMENTS_TOTAL = V('payments', 'total', 'Total 340B Payments Received', 'total');
const VT_ACQUISITION = V('acquisition', 'cost', '340B Prescription Drug Acquisition Costs');
const VT_CONTRACT = V('expenses', 'contract_pharmacies', 'Payments Made to Contract Pharmacies');
const VT_VENDORS = V('expenses', 'outside_vendors', 'Payments Made to Outside Vendors');

const VT: FormSpec = {
  id: 'vt-gmcb-340b-financial',
  layout: 'one-page',
  recordKinds: ['filing'],
  noun: 'report',
  nounPlural: 'reports',
  periodWord: 'fiscal year',
  asWord: 'printed',
  publisher: "Green Mountain Care Board's website",
  shownSchedules: ['payments', 'acquisition', 'expenses', 'result', 'page_note'],
  withheldSchedules: [],
  figureRows: [
    V('payments', 'in_house_pharmacy', 'In-House Pharmacy Dispensed'),
    V('payments', 'contract_pharmacy', 'Contract Pharmacy Dispensed'),
    V('payments', 'administered_paid_separately', 'Administered Drugs Paid Separately'),
    V('payments', 'administered_bundled', 'Administered Drugs Bundled Payments'),
    VT_PAYMENTS_TOTAL,
    VT_ACQUISITION,
    VT_CONTRACT,
    V('expenses', 'internal', 'Internal 340B Program Expenses'),
    VT_VENDORS,
    V('expenses', 'total', 'Total 340B Expenses', 'total'),
    V('result', 'net_revenue', '340B Net Revenue'),
    V('result', 'operating_margin', '340B Operating Margin'),
  ],
  figureKinds: ['detail', 'total'],
  margin: { plus: VT_PAYMENTS_TOTAL, minus: VT_ACQUISITION },
  external: [VT_CONTRACT, VT_VENDORS],
  describe: (keys) => {
    const labels = keys.map((k) => k.label ?? k.line);
    return labels.length < 2 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  },
  titleSuffix: (year) => `340B report, FY${year}`,
};

const MN_GROUPS: readonly ReportGroup[] = [
  { id: 'top_unadjusted', label: 'Top 25, unadjusted', kind: 'detail', adjusted: false },
  { id: 'remaining_unadjusted', label: 'Remaining 156, unadjusted', kind: 'detail', adjusted: false },
  { id: 'total_unadjusted', label: 'Total, unadjusted', kind: 'total', adjusted: false },
  { id: 'top_adjusted', label: 'Top 25, adjusted', kind: 'detail', adjusted: true },
  { id: 'remaining_adjusted', label: 'Remaining 156, adjusted', kind: 'detail', adjusted: true },
  { id: 'total_adjusted', label: 'Total, adjusted', kind: 'total', adjusted: true },
];

const MN: ReportFormSpec = {
  id: 'mn-mdh-340b-report',
  layout: 'state-report',
  recordKinds: ['state_report_row', 'state_report_totals'],
  agency: 'Minnesota Department of Health',
  noun: 'report',
  nounPlural: 'reports',
  periodWord: 'data year',
  asWord: 'printed',
  publisher: "Minnesota Department of Health's website",
  shownSchedules: ['table_6_1', 'table_6_2', 'page_note'],
  withheldSchedules: [],
  entityTable: { schedule: 'table_6_1', netLine: 'net_revenue', pctLine: 'pct_of_statewide', netHeading: 'Net 340B Revenue ($)', pctHeading: '% of Statewide Net 340B Revenue' },
  totalsTable: { schedule: 'table_6_2', netSuffix: 'net_revenue', pctSuffix: 'pct_of_total', netHeading: 'Net 340B Revenue ($)', pctHeading: '% of Total', groups: MN_GROUPS },
  notes: { schedule: 'page_note', aboveEntityTable: 'note_1', entityTableTitle: 'note_2', entityTableSource: 'note_3', aboveTotalsTable: 'note_4', totalsTableTitle: 'note_5', totalsTableSource: 'note_6' },
  typeFor: (printedType) => (/\bHospital\b/.test(printedType) ? 'hospital' : 'other'),
  titleSuffix: (year) => `340B data, ${year}`,
};

const ID_PAYER_ROWS: readonly TotalsRow[] = [
  { id: 'commercial', label: 'Commercial', kind: 'detail' },
  { id: 'medicare', label: 'Medicare', kind: 'detail' },
  { id: 'medicaid', label: 'Medicaid', kind: 'detail' },
  { id: 'self_pay', label: 'Self-Pay', kind: 'detail' },
  { id: 'other', label: 'Other', kind: 'detail' },
  { id: 'uninsured', label: 'Uninsured', kind: 'detail' },
  { id: 'total', label: 'TOTAL', kind: 'total' },
];

const idPayerTable = (schedule: string, heading: string, figureHeading: string, pctHeading: string, above: readonly string[], figureSuffix = 'amount', figureUnit: 'usd' | 'count' = 'usd'): TotalsTableSpec => ({
  schedule,
  heading,
  rowHeading: 'Payer Type',
  figureHeading,
  pctHeading,
  figureSuffix,
  pctSuffix: 'pct',
  figureUnit,
  rows: ID_PAYER_ROWS,
  above,
  below: [],
});

const ID: TotalsFormSpec = {
  id: 'id-sco-340b-report',
  layout: 'state-totals',
  recordKinds: ['state_report_totals'],
  agency: "Idaho State Controller's Office",
  noun: 'report',
  nounPlural: 'reports',
  periodWord: 'calendar year',
  asWord: 'printed',
  publisher: "Idaho State Controller's Office file store",
  shownSchedules: ['key_highlights', 'key_financial_metrics', 'submissions', 'acquisition_cost', 'payments_received', 'contract_pharmacy_payments', 'claims', 'savings_use', 'page_note'],
  withheldSchedules: [],
  highlights: {
    schedule: 'key_highlights',
    heading: 'KEY HIGHLIGHTS',
    figures: [
      { line: 'total_claims', label: 'Total Claims Dispensed' },
      { line: 'payments_received', label: 'Aggregate Payments Received' },
      { line: 'savings_to_community', label: '340B Savings to Community' },
      { line: 'covered_entities', label: 'Unique Covered Entities' },
    ],
  },
  chart: {
    schedule: 'key_financial_metrics',
    title: 'note_4',
    figures: [
      { line: 'contract_pharmacy_payments', label: 'Payments to Contract Pharmacies' },
      { line: 'acquisition_cost', label: 'Aggregate Acquisition Cost' },
      { line: 'savings_utilized', label: '340B Savings Utilized' },
      { line: 'payments_received', label: 'Aggregate Payments Received' },
    ],
  },
  submissions: {
    schedule: 'submissions',
    rowHeading: 'Submission Metric',
    countHeading: 'Count',
    notesHeading: 'Notes',
    rows: [
      { label: 'Total submissions received', countLine: 'received_count', notesLine: 'received_notes' },
      { label: 'Total child sites', countLine: 'child_sites_count' },
      { label: 'Submissions with complete status', countLine: 'complete_count', pctLine: 'complete_pct', notesLine: 'complete_notes' },
    ],
    above: ['note_6', 'note_7'],
  },
  countOf: { schedule: 'submissions', line: 'received_count', noun: 'submissions' },
  payerTables: [
    idPayerTable('acquisition_cost', 'Aggregate Acquisition Cost', 'Aggregate Acquisition Cost', '% of Total Cost', ['note_8']),
    idPayerTable('payments_received', 'Aggregate Payments Received', 'Aggregate Payments Received', '% of Total Payments', ['note_9']),
    idPayerTable('contract_pharmacy_payments', 'Aggregate Payments to Contract Pharmacies', 'Payments to Contract Pharmacies', '% of Total CP Payments', ['note_10']),
    idPayerTable('claims', 'Number of Claims by Payer Type', 'Total Claims', '% of Total', ['note_11', 'note_12'], 'claims', 'count'),
  ],
  usesTable: {
    schedule: 'savings_use',
    heading: '340B Savings Utilization',
    rowHeading: 'Savings Use Category',
    figureHeading: 'Amount Applied',
    pctHeading: '% of Total Savings',
    figureSuffix: 'amount',
    pctSuffix: 'pct',
    figureUnit: 'usd',
    rows: [
      { id: 'under_reimbursement', label: 'Offset financial loss due to under-reimbursement from government programs', kind: 'detail' },
      { id: 'uncompensated_care', label: 'Offset financial loss due to providing uncompensated care', kind: 'detail' },
      { id: 'patient_financial_assistance', label: 'Financial assistance for patients who cannot pay for care or medications', kind: 'detail' },
      { id: 'prescription_assistance', label: 'Prescription medication assistance programs', kind: 'detail' },
      { id: 'community_health', label: 'Community health programs and outreach/education', kind: 'detail' },
      { id: 'subsidized_services', label: 'Subsidized health services provided below actual cost', kind: 'detail' },
      { id: 'health_professional_education', label: 'Education of health professionals serving underserved populations', kind: 'detail' },
      { id: 'access_barriers', label: 'Programs addressing barriers to healthcare access', kind: 'detail' },
      { id: 'other_uses', label: 'Additional / Other reported uses (10 entities*)', kind: 'detail' },
      { id: 'total', label: 'TOTAL', kind: 'total' },
    ],
    above: ['note_13'],
    below: ['note_14'],
  },
  // note_1 is the period, which filings.csv also carries; note_5 is the labels of the chart's value axis.
  notes: { schedule: 'page_note', summary: ['note_2', 'note_3'], closing: ['note_15'], notDrawn: ['note_1', 'note_5'] },
  titleSuffix: (year) => `340B data, ${year}`,
};

export const FORMS: Readonly<Record<string, AnyFormSpec>> = { [RI.id]: RI, [VT.id]: VT, [MN.id]: MN, [ID.id]: ID };

/** Any form the site knows; an unknown id stops the build. */
export function anyFormSpec(id: string): AnyFormSpec {
  const spec = FORMS[id];
  if (!spec) throw new Error(`Unknown form "${id}": this site does not know how to read it`);
  return spec;
}

/** A form on which entities file their own figures (the three measures exist). */
export function formSpec(id: string): FormSpec {
  const spec = anyFormSpec(id);
  if (spec.layout === 'state-report' || spec.layout === 'state-totals') throw new Error(`The form "${id}" is a state's report about entities, not a filing`);
  return spec;
}

/** A form on which a state prints figures about the entities it names. */
export function reportFormSpec(id: string): ReportFormSpec {
  const spec = anyFormSpec(id);
  if (spec.layout !== 'state-report') throw new Error(`The form "${id}" is not a state's report with a row for each entity`);
  return spec;
}

/** A form on which a state prints statewide totals only. */
export function totalsFormSpec(id: string): TotalsFormSpec {
  const spec = anyFormSpec(id);
  if (spec.layout !== 'state-totals') throw new Error(`The form "${id}" is not a state's report of statewide totals`);
  return spec;
}
