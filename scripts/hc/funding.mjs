// The funding and deadline calendar: what the site copies from clinx-health-centers and what it expects of the copy.
//
// In plain words: the engine's data/funding/ folder holds HRSA's funding opportunities from Grants.gov, the
// Federal Register documents that name health centers, and one calendar built from both. This module copies
// the seven files the pages need into src/data/health-centers/funding/, after checking that they are what the
// pages were written for: the same columns, known kinds of date, real days, every dated event pointing at an
// opportunity or a document that is in the files, the counts in index.json equal to the counts of rows, and no
// email address or phone number anywhere. `npm run check:data` runs the same checks on the copy.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { copyPart, partDir } from './shared.mjs';

const PART = 'funding';

/** The files copied, in the order the pages read them. The first four are what the pages are built from; the rest are downloads. */
export const FUNDING_FILES = ['index.json', 'opportunities.json', 'deadlines.json', 'register.json', 'opportunities.csv', 'deadlines.csv', 'register.csv'];

/** The kinds of dated event the calendar holds, in the order the pages list them. Must match src/lib/hc-funding.ts. */
export const FUNDING_KINDS = ['notice expected', 'application due', 'award expected', 'comments close', 'takes effect'];

/** The columns of the three tables as CSV, in order. */
export const CSV_COLUMNS = {
  'deadlines.csv': ['date', 'kind', 'estimated', 'title', 'source', 'source_id', 'url', 'status', 'note'],
  'register.csv': [
    'document_number', 'title', 'title_as_published', 'type', 'action', 'action_as_published', 'agency_names', 'publication_date', 'comments_close_on',
    'effective_on', 'date_text', 'date_text_as_published', 'abstract', 'abstract_as_published', 'html_url', 'pdf_url', 'docket_ids', 'regulation_id_numbers', 'found_by',
  ],
};

/** The keys every opportunity of opportunities.json carries. Must match the reader in src/lib/hc-funding.ts. */
export const OPPORTUNITY_KEYS = [
  'agency_code', 'agency_name', 'applicant_types', 'application_due_note', 'application_due_note_as_published', 'attachment_file_names', 'award_ceiling', 'award_floor',
  'category', 'change_comment', 'change_comment_as_published', 'cost_sharing', 'date_conflicts', 'dates', 'description', 'description_as_published', 'document_kind',
  'eligibility', 'eligibility_as_published', 'estimated_funding', 'fiscal_year', 'funding_categories', 'funding_instruments', 'grants_gov_url', 'health_center_program',
  'id', 'listings', 'matched_terms', 'more_information_text', 'more_information_text_as_published', 'more_information_url', 'names_health_centers', 'number',
  'number_of_awards', 'packages', 'record_change_comment', 'record_change_comment_as_published', 'revision', 'status', 'title', 'title_as_published',
];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const PHONE = /(?:\(\d{3}\)\s?|\b\d{3}[-.\s])\d{3}[-.\s]\d{4}\b/;

/** The number of records of a CSV text (a quoted cell may hold line breaks), header excluded, and its header cells. */
export function csvShape(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return { header: rows[0] ?? [], records: Math.max(rows.length - 1, 0) };
}

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** What is wrong with the seven files, as plain sentences. `texts` maps a file name to its text. */
export function fundingProblems(texts) {
  const problems = [];
  const say = (message) => problems.push(message);
  for (const name of FUNDING_FILES) {
    if (typeof texts[name] !== 'string') say(`${name}: the file is missing`);
  }
  if (problems.length > 0) return problems;

  for (const name of FUNDING_FILES) {
    if (EMAIL.test(texts[name])) say(`${name}: holds something shaped like an email address`);
    if (PHONE.test(texts[name])) say(`${name}: holds something shaped like a phone number`);
  }

  const parse = (name) => {
    try {
      return JSON.parse(texts[name]);
    } catch {
      say(`${name}: is not valid JSON`);
      return undefined;
    }
  };
  const index = parse('index.json');
  const opportunities = parse('opportunities.json');
  const deadlines = parse('deadlines.json');
  const register = parse('register.json');
  if (!isRecord(index) || !Array.isArray(opportunities) || !Array.isArray(deadlines) || !Array.isArray(register)) {
    if (problems.length === 0) say('the JSON files are not the shapes the pages expect (index.json an object, the other three lists)');
    return problems;
  }

  if (!DAY.test(index.snapshot_day ?? '')) say('index.json: no snapshot_day');

  // Opportunities.
  const ids = new Set();
  const statuses = { forecasted: 0, posted: 0 };
  for (const o of opportunities) {
    const at = `opportunities.json: ${o?.id ?? '(no id)'}`;
    if (!isRecord(o)) {
      say('opportunities.json: a row is not an object');
      continue;
    }
    if (JSON.stringify(Object.keys(o)) !== JSON.stringify(OPPORTUNITY_KEYS)) {
      say(`${at}: the keys are not the ones the pages expect`);
      continue;
    }
    if (!/^\d+$/.test(o.id)) say(`${at}: the id is not a number`);
    if (ids.has(o.id)) say(`${at}: listed twice`);
    ids.add(o.id);
    if (o.status in statuses) statuses[o.status] += 1;
    else say(`${at}: status "${o.status}" is neither forecasted nor posted`);
    if (!['forecast', 'synopsis'].includes(o.document_kind)) say(`${at}: unknown document kind "${o.document_kind}"`);
    if (o.grants_gov_url !== `https://www.grants.gov/search-results-detail/${o.id}`) say(`${at}: the Grants.gov address is not the pattern https://www.grants.gov/search-results-detail/<id>`);
    for (const [name, date] of Object.entries(o.dates)) {
      if (!isRecord(date) || typeof date.as_published !== 'string' || !DAY.test(date.date ?? '')) say(`${at}: date ${name} has no published text or no day`);
    }
    for (const key of ['estimated_funding', 'award_ceiling', 'award_floor', 'number_of_awards']) {
      if (o[key] !== null && (!isRecord(o[key]) || typeof o[key].as_published !== 'string')) say(`${at}: ${key} is neither empty nor a published text`);
    }
    for (const key of ['health_center_program', 'names_health_centers', 'cost_sharing']) {
      if (typeof o[key] !== 'boolean') say(`${at}: ${key} is not true or false`);
    }
    for (const key of ['applicant_types', 'funding_categories', 'funding_instruments', 'listings', 'matched_terms', 'packages', 'attachment_file_names', 'date_conflicts']) {
      if (!Array.isArray(o[key])) say(`${at}: ${key} is not a list`);
    }
    if (typeof o.title !== 'string' || o.title === '' || typeof o.description !== 'string' || typeof o.eligibility !== 'string') say(`${at}: a title or a text is missing`);
    if (o.more_information_url !== '' && !/^https?:\/\/\S+$/.test(o.more_information_url)) say(`${at}: the attached link is not a web address`);
    if (o.names_health_centers !== (o.matched_terms.length > 0)) say(`${at}: the flag for naming health centers and the matched words disagree`);
  }

  // Register.
  const documents = new Set();
  for (const r of register) {
    const at = `register.json: ${r?.document_number ?? '(no number)'}`;
    if (!isRecord(r) || typeof r.document_number !== 'string' || r.document_number === '') {
      say('register.json: a row has no document number');
      continue;
    }
    if (documents.has(r.document_number)) say(`${at}: listed twice`);
    documents.add(r.document_number);
    if (!/^https:\/\/www\.federalregister\.gov\//.test(r.html_url ?? '')) say(`${at}: the Federal Register address is not on federalregister.gov`);
    if (r.pdf_url !== '' && !/^https:\/\/\S+$/.test(r.pdf_url ?? '')) say(`${at}: the PDF address is not a web address`);
    if (!DAY.test(r.publication_date ?? '')) say(`${at}: no publication date`);
    for (const key of ['comments_close_on', 'effective_on']) {
      if (r[key] !== null && r[key] !== '' && !DAY.test(r[key] ?? '')) say(`${at}: ${key} is not a day`);
    }
    if (!Array.isArray(r.found_by) || r.found_by.length === 0 || r.found_by.some((q) => !['hrsa-health-center', 'any-agency-fqhc'].includes(q))) say(`${at}: found_by is not one of the two questions`);
    if (!Array.isArray(r.agency_names)) say(`${at}: agency_names is not a list`);
  }

  // The calendar.
  const byKind = {};
  let estimated = 0;
  let last = '';
  for (const e of deadlines) {
    const at = `deadlines.json: ${e?.source_id ?? '(no id)'} ${e?.kind ?? ''}`;
    if (!isRecord(e) || JSON.stringify(Object.keys(e)) !== JSON.stringify(['date', 'estimated', 'kind', 'note', 'source', 'source_id', 'status', 'title', 'url'])) {
      say(`${at}: the keys are not the ones the pages expect`);
      continue;
    }
    if (!DAY.test(e.date)) say(`${at}: no day`);
    if (e.date < last) say(`${at}: not in day order`);
    last = e.date;
    if (!FUNDING_KINDS.includes(e.kind)) say(`${at}: unknown kind of date`);
    byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    if (typeof e.estimated !== 'boolean') say(`${at}: estimated is not true or false`);
    if (e.estimated) estimated += 1;
    if (e.source === 'grants.gov') {
      if (!ids.has(e.source_id)) say(`${at}: names an opportunity that is not in opportunities.json`);
      if (e.url !== `https://www.grants.gov/search-results-detail/${e.source_id}`) say(`${at}: the Grants.gov address is not the pattern`);
      if (!['notice expected', 'application due', 'award expected'].includes(e.kind)) say(`${at}: a Grants.gov date of a kind it does not give`);
    } else if (e.source === 'federal register') {
      const doc = register.find((r) => r.document_number === e.source_id);
      if (!doc) say(`${at}: names a document that is not in register.json`);
      else if (doc.html_url !== e.url) say(`${at}: its address differs from the document's`);
      if (!['comments close', 'takes effect'].includes(e.kind)) say(`${at}: a Federal Register date of a kind it does not give`);
      if (e.estimated) say(`${at}: a Federal Register date is marked estimated`);
    } else say(`${at}: unknown source "${e.source}"`);
  }

  // The counts in index.json equal the counts of rows.
  const count = (what, said, found) => {
    if (said !== found) say(`index.json: says ${said} ${what}, the file holds ${found}`);
  };
  count('opportunities', index.opportunities?.total, opportunities.length);
  count('forecast opportunities', index.opportunities?.by_status?.forecasted, statuses.forecasted);
  count('posted opportunities', index.opportunities?.by_status?.posted, statuses.posted);
  count('opportunities that name health centers', index.opportunities?.names_health_centers, opportunities.filter((o) => o.names_health_centers).length);
  count('opportunities of the Health Center Program', index.opportunities?.health_center_program, opportunities.filter((o) => o.health_center_program).length);
  count('Federal Register documents', index.register_documents?.total, register.length);
  count('dated events', index.events?.total, deadlines.length);
  count('estimated events', index.events?.estimated, estimated);
  count('firm events', index.events?.firm, deadlines.length - estimated);
  for (const kind of FUNDING_KINDS) count(`events of kind "${kind}"`, index.events?.by_kind?.[kind] ?? 0, byKind[kind] ?? 0);

  // The CSV copies hold the same rows as the JSON copies.
  const csv = (name, rows, columns) => {
    const shape = csvShape(texts[name]);
    if (columns && JSON.stringify(shape.header) !== JSON.stringify(columns)) say(`${name}: the columns are not the ones the pages expect`);
    if (shape.records !== rows) say(`${name}: holds ${shape.records} rows, its JSON file holds ${rows}`);
  };
  csv('opportunities.csv', opportunities.length, undefined);
  csv('deadlines.csv', deadlines.length, CSV_COLUMNS['deadlines.csv']);
  csv('register.csv', register.length, CSV_COLUMNS['register.csv']);
  return problems;
}

const readTexts = (dir) => Object.fromEntries(FUNDING_FILES.filter((name) => existsSync(join(dir, name))).map((name) => [name, readFileSync(join(dir, name), 'utf8')]));

/** Copies the files into the site and says in one sentence what it copied. Throws when the files are not what the pages expect. */
export function sync({ siteRoot, engineRoot }) {
  const from = 'data/funding';
  const texts = readTexts(join(engineRoot, from));
  const problems = fundingProblems(texts);
  if (problems.length > 0) throw new Error(`the funding tables are not what this site expects:\n  ${problems.join('\n  ')}`);
  const index = JSON.parse(texts['index.json']);
  const record = copyPart({
    siteRoot,
    engineRoot,
    part: PART,
    from,
    names: FUNDING_FILES,
    facts: { snapshot_day: index.snapshot_day, opportunities: index.opportunities.total, register_documents: index.register_documents.total, events: index.events.total },
  });
  return `${record.opportunities} opportunities, ${record.register_documents} Federal Register documents and ${record.events} dated events of ${record.snapshot_day} (${record.source_commit ? record.source_commit.slice(0, 7) : 'no commit yet'})`;
}

/** What is wrong with the copy in the site, as plain sentences; empty when it is what the pages expect. */
export function problems({ siteRoot }) {
  return fundingProblems(readTexts(partDir(siteRoot, PART)));
}
