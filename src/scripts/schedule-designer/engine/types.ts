// The shape of a schedule: what the tool keeps in memory and what it writes into a workbook.
//
// In plain words: a schedule is a template week for a clinic. It lists the places and rooms, the
// kinds of time (appointments and everything else), the people, and the blocks of time each person
// has on each day. It holds no patients and no real appointments. Every time is a count of minutes
// from midnight (540 is 9:00 in the morning) and every length is in minutes.

/** A day of the week. 0 is Monday and 6 is Sunday. */
export type Day = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** One of twelve swatches. It is a number, never a colour value: the page and the workbook each decide how it looks. */
export type Colour = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/** The grid a person's week snaps to: lines every 15 or every 20 minutes. */
export type Step = 15 | 20;

export interface Schedule {
  format: 'clinx-schedule';
  version: 1;
  /** What this schedule is called, such as "Spring template". */
  name: string;
  /** The clinic's name. Free text, and it may be empty. */
  clinic: string;
  /** The days shown, in order. */
  days: Day[];
  /** The first minute the grid shows, such as 480 for 8:00 in the morning. */
  dayStart: number;
  /** The last minute the grid shows, such as 1020 for 5:00 in the afternoon. */
  dayEnd: number;
  sites: Site[];
  departments: Department[];
  /** Time that is not an appointment: a huddle, a meeting, admin time, lunch. */
  activities: Activity[];
  people: Person[];
  blocks: Block[];
  /**
   * How many slots a person's week may be over or under their slot target and still count as on
   * target. 0 means the week must match the target exactly. See `tallyPerson` in tally.ts.
   */
  tolerance: number;
}

export interface Site {
  id: string;
  name: string;
  rooms: Room[];
}

export interface Room {
  id: string;
  name: string;
}

export interface Department {
  id: string;
  name: string;
  /** The grid a new person in this department starts with. It is also the department's standard appointment length. */
  step: Step;
  /**
   * The share of contract hours that is patient care, before any set-aside time comes out: above 0
   * and at most 1. With 0.8, a 40 hour contract has 32 hours of patient care.
   */
  careFactor: number;
  /** How many standard slots fit in an hour of patient care: from 1 to 12. With 3, a slot is 20 minutes. */
  slotsPerHour: number;
  visitTypes: VisitType[];
}

export interface VisitType {
  id: string;
  name: string;
  /** A short code for a small block, such as "NEW". It may be empty. */
  code: string;
  /** How long one appointment of this type lasts. */
  minutes: number;
  colour: Colour;
}

export interface Activity {
  id: string;
  name: string;
  colour: Colour;
  /** Whether this time counts toward a person's paid hours. Lunch usually does not. */
  paid: boolean;
}

/** Whether a person sees patients on their own schedule, or works alongside the people who do. */
export type PersonKind = 'provider' | 'support';

/** One stretch of a person's working hours on one day: from a minute of the day to a later one. */
export interface WorkStretch {
  day: Day;
  from: number;
  to: number;
}

export interface Person {
  id: string;
  name: string;
  role: string;
  /**
   * A provider has a slot target and a week judged against it. Support staff (a medical assistant,
   * a nurse, a nurse care manager) have no slot target: their week is paid hours against contract
   * hours, and time with the providers they work with. A file saved before this field existed
   * has providers only.
   */
  kind: PersonKind;
  departmentId: string;
  /** This person's grid. The Design toolbar switches it. */
  step: Step;
  /** Paid hours a week. */
  contractHours: number;
  /**
   * The hours a week this person is allowed for time that is not patient care, such as admin time
   * or a required meeting. One line for an activity. The patient-care hours a person needs are
   * never typed: they are the contract hours times the care factor, minus these. See `careTarget`
   * in tally.ts.
   */
  setAside: SetAside[];
  /** This person's own care factor in place of the department's, or null to use the department's. */
  careFactor: number | null;
  /** This person's own slots in an hour in place of the department's, or null to use the department's. */
  slotsPerHour: number | null;
  /** True while a new person builds up to a full week. Their slots are counted and not judged against the target. */
  ramping: boolean;
  /**
   * For support staff, the ids of the providers they usually work with, in the order they were
   * added. Always empty for a provider.
   */
  worksWith: string[];
  /**
   * Working hours: the stretches of each day the person is at work, by day and then by time. At
   * most two stretches a day (a split day), never overlapping or touching, in steps of 5 minutes.
   * An empty list means working hours have not been entered, so nothing is checked against them.
   * Once the list holds anything, a day the schedule shows with no stretch is a day off.
   */
  work: WorkStretch[];
}

/** One set-aside line: so many hours a week for one activity. */
export interface SetAside {
  activityId: string;
  hours: number;
}

/** Where a block of time is spent: in a room at a site, at a site with no room chosen, remote, or nowhere in particular. */
export type Where = { kind: 'site'; siteId: string; roomId: string | null } | { kind: 'remote' } | { kind: 'none' };

/**
 * What a block of time is: one appointment of a visit type, a stretch of an activity, or a stretch
 * that a support person spends working with one provider (`personId` is that provider). Only
 * support staff hold time of the third kind. It is paid time, and its place is a site with no
 * room, so it never takes a room.
 *
 * A known limit: one such block names one provider. An assistant who covers two providers in the
 * same minutes cannot be drawn yet.
 */
export type What = { kind: 'visit'; visitTypeId: string } | { kind: 'activity'; activityId: string } | { kind: 'with'; personId: string };

export interface Block {
  id: string;
  personId: string;
  day: Day;
  /** The minute the block starts. */
  start: number;
  /** How long the block lasts. A visit block is always exactly one appointment long. */
  minutes: number;
  what: What;
  where: Where;
}

/** Every day in order, Monday first. */
export const ALL_DAYS: readonly Day[] = [0, 1, 2, 3, 4, 5, 6];

/** Every swatch in order. */
export const ALL_COLOURS: readonly Colour[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/**
 * A plain name for each swatch, for a label or a screen reader. The page's swatch colours and the
 * workbook's fills are both chosen to fit these names.
 */
export const COLOUR_NAMES: Readonly<Record<Colour, string>> = {
  1: 'Purple',
  2: 'Blue',
  3: 'Teal',
  4: 'Green',
  5: 'Lime',
  6: 'Yellow',
  7: 'Orange',
  8: 'Red',
  9: 'Pink',
  10: 'Sand',
  11: 'Slate',
  12: 'Grey',
};

/** The limits a schedule stays inside, so a page and a workbook can always show it. */
export const LIMITS = {
  /** The longest a name may be, in characters. */
  name: 80,
  /** The longest a visit type's short code may be. */
  code: 8,
  sites: 20,
  roomsPerSite: 60,
  departments: 20,
  visitTypesPerDepartment: 30,
  activities: 30,
  people: 150,
  blocks: 40000,
  /** The shortest and the longest an appointment may be, in minutes. Lengths go in steps of 5. */
  visitMinutes: { least: 5, most: 480 },
  /** The most hours a week a contract or a target may say. */
  hours: 168,
  /** The smallest and the largest care factor an edit keeps. */
  careFactor: { least: 0.01, most: 1 },
  /** The fewest and the most slots in an hour. */
  slotsPerHour: { least: 1, most: 12 },
  /** The widest tolerance, in slots. */
  tolerance: 100,
  /** The most stretches of working hours a day may have: two, for a split day. */
  workStretchesPerDay: 2,
  /** Working hours go in steps of this many minutes. */
  workStep: 5,
  /** The most providers one support person may list. */
  worksWith: 30,
} as const;
