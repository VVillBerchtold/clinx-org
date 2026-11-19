import { describe, expect, it } from 'vitest';
import { checkSay, departmentSay, listedIn, sectionsOf, showSay } from '../../src/scripts/schedule-designer/check-say';
import { check } from '../../src/scripts/schedule-designer/engine/check';
import { addPerson, clearDay, newSchedule, paint, removePerson, setPerson, setTolerance } from '../../src/scripts/schedule-designer/engine/edit';
import { sampleSchedule } from '../../src/scripts/schedule-designer/engine/sample';
import { tallyClinic, tallyPerson } from '../../src/scripts/schedule-designer/engine/tally';
import type { Schedule } from '../../src/scripts/schedule-designer/engine/types';

const sample = sampleSchedule();

/** The sample and a handful of weeks made from it, so the sentence is tried with different findings. */
function weeks(): [string, Schedule][] {
  const first = sample.people[0];
  const second = sample.people[1];
  if (!first || !second) throw new Error('the sample has people');
  const day = sample.days[0] ?? 0;
  return [
    ['the sample', sample],
    ['a day cleared', clearDay(sample, first.id, day)],
    ['two days cleared', clearDay(clearDay(sample, first.id, day), second.id, day)],
    ['no tolerance', setTolerance(sample, 0)],
    ['a person with no contract hours', setPerson(sample, first.id, { contractHours: 0 })],
    ['a person removed', removePerson(sample, second.id).schedule],
    ['a person added', addPerson(sample, { name: 'Someone new' })],
  ];
}

/** The first whole number in a sentence. */
const numberIn = (say: string): number => Number(/\d+/.exec(say)?.[0] ?? Number.NaN);

describe('Schedule Designer: what Check and save says above its findings', () => {
  it.each(weeks())('the count in the sentence is the number of findings listed under it: %s', (_name, s) => {
    const found = check(s);
    const read = checkSay(s, found);
    const listed = listedIn(sectionsOf(found));
    expect(listed).toBe(found.length);
    expect(read.listed).toBe(listed);
    expect(read.sections.reduce((sum, section) => sum + section.count, 0)).toBe(listed);
    if (listed === 0) expect(read.say).toBe('The page read the whole week and found nothing to list.');
    else expect(numberIn(read.say)).toBe(listed);
    // Each part of the sentence is the count of one section, and the parts add up to the whole.
    if (read.sections.length > 1) {
      const parts = [...read.say.split(':')[1]!.matchAll(/\d+/g)].map((match) => Number(match[0]));
      expect(parts).toEqual(read.sections.map((section) => section.count));
      expect(parts.reduce((sum, part) => sum + part, 0)).toBe(listed);
    }
  });

  it('the sample has more than one kind of finding, so the sentence names each', () => {
    const read = checkSay(sample, check(sample));
    expect(read.sections.length).toBeGreaterThan(1);
    expect(read.say).toMatch(/^The page read the whole week and lists \d+ things: /);
  });

  it('a schedule with nobody in it is never called ready', () => {
    const s = newSchedule();
    const read = checkSay(s, check(s));
    expect(s.people).toHaveLength(0);
    expect(read.state).toBe('empty');
    expect(read.say).toBe('There is nothing to check yet. Add a person in Set up, then build their week in Design.');
    expect(read.listed).toBe(0);
  });

  it('a person with no time painted is not ready either, and painting changes that', () => {
    const s = addPerson(newSchedule(), { name: 'Someone new' });
    const person = s.people[0];
    const visitType = s.departments.find((department) => department.id === person?.departmentId)?.visitTypes[0];
    if (!person || !visitType) throw new Error('a new schedule has a department with visit types');
    expect(checkSay(s, check(s)).state).toBe('empty');
    expect(checkSay(s, check(s)).say).toBe('There is nothing to check yet. Add time to a week in Design, then come back here.');
    const painted = paint(s, { personId: person.id, day: s.days[0] ?? 0, from: s.dayStart, to: s.dayStart + 60, what: { kind: 'visit', visitTypeId: visitType.id }, where: { kind: 'remote' } });
    expect(painted.blocks.length).toBeGreaterThan(0);
    expect(checkSay(painted, check(painted)).state).not.toBe('empty');
  });
});

describe('Schedule Designer: a department is on target only when each person in it is', () => {
  it('one person under and one person over do not make a department on target', () => {
    const clinic = tallyClinic(sample);
    const mixed = sample.departments
      .map((department) => {
        const verdicts = sample.people.filter((person) => person.departmentId === department.id).map((person) => tallyPerson(sample, person.id)?.slots.verdict);
        return { department, under: verdicts.filter((verdict) => verdict === 'under').length, over: verdicts.filter((verdict) => verdict === 'over').length, onTarget: verdicts.filter((verdict) => verdict === 'on-target').length };
      })
      .find((row) => row.under > 0 && row.over > 0);
    if (!mixed) throw new Error('the sample has a department with someone under and someone over');
    const word = departmentSay(sample, mixed.department.id);
    expect(word.state).toBe('mixed');
    expect(word.say).toBe(`${mixed.under} under, ${mixed.over} over`);
    expect(word).toMatchObject({ under: mixed.under, over: mixed.over, onTarget: mixed.onTarget });
    // The slots of the two cancel out in the sum, which is why the word is not made from the sum.
    expect(clinic.departments.find((row) => row.departmentId === mixed.department.id)?.variance).toBe(0);
  });

  it('every department gets the word its people earn', () => {
    for (const department of sample.departments) {
      const verdicts = sample.people.filter((person) => person.departmentId === department.id).map((person) => tallyPerson(sample, person.id)?.slots.verdict);
      const off = verdicts.filter((verdict) => verdict === 'under' || verdict === 'over').length;
      const counted = off + verdicts.filter((verdict) => verdict === 'on-target').length;
      const word = departmentSay(sample, department.id);
      if (counted === 0) expect(word.state).toBe('none');
      else expect(word.state === 'met').toBe(off === 0);
    }
  });
});

describe('Schedule Designer: the sentence "Show it" writes', () => {
  const findings = check(sample);
  const by = (start: string) => {
    const finding = findings.find((one) => one.id.startsWith(start));
    if (!finding) throw new Error(`the sample has no ${start} finding`);
    return finding;
  };

  it('names the person, the day and the time of a finding that has them', () => {
    expect(showSay(sample, by('clash:'))).toBe('Showing Tobin Achterberg on Tuesday at 8:15 am.');
    expect(showSay(sample, by('no-support:'))).toBe('Showing Yusra Hollin on Friday at 1:00 pm.');
  });

  it('names the week of a person when the finding is about the whole week', () => {
    expect(showSay(sample, by('slots-under:'))).toBe('Showing the week of Tobin Achterberg.');
    expect(showSay(sample, by('ramping:'))).toBe('Showing the week of Linnea Farrowby.');
  });

  it('names the day with no time, and a room with its site', () => {
    const tobin = by('slots-under:');
    expect(showSay(sample, { ...tobin, day: 2 })).toBe('Showing Tobin Achterberg on Wednesday.');
    const site = sample.sites[0];
    const room = site?.rooms[0];
    if (!site || !room) throw new Error('the sample has rooms');
    expect(showSay(sample, { id: `unused-room:${room.id}`, level: 'note', group: 'Rooms not used', say: '', siteId: site.id, roomId: room.id })).toBe(`Showing ${room.name} at ${site.name}.`);
  });

  it('says nothing for a finding with no person and no room, which opens Set up', () => {
    expect(showSay(sample, by('unused-type:'))).toBe('');
  });
});
