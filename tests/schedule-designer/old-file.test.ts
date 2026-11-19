// Working hours, the kind of a person and the "works with" list were added to the saved file
// without a new version number. These tests read files with and without the new fields.

import { describe, expect, it } from 'vitest';
import { check } from '../../src/scripts/schedule-designer/engine/check';
import { overview } from '../../src/scripts/schedule-designer/engine/overview';
import { tallyClinic, tallyPerson } from '../../src/scripts/schedule-designer/engine/tally';
import type { Schedule } from '../../src/scripts/schedule-designer/engine/types';
import { LIMITS } from '../../src/scripts/schedule-designer/engine/types';
import { VERSION, validate } from '../../src/scripts/schedule-designer/engine/validate';
import { fromWorkbook, toWorkbook } from '../../src/scripts/schedule-designer/engine/workbook';
import { hasRow, openBook, savedValue, withSavedValue } from './fixtures/book';
import { REMOTE, activity, block, room, small, visit, withBlocks, withTime } from './fixtures/small';
import { team, visits } from './fixtures/team';

const BANNED = /\b(?:highest|lowest|worst|best)\b|\btop\s/i;
const DASHES = /[—–]| - /;
const ELM = room('s1', null);

/** A schedule that uses every new field: working hours, a split day, support staff, a list and time with a provider. */
const modern: Schedule = (() => {
  const s = team();
  return withBlocks(
    {
      ...s,
      people: s.people.map((person) => {
        if (person.id === 'pA') return { ...person, work: [{ day: 0, from: 480, to: 1020 }, { day: 1, from: 480, to: 720 }, { day: 1, from: 780, to: 1020 }] };
        if (person.id === 'pS') return { ...person, worksWith: ['pA', 'pB'], work: [{ day: 0, from: 480, to: 960 }] };
        return person;
      }),
    },
    [...visits('a', 'pA', 0, 480, 6), block('w1', 'pS', 0, 480, 120, withTime('pA'), ELM), block('w2', 'pS', 0, 615, 45, withTime('pB'), { kind: 'none' }), block('ad', 'pS', 0, 660, 60, activity('aAdmin'), ELM)],
  );
})();

type Loose = { people: Record<string, unknown>[]; blocks: Record<string, unknown>[] } & Record<string, unknown>;

/** A copy that a test may change, as loose as a file is. */
const copy = (s: Schedule = modern): Loose => JSON.parse(JSON.stringify(s)) as Loose;

/** The problem a changed copy gives, or nothing when it is accepted. */
function problemAfter(change: (s: Loose) => void): string | undefined {
  const s = copy();
  change(s);
  const result = validate(s);
  return 'problem' in result ? result.problem : undefined;
}

const personIn = (s: Loose, id: string): Record<string, unknown> => s.people.find((person) => person['id'] === id) ?? {};
const blockIn = (s: Loose, id: string): Record<string, unknown> => s.blocks.find((one) => one['id'] === id) ?? {};

describe('Schedule Designer: the new fields in a file', () => {
  it('keeps the version at 1', () => {
    expect(VERSION).toBe(1);
    expect(modern.version).toBe(1);
  });

  it('accepts a schedule with working hours, support staff and time with a provider, and gives back an equal copy', () => {
    const result = validate(copy());
    expect(result).toEqual({ schedule: modern });
    expect('schedule' in result && result.schedule).not.toBe(modern);
  });

  it('a person with no kind is a provider, with no list is with nobody, and with no working hours has none entered', () => {
    const s = copy(small());
    for (const person of s.people) {
      delete person['kind'];
      delete person['worksWith'];
      delete person['work'];
    }
    expect(Object.keys(s.people[0] ?? {})).not.toContain('kind');
    expect(validate(s)).toEqual({ schedule: small() });
    // Each one may be missing by itself.
    for (const field of ['kind', 'worksWith', 'work']) {
      const one = copy(small());
      for (const person of one.people) delete person[field];
      expect(validate(one)).toEqual({ schedule: small() });
    }
    // A support person may lack the list and the working hours.
    const support = copy();
    delete personIn(support, 'pT')['worksWith'];
    delete personIn(support, 'pT')['work'];
    expect(validate(support)).toEqual({ schedule: modern });
  });

  it('puts working hours in day and time order', () => {
    const s = copy();
    personIn(s, 'pA')['work'] = [{ day: 1, from: 780, to: 1020 }, { day: 0, from: 480, to: 1020 }, { day: 1, from: 480, to: 720 }];
    expect(validate(s)).toEqual({ schedule: modern });
  });

  it('puts a provider on the list of a person who has time with them, when the list fell behind', () => {
    const s = copy();
    personIn(s, 'pS')['worksWith'] = ['pB'];
    const result = validate(s);
    expect('schedule' in result && result.schedule.people.find((person) => person.id === 'pS')?.worksWith).toEqual(['pB', 'pA']);
    const none = copy();
    delete personIn(none, 'pS')['worksWith'];
    const repaired = validate(none);
    expect('schedule' in repaired && repaired.schedule.people.find((person) => person.id === 'pS')?.worksWith).toEqual(['pA', 'pB']);
  });

  it('refuses what does not fit, each with a plain reason', () => {
    const cases: [string, (s: Loose) => void, string][] = [
      ['a kind this tool does not know', (s) => (personIn(s, 'pA')['kind'] = 'nurse'), 'a person is neither a provider nor support staff'],
      ['a kind that is not text', (s) => (personIn(s, 'pA')['kind'] = null), 'a person is neither a provider nor support staff'],
      ['a provider with a list', (s) => (personIn(s, 'pA')['worksWith'] = ['pB']), 'a provider has a list of providers they work with, which only support staff have'],
      ['a list that is not a list', (s) => (personIn(s, 'pS')['worksWith'] = 'pA'), 'the list of providers one person works with is missing'],
      ['an id that is not text', (s) => (personIn(s, 'pS')['worksWith'] = [7]), 'the id of a provider a person works with is not text'],
      ['a provider listed twice', (s) => (personIn(s, 'pS')['worksWith'] = ['pA', 'pB', 'pA']), 'a person lists one provider twice among those they work with'],
      ['a support person on the list', (s) => (personIn(s, 'pS')['worksWith'] = ['pA', 'pB', 'pT']), 'a person works with someone who is not a provider in it'],
      ['the person themselves on the list', (s) => (personIn(s, 'pS')['worksWith'] = ['pA', 'pB', 'pS']), 'a person works with someone who is not a provider in it'],
      ['a person who is not in the schedule on the list', (s) => (personIn(s, 'pS')['worksWith'] = ['pA', 'pB', 'gone']), 'a person works with someone who is not a provider in it'],
      ['too many providers', (s) => (personIn(s, 'pS')['worksWith'] = Array.from({ length: LIMITS.worksWith + 1 }, (_, at) => `x${at}`)), `it has more than ${LIMITS.worksWith} providers one person works with, which is too large for this tool`],
      ['working hours that are not a list', (s) => (personIn(s, 'pA')['work'] = {}), 'the list of working hours for one person is missing'],
      ['a stretch that is not in the right form', (s) => (personIn(s, 'pA')['work'] = [[480, 1020]]), "a stretch of a person's working hours is missing or is not in the right form"],
      ['a day that is not a day', (s) => (personIn(s, 'pA')['work'] = [{ day: 7, from: 480, to: 1020 }]), 'the day of a working stretch is not a whole number from 0 to 6'],
      ['a day the schedule does not show', (s) => (personIn(s, 'pA')['work'] = [{ day: 5, from: 480, to: 1020 }]), "a person's working hours are on a day the schedule does not show"],
      ['a start that is not a number', (s) => (personIn(s, 'pA')['work'] = [{ day: 0, from: '8:00', to: 1020 }]), 'the start of a working stretch is not a whole number from 0 to 1440'],
      ['an end past midnight', (s) => (personIn(s, 'pA')['work'] = [{ day: 0, from: 480, to: 1445 }]), 'the end of a working stretch is not a whole number from 0 to 1440'],
      ['a time off the five minute step', (s) => (personIn(s, 'pA')['work'] = [{ day: 0, from: 482, to: 1020 }]), "a person's working hours are not in steps of 5 minutes"],
      ['a stretch that ends where it starts', (s) => (personIn(s, 'pA')['work'] = [{ day: 0, from: 600, to: 600 }]), "a stretch of a person's working hours ends before it starts"],
      ['a stretch that ends before it starts', (s) => (personIn(s, 'pA')['work'] = [{ day: 0, from: 600, to: 540 }]), "a stretch of a person's working hours ends before it starts"],
      ['two stretches that overlap', (s) => (personIn(s, 'pA')['work'] = [{ day: 0, from: 480, to: 720 }, { day: 0, from: 715, to: 1020 }]), "two stretches of a person's working hours overlap"],
      ['three stretches in a day', (s) => (personIn(s, 'pA')['work'] = [{ day: 0, from: 480, to: 600 }, { day: 0, from: 660, to: 720 }, { day: 0, from: 780, to: 1020 }]), 'a person has more than 2 stretches of working hours in one day'],
      ['time with a provider on a provider\'s week', (s) => (blockIn(s, 'w1')['personId'] = 'pB'), 'time with a provider belongs to a person who is not support staff'],
      ['time with a support person', (s) => (blockIn(s, 'w1')['what'] = { kind: 'with', personId: 'pT' }), 'a block of time is with someone who is not a provider in it'],
      ['time with nobody', (s) => (blockIn(s, 'w1')['what'] = { kind: 'with' }), 'a block of time is with someone who is not a provider in it'],
      ['time with a person who is not in the schedule', (s) => (blockIn(s, 'w1')['what'] = { kind: 'with', personId: 'gone' }), 'a block of time is with someone who is not a provider in it'],
      ['time with a provider marked remote', (s) => (blockIn(s, 'w1')['where'] = { kind: 'remote' }), 'time with a provider is remote or holds a room, which it never does'],
      ['time with a provider in a room', (s) => (blockIn(s, 'w1')['where'] = { kind: 'site', siteId: 's1', roomId: 'r1' }), 'time with a provider is remote or holds a room, which it never does'],
      ['a kind of time this tool does not know', (s) => (blockIn(s, 'w1')['what'] = { kind: 'beside', personId: 'pA' }), 'a block of time is not an appointment, an activity or time with a provider'],
    ];
    for (const [name, change, reason] of cases) {
      const problem = problemAfter(change);
      expect(problem, name).toBe(`This schedule cannot be opened because ${reason}. Open a workbook saved from this page that has not been changed by hand, or start a new schedule.`);
      expect(BANNED.test(problem ?? ''), name).toBe(false);
      expect(DASHES.test(problem ?? ''), name).toBe(false);
    }
  });

  it('allows two stretches that touch, a stretch of the whole day and a day with none', () => {
    expect(problemAfter((s) => (personIn(s, 'pA')['work'] = [{ day: 0, from: 480, to: 720 }, { day: 0, from: 720, to: 1020 }]))).toBeUndefined();
    expect(problemAfter((s) => (personIn(s, 'pA')['work'] = [{ day: 0, from: 0, to: 1440 }]))).toBeUndefined();
    expect(problemAfter((s) => (personIn(s, 'pA')['work'] = []))).toBeUndefined();
    // Working hours may reach outside the hours shown: the checks say so.
    expect(problemAfter((s) => (personIn(s, 'pA')['work'] = [{ day: 0, from: 300, to: 1200 }]))).toBeUndefined();
  });

  it('refuses time with a provider once that provider is support staff, and a list entry too', () => {
    expect(problemAfter((s) => (personIn(s, 'pB')['kind'] = 'support'))).toContain('a person works with someone who is not a provider in it');
    expect(
      problemAfter((s) => {
        personIn(s, 'pB')['kind'] = 'support';
        personIn(s, 'pS')['worksWith'] = ['pA'];
      }),
    ).toContain('a block of time is with someone who is not a provider in it');
  });
});

/**
 * A schedule as a workbook saved before this round holds it: no person has a kind, a "works with"
 * list or working hours. Avery has 79 appointments of 20 minutes, the case the old slot sheet
 * works by hand, and Blake has six of an hour.
 */
function oldFile(): Loose {
  let s = small();
  const blocks = [];
  for (let n = 0; n < 79; n++) blocks.push(block(`a${n}`, 'pA', Math.floor(n / 24) as 0 | 1 | 2 | 3, 480 + (n % 24) * 20, 20, visit('v20'), n < 24 ? room('s1', 'r1') : REMOTE));
  for (let n = 0; n < 6; n++) blocks.push(block(`b${n}`, 'pB', 4, 480 + n * 60, 60, visit('v60'), room('s2', 'r3')));
  blocks.push(block('lunch', 'pA', 0, 960, 60, activity('aLunch'), ELM), block('meet', 'pA', 4, 480, 120, activity('aMeet'), ELM));
  s = withBlocks(s, blocks);
  const old = copy(s);
  for (const person of old.people) {
    delete person['kind'];
    delete person['worksWith'];
    delete person['work'];
  }
  return old;
}

/** The same schedule with the new fields written out at their defaults. */
function sameToday(): Schedule {
  const old = oldFile();
  return { ...(old as unknown as Schedule), people: old.people.map((person) => ({ ...person, kind: 'provider', worksWith: [], work: [] })) as unknown as Schedule['people'] };
}

describe('Schedule Designer: a file saved before working hours and support staff', () => {
  it('holds none of the new fields', () => {
    const text = JSON.stringify(oldFile());
    expect(text).not.toContain('"kind":"provider"');
    expect(text).not.toContain('worksWith');
    expect(text).not.toContain('"work"');
    expect(text).not.toContain('"with"');
  });

  it('opens: every person is a provider, works with nobody listed and has no working hours entered', () => {
    const result = validate(oldFile());
    expect(result).toEqual({ schedule: sameToday() });
    const people = 'schedule' in result ? result.schedule.people : [];
    expect(people.map((person) => [person.id, person.kind, person.worksWith, person.work])).toEqual([['pA', 'provider', [], []], ['pB', 'provider', [], []]]);
  });

  it('tallies exactly as before: 79 appointments of 20 minutes are 26.33 hours and 79 slots, 5 under a target of 84', () => {
    const result = validate(oldFile());
    const s = 'schedule' in result ? result.schedule : small();
    const avery = tallyPerson(s, 'pA');
    expect(avery?.week).toEqual({ appointments: 79, careMinutes: 1580, otherPaidMinutes: 120, withMinutes: 0, unpaidMinutes: 60, paidMinutes: 1700, onSite: 24, remote: 55, noPlace: 0 });
    expect(avery?.contractMinutes).toBe(2040);
    expect(avery?.setAsideMinutes).toBe(360);
    expect(avery?.targetMinutes).toBe(1680);
    expect(avery?.slots).toMatchObject({ target: 84, actual: 79, variance: -5, verdict: 'under' });
    expect(avery?.days.map((day) => [day.appointments, day.careMinutes, day.slots])).toEqual([[24, 480, 24], [24, 480, 24], [24, 480, 24], [7, 140, 7], [0, 0, 0]]);
    expect([avery?.kind, avery?.workMinutes, avery?.paidWorkMinutes, avery?.openMinutes, avery?.withProviders]).toEqual(['provider', null, null, null, []]);
    const blake = tallyPerson(s, 'pB');
    // Blake: 40 contract hours less 10 set aside is 30 hours, 120 slots at 4 an hour. Six hours are 24 slots.
    expect(blake?.week).toMatchObject({ appointments: 6, careMinutes: 360, paidMinutes: 360 });
    expect(blake?.slots).toMatchObject({ target: 120, actual: 24, variance: -96, verdict: 'under' });
    const clinic = tallyClinic(s);
    expect([clinic.appointments, clinic.careMinutes, clinic.byDay]).toEqual([85, 1940, [24, 24, 24, 7, 6]]);
    expect(clinic.departments.map((row) => [row.people, row.supportStaff, row.peopleCounted, row.targetSlots, row.actualSlots, row.variance])).toEqual([[1, 0, 1, 84, 79, -5], [1, 0, 1, 120, 24, -96]]);
  });

  it('gets none of the findings about working hours or care teams, and the same findings as the same schedule today', () => {
    const result = validate(oldFile());
    const s = 'schedule' in result ? result.schedule : small();
    const findings = check(s);
    expect(findings.filter((finding) => finding.group === 'Working hours' || finding.group === 'Care teams')).toEqual([]);
    expect(findings).toEqual(check(sameToday()));
    expect(findings.map((finding) => finding.id)).toContain('slots-under:pA');
    expect(overview(s).map((row) => [row.kind, row.workMinutes, row.worksWith])).toEqual([['provider', null, []], ['provider', null, []]]);
  });

  it('opens from a workbook whose hidden sheet holds it, and tallies the same', async () => {
    const carrier = await toWorkbook(small());
    const opened = await fromWorkbook(await withSavedValue(carrier, oldFile()));
    expect(opened).toEqual({ schedule: sameToday() });
    const s = 'schedule' in opened ? opened.schedule : small();
    expect(tallyPerson(s, 'pA')).toEqual(tallyPerson(sameToday(), 'pA'));
    expect(tallyPerson(s, 'pA')?.slots).toMatchObject({ target: 84, actual: 79, variance: -5, verdict: 'under' });
  });

  it('saves again as a workbook that opens as the same schedule, now with the fields written out', async () => {
    const carrier = await toWorkbook(small());
    const opened = await fromWorkbook(await withSavedValue(carrier, oldFile()));
    const s = 'schedule' in opened ? opened.schedule : small();
    const bytes = await toWorkbook(s);
    expect(await fromWorkbook(bytes)).toEqual({ schedule: sameToday() });
    const book = await openBook(bytes);
    const saved = savedValue(book) as unknown as Schedule;
    expect(saved.version).toBe(1);
    expect(saved.people.map((person) => [person.kind, person.worksWith, person.work])).toEqual([['provider', [], []], ['provider', [], []]]);
    // The workbook has no sheet and no row for what the schedule does not use.
    expect(book.sheets.map((sheet) => sheet.name)).toEqual(['Overview', 'Avery Quill', 'Blake Rowan', 'Rooms', 'Kinds of time', 'ClinX data']);
    const avery = book.sheets[1]?.cells ?? new Map();
    expect(hasRow(avery, 'Working hours')).toBe(false);
    expect(hasRow(avery, 'Hours at work')).toBe(false);
    expect(hasRow(avery, 'Support staff with this provider')).toBe(false);
    // The same bytes as the workbook of the same schedule read today with every field written out.
    const today = validate(sameToday());
    const again = await toWorkbook('schedule' in today ? today.schedule : small());
    expect(bytes.length).toBe(again.length);
    expect(bytes.every((byte, at) => byte === again[at])).toBe(true);
  });

  it('a file with the new fields and one without may hold the same week: the fields change no number', () => {
    const result = validate(oldFile());
    const old = 'schedule' in result ? result.schedule : small();
    const hours: Schedule = { ...old, people: old.people.map((person) => ({ ...person, work: [0, 1, 2, 3, 4].map((day) => ({ day: day as 0, from: 480, to: 1020 })) })) };
    for (const id of ['pA', 'pB']) {
      const a = tallyPerson(old, id);
      const b = tallyPerson(hours, id);
      expect(b?.week).toEqual(a?.week);
      expect(b?.slots).toEqual(a?.slots);
      expect(b?.setAside).toEqual(a?.setAside);
      expect(b?.byType).toEqual(a?.byType);
    }
    expect(tallyClinic(hours)).toEqual(tallyClinic(old));
  });
});
