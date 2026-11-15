import { describe, expect, it } from 'vitest';
import { EVENT_COLUMNS, EVENT_KINDS as SHAPE_KINDS, billsProblems } from '../scripts/bills-shape.mjs';
import { CONGRESS, parseBills } from '../src/lib/bills';
import { EVENT_KINDS, byMonth, byYear, calendarFile, calendarFilePath, calendarPath, comingUp, eventTitle, eventsOf, fileEvents, isSessionDay, kindLabel, latestSteps, parseEvents, past, placesWithEvents, weekdayOf } from '../src/lib/calendar';

// The calendar is read from the copy this site was built from, so these tests follow the real table.
const modules = import.meta.glob('../src/data/bills/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const files = Object.fromEntries(Object.entries(modules).map(([path, text]) => [path.split('/').pop()!, text]));
delete files['SOURCE.json'];
const data = parseEvents(files['340b-events.json']!);
const bills = parseBills(files['340b-bills.json']!);

describe('the calendar table', () => {
  it('is what the shape check expects, and the reader and the check agree on the kinds and columns', () => {
    expect(billsProblems(files)).toEqual([]);
    expect([...EVENT_KINDS]).toEqual(SHAPE_KINDS);
    expect(Object.keys(JSON.parse(files['340b-events.json']!).events[0])).toEqual(EVENT_COLUMNS);
    expect([...data.kindNotes.keys()]).toEqual([...EVENT_KINDS]);
  });

  it('is in day order, and every event of a bill points at a bill in the bills table', () => {
    const days = data.events.map((e) => e.day);
    expect(days).toEqual([...days].sort());
    const known = new Set(bills.bills.map((b) => b.billId));
    for (const event of data.events) {
      if (isSessionDay(event)) expect(event.billId).toBe('');
      else expect(known.has(event.billId)).toBe(true);
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
    expect(places[0]).toBe(CONGRESS);
    expect(new Set(places)).toEqual(new Set(data.events.map((e) => e.place)));
    expect(eventsOf(data, 'RI').every((e) => e.place === 'RI')).toBe(true);
  });

  it('lists the newest steps of bills, newest first, never a session day', () => {
    const steps = latestSteps(data, 12);
    expect(steps).toHaveLength(12);
    expect(steps.some(isSessionDay)).toBe(false);
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

  it('reaches back two months for every place together, and a year for one place', () => {
    const all = fileEvents(data);
    const one = fileEvents(data, CONGRESS);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((e) => e.day >= '2026-01-01')).toBe(true);
    expect(one.every((e) => e.place === CONGRESS)).toBe(true);
    expect(one.length).toBeGreaterThanOrEqual(all.filter((e) => e.place === CONGRESS).length);
  });
});
