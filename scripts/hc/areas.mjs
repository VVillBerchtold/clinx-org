// The shortage area tables: what the pages expect of them, and the copy into this site.
//
// In plain words: the tracker of shortage areas is made in the folder clinx-health-centers
// (data/areas/). This module copies the files the pages are built from into
// src/data/health-centers/areas/, after checking that they are what the pages were written for: the
// same columns, known events and statuses, counts that agree with the lists, and no web address,
// email address or telephone number anywhere. `npm run check:data` runs the same checks on the copy.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { copyPart, partDir } from './shared.mjs';

export const PART = 'areas';

/** The four kinds of area, in the order the pages show them. */
export const SERIES = ['hpsa-pc', 'hpsa-dh', 'hpsa-mh', 'mua'];
export const STATUSES = ['Designated', 'Proposed For Withdrawal', 'Withdrawn'];
export const EVENTS = ['designated', 'withdrawn', 'updated'];
export const SITE_REASONS = ['added to scope in the last 365 days', 'status is not Active'];
export const SOURCE_FILES = [
  'BCD_HPSA_FCT_DET_DH.csv',
  'BCD_HPSA_FCT_DET_MH.csv',
  'BCD_HPSA_FCT_DET_PC.csv',
  'Health_Center_Service_Delivery_and_LookAlike_Sites.csv',
  'MUA_DET.csv',
];

export const RECENT_COLUMNS = ['event_date_iso', 'event', 'file', 'discipline', 'key', 'id', 'name', 'designation_type', 'state', 'states', 'counties', 'score', 'status', 'event_date_as_published'];
export const PROPOSED_COLUMNS = ['file', 'discipline', 'key', 'id', 'name', 'designation_type', 'state', 'states', 'counties', 'score', 'status', 'designation_date_as_published', 'designation_date_iso', 'last_update_date_as_published', 'last_update_date_iso'];
export const SITE_COLUMNS = ['reason', 'state', 'key', 'site_name', 'health_center_number', 'health_center_name', 'site_status', 'added_to_scope_as_published', 'added_to_scope_iso', 'address', 'city', 'postal_code', 'county'];
export const CHANGE_COLUMNS = ['from_day', 'to_day', 'file', 'key', 'state', 'name', 'kind', 'field', 'before', 'after'];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const PHONE = /(?:\(\d{3}\)\s?|\b\d{3}[-. ])\d{3}[-. ]\d{4}\b/;
const WEB = /https?:\/\/|\bwww\./i;

/** The files a copy holds, given the list of states. */
export function copyNames(states) {
  return ['index.json', 'states.json', 'recent.csv', 'proposed.csv', 'sites-recent.csv', 'changes.csv', ...states.map((st) => `states/${st}.json`)];
}

/** Rows of a CSV text (quoted fields, doubled quotes, line breaks inside quotes), header first. */
export function csvRows(text) {
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

/** The day a year before a day, as the files count it: the snapshot day minus 365 days. */
export function windowStart(day) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 365);
  return d.toISOString().slice(0, 10);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What is wrong with a set of tables, as plain sentences. `read(name)` gives a file's text or null.
 * `states` is only needed to say which state files to expect; it is read from index.json.
 */
export function shapeProblems(read) {
  const problems = [];
  const say = (text) => problems.push(text);
  const text = (name) => {
    const t = read(name);
    if (typeof t !== 'string') say(`${name}: missing`);
    return t;
  };
  const json = (name, t) => {
    try {
      return JSON.parse(t);
    } catch {
      say(`${name}: not valid JSON`);
      return null;
    }
  };

  const indexText = text('index.json');
  if (typeof indexText !== 'string') return problems;
  const index = json('index.json', indexText);
  if (!index) return problems;
  if (!DAY.test(index.snapshot_day ?? '')) say('index.json: no snapshot day');
  else {
    if (index.window_end !== index.snapshot_day) say('index.json: the window does not end on the snapshot day');
    if (index.window_start !== windowStart(index.snapshot_day)) say('index.json: the window does not start 365 days before the snapshot day');
  }
  if (!Array.isArray(index.sources) || !same(index.sources.map((s) => s.file), SOURCE_FILES)) say('index.json: the five HRSA files are not the ones this site names');
  else for (const s of index.sources) if (!/^[0-9a-f]{64}$/.test(s.sha256 ?? '') || !/^\d{4}-\d{2}-\d{2}T/.test(s.retrieved_utc ?? '')) say(`index.json: ${s.file} has no fingerprint or no retrieval time`);
  if (!Array.isArray(index.states) || index.states.length === 0 || !index.states.every((s) => /^[A-Z]{2}$/.test(s)) || !same(index.states, [...index.states].sort())) {
    say('index.json: the list of states is not sorted two-letter codes');
    return problems;
  }
  if (!Number.isInteger(index.change_rows_so_far)) say('index.json: no count of change rows');
  const nat = index.national_counts;
  if (!nat || !same(Object.keys(nat.designations ?? {}).sort(), [...SERIES].sort())) say('index.json: the national counts are not for the four kinds of area');

  const statesText = text('states.json');
  const states = typeof statesText === 'string' ? json('states.json', statesText) : null;
  if (states) {
    if (!same(Object.keys(states.states ?? {}), index.states)) say('states.json: the states are not the states of index.json');
    for (const key of ['counts', 'state', 'updated', 'window']) if (typeof states.notes?.[key] !== 'string' || states.notes[key] === '') say(`states.json: no "${key}" note`);
    if (states.snapshot_day !== index.snapshot_day) say('states.json: not of the same day as index.json');
  }

  const totals = { recent: 0, proposed: 0, sites: 0, changes: 0 };
  for (const st of index.states) {
    const name = `states/${st}.json`;
    const t = text(name);
    if (typeof t !== 'string') continue;
    const s = json(name, t);
    if (!s) continue;
    const bad = (what) => say(`${name}: ${what}`);
    if (s.state !== st || s.snapshot_day !== index.snapshot_day || s.window_start !== index.window_start || s.window_end !== index.window_end) bad('its state or days are not those of index.json');
    if (!same(s.recent_columns, RECENT_COLUMNS) || !same(s.proposed_columns, PROPOSED_COLUMNS) || !same(s.sites_recent_columns, SITE_COLUMNS) || !same(s.changes_columns, CHANGE_COLUMNS)) bad('the columns are not the ones this site reads');
    for (const key of ['counts', 'recent', 'proposed', 'sites_recent', 'changes', 'notes']) if (!(key in s)) bad(`no "${key}"`);
    if (!Array.isArray(s.recent) || !Array.isArray(s.proposed) || !Array.isArray(s.sites_recent) || !Array.isArray(s.changes) || !s.counts) continue;
    const c = s.counts;
    for (const series of SERIES) {
      if (!c.designations?.[series]) bad(`no counts for ${series}`);
      else {
        for (const status of STATUSES) {
          const cell = c.designations[series][status];
          if (!cell || !Number.isInteger(cell.designations) || !Number.isInteger(cell.file_rows)) bad(`no count for ${series}, ${status}`);
        }
      }
    }
    for (const r of s.recent) {
      if (!same(Object.keys(r).sort(), [...RECENT_COLUMNS].sort())) bad('a recent row does not have the recent columns');
      else {
        if (!EVENTS.includes(r.event)) bad(`unknown event ${r.event}`);
        if (!STATUSES.includes(r.status)) bad(`unknown status ${r.status}`);
        if (!DAY.test(r.event_date_iso)) bad(`${r.key}: no event date`);
        if (r.state !== st) bad(`${r.key}: a row of another state`);
        if (!['hpsa', 'mua'].includes(r.file)) bad(`${r.key}: unknown file ${r.file}`);
      }
    }
    if (s.recent.length !== Object.values(c.recent_events ?? {}).reduce((n, e) => n + Object.values(e).reduce((a, b) => a + b, 0), 0)) bad('the recent rows are not as many as the counts say');
    for (const r of s.proposed) {
      if (!same(Object.keys(r).sort(), [...PROPOSED_COLUMNS].sort())) bad('a proposed row does not have the proposed columns');
      else {
        if (r.status !== 'Proposed For Withdrawal') bad(`${r.key}: in the proposed list but its status is ${r.status}`);
        if (r.state !== st) bad(`${r.key}: a row of another state`);
        if (!r.name) bad(`${r.key}: no name`);
      }
    }
    const proposedCount = SERIES.reduce((n, series) => n + (c.designations?.[series]?.['Proposed For Withdrawal']?.designations ?? 0), 0);
    if (s.proposed.length !== proposedCount) bad(`lists ${s.proposed.length} proposed designations, the counts say ${proposedCount}`);
    for (const r of s.sites_recent) {
      if (!same(Object.keys(r).sort(), [...SITE_COLUMNS].sort())) bad('a site row does not have the site columns');
      else {
        if (!SITE_REASONS.includes(r.reason)) bad(`unknown reason ${r.reason}`);
        if (r.state !== st) bad(`${r.key}: a site of another state`);
      }
    }
    if (s.sites_recent.length !== (c.sites_added_to_scope_in_window ?? -1) + (c.sites_not_active ?? -1)) bad('the site rows are not as many as the counts say');
    for (const r of s.changes) if (!same(Object.keys(r).sort(), [...CHANGE_COLUMNS].sort())) bad('a change row does not have the change columns');
    if (s.changes.length !== c.change_rows) bad('the change rows are not as many as the counts say');
    totals.recent += s.recent.length;
    totals.proposed += s.proposed.length;
    totals.sites += s.sites_recent.length;
    totals.changes += s.changes.length;
  }

  // The four tables of the whole country have as many rows as the states' lists together.
  for (const [name, expected, columns] of [
    ['recent.csv', totals.recent, RECENT_COLUMNS],
    ['proposed.csv', totals.proposed, PROPOSED_COLUMNS],
    ['sites-recent.csv', totals.sites, SITE_COLUMNS],
    ['changes.csv', totals.changes, CHANGE_COLUMNS],
  ]) {
    const t = text(name);
    if (typeof t !== 'string') continue;
    const rows = csvRows(t);
    if (!same(rows[0], columns)) say(`${name}: the columns are not the ones this site reads`);
    else if (rows.length - 1 !== expected) say(`${name}: has ${rows.length - 1} rows, the states' lists hold ${expected}`);
  }
  if (Number.isInteger(index.change_rows_so_far) && index.change_rows_so_far !== totals.changes) say('index.json: the change rows so far are not as many as the states hold');

  // Nothing that names or reaches a person or a web page.
  for (const name of copyNames(index.states)) {
    const t = read(name);
    if (typeof t !== 'string') continue;
    if (EMAIL.test(t)) say(`${name}: holds something shaped like an email address`);
    if (PHONE.test(t)) say(`${name}: holds something shaped like a telephone number`);
    if (WEB.test(t)) say(`${name}: holds something shaped like a web address`);
  }
  return problems;
}

/** Copies the tables into the site and returns one plain sentence for the log. */
export function sync({ siteRoot, engineRoot }) {
  const from = 'data/areas';
  const read = (name) => (existsSync(join(engineRoot, from, name)) ? readFileSync(join(engineRoot, from, name), 'utf8') : null);
  const problems = shapeProblems(read);
  if (problems.length > 0) throw new Error(`the areas tables are not what this site expects:\n  ${problems.join('\n  ')}`);
  const index = JSON.parse(read('index.json'));
  const record = copyPart({
    siteRoot,
    engineRoot,
    part: PART,
    from,
    names: copyNames(index.states),
    facts: { snapshot_day: index.snapshot_day, window_start: index.window_start, states: index.states.length },
  });
  return `${index.states.length} state files and 6 tables of ${record.snapshot_day} (${String(record.source_commit).slice(0, 7)})`;
}

/** What is wrong with the copy in this site, as plain sentences. Empty when it is what the pages expect. */
export function problems({ siteRoot }) {
  const dir = partDir(siteRoot, PART);
  return shapeProblems((name) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : null)).map((p) => `health-centers/areas/${p}`);
}
