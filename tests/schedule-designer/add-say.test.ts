import { describe, expect, it } from 'vitest';
import { KIND_HEADING, NO_SITE_HEADING, openRoom, replacedSay, whatChoices, whereChoices, whereKey, whereOf } from '../../src/scripts/schedule-designer/add-say';
import { addPerson, newSchedule, paint, sampleSchedule } from '../../src/scripts/schedule-designer/engine/index';
import type { Where } from '../../src/scripts/schedule-designer/engine/index';

describe('the choices of What to add', () => {
  const rows = [
    { tool: { kind: 'with' }, name: 'With Maren Castellane', note: 'MC', colour: 3 },
    { tool: { kind: 'activity' }, name: 'Lunch', note: '', colour: 7 },
    { tool: { kind: 'visit' }, name: 'Standard', note: '20 min', colour: 1 },
  ];
  it('keeps the order of the rows, which is the order the number keys use', () => {
    expect(whatChoices(rows).map((choice) => choice.value)).toEqual(['0', '1', '2']);
    expect(whatChoices(rows).map((choice) => choice.say)).toEqual(['With Maren Castellane', 'Lunch', 'Standard']);
  });
  it('puts each kind under its heading, with its swatch and its quiet line', () => {
    const [beside, lunch, visit] = whatChoices(rows);
    expect(beside).toEqual({ value: '0', say: 'With Maren Castellane', note: 'MC', group: KIND_HEADING['with'], swatch: 3 });
    expect(lunch).toEqual({ value: '1', say: 'Lunch', group: 'Other time', swatch: 7 });
    expect(visit?.group).toBe('Appointments');
    expect(visit?.note).toBe('20 min');
  });
  it('gives every choice a swatch, so the list never mixes rows with and without one', () => {
    expect(whatChoices(rows).every((choice) => typeof choice.swatch === 'number')).toBe(true);
  });
});

describe('the choices of Where', () => {
  const s = sampleSchedule();
  it('lists each site with no room, then its rooms, then the two places at no site', () => {
    const choices = whereChoices(s);
    const rooms = s.sites.reduce((sum, site) => sum + site.rooms.length, 0);
    expect(choices).toHaveLength(s.sites.length + rooms + 2);
    const site = s.sites[0];
    if (!site) throw new Error('no site');
    expect(choices[0]).toEqual({ value: whereKey({ kind: 'site', siteId: site.id, roomId: null }), say: site.name, note: 'No room', group: site.name });
    expect(choices.slice(-2).map((choice) => [choice.say, choice.group])).toEqual([
      ['Remote', NO_SITE_HEADING],
      ['No place', NO_SITE_HEADING],
    ]);
  });
  it('gives every choice its own value, and the value names the place again', () => {
    const choices = whereChoices(s);
    expect(new Set(choices.map((choice) => choice.value)).size).toBe(choices.length);
    for (const choice of choices) {
      const where = whereOf(s, choice.value);
      expect(where).not.toBeNull();
      expect(whereKey(where as Where)).toBe(choice.value);
    }
  });
  it('says the site with a room on the closed button only when there is more than one site', () => {
    const site = s.sites[0];
    const room = site?.rooms[0];
    if (!site || !room) throw new Error('no room');
    const one = { ...s, sites: [site] };
    expect(whereChoices(one).find((choice) => choice.value === whereKey({ kind: 'site', siteId: site.id, roomId: room.id }))?.full).toBeUndefined();
    const two = { ...s, sites: [site, { ...site, id: 'other', name: 'Other site', rooms: [] }] };
    expect(whereChoices(two).find((choice) => choice.value === whereKey({ kind: 'site', siteId: site.id, roomId: room.id }))?.full).toBe(`${room.name}, ${site.name}`);
  });
  it('names no place for a value it cannot read or a room that is gone', () => {
    expect(whereOf(s, 'nonsense')).toBeNull();
    expect(whereOf(s, JSON.stringify(['site', 'no-such-site', null]))).toBeNull();
    const site = s.sites[0];
    if (!site) throw new Error('no site');
    expect(whereOf(s, JSON.stringify(['site', site.id, 'no-such-room']))).toBeNull();
    expect(whereOf(s, JSON.stringify(['remote']))).toEqual({ kind: 'remote' });
    expect(whereOf(s, JSON.stringify(['none']))).toEqual({ kind: 'none' });
  });
});

describe('the room a new provider starts in', () => {
  // A new schedule has one site with two rooms and one department with a visit type.
  const empty = newSchedule();
  const site = empty.sites[0];
  const type = empty.departments[0]?.visitTypes[0];
  if (!site || !type) throw new Error('a new schedule has a site and a visit type');
  const [first, second] = site.rooms;
  if (!first || !second) throw new Error('a new schedule has two rooms');
  const two = addPerson(addPerson(empty, { name: 'Avery Quill' }), { name: 'Blake Rowan' });
  const [avery, blake] = two.people;
  if (!avery || !blake) throw new Error('two people were added');
  const visit = { kind: 'visit', visitTypeId: type.id } as const;

  it('is the first room of the site when nobody uses a room yet', () => {
    expect(openRoom(two, site.id, avery.id)).toBe(first.id);
    expect(openRoom(two, site.id, blake.id)).toBe(first.id);
  });

  it('is the next room once somebody else is in the first at any time of the week', () => {
    const s = paint(two, { personId: avery.id, day: 3, from: 540, to: 600, what: visit, where: { kind: 'site', siteId: site.id, roomId: first.id } });
    expect(openRoom(s, site.id, blake.id)).toBe(second.id);
    // The person's own time does not count against them.
    expect(openRoom(s, site.id, avery.id)).toBe(first.id);
  });

  it('is no room when other people use every room, or the site is not there', () => {
    let s = paint(two, { personId: avery.id, day: 0, from: 540, to: 600, what: visit, where: { kind: 'site', siteId: site.id, roomId: first.id } });
    s = paint(s, { personId: avery.id, day: 1, from: 540, to: 600, what: visit, where: { kind: 'site', siteId: site.id, roomId: second.id } });
    expect(openRoom(s, site.id, blake.id)).toBeNull();
    expect(openRoom(two, 'no-such-site', avery.id)).toBeNull();
  });

  it('never picks a room that someone else is in, in the sample', () => {
    const s = sampleSchedule();
    for (const person of s.people) {
      for (const place of s.sites) {
        const roomId = openRoom(s, place.id, person.id);
        if (roomId === null) continue;
        expect(s.blocks.some((block) => block.personId !== person.id && block.where.kind === 'site' && block.where.roomId === roomId)).toBe(false);
      }
    }
  });
});

describe('what new time took the place of', () => {
  const admin = { name: 'Admin time', kind: 'admin|elm' };
  const lunch = { name: 'Lunch', kind: 'lunch|none' };
  const standard = { name: 'Standard', kind: 'standard|exam1' };

  it('names a block that went whole', () => {
    expect(replacedSay([{ ...admin, start: 540, end: 600 }], [{ ...standard, start: 540, end: 600 }])).toBe('Admin time');
    expect(replacedSay([], [{ ...standard, start: 540, end: 560 }])).toBe('');
  });

  it('names a block that lost part of its time with the time that went', () => {
    // 20 min in the middle of two hours of Admin time: what is left is two shorter blocks.
    const left = [
      { ...admin, start: 540, end: 580 },
      { ...standard, start: 580, end: 600 },
      { ...admin, start: 600, end: 660 },
    ];
    expect(replacedSay([{ ...admin, start: 540, end: 660 }], left)).toBe('20 min of Admin time');
    // The first hour of two.
    expect(replacedSay([{ ...admin, start: 540, end: 660 }], [{ ...standard, start: 540, end: 600 }, { ...admin, start: 600, end: 660 }])).toBe('1 h of Admin time');
  });

  it('says each of two kinds its own way, and counts the blocks when there are more kinds', () => {
    const gone = [
      { ...lunch, start: 720, end: 750 },
      { ...admin, start: 750, end: 870 },
    ];
    const left = [
      { ...standard, start: 720, end: 780 },
      { ...admin, start: 780, end: 870 },
    ];
    expect(replacedSay(gone, left)).toBe('Lunch and 30 min of Admin time');
    expect(replacedSay([...gone, { ...standard, start: 700, end: 720 }], left)).toBe('3 blocks');
  });

  it('does not take the same kind of time in another place for what is left', () => {
    expect(replacedSay([{ ...admin, start: 540, end: 660 }], [{ name: 'Admin time', kind: 'admin|annex', start: 540, end: 600 }])).toBe('Admin time');
  });
});
