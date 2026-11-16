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
export const ENTITY_TYPES = ['health_center', 'hospital', 'other', 'state_total', 'not_stated'] as const;
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
  /** 'schedules': a cover page and lettered schedules. 'one-page': a single page of figures. 'state-report': tables in a state's own report, one row per entity. 'state-totals': a state's own report that prints statewide totals only. 'state-drug-lists': a state's own report that prints statewide totals and lists of drugs, no row naming a filer. */
  layout: 'schedules' | 'one-page' | 'state-report' | 'state-totals' | 'state-drug-lists' | 'workbook';
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
  /**
   * The same state's report of an earlier year, when the dataset holds one. It prints other columns and
   * other tables, so it has its own lines; the form says which year it is (`reporting_year`) and
   * how to read it. The page of the earlier year shows only what that report prints.
   */
  earlier?: EarlierReportSpec;
}

/** One column of the earlier report's entity table, besides the entity's name: the line and the heading the report prints. */
export interface EarlierColumn {
  line: string;
  heading: string;
  unit: 'usd' | 'percent' | 'none';
}

/** One payer column of the earlier report's table of totals. */
export interface EarlierPayer {
  /** The line ends in `_<id>`. */
  id: string;
  /** The heading the report prints. */
  heading: string;
}

/** One grouping (row) of the earlier report's table of totals. */
export interface EarlierGrouping {
  /** The line starts with `<id>_`. */
  id: string;
  /** The row's label exactly as the report prints it. */
  label: string;
  kind: RowKind;
}

/** How to read a state's report of an earlier year: an entity table and a table of totals by grouping and payer. */
export interface EarlierReportSpec {
  /** The `reporting_year` of its records. */
  year: string;
  /** The entity table: scope, net revenue, share of the statewide figure and share attributed to the state's own programs. */
  entityTable: { schedule: string; scope: EarlierColumn; net: EarlierColumn; pct: EarlierColumn; programs: EarlierColumn };
  /** The totals table: one row per grouping (with its major type as text), one column per payer and a Total column; the last grouping is the Total row. */
  totalsTable: { schedule: string; majorTypeSuffix: string; majorTypeHeading: string; groupingHeading: string; payers: readonly EarlierPayer[]; groupings: readonly EarlierGrouping[] };
  /** The report's own words around the tables: the line of each page note. */
  notes: { schedule: string; aboveEntityTable: string; entityTableTitle: string; entityTableSource: string; entityTableNote: string; totalsTableTitle: string; totalsTableSource: string };
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

/** One of a drug report's lists of drugs: a share sentence, then three figures for each drug. */
export interface DrugListSpec {
  /** The schedule in line_items.csv; also the list's anchor on the page. */
  schedule: string;
  /** Short name used in this site's own words, for example "most costly". */
  short: string;
  /** The line of the share sentence, and the lines of a page note that hold the report's title and sub-title of the list. */
  shareLine: string;
  titleNote: string;
  subtitleNote: string;
  /** A drug's three lines are `<ndc>_<suffix>`. */
  costSuffix: string;
  savingsSuffix: string;
  hospitalsSuffix: string;
  /** The drugs the report prints in this list, which the dataset must hold exactly. */
  drugs: number;
}

/** A figure the summary prints in a sentence: its line, the kind of cell it is, and the short name this site gives it. */
export interface DrugReportFigure {
  line: string;
  /** 'count' and 'percent' have a parsed amount; 'text' is a figure printed with a letter for millions, kept as text. */
  kind: 'count' | 'percent' | 'text';
  /** What the figure is, in a few words. */
  caption: string;
}

/**
 * A form on which a state prints statewide figures and lists of drugs added across its hospitals: one
 * record, no row that names a hospital, and none of the three measures.
 */
export interface DrugListsFormSpec extends FormBase {
  layout: 'state-drug-lists';
  /** The state body that prints the report. */
  agency: string;
  /** The summary's four figures, in the order printed. */
  summary: { schedule: string; figures: readonly DrugReportFigure[]; titleNote: string };
  /** The lists of drugs, in the order printed. */
  lists: readonly DrugListSpec[];
  /** The line of the summary whose count the site's lists give for the state, and the word for what is counted. */
  countOf: { schedule: string; line: string; noun: string };
  /** The line of the page notes the form keeps. */
  notes: { schedule: string };
}

/** A column of a workbook's tables: the key the dataset gives it and the heading the template prints. */
export interface WorkbookColumn {
  /** The `line` of the rows in this column. */
  id: string;
  heading: string;
}

/** One table of a workbook: a row of the template for each payer column. */
export interface WorkbookTable {
  /** The `schedule` of its rows in line_items.csv. */
  schedule: string;
  /** What the row is, in a few words; the label the template prints is on the data and is used as the row's title. */
  short: string;
  unit: 'usd' | 'count' | 'percent';
}

/** A section of the template's first sheet that is a grid of figures by payer. */
export interface WorkbookSection {
  id: string;
  /** The words the template uses for the section. */
  heading: string;
  /** A plain sentence about what the section holds. */
  about: string;
  tables: readonly WorkbookTable[];
  /** The payer columns, left to right. */
  columns: readonly WorkbookColumn[];
}

/** A kind of covered entity, by the letters its 340B ID starts with, and HRSA's name for it. One map, so it can be corrected in one place. */
export type WorkbookKinds = Readonly<Record<string, string>>;

/**
 * A form that is an Excel workbook on the state's own template, one workbook for each filer (Ohio's).
 * The workbook prints a 340B ID and no name. Everything the page says that depends on the form is here.
 */
export interface WorkbookFormSpec extends FormBase {
  layout: 'workbook';
  /** The state body that collects and posts the workbooks. */
  agency: string;
  /** What the template is called. */
  templateName: string;
  /** The sections of figures by payer, in the order the template prints them. */
  sections: readonly WorkbookSection[];
  /** The `schedule` and `line` of the template's single figures and texts. */
  costs: { schedule: string; rows: readonly { line: string; label: string }[] };
  pharmacies: { schedule: string; line: string; notesSchedule: string; notesLine: string };
  uses: { schedule: string; programs: readonly string[]; equipment: readonly string[]; other: string; narrative: string; alternativeNarrative: string };
  /** The schedule of the cells outside the template, and the schedule of the identity cells. */
  otherCells: string;
  identity: { schedule: string; period: string; id: string; prefix: string; number: string };
  /** Kinds of entity by the letters at the start of the 340B ID, with the name HRSA gives each. */
  kinds: WorkbookKinds;
  /** The page where the cells of every workbook are listed in the dataset repository, from the workbook's file name. */
  cellsFolder: string;
}

export type AnyFormSpec = FormSpec | ReportFormSpec | TotalsFormSpec | DrugListsFormSpec | WorkbookFormSpec;

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
  shownSchedules: ['table_6_1', 'table_6_2', 'table_5', 'table_6', 'page_note'],
  withheldSchedules: [],
  entityTable: { schedule: 'table_6_1', netLine: 'net_revenue', pctLine: 'pct_of_statewide', netHeading: 'Net 340B Revenue ($)', pctHeading: '% of Statewide Net 340B Revenue' },
  totalsTable: { schedule: 'table_6_2', netSuffix: 'net_revenue', pctSuffix: 'pct_of_total', netHeading: 'Net 340B Revenue ($)', pctHeading: '% of Total', groups: MN_GROUPS },
  notes: { schedule: 'page_note', aboveEntityTable: 'note_1', entityTableTitle: 'note_2', entityTableSource: 'note_3', aboveTotalsTable: 'note_4', totalsTableTitle: 'note_5', totalsTableSource: 'note_6' },
  typeFor: (printedType) => (/\bHospital\b/.test(printedType) ? 'hospital' : 'other'),
  earlier: {
    year: '2023',
    entityTable: {
      schedule: 'table_5',
      scope: { line: 'scope', heading: 'Scope of Reported Data', unit: 'none' },
      net: { line: 'net_revenue', heading: 'Net 340B Revenue ($)', unit: 'usd' },
      pct: { line: 'pct_of_statewide', heading: '% of Statewide Net 340B Revenue', unit: 'percent' },
      programs: { line: 'pct_mhcp', heading: '% of Entity’s 340B Net Revenue attributed to Minnesota Health Care Programs', unit: 'percent' },
    },
    totalsTable: {
      schedule: 'table_6',
      majorTypeSuffix: 'major_type',
      majorTypeHeading: 'Covered Entity Major Type',
      groupingHeading: 'Covered Entity Grouping',
      payers: [
        { id: 'commercial', heading: 'Commercial' },
        { id: 'medicare', heading: 'Medicare' },
        { id: 'mhcp', heading: 'Minnesota Health Care Programs (MHCP)' },
        { id: 'other', heading: 'Other' },
        { id: 'total', heading: 'Total' },
      ],
      groupings: [
        { id: 'general_acute_care', label: 'General Acute Care Hospitals (DSH)', kind: 'detail' },
        { id: 'critical_access', label: 'Critical Access Hospitals', kind: 'detail' },
        { id: 'other_hospitals', label: 'Other Hospitals', kind: 'detail' },
        { id: 'disease_specific_grantees', label: 'Disease Specific Federal Grantees', kind: 'detail' },
        { id: 'safety_net_grantees', label: 'Safety-Net Federal Grantees', kind: 'detail' },
        { id: 'total', label: 'Total', kind: 'total' },
      ],
    },
    notes: { schedule: 'page_note', aboveEntityTable: 'note_1', entityTableTitle: 'note_2', entityTableSource: 'note_3', entityTableNote: 'note_4', totalsTableTitle: 'note_5', totalsTableSource: 'note_6' },
  },
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

const ME_COSTLY: DrugListSpec = {
  schedule: 'top3_costly',
  short: 'most costly',
  shareLine: 'pct_of_acquisition_cost',
  titleNote: 'note_2',
  subtitleNote: 'note_3',
  costSuffix: 'acquisition_cost',
  savingsSuffix: 'estimated_savings',
  hospitalsSuffix: 'hospitals',
  drugs: 37,
};

const ME_FREQUENT: DrugListSpec = {
  ...ME_COSTLY,
  schedule: 'top3_frequent',
  short: 'most frequently dispensed',
  titleNote: 'note_4',
  subtitleNote: 'note_5',
  drugs: 54,
};

const ME: DrugListsFormSpec = {
  id: 'me-mhdo-340b-report',
  layout: 'state-drug-lists',
  recordKinds: ['state_report_totals'],
  agency: 'Maine Health Data Organization',
  noun: 'report',
  nounPlural: 'reports',
  periodWord: 'fiscal year',
  asWord: 'printed',
  publisher: "Maine Health Data Organization's website",
  shownSchedules: ['summary', 'top3_costly', 'top3_frequent', 'page_note'],
  withheldSchedules: [],
  summary: {
    schedule: 'summary',
    titleNote: 'note_1',
    figures: [
      { line: 'hospitals_reporting', kind: 'count', caption: 'Hospitals that sent data' },
      { line: 'acquisition_cost', kind: 'text', caption: 'Spent to acquire drugs under 340B' },
      { line: 'pct_of_drug_spend', kind: 'percent', caption: 'Share of the hospitals\' spending on all drugs' },
      { line: 'estimated_savings', kind: 'text', caption: 'Estimated savings' },
    ],
  },
  lists: [ME_COSTLY, ME_FREQUENT],
  countOf: { schedule: 'summary', line: 'hospitals_reporting', noun: 'hospitals' },
  notes: { schedule: 'page_note' },
  titleSuffix: (year) => `340B report, fiscal ${year}`,
};


const OH_PAYERS: readonly WorkbookColumn[] = [
  { id: 'commercial', heading: 'Commercial Insurance/Private Insurance' },
  { id: 'medicare', heading: 'Medicare' },
  { id: 'medicaid', heading: 'Medicaid (all states)' },
  { id: 'other_third_party', heading: 'Other Third-Party Payor' },
  { id: 'uninsured', heading: 'Uninsured/Self-Pay' },
];
const OH_TOTAL: WorkbookColumn = { id: 'total', heading: 'Total' };
const OH_INDETERMINATE: WorkbookColumn = { id: 'indeterminate', heading: 'Indeterminate (Explain)' };
const ohTable = (schedule: string, short: string, unit: WorkbookTable['unit']): WorkbookTable => ({ schedule, short, unit });

// The letters at the start of HRSA's spelling of a 340B ID, and the name each has. HRSA's own page is the authority: correct a name here and every page follows.
const OH_KINDS: WorkbookKinds = {
  CAH: 'Critical access hospital',
  DSH: 'Disproportionate share hospital',
  RRC: 'Rural referral center',
  SCH: 'Sole community hospital',
  PED: "Children's hospital",
  CH: 'Community health center',
  // HRSA types an ID that starts CHC as a CH, and an ID that starts RW as an RW4 (checked against HRSA's list of 2026-11-11).
  CHC: 'Community health center',
  FQHCLA: 'Health center look-alike',
  FP: 'Title X family planning clinic',
  STD: 'Sexually transmitted disease clinic',
  TB: 'Tuberculosis clinic',
  HM: 'Hemophilia treatment center',
  HV: 'Ryan White HIV/AIDS program grantee',
  RW: 'Ryan White HIV/AIDS program grantee',
  RWI: 'Ryan White HIV/AIDS program grantee',
  RWII: 'Ryan White HIV/AIDS program grantee',
  RW4: 'Ryan White HIV/AIDS program grantee',
};

const OH: WorkbookFormSpec = {
  id: 'oh-odh-340b-report',
  layout: 'workbook',
  recordKinds: ['filing'],
  agency: 'Ohio Department of Health',
  templateName: 'ORC 3701.88 340B Covered Entity Reporting Template',
  noun: 'workbook',
  nounPlural: 'workbooks',
  periodWord: 'calendar year',
  asWord: 'stored',
  publisher: "Ohio Department of Health's website",
  shownSchedules: [],
  withheldSchedules: [],
  sections: [
    {
      id: 'in-house',
      heading: 'Drugs dispensed in house',
      about: 'Drugs the covered entity dispensed through its own pharmacies.',
      columns: [...OH_PAYERS, OH_TOTAL],
      tables: [
        ohTable('in_house_acquisition_cost', 'Acquisition cost', 'usd'),
        ohTable('in_house_payments_received', 'Payments received', 'usd'),
        ohTable('in_house_rx_all', 'All prescriptions', 'count'),
        ohTable('in_house_rx_340b', '340B prescriptions', 'count'),
        ohTable('in_house_rx_pct', 'Percentage that were 340B', 'percent'),
      ],
    },
    {
      id: 'contract',
      heading: 'Drugs dispensed through contract pharmacies',
      about: 'Drugs contract pharmacies dispensed on behalf of the covered entity.',
      columns: [...OH_PAYERS, OH_INDETERMINATE, OH_TOTAL],
      tables: [
        ohTable('contract_acquisition_cost', 'Acquisition cost', 'usd'),
        ohTable('contract_payments_received', 'Payments received', 'usd'),
        ohTable('contract_rx_all', 'All prescriptions', 'count'),
        ohTable('contract_rx_340b', '340B prescriptions', 'count'),
        ohTable('contract_rx_pct', 'Percentage that were 340B', 'percent'),
      ],
    },
    {
      id: 'administered',
      heading: 'Drugs administered',
      about: 'Drugs the covered entity administered, for example by infusion or injection.',
      columns: [...OH_PAYERS, OH_TOTAL],
      tables: [
        ohTable('administered_acquisition_cost', 'Acquisition cost', 'usd'),
        ohTable('administered_payments_actual', 'Actual payments', 'usd'),
        ohTable('administered_payments_estimated', 'Estimated payments', 'usd'),
        ohTable('administered_payments_total', 'Total payments', 'usd'),
        ohTable('administered_rx_all', 'All prescriptions', 'count'),
        ohTable('administered_rx_340b', '340B prescriptions', 'count'),
        ohTable('administered_rx_pct', 'Percentage that were 340B', 'percent'),
      ],
    },
  ],
  costs: {
    schedule: 'costs',
    rows: [
      { line: 'contract_pharmacies', label: 'Contract pharmacies' },
      { line: 'third_party_administrators', label: 'Third-party administrators' },
      { line: 'consultants', label: 'Consultants' },
      { line: 'software_it', label: 'Software and IT' },
      { line: 'other_external', label: 'Other outside costs' },
      { line: 'staffing', label: 'Staffing' },
      { line: 'internal_it', label: 'Internal IT' },
      { line: 'other_internal', label: 'Other internal costs' },
    ],
  },
  pharmacies: { schedule: 'contract_pharmacies', line: 'count', notesSchedule: 'contract_pharmacy_notes', notesLine: 'indeterminate_explanation' },
  uses: {
    schedule: 'uses',
    programs: ['program_1', 'program_2', 'program_3', 'program_4', 'program_5'],
    equipment: ['equipment_1', 'equipment_2', 'equipment_3', 'equipment_4', 'equipment_5'],
    other: 'other_uses',
    narrative: 'narrative',
    alternativeNarrative: 'alternative_narrative',
  },
  otherCells: 'other_cells',
  identity: { schedule: 'identity', period: 'reporting_period', id: 'hrsa_id', prefix: 'id_prefix', number: 'id_number' },
  kinds: OH_KINDS,
  cellsFolder: 'sources/oh/2025/cells',
  titleSuffix: (year) => `340B report, calendar year ${year}`,
};

export const FORMS: Readonly<Record<string, AnyFormSpec>> = { [RI.id]: RI, [VT.id]: VT, [MN.id]: MN, [ID.id]: ID, [ME.id]: ME, [OH.id]: OH };

/** Any form the site knows; an unknown id stops the build. */
export function anyFormSpec(id: string): AnyFormSpec {
  const spec = FORMS[id];
  if (!spec) throw new Error(`Unknown form "${id}": this site does not know how to read it`);
  return spec;
}

/** A form on which entities file their own figures (the three measures exist). */
export function formSpec(id: string): FormSpec {
  const spec = anyFormSpec(id);
  if (spec.layout === 'state-report' || spec.layout === 'state-totals' || spec.layout === 'state-drug-lists' || spec.layout === 'workbook') throw new Error(`The form "${id}" is a state's report about entities, not a filing`);
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

/** A form on which a state prints statewide figures and lists of drugs. */
export function drugListsFormSpec(id: string): DrugListsFormSpec {
  const spec = anyFormSpec(id);
  if (spec.layout !== 'state-drug-lists') throw new Error(`The form "${id}" is not a state's report of statewide figures and lists of drugs`);
  return spec;
}

/** A form that is an Excel workbook for each filer. */
export function workbookFormSpec(id: string): WorkbookFormSpec {
  const spec = anyFormSpec(id);
  if (spec.layout !== 'workbook') throw new Error(`The form "${id}" is not an Excel workbook for each filer`);
  return spec;
}

/** Every schedule a workbook's rows may be on: the sections' tables, the costs, the pharmacies, the uses, the identity cells and the cells outside the template. */
export function workbookSchedules(spec: WorkbookFormSpec): Set<string> {
  return new Set([
    ...spec.sections.flatMap((s) => s.tables.map((t) => t.schedule)),
    spec.costs.schedule,
    spec.pharmacies.schedule,
    spec.pharmacies.notesSchedule,
    spec.uses.schedule,
    spec.identity.schedule,
    spec.otherCells,
  ]);
}
