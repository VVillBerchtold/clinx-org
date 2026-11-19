import { describe, expect, it } from 'vitest';
import { addPerson } from '../../src/scripts/schedule-designer/engine/edit';
import { allClashes, freeRooms, roomHours, roomUse, roomsFree } from '../../src/scripts/schedule-designer/engine/rooms';
import { NOWHERE, REMOTE, activity, block, deepFreeze, room, small, visit, withBlocks } from './fixtures/small';

const base = small();
const EXAM1 = room('s1', 'r1');
const EXAM2 = room('s1', 'r2');

describe('Schedule Designer: who is in each room', () => {
  const s = withBlocks(base, [
    block('a1', 'pA', 0, 540, 20, visit('v20'), EXAM1),
    block('a2', 'pA', 0, 560, 20, visit('v20'), EXAM1),
    block('a3', 'pA', 0, 600, 20, visit('v20'), EXAM1),
    block('a4', 'pA', 0, 620, 60, activity('aAdmin'), EXAM2),
    block('a5', 'pA', 0, 700, 20, visit('v20'), room('s1', null)),
    block('a6', 'pA', 0, 720, 20, visit('v20'), REMOTE),
    block('a7', 'pA', 1, 540, 20, visit('v20'), EXAM1),
    block('b1', 'pB', 0, 660, 30, visit('v30'), EXAM1),
  ]);

  it('lists each room of the site with the stays in it, touching blocks joined', () => {
    const use = roomUse(s, 0, 's1');
    expect(use.map((r) => [r.roomId, r.name])).toEqual([['r1', 'Exam 1'], ['r2', 'Exam 2']]);
    expect(use[0]?.stays).toEqual([
      { personId: 'pA', from: 540, to: 580, clash: false },
      { personId: 'pA', from: 600, to: 620, clash: false },
      { personId: 'pB', from: 660, to: 690, clash: false },
    ]);
    expect(use[1]?.stays).toEqual([{ personId: 'pA', from: 620, to: 680, clash: false }]);
    expect(use.flatMap((r) => r.clashes)).toEqual([]);
  });

  it('counts only that day and that site, and only time with a room', () => {
    expect(roomUse(s, 1, 's1')[0]?.stays).toEqual([{ personId: 'pA', from: 540, to: 560, clash: false }]);
    expect(roomUse(s, 0, 's2')).toEqual([{ roomId: 'r3', name: 'Consult', stays: [], clashes: [] }]);
    expect(roomUse(s, 0, 'no-such-site')).toEqual([]);
  });

  it('lists when each room is free inside the hours shown', () => {
    const free = roomsFree(s, 0, 's1');
    expect(free[0]).toEqual({ roomId: 'r1', name: 'Exam 1', free: [{ from: 480, to: 540 }, { from: 580, to: 600 }, { from: 620, to: 660 }, { from: 690, to: 1020 }] });
    expect(free[1]?.free).toEqual([{ from: 480, to: 620 }, { from: 680, to: 1020 }]);
    expect(roomsFree(s, 0, 's2')[0]?.free).toEqual([{ from: 480, to: 1020 }]);
  });

  it('lists the rooms free for a whole stretch, counting or leaving out one person', () => {
    expect(freeRooms(s, 0, 's1', 540, 600).map((r) => r.id)).toEqual(['r2']);
    expect(freeRooms(s, 0, 's1', 580, 600).map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(freeRooms(s, 0, 's1', 600, 700).map((r) => r.id)).toEqual([]);
    // A person's own time does not stand in their own way.
    expect(freeRooms(s, 0, 's1', 540, 600, 'pA').map((r) => r.id)).toEqual(['r1', 'r2']);
  });
});

describe('Schedule Designer: a room\'s hours across the week', () => {
  const s = withBlocks(base, [
    block('a1', 'pA', 0, 540, 20, visit('v20'), EXAM1),
    block('a2', 'pA', 0, 560, 20, visit('v20'), EXAM1),
    block('b1', 'pB', 0, 660, 30, visit('v30'), EXAM1),
    block('a3', 'pA', 1, 540, 20, visit('v20'), EXAM1),
    // A meeting two people share in Exam 2 counts once.
    block('a4', 'pA', 2, 780, 60, activity('aMeet'), EXAM2),
    block('b2', 'pB', 2, 780, 60, activity('aMeet'), EXAM2),
    // Only the part inside the hours shown (8:00 am to 5:00 pm) counts: 20 of these 60 minutes, and none of the next 60.
    block('b3', 'pB', 3, 440, 60, visit('v60'), EXAM2),
    block('b4', 'pB', 4, 1020, 60, visit('v60'), EXAM2),
    // Time at the site with no room, and remote time, use no room.
    block('a5', 'pA', 4, 540, 20, visit('v20'), room('s1', null)),
    block('a6', 'pA', 4, 560, 20, visit('v20'), REMOTE),
  ]);

  it('adds up the time in use and the time free for each room, by day and for the week', () => {
    const hours = roomHours(s, 's1');
    expect(hours.map((r) => [r.roomId, r.name, r.usedMinutes, r.freeMinutes])).toEqual([
      ['r1', 'Exam 1', 90, 5 * 540 - 90],
      ['r2', 'Exam 2', 80, 5 * 540 - 80],
    ]);
    expect(hours[0]?.days).toEqual([
      { day: 0, usedMinutes: 70, freeMinutes: 470 },
      { day: 1, usedMinutes: 20, freeMinutes: 520 },
      { day: 2, usedMinutes: 0, freeMinutes: 540 },
      { day: 3, usedMinutes: 0, freeMinutes: 540 },
      { day: 4, usedMinutes: 0, freeMinutes: 540 },
    ]);
    expect(hours[1]?.days.map((d) => d.usedMinutes)).toEqual([0, 0, 60, 20, 0]);
  });

  it('gives a room nobody uses all its hours free, and nothing for a site that is not there', () => {
    expect(roomHours(s, 's2')).toEqual([{ roomId: 'r3', name: 'Consult', usedMinutes: 0, freeMinutes: 2700, days: [0, 1, 2, 3, 4].map((day) => ({ day, usedMinutes: 0, freeMinutes: 540 })) }]);
    expect(roomHours(s, 'no-such-site')).toEqual([]);
  });

  it('offers the rooms free for a day and a stretch of time, for when someone paints into a taken one', () => {
    // Monday 9:00 to 9:40: Exam 1 is taken by Avery, so Blake is offered Exam 2 only.
    expect(freeRooms(s, 0, 's1', 540, 580, 'pB').map((r) => r.name)).toEqual(['Exam 2']);
    expect(freeRooms(s, 0, 's1', 580, 660, 'pB').map((r) => r.name)).toEqual(['Exam 1', 'Exam 2']);
    expect(freeRooms(s, 2, 's1', 800, 820).map((r) => r.name)).toEqual(['Exam 1']);
    expect(freeRooms(s, 0, 'no-such-site', 540, 580)).toEqual([]);
  });
});

describe('Schedule Designer: room clashes', () => {
  it('marks two people in one room at once, for the time they share', () => {
    const s = withBlocks(base, [
      block('a1', 'pA', 0, 540, 20, visit('v20'), EXAM1),
      block('a2', 'pA', 0, 560, 20, visit('v20'), EXAM1),
      block('b1', 'pB', 0, 570, 30, visit('v30'), EXAM1),
      block('b2', 'pB', 0, 600, 30, visit('v30'), EXAM1),
    ]);
    const use = roomUse(s, 0, 's1')[0];
    expect(use?.clashes).toEqual([{ siteId: 's1', roomId: 'r1', day: 0, from: 570, to: 580, personIds: ['pA', 'pB'] }]);
    expect(use?.stays).toEqual([
      { personId: 'pA', from: 540, to: 580, clash: true },
      { personId: 'pB', from: 570, to: 630, clash: true },
    ]);
    expect(allClashes(s)).toEqual(use?.clashes);
  });

  it('does not mark people who follow one another', () => {
    const s = withBlocks(base, [block('a1', 'pA', 0, 540, 20, visit('v20'), EXAM1), block('b1', 'pB', 0, 560, 30, visit('v30'), EXAM1)]);
    expect(allClashes(s)).toEqual([]);
  });

  it('does not mark the same people in different rooms, or on different days', () => {
    const s = withBlocks(base, [
      block('a1', 'pA', 0, 540, 20, visit('v20'), EXAM1),
      block('b1', 'pB', 0, 540, 30, visit('v30'), EXAM2),
      block('b2', 'pB', 1, 540, 30, visit('v30'), EXAM1),
      block('b3', 'pB', 2, 540, 30, visit('v30'), room('s1', null)),
      block('a3', 'pA', 2, 540, 20, visit('v20'), room('s1', null)),
    ]);
    expect(allClashes(s)).toEqual([]);
  });

  it('lets people share a room for the same activity, such as a meeting', () => {
    const s = withBlocks(base, [block('a1', 'pA', 2, 780, 60, activity('aMeet'), EXAM1), block('b1', 'pB', 2, 780, 60, activity('aMeet'), EXAM1)]);
    expect(allClashes(s)).toEqual([]);
    expect(roomUse(s, 2, 's1')[0]?.stays.map((stay) => stay.clash)).toEqual([false, false]);
  });

  it('marks different activities, or an activity and an appointment, in one room', () => {
    const two = withBlocks(base, [block('a1', 'pA', 2, 780, 60, activity('aMeet'), EXAM1), block('b1', 'pB', 2, 800, 60, activity('aAdmin'), EXAM1)]);
    expect(allClashes(two)).toEqual([{ siteId: 's1', roomId: 'r1', day: 2, from: 800, to: 840, personIds: ['pA', 'pB'] }]);
    const mixed = withBlocks(base, [block('a1', 'pA', 2, 780, 60, activity('aMeet'), EXAM1), block('b1', 'pB', 2, 780, 30, visit('v30'), EXAM1)]);
    expect(allClashes(mixed)).toEqual([{ siteId: 's1', roomId: 'r1', day: 2, from: 780, to: 810, personIds: ['pA', 'pB'] }]);
  });

  it('with three people, says who is there for each stretch, in the order of the people list', () => {
    const three = deepFreeze(addPerson(base, { name: 'Casey Lund' }));
    const pC = three.people[2]?.id ?? '';
    const s = withBlocks(three, [
      block('c1', pC, 0, 540, 60, activity('aAdmin'), EXAM1),
      block('a1', 'pA', 0, 540, 40, visit('v40'), EXAM1),
      block('b1', 'pB', 0, 560, 30, visit('v30'), EXAM1),
      block('x', 'pB', 0, 700, 30, visit('v30'), NOWHERE),
    ]);
    expect(allClashes(s).map((c) => [c.from, c.to, c.personIds])).toEqual([
      [540, 560, ['pA', pC]],
      [560, 580, ['pA', 'pB', pC]],
      [580, 590, ['pB', pC]],
    ]);
  });

  it('lists clashes for the whole week by day, then site, then room, then time', () => {
    const s = withBlocks(base, [
      block('a1', 'pA', 3, 540, 20, visit('v20'), room('s2', 'r3')),
      block('b1', 'pB', 3, 540, 30, visit('v30'), room('s2', 'r3')),
      block('a2', 'pA', 1, 540, 20, visit('v20'), EXAM2),
      block('b2', 'pB', 1, 540, 30, visit('v30'), EXAM2),
    ]);
    expect(allClashes(s).map((c) => [c.day, c.roomId])).toEqual([[1, 'r2'], [3, 'r3']]);
  });
});
