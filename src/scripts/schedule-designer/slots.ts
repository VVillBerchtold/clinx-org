// Words for a week's slots against its target. The tallies beside the week, the Overview, the
// Set up step and the printed page all say it the same way.
import { blocksOf, capacityHours, lengthText, personOf, slotTarget, standardsOf, tallyPerson } from './engine/index';
import type { Schedule, SlotTally } from './engine/index';

/** A count of slots or hours for showing: one decimal place for slots, two for hours, and no trailing zeros. */
export const slotNum = (count: number): string => String(Math.round(count * 10) / 10);
export const hourNum = (hours: number): string => String(Math.round(hours * 100) / 100);

/** A number of hours as a length a person reads: 37.5 is "37 h 30 min". */
export const hourSpan = (hours: number): string => lengthText(hours * 60);
export const slotWords = (count: number): string => `${slotNum(count)} ${Math.abs(count) === 1 ? 'slot' : 'slots'}`;
/** A clinical factor as a percent: 0.8 is "80%". */
export const percent = (factor: number): string => `${Math.round(factor * 1000) / 10}%`;
/** A difference with its sign: "+2", "−4" or "0". */
export const signed = (count: number): string => (count > 0 ? `+${slotNum(count)}` : count < 0 ? `−${slotNum(-count)}` : '0');

export interface VerdictSay {
  /** Which colour to give it: met, short, over, or none when there is no verdict. */
  state: 'met' | 'short' | 'over' | 'none';
  /** The headline: "On target", "4 slots under". */
  head: string;
  /** A few words for a chip in a table. */
  chip: string;
  /** What to do about it, in a sentence. */
  note: string;
}

export function verdictSay(slots: SlotTally, tolerance: number): VerdictSay {
  const off = Math.abs(slots.variance);
  switch (slots.verdict) {
    case 'under':
      return { state: 'short', head: `${slotWords(off)} under`, chip: `${slotNum(off)} under`, note: `Add ${slotWords(off)} to reach the target.` };
    case 'over':
      return { state: 'over', head: `${slotWords(off)} over`, chip: `${slotNum(off)} over`, note: `Take out ${slotWords(off)} to come back to the target.` };
    case 'ramping':
      return { state: 'none', head: 'Ramping', chip: 'Ramping', note: 'This person is building up to a whole week. The slots are counted and are not held to the target.' };
    case 'needs-contract':
      return { state: 'none', head: 'No contract hours', chip: 'Needs contract', note: 'Give this person contract hours in Set up to see a target.' };
    case 'support':
      return { state: 'none', head: 'Support staff', chip: 'Support staff', note: 'Support staff have no slot target. Their paid hours are counted against their contract hours.' };
    case 'needs-schedule':
      return { state: 'none', head: 'Nothing planned', chip: 'Needs a week', note: `Appointments added to this week are counted against the target of ${slotWords(slots.target)}.` };
    default:
      return {
        state: 'met',
        head: 'On target',
        chip: 'On target',
        note: off === 0 ? 'The week matches the target.' : `The week is ${slotWords(off)} ${slots.variance < 0 ? 'under' : 'over'}, which is within the ${slotWords(tolerance)} allowed.`,
      };
  }
}

/** How a person's target is made, in sentences a person can follow with a calculator. */
export function targetSay(s: Schedule, personId: string): string {
  const person = personOf(s, personId);
  if (!person) return '';
  const { careFactor, slotsPerHour } = standardsOf(s, personId);
  const aside = person.setAside.reduce((sum, line) => sum + line.hours, 0);
  const capacity = hourSpan(capacityHours(s, personId));
  const contract = hourSpan(person.contractHours);
  let hours: string;
  if (careFactor < 1) {
    hours = `${percent(careFactor)} of the ${contract} contract is ${hourSpan(person.contractHours * careFactor)}.`;
    if (aside > 0) hours += ` Less ${hourSpan(aside)} set aside leaves ${capacity}.`;
  } else if (aside > 0) hours = `The ${contract} contract, less ${hourSpan(aside)} set aside, leaves ${capacity}.`;
  else hours = `All of the ${contract} contract is for patient care.`;
  return `${hours} At ${slotNum(slotsPerHour)} slots an hour, the target is ${slotWords(slotTarget(s, personId))}.`;
}

/**
 * Why a week's slots and its appointments are two different numbers, for where both show side by
 * side: how long a slot is, and how many slots the person's most common longer or shorter visit
 * counts as. Empty when the two numbers are the same, and for support staff.
 */
export function slotNote(s: Schedule, personId: string): string {
  const tally = tallyPerson(s, personId);
  if (!tally || tally.kind === 'support' || tally.slots.actual === tally.week.appointments) return '';
  const slot = 60 / standardsOf(s, personId).slotsPerHour;
  const long = Number.isInteger(slot) ? lengthText(slot) : `${hourNum(slot)} min`;
  const lengths = new Map<number, number>();
  for (const block of blocksOf(s, personId)) if (block.what.kind === 'visit' && block.minutes !== slot) lengths.set(block.minutes, (lengths.get(block.minutes) ?? 0) + 1);
  let common: number | undefined;
  for (const [minutes, count] of lengths) if (common === undefined || count > (lengths.get(common) ?? 0)) common = minutes;
  if (common === undefined) return `A slot is ${long} of patient care.`;
  return `A slot is ${long}, so a ${lengthText(common)} visit counts as ${slotWords(common / slot)}.`;
}
