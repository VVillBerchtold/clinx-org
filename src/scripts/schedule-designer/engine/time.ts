// Times and the grid: how a minute of the day is written, and how a point on the page snaps to a line.
//
// In plain words: the schedule keeps every time as minutes from midnight. This file turns those
// numbers into words a person reads ("9:20 am", "1 hour 30 minutes") and does the arithmetic of the
// grid. A person's grid has a line every 15 or every 20 minutes, counted from the first minute the
// schedule shows. So a clinic that opens at 7:30 with 20 minute appointments has lines at 7:30,
// 7:50 and 8:10. The grid only guides where painting lands. A block always keeps its true minutes.

import type { Day, Step } from './types';

/** The last minute of a day. */
export const DAY_MINUTES = 1440;

/** Noon, where a morning ends and an afternoon starts. */
export const NOON = 720;

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** The full name of a day: "Monday". */
export function dayName(day: Day): string {
  return DAY_NAMES[day];
}

/** The short name of a day: "Mon". */
export function dayShort(day: Day): string {
  return DAY_NAMES[day].slice(0, 3);
}

/** A minute of the day as a clock time: 560 is "9:20 am". */
export function clock(minute: number): string {
  const whole = ((Math.round(minute) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hour = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(rest).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;
}

/** A stretch of time in words: "9:00 am to 9:20 am". */
export function clockRange(from: number, to: number): string {
  return `${clock(from)} to ${clock(to)}`;
}

/**
 * A length of time as a person reads it, in hours and minutes: "20 min", "8 h", "10 h 20 min".
 * No time at all is "0 h". This is the one way the page writes a length, in a figure or in a
 * sentence, so nobody has to turn "10.33" into minutes.
 */
export function lengthText(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (rest === 0) return `${hours} h`;
  return hours === 0 ? `${rest} min` : `${hours} h ${rest} min`;
}

/** Minutes as hours, to two decimal places: 1580 minutes is 26.33 hours. A number for sums and for the workbook. The page writes a length with `lengthText`. */
export function hoursOf(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

/** Minutes as hours in writing, with no zeros left on the end: "26.33", "7.5", "8". */
export function hoursText(minutes: number): string {
  return String(hoursOf(minutes));
}

/** How many minutes two stretches of time share. Zero when they only touch or do not meet. */
export function overlap(aFrom: number, aTo: number, bFrom: number, bTo: number): number {
  return Math.max(0, Math.min(aTo, bTo) - Math.max(aFrom, bFrom));
}

const clampToDay = (minute: number): number => Math.min(DAY_MINUTES, Math.max(0, minute));

/** The minute each row of a grid starts at, from the first minute shown up to the last. */
export function gridLines(dayStart: number, dayEnd: number, step: Step): number[] {
  const lines: number[] = [];
  for (let minute = dayStart; minute < dayEnd; minute += step) lines.push(minute);
  return lines;
}

/** True when a minute sits on a line of the grid that starts at `dayStart`. */
export function onGrid(minute: number, step: Step, dayStart: number): boolean {
  return (minute - dayStart) % step === 0;
}

/** The grid line at or before a minute. */
export function snapDown(minute: number, step: Step, dayStart: number): number {
  return clampToDay(dayStart + Math.floor((minute - dayStart) / step) * step);
}

/** The grid line at or after a minute. */
export function snapUp(minute: number, step: Step, dayStart: number): number {
  return clampToDay(dayStart + Math.ceil((minute - dayStart) / step) * step);
}

/** The nearer grid line. A minute halfway between two lines goes to the later one. */
export function snapNear(minute: number, step: Step, dayStart: number): number {
  return clampToDay(dayStart + Math.round((minute - dayStart) / step) * step);
}

/**
 * The whole cells of the grid that two points cover, whichever way the drag went. A single point
 * (a click, or a key press on one cell) covers the cell it lands in. This is the range to hand to
 * `paint` or `erase`.
 */
export function snapRange(a: number, b: number, step: Step, dayStart: number): { from: number; to: number } {
  const first = clampToDay(Math.min(a, b));
  const last = clampToDay(Math.max(a, b));
  let from = snapDown(first, step, dayStart);
  let to = snapUp(last, step, dayStart);
  // A point that sits exactly on a line has no width yet: give it the cell below, or the cell above at the day's end.
  if (to === snapDown(last, step, dayStart)) to = Math.min(DAY_MINUTES, to + step);
  if (to <= from) from = Math.max(0, to - step);
  return { from, to };
}
