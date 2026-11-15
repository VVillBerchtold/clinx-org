// What the site expects of its copy of the bills table (bills.csv and 340b-bills.json) and of the
// calendar made from it (events.csv and 340b-events.json).
// In plain words: both are made in the sibling folder clinx-340b-bills. Before the site takes a
// copy, and again before every build, these checks make sure the copy is what the pages were
// written for: the same columns, known roles and kinds, real dates and real web addresses, and
// every event of a bill pointing at a bill that is in the table.
import { KNOWN_LAW_KINDS } from './dataset-shape.mjs';

/** The files of the bills table and its calendar, as they are named in public/data/. */
export const BILL_FILES = ['bills.csv', '340b-bills.json', 'events.csv', '340b-events.json'];

/** The columns of the calendar, in order. Must match the reader in src/lib/calendar.ts. */
export const EVENT_COLUMNS = ['event_id', 'day', 'time', 'jurisdiction', 'kind', 'bill_id', 'bill', 'what', 'body', 'where', 'link', 'source', 'retrieved'];
/** The kinds of event, in the order a bill meets them; the last three are not steps of a bill. */
export const EVENT_KINDS = [
  'introduced',
  'sent to committee',
  'reported by committee',
  'failed in committee',
  'vote on passage',
  'sent for signature',
  'signed',
  'vetoed',
  'became law',
  'hearing',
  'session starts',
  'session ends',
];
/** Kinds that belong to no one bill. */
export const SESSION_KINDS = ['session starts', 'session ends'];

/** The columns of the table, in order. Must match the reader in src/lib/bills.ts. */
export const BILL_COLUMNS = [
  'bill_id',
  'jurisdiction',
  'session',
  'session_end',
  'bill',
  'title',
  'official_title',
  'role',
  'kinds',
  'summary',
  'names_program_in',
  'text_mentions',
  'quote',
  'introduced_date',
  'sponsor',
  'cosponsors',
  'committees',
  'stage',
  'stage_date',
  'failed_vote',
  'latest_action_date',
  'latest_action',
  'law',
  'same_as',
  'bill_url',
  'text_version',
  'text_date',
  'text_url',
  'status_updated',
  'retrieved',
];

/** What a bill is to the program. Blank until a person has read the bill. */
export const BILL_ROLES = ['main', 'part', 'mention'];
/** Where a bill names the program. */
export const NAMED_IN = ['title', 'summary', 'text', 'earlier text'];
/** How far a bill has got. "Passed the ..." names one chamber in the legislature's own word. */
export const BILL_STAGES = ['Introduced', 'Reported by committee', 'Passed both chambers', 'Passed the legislature', 'Sent to the President', 'Sent to the governor', 'Vetoed', 'Became law'];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_COLUMNS = ['session_end', 'introduced_date', 'stage_date', 'latest_action_date', 'text_date', 'status_updated', 'retrieved'];
const PLACE = /^(?:US|[A-Z]{2})$/;

/** Returns every way the two files differ from what the site expects; an empty list means none. */
export function billsProblems(texts) {
  const problems = [];
  for (const name of BILL_FILES) {
    if (typeof texts[name] !== 'string') problems.push(`${name}: missing`);
  }
  if (problems.length > 0) return problems;

  const header = texts['bills.csv'].split('\n', 1)[0].replace(/\r$/, '');
  if (header !== BILL_COLUMNS.join(',')) problems.push('bills.csv: the columns are not the ones this site reads');

  let document;
  try {
    document = JSON.parse(texts['340b-bills.json']);
  } catch {
    return [...problems, '340b-bills.json: not valid JSON'];
  }
  if (!DAY.test(document.retrieved ?? '')) problems.push('340b-bills.json: no retrieved date');
  if (JSON.stringify((document.roles ?? []).map((r) => r.role)) !== JSON.stringify(BILL_ROLES)) problems.push('340b-bills.json: the roles are not main, part, mention');
  if (JSON.stringify(document.kinds) !== JSON.stringify(KNOWN_LAW_KINDS)) problems.push('340b-bills.json: the kinds are not the kinds of the laws table');
  if (!Array.isArray(document.bills) || document.bills.length === 0) return [...problems, '340b-bills.json: no bills'];

  const seen = new Set();
  for (const bill of document.bills) {
    const id = String(bill.bill_id);
    const say = (what) => problems.push(`${id}: ${what}`);
    if (JSON.stringify(Object.keys(bill)) !== JSON.stringify(BILL_COLUMNS)) {
      say('its fields are not the columns of the table');
      continue;
    }
    if (!/^[a-z]{2}-[a-z0-9]+-[a-z0-9]+$/.test(id)) say('its name is not in the form place-session-number');
    if (seen.has(id)) say('listed twice');
    seen.add(id);
    if (!PLACE.test(bill.jurisdiction) || id.slice(0, 2).toUpperCase() !== bill.jurisdiction) say('its place does not match its name');
    for (const column of ['session', 'bill', 'title']) if (!bill[column]) say(`no ${column}`);
    if (bill.role !== '' && !BILL_ROLES.includes(bill.role)) say(`unknown role ${bill.role}`);
    if (!Array.isArray(bill.kinds) || bill.kinds.some((k) => !KNOWN_LAW_KINDS.includes(k))) say('unknown kind');
    else if (bill.role === 'mention' && bill.kinds.length > 0) say('a bill that only mentions the program has no kind');
    else if ((bill.role === 'main' || bill.role === 'part') && bill.kinds.length === 0) say('read, but no kind');
    if (bill.role !== '' && !bill.summary) say('read, but no sentence');
    if (bill.role === '' && (bill.summary || bill.kinds.length > 0)) say('a sentence or a kind, but no role');
    if (!Array.isArray(bill.names_program_in) || bill.names_program_in.length === 0 || bill.names_program_in.some((w) => !NAMED_IN.includes(w))) say('does not say where it names the program');
    for (const column of ['text_mentions', 'cosponsors']) {
      if (bill[column] !== null && !(Number.isInteger(bill[column]) && bill[column] >= 0)) say(`${column} is not a whole number`);
    }
    for (const column of DATE_COLUMNS) if (bill[column] !== '' && !DAY.test(bill[column])) say(`${column} is not a date`);
    if (!bill.session_end) say('no end date for its session');
    if (bill.stage !== '' && !BILL_STAGES.includes(bill.stage) && !/^Passed the \S/.test(bill.stage)) say(`unknown stage ${bill.stage}`);
    if (!/^https?:\/\/[^\s]+$/.test(bill.bill_url)) say('no official page');
    if (bill.text_url !== '' && !/^https?:\/\/[^\s]+$/.test(bill.text_url)) say('the link to its text is not a web address');
  }
  const rows = texts['bills.csv'].trimEnd().split('\n').length - 1;
  if (rows < document.bills.length) problems.push('bills.csv: fewer rows than the JSON file has bills');
  problems.push(...eventsProblems(texts, seen));
  return problems;
}

/** The same for the calendar. `billIds` is every bill in the table: an event of a bill must point at one. */
function eventsProblems(texts, billIds) {
  const problems = [];
  if (texts['events.csv'].split('\n', 1)[0].replace(/\r$/, '') !== EVENT_COLUMNS.join(',')) problems.push('events.csv: the columns are not the ones this site reads');
  let document;
  try {
    document = JSON.parse(texts['340b-events.json']);
  } catch {
    return [...problems, '340b-events.json: not valid JSON'];
  }
  if (!DAY.test(document.retrieved ?? '')) problems.push('340b-events.json: no retrieved date');
  if (JSON.stringify(Object.keys(document.kinds ?? {})) !== JSON.stringify(EVENT_KINDS)) problems.push('340b-events.json: the kinds of event are not the ones this site knows');
  if (!Array.isArray(document.events) || document.events.length === 0) return [...problems, '340b-events.json: no events'];
  const seen = new Set();
  for (const event of document.events) {
    const id = String(event.event_id);
    const say = (what) => problems.push(`${id}: ${what}`);
    if (JSON.stringify(Object.keys(event)) !== JSON.stringify(EVENT_COLUMNS)) {
      say('its fields are not the columns of the calendar');
      continue;
    }
    if (!/^[a-z]{2}-[a-z0-9-]+$/.test(id)) say('its name is not in the form place-what');
    if (seen.has(id)) say('listed twice');
    seen.add(id);
    if (!DAY.test(event.day)) say('no day');
    if (event.time !== '' && !/^\d{2}:\d{2} UTC$/.test(event.time)) say('its time is not in the form 14:30 UTC');
    if (!PLACE.test(event.jurisdiction) || id.slice(0, 2).toUpperCase() !== event.jurisdiction) say('its place does not match its name');
    if (!EVENT_KINDS.includes(event.kind)) say(`unknown kind ${event.kind}`);
    else if (SESSION_KINDS.includes(event.kind) ? event.bill_id !== '' : !billIds.has(event.bill_id)) say('does not point at a bill in the table');
    if (!event.what) say('no words');
    if (!/^https?:\/\/[^\s]+$/.test(event.link)) say('no official page');
    if (!event.source) say('does not say where it comes from');
  }
  const rows = texts['events.csv'].trimEnd().split('\n').length - 1;
  if (rows < document.events.length) problems.push('events.csv: fewer rows than the JSON file has events');
  return problems;
}
