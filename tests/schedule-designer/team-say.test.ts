import { describe, expect, it } from 'vitest';
import {
  canWorkWith,
  dayFill,
  dayOrder,
  emptySupportAddSay,
  emptySupportSay,
  fillLabel,
  fillShort,
  fillStart,
  fillSay,
  howMore,
  nameAndRole,
  overviewMore,
  paidSay,
  stripLanes,
  teamRows,
  teamWhen,
  withChoices,
  withLine,
  withName,
  worksWithLine,
} from '../../src/scripts/schedule-designer/team-say';
import { firstTool, sameTool, toolFor } from '../../src/scripts/schedule-designer/state';
import { addPerson, blocksOf, clearDay, fillWith, planWith, sampleSchedule, setKind, teamOf } from '../../src/scripts/schedule-designer/engine/index';
import type { Day, Schedule, TeamSpan } from '../../src/scripts/schedule-designer/engine/index';

const idOf = (s: Schedule, name: string): string => {
  const person = s.people.find((one) => one.name === name);
  if (!person) throw new Error(`nobody is called ${name}`);
  return person.id;
};

/** The sample with one more support person, who has nothing on the week and nobody on the list. */
function withNewcomer(): { s: Schedule; id: string } {
  const base = sampleSchedule();
  const dept = base.departments[0];
  if (!dept) throw new Error('no department');
  const added = addPerson(base, { name: 'Corin Ashdown', role: 'Medical assistant', departmentId: dept.id });
  const id = idOf(added, 'Corin Ashdown');
  return { s: setKind(added, id, 'support').schedule, id };
}

describe('support staff: who a person can add time with', () => {
  it('names time beside a provider', () => {
    expect(withName('Maren Castellane')).toBe('With Maren Castellane');
    expect(withName('  ')).toBe('With a provider');
  });
  it('lists the providers on the list, in the order of the list', () => {
    const s = sampleSchedule();
    expect(withChoices(s, idOf(s, 'Emrys Tolliver')).map((choice) => choice.name)).toEqual(['Yusra Hollin', 'Linnea Farrowby']);
    expect(withChoices(s, idOf(s, 'Briony Halvard')).map((choice) => choice.name)).toEqual(['Maren Castellane']);
  });
  it('lists nobody for a provider, and for somebody who is not there', () => {
    const s = sampleSchedule();
    expect(withChoices(s, idOf(s, 'Maren Castellane'))).toEqual([]);
    expect(withChoices(s, 'nobody')).toEqual([]);
  });
  it('adds a provider the person already has time with, after the listed ones', () => {
    const s = sampleSchedule();
    const emrys = idOf(s, 'Emrys Tolliver');
    const yusra = idOf(s, 'Yusra Hollin');
    // The list loses Yusra Hollin while the blocks beside her stay.
    const cut: Schedule = { ...s, people: s.people.map((person) => (person.id === emrys ? { ...person, worksWith: person.worksWith.filter((id) => id !== yusra) } : person)) };
    expect(blocksOf(cut, emrys).some((block) => block.what.kind === 'with' && block.what.personId === yusra)).toBe(true);
    expect(withChoices(cut, emrys).map((choice) => choice.name)).toEqual(['Linnea Farrowby', 'Yusra Hollin']);
  });
  it('offers the providers who are not on the list yet', () => {
    const s = sampleSchedule();
    const can = canWorkWith(s, idOf(s, 'Briony Halvard')).map((person) => person.name);
    expect(can).toHaveLength(s.people.filter((person) => person.kind === 'provider').length - 1);
    expect(can).not.toContain('Maren Castellane');
    expect(can).not.toContain('Emrys Tolliver');
    expect(canWorkWith(s, idOf(s, 'Maren Castellane'))).toEqual([]);
  });
});

describe('support staff: the tool a person starts with', () => {
  it('starts a support person on time with the first provider on their list', () => {
    const s = sampleSchedule();
    expect(firstTool(s, idOf(s, 'Emrys Tolliver'))).toEqual({ kind: 'with', personId: idOf(s, 'Yusra Hollin') });
  });
  it('starts a support person with nobody on the list on another kind of time, never a visit type', () => {
    const { s, id } = withNewcomer();
    expect(firstTool(s, id).kind).toBe('activity');
  });
  it('starts a provider on a visit type', () => {
    const s = sampleSchedule();
    expect(firstTool(s, idOf(s, 'Maren Castellane')).kind).toBe('visit');
  });
  it('keeps time with a provider for a person who can have it, and changes it for anybody else', () => {
    const s = sampleSchedule();
    const yusra = idOf(s, 'Yusra Hollin');
    const tool = { kind: 'with', personId: yusra } as const;
    expect(toolFor(s, idOf(s, 'Emrys Tolliver'), tool)).toEqual(tool);
    expect(toolFor(s, idOf(s, 'Odalys Wren'), tool)).toEqual(tool);
    // Briony Halvard does not work with Yusra Hollin.
    expect(toolFor(s, idOf(s, 'Briony Halvard'), tool)).toEqual({ kind: 'with', personId: idOf(s, 'Maren Castellane') });
    // A provider never has time with a provider.
    expect(toolFor(s, idOf(s, 'Maren Castellane'), tool).kind).toBe('visit');
    // A provider who is gone.
    expect(toolFor(s, idOf(s, 'Emrys Tolliver'), { kind: 'with', personId: 'gone' })).toEqual(tool);
  });
  it('matches two tools for time with the same provider, and no others', () => {
    expect(sameTool({ kind: 'with', personId: 'a' }, { kind: 'with', personId: 'a' })).toBe(true);
    expect(sameTool({ kind: 'with', personId: 'a' }, { kind: 'with', personId: 'b' })).toBe(false);
    expect(sameTool({ kind: 'with', personId: 'a' }, { kind: 'activity', activityId: 'a' })).toBe(false);
    expect(sameTool({ kind: 'visit', visitTypeId: 'v' }, { kind: 'visit', visitTypeId: 'v' })).toBe(true);
    expect(sameTool({ kind: 'none' }, { kind: 'none' })).toBe(false);
  });
});

describe('support staff: the fill button and its sentence', () => {
  it('says whose patient time it fills from, and the day in the Day view', () => {
    expect(fillLabel('Maren Castellane')).toBe('Fill from Maren Castellane’s patient time');
    expect(fillLabel('Maren Castellane', 0 as Day)).toBe('Fill Monday from Maren Castellane’s patient time');
    expect(fillLabel(' ')).toBe('Fill from this provider’s patient time');
  });
  it('has a short form for the button, which names the week or the day', () => {
    expect(fillShort()).toBe('Fill the week from their patient time');
    expect(fillShort(0 as Day)).toBe('Fill Monday from their patient time');
    expect(fillStart()).toBe('Fill the week');
    expect(fillStart(2 as Day)).toBe('Fill Wednesday');
  });
  it('offers one day in the day menu only while adding time with a provider on a support week', () => {
    const s = sampleSchedule();
    const emrys = idOf(s, 'Emrys Tolliver');
    const yusra = idOf(s, 'Yusra Hollin');
    const maren = idOf(s, 'Maren Castellane');
    const tool = { kind: 'with', personId: yusra };
    expect(dayFill(s, emrys, tool, 1 as Day, true)).toEqual({ providerId: yusra, say: 'Fill Tuesday from Yusra Hollin’s patient time' });
    // Not in Look or Erase, not for another kind of time, not on a provider's own week, and not for somebody who is gone or is not a provider.
    expect(dayFill(s, emrys, tool, 1 as Day, false)).toBeNull();
    expect(dayFill(s, emrys, { kind: 'activity' }, 1 as Day, true)).toBeNull();
    expect(dayFill(s, emrys, { kind: 'with' }, 1 as Day, true)).toBeNull();
    expect(dayFill(s, maren, tool, 1 as Day, true)).toBeNull();
    expect(dayFill(s, emrys, { kind: 'with', personId: 'nobody' }, 1 as Day, true)).toBeNull();
    expect(dayFill(s, emrys, { kind: 'with', personId: emrys }, 1 as Day, true)).toBeNull();
  });
  it('fills that one day and leaves every other day as it was', () => {
    // Tuesday is cleared first, so there is room beside the provider's patient time.
    const emrys = idOf(sampleSchedule(), 'Emrys Tolliver');
    const s = clearDay(sampleSchedule(), emrys, 1 as Day);
    const maren = idOf(s, 'Maren Castellane');
    const offer = dayFill(s, emrys, { kind: 'with', personId: maren }, 1 as Day, true);
    if (!offer) throw new Error('no offer');
    const { schedule, plan } = fillWith(s, emrys, offer.providerId, 1 as Day);
    expect(plan.addMinutes).toBeGreaterThan(0);
    for (const day of s.days) {
      const before = blocksOf(s, emrys).filter((block) => block.day === day);
      const after = blocksOf(schedule, emrys).filter((block) => block.day === day);
      if (day === 1) expect(after.length).toBeGreaterThan(before.length);
      else expect(after).toEqual(before);
    }
  });
  it('says what was added and that Undo takes it off, and only then', () => {
    const { s, id } = withNewcomer();
    const maren = idOf(s, 'Maren Castellane');
    const first = fillWith(s, id, maren);
    expect(first.plan.addMinutes).toBeGreaterThan(0);
    expect(fillSay(first.plan)).toBe(`${first.plan.say} Undo takes it off again.`);
    // A second fill finds the time already there and adds nothing.
    const again = planWith(first.schedule, id, maren);
    expect(again.addMinutes).toBe(0);
    expect(fillSay(again)).toBe(again.say);
    expect(fillSay(again)).not.toContain('Undo');
  });
});

describe('support staff: an empty week', () => {
  it('points at the fill button when somebody is on the list', () => {
    const s = sampleSchedule();
    const briony = idOf(s, 'Briony Halvard');
    expect(emptySupportSay(s, briony, true, 0 as Day)).toBe('Nothing is on this week yet. To begin, choose Add. One button there fills the week from Maren Castellane’s patient time.');
    expect(emptySupportSay(s, briony, false, 2 as Day)).toBe('Nothing is on Wednesday yet. To begin, choose Add. One button there fills the day from Maren Castellane’s patient time.');
    expect(emptySupportAddSay(s, briony, false)).toBe('Use the Fill button above, or drag down a day to add time.');
    expect(emptySupportAddSay(s, briony, true)).toBe('Use the Fill button above, or press and hold on a day, then drag down to add time.');
  });
  it('says where the list is when nobody is on it', () => {
    const { s, id } = withNewcomer();
    expect(emptySupportSay(s, id, true, 0 as Day)).toBe('Nothing is on this week yet. To begin, open Set up and add the providers this person works with. Their patient time can then fill this week.');
    expect(emptySupportAddSay(s, id, false)).toBe('Nobody is on this person’s “works with” list yet. You can still drag down a day to add other time.');
  });
});

describe('support staff: who is with a provider', () => {
  it('lists the support staff with a provider in the week, in the order of the people list', () => {
    const s = sampleSchedule();
    const rows = teamRows(s, idOf(s, 'Yusra Hollin'));
    expect(rows.map((row) => row.name)).toEqual(['Emrys Tolliver', 'Odalys Wren']);
    for (const row of rows) expect(row.minutes).toBe(row.spans.reduce((sum, span) => sum + span.to - span.from, 0));
    expect(withLine(rows)).toBe('With: Emrys Tolliver, Medical assistant; Odalys Wren, Nurse care manager');
  });
  it('lists only the people with time on the day asked for', () => {
    const s = sampleSchedule();
    const yusra = idOf(s, 'Yusra Hollin');
    const odalys = idOf(s, 'Odalys Wren');
    const days = new Set(teamOf(s, yusra).filter((span) => span.personId === odalys).map((span) => span.day));
    for (const day of s.days) expect(teamRows(s, yusra, day).some((row) => row.personId === odalys)).toBe(days.has(day));
  });
  it('gives nothing for a provider with nobody, and no line', () => {
    const s = sampleSchedule();
    const alone = s.people.find((person) => person.kind === 'provider' && teamOf(s, person.id).length === 0);
    if (!alone) throw new Error('every provider has somebody');
    expect(teamRows(s, alone.id)).toEqual([]);
    expect(withLine([])).toBe('');
    expect(worksWithLine([])).toBe('');
    expect(worksWithLine(withChoices(s, idOf(s, 'Emrys Tolliver')))).toBe('Works with: Yusra Hollin, Physician; Linnea Farrowby, Nurse practitioner');
  });
  it('writes a person as a name and a role, and a name alone with no role', () => {
    expect(nameAndRole({ name: 'Briony Halvard', role: 'Medical assistant' })).toBe('Briony Halvard, Medical assistant');
    expect(nameAndRole({ name: 'Briony Halvard', role: '' })).toBe('Briony Halvard');
  });
});

describe('support staff: when somebody is with a provider', () => {
  const span = (day: number, from: number, to: number): TeamSpan => ({ personId: 'a', day: day as Day, from, to, siteId: 's' });
  it('gives the times on one day', () => {
    expect(teamWhen([span(0, 480, 720), span(0, 780, 1020)])).toBe('Monday, 8:00 am to 12:00 pm and 1:00 pm to 5:00 pm');
  });
  it('gives the hours and both days over two days', () => {
    expect(teamWhen([span(1, 480, 720), span(1, 780, 1020), span(3, 480, 720), span(3, 780, 1020)])).toBe('16 h this week, on Tuesday and Thursday');
  });
  it('gives the hours and a count of days over more', () => {
    expect(teamWhen([0, 1, 2, 3, 4].flatMap((day) => [span(day, 480, 720), span(day, 780, 1020)]))).toBe('40 h this week, on 5 days');
  });
  it('gives nothing for no time', () => {
    expect(teamWhen([])).toBe('');
  });
});

describe('support staff: the order of the Day view', () => {
  it('holds everybody once', () => {
    const s = sampleSchedule();
    for (const day of s.days) expect([...dayOrder(s, day)].sort()).toEqual(s.people.map((person) => person.id).sort());
  });
  it('puts each support person straight after the provider they are with that day', () => {
    const s = sampleSchedule();
    const kind = new Map(s.people.map((person) => [person.id, person.kind]));
    for (const day of s.days) {
      const order = dayOrder(s, day);
      let provider = '';
      let tail = false;
      order.forEach((id) => {
        if (kind.get(id) !== 'support') {
          // No provider comes after the support staff who are with nobody.
          expect(tail).toBe(false);
          provider = id;
          return;
        }
        const withProvider = blocksOf(s, id).some((block) => block.day === day && block.what.kind === 'with' && block.what.personId === provider);
        if (!withProvider) tail = true;
        if (tail) expect(blocksOf(s, id).some((block) => block.day === day && block.what.kind === 'with')).toBe(false);
      });
    }
  });
  it('keeps the providers in the order of the people list', () => {
    const s = sampleSchedule();
    const providers = s.people.filter((person) => person.kind !== 'support').map((person) => person.id);
    const first = s.days[0];
    if (first === undefined) throw new Error('no days');
    expect(dayOrder(s, first).filter((id) => providers.includes(id))).toEqual(providers);
  });
  it('puts Briony Halvard after Maren Castellane on Monday', () => {
    const s = sampleSchedule();
    const order = dayOrder(s, 0 as Day);
    expect(order.indexOf(idOf(s, 'Briony Halvard'))).toBe(order.indexOf(idOf(s, 'Maren Castellane')) + 1);
  });
  it('puts a support person with no time beside a provider that day last', () => {
    const { s, id } = withNewcomer();
    const order = dayOrder(s, 0 as Day);
    expect(order[order.length - 1]).toBe(id);
  });
  it('follows the provider a person is with longer', () => {
    const { s, id } = withNewcomer();
    const maren = idOf(s, 'Maren Castellane');
    const filled = fillWith(s, id, maren, 0 as Day).schedule;
    const order = dayOrder(filled, 0 as Day);
    const at = order.indexOf(id);
    // After Maren Castellane, beside whoever else is with her that day.
    const before = order.slice(order.indexOf(maren), at);
    expect(before[0]).toBe(maren);
    expect(before.slice(1).every((other) => filled.people.find((person) => person.id === other)?.kind === 'support')).toBe(true);
  });
});

describe('support staff: the strips at the edge of a provider’s day', () => {
  it('gives each person a lane, in the order of the people list', () => {
    const s = sampleSchedule();
    const yusra = idOf(s, 'Yusra Hollin');
    const lanes = stripLanes(s, teamOf(s, yusra));
    expect(lanes.get(idOf(s, 'Emrys Tolliver'))).toBe(0);
    expect(lanes.get(idOf(s, 'Odalys Wren'))).toBe(1);
    expect(stripLanes(s, []).size).toBe(0);
  });
});

describe('support staff: the Overview', () => {
  it('writes the hours at work and who a person works with under the name', () => {
    expect(overviewMore({ workMinutes: 2700, worksWith: ['Briony Halvard'] })).toBe('At work 45 h. With Briony Halvard.');
    expect(overviewMore({ workMinutes: 60, worksWith: [] })).toBe('At work 1 h.');
    expect(overviewMore({ workMinutes: null, worksWith: ['A', 'B'] })).toBe('With A and B.');
    expect(overviewMore({ workMinutes: null, worksWith: ['A', 'B', 'C'] })).toBe('With A, B and C.');
    expect(overviewMore({ workMinutes: null, worksWith: [] })).toBe('');
  });
  it('says how the paid hours sit against the contract', () => {
    expect(paidSay(0, 0, 0)).toEqual({ state: 'none', chip: 'Needs contract', note: 'Give this person contract hours in Set up to count the week against them.' });
    expect(paidSay(2400, 120, 0)).toEqual({ state: 'none', chip: '2 h to plan', note: '2 h of the contract has nothing planned yet.' });
    expect(paidSay(2400, 60, 0).note).toBe('1 h of the contract has nothing planned yet.');
    expect(paidSay(2400, 0, 90)).toEqual({ state: 'over', chip: '1 h 30 min over', note: 'The week is 1 h 30 min over the contract.' });
    expect(paidSay(2400, 20, 0).chip).toBe('20 min to plan');
    expect(paidSay(2400, 0, 0)).toEqual({ state: 'met', chip: 'Matches', note: 'The paid hours match the contract.' });
  });
});

describe('how this works: the sentences about working hours and support staff', () => {
  it('says each only when the schedule has it', () => {
    expect(howMore(false, false)).toBe('');
    expect(howMore(true, false)).toBe('Dotted time is outside a person’s working hours, and you can still add time there.');
    expect(howMore(false, true)).toBe('Support staff have their own weeks, and a strip at the edge of a provider’s day shows when somebody is with them.');
    expect(howMore(true, true)).toBe(`${howMore(true, false)} ${howMore(false, true)}`);
  });
});
