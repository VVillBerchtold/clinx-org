// Support staff and the providers they work with.
//
// In plain words: a schedule holds two kinds of people. A provider sees patients on their own
// schedule and has a slot target. Support staff (a medical assistant, a nurse, a nurse care
// manager) work alongside providers. A support person lists the providers they usually work with,
// and their week can hold time "with" one of those providers. This file fills such time in from a
// provider's patient time, says who is with a provider and when, says which of a provider's
// patient time has nobody with them, and changes a person from one kind to the other.
//
// A known limit: one block of time with a provider names one provider. An assistant who covers
// two providers in the same minutes cannot be drawn yet.

import { paint } from './edit';
import type { Change } from './edit';
import { blocksOn, endOf, personOf } from './find';
import { dayName, lengthText } from './time';
import { LIMITS } from './types';
import type { Day, Person, PersonKind, Schedule } from './types';
import { hasWork, spanMinutes, spansInside, spansLess, workOn } from './work';
import type { Span } from './work';

/** A stretch of one day at one site. */
export interface SiteSpan extends Span {
  siteId: string;
}

/** A stretch of a day that a support person spends with a provider. */
export interface TeamSpan extends Span {
  /** The support person. */
  personId: string;
  day: Day;
  /** The site the time is at, or null when it has no place. */
  siteId: string | null;
}

/** A provider's patient time at a site on one day, split by whether a support person is with them. */
export interface Coverage {
  covered: SiteSpan[];
  uncovered: SiteSpan[];
}

/** Two appointments at one site less than this many minutes apart count as one stretch of patient time. */
export const TEAM_GAP = 30;

/** The providers of a schedule, in order. */
export function providersIn(s: Schedule): Person[] {
  return s.people.filter((person) => person.kind === 'provider');
}

/** The support staff of a schedule, in order. */
export function supportStaffIn(s: Schedule): Person[] {
  return s.people.filter((person) => person.kind === 'support');
}

/** The support staff who list a provider as someone they work with, in order. */
export function supportFor(s: Schedule, providerId: string): Person[] {
  return s.people.filter((person) => person.kind === 'support' && person.worksWith.includes(providerId));
}

/** A provider's appointments at a site on one day, joined into stretches. Appointments closer than `gap` minutes at one site join; a change of site always starts a new stretch. */
function stretches(s: Schedule, providerId: string, day: Day, gap: number): SiteSpan[] {
  const out: SiteSpan[] = [];
  for (const block of blocksOn(s, providerId, day)) {
    if (block.what.kind !== 'visit' || block.where.kind !== 'site') continue;
    const last = out[out.length - 1];
    if (last && last.siteId === block.where.siteId && block.start - last.to < gap) last.to = Math.max(last.to, endOf(block));
    else out.push({ from: block.start, to: endOf(block), siteId: block.where.siteId });
  }
  return out;
}

/**
 * A person's patient time at a site on one day: their appointments there, with touching ones made
 * one stretch. Remote appointments and appointments with no place are left out. A change of site
 * starts a new stretch.
 */
export function patientTime(s: Schedule, personId: string, day: Day): SiteSpan[] {
  return stretches(s, personId, day, 1);
}

/**
 * The same patient time in the stretches a support person would be with the provider for:
 * appointments that touch or sit less than 30 minutes apart at one site are one stretch, so a
 * short gap between two appointments stays covered. A change of site starts a new stretch.
 */
export function patientStretches(s: Schedule, personId: string, day: Day): SiteSpan[] {
  return stretches(s, personId, day, TEAM_GAP);
}

/**
 * Who is with a provider and when: every stretch of time a support person has with them, on one
 * day or (with no day given) through the week, by day, then by time, then in the order of the
 * people list.
 */
export function teamOf(s: Schedule, providerId: string, day?: Day): TeamSpan[] {
  const out: TeamSpan[] = [];
  for (const one of day === undefined ? s.days : [day]) {
    const spans: TeamSpan[] = [];
    for (const person of s.people) {
      if (person.kind !== 'support') continue;
      for (const block of blocksOn(s, person.id, one)) {
        if (block.what.kind !== 'with' || block.what.personId !== providerId) continue;
        spans.push({ personId: person.id, day: one, from: block.start, to: endOf(block), siteId: block.where.kind === 'site' ? block.where.siteId : null });
      }
    }
    // The sort keeps the order of the people list for stretches that start together.
    out.push(...spans.sort((a, b) => a.from - b.from));
  }
  return out;
}

/** The support staff who have time with a provider this week, in the order of the people list, each with their minutes. */
export function teamHours(s: Schedule, providerId: string): { personId: string; name: string; role: string; byDay: number[]; minutes: number }[] {
  const rows = new Map<string, { personId: string; name: string; role: string; byDay: number[]; minutes: number }>();
  const column = new Map<Day, number>(s.days.map((day, at) => [day, at]));
  for (const span of teamOf(s, providerId)) {
    const person = personOf(s, span.personId);
    let row = rows.get(span.personId);
    if (!row) rows.set(span.personId, (row = { personId: span.personId, name: person?.name ?? '', role: person?.role ?? '', byDay: s.days.map(() => 0), minutes: 0 }));
    const at = column.get(span.day) ?? 0;
    row.byDay[at] = (row.byDay[at] ?? 0) + (span.to - span.from);
    row.minutes += span.to - span.from;
  }
  const rank = new Map(s.people.map((person, at) => [person.id, at]));
  return [...rows.values()].sort((a, b) => (rank.get(a.personId) ?? 0) - (rank.get(b.personId) ?? 0));
}

/**
 * A provider's patient time at a site on one day, split into the stretches when at least one
 * support person is with them and the stretches when nobody is. Any support person's time with
 * the provider counts, wherever that time says it is: time at another site is a matter for the
 * checks, which report it by itself.
 */
export function coverage(s: Schedule, providerId: string, day: Day): Coverage {
  const care = patientTime(s, providerId, day);
  const team = teamOf(s, providerId, day);
  const covered: SiteSpan[] = [];
  const uncovered: SiteSpan[] = [];
  for (const stretch of care) {
    for (const span of spansInside([stretch], team)) covered.push({ ...span, siteId: stretch.siteId });
    for (const span of spansLess([stretch], team)) uncovered.push({ ...span, siteId: stretch.siteId });
  }
  const inOrder = (a: SiteSpan, b: SiteSpan): number => a.from - b.from;
  return { covered: covered.sort(inOrder), uncovered: uncovered.sort(inOrder) };
}

// ---------------------------------------------------------------------------------------------
// Filling a support person's week from a provider's patient time

/** One block of time with a provider that a fill would add. */
export interface WithPiece extends SiteSpan {
  day: Day;
}

/** What filling a support person's week from a provider's patient time would do. */
export interface WithPlan {
  supportId: string;
  providerId: string;
  /** The day the plan is for, or null for the whole week. */
  day: Day | null;
  /** The blocks that would be added, by day and then by time. */
  pieces: WithPiece[];
  /** The provider's patient time at a site that was looked at, in minutes, short gaps included. */
  foundMinutes: number;
  /** The minutes the fill adds. */
  addMinutes: number;
  /** Minutes left out because the support person is already with this provider then. */
  alreadyMinutes: number;
  /** Minutes left out because the support person already has something else then. A fill never overwrites. */
  busyMinutes: number;
  /** Minutes left out because they are outside the support person's working hours, or on their day off. Zero while no working hours are entered. */
  offMinutes: number;
  /** What the fill did, in one plain sentence for the person, written as if it has been done. */
  say: string;
  /** Why some of the provider's patient time was not added, in plain sentences. Empty when all of it was. */
  why: string;
}

const none = (supportId: string, providerId: string, day: Day | null, say: string): WithPlan => ({ supportId, providerId, day, pieces: [], foundMinutes: 0, addMinutes: 0, alreadyMinutes: 0, busyMinutes: 0, offMinutes: 0, say, why: '' });

/**
 * Plans the time a support person would spend with a provider, on one day or (with no day given)
 * through the week, and changes nothing.
 *
 * It takes the provider's appointments at a site (never remote ones), joins those that touch or
 * sit less than 30 minutes apart into stretches, and starts a new stretch where the site changes.
 * When the support person has working hours, each stretch is cut to them. Any time the support
 * person already has a block is left out, whatever the block is: a fill never overwrites. What is
 * left are the pieces to add. The plan counts the minutes it adds and the minutes it left out for
 * each reason, and says so in a sentence.
 */
export function planWith(s: Schedule, supportId: string, providerId: string, day?: Day): WithPlan {
  const support = personOf(s, supportId);
  const provider = personOf(s, providerId);
  const only = day === undefined ? null : day;
  if (!support || support.kind !== 'support') return none(supportId, providerId, only, 'Only support staff can have time with a provider.');
  if (!provider || provider.kind !== 'provider') return none(supportId, providerId, only, 'Time like this is spent with a provider. Choose a provider.');
  const days = day === undefined ? s.days : s.days.includes(day) ? [day] : [];
  const entered = hasWork(s, supportId);
  const plan = none(supportId, providerId, only, '');
  for (const one of days) {
    const mine = blocksOn(s, supportId, one);
    const withThem = mine.filter((block) => block.what.kind === 'with' && block.what.personId === providerId).map((block) => ({ from: block.start, to: endOf(block) }));
    const other = mine.filter((block) => !(block.what.kind === 'with' && block.what.personId === providerId)).map((block) => ({ from: block.start, to: endOf(block) }));
    for (const stretch of patientStretches(s, providerId, one)) {
      plan.foundMinutes += stretch.to - stretch.from;
      const atWork = entered ? spansInside([stretch], workOn(s, supportId, one)) : [{ from: stretch.from, to: stretch.to }];
      plan.offMinutes += stretch.to - stretch.from - spanMinutes(atWork);
      plan.alreadyMinutes += spanMinutes(spansInside(atWork, withThem));
      plan.busyMinutes += spanMinutes(spansInside(atWork, other));
      for (const piece of spansLess(atWork, [...withThem, ...other])) plan.pieces.push({ day: one, from: piece.from, to: piece.to, siteId: stretch.siteId });
    }
  }
  plan.addMinutes = spanMinutes(plan.pieces);

  const when = day === undefined ? 'this week' : `on ${dayName(day)}`;
  if (plan.foundMinutes === 0) {
    plan.say = `${provider.name} has no appointments at a site ${when}, so there was nothing to fill from.`;
    return plan;
  }
  plan.say = plan.addMinutes > 0 ? `Added ${lengthText(plan.addMinutes)} with ${provider.name} ${when}.` : `Nothing was added with ${provider.name} ${when}.`;
  const why: string[] = [];
  if (plan.alreadyMinutes > 0) why.push(`${lengthText(plan.alreadyMinutes)} was already there.`);
  if (plan.busyMinutes > 0) why.push(`${lengthText(plan.busyMinutes)} was left out because ${support.name} has other time then.`);
  if (plan.offMinutes > 0) why.push(`${lengthText(plan.offMinutes)} was left out because that time is outside their working hours.`);
  plan.why = why.join(' ');
  return plan;
}

/**
 * Fills a support person's week, or one day of it, with time with a provider: it adds every piece
 * that `planWith` lists and hands back the new schedule with the plan. It never overwrites and
 * never moves a block. Pieces that touch time already there with the same provider join it. A
 * provider who is not yet on the support person's "works with" list is added to it when anything
 * is added. The same schedule comes back when there is nothing to add.
 */
export function fillWith(s: Schedule, supportId: string, providerId: string, day?: Day): { schedule: Schedule; plan: WithPlan } {
  const plan = planWith(s, supportId, providerId, day);
  let schedule = s;
  for (const piece of plan.pieces) {
    schedule = paint(schedule, { personId: supportId, day: piece.day, from: piece.from, to: piece.to, what: { kind: 'with', personId: providerId }, where: { kind: 'site', siteId: piece.siteId, roomId: null } });
  }
  return { schedule, plan };
}

// ---------------------------------------------------------------------------------------------
// The "works with" list

/**
 * Adds a provider to the list of people a support person works with, at the end. Nothing changes
 * when the first person is not support staff, the second is not a provider, or the provider is
 * already on the list.
 */
export function addWorksWith(s: Schedule, supportId: string, providerId: string): Schedule {
  const support = personOf(s, supportId);
  const provider = personOf(s, providerId);
  if (!support || support.kind !== 'support' || !provider || provider.kind !== 'provider') return s;
  if (support.worksWith.includes(providerId) || support.worksWith.length >= LIMITS.worksWith) return s;
  return { ...s, people: s.people.map((person) => (person.id === supportId ? { ...person, worksWith: [...person.worksWith, providerId] } : person)) };
}

/**
 * Takes a provider off the list of people a support person works with, and removes the time the
 * support person has with them. `touched` says how many blocks went.
 */
export function removeWorksWith(s: Schedule, supportId: string, providerId: string): Change {
  const support = personOf(s, supportId);
  if (!support) return { schedule: s, touched: 0 };
  const blocks = s.blocks.filter((block) => !(block.personId === supportId && block.what.kind === 'with' && block.what.personId === providerId));
  const listed = support.worksWith.includes(providerId);
  if (!listed && blocks.length === s.blocks.length) return { schedule: s, touched: 0 };
  const people = listed ? s.people.map((person) => (person.id === supportId ? { ...person, worksWith: person.worksWith.filter((id) => id !== providerId) } : person)) : s.people;
  return { schedule: { ...s, people, blocks }, touched: s.blocks.length - blocks.length };
}

// ---------------------------------------------------------------------------------------------
// Changing a person's kind

/** What changing a person's kind would take away, so the page can ask first. */
export interface KindChange {
  /** False when the person is not in the schedule or already is of that kind. */
  changes: boolean;
  /** Blocks of time with a provider that would be removed: the person's own, or other people's time with them. */
  withBlocks: number;
  /** "Works with" entries that would go: the person's own list, or their place on other people's lists. */
  listEntries: number;
  /** Set-aside lines that would be removed. Support staff have none. */
  setAsideLines: number;
  /** True when the person's own care factor or slots in an hour would be dropped. */
  ownStandards: boolean;
  /** True when a ramping mark would be taken off. */
  ramping: boolean;
  /** True when the change would remove anything at all. */
  removes: boolean;
  /** What would be removed, in one sentence for the person. Empty when nothing would be. */
  say: string;
}

const count = (n: number, one: string, more: string): string => `${n} ${n === 1 ? one : more}`;

/** Parts of a sentence in a row: "a and b", "a, b and c". */
function listOf(parts: string[]): string {
  if (parts.length < 2) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] ?? ''}`;
}

/**
 * Says what changing a person's kind would remove, and changes nothing. A provider who becomes
 * support staff loses the time support staff had with them, their place on "works with" lists,
 * their set-aside lines, their own care factor and slots in an hour, and a ramping mark. Their
 * appointments stay: support staff may hold appointments, such as nurse visits. A support person
 * who becomes a provider loses their time with providers and their "works with" list.
 */
export function kindChange(s: Schedule, personId: string, kind: PersonKind): KindChange {
  const person = personOf(s, personId);
  const nothing: KindChange = { changes: false, withBlocks: 0, listEntries: 0, setAsideLines: 0, ownStandards: false, ramping: false, removes: false, say: '' };
  if (!person || person.kind === kind || (kind !== 'provider' && kind !== 'support')) return nothing;
  const parts: string[] = [];
  if (kind === 'support') {
    const withBlocks = s.blocks.filter((block) => block.what.kind === 'with' && block.what.personId === personId).length;
    const listEntries = s.people.filter((other) => other.worksWith.includes(personId)).length;
    const setAsideLines = person.setAside.length;
    const ownStandards = person.careFactor !== null || person.slotsPerHour !== null;
    if (withBlocks > 0) parts.push(`${count(withBlocks, 'block', 'blocks')} of time that support staff have with them`);
    if (listEntries > 0) parts.push(`their place on the “works with” list of ${count(listEntries, 'person', 'people')}`);
    if (setAsideLines > 0) parts.push(`their ${count(setAsideLines, 'set-aside line', 'set-aside lines')}`);
    if (ownStandards) parts.push('their own clinical factor and slots an hour');
    if (person.ramping) parts.push('their ramping mark');
    const say = parts.length === 0 ? '' : `Changing ${person.name} to support staff removes ${listOf(parts)}. Their appointments stay on their week.`;
    return { changes: true, withBlocks, listEntries, setAsideLines, ownStandards, ramping: person.ramping, removes: parts.length > 0, say };
  }
  const withBlocks = s.blocks.filter((block) => block.personId === personId && block.what.kind === 'with').length;
  const listEntries = person.worksWith.length;
  if (withBlocks > 0) parts.push(`${count(withBlocks, 'block', 'blocks')} of time they have with providers`);
  if (listEntries > 0) parts.push(`their “works with” list of ${count(listEntries, 'provider', 'providers')}`);
  const say = parts.length === 0 ? '' : `Changing ${person.name} to a provider removes ${listOf(parts)}.`;
  return { changes: true, withBlocks, listEntries, setAsideLines: 0, ownStandards: false, ramping: false, removes: parts.length > 0, say };
}

/**
 * Changes a person from a provider to support staff or back, and takes away what the new kind
 * does not use, exactly as `kindChange` says. `touched` says how many blocks were removed. The
 * same schedule comes back when the person already is of that kind.
 */
export function setKind(s: Schedule, personId: string, kind: PersonKind): Change {
  const person = personOf(s, personId);
  if (!person || person.kind === kind || (kind !== 'provider' && kind !== 'support')) return { schedule: s, touched: 0 };
  if (kind === 'support') {
    const blocks = s.blocks.filter((block) => !(block.what.kind === 'with' && block.what.personId === personId));
    const people = s.people.map((other): Person => {
      if (other.id === personId) return { ...other, kind: 'support', setAside: [], careFactor: null, slotsPerHour: null, ramping: false, worksWith: [] };
      return other.worksWith.includes(personId) ? { ...other, worksWith: other.worksWith.filter((id) => id !== personId) } : other;
    });
    return { schedule: { ...s, people, blocks }, touched: s.blocks.length - blocks.length };
  }
  const blocks = s.blocks.filter((block) => !(block.personId === personId && block.what.kind === 'with'));
  const people = s.people.map((other): Person => (other.id === personId ? { ...other, kind: 'provider', worksWith: [] } : other));
  return { schedule: { ...s, people, blocks }, touched: s.blocks.length - blocks.length };
}
