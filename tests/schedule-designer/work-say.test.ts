import { describe, expect, it } from 'vitest';
import { NO_WORK_SAY, firstRow, hoursLike, limitsOf, offAfter, offKind, offSay, offShort, plannedOutside, splitOf, timeChoices, timeSay, usualDay, workFigures, workRows, workWeekSay } from '../../src/scripts/schedule-designer/work-say';
import { blocksOf, clearWork, endOf, sampleSchedule, setHours, setWork } from '../../src/scripts/schedule-designer/engine/index';
import type { Day, Schedule } from '../../src/scripts/schedule-designer/engine/index';

const MON = 0 as Day;
const TUE = 1 as Day;
const WED = 2 as Day;
const FRI = 4 as Day;

/** The sample with one person's working hours cleared and then entered by the test. */
function withHours(build: (s: Schedule, id: string) => Schedule): { s: Schedule; id: string; name: string } {
  const sample = sampleSchedule();
  const person = sample.people[0];
  if (!person) throw new Error('no people');
  return { s: build(clearWork(sample, person.id), person.id), id: person.id, name: person.name };
}

describe('working hours in Set up: the rows of a week', () => {
  it('has no rows while nothing is entered, and a sentence that says what that means', () => {
    const { s, id } = withHours((s) => s);
    expect(workRows(s, id)).toEqual([]);
    expect(NO_WORK_SAY).toMatch(/^No working hours are entered\./);
  });
  it('has a row for each shown day: one stretch, a split day and a day off', () => {
    const { s, id } = withHours((s, id) => {
      let next = setWork(s, id, MON, [{ from: 480, to: 1020 }]);
      next = setWork(next, id, TUE, [{ from: 480, to: 720 }, { from: 780, to: 1020 }]);
      return next;
    });
    const rows = workRows(s, id);
    expect(rows.map((row) => row.name)).toEqual(s.days.map((_, at) => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][at]));
    expect(rows[0]).toMatchObject({ off: false, stretches: [{ from: 480, to: 1020 }] });
    expect(rows[1]?.stretches).toHaveLength(2);
    expect(rows[2]).toMatchObject({ off: true, stretches: [] });
  });
});

describe('working hours in Set up: the times a picker offers', () => {
  it('offers every quarter hour between two times and says Midnight for the end of the day', () => {
    const choices = timeChoices(480, 540, 480);
    expect(choices.map((choice) => choice.say)).toEqual(['8:00 am', '8:15 am', '8:30 am', '8:45 am', '9:00 am']);
    expect(timeSay(1440)).toBe('Midnight');
    expect(timeChoices(1380, 1440, 1440).at(-1)).toEqual({ value: '1440', say: 'Midnight' });
  });
  it('keeps a time that is not on a quarter hour, in its place', () => {
    const choices = timeChoices(480, 540, 505);
    expect(choices.map((choice) => choice.value)).toEqual(['480', '495', '505', '510', '525', '540']);
  });
  it('keeps a stretch from ending before it starts, and two stretches from meeting', () => {
    expect(limitsOf([{ from: 480, to: 1020 }])).toEqual([{ from: [0, 1005], to: [495, 1440] }]);
    const two = limitsOf([{ from: 480, to: 720 }, { from: 780, to: 1020 }]);
    expect(two[0]).toEqual({ from: [0, 705], to: [495, 765] });
    expect(two[1]).toEqual({ from: [735, 1005], to: [795, 1440] });
  });
});

describe('working hours in Set up: splitting a day', () => {
  it('splits a day that runs through the middle of the day around 12:00 pm to 1:00 pm', () => {
    expect(splitOf({ from: 480, to: 1020 })).toEqual([{ from: 480, to: 720 }, { from: 780, to: 1020 }]);
  });
  it('gives a morning a second stretch an hour later, as long as the first', () => {
    expect(splitOf({ from: 480, to: 720 })).toEqual([{ from: 480, to: 720 }, { from: 780, to: 1020 }]);
    expect(splitOf({ from: 420, to: 480 })).toEqual([{ from: 420, to: 480 }, { from: 540, to: 600 }]);
  });
  it('makes the second stretch no longer than four hours and keeps it inside the day', () => {
    expect(splitOf({ from: 360, to: 700 })).toEqual([{ from: 360, to: 700 }, { from: 760, to: 1000 }]);
    expect(splitOf({ from: 1080, to: 1320 })).toEqual([{ from: 1080, to: 1320 }, { from: 1380, to: 1440 }]);
  });
  it('puts the second stretch before the first when the day has no room after it, and gives nothing with no room either side', () => {
    expect(splitOf({ from: 1200, to: 1440 })).toEqual([{ from: 900, to: 1140 }, { from: 1200, to: 1440 }]);
    expect(splitOf({ from: 60, to: 1400 })).toEqual([{ from: 60, to: 720 }, { from: 780, to: 1400 }]);
    expect(splitOf({ from: 0, to: 1440 })).toEqual([{ from: 0, to: 720 }, { from: 780, to: 1440 }]);
    expect(splitOf({ from: 800, to: 1440 })).toEqual([{ from: 500, to: 740 }, { from: 800, to: 1440 }]);
    expect(splitOf({ from: 60, to: 1400 - 0 })).not.toBeNull();
    expect(splitOf({ from: 100, to: 1380 })).not.toBeNull();
  });
});

describe('working hours in Set up: the hours a day starts with', () => {
  it('starts at 8:00 am to 5:00 pm, kept inside the hours shown', () => {
    const s = sampleSchedule();
    expect(usualDay(s)).toEqual({ from: 480, to: 1020 });
    expect(usualDay(setHours(s, 540, 960))).toEqual({ from: 540, to: 960 });
  });
  it('gives a day off the hours of the nearest working day before it, then after it, then the usual day', () => {
    const { s, id } = withHours((s, id) => setWork(setWork(s, id, MON, [{ from: 420, to: 900 }]), id, FRI, [{ from: 600, to: 1080 }]));
    expect(hoursLike(s, id, TUE)).toEqual([{ from: 420, to: 900 }]);
    expect(hoursLike(s, id, WED)).toEqual([{ from: 420, to: 900 }]);
    const later = withHours((s, id) => setWork(s, id, FRI, [{ from: 600, to: 1080 }]));
    expect(hoursLike(later.s, later.id, MON)).toEqual([{ from: 600, to: 1080 }]);
    const none = withHours((s) => s);
    expect(hoursLike(none.s, none.id, MON)).toEqual([{ from: 480, to: 1020 }]);
  });
});

describe('working hours in Set up: the line under the rows', () => {
  it('gives the hours at work beside the contract hours', () => {
    expect(workWeekSay(2400, 2400, 2400)).toBe('40 h at work in the week. The contract is 40 h.');
  });
  it('says how much of the time at work is unpaid time, and what that leaves', () => {
    expect(workWeekSay(2700, 2400, 2400)).toBe('45 h at work in the week: 40 h paid and 5 h unpaid, such as lunch. The contract is 40 h.');
    expect(workWeekSay(1260, 1200, 1200)).toBe('21 h at work in the week: 20 h paid and 1 h unpaid, such as lunch. The contract is 20 h.');
  });
});

describe('Add outside working hours', () => {
  const made = withHours((s, id) => setWork(setWork(s, id, MON, [{ from: 480, to: 720 }, { from: 780, to: 1020 }]), id, TUE, [{ from: 480, to: 1020 }]));
  it('says nothing inside working hours, and nothing while none are entered', () => {
    expect(offKind(made.s, made.id, MON, 480, 500)).toBe('inside');
    expect(offSay(made.s, made.id, MON, 480, 500)).toBe('');
    expect(offShort('inside')).toBe('');
    expect(offAfter(made.s, made.id, MON, 480, 500)).toBe('');
    const none = withHours((s) => s);
    expect(offKind(none.s, none.id, MON, 300, 320)).toBe('inside');
    expect(offSay(none.s, none.id, WED, 300, 320)).toBe('');
  });
  it('says when the time is outside working hours, names the hours, and says adding is still allowed', () => {
    expect(offKind(made.s, made.id, MON, 440, 460)).toBe('outside');
    expect(offSay(made.s, made.id, MON, 440, 460)).toBe('Outside working hours. You can still add time here.');
    expect(offShort('outside')).toBe('outside working hours');
    expect(offAfter(made.s, made.id, MON, 440, 460)).toBe(' That is outside their working hours.');
  });
  it('counts a stretch that is only partly outside, and the gap of a split day', () => {
    expect(offKind(made.s, made.id, MON, 460, 500)).toBe('outside');
    expect(offKind(made.s, made.id, MON, 720, 740)).toBe('outside');
    expect(offKind(made.s, made.id, TUE, 720, 740)).toBe('inside');
  });
  it('says a day off is a day off', () => {
    expect(offKind(made.s, made.id, WED, 540, 560)).toBe('day-off');
    expect(offSay(made.s, made.id, WED, 540, 560)).toBe('Wednesday is a day off. You can still add time here.');
    expect(offShort('day-off')).toBe('on a day off');
    expect(offAfter(made.s, made.id, WED, 540, 560)).toBe(' Wednesday is a day off in their working hours.');
  });
});

describe('the tally beside the week and the first row', () => {
  it('gives at work, scheduled and open, and nothing while no working hours are entered', () => {
    expect(workFigures(2700, 45)).toEqual({ work: 2700, scheduled: 2655, open: 45 });
    expect(workFigures(null, null)).toBeNull();
  });
  it('opens a day one hour above the earlier of the first working minute and the first block', () => {
    expect(firstRow({ from: 480, to: 1020 })).toBe(420);
    expect(firstRow({ from: 450, to: 1020 })).toBe(360);
    expect(firstRow(null)).toBeNull();
  });
});

describe('the working hours card: time planned outside working hours', () => {
  it('is nothing while no working hours are entered, and nothing when every block is inside them', () => {
    const cleared = withHours((s) => s);
    expect(plannedOutside(cleared.s, cleared.id)).toBe(0);
    const sample = sampleSchedule();
    const first = sample.people[0];
    if (!first) throw new Error('no people');
    expect(plannedOutside(sample, first.id)).toBe(0);
  });
  it('counts every planned minute of a day that becomes a day off, and the part of a block past the end of a day', () => {
    const sample = sampleSchedule();
    const person = sample.people[0];
    if (!person) throw new Error('no people');
    const monday = blocksOf(sample, person.id).filter((block) => block.day === MON);
    const planned = monday.reduce((sum, block) => sum + block.minutes, 0);
    expect(planned).toBeGreaterThan(0);
    expect(plannedOutside(setWork(sample, person.id, MON, []), person.id)).toBe(planned);
    // The day now ends at noon: what is planned after noon is outside, and a block across noon counts in part.
    const after = monday.reduce((sum, block) => sum + Math.max(0, endOf(block) - Math.max(block.start, 720)), 0);
    expect(after).toBeGreaterThan(0);
    const first = Math.min(...monday.map((block) => block.start));
    expect(plannedOutside(setWork(sample, person.id, MON, [{ from: Math.min(first, 480), to: 720 }]), person.id)).toBe(after);
  });
});
