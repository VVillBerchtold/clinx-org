/**
 * Bills that name the 340B program, in Congress and in the state legislatures, read from the bills
 * table (src/data/bills/340b-bills.json, copied in by scripts/sync-bills.mjs).
 *
 * In plain words: a bill is a proposal; most never become law. The table lists every bill whose
 * title, official summary or official text names the program, with how far it has got and links to
 * the legislature's own pages. This file reads that table for the site: the bills of one place,
 * their order on a page, a five-step measure of how far a bill has got, and a map of the states
 * that have one. Nothing here adds to or changes what the table says.
 */
import { LAW_KINDS, lawsPath, type LawKind } from './laws';
import { STATES, TILE, stateName, type StateTile } from './states';

/** Congress, in the table's place column. Every other place is a state's two letters. */
export const CONGRESS = 'US';

export const BILL_ROLES = ['main', 'part', 'mention'] as const;
/** What a bill is to the program: about it, changes it in one part, or only names it in passing. */
export type BillRole = (typeof BILL_ROLES)[number];

export const NAMED_IN = ['title', 'summary', 'text', 'earlier text'] as const;
export type NamedIn = (typeof NAMED_IN)[number];

export interface Bill {
  billId: string;
  /** "US" for Congress, else a state's two letters. */
  place: string;
  session: string;
  /** The day the session ends or ended (ISO). */
  sessionEnd: string;
  /** The bill's number as the legislature writes it, for example "H.R. 5256" or "SB 114". */
  bill: string;
  title: string;
  /** Blank until a person has read the bill. */
  role: BillRole | '';
  kinds: readonly LawKind[];
  /** One plain sentence on what the bill would do. Blank until a person has read the bill. */
  summary: string;
  namedIn: readonly NamedIn[];
  /** How many times the text that was read names the program; null where no text was read. */
  textMentions: number | null;
  /** The first passage that names the program. */
  quote: string;
  introducedDate: string;
  sponsor: string;
  cosponsors: number | null;
  /** How far the bill has got, for example "Introduced" or "Passed the Senate". Blank where no step is recorded. */
  stage: string;
  stageDate: string;
  failedVote: string;
  latestActionDate: string;
  /** The latest step, in the legislature's own words. */
  latestAction: string;
  /** The law it became, where the record gives a number. */
  law: string;
  billUrl: string;
  textVersion: string;
  textUrl: string;
  retrieved: string;
}

export interface BillsData {
  /** The day the table was last built (ISO). */
  retrieved: string;
  roleLabels: ReadonlyMap<BillRole, string>;
  bills: readonly Bill[];
}

type Raw = Record<string, unknown>;

const text = (row: Raw, key: string): string => {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`Bills file: "${key}" is not text`);
  return value;
};
const count = (row: Raw, key: string): number | null => {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error(`Bills file: "${key}" is not a whole number`);
  return value;
};
function oneOf<T extends string>(known: readonly T[], value: unknown, what: string): T {
  if (typeof value !== 'string' || !(known as readonly string[]).includes(value)) throw new Error(`Bills file: unknown ${what} "${String(value)}"`);
  return value as T;
}
const listOf = (row: Raw, key: string): unknown[] => {
  const value = row[key];
  if (!Array.isArray(value)) throw new Error(`Bills file: "${key}" is not a list`);
  return value;
};

/** Reads the bills document. Throws on anything it does not expect, so a changed file stops the build. */
export function parseBills(json: string): BillsData {
  const document = JSON.parse(json) as Raw;
  const roleLabels = new Map((listOf(document, 'roles') as Raw[]).map((r) => [oneOf(BILL_ROLES, r['role'], 'role'), text(r, 'label')]));
  const bills = (listOf(document, 'bills') as Raw[]).map((r): Bill => {
    const place = text(r, 'jurisdiction');
    if (place !== CONGRESS) stateName(place);
    const role = text(r, 'role');
    const bill: Bill = {
      billId: text(r, 'bill_id'),
      place,
      session: text(r, 'session'),
      sessionEnd: text(r, 'session_end'),
      bill: text(r, 'bill'),
      title: text(r, 'title'),
      role: role === '' ? '' : oneOf(BILL_ROLES, role, 'role'),
      kinds: listOf(r, 'kinds').map((k) => oneOf(LAW_KINDS, k, 'kind')),
      summary: text(r, 'summary'),
      namedIn: listOf(r, 'names_program_in').map((w) => oneOf(NAMED_IN, w, 'place a bill names the program')),
      textMentions: count(r, 'text_mentions'),
      quote: text(r, 'quote'),
      introducedDate: text(r, 'introduced_date'),
      sponsor: text(r, 'sponsor'),
      cosponsors: count(r, 'cosponsors'),
      stage: text(r, 'stage'),
      stageDate: text(r, 'stage_date'),
      failedVote: text(r, 'failed_vote'),
      latestActionDate: text(r, 'latest_action_date'),
      latestAction: text(r, 'latest_action'),
      law: text(r, 'law'),
      billUrl: text(r, 'bill_url'),
      textVersion: text(r, 'text_version'),
      textUrl: text(r, 'text_url'),
      retrieved: text(r, 'retrieved'),
    };
    for (const url of [bill.billUrl, bill.textUrl]) {
      if (url !== '' && !/^https?:\/\//.test(url)) throw new Error(`Bills file: ${bill.billId} has a link that is not a web address`);
    }
    if (bill.billUrl === '') throw new Error(`Bills file: ${bill.billId} has no official page`);
    return bill;
  });
  return { retrieved: text(document, 'retrieved'), roleLabels, bills };
}

let cached: BillsData | undefined;

/** The bills table this site was built from. */
export function getBills(): BillsData {
  if (cached) return cached;
  const modules = import.meta.glob('../data/bills/340b-bills.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const json = Object.values(modules)[0];
  if (json === undefined) throw new Error('src/data/bills/340b-bills.json is missing. Run: npm run sync:bills');
  cached = parseBills(json);
  return cached;
}

export interface BillsRecord {
  retrieved: string;
  bills: number;
  /** How many dates the calendar made from the table holds. */
  events: number;
  /** Each file of the table and its SHA-256, as copied into this site. */
  files: Readonly<Record<string, string>>;
}

/** Where this site's copy of the bills table came from (written by scripts/sync-bills.mjs). */
export function getBillsRecord(): BillsRecord {
  const modules = import.meta.glob('../data/bills/SOURCE.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const json = Object.values(modules)[0];
  if (json === undefined) throw new Error('src/data/bills/SOURCE.json is missing. Run: npm run sync:bills');
  return JSON.parse(json) as BillsRecord;
}

/** The address of the page of all bills. */
export const BILLS_HOME = '/bills/';

/** The address of one place's bills: /bills/congress/ or /bills/ri/. */
export function billsPath(place: string): string {
  return `${BILLS_HOME}${place === CONGRESS ? 'congress' : place.toLowerCase()}/`;
}

/** "Congress", or the state's name. */
export function placeName(place: string): string {
  return place === CONGRESS ? 'Congress' : stateName(place);
}

/** The address of one bill: its card on its place's page. */
export function billHref(bill: Bill): string {
  return `${billsPath(bill.place)}#${bill.billId}`;
}

/** States with at least one listed bill, A to Z by name. */
export function statesWithBills(data: BillsData): StateTile[] {
  const has = new Set(data.bills.map((b) => b.place));
  return [...STATES].filter((s) => has.has(s.code)).sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/** The five steps a bill is measured against, in order. */
export const STEPS = ['Introduced', 'Committee', 'One chamber', 'Both chambers', 'Law'] as const;

/**
 * How far along the five steps a bill is: 0 where no step is recorded, 5 where it became law.
 * A vetoed bill passed both chambers, so it stands at 4.
 */
export function stepOf(bill: Bill): number {
  const stage = bill.stage;
  if (stage === '') return 0;
  if (stage === 'Introduced') return 1;
  if (stage === 'Reported by committee') return 2;
  if (stage === 'Became law') return 5;
  if (['Passed both chambers', 'Passed the legislature', 'Sent to the President', 'Sent to the governor', 'Vetoed'].includes(stage)) return 4;
  if (stage.startsWith('Passed the ')) return 3;
  throw new Error(`Bills file: ${bill.billId} has the stage "${stage}", which this site does not know`);
}

/** True where the bill's session was over when the table was built and the bill had not become law. */
export function sessionOver(data: BillsData, bill: Bill): boolean {
  return bill.sessionEnd < data.retrieved && stepOf(bill) < 5;
}

/**
 * Where a bill sits on its place's page. A bill a person has read goes by what it is to the
 * program; one nobody has read yet goes by where it names the program. Bills that only mention
 * the program come last, as a short list.
 */
function rank(bill: Bill): number {
  if (bill.role === 'main') return 0;
  if (bill.role === 'part') return 1;
  if (bill.role === 'mention') return 4;
  return bill.namedIn.includes('title') ? 2 : 3;
}

/** A page order for bills: by rank, then furthest along, then the newest step, then the bill's number. */
export function inPageOrder(bills: readonly Bill[]): Bill[] {
  return [...bills].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      stepOf(b) - stepOf(a) ||
      b.latestActionDate.localeCompare(a.latestActionDate) ||
      a.bill.localeCompare(b.bill, 'en', { numeric: true }),
  );
}

export interface SessionGroup {
  session: string;
  sessionEnd: string;
  /** The bills shown in full, in page order. */
  bills: Bill[];
  /** The bills that only mention the program, shown as a short list. */
  mentions: Bill[];
}

/** One place's bills by session, the session that ends last first. */
export function sessionsOf(data: BillsData, place: string): SessionGroup[] {
  const groups = new Map<string, SessionGroup>();
  for (const bill of data.bills) {
    if (bill.place !== place) continue;
    const group = groups.get(bill.session) ?? { session: bill.session, sessionEnd: bill.sessionEnd, bills: [], mentions: [] };
    (bill.role === 'mention' ? group.mentions : group.bills).push(bill);
    groups.set(bill.session, group);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, bills: inPageOrder(g.bills), mentions: inPageOrder(g.mentions) }))
    .sort((a, b) => b.sessionEnd.localeCompare(a.sessionEnd) || b.session.localeCompare(a.session, 'en', { numeric: true }));
}

/**
 * The bills with the newest recorded steps, newest first. Only bills that are about 340B: one a
 * person has read as about it or as having a part on it, or one not yet read that names it in its title.
 */
export function latestSteps(data: BillsData, howMany: number): Bill[] {
  return data.bills
    .filter((b) => b.latestActionDate !== '' && b.latestAction !== '' && (b.role === 'main' || b.role === 'part' || (b.role === '' && b.namedIn.includes('title'))))
    .sort((a, b) => b.latestActionDate.localeCompare(a.latestActionDate) || a.billId.localeCompare(b.billId))
    .slice(0, howMany);
}

/** The site a link goes to, for example "congress.gov". */
export function hostOf(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '');
}

/** Where a bill nobody has read yet names the program, in a few words. */
export function namedInWords(bill: Bill): string {
  if (bill.namedIn.includes('title')) return '340B in the title';
  if (bill.namedIn.includes('summary')) return '340B in the official summary';
  if (bill.namedIn.includes('text')) return bill.textMentions === 1 ? 'Names 340B once' : `Names 340B ${bill.textMentions} times`;
  return /amendment/i.test(bill.textVersion) ? 'Named 340B in an amendment' : 'Named 340B in an earlier version';
}

/** The state's page of enacted laws, where the laws table has one for it. */
export function lawsPageOf(place: string, statesWithLaws: ReadonlySet<string>): string | null {
  return place !== CONGRESS && statesWithLaws.has(place) ? lawsPath(place) : null;
}

const esc = (t: string): string => t.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/**
 * The map of states as inline SVG, for the bills pages. A state with a listed bill is drawn filled
 * and is a link to its page; a state with none is a plain tile. `current` marks the state whose
 * page the map is on.
 */
export function billsMapSvg(data: BillsData, id: string, options: { current?: string } = {}): string {
  const { current } = options;
  const step = TILE.size + TILE.gap;
  const pad = 10;
  const width = TILE.cols * step - TILE.gap + pad * 2;
  const height = TILE.rows * step - TILE.gap + pad * 2;
  const counts = new Map<string, number>();
  for (const bill of data.bills) counts.set(bill.place, (counts.get(bill.place) ?? 0) + 1);
  const filled = statesWithBills(data);
  const parts: string[] = [
    `<svg class="tilemap lawmap" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="group" aria-labelledby="${id}-t ${id}-d">`,
    `<title id="${id}-t">States with a bill that names 340B</title>`,
    `<desc id="${id}-d">${esc(`A grid of the 50 states and the District of Columbia. With a bill that names 340B: ${filled.map((s) => s.name).join(', ')}.`)}</desc>`,
  ];
  for (const s of STATES) {
    const x = pad + s.col * step;
    const y = pad + s.row * step;
    const n = counts.get(s.code) ?? 0;
    const rect = `<rect class="tile" x="${x}" y="${y}" width="${TILE.size}" height="${TILE.size}" rx="${TILE.radius}"/>`;
    const abbr = `<text class="abbr" x="${x + TILE.size / 2}" y="${y + TILE.size / 2 + 4.5}" text-anchor="middle">${s.code}</text>`;
    if (n === 0) {
      parts.push(`<g class="tile-g none r${s.row}">${rect}${abbr}</g>`);
      continue;
    }
    const here = s.code === current ? ' here' : '';
    const now = s.code === current ? ' aria-current="page"' : '';
    parts.push(`<a class="tile-g has${here} r${s.row}" href="${billsPath(s.code)}" aria-label="${s.code}, ${esc(s.name)}: ${n} ${n === 1 ? 'bill' : 'bills'}"${now}>${rect}${abbr}</a>`);
  }
  parts.push('</svg>');
  return parts.join('');
}
