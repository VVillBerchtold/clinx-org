// The questions the server can answer, and how each is answered from the tables.
//
// Every tool only reads. Every answer names the official page it came from and the day the table
// was last brought up to date, so whoever asks can check it at the source.
//
// The tools are in groups by subject. This file holds the 340B tools, the overview of one state
// and about_the_data. The health center tools are in src/health-center-tools.js and are listed
// with the rest below.

import { filingPath, latestYears } from './pages.js';
import { InputError, LIMIT, SITE, clip, countOf, dayOf, echo, fitRows, freeText, holds, idOf, leftOutForSize, oneOf, said, tally, text, wholeNumber, words, yearOf, yesNo } from './inputs.js';
import { HEALTH_CENTER_TOOLS, aboutHealthCenters } from './health-center-tools.js';

// The helpers that check an input live in src/inputs.js; the class is passed on from here for the files that take it from this one.
export { InputError };

const STATE = { type: 'string', description: 'Two-letter state code such as RI or TX. Use US for Congress.', pattern: '^[A-Za-z]{2}$' };
// Federal agencies write rules and notices, not bills: they are a place on the calendar, with the code FED.
const AGENCIES = 'FED';
const PLACE = { type: 'string', description: 'Two-letter state code such as RI or TX, US for Congress, or FED for federal agencies (rules and notices in the Federal Register).', pattern: '^[A-Za-z]{2,3}$' };
// The notice that opened the rebate pilot of 2027 has a page of its own on the site.
const PILOT_NOTICE = 'fr-2026-15633';
// What every tool says about itself to a client: it only reads, it changes and removes nothing, asking
// twice gives the same answer, and it reaches nothing beyond ClinX's own files. `destructiveHint` is
// said out loud because the protocol takes a hint that is left out to mean "may remove things".
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const CAUTION = 'Plain-word summaries are a reading aid; the official text at the link governs. Not legal advice.';
const NOTICE_CAUTION = 'The sentence on each document is written by a person who read it and covers only what it does about 340B. Titles, agencies and dates are the Federal Register\'s own, and the Federal Register governs. Not legal advice.';

const place = (code) => (code === 'US' ? 'congress' : code === AGENCIES ? 'agencies' : code.toLowerCase());

// A list's note: the sentence about rows left out for size comes first when there is one (see fitRows in src/inputs.js).
const noted = (leftOut, note) => (leftOut ? `${leftOut} ${note}` : note);

const PLACES = new Set('AK AL AR AZ CA CO CT DE FL GA HI IA ID IL IN KS KY LA MA MD ME MI MN MO MS MT NC ND NE NH NJ NM NV NY OH OK OR PA RI SC SD TN TX UT VA VT WA WI WV WY US'.split(' '));

/** True for a code the tables use for a place: a state, US for Congress, FED for federal agencies. */
export const isPlace = (code) => PLACES.has(code) || code === AGENCIES;

/** The place asked for. Tools about bills and laws do not take FED; the calendar and the overview do. */
function stateOf(args, { agencies = false } = {}) {
  if (args.state === undefined || args.state === '') return undefined;
  const code = typeof args.state === 'string' ? args.state.trim().toUpperCase() : '';
  if (code === AGENCIES) {
    if (agencies) return code;
    throw new InputError('FED is federal agencies, which publish rules and notices, not bills or laws: use find_notices, or calendar with state FED');
  }
  if (!PLACES.has(code)) throw new InputError(`state must be the two-letter code of one of the fifty states, such as RI, or US for Congress${agencies ? ', or FED for federal agencies' : ''}`);
  return code;
}

const briefBill = (bill) => said({
  bill_id: bill.bill_id,
  place: bill.jurisdiction,
  bill: bill.bill,
  title: bill.title,
  stage: bill.stage,
  stage_date: bill.stage_date,
  role: bill.role,
  kinds: bill.kinds,
  summary: bill.summary,
  latest_step: bill.latest_action,
  latest_step_date: bill.latest_action_date,
  official_page: bill.bill_url,
  clinx_page: `${SITE}/bills/${place(bill.jurisdiction)}/`,
});

const briefLaw = (law) => said({
  law_id: law.law_id,
  state: law.state,
  citation: law.citation,
  title: law.title,
  kinds: law.kinds,
  summary: law.summary,
  effective_date: law.effective_date,
  official_page: law.source_url,
  clinx_page: `${SITE}/laws/${law.state.toLowerCase()}/`,
});

const briefEvent = (event) => said({
  day: event.day,
  time: event.time,
  place: event.jurisdiction,
  kind: event.kind,
  bill_id: event.bill_id,
  bill: event.bill,
  notice_id: event.notice_id,
  what: event.what,
  body: event.body,
  where: event.where,
  official_page: event.link,
});

// The agency that wrote a document is the last one named; the department comes first.
const writer = (notice) => notice.agencies[notice.agencies.length - 1] ?? '';
const noticePage = (notice) => `${SITE}/notices/#${notice.notice_id}`;
const openOn = (notice, today) => notice.comments_close !== '' && notice.comments_close >= today;

const briefNotice = (notice, today) => said({
  notice_id: notice.notice_id,
  citation: notice.citation,
  type: notice.type,
  title: notice.title,
  agency: writer(notice),
  role: notice.role,
  summary: notice.summary,
  published: notice.published,
  comments_close: notice.comments_close,
  open_for_comment: openOn(notice, today) ? true : undefined,
  effective: notice.effective,
  official_page: notice.notice_url,
  clinx_page: noticePage(notice),
});

// The table names the chamber ("Passed the Senate", "Sent to the governor"); a search asks more loosely.
// 'Did not pass' ends a bill without it becoming law (a session ended, or a vote went against it). It is finished, not waiting.
const STAGES = ['Introduced', 'Reported by committee', 'Passed one chamber', 'Passed both chambers', 'Sent for signature', 'Vetoed', 'Became law', 'Did not pass'];
function stageGroup(stage) {
  if (/^Passed (the legislature|Congress|both)/.test(stage)) return 'Passed both chambers';
  if (stage.startsWith('Passed ')) return 'Passed one chamber';
  if (stage.startsWith('Sent to ')) return 'Sent for signature';
  if (stage.startsWith('Did not pass')) return 'Did not pass';
  return stage;
}
const ROLES = ['main', 'part', 'mention'];
const KINDS = ['contract-pharmacy', 'payer-nondiscrimination', 'reporting', 'medicaid', 'use-of-savings', 'study', 'other'];
const EVENT_KINDS = ['introduced', 'sent to committee', 'reported by committee', 'failed in committee', 'vote on passage', 'sent for signature', 'signed', 'vetoed', 'became law', 'hearing', 'report due', 'session starts', 'session ends', 'notice published', 'comments close', 'takes effect', 'date set by a notice'];
const NOTICE_TYPES = ['Rule', 'Proposed Rule', 'Notice', 'Presidential Document'];

// ---- Filed reports and the states with a reporting law ----------------------------------------
//
// A "filing" in these tables is one record of a report: a hospital's or health center's own
// report, a row a state printed about one of them, or a state's own totals. Every figure is given
// exactly as the official file prints it. The server never changes, rounds or fills in a figure,
// never ranks one filer against another, and never gives a claim count of 1 to 5.

export const FILINGS_UNREAD = 'The table of filed reports could not be read just now, so this question cannot be answered. The other tools still work. Try again in a minute.';
export const REPORTING_UNREAD = 'The list of states with a reporting law could not be read just now, so this question cannot be answered. The other tools still work. Try again in a minute.';

const FILINGS_CAUTION = 'Every figure is given exactly as the official file prints it; the _as_filed columns hold the printed text and amount and claims hold the same figure as a number. Claim counts of 1 to 5 are never published. ClinX does not rank or judge a filer.';

const needFilings = (t) => {
  if (!t.filings) throw new InputError(FILINGS_UNREAD);
  return t.filings;
};
const needReporting = (t) => {
  if (!t.reporting) throw new InputError(REPORTING_UNREAD);
  return t.reporting;
};

// Why a claim count is not given. A reason this code has not seen is still passed on, with the rule.
export const REPORT_UNREAD = 'The lines of this report could not be read just now, so this question cannot be answered. The other tools still work. Try again in a minute.';

const WITHHELD_WHY = {
  fewer_than_6: 'The count of claims on this row is 1 to 5. Counts that small are never published, so it is not given. The official file prints it on the page named on the row.',
  beside_small: 'The count on this row is not given, because next to the printed total it would let a reader work out a small count on another row.',
  reveals_small: 'This row is a percentage that would let a reader work out a count of 1 to 5 on another row, so it is not given. The official file prints it in the cell named on the row.',
};
const withheldWhy = (reason) => WITHHELD_WHY[reason] ?? `The count on this row is withheld (${reason}). Counts of 1 to 5 are never published.`;

// How a row was checked, in the dataset's own terms.
const CHECKED_WHAT = {
  text_and_image: 'The figure matches the text of the official file and a separate read of the page image.',
  two_file_reads: 'The figure is a cell of the official Excel workbook. Two separate programs read the cell and they agree. A workbook has no page image, so none was used.',
  two_image_reads: 'The page has no usable text, so two separate reads of the page image were compared and they agree.',
  adjudicated: 'The two reads differed and a further look settled it, at the page image for a PDF. The note on the row says what was seen.',
  unreadable: 'The page could not be read with confidence, so the value is left blank.',
};
const BASIS_WHAT = {
  form: 'The form itself says these two figures agree.',
  comparison: 'The form does not say the figures agree. They are shown together.',
};

const PAGE_LINE_COLUMNS = ['schedule', 'line', 'row_kind', 'label_as_filed', 'name_as_filed', 'description_as_filed', 'ndc_as_filed', 'normalized_vendor', 'category', 'amount_as_filed', 'amount', 'unit', 'claims_as_filed', 'claims', 'claims_withheld', 'answer_as_filed', 'page', 'source_cell', 'verification', 'note'];

/** A state's two letters for the filings tools: a state, never US or FED. */
function filingState(args) {
  const code = stateOf(args, { agencies: true });
  if (code === 'US' || code === AGENCIES) throw new InputError('Reports are filed with a state: give the two-letter code of a state, such as RI');
  return code;
}

// A report's lines are not held with the index: they are read when that one report is asked for (see src/tables.js).

// The name the filer printed. A workbook prints a 340B ID and no name, so for Ohio this is empty:
// the name then comes from HRSA's list and is given as HRSA's (see hrsaOf).
const nameOf = (filing) => filing.entity.name_as_filed ?? '';
// A name to sort and to look for by: the filer's own, else HRSA's, else the ID.
const sortName = (filing) => nameOf(filing) || filing.entity.hrsa_name || filing.entity_id;
// HRSA's name for the entity, labelled as HRSA's and never as the filer's own words.
const hrsaOf = (filing) => (filing.entity.hrsa_name
  ? { hrsa_name: filing.entity.hrsa_name, hrsa_list_date: filing.entity.hrsa_list_date, name_source: `The name is HRSA's, from its public list of covered entities read on ${filing.entity.hrsa_list_date || 'a day the table does not give'}. The official file prints the 340B ID and no name.` }
  : {});
// An official file that is an Excel workbook (a form the state publishes as a spreadsheet, not a PDF).
const isWorkbook = (filing) => /\.xlsx?$/i.test(String(filing.source_file ?? '')) || /\.xlsx?(\?|$)/i.test(String(filing.source_url ?? ''));
const kindsOf = (filings, key) => [...new Set(filings.map((f) => key(f)).filter(Boolean))].sort();

// A report has a page of its own on the site only when it is an entity's own filing. A row a state
// printed about an entity, or a state's totals, is shown on the page of the state's reports, and a
// state's earlier year on its own page. The rule is src/pages.js, which the site builds its pages from.
const latestOf = new WeakMap();
function filingPage(filing, held) {
  if (!latestOf.has(held)) latestOf.set(held, latestYears(held.filings));
  return `${SITE}${filingPath(filing, latestOf.get(held))}`;
}

const briefFiling = (filing, held) => said({
  filing_id: filing.filing_id,
  entity: nameOf(filing),
  ...hrsaOf(filing),
  entity_id: filing.entity_id,
  ...(filing.other_entity_ids ? { other_entity_ids: filing.other_entity_ids } : {}),
  entity_type: filing.entity.entity_type,
  state: filing.state,
  year: filing.reporting_year,
  form: filing.form,
  form_revision: filing.form_revision,
  record_kind: filing.record_kind,
  clinx_page: filingPage(filing, held),
  official_source: filing.source_url,
});

// How many lines of a report one answer of get_filing holds; a longer report is read part by part.
// Where the lines are long, an answer holds fewer, so that it stays within the size one answer may
// have (ANSWER_MOST in src/inputs.js).
export const FILING_LINES = { usual: 100, most: 150 };

const fileSize = (value) => (/^\d+$/.test(String(value ?? '')) ? Number(value) : undefined);

function fullLine(line) {
  const ordered = {};
  for (const key of PAGE_LINE_COLUMNS) if (line[key] !== undefined) ordered[key] = line[key];
  for (const key of Object.keys(line)) if (ordered[key] === undefined) ordered[key] = line[key];
  return ordered;
}

// Which group of reporting states a state is in, with the group's own words.
function reportingOf(t, state) {
  if (!t.reporting) return undefined;
  const entry = t.reporting.states.find((s) => s.state === state);
  if (!entry) return null;
  const group = t.reporting.groups.find((g) => g.id === entry.group);
  return { entry, group: group ?? { id: entry.group, label: entry.group, description: '' } };
}

export const TOOLS = [
  {
    name: 'find_bills',
    title: 'Find 340B bills',
    description: 'Search the bills in Congress and the state legislatures that name the federal 340B drug pricing program. Filter by state, stage, role (main: the bill is about 340B; part: a wider bill with a 340B provision; mention: names it in passing), kind, or words in the title, number or summary. Newest activity first.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        state: STATE,
        text: { type: 'string', description: 'Words to look for in the bill number, title and summary.' },
        stage: { type: 'string', enum: STAGES, description: 'How far the bill has gone. Did not pass means the bill ended without becoming law: it is finished and nothing is pending.' },
        role: { type: 'string', enum: ROLES },
        kind: { type: 'string', enum: KINDS, description: 'What the bill does about 340B.' },
        limit: LIMIT,
      },
    },
    run(t, args) {
      const state = stateOf(args);
      const stage = oneOf(args, 'stage', STAGES);
      const role = oneOf(args, 'role', ROLES);
      const kind = oneOf(args, 'kind', KINDS);
      const needles = words(args);
      const found = t.bills
        .filter((b) => (!state || b.jurisdiction === state) && (!stage || stageGroup(b.stage) === stage) && (!role || b.role === role) && (!kind || b.kinds.includes(kind)))
        .filter((b) => holds(text(`${b.bill} ${b.bill.replace(/\s+/g, '')} ${b.title} ${b.official_title} ${b.summary}`), needles))
        .sort((a, b) => (b.latest_action_date || '').localeCompare(a.latest_action_date || ''));
      const asked = clip(found, args.limit).map(briefBill);
      return fitRows(asked, (bills) => ({ matched: found.length, bills, retrieved: t.billsRetrieved, note: noted(leftOutForSize(bills, asked, found.length, 'state, stage, role, kind or text'), CAUTION) }));
    },
  },
  {
    name: 'get_bill',
    title: 'One 340B bill in full',
    description: 'Everything the table holds about one bill, by its bill_id from find_bills: sponsor, stage, latest step in the legislature\'s own words, the passage that names 340B, links to the official page and text, and its dated steps.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['bill_id'], properties: { bill_id: { type: 'string', description: 'For example ri-2025-h5634 or us-119-hr4581.' } } },
    run(t, args) {
      if (typeof args.bill_id !== 'string' || !args.bill_id) throw new InputError('bill_id is required; find_bills returns it');
      const bill = t.bills.find((b) => b.bill_id === args.bill_id.toLowerCase());
      if (!bill) throw new InputError(`no bill with the id ${echo(args.bill_id)}; use find_bills to look one up`);
      const steps = t.events.filter((e) => e.bill_id === bill.bill_id).map(briefEvent);
      return { bill: { ...bill, clinx_page: `${SITE}/bills/${place(bill.jurisdiction)}/` }, dated_steps: steps, retrieved: t.billsRetrieved, note: CAUTION };
    },
  },
  {
    name: 'find_laws',
    title: 'Find state 340B laws',
    description: 'Search the state laws on the books that name the 340B program (not bills: laws already passed). Filter by state, kind, or words in the citation, title and summary.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        state: STATE,
        kind: { type: 'string', description: 'What the law does, for example contract-pharmacy, payer-nondiscrimination or reporting. about_the_data lists the kinds.' },
        text: { type: 'string', description: 'Words to look for in the citation, title and summary.' },
        limit: LIMIT,
      },
    },
    run(t, args) {
      const state = stateOf(args);
      const kinds = t.lawKinds.map((k) => k.kind);
      const kind = oneOf(args, 'kind', kinds.length ? kinds : KINDS);
      const needles = words(args);
      const found = t.laws
        .filter((l) => (!state || l.state === state) && (!kind || l.kinds.includes(kind)))
        .filter((l) => holds(text(`${l.citation} ${l.title} ${l.summary} ${l.act} ${l.bill}`), needles))
        .sort((a, b) => a.state.localeCompare(b.state) || (b.effective_date || '').localeCompare(a.effective_date || ''));
      const asked = clip(found, args.limit).map(briefLaw);
      return fitRows(asked, (laws) => ({ matched: found.length, laws, dataset_version: t.lawsVersion, note: noted(leftOutForSize(laws, asked, found.length, 'state, kind or text'), CAUTION) }));
    },
  },
  {
    name: 'get_law',
    title: 'One state 340B law in full',
    description: 'Everything the table holds about one state law, by its law_id from find_laws: citation, who it binds, what it limits, how it is enforced, dates, the passage that names 340B and the link to the official text.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['law_id'], properties: { law_id: { type: 'string' } } },
    run(t, args) {
      if (typeof args.law_id !== 'string' || !args.law_id) throw new InputError('law_id is required; find_laws returns it');
      const law = t.laws.find((l) => text(l.law_id) === text(args.law_id));
      if (!law) throw new InputError(`no law with the id ${echo(args.law_id)}; use find_laws to look one up`);
      const { source_text: _a, more_text: _b, source_sha256: _c, more_sha256: _d, ...rest } = law;
      return { law: { ...rest, clinx_page: `${SITE}/laws/${law.state.toLowerCase()}/` }, dataset_version: t.lawsVersion, note: CAUTION };
    },
  },
  {
    name: 'find_notices',
    title: 'Find federal 340B rules and notices',
    description: 'Search the rules, proposed rules and notices that federal agencies have published in the Federal Register since January 2025 and that name the 340B program. Filter by type, role (main: the document is about 340B; part: a wider document with a part on 340B; mention: names it in passing), whether comments are still open, the day it was published, or words in the title, citation, agency, docket and summary. Newest first.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string', description: 'Words to look for in the title, citation, document number, agency, docket and summary.' },
        type: { type: 'string', enum: NOTICE_TYPES, description: 'The Federal Register\'s kind of document. Rule is a final rule.' },
        role: { type: 'string', enum: ROLES },
        open_for_comment: { type: 'boolean', description: 'True for documents whose last day for public comments has not passed.' },
        from: { type: 'string', description: 'Published on or after this day, year-month-day.' },
        to: { type: 'string', description: 'Published on or before this day, year-month-day.' },
        limit: LIMIT,
      },
    },
    run(t, args) {
      const type = oneOf(args, 'type', NOTICE_TYPES);
      const role = oneOf(args, 'role', ROLES);
      const open = yesNo(args, 'open_for_comment');
      const from = dayOf(args, 'from');
      const to = dayOf(args, 'to');
      if (from && to && from > to) throw new InputError('from must not be after to');
      const needles = words(args);
      const found = t.notices
        .filter((n) => (!type || n.type === type) && (!role || n.role === role) && (open === undefined || openOn(n, t.today) === open) && (!from || n.published >= from) && (!to || n.published <= to))
        .filter((n) => holds(text(`${n.citation} ${n.document_number} ${n.notice_id} ${n.title} ${n.action} ${n.agencies.join(' ')} ${n.docket} ${n.summary}`), needles))
        .sort((a, b) => b.published.localeCompare(a.published) || b.notice_id.localeCompare(a.notice_id));
      const asked = clip(found, args.limit).map((n) => briefNotice(n, t.today));
      return fitRows(asked, (notices) => ({ matched: found.length, notices, retrieved: t.noticesRetrieved, note: noted(leftOutForSize(notices, asked, found.length, 'type, role, open_for_comment, from, to or text'), NOTICE_CAUTION) }));
    },
  },
  {
    name: 'get_notice',
    title: 'One federal rule or notice in full',
    description: 'Everything the table holds about one federal rule or notice, by its notice_id from find_notices (its Federal Register citation, such as 91 FR 48883, also works): the kind of document, the agency that wrote it, what it does about 340B in a sentence, the Federal Register\'s own words about its dates, the days it sets, the passage that names 340B, and links to the official page and the printed PDF.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['notice_id'], properties: { notice_id: { type: 'string', description: 'For example fr-2026-15633.' } } },
    run(t, args) {
      if (typeof args.notice_id !== 'string' || !args.notice_id.trim()) throw new InputError('notice_id is required; find_notices returns it');
      const asked = text(args.notice_id).trim().replace(/\s+/g, ' ');
      const notice = t.notices.find((n) => n.notice_id === asked || text(n.document_number) === asked || text(n.citation) === asked);
      if (!notice) throw new InputError(`no rule or notice with the id ${echo(args.notice_id)}; use find_notices to look one up`);
      const days = t.events.filter((e) => e.notice_id === notice.notice_id).sort((a, b) => a.day.localeCompare(b.day)).map(briefEvent);
      return {
        notice: {
          ...notice,
          agency: writer(notice),
          open_for_comment: openOn(notice, t.today),
          clinx_page: noticePage(notice),
          ...(notice.notice_id === PILOT_NOTICE ? { explained_at: `${SITE}/rebate-pilot/` } : {}),
          ...(notice.summary === '' ? { not_yet_read: 'Nobody at ClinX has read this document yet, so it has no summary. The facts given are the Federal Register\'s own.' } : {}),
        },
        dated_days: days,
        retrieved: t.noticesRetrieved,
        note: NOTICE_CAUTION,
      };
    },
  },
  {
    name: 'calendar',
    title: '340B calendar',
    description: 'Dated events for 340B bills and federal notices: each bill\'s steps (introduced, sent to committee, votes, signed, vetoed, became law), the days a state\'s 340B report is due (report due), hearings that name a listed bill, the days legislative sessions start and end, and for federal agencies (state FED) the day a rule or notice was published, the day its comments close, the day it takes effect and other days it sets. With no dates given it returns what is coming up from today, soonest first. Give from and to for a past stretch. Dates can move: check the official page before planning around one.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        state: PLACE,
        from: { type: 'string', description: 'First day, year-month-day. Default: today.' },
        to: { type: 'string', description: 'Last day, year-month-day.' },
        kind: { type: 'string', enum: EVENT_KINDS },
        bill_id: { type: 'string', description: 'Only this bill\'s dates.' },
        notice_id: { type: 'string', description: 'Only this federal rule\'s or notice\'s dates, for example fr-2026-15633.' },
        limit: LIMIT,
      },
    },
    run(t, args) {
      const state = stateOf(args, { agencies: true });
      const kind = oneOf(args, 'kind', EVENT_KINDS);
      const to = dayOf(args, 'to');
      // An id that is not text is refused. It is not passed over, which would answer with the whole calendar.
      const billId = idOf(args, 'bill_id', 'ri-2025-h5634; find_bills returns it');
      const noticeId = idOf(args, 'notice_id', 'fr-2026-15633; find_notices returns it');
      // One bill's or one notice's dates are given from the start; anything else starts today.
      const from = dayOf(args, 'from') ?? (to || billId || noticeId ? undefined : t.today);
      if (from && to && from > to) throw new InputError('from must not be after to');
      const found = t.events
        .filter((e) => (!state || e.jurisdiction === state) && (!kind || e.kind === kind) && (!billId || e.bill_id === billId) && (!noticeId || e.notice_id === noticeId) && (!from || e.day >= from) && (!to || e.day <= to))
        .sort((a, b) => a.day.localeCompare(b.day));
      const asked = clip(found, args.limit).map(briefEvent);
      return fitRows(asked, (events) => ({ matched: found.length, events, ...(from ? { from } : {}), retrieved: t.eventsRetrieved, note: noted(leftOutForSize(events, asked, found.length, 'state, kind, from, to, bill_id or notice_id'), 'Dates can move. Check the official page before planning around one.') }));
    },
  },
  {
    name: 'reporting_states',
    title: 'States with a 340B reporting law',
    description: 'The states whose law requires 340B reports, grouped by what the public can see: each filer\'s own report is posted; one state report gives a figure for each named entity; one state report gives totals only; or reports are required and none is public yet. For each state it gives what is public, where it stands, whether ClinX holds its figures, the page of figures on ClinX, and the official sources. Filter by state or by group.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        state: STATE,
        group: { type: 'string', description: 'One group of states: own-reports, named-in-state-report, state-totals or not-posted-yet.' },
      },
    },
    run(t, args) {
      const reporting = needReporting(t);
      const state = filingState(args);
      const groupIds = reporting.groups.map((g) => g.id);
      const group = freeText(args, 'group');
      if (group !== undefined && !groupIds.some((id) => id.toLowerCase() === group)) throw new InputError(`group must be one of: ${groupIds.join(', ')}`);
      const held = t.filings ? tally(t.filings.filings, (f) => f.state) : undefined;
      const wanted = reporting.states.filter((s) => (!state || s.state === state) && (!group || String(s.group).toLowerCase() === group));
      const groups = [...reporting.groups];
      for (const s of wanted) if (!groups.some((g) => g.id === s.group)) groups.push({ id: s.group, label: s.group, description: '' });
      const out = groups
        .map((g) => ({
          id: g.id,
          label: g.label,
          description: g.description,
          states: wanted
            .filter((s) => s.group === g.id)
            .sort((a, b) => String(a.name).localeCompare(String(b.name)))
            .map((s) => ({ ...s, ...(held ? { filings_held: held[s.state] ?? 0 } : {}) })),
        }))
        .filter((g) => g.states.length > 0)
        .map(said);
      return {
        matched: wanted.length,
        groups: out,
        ...(wanted.length === 0 && state ? { not_listed: `${state} is not on ClinX's list of states with a law that requires 340B reports.` } : {}),
        ...(t.filings ? {} : { filings_held_unknown: FILINGS_UNREAD }),
        about: reporting.about,
        updated: reporting.updated,
        note: 'A state is listed here when its law requires 340B reports. on_clinx says whether the Scorecard holds figures for the state. The official sources govern. Not legal advice.',
      };
    },
  },
  {
    name: 'find_filings',
    title: 'Find filed 340B reports',
    description: 'Search the reports that covered entities and states have filed about 340B, which the Scorecard holds. Filter by state, year, entity name or 340B ID, entity type, kind of record (an entity\'s own filing, a row a state printed about an entity, a state\'s totals) or form. Returns short rows: the entity, state, year, form, kind of record, the ClinX page and the official source. Use get_filing for one report in full. Figures are exactly as filed and ClinX ranks no one.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        state: STATE,
        year: { type: 'integer', minimum: 1990, maximum: 2100, description: 'The reporting year, such as 2025.' },
        entity: { type: 'string', description: 'Words in the entity\'s name as filed or in HRSA\'s name for it (Ohio\'s workbooks print an ID and no name), or its city, or a 340B ID such as DSH410009.' },
        entity_type: { type: 'string', description: 'For example hospital, health_center or state_total. about_the_data lists the types held.' },
        record_kind: { type: 'string', description: 'For example filing (an entity\'s own report), state_report_row (a row a state printed about an entity) or state_report_totals. about_the_data lists the kinds held.' },
        form: { type: 'string', description: 'The form\'s id, as listed by about_the_data.' },
        limit: LIMIT,
      },
    },
    run(t, args) {
      const held = needFilings(t);
      const state = filingState(args);
      const year = yearOf(args);
      if (args.entity !== undefined && typeof args.entity !== 'string') throw new InputError('entity must be words to look for');
      const needles = words({ text: args.entity });
      const type = freeText(args, 'entity_type');
      const kind = freeText(args, 'record_kind');
      const form = freeText(args, 'form');
      const found = held.filings
        .filter((f) => (!state || f.state === state) && (!year || f.reporting_year === year) && (!type || text(f.entity.entity_type) === type) && (!kind || text(f.record_kind) === kind) && (!form || text(f.form) === form))
        .filter((f) => holds(text(`${f.entity.name_as_filed ?? ''} ${f.entity.hrsa_name ?? ''} ${f.entity.city_as_filed ?? ''} ${f.entity.opais_ids_as_filed ?? ''} ${f.entity.hrsa_id_spelling ?? ''} ${f.other_entity_ids ?? ''} ${f.entity_id} ${f.filing_id}`), needles))
        .sort((a, b) => a.state.localeCompare(b.state) || String(b.reporting_year).localeCompare(String(a.reporting_year)) || sortName(a).localeCompare(sortName(b)));
      const asked = clip(found, args.limit).map((f) => briefFiling(f, held));
      return fitRows(asked, (shown) => {
        const notes = [FILINGS_CAUTION];
        const leftOut = leftOutForSize(shown, asked, found.length, 'state, year or entity');
        if (leftOut) notes.unshift(leftOut);
        else if (shown.length < found.length) notes.unshift(`Showing ${shown.length} of ${found.length}. The list is cut short: narrow it with state, year or entity, or ask for more with limit (up to 100).`);
        for (const [name, value, known] of [['entity_type', type, kindsOf(held.filings, (f) => f.entity.entity_type)], ['record_kind', kind, kindsOf(held.filings, (f) => f.record_kind)], ['form', form, kindsOf(held.filings, (f) => f.form)]]) {
          if (value && !known.some((k) => text(k) === value)) notes.unshift(`No report has a ${name} of ${echo(value)}. The ${name} values held are: ${known.join(', ')}.`);
        }
        return { matched: found.length, shown: shown.length, filings: shown, retrieved: held.retrieved, note: notes.join(' ') };
      });
    },
  },
  {
    name: 'get_filing',
    title: 'One filed 340B report in full',
    description: `One filed report by its filing_id from find_filings: every line as filed with its label, unit and amount; which claim counts are withheld and why (counts of 1 to 5 are never given); how each figure was checked; any discrepancies recorded between figures the report prints; the official file's address, size and SHA-256; and the ClinX page. For a workbook, the cell each figure was read from. One answer holds ${FILING_LINES.usual} lines, or up to ${FILING_LINES.most} with limit, and fewer where the lines are long. A longer report is given in parts: the answer says how many lines are left and how to ask for the next part with offset, or for one schedule.`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['filing_id'],
      properties: {
        filing_id: { type: 'string', description: 'For example ri-2025-east-bay-cap.' },
        schedule: { type: 'string', description: 'Only the lines of this schedule, as the line list names it (for example G). The answer lists the schedules the report has.' },
        offset: { type: 'integer', minimum: 0, description: 'How many lines to skip, for the next part of a long report (default 0). The answer names the offset of the next part.' },
        limit: { type: 'integer', minimum: 1, maximum: FILING_LINES.most, description: `How many lines to return (default ${FILING_LINES.usual}, at most ${FILING_LINES.most}).` },
      },
    },
    async run(t, args) {
      const held = needFilings(t);
      if (typeof args.filing_id !== 'string' || !args.filing_id.trim()) throw new InputError('filing_id is required; find_filings returns it');
      const filing = held.byId.get(args.filing_id.trim().toLowerCase());
      if (!filing) throw new InputError(`no filed report with the id ${echo(args.filing_id)}; use find_filings to look one up`);
      const offset = wholeNumber(args, 'offset', 0, 1e9, 0);
      const limit = wholeNumber(args, 'limit', 1, FILING_LINES.most, FILING_LINES.usual);
      if (args.schedule !== undefined && typeof args.schedule !== 'string') throw new InputError('schedule must be text, such as G; the answer without a schedule lists the schedules the report has');
      const schedule = args.schedule === undefined || args.schedule === '' ? undefined : args.schedule;
      // The lines are read now, from this one report's file (or from the copy held, in the fallback).
      let report;
      try {
        report = await held.report(filing.filing_id);
      } catch {
        throw new InputError(REPORT_UNREAD);
      }
      const allLines = report.lines;
      const schedules = tally(allLines, (l) => l.schedule ?? '');
      if (schedule !== undefined && !Object.hasOwn(schedules, schedule)) throw new InputError(`this report has no lines in the schedule ${echo(schedule)}; its schedules are: ${Object.keys(schedules).join(', ') || 'none'}`);
      const chosen = schedule === undefined ? allLines : allLines.filter((l) => (l.schedule ?? '') === schedule);
      const asked = chosen.slice(offset, offset + limit).map(fullLine);

      const withheld = tally(allLines, (l) => l.claims_withheld);
      const checked = tally(allLines, (l) => l.verification ?? 'not recorded');
      const { entity } = filing;
      const { entity: _e, line_count: _c, discrepancy_count: _n, measures: _m, attachments: _a, ...record } = filing;
      const fileFields = ['source_url', 'source_file', 'pdf_bytes', 'pdf_sha256', 'page_count', 'cover_page_url', 'retrieved_at'];
      const workbook = isWorkbook(filing);
      const differences = report.discrepancies;
      const cut = (obj, names) => Object.fromEntries(Object.entries(obj).filter(([k]) => !names.includes(k)));
      // The lines asked for are kept whole while the answer stays within the size one answer may
      // have (fitRows in src/inputs.js). The counts and the sentence about what is left are written
      // from the lines that are returned, so the next part starts at the first line left out.
      return fitRows(asked, (returned) => ({
        filing: { ...cut(record, fileFields), entity, ...hrsaOf(filing), clinx_page: filingPage(filing, held) },
        official_file: said({
          ...(workbook ? { kind: 'An Excel workbook (.xlsx) on the State\'s own website. ClinX does not republish it, because the workbook names a member of staff as its contact. The address below is the State\'s. The sha256 and bytes are the workbook\'s own fingerprint and size.' } : {}),
          url: filing.source_url,
          file_name: filing.source_file,
          bytes: fileSize(filing.pdf_bytes),
          sha256: filing.pdf_sha256,
          ...(workbook ? {} : { pages: fileSize(filing.page_count) }),
          cover_page_url: filing.cover_page_url,
          read_on: filing.retrieved_at,
        }),
        clinx_page: filingPage(filing, held),
        // How much of the report this answer holds is said before the lines, so it is read first.
        lines_total: chosen.length,
        lines_returned: returned.length,
        offset,
        ...(offset + returned.length < chosen.length ? { more: `${countOf(chosen.length - offset - returned.length, 'more line', 'more lines')}: ask again with offset ${offset + returned.length} for the next part, or with schedule to take one schedule at a time. ${returned.length < asked.length ? `This answer holds ${countOf(returned.length, 'line', 'lines')}: that is as many whole lines as fit in one answer.` : `One answer holds up to ${FILING_LINES.most} lines.`}` } : {}),
        lines: returned,
        schedules,
        how_to_read_lines: 'Columns ending _as_filed are the official file\'s own words and amounts. amount and claims give the same figure as a number, written as text exactly as the table holds it. unit says what the amount is: usd, percent, count, or none when the row carries no figure. normalized_vendor and category are ClinX\'s own labels, not the filer\'s words. page is the page of the official file; for an Excel workbook it is always 1 and source_cell is the cell the figure was read from. A cell that held words where a figure belongs has the words in amount_as_filed (or answer_as_filed) and no amount.',
        withheld: {
          rows: Object.values(withheld).reduce((a, b) => a + b, 0),
          by_reason: withheld,
          why: Object.fromEntries(Object.keys(withheld).map((reason) => [reason, withheldWhy(reason)])),
          rule: 'A claim count of 1 to 5 is never published, and neither is anything that would let a reader work one out. The amount on the row stays as filed.',
        },
        checked: {
          lines: allLines.length,
          by_verification: checked,
          meaning: Object.fromEntries(Object.keys(checked).map((v) => [v, CHECKED_WHAT[v] ?? `Recorded as ${v} in the table.`])),
          how: workbook
            ? 'Each figure is a cell of the official Excel workbook. Two separate programs read every cell, and a figure is given where they agree. A workbook has no page image. Where a program recalculated a formula, the stored value is kept and the note on the row says so.'
            : 'As the dataset describes it, each figure was transcribed from the official file and compared with that file\'s text and with a separate read of the page image. Both reads were made by software, each as a separate job.',
          ...(filing.scanned === 'true' ? { scanned: 'The official file is a scan, so it has no text to compare with: two separate reads of the page images were compared.' } : {}),
        },
        discrepancies: {
          count: differences.length,
          rows: differences.map((d) => ({ ...d, ...(BASIS_WHAT[d.basis] ? { basis_means: BASIS_WHAT[d.basis] } : {}) })),
          meaning: differences.length
            ? 'A discrepancy is a place where figures the report prints do not agree with each other. Both are given exactly as filed. ClinX corrects neither.'
            : 'No discrepancy is recorded for this report.',
        },
        ...(filing.measures.length ? { measures: { rows: filing.measures, meaning: 'Worked out by the dataset from the lines of this report, and checked against them. They describe this report only and are not a comparison with any other filer.' } } : {}),
        ...(filing.attachments.length ? { attached_documents: filing.attachments } : {}),
        retrieved: held.retrieved,
        note: FILINGS_CAUTION,
      }));
    },
  },
  {
    name: 'state_overview',
    title: '340B in one place',
    description: 'A short picture of 340B law and legislation in one state (or US for Congress): how many laws are on the books and of what kind, how many bills name 340B and how far they have gone, which group of reporting states it is in (what the public can see of its 340B reports) and how many filed reports ClinX holds for it, and the next dates on the calendar, with links to the pages that hold the detail. With FED it gives the federal agencies instead: how many rules and notices name 340B, which are open for comment, and the next federal dates.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['state'], properties: { state: PLACE } },
    run(t, args) {
      const state = stateOf(args, { agencies: true });
      if (!state) throw new InputError('state is required: a two-letter code such as RI, US for Congress, or FED for federal agencies');
      const count = (rows, key) => rows.reduce((all, row) => { for (const k of [].concat(key(row))) all[k] = (all[k] ?? 0) + 1; return all; }, {});
      const coming = t.events.filter((e) => e.jurisdiction === state && e.day >= t.today).sort((a, b) => a.day.localeCompare(b.day));
      if (state === AGENCIES) {
        return {
          place: state,
          what: 'Federal agencies: rules, proposed rules and notices in the Federal Register that name 340B.',
          notices: {
            count: t.notices.length,
            by_role: count(t.notices, (n) => n.role || 'not yet read'),
            by_type: count(t.notices, (n) => n.type),
            open_for_comment: t.notices.filter((n) => openOn(n, t.today)).map((n) => briefNotice(n, t.today)),
          },
          coming_up: coming.slice(0, 5).map(briefEvent),
          pages: { notices: `${SITE}/notices/`, calendar: `${SITE}/calendar/${place(state)}/`, rebate_pilot: `${SITE}/rebate-pilot/` },
          retrieved: t.noticesRetrieved,
          note: NOTICE_CAUTION,
        };
      }
      const laws = t.laws.filter((l) => l.state === state);
      const bills = t.bills.filter((b) => b.jurisdiction === state);
      // Reports filed with the state, and which group of reporting states it is in. Congress has neither.
      const filed = state === 'US' ? undefined : t.filings ? t.filings.filings.filter((f) => f.state === state) : null;
      const reportingHere = state === 'US' ? undefined : reportingOf(t, state);
      const scorecard = reportingHere?.entry.scorecard_url ?? (filed?.length ? `${SITE}/scorecard/${place(state)}/` : undefined);
      return {
        place: state,
        laws: { count: laws.length, by_kind: count(laws, (l) => l.kinds), list: laws.map((l) => ({ law_id: l.law_id, citation: l.citation, kinds: l.kinds })) },
        bills: {
          count: bills.length,
          by_stage: count(bills, (b) => stageGroup(b.stage)),
          became_law: bills.filter((b) => b.stage === 'Became law').map((b) => ({ bill_id: b.bill_id, bill: b.bill, title: b.title })),
          ...(bills.some((b) => stageGroup(b.stage) === 'Did not pass') ? { did_not_pass: bills.filter((b) => stageGroup(b.stage) === 'Did not pass').map((b) => ({ bill_id: b.bill_id, bill: b.bill, title: b.title })) } : {}),
        },
        ...(state === 'US' ? {} : {
          reporting: reportingHere === undefined
            ? { unavailable: REPORTING_UNREAD }
            : reportingHere === null
              ? { listed: false, note: `${state} is not on ClinX's list of states with a law that requires 340B reports.` }
              : {
                listed: true,
                group: reportingHere.group.id,
                group_label: reportingHere.group.label,
                what_is_public: reportingHere.entry.what_is_public,
                where_it_stands: reportingHere.entry.where_it_stands,
                on_clinx: reportingHere.entry.on_clinx,
                scorecard_url: reportingHere.entry.scorecard_url ?? null,
              },
          filings: filed === null
            ? { unavailable: FILINGS_UNREAD }
            : {
              count: filed.length,
              by_year: tally(filed, (f) => f.reporting_year),
              by_record_kind: tally(filed, (f) => f.record_kind),
              note: 'Each record is one report, or one row a state printed about an entity, or a state\'s totals. Use find_filings to list them.',
            },
        }),
        coming_up: coming.slice(0, 5).map(briefEvent),
        ...(state === 'US' ? {} : { health_centers: `For health centers in ${state} use find_health_centers and shortage_area_changes with state ${state}. They are separate sets, read from HRSA's files.` }),
        pages: {
          ...(laws.length ? { laws: `${SITE}/laws/${place(state)}/` } : {}),
          ...(bills.length ? { bills: `${SITE}/bills/${place(state)}/` } : {}),
          ...(scorecard ? { scorecard } : {}),
          calendar: `${SITE}/calendar/${place(state)}/`,
          // Congress writes the bills; the agencies' rules and notices are their own place, FED.
          ...(state === 'US' ? { federal_notices: `${SITE}/notices/` } : {}),
        },
        retrieved: t.billsRetrieved,
        note: CAUTION,
      };
    },
  },
  ...HEALTH_CENTER_TOOLS,
  {
    name: 'about_the_data',
    title: 'About the data',
    description: 'What ClinX\'s open data holds (the 340B tables and the health center sets), where each part comes from, when each was last brought up to date or read, what the marks in a health center report mean, the licence, and where to download the files whole.',
    inputSchema: { type: 'object', additionalProperties: false },
    async run(t) {
      return {
        what: 'Open data from ClinX (clinx.org), a platform of tools for clinics, in two groups. The 340B tables: state laws on the books that name the federal 340B drug pricing program, bills in Congress and the state legislatures that name it, rules and notices federal agencies have published in the Federal Register that name it, a calendar of the bills\' dated steps, session days, report due days and the notices\' dates, the reports that covered entities and states have filed about 340B, and the list of states whose law requires 340B reports. The health center sets (see health_centers below): what each health center reported to HRSA, HRSA\'s funding opportunities and their dates, and HRSA\'s shortage designations and health center sites.',
        counts: { laws: t.laws.length, bills: t.bills.length, notices: t.notices.length, calendar_dates: t.events.length },
        up_to_date_as_of: {
          laws: `dataset version ${t.lawsVersion}`,
          bills: t.billsRetrieved,
          notices: t.noticesRetrieved,
          calendar: t.eventsRetrieved,
          filings: t.filings ? `read ${t.filings.retrieved}, dataset version ${t.filings.version}` : FILINGS_UNREAD,
          reporting_states: t.reporting ? t.reporting.updated : REPORTING_UNREAD,
        },
        filings: t.filings
          ? {
            about: 'The filed reports table: each record is one report that a covered entity or a state filed, with every line of it as the official file prints it. A record is an entity\'s own filing, a row a state printed about one entity in its own report, or a state\'s totals. Use find_filings and get_filing.',
            records: t.filings.filings.length,
            lines: t.filings.filings.reduce((n, f) => n + f.line_count, 0),
            states: kindsOf(t.filings.filings, (f) => f.state),
            years: kindsOf(t.filings.filings, (f) => f.reporting_year),
            forms: kindsOf(t.filings.filings, (f) => f.form),
            record_kinds: kindsOf(t.filings.filings, (f) => f.record_kind),
            entity_types: kindsOf(t.filings.filings, (f) => f.entity.entity_type),
            as_filed: 'Every figure is given exactly as the official file prints it, in the _as_filed columns, with the same figure as a number beside it. ClinX never rounds, estimates or fills in a figure, and never ranks one filer against another. A name or fact that comes from another source is labelled with that source.',
            small_counts: 'A count of 1 to 5 claims is never published, and neither is anything that would let a reader work one out. Those rows say claims_withheld, and every other figure on the row stays as filed. get_filing explains each reason.',
            dataset_version: t.filings.version,
          }
          : { unavailable: FILINGS_UNREAD },
        reporting_states: t.reporting
          ? {
            about: 'The states whose law requires 340B reports, in groups by what the public can see. Use reporting_states.',
            states: t.reporting.states.length,
            groups: t.reporting.groups.map((g) => ({ id: g.id, label: g.label, states: t.reporting.states.filter((s) => s.group === g.id).length })),
          }
          : { unavailable: REPORTING_UNREAD },
        health_centers: await aboutHealthCenters(t),
        today: t.today,
        sources: 'Laws: each state\'s own code or session laws. Bills in Congress: the Government Publishing Office\'s bulk files. State bills: each legislature\'s record as gathered by Open States, with the text read on the legislature\'s own site. Federal rules and notices: the Federal Register\'s own data service. Filed reports: each state\'s own report files; every report names its official file, with the file\'s size and SHA-256. The list of reporting states: each state\'s law and the agency\'s own pages. Every row links to its official page.',
        places: 'A two-letter code for a state, US for Congress, FED for federal agencies.',
        law_kinds: t.lawKinds,
        bill_kinds: t.billKinds,
        notice_types: t.noticeTypes,
        notice_roles: t.noticeRoles,
        calendar_kinds: t.eventKinds,
        licence: `${t.licence}. Free to copy, share and build on with credit.`,
        downloads: `${SITE}/data/`,
        limits: 'A bill is listed only when its title, official summary or text names the program. Summaries are written by a person reading the text and may trail a newer version of a bill. Hearings appear once a legislature posts an agenda naming a listed bill. A federal rule or notice is listed when its text names the program; one nobody has read yet carries the Federal Register\'s facts and no summary. "Coming up" and "open for comment" go by today\'s date, so check up_to_date_as_of for how fresh each table is. A filed report is listed as the official file prints it, and a claim count of 1 to 5 is never given. ' + CAUTION,
      };
    },
  },
].map((tool) => ({ ...tool, annotations: READ_ONLY }));
