// The questions the server can answer, and how each is answered from the tables.
//
// Every tool only reads. Every answer names the official page it came from and the day the table
// was last brought up to date, so whoever asks can check it at the source.

const SITE = 'https://clinx.org';
const STATE = { type: 'string', description: 'Two-letter state code such as RI or TX. Use US for Congress.', pattern: '^[A-Za-z]{2}$' };
// Federal agencies write rules and notices, not bills: they are a place on the calendar, with the code FED.
const AGENCIES = 'FED';
const PLACE = { type: 'string', description: 'Two-letter state code such as RI or TX, US for Congress, or FED for federal agencies (rules and notices in the Federal Register).', pattern: '^[A-Za-z]{2,3}$' };
// The notice that opened the rebate pilot of 2027 has a page of its own on the site.
const PILOT_NOTICE = 'fr-2026-15633';
const LIMIT = { type: 'integer', minimum: 1, maximum: 100, description: 'How many to return (default 20).' };
const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
const CAUTION = 'Plain-word summaries are a reading aid; the official text at the link governs. Not legal advice.';
const NOTICE_CAUTION = 'The sentence on each document is written by a person who read it and covers only what it does about 340B. Titles, agencies and dates are the Federal Register\'s own, and the Federal Register governs. Not legal advice.';

/** A problem with what was asked for, said back to the asker as the tool's answer. */
export class InputError extends Error {}

const text = (value) => String(value ?? '').toLowerCase();
const place = (code) => (code === 'US' ? 'congress' : code === AGENCIES ? 'agencies' : code.toLowerCase());

function clip(rows, limit) {
  if (limit !== undefined && !(Number.isInteger(limit) && limit >= 1 && limit <= 100)) throw new InputError('limit must be a whole number from 1 to 100');
  return rows.slice(0, limit ?? 20);
}

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

function yesNo(args, name) {
  if (args[name] === undefined) return undefined;
  if (typeof args[name] !== 'boolean') throw new InputError(`${name} must be true or false`);
  return args[name];
}

function dayOf(args, name) {
  if (args[name] === undefined || args[name] === '') return undefined;
  if (typeof args[name] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(args[name])) throw new InputError(`${name} must be a date written year-month-day, such as 2027-01-15`);
  return args[name];
}

function oneOf(args, name, allowed) {
  if (args[name] === undefined || args[name] === '') return undefined;
  if (!allowed.includes(args[name])) throw new InputError(`${name} must be one of: ${allowed.join(', ')}`);
  return args[name];
}

function words(args) {
  if (args.text !== undefined && typeof args.text !== 'string') throw new InputError('text must be words to look for');
  return text(args.text).split(/\s+/).filter(Boolean);
}
const holds = (haystack, needles) => needles.every((needle) => haystack.includes(needle));

// Short rows for lists. Empty fields are left out, so an answer carries only what there is to say.
const said = (row) => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== '' && value !== undefined && value !== null));

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
const STAGES = ['Introduced', 'Reported by committee', 'Passed one chamber', 'Passed both chambers', 'Sent for signature', 'Vetoed', 'Became law'];
function stageGroup(stage) {
  if (/^Passed (the legislature|Congress|both)/.test(stage)) return 'Passed both chambers';
  if (stage.startsWith('Passed ')) return 'Passed one chamber';
  if (stage.startsWith('Sent to ')) return 'Sent for signature';
  return stage;
}
const ROLES = ['main', 'part', 'mention'];
const KINDS = ['contract-pharmacy', 'payer-nondiscrimination', 'reporting', 'medicaid', 'use-of-savings', 'study', 'other'];
const EVENT_KINDS = ['introduced', 'sent to committee', 'reported by committee', 'failed in committee', 'vote on passage', 'sent for signature', 'signed', 'vetoed', 'became law', 'hearing', 'session starts', 'session ends', 'notice published', 'comments close', 'takes effect', 'date set by a notice'];
const NOTICE_TYPES = ['Rule', 'Proposed Rule', 'Notice', 'Presidential Document'];

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
        stage: { type: 'string', enum: STAGES, description: 'How far the bill has got.' },
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
      return { matched: found.length, bills: clip(found, args.limit).map(briefBill), retrieved: t.billsRetrieved, note: CAUTION };
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
      if (!bill) throw new InputError(`no bill with the id ${args.bill_id}; use find_bills to look one up`);
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
      return { matched: found.length, laws: clip(found, args.limit).map(briefLaw), dataset_version: t.lawsVersion, note: CAUTION };
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
      if (!law) throw new InputError(`no law with the id ${args.law_id}; use find_laws to look one up`);
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
      return { matched: found.length, notices: clip(found, args.limit).map((n) => briefNotice(n, t.today)), retrieved: t.noticesRetrieved, note: NOTICE_CAUTION };
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
      if (!notice) throw new InputError(`no rule or notice with the id ${args.notice_id}; use find_notices to look one up`);
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
    description: 'Dated events for 340B bills and federal notices: each bill\'s steps (introduced, sent to committee, votes, signed, vetoed, became law), hearings that name a listed bill, the days legislative sessions start and end, and for federal agencies (state FED) the day a rule or notice was published, the day its comments close, the day it takes effect and other days it sets. With no dates given it returns what is coming up from today, soonest first. Give from and to for a past stretch. Dates can move: check the official page before planning around one.',
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
      const idOf = (name) => (typeof args[name] === 'string' && args[name] ? args[name].trim().toLowerCase() : undefined);
      const billId = idOf('bill_id');
      const noticeId = idOf('notice_id');
      // One bill's or one notice's dates are given from the start; anything else starts today.
      const from = dayOf(args, 'from') ?? (to || billId || noticeId ? undefined : t.today);
      if (from && to && from > to) throw new InputError('from must not be after to');
      const found = t.events
        .filter((e) => (!state || e.jurisdiction === state) && (!kind || e.kind === kind) && (!billId || e.bill_id === billId) && (!noticeId || e.notice_id === noticeId) && (!from || e.day >= from) && (!to || e.day <= to))
        .sort((a, b) => a.day.localeCompare(b.day));
      return { matched: found.length, events: clip(found, args.limit).map(briefEvent), ...(from ? { from } : {}), retrieved: t.eventsRetrieved, note: 'Dates can move. Check the official page before planning around one.' };
    },
  },
  {
    name: 'state_overview',
    title: '340B in one place',
    description: 'A short picture of 340B law and legislation in one state (or US for Congress): how many laws are on the books and of what kind, how many bills name 340B and how far they have got, and the next dates on the calendar, with links to the pages that hold the detail. With FED it gives the federal agencies instead: how many rules and notices name 340B, which are open for comment, and the next federal dates.',
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
      return {
        place: state,
        laws: { count: laws.length, by_kind: count(laws, (l) => l.kinds), list: laws.map((l) => ({ law_id: l.law_id, citation: l.citation, kinds: l.kinds })) },
        bills: { count: bills.length, by_stage: count(bills, (b) => stageGroup(b.stage)), became_law: bills.filter((b) => b.stage === 'Became law').map((b) => ({ bill_id: b.bill_id, bill: b.bill, title: b.title })) },
        coming_up: coming.slice(0, 5).map(briefEvent),
        pages: {
          ...(laws.length ? { laws: `${SITE}/laws/${place(state)}/` } : {}),
          ...(bills.length ? { bills: `${SITE}/bills/${place(state)}/` } : {}),
          calendar: `${SITE}/calendar/${place(state)}/`,
          // Congress writes the bills; the agencies' rules and notices are their own place, FED.
          ...(state === 'US' ? { federal_notices: `${SITE}/notices/` } : {}),
        },
        retrieved: t.billsRetrieved,
        note: CAUTION,
      };
    },
  },
  {
    name: 'about_the_data',
    title: 'About these tables',
    description: 'What the tables hold, where each comes from, when each was last brought up to date, the licence, and where to download them whole.',
    inputSchema: { type: 'object', additionalProperties: false },
    run(t) {
      return {
        what: 'Open tables about the federal 340B drug pricing program, from ClinX (clinx.org): state laws on the books that name 340B, bills in Congress and the state legislatures that name it, rules and notices federal agencies have published in the Federal Register that name it, and a calendar of the bills\' dated steps, session days and the notices\' dates.',
        counts: { laws: t.laws.length, bills: t.bills.length, notices: t.notices.length, calendar_dates: t.events.length },
        up_to_date_as_of: { laws: `dataset version ${t.lawsVersion}`, bills: t.billsRetrieved, notices: t.noticesRetrieved, calendar: t.eventsRetrieved },
        today: t.today,
        sources: 'Laws: each state\'s own code or session laws. Bills in Congress: the Government Publishing Office\'s bulk files. State bills: each legislature\'s record as gathered by Open States, with the text read on the legislature\'s own site. Federal rules and notices: the Federal Register\'s own data service. Every row links to its official page.',
        places: 'A two-letter code for a state, US for Congress, FED for federal agencies.',
        law_kinds: t.lawKinds,
        bill_kinds: t.billKinds,
        notice_types: t.noticeTypes,
        notice_roles: t.noticeRoles,
        calendar_kinds: t.eventKinds,
        licence: `${t.licence}. Free to copy, share and build on with credit.`,
        downloads: `${SITE}/data/`,
        limits: 'A bill is listed only when its title, official summary or text names the program. Summaries are written by a person reading the text and may trail a newer version of a bill. Hearings appear once a legislature posts an agenda naming a listed bill. A federal rule or notice is listed when its text names the program; one nobody has read yet carries the Federal Register\'s facts and no summary. "Coming up" and "open for comment" go by today\'s date, so check up_to_date_as_of for how fresh each table is. ' + CAUTION,
      };
    },
  },
].map((tool) => ({ ...tool, annotations: READ_ONLY }));
