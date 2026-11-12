// What a copy of the dataset must look like. Shared by sync-data.mjs and check-data.mjs.
// Anything else is refused: a new file, a missing column, an extra column or a form this site does not know.

/** The columns each CSV file must have, in order. */
export const CSV_HEADERS = {
  'attachments.csv': ['filing_id', 'first_page', 'last_page', 'kind', 'title_as_filed', 'note', 'document_file', 'document_url', 'document_cover_page_url', 'document_sha256', 'document_bytes'],
  'discrepancies.csv': ['filing_id', 'rule', 'basis', 'description', 'expected', 'filed', 'difference', 'unit', 'note'],
  'entities.csv': ['entity_id', 'state', 'entity_type', 'name_as_filed', 'opais_ids_as_filed', 'entity_type_as_filed', 'city_as_filed'],
  'filings.csv': ['filing_id', 'entity_id', 'state', 'reporting_year', 'form_revision', 'reporting_basis_as_filed', 'recertification_date_as_filed', 'corporate_address_as_filed', 'source_url', 'source_file', 'retrieved_at', 'pdf_sha256', 'pdf_bytes', 'page_count', 'scanned', 'form', 'status_as_filed', 'status_notice_as_filed', 'period_as_filed', 'submission_as_filed', 'cover_page_url', 'record_kind'],
  'line_items.csv': ['filing_id', 'schedule', 'line', 'row_kind', 'label_as_filed', 'name_as_filed', 'normalized_vendor', 'category', 'description_as_filed', 'ndc_as_filed', 'amount_as_filed', 'amount', 'unit', 'claims_as_filed', 'claims', 'claims_withheld', 'answer_as_filed', 'page', 'verification', 'note'],
  'measures.csv': ['filing_id', 'measure', 'formula', 'value'],
  'vendors.csv': ['normalized_name', 'vendor_type', 'alias_as_filed', 'note'],
};

/** Every file in the dataset's data/ folder. */
export const DATA_FILES = [...Object.keys(CSV_HEADERS), '340b-state-filings.json', 'external-share-dark.svg', 'external-share-light.svg'].sort();

/** The forms this site can show. Must match FORMS in src/lib/forms.ts. */
export const KNOWN_FORMS = ['ri-oag-340b', 'vt-gmcb-340b-financial', 'mn-mdh-340b-report'];

/** The kinds of record a filing may be (filings.csv `record_kind`). Must match RECORD_KINDS in src/lib/forms.ts. */
export const KNOWN_RECORD_KINDS = ['filing', 'state_report_row', 'state_report_totals'];

/** The entity types a row of entities.csv may have. Must match ENTITY_TYPES in src/lib/forms.ts. */
export const KNOWN_ENTITY_TYPES = ['health_center', 'hospital', 'other', 'state_total'];

/** Units a row may have. */
export const KNOWN_UNITS = ['usd', 'percent', 'count', 'none'];

/** Why a row's claim count is left out (line_items.csv `claims_withheld`); empty when it is published. */
export const KNOWN_WITHHELD = ['', 'fewer_than_6', 'beside_small'];

/** The small-number rule: a claim count from 1 up to this is never published. */
export const SMALL_CLAIMS_HIGHEST = 5;
const SMALL_MARK = 'fewer_than_6';

/** True for a printed or parsed claim count of 1 to 5 ("3", "0003", "1,0" is not a count and is left alone). */
export function isSmallClaimCount(text) {
  if (typeof text !== 'string' || !/^\d[\d,]*$/.test(text.trim())) return false;
  const count = Number(text.replace(/,/g, ''));
  return count >= 1 && count <= SMALL_CLAIMS_HIGHEST;
}

/** Writes rows back as CSV: a cell is quoted only when it needs to be. */
export function writeCsv(rows, newline = '\n') {
  const cell = (value) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return rows.map((row) => row.map(cell).join(',')).join(newline) + newline;
}

/**
 * Applies the small-number rule to a set of dataset files (name -> text) on their way into this site.
 * The dataset already leaves these counts out; this is the site's own second pass. A row that still
 * carries a claim count of 1 to 5 is kept, with the count left out and `claims_withheld` set, exactly
 * as the dataset would publish it. Nothing is refused. Returns the files (unchanged text when nothing
 * was found) and one line per row that was changed, for a warning.
 */
export function maskSmallClaimCounts(files) {
  const out = { ...files };
  const changed = [];
  const mask = (row) => {
    if (!isSmallClaimCount(row.claims) && !isSmallClaimCount(row.claims_as_filed)) return false;
    row.claims = '';
    row.claims_as_filed = '';
    row.claims_withheld = SMALL_MARK;
    return true;
  };

  const csvName = 'line_items.csv';
  if (csvName in files) {
    const [header, ...rows] = readCsv(files[csvName]);
    const at = Object.fromEntries(header.map((h, i) => [h, i]));
    if ('claims' in at && 'claims_as_filed' in at && 'claims_withheld' in at) {
      let touched = false;
      for (const cells of rows) {
        const row = { claims: cells[at.claims], claims_as_filed: cells[at.claims_as_filed], claims_withheld: cells[at.claims_withheld] };
        if (!mask(row)) continue;
        cells[at.claims] = row.claims;
        cells[at.claims_as_filed] = row.claims_as_filed;
        cells[at.claims_withheld] = row.claims_withheld;
        changed.push(`${csvName}: ${cells[at.filing_id]} schedule ${cells[at.schedule]} line ${cells[at.line]}`);
        touched = true;
      }
      if (touched) out[csvName] = writeCsv([header, ...rows], files[csvName].includes('\r\n') ? '\r\n' : '\n');
    }
  }

  const jsonName = '340b-state-filings.json';
  if (jsonName in files) {
    const document = JSON.parse(files[jsonName]);
    let touched = false;
    for (const row of Array.isArray(document.line_items) ? document.line_items : []) {
      if (!('claims_withheld' in row) || !mask(row)) continue;
      changed.push(`${jsonName}: ${row.filing_id} schedule ${row.schedule} line ${row.line}`);
      touched = true;
    }
    if (touched) out[jsonName] = JSON.stringify(document, null, 2) + '\n';
  }
  return { files: out, changed };
}

/** The first line of a CSV file, split on commas (header names never contain a comma or quote). */
export function headerOf(text) {
  return text.split(/\r?\n/, 1)[0].split(',');
}

/** Returns a list of problems with a set of files (name -> text); empty when the copy is as expected. */
export function shapeProblems(files) {
  const problems = [];
  for (const name of Object.keys(files)) {
    if (!DATA_FILES.includes(name)) problems.push(`${name}: not a file this site expects`);
  }
  for (const name of DATA_FILES) {
    if (!(name in files)) problems.push(`${name}: missing`);
  }
  for (const [name, expected] of Object.entries(CSV_HEADERS)) {
    if (!(name in files)) continue;
    const found = headerOf(files[name]);
    if (found.join(',') !== expected.join(',')) problems.push(`${name}: columns are not the expected ones (found ${found.join(' ')})`);
  }
  return problems;
}

/** A small CSV reader (same rules as src/lib/csv.ts): returns arrays of cells, header first. */
export function readCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Checks the values that decide how a row is read: the form and record kind of each filing, the type of each entity and the unit of each row. */
export function valueProblems(files) {
  const problems = [];
  const records = (name) => {
    const [header, ...rows] = readCsv(files[name]);
    return rows.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])));
  };
  for (const r of records('filings.csv')) {
    if (!KNOWN_FORMS.includes(r.form)) problems.push(`filings.csv: ${r.filing_id} names the form "${r.form}", which this site does not know`);
    if (!KNOWN_RECORD_KINDS.includes(r.record_kind)) problems.push(`filings.csv: ${r.filing_id} has the record kind "${r.record_kind}", which this site does not know`);
  }
  for (const r of records('entities.csv')) {
    if (!KNOWN_ENTITY_TYPES.includes(r.entity_type)) problems.push(`entities.csv: ${r.entity_id} has the entity type "${r.entity_type}", which this site does not know`);
  }
  for (const name of ['line_items.csv', 'discrepancies.csv']) {
    for (const r of records(name)) {
      if (!KNOWN_UNITS.includes(r.unit)) problems.push(`${name}: ${r.filing_id} has the unit "${r.unit}", which this site does not know`);
    }
  }
  // The small-number rule, on a finished copy. Sync leaves these counts out on the way in
  // (maskSmallClaimCounts), so this only speaks if a copy was changed by hand afterwards.
  for (const r of records('line_items.csv')) {
    const where = `line_items.csv: ${r.filing_id} schedule ${r.schedule} line ${r.line}`;
    if (!KNOWN_WITHHELD.includes(r.claims_withheld)) problems.push(`${where} has claims_withheld "${r.claims_withheld}", which this site does not know`);
    if (isSmallClaimCount(r.claims) || isSmallClaimCount(r.claims_as_filed)) problems.push(`${where} carries a claim count of 1 to ${SMALL_CLAIMS_HIGHEST}. Run: npm run sync (it leaves the count out and keeps the row)`);
  }
  return problems;
}
