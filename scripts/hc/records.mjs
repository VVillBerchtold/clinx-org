// The records part of the health center tables: what each health center reported to HRSA in the
// Uniform Data System, one page per center and year.
//
// In plain words: this module knows which files of clinx-health-centers/data/records the pages read,
// checks that they are what the pages were written for, and copies them. `problems` makes the same
// checks again on the copy, so a changed or half-copied file is caught before a build.
//
// Files copied: health-centers.csv, lines.csv, notes.csv and one centers/<key>.json for each health
// center. Not copied: values.csv (the same cells as the center files, 15.6 MB), sites.csv and zips.csv
// (the same rows as the center files; their counts are checked against the center files when copying),
// index.json, differences.csv, sum_rules.csv and line_comparison.csv (checks of the folder, not shown).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { copyPart, partDir, readRecord } from './shared.mjs';

export const PART = 'records';
export const FROM = 'data/records';

export const YEARS = [2021, 2022, 2023, 2024, 2025];
export const STATES = ['MA', 'RI'];
export const HEALTH_CENTER_COLUMNS = [
  'health_center', 'grant_number', 'year', 'sheet_row', 'name_as_published', 'street', 'address_line_2', 'city', 'state', 'zip',
  'funding_chc', 'funding_mhc', 'funding_ho', 'funding_ph', 'funding_msaw', 'funding_hp', 'funding_rph', 'urban_rural', 'sites',
];
export const LINE_COLUMNS = ['year', 'uiid', 'table_name', 'sheet', 'sheet_column', 'line', 'line_title', 'column', 'column_title', 'kind', 'kind_rule'];
export const NOTE_COLUMNS = ['year', 'health_center', 'uiid', 'note', 'value_as_published', 'explanation'];
export const KINDS = ['patients', 'visits', 'fte', 'dollars', 'percent', 'count', 'text', 'other'];
export const SITE_COLUMNS = [
  'sheet_row', 'site_name', 'site_type', 'site_status', 'location_type', 'location_setting', 'operational_schedule', 'calendar_schedule',
  'weekly_hours_as_published', 'service_area_population', 'operated_by', 'street', 'city', 'state', 'zip', 'data_as_of',
];
export const ZIP_COLUMNS = [
  'sheet_row', 'zip', 'zip_type', 'uninsured_as_published', 'uninsured_mark', 'medicaid_chip_other_public_as_published', 'medicaid_chip_other_public_mark',
  'medicare_as_published', 'medicare_mark', 'private_as_published', 'private_mark', 'total_as_published', 'total_mark',
];
export const STATUSES = ['row_present', 'row_withheld_unnamed', 'row_absent'];

const FIXED_FILES = ['health-centers.csv', 'lines.csv', 'notes.csv'];

/** Reads CSV text (quoted fields, doubled quotes) into records keyed by the header row. */
export function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
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
  const header = rows.shift() ?? [];
  return { header, records: rows.map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i] ?? '']))), widths: rows.map((cells) => cells.length) };
}

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * What is wrong with the tables, as plain sentences. `files` maps a name (health-centers.csv, lines.csv,
 * notes.csv, centers/<key>.json) to its text.
 */
export function shapeProblems(files) {
  const problems = [];
  const say = (message) => problems.push(message);
  for (const name of FIXED_FILES) if (typeof files[name] !== 'string') say(`${name} is missing`);
  if (problems.length > 0) return problems;

  const centersTable = parseCsv(files['health-centers.csv']);
  if (!sameList(centersTable.header, HEALTH_CENTER_COLUMNS)) say('health-centers.csv does not have the columns the pages read');
  const linesTable = parseCsv(files['lines.csv']);
  if (!sameList(linesTable.header, LINE_COLUMNS)) say('lines.csv does not have the columns the pages read');
  const notesTable = parseCsv(files['notes.csv']);
  if (!sameList(notesTable.header, NOTE_COLUMNS)) say('notes.csv does not have the columns the pages read');
  if (problems.length > 0) return problems;

  const keys = [...new Set(centersTable.records.map((r) => r.health_center))];
  const yearsSeen = [...new Set(centersTable.records.map((r) => Number(r.year)))].sort();
  if (!sameList(yearsSeen, YEARS)) say(`health-centers.csv covers the years ${yearsSeen.join(', ')}, the pages expect ${YEARS.join(', ')}`);
  const pairs = new Set(centersTable.records.map((r) => `${r.health_center}/${r.year}`));
  if (pairs.size !== centersTable.records.length) say('health-centers.csv lists a health center twice in one year');
  if (pairs.size !== keys.length * YEARS.length) say('health-centers.csv does not have a row for every health center in every year');
  for (const r of centersTable.records) {
    if (!/^[0-9A-Z]+$/.test(r.health_center)) say(`health-centers.csv: "${r.health_center}" is not a key of letters and digits`);
    if (!STATES.includes(r.state)) say(`health-centers.csv: ${r.health_center} ${r.year} is in state "${r.state}"`);
    if (r.name_as_published.trim() === '') say(`health-centers.csv: ${r.health_center} ${r.year} has no name`);
  }
  if (new Set(keys.map((k) => k.toLowerCase())).size !== keys.length) say('two health center keys are the same in lower case, so two pages would share an address');

  const lineSet = new Map();
  for (const l of linesTable.records) {
    if (!YEARS.includes(Number(l.year))) say(`lines.csv: ${l.uiid} is in the year "${l.year}"`);
    if (!KINDS.includes(l.kind)) say(`lines.csv: ${l.year} ${l.uiid} has the kind "${l.kind}"`);
    const id = `${l.year}/${l.uiid}`;
    if (lineSet.has(id)) say(`lines.csv: ${id} appears twice`);
    lineSet.set(id, l);
    if (l.line_title.trim() === '' || l.column_title.trim() === '' || l.table_name.trim() === '') say(`lines.csv: ${id} has an empty title`);
    if (!/^[A-Z]{1,3}$/.test(l.sheet_column)) say(`lines.csv: ${id} has the sheet column "${l.sheet_column}"`);
  }
  for (const n of notesTable.records) if (!lineSet.has(`${n.year}/${n.uiid}`)) say(`notes.csv: ${n.year} ${n.uiid} is not in lines.csv`);

  const totals = { sites: 0, zips: 0 };
  for (const key of keys) {
    const text = files[`centers/${key}.json`];
    if (typeof text !== 'string') {
      say(`centers/${key}.json is missing`);
      continue;
    }
    let doc;
    try {
      doc = JSON.parse(text);
    } catch {
      say(`centers/${key}.json is not valid JSON`);
      continue;
    }
    if (doc.key !== key) say(`centers/${key}.json says its key is "${doc.key}"`);
    if (!sameList(Object.keys(doc.years ?? {}).sort(), YEARS.map(String))) say(`centers/${key}.json does not hold the years ${YEARS.join(', ')}`);
    for (const year of YEARS) {
      const y = doc.years?.[String(year)];
      if (!y) continue;
      const row = centersTable.records.find((r) => r.health_center === key && Number(r.year) === year);
      if (!row || y.health_center?.HealthCenterName !== row.name_as_published) say(`centers/${key}.json ${year}: the name differs from health-centers.csv`);
      if (y.reads !== 'two_reads' && y.reads !== 'one_read') say(`centers/${key}.json ${year}: no statement of how many reads`);
      if (!y.source?.file || !y.source?.report_last_refreshed) say(`centers/${key}.json ${year}: no source file or refresh day`);
      for (const [uiid, value] of Object.entries(y.values ?? {})) {
        if (!lineSet.has(`${year}/${uiid}`)) say(`centers/${key}.json ${year}: ${uiid} is not in lines.csv`);
        if (value !== null && typeof value !== 'string') say(`centers/${key}.json ${year}: ${uiid} is neither text nor empty`);
      }
      for (const [sheet, status] of Object.entries(y.tables ?? {})) {
        if (!STATUSES.includes(status.status)) say(`centers/${key}.json ${year}: ${sheet} has the status "${status.status}"`);
        if (status.status === 'row_present' && !/^\d+$/.test(String(status.sheet_row))) say(`centers/${key}.json ${year}: ${sheet} is present with no row`);
      }
      const sheetsNeeded = new Set([...lineSet.values()].filter((l) => Number(l.year) === year).map((l) => l.sheet));
      for (const sheet of sheetsNeeded) if (!y.tables?.[sheet]) say(`centers/${key}.json ${year}: no status for ${sheet}`);
      if (!sameList(y.sites?.columns ?? [], SITE_COLUMNS)) say(`centers/${key}.json ${year}: the site columns are not the ones the pages read`);
      if (!sameList(y.zip_codes?.columns ?? [], ZIP_COLUMNS)) say(`centers/${key}.json ${year}: the ZIP code columns are not the ones the pages read`);
      for (const r of [...(y.sites?.rows ?? []), ...(y.zip_codes?.rows ?? [])]) if (!Array.isArray(r)) say(`centers/${key}.json ${year}: a row is not a list`);
      if (row && Number(row.sites) !== (y.sites?.rows ?? []).length) say(`centers/${key}.json ${year}: ${(y.sites?.rows ?? []).length} site rows, health-centers.csv says ${row.sites}`);
      totals.sites += (y.sites?.rows ?? []).length;
      totals.zips += (y.zip_codes?.rows ?? []).length;
    }
  }
  // Nothing in a copied file may look like an email address or a telephone number.
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/;
  const PHONE = /(?<![0-9])\(?[0-9]{3}\)?[-. ][0-9]{3}[-. ][0-9]{4}(?![0-9])/;
  for (const [name, text] of Object.entries(files)) {
    if (EMAIL.test(text)) say(`${name} holds something shaped like an email address`);
    if (PHONE.test(text)) say(`${name} holds something shaped like a telephone number`);
  }
  files.__totals = totals;
  return problems;
}

/** Plain facts about the workbooks, from the engine's own list of what it downloaded. */
function workbookFacts(engineRoot, centerFiles) {
  const manifest = parseCsv(readFileSync(join(engineRoot, 'sources', 'manifest.csv'), 'utf8')).records.filter((r) => r.group === 'uds');
  const facts = {};
  for (const year of YEARS) {
    const m = manifest.find((r) => r.file === `H80-${year}.xlsx`);
    if (!m) throw new Error(`sources/manifest.csv has no row for H80-${year}.xlsx`);
    const refreshed = new Set();
    const reads = new Set();
    for (const text of centerFiles) {
      const y = JSON.parse(text).years[String(year)];
      refreshed.add(y.source.report_last_refreshed);
      reads.add(y.reads);
    }
    if (refreshed.size !== 1) throw new Error(`the centers disagree on the refresh day of the ${year} workbook`);
    facts[year] = {
      file: m.file,
      url: m.url,
      retrieved_utc: m.retrieved_utc,
      bytes: Number(m.bytes),
      sha256: m.sha256,
      report_last_refreshed: [...refreshed][0],
      reads: reads.size === 1 ? [...reads][0] : 'mixed',
    };
  }
  return facts;
}

/** Copies the files the pages read, after checking them. Returns one plain sentence for the log. */
export function sync({ siteRoot, engineRoot }) {
  const dir = join(engineRoot, FROM);
  const read = (name) => readFileSync(join(dir, name), 'utf8');
  for (const name of FIXED_FILES) if (!existsSync(join(dir, name))) throw new Error(`no ${FROM}/${name} in ${engineRoot}`);
  const keys = [...new Set(parseCsv(read('health-centers.csv')).records.map((r) => r.health_center))].sort();
  const names = [...FIXED_FILES, ...keys.map((k) => `centers/${k}.json`)];
  const files = {};
  for (const name of names) {
    if (!existsSync(join(dir, name))) throw new Error(`no ${FROM}/${name} in ${engineRoot}`);
    files[name] = read(name);
  }
  const found = shapeProblems(files);
  if (found.length > 0) throw new Error(`the records tables are not what this site expects:\n  ${found.slice(0, 20).join('\n  ')}`);

  // The engine's own lists of sites and ZIP code rows must hold as many rows as the center files.
  for (const [name, total] of [['sites.csv', files.__totals.sites], ['zips.csv', files.__totals.zips]]) {
    const n = parseCsv(read(name)).records.length;
    if (n !== total) throw new Error(`${name} has ${n} rows and the center files hold ${total}`);
  }
  const centerTexts = keys.map((k) => files[`centers/${k}.json`]);
  const facts = {
    years: YEARS,
    latest_year: YEARS[YEARS.length - 1],
    states: STATES,
    health_centers: keys.length,
    workbooks: workbookFacts(engineRoot, centerTexts),
  };
  const record = copyPart({ siteRoot, engineRoot, part: PART, from: FROM, names, facts });
  return `${keys.length} health centers, ${YEARS.length} years, ${Object.keys(record.files).length} files copied (${String(record.source_commit).slice(0, 7)}).`;
}

/** What is wrong with the copy, as plain sentences. Empty when the copy is what the pages expect. */
export function problems({ siteRoot }) {
  const dir = partDir(siteRoot, PART);
  const record = readRecord(siteRoot, PART);
  if (!record) return [`health-centers/${PART}: SOURCE.json is missing`];
  const out = [];
  const files = {};
  for (const name of Object.keys(record.files)) {
    const path = join(dir, name);
    if (existsSync(path)) files[name] = readFileSync(path, 'utf8');
  }
  out.push(...shapeProblems(files).map((p) => `health-centers/${PART}: ${p}`));
  for (const year of YEARS) {
    const w = record.workbooks?.[year];
    if (!w || !/^[0-9a-f]{64}$/.test(w.sha256 ?? '') || !/^https:\/\/data\.hrsa\.gov\//.test(w.url ?? '') || !/^\d{4}-\d{2}-\d{2}T/.test(w.retrieved_utc ?? '') || !w.report_last_refreshed) {
      out.push(`health-centers/${PART}: SOURCE.json does not describe the ${year} workbook`);
    }
  }
  return out;
}
