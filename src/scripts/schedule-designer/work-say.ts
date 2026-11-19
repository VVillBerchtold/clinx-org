// Small decisions about working hours that the page makes with no page in hand: the rows Set up
// shows for a week, the times a picker offers, how a day is split in two, what the line under the
// rows says, and what Add says when the time under the pointer is outside a person's working hours.
import { DAY_MINUTES, NOON, blocksOf, clock, dayName, endOf, hasWork, isDayOff, lengthText, outsideWork, workOn } from './engine/index';
import type { Day, Schedule, Span } from './engine/index';
import type { Choice } from './dropdown-keys';

/** The pickers in Set up move in quarter hours. */
export const WORK_STEP = 15;
/** The hours a day starts with when working hours are first entered: 8:00 am to 5:00 pm. */
export const USUAL_DAY: Span = { from: 480, to: 1020 };


/** One row of the working hours in Set up: a day the schedule shows, with its stretches or a day off. */
export interface WorkRow {
  day: Day;
  name: string;
  /** No stretch, one, or two for a split day. */
  stretches: Span[];
  /** True when working hours are entered and this day has none. */
  off: boolean;
}

/** A row for each day the schedule shows. Empty while no working hours are entered. */
export function workRows(s: Schedule, personId: string): WorkRow[] {
  if (!hasWork(s, personId)) return [];
  return s.days.map((day) => ({ day, name: dayName(day), stretches: workOn(s, personId, day), off: isDayOff(s, personId, day) }));
}

/** A time of day for a picker: "8:00 am", and "Midnight" for the end of the day. */
export const timeSay = (minute: number): string => (minute >= DAY_MINUTES ? 'Midnight' : clock(minute));

/**
 * The times a picker offers: every quarter hour from `first` to `last`. The time the day has now
 * stays in the list even when it is not on a quarter hour, so it can be seen and kept.
 */
export function timeChoices(first: number, last: number, own: number): Choice[] {
  const minutes = new Set<number>();
  for (let minute = Math.ceil(first / WORK_STEP) * WORK_STEP; minute <= last; minute += WORK_STEP) minutes.add(minute);
  minutes.add(own);
  return [...minutes].sort((a, b) => a - b).map((minute) => ({ value: String(minute), say: timeSay(minute) }));
}

/** The times each of a day's pickers may offer, so that a stretch never ends before it starts and two stretches never meet. */
export function limitsOf(stretches: readonly Span[]): { from: [number, number]; to: [number, number] }[] {
  return stretches.map((stretch, at) => {
    const before = stretches[at - 1];
    const after = stretches[at + 1];
    return {
      from: [before ? before.to + WORK_STEP : 0, stretch.to - WORK_STEP],
      to: [stretch.from + WORK_STEP, after ? after.from - WORK_STEP : DAY_MINUTES],
    };
  });
}

/**
 * A day of one stretch made into two. A day that runs through the middle of the day is split
 * around 12:00 pm to 1:00 pm. A shorter day gets a second stretch an hour after the first, as long
 * as the first and no longer than four hours, or before the first when the day has no room after
 * it. Nothing when there is no room either side.
 */
export function splitOf(stretch: Span): [Span, Span] | null {
  const back = NOON + 60;
  if (stretch.from <= NOON - 60 && stretch.to >= back + 60) return [{ from: stretch.from, to: NOON }, { from: back, to: stretch.to }];
  const length = Math.min(240, stretch.to - stretch.from);
  if (stretch.to + 120 <= DAY_MINUTES) return [stretch, { from: stretch.to + 60, to: Math.min(DAY_MINUTES, stretch.to + 60 + length) }];
  if (stretch.from - 120 >= 0) return [{ from: Math.max(0, stretch.from - 60 - length), to: stretch.from - 60 }, stretch];
  return null;
}

/** The hours a day starts with: 8:00 am to 5:00 pm, kept inside the hours the schedule shows when they are narrower. */
export function usualDay(s: Schedule): Span {
  const from = Math.max(s.dayStart, USUAL_DAY.from);
  const to = Math.min(s.dayEnd, USUAL_DAY.to);
  return to - from >= 60 ? { from, to } : { from: s.dayStart, to: s.dayEnd };
}

/** The hours a day off gets when it becomes a working day: the hours of the nearest working day before it, else after it, else the usual day. */
export function hoursLike(s: Schedule, personId: string, day: Day): Span[] {
  const at = s.days.indexOf(day);
  const others = [...s.days.slice(0, Math.max(0, at)).reverse(), ...s.days.slice(at + 1)];
  for (const other of others) {
    const stretches = workOn(s, personId, other);
    if (stretches.length > 0) return stretches;
  }
  return [usualDay(s)];
}

/** What the block says while nothing is entered. */
export const NO_WORK_SAY = 'No working hours are entered. Nothing on this week is shaded and nothing is checked against working hours. Enter them when you want the week to show when this person is at work.';

/**
 * The line under the rows: hours at work in the week beside the contract hours. `paid` is the time
 * at work less the unpaid time, such as lunch, that sits inside it.
 */
export function workWeekSay(work: number, paid: number, contract: number): string {
  const unpaid = work - paid;
  const first = unpaid > 0 ? `${lengthText(work)} at work in the week: ${lengthText(paid)} paid and ${lengthText(unpaid)} unpaid, such as lunch.` : `${lengthText(work)} at work in the week.`;
  return `${first} The contract is ${lengthText(contract)}.`;
}

/** How a stretch of time sits against a person's working hours. */
export type OffKind = 'inside' | 'outside' | 'day-off';

export function offKind(s: Schedule, personId: string, day: Day, from: number, to: number): OffKind {
  if (!hasWork(s, personId)) return 'inside';
  if (isDayOff(s, personId, day)) return 'day-off';
  return outsideWork(s, personId, day, from, to).length > 0 ? 'outside' : 'inside';
}

/** A few words for the end of the label that follows the pointer in Add. Empty inside working hours. */
export function offShort(kind: OffKind): string {
  return kind === 'day-off' ? 'on a day off' : kind === 'outside' ? 'outside working hours' : '';
}

/**
 * What Add says beside the switch while the time under the pointer is outside a person's working
 * hours. Adding there is still allowed, and the words say so. They are short, because they stay on
 * one line. Empty inside working hours and while none are entered.
 */
export function offSay(s: Schedule, personId: string, day: Day, from: number, to: number): string {
  const kind = offKind(s, personId, day, from, to);
  if (kind === 'inside') return '';
  if (kind === 'day-off') return `${dayName(day)} is a day off. You can still add time here.`;
  return 'Outside working hours. You can still add time here.';
}

/** The words added to the line under the week after time was added outside working hours. Empty inside them. */
export function offAfter(s: Schedule, personId: string, day: Day, from: number, to: number): string {
  const kind = offKind(s, personId, day, from, to);
  if (kind === 'inside') return '';
  return kind === 'day-off' ? ` ${dayName(day)} is a day off in their working hours.` : ' That is outside their working hours.';
}

/** The time a person has planned outside their working hours in the week, in minutes. Zero while no working hours are entered. */
export function plannedOutside(s: Schedule, personId: string): number {
  let minutes = 0;
  for (const block of blocksOf(s, personId)) for (const span of outsideWork(s, personId, block.day, block.start, endOf(block))) minutes += span.to - span.from;
  return minutes;
}

/** The three figures of the tally beside the week, in minutes: at work, with a block in it, and still open. */
export function workFigures(work: number | null, open: number | null): { work: number; scheduled: number; open: number } | null {
  if (work === null || open === null) return null;
  return { work, scheduled: Math.max(0, work - open), open };
}

/**
 * The first row a day's column should open on: one hour above the earlier of the first working
 * minute and the first block, on the hour. Nothing when the day holds neither.
 */
export function firstRow(extent: Span | null): number | null {
  return extent === null ? null : Math.floor(extent.from / 60) * 60 - 60;
}
