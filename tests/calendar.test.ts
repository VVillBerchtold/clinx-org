import { describe, expect, it } from 'vitest';
import { EVENT_COLUMNS, EVENT_KINDS as SHAPE_KINDS, billsProblems } from '../scripts/bills-shape.mjs';
import { CONGRESS, parseBills } from '../src/lib/bills';
import { EVENT_KINDS, byMonth, byYear, calendarFile, calendarFilePath, calendarPath, calendarPlaceName, comingUp, eventNoticeHref, eventTitle, eventsOf, fileEvents, isBillStep, isNoticeDay, isSessionDay, kindLabel, latestSteps, parseEvents, past, placesWithEvents, weekdayOf } from '../src/lib/calendar';
import { AGENCIES, parseNotices } from '../src/lib/notices';

// The calendar is read from the copy this site was built from, so these tests follow the real table.
const modules = import.meta.glob('../src/data/bills/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const files = Object.fromEntries(Object.entries(modules).map(([path, text]) => [path.split('/').pop()!, text]));
delete files['SOURCE.json'];
const data = parseEvents(files['340b-events.json']!);
const bills = parseBills(files['340b-bills.json']!);
const notices = parseNotices(files['340b-notices.json']!);

describe('the calendar table', () => {
  it('is what the shape check expects, and the reader and the check agree on the kinds and columns', () => {
    expect(billsProblems(files)).toEqual([]);
    expect([...EVENT_KINDS]).toEqual(SHAPE_KINDS);
    expect(Object.keys(JSON.parse(files['340b-events.json']!).events[0])).toEqual(EVENT_COLUMNS);
    // 'report due' may be missing from a table made before that kind existed; every other kind is always listed.
    expect([...data.kindNotes.keys()]).toEqual(EVENT_KINDS.filter((k) => k !== 'report due' || data.kindNotes.has(k)));
  });

  it('is in day order, and every event points at its bill or its federal notice', () => {
    const days = data.events.map((e) => e.day);
    expect(days).toEqual([...days].sort());
    const known = new Set(bills.bills.map((b) => b.billId));
    const documents = new Set(notices.notices.map((n) => n.noticeId));
    for (const event of data.events) {
      if (isSessionDay(event)) expect(event.billId + event.noticeId).toBe('');
      else if (isNoticeDay(event)) expect(event.billId === '' && event.place === AGENCIES && documents.has(event.noticeId)).toBe(true);
      // A report due day is set by a law, so it may name no bill; when it names one the table holds it.
      else if (event.kind === 'report due') expect((event.billId === '' || known.has(event.billId)) && event.noticeId === '').toBe(true);
      else expect(known.has(event.billId) && event.noticeId === '').toBe(true);
      expect(event.link).toMatch(/^https?:\/\//);
      expect(event.what).not.toBe('');
    }
    expect(new Set(data.events.map((e) => e.eventId)).size).toBe(data.events.length);
  });

  it('refuses a file it does not expect', () => {
    const document = JSON.parse(files['340b-events.json']!);
    const broken = (change: (event: Record<string, unknown>) => void): string => {
      const copy = structuredClone(document);
      change(copy.events[0]);
      return JSON.stringify(copy);
    };
    expect(() => parseEvents(broken((e) => (e['kind'] = 'party')))).toThrow(/unknown kind/);
    expect(() => parseEvents(broken((e) => (e['day'] = 'soon')))).toThrow(/no day/);
    expect(() => parseEvents(broken((e) => (e['link'] = 'somewhere')))).toThrow(/official page/);
    expect(billsProblems({ ...files, '340b-events.json': broken((e) => (e['bill_id'] = 'xx-0-none')) }).join('\n')).toMatch(/does not point at a bill/);
    expect(billsProblems({ ...files, 'events.csv': files['events.csv']!.replace('event_id,', 'id,') }).join('\n')).toMatch(/columns/);
  });

  it('refuses a date of a federal notice that is not one, or that names no notice in the table', () => {
    const document = JSON.parse(files['340b-events.json']!);
    const at = document.events.findIndex((e: Record<string, unknown>) => e['kind'] === 'comments close');
    expect(at).toBeGreaterThanOrEqual(0);
    const broken = (change: (event: Record<string, unknown>) => void): string => {
      const copy = structuredClone(document);
      change(copy.events[at]);
      return JSON.stringify(copy);
    };
    expect(() => parseEvents(broken((e) => (e['notice_id'] = '')))).toThrow(/date of a federal notice/);
    expect(() => parseEvents(broken((e) => (e['jurisdiction'] = 'US')))).toThrow(/date of a federal notice/);
    expect(() => parseEvents(broken((e) => (e['kind'] = 'introduced')))).toThrow(/date of a federal notice/);
    expect(billsProblems({ ...files, '340b-events.json': broken((e) => (e['notice_id'] = 'fr-1999-00000')) }).join('\n')).toMatch(/does not point at a notice|does not match its name/);
    expect(billsProblems({ ...files, '340b-events.json': broken((e) => (e['bill_id'] = 'us-119-hr1')) }).join('\n')).toMatch(/does not point at a notice/);
  });
});

describe('the calendar kind "report due"', () => {
  const document = JSON.parse(files['340b-events.json']!);
  const base = document.events.find((e: Record<string, unknown>) => e['kind'] === 'introduced');
  /** A table with one report-due date added, naming the bill of an existing step or none. */
  const withReportDue = (bill: boolean, listed: boolean): { json: string; copy: Record<string, unknown> } => {
    const copy = structuredClone(document);
    const event = { ...structuredClone(base), event_id: `${base.event_id}-report`, kind: 'report due', what: 'Annual report due to the department', ...(bill ? {} : { bill_id: '', bill: '' }) };
    copy.events.push(event);
    if (listed) copy.kinds = { ...copy.kinds, 'report due': 'A day a report is due.' };
    return { json: JSON.stringify(copy), copy };
  };

  it('is a known kind, with a plain label, and today\'s table needs neither it nor a note for it', () => {
    expect(EVENT_KINDS).toContain('report due');
    expect(kindLabel('report due')).toBe('Report due');
    expect(billsProblems(files)).toEqual([]);
    expect(data.events.some((e) => e.kind === 'report due')).toBe(data.kindNotes.has('report due'));
  });

  it('is read, with or without a bill, and the shape check accepts both forms of the table', () => {
    for (const bill of [true, false]) {
      for (const listed of [true, false]) {
        const { json } = withReportDue(bill, listed);
        const read = parseEvents(json);
        const added = read.events.find((e) => e.kind === 'report due')!;
        expect(added.billId === '').toBe(!bill);
        expect(isBillStep(added)).toBe(bill);
        expect(eventTitle(added)).toContain('Report due');
        // The CSV copy gets one more row, so it still has as many rows as the JSON file has events.
        expect(billsProblems({ ...files, '340b-events.json': json, 'events.csv': `${files['events.csv']!.trimEnd()}\nextra\n` })).toEqual([]);
      }
    }
  });

  it('still refuses a report due that names a bill the table does not hold', () => {
    const { copy } = withReportDue(true, true);
    (copy['events'] as Record<string, unknown>[]).at(-1)!['bill_id'] = 'xx-0-none';
    expect(billsProblems({ ...files, '340b-events.json': JSON.stringify(copy) }).join('\n')).toMatch(/does not point at a bill/);
  });
});

describe('reading the calendar', () => {
  it('splits what is coming up from what has happened, on the day the table was made', () => {
    const ahead = comingUp(data.events, data.retrieved);
    const behind = past(data.events, data.retrieved);
    expect(ahead.length + behind.length).toBe(data.events.length);
    expect(ahead.every((e) => e.day >= data.retrieved)).toBe(true);
    expect(behind.every((e) => e.day < data.retrieved)).toBe(true);
    expect(behind.map((e) => e.day)).toEqual([...behind.map((e) => e.day)].sort().reverse());
  });

  it('groups by month and by year without losing or reordering a date', () => {
    const months = byMonth(data.events);
    expect(months.flatMap((m) => m.events)).toEqual([...data.events]);
    expect(months.every((m) => m.events.every((e) => e.day.startsWith(m.month)))).toBe(true);
    expect(byMonth([{ ...data.events[0]!, day: '2027-01-04' }])[0]!.label).toBe('January 2027');
    const years = byYear(data.events);
    expect(years.reduce((sum, y) => sum + y.count, 0)).toBe(data.events.length);
    expect(years.map((y) => y.year)).toEqual([...new Set(data.events.map((e) => e.day.slice(0, 4)))]);
  });

  it('names days, kinds, places and addresses', () => {
    expect(weekdayOf('2026-11-15')).toBe('Sun');
    expect(weekdayOf('2027-01-04')).toBe('Mon');
    expect(kindLabel('vote on passage')).toBe('Vote on passage');
    expect(calendarPath(CONGRESS)).toBe('/calendar/congress/');
    expect(calendarPath('RI')).toBe('/calendar/ri/');
    expect(calendarFilePath()).toBe('/calendar/340b.ics');
    expect(calendarFilePath('RI')).toBe('/calendar/ri/340b.ics');
    const places = placesWithEvents(data);
    expect(places.slice(0, 2)).toEqual([CONGRESS, AGENCIES]);
    expect(calendarPath(AGENCIES)).toBe('/calendar/agencies/');
    expect(calendarFilePath(AGENCIES)).toBe('/calendar/agencies/340b.ics');
    expect(calendarPlaceName(AGENCIES)).toBe('Federal agencies');
    expect(calendarPlaceName('RI')).toBe('Rhode Island');
    expect(new Set(places)).toEqual(new Set(data.events.map((e) => e.place)));
    expect(eventsOf(data, 'RI').every((e) => e.place === 'RI')).toBe(true);
  });

  it('lists the newest steps of bills and the newest federal notices, newest first, never a session day or a deadline', () => {
    const steps = latestSteps(data, 12);
    expect(steps).toHaveLength(12);
    expect(steps.some(isSessionDay)).toBe(false);
    expect(steps.every((e) => isBillStep(e) || e.kind === 'notice published')).toBe(true);
    expect(steps.every((e) => e.day <= data.retrieved)).toBe(true);
    expect(steps.map((e) => e.day)).toEqual([...steps.map((e) => e.day)].sort().reverse());
  });
});

describe('the calendar file', () => {
  const sessionDay = data.events.find(isSessionDay)!;
  const step = data.events.find((e) => !isSessionDay(e))!;

  it('holds one event for each date, each with a name that does not change', () => {
    const events = fileEvents(data, 'TX');
    const file = calendarFile(data, events, 'ClinX 340B calendar: Texas');
    expect(file.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(file.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(file.match(/BEGIN:VEVENT/g) ?? []).toHaveLength(events.length);
    expect(file.match(/END:VEVENT/g) ?? []).toHaveLength(events.length);
    for (const event of events) expect(file).toContain(`UID:${event.eventId}@clinx.org`);
    expect(events.every((e) => e.place === 'TX')).toBe(true);
  });

  it('writes a day with no time as an all-day event and a hearing with a time in UTC', () => {
    const allDay = calendarFile(data, [{ ...step, day: '2027-02-28', time: '' }], 'x');
    expect(allDay).toContain('DTSTART;VALUE=DATE:20270228\r\nDTEND;VALUE=DATE:20270301');
    const timed = calendarFile(data, [{ ...step, kind: 'hearing', day: '2027-02-28', time: '14:30 UTC', where: 'Room 101' }], 'x');
    expect(timed).toContain('DTSTART:20270228T143000Z');
    expect(timed).toContain('LOCATION:Room 101');
  });

  it('keeps lines to 75 bytes and escapes commas, semicolons and line breaks', () => {
    const file = calendarFile(data, [{ ...step, what: 'Read; passed, 30 to 2. '.repeat(12) }], 'A, B; C');
    for (const line of file.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(file).toContain('X-WR-CALNAME:A\\, B\\; C');
    expect(file.replaceAll('\r\n ', '')).toContain('Read\\; passed\\, 30 to 2.');
  });

  it('names an event by its place, its bill and what happened', () => {
    expect(eventTitle({ ...step, place: 'RI', bill: 'HB 5634', kind: 'vote on passage' })).toBe('Rhode Island HB 5634: Vote on passage');
    expect(eventTitle({ ...sessionDay, place: 'TX', kind: 'session starts', what: '90th Legislature (2027)' })).toBe('Texas: session starts (90th Legislature (2027))');
  });

  it('names a date of a federal notice for what happens on it', () => {
    const closes = data.events.find((e) => e.kind === 'comments close')!;
    const set = data.events.find((e) => e.kind === 'date set by a notice')!;
    expect(eventTitle(closes)).toBe(`Comments close: ${closes.what}`);
    expect(eventTitle(set)).toBe(set.what);
    expect(eventNoticeHref(closes)).toBe(`/notices/#${closes.noticeId}`);
    const file = calendarFile(data, fileEvents(data, AGENCIES), 'x');
    expect(file).toContain(`SUMMARY:${'Comments close: '.slice(0, 14)}`);
    expect(fileEvents(data, AGENCIES).every((e) => e.place === AGENCIES && e.link.startsWith('https://www.federalregister.gov/'))).toBe(true);
  });

  it('reaches back two months for every place together, and a year for one place', () => {
    const all = fileEvents(data);
    const one = fileEvents(data, CONGRESS);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((e) => e.day >= '2026-01-01')).toBe(true);
    expect(one.every((e) => e.place === CONGRESS)).toBe(true);
    expect(one.length).toBeGreaterThanOrEqual(all.filter((e) => e.place === CONGRESS).length);
  });
});
