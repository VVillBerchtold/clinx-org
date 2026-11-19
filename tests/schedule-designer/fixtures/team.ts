// The small made-up schedule with two support staff added, for the tests of working hours and
// care teams. Every name here is invented.

import type { Block, Schedule } from '../../../src/scripts/schedule-designer/engine/types';
import { block, deepFreeze, room, small, visit } from './small';

/**
 * The small schedule and two support staff in Primary care, with nothing on their weeks:
 * Sage Marlow, a medical assistant with a contract of 40 hours, and Teal Ostrander, a nurse with
 * a contract of 20. Neither lists a provider yet and nobody has working hours.
 */
export function team(): Schedule {
  const s = small();
  return deepFreeze<Schedule>({
    ...s,
    people: [
      ...s.people,
      { id: 'pS', name: 'Sage Marlow', role: 'Medical assistant', kind: 'support', departmentId: 'd1', step: 20, contractHours: 40, setAside: [], careFactor: null, slotsPerHour: null, ramping: false, worksWith: [], work: [] },
      { id: 'pT', name: 'Teal Ostrander', role: 'Nurse', kind: 'support', departmentId: 'd1', step: 20, contractHours: 20, setAside: [], careFactor: null, slotsPerHour: null, ramping: false, worksWith: [], work: [] },
    ],
  });
}

/** Twenty-minute appointments in a row for one person, written out by hand: `count` of them from `from`. */
export function visits(prefix: string, personId: string, day: Block['day'], from: number, count: number, where: Block['where'] = room('s1', 'r1')): Block[] {
  return Array.from({ length: count }, (_, at) => block(`${prefix}${at}`, personId, day, from + at * 20, 20, visit('v20'), where));
}

/** The same schedule with one person changed, frozen. */
export function withPerson(s: Schedule, personId: string, change: Partial<Schedule['people'][number]>): Schedule {
  return deepFreeze({ ...s, people: s.people.map((person) => (person.id === personId ? { ...person, ...change } : person)) });
}
