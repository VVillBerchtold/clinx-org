/**
 * Federal rules, proposed rules and notices that name the 340B program, read from the notices table
 * (src/data/bills/340b-notices.json, copied in by scripts/sync-bills.mjs).
 *
 * In plain words: federal agencies publish what they decide, and what they propose to decide, in
 * the Federal Register. The table lists every such document since January 2025 whose text names the
 * program: the official facts as the Federal Register gives them (title, agency, the day it was
 * published, the day comments close, the day it takes effect), and one plain sentence, written by a
 * person who read it, on what it does about 340B. This file reads that table for the site. Nothing
 * here adds to or changes what the table says.
 */
import { BILL_ROLES, type BillRole } from './bills';

/** Federal agencies, in the calendar's place column. Congress is "US"; this is the rule-writing side. */
export const AGENCIES = 'FED';

/** The Federal Register's kinds of document. */
export const NOTICE_TYPES = ['Rule', 'Proposed Rule', 'Notice', 'Presidential Document'] as const;
export type NoticeType = (typeof NOTICE_TYPES)[number];

const NAMED_IN = ['title', 'summary', 'text'] as const;
type NamedIn = (typeof NAMED_IN)[number];

/** A day the document itself sets, read in it by Claude. */
export interface NoticeDate {
  day: string;
  /** What happens on the day, in our words. */
  what: string;
  /** The document's own words for it. */
  words: string;
}

export interface Notice {
  /** "fr-" and the Federal Register's document number, for example "fr-2026-15633". */
  noticeId: string;
  documentNumber: string;
  /** Where it is printed, for example "91 FR 48883". */
  citation: string;
  type: NoticeType;
  /** The Federal Register's line on what the document is, for example "Final rule." */
  action: string;
  /** The department first, then the agency that wrote it. */
  agencies: readonly string[];
  title: string;
  /** Blank until Claude has read the document. */
  role: BillRole | '';
  /** One plain sentence on what the document does about 340B. Blank until Claude has read it. */
  summary: string;
  namedIn: readonly NamedIn[];
  /** How many times the text names the program. */
  textMentions: number;
  /** The first passage of the text that names the program. */
  quote: string;
  published: string;
  /** The last day for public comments, where the Federal Register gives one. */
  commentsClose: string;
  /** The effective date, where the Federal Register gives one. */
  effective: string;
  /** The Federal Register's own words about dates. */
  dates: string;
  docket: string;
  noticeUrl: string;
  pdfUrl: string;
  datesRead: readonly NoticeDate[];
}

export interface NoticesData {
  /** The day the table was last built (ISO). */
  retrieved: string;
  roleLabels: ReadonlyMap<BillRole, string>;
  /** Every listed document, newest first. */
  notices: readonly Notice[];
}

type Raw = Record<string, unknown>;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const text = (row: Raw, key: string): string => {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`Notices file: "${key}" is not text`);
  return value;
};
const listOf = (row: Raw, key: string): unknown[] => {
  const value = row[key];
  if (!Array.isArray(value)) throw new Error(`Notices file: "${key}" is not a list`);
  return value;
};
function oneOf<T extends string>(known: readonly T[], value: unknown, what: string): T {
  if (typeof value !== 'string' || !(known as readonly string[]).includes(value)) throw new Error(`Notices file: unknown ${what} "${String(value)}"`);
  return value as T;
}
const dayOrBlank = (row: Raw, key: string): string => {
  const value = text(row, key);
  if (value !== '' && !DAY.test(value)) throw new Error(`Notices file: "${key}" is not a date`);
  return value;
};

/** Reads the notices document. Throws on anything it does not expect, so a changed file stops the build. */
export function parseNotices(json: string): NoticesData {
  const document = JSON.parse(json) as Raw;
  const roleLabels = new Map((listOf(document, 'roles') as Raw[]).map((r) => [oneOf(BILL_ROLES, r['role'], 'role'), text(r, 'label')]));
  const notices = (listOf(document, 'notices') as Raw[]).map((r): Notice => {
    const role = text(r, 'role');
    const mentions = r['text_mentions'];
    if (typeof mentions !== 'number' || !Number.isInteger(mentions) || mentions < 0) throw new Error('Notices file: "text_mentions" is not a whole number');
    const notice: Notice = {
      noticeId: text(r, 'notice_id'),
      documentNumber: text(r, 'document_number'),
      citation: text(r, 'citation'),
      type: oneOf(NOTICE_TYPES, r['type'], 'type'),
      action: text(r, 'action'),
      agencies: listOf(r, 'agencies').map(String),
      title: text(r, 'title'),
      role: role === '' ? '' : oneOf(BILL_ROLES, role, 'role'),
      summary: text(r, 'summary'),
      namedIn: listOf(r, 'names_program_in').map((w) => oneOf(NAMED_IN, w, 'place a document names the program')),
      textMentions: mentions,
      quote: text(r, 'quote'),
      published: text(r, 'published'),
      commentsClose: dayOrBlank(r, 'comments_close'),
      effective: dayOrBlank(r, 'effective'),
      dates: text(r, 'dates'),
      docket: text(r, 'docket'),
      noticeUrl: text(r, 'notice_url'),
      pdfUrl: text(r, 'pdf_url'),
      datesRead: (listOf(r, 'dates_read') as Raw[]).map((d) => ({ day: text(d, 'day'), what: text(d, 'what'), words: text(d, 'words') })),
    };
    if (!DAY.test(notice.published)) throw new Error(`Notices file: ${notice.noticeId} has no day of publication`);
    if (notice.agencies.length === 0) throw new Error(`Notices file: ${notice.noticeId} has no agency`);
    if (!/^https:\/\//.test(notice.noticeUrl)) throw new Error(`Notices file: ${notice.noticeId} has no official page`);
    if (notice.pdfUrl !== '' && !/^https:\/\//.test(notice.pdfUrl)) throw new Error(`Notices file: ${notice.noticeId} has a link that is not a web address`);
    for (const date of notice.datesRead) if (!DAY.test(date.day)) throw new Error(`Notices file: ${notice.noticeId} sets a date that is not a day`);
    return notice;
  });
  const retrieved = text(document, 'retrieved');
  if (!DAY.test(retrieved)) throw new Error('Notices file: no retrieved date');
  return { retrieved, roleLabels, notices: [...notices].sort((a, b) => b.published.localeCompare(a.published) || b.noticeId.localeCompare(a.noticeId)) };
}

let cached: NoticesData | undefined;

/** The notices table this site was built from. */
export function getNotices(): NoticesData {
  if (cached) return cached;
  const modules = import.meta.glob('../data/bills/340b-notices.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const json = Object.values(modules)[0];
  if (json === undefined) throw new Error('src/data/bills/340b-notices.json is missing. Run: npm run sync:bills');
  cached = parseNotices(json);
  return cached;
}

/** The address of the page of federal notices. */
export const NOTICES_HOME = '/notices/';

/** The address of one document: its entry on the notices page. */
export function noticeHref(noticeId: string): string {
  return `${NOTICES_HOME}#${noticeId}`;
}

/** A kind of document as a label: "Final rule", "Proposed rule", "Notice", "Presidential document". */
export function typeLabel(type: NoticeType): string {
  if (type === 'Rule') return 'Final rule';
  if (type === 'Proposed Rule') return 'Proposed rule';
  return type === 'Notice' ? 'Notice' : 'Presidential document';
}

/** What each kind of document is, in a sentence. */
export const TYPE_NOTES: Readonly<Record<NoticeType, string>> = {
  Rule: 'A decision with the force of law. It applies from the day it takes effect.',
  'Proposed Rule': 'A draft of a rule, published so the public can comment before the agency decides.',
  Notice: 'An announcement: a program an agency is opening, a form it wants approved, a request for views.',
  'Presidential Document': 'An order or proclamation signed by the President.',
};

/** The agency that wrote the document: the last one named, for example "Health Resources and Services Administration". */
export function writerOf(notice: Notice): string {
  return notice.agencies[notice.agencies.length - 1]!;
}

/**
 * Where a document sits on the notices page: 0 about 340B, 1 with a part on it, 2 only mentions it.
 * A document Claude has read goes by what it found; one nobody has read yet goes by whether
 * its title names the program.
 */
export function rankOf(notice: Notice): 0 | 1 | 2 {
  if (notice.role === 'main') return 0;
  if (notice.role === 'mention') return 2;
  if (notice.role === 'part') return 1;
  return notice.namedIn.includes('title') ? 0 : 1;
}

/** Where a document nobody has read yet names the program, in a few words. */
export function namedInWords(notice: Notice): string {
  if (notice.namedIn.includes('title')) return '340B in the title';
  if (notice.namedIn.includes('summary')) return '340B in the official summary';
  return notice.textMentions === 1 ? 'Names 340B once' : `Names 340B ${notice.textMentions} times`;
}

/** True while the public can still comment: the last day for comments has not passed. */
export function openForComment(notice: Notice, today: string): boolean {
  return notice.commentsClose !== '' && notice.commentsClose >= today;
}

/** The notice that opened the rebate pilot of 2027, by its Federal Register document number. */
export const PILOT_NOTICE = 'fr-2026-15633';

/** The day the rebate pilot starts, as the Federal Register gives it; blank if the table does not have it. */
export function pilotStart(data: NoticesData): string {
  return data.notices.find((n) => n.noticeId === PILOT_NOTICE)?.effective ?? '';
}
