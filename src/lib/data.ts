import { parseCsv } from './csv';
import { anyFormSpec, entityType as toEntityType, formSpec, recordKind as toRecordKind, reportFormSpec, type DrugScheduleSpec, type EntityType, type FormSpec, type RecordKind, type ReportFormSpec, type ReportGroup, type RowKey } from './forms';
import { amountScale, claimsSortValue, largestBy, type AmountScale, type ClaimsStatus } from './drugs';
import { centsToDecimal, foldName, groupDrugRows, toCsv, type DrugGroup } from './drug-groups';
import { fdaNameFor, fdaTitle, getFdaNames, type FdaName, type FdaNames, type FdaSource } from './fda-names';
import { filedDrugShown } from './filed-drug-display';
import { groupDigits, parseCents, parseMicro, ratioMicro, sumCents, type Cents, type Micro } from './money';

export type { EntityType } from './forms';

/**
 * Loads the dataset copied into src/data/dataset by scripts/sync-data.mjs.
 *
 * Small numbers: a form's drug schedule (Rhode Island's Schedule G) is loaded into its own list, `drugRows`,
 * never into `lineItems`, so no other page can show a claim count by mistake. In `drugRows` a count of 1 to 5
 * is never held: the dataset leaves it out (METHODS section 9) and a row that still carries one stops the
 * build. Schedule I signer details are not in the data. For Rhode Island's form Schedules A, D and E are
 * loaded as rows (and G as drug rows); for
 * Vermont's form every printed row of the page is loaded (it has no claim counts); for Minnesota's
 * form the two tables and the page notes. Which rows a filing's form allows is set in forms.ts; a row
 * outside the list stops the build. A record's kind (filing, state report row, state report totals)
 * decides which view reads it: buildViews reads filings, buildReportViews reads the state's report.
 */

/** The two kinds of filer whose own filings carry the three measures. */
export type FilerType = 'health_center' | 'hospital';

export interface Entity {
  entityId: string;
  state: string;
  entityType: EntityType;
  nameAsFiled: string;
  opaisIdsAsFiled: string;
  /** Minnesota: the entity's type as the report prints it; blank otherwise. */
  entityTypeAsFiled: string;
  /** Minnesota: the entity's city as the report prints it; blank otherwise. */
  cityAsFiled: string;
  slug: string;
  path: string;
}

export interface Filing {
  filingId: string;
  entityId: string;
  state: string;
  reportingYear: string;
  formRevision: string;
  reportingBasisAsFiled: string;
  recertificationDateAsFiled: string;
  sourceUrl: string;
  retrievedAt: string;
  pdfSha256: string;
  pageCount: number;
  scanned: boolean;
  /** The form the filing was made on; it decides how its rows are read (see forms.ts). */
  form: string;
  /** Status the page prints ('draft' for Vermont); blank when the form prints none. */
  statusAsFiled: string;
  statusNoticeAsFiled: string;
  periodAsFiled: string;
  submissionAsFiled: string;
  /** The state web page that lists the document, when there is one. */
  coverPageUrl: string;
  /** An entity's own filing, a row a state printed about an entity, or a state's totals (see forms.ts). */
  recordKind: RecordKind;
}

export type Unit = 'usd' | 'percent' | 'count' | 'none';

export interface LineItem {
  filingId: string;
  /** Rhode Island: the schedule letter. Vermont: a key the dataset assigned (the page prints none). */
  schedule: string;
  line: string;
  rowKind: 'detail' | 'below_threshold' | 'total';
  labelAsFiled: string;
  nameAsFiled: string;
  normalizedVendor: string;
  category: string;
  descriptionAsFiled: string;
  amountAsFiled: string;
  /** Whole cents for a dollar amount; null for a percentage, a cell with no figure (N/A, N/R) or text. */
  amountCents: Cents | null;
  unit: Unit;
  page: number;
  note: string;
}

/** One row of a drug schedule. A claim count that is left out has `claims` null and says so in `claimsStatus`. */
export interface DrugRow {
  filingId: string;
  schedule: string;
  line: string;
  rowKind: 'detail' | 'below_threshold' | 'total';
  /** The printed total's label, or the label of the "under $5,000" row; blank on a drug row. */
  labelAsFiled: string;
  /** The drug's name as filed; blank on 2 rows, where the NDC column holds the drug's description. */
  nameAsFiled: string;
  /** The NDC column as filed, punctuation kept. */
  ndcAsFiled: string;
  amountAsFiled: string;
  amountCents: Cents;
  /** The count as filed (digits and commas); blank when the count is left out. */
  claimsAsFiled: string;
  /** A count of 0 or 6 or more; null when the count is left out. Never 1 to 5. */
  claims: number | null;
  claimsStatus: ClaimsStatus;
  page: number;
  note: string;
}

export interface Measure {
  filingId: string;
  measure: string;
  formula: string;
  value: string;
}

export interface Discrepancy {
  filingId: string;
  rule: string;
  basis: 'form' | 'comparison';
  description: string;
  expected: string;
  filed: string;
  difference: string;
  unit: Unit;
  note: string;
}

export interface Attachment {
  filingId: string;
  firstPage: number;
  lastPage: number;
  kind: string;
  titleAsFiled: string;
  note: string;
  /** For a separate document the state lists beside the filing (Vermont's narrative); blank otherwise. */
  documentFile: string;
  documentUrl: string;
  documentCoverPageUrl: string;
  documentSha256: string;
  documentBytes: number | null;
}

export interface Dataset {
  version: string;
  commit: string;
  /** SHA-256 of each copied file, from SOURCE.json. */
  hashes: Record<string, string>;
  entities: Entity[];
  filings: Filing[];
  lineItems: LineItem[];
  /** Rows of each form's drug schedule (Rhode Island: Schedule G), apart from `lineItems`. */
  drugRows: DrugRow[];
  measures: Measure[];
  discrepancies: Discrepancy[];
  attachments: Attachment[];
  /** Every row in line_items.csv, all schedules. */
  rowCount: number;
  verificationCounts: Record<string, number>;
  /** Date of the latest retrieval, ISO `YYYY-MM-DD`. */
  dataDate: string;
  methodsMarkdown: string;
  dictionaryMarkdown: string;
  downloads: string[];
}

export interface RawDataset {
  /** File name (no folder) to text. */
  files: Record<string, string>;
}

function need(files: Record<string, string>, name: string): string {
  const text = files[name];
  if (text === undefined) throw new Error(`Dataset file missing: ${name}`);
  return text;
}

function slugFor(entityId: string, state: string): string {
  const prefix = `${state.toLowerCase()}-`;
  return entityId.startsWith(prefix) ? entityId.slice(prefix.length) : entityId;
}

function toUnit(text: string, what: string): Unit {
  if (text !== 'usd' && text !== 'percent' && text !== 'count' && text !== 'none') throw new Error(`${what}: unknown unit "${text}"`);
  return text;
}

function toPage(text: string, what: string): number {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${what}: bad page "${text}"`);
  return n;
}

/** Reads one row of a drug schedule. A row it cannot read stops the build, naming the filing and the line. */
function readDrugRow(r: Record<string, string>, spec: DrugScheduleSpec, pageCount: number): DrugRow {
  const filingId = r['filing_id']!;
  const where = `${filingId} ${spec.scheduleName} line ${r['line']}`;
  const rowKind = r['row_kind'];
  if (rowKind !== 'detail' && rowKind !== 'below_threshold' && rowKind !== 'total') throw new Error(`${where}: unknown row kind "${rowKind}"`);
  if (r['unit'] !== 'usd') throw new Error(`${where}: the amount is not in dollars`);
  if (rowKind === 'below_threshold' && r['line'] !== spec.belowThresholdLine) throw new Error(`${where}: a below-threshold row on line "${r['line']}", expected "${spec.belowThresholdLine}"`);
  if (rowKind === 'total' && r['line'] !== spec.totalLine) throw new Error(`${where}: a total row on line "${r['line']}", expected "${spec.totalLine}"`);

  const amountAsFiled = r['amount_as_filed']!;
  let amountCents: Cents | null;
  try {
    amountCents = parseCents(amountAsFiled);
  } catch {
    throw new Error(`${where}: the amount "${amountAsFiled}" cannot be read`);
  }
  if (amountCents === null) throw new Error(`${where}: the amount is blank or not a figure`);
  if (amountCents < 0) throw new Error(`${where}: a negative amount "${amountAsFiled}"; the page has no way to draw it`);
  if (r['amount'] !== undefined && r['amount'] !== '' && parseCents(r['amount']!) !== amountCents) throw new Error(`${where}: "amount" differs from "amount_as_filed"`);

  const page = toPage(r['page']!, where);
  if (page > pageCount) throw new Error(`${where}: page ${page} is beyond the ${pageCount} pages of the filing`);

  // The claims cell. The dataset leaves out a count of 1 to 5 and marks the row; a count that is still there stops the build.
  const withheld = r['claims_withheld']!;
  const claimsAsFiled = r['claims_as_filed']!;
  const claimsText = r['claims']!;
  let claimsStatus: ClaimsStatus;
  let claims: number | null;
  if (withheld === 'fewer_than_6' || withheld === 'beside_small') {
    if (rowKind !== 'detail') throw new Error(`${where}: a ${rowKind} row cannot have its claim count left out`);
    if (claimsAsFiled !== '' || claimsText !== '') throw new Error(`${where}: the claim count is marked ${withheld} but a number is there`);
    claimsStatus = withheld;
    claims = null;
  } else if (withheld === '') {
    if (!/^\d{1,3}(,\d{3})*$|^\d+$/.test(claimsAsFiled)) throw new Error(`${where}: the claim count "${claimsAsFiled}" cannot be read`);
    claims = Number(claimsAsFiled.replaceAll(',', ''));
    if (String(claims) !== claimsText) throw new Error(`${where}: "claims" differs from "claims_as_filed"`);
    if (claims >= 1 && claims <= 5) throw new Error(`${where}: carries a claim count of 1 to 5; the dataset should have left it out (METHODS section 9)`);
    claimsStatus = 'count';
  } else {
    throw new Error(`${where}: unknown claims_withheld "${withheld}"`);
  }

  return {
    filingId,
    schedule: r['schedule']!,
    line: r['line']!,
    rowKind,
    labelAsFiled: r['label_as_filed']!,
    nameAsFiled: r['name_as_filed']!,
    ndcAsFiled: r['ndc_as_filed']!,
    amountAsFiled,
    amountCents,
    claimsAsFiled,
    claims,
    claimsStatus,
    page,
    note: r['note']!,
  };
}

export function buildDataset(raw: RawDataset): Dataset {
  const files = raw.files;
  const source = JSON.parse(need(files, 'SOURCE.json')) as {
    dataset_version: string;
    dataset_commit: string;
    files: Record<string, string>;
  };

  const entities: Entity[] = parseCsv(need(files, 'entities.csv')).map((r) => {
    const entityType = toEntityType(r['entity_type']!);
    const state = r['state']!;
    const entityId = r['entity_id']!;
    const slug = slugFor(entityId, state);
    return {
      entityId,
      state,
      entityType,
      nameAsFiled: r['name_as_filed']!,
      opaisIdsAsFiled: r['opais_ids_as_filed']!,
      entityTypeAsFiled: r['entity_type_as_filed']!,
      cityAsFiled: r['city_as_filed']!,
      slug,
      path: `/scorecard/${state.toLowerCase()}/${slug}/`,
    };
  });

  const filings: Filing[] = parseCsv(need(files, 'filings.csv')).map((r) => ({
    filingId: r['filing_id']!,
    entityId: r['entity_id']!,
    state: r['state']!,
    reportingYear: r['reporting_year']!,
    formRevision: r['form_revision']!,
    reportingBasisAsFiled: r['reporting_basis_as_filed']!,
    recertificationDateAsFiled: r['recertification_date_as_filed']!,
    sourceUrl: r['source_url']!,
    retrievedAt: r['retrieved_at']!,
    pdfSha256: r['pdf_sha256']!,
    pageCount: toPage(r['page_count']!, r['filing_id']!),
    scanned: r['scanned'] === 'true',
    form: anyFormSpec(r['form']!).id,
    statusAsFiled: r['status_as_filed']!,
    statusNoticeAsFiled: r['status_notice_as_filed']!,
    periodAsFiled: r['period_as_filed']!,
    submissionAsFiled: r['submission_as_filed']!,
    coverPageUrl: r['cover_page_url']!,
    recordKind: toRecordKind(r['record_kind']!),
  }));
  const specByFiling = new Map(filings.map((f) => [f.filingId, anyFormSpec(f.form)]));
  const entityById = new Map(entities.map((e) => [e.entityId, e]));
  for (const f of filings) {
    const spec = anyFormSpec(f.form);
    const entity = entityById.get(f.entityId);
    if (!entity) throw new Error(`Filing without entity: ${f.filingId}`);
    if (!spec.recordKinds.includes(f.recordKind)) throw new Error(`${f.filingId}: the form ${spec.id} does not allow a record of kind "${f.recordKind}"`);
    if (f.recordKind === 'state_report_totals' && entity.entityType !== 'state_total') throw new Error(`${f.filingId}: the totals record belongs to an entity of type "${entity.entityType}", expected state_total`);
    if (f.recordKind !== 'state_report_totals' && entity.entityType === 'state_total') throw new Error(`${f.filingId}: only a totals record may belong to the state_total entity`);
    if (f.recordKind === 'state_report_row') {
      const report = reportFormSpec(f.form);
      if (entity.entityTypeAsFiled === '' || entity.cityAsFiled === '') throw new Error(`${f.filingId}: the printed type or city is blank`);
      if (report.typeFor(entity.entityTypeAsFiled) !== entity.entityType) throw new Error(`${f.filingId}: the entity type "${entity.entityType}" does not follow the printed type "${entity.entityTypeAsFiled}"`);
    }
  }
  const measureOwners = parseCsv(need(files, 'measures.csv')).map((r) => r['filing_id']!);
  const kindById = new Map(filings.map((f) => [f.filingId, f.recordKind]));
  for (const id of measureOwners) {
    if (kindById.get(id) !== 'filing') throw new Error(`${id}: a measure belongs to a record that is not an entity's own filing`);
  }

  const allRows = parseCsv(need(files, 'line_items.csv'));
  const verificationCounts: Record<string, number> = {};
  for (const r of allRows) verificationCounts[r['verification']!] = (verificationCounts[r['verification']!] ?? 0) + 1;

  const lineItems: LineItem[] = [];
  const drugRows: DrugRow[] = [];
  const pageCountOf = new Map(filings.map((f) => [f.filingId, f.pageCount]));
  for (const r of allRows) {
    const schedule = r['schedule']!;
    const spec = specByFiling.get(r['filing_id']!);
    if (!spec) throw new Error(`Row without a filing: ${r['filing_id']}`);
    const drugSchedule = 'drugSchedule' in spec ? spec.drugSchedule : undefined;
    if (drugSchedule && schedule === drugSchedule.schedule) {
      drugRows.push(readDrugRow(r, drugSchedule, pageCountOf.get(r['filing_id']!)!));
      continue;
    }
    if (!spec.shownSchedules.includes(schedule)) {
      if (spec.withheldSchedules.includes(schedule)) continue;
      throw new Error(`${r['filing_id']}: schedule "${schedule}" is not on the form ${spec.id}`);
    }
    const unit = toUnit(r['unit']!, `${r['filing_id']} schedule ${schedule}`);
    const rowKind = r['row_kind'];
    if (rowKind !== 'detail' && rowKind !== 'below_threshold' && rowKind !== 'total') throw new Error(`Unknown row kind: ${rowKind}`);
    const amountAsFiled = r['amount_as_filed']!;
    lineItems.push({
      filingId: r['filing_id']!,
      schedule: schedule as LineItem['schedule'],
      line: r['line']!,
      rowKind,
      labelAsFiled: r['label_as_filed']!,
      nameAsFiled: r['name_as_filed']!,
      normalizedVendor: r['normalized_vendor']!,
      category: r['category']!,
      descriptionAsFiled: r['description_as_filed']!,
      amountAsFiled,
      amountCents: unit === 'usd' ? parseCents(amountAsFiled) : null,
      unit,
      page: toPage(r['page']!, `${r['filing_id']} schedule ${schedule}`),
      note: r['note']!,
    });
  }

  const measures: Measure[] = parseCsv(need(files, 'measures.csv')).map((r) => ({
    filingId: r['filing_id']!,
    measure: r['measure']!,
    formula: r['formula']!,
    value: r['value']!,
  }));

  const discrepancies: Discrepancy[] = parseCsv(need(files, 'discrepancies.csv')).map((r) => {
    const basis = r['basis'];
    if (basis !== 'form' && basis !== 'comparison') throw new Error(`Unknown basis: ${basis}`);
    const rule = r['rule']!;
    return {
      filingId: r['filing_id']!,
      rule,
      basis,
      description: r['description']!,
      expected: r['expected']!,
      filed: r['filed']!,
      difference: r['difference']!,
      unit: toUnit(r['unit']!, `${r['filing_id']} ${rule}`),
      note: r['note']!,
    };
  });

  const attachments: Attachment[] = parseCsv(need(files, 'attachments.csv')).map((r) => ({
    filingId: r['filing_id']!,
    firstPage: toPage(r['first_page']!, 'attachment'),
    lastPage: toPage(r['last_page']!, 'attachment'),
    kind: r['kind']!,
    titleAsFiled: r['title_as_filed']!,
    note: r['note']!,
    documentFile: r['document_file']!,
    documentUrl: r['document_url']!,
    documentCoverPageUrl: r['document_cover_page_url']!,
    documentSha256: r['document_sha256']!,
    documentBytes: r['document_bytes']! === '' ? null : Number(r['document_bytes']),
  }));

  const dates = filings.map((f) => dayOf(f.retrievedAt)).sort();

  const dataset: Dataset = {
    version: source.dataset_version,
    commit: source.dataset_commit,
    hashes: source.files,
    entities,
    filings,
    lineItems,
    drugRows,
    measures,
    discrepancies,
    attachments,
    rowCount: allRows.length,
    verificationCounts,
    dataDate: dates[dates.length - 1]!,
    methodsMarkdown: need(files, 'METHODS.md'),
    dictionaryMarkdown: need(files, 'DATA_DICTIONARY.md'),
    downloads: Object.keys(files).filter((n) => /\.(csv|json)$/.test(n) && n !== 'SOURCE.json').sort(),
  };
  return dataset;
}

// ---------------------------------------------------------------------------
// Loading from the copied files (Vite reads them at build time; nothing runs in the browser).

let cached: Dataset | undefined;

export function getDataset(): Dataset {
  if (cached) return cached;
  const modules = import.meta.glob(['../data/dataset/*.csv', '../data/dataset/*.json', '../data/dataset/*.md'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;
  const files: Record<string, string> = {};
  for (const [path, text] of Object.entries(modules)) files[path.slice(path.lastIndexOf('/') + 1)] = text;
  cached = buildDataset({ files });
  return cached;
}

// ---------------------------------------------------------------------------
// Views: the figures each page shows, computed from the rows (never typed).

export interface FilingView {
  entity: Entity;
  filing: Filing;
  /** The words and rows of this filing's form. */
  spec: FormSpec;
  /** The form's figure rows, in the order it prints them (Rhode Island: Schedule A lines 1 to 6). */
  printedRows: LineItem[];
  grossMarginCents: Cents;
  externalCostCents: Cents;
  /** Millionths; null when the margin is not above zero. */
  shareMicro: Micro | null;
  /** Page of the PDF where the lines used are printed (the first of them). */
  marginPage: number;
  externalPage: number;
  sharePage: number;
  /** What each linked figure's source is, in words (which rows, which page). */
  cite: { margin: string; external: string; share: string };
}

export interface GroupTotals {
  count: number;
  grossMarginCents: Cents;
  externalCostCents: Cents;
  shareMicro: Micro | null;
}

export const GROUP_ORDER: readonly FilerType[] = ['health_center', 'hospital'];
export const GROUP_LABEL: Record<FilerType, string> = { health_center: 'Health centers', hospital: 'Hospitals' };

/** "Hospital filing" or "Hospital report", by the word the filing's form uses. */
export function groupSingular(type: EntityType, spec: FormSpec): string {
  if (type === 'hospital') return `Hospital ${spec.noun}`;
  if (type === 'health_center') return 'Health center';
  throw new Error(`A ${type} has no filing of its own on this site`);
}

export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, 'en', { sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);
}

function measureValue(data: Dataset, filingId: string, measure: string): string {
  const m = data.measures.find((x) => x.filingId === filingId && x.measure === measure);
  if (!m) throw new Error(`Measure missing: ${filingId} ${measure}`);
  return m.value;
}

/** The rows of a filing that the form's figure rows name, in printed order. Anything else on that page stops the build. */
function figureRowsOf(data: Dataset, filing: Filing, spec: FormSpec): LineItem[] {
  const own = data.lineItems.filter((r) => r.filingId === filing.filingId);
  const figureSchedules = new Set(spec.figureRows.map((k) => k.schedule));
  const candidates = own.filter((r) => figureSchedules.has(r.schedule) && spec.figureKinds.includes(r.rowKind as 'detail' | 'total'));
  if (candidates.length !== spec.figureRows.length) {
    throw new Error(`${filing.filingId}: the form ${spec.id} has ${spec.figureRows.length} figure rows, the data has ${candidates.length}`);
  }
  return spec.figureRows.map((key) => {
    const found = candidates.filter((r) => r.schedule === key.schedule && r.line === key.line);
    if (found.length !== 1) throw new Error(`${filing.filingId}: expected one row ${key.schedule} ${key.line}, found ${found.length}`);
    const row = found[0]!;
    if (row.rowKind !== key.kind) throw new Error(`${filing.filingId}: row ${key.schedule} ${key.line} is a ${row.rowKind} row, expected ${key.kind}`);
    if (key.label !== undefined && row.labelAsFiled !== key.label) {
      throw new Error(`${filing.filingId}: row ${key.schedule} ${key.line} is labelled "${row.labelAsFiled}", expected "${key.label}"`);
    }
    return row;
  });
}

export function buildViews(data: Dataset): FilingView[] {
  const entityById = new Map(data.entities.map((e) => [e.entityId, e]));
  return data.filings.filter((f) => f.recordKind === 'filing').map((filing) => {
    const entity = entityById.get(filing.entityId);
    if (!entity) throw new Error(`Filing without entity: ${filing.filingId}`);
    const spec = formSpec(filing.form);
    const printedRows = figureRowsOf(data, filing, spec);
    const indexOf = (key: RowKey): number => {
      const i = spec.figureRows.findIndex((k) => k.schedule === key.schedule && k.line === key.line);
      if (i < 0) throw new Error(`${spec.id}: ${key.schedule} ${key.line} is not one of the form's figure rows`);
      return i;
    };
    const rowFor = (key: RowKey): LineItem => printedRows[indexOf(key)]!;
    const cents = (key: RowKey): Cents => {
      const row = rowFor(key);
      const v = row.amountCents;
      if (v === null) throw new Error(`${filing.filingId}: ${row.labelAsFiled} (${key.schedule} ${key.line}) has no amount`);
      return v;
    };

    const grossMarginCents = cents(spec.margin.plus) - cents(spec.margin.minus);
    const externalCostCents = sumCents(spec.external.map(cents));
    const shareMicro = ratioMicro(externalCostCents, grossMarginCents);

    // The measures file must agree with the rows it is calculated from.
    const filedMargin = parseCents(measureValue(data, filing.filingId, 'gross_margin'));
    const filedExternal = parseCents(measureValue(data, filing.filingId, 'external_cost'));
    const filedShare = parseMicro(measureValue(data, filing.filingId, 'external_share_of_margin'));
    if (filedMargin !== grossMarginCents) throw new Error(`${filing.filingId}: gross margin differs from measures.csv`);
    if (filedExternal !== externalCostCents) throw new Error(`${filing.filingId}: external cost differs from measures.csv`);
    if (filedShare !== shareMicro) throw new Error(`${filing.filingId}: share differs from measures.csv`);

    const marginKeys = [spec.margin.plus, spec.margin.minus];
    const shareKeys = [...marginKeys, ...spec.external].sort((a, b) => indexOf(a) - indexOf(b));
    const firstPage = (keys: readonly RowKey[]): number => Math.min(...keys.map((k) => rowFor(k).page));
    const marginPage = firstPage(marginKeys);
    const externalPage = firstPage(spec.external);
    const sharePage = firstPage(shareKeys);
    const where = (keys: readonly RowKey[], page: number): string => `${spec.describe(keys)}, page ${page} of the ${spec.noun} PDF`;

    return {
      entity,
      filing,
      spec,
      printedRows,
      grossMarginCents,
      externalCostCents,
      shareMicro,
      marginPage,
      externalPage,
      sharePage,
      cite: {
        margin: where(marginKeys, marginPage),
        external: where(spec.external, externalPage),
        share: where(shareKeys, sharePage),
      },
    };
  });
}

export function viewsInGroup(views: readonly FilingView[], group: FilerType): FilingView[] {
  return views.filter((v) => v.entity.entityType === group).sort((a, b) => compareNames(a.entity.nameAsFiled, b.entity.nameAsFiled));
}

export function groupTotals(views: readonly FilingView[]): GroupTotals {
  const grossMarginCents = sumCents(views.map((v) => v.grossMarginCents));
  const externalCostCents = sumCents(views.map((v) => v.externalCostCents));
  return { count: views.length, grossMarginCents, externalCostCents, shareMicro: ratioMicro(externalCostCents, grossMarginCents) };
}

export function pdfHref(filing: Filing, page: number): string {
  return `${filing.sourceUrl}#page=${page}`;
}

/** `2026-11-11` -> `11 November 2026`. */
/**
 * The calendar day of a date or a timestamp, as `YYYY-MM-DD`. The dataset stamps each retrieval in UTC,
 * and an evening retrieval in the United States falls on the next day in UTC. The site shows the day on
 * the US East Coast, where the work is done, so a page never shows a day that has not started there.
 */
export function dayOf(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(iso)) return iso.slice(0, 10);
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) throw new Error(`Not a timestamp: ${iso}`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (type: string): string => parts.find((x) => x.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function formatDate(iso: string): string {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dayOf(iso));
  if (!match) throw new Error(`Not a date: ${iso}`);
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

/** The METHODS.md paragraph on why two filers' shares are not directly comparable (markdown, as written there). */
export function comparabilityParagraph(data: Dataset): string {
  const paragraph = data.methodsMarkdown.split(/\n\s*\n/).find((p) => p.startsWith("**Why two filers' shares are not directly comparable.**"));
  if (!paragraph) throw new Error('METHODS.md: comparability paragraph not found');
  return paragraph.trim();
}

export const CATEGORY_LABEL: Record<string, string> = {
  third_party_administrator: 'Third-party administrator',
  referral_capture: 'Referral capture',
  consulting_audit: 'Consulting and audit',
  other: 'Other',
};

export function findDifferences(data: Dataset, filingId?: string): Discrepancy[] {
  return data.discrepancies.filter((d) => filingId === undefined || d.filingId === filingId);
}

/** The one value every item shares. Pages that quote a notice must not hide a difference between filings, so a mix stops the build. */
export function sharedValue(values: readonly string[], what: string): string {
  const distinct = [...new Set(values)];
  if (distinct.length !== 1) throw new Error(`${what}: expected one value across the filings, found ${distinct.length}`);
  return distinct[0]!;
}

/** First and last retrieval date (ISO `YYYY-MM-DD`) among some filings. */
export function retrievalSpan(views: readonly FilingView[]): { first: string; last: string } {
  const dates = views.map((v) => dayOf(v.filing.retrievedAt)).sort();
  return { first: dates[0]!, last: dates[dates.length - 1]! };
}

/** A measure's formula as the dataset words it (measures.csv). */
export function measureFormula(data: Dataset, filingId: string, measure: string): string {
  const m = data.measures.find((x) => x.filingId === filingId && x.measure === measure);
  if (!m) throw new Error(`Measure missing: ${filingId} ${measure}`);
  return m.formula;
}

/** The "Printed note: " text kept on a row, without the prefix; blank when the row has none. */
export function printedNote(row: Pick<LineItem, 'filingId' | 'schedule' | 'line' | 'note'>): string {
  if (row.note === '') return '';
  const prefix = 'Printed note: ';
  if (!row.note.startsWith(prefix)) throw new Error(`${row.filingId}: note on ${row.schedule} ${row.line} does not start with "${prefix}"`);
  return row.note.slice(prefix.length);
}

/** "14 filings" or "13 reports": a state's count, in the word its form uses. */
export function countPhrase(views: readonly FilingView[]): string {
  const spec = views[0]?.spec;
  if (!spec || views.some((v) => v.spec.id !== spec.id)) throw new Error('A count is given for filings of one form only');
  return `${views.length} ${views.length === 1 ? spec.noun : spec.nounPlural}`;
}

/** A difference's figure with its unit: dollars as they are, a percentage with its sign, a gap in percentage points. */
export function formatFigure(text: string | null, unit: Unit, isDifference = false): string {
  const grouped = groupDigits(text);
  if (unit === 'percent') return isDifference ? `${grouped} percentage points` : `${grouped}%`;
  return grouped;
}

/** Paragraphs of METHODS.md that carry on from the comparability paragraph for another state ("The same holds for ..."). */
export function comparabilityFollowOns(data: Dataset): string[] {
  return data.methodsMarkdown
    .split(/\n\s*\n/)
    .filter((p) => p.startsWith('The same holds for '))
    .map((p) => p.trim());
}

// ---------------------------------------------------------------------------
// A state's own report about the entities it names (Minnesota): one row per entity, one record of totals.
// There is no filing of the entity's own, no cost rows and no measure. Nothing here branches on the state.

/** The two figures a state prints on an entity's row. */
export interface ReportEntityRow {
  entity: Entity;
  filing: Filing;
  /** Name, type and city exactly as the report prints them. */
  name: string;
  typeAsPrinted: string;
  cityAsPrinted: string;
  net: LineItem;
  pct: LineItem;
  /** Whole cents; null for a cell that prints no figure (never read as zero). */
  netCents: Cents | null;
  /** The printed percentage as a plain number string ("12.0"), for sorting; blank when the cell prints no figure. */
  pctValue: string;
  /** Says which column and page a link leads to. */
  cite: { net: string; pct: string };
}

export interface ReportTotalRow {
  group: ReportGroup;
  net: LineItem;
  pct: LineItem;
  netCents: Cents | null;
  cite: { net: string; pct: string };
}

export interface ReportNotes {
  aboveEntityTable: LineItem;
  entityTableTitle: LineItem;
  entityTableSource: LineItem;
  aboveTotalsTable: LineItem;
  totalsTableTitle: LineItem;
  totalsTableSource: LineItem;
}

export interface ReportDifference {
  difference: Discrepancy;
  /** The entity a difference belongs to, as the report prints its name; null for the statewide record. */
  owner: string | null;
}

export interface ReportView {
  state: string;
  spec: ReportFormSpec;
  /** The statewide record's filing: the report PDF, its hash and the date it was retrieved. */
  filing: Filing;
  /** Entity rows, A to Z by name as printed. */
  entities: ReportEntityRow[];
  /** The six rows of the totals table, in the order the report prints them. */
  totals: ReportTotalRow[];
  notes: ReportNotes;
  /** The statewide differences first, then each entity's, A to Z. */
  differences: ReportDifference[];
  /** The entity rows' net revenue added together, in cents. */
  entitySumCents: Cents;
}

function oneRow(rows: readonly LineItem[], schedule: string, line: string, who: string): LineItem {
  const found = rows.filter((r) => r.schedule === schedule && r.line === line);
  if (found.length !== 1) throw new Error(`${who}: expected one row ${schedule} ${line}, found ${found.length}`);
  return found[0]!;
}

export function buildReportViews(data: Dataset): ReportView[] {
  const entityById = new Map(data.entities.map((e) => [e.entityId, e]));
  const reportFilings = data.filings.filter((f) => f.recordKind !== 'filing');
  const states = [...new Set(reportFilings.map((f) => f.state))].sort();
  return states.map((state) => {
    const mine = reportFilings.filter((f) => f.state === state);
    const spec = reportFormSpec(sharedValue(mine.map((f) => f.form), `${state}: form`));
    const totalsFilings = mine.filter((f) => f.recordKind === 'state_report_totals');
    if (totalsFilings.length !== 1) throw new Error(`${state}: expected one totals record, found ${totalsFilings.length}`);
    const statewide = totalsFilings[0]!;
    const pdfPage = (filing: Filing, page: number): number => {
      if (page > filing.pageCount) throw new Error(`${filing.filingId}: page ${page} is beyond the ${filing.pageCount} pages of the report`);
      return page;
    };

    const entities: ReportEntityRow[] = mine
      .filter((f) => f.recordKind === 'state_report_row')
      .map((filing) => {
        const entity = entityById.get(filing.entityId)!;
        const rows = data.lineItems.filter((r) => r.filingId === filing.filingId);
        const t = spec.entityTable;
        if (rows.length !== 2) throw new Error(`${filing.filingId}: expected two figure rows, found ${rows.length}`);
        const net = oneRow(rows, t.schedule, t.netLine, filing.filingId);
        const pct = oneRow(rows, t.schedule, t.pctLine, filing.filingId);
        if (net.unit !== 'usd' || pct.unit !== 'percent') throw new Error(`${filing.filingId}: a figure has the wrong unit`);
        if (net.descriptionAsFiled !== t.netHeading || pct.descriptionAsFiled !== t.pctHeading) throw new Error(`${filing.filingId}: a column heading is not the one the report prints`);
        if (net.labelAsFiled !== entity.nameAsFiled || pct.labelAsFiled !== entity.nameAsFiled) throw new Error(`${filing.filingId}: the row's label is not the entity's name`);
        if (net.page !== pct.page) throw new Error(`${filing.filingId}: the two figures are on different pages`);
        const page = pdfPage(filing, net.page);
        const pctText = pct.amountAsFiled.trim().replace(/%$/, '');
        return {
          entity,
          filing,
          name: entity.nameAsFiled,
          typeAsPrinted: entity.entityTypeAsFiled,
          cityAsPrinted: entity.cityAsFiled,
          net,
          pct,
          netCents: net.amountCents,
          pctValue: /^\d+(?:\.\d+)?$/.test(pctText) ? pctText : '',
          cite: {
            net: `${t.netHeading} for ${entity.nameAsFiled}, page ${page} of the report PDF`,
            pct: `${t.pctHeading} for ${entity.nameAsFiled}, page ${page} of the report PDF`,
          },
        };
      })
      .sort((a, b) => compareNames(a.name, b.name));

    const statewideRows = data.lineItems.filter((r) => r.filingId === statewide.filingId);
    const tt = spec.totalsTable;
    const totals: ReportTotalRow[] = tt.groups.map((group) => {
      const net = oneRow(statewideRows, tt.schedule, `${group.id}_${tt.netSuffix}`, statewide.filingId);
      const pct = oneRow(statewideRows, tt.schedule, `${group.id}_${tt.pctSuffix}`, statewide.filingId);
      for (const r of [net, pct]) {
        if (r.rowKind !== group.kind) throw new Error(`${statewide.filingId}: ${r.line} is a ${r.rowKind} row, expected ${group.kind}`);
        if (r.labelAsFiled !== group.label) throw new Error(`${statewide.filingId}: ${r.line} is labelled "${r.labelAsFiled}", expected "${group.label}"`);
      }
      if (net.unit !== 'usd' || pct.unit !== 'percent') throw new Error(`${statewide.filingId}: ${group.id} has a figure with the wrong unit`);
      if (net.descriptionAsFiled !== tt.netHeading || pct.descriptionAsFiled !== tt.pctHeading) throw new Error(`${statewide.filingId}: ${group.id} has a column heading the report does not print`);
      if (net.page !== pct.page) throw new Error(`${statewide.filingId}: ${group.id} is on two pages`);
      const page = pdfPage(statewide, net.page);
      return {
        group,
        net,
        pct,
        netCents: net.amountCents,
        cite: { net: `${group.label}, ${tt.netHeading}, page ${page} of the report PDF`, pct: `${group.label}, ${tt.pctHeading}, page ${page} of the report PDF` },
      };
    });
    if (statewideRows.length !== tt.groups.length * 2 + 6) throw new Error(`${statewide.filingId}: expected ${tt.groups.length * 2 + 6} rows, found ${statewideRows.length}`);

    const n = spec.notes;
    const note = (line: string): LineItem => oneRow(statewideRows, n.schedule, line, statewide.filingId);
    const notes: ReportNotes = {
      aboveEntityTable: note(n.aboveEntityTable),
      entityTableTitle: note(n.entityTableTitle),
      entityTableSource: note(n.entityTableSource),
      aboveTotalsTable: note(n.aboveTotalsTable),
      totalsTableTitle: note(n.totalsTableTitle),
      totalsTableSource: note(n.totalsTableSource),
    };
    for (const r of Object.values(notes)) pdfPage(statewide, r.page);

    // The sums the dataset lists as differences must be the ones this site's own rows give.
    const nets = entities.map((e) => e.netCents);
    const entitySumCents = sumCents(nets.map((c) => c ?? 0));
    const own = data.discrepancies.filter((d) => d.filingId === statewide.filingId);
    const rule = (name: string): Discrepancy | undefined => own.find((d) => d.rule === name);
    const rowsRule = rule('table_6_1.rows=stated_entities');
    if (rowsRule && Number(rowsRule.expected) !== entities.length) throw new Error(`${statewide.filingId}: the listed row count differs from the ${entities.length} rows`);
    const sumRule = rule('table_6_1.sum=table_6_2.top_unadjusted');
    if (sumRule && nets.every((c) => c !== null)) {
      const top = totals.find((t) => t.group.id === 'top_unadjusted')!;
      if (parseCents(sumRule.expected ?? '') !== entitySumCents) throw new Error(`${statewide.filingId}: the listed sum differs from the rows added together`);
      if (parseCents(sumRule.filed ?? '') !== top.netCents) throw new Error(`${statewide.filingId}: the listed printed figure differs from Table 6.2`);
    }

    const ownerOf = (filingId: string): string | null => {
      const filing = data.filings.find((f) => f.filingId === filingId);
      if (!filing) throw new Error(`Difference without a record: ${filingId}`);
      return filing.recordKind === 'state_report_totals' ? null : entityById.get(filing.entityId)!.nameAsFiled;
    };
    const ids = new Set(mine.map((f) => f.filingId));
    const differences: ReportDifference[] = data.discrepancies
      .filter((d) => ids.has(d.filingId))
      .map((difference) => ({ difference, owner: ownerOf(difference.filingId) }))
      .sort((a, b) => (a.owner === null ? 0 : 1) - (b.owner === null ? 0 : 1) || (a.owner !== null && b.owner !== null ? compareNames(a.owner, b.owner) : 0));

    return { state, spec, filing: statewide, entities, totals, notes, differences, entitySumCents };
  });
}

/** The report view of one state; a state without one stops the build. */
export function reportViewFor(data: Dataset, state: string): ReportView {
  const found = buildReportViews(data).find((v) => v.state === state);
  if (!found) throw new Error(`${state}: no state report in the dataset`);
  return found;
}

// ---------------------------------------------------------------------------
// The drug pages: one per filing whose form has a drug schedule and at least one row on it.

export interface DrugView {
  entity: Entity;
  filing: Filing;
  spec: FormSpec;
  drug: DrugScheduleSpec;
  /** The drugs, in the order filed. */
  rows: DrugRow[];
  /** The row that adds up the drugs below the form's threshold; null when the filing prints none. */
  below: DrugRow | null;
  /** The printed total. */
  total: DrugRow;
  /** Rows whose count is shown as "fewer than 6". */
  fewerThan6: number;
  /** Rows whose count is marked "not shown". */
  notShown: number;
  /** The five largest amounts, largest first. */
  largest: DrugRow[];
  /** The largest amount on the page, in cents: the bars are drawn to it. */
  maxCents: Cents;
  /** Whole dollars or cents, as the filer printed them. */
  scale: AmountScale;
  /** The first and last PDF page the schedule is printed on. */
  firstPage: number;
  lastPage: number;
  path: string;
}

export const LARGEST_COUNT = 5;

export function buildDrugViews(data: Dataset): DrugView[] {
  const entityById = new Map(data.entities.map((e) => [e.entityId, e]));
  const views: DrugView[] = [];
  for (const filing of data.filings) {
    if (filing.recordKind !== 'filing') continue;
    const spec = formSpec(filing.form);
    const drug = spec.drugSchedule;
    if (!drug) continue;
    const own = data.drugRows.filter((r) => r.filingId === filing.filingId);
    if (own.length === 0) continue;
    const entity = entityById.get(filing.entityId);
    if (!entity) throw new Error(`Filing without entity: ${filing.filingId}`);
    const who = `${filing.filingId} ${drug.scheduleName}`;
    const rows = own.filter((r) => r.rowKind === 'detail');
    const belowRows = own.filter((r) => r.rowKind === 'below_threshold');
    const totalRows = own.filter((r) => r.rowKind === 'total');
    if (totalRows.length !== 1) throw new Error(`${who}: expected one printed total, found ${totalRows.length}`);
    if (belowRows.length > 1) throw new Error(`${who}: expected at most one below-threshold row, found ${belowRows.length}`);
    if (rows.length === 0) throw new Error(`${who}: no drug rows, only ${own.length} closing row(s)`);
    if (new Set(rows.map((r) => r.line)).size !== rows.length) throw new Error(`${who}: two drug rows share a line`);
    const total = totalRows[0]!;
    const below = belowRows[0] ?? null;
    const pages = own.map((r) => r.page);
    views.push({
      entity,
      filing,
      spec,
      drug,
      rows,
      below,
      total,
      fewerThan6: rows.filter((r) => r.claimsStatus === 'fewer_than_6').length,
      notShown: rows.filter((r) => r.claimsStatus === 'beside_small').length,
      largest: largestBy(rows, LARGEST_COUNT),
      maxCents: Math.max(...rows.map((r) => r.amountCents)),
      scale: amountScale(own.map((r) => r.amountAsFiled)),
      firstPage: Math.min(...pages),
      lastPage: Math.max(...pages),
      path: `${entity.path}drugs/`,
    });
    // Stops the build on a shown count of 1 to 5 (readDrugRow has already refused one).
    for (const r of own) claimsSortValue(r.claimsStatus, r.claims);
  }
  return views.sort((a, b) => compareNames(a.entity.nameAsFiled, b.entity.nameAsFiled));
}

/** The drug view of one filing, or null when its form has no drug schedule or the filing lists no drug. */
export function drugViewFor(data: Dataset, filingId: string): DrugView | null {
  return buildDrugViews(data).find((v) => v.filing.filingId === filingId) ?? null;
}

// ---------------------------------------------------------------------------
// Every filer's drug rows side by side: one page and one download per state, for its latest reporting year
// with drug rows. The grouping is in drug-groups.ts.

/** A drug on the page of all filers: the rows as filed, and the name the FDA's directory lists for the code, if any. */
export type StateDrugGroup = DrugGroup<DrugRow> & {
  /** The FDA's listing for the code; null for a code it does not list and for a row that is not grouped. */
  fda: FdaName | null;
  /** The name at the head of the drug: the FDA's when the code is listed, else the name filed most often, drawn the way the pages draw a filer's name. */
  shownName: string;
};

export interface StateDrugView {
  /** The state's two-letter code. */
  state: string;
  reportingYear: string;
  spec: FormSpec;
  drug: DrugScheduleSpec;
  /** The filings with drug rows, by filer name. */
  views: DrugView[];
  /** The drugs, in the page's first order: most filers first, then the name shown A to Z, then code. */
  groups: StateDrugGroup[];
  /** Where the FDA names come from, and how many codes it names. */
  fda: { source: FdaSource; named: number; byProduct: number; notListed: number; /** Named codes a later copy of the directory dropped: the name is kept. */ kept: number };
  rowCount: number;
  /** Groups whose rows share an 11-digit code. */
  codeCount: number;
  /** Of those, the codes on two or more filings. */
  sharedCount: number;
  /** Rows that stay on their own: the NDC cell is not one 11-digit code. */
  aloneCount: number;
  fewerThan6: number;
  notShown: number;
  /** The largest group amount, in cents: the bars are drawn to it. */
  maxCents: Cents;
  path: string;
  csvName: string;
  csvPath: string;
}

export function buildStateDrugViews(data: Dataset, names: FdaNames = getFdaNames()): StateDrugView[] {
  const all = buildDrugViews(data);
  const out: StateDrugView[] = [];
  for (const state of [...new Set(all.map((v) => v.entity.state))].sort()) {
    const ofState = all.filter((v) => v.entity.state === state);
    const reportingYear = ofState.map((v) => v.filing.reportingYear).sort().at(-1)!;
    const views = ofState.filter((v) => v.filing.reportingYear === reportingYear);
    const forms = new Set(views.map((v) => v.spec.id));
    if (forms.size !== 1) throw new Error(`${state} ${reportingYear}: drug rows on more than one form (${[...forms].join(', ')})`);
    if (views.some((v) => v.entity.slug === 'drugs')) throw new Error(`${state}: a filer's page would take the address of the page of all drug rows`);
    const first = views[0]!;
    const rows = views.flatMap((v) => v.rows);
    const groups: StateDrugGroup[] = groupDrugRows(rows, views.map((v) => v.filing.filingId))
      .map((g) => {
        const fda = g.key === null ? null : fdaNameFor(names, g.key);
        return { ...g, fda, shownName: fda ? fdaTitle(fda) : filedDrugShown(g.name) };
      })
      .sort(
        (a, b) =>
          b.filingIds.length - a.filingIds.length ||
          Number(a.shownName === '') - Number(b.shownName === '') ||
          foldName(a.shownName).localeCompare(foldName(b.shownName), 'en') ||
          (a.key ?? a.id).localeCompare(b.key ?? b.id, 'en'),
      );
    const coded = groups.filter((g) => g.key !== null);
    const named = coded.filter((g) => g.fda !== null);
    const code = state.toLowerCase();
    const csvName = `drug-rows-${code}-${reportingYear}.csv`;
    out.push({
      state,
      reportingYear,
      spec: first.spec,
      drug: first.drug,
      views,
      groups,
      fda: { source: names.source, named: named.length, byProduct: named.filter((g) => g.fda!.match === 'product').length, notListed: coded.length - named.length, kept: named.filter((g) => g.fda!.kept).length },
      rowCount: rows.length,
      codeCount: coded.length,
      sharedCount: coded.filter((g) => g.filingIds.length > 1).length,
      aloneCount: groups.length - coded.length,
      fewerThan6: rows.filter((r) => r.claimsStatus === 'fewer_than_6').length,
      notShown: rows.filter((r) => r.claimsStatus === 'beside_small').length,
      maxCents: Math.max(0, ...groups.map((g) => g.amountCents)),
      path: `/scorecard/${code}/drugs/`,
      csvName,
      csvPath: `/data/${csvName}`,
    });
  }
  return out;
}

export function stateDrugViewFor(data: Dataset, state: string): StateDrugView | null {
  return buildStateDrugViews(data).find((v) => v.state === state) ?? null;
}

export const DRUG_CSV_HEADER = [
  'state',
  'reporting_year',
  'filing_id',
  'entity_name_as_filed',
  'schedule',
  'line',
  'ndc_as_filed',
  'ndc_11',
  'group_name',
  'fda_proprietary_name',
  'fda_proprietary_name_suffix',
  'fda_nonproprietary_name',
  'fda_dosage_form',
  'fda_strength',
  'fda_labeler',
  'fda_match',
  'fda_listed_on',
  'name_as_filed',
  'amount_as_filed',
  'amount',
  'claims_as_filed',
  'claims',
  'claims_withheld',
  'page',
  'source_url',
] as const;

/**
 * The download: one line per drug row as filed, in the page's order (group by group). `ndc_11` and `group_name`
 * are the site's; the `fda_` fields are the FDA directory's listing for the code (blank when it lists none), with the day of the
 * copy of the directory that listed it;
 * every other field is the filing's. A count that is left out is blank in both claims fields
 * and named in `claims_withheld`, as in line_items.csv.
 */
export function stateDrugCsv(view: StateDrugView): string {
  const byFiling = new Map(view.views.map((v) => [v.filing.filingId, v]));
  const lines: string[][] = [];
  for (const group of view.groups) {
    for (const row of group.rows) {
      const filer = byFiling.get(row.filingId)!;
      claimsSortValue(row.claimsStatus, row.claims); // stops the build on a shown count of 1 to 5
      const shown = row.claimsStatus === 'count';
      lines.push([
        view.state,
        view.reportingYear,
        row.filingId,
        filer.entity.nameAsFiled,
        row.schedule,
        row.line,
        row.ndcAsFiled,
        group.key ?? '',
        group.name,
        group.fda?.proprietaryName ?? '',
        group.fda?.proprietaryNameSuffix ?? '',
        group.fda?.nonproprietaryName ?? '',
        group.fda?.dosageForm ?? '',
        group.fda?.strength ?? '',
        group.fda?.labeler ?? '',
        group.fda?.match ?? '',
        group.fda?.listedOn ?? '',
        row.nameAsFiled,
        row.amountAsFiled,
        centsToDecimal(row.amountCents),
        shown ? row.claimsAsFiled : '',
        shown ? String(row.claims) : '',
        shown ? '' : row.claimsStatus,
        String(row.page),
        pdfHref(filer.filing, row.page),
      ]);
    }
  }
  return toCsv(DRUG_CSV_HEADER, lines);
}
