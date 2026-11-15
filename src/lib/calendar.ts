/**
 * The 340B calendar: the dated steps of every bill in the bills table, committee hearings that have
 * one of those bills on the agenda, the days each legislature's session starts and ends, and the
 * dates of federal rules and notices (published, comments close, takes effect, and other days a
 * document sets). Read from src/data/bills/340b-events.json, copied in by scripts/sync-bills.mjs.
 *
 * In plain words: every row is one thing that happened, or is due to happen, on one day. A step of
 * a bill is in the legislature's own words and links to the legislature's own page; a date of a
 * federal notice links to its page in the Federal Register. This file reads
 * the table for the site: what is coming up, what happened and when, one place at a time, and the
 * same dates as a calendar file people can add to their own calendar. Nothing here adds to or
 * changes what the table says.
 */
import { CONGRESS, billsPath, placeName } from './bills';
import { AGENCIES, noticeHref } from './notices';
import { SITE_URL } from './site';
import { STATES, TILE, stateName, type StateTile } from './states';

/** The kinds of event: a bill's steps in the order it meets them, a hearing, a session's days, then a federal notice's days. */
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
  'notice published',
  'comments close',
  'takes effect',
  'date set by a notice',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** Kinds that belong to a legislature, not to one bill. */
const SESSION_KINDS: readonly EventKind[] = ['session starts', 'session ends'];
/** Kinds that belong to a federal rule or notice. */
const NOTICE_KINDS: readonly EventKind[] = ['notice published', 'comments close', 'takes effect', 'date set by a notice'];

export interface CalendarEvent {
  eventId: string;
  /** The day (ISO). */
  day: string;
  /** "14:30 UTC" for a hearing with a time, else blank: the event is on that day. */
  time: string;
  /** "US" for Congress, "FED" for federal agencies, else a state's two letters. */
  place: string;
  kind: EventKind;
  /** The bill the event belongs to; blank for a session's first or last day and for a notice's date. */
  billId: string;
  /** The bill's number as the legislature writes it. */
  bill: string;
  /** The federal rule or notice the date belongs to; blank for everything else. */
  noticeId: string;
  /**
   * The official words: the step as recorded, the hearing's name, the session's name, or the title
   * of the rule or notice. For a day a notice sets, what happens on it, in a few words of ours.
   */
  what: string;
  /** The chamber or committee, where the record names one; for a notice, the agency that wrote it. */
  body: string;
  /** Where a hearing is held, where the notice says. */
  where: string;
  /** The legislature's own page, or the Federal Register's. */
  link: string;
  /** Where the row comes from, in a few words. */
  source: string;
}

export interface CalendarData {
  /** The day the table was put together; "coming up" is measured from it. */
  retrieved: string;
  /** What each kind means, in a sentence. */
  kindNotes: ReadonlyMap<EventKind, string>;
  /** Every event, earliest first. */
  events: readonly CalendarEvent[];
}

type Raw = Record<string, unknown>;
const text = (row: Raw, key: string): string => {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`Calendar file: "${key}" is not text`);
  return value;
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Reads the calendar document. Throws on anything it does not expect, so a changed file stops the build. */
export function parseEvents(json: string): CalendarData {
  const document = JSON.parse(json) as Raw;
  const notes = document['kinds'];
  if (typeof notes !== 'object' || notes === null) throw new Error('Calendar file: no kinds');
  const kindOf = (value: unknown): EventKind => {
    if (!EVENT_KINDS.includes(value as EventKind)) throw new Error(`Calendar file: unknown kind of event "${String(value)}"`);
    return value as EventKind;
  };
  const kindNotes = new Map(Object.entries(notes as Raw).map(([kind, note]) => [kindOf(kind), String(note)]));
  const list = document['events'];
  if (!Array.isArray(list)) throw new Error('Calendar file: "events" is not a list');
  const events = (list as Raw[]).map((r): CalendarEvent => {
    const event: CalendarEvent = {
      eventId: text(r, 'event_id'),
      day: text(r, 'day'),
      time: text(r, 'time'),
      place: text(r, 'jurisdiction'),
      kind: kindOf(r['kind']),
      billId: text(r, 'bill_id'),
      bill: text(r, 'bill'),
      noticeId: text(r, 'notice_id'),
      what: text(r, 'what'),
      body: text(r, 'body'),
      where: text(r, 'where'),
      link: text(r, 'link'),
      source: text(r, 'source'),
    };
    if (!DAY.test(event.day)) throw new Error(`Calendar file: ${event.eventId} has no day`);
    if (event.place !== CONGRESS && event.place !== AGENCIES) stateName(event.place);
    if (!/^https?:\/\//.test(event.link)) throw new Error(`Calendar file: ${event.eventId} has no official page`);
    const ofNotice = NOTICE_KINDS.includes(event.kind);
    if (ofNotice !== (event.noticeId !== '') || ofNotice !== (event.place === AGENCIES)) throw new Error(`Calendar file: ${event.eventId} should ${ofNotice ? '' : 'not '}be a date of a federal notice`);
    const ofBill = !ofNotice && !SESSION_KINDS.includes(event.kind);
    if (ofBill !== (event.billId !== '')) throw new Error(`Calendar file: ${event.eventId} should ${ofBill ? '' : 'not '}name a bill`);
    return event;
  });
  const retrieved = text(document, 'retrieved');
  if (!DAY.test(retrieved)) throw new Error('Calendar file: no retrieved date');
  return { retrieved, kindNotes, events: [...events].sort(inOrder) };
}

/** Congress first, then federal agencies, then the states. */
const placeRank = (place: string): number => (place === CONGRESS ? 0 : place === AGENCIES ? 1 : 2);

/** Earliest first; on one day, Congress, federal agencies, then the states A to Z, a bill's steps in the order it meets them. */
function inOrder(a: CalendarEvent, b: CalendarEvent): number {
  return (
    a.day.localeCompare(b.day) ||
    placeRank(a.place) - placeRank(b.place) ||
    a.place.localeCompare(b.place) ||
    a.bill.localeCompare(b.bill, 'en', { numeric: true }) ||
    a.noticeId.localeCompare(b.noticeId) ||
    EVENT_KINDS.indexOf(a.kind) - EVENT_KINDS.indexOf(b.kind) ||
    a.eventId.localeCompare(b.eventId)
  );
}

let cached: CalendarData | undefined;

/** The calendar this site was built from. */
export function getCalendar(): CalendarData {
  if (cached) return cached;
  const modules = import.meta.glob('../data/bills/340b-events.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const json = Object.values(modules)[0];
  if (json === undefined) throw new Error('src/data/bills/340b-events.json is missing. Run: npm run sync:bills');
  cached = parseEvents(json);
  return cached;
}

/** The address of the calendar. */
export const CALENDAR_HOME = '/calendar/';

/** The last part of a place's address: "congress", "agencies" or a state's two letters. */
export function calendarSlug(place: string): string {
  return place === CONGRESS ? 'congress' : place === AGENCIES ? 'agencies' : place.toLowerCase();
}

/** The address of one place's calendar: /calendar/congress/, /calendar/agencies/ or /calendar/ri/. */
export function calendarPath(place: string): string {
  return `${CALENDAR_HOME}${calendarSlug(place)}/`;
}

/** "Congress", "Federal agencies", or the state's name. */
export function calendarPlaceName(place: string): string {
  return place === AGENCIES ? 'Federal agencies' : placeName(place);
}

/** The address of the calendar file (.ics) for every place, or for one. */
export function calendarFilePath(place?: string): string {
  return `${place === undefined ? CALENDAR_HOME : calendarPath(place)}340b.ics`;
}

/** A kind as a label: "Vote on passage". */
export function kindLabel(kind: EventKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** True for the first or last day of a session: an event of the legislature, not of one bill. */
export function isSessionDay(event: CalendarEvent): boolean {
  return SESSION_KINDS.includes(event.kind);
}

/** True for a date of a federal rule or notice. */
export function isNoticeDay(event: CalendarEvent): boolean {
  return NOTICE_KINDS.includes(event.kind);
}

/** True for a dated step of a bill: not a hearing, a session's day or a notice's date. */
export function isBillStep(event: CalendarEvent): boolean {
  return event.billId !== '' && event.kind !== 'hearing';
}

/** "Congress" or "the Texas legislature". */
export function legislatureName(place: string): string {
  return place === CONGRESS ? 'Congress' : `the ${stateName(place)} legislature`;
}

/** One place's events, earliest first. */
export function eventsOf(data: CalendarData, place: string): CalendarEvent[] {
  return data.events.filter((e) => e.place === place);
}

/** What is still ahead on the day the table was put together (that day included), soonest first. */
export function comingUp(events: readonly CalendarEvent[], today: string): CalendarEvent[] {
  return events.filter((e) => e.day >= today);
}

/** What has happened, newest first. A day that is "today" counts as coming up, not as past. */
export function past(events: readonly CalendarEvent[], today: string): CalendarEvent[] {
  return events.filter((e) => e.day < today).reverse();
}

/** The newest steps of bills anywhere and the newest federal rules and notices, newest first. */
export function latestSteps(data: CalendarData, howMany: number): CalendarEvent[] {
  return data.events
    .filter((e) => (isBillStep(e) || e.kind === 'notice published') && e.day <= data.retrieved)
    .reverse()
    .slice(0, howMany);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Tue" for a day, worked out without a time zone. */
export function weekdayOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

export interface MonthGroup {
  /** "2027-01" */
  month: string;
  /** "January 2027" */
  label: string;
  events: CalendarEvent[];
}

/** Events grouped by month, in the order given. */
export function byMonth(events: readonly CalendarEvent[]): MonthGroup[] {
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

export interface YearGroup {
  year: string;
  count: number;
  months: MonthGroup[];
}

/** Month groups gathered by year, in the order given. */
export function byYear(events: readonly CalendarEvent[]): YearGroup[] {
  const years: YearGroup[] = [];
  for (const group of byMonth(events)) {
    const year = group.month.slice(0, 4);
    let last = years[years.length - 1];
    if (!last || last.year !== year) {
      last = { year, count: 0, months: [] };
      years.push(last);
    }
    last.months.push(group);
    last.count += group.events.length;
  }
  return years;
}

/** Places with at least one event: Congress and federal agencies first where they have one, then the states A to Z by name. */
export function placesWithEvents(data: CalendarData): string[] {
  const has = new Set(data.events.map((e) => e.place));
  const states = [...STATES].filter((s: StateTile) => has.has(s.code)).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return [...[CONGRESS, AGENCIES].filter((place) => has.has(place)), ...states.map((s) => s.code)];
}

/** The address of the rule or notice a date belongs to: its entry on the notices page. */
export function eventNoticeHref(event: CalendarEvent): string {
  return noticeHref(event.noticeId);
}

/** The address of the bill an event belongs to: its card on its place's bills page. */
export function eventBillHref(event: CalendarEvent): string {
  return `${billsPath(event.place)}#${event.billId}`;
}

const esc = (t: string): string => t.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/**
 * The map of states as inline SVG, for the calendar pages. A state with an event is drawn filled
 * and is a link to its calendar; a state with none is a plain tile. `current` marks the state
 * whose page the map is on.
 */
export function calendarMapSvg(data: CalendarData, id: string, options: { current?: string } = {}): string {
  const { current } = options;
  const step = TILE.size + TILE.gap;
  const pad = 10;
  const width = TILE.cols * step - TILE.gap + pad * 2;
  const height = TILE.rows * step - TILE.gap + pad * 2;
  const has = new Set(data.events.map((e) => e.place));
  const filled = STATES.filter((s) => has.has(s.code));
  const parts: string[] = [
    `<svg class="tilemap lawmap" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="group" aria-labelledby="${id}-t ${id}-d">`,
    `<title id="${id}-t">States with dates on the 340B calendar</title>`,
    `<desc id="${id}-d">${esc(`A grid of the 50 states and the District of Columbia. On the calendar: ${[...filled].sort((a, b) => a.name.localeCompare(b.name, 'en')).map((s) => s.name).join(', ')}.`)}</desc>`,
  ];
  for (const s of STATES) {
    const x = pad + s.col * step;
    const y = pad + s.row * step;
    const rect = `<rect class="tile" x="${x}" y="${y}" width="${TILE.size}" height="${TILE.size}" rx="${TILE.radius}"/>`;
    const abbr = `<text class="abbr" x="${x + TILE.size / 2}" y="${y + TILE.size / 2 + 4.5}" text-anchor="middle">${s.code}</text>`;
    if (!has.has(s.code)) {
      parts.push(`<g class="tile-g none r${s.row}">${rect}${abbr}</g>`);
      continue;
    }
    const here = s.code === current ? ' here' : '';
    const now = s.code === current ? ' aria-current="page"' : '';
    parts.push(`<a class="tile-g has${here} r${s.row}" href="${calendarPath(s.code)}" aria-label="${s.code}, ${esc(s.name)}: 340B calendar"${now}>${rect}${abbr}</a>`);
  }
  parts.push('</svg>');
  return parts.join('');
}

// ---------- The calendar file (.ics) ----------

/** How far back a calendar file reaches, in days: everything ahead, and this much behind. */
export const FILE_REACH = { all: 60, place: 365 } as const;

/** The events that go into a calendar file: every place's recent and coming dates, or one place's last year and on. */
export function fileEvents(data: CalendarData, place?: string): CalendarEvent[] {
  const [y, m, d] = data.retrieved.split('-').map(Number) as [number, number, number];
  const from = new Date(Date.UTC(y, m - 1, d - (place === undefined ? FILE_REACH.all : FILE_REACH.place))).toISOString().slice(0, 10);
  return data.events.filter((e) => e.day >= from && (place === undefined || e.place === place));
}

/**
 * An event's one-line name in a calendar: "Rhode Island HB 5634: Vote on passage". A date of a
 * federal notice is named for what happens: "Comments close: " and the document's title, or the
 * few words that say what the day is.
 */
export function eventTitle(event: CalendarEvent): string {
  if (event.kind === 'date set by a notice') return event.what;
  if (isNoticeDay(event)) return `${kindLabel(event.kind)}: ${event.what}`;
  if (isSessionDay(event)) return `${placeName(event.place)}: ${event.kind} (${event.what})`;
  return `${placeName(event.place)} ${event.bill}: ${kindLabel(event.kind)}`;
}

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

/**
 * The events as a calendar file (iCalendar, RFC 5545) that calendar apps can open or subscribe to.
 * An event with no time is an all-day event. Every event keeps the same name from one build to the
 * next, so an app that subscribes updates its copy and does not double it.
 */
export function calendarFile(data: CalendarData, events: readonly CalendarEvent[], name: string): string {
  const compact = (day: string): string => day.replaceAll('-', '');
  const nextDay = (day: string): string => {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  };
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ClinX//340B calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsText(name)}`, `NAME:${icsText(name)}`];
  for (const event of events) {
    const page = `${SITE_URL}${calendarPath(event.place)}`;
    const details = [event.what, event.body, event.where, `Official page: ${event.link}`, `More: ${page}`].filter((part) => part !== '').join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.eventId}@clinx.org`,
      `DTSTAMP:${compact(data.retrieved)}T000000Z`,
      ...(event.time === ''
        ? [`DTSTART;VALUE=DATE:${compact(event.day)}`, `DTEND;VALUE=DATE:${compact(nextDay(event.day))}`]
        : [`DTSTART:${compact(event.day)}T${event.time.slice(0, 5).replace(':', '')}00Z`]),
      `SUMMARY:${icsText(eventTitle(event))}`,
      `DESCRIPTION:${icsText(details)}`,
      ...(event.where === '' ? [] : [`LOCATION:${icsText(event.where)}`]),
      `URL:${event.link}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(folded).join('\r\n') + '\r\n';
}
