// Looking things up in a schedule: a person by id, a block's name and colour, where a block is.
//
// In plain words: a block only holds ids ("this person, this visit type, this room"). To draw it or
// count it, the tool needs the names and settings behind those ids. This file finds them. A
// schedule is never changed once made, so what is found for one schedule is remembered and reused.

import type { Activity, Block, Colour, Day, Department, Person, Room, Schedule, Site, VisitType, Where } from './types';

interface Index {
  people: Map<string, Person>;
  departments: Map<string, Department>;
  visitTypes: Map<string, { type: VisitType; department: Department }>;
  activities: Map<string, Activity>;
  sites: Map<string, Site>;
  rooms: Map<string, { room: Room; site: Site }>;
  /** Each person's blocks on each day, in time order. The key is the person's id, a space, and the day. */
  byPersonDay: Map<string, Block[]>;
}

const remembered = new WeakMap<Schedule, Index>();

function indexOf(s: Schedule): Index {
  const known = remembered.get(s);
  if (known) return known;
  const index: Index = { people: new Map(), departments: new Map(), visitTypes: new Map(), activities: new Map(), sites: new Map(), rooms: new Map(), byPersonDay: new Map() };
  for (const person of s.people) index.people.set(person.id, person);
  for (const department of s.departments) {
    index.departments.set(department.id, department);
    for (const type of department.visitTypes) index.visitTypes.set(type.id, { type, department });
  }
  for (const activity of s.activities) index.activities.set(activity.id, activity);
  for (const site of s.sites) {
    index.sites.set(site.id, site);
    for (const room of site.rooms) index.rooms.set(room.id, { room, site });
  }
  for (const block of s.blocks) {
    const key = `${block.personId} ${block.day}`;
    const list = index.byPersonDay.get(key);
    if (list) list.push(block);
    else index.byPersonDay.set(key, [block]);
  }
  for (const list of index.byPersonDay.values()) list.sort((a, b) => a.start - b.start);
  remembered.set(s, index);
  return index;
}

/** The person with this id, if there is one. */
export function personOf(s: Schedule, personId: string): Person | undefined {
  return indexOf(s).people.get(personId);
}

/** The department with this id, if there is one. */
export function departmentOf(s: Schedule, departmentId: string): Department | undefined {
  return indexOf(s).departments.get(departmentId);
}

/** The visit type with this id, if there is one. Visit type ids are unique across the whole schedule. */
export function visitTypeOf(s: Schedule, visitTypeId: string): VisitType | undefined {
  return indexOf(s).visitTypes.get(visitTypeId)?.type;
}

/** The department a visit type belongs to. */
export function departmentOfVisitType(s: Schedule, visitTypeId: string): Department | undefined {
  return indexOf(s).visitTypes.get(visitTypeId)?.department;
}

/** The activity with this id, if there is one. */
export function activityOf(s: Schedule, activityId: string): Activity | undefined {
  return indexOf(s).activities.get(activityId);
}

/** The site with this id, if there is one. */
export function siteOf(s: Schedule, siteId: string): Site | undefined {
  return indexOf(s).sites.get(siteId);
}

/** The room with this id, if there is one. Room ids are unique across the whole schedule. */
export function roomOf(s: Schedule, roomId: string): Room | undefined {
  return indexOf(s).rooms.get(roomId)?.room;
}

/** The site a room is in. */
export function siteOfRoom(s: Schedule, roomId: string): Site | undefined {
  return indexOf(s).rooms.get(roomId)?.site;
}

/** One person's blocks on one day, in time order. The list is shared: do not change it. */
export function blocksOn(s: Schedule, personId: string, day: Day): readonly Block[] {
  return indexOf(s).byPersonDay.get(`${personId} ${day}`) ?? [];
}

/** All of one person's blocks, by day and then by time. */
export function blocksOf(s: Schedule, personId: string): Block[] {
  return s.days.flatMap((day) => blocksOn(s, personId, day));
}

/** The minute a block ends. */
export function endOf(block: Block): number {
  return block.start + block.minutes;
}

/** True when two places are the same place. */
export function sameWhere(a: Where, b: Where): boolean {
  if (a.kind === 'site' && b.kind === 'site') return a.siteId === b.siteId && a.roomId === b.roomId;
  return a.kind === b.kind;
}

/** True when two blocks hold the same kind of time: the same visit type, the same activity, or time with the same provider. */
export function sameWhat(a: Block['what'], b: Block['what']): boolean {
  if (a.kind === 'visit' && b.kind === 'visit') return a.visitTypeId === b.visitTypeId;
  if (a.kind === 'activity' && b.kind === 'activity') return a.activityId === b.activityId;
  if (a.kind === 'with' && b.kind === 'with') return a.personId === b.personId;
  return false;
}

/** The swatches a person can be given, in the order they are handed out. Grey is left out: it reads as empty or unpaid time. */
const PERSON_SWATCHES: readonly Colour[] = [2, 4, 9, 7, 1, 3, 5, 8, 6, 10, 11];

/**
 * A steady swatch for a person, chosen from their place among the people of their own kind: the
 * first provider gets the first swatch, the second the next, and so on round the list. Time with
 * a provider is drawn in that provider's swatch, so two providers look different on one support
 * person's week. A support person's swatch marks them on a provider's week. Gives grey for a
 * person who is not in the schedule.
 */
export function personColour(s: Schedule, personId: string): Colour {
  const person = personOf(s, personId);
  if (!person) return 12;
  const place = s.people.filter((other) => other.kind === person.kind).findIndex((other) => other.id === personId);
  return PERSON_SWATCHES[Math.max(0, place) % PERSON_SWATCHES.length] ?? 12;
}

/** A person's initials, for a small block: "Maren Castellane" gives "MC", and a single name gives one letter. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter((part) => part !== '');
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  const letter = (word: string | undefined): string => (word === undefined ? '' : (Array.from(word)[0] ?? '').toUpperCase());
  return letter(first) + letter(last);
}

/** A place in words: "Exam 2, Mill Street", "Mill Street", "Remote", or nothing when no place is set. */
export function whereText(s: Schedule, where: Where): string {
  if (where.kind === 'remote') return 'Remote';
  if (where.kind === 'none') return '';
  const site = siteOf(s, where.siteId)?.name ?? '';
  const room = where.roomId === null ? '' : (roomOf(s, where.roomId)?.name ?? '');
  return room && site ? `${room}, ${site}` : room || site;
}

/** The short form of a place, for a small block: the room's name if there is one, or the site's, or "Remote". */
export function whereShort(s: Schedule, where: Where): string {
  if (where.kind === 'remote') return 'Remote';
  if (where.kind === 'none') return '';
  if (where.roomId !== null) return roomOf(s, where.roomId)?.name ?? '';
  return siteOf(s, where.siteId)?.name ?? '';
}

/** What a page needs to draw one block. */
export interface BlockFacts {
  /** What kind of time the block is: an appointment, an activity, or time with a provider. */
  kind: Block['what']['kind'];
  /** The visit type's or the activity's name, or "With" and the provider's name. */
  name: string;
  /** The visit type's short code, or the provider's initials for time with a provider. Empty for an activity. */
  code: string;
  colour: Colour;
  /** True for an appointment: time with patients. */
  care: boolean;
  /** True when the time counts toward paid hours. Every appointment does. */
  paid: boolean;
  /** The place in full: "Exam 2, Mill Street". */
  place: string;
  /** The place in short: "Exam 2". */
  placeShort: string;
  from: number;
  to: number;
}

/** The name, colour, place and times of a block, ready to draw. */
export function factsOf(s: Schedule, block: Block): BlockFacts {
  const place = whereText(s, block.where);
  const placeShort = whereShort(s, block.where);
  const times = { from: block.start, to: endOf(block) };
  if (block.what.kind === 'visit') {
    const type = visitTypeOf(s, block.what.visitTypeId);
    return { kind: 'visit', name: type?.name ?? '', code: type?.code ?? '', colour: type?.colour ?? 12, care: true, paid: true, place, placeShort, ...times };
  }
  if (block.what.kind === 'with') {
    const provider = personOf(s, block.what.personId);
    const name = provider?.name ?? '';
    return { kind: 'with', name: name === '' ? 'With a provider' : `With ${name}`, code: initialsOf(name), colour: personColour(s, block.what.personId), care: false, paid: true, place, placeShort, ...times };
  }
  const activity = activityOf(s, block.what.activityId);
  return { kind: 'activity', name: activity?.name ?? '', code: '', colour: activity?.colour ?? 12, care: false, paid: activity?.paid ?? false, place, placeShort, ...times };
}
