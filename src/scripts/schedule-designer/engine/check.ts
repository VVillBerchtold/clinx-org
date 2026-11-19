// The checks: what a schedule should have fixed, what is worth a look, and what is only a note.
//
// In plain words: this reads the whole week and writes a list of findings. Each finding is one
// plain sentence that says what was found and what to do about it. There are three levels.
// "fix" is something that cannot work as planned: two people in one room at once.
// "look" may be meant, but usually is not: an appointment with no room, a week with more or fewer
// slots than its target, time that does not match the hours set aside for it.
// "note" is tidying: an empty week, a person who is ramping, a room or a visit type nobody uses,
// a block off the grid.
// What to do is said with the controls the page has: Add, Erase, Where, and the Set up step.
// Two groups came with working hours and support staff. "Working hours" lists paid time outside a
// person's working hours or on their day off, and notes working hours that do not add up to the
// contract. "Care teams" lists a provider's patient time with no support staff with them (only for
// a provider that some support person lists, in one finding for the week), and time with a provider
// that does not line up with where and when that provider sees patients.
// Each finding also says where it is (the person, the day, the minute, the room) so the page can
// jump there.

import { blocksOf, blocksOn, departmentOf, endOf, personOf, roomOf, siteOf } from './find';
import { allClashes } from './rooms';
import { tallyPerson } from './tally';
import { coverage, patientStretches, supportFor } from './team';
import { DAY_MINUTES, NOON, clock, clockRange, dayName, lengthText, onGrid } from './time';
import type { Block, Day, Person, Schedule, Step } from './types';
import { blocksOutsideWork, isDayOff, outsideWork, spanMinutes, spansInside, spansLess, workOutsideHours, workText } from './work';
import type { Span } from './work';

export type Level = 'fix' | 'look' | 'note';

export interface Finding {
  /** Stays the same for the same finding from one check to the next, so the page can keep its place. It starts with the kind of finding and a colon. */
  id: string;
  level: Level;
  /** A short heading to list the finding under, such as "Room clashes". */
  group: string;
  /** The finding in one or two plain sentences, ending with what to do. */
  say: string;
  /** The person to show. For a clash, the first of the people in the room. */
  personId?: string;
  day?: Day;
  /** The minute of the day to show. */
  start?: number;
  siteId?: string;
  roomId?: string;
}

/** The longest stretch of paid time a person should have without a break, and how long a break is. */
const LONGEST_STRETCH = 300;
const BREAK = 20;
/** Working hours and contract hours may differ by this many minutes before a note is written. */
const WORK_SLACK = 30;
/** The least time worth a finding about a care team: patient time with nobody there, or time with a provider who has no patients then. */
const TEAM_LEAST = 30;

const many = (count: number, one: string, more: string): string => `${count} ${count === 1 ? one : more}`;
const slotsWords = (count: number): string => `${count} ${count === 1 ? 'slot' : 'slots'}`;

/** Names in a sentence: "Ana and Ben", "Ana, Ben and Cal". */
function listOf(names: string[]): string {
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

function clashFindings(s: Schedule): Finding[] {
  const names = new Map(s.people.map((person) => [person.id, person.name]));
  return allClashes(s).map((clash) => {
    const people = clash.personIds.map((id) => names.get(id) ?? '');
    const two = people.length === 2;
    const finding: Finding = {
      id: `clash:${clash.roomId}:${clash.day}:${clash.from}`,
      level: 'fix',
      group: 'Room clashes',
      say: `${listOf(people)} are ${two ? 'both' : 'all'} in ${roomOf(s, clash.roomId)?.name ?? 'one room'} at ${siteOf(s, clash.siteId)?.name ?? 'one site'} on ${dayName(clash.day)} from ${clockRange(clash.from, clash.to)}. ${two ? 'Give one of them another room.' : 'Give all but one of them another room.'} In Design, choose Add, pick the room in Where and add their time there again.`,
      day: clash.day,
      start: clash.from,
      siteId: clash.siteId,
      roomId: clash.roomId,
    };
    const first = clash.personIds[0];
    return first === undefined ? finding : { ...finding, personId: first };
  });
}

/** Appointments at a site with no room, and appointments with no place at all: one finding for a person, a day and a site. */
function placeFindings(s: Schedule, person: Person): Finding[] {
  const findings: Finding[] = [];
  for (const day of s.days) {
    const noRoom = new Map<string, Block[]>();
    const noPlace: Block[] = [];
    for (const block of blocksOn(s, person.id, day)) {
      if (block.what.kind !== 'visit') continue;
      if (block.where.kind === 'none') noPlace.push(block);
      else if (block.where.kind === 'site' && block.where.roomId === null) noRoom.set(block.where.siteId, [...(noRoom.get(block.where.siteId) ?? []), block]);
    }
    for (const [siteId, blocks] of noRoom) {
      const one = blocks.length === 1;
      findings.push({
        id: `no-room:${person.id}:${day}:${siteId}`,
        level: 'look',
        group: 'Appointments with no room',
        say: `${person.name} has ${many(blocks.length, 'appointment', 'appointments')} at ${siteOf(s, siteId)?.name ?? 'a site'} on ${dayName(day)} with no room. In Design, choose Add, pick a room in Where and add ${one ? 'it' : 'them'} again.`,
        personId: person.id,
        day,
        start: blocks[0]?.start ?? s.dayStart,
        siteId,
      });
    }
    if (noPlace.length > 0) {
      const them = noPlace.length === 1 ? 'it' : 'them';
      findings.push({
        id: `no-place:${person.id}:${day}`,
        level: 'look',
        group: 'Appointments with no room',
        say: `${person.name} has ${many(noPlace.length, 'appointment', 'appointments')} on ${dayName(day)} with no place. In Design, choose Add, pick a room or Remote in Where and add ${them} again.`,
        personId: person.id,
        day,
        start: noPlace[0]?.start ?? s.dayStart,
      });
    }
  }
  return findings;
}

/**
 * A set-aside line for an unpaid activity. Set-aside hours come out of the contract, which counts
 * paid hours only, so such a line makes the patient-care target too low.
 */
function unpaidSetAsideFindings(s: Schedule, person: Person): Finding[] {
  const findings: Finding[] = [];
  for (const line of tallyPerson(s, person.id)?.setAside ?? []) {
    if (line.paid) continue;
    findings.push({
      id: `set-aside-unpaid:${person.id}:${line.activityId}`,
      level: 'look',
      group: 'Set-aside hours',
      say: `${person.name} has ${lengthText(line.allowedMinutes)} set aside for ${line.name}, which is unpaid time. Set-aside hours come out of the contract hours, so take this line out or mark ${line.name} as paid in Set up.`,
      personId: person.id,
    });
  }
  return findings;
}

/**
 * The week's slots against the target. Under and over are worth a look and say how many slots to
 * add or take out. A person with no contract hours has no target, which is worth a look too. A
 * person who is ramping gets a note and no verdict. A person whose week is still empty gets the
 * note about that instead, unless the contract hours are what is missing. Support staff have no
 * slot target, so none of this is said about them.
 */
function slotFindings(s: Schedule, person: Person): Finding[] {
  const tally = tallyPerson(s, person.id);
  if (!tally) return [];
  const { target, actual, variance, verdict } = tally.slots;
  const group = 'Slots against target';
  if (verdict === 'needs-contract') {
    return [{ id: `needs-contract:${person.id}`, level: 'look', group, say: `${person.name} has no contract hours, so there is no slot target for their week. Enter their contract hours in Set up.`, personId: person.id }];
  }
  if (blocksOf(s, person.id).length === 0) return [];
  const within = s.tolerance > 0 ? ` A week within ${slotsWords(s.tolerance)} of its target counts as on target.` : '';
  if (verdict === 'under') {
    return [{ id: `slots-under:${person.id}`, level: 'look', group, say: `${person.name} has ${slotsWords(actual)} planned and the target is ${target}. Add ${slotsWords(-variance)}, or change their contract hours or clinical factor in Set up.${within}`, personId: person.id }];
  }
  if (verdict === 'over') {
    return [{ id: `slots-over:${person.id}`, level: 'look', group, say: `${person.name} has ${slotsWords(actual)} planned and the target is ${target}. Take out ${slotsWords(variance)}, or change their contract hours or clinical factor in Set up.${within}`, personId: person.id }];
  }
  if (verdict === 'needs-schedule' && target > 0) {
    return [{ id: `needs-schedule:${person.id}`, level: 'look', group, say: `${person.name} has no patient care planned and the target is ${slotsWords(target)}. Add appointments to their week in Design.`, personId: person.id }];
  }
  if (verdict === 'ramping') {
    return [
      {
        id: `ramping:${person.id}`,
        level: 'note',
        group,
        say: `${person.name} is marked as ramping, so their ${slotsWords(actual)} planned are not held to the target of ${target}. Take the mark off in Set up once they carry a whole week.`,
        personId: person.id,
      },
    ];
  }
  return [];
}

/**
 * Hours that do not add up: an activity on the week for more or less time than is set aside for
 * it, and paid hours over the contract. A person whose week is still empty gets the note about
 * that and none of these.
 */
function hoursFindings(s: Schedule, person: Person): Finding[] {
  const tally = tallyPerson(s, person.id);
  if (!tally || blocksOf(s, person.id).length === 0) return [];
  const findings: Finding[] = [];
  for (const line of tally.setAside) {
    if (!line.paid || line.scheduledMinutes === line.allowedMinutes) continue;
    const over = line.scheduledMinutes > line.allowedMinutes;
    const gap = lengthText(Math.abs(line.scheduledMinutes - line.allowedMinutes));
    const first = blocksOf(s, person.id).find((block) => block.what.kind === 'activity' && block.what.activityId === line.activityId);
    const finding: Finding = {
      id: `set-aside:${person.id}:${line.activityId}`,
      level: 'look',
      group: 'Set-aside hours',
      say: `${person.name} has ${line.scheduledMinutes === 0 ? `no ${line.name}` : `${lengthText(line.scheduledMinutes)} of ${line.name}`} scheduled and ${lengthText(line.allowedMinutes)} set aside for it. ${over ? `Take out ${gap}` : `Add ${gap}`}, or change the hours set aside in Set up.`,
      personId: person.id,
    };
    findings.push(first ? { ...finding, day: first.day, start: first.start } : finding);
  }
  if (tally.paidOverMinutes > 0) {
    findings.push({
      id: `over-contract:${person.id}`,
      level: 'look',
      group: 'Paid hours',
      say: `${person.name} has ${lengthText(tally.week.paidMinutes)} of paid time planned and the contract is ${lengthText(tally.contractMinutes)}. Take out ${lengthText(tally.paidOverMinutes)}, or raise the contract hours in Set up.`,
      personId: person.id,
    });
  }
  return findings;
}

/** Time that starts before the first hour shown or ends after the last: the page cannot draw it. */
function outsideFindings(s: Schedule, person: Person): Finding[] {
  const findings: Finding[] = [];
  for (const day of s.days) {
    const outside = blocksOn(s, person.id, day).filter((block) => block.start < s.dayStart || endOf(block) > s.dayEnd);
    const first = outside[0];
    if (!first) continue;
    const visits = outside.filter((block) => block.what.kind === 'visit').length;
    const what = visits > 0 ? many(visits, 'appointment', 'appointments') : 'other time';
    findings.push({
      id: `outside:${person.id}:${day}`,
      level: 'look',
      group: 'Outside the hours shown',
      say: `${person.name} has ${what} on ${dayName(day)} outside the hours shown, ${clockRange(s.dayStart, s.dayEnd)}. Widen the hours in Set up to see ${visits > 1 ? 'them' : 'it'}. To change the time, erase ${visits > 1 ? 'them' : 'it'} in Design and add ${visits > 1 ? 'them' : 'it'} again.`,
      personId: person.id,
      day,
      start: first.start,
    });
  }
  return findings;
}

/**
 * More than five hours of paid time with no break. Paid time is appointments and paid activities.
 * A break is 20 minutes or more with nothing paid in it: empty time, or an unpaid activity such as lunch.
 */
function breakFindings(s: Schedule, person: Person): Finding[] {
  const paid = new Set(s.activities.filter((activity) => activity.paid).map((activity) => activity.id));
  const findings: Finding[] = [];
  for (const day of s.days) {
    let from: number | undefined;
    let to = 0;
    const close = (): void => {
      if (from !== undefined && to - from > LONGEST_STRETCH) {
        findings.push({
          id: `no-break:${person.id}:${day}:${from}`,
          level: 'look',
          group: 'Breaks',
          say: `${person.name} has paid time on ${dayName(day)} from ${clockRange(from, to)} with no break of ${lengthText(BREAK)}. Add a break, such as lunch.`,
          personId: person.id,
          day,
          start: from,
        });
      }
      from = undefined;
    };
    for (const block of blocksOn(s, person.id, day)) {
      if (block.what.kind === 'activity' && !paid.has(block.what.activityId)) continue;
      if (from !== undefined && block.start - to >= BREAK) close();
      if (from === undefined) from = block.start;
      to = endOf(block);
    }
    close();
  }
  return findings;
}

/**
 * Working hours: paid time outside them, one finding for a person and a day, and paid time on a
 * day off. Unpaid time such as lunch is never counted. Then working stretches that reach outside
 * the hours the schedule shows, so narrowing those hours never hides one without a word. Last, as
 * a note, paid hours at work that differ from the contract by more than half an hour. A person
 * with no working hours entered gets none of these.
 */
function workFindings(s: Schedule, person: Person): Finding[] {
  if (person.work.length === 0) return [];
  const findings: Finding[] = [];
  const group = 'Working hours';
  for (const day of s.days) {
    const outside = blocksOutsideWork(s, person.id, day);
    const pieces = outside.flatMap((block) => outsideWork(s, person.id, day, block.start, endOf(block)));
    const first = pieces[0];
    if (!first) continue;
    const time = lengthText(spanMinutes(pieces));
    const off = isDayOff(s, person.id, day);
    findings.push({
      id: `${off ? 'day-off' : 'off-hours'}:${person.id}:${day}`,
      level: 'look',
      group,
      say: off
        ? `${person.name} has ${time} of paid time on ${dayName(day)}, which is a day off in their working hours. Erase it in Design and add it on a working day, or enter working hours for ${dayName(day)} in Set up.`
        : `${person.name} has ${time} of paid time on ${dayName(day)} outside their working hours, ${workText(s, person.id, day)}. Erase it in Design and add it inside their working hours, or change the working hours in Set up.`,
      personId: person.id,
      day,
      start: first.from,
    });
  }
  const hidden = workOutsideHours(s, person.id);
  const firstHidden = hidden[0];
  if (firstHidden) {
    const days = new Set(hidden.map((stretch) => stretch.day)).size;
    const shown = clockRange(s.dayStart, s.dayEnd);
    const theirs = workText(s, person.id, firstHidden.day);
    findings.push({
      id: `work-outside:${person.id}`,
      level: 'look',
      group: 'Outside the hours shown',
      say:
        days === 1
          ? `${person.name} has working hours on ${dayName(firstHidden.day)}, ${theirs}, that reach outside the hours shown, ${shown}. Widen the hours shown in Set up, or change the working hours.`
          : `${person.name} has working hours on ${days} days that reach outside the hours shown, ${shown}. The first is ${dayName(firstHidden.day)}, ${theirs}. Widen the hours shown in Set up, or change the working hours.`,
      personId: person.id,
      day: firstHidden.day,
      start: firstHidden.from,
    });
  }
  const tally = tallyPerson(s, person.id);
  if (tally && tally.paidWorkMinutes !== null && blocksOf(s, person.id).length > 0 && Math.abs(tally.paidWorkMinutes - tally.contractMinutes) > WORK_SLACK) {
    findings.push({
      id: `work-contract:${person.id}`,
      level: 'note',
      group,
      say: `${person.name} has ${lengthText(tally.paidWorkMinutes)} of paid time in their working hours and a contract of ${lengthText(tally.contractMinutes)}. Change the working hours or the contract hours in Set up, or leave them if this is meant.`,
      personId: person.id,
    });
  }
  return findings;
}

/** A support person's time with one provider on one day, as stretches. */
function withSpans(s: Schedule, supportId: string, providerId: string, day: Day): (Span & { siteId: string | null })[] {
  return blocksOn(s, supportId, day)
    .filter((block) => block.what.kind === 'with' && block.what.personId === providerId)
    .map((block) => ({ from: block.start, to: endOf(block), siteId: block.where.kind === 'site' ? block.where.siteId : null }));
}

/** The two halves of a day. Patient time with nobody there is counted in each half by itself. */
const HALVES: readonly Span[] = [
  { from: 0, to: NOON },
  { from: NOON, to: DAY_MINUTES },
];

/**
 * Care teams, from the provider's side: a provider whom at least one support person lists, seeing
 * patients at a site with nobody with them. A morning or an afternoon counts when it has 30
 * minutes or more of such time. The whole week is one finding: it names the days and adds up the
 * time, and it shows the first of them. A provider nobody lists gets none: not every provider
 * works with support staff.
 */
function uncoveredFindings(s: Schedule, provider: Person): Finding[] {
  if (provider.kind !== 'provider' || supportFor(s, provider.id).length === 0) return [];
  const pieces: (Span & { siteId: string; day: Day })[] = [];
  for (const day of s.days) {
    const { uncovered } = coverage(s, provider.id, day);
    for (const half of HALVES) {
      const inHalf = uncovered.flatMap((span) => spansInside([span], [half]).map((piece) => ({ ...piece, siteId: span.siteId, day })));
      if (spanMinutes(inHalf) < TEAM_LEAST) continue;
      for (const piece of inHalf) {
        // A stretch that runs through noon is one stretch again.
        const before = pieces[pieces.length - 1];
        if (before && before.day === piece.day && before.to === piece.from && before.siteId === piece.siteId) before.to = piece.to;
        else pieces.push(piece);
      }
    }
  }
  const first = pieces[0];
  const last = pieces[pieces.length - 1];
  if (!first || !last) return [];
  const days = [...new Set(pieces.map((piece) => piece.day))];
  const oneSite = pieces.every((piece) => piece.siteId === first.siteId);
  const at = oneSite ? ` at ${siteOf(s, first.siteId)?.name ?? 'a site'}` : '';
  const time = lengthText(spanMinutes(pieces));
  let when: string;
  if (pieces.length === 1) when = `on ${dayName(first.day)} from ${clockRange(first.from, first.to)} with no support staff with them.`;
  else if (days.length === 1) when = `on ${dayName(first.day)} for ${time} between ${clock(first.from)} and ${clock(last.to)} with no support staff with them.`;
  else when = `on ${listOf(days.map((day) => dayName(day)))} for ${time} in all with no support staff with them. The first time is ${dayName(first.day)} at ${clock(first.from)}.`;
  return [
    {
      id: `no-support:${provider.id}`,
      level: 'look',
      group: 'Care teams',
      say: `${provider.name} sees patients${at} ${when} Add time with ${provider.name} to a support person's week in Design, or leave it if this is meant.`,
      personId: provider.id,
      day: first.day,
      start: first.from,
      siteId: first.siteId,
    },
  ];
}

/**
 * Care teams, from the support person's side. Time with a provider when that provider has no
 * appointments at a site, 30 minutes or more in a day (a gap of less than 30 minutes between two
 * appointments does not count). Time with a provider at one site while the provider is at
 * another. And, as a note, a provider on the person's "works with" list with whom they have no
 * time this week.
 */
function withFindings(s: Schedule, person: Person): Finding[] {
  if (person.kind !== 'support') return [];
  const findings: Finding[] = [];
  const group = 'Care teams';
  const providerIds = [...new Set([...person.worksWith, ...blocksOf(s, person.id).flatMap((block) => (block.what.kind === 'with' ? [block.what.personId] : []))])];
  for (const providerId of providerIds) {
    const provider = personOf(s, providerId);
    if (!provider) continue;
    let any = false;
    for (const day of s.days) {
      const spans = withSpans(s, person.id, providerId, day);
      if (spans.length === 0) continue;
      any = true;
      const idle = spansLess(spans, patientStretches(s, providerId, day));
      const firstIdle = idle[0];
      if (firstIdle && spanMinutes(idle) >= TEAM_LEAST) {
        findings.push({
          id: `with-idle:${person.id}:${providerId}:${day}`,
          level: 'look',
          group,
          say: `${person.name} has ${lengthText(spanMinutes(idle))} with ${provider.name} on ${dayName(day)} when ${provider.name} has no appointments at a site, starting at ${clock(firstIdle.from)}. Erase that time in Design, or add another kind of time over it.`,
          personId: person.id,
          day,
          start: firstIdle.from,
        });
      }
      // Where the provider is: any of their blocks at a site, appointment or not.
      for (const span of spans) {
        if (span.siteId === null) continue;
        const elsewhere = blocksOn(s, providerId, day).find((block) => block.where.kind === 'site' && block.where.siteId !== span.siteId && block.start < span.to && endOf(block) > span.from);
        if (!elsewhere || elsewhere.where.kind !== 'site') continue;
        const theirs = siteOf(s, elsewhere.where.siteId)?.name ?? 'another site';
        findings.push({
          id: `with-site:${person.id}:${providerId}:${day}`,
          level: 'look',
          group,
          say: `${person.name} has time with ${provider.name} on ${dayName(day)} at ${siteOf(s, span.siteId)?.name ?? 'a site'} from ${clockRange(span.from, span.to)}, and ${provider.name} is at ${theirs} then. Erase that time in Design and add it again. Time with a provider goes where the provider is.`,
          personId: person.id,
          day,
          start: Math.max(span.from, elsewhere.start),
          siteId: span.siteId,
        });
        break;
      }
    }
    if (!any && person.worksWith.includes(providerId)) {
      findings.push({
        id: `with-none:${person.id}:${providerId}`,
        level: 'note',
        group,
        say: `${person.name} lists ${provider.name} as someone they work with and has no time with them this week. Fill their week from the patient time of ${provider.name} in Design, or take ${provider.name} off their list in Set up.`,
        personId: person.id,
      });
    }
  }
  return findings;
}

/**
 * A person with nothing planned, and blocks that do not start on a line of the person's grid.
 * Time with a provider is left out of the grid note: it follows the provider's appointments,
 * and the provider's grid may differ from the support person's.
 */
function tidyFindings(s: Schedule, person: Person): Finding[] {
  const all = blocksOf(s, person.id);
  if (all.length === 0) {
    return [{ id: `empty-week:${person.id}`, level: 'note', group: 'Empty weeks', say: `${person.name} has nothing planned this week. Build their week in Design, or remove them in Set up.`, personId: person.id }];
  }
  const blocks = all.filter((block) => block.what.kind !== 'with');
  const off = blocks.filter((block) => !onGrid(block.start, person.step, s.dayStart));
  const first = off[0];
  if (!first) return [];
  const other: Step = person.step === 15 ? 20 : 15;
  const one = off.length === 1;
  const fits = blocks.every((block) => onGrid(block.start, other, s.dayStart));
  const advice = fits
    ? `Switch their grid to ${other} min in Design and ${one ? 'it' : 'they'} will fit.`
    : one
      ? 'Add it again in Design so it starts on a line, or leave it if the time is meant.'
      : 'Add them again in Design so they start on a line, or leave them if the times are meant.';
  return [
    {
      id: `off-grid:${person.id}`,
      level: 'note',
      group: 'Off the grid',
      say: `${person.name} has ${one ? '1 block of time that does not start' : `${off.length} blocks of time that do not start`} on a line of their ${person.step} min grid, ${one ? '' : 'the first '}on ${dayName(first.day)} at ${clock(first.start)}. ${advice}`,
      personId: person.id,
      day: first.day,
      start: first.start,
    },
  ];
}

/** Rooms and visit types that nothing in the week uses. */
function unusedFindings(s: Schedule): Finding[] {
  const rooms = new Set<string>();
  const types = new Set<string>();
  for (const block of s.blocks) {
    if (block.where.kind === 'site' && block.where.roomId !== null) rooms.add(block.where.roomId);
    if (block.what.kind === 'visit') types.add(block.what.visitTypeId);
  }
  const findings: Finding[] = [];
  for (const site of s.sites) {
    for (const room of site.rooms) {
      if (rooms.has(room.id)) continue;
      findings.push({ id: `unused-room:${room.id}`, level: 'note', group: 'Rooms not used', say: `${room.name} at ${site.name} is not used this week. Pick it in Where when you add time in Design, or remove it in Set up.`, siteId: site.id, roomId: room.id });
    }
  }
  for (const department of s.departments) {
    for (const type of department.visitTypes) {
      if (types.has(type.id)) continue;
      findings.push({ id: `unused-type:${type.id}`, level: 'note', group: 'Visit types not used', say: `${type.name} in ${departmentOf(s, department.id)?.name ?? 'its department'} is not used this week. Add some in Design, or remove it in Set up.` });
    }
  }
  return findings;
}

/**
 * Reads the whole schedule and lists what it finds: fixes first, then things to look at, then
 * notes. Inside a level the findings keep a steady order: by kind, then by person, then by day.
 */
export function check(s: Schedule): Finding[] {
  const findings: Finding[] = [
    ...clashFindings(s),
    ...s.people.flatMap((person) => placeFindings(s, person)),
    ...s.people.flatMap((person) => slotFindings(s, person)),
    ...s.people.flatMap((person) => hoursFindings(s, person)),
    ...s.people.flatMap((person) => unpaidSetAsideFindings(s, person)),
    ...s.people.flatMap((person) => outsideFindings(s, person)),
    ...s.people.flatMap((person) => breakFindings(s, person)),
    ...s.people.flatMap((person) => workFindings(s, person)),
    ...s.people.flatMap((person) => uncoveredFindings(s, person)),
    ...s.people.flatMap((person) => withFindings(s, person)),
    ...s.people.flatMap((person) => tidyFindings(s, person)),
    ...unusedFindings(s),
  ];
  const rank: Record<Level, number> = { fix: 0, look: 1, note: 2 };
  return findings.map((finding, at) => ({ finding, at })).sort((a, b) => rank[a.finding.level] - rank[b.finding.level] || a.at - b.at).map((entry) => entry.finding);
}
