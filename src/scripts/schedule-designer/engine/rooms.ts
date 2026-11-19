// Rooms: who is in each room through a day, where two people clash, and when a room is free.
//
// In plain words: a room holds one person's work at a time. When two people are painted into the
// same room for the same minutes, that is a clash and the checks ask for it to be fixed. There is
// one exception, decided here: people who are in a room together for the same activity, such as a
// meeting or a huddle, are sharing it and do not clash. Appointments never share a room.

import { endOf } from './find';
import type { Block, Day, Room, Schedule } from './types';

/** One person's unbroken time in a room: blocks that follow one another with no gap are one stay. */
export interface Stay {
  personId: string;
  from: number;
  to: number;
  /** True when part of this stay clashes with someone else. */
  clash: boolean;
}

/** A stretch of time when two or more people are in one room and should not be. */
export interface Clash {
  siteId: string;
  roomId: string;
  day: Day;
  from: number;
  to: number;
  /** Everyone in the room for this stretch, in the order of the people list. */
  personIds: string[];
}

/** One room on one day. */
export interface RoomUse {
  roomId: string;
  name: string;
  /** In time order. */
  stays: Stay[];
  clashes: Clash[];
}

/** One room's free time on one day. */
export interface RoomFree {
  roomId: string;
  name: string;
  /** The stretches inside the hours shown when nobody is in the room. */
  free: { from: number; to: number }[];
}

/** How much one room is used through the week, counted inside the hours the schedule shows. */
export interface RoomHours {
  roomId: string;
  name: string;
  /** Minutes in the week with at least one person in the room. People sharing it for a meeting count once. */
  usedMinutes: number;
  /** Minutes in the week with nobody in the room. */
  freeMinutes: number;
  /** The same two numbers for each day the schedule shows, in order. */
  days: { day: Day; usedMinutes: number; freeMinutes: number }[];
}

/** The blocks in one room on one day, in time order. */
function blocksIn(s: Schedule, day: Day, roomId: string): Block[] {
  return s.blocks.filter((block) => block.day === day && block.where.kind === 'site' && block.where.roomId === roomId).sort((a, b) => a.start - b.start);
}

/** True when the blocks present at one moment may share the room: all the same activity. */
function sharing(present: Block[]): boolean {
  const first = present[0];
  if (!first || first.what.kind !== 'activity') return false;
  const activityId = first.what.activityId;
  return present.every((block) => block.what.kind === 'activity' && block.what.activityId === activityId);
}

function clashesIn(s: Schedule, day: Day, siteId: string, roomId: string, blocks: Block[]): Clash[] {
  const rank = new Map(s.people.map((person, at) => [person.id, at]));
  const cuts = [...new Set(blocks.flatMap((block) => [block.start, endOf(block)]))].sort((a, b) => a - b);
  const clashes: Clash[] = [];
  for (let at = 0; at + 1 < cuts.length; at++) {
    const from = cuts[at] ?? 0;
    const to = cuts[at + 1] ?? 0;
    const present = blocks.filter((block) => block.start < to && endOf(block) > from);
    const personIds = [...new Set(present.map((block) => block.personId))].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
    if (personIds.length < 2 || sharing(present)) continue;
    const last = clashes[clashes.length - 1];
    if (last && last.to === from && last.personIds.join(' ') === personIds.join(' ')) last.to = to;
    else clashes.push({ siteId, roomId, day, from, to, personIds });
  }
  return clashes;
}

function staysIn(s: Schedule, blocks: Block[], clashes: Clash[]): Stay[] {
  const rank = new Map(s.people.map((person, at) => [person.id, at]));
  const open = new Map<string, Stay>();
  const stays: Stay[] = [];
  for (const block of blocks) {
    const last = open.get(block.personId);
    if (last && last.to === block.start) {
      last.to = endOf(block);
    } else {
      const stay: Stay = { personId: block.personId, from: block.start, to: endOf(block), clash: false };
      open.set(block.personId, stay);
      stays.push(stay);
    }
  }
  for (const stay of stays) stay.clash = clashes.some((clash) => clash.personIds.includes(stay.personId) && clash.from < stay.to && clash.to > stay.from);
  return stays.sort((a, b) => a.from - b.from || (rank.get(a.personId) ?? 0) - (rank.get(b.personId) ?? 0));
}

/**
 * Every room of one site on one day: who is in it, from when to when, and where people clash.
 * Only time painted with a room counts. Gives an empty list for a site the schedule does not have.
 */
export function roomUse(s: Schedule, day: Day, siteId: string): RoomUse[] {
  const site = s.sites.find((item) => item.id === siteId);
  if (!site) return [];
  return site.rooms.map((room) => {
    const blocks = blocksIn(s, day, room.id);
    const clashes = clashesIn(s, day, siteId, room.id, blocks);
    return { roomId: room.id, name: room.name, stays: staysIn(s, blocks, clashes), clashes };
  });
}

/** Every room of one site on one day, with the stretches inside the hours shown when nobody is in it. */
export function roomsFree(s: Schedule, day: Day, siteId: string): RoomFree[] {
  const site = s.sites.find((item) => item.id === siteId);
  if (!site) return [];
  return site.rooms.map((room) => {
    const free: { from: number; to: number }[] = [];
    let at = s.dayStart;
    for (const block of blocksIn(s, day, room.id)) {
      if (block.start > at) free.push({ from: at, to: Math.min(block.start, s.dayEnd) });
      at = Math.max(at, endOf(block));
      if (at >= s.dayEnd) break;
    }
    if (at < s.dayEnd) free.push({ from: at, to: s.dayEnd });
    return { roomId: room.id, name: room.name, free: free.filter((gap) => gap.to > gap.from) };
  });
}

/**
 * The rooms of one site that nobody is in at any point of a stretch of time on one day, for
 * offering a room that will not clash when someone paints into a taken one. Name a person to leave their own time out of the count, so the room they
 * are already in is still offered to them.
 */
export function freeRooms(s: Schedule, day: Day, siteId: string, from: number, to: number, exceptPersonId?: string): Room[] {
  const site = s.sites.find((item) => item.id === siteId);
  if (!site) return [];
  return site.rooms.filter((room) => !blocksIn(s, day, room.id).some((block) => block.personId !== exceptPersonId && block.start < to && endOf(block) > from));
}

/**
 * Every room of one site across the whole week: the time it is in use and the time it is free,
 * inside the hours the schedule shows. With `hoursOf` this gives "Exam 2: 31 hours in use, 14 free".
 */
export function roomHours(s: Schedule, siteId: string): RoomHours[] {
  const site = s.sites.find((item) => item.id === siteId);
  if (!site) return [];
  const shown = Math.max(0, s.dayEnd - s.dayStart);
  const rows: RoomHours[] = site.rooms.map((room) => ({ roomId: room.id, name: room.name, usedMinutes: 0, freeMinutes: 0, days: [] }));
  for (const day of s.days) {
    roomsFree(s, day, siteId).forEach((room, at) => {
      const row = rows[at];
      if (!row) return;
      const freeMinutes = room.free.reduce((sum, gap) => sum + gap.to - gap.from, 0);
      row.days.push({ day, usedMinutes: shown - freeMinutes, freeMinutes });
      row.usedMinutes += shown - freeMinutes;
      row.freeMinutes += freeMinutes;
    });
  }
  return rows;
}

/** Every clash in the week: by day, then site, then room, then time. */
export function allClashes(s: Schedule): Clash[] {
  const byRoom = new Map<string, Block[]>();
  for (const block of s.blocks) {
    if (block.where.kind !== 'site' || block.where.roomId === null) continue;
    const key = `${block.day} ${block.where.roomId}`;
    const list = byRoom.get(key);
    if (list) list.push(block);
    else byRoom.set(key, [block]);
  }
  const clashes: Clash[] = [];
  for (const day of s.days) {
    for (const site of s.sites) {
      for (const room of site.rooms) {
        const blocks = byRoom.get(`${day} ${room.id}`);
        if (blocks && blocks.length > 1) clashes.push(...clashesIn(s, day, site.id, room.id, blocks));
      }
    }
  }
  return clashes;
}
