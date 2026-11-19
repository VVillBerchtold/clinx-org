// Small decisions about support staff that the page makes with no page in hand: which providers a
// support person can add time with, what the fill button says and what the line under the week says
// after a fill, what an empty week says, who is with a provider and when, and the order of the
// people in the Day view.
import { blocksOf, clockRange, dayName, lengthText, personOf, teamOf } from './engine/index';
import type { Day, Person, Schedule, TeamSpan, WithPlan } from './engine/index';

/** A provider a support person can add time with. */
export interface WithChoice {
  personId: string;
  name: string;
  role: string;
}

/** "With Maren Castellane", the name of time spent beside a provider. */
export const withName = (name: string): string => (name.trim() === '' ? 'With a provider' : `With ${name.trim()}`);

/**
 * The providers a support person can add time with: the ones on their "works with" list, in the
 * order of the list, then any other provider they already have time with. Nobody for a provider.
 */
export function withChoices(s: Schedule, personId: string): WithChoice[] {
  const person = personOf(s, personId);
  if (!person || person.kind !== 'support') return [];
  const ids = [...person.worksWith];
  for (const block of blocksOf(s, personId)) if (block.what.kind === 'with' && !ids.includes(block.what.personId)) ids.push(block.what.personId);
  const out: WithChoice[] = [];
  for (const id of ids) {
    const provider = personOf(s, id);
    if (provider && provider.kind === 'provider') out.push({ personId: provider.id, name: provider.name, role: provider.role.trim() });
  }
  return out;
}

/** The providers who can still be added to a support person's "works with" list, in the order of the people list. */
export function canWorkWith(s: Schedule, personId: string): Person[] {
  const person = personOf(s, personId);
  if (!person || person.kind !== 'support') return [];
  return s.people.filter((other) => other.kind === 'provider' && !person.worksWith.includes(other.id));
}

/** The full name of the button that fills a support person's week, or one day of it, from a provider's patient time. */
export function fillLabel(providerName: string, day?: Day): string {
  const whose = `${providerName.trim() === '' ? 'this provider' : providerName.trim()}’s patient time`;
  return day === undefined ? `Fill from ${whose}` : `Fill ${dayName(day)} from ${whose}`;
}

/** The short words on the fill button. The provider is named in the field beside it, so the button says "their". */
export function fillShort(day?: Day): string {
  return `${fillStart(day)}${FILL_REST}`;
}

/** The first words of the fill button, which are all a phone has room for beside the field: "Fill the week", or "Fill Monday". */
export const fillStart = (day?: Day): string => (day === undefined ? 'Fill the week' : `Fill ${dayName(day)}`);

/** The rest of the fill button's words. */
export const FILL_REST = ' from their patient time';

/**
 * The choice in a day's menu that fills that one day of a support person's week from the patient
 * time of the provider chosen in "What to add". It is there only while adding time with a provider,
 * so a support person who changes provider in the middle of a week can fill day by day.
 */
export function dayFill(s: Schedule, personId: string, tool: { kind: string; personId?: string }, day: Day, adding: boolean): { providerId: string; say: string } | null {
  if (!adding || tool.kind !== 'with' || tool.personId === undefined) return null;
  const person = s.people.find((one) => one.id === personId);
  const provider = s.people.find((one) => one.id === tool.personId);
  if (!person || person.kind !== 'support' || !provider || provider.kind !== 'provider') return null;
  return { providerId: provider.id, say: fillLabel(provider.name, day) };
}

/** The line under the week after a fill: what was added, and that Undo takes it back when anything was. The reasons for what was left out wait behind "Why". */
export function fillSay(plan: WithPlan): string {
  return plan.addMinutes > 0 ? `${plan.say} Undo takes it off again.` : plan.say;
}

/**
 * What an empty week says for a support person, in Look. With a provider on their list it points
 * at the fill button. With nobody on the list it says where the list is.
 */
export function emptySupportSay(s: Schedule, personId: string, whole: boolean, day: Day): string {
  const first = withChoices(s, personId)[0];
  const nothing = whole ? 'Nothing is on this week yet.' : `Nothing is on ${dayName(day)} yet.`;
  if (first) return `${nothing} To begin, choose Add. One button there fills ${whole ? 'the week' : 'the day'} from ${first.name}’s patient time.`;
  return `${nothing} To begin, open Set up and add the providers this person works with. Their patient time can then fill this week.`;
}

/** What an empty week says for a support person in Add. */
export function emptySupportAddSay(s: Schedule, personId: string, finger: boolean): string {
  const drag = finger ? 'press and hold on a day, then drag down' : 'drag down a day';
  return withChoices(s, personId).length > 0 ? `Use the Fill button above, or ${drag} to add time.` : `Nobody is on this person’s “works with” list yet. You can still ${drag} to add other time.`;
}

/** One support person who is with a provider, and when. */
export interface TeamRow {
  personId: string;
  name: string;
  role: string;
  /** Their stretches of time with the provider, by day and then by time. */
  spans: TeamSpan[];
  minutes: number;
}

/** The support staff who have time with a provider, on one day or through the week, in the order of the people list. */
export function teamRows(s: Schedule, providerId: string, day?: Day): TeamRow[] {
  const rows = new Map<string, TeamRow>();
  for (const span of teamOf(s, providerId, day)) {
    let row = rows.get(span.personId);
    if (!row) {
      const person = personOf(s, span.personId);
      rows.set(span.personId, (row = { personId: span.personId, name: person?.name ?? '', role: person?.role.trim() ?? '', spans: [], minutes: 0 }));
    }
    row.spans.push(span);
    row.minutes += span.to - span.from;
  }
  const rank = new Map(s.people.map((person, at) => [person.id, at]));
  return [...rows.values()].sort((a, b) => (rank.get(a.personId) ?? 0) - (rank.get(b.personId) ?? 0));
}

/** A person as a name and a role: "Briony Halvard, Medical assistant". */
export const nameAndRole = (row: { name: string; role: string }): string => (row.role === '' ? row.name : `${row.name}, ${row.role}`);

/** The line near a provider's name that lists who is with them: "With: Briony Halvard, Medical assistant". Empty when nobody is. */
export function withLine(rows: readonly { name: string; role: string }[]): string {
  if (rows.length === 0) return '';
  return `With: ${rows.map(nameAndRole).join('; ')}`;
}

/** The line near a support person's name on their printed page that lists the providers they work with: "Works with: Yusra Hollin, Physician". Empty when there are none. */
export function worksWithLine(rows: readonly { name: string; role: string }[]): string {
  if (rows.length === 0) return '';
  return `Works with: ${rows.map(nameAndRole).join('; ')}`;
}

/**
 * When one support person is with a provider, in one line. On one day it gives the times:
 * "Monday, 8:00 am to 12:00 pm and 1:00 pm to 5:00 pm". Over more days it gives the hours and the
 * days: "16 hours this week, on Tuesday and Thursday", or "40 hours this week, on 5 days".
 */
export function teamWhen(spans: readonly TeamSpan[]): string {
  const byDay = new Map<Day, string[]>();
  let minutes = 0;
  for (const span of spans) {
    byDay.set(span.day, [...(byDay.get(span.day) ?? []), clockRange(span.from, span.to)]);
    minutes += span.to - span.from;
  }
  const days = [...byDay.keys()];
  const first = days[0];
  if (first === undefined) return '';
  if (days.length === 1) return `${dayName(first)}, ${(byDay.get(first) ?? []).join(' and ')}`;
  const on = days.length === 2 ? `${dayName(first)} and ${dayName(days[1] ?? first)}` : `${days.length} days`;
  return `${lengthText(minutes)} this week, on ${on}`;
}

/**
 * The order of the people in the Day view: each provider, in the order of the people list,
 * followed by the support staff who have time with them that day. A support person with time
 * beside two providers follows the one they are with longer, and the earlier one when the time is
 * equal. Support staff with no time beside a provider that day come last, in the order of the list.
 */
export function dayOrder(s: Schedule, day: Day): string[] {
  const providers = s.people.filter((person) => person.kind !== 'support');
  const support = s.people.filter((person) => person.kind === 'support');
  const follows = new Map<string, string>();
  for (const person of support) {
    const minutes = new Map<string, number>();
    for (const block of blocksOf(s, person.id)) {
      if (block.day !== day || block.what.kind !== 'with') continue;
      minutes.set(block.what.personId, (minutes.get(block.what.personId) ?? 0) + block.minutes);
    }
    let chosen: string | undefined;
    for (const provider of providers) {
      const have = minutes.get(provider.id) ?? 0;
      if (have > 0 && (chosen === undefined || have > (minutes.get(chosen) ?? 0))) chosen = provider.id;
    }
    if (chosen !== undefined) follows.set(person.id, chosen);
  }
  const out: string[] = [];
  for (const provider of providers) {
    out.push(provider.id);
    for (const person of support) if (follows.get(person.id) === provider.id) out.push(person.id);
  }
  for (const person of support) if (!follows.has(person.id)) out.push(person.id);
  return out;
}

/** The lane each support person's strip takes at the edge of a provider's day column: one lane a person, in the order of the people list. */
export function stripLanes(s: Schedule, spans: readonly TeamSpan[]): Map<string, number> {
  const ids = new Set(spans.map((span) => span.personId));
  const lanes = new Map<string, number>();
  for (const person of s.people) if (ids.has(person.id)) lanes.set(person.id, lanes.size);
  return lanes;
}

/**
 * The quiet line under a name in the Overview: the hours at work in the week, and who the person
 * works with. "At work 45 hours. With Briony Halvard." Empty when there is nothing to say.
 */
export function overviewMore(row: { workMinutes: number | null; worksWith: readonly string[] }): string {
  const parts: string[] = [];
  if (row.workMinutes !== null) parts.push(`At work ${lengthText(row.workMinutes)}.`);
  const names = row.worksWith.filter((name) => name.trim() !== '');
  if (names.length > 0) parts.push(`With ${names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`}.`);
  return parts.join(' ');
}

/** A support person's paid hours on the week against their contract hours: a chip, and a sentence. */
export interface PaidSay {
  state: 'none' | 'met' | 'over';
  chip: string;
  note: string;
}

/** What the week says about a support person's paid hours. `short` and `over` are minutes against the contract. */
export function paidSay(contract: number, short: number, over: number): PaidSay {
  if (contract === 0) return { state: 'none', chip: 'Needs contract', note: 'Give this person contract hours in Set up to count the week against them.' };
  if (short > 0) return { state: 'none', chip: `${lengthText(short)} to plan`, note: `${lengthText(short)} of the contract has nothing planned yet.` };
  if (over > 0) return { state: 'over', chip: `${lengthText(over)} over`, note: `The week is ${lengthText(over)} over the contract.` };
  return { state: 'met', chip: 'Matches', note: 'The paid hours match the contract.' };
}

/**
 * The sentence or two that "How this works" gains: one about working hours when anybody has them,
 * and one about support staff when the schedule has any.
 */
export function howMore(anyWork: boolean, anySupport: boolean): string {
  const parts: string[] = [];
  if (anyWork) parts.push('Dotted time is outside a person’s working hours, and you can still add time there.');
  if (anySupport) parts.push('Support staff have their own weeks, and a strip at the edge of a provider’s day shows when somebody is with them.');
  return parts.join(' ');
}
