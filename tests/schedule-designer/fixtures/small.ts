// A small made-up schedule for the tests, and helpers to read one. Every name here is invented.

import { endOf, factsOf } from '../../../src/scripts/schedule-designer/engine/find';
import type { Block, Day, Schedule, What, Where } from '../../../src/scripts/schedule-designer/engine/types';

/** Freezes a value and everything inside it, so a test fails loudly if an edit tries to change its input. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/**
 * Two sites, two departments (a 20 minute one and a 15 minute one), three activities, two people, no blocks.
 * Both departments have a care factor of 1, so the patient care a person needs is the contract less
 * the hours set aside. Primary care counts 3 slots in an hour and Counselling 4. The tolerance is 0.
 */
export function small(): Schedule {
  return deepFreeze<Schedule>({
    format: 'clinx-schedule',
    version: 1,
    name: 'Test week',
    clinic: 'Invented Clinic',
    days: [0, 1, 2, 3, 4],
    dayStart: 480,
    dayEnd: 1020,
    sites: [
      { id: 's1', name: 'Elm Street', rooms: [{ id: 'r1', name: 'Exam 1' }, { id: 'r2', name: 'Exam 2' }] },
      { id: 's2', name: 'Annex', rooms: [{ id: 'r3', name: 'Consult' }] },
    ],
    departments: [
      {
        id: 'd1',
        name: 'Primary care',
        step: 20,
        careFactor: 1,
        slotsPerHour: 3,
        visitTypes: [
          { id: 'v20', name: 'Standard', code: 'STD', minutes: 20, colour: 1 },
          { id: 'v40', name: 'New patient', code: 'NEW', minutes: 40, colour: 2 },
        ],
      },
      {
        id: 'd2',
        name: 'Counselling',
        step: 15,
        careFactor: 1,
        slotsPerHour: 4,
        visitTypes: [
          { id: 'v30', name: 'Standard', code: 'S30', minutes: 30, colour: 3 },
          { id: 'v60', name: 'Extended', code: 'EXT', minutes: 60, colour: 4 },
        ],
      },
    ],
    activities: [
      { id: 'aMeet', name: 'Meeting', colour: 7, paid: true },
      { id: 'aAdmin', name: 'Admin time', colour: 11, paid: true },
      { id: 'aLunch', name: 'Lunch', colour: 12, paid: false },
    ],
    people: [
      // Avery: 34 contract hours less 4 of admin and 2 of meetings leaves 28 of patient care.
      { id: 'pA', name: 'Avery Quill', role: 'Physician', kind: 'provider', departmentId: 'd1', step: 20, contractHours: 34, setAside: [{ activityId: 'aAdmin', hours: 4 }, { activityId: 'aMeet', hours: 2 }], careFactor: null, slotsPerHour: null, ramping: false, worksWith: [], work: [] },
      // Blake: 40 less 8 of admin and 2 of meetings leaves 30.
      { id: 'pB', name: 'Blake Rowan', role: 'Counsellor', kind: 'provider', departmentId: 'd2', step: 15, contractHours: 40, setAside: [{ activityId: 'aAdmin', hours: 8 }, { activityId: 'aMeet', hours: 2 }], careFactor: null, slotsPerHour: null, ramping: false, worksWith: [], work: [] },
    ],
    blocks: [],
    tolerance: 0,
  });
}

export const visit = (visitTypeId: string): What => ({ kind: 'visit', visitTypeId });
export const activity = (activityId: string): What => ({ kind: 'activity', activityId });
export const withTime = (personId: string): What => ({ kind: 'with', personId });
export const room = (siteId: string, roomId: string | null): Where => ({ kind: 'site', siteId, roomId });
export const REMOTE: Where = { kind: 'remote' };
export const NOWHERE: Where = { kind: 'none' };

/** One person's day as short lines, in time order: "540-560 Standard @ Exam 1, Elm Street". */
export function dayOf(s: Schedule, personId: string, day: Day): string[] {
  return s.blocks
    .filter((block) => block.personId === personId && block.day === day)
    .sort((a, b) => a.start - b.start)
    .map((block) => {
      const facts = factsOf(s, block);
      return `${block.start}-${endOf(block)} ${facts.name}${facts.place ? ` @ ${facts.place}` : ''}`;
    });
}

/** A block written out by hand, for tests that need an exact starting point. */
export function block(id: string, personId: string, day: Day, start: number, minutes: number, what: What, where: Where): Block {
  return { id, personId, day, start, minutes, what, where };
}

/** The same schedule with these blocks, frozen. */
export function withBlocks(s: Schedule, blocks: Block[]): Schedule {
  return deepFreeze({ ...s, blocks });
}

/** True when no two blocks of one person overlap on a day. */
export function noOverlaps(s: Schedule): boolean {
  const seen = new Map<string, Block[]>();
  for (const b of s.blocks) {
    const key = `${b.personId} ${b.day}`;
    const list = seen.get(key) ?? [];
    if (list.some((other) => other.start < endOf(b) && b.start < endOf(other))) return false;
    list.push(b);
    seen.set(key, list);
  }
  return true;
}
