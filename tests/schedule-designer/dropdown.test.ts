import { describe, expect, it } from 'vitest';
import { PAGE, dropKey, groupsOf, isTyped, placeList, typedMatch } from '../../src/scripts/schedule-designer/dropdown-keys';
import { KIND_GROUP, peopleInOrder, personChoices } from '../../src/scripts/schedule-designer/people-say';
import { addPerson, sampleSchedule, setKind } from '../../src/scripts/schedule-designer/engine/index';

describe('the dropdown: what a key does while the list is closed', () => {
  it('opens on the present choice with Enter, Space, Down and Up', () => {
    for (const key of ['Enter', ' ', 'ArrowDown', 'ArrowUp']) expect(dropKey(key, false, 3, 10)).toEqual({ act: 'open', at: 3 });
  });
  it('opens on the first choice with Home and the last with End', () => {
    expect(dropKey('Home', false, 3, 10)).toEqual({ act: 'open', at: 0 });
    expect(dropKey('End', false, 3, 10)).toEqual({ act: 'open', at: 9 });
  });
  it('does nothing for Esc, Tab and the page keys', () => {
    for (const key of ['Escape', 'Tab', 'PageDown', 'PageUp', 'ArrowLeft', 'F2']) expect(dropKey(key, false, 3, 10)).toEqual({ act: 'none' });
  });
  it('opens on a choice that exists when the present one is out of range', () => {
    expect(dropKey('Enter', false, -1, 4)).toEqual({ act: 'open', at: 0 });
    expect(dropKey('Enter', false, 99, 4)).toEqual({ act: 'open', at: 3 });
  });
});

describe('the dropdown: what a key does while the list is open', () => {
  it('moves one choice with the arrows and stops at the ends', () => {
    expect(dropKey('ArrowDown', true, 3, 10)).toEqual({ act: 'move', at: 4 });
    expect(dropKey('ArrowUp', true, 3, 10)).toEqual({ act: 'move', at: 2 });
    expect(dropKey('ArrowDown', true, 9, 10)).toEqual({ act: 'move', at: 9 });
    expect(dropKey('ArrowUp', true, 0, 10)).toEqual({ act: 'move', at: 0 });
  });
  it('goes to the ends with Home and End', () => {
    expect(dropKey('Home', true, 5, 10)).toEqual({ act: 'move', at: 0 });
    expect(dropKey('End', true, 5, 10)).toEqual({ act: 'move', at: 9 });
  });
  it('moves a page at a time and stops at the ends', () => {
    expect(dropKey('PageDown', true, 1, 30)).toEqual({ act: 'move', at: 1 + PAGE });
    expect(dropKey('PageUp', true, 20, 30)).toEqual({ act: 'move', at: 20 - PAGE });
    expect(dropKey('PageDown', true, 28, 30)).toEqual({ act: 'move', at: 29 });
    expect(dropKey('PageUp', true, 2, 30)).toEqual({ act: 'move', at: 0 });
  });
  it('chooses with Enter and Space, and only then', () => {
    expect(dropKey('Enter', true, 4, 10)).toEqual({ act: 'choose', at: 4 });
    expect(dropKey(' ', true, 4, 10)).toEqual({ act: 'choose', at: 4 });
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp', 'Escape', 'Tab', 'a']) expect(dropKey(key, true, 4, 10).act).not.toBe('choose');
  });
  it('closes with Esc and lets Tab move on', () => {
    expect(dropKey('Escape', true, 4, 10)).toEqual({ act: 'close' });
    expect(dropKey('Tab', true, 4, 10)).toEqual({ act: 'leave' });
  });
  it('with no choices, only Esc does anything, and only when open', () => {
    expect(dropKey('Enter', false, 0, 0)).toEqual({ act: 'none' });
    expect(dropKey('ArrowDown', true, 0, 0)).toEqual({ act: 'none' });
    expect(dropKey('Escape', true, 0, 0)).toEqual({ act: 'close' });
  });
});

describe('the dropdown: typing a few letters', () => {
  const names = ['Maren Castellane', 'Dalia Pemberthy', 'Osric Vandermeer', 'Tobin Achterberg', 'Dorian Vale', 'Sunniva Kell', 'Sable Orr'];
  it('reads a key that types one character, and not Space or a named key', () => {
    expect(isTyped('a')).toBe(true);
    expect(isTyped('9')).toBe(true);
    expect(isTyped(' ')).toBe(false);
    expect(isTyped('Enter')).toBe(false);
  });
  it('finds the first name that starts with the letters, whatever the capitals', () => {
    expect(typedMatch(names, 'to', 0)).toBe(3);
    expect(typedMatch(names, 'DO', 0)).toBe(4);
    expect(typedMatch(names, 'su', 0)).toBe(5);
  });
  it('stays on the present choice when it already starts with the letters', () => {
    expect(typedMatch(names, 'da', 1)).toBe(1);
    expect(typedMatch(names, 'do', 4)).toBe(4);
  });
  it('steps through the names that start with one letter typed again', () => {
    expect(typedMatch(names, 'd', 0)).toBe(1);
    expect(typedMatch(names, 'd', 1)).toBe(4);
    expect(typedMatch(names, 'dd', 1)).toBe(4);
    expect(typedMatch(names, 'd', 4)).toBe(1);
    expect(typedMatch(names, 's', 5)).toBe(6);
    expect(typedMatch(names, 's', 6)).toBe(5);
  });
  it('gives -1 when no name starts with the letters, or nothing was typed', () => {
    expect(typedMatch(names, 'x', 0)).toBe(-1);
    expect(typedMatch(names, 'dz', 0)).toBe(-1);
    expect(typedMatch(names, '', 0)).toBe(-1);
    expect(typedMatch([], 'a', 0)).toBe(-1);
  });
  it('finds times by their first figures', () => {
    const times = ['6:00 am', '7:00 am', '8:00 am', '9:00 am', '10:00 am', '11:00 am', '12:00 pm', '1:00 pm'];
    expect(typedMatch(times, '9', 0)).toBe(3);
    expect(typedMatch(times, '1', 0)).toBe(4);
    expect(typedMatch(times, '11', 4)).toBe(5);
    expect(typedMatch(times, '12', 0)).toBe(6);
  });
});

describe('the dropdown: headings', () => {
  it('cuts the choices into runs that share a heading, in order, keeping each place in the list', () => {
    const runs = groupsOf([
      { value: 'a', say: 'A', group: 'One' },
      { value: 'b', say: 'B', group: 'One' },
      { value: 'c', say: 'C', group: 'Two' },
    ]);
    expect(runs.map((run) => run.group)).toEqual(['One', 'Two']);
    expect(runs.map((run) => run.items.map((item) => item.index))).toEqual([[0, 1], [2]]);
  });
  it('gives one run with no heading when no choice has one', () => {
    const runs = groupsOf([
      { value: 'a', say: 'A' },
      { value: 'b', say: 'B' },
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.group).toBe('');
  });
});

describe('the dropdown: where the list goes', () => {
  const win = { width: 1366, height: 768 };
  it('opens under the button and lines up with its left edge', () => {
    const spot = placeList({ left: 400, top: 20, bottom: 56, width: 208 }, { width: 240, height: 300 }, win);
    expect(spot.top).toBe(62);
    expect(spot.bottom).toBeNull();
    expect(spot.left).toBe(400);
    expect(spot.minWidth).toBe(208);
    expect(spot.maxHeight).toBe(352);
  });
  it('opens above the button when there is little room below and more above', () => {
    const spot = placeList({ left: 400, top: 640, bottom: 676, width: 208 }, { width: 240, height: 300 }, win);
    expect(spot.top).toBeNull();
    expect(spot.bottom).toBe(768 - 640 + 6);
    expect(spot.maxHeight).toBe(352);
  });
  it('stays under the button when a short list fits there', () => {
    const spot = placeList({ left: 400, top: 640, bottom: 676, width: 208 }, { width: 240, height: 70 }, win);
    expect(spot.top).toBe(682);
  });
  it('is never taller than the room it has', () => {
    const spot = placeList({ left: 400, top: 300, bottom: 336, width: 208 }, { width: 240, height: 900 }, { width: 1366, height: 560 });
    expect(spot.top).toBe(342);
    expect(spot.maxHeight).toBe(560 - 336 - 6 - 8);
  });
  it('is pulled in from the right edge, and is never wider than the window', () => {
    const spot = placeList({ left: 1250, top: 20, bottom: 56, width: 100 }, { width: 300, height: 200 }, win);
    expect(spot.left).toBe(1366 - 8 - 300);
    const narrow = placeList({ left: 20, top: 20, bottom: 56, width: 600 }, { width: 900, height: 200 }, { width: 500, height: 800 });
    expect(narrow.left).toBe(8);
    expect(narrow.minWidth).toBe(484);
  });
});

describe('the person picker', () => {
  it('lists providers and then support staff under two headings, with the role as the quiet line', () => {
    const s = sampleSchedule();
    const choices = personChoices(s);
    expect(choices).toHaveLength(s.people.length);
    const groups = choices.map((choice) => choice.group);
    expect(new Set(groups)).toEqual(new Set([KIND_GROUP.provider, KIND_GROUP.support]));
    // Every provider comes before every support person.
    expect(groups.lastIndexOf(KIND_GROUP.provider)).toBeLessThan(groups.indexOf(KIND_GROUP.support));
    const briony = choices.find((choice) => choice.say === 'Briony Halvard');
    expect(briony?.group).toBe('Support staff');
    expect(briony?.note).toBe('Medical assistant');
    expect(choices.filter((choice) => choice.group === 'Support staff').map((choice) => choice.say)).toEqual(['Briony Halvard', 'Emrys Tolliver', 'Odalys Wren']);
  });
  it('keeps list order inside each kind, and the arrows step in the same order', () => {
    const s = sampleSchedule();
    const order = peopleInOrder(s).map((person) => person.id);
    expect(order).toEqual(personChoices(s).map((choice) => choice.value));
    expect(order.slice(0, 8)).toEqual(s.people.filter((person) => person.kind === 'provider').map((person) => person.id));
  });
  it('puts a support person who was added first after the providers', () => {
    let s = sampleSchedule();
    const first = s.people[0];
    if (!first) throw new Error('no people');
    s = setKind(s, first.id, 'support').schedule;
    const choices = personChoices(s);
    expect(choices[choices.length - 4]?.group).toBe('Support staff');
    expect(choices.find((choice) => choice.value === first.id)?.group).toBe('Support staff');
    expect(choices[0]?.group).toBe('Providers');
  });
  it('has no headings when nobody is support staff, and no quiet line for an empty role', () => {
    let s = sampleSchedule();
    for (const person of s.people.filter((one) => one.kind === 'support')) s = setKind(s, person.id, 'provider').schedule;
    const dept = s.departments[0];
    if (!dept) throw new Error('no department');
    s = addPerson(s, { name: 'Nobody Special', role: '  ', departmentId: dept.id });
    const choices = personChoices(s);
    expect(choices.every((choice) => choice.group === undefined)).toBe(true);
    expect(choices.find((choice) => choice.say === 'Nobody Special')?.note).toBeUndefined();
  });
});

describe('the dropdown: a list with headings may be taller', () => {
  it('takes the height it is given when there is room, and no more than the room', () => {
    const button = { left: 356, top: 20, bottom: 56, width: 168 };
    expect(placeList(button, { width: 180, height: 580 }, { width: 1366, height: 768 }, 608).maxHeight).toBe(608);
    expect(placeList(button, { width: 180, height: 580 }, { width: 1366, height: 768 }).maxHeight).toBe(352);
    expect(placeList(button, { width: 180, height: 580 }, { width: 1366, height: 500 }, 608).maxHeight).toBe(500 - 56 - 6 - 8);
  });
});
