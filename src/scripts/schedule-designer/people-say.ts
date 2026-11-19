// Small decisions about people that the page makes with no page in hand: how the person picker
// lists them, and the order the arrows beside it step through.
import type { Schedule } from './engine/index';
import type { Choice } from './dropdown-keys';

/** The headings the person picker uses. */
export const KIND_GROUP = { provider: 'Providers', support: 'Support staff' } as const;

/** The people in the order the picker shows them: providers first, then support staff, each in list order. */
export function peopleInOrder(s: Schedule): Schedule['people'] {
  return [...s.people.filter((person) => person.kind !== 'support'), ...s.people.filter((person) => person.kind === 'support')];
}

/**
 * The person picker's choices. Each carries the role as its quiet second line. The two headings
 * show only when the schedule has support staff, so a list of providers alone has no heading.
 */
export function personChoices(s: Schedule): Choice[] {
  const grouped = s.people.some((person) => person.kind === 'support');
  return peopleInOrder(s).map((person) => {
    const choice: Choice = { value: person.id, say: person.name };
    if (person.role.trim() !== '') choice.note = person.role.trim();
    if (grouped) choice.group = KIND_GROUP[person.kind === 'support' ? 'support' : 'provider'];
    return choice;
  });
}
