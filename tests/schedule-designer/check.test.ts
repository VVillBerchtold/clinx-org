import { describe, expect, it } from 'vitest';
import { check, type Finding } from '../../src/scripts/schedule-designer/engine/check';
import { addPerson, paint, setAsideHours, setDepartmentStandards, setHours, setPerson, setStep, setTolerance } from '../../src/scripts/schedule-designer/engine/edit';
import type { Day, Schedule } from '../../src/scripts/schedule-designer/engine/types';
import { NOWHERE, REMOTE, activity, block, deepFreeze, room, small, visit, withBlocks } from './fixtures/small';

const base = small();
const EXAM1 = room('s1', 'r1');
const EXAM2 = room('s1', 'r2');

/** Avery's week with `count` twenty-minute appointments, at most 24 a day from 8:00 am. */
function weekOf(count: number): Schedule {
  let s: Schedule = base;
  for (let day = 0, left = count; left > 0; day++, left -= 24) s = paint(s, { personId: 'pA', day: day as Day, from: 480, to: 480 + Math.min(24, left) * 20, what: visit('v20'), where: REMOTE });
  return s;
}

/** The findings of one kind: a finding's id starts with its kind and a colon. */
const of = (s: Schedule, kind: string): Finding[] => check(s).filter((finding) => finding.id.startsWith(`${kind}:`));

describe('Schedule Designer: checks that ask for a fix', () => {
  it('two people in one room at once', () => {
    const s = withBlocks(base, [block('a1', 'pA', 1, 540, 20, visit('v20'), EXAM1), block('a2', 'pA', 1, 560, 20, visit('v20'), EXAM1), block('b1', 'pB', 1, 540, 60, visit('v60'), EXAM1)]);
    expect(of(s, 'clash')).toEqual([
      {
        id: 'clash:r1:1:540',
        level: 'fix',
        group: 'Room clashes',
        say: 'Avery Quill and Blake Rowan are both in Exam 1 at Elm Street on Tuesday from 9:00 am to 9:40 am. Give one of them another room. In Design, choose Add, pick the room in Where and add their time there again.',
        personId: 'pA',
        day: 1,
        start: 540,
        siteId: 's1',
        roomId: 'r1',
      },
    ]);
  });

  it('three people in one room at once', () => {
    const three = deepFreeze(addPerson(base, { name: 'Casey Lund' }));
    const pC = three.people[2]?.id ?? '';
    const s = withBlocks(three, [block('a1', 'pA', 1, 540, 20, visit('v20'), EXAM1), block('b1', 'pB', 1, 540, 30, visit('v30'), EXAM1), block('c1', pC, 1, 540, 20, visit('v20'), EXAM1)]);
    expect(of(s, 'clash')[0]?.say).toBe('Avery Quill, Blake Rowan and Casey Lund are all in Exam 1 at Elm Street on Tuesday from 9:00 am to 9:20 am. Give all but one of them another room. In Design, choose Add, pick the room in Where and add their time there again.');
  });

  it('does not report people sharing a room for the same meeting', () => {
    const s = withBlocks(base, [block('a1', 'pA', 1, 540, 60, activity('aMeet'), EXAM1), block('b1', 'pB', 1, 540, 60, activity('aMeet'), EXAM1)]);
    expect(of(s, 'clash')).toEqual([]);
  });
});

describe('Schedule Designer: checks worth a look', () => {
  it('patient care on site with no room, once for a person, a day and a site', () => {
    let s = paint(base, { personId: 'pA', day: 0, from: 540, to: 600, what: visit('v20'), where: room('s1', null) });
    s = paint(s, { personId: 'pA', day: 0, from: 600, to: 620, what: visit('v20'), where: room('s2', null) });
    s = paint(s, { personId: 'pA', day: 0, from: 620, to: 680, what: activity('aAdmin'), where: room('s1', null) });
    expect(of(s, 'no-room').map((f) => [f.level, f.group, f.say, f.personId, f.day, f.start])).toEqual([
      ['look', 'Appointments with no room', 'Avery Quill has 3 appointments at Elm Street on Monday with no room. In Design, choose Add, pick a room in Where and add them again.', 'pA', 0, 540],
      ['look', 'Appointments with no room', 'Avery Quill has 1 appointment at Annex on Monday with no room. In Design, choose Add, pick a room in Where and add it again.', 'pA', 0, 600],
    ]);
  });

  it('an appointment with no place at all', () => {
    const s = paint(base, { personId: 'pA', day: 2, from: 540, to: 580, what: visit('v20'), where: NOWHERE });
    expect(of(s, 'no-place').map((f) => [f.level, f.say])).toEqual([['look', 'Avery Quill has 2 appointments on Wednesday with no place. In Design, choose Add, pick a room or Remote in Where and add them again.']]);
    expect(of(s, 'no-room')).toEqual([]);
  });

  it('slots under target, with how many to add', () => {
    // 79 twenty-minute appointments at 3 slots an hour. Avery's contract is 34 h with 6 set aside, so the target is 84 slots.
    const s = weekOf(79);
    expect(of(s, 'slots-under')).toEqual([
      {
        id: 'slots-under:pA',
        level: 'look',
        group: 'Slots against target',
        say: 'Avery Quill has 79 slots planned and the target is 84. Add 5 slots, or change their contract hours or clinical factor in Set up.',
        personId: 'pA',
      },
    ]);
    expect(of(setAsideHours(s, 'pA', 'aAdmin', 5.5), 'slots-under')[0]?.say).toBe('Avery Quill has 79 slots planned and the target is 80. Add 1 slot, or change their contract hours or clinical factor in Set up.');
    expect(of(setAsideHours(s, 'pA', 'aAdmin', 6), 'slots-under')).toEqual([]);
    expect(of(s, 'slots-over')).toEqual([]);
    // The care factor moves the target: 34 x 0.8 - 6 is 21.2 h, 64 slots, so the same week is now over.
    expect(of(setDepartmentStandards(s, 'd1', { careFactor: 0.8 }), 'slots-under')).toEqual([]);
  });

  it('slots over target, with how many to take out', () => {
    const s = weekOf(87);
    expect(of(s, 'slots-over')).toEqual([
      {
        id: 'slots-over:pA',
        level: 'look',
        group: 'Slots against target',
        say: 'Avery Quill has 87 slots planned and the target is 84. Take out 3 slots, or change their contract hours or clinical factor in Set up.',
        personId: 'pA',
      },
    ]);
    expect(of(weekOf(85), 'slots-over')[0]?.say).toBe('Avery Quill has 85 slots planned and the target is 84. Take out 1 slot, or change their contract hours or clinical factor in Set up.');
    expect(of(s, 'slots-under')).toEqual([]);
    expect(of(weekOf(84), 'slots-over').concat(of(weekOf(84), 'slots-under'))).toEqual([]);
    // Part of a slot is said as it is: 87 visits at 4 an hour are 116 slots against 112.
    expect(of(setPerson(s, 'pA', { slotsPerHour: 4 }), 'slots-over')[0]?.say).toBe('Avery Quill has 116 slots planned and the target is 112. Take out 4 slots, or change their contract hours or clinical factor in Set up.');
    expect(of(setPerson(weekOf(1), 'pA', { slotsPerHour: 4, contractHours: 6.25 }), 'slots-over')[0]?.say).toBe('Avery Quill has 1.3 slots planned and the target is 1. Take out 0.3 slots, or change their contract hours or clinical factor in Set up.');
  });

  it('says what the tolerance allows, and holds its tongue inside it', () => {
    expect(of(setTolerance(weekOf(79), 5), 'slots-under')).toEqual([]);
    expect(of(setTolerance(weekOf(87), 3), 'slots-over')).toEqual([]);
    expect(of(setTolerance(weekOf(79), 2), 'slots-under')[0]?.say).toBe('Avery Quill has 79 slots planned and the target is 84. Add 5 slots, or change their contract hours or clinical factor in Set up. A week within 2 slots of its target counts as on target.');
    expect(of(setTolerance(weekOf(87), 1), 'slots-over')[0]?.say).toBe('Avery Quill has 87 slots planned and the target is 84. Take out 3 slots, or change their contract hours or clinical factor in Set up. A week within 1 slot of its target counts as on target.');
  });

  it('a ramping person gets a note with the numbers and no verdict', () => {
    const s = setPerson(weekOf(40), 'pA', { ramping: true });
    expect(of(s, 'ramping')).toEqual([
      {
        id: 'ramping:pA',
        level: 'note',
        group: 'Slots against target',
        say: 'Avery Quill is marked as ramping, so their 40 slots planned are not held to the target of 84. Take the mark off in Set up once they carry a whole week.',
        personId: 'pA',
      },
    ]);
    expect(of(s, 'slots-under')).toEqual([]);
    expect(of(setPerson(weekOf(1), 'pA', { ramping: true }), 'ramping')[0]?.say).toContain('their 1 slot planned are not held');
    // Ramping comes first, even over the target, and with a week still empty there is nothing to say.
    expect(of(setPerson(weekOf(87), 'pA', { ramping: true }), 'slots-over')).toEqual([]);
    expect(of(setPerson(base, 'pA', { ramping: true }), 'ramping')).toEqual([]);
  });

  it('a person with no contract hours needs them before there is a target', () => {
    const none = setPerson(base, 'pA', { contractHours: 0 });
    const wanted = [
      {
        id: 'needs-contract:pA',
        level: 'look',
        group: 'Slots against target',
        say: 'Avery Quill has no contract hours, so there is no slot target for their week. Enter their contract hours in Set up.',
        personId: 'pA',
      },
    ];
    // Said for an empty week too, since the contract is asked for in Set up before any painting.
    expect(of(none, 'needs-contract')).toEqual(wanted);
    expect(of(setPerson(weekOf(10), 'pA', { contractHours: 0 }), 'needs-contract')).toEqual(wanted);
    expect(of(setPerson(weekOf(10), 'pA', { contractHours: 0 }), 'slots-over')).toEqual([]);
    expect(of(base, 'needs-contract')).toEqual([]);
    // A ramping person is not asked for anything yet.
    expect(of(setPerson(none, 'pA', { ramping: true }), 'needs-contract')).toEqual([]);
  });

  it('a week with other time and no patient care needs appointments', () => {
    const s = paint(base, { personId: 'pA', day: 0, from: 480, to: 600, what: activity('aAdmin'), where: NOWHERE });
    expect(of(s, 'needs-schedule')).toEqual([
      {
        id: 'needs-schedule:pA',
        level: 'look',
        group: 'Slots against target',
        say: 'Avery Quill has no patient care planned and the target is 84 slots. Add appointments to their week in Design.',
        personId: 'pA',
      },
    ]);
    expect(of(s, 'slots-under')).toEqual([]);
    // No target, nothing to ask for.
    expect(of(setAsideHours(s, 'pA', 'aAdmin', 40), 'needs-schedule')).toEqual([]);
  });

  it('does not report slots for a person whose week is still empty', () => {
    expect(check(base).filter((finding) => finding.group === 'Slots against target')).toEqual([]);
    expect(check(base).some((finding) => finding.id.startsWith('under-target:'))).toBe(false);
  });

  it('paid hours over contract', () => {
    let s = setPerson(base, 'pA', { contractHours: 8 });
    s = paint(s, { personId: 'pA', day: 0, from: 480, to: 720, what: activity('aAdmin'), where: NOWHERE });
    s = paint(s, { personId: 'pA', day: 0, from: 720, to: 780, what: activity('aLunch'), where: NOWHERE });
    s = paint(s, { personId: 'pA', day: 0, from: 780, to: 1050, what: activity('aAdmin'), where: NOWHERE });
    expect(of(s, 'over-contract').map((f) => [f.level, f.group, f.say, f.personId])).toEqual([
      ['look', 'Paid hours', 'Avery Quill has 8 h 30 min of paid time planned and the contract is 8 h. Take out 30 min, or raise the contract hours in Set up.', 'pA'],
    ]);
    expect(of(setPerson(s, 'pA', { contractHours: 8.5 }), 'over-contract')).toEqual([]);
  });

  it('an activity on the week for less or more time than is set aside for it, with both numbers', () => {
    // Avery has 4 h set aside for admin and 2 for meetings.
    let s = paint(base, { personId: 'pA', day: 0, from: 780, to: 980, what: activity('aAdmin'), where: NOWHERE });
    s = paint(s, { personId: 'pA', day: 2, from: 780, to: 930, what: activity('aMeet'), where: NOWHERE });
    expect(of(s, 'set-aside')).toEqual([
      {
        id: 'set-aside:pA:aAdmin',
        level: 'look',
        group: 'Set-aside hours',
        say: 'Avery Quill has 3 h 20 min of Admin time scheduled and 4 h set aside for it. Add 40 min, or change the hours set aside in Set up.',
        personId: 'pA',
        day: 0,
        start: 780,
      },
      {
        id: 'set-aside:pA:aMeet',
        level: 'look',
        group: 'Set-aside hours',
        say: 'Avery Quill has 2 h 30 min of Meeting scheduled and 2 h set aside for it. Take out 30 min, or change the hours set aside in Set up.',
        personId: 'pA',
        day: 2,
        start: 780,
      },
    ]);
  });

  it('says so when none of a set-aside activity is on the week, and nothing when the time matches', () => {
    let s = paint(base, { personId: 'pA', day: 0, from: 780, to: 1020, what: activity('aAdmin'), where: NOWHERE });
    expect(of(s, 'set-aside')).toEqual([
      { id: 'set-aside:pA:aMeet', level: 'look', group: 'Set-aside hours', say: 'Avery Quill has no Meeting scheduled and 2 h set aside for it. Add 2 h, or change the hours set aside in Set up.', personId: 'pA' },
    ]);
    s = paint(s, { personId: 'pA', day: 1, from: 780, to: 900, what: activity('aMeet'), where: NOWHERE });
    expect(of(s, 'set-aside')).toEqual([]);
    // A person whose week is still empty gets the note about that, not a line for each allowance.
    expect(of(base, 'set-aside')).toEqual([]);
  });

  it('hours set aside for an unpaid activity', () => {
    const s = setAsideHours(base, 'pA', 'aLunch', 2.5);
    expect(of(s, 'set-aside-unpaid')).toEqual([
      {
        id: 'set-aside-unpaid:pA:aLunch',
        level: 'look',
        group: 'Set-aside hours',
        say: 'Avery Quill has 2 h 30 min set aside for Lunch, which is unpaid time. Set-aside hours come out of the contract hours, so take this line out or mark Lunch as paid in Set up.',
        personId: 'pA',
      },
    ]);
    // The unpaid line is not also compared with the week.
    const withLunch = paint(s, { personId: 'pA', day: 0, from: 720, to: 780, what: activity('aLunch'), where: NOWHERE });
    expect(of(withLunch, 'set-aside').map((f) => f.id)).toEqual(['set-aside:pA:aAdmin', 'set-aside:pA:aMeet']);
    expect(of(withLunch, 'set-aside-unpaid').length).toBe(1);
  });

  it('time outside the hours the grid shows', () => {
    let s = paint(base, { personId: 'pA', day: 3, from: 440, to: 500, what: visit('v20'), where: REMOTE });
    s = paint(s, { personId: 'pA', day: 3, from: 1000, to: 1040, what: visit('v40'), where: REMOTE });
    s = paint(s, { personId: 'pB', day: 3, from: 1020, to: 1080, what: activity('aAdmin'), where: NOWHERE });
    expect(of(s, 'outside').map((f) => [f.level, f.group, f.say, f.personId, f.day, f.start])).toEqual([
      ['look', 'Outside the hours shown', 'Avery Quill has 3 appointments on Thursday outside the hours shown, 8:00 am to 5:00 pm. Widen the hours in Set up to see them. To change the time, erase them in Design and add them again.', 'pA', 3, 440],
      ['look', 'Outside the hours shown', 'Blake Rowan has other time on Thursday outside the hours shown, 8:00 am to 5:00 pm. Widen the hours in Set up to see it. To change the time, erase it in Design and add it again.', 'pB', 3, 1020],
    ]);
    expect(of(setHours(s, 420, 1080), 'outside')).toEqual([]);
  });

  it('more than five hours of paid time with no break of 20 minutes', () => {
    // 8:00 to 1:20 with only a 10 min gap: five hours and twenty minutes without a real break.
    let s = paint(base, { personId: 'pA', day: 0, from: 480, to: 600, what: visit('v20'), where: REMOTE });
    s = paint(s, { personId: 'pA', day: 0, from: 610, to: 800, what: activity('aAdmin'), where: NOWHERE });
    expect(of(s, 'no-break').map((f) => [f.level, f.group, f.say, f.personId, f.day, f.start])).toEqual([
      ['look', 'Breaks', 'Avery Quill has paid time on Monday from 8:00 am to 1:20 pm with no break of 20 min. Add a break, such as lunch.', 'pA', 0, 480],
    ]);
  });

  it('exactly five hours is fine, and so is a longer day with a 20 minute break or an unpaid lunch', () => {
    const five = paint(base, { personId: 'pA', day: 0, from: 480, to: 780, what: activity('aAdmin'), where: NOWHERE });
    expect(of(five, 'no-break')).toEqual([]);
    let gap = paint(base, { personId: 'pA', day: 0, from: 480, to: 720, what: activity('aAdmin'), where: NOWHERE });
    gap = paint(gap, { personId: 'pA', day: 0, from: 740, to: 1020, what: activity('aAdmin'), where: NOWHERE });
    expect(of(gap, 'no-break')).toEqual([]);
    const lunch = paint(paint(five, { personId: 'pA', day: 0, from: 780, to: 800, what: activity('aLunch'), where: NOWHERE }), { personId: 'pA', day: 0, from: 800, to: 1020, what: activity('aAdmin'), where: NOWHERE });
    expect(of(lunch, 'no-break')).toEqual([]);
    // A 15 min lunch is not a break of 20 min.
    const short = paint(paint(five, { personId: 'pA', day: 0, from: 780, to: 795, what: activity('aLunch'), where: NOWHERE }), { personId: 'pA', day: 0, from: 795, to: 1020, what: activity('aAdmin'), where: NOWHERE });
    expect(of(short, 'no-break').length).toBe(1);
  });
});

describe('Schedule Designer: checks that are only a note', () => {
  it('a person with an empty week', () => {
    expect(of(base, 'empty-week').map((f) => [f.level, f.group, f.say, f.personId])).toEqual([
      ['note', 'Empty weeks', 'Avery Quill has nothing planned this week. Build their week in Design, or remove them in Set up.', 'pA'],
      ['note', 'Empty weeks', 'Blake Rowan has nothing planned this week. Build their week in Design, or remove them in Set up.', 'pB'],
    ]);
  });

  it('blocks off the grid, with the switch that would fix them', () => {
    // Appointments painted on a 20 min grid, then the grid switched to 15 min.
    const painted = paint(base, { personId: 'pA', day: 1, from: 480, to: 600, what: visit('v20'), where: REMOTE });
    expect(of(painted, 'off-grid')).toEqual([]);
    const switched = setStep(painted, 'pA', 15);
    expect(of(switched, 'off-grid')).toEqual([
      {
        id: 'off-grid:pA',
        level: 'note',
        group: 'Off the grid',
        say: 'Avery Quill has 4 blocks of time that do not start on a line of their 15 min grid, the first on Tuesday at 8:20 am. Switch their grid to 20 min in Design and they will fit.',
        personId: 'pA',
        day: 1,
        start: 500,
      },
    ]);
  });

  it('a block off both grids gets the other advice', () => {
    const s = withBlocks(base, [block('a1', 'pA', 4, 485, 20, visit('v20'), REMOTE)]);
    expect(of(s, 'off-grid')[0]?.say).toBe('Avery Quill has 1 block of time that does not start on a line of their 20 min grid, on Friday at 8:05 am. Add it again in Design so it starts on a line, or leave it if the time is meant.');
  });

  it('a room nobody uses', () => {
    const s = paint(base, { personId: 'pA', day: 0, from: 480, to: 500, what: visit('v20'), where: EXAM1 });
    expect(of(s, 'unused-room').map((f) => [f.level, f.group, f.say, f.siteId, f.roomId])).toEqual([
      ['note', 'Rooms not used', 'Exam 2 at Elm Street is not used this week. Pick it in Where when you add time in Design, or remove it in Set up.', 's1', 'r2'],
      ['note', 'Rooms not used', 'Consult at Annex is not used this week. Pick it in Where when you add time in Design, or remove it in Set up.', 's2', 'r3'],
    ]);
  });

  it('a visit type nobody uses', () => {
    let s = paint(base, { personId: 'pA', day: 0, from: 480, to: 500, what: visit('v20'), where: EXAM1 });
    s = paint(s, { personId: 'pB', day: 0, from: 480, to: 540, what: visit('v60'), where: EXAM2 });
    s = paint(s, { personId: 'pB', day: 0, from: 540, to: 570, what: visit('v30'), where: EXAM2 });
    expect(of(s, 'unused-type').map((f) => [f.level, f.group, f.say])).toEqual([['note', 'Visit types not used', 'New patient in Primary care is not used this week. Add some in Design, or remove it in Set up.']]);
  });
});

describe('Schedule Designer: the list of findings as a whole', () => {
  let s = paint(base, { personId: 'pA', day: 1, from: 540, to: 600, what: visit('v20'), where: EXAM1 });
  s = paint(s, { personId: 'pB', day: 1, from: 540, to: 600, what: visit('v60'), where: EXAM1 });
  s = paint(s, { personId: 'pB', day: 2, from: 400, to: 460, what: visit('v60'), where: room('s2', null) });
  const findings = check(s);

  it('puts fixes first, then things to look at, then notes', () => {
    const levels = findings.map((f) => f.level);
    expect(levels).toEqual([...levels].sort((a, b) => ['fix', 'look', 'note'].indexOf(a) - ['fix', 'look', 'note'].indexOf(b)));
    expect(new Set(levels)).toEqual(new Set(['fix', 'look', 'note']));
  });

  it('gives every finding its own id', () => {
    expect(new Set(findings.map((f) => f.id)).size).toBe(findings.length);
  });

  it('writes plain sentences with none of the words the site bans and no dashes', () => {
    for (const finding of findings) {
      expect(finding.say, finding.id).toMatch(/^[A-Z].*\.$/);
      expect(finding.say, finding.id).not.toMatch(/\b(?:highest|lowest|worst|best)\b|\btop\s/i);
      expect(finding.say, finding.id).not.toMatch(/[—–]| - |undefined|NaN/);
      expect(finding.group, finding.id).not.toMatch(/\b(?:highest|lowest|worst|best)\b|\btop\s|[—–]/i);
    }
  });

  it('finds nothing to fix or look at in an empty schedule with no people', () => {
    const empty: Schedule = { ...base, people: [], sites: [], departments: [], blocks: [] };
    expect(check(empty)).toEqual([]);
  });
});
