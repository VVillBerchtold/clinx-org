// Checks that a value read from a file is a schedule this version of the tool can open.
//
// In plain words: a saved workbook carries the schedule as text. That text may have been cut
// short, changed by hand, or written by a newer version of the tool. Before the page trusts it,
// every part is looked at here: the right kinds of values, ids that are not repeated, blocks that
// point at people, visit types and rooms that exist, and no two blocks at once for one person.
// What comes back is a clean copy holding only what a schedule holds, or one sentence saying what
// is wrong. This never throws, whatever it is given.
//
// Three things about a person came later than the first saved files: whether they are a provider
// or support staff, the providers a support person works with, and working hours. A file without
// them still opens: the person is a provider, works with nobody and has no working hours entered.

import { DAY_MINUTES } from './time';
import { LIMITS } from './types';
import type { Activity, Block, Colour, Day, Department, Person, PersonKind, Room, Schedule, SetAside, Site, Step, VisitType, What, Where, WorkStretch } from './types';

/** The newest schedule version this tool can open. */
export const VERSION = 1;

/** A fault found while reading. It carries the sentence for the person. */
class Fault extends Error {}

const ADVICE = 'Open a workbook saved from this page that has not been changed by hand, or start a new schedule.';

function fail(what: string): never {
  throw new Fault(`This schedule cannot be opened because ${what}. ${ADVICE}`);
}

type Bag = Record<string, unknown>;

function bag(value: unknown, what: string): Bag {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${what} is missing or is not in the right form`);
  return value as Bag;
}

function list(value: unknown, what: string, most: number): unknown[] {
  if (!Array.isArray(value)) fail(`the list of ${what} is missing`);
  if (value.length > most) fail(`it has more than ${most} ${what}, which is too large for this tool`);
  return value;
}

function words(value: unknown, what: string, most: number = LIMITS.name): string {
  if (typeof value !== 'string') fail(`${what} is not text`);
  if (value.length > most) fail(`${what} is longer than ${most} characters`);
  return value;
}

function whole(value: unknown, what: string, least: number, most: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < least || value > most) fail(`${what} is not a whole number from ${least} to ${most}`);
  return value;
}

function hours(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > LIMITS.hours) fail(`${what} are not a number of hours from 0 to ${LIMITS.hours}`);
  return value;
}

/** A care factor: above 0 and at most 1. */
function factor(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > LIMITS.careFactor.most) fail(`${what} is not a number above 0 and at most ${LIMITS.careFactor.most}`);
  return value;
}

/** Slots in an hour: from 1 to 12. */
function slots(value: unknown, what: string): number {
  const { least, most } = LIMITS.slotsPerHour;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < least || value > most) fail(`${what} are not a number from ${least} to ${most}`);
  return value;
}

function step(value: unknown, what: string): Step {
  if (value !== 15 && value !== 20) fail(`${what} is neither 15 nor 20 minutes`);
  return value;
}

function colour(value: unknown, what: string): Colour {
  return whole(value, `the colour of ${what}`, 1, 12) as Colour;
}

/** Reads an id and makes sure no other thing in the schedule has it. */
function id(value: unknown, what: string, seen: Set<string>): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 40) fail(`${what} has no usable id`);
  if (seen.has(value)) fail(`two things in it share the id "${value.slice(0, 20)}"`);
  seen.add(value);
  return value;
}

function read(value: unknown): Schedule {
  const root = bag(value, 'the schedule');
  if (root['format'] !== 'clinx-schedule') throw new Fault('This is not a schedule made by this tool. Open a workbook that was saved from this page.');
  const version = root['version'];
  if (typeof version === 'number' && version > VERSION) {
    throw new Fault('This schedule was saved by a newer version of this tool than the one on this page. Reload the page to get the current version, then open the file again.');
  }
  if (version !== VERSION) fail('its version number is not one this tool knows');

  const seen = new Set<string>();
  const name = words(root['name'], 'its name');
  const clinic = words(root['clinic'], "the clinic's name");

  const days = list(root['days'], 'days', 7).map((day) => whole(day, 'a day', 0, 6) as Day);
  if (days.length === 0) fail('it shows no days');
  if (days.some((day, at) => at > 0 && day <= (days[at - 1] ?? -1))) fail('its days are repeated or out of order');

  const dayStart = whole(root['dayStart'], 'the first hour shown', 0, DAY_MINUTES);
  const dayEnd = whole(root['dayEnd'], 'the last hour shown', 0, DAY_MINUTES);
  if (dayEnd <= dayStart) fail('the hours it shows end before they start');

  const roomSite = new Map<string, string>();
  const sites = list(root['sites'], 'sites', LIMITS.sites).map((entry): Site => {
    const site = bag(entry, 'a site');
    const siteId = id(site['id'], 'a site', seen);
    const rooms = list(site['rooms'], 'rooms at one site', LIMITS.roomsPerSite).map((inner): Room => {
      const room = bag(inner, 'a room');
      const roomId = id(room['id'], 'a room', seen);
      roomSite.set(roomId, siteId);
      return { id: roomId, name: words(room['name'], "a room's name") };
    });
    return { id: siteId, name: words(site['name'], "a site's name"), rooms };
  });
  const siteIds = new Set(sites.map((site) => site.id));

  const visitMinutes = new Map<string, number>();
  const departments = list(root['departments'], 'departments', LIMITS.departments).map((entry): Department => {
    const department = bag(entry, 'a department');
    const departmentId = id(department['id'], 'a department', seen);
    const visitTypes = list(department['visitTypes'], 'visit types in one department', LIMITS.visitTypesPerDepartment).map((inner): VisitType => {
      const type = bag(inner, 'a visit type');
      const typeId = id(type['id'], 'a visit type', seen);
      const minutes = whole(type['minutes'], "a visit type's length", 1, LIMITS.visitMinutes.most);
      visitMinutes.set(typeId, minutes);
      return { id: typeId, name: words(type['name'], "a visit type's name"), code: words(type['code'], "a visit type's code", LIMITS.code), minutes, colour: colour(type['colour'], 'a visit type') };
    });
    return {
      id: departmentId,
      name: words(department['name'], "a department's name"),
      step: step(department['step'], "a department's grid"),
      careFactor: factor(department['careFactor'], "a department's care factor"),
      slotsPerHour: slots(department['slotsPerHour'], "a department's slots in an hour"),
      visitTypes,
    };
  });
  const departmentIds = new Set(departments.map((department) => department.id));

  const activities = list(root['activities'], 'activities', LIMITS.activities).map((entry): Activity => {
    const activity = bag(entry, 'an activity');
    if (typeof activity['paid'] !== 'boolean') fail('an activity does not say whether it is paid');
    return { id: id(activity['id'], 'an activity', seen), name: words(activity['name'], "an activity's name"), colour: colour(activity['colour'], 'an activity'), paid: activity['paid'] };
  });
  const activityIds = new Set(activities.map((activity) => activity.id));

  const people = list(root['people'], 'people', LIMITS.people).map((entry): Person => {
    const person = bag(entry, 'a person');
    const departmentId = person['departmentId'];
    if (typeof departmentId !== 'string' || !departmentIds.has(departmentId)) fail('a person belongs to a department that is not in it');
    const ramping = person['ramping'];
    if (typeof ramping !== 'boolean') fail('a person does not say whether they are ramping');
    const lines = new Set<string>();
    const setAside = list(person['setAside'], 'set-aside lines for one person', LIMITS.activities).map((inner): SetAside => {
      const line = bag(inner, 'a set-aside line');
      const activityId = line['activityId'];
      if (typeof activityId !== 'string' || !activityIds.has(activityId)) fail('a person has hours set aside for an activity that is not in it');
      if (lines.has(activityId)) fail('a person has two set-aside lines for one activity');
      lines.add(activityId);
      return { activityId, hours: hours(line['hours'], "a person's set-aside hours") };
    });
    // Missing in a file saved before support staff: a provider.
    const kindValue = person['kind'];
    if (kindValue !== undefined && kindValue !== 'provider' && kindValue !== 'support') fail('a person is neither a provider nor support staff');
    const kind: PersonKind = kindValue === 'support' ? 'support' : 'provider';
    // Missing in a file saved before support staff: nobody. The ids are checked once every person is read.
    const worksWith = person['worksWith'] === undefined ? [] : list(person['worksWith'], 'providers one person works with', LIMITS.worksWith).map((inner) => words(inner, 'the id of a provider a person works with', 40));
    if (kind === 'provider' && worksWith.length > 0) fail('a provider has a list of providers they work with, which only support staff have');
    // Missing in a file saved before working hours: none entered.
    const work = person['work'] === undefined ? [] : list(person['work'], 'working hours for one person', 7 * LIMITS.workStretchesPerDay).map((inner): WorkStretch => {
      const stretch = bag(inner, "a stretch of a person's working hours");
      const day = whole(stretch['day'], 'the day of a working stretch', 0, 6) as Day;
      if (!days.includes(day)) fail("a person's working hours are on a day the schedule does not show");
      const from = whole(stretch['from'], 'the start of a working stretch', 0, DAY_MINUTES);
      const to = whole(stretch['to'], 'the end of a working stretch', 0, DAY_MINUTES);
      if (from % LIMITS.workStep !== 0 || to % LIMITS.workStep !== 0) fail(`a person's working hours are not in steps of ${LIMITS.workStep} minutes`);
      if (to <= from) fail("a stretch of a person's working hours ends before it starts");
      return { day, from, to };
    });
    work.sort((a, b) => a.day - b.day || a.from - b.from);
    for (let at = 0; at < work.length; at++) {
      const stretch = work[at];
      const before = work[at - 1];
      if (!stretch) continue;
      if (before && before.day === stretch.day && before.to > stretch.from) fail("two stretches of a person's working hours overlap");
      if (work.filter((other) => other.day === stretch.day).length > LIMITS.workStretchesPerDay) fail(`a person has more than ${LIMITS.workStretchesPerDay} stretches of working hours in one day`);
    }
    return {
      id: id(person['id'], 'a person', seen),
      name: words(person['name'], "a person's name"),
      role: words(person['role'], "a person's role"),
      kind,
      departmentId,
      step: step(person['step'], "a person's grid"),
      contractHours: hours(person['contractHours'], "a person's contract hours"),
      setAside,
      careFactor: person['careFactor'] === null ? null : factor(person['careFactor'], "a person's own care factor"),
      slotsPerHour: person['slotsPerHour'] === null ? null : slots(person['slotsPerHour'], "a person's own slots in an hour"),
      ramping,
      worksWith,
      work,
    };
  });
  const personIds = new Set(people.map((person) => person.id));
  const kinds = new Map(people.map((person) => [person.id, person.kind]));
  for (const person of people) {
    if (new Set(person.worksWith).size !== person.worksWith.length) fail('a person lists one provider twice among those they work with');
    for (const providerId of person.worksWith) {
      if (providerId === person.id || kinds.get(providerId) !== 'provider') fail('a person works with someone who is not a provider in it');
    }
  }

  const blocks = list(root['blocks'], 'blocks of time', LIMITS.blocks).map((entry): Block => {
    const block = bag(entry, 'a block of time');
    const blockId = id(block['id'], 'a block of time', seen);
    const personId = block['personId'];
    if (typeof personId !== 'string' || !personIds.has(personId)) fail('a block of time belongs to a person who is not in it');
    const day = whole(block['day'], "a block's day", 0, 6) as Day;
    if (!days.includes(day)) fail('a block of time is on a day the schedule does not show');
    const start = whole(block['start'], "a block's start", 0, DAY_MINUTES - 1);
    const minutes = whole(block['minutes'], "a block's length", 1, DAY_MINUTES);
    if (start + minutes > DAY_MINUTES) fail('a block of time runs past midnight');

    const whatBag = bag(block['what'], "a block's kind of time");
    let what: What;
    if (whatBag['kind'] === 'visit') {
      const visitTypeId = whatBag['visitTypeId'];
      const length = typeof visitTypeId === 'string' ? visitMinutes.get(visitTypeId) : undefined;
      if (typeof visitTypeId !== 'string' || length === undefined) fail('an appointment is of a visit type that is not in it');
      if (length !== minutes) fail('an appointment is not as long as its visit type says');
      what = { kind: 'visit', visitTypeId };
    } else if (whatBag['kind'] === 'activity') {
      const activityId = whatBag['activityId'];
      if (typeof activityId !== 'string' || !activityIds.has(activityId)) fail('a block of time is of an activity that is not in it');
      what = { kind: 'activity', activityId };
    } else if (whatBag['kind'] === 'with') {
      const providerId = whatBag['personId'];
      if (kinds.get(personId) !== 'support') fail('time with a provider belongs to a person who is not support staff');
      if (typeof providerId !== 'string' || kinds.get(providerId) !== 'provider') fail('a block of time is with someone who is not a provider in it');
      what = { kind: 'with', personId: providerId };
    } else {
      fail('a block of time is not an appointment, an activity or time with a provider');
    }

    const whereBag = bag(block['where'], "a block's place");
    let where: Where;
    if (whereBag['kind'] === 'remote') where = { kind: 'remote' };
    else if (whereBag['kind'] === 'none') where = { kind: 'none' };
    else if (whereBag['kind'] === 'site') {
      const siteId = whereBag['siteId'];
      const roomId = whereBag['roomId'];
      if (typeof siteId !== 'string' || !siteIds.has(siteId)) fail('a block of time is at a site that is not in it');
      if (roomId !== null && (typeof roomId !== 'string' || roomSite.get(roomId) !== siteId)) fail('a block of time is in a room that is not at its site');
      where = { kind: 'site', siteId, roomId };
    } else {
      fail('a block of time has a place of a kind this tool does not know');
    }
    // Time with a provider is at the provider's site and never holds a room.
    if (what.kind === 'with' && (where.kind === 'remote' || (where.kind === 'site' && where.roomId !== null))) fail('time with a provider is remote or holds a room, which it never does');
    return { id: blockId, personId, day, start, minutes, what, where };
  });

  // One person cannot be in two places: look for two blocks at once.
  const order = [...blocks].sort((a, b) => (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : a.day - b.day || a.start - b.start));
  for (let at = 1; at < order.length; at++) {
    const before = order[at - 1];
    const block = order[at];
    if (before && block && before.personId === block.personId && before.day === block.day && before.start + before.minutes > block.start) {
      fail('one person has two blocks of time at once');
    }
  }

  // Time with a provider puts that provider on the person's list. A file where the list fell behind is put right.
  for (const block of blocks) {
    if (block.what.kind !== 'with') continue;
    const owner = people.find((person) => person.id === block.personId);
    if (owner && !owner.worksWith.includes(block.what.personId)) owner.worksWith.push(block.what.personId);
  }
  for (const person of people) if (person.worksWith.length > LIMITS.worksWith) fail(`a person works with more than ${LIMITS.worksWith} providers`);

  const tolerance = root['tolerance'];
  if (typeof tolerance !== 'number' || !Number.isFinite(tolerance) || tolerance < 0 || tolerance > LIMITS.tolerance) fail(`its tolerance is not a number of slots from 0 to ${LIMITS.tolerance}`);

  return { format: 'clinx-schedule', version: 1, name, clinic, days, dayStart, dayEnd, sites, departments, activities, people, blocks, tolerance };
}

/**
 * Checks a value read from a file. Gives back `{ schedule }`, a clean copy that holds only what a
 * schedule holds, or `{ problem }`, one sentence for the person. It never throws.
 */
export function validate(value: unknown): { schedule: Schedule } | { problem: string } {
  try {
    return { schedule: read(value) };
  } catch (error) {
    if (error instanceof Fault) return { problem: error.message };
    return { problem: `This schedule cannot be opened because it is not in the form this tool writes. ${ADVICE}` };
  }
}
