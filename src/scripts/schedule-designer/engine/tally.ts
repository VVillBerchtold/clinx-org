// The tallies: what a week adds up to, for one person and for the clinic.
//
// In plain words: this is the arithmetic the old spreadsheet did under its grid. For each day and
// for the week it counts the appointments and adds up the minutes of patient care, of other paid
// time and of unpaid time. It then sets the week against the person's contract and their
// patient-care target, and says how many more appointments would reach the target.
//
// The target is never typed. A person's contract says how many paid hours a week. The care factor
// says what share of those hours is patient care (0.8 leaves a fifth for everything else). Some
// hours more are set aside for named work: so many hours of a required meeting, so many of
// training. What is left is the person's capacity for patient care:
//   capacity hours = contract hours x care factor - set-aside hours, and never below zero.
// A clinic counts that capacity in slots, a slot being the standard appointment:
//   target slots = capacity hours x slots in an hour, rounded to a whole slot.
//   actual slots = the patient care on the designed week, counted the same way.
//   variance     = actual slots - target slots.
// The care factor and the slots in an hour are set for a department, and a person may have their own.
// The method's own worked case: contract 34, factor 0.8, 1 hour set aside gives 26.2 hours of
// capacity and, at 3 slots an hour, a target of 79 slots.
// Time is kept in whole minutes. `hoursOf` in time.ts turns minutes into hours for showing,
// so 79 twenty-minute appointments are 1,580 minutes, shown as 26.33 hours.
//
// Support staff (a medical assistant, a nurse) have no capacity, no slot target and no verdict to
// judge: their week is paid hours against contract hours, and hours with each provider. Every
// target and every sum of targets here counts providers only. An appointment a support person
// holds, such as a nurse visit, counts in the clinic's appointments and in no slot target.
//
// When a person has working hours entered, the tally also says how long they are at work, how much
// of that is paid (time at work less unpaid time such as lunch inside it), and how much is still open.

import { activityOf, blocksOn, departmentOf, personOf, visitTypeOf } from './find';
import type { Colour, Day, Person, PersonKind, Schedule } from './types';
import { hasWork, openSpans, spanMinutes, unpaidInsideWork, workOn } from './work';

/** What a day or a week adds up to. */
export interface Counts {
  /** How many appointments. */
  appointments: number;
  /** Minutes of patient care: the appointments' time. */
  careMinutes: number;
  /** Minutes of paid time that is not patient care: meetings, admin and the like, and a support person's time with providers. */
  otherPaidMinutes: number;
  /** Minutes a support person spends with providers. They are part of `otherPaidMinutes`. Always zero for a provider. */
  withMinutes: number;
  /** Minutes of unpaid time, such as lunch. */
  unpaidMinutes: number;
  /** All paid minutes: patient care and other paid time together. */
  paidMinutes: number;
  /** Appointments at a site, with or without a room. */
  onSite: number;
  /** Appointments marked remote. */
  remote: number;
  /** Appointments with no place set. */
  noPlace: number;
}

export interface DayTally extends Counts {
  day: Day;
  /** The day's patient care counted in slots, to one decimal place. Zero for support staff. */
  slots: number;
  /** Minutes at work that day, or null when working hours are not entered. Zero on a day off. */
  workMinutes: number | null;
  /** Minutes at work that day with no block in them, or null when working hours are not entered. */
  openMinutes: number | null;
}

/** The care factor and the slots in an hour that apply to one person. */
export interface Standards {
  careFactor: number;
  slotsPerHour: number;
}

/**
 * What a week's slots say against the target.
 * "ramping": the person is building up, so no verdict is given.
 * "needs-contract": the contract hours are 0, so there is no target yet.
 * "needs-schedule": the week has no patient care yet.
 * "on-target": the variance is inside the schedule's tolerance.
 * "over": more slots than the target, so some should come out.
 * "under": fewer slots than the target, so some should be added.
 * "support": the person is support staff, who have no slot target, so there is nothing to judge.
 */
export type Verdict = 'on-target' | 'over' | 'under' | 'ramping' | 'needs-contract' | 'needs-schedule' | 'support';

/** Each verdict in words, for a label or a cell: "On target", "Needs contract". */
export const VERDICT_NAMES: Readonly<Record<Verdict, string>> = {
  'on-target': 'On target',
  over: 'Over',
  under: 'Under',
  ramping: 'Ramping',
  'needs-contract': 'Needs contract',
  'needs-schedule': 'Needs schedule',
  support: 'Support staff',
};

/** One person's week in slots. */
export interface SlotTally {
  /** The slots the person's capacity asks for, a whole number. The same as `slotTarget`. */
  target: number;
  /** The slots on the designed week, to one decimal place: a 40 minute visit at 3 slots an hour is 2 slots. */
  actual: number;
  /** Actual less target. Above zero is over, below zero is under. */
  variance: number;
  verdict: Verdict;
}

/** How much of one visit type a person has in the week. */
export interface TypeCount {
  visitTypeId: string;
  name: string;
  code: string;
  minutes: number;
  colour: Colour;
  appointments: number;
  careMinutes: number;
}

/** One set-aside line set against the week: what the person is allowed and what is on the week. */
export interface SetAsideTally {
  activityId: string;
  name: string;
  colour: Colour;
  /** False when the activity is unpaid. Set-aside hours come out of the contract, so the checks ask about such a line. */
  paid: boolean;
  /** The minutes a week the person is allowed for this activity. */
  allowedMinutes: number;
  /** The minutes of this activity on the person's week. */
  scheduledMinutes: number;
}

/** A support person's time with one provider. */
export interface WithTally {
  /** The provider's id. */
  personId: string;
  name: string;
  /** True when the provider is on the support person's "works with" list. */
  listed: boolean;
  /** Minutes with this provider on each day the schedule shows, in order. */
  byDay: number[];
  /** Minutes with this provider in the week. */
  minutes: number;
}

export interface PersonTally {
  personId: string;
  /** Provider or support staff. Support staff have zero targets and the verdict "support". */
  kind: PersonKind;
  /** One entry for each day the schedule shows, in order. */
  days: DayTally[];
  week: Counts;
  /** The contract, in minutes a week. */
  contractMinutes: number;
  /** All set-aside lines together, in minutes a week. */
  setAsideMinutes: number;
  /** The patient-care target, in minutes a week: the contract times the care factor, minus the set-aside hours. The same as `careTarget`. */
  targetMinutes: number;
  /** The week in slots: target, actual, variance and the verdict. */
  slots: SlotTally;
  /** Each set-aside line, in the person's own order: allowed against scheduled. */
  setAside: SetAsideTally[];
  /** Paid minutes on the week that are neither patient care, nor time with a provider, nor one of the set-aside activities, such as a huddle with no hours set aside. */
  otherPaidNotSetAsideMinutes: number;
  /** Patient care still missing to reach the target. Zero when the target is met. */
  careShortMinutes: number;
  /** Patient care beyond the target. Zero when the week is at or under it. */
  careOverMinutes: number;
  /** Paid time still missing to fill the contract. Zero when it is filled. */
  paidShortMinutes: number;
  /** Paid time beyond the contract. Zero when the week is at or under it. */
  paidOverMinutes: number;
  /** The standard appointment length of the person's department: its grid, 15 or 20 minutes. */
  standardMinutes: number;
  /** How many more appointments of the standard length would reach the target, rounded up. */
  appointmentsNeeded: number;
  /** A count for each visit type: the person's own department's types first (zeros kept), then any other type they use. */
  byType: TypeCount[];
  /** Minutes at work in the week, over the days shown, or null when working hours are not entered. */
  workMinutes: number | null;
  /** Minutes at work less the unpaid time, such as lunch, that sits inside them, or null when working hours are not entered. This is what the contract is set against. */
  paidWorkMinutes: number | null;
  /** Minutes at work with no block in them yet, or null when working hours are not entered. */
  openMinutes: number | null;
  /**
   * For support staff, the time with each provider: the providers on their "works with" list in
   * that order (zeros kept), then any other provider they have time with. Empty for a provider.
   */
  withProviders: WithTally[];
}

const minutesOf = (hours: number): number => Math.round(hours * 60);

/** Takes away the tiny error a computer leaves when it multiplies decimals: 34 x 0.8 - 1 is 26.2, not 26.200000000000003. */
const trim = (value: number): number => Math.round(value * 1e6) / 1e6;
const oneDecimal = (value: number): number => Math.round(trim(value) * 10) / 10;

function standardsFor(s: Schedule, person: Person): Standards {
  const department = departmentOf(s, person.departmentId);
  return { careFactor: person.careFactor ?? department?.careFactor ?? 1, slotsPerHour: person.slotsPerHour ?? department?.slotsPerHour ?? 60 / person.step };
}

function capacityFor(person: Person, careFactor: number): number {
  if (person.kind === 'support') return 0;
  return Math.max(0, trim(person.contractHours * careFactor - person.setAside.reduce((sum, line) => sum + line.hours, 0)));
}

/**
 * The care factor and the slots in an hour that apply to a person: their own value where they
 * have one, else their department's. Gives a factor of 1 and 3 slots an hour for a person who is
 * not in the schedule.
 */
export function standardsOf(s: Schedule, personId: string): Standards {
  const person = personOf(s, personId);
  return person ? standardsFor(s, person) : { careFactor: 1, slotsPerHour: 3 };
}

/**
 * A person's capacity for patient care, in hours a week: contract hours times the care factor,
 * minus the set-aside hours, and never below zero. It is not rounded to the minute, so it is
 * exactly what the same formula gives in the saved workbook. Gives 0 for support staff, who have
 * no patient-care target, and for a person who is not in the schedule.
 */
export function capacityHours(s: Schedule, personId: string): number {
  const person = personOf(s, personId);
  return person ? capacityFor(person, standardsFor(s, person).careFactor) : 0;
}

/**
 * The patient care a person needs in a week, in minutes: their capacity (contract hours times
 * the care factor, minus the set-aside hours, never below zero) to the nearest minute. Gives 0
 * for a person who is not in the schedule.
 */
export function careTarget(s: Schedule, personId: string): number {
  return Math.round(capacityHours(s, personId) * 60);
}

/**
 * A person's target in slots: their capacity hours times their slots in an hour, rounded to a
 * whole slot. Contract 34, factor 0.8 and 1 hour set aside is 26.2 hours, and at 3 slots an hour
 * that is 79 slots. Gives 0 for support staff and for a person who is not in the schedule.
 */
export function slotTarget(s: Schedule, personId: string): number {
  const person = personOf(s, personId);
  if (!person || person.kind === 'support') return 0;
  const standards = standardsFor(s, person);
  return Math.round(trim(capacityFor(person, standards.careFactor) * standards.slotsPerHour));
}

/** Minutes of patient care counted in slots, to one decimal place. */
const slotsIn = (careMinutes: number, slotsPerHour: number): number => oneDecimal((careMinutes * slotsPerHour) / 60);

const nothing = (): Counts => ({ appointments: 0, careMinutes: 0, otherPaidMinutes: 0, withMinutes: 0, unpaidMinutes: 0, paidMinutes: 0, onSite: 0, remote: 0, noPlace: 0 });

/** One person's week added up. Gives nothing when the person is not in the schedule. */
export function tallyPerson(s: Schedule, personId: string): PersonTally | undefined {
  const person = personOf(s, personId);
  if (!person) return undefined;
  const department = departmentOf(s, person.departmentId);
  const types = new Map<string, TypeCount>();
  for (const type of department?.visitTypes ?? []) types.set(type.id, { visitTypeId: type.id, name: type.name, code: type.code, minutes: type.minutes, colour: type.colour, appointments: 0, careMinutes: 0 });

  const week = nothing();
  const byActivity = new Map<string, number>();
  const standards = standardsFor(s, person);
  const support = person.kind === 'support';
  const entered = hasWork(s, personId);
  const withProviders = new Map<string, WithTally>();
  const withRow = (providerId: string): WithTally => {
    let row = withProviders.get(providerId);
    if (!row) {
      row = { personId: providerId, name: personOf(s, providerId)?.name ?? '', listed: person.worksWith.includes(providerId), byDay: s.days.map(() => 0), minutes: 0 };
      withProviders.set(providerId, row);
    }
    return row;
  };
  for (const providerId of person.worksWith) withRow(providerId);
  let workTotal = 0;
  let unpaidAtWork = 0;
  let openTotal = 0;
  const days = s.days.map((day, at): DayTally => {
    const counts = nothing();
    for (const block of blocksOn(s, personId, day)) {
      if (block.what.kind === 'visit') {
        counts.appointments++;
        counts.careMinutes += block.minutes;
        if (block.where.kind === 'site') counts.onSite++;
        else if (block.where.kind === 'remote') counts.remote++;
        else counts.noPlace++;
        let row = types.get(block.what.visitTypeId);
        if (!row) {
          const type = visitTypeOf(s, block.what.visitTypeId);
          row = { visitTypeId: block.what.visitTypeId, name: type?.name ?? '', code: type?.code ?? '', minutes: type?.minutes ?? block.minutes, colour: type?.colour ?? 12, appointments: 0, careMinutes: 0 };
          types.set(row.visitTypeId, row);
        }
        row.appointments++;
        row.careMinutes += block.minutes;
      } else if (block.what.kind === 'with') {
        counts.withMinutes += block.minutes;
        counts.otherPaidMinutes += block.minutes;
        const row = withRow(block.what.personId);
        row.byDay[at] = (row.byDay[at] ?? 0) + block.minutes;
        row.minutes += block.minutes;
      } else {
        byActivity.set(block.what.activityId, (byActivity.get(block.what.activityId) ?? 0) + block.minutes);
        if (activityOf(s, block.what.activityId)?.paid) counts.otherPaidMinutes += block.minutes;
        else counts.unpaidMinutes += block.minutes;
      }
    }
    counts.paidMinutes = counts.careMinutes + counts.otherPaidMinutes;
    for (const key of Object.keys(week) as (keyof Counts)[]) week[key] += counts[key];
    const atWork = entered ? spanMinutes(workOn(s, personId, day)) : null;
    const open = entered ? spanMinutes(openSpans(s, personId, day)) : null;
    workTotal += atWork ?? 0;
    openTotal += open ?? 0;
    if (entered) unpaidAtWork += unpaidInsideWork(s, personId, day);
    return { day, ...counts, slots: support ? 0 : slotsIn(counts.careMinutes, standards.slotsPerHour), workMinutes: atWork, openMinutes: open };
  });

  const contractMinutes = minutesOf(person.contractHours);
  const targetMinutes = careTarget(s, personId);
  const setAside = person.setAside.map((line): SetAsideTally => {
    const activity = activityOf(s, line.activityId);
    return { activityId: line.activityId, name: activity?.name ?? '', colour: activity?.colour ?? 12, paid: activity?.paid ?? false, allowedMinutes: minutesOf(line.hours), scheduledMinutes: byActivity.get(line.activityId) ?? 0 };
  });
  const setAsidePaidScheduled = setAside.reduce((sum, line) => sum + (line.paid ? line.scheduledMinutes : 0), 0);
  const careShortMinutes = Math.max(0, targetMinutes - week.careMinutes);
  const standardMinutes = department?.step ?? person.step;
  const target = slotTarget(s, personId);
  const actual = support ? 0 : slotsIn(week.careMinutes, standards.slotsPerHour);
  const variance = oneDecimal(actual - target);
  const verdict: Verdict = support
    ? 'support'
    : person.ramping
      ? 'ramping'
      : person.contractHours <= 0
        ? 'needs-contract'
        : week.careMinutes === 0
          ? 'needs-schedule'
          : Math.abs(variance) <= s.tolerance
            ? 'on-target'
            : variance > 0
              ? 'over'
              : 'under';
  return {
    personId,
    kind: person.kind,
    days,
    week,
    contractMinutes,
    setAsideMinutes: setAside.reduce((sum, line) => sum + line.allowedMinutes, 0),
    targetMinutes,
    slots: { target, actual, variance, verdict },
    setAside,
    otherPaidNotSetAsideMinutes: week.otherPaidMinutes - week.withMinutes - setAsidePaidScheduled,
    careShortMinutes,
    careOverMinutes: support ? 0 : Math.max(0, week.careMinutes - targetMinutes),
    paidShortMinutes: Math.max(0, contractMinutes - week.paidMinutes),
    paidOverMinutes: Math.max(0, week.paidMinutes - contractMinutes),
    standardMinutes,
    appointmentsNeeded: Math.ceil(careShortMinutes / standardMinutes),
    byType: [...types.values()],
    workMinutes: entered ? workTotal : null,
    paidWorkMinutes: entered ? workTotal - unpaidAtWork : null,
    openMinutes: entered ? openTotal : null,
    withProviders: support ? [...withProviders.values()] : [],
  };
}

/** One visit type across the clinic: how many appointments on each day and in the week. */
export interface ClinicTypeRow {
  visitTypeId: string;
  departmentId: string;
  departmentName: string;
  name: string;
  code: string;
  minutes: number;
  colour: Colour;
  /** Appointments on each day, in the same order as `days`. */
  byDay: number[];
  week: number;
}

/**
 * One department's slots. Only providers with a verdict in slots are counted in the sums: someone
 * who is ramping, has no contract hours, or has no patient care on the week yet is left out, so
 * the sums compare weeks that are meant to match their targets. Support staff have no slots.
 */
export interface ClinicDepartmentRow {
  departmentId: string;
  name: string;
  /** The department's own care factor and slots in an hour. */
  careFactor: number;
  slotsPerHour: number;
  /** The providers in the department. Support staff are counted apart, in `supportStaff`. */
  people: number;
  /** The support staff in the department. They have no slots, so they are in none of the sums. */
  supportStaff: number;
  /** The people whose slots are in the sums. */
  peopleCounted: number;
  /** The counted people's target slots, added up. */
  targetSlots: number;
  /** The counted people's actual slots, added up. */
  actualSlots: number;
  /** Actual less target. */
  variance: number;
}

export interface ClinicTally {
  /** The days the schedule shows. Every `byDay` list follows this order. */
  days: Day[];
  /** One row for each visit type, department by department, zeros kept. */
  types: ClinicTypeRow[];
  /** One row for each department, in order: its people and their slots against target. */
  departments: ClinicDepartmentRow[];
  /** All appointments on each day. */
  byDay: number[];
  /** Minutes of patient care on each day. */
  careMinutesByDay: number[];
  appointments: number;
  careMinutes: number;
}

/** The whole clinic's appointments, by day and by visit type, and each department's slots against target. */
export function tallyClinic(s: Schedule): ClinicTally {
  const column = new Map<Day, number>(s.days.map((day, at) => [day, at]));
  const zeros = (): number[] => s.days.map(() => 0);
  const rows = new Map<string, ClinicTypeRow>();
  for (const department of s.departments) {
    for (const type of department.visitTypes) {
      rows.set(type.id, { visitTypeId: type.id, departmentId: department.id, departmentName: department.name, name: type.name, code: type.code, minutes: type.minutes, colour: type.colour, byDay: zeros(), week: 0 });
    }
  }
  const byDay = zeros();
  const careMinutesByDay = zeros();
  let appointments = 0;
  let careMinutes = 0;
  for (const block of s.blocks) {
    const at = column.get(block.day);
    if (block.what.kind !== 'visit' || at === undefined) continue;
    byDay[at] = (byDay[at] ?? 0) + 1;
    careMinutesByDay[at] = (careMinutesByDay[at] ?? 0) + block.minutes;
    appointments++;
    careMinutes += block.minutes;
    const row = rows.get(block.what.visitTypeId);
    if (row) {
      row.byDay[at] = (row.byDay[at] ?? 0) + 1;
      row.week++;
    }
  }
  const departments = s.departments.map((department): ClinicDepartmentRow => {
    const row: ClinicDepartmentRow = { departmentId: department.id, name: department.name, careFactor: department.careFactor, slotsPerHour: department.slotsPerHour, people: 0, supportStaff: 0, peopleCounted: 0, targetSlots: 0, actualSlots: 0, variance: 0 };
    for (const person of s.people) {
      if (person.departmentId !== department.id) continue;
      if (person.kind === 'support') {
        row.supportStaff++;
        continue;
      }
      row.people++;
      const slots = tallyPerson(s, person.id)?.slots;
      if (!slots || (slots.verdict !== 'on-target' && slots.verdict !== 'over' && slots.verdict !== 'under')) continue;
      row.peopleCounted++;
      row.targetSlots += slots.target;
      row.actualSlots = oneDecimal(row.actualSlots + slots.actual);
    }
    row.variance = oneDecimal(row.actualSlots - row.targetSlots);
    return row;
  });
  return { days: [...s.days], types: [...rows.values()], departments, byDay, careMinutesByDay, appointments, careMinutes };
}
