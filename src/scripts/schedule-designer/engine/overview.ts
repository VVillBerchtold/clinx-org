// The overview: every person's week at a glance, a morning and an afternoon for each day.
//
// In plain words: for each half of each day this picks the kind of time that takes the most
// minutes (patient care, or one activity) and the place where most of that time is spent, and
// says both in a few words: "Patient care, Mill Street". All appointments count together as
// patient care. A block that sits across noon is split between the two halves. When two kinds
// take equal time, patient care is named first, then the activity listed earlier, then time with
// a provider. Each row also says whether the person is a provider or support staff, their working
// hours in the week, and who they work with.

import { activityOf, blocksOn, departmentOf, personColour, personOf, siteOf, visitTypeOf } from './find';
import { capacityHours, standardsOf, tallyPerson } from './tally';
import type { Verdict } from './tally';
import { teamHours } from './team';
import { DAY_MINUTES, NOON, overlap } from './time';
import type { Block, Colour, Day, PersonKind, Schedule } from './types';

/** A morning or an afternoon in a few words. */
export interface Half {
  /** Patient care, other time, or nothing at all. */
  kind: 'care' | 'other' | 'empty';
  /** "Patient care", the activity's name, or "With" and a provider's name. Empty when nothing is planned. */
  label: string;
  /** The site's name, "Remote", or empty when no place is set. */
  place: string;
  /** Both together, for a chip: "Patient care, Mill Street", "Admin time, remote", "Nothing planned". */
  say: string;
  /** The swatch to draw it with: the activity's, or the visit type's that takes the most time. None when nothing is planned. */
  colour: Colour | null;
  /** How many minutes of the half the main kind of time takes. */
  minutes: number;
}

export interface OverviewDay {
  day: Day;
  morning: Half;
  afternoon: Half;
}

export interface OverviewRow {
  personId: string;
  name: string;
  role: string;
  departmentName: string;
  /** A provider, or support staff. */
  kind: PersonKind;
  /** Minutes at work in the week, from the working hours. Null when none are entered. */
  workMinutes: number | null;
  /**
   * The names of the people this person works with. For support staff, the providers on their
   * list. For a provider, the support staff who have time with them this week.
   */
  worksWith: string[];
  /** One entry for each day the schedule shows, in order. */
  days: OverviewDay[];
  careMinutes: number;
  targetMinutes: number;
  paidMinutes: number;
  contractMinutes: number;
  // The roster, in the order a slot tracker reads: hours first, then slots.
  /** Paid hours a week. */
  contractHours: number;
  /** The care factor that applies: the person's own, else the department's. */
  careFactor: number;
  /** All set-aside lines together, in hours a week. */
  setAsideHours: number;
  /** Contract hours times the care factor, minus the set-aside hours, never below zero. */
  capacityHours: number;
  /** The slots in an hour that apply: the person's own, else the department's. */
  slotsPerHour: number;
  /** Target slots: capacity hours times slots in an hour, rounded to a whole slot. */
  target: number;
  /** Actual slots on the designed week, to one decimal place. */
  actual: number;
  /** Actual less target. */
  variance: number;
  verdict: Verdict;
  /** True while the person builds up to a full week. */
  ramping: boolean;
}

/** Adds minutes under a key and keeps the order in which keys were first seen. */
function add(sums: Map<string, number>, key: string, minutes: number): void {
  sums.set(key, (sums.get(key) ?? 0) + minutes);
}

/** The key with the most minutes. On a tie the first in `order` wins, or the first seen. */
function most(sums: Map<string, number>, order?: string[]): string | undefined {
  let chosen: string | undefined;
  for (const key of order ?? sums.keys()) {
    const minutes = sums.get(key);
    if (minutes !== undefined && (chosen === undefined || minutes > (sums.get(chosen) ?? 0))) chosen = key;
  }
  return chosen;
}

function half(s: Schedule, blocks: readonly Block[], from: number, to: number): Half {
  const kinds = new Map<string, number>();
  const part = (block: Block): number => overlap(block.start, block.start + block.minutes, from, to);
  // An activity's key starts with "a:", a provider's with "w:" and a site's with "s:", so an id can never be mistaken for the words care, remote or none.
  const kindOf = (block: Block): string => (block.what.kind === 'visit' ? 'care' : block.what.kind === 'with' ? `w:${block.what.personId}` : `a:${block.what.activityId}`);
  for (const block of blocks) if (part(block) > 0) add(kinds, kindOf(block), part(block));
  const main = most(kinds, ['care', ...s.activities.map((activity) => `a:${activity.id}`), ...s.people.map((person) => `w:${person.id}`)]);
  if (main === undefined) return { kind: 'empty', label: '', place: '', say: 'Nothing planned', colour: null, minutes: 0 };

  const places = new Map<string, number>();
  const types = new Map<string, number>();
  for (const block of blocks) {
    if (part(block) === 0 || kindOf(block) !== main) continue;
    add(places, block.where.kind === 'site' ? `s:${block.where.siteId}` : block.where.kind, part(block));
    if (block.what.kind === 'visit') add(types, block.what.visitTypeId, part(block));
  }
  const where = most(places) ?? 'none';
  const place = where === 'remote' ? 'Remote' : where === 'none' ? '' : (siteOf(s, where.slice(2))?.name ?? '');
  const say = (label: string): string => (place === '' ? label : `${label}, ${place === 'Remote' ? 'remote' : place}`);
  if (main.startsWith('w:')) {
    const providerId = main.slice(2);
    const label = `With ${personOf(s, providerId)?.name ?? 'a provider'}`;
    return { kind: 'other', label, place, say: say(label), colour: personColour(s, providerId), minutes: kinds.get(main) ?? 0 };
  }
  const activity = main === 'care' ? undefined : activityOf(s, main.slice(2));
  const label = main === 'care' ? 'Patient care' : (activity?.name ?? '');
  const colour = main === 'care' ? (visitTypeOf(s, most(types) ?? '')?.colour ?? 12) : (activity?.colour ?? 12);
  return { kind: main === 'care' ? 'care' : 'other', label, place, say: say(label), colour, minutes: kinds.get(main) ?? 0 };
}

/**
 * A row for each person: each day's morning and afternoon in a few words, the week's hours
 * against target and contract, and the roster of a slot tracker (contract hours, care factor,
 * set-aside hours, capacity hours, slots in an hour, target, actual, variance and verdict).
 * A support person's row has no slot target: its capacity, target and actual are 0 and its
 * verdict is "support".
 */
export function overview(s: Schedule): OverviewRow[] {
  return s.people.map((person) => {
    const tally = tallyPerson(s, person.id);
    const standards = standardsOf(s, person.id);
    return {
      personId: person.id,
      name: person.name,
      role: person.role,
      departmentName: departmentOf(s, person.departmentId)?.name ?? '',
      kind: person.kind,
      workMinutes: tally?.workMinutes ?? null,
      worksWith:
        person.kind === 'support'
          ? person.worksWith.flatMap((id) => personOf(s, id)?.name ?? [])
          : teamHours(s, person.id).map((line) => line.name),
      days: s.days.map((day) => {
        const blocks = blocksOn(s, person.id, day);
        return { day, morning: half(s, blocks, 0, NOON), afternoon: half(s, blocks, NOON, DAY_MINUTES) };
      }),
      careMinutes: tally?.week.careMinutes ?? 0,
      targetMinutes: tally?.targetMinutes ?? 0,
      paidMinutes: tally?.week.paidMinutes ?? 0,
      contractMinutes: tally?.contractMinutes ?? 0,
      contractHours: person.contractHours,
      careFactor: standards.careFactor,
      setAsideHours: Math.round(person.setAside.reduce((sum, line) => sum + line.hours, 0) * 100) / 100,
      capacityHours: capacityHours(s, person.id),
      slotsPerHour: standards.slotsPerHour,
      target: tally?.slots.target ?? 0,
      actual: tally?.slots.actual ?? 0,
      variance: tally?.slots.variance ?? 0,
      verdict: tally?.slots.verdict ?? 'needs-schedule',
      ramping: person.ramping,
    };
  });
}
