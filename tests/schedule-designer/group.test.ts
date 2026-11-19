import { describe, expect, it } from 'vitest';
import { clearDay, erase, paint } from '../../src/scripts/schedule-designer/engine/edit';
import { blocksOn } from '../../src/scripts/schedule-designer/engine/find';
import { sampleSchedule } from '../../src/scripts/schedule-designer/engine/sample';
import type { Schedule, What, Where } from '../../src/scripts/schedule-designer/engine/types';
import { runSay, runsOf } from '../../src/scripts/schedule-designer/group';

const sample = sampleSchedule();
const person = sample.people[0];
const department = sample.departments.find((item) => item.id === person?.departmentId);
const typeA = department?.visitTypes[0];
const typeB = department?.visitTypes.find((type) => type.id !== typeA?.id);
const site = sample.sites.find((item) => item.rooms.length > 1);
const activity = sample.activities[0];
if (!person || !typeA || !typeB || !site || !activity) throw new Error('the sample has a person, two visit types, a site with two rooms and an activity');
const day = sample.days[0] ?? 0;
const roomOne: Where = { kind: 'site', siteId: site.id, roomId: site.rooms[0]?.id ?? null };
const roomTwo: Where = { kind: 'site', siteId: site.id, roomId: site.rooms[1]?.id ?? null };
const visitA: What = { kind: 'visit', visitTypeId: typeA.id };
const visitB: What = { kind: 'visit', visitTypeId: typeB.id };

/** The person's first day with nothing on it, ready to paint. */
const empty = clearDay(sample, person.id, day);
const NINE = 9 * 60;
const put = (s: Schedule, from: number, to: number, what: What, where: Where): Schedule => paint(s, { personId: person.id, day, from, to, what, where });
const runs = (s: Schedule) => runsOf(blocksOn(s, person.id, day));
const sizes = (s: Schedule): number[] => runs(s).map((run) => run.blocks.length);

describe('Schedule Designer: the Grouped look sorts a day into runs', () => {
  it('visits of one type that touch in one room are one run', () => {
    const s = put(empty, NINE, NINE + 8 * typeA.minutes, visitA, roomOne);
    expect(blocksOn(s, person.id, day)).toHaveLength(8);
    const found = runs(s);
    expect(found).toHaveLength(1);
    expect(found[0]?.blocks).toHaveLength(8);
    expect(found[0]).toMatchObject({ from: NINE, to: NINE + 8 * typeA.minutes });
  });

  it('a different visit type starts a new run', () => {
    let s = put(empty, NINE, NINE + 3 * typeA.minutes, visitA, roomOne);
    const next = NINE + 3 * typeA.minutes;
    s = put(s, next, next + 2 * typeB.minutes, visitB, roomOne);
    expect(sizes(s)).toEqual([3, 2]);
    expect(runs(s)[1]).toMatchObject({ from: next, to: next + 2 * typeB.minutes });
  });

  it('a different room starts a new run, and so does a visit that is remote', () => {
    const third = NINE + 3 * typeA.minutes;
    const fifth = NINE + 5 * typeA.minutes;
    let s = put(empty, NINE, third, visitA, roomOne);
    s = put(s, third, fifth, visitA, roomTwo);
    s = put(s, fifth, fifth + 2 * typeA.minutes, visitA, { kind: 'remote' });
    expect(sizes(s)).toEqual([3, 2, 2]);
  });

  it('a gap starts a new run', () => {
    const afterGap = NINE + 4 * typeA.minutes;
    let s = put(empty, NINE, NINE + 3 * typeA.minutes, visitA, roomOne);
    s = put(s, afterGap, afterGap + 2 * typeA.minutes, visitA, roomOne);
    expect(sizes(s)).toEqual([3, 2]);
    expect(runs(s).map((run) => [run.from, run.to])).toEqual([
      [NINE, NINE + 3 * typeA.minutes],
      [afterGap, afterGap + 2 * typeA.minutes],
    ]);
  });

  it('one visit by itself is a run of one', () => {
    const s = put(empty, NINE, NINE + typeA.minutes, visitA, roomOne);
    const found = runs(s);
    expect(found).toHaveLength(1);
    expect(found[0]?.blocks).toHaveLength(1);
    expect(found[0]).toMatchObject({ from: NINE, to: NINE + typeA.minutes });
  });

  it('other time never joins a run, even when it touches a visit or more of itself', () => {
    const what: What = { kind: 'activity', activityId: activity.id };
    let s = put(empty, NINE, NINE + 2 * typeA.minutes, visitA, roomOne);
    const next = NINE + 2 * typeA.minutes;
    s = put(s, next, next + 60, what, roomOne);
    s = put(s, next + 60, next + 60 + 2 * typeA.minutes, visitA, roomOne);
    const found = runs(s);
    expect(found.map((run) => run.blocks[0]?.what.kind)).toEqual(['visit', 'activity', 'visit']);
    for (const run of found) if (run.blocks[0]?.what.kind === 'activity') expect(run.blocks).toHaveLength(1);
    expect(sizes(s)).toEqual([2, 1, 2]);
  });

  it('erasing the middle of a run leaves two runs', () => {
    const whole = put(empty, NINE, NINE + 8 * typeA.minutes, visitA, roomOne);
    expect(sizes(whole)).toEqual([8]);
    const cut = erase(whole, { personId: person.id, day, from: NINE + 3 * typeA.minutes, to: NINE + 5 * typeA.minutes });
    expect(sizes(cut)).toEqual([3, 3]);
  });

  it('keeps every block once, in any order it is given them, and changes nothing', () => {
    const blocks = blocksOn(sample, person.id, day);
    const before = JSON.stringify(blocks);
    const found = runsOf([...blocks].reverse());
    expect(JSON.stringify(blocks)).toBe(before);
    expect(found.flatMap((run) => run.blocks.map((block) => block.id)).sort()).toEqual(blocks.map((block) => block.id).sort());
    for (const run of found) {
      expect(run.from).toBe(run.blocks[0]?.start);
      const last = run.blocks[run.blocks.length - 1];
      expect(run.to).toBe((last?.start ?? 0) + (last?.minutes ?? 0));
      for (let at = 1; at < run.blocks.length; at++) {
        const a = run.blocks[at - 1];
        const b = run.blocks[at];
        expect(a?.what).toEqual(b?.what);
        expect(a?.where).toEqual(b?.where);
        expect((a?.start ?? 0) + (a?.minutes ?? 0)).toBe(b?.start);
      }
    }
    expect(runsOf([])).toEqual([]);
  });

  it('a band says its name, its count and its time', () => {
    expect(runSay('Standard', 8, '9:00 am to 11:40 am')).toBe('Standard, 8 visits, 9:00 am to 11:40 am');
  });
});
