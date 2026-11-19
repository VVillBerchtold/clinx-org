// The few words that say why a week's slots and its appointments are two different numbers.
import { describe, expect, it } from 'vitest';
import { slotNote } from '../../src/scripts/schedule-designer/slots';
import { sampleSchedule, tallyPerson } from '../../src/scripts/schedule-designer/engine/index';

describe('Schedule Designer: slots beside appointments', () => {
  const s = sampleSchedule();
  const named = (name: string) => {
    const person = s.people.find((one) => one.name === name);
    if (!person) throw new Error(`the sample has no ${name}`);
    return person;
  };

  it('says how long a slot is and what a longer visit counts as, where the two numbers differ', () => {
    const maren = named('Maren Castellane');
    const tally = tallyPerson(s, maren.id);
    expect([tally?.slots.actual, tally?.week.appointments]).toEqual([93, 88]);
    expect(slotNote(s, maren.id)).toBe('A slot is 20 min, so a 40 min visit counts as 2 slots.');
  });

  it('says nothing for support staff, for a person who is not there, or when the numbers are the same', () => {
    expect(slotNote(s, named('Briony Halvard').id)).toBe('');
    expect(slotNote(s, 'nobody')).toBe('');
    for (const person of s.people) {
      const tally = tallyPerson(s, person.id);
      if (tally && tally.kind !== 'support' && tally.slots.actual === tally.week.appointments) expect(slotNote(s, person.id)).toBe('');
    }
  });

  it('is a plain sentence for every provider in the sample', () => {
    for (const person of s.people) {
      const say = slotNote(s, person.id);
      if (say !== '') expect(say).toMatch(/^A slot is [\d.]+ (min|h)( \d+ min)?(, so a [\d h]+(min|h) visit counts as [\d.]+ slots?| of patient care)\.$/);
    }
  });
});
