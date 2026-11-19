import { describe, expect, it } from 'vitest';
import { fromSetup, newSchedule, paint } from '../../src/scripts/schedule-designer/engine/edit';
import { sampleSchedule } from '../../src/scripts/schedule-designer/engine/sample';
import { tallyPerson } from '../../src/scripts/schedule-designer/engine/tally';
import { validate } from '../../src/scripts/schedule-designer/engine/validate';
import { fromWorkbook, toWorkbook } from '../../src/scripts/schedule-designer/engine/workbook';
import type { Schedule } from '../../src/scripts/schedule-designer/engine/types';
import { deepFreeze, room, small, visit, withBlocks } from './fixtures/small';

// A new season starts from last season's set-up: the places, the kinds of time, the people and
// the standards stay, and the weeks and the schedule's own name go.

/** A week with blocks, a person who is ramping and a person with their own standards. */
function lastSeason(): Schedule {
  const base = small();
  const people = base.people.map((person) => (person.id === 'pA' ? { ...person, ramping: true } : { ...person, careFactor: 0.8, slotsPerHour: 3.5 }));
  return deepFreeze(
    withBlocks({ ...base, name: 'Autumn template', tolerance: 2, people }, [
      { id: 'b1', personId: 'pA', day: 0, start: 540, minutes: 20, what: visit('v20'), where: room('s1', 'r1') },
      { id: 'b2', personId: 'pA', day: 0, start: 560, minutes: 20, what: visit('v20'), where: room('s1', 'r1') },
      { id: 'b3', personId: 'pB', day: 2, start: 600, minutes: 30, what: visit('v30'), where: room('s2', 'r3') },
    ]),
  );
}

describe('Schedule Designer: a new schedule from a saved set-up', () => {
  it('removes every block', () => {
    const before = lastSeason();
    expect(before.blocks.length).toBe(3);
    expect(fromSetup(before).blocks).toEqual([]);
  });

  it('gives the schedule the name a new one starts with, so the old name is not carried on', () => {
    const next = fromSetup(lastSeason());
    expect(next.name).toBe(newSchedule().name);
    expect(next.name).not.toBe('Autumn template');
  });

  it('keeps the clinic, the days, the hours and the tolerance', () => {
    const before = lastSeason();
    const next = fromSetup(before);
    expect(next.clinic).toBe('Invented Clinic');
    expect(next.days).toEqual(before.days);
    expect(next.dayStart).toBe(before.dayStart);
    expect(next.dayEnd).toBe(before.dayEnd);
    expect(next.tolerance).toBe(2);
  });

  it('keeps the sites and rooms, the departments with their visit types and standards, and the other time', () => {
    const before = lastSeason();
    const next = fromSetup(before);
    expect(next.sites).toEqual(before.sites);
    expect(next.departments).toEqual(before.departments);
    expect(next.activities).toEqual(before.activities);
  });

  it('keeps each person with their contract, set-aside hours, own standards and ramping', () => {
    const before = lastSeason();
    const next = fromSetup(before);
    expect(next.people).toEqual(before.people);
    expect(next.people.find((person) => person.id === 'pA')?.ramping).toBe(true);
    expect(next.people.find((person) => person.id === 'pB')?.careFactor).toBe(0.8);
    expect(next.people.find((person) => person.id === 'pB')?.slotsPerHour).toBe(3.5);
    expect(next.people.find((person) => person.id === 'pB')?.setAside).toEqual([
      { activityId: 'aAdmin', hours: 8 },
      { activityId: 'aMeet', hours: 2 },
    ]);
  });

  it('never changes the schedule it is given, and always hands back another one', () => {
    const before = lastSeason();
    const copy = JSON.parse(JSON.stringify(before)) as Schedule;
    const next = fromSetup(before);
    expect(before).toEqual(copy);
    expect(next).not.toBe(before);
    // Also for a schedule with no blocks: the page treats the result as a schedule nobody has saved.
    const empty = small();
    expect(fromSetup(empty)).not.toBe(empty);
  });

  it('gives a schedule this version can open, with nothing left that points at a removed block', () => {
    const next = fromSetup(lastSeason());
    const read = validate(JSON.parse(JSON.stringify(next)));
    expect('schedule' in read).toBe(true);
    for (const person of next.people) expect(tallyPerson(next, person.id)?.week.appointments).toBe(0);
  });

  it('holds only the fields of a schedule', () => {
    const next = fromSetup(lastSeason());
    expect(Object.keys(next).sort()).toEqual(Object.keys(newSchedule()).sort());
  });

  it('can be painted on at once', () => {
    const next = fromSetup(lastSeason());
    const painted = paint(next, { personId: 'pA', day: 1, from: 540, to: 600, what: visit('v20'), where: room('s1', 'r2') });
    expect(painted.blocks.length).toBe(3);
  });

  it('works on the sample clinic, and the result survives a workbook', async () => {
    const sample = sampleSchedule();
    const next = fromSetup(sample);
    expect(next.blocks.length).toBe(0);
    expect(next.people.length).toBe(sample.people.length);
    expect(next.sites).toEqual(sample.sites);
    const back = await fromWorkbook(await toWorkbook(next));
    expect('schedule' in back && back.schedule).toEqual(next);
  });
});
