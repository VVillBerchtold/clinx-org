// Every change a person can make to a schedule: painting time, erasing it, and editing the lists.
//
// In plain words: nothing here ever changes the schedule it is given. Each edit hands back a new
// schedule, so the page can keep the old ones for undo. When an edit has nothing to do (the person
// is not in the schedule, the range is empty, the name is the same) it hands back the very same
// schedule it was given, so the page can tell that nothing happened.
//
// The rules of painting, in one place:
// - One person's blocks never overlap on a day. Painting clears the range first.
// - An appointment is all or nothing. Anything that covers part of an appointment removes it.
// - Other time (a meeting, admin, lunch) can be trimmed or split, and joins up with a touching
//   block of the same activity in the same place.
// - Time a support person spends with a provider behaves like other time. Its place is always the
//   provider's site with no room, worked out here and never taken from the request.
// - Blocks keep the exact minutes they were painted at. The grid is only a guide for the page.

import { blocksOn, departmentOf, endOf, personOf, sameWhat, sameWhere, siteOf, siteOfRoom, visitTypeOf, activityOf } from './find';
import { DAY_MINUTES } from './time';
import { ALL_COLOURS, LIMITS } from './types';
import type { Activity, Block, Colour, Day, Department, Person, PersonKind, Schedule, SetAside, Step, VisitType, What, Where } from './types';

/** What to paint: a person, a day, a stretch of minutes, what the time is and where it is spent. */
export interface PaintRequest {
  personId: string;
  day: Day;
  /** The first minute of the range. */
  from: number;
  /** The minute the range ends. */
  to: number;
  what: What;
  where: Where;
}

/** What to erase: a person, a day and a stretch of minutes. */
export interface EraseRequest {
  personId: string;
  day: Day;
  from: number;
  to: number;
}

/** A stretch of one person's day to move to another place. */
export interface PlaceRequest {
  personId: string;
  day: Day;
  from: number;
  to: number;
  where: Where;
}

/**
 * The result of an edit that can take blocks with it, such as removing a room.
 * `touched` is how many blocks were removed or changed, so the page can say so and offer undo.
 * `problem` is set, in a sentence for the person, when the edit could not be done at all.
 */
export interface Change {
  schedule: Schedule;
  touched: number;
  problem?: string;
}

// ---------------------------------------------------------------------------------------------
// Ids

const ID_LETTERS = 'abcdefghijkmnpqrstuvwxyz23456789';

/** A short random id: eight letters and digits. Pass the ids already in use to be sure of a new one. */
export function newId(taken?: ReadonlySet<string>): string {
  for (;;) {
    let id = '';
    for (const byte of crypto.getRandomValues(new Uint8Array(8))) id += ID_LETTERS.charAt(byte & 31);
    if (!taken?.has(id)) return id;
  }
}

/** Every id in a schedule, so a new one never repeats an old one. New ids are added to the set as they are made. */
function idsIn(s: Schedule): Set<string> {
  const ids = new Set<string>();
  for (const site of s.sites) {
    ids.add(site.id);
    for (const room of site.rooms) ids.add(room.id);
  }
  for (const department of s.departments) {
    ids.add(department.id);
    for (const type of department.visitTypes) ids.add(type.id);
  }
  for (const activity of s.activities) ids.add(activity.id);
  for (const person of s.people) ids.add(person.id);
  for (const block of s.blocks) ids.add(block.id);
  return ids;
}

function fresh(taken: Set<string>): string {
  const id = newId(taken);
  taken.add(id);
  return id;
}

// ---------------------------------------------------------------------------------------------
// Small helpers

/** A name as it is kept: no spaces at the ends, and no longer than the limit. */
function tidy(text: string, most: number = LIMITS.name): string {
  return String(text).trim().slice(0, most).trim();
}

const isDay = (value: unknown): value is Day => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;
const isStep = (value: unknown): value is Step => value === 15 || value === 20;

/** A care factor as it is kept: from 0.01 to 1, to three decimal places. */
function factorIn(value: number): number {
  return Math.round(Math.min(LIMITS.careFactor.most, Math.max(LIMITS.careFactor.least, value)) * 1000) / 1000;
}

/** Slots in an hour as they are kept: from 1 to 12, to two decimal places. */
function slotsIn(value: number): number {
  return Math.round(Math.min(LIMITS.slotsPerHour.most, Math.max(LIMITS.slotsPerHour.least, value)) * 100) / 100;
}

const isColour = (value: unknown): value is Colour => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 12;

/** A place with exactly the fields a place has, or nothing when it names a site or room the schedule does not have. */
function placeIn(s: Schedule, where: Where): Where | undefined {
  if (where.kind === 'remote') return { kind: 'remote' };
  if (where.kind === 'none') return { kind: 'none' };
  if (where.kind !== 'site' || !siteOf(s, where.siteId)) return undefined;
  if (where.roomId === null) return { kind: 'site', siteId: where.siteId, roomId: null };
  if (siteOfRoom(s, where.roomId)?.id !== where.siteId) return undefined;
  return { kind: 'site', siteId: where.siteId, roomId: where.roomId };
}

/** A stretch of minutes kept inside the day, or nothing when it is empty or not a number. */
function rangeIn(from: number, to: number): { from: number; to: number } | undefined {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return undefined;
  const start = Math.min(DAY_MINUTES, Math.max(0, Math.round(from)));
  const end = Math.min(DAY_MINUTES, Math.max(0, Math.round(to)));
  return end > start ? { from: start, to: end } : undefined;
}

const isOf = (block: Block, personId: string, day: Day): boolean => block.personId === personId && block.day === day;

/**
 * Clears a stretch of one person's day. An activity block is trimmed, or split in two when the
 * middle goes. An appointment the stretch touches at all is removed whole. Gives back the same
 * list when nothing was in the way.
 */
function cut(blocks: readonly Block[], personId: string, day: Day, from: number, to: number, taken: Set<string>): readonly Block[] {
  let changed = false;
  const out: Block[] = [];
  for (const block of blocks) {
    const end = endOf(block);
    if (!isOf(block, personId, day) || block.start >= to || end <= from) {
      out.push(block);
      continue;
    }
    changed = true;
    if (block.what.kind === 'visit') continue;
    const keepsStart = block.start < from;
    if (keepsStart) out.push({ ...block, minutes: from - block.start });
    if (end > to) out.push({ ...block, id: keepsStart ? fresh(taken) : block.id, start: to, minutes: end - to });
  }
  return changed ? out : blocks;
}

/**
 * Joins blocks of one person's day that touch and are the same activity, or time with the same
 * provider, in the same place. Appointments are never joined. The joined block keeps the id of
 * the earlier one. Gives back the same list when nothing joined.
 */
function join(blocks: readonly Block[], personId: string, day: Day): readonly Block[] {
  const mine = blocks.filter((block) => isOf(block, personId, day) && block.what.kind !== 'visit').sort((a, b) => a.start - b.start);
  const grown = new Map<string, Block>();
  const gone = new Set<string>();
  let last: Block | undefined;
  for (const block of mine) {
    if (last && endOf(last) === block.start && sameWhat(last.what, block.what) && sameWhere(last.where, block.where)) {
      last = { ...last, minutes: last.minutes + block.minutes };
      grown.set(last.id, last);
      gone.add(block.id);
    } else {
      last = block;
    }
  }
  if (gone.size === 0) return blocks;
  return blocks.filter((block) => !gone.has(block.id)).map((block) => grown.get(block.id) ?? block);
}

/** Joins up every person's days. Used after an edit that changes places across the schedule. */
function joinAll(s: Schedule, blocks: readonly Block[]): readonly Block[] {
  let out = blocks;
  for (const person of s.people) for (const day of s.days) out = join(out, person.id, day);
  return out;
}

const withBlocks = (s: Schedule, blocks: readonly Block[]): Schedule => (blocks === s.blocks ? s : { ...s, blocks: [...blocks] });

/**
 * Where time with a provider is spent: the site where the provider has the most time in that
 * stretch of the day, with no room. When the provider has no time at a site then, it is the site
 * of the place asked for, or else the site where the provider spends the most of that day, or
 * else no place.
 */
function placeWith(s: Schedule, providerId: string, day: Day, from: number, to: number, asked: Where): Where {
  const inRange = new Map<string, number>();
  const inDay = new Map<string, number>();
  for (const block of blocksOn(s, providerId, day)) {
    if (block.where.kind !== 'site') continue;
    inDay.set(block.where.siteId, (inDay.get(block.where.siteId) ?? 0) + block.minutes);
    const shared = Math.max(0, Math.min(to, endOf(block)) - Math.max(from, block.start));
    if (shared > 0) inRange.set(block.where.siteId, (inRange.get(block.where.siteId) ?? 0) + shared);
  }
  const most = (sums: Map<string, number>): string | undefined => {
    let chosen: string | undefined;
    for (const [siteId, minutes] of sums) if (chosen === undefined || minutes > (sums.get(chosen) ?? 0)) chosen = siteId;
    return chosen;
  };
  const siteId = most(inRange) ?? (asked.kind === 'site' ? asked.siteId : most(inDay));
  return siteId === undefined ? { kind: 'none' } : { kind: 'site', siteId, roomId: null };
}

// ---------------------------------------------------------------------------------------------
// A new schedule

/**
 * A schedule to start from: Monday to Friday, 6:00 am to 9:00 pm, one site with two rooms, one
 * 20 minute department with three visit types, four kinds of other time, and nobody in it yet.
 * The department has a care factor of 1 and 3 slots in an hour, and the tolerance is 0 slots.
 * The set-up step adds the people. Every name is a plain placeholder for the person to change.
 */
export function newSchedule(): Schedule {
  const taken = new Set<string>();
  return {
    format: 'clinx-schedule',
    version: 1,
    name: NEW_NAME,
    clinic: '',
    days: [0, 1, 2, 3, 4],
    dayStart: 360,
    dayEnd: 1260,
    sites: [
      {
        id: fresh(taken),
        name: 'Main site',
        rooms: [
          { id: fresh(taken), name: 'Room 1' },
          { id: fresh(taken), name: 'Room 2' },
        ],
      },
    ],
    departments: [
      {
        id: fresh(taken),
        name: 'Primary care',
        step: 20,
        careFactor: 1,
        slotsPerHour: 3,
        visitTypes: [
          { id: fresh(taken), name: 'Standard', code: 'STD', minutes: 20, colour: 1 },
          { id: fresh(taken), name: 'New patient', code: 'NEW', minutes: 40, colour: 2 },
          { id: fresh(taken), name: 'Same day', code: 'SAME', minutes: 20, colour: 3 },
        ],
      },
    ],
    activities: [
      { id: fresh(taken), name: 'Huddle', colour: 6, paid: true },
      { id: fresh(taken), name: 'Meeting', colour: 7, paid: true },
      { id: fresh(taken), name: 'Admin time', colour: 11, paid: true },
      { id: fresh(taken), name: 'Lunch', colour: 12, paid: false },
    ],
    people: [],
    blocks: [],
    tolerance: 0,
  };
}

/** The name a schedule has until the person gives it one. */
const NEW_NAME = 'New schedule';

/**
 * A new schedule that starts from another one's set-up, for a new season.
 *
 * It keeps the clinic's name, the days and hours, the sites and their rooms, the departments with
 * their visit types and standards, the other kinds of time, the tolerance, and every person with
 * their contract, set-aside hours, own standards, ramping, kind, working hours and the providers
 * support staff work with. It removes every block, and it gives
 * the schedule the name a new one starts with, because a schedule's name cannot be empty and the
 * old name belongs to the old weeks. Ids stay as they were, so everything still points at the
 * right thing. The schedule it is given is never changed, and the one handed back is always
 * another one.
 */
export function fromSetup(s: Schedule): Schedule {
  return {
    format: 'clinx-schedule',
    version: 1,
    name: NEW_NAME,
    clinic: s.clinic,
    days: s.days,
    dayStart: s.dayStart,
    dayEnd: s.dayEnd,
    sites: s.sites,
    departments: s.departments,
    activities: s.activities,
    people: s.people,
    blocks: [],
    tolerance: s.tolerance,
  };
}

// ---------------------------------------------------------------------------------------------
// Painting and erasing

/**
 * Paints a stretch of one person's day.
 *
 * With a visit type, it lays whole appointments end to end from the start of the range. A piece
 * left over at the end that is too short for one more appointment stays empty. A range shorter
 * than one appointment still places one, so a click on a single cell paints. If that one
 * appointment would run past midnight, nothing is placed. Any visit type in the schedule may be
 * used, also one from another department than the person's.
 *
 * With an activity, it makes one block for the whole range, then joins it to a touching block of
 * the same activity in the same place.
 *
 * With time with a provider, it makes one block for the whole range in the same way. Only support
 * staff can hold such time, and only with a provider: anything else changes nothing. The place is
 * the provider's site in that stretch with no room, whatever place the request names (see
 * `placeWith` above). A provider who is not yet on the person's "works with" list is added to it.
 *
 * Either way the time painted over is cleared first: an activity there is trimmed or split, and an
 * appointment touched even in part is removed. Nothing changes when the person, the day, the kind
 * of time or the place is not in the schedule, or the range is empty. Nothing changes either when
 * the day would hold the very same time afterwards: the same kinds, in the same places, at the
 * same times. Adding a thing over itself is not a change, so it is no step to undo.
 */
export function paint(s: Schedule, request: PaintRequest): Schedule {
  const next = layDown(s, request);
  if (next === s) return s;
  const day = (from: Schedule): string =>
    from.blocks
      .filter((block) => block.personId === request.personId && block.day === request.day)
      .map((block) => `${block.start}|${block.minutes}|${JSON.stringify(block.what)}|${JSON.stringify(block.where)}`)
      .sort()
      .join('\n');
  return day(next) === day(s) && next.people === s.people ? s : next;
}

function layDown(s: Schedule, request: PaintRequest): Schedule {
  const range = rangeIn(request.from, request.to);
  const where = placeIn(s, request.where);
  if (!range || !where || !personOf(s, request.personId) || !s.days.includes(request.day)) return s;
  if (s.blocks.length >= LIMITS.blocks) return s;
  const { personId, day } = request;
  const taken = idsIn(s);

  if (request.what.kind === 'visit') {
    const type = visitTypeOf(s, request.what.visitTypeId);
    if (!type) return s;
    let count = Math.max(1, Math.floor((range.to - range.from) / type.minutes));
    count = Math.min(count, Math.floor((DAY_MINUTES - range.from) / type.minutes));
    if (count < 1) return s;
    const blocks = [...cut(s.blocks, personId, day, range.from, range.from + count * type.minutes, taken)];
    for (let i = 0; i < count; i++) {
      blocks.push({ id: fresh(taken), personId, day, start: range.from + i * type.minutes, minutes: type.minutes, what: { kind: 'visit', visitTypeId: type.id }, where });
    }
    return { ...s, blocks };
  }

  if (request.what.kind === 'with') {
    const owner = personOf(s, personId);
    const provider = personOf(s, request.what.personId);
    if (!owner || owner.kind !== 'support' || !provider || provider.kind !== 'provider') return s;
    const listed = owner.worksWith.includes(provider.id);
    if (!listed && owner.worksWith.length >= LIMITS.worksWith) return s;
    const blocks = [...cut(s.blocks, personId, day, range.from, range.to, taken)];
    blocks.push({ id: fresh(taken), personId, day, start: range.from, minutes: range.to - range.from, what: { kind: 'with', personId: provider.id }, where: placeWith(s, provider.id, day, range.from, range.to, where) });
    const people = listed ? s.people : s.people.map((item) => (item.id === personId ? { ...item, worksWith: [...item.worksWith, provider.id] } : item));
    return { ...s, people, blocks: [...join(blocks, personId, day)] };
  }

  if (request.what.kind !== 'activity' || !activityOf(s, request.what.activityId)) return s;
  const blocks = [...cut(s.blocks, personId, day, range.from, range.to, taken)];
  blocks.push({ id: fresh(taken), personId, day, start: range.from, minutes: range.to - range.from, what: { kind: 'activity', activityId: request.what.activityId }, where });
  return { ...s, blocks: [...join(blocks, personId, day)] };
}

/**
 * Erases a stretch of one person's day. An activity block is trimmed, or split in two when the
 * middle is erased: the first piece keeps the block's id and the second is a new block. An
 * appointment the stretch touches, even in part, is removed whole. A block that only touches the
 * edge of the stretch is left alone.
 */
export function erase(s: Schedule, request: EraseRequest): Schedule {
  const range = rangeIn(request.from, request.to);
  if (!range) return s;
  return withBlocks(s, cut(s.blocks, request.personId, request.day, range.from, range.to, idsIn(s)));
}

/**
 * Moves time already painted to another place, without painting it again. Every block the stretch
 * touches takes the new place, whole blocks at a time. Activity blocks that now touch in the same
 * place are joined. Use it to give rooms to a copied person, or to answer a "no room" finding.
 * Time with a provider never takes a room and is never remote: it takes the site of the new place
 * with no room, and stays as it is when the new place is remote.
 */
export function setPlace(s: Schedule, request: PlaceRequest): Schedule {
  const range = rangeIn(request.from, request.to);
  const where = placeIn(s, request.where);
  if (!range || !where) return s;
  let changed = false;
  const besideProvider: Where | undefined = where.kind === 'site' ? { kind: 'site', siteId: where.siteId, roomId: null } : where.kind === 'none' ? where : undefined;
  const moved = s.blocks.map((block) => {
    if (!isOf(block, request.personId, request.day) || block.start >= range.to || endOf(block) <= range.from) return block;
    const to = block.what.kind === 'with' ? besideProvider : where;
    if (!to || sameWhere(block.where, to)) return block;
    changed = true;
    return { ...block, where: to };
  });
  return changed ? { ...s, blocks: [...join(moved, request.personId, request.day)] } : s;
}

/**
 * Copies one person's day onto other days. Each day copied onto loses what it had and gets new
 * blocks at the same times. Copying an empty day therefore clears the others. The day itself, a
 * day named twice and a day the schedule does not show are skipped.
 */
export function copyDay(s: Schedule, personId: string, fromDay: Day, toDays: readonly Day[]): Schedule {
  if (!personOf(s, personId) || !s.days.includes(fromDay)) return s;
  const targets = [...new Set(toDays)].filter((day) => day !== fromDay && s.days.includes(day));
  if (targets.length === 0) return s;
  const source = blocksOn(s, personId, fromDay);
  const blocks = s.blocks.filter((block) => block.personId !== personId || !targets.includes(block.day));
  if (source.length === 0 && blocks.length === s.blocks.length) return s;
  const taken = idsIn(s);
  for (const day of targets) for (const block of source) blocks.push({ ...block, id: fresh(taken), day });
  return { ...s, blocks };
}

/** Removes everything one person has on one day. */
export function clearDay(s: Schedule, personId: string, day: Day): Schedule {
  const blocks = s.blocks.filter((block) => !isOf(block, personId, day));
  return blocks.length === s.blocks.length ? s : { ...s, blocks };
}

/**
 * Switches one person's grid between 15 and 20 minutes. Only the lines and the snapping change:
 * every block keeps its true times. The checks then note any block that does not sit on the new grid.
 */
export function setStep(s: Schedule, personId: string, step: Step): Schedule {
  const person = personOf(s, personId);
  if (!person || !isStep(step) || person.step === step) return s;
  return { ...s, people: s.people.map((p) => (p.id === personId ? { ...p, step } : p)) };
}

// ---------------------------------------------------------------------------------------------
// The clinic's own details

/** Sets the schedule's name, the clinic's name, or both. The schedule's name cannot be empty; the clinic's can. */
export function setDetails(s: Schedule, details: { name?: string; clinic?: string }): Schedule {
  const name = details.name === undefined ? s.name : tidy(details.name) || s.name;
  const clinic = details.clinic === undefined ? s.clinic : tidy(details.clinic);
  return name === s.name && clinic === s.clinic ? s : { ...s, name, clinic };
}

/**
 * Sets the hours the grid shows. Both are rounded to five minutes and must be at least an hour
 * apart. Blocks keep their times: one that now falls outside the hours is reported by the checks.
 * Working hours keep their times too. A working stretch that now reaches outside the hours shown
 * is listed by `workOutsideHours` in work.ts and reported by the checks, so nothing is hidden
 * without a word.
 * A person's grid lines are counted from the first minute shown, so moving it by an amount that is
 * not a multiple of their step leaves their blocks off the grid.
 */
export function setHours(s: Schedule, dayStart: number, dayEnd: number): Schedule {
  if (!Number.isFinite(dayStart) || !Number.isFinite(dayEnd)) return s;
  const start = Math.round(dayStart / 5) * 5;
  const end = Math.round(dayEnd / 5) * 5;
  if (start < 0 || end > DAY_MINUTES || end - start < 60) return s;
  return start === s.dayStart && end === s.dayEnd ? s : { ...s, dayStart: start, dayEnd: end };
}

/**
 * Sets the tolerance: how many slots a week may be over or under its target and still count as on
 * target. It is kept from 0 to 100, to one decimal place. Nothing changes when it is not a number.
 */
export function setTolerance(s: Schedule, slots: number): Schedule {
  if (!Number.isFinite(slots)) return s;
  const tolerance = Math.round(Math.min(LIMITS.tolerance, Math.max(0, slots)) * 10) / 10;
  return tolerance === s.tolerance ? s : { ...s, tolerance };
}

/**
 * Sets the days the schedule shows, kept in week order from Monday. At least one day must stay.
 * Blocks on a day that is taken away are removed, and `touched` says how many. Working hours on
 * such a day are removed with them.
 */
export function setDays(s: Schedule, days: readonly Day[]): Change {
  const kept = [...new Set(days.filter(isDay))].sort((a, b) => a - b);
  if (kept.length === 0) return { schedule: s, touched: 0, problem: 'Keep at least one day in the week.' };
  if (kept.length === s.days.length && kept.every((day, at) => s.days[at] === day)) return { schedule: s, touched: 0 };
  const blocks = s.blocks.filter((block) => kept.includes(block.day));
  const people = s.people.map((person) => (person.work.every((stretch) => kept.includes(stretch.day)) ? person : { ...person, work: person.work.filter((stretch) => kept.includes(stretch.day)) }));
  return { schedule: { ...s, days: kept, people, blocks }, touched: s.blocks.length - blocks.length };
}

// ---------------------------------------------------------------------------------------------
// Sites and rooms

/** Adds a site, with no rooms yet, at the end of the list. */
export function addSite(s: Schedule, name = 'New site'): Schedule {
  if (s.sites.length >= LIMITS.sites) return s;
  return { ...s, sites: [...s.sites, { id: newId(idsIn(s)), name: tidy(name) || 'New site', rooms: [] }] };
}

/** Renames a site. An empty name is refused. */
export function renameSite(s: Schedule, siteId: string, name: string): Schedule {
  const site = siteOf(s, siteId);
  const next = tidy(name);
  if (!site || !next || next === site.name) return s;
  return { ...s, sites: s.sites.map((item) => (item.id === siteId ? { ...item, name: next } : item)) };
}

/**
 * Removes a site and its rooms. Time that was spent there stays in the week with no place set,
 * and `touched` says how many blocks that is.
 */
export function removeSite(s: Schedule, siteId: string): Change {
  if (!siteOf(s, siteId)) return { schedule: s, touched: 0 };
  let touched = 0;
  const blocks = s.blocks.map((block): Block => {
    if (block.where.kind !== 'site' || block.where.siteId !== siteId) return block;
    touched++;
    return { ...block, where: { kind: 'none' } };
  });
  const next = { ...s, sites: s.sites.filter((site) => site.id !== siteId) };
  return { schedule: { ...next, blocks: [...joinAll(next, blocks)] }, touched };
}

/** Adds a room to a site, at the end of its list. */
export function addRoom(s: Schedule, siteId: string, name = 'New room'): Schedule {
  const site = siteOf(s, siteId);
  if (!site || site.rooms.length >= LIMITS.roomsPerSite) return s;
  const room = { id: newId(idsIn(s)), name: tidy(name) || 'New room' };
  return { ...s, sites: s.sites.map((item) => (item.id === siteId ? { ...item, rooms: [...item.rooms, room] } : item)) };
}

/** Renames a room. An empty name is refused. */
export function renameRoom(s: Schedule, roomId: string, name: string): Schedule {
  const site = siteOfRoom(s, roomId);
  const next = tidy(name);
  if (!site || !next || site.rooms.find((room) => room.id === roomId)?.name === next) return s;
  return { ...s, sites: s.sites.map((item) => (item.id === site.id ? { ...item, rooms: item.rooms.map((room) => (room.id === roomId ? { ...room, name: next } : room)) } : item)) };
}

/**
 * Removes a room. Time that was in it stays at the same site with no room chosen, and `touched`
 * says how many blocks that is.
 */
export function removeRoom(s: Schedule, roomId: string): Change {
  const site = siteOfRoom(s, roomId);
  if (!site) return { schedule: s, touched: 0 };
  let touched = 0;
  const blocks = s.blocks.map((block): Block => {
    if (block.where.kind !== 'site' || block.where.roomId !== roomId) return block;
    touched++;
    return { ...block, where: { kind: 'site', siteId: block.where.siteId, roomId: null } };
  });
  const sites = s.sites.map((item) => (item.id === site.id ? { ...item, rooms: item.rooms.filter((room) => room.id !== roomId) } : item));
  return { schedule: { ...s, sites, blocks: [...joinAll(s, blocks)] }, touched };
}

// ---------------------------------------------------------------------------------------------
// Departments and visit types

/**
 * Adds a department, with no visit types yet, at the end of the list. It starts with a care
 * factor of 1 and one slot for each line of its grid: 3 slots in an hour at 20 minutes, 4 at 15.
 */
export function addDepartment(s: Schedule, name = 'New department', step: Step = 20): Schedule {
  if (s.departments.length >= LIMITS.departments) return s;
  const grid: Step = isStep(step) ? step : 20;
  const department: Department = { id: newId(idsIn(s)), name: tidy(name) || 'New department', step: grid, careFactor: 1, slotsPerHour: 60 / grid, visitTypes: [] };
  return { ...s, departments: [...s.departments, department] };
}

/** Renames a department. An empty name is refused. */
export function renameDepartment(s: Schedule, departmentId: string, name: string): Schedule {
  const department = departmentOf(s, departmentId);
  const next = tidy(name);
  if (!department || !next || next === department.name) return s;
  return { ...s, departments: s.departments.map((item) => (item.id === departmentId ? { ...item, name: next } : item)) };
}

/**
 * Sets a department's grid: the grid a new person in it starts with, and the length the tallies
 * use for "appointments still needed". People already in the department keep their own grid.
 * The slots in an hour follow the grid only while they still match it (3 at 20 minutes, 4 at 15):
 * once they have been set to something else with `setDepartmentStandards`, they stay as set.
 */
export function setDepartmentStep(s: Schedule, departmentId: string, step: Step): Schedule {
  const department = departmentOf(s, departmentId);
  if (!department || !isStep(step) || department.step === step) return s;
  const slotsPerHour = department.slotsPerHour === 60 / department.step ? 60 / step : department.slotsPerHour;
  return { ...s, departments: s.departments.map((item) => (item.id === departmentId ? { ...item, step, slotsPerHour } : item)) };
}

/**
 * Sets a department's standards: its care factor (the share of contract hours that is patient
 * care, such as 0.8), its slots in an hour (such as 3), or both. Leave one out to keep it. A value
 * out of range is brought to the nearest one allowed: the factor from 0.01 to 1, the slots from 1
 * to 12. Nothing changes when a value given is not a number.
 */
export function setDepartmentStandards(s: Schedule, departmentId: string, standards: { careFactor?: number; slotsPerHour?: number }): Schedule {
  const department = departmentOf(s, departmentId);
  if (!department) return s;
  if (standards.careFactor !== undefined && !Number.isFinite(standards.careFactor)) return s;
  if (standards.slotsPerHour !== undefined && !Number.isFinite(standards.slotsPerHour)) return s;
  const careFactor = standards.careFactor === undefined ? department.careFactor : factorIn(standards.careFactor);
  const slotsPerHour = standards.slotsPerHour === undefined ? department.slotsPerHour : slotsIn(standards.slotsPerHour);
  if (careFactor === department.careFactor && slotsPerHour === department.slotsPerHour) return s;
  return { ...s, departments: s.departments.map((item) => (item.id === departmentId ? { ...item, careFactor, slotsPerHour } : item)) };
}

/**
 * Removes a department with its visit types. Appointments of those types are removed, and
 * `touched` says how many. Its people move to the first department that is left and keep their
 * weeks. The only department cannot be removed while people belong to it: `problem` says so.
 */
export function removeDepartment(s: Schedule, departmentId: string): Change {
  const department = departmentOf(s, departmentId);
  if (!department) return { schedule: s, touched: 0 };
  const home = s.departments.find((item) => item.id !== departmentId);
  const hasPeople = s.people.some((person) => person.departmentId === departmentId);
  if (hasPeople && !home) {
    return { schedule: s, touched: 0, problem: 'Every person belongs to a department. Add another department first, or remove the people in this one.' };
  }
  const types = new Set(department.visitTypes.map((type) => type.id));
  const blocks = s.blocks.filter((block) => block.what.kind !== 'visit' || !types.has(block.what.visitTypeId));
  const people = home ? s.people.map((person) => (person.departmentId === departmentId ? { ...person, departmentId: home.id } : person)) : s.people;
  return { schedule: { ...s, departments: s.departments.filter((item) => item.id !== departmentId), people, blocks }, touched: s.blocks.length - blocks.length };
}

/** The details of a visit type that can be set. Leave one out to keep it as it is. */
export interface VisitTypeDetails {
  name?: string;
  code?: string;
  minutes?: number;
  colour?: Colour;
}

/** A visit length as it is kept: a multiple of five minutes, inside the limits. */
function visitLength(minutes: number, otherwise: number): number {
  if (!Number.isFinite(minutes)) return otherwise;
  return Math.min(LIMITS.visitMinutes.most, Math.max(LIMITS.visitMinutes.least, Math.round(minutes / 5) * 5));
}

/** The first swatch that no visit type or activity uses yet, or the first swatch when all are in use. */
function freeColour(s: Schedule): Colour {
  const used = new Set<Colour>([...s.departments.flatMap((department) => department.visitTypes.map((type) => type.colour)), ...s.activities.map((activity) => activity.colour)]);
  return ALL_COLOURS.find((colour) => !used.has(colour)) ?? 1;
}

/**
 * Adds a visit type to a department, at the end of its list. Left to itself it is called
 * "New visit type", lasts as long as the department's grid, and takes a colour not yet in use.
 */
export function addVisitType(s: Schedule, departmentId: string, details: VisitTypeDetails = {}): Schedule {
  const department = departmentOf(s, departmentId);
  if (!department || department.visitTypes.length >= LIMITS.visitTypesPerDepartment) return s;
  const type: VisitType = {
    id: newId(idsIn(s)),
    name: tidy(details.name ?? '') || 'New visit type',
    code: tidy(details.code ?? '', LIMITS.code),
    minutes: visitLength(details.minutes ?? department.step, department.step),
    colour: details.colour !== undefined && isColour(details.colour) ? details.colour : freeColour(s),
  };
  return { ...s, departments: s.departments.map((item) => (item.id === departmentId ? { ...item, visitTypes: [...item.visitTypes, type] } : item)) };
}

/**
 * Changes a visit type. A new name, code or colour touches no blocks.
 *
 * A new length lays its appointments out again. Each run of appointments of this type that stand
 * end to end in one place is refilled from its start with appointments of the new length, as many
 * as fit in the time the run took. So the week never grows past the time it filled and nothing
 * else is pushed aside. A run too short for one appointment of the new length is removed.
 * `touched` says how many appointments were laid out again.
 */
export function setVisitType(s: Schedule, visitTypeId: string, details: VisitTypeDetails): Change {
  const type = visitTypeOf(s, visitTypeId);
  if (!type) return { schedule: s, touched: 0 };
  const next: VisitType = {
    id: type.id,
    name: details.name === undefined ? type.name : tidy(details.name) || type.name,
    code: details.code === undefined ? type.code : tidy(details.code, LIMITS.code),
    minutes: details.minutes === undefined ? type.minutes : visitLength(details.minutes, type.minutes),
    colour: details.colour !== undefined && isColour(details.colour) ? details.colour : type.colour,
  };
  if (next.name === type.name && next.code === type.code && next.minutes === type.minutes && next.colour === type.colour) return { schedule: s, touched: 0 };
  const departments = s.departments.map((department) => ({ ...department, visitTypes: department.visitTypes.map((item) => (item.id === visitTypeId ? next : item)) }));
  if (next.minutes === type.minutes) return { schedule: { ...s, departments }, touched: 0 };

  const isThisType = (block: Block): boolean => block.what.kind === 'visit' && block.what.visitTypeId === visitTypeId;
  const old = s.blocks.filter(isThisType).sort((a, b) => a.personId.localeCompare(b.personId) || a.day - b.day || a.start - b.start);
  const taken = idsIn(s);
  const laid: Block[] = [];
  let run: Block[] = [];
  const closeRun = (): void => {
    const first = run[0];
    if (!first) return;
    const span = run.reduce((sum, block) => sum + block.minutes, 0);
    for (let i = 0; i < Math.floor(span / next.minutes); i++) {
      laid.push({ ...first, id: run[i]?.id ?? fresh(taken), start: first.start + i * next.minutes, minutes: next.minutes });
    }
    run = [];
  };
  for (const block of old) {
    const last = run[run.length - 1];
    if (last && (last.personId !== block.personId || last.day !== block.day || endOf(last) !== block.start || !sameWhere(last.where, block.where))) closeRun();
    run.push(block);
  }
  closeRun();
  return { schedule: { ...s, departments, blocks: [...s.blocks.filter((block) => !isThisType(block)), ...laid] }, touched: old.length };
}

/** Removes a visit type and every appointment of it. `touched` says how many appointments went. */
export function removeVisitType(s: Schedule, visitTypeId: string): Change {
  if (!visitTypeOf(s, visitTypeId)) return { schedule: s, touched: 0 };
  const blocks = s.blocks.filter((block) => block.what.kind !== 'visit' || block.what.visitTypeId !== visitTypeId);
  const departments = s.departments.map((department) => ({ ...department, visitTypes: department.visitTypes.filter((type) => type.id !== visitTypeId) }));
  return { schedule: { ...s, departments, blocks }, touched: s.blocks.length - blocks.length };
}

// ---------------------------------------------------------------------------------------------
// Activities: time that is not an appointment

/** The details of an activity that can be set. Leave one out to keep it as it is. */
export interface ActivityDetails {
  name?: string;
  colour?: Colour;
  paid?: boolean;
}

/** Adds an activity at the end of the list. Left to itself it is called "New activity", is paid, and takes a colour not yet in use. */
export function addActivity(s: Schedule, details: ActivityDetails = {}): Schedule {
  if (s.activities.length >= LIMITS.activities) return s;
  const activity: Activity = {
    id: newId(idsIn(s)),
    name: tidy(details.name ?? '') || 'New activity',
    colour: details.colour !== undefined && isColour(details.colour) ? details.colour : freeColour(s),
    paid: details.paid ?? true,
  };
  return { ...s, activities: [...s.activities, activity] };
}

/** Changes an activity's name, colour, or whether it is paid. No block is touched: the tallies follow by themselves. */
export function setActivity(s: Schedule, activityId: string, details: ActivityDetails): Schedule {
  const activity = activityOf(s, activityId);
  if (!activity) return s;
  const next: Activity = {
    id: activity.id,
    name: details.name === undefined ? activity.name : tidy(details.name) || activity.name,
    colour: details.colour !== undefined && isColour(details.colour) ? details.colour : activity.colour,
    paid: details.paid === undefined ? activity.paid : details.paid === true,
  };
  if (next.name === activity.name && next.colour === activity.colour && next.paid === activity.paid) return s;
  return { ...s, activities: s.activities.map((item) => (item.id === activityId ? next : item)) };
}

/**
 * Removes an activity, every block of it, and every person's set-aside line for it. `touched` says
 * how many blocks went. A person who had hours set aside for it now needs that much more patient care.
 */
export function removeActivity(s: Schedule, activityId: string): Change {
  if (!activityOf(s, activityId)) return { schedule: s, touched: 0 };
  const blocks = s.blocks.filter((block) => block.what.kind !== 'activity' || block.what.activityId !== activityId);
  const people = s.people.map((person) => (person.setAside.some((line) => line.activityId === activityId) ? { ...person, setAside: person.setAside.filter((line) => line.activityId !== activityId) } : person));
  return { schedule: { ...s, activities: s.activities.filter((activity) => activity.id !== activityId), people, blocks }, touched: s.blocks.length - blocks.length };
}

// ---------------------------------------------------------------------------------------------
// People

/**
 * The details of a person that can be set. Leave one out to keep it as it is. The grid is set
 * with `setStep`, the set-aside hours with `setAsideHours`, the working hours with `setWork` in
 * work.ts, and the providers a support person works with in team.ts.
 */
export interface PersonDetails {
  name?: string;
  role?: string;
  /**
   * Provider or support staff. Read by `addPerson` only. `setPerson` leaves the kind alone: use
   * `setKind` in team.ts, which also takes away what the new kind does not use.
   */
  kind?: PersonKind;
  departmentId?: string;
  contractHours?: number;
  /** The person's own care factor, or null to use the department's. */
  careFactor?: number | null;
  /** The person's own slots in an hour, or null to use the department's. */
  slotsPerHour?: number | null;
  /** True while the person builds up to a full week: their slots get no verdict. */
  ramping?: boolean;
}

/** Hours a week as they are kept: from 0 to 168, to two decimal places. */
function weekHours(hours: number): number {
  return Math.round(Math.min(LIMITS.hours, Math.max(0, hours)) * 100) / 100;
}

/**
 * Adds a person at the end of the list. Left to itself the person is called "New person", joins
 * the first department, takes that department's grid, and has 40 contract hours with nothing
 * set aside yet. They use the department's care factor and slots in an hour and are not ramping,
 * unless the details say otherwise. They are a provider unless the details say support staff, who
 * have no care factor, slots or ramping of their own. Nobody starts with working hours. A person
 * needs a department, so nothing is added while the schedule has none.
 */
export function addPerson(s: Schedule, details: PersonDetails = {}): Schedule {
  const department = details.departmentId === undefined ? s.departments[0] : departmentOf(s, details.departmentId);
  if (!department || s.people.length >= LIMITS.people) return s;
  const support = details.kind === 'support';
  const person: Person = {
    id: newId(idsIn(s)),
    name: tidy(details.name ?? '') || 'New person',
    role: tidy(details.role ?? ''),
    kind: support ? 'support' : 'provider',
    departmentId: department.id,
    step: department.step,
    contractHours: weekHours(Number.isFinite(details.contractHours) ? (details.contractHours ?? 40) : 40),
    setAside: [],
    careFactor: !support && typeof details.careFactor === 'number' && Number.isFinite(details.careFactor) ? factorIn(details.careFactor) : null,
    slotsPerHour: !support && typeof details.slotsPerHour === 'number' && Number.isFinite(details.slotsPerHour) ? slotsIn(details.slotsPerHour) : null,
    ramping: !support && details.ramping === true,
    worksWith: [],
    work: [],
  };
  return { ...s, people: [...s.people, person] };
}

/**
 * Changes a person's name, role, department, contract hours, own care factor, own slots in an
 * hour, or whether they are ramping. Moving to another department keeps the person's week and
 * grid as they are. A care factor or slots out of range are brought to the nearest value allowed,
 * and null goes back to the department's. Nothing changes when a value given is not usable: an
 * unknown department, or a number that is not a number.
 */
export function setPerson(s: Schedule, personId: string, details: PersonDetails): Schedule {
  const person = personOf(s, personId);
  if (!person) return s;
  if (details.departmentId !== undefined && !departmentOf(s, details.departmentId)) return s;
  if (details.contractHours !== undefined && !Number.isFinite(details.contractHours)) return s;
  if (typeof details.careFactor === 'number' && !Number.isFinite(details.careFactor)) return s;
  if (typeof details.slotsPerHour === 'number' && !Number.isFinite(details.slotsPerHour)) return s;
  const next: Person = {
    id: person.id,
    name: details.name === undefined ? person.name : tidy(details.name) || person.name,
    role: details.role === undefined ? person.role : tidy(details.role),
    kind: person.kind,
    departmentId: details.departmentId ?? person.departmentId,
    step: person.step,
    contractHours: details.contractHours === undefined ? person.contractHours : weekHours(details.contractHours),
    setAside: person.setAside,
    careFactor: details.careFactor === undefined ? person.careFactor : details.careFactor === null ? null : factorIn(details.careFactor),
    slotsPerHour: details.slotsPerHour === undefined ? person.slotsPerHour : details.slotsPerHour === null ? null : slotsIn(details.slotsPerHour),
    ramping: details.ramping === undefined ? person.ramping : details.ramping === true,
    worksWith: person.worksWith,
    work: person.work,
  };
  const same =
    next.name === person.name &&
    next.role === person.role &&
    next.departmentId === person.departmentId &&
    next.contractHours === person.contractHours &&
    next.careFactor === person.careFactor &&
    next.slotsPerHour === person.slotsPerHour &&
    next.ramping === person.ramping;
  return same ? s : { ...s, people: s.people.map((item) => (item.id === personId ? next : item)) };
}

/**
 * Sets how many hours a week a person is allowed for one activity, such as 4 hours of admin time.
 * A person has one line for an activity: a new activity adds a line at the end, a known one
 * changes its hours. These hours come out of the contract to give the patient-care hours the
 * person needs, so the activity should be a paid one. The checks say so when it is not.
 */
export function setAsideHours(s: Schedule, personId: string, activityId: string, hours: number): Schedule {
  const person = personOf(s, personId);
  if (!person || !activityOf(s, activityId) || !Number.isFinite(hours)) return s;
  const line: SetAside = { activityId, hours: weekHours(hours) };
  const old = person.setAside.find((item) => item.activityId === activityId);
  if (old?.hours === line.hours) return s;
  const setAside = old ? person.setAside.map((item) => (item.activityId === activityId ? line : item)) : [...person.setAside, line];
  return { ...s, people: s.people.map((item) => (item.id === personId ? { ...item, setAside } : item)) };
}

/** Takes away a person's set-aside line for one activity. Their blocks of that activity stay in the week. */
export function removeSetAside(s: Schedule, personId: string, activityId: string): Schedule {
  const person = personOf(s, personId);
  if (!person || !person.setAside.some((item) => item.activityId === activityId)) return s;
  return { ...s, people: s.people.map((item) => (item.id === personId ? { ...item, setAside: item.setAside.filter((line) => line.activityId !== activityId) } : item)) };
}

/**
 * Removes a person and their whole week. When the person is a provider, the time support staff
 * had with them is removed as well, and they come off every "works with" list. `touched` says how
 * many blocks went, theirs and those.
 */
export function removePerson(s: Schedule, personId: string): Change {
  if (!personOf(s, personId)) return { schedule: s, touched: 0 };
  const blocks = s.blocks.filter((block) => block.personId !== personId && !(block.what.kind === 'with' && block.what.personId === personId));
  const people = s.people
    .filter((person) => person.id !== personId)
    .map((person) => (person.worksWith.includes(personId) ? { ...person, worksWith: person.worksWith.filter((id) => id !== personId) } : person));
  return { schedule: { ...s, people, blocks }, touched: s.blocks.length - blocks.length };
}

/**
 * Makes a copy of a person, placed right after them and named "… (copy)", with the same week,
 * contract, set-aside hours, standards, kind and working hours. A copy of a support person works
 * with the same providers. A copy of a provider is on nobody's "works with" list.
 * Two people cannot be in one room at one time, so the copy's time keeps its site and drops its
 * room. The checks then list the copy's appointments as needing a room, and `setPlace` or
 * painting gives them one.
 */
export function duplicatePerson(s: Schedule, personId: string): Schedule {
  const person = personOf(s, personId);
  if (!person || s.people.length >= LIMITS.people) return s;
  const taken = idsIn(s);
  const copy: Person = {
    ...person,
    id: fresh(taken),
    name: `${person.name.slice(0, LIMITS.name - 7)} (copy)`,
    setAside: person.setAside.map((line) => ({ ...line })),
    worksWith: [...person.worksWith],
    work: person.work.map((stretch) => ({ ...stretch })),
  };
  const copies = s.blocks
    .filter((block) => block.personId === personId)
    .map((block): Block => ({ ...block, id: fresh(taken), personId: copy.id, where: block.where.kind === 'site' ? { kind: 'site', siteId: block.where.siteId, roomId: null } : block.where }));
  let blocks: readonly Block[] = [...s.blocks, ...copies];
  for (const day of s.days) blocks = join(blocks, copy.id, day);
  const at = s.people.findIndex((item) => item.id === personId);
  return { ...s, people: [...s.people.slice(0, at + 1), copy, ...s.people.slice(at + 1)], blocks: [...blocks] };
}
