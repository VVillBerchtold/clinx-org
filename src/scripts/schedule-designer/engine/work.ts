// Working hours: the stretches of each day a person is at work, and what the week looks like against them.
//
// In plain words: contract hours say how many paid hours a week. Working hours say when: Monday
// 8:00 am to 5:00 pm, Friday 8:00 am to 12:00 pm. A day may have two stretches (a split day), and a
// day the schedule shows with no stretch is a day off. Working hours are optional. While a person
// has none entered, nothing here shades their week or checks it. Once they are entered, the page
// can shade the time outside them, the tally can say how much of the time at work is still open,
// and the checks can point at paid time that sits outside them.
//
// The edits here follow the rule of every edit: they give back a new schedule, or the very same
// one when nothing changed.

import { activityOf, blocksOn, endOf, personOf } from './find';
import { DAY_MINUTES, clockRange, overlap } from './time';
import { LIMITS } from './types';
import type { Block, Day, Person, Schedule, WorkStretch } from './types';

/** A stretch of one day: from a minute to a later one. */
export interface Span {
  from: number;
  to: number;
}

/** A stretch of one person's day. */
export interface DaySpan extends Span {
  personId: string;
  day: Day;
}

// ---------------------------------------------------------------------------------------------
// Arithmetic on stretches

/** Stretches in time order with overlapping and touching ones made one. */
function merged(spans: readonly Span[]): Span[] {
  const out: Span[] = [];
  for (const span of [...spans].sort((a, b) => a.from - b.from || a.to - b.to)) {
    const last = out[out.length - 1];
    if (last && span.from <= last.to) last.to = Math.max(last.to, span.to);
    else out.push({ from: span.from, to: span.to });
  }
  return out;
}

/** What is left of some stretches once others are taken out of them. */
export function spansLess(spans: readonly Span[], taken: readonly Span[]): Span[] {
  const out: Span[] = [];
  const holes = merged(taken);
  for (const span of spans) {
    let from = span.from;
    for (const hole of holes) {
      if (hole.to <= from || hole.from >= span.to) continue;
      if (hole.from > from) out.push({ from, to: hole.from });
      from = Math.max(from, hole.to);
    }
    if (from < span.to) out.push({ from, to: span.to });
  }
  return out;
}

/** The parts of some stretches that lie inside others. */
export function spansInside(spans: readonly Span[], within: readonly Span[]): Span[] {
  const out: Span[] = [];
  for (const span of spans) {
    for (const other of merged(within)) {
      const from = Math.max(span.from, other.from);
      const to = Math.min(span.to, other.to);
      if (to > from) out.push({ from, to });
    }
  }
  return out;
}

/** How many minutes some stretches hold together. */
export function spanMinutes(spans: readonly Span[]): number {
  return spans.reduce((sum, span) => sum + (span.to - span.from), 0);
}

const stretchesOf = (person: Person, day: Day): Span[] => person.work.filter((stretch) => stretch.day === day).map((stretch) => ({ from: stretch.from, to: stretch.to }));

// ---------------------------------------------------------------------------------------------
// Reading working hours

/** True when working hours have been entered for a person. While they have not, nothing is shaded or checked. */
export function hasWork(s: Schedule, personId: string): boolean {
  return (personOf(s, personId)?.work.length ?? 0) > 0;
}

/** A person's working stretches on one day, in time order. Empty on a day off, and while no working hours are entered. */
export function workOn(s: Schedule, personId: string, day: Day): Span[] {
  const person = personOf(s, personId);
  return person ? stretchesOf(person, day) : [];
}

/** True when working hours are entered and this day, one the schedule shows, has none: a day off. */
export function isDayOff(s: Schedule, personId: string, day: Day): boolean {
  const person = personOf(s, personId);
  return !!person && person.work.length > 0 && s.days.includes(day) && !person.work.some((stretch) => stretch.day === day);
}

/** Minutes at work on one day, or nothing when working hours are not entered. */
export function workMinutesOn(s: Schedule, personId: string, day: Day): number | null {
  return hasWork(s, personId) ? spanMinutes(workOn(s, personId, day)) : null;
}

/** Minutes at work in the week, over the days the schedule shows, or nothing when working hours are not entered. */
export function workMinutes(s: Schedule, personId: string): number | null {
  if (!hasWork(s, personId)) return null;
  return s.days.reduce<number>((sum, day) => sum + spanMinutes(workOn(s, personId, day)), 0);
}

/**
 * True when a stretch of time lies wholly inside a person's working hours on that day. Always
 * true while working hours are not entered, because then there is nothing to be outside of.
 */
export function insideWork(s: Schedule, personId: string, day: Day, from: number, to: number): boolean {
  if (!hasWork(s, personId)) return true;
  return workOn(s, personId, day).some((stretch) => stretch.from <= from && to <= stretch.to);
}

/** The parts of a stretch of time that lie outside a person's working hours on that day. Empty while working hours are not entered. */
export function outsideWork(s: Schedule, personId: string, day: Day, from: number, to: number): Span[] {
  if (!hasWork(s, personId) || to <= from) return [];
  return spansLess([{ from, to }], workOn(s, personId, day));
}

/**
 * The parts of the hours the schedule shows that are outside a person's working hours on one day,
 * for the page to shade. A day off gives the whole of the hours shown. Empty while working hours
 * are not entered.
 */
export function offHours(s: Schedule, personId: string, day: Day): Span[] {
  return outsideWork(s, personId, day, s.dayStart, s.dayEnd);
}

/** True when a block counts toward paid hours: an appointment, a paid activity, or time with a provider. */
function isPaid(s: Schedule, block: Block): boolean {
  return block.what.kind === 'activity' ? activityOf(s, block.what.activityId)?.paid === true : true;
}

/**
 * A person's blocks of paid time that sit outside their working hours, in whole or in part, on one
 * day or (with no day given) through the week. Unpaid time such as lunch is never listed: on a
 * split day it belongs between the two stretches. Empty while working hours are not entered.
 */
export function blocksOutsideWork(s: Schedule, personId: string, day?: Day): Block[] {
  if (!hasWork(s, personId)) return [];
  const days = day === undefined ? s.days : [day];
  return days.flatMap((one) => blocksOn(s, personId, one).filter((block) => isPaid(s, block) && !insideWork(s, personId, one, block.start, endOf(block))));
}

/** The time at work on one day that has no block in it yet. Empty while working hours are not entered. */
export function openSpans(s: Schedule, personId: string, day: Day): Span[] {
  return spansLess(workOn(s, personId, day), blocksOn(s, personId, day).map((block) => ({ from: block.start, to: endOf(block) })));
}

/** Minutes of unpaid time, such as lunch, that sit inside a person's working hours on one day. */
export function unpaidInsideWork(s: Schedule, personId: string, day: Day): number {
  const work = workOn(s, personId, day);
  let minutes = 0;
  for (const block of blocksOn(s, personId, day)) {
    if (isPaid(s, block)) continue;
    for (const stretch of work) minutes += overlap(block.start, endOf(block), stretch.from, stretch.to);
  }
  return minutes;
}

/**
 * One day's working hours in words: "8:00 am to 5:00 pm", "8:00 am to 12:00 pm and 1:00 pm to
 * 5:00 pm" for a split day, "Day off", or nothing while working hours are not entered.
 */
export function workText(s: Schedule, personId: string, day: Day): string {
  if (!hasWork(s, personId)) return '';
  const stretches = workOn(s, personId, day);
  return stretches.length === 0 ? 'Day off' : stretches.map((stretch) => clockRange(stretch.from, stretch.to)).join(' and ');
}

/**
 * The earliest and the latest minute a person's day holds anything: working hours or blocks.
 * Nothing when the day holds neither. The page opens a week a little above the earlier of these.
 */
export function dayExtent(s: Schedule, personId: string, day: Day): Span | null {
  const spans = [...workOn(s, personId, day), ...blocksOn(s, personId, day).map((block) => ({ from: block.start, to: endOf(block) }))];
  if (spans.length === 0) return null;
  return { from: Math.min(...spans.map((span) => span.from)), to: Math.max(...spans.map((span) => span.to)) };
}

/**
 * The earliest and the latest minute a person's week holds anything, over the days the schedule
 * shows: working hours or blocks. Nothing when the week holds neither. A printed week covers this.
 */
export function weekExtent(s: Schedule, personId: string): Span | null {
  const days = s.days.map((day) => dayExtent(s, personId, day)).filter((span): span is Span => span !== null);
  if (days.length === 0) return null;
  return { from: Math.min(...days.map((span) => span.from)), to: Math.max(...days.map((span) => span.to)) };
}

/**
 * Working stretches that reach outside the hours the schedule shows, for every person or for one.
 * `setHours` keeps working hours as they are, as it keeps blocks, so after the hours shown are
 * made narrower these are the stretches the grid can no longer show in full. The checks list them,
 * and the page can say how many there are before it changes the hours.
 */
export function workOutsideHours(s: Schedule, personId?: string): DaySpan[] {
  const out: DaySpan[] = [];
  for (const person of s.people) {
    if (personId !== undefined && person.id !== personId) continue;
    for (const stretch of person.work) {
      if (s.days.includes(stretch.day) && (stretch.from < s.dayStart || stretch.to > s.dayEnd)) out.push({ personId: person.id, day: stretch.day, from: stretch.from, to: stretch.to });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Changing working hours

const sorted = (work: readonly WorkStretch[]): WorkStretch[] => [...work].sort((a, b) => a.day - b.day || a.from - b.from);
const sameWork = (a: readonly WorkStretch[], b: readonly WorkStretch[]): boolean => a.length === b.length && a.every((stretch, at) => stretch.day === b[at]?.day && stretch.from === b[at]?.from && stretch.to === b[at]?.to);

/** Stretches as they are kept: on the five minute step, inside the day, in order, with overlapping and touching ones made one. */
function tidied(stretches: readonly Span[]): Span[] | undefined {
  const step = LIMITS.workStep;
  const kept: Span[] = [];
  for (const stretch of stretches) {
    if (!Number.isFinite(stretch.from) || !Number.isFinite(stretch.to)) return undefined;
    const from = Math.min(DAY_MINUTES, Math.max(0, Math.round(stretch.from / step) * step));
    const to = Math.min(DAY_MINUTES, Math.max(0, Math.round(stretch.to / step) * step));
    if (to > from) kept.push({ from, to });
  }
  return merged(kept);
}

/** The hours shown, made wide enough to hold these stretches. The first hour moves by whole hours, so every grid keeps its lines. */
function widened(s: Schedule, stretches: readonly Span[]): { dayStart: number; dayEnd: number } {
  let { dayStart, dayEnd } = s;
  for (const stretch of stretches) {
    if (stretch.from < dayStart) {
      const moved = dayStart - Math.ceil((dayStart - stretch.from) / 60) * 60;
      dayStart = moved >= 0 ? moved : Math.floor(stretch.from / 60) * 60;
    }
    if (stretch.to > dayEnd) dayEnd = Math.min(DAY_MINUTES, Math.ceil(stretch.to / 60) * 60);
  }
  return { dayStart, dayEnd };
}

function withWork(s: Schedule, person: Person, work: WorkStretch[], hours: { dayStart: number; dayEnd: number }): Schedule {
  const sameHours = hours.dayStart === s.dayStart && hours.dayEnd === s.dayEnd;
  if (sameWork(person.work, work) && sameHours) return s;
  return { ...s, dayStart: hours.dayStart, dayEnd: hours.dayEnd, people: s.people.map((item) => (item.id === person.id ? { ...item, work } : item)) };
}

/**
 * Sets one day's working hours for a person: no stretch for a day off, one, or two for a split
 * day. Each time is rounded to five minutes and kept inside the day. A stretch that ends where it
 * starts is dropped, and stretches that overlap or touch become one. Nothing changes when more
 * than two stretches are left, when a time is not a number, or when the person or the day is not
 * in the schedule.
 *
 * A stretch that starts before the first hour shown, or ends after the last, widens the hours
 * shown to the whole hour so it can be seen. The first hour moves back by whole hours from where
 * it was, so everyone's grid lines stay where they are.
 *
 * Giving a day no stretch while it is the only day with any clears the person's working hours,
 * which then count as not entered.
 */
export function setWork(s: Schedule, personId: string, day: Day, stretches: readonly Span[]): Schedule {
  const person = personOf(s, personId);
  if (!person || !s.days.includes(day)) return s;
  const kept = tidied(stretches);
  if (!kept || kept.length > LIMITS.workStretchesPerDay) return s;
  const work = sorted([...person.work.filter((stretch) => stretch.day !== day), ...kept.map((stretch) => ({ day, from: stretch.from, to: stretch.to }))]);
  return withWork(s, person, work, widened(s, kept));
}

/**
 * Copies one day's working hours onto other days, replacing what those days had. Copying a day
 * off makes the others days off too. The day itself, a day named twice and a day the schedule does
 * not show are skipped.
 */
export function copyWork(s: Schedule, personId: string, fromDay: Day, toDays: readonly Day[]): Schedule {
  const person = personOf(s, personId);
  if (!person || !s.days.includes(fromDay)) return s;
  const targets = [...new Set(toDays)].filter((day) => day !== fromDay && s.days.includes(day));
  if (targets.length === 0) return s;
  const source = stretchesOf(person, fromDay);
  const work = sorted([...person.work.filter((stretch) => !targets.includes(stretch.day)), ...targets.flatMap((day) => source.map((stretch) => ({ day, from: stretch.from, to: stretch.to })))]);
  return withWork(s, person, work, { dayStart: s.dayStart, dayEnd: s.dayEnd });
}

/** Clears a person's working hours, so they count as not entered. Their blocks stay as they are. */
export function clearWork(s: Schedule, personId: string): Schedule {
  const person = personOf(s, personId);
  if (!person || person.work.length === 0) return s;
  return withWork(s, person, [], { dayStart: s.dayStart, dayEnd: s.dayEnd });
}
