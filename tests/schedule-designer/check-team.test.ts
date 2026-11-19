import { describe, expect, it } from 'vitest';
import { check, type Finding } from '../../src/scripts/schedule-designer/engine/check';
import { setHours } from '../../src/scripts/schedule-designer/engine/edit';
import { addWorksWith, fillWith } from '../../src/scripts/schedule-designer/engine/team';
import type { Block, Schedule } from '../../src/scripts/schedule-designer/engine/types';
import { setWork } from '../../src/scripts/schedule-designer/engine/work';
import { NOWHERE, REMOTE, activity, block, deepFreeze, room, visit, withBlocks, withTime } from './fixtures/small';
import { team, visits, withPerson } from './fixtures/team';

const base = team();
const ELM = room('s1', null);
const ANNEX = room('s2', null);
const CONSULT = room('s2', 'r3');

const BANNED = /\b(?:highest|lowest|worst|best)\b|\btop\s/i;
const DASHES = /[—–]| - /;

/** The findings of one kind: a finding's id starts with its kind and a colon. */
const of = (s: Schedule, kind: string): Finding[] => check(s).filter((finding) => finding.id.startsWith(`${kind}:`));
/** The findings this round added. */
const NEW = ['day-off', 'off-hours', 'work-outside', 'work-contract', 'no-support', 'with-idle', 'with-site', 'with-none'];
const added = (s: Schedule): Finding[] => check(s).filter((finding) => NEW.some((kind) => finding.id.startsWith(`${kind}:`)));

const withBlock = (id: string, supportId: string, day: Block['day'], start: number, minutes: number, providerId: string, where: Block['where'] = ELM): Block => block(id, supportId, day, start, minutes, withTime(providerId), where);

/** Avery at work on Monday from 9:00 am to 4:00 pm and on Tuesday from 8:00 am to 12:00 pm and 1:00 pm to 5:00 pm. */
function hours(): Schedule {
  let s = setWork(base, 'pA', 0, [{ from: 540, to: 960 }]);
  s = setWork(s, 'pA', 1, [{ from: 480, to: 720 }, { from: 780, to: 1020 }]);
  return deepFreeze(s);
}

/** Avery's Monday: appointments at Elm Street from 8:00 am to 10:00 am and at the Annex from 1:00 pm to 3:00 pm. */
const averyMonday = (): Block[] => [...visits('m', 'pA', 0, 480, 6), ...visits('n', 'pA', 0, 780, 6, CONSULT)];

describe('Schedule Designer: checks on working hours', () => {
  it('paid time outside working hours: one finding for a person and a day, naming the hours', () => {
    // Three appointments from 8:00 am, before the 9:00 am start, and an hour of admin after the 4:00 pm end.
    const s = withBlocks(hours(), [...visits('a', 'pA', 0, 480, 3, REMOTE), ...visits('b', 'pA', 0, 600, 3, REMOTE), block('admin', 'pA', 0, 960, 60, activity('aAdmin'), ELM)]);
    expect(of(s, 'off-hours')).toEqual([
      {
        id: 'off-hours:pA:0',
        level: 'look',
        group: 'Working hours',
        say: 'Avery Quill has 2 h of paid time on Monday outside their working hours, 9:00 am to 4:00 pm. Erase it in Design and add it inside their working hours, or change the working hours in Set up.',
        personId: 'pA',
        day: 0,
        start: 480,
      },
    ]);
    expect(of(s, 'day-off')).toEqual([]);
  });

  it('counts only the part of a block that is outside', () => {
    // A 40 min appointment from 8:40 am: 20 min of it are before the 9:00 am start.
    const s = withBlocks(hours(), [block('a', 'pA', 0, 520, 40, visit('v40'), REMOTE)]);
    const [finding] = of(s, 'off-hours');
    expect(finding?.say).toBe('Avery Quill has 20 min of paid time on Monday outside their working hours, 9:00 am to 4:00 pm. Erase it in Design and add it inside their working hours, or change the working hours in Set up.');
    expect(finding?.start).toBe(520);
  });

  it('a split day: paid time in the gap is outside, and lunch there is not', () => {
    const meeting = withBlocks(hours(), [block('meet', 'pA', 1, 720, 60, activity('aMeet'), ELM)]);
    expect(of(meeting, 'off-hours')).toEqual([
      {
        id: 'off-hours:pA:1',
        level: 'look',
        group: 'Working hours',
        say: 'Avery Quill has 1 h of paid time on Tuesday outside their working hours, 8:00 am to 12:00 pm and 1:00 pm to 5:00 pm. Erase it in Design and add it inside their working hours, or change the working hours in Set up.',
        personId: 'pA',
        day: 1,
        start: 720,
      },
    ]);
    const lunch = withBlocks(hours(), [block('lunch', 'pA', 1, 720, 60, activity('aLunch'), ELM)]);
    expect(of(lunch, 'off-hours')).toEqual([]);
  });

  it('paid time on a day off', () => {
    const s = withBlocks(hours(), [block('meet', 'pA', 2, 600, 60, activity('aMeet'), ELM), ...visits('a', 'pA', 2, 660, 2, REMOTE), block('lunch', 'pA', 3, 720, 60, activity('aLunch'), ELM)]);
    expect(of(s, 'day-off')).toEqual([
      {
        id: 'day-off:pA:2',
        level: 'look',
        group: 'Working hours',
        say: 'Avery Quill has 1 h 40 min of paid time on Wednesday, which is a day off in their working hours. Erase it in Design and add it on a working day, or enter working hours for Wednesday in Set up.',
        personId: 'pA',
        day: 2,
        start: 600,
      },
    ]);
    // Lunch alone on Thursday, another day off, is not paid time.
    expect(of(s, 'off-hours')).toEqual([]);
  });

  it('says nothing about a person with no working hours entered, or a week inside them', () => {
    const none = withBlocks(base, [...visits('a', 'pA', 0, 480, 3, REMOTE), block('meet', 'pA', 2, 600, 60, activity('aMeet'), ELM)]);
    expect(added(none)).toEqual([]);
    const inside = withBlocks(hours(), [...visits('a', 'pA', 0, 540, 3, REMOTE), block('lunch', 'pA', 0, 720, 60, activity('aLunch'), ELM), block('admin', 'pA', 0, 900, 60, activity('aAdmin'), ELM)]);
    expect([...of(inside, 'off-hours'), ...of(inside, 'day-off'), ...of(inside, 'work-outside')]).toEqual([]);
    // Blake's blocks are never held against Avery's hours.
    const blake = withBlocks(hours(), [block('b', 'pB', 2, 480, 60, visit('v60'), REMOTE)]);
    expect([...of(blake, 'off-hours'), ...of(blake, 'day-off')]).toEqual([]);
  });

  it('working hours that reach outside the hours shown are said, so narrowing the hours hides nothing', () => {
    const one = setHours(setWork(base, 'pA', 0, [{ from: 480, to: 1020 }]), 540, 960);
    expect(of(one, 'work-outside')).toEqual([
      {
        id: 'work-outside:pA',
        level: 'look',
        group: 'Outside the hours shown',
        say: 'Avery Quill has working hours on Monday, 8:00 am to 5:00 pm, that reach outside the hours shown, 9:00 am to 4:00 pm. Widen the hours shown in Set up, or change the working hours.',
        personId: 'pA',
        day: 0,
        start: 480,
      },
    ]);
    const two = setHours(hours(), 540, 960);
    expect(of(two, 'work-outside')).toEqual([
      {
        id: 'work-outside:pA',
        level: 'look',
        group: 'Outside the hours shown',
        say: 'Avery Quill has working hours on Tuesday, 8:00 am to 12:00 pm and 1:00 pm to 5:00 pm, that reach outside the hours shown, 9:00 am to 4:00 pm. Widen the hours shown in Set up, or change the working hours.',
        personId: 'pA',
        day: 1,
        start: 480,
      },
    ]);
    const many = setHours(setWork(hours(), 'pA', 0, [{ from: 480, to: 1020 }]), 540, 960);
    expect(of(many, 'work-outside').map((finding) => finding.say)).toEqual([
      'Avery Quill has working hours on 2 days that reach outside the hours shown, 9:00 am to 4:00 pm. The first is Monday, 8:00 am to 5:00 pm. Widen the hours shown in Set up, or change the working hours.',
    ]);
    expect(of(hours(), 'work-outside')).toEqual([]);
  });

  it('as a note: paid hours at work that differ from the contract by more than half an hour', () => {
    // Avery's contract is 34 h. Monday to Thursday, 8:00 am to 5:00 pm, is 36 h at work.
    let s: Schedule = base;
    for (const day of [0, 1, 2, 3] as const) s = setWork(s, 'pA', day, [{ from: 480, to: 1020 }]);
    const one = withBlocks(s, visits('a', 'pA', 0, 480, 1, REMOTE));
    expect(of(one, 'work-contract')).toEqual([
      {
        id: 'work-contract:pA',
        level: 'note',
        group: 'Working hours',
        say: 'Avery Quill has 36 h of paid time in their working hours and a contract of 34 h. Change the working hours or the contract hours in Set up, or leave them if this is meant.',
        personId: 'pA',
      },
    ]);
    // An hour of lunch inside the working hours on two days is unpaid: 34 h are left, which is the contract.
    const lunches = withBlocks(s, [...visits('a', 'pA', 0, 480, 1, REMOTE), block('l0', 'pA', 0, 720, 60, activity('aLunch'), ELM), block('l1', 'pA', 1, 720, 60, activity('aLunch'), ELM)]);
    expect(of(lunches, 'work-contract')).toEqual([]);
    // One lunch leaves 35 h, an hour over.
    const lunch = withBlocks(s, [...visits('a', 'pA', 0, 480, 1, REMOTE), block('l0', 'pA', 0, 720, 60, activity('aLunch'), ELM)]);
    expect(of(lunch, 'work-contract')[0]?.say).toContain('has 35 h of paid time in their working hours and a contract of 34 h');
  });

  it('half an hour either way is close enough, and five minutes more is not', () => {
    // Monday to Wednesday 8:00 am to 5:00 pm is 27 h. Thursday makes up the rest.
    const upTo = (thursdayEnd: number): Schedule => {
      let s: Schedule = base;
      for (const day of [0, 1, 2] as const) s = setWork(s, 'pA', day, [{ from: 480, to: 1020 }]);
      s = setWork(s, 'pA', 3, [{ from: 480, to: thursdayEnd }]);
      return withBlocks(s, visits('a', 'pA', 0, 480, 1, REMOTE));
    };
    // 34 h 30 min and 33 h 30 min.
    expect(of(upTo(930), 'work-contract')).toEqual([]);
    expect(of(upTo(870), 'work-contract')).toEqual([]);
    expect(of(upTo(935), 'work-contract')[0]?.say).toContain('has 34 h 35 min of paid time');
    expect(of(upTo(865), 'work-contract')[0]?.say).toContain('has 33 h 25 min of paid time');
  });

  it('holds the note back while the week is empty', () => {
    let s: Schedule = base;
    for (const day of [0, 1] as const) s = setWork(s, 'pA', day, [{ from: 480, to: 1020 }]);
    expect(of(s, 'work-contract')).toEqual([]);
    expect(of(s, 'empty-week').map((finding) => finding.personId)).toContain('pA');
  });
});

describe('Schedule Designer: checks on care teams, from the provider\'s side', () => {
  const listed = addWorksWith(base, 'pS', 'pA');

  it('a provider someone lists, seeing patients at a site with nobody with them: one finding for the week', () => {
    // Monday morning at Elm Street and Monday afternoon at the Annex: two stretches at two sites, so no site is named.
    const s = withBlocks(listed, averyMonday());
    expect(of(s, 'no-support')).toEqual([
      {
        id: 'no-support:pA',
        level: 'look',
        group: 'Care teams',
        say: "Avery Quill sees patients on Monday for 4 h between 8:00 am and 3:00 pm with no support staff with them. Add time with Avery Quill to a support person's week in Design, or leave it if this is meant.",
        personId: 'pA',
        day: 0,
        start: 480,
        siteId: 's1',
      },
    ]);
  });

  it('one stretch in the week is said with its site and its time, and no half of the day is named', () => {
    // 6:00 pm to 7:00 pm is an evening hour.
    const evening = withBlocks(listed, visits('a', 'pA', 0, 1080, 3));
    expect(of(evening, 'no-support').map((finding) => finding.say)).toEqual([
      "Avery Quill sees patients at Elm Street on Monday from 6:00 pm to 7:00 pm with no support staff with them. Add time with Avery Quill to a support person's week in Design, or leave it if this is meant.",
    ]);
  });

  it('several days are one finding that names the days, adds up the time and shows the first', () => {
    const s = withBlocks(listed, [...visits('a', 'pA', 0, 480, 6), ...visits('b', 'pA', 2, 540, 3), ...visits('c', 'pA', 4, 780, 6)]);
    expect(of(s, 'no-support')).toEqual([
      {
        id: 'no-support:pA',
        level: 'look',
        group: 'Care teams',
        say: "Avery Quill sees patients at Elm Street on Monday, Wednesday and Friday for 5 h in all with no support staff with them. The first time is Monday at 8:00 am. Add time with Avery Quill to a support person's week in Design, or leave it if this is meant.",
        personId: 'pA',
        day: 0,
        start: 480,
        siteId: 's1',
      },
    ]);
    // Once Monday is filled, the finding shows the next day that still has nobody.
    const monday = fillWith(s, 'pS', 'pA', 0).schedule;
    expect(of(monday, 'no-support').map((finding) => [finding.day, finding.start, finding.say.includes('on Wednesday and Friday for 3 h in all')])).toEqual([[2, 540, true]]);
  });

  it('goes away once the time is filled', () => {
    const s = withBlocks(listed, averyMonday());
    expect(of(fillWith(s, 'pS', 'pA').schedule, 'no-support')).toEqual([]);
    // Any support person's time counts, listed or not.
    const other = withBlocks(listed, [...averyMonday(), withBlock('t1', 'pT', 0, 480, 120, 'pA'), withBlock('t2', 'pT', 0, 780, 120, 'pA', ANNEX)]);
    expect(of(other, 'no-support')).toEqual([]);
  });

  it('says a stretch that runs through noon as one stretch', () => {
    // 11:00 am to 1:00 pm.
    const s = withBlocks(listed, visits('a', 'pA', 3, 660, 6));
    expect(of(s, 'no-support').map((finding) => [finding.id, finding.start, finding.say.includes('on Thursday from 11:00 am to 1:00 pm')])).toEqual([['no-support:pA', 660, true]]);
  });

  it('needs 30 minutes or more with nobody in a half day', () => {
    // 8:00 am to 10:00 am, with someone there from 8:20 am: 20 min with nobody.
    const short = withBlocks(listed, [...visits('a', 'pA', 0, 480, 6), withBlock('w', 'pS', 0, 500, 100, 'pA')]);
    expect(of(short, 'no-support')).toEqual([]);
    // With someone there from 8:40 am to 9:20 am: 40 min before and 40 after.
    const pieces = withBlocks(listed, [...visits('a', 'pA', 0, 480, 6), withBlock('w', 'pS', 0, 520, 40, 'pA')]);
    expect(of(pieces, 'no-support')).toEqual([
      {
        id: 'no-support:pA',
        level: 'look',
        group: 'Care teams',
        say: "Avery Quill sees patients at Elm Street on Monday for 1 h 20 min between 8:00 am and 10:00 am with no support staff with them. Add time with Avery Quill to a support person's week in Design, or leave it if this is meant.",
        personId: 'pA',
        day: 0,
        start: 480,
        siteId: 's1',
      },
    ]);
    // Exactly 30 min with nobody is said.
    const thirty = withBlocks(listed, [...visits('a', 'pA', 0, 480, 6), withBlock('w', 'pS', 0, 510, 90, 'pA')]);
    expect(of(thirty, 'no-support').map((finding) => finding.say.includes('from 8:00 am to 8:30 am'))).toEqual([true]);
  });

  it('says nothing about a provider nobody lists, or about remote appointments', () => {
    const unlisted = withBlocks(listed, [...visits('b', 'pB', 0, 480, 6)]);
    expect(of(unlisted, 'no-support')).toEqual([]);
    expect(of(withBlocks(base, averyMonday()), 'no-support')).toEqual([]);
    const remote = withBlocks(listed, [...visits('a', 'pA', 0, 480, 6, REMOTE), ...visits('b', 'pA', 1, 480, 6, NOWHERE)]);
    expect(of(remote, 'no-support')).toEqual([]);
  });
});

describe('Schedule Designer: checks on care teams, from the support person\'s side', () => {
  it('time with a provider when the provider has no appointments at a site, 30 minutes or more', () => {
    // Avery sees patients 8:00 am to 9:00 am. Sage is with them until 10:00 am.
    const s = withBlocks(withPerson(base, 'pS', { worksWith: ['pA'] }), [...visits('a', 'pA', 0, 480, 3), withBlock('w', 'pS', 0, 480, 120, 'pA')]);
    expect(of(s, 'with-idle')).toEqual([
      {
        id: 'with-idle:pS:pA:0',
        level: 'look',
        group: 'Care teams',
        say: 'Sage Marlow has 1 h with Avery Quill on Monday when Avery Quill has no appointments at a site, starting at 9:00 am. Erase that time in Design, or add another kind of time over it.',
        personId: 'pS',
        day: 0,
        start: 540,
      },
    ]);
  });

  it('does not count less than 30 minutes, or a short gap between two appointments', () => {
    // 20 min past the last appointment.
    const short = withBlocks(withPerson(base, 'pS', { worksWith: ['pA'] }), [...visits('a', 'pA', 0, 480, 3), withBlock('w', 'pS', 0, 480, 80, 'pA')]);
    expect(of(short, 'with-idle')).toEqual([]);
    // Appointments 8:00 to 9:00 and 9:20 to 10:20: the 20 min between are part of the stretch.
    const gap = withBlocks(withPerson(base, 'pS', { worksWith: ['pA'] }), [...visits('a', 'pA', 0, 480, 3), ...visits('b', 'pA', 0, 560, 3), withBlock('w', 'pS', 0, 480, 140, 'pA')]);
    expect(of(gap, 'with-idle')).toEqual([]);
    // A gap of 40 min is not: 8:00 to 9:00 and 9:40 to 10:40.
    const wide = withBlocks(withPerson(base, 'pS', { worksWith: ['pA'] }), [...visits('a', 'pA', 0, 480, 3), ...visits('b', 'pA', 0, 580, 3), withBlock('w', 'pS', 0, 480, 160, 'pA')]);
    expect(of(wide, 'with-idle').map((finding) => [finding.start, finding.say.includes('has 40 min with Avery Quill')])).toEqual([[540, true]]);
  });

  it('counts time with a provider whose appointments are remote, or who has none that day', () => {
    const s = withBlocks(withPerson(base, 'pS', { worksWith: ['pA'] }), [...visits('a', 'pA', 0, 480, 6, REMOTE), withBlock('w0', 'pS', 0, 480, 120, 'pA'), withBlock('w1', 'pS', 1, 600, 30, 'pA')]);
    expect(of(s, 'with-idle').map((finding) => [finding.id, finding.start])).toEqual([['with-idle:pS:pA:0', 480], ['with-idle:pS:pA:1', 600]]);
    expect(of(s, 'with-idle')[0]?.say).toBe('Sage Marlow has 2 h with Avery Quill on Monday when Avery Quill has no appointments at a site, starting at 8:00 am. Erase that time in Design, or add another kind of time over it.');
  });

  it('time with a provider at one site while the provider is at another', () => {
    const s = withBlocks(withPerson(base, 'pS', { worksWith: ['pA'] }), [...visits('a', 'pA', 0, 480, 3), withBlock('w', 'pS', 0, 480, 60, 'pA', ANNEX)]);
    expect(of(s, 'with-site')).toEqual([
      {
        id: 'with-site:pS:pA:0',
        level: 'look',
        group: 'Care teams',
        say: 'Sage Marlow has time with Avery Quill on Monday at Annex from 8:00 am to 9:00 am, and Avery Quill is at Elm Street then. Erase that time in Design and add it again. Time with a provider goes where the provider is.',
        personId: 'pS',
        day: 0,
        start: 480,
        siteId: 's2',
      },
    ]);
    // The provider is covered all the same: where the time says it is, is this finding's matter alone.
    expect(of(s, 'no-support')).toEqual([]);
    expect(of(s, 'with-idle')).toEqual([]);
  });

  it('gives one such finding for a day, starting where the two first differ', () => {
    // Avery is at Elm Street until 9:00 am and at the Annex from 9:00 am. Sage is at Elm Street all morning.
    const s = withBlocks(withPerson(base, 'pS', { worksWith: ['pA'] }), [...visits('a', 'pA', 0, 480, 3), ...visits('b', 'pA', 0, 540, 3, CONSULT), ...visits('c', 'pA', 0, 600, 3, CONSULT), withBlock('w', 'pS', 0, 480, 180, 'pA')]);
    expect(of(s, 'with-site').map((finding) => [finding.id, finding.start, finding.siteId])).toEqual([['with-site:pS:pA:0', 540, 's1']]);
    expect(of(s, 'with-site')[0]?.say).toBe('Sage Marlow has time with Avery Quill on Monday at Elm Street from 8:00 am to 11:00 am, and Avery Quill is at Annex then. Erase that time in Design and add it again. Time with a provider goes where the provider is.');
  });

  it('says nothing about a site while the time has no place, or the provider is at the same site', () => {
    const s = withBlocks(withPerson(base, 'pS', { worksWith: ['pA'] }), [...visits('a', 'pA', 0, 480, 3), withBlock('w', 'pS', 0, 480, 60, 'pA', NOWHERE), withBlock('x', 'pS', 1, 480, 60, 'pA', ELM), ...visits('b', 'pA', 1, 480, 3)]);
    expect(of(s, 'with-site')).toEqual([]);
  });

  it('as a note: a provider on the list with whom the person has no time this week', () => {
    const s = withBlocks(withPerson(base, 'pS', { worksWith: ['pA', 'pB'] }), [...visits('a', 'pA', 0, 480, 3), withBlock('w', 'pS', 0, 480, 60, 'pA')]);
    expect(of(s, 'with-none')).toEqual([
      {
        id: 'with-none:pS:pB',
        level: 'note',
        group: 'Care teams',
        say: 'Sage Marlow lists Blake Rowan as someone they work with and has no time with them this week. Fill their week from the patient time of Blake Rowan in Design, or take Blake Rowan off their list in Set up.',
        personId: 'pS',
      },
    ]);
    // A person whose whole week is empty gets it too, for each provider on their list.
    const empty = withPerson(base, 'pT', { worksWith: ['pA', 'pB'] });
    expect(of(empty, 'with-none').map((finding) => finding.id)).toEqual(['with-none:pT:pA', 'with-none:pT:pB']);
  });

  it('time with a provider does not have to start on a line of the support person\'s grid', () => {
    // 8:15 am is on Blake's 15 min grid and off Sage's 20 min one.
    const s = withBlocks(withPerson(base, 'pS', { worksWith: ['pB'] }), [block('b', 'pB', 0, 495, 30, visit('v30'), CONSULT), withBlock('w', 'pS', 0, 495, 30, 'pB', ANNEX)]);
    expect(of(s, 'off-grid')).toEqual([]);
    const admin = withBlocks(s, [...s.blocks, block('admin', 'pS', 1, 495, 30, activity('aAdmin'), ELM)]);
    expect(of(admin, 'off-grid').map((finding) => finding.personId)).toEqual(['pS']);
  });

  it('says nothing about slots for support staff, and nothing about care teams for a provider with no team', () => {
    const s = withBlocks(withPerson(base, 'pS', { worksWith: ['pA'], contractHours: 0 }), [...visits('a', 'pA', 0, 480, 3), withBlock('w', 'pS', 0, 480, 60, 'pA'), ...visits('n', 'pS', 1, 480, 2, room('s1', 'r2'))]);
    const mine = check(s).filter((finding) => finding.personId === 'pS');
    expect(mine.filter((finding) => finding.group === 'Slots against target')).toEqual([]);
    expect(added(withBlocks(base, visits('a', 'pA', 0, 480, 3)))).toEqual([]);
  });
});

describe('Schedule Designer: the new findings among the others', () => {
  /** One schedule that has every new finding in it. */
  function everything(): Schedule {
    let s: Schedule = withPerson(base, 'pS', { worksWith: ['pA', 'pB'] });
    s = withPerson(s, 'pT', { worksWith: ['pA'] });
    for (const day of [0, 1, 2, 3] as const) s = setWork(s, 'pA', day, [{ from: 480, to: 1020 }]);
    s = withBlocks(s, [
      // Avery: Monday at Elm Street, Tuesday at the Annex, an hour on Friday, a day off.
      ...visits('a', 'pA', 0, 480, 6),
      ...visits('b', 'pA', 1, 480, 6, CONSULT),
      block('fri', 'pA', 4, 600, 60, activity('aAdmin'), ELM),
      // Sage: with Avery on Monday past the last appointment, and at the wrong site on Tuesday morning.
      withBlock('w0', 'pS', 0, 480, 180, 'pA'),
      withBlock('w1', 'pS', 1, 480, 60, 'pA'),
    ]);
    return deepFreeze(setHours(s, 480, 960));
  }

  it('lists them after the fixes, with the notes last', () => {
    const findings = check(everything());
    expect(added(everything()).map((finding) => [finding.level, finding.id])).toEqual([
      ['look', 'day-off:pA:4'],
      ['look', 'work-outside:pA'],
      ['look', 'no-support:pA'],
      ['look', 'with-idle:pS:pA:0'],
      ['look', 'with-site:pS:pA:1'],
      ['note', 'work-contract:pA'],
      ['note', 'with-none:pS:pB'],
      ['note', 'with-none:pT:pA'],
    ]);
    const levels = findings.map((finding) => finding.level);
    expect(levels).toEqual([...levels].sort((a, b) => ['fix', 'look', 'note'].indexOf(a) - ['fix', 'look', 'note'].indexOf(b)));
    expect(new Set(findings.map((finding) => finding.id)).size).toBe(findings.length);
  });

  it('gives each finding a person, and a day and a start where there is something to show', () => {
    for (const finding of added(everything())) {
      expect(finding.personId).toBeDefined();
      const shows = !finding.id.startsWith('work-contract:') && !finding.id.startsWith('with-none:');
      expect([finding.id, finding.day !== undefined, finding.start !== undefined]).toEqual([finding.id, shows, shows]);
    }
  });

  it('writes each one in plain words, with no word or dash the site does not allow', () => {
    const says = added(everything()).map((finding) => finding.say);
    expect(says).toHaveLength(8);
    for (const say of says) {
      expect(say).not.toMatch(BANNED);
      expect(say).not.toMatch(DASHES);
      expect(say).not.toMatch(/\bpaint|palette\b/i);
      expect(say).toMatch(/^[A-Z].*\.$/);
    }
  });

  it('gives the same findings every time, and does not change the schedule', () => {
    const s = everything();
    expect(check(s)).toEqual(check(s));
  });
});
