/**
 * The funding and deadline calendar of the health centers section: the funding opportunities HRSA
 * has forecast or posted on Grants.gov, the Federal Register documents that name health centers,
 * and the dated events of both. Read from src/data/health-centers/funding/, copied in by
 * scripts/hc/funding.mjs (node scripts/sync-health-centers.mjs funding).
 *
 * In plain words: every row is one date the agency gives, with the agency's own words and a link to
 * the agency's own page. A date HRSA labels as estimated is marked estimated wherever it appears.
 * This file reads the files for the site and draws the same dates as a calendar file. Nothing here
 * adds to, rounds or changes a value the agency published, and nothing is ranked or compared.
 */
import { SITE_URL } from './site';
import { weekdayOf } from './calendar';

export const FUNDING_HOME = '/health-centers/funding/';
export const FUNDING_FEED = '/health-centers/funding.ics';
export const FUNDING_DATA = '/data/health-centers/funding/';

/** The six downloads, each with the plain sentence the page gives beside it. */
export const DOWNLOADS = [
  { name: 'opportunities.json', what: 'The HRSA opportunities, with every date, amount and text as published, and the same text as HRSA wrote it (with its markup).' },
  { name: 'opportunities.csv', what: 'The same opportunities as a table, one row for each, in plain text.' },
  { name: 'deadlines.json', what: 'The dated events of the calendar.' },
  { name: 'deadlines.csv', what: 'The dated events of the calendar as a table.' },
  { name: 'register.json', what: 'The Federal Register documents the two questions found.' },
  { name: 'register.csv', what: 'The same documents as a table.' },
] as const;
export type DownloadName = (typeof DOWNLOADS)[number]['name'];

/** The kinds of dated event, in the order the pages list them. */
export const KINDS = ['notice expected', 'application due', 'award expected', 'comments close', 'takes effect'] as const;
export type Kind = (typeof KINDS)[number];

/** "Application due". */
export function kindLabel(kind: Kind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** What each kind of date is, in a sentence. */
export const KIND_NOTES: Readonly<Record<Kind, string>> = {
  'notice expected': 'The day HRSA expects to post the funding notice, from a forecast.',
  'application due': 'The day applications are due: HRSA’s estimate in a forecast, or the day stated in a posted notice.',
  'award expected': 'The day HRSA expects to make awards, from a forecast.',
  'comments close': 'The last day the Federal Register document takes comments.',
  'takes effect': 'The day the Federal Register document says its rule or notice takes effect.',
};

export interface Stamp {
  /** The agency's text for the day, as published. */
  asPublished: string;
  /** The day it names (ISO). */
  date: string;
}
export interface Amount {
  asPublished: string;
  /** The exact whole number when the published text is only digits, else null. */
  value: number | null;
}
export interface Opportunity {
  id: string;
  number: string;
  title: string;
  /** "forecasted" or "posted", HRSA's own word. */
  status: 'forecasted' | 'posted';
  documentKind: 'forecast' | 'synopsis';
  category: string;
  agencyName: string;
  grantsGovUrl: string;
  listings: readonly { number: string; programTitle: string }[];
  healthCenterProgram: boolean;
  namesHealthCenters: boolean;
  matchedTerms: readonly string[];
  /** Every date the record gives, by its name in the file. */
  dates: Readonly<Record<string, Stamp>>;
  applicationDueNote: string;
  estimatedFunding: Amount | null;
  awardCeiling: Amount | null;
  awardFloor: Amount | null;
  numberOfAwards: Amount | null;
  costSharing: boolean;
  fiscalYear: number | null;
  applicantTypes: readonly string[];
  fundingInstruments: readonly string[];
  fundingCategories: readonly string[];
  eligibility: string;
  description: string;
  revision: number;
  changeComment: string;
  recordChangeComment: string;
  moreInformationUrl: string;
  moreInformationText: string;
  attachmentFileNames: readonly string[];
  packages: readonly { packageId: string; opens: string; closes: string }[];
}
export interface RegisterDocument {
  documentNumber: string;
  title: string;
  type: string;
  agencyNames: readonly string[];
  publicationDate: string;
  commentsCloseOn: string;
  effectiveOn: string;
  dateText: string;
  htmlUrl: string;
  /** "hrsa-health-center", "any-agency-fqhc", or both. */
  foundBy: readonly string[];
}
export interface FundingEvent {
  day: string;
  kind: Kind;
  estimated: boolean;
  title: string;
  source: 'grants.gov' | 'federal register';
  sourceId: string;
  url: string;
  /** The opportunity's status ("forecasted", "posted") or the document's type ("Notice", "Rule"). */
  status: string;
  note: string;
}
export interface FundingData {
  /** The day of the files; "ahead" and "passed" are measured from it. */
  day: string;
  opportunities: readonly Opportunity[];
  register: readonly RegisterDocument[];
  /** Every dated event, in day order as the file gives them. */
  events: readonly FundingEvent[];
  /** The counts the agency-side file states, kept to be compared with the rows. */
  stated: { opportunities: number; register: number; events: number; estimated: number; firm: number };
}

type Raw = Record<string, unknown>;
const text = (row: Raw, key: string): string => {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`Funding file: "${key}" is not text`);
  return value;
};
const list = (row: Raw, key: string): Raw[] => {
  const value = row[key];
  if (!Array.isArray(value)) throw new Error(`Funding file: "${key}" is not a list`);
  return value as Raw[];
};
const flag = (row: Raw, key: string): boolean => {
  const value = row[key];
  if (typeof value !== 'boolean') throw new Error(`Funding file: "${key}" is not true or false`);
  return value;
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const amount = (value: unknown): Amount | null => {
  if (value === null || value === undefined) return null;
  const row = value as Raw;
  const asPublished = text(row, 'as_published');
  const number = row['value'];
  return { asPublished, value: typeof number === 'number' ? number : null };
};

/** Reads the files. Throws on anything it does not expect, so a changed file stops the build. */
export function parseFunding(files: { index: string; opportunities: string; deadlines: string; register: string }): FundingData {
  const index = JSON.parse(files.index) as Raw;
  const day = text(index, 'snapshot_day');
  if (!DAY.test(day)) throw new Error('Funding file: no snapshot day');

  const opportunities = (JSON.parse(files.opportunities) as Raw[]).map((r): Opportunity => {
    const dates: Record<string, Stamp> = {};
    for (const [name, value] of Object.entries(r['dates'] as Raw)) {
      const stamp = value as Raw;
      const date = text(stamp, 'date');
      if (!DAY.test(date)) throw new Error(`Funding file: ${text(r, 'id')} date ${name} is not a day`);
      dates[name] = { asPublished: text(stamp, 'as_published'), date };
    }
    const status = text(r, 'status');
    if (status !== 'forecasted' && status !== 'posted') throw new Error(`Funding file: ${text(r, 'id')} has status ${status}`);
    const documentKind = text(r, 'document_kind');
    if (documentKind !== 'forecast' && documentKind !== 'synopsis') throw new Error(`Funding file: ${text(r, 'id')} has document kind ${documentKind}`);
    const fiscalYear = r['fiscal_year'];
    const described = (key: string): string[] => list(r, key).map((x) => text(x, 'description'));
    return {
      id: text(r, 'id'),
      number: text(r, 'number'),
      title: text(r, 'title'),
      status,
      documentKind,
      category: text(r, 'category'),
      agencyName: text(r, 'agency_name'),
      grantsGovUrl: text(r, 'grants_gov_url'),
      listings: list(r, 'listings').map((x) => ({ number: text(x, 'number'), programTitle: text(x, 'program_title') })),
      healthCenterProgram: flag(r, 'health_center_program'),
      namesHealthCenters: flag(r, 'names_health_centers'),
      matchedTerms: (r['matched_terms'] as string[]).map(String),
      dates,
      applicationDueNote: text(r, 'application_due_note'),
      estimatedFunding: amount(r['estimated_funding']),
      awardCeiling: amount(r['award_ceiling']),
      awardFloor: amount(r['award_floor']),
      numberOfAwards: amount(r['number_of_awards']),
      costSharing: flag(r, 'cost_sharing'),
      fiscalYear: typeof fiscalYear === 'number' ? fiscalYear : null,
      applicantTypes: described('applicant_types'),
      fundingInstruments: described('funding_instruments'),
      fundingCategories: described('funding_categories'),
      eligibility: text(r, 'eligibility'),
      description: text(r, 'description'),
      revision: Number(r['revision']),
      changeComment: text(r, 'change_comment'),
      recordChangeComment: text(r, 'record_change_comment'),
      moreInformationUrl: text(r, 'more_information_url'),
      moreInformationText: text(r, 'more_information_text'),
      attachmentFileNames: (r['attachment_file_names'] as string[]).map(String),
      packages: list(r, 'packages').map((p) => ({
        packageId: text(p, 'package_id'),
        opens: ((p['opening'] as Raw | null)?.['as_published'] as string | undefined) ?? '',
        closes: ((p['closing'] as Raw | null)?.['as_published'] as string | undefined) ?? '',
      })),
    };
  });

  const register = (JSON.parse(files.register) as Raw[]).map(
    (r): RegisterDocument => ({
      documentNumber: text(r, 'document_number'),
      title: text(r, 'title'),
      type: text(r, 'type'),
      agencyNames: (r['agency_names'] as string[]).map(String),
      publicationDate: text(r, 'publication_date'),
      commentsCloseOn: typeof r['comments_close_on'] === 'string' ? (r['comments_close_on'] as string) : '',
      effectiveOn: typeof r['effective_on'] === 'string' ? (r['effective_on'] as string) : '',
      dateText: text(r, 'date_text'),
      htmlUrl: text(r, 'html_url'),
      foundBy: (r['found_by'] as string[]).map(String),
    }),
  );

  const events = (JSON.parse(files.deadlines) as Raw[]).map((r): FundingEvent => {
    const kind = text(r, 'kind');
    if (!(KINDS as readonly string[]).includes(kind)) throw new Error(`Funding file: unknown kind of date "${kind}"`);
    const source = text(r, 'source');
    if (source !== 'grants.gov' && source !== 'federal register') throw new Error(`Funding file: unknown source "${source}"`);
    const event: FundingEvent = { day: text(r, 'date'), kind: kind as Kind, estimated: flag(r, 'estimated'), title: text(r, 'title'), source, sourceId: text(r, 'source_id'), url: text(r, 'url'), status: text(r, 'status'), note: text(r, 'note') };
    if (!DAY.test(event.day)) throw new Error(`Funding file: ${event.sourceId} has no day`);
    if (!/^https:\/\//.test(event.url)) throw new Error(`Funding file: ${event.sourceId} has no official page`);
    return event;
  });

  const known = new Set(opportunities.map((o) => o.id));
  const documents = new Set(register.map((r) => r.documentNumber));
  for (const e of events) {
    if (!(e.source === 'grants.gov' ? known : documents).has(e.sourceId)) throw new Error(`Funding file: the date of ${e.sourceId} names nothing in the files`);
  }
  const stated = {
    opportunities: (index['opportunities'] as Raw)['total'] as number,
    register: (index['register_documents'] as Raw)['total'] as number,
    events: (index['events'] as Raw)['total'] as number,
    estimated: (index['events'] as Raw)['estimated'] as number,
    firm: (index['events'] as Raw)['firm'] as number,
  };
  return { day, opportunities, register, events, stated };
}

let cached: FundingData | undefined;
const modules = import.meta.glob('../data/health-centers/funding/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const fileTexts = Object.fromEntries(Object.entries(modules).map(([path, body]) => [path.split('/').pop()!, body]));

/** The text of one of the copied files, or throws when the copy is missing. */
export function fundingFile(name: string): string {
  const body = fileTexts[name];
  if (body === undefined) throw new Error(`src/data/health-centers/funding/${name} is missing. Run: node scripts/sync-health-centers.mjs funding`);
  return body;
}

/** The funding data this site was built from. */
export function getFunding(): FundingData {
  if (cached) return cached;
  cached = parseFunding({ index: fundingFile('index.json'), opportunities: fundingFile('opportunities.json'), deadlines: fundingFile('deadlines.json'), register: fundingFile('register.json') });
  return cached;
}

// ---------- Addresses ----------

/** The page of one opportunity. */
export function opportunityPath(id: string): string {
  return `${FUNDING_HOME}${id}/`;
}

/** The address of one download. */
export function downloadPath(name: string): string {
  return `${FUNDING_DATA}${name}`;
}

// ---------- Words ----------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "9 March 2027", worked out without a time zone. */
export function dayText(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Not a day: ${iso}`);
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** "Tuesday 9 March 2027". */
export function longDayText(iso: string): string {
  const names: Record<string, string> = { Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };
  return `${names[weekdayOf(iso)]} ${dayText(iso)}`;
}

/** HRSA's two words for an opportunity, as a label: "Forecast" and "Posted". */
export function statusLabel(status: Opportunity['status']): string {
  return status === 'posted' ? 'Posted' : 'Forecast';
}

/** What a published money text looks like with its thousands separators and a dollar sign drawn. A text that is not only digits is returned as published. */
export function moneyText(a: Amount | null): string {
  if (a === null || a.asPublished.trim() === '') return 'Not given';
  return /^\d+$/.test(a.asPublished) ? `$${a.asPublished.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}` : a.asPublished;
}
/** A published count with thousands separators drawn; any other text as published. */
export function countText(a: Amount | null): string {
  if (a === null || a.asPublished.trim() === '') return 'Not given';
  return /^\d+$/.test(a.asPublished) ? a.asPublished.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : a.asPublished;
}

/** The names of an opportunity's dates, in the order the page lists them, and whether HRSA estimates each one. */
export const DATE_NAMES: readonly { name: string; label: string; estimated: boolean }[] = [
  { name: 'forecast_posted', label: 'Forecast posted', estimated: false },
  { name: 'est_notice_posting', label: 'Notice expected', estimated: true },
  { name: 'notice_posted', label: 'Notice posted', estimated: false },
  { name: 'est_application_due', label: 'Application due', estimated: true },
  { name: 'application_due', label: 'Application due', estimated: false },
  { name: 'original_application_due', label: 'Original application due date', estimated: false },
  { name: 'est_award', label: 'Award expected', estimated: true },
  { name: 'est_project_start', label: 'Project start expected', estimated: true },
  { name: 'earlier_est_notice_posting', label: 'Earlier forecast: notice expected', estimated: true },
  { name: 'earlier_est_application_due', label: 'Earlier forecast: application due', estimated: true },
  { name: 'earlier_est_award', label: 'Earlier forecast: award expected', estimated: true },
  { name: 'earlier_est_project_start', label: 'Earlier forecast: project start expected', estimated: true },
  { name: 'search_open', label: 'Opens, in the Grants.gov search list', estimated: false },
  { name: 'search_close', label: 'Closes, in the Grants.gov search list', estimated: false },
  { name: 'archive', label: 'Archive date', estimated: false },
  { name: 'last_changed', label: 'Last changed by HRSA', estimated: false },
];

/** The rows of the dates table of one opportunity: only the dates the record gives. */
export function opportunityDates(o: Opportunity): { label: string; estimated: boolean; stamp: Stamp }[] {
  return DATE_NAMES.filter((d) => o.dates[d.name] !== undefined).map((d) => ({ label: d.label, estimated: d.estimated, stamp: o.dates[d.name]! }));
}

/** The paragraphs of a plain text: one for each line, spaces gathered. */
export function paragraphs(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '');
}

/** The words this site's page check does not allow in a page's text. */
export const BLOCKED_WORDS = /\b(?:highest|lowest|worst|best)\b|\btop\s/i;

/**
 * True when a paragraph of the agency's text holds a word that scripts/check-dist.mjs refuses on any page.
 * The check lets exactly those paragraphs through on the funding pages, as the agency's own words, the way it
 * does for bills, notices and workbooks (scripts/hc/printed-words.mjs). With PRINT_BLOCKED_PARAGRAPHS false
 * such a paragraph would be left out of the page and the page would say so.
 */
export function isHeldBack(paragraph: string): boolean {
  return !PRINT_BLOCKED_PARAGRAPHS && BLOCKED_WORDS.test(paragraph);
}
/** Set to true when check-dist lets the funding pages print the agency's words that hold a blocked word. */
export const PRINT_BLOCKED_PARAGRAPHS = true;

/** True for a web address the page may link to. */
export function isWebAddress(value: string): boolean {
  return /^https?:\/\/[^\s<>"]+$/.test(value);
}

// ---------- Lists the pages use ----------

/** Events from the day of the files on, and events before it. */
export function ahead(data: FundingData): FundingEvent[] {
  return data.events.filter((e) => e.day >= data.day);
}
export function passed(data: FundingData): FundingEvent[] {
  return data.events.filter((e) => e.day < data.day);
}

export interface MonthGroup {
  month: string;
  label: string;
  events: FundingEvent[];
}
/** Events grouped by month, in the order given. */
export function byMonth(events: readonly FundingEvent[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const event of events) {
    const month = event.day.slice(0, 7);
    let group = groups[groups.length - 1];
    if (!group || group.month !== month) {
      group = { month, label: `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`, events: [] };
      groups.push(group);
    }
    group.events.push(event);
  }
  return groups;
}

/** The opportunity an event belongs to, or undefined for a Federal Register date. */
export function opportunityOf(data: FundingData, event: FundingEvent): Opportunity | undefined {
  return event.source === 'grants.gov' ? data.opportunities.find((o) => o.id === event.sourceId) : undefined;
}

/** The assistance listing numbers that put an opportunity under the Health Center Program, over all opportunities. */
export function programListingNumbers(data: FundingData): string[] {
  const numbers = new Set<string>();
  for (const o of data.opportunities) if (o.healthCenterProgram) for (const l of o.listings) numbers.add(l.number);
  return [...numbers].sort();
}

/** The Federal Register documents, newest publication first. */
export function registerNewestFirst(data: FundingData): RegisterDocument[] {
  return [...data.register].sort((a, b) => b.publicationDate.localeCompare(a.publicationDate) || a.documentNumber.localeCompare(b.documentNumber));
}

/** Which of the two questions found a document, in a few words. */
export function foundByText(foundBy: readonly string[]): string {
  const one = foundBy.includes('hrsa-health-center');
  const two = foundBy.includes('any-agency-fqhc');
  return one && two ? 'Both questions' : one ? 'Question 1' : 'Question 2';
}

/** An opportunity's flags as short labels, for a row. */
export function flagLabels(o: Opportunity): string[] {
  return [...(o.namesHealthCenters ? ['Names health centers'] : []), ...(o.healthCenterProgram ? ['Health Center Program listing'] : [])];
}

/** Estimated dates that fall before the day of the files. */
export function estimatedBeforeDay(data: FundingData): FundingEvent[] {
  return data.events.filter((e) => e.estimated && e.day < data.day);
}

// ---------- The calendar file (.ics) ----------

const icsText = (t: string): string => t.replaceAll('\\', '\\\\').replaceAll(';', '\\;').replaceAll(',', '\\,').replaceAll(/\r?\n/g, '\\n');

/** A line of a calendar file may be 75 bytes long; a longer one carries on, on a line that starts with a space. */
function folded(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (size + bytes > (out.length === 0 ? 75 : 74)) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += bytes;
  }
  out.push(current);
  return out.join('\r\n ');
}

/** The sentence ClinX adds to every estimated date; it is not HRSA's sentence about the date. */
export const ADDED_NOTE = 'HRSA labels this date as estimated.';

/** One event's name in a calendar: "Application due (estimated): Title". */
export function eventTitle(event: FundingEvent): string {
  return `${kindLabel(event.kind)}${event.estimated ? ' (estimated)' : ''}: ${event.title}`;
}

/** The agency's own sentence about a date, without the sentence ClinX adds. */
export function agencyNote(event: FundingEvent): string {
  return event.note.startsWith(ADDED_NOTE) ? event.note.slice(ADDED_NOTE.length).trim() : event.note.trim();
}

/** The page of ClinX that tells more about an event. */
export function eventPage(event: FundingEvent): string {
  return event.source === 'grants.gov' ? opportunityPath(event.sourceId) : FUNDING_HOME;
}

/** A name for an event that stays the same from one build to the next, so a subscribed calendar updates and does not double. */
export function eventUid(event: FundingEvent): string {
  return `funding-${event.source === 'grants.gov' ? 'grants' : 'register'}-${event.sourceId}-${event.kind.replaceAll(' ', '-')}.clinx.org`;
}

/** Every dated event as a calendar file (iCalendar, RFC 5545): all-day events, each linking to the agency's own page. */
export function fundingCalendarFile(data: FundingData): string {
  const compact = (day: string): string => day.replaceAll('-', '');
  const nextDay = (day: string): string => {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  };
  const name = 'ClinX health center funding dates';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ClinX//Health center funding dates//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsText(name)}`, `NAME:${icsText(name)}`];
  for (const event of data.events) {
    const opportunity = opportunityOf(data, event);
    const details = [
      ...(event.estimated ? ['Estimated date. HRSA gives this date in a forecast as an estimate, and HRSA can change it.'] : []),
      opportunity ? `${statusLabel(opportunity.status)} opportunity ${opportunity.number}.` : `Federal Register ${event.status.toLowerCase()}.`,
      agencyNote(event),
      `Official page: ${event.url}`,
      `More: ${SITE_URL}${eventPage(event)}`,
    ].filter((part) => part !== '');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${eventUid(event)}`,
      `DTSTAMP:${compact(data.day)}T000000Z`,
      `DTSTART;VALUE=DATE:${compact(event.day)}`,
      `DTEND;VALUE=DATE:${compact(nextDay(event.day))}`,
      `SUMMARY:${icsText(eventTitle(event))}`,
      `DESCRIPTION:${icsText(details.join('\n'))}`,
      `URL:${event.url}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(folded).join('\r\n') + '\r\n';
}
