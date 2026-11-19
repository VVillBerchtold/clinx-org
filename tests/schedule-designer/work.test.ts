import { describe, expect, it } from 'vitest';
import { duplicatePerson, setDays, setHours } from '../../src/scripts/schedule-designer/engine/edit';
import { personOf } from '../../src/scripts/schedule-designer/engine/find';
import { tallyPerson } from '../../src/scripts/schedule-designer/engine/tally';
import type { Schedule, WorkStretch } from '../../src/scripts/schedule-designer/engine/types';
import { LIMITS } from '../../src/scripts/schedule-designer/engine/types';
import {
  blocksOutsideWork,
  clearWork,
  copyWork,
  dayExtent,
  hasWork,
  insideWork,
  isDayOff,
  offHours,
  openSpans,
  outsideWork,
  setWork,
  spanMinutes,
  spansInside,
  spansLess,
  unpaidInsideWork,
  weekExtent,
  workMinutes,
  workMinutesOn,
  workOn,
  workOutsideHours,
  workText,
} from '../../src/scripts/schedule-designer/engine/work';
import { REMOTE, activity, block, deepFreeze, room, small, visit, withBlocks } from './fixtures/small';
import { visits, withPerson } from './fixtures/team';

const base = small();
const workOf = (s: Schedule, personId: string): WorkStretch[] => personOf(s, personId)?.work ?? [];

/** Avery at work Monday 8:00 am to 5:00 pm, Tuesday 8:00 am to 12:00 pm and 1:00 pm to 5:00 pm, with Wednesday to Friday off. */
function entered(): Schedule {
  let s = setWork(base, 'pA', 0, [{ from: 480, to: 1020 }]);
  s = setWork(s, 'pA', 1, [{ from: 480, to: 720 }, { from: 780, to: 1020 }]);
  return deepFreeze(s);
}

describe('Schedule Designer: arithmetic on stretches of time', () => {
  it('takes stretches out of others, and keeps what lies inside others', () => {
    expect(spansLess([{ from: 480, to: 720 }], [{ from: 540, to: 600 }])).toEqual([{ from: 480, to: 540 }, { from: 600, to: 720 }]);
    expect(spansLess([{ from: 480, to: 720 }], [{ from: 600, to: 660 }, { from: 400, to: 500 }, { from: 650, to: 800 }])).toEqual([{ from: 500, to: 600 }]);
    expect(spansLess([{ from: 480, to: 720 }], [])).toEqual([{ from: 480, to: 720 }]);
    expect(spansLess([{ from: 480, to: 720 }], [{ from: 480, to: 720 }])).toEqual([]);
    expect(spansLess([{ from: 480, to: 720 }], [{ from: 720, to: 780 }, { from: 420, to: 480 }])).toEqual([{ from: 480, to: 720 }]);
    expect(spansInside([{ from: 480, to: 720 }], [{ from: 400, to: 500 }, { from: 700, to: 800 }])).toEqual([{ from: 480, to: 500 }, { from: 700, to: 720 }]);
    expect(spansInside([{ from: 480, to: 720 }], [{ from: 720, to: 800 }])).toEqual([]);
    expect(spanMinutes([{ from: 480, to: 500 }, { from: 700, to: 720 }])).toBe(40);
    expect(spanMinutes([])).toBe(0);
  });
});

describe('Schedule Designer: setting a day\'s working hours', () => {
  it('sets one stretch, and working hours then count as entered', () => {
    expect(hasWork(base, 'pA')).toBe(false);
    const s = setWork(base, 'pA', 0, [{ from: 480, to: 1020 }]);
    expect(workOf(s, 'pA')).toEqual([{ day: 0, from: 480, to: 1020 }]);
    expect(hasWork(s, 'pA')).toBe(true);
    expect(hasWork(s, 'pB')).toBe(false);
    expect(workOf(base, 'pA')).toEqual([]);
  });

  it('gives back the very same schedule when nothing changes', () => {
    const s = setWork(base, 'pA', 0, [{ from: 480, to: 1020 }]);
    expect(setWork(s, 'pA', 0, [{ from: 480, to: 1020 }])).toBe(s);
    expect(setWork(base, 'pA', 0, [])).toBe(base);
    expect(setWork(base, 'nobody', 0, [{ from: 480, to: 1020 }])).toBe(base);
    expect(setWork(base, 'pA', 6, [{ from: 480, to: 1020 }])).toBe(base);
    expect(setWork(base, 'pA', 0, [{ from: Number.NaN, to: 1020 }])).toBe(base);
    expect(setWork(base, 'pA', 0, [{ from: 480, to: Number.POSITIVE_INFINITY }])).toBe(base);
  });

  it('rounds each time to five minutes and drops a stretch that ends where it starts', () => {
    expect(workOf(setWork(base, 'pA', 0, [{ from: 482, to: 1018 }]), 'pA')).toEqual([{ day: 0, from: 480, to: 1020 }]);
    expect(workOf(setWork(base, 'pA', 0, [{ from: 543, to: 601 }]), 'pA')).toEqual([{ day: 0, from: 545, to: 600 }]);
    expect(setWork(base, 'pA', 0, [{ from: 600, to: 601 }])).toBe(base);
    expect(setWork(base, 'pA', 0, [{ from: 700, to: 600 }])).toBe(base);
    expect(workOf(setWork(base, 'pA', 0, [{ from: 600, to: 600 }, { from: 540, to: 660 }]), 'pA')).toEqual([{ day: 0, from: 540, to: 660 }]);
  });

  it('a split day: two stretches, kept in time order whatever order they came in', () => {
    const s = setWork(base, 'pA', 1, [{ from: 780, to: 1020 }, { from: 480, to: 720 }]);
    expect(workOf(s, 'pA')).toEqual([{ day: 1, from: 480, to: 720 }, { day: 1, from: 780, to: 1020 }]);
    expect(workOn(s, 'pA', 1)).toEqual([{ from: 480, to: 720 }, { from: 780, to: 1020 }]);
    expect(workText(s, 'pA', 1)).toBe('8:00 am to 12:00 pm and 1:00 pm to 5:00 pm');
  });

  it('makes one stretch of two that overlap or touch', () => {
    expect(workOf(setWork(base, 'pA', 0, [{ from: 480, to: 720 }, { from: 720, to: 1020 }]), 'pA')).toEqual([{ day: 0, from: 480, to: 1020 }]);
    expect(workOf(setWork(base, 'pA', 0, [{ from: 480, to: 800 }, { from: 700, to: 1020 }]), 'pA')).toEqual([{ day: 0, from: 480, to: 1020 }]);
    // Three stretches that come down to two are taken.
    expect(workOf(setWork(base, 'pA', 0, [{ from: 480, to: 600 }, { from: 600, to: 720 }, { from: 780, to: 1020 }]), 'pA')).toEqual([{ day: 0, from: 480, to: 720 }, { day: 0, from: 780, to: 1020 }]);
  });

  it('refuses a third stretch in one day', () => {
    expect(LIMITS.workStretchesPerDay).toBe(2);
    const s = setWork(base, 'pA', 0, [{ from: 480, to: 720 }, { from: 780, to: 1020 }]);
    expect(setWork(s, 'pA', 0, [{ from: 480, to: 600 }, { from: 660, to: 720 }, { from: 780, to: 1020 }])).toBe(s);
    expect(setWork(base, 'pA', 0, [{ from: 480, to: 600 }, { from: 660, to: 720 }, { from: 780, to: 1020 }])).toBe(base);
  });

  it('replaces only the day it names, and keeps the list in day order', () => {
    let s = setWork(base, 'pA', 2, [{ from: 480, to: 1020 }]);
    s = setWork(s, 'pA', 0, [{ from: 540, to: 900 }]);
    s = setWork(s, 'pA', 2, [{ from: 600, to: 960 }]);
    expect(workOf(s, 'pA')).toEqual([{ day: 0, from: 540, to: 900 }, { day: 2, from: 600, to: 960 }]);
    expect(workOf(s, 'pB')).toEqual([]);
  });

  it('a day off: a day with no stretch once any day has one', () => {
    const s = entered();
    expect(isDayOff(s, 'pA', 0)).toBe(false);
    expect(isDayOff(s, 'pA', 2)).toBe(true);
    expect(workOn(s, 'pA', 2)).toEqual([]);
    expect(workText(s, 'pA', 2)).toBe('Day off');
    // Taking a day's stretches away makes it a day off.
    const off = setWork(s, 'pA', 0, []);
    expect(isDayOff(off, 'pA', 0)).toBe(true);
    expect(workOf(off, 'pA')).toEqual([{ day: 1, from: 480, to: 720 }, { day: 1, from: 780, to: 1020 }]);
    // A day the schedule does not show is never a day off, and nobody has one before hours are entered.
    expect(isDayOff(s, 'pA', 6)).toBe(false);
    expect(isDayOff(s, 'pB', 2)).toBe(false);
    expect(isDayOff(s, 'nobody', 2)).toBe(false);
  });

  it('taking away the only day with a stretch leaves working hours not entered', () => {
    const s = setWork(base, 'pA', 0, [{ from: 480, to: 1020 }]);
    const cleared = setWork(s, 'pA', 0, []);
    expect(workOf(cleared, 'pA')).toEqual([]);
    expect(hasWork(cleared, 'pA')).toBe(false);
    expect(isDayOff(cleared, 'pA', 0)).toBe(false);
  });

  it('a stretch outside the hours shown widens them to the whole hour', () => {
    // The small schedule shows 8:00 am to 5:00 pm.
    const early = setWork(base, 'pA', 0, [{ from: 430, to: 960 }]);
    expect([early.dayStart, early.dayEnd]).toEqual([420, 1020]);
    expect(workOf(early, 'pA')).toEqual([{ day: 0, from: 430, to: 960 }]);
    const late = setWork(base, 'pA', 0, [{ from: 600, to: 1110 }]);
    expect([late.dayStart, late.dayEnd]).toEqual([480, 1140]);
    const both = setWork(base, 'pA', 0, [{ from: 420, to: 720 }, { from: 780, to: 1140 }]);
    expect([both.dayStart, both.dayEnd]).toEqual([420, 1140]);
    const edges = setWork(base, 'pA', 0, [{ from: 0, to: 1440 }]);
    expect([edges.dayStart, edges.dayEnd]).toEqual([0, 1440]);
    // A stretch inside the hours shown leaves them alone.
    const inside = setWork(base, 'pA', 0, [{ from: 480, to: 1020 }]);
    expect([inside.dayStart, inside.dayEnd]).toEqual([480, 1020]);
    // Everything else in the schedule is the same object as before.
    expect(early.blocks).toBe(base.blocks);
    expect(early.sites).toBe(base.sites);
  });

  it('moves the first hour shown back by whole hours, so the grid lines stay where they are', () => {
    const halfPast = deepFreeze({ ...base, dayStart: 510 });
    const s = setWork(halfPast, 'pA', 0, [{ from: 440, to: 900 }]);
    expect(s.dayStart).toBe(390);
    // When a whole hour back would pass midnight, the hours shown start at the stretch's own hour.
    const nearMidnight = deepFreeze({ ...base, dayStart: 30 });
    expect(setWork(nearMidnight, 'pA', 0, [{ from: 10, to: 600 }]).dayStart).toBe(0);
  });

  it('widens the hours shown even when the stretches are the ones already kept', () => {
    const s = setWork(base, 'pA', 0, [{ from: 420, to: 960 }]);
    const narrow = setHours(s, 480, 1020);
    expect(narrow.dayStart).toBe(480);
    const again = setWork(narrow, 'pA', 0, [{ from: 420, to: 960 }]);
    expect(again.dayStart).toBe(420);
    expect(workOf(again, 'pA')).toEqual([{ day: 0, from: 420, to: 960 }]);
  });
});

describe('Schedule Designer: copying and clearing working hours', () => {
  it('copies one day onto others, replacing what they had', () => {
    const s = entered();
    const copied = copyWork(s, 'pA', 1, [0, 2, 4]);
    expect(workOf(copied, 'pA')).toEqual([
      { day: 0, from: 480, to: 720 },
      { day: 0, from: 780, to: 1020 },
      { day: 1, from: 480, to: 720 },
      { day: 1, from: 780, to: 1020 },
      { day: 2, from: 480, to: 720 },
      { day: 2, from: 780, to: 1020 },
      { day: 4, from: 480, to: 720 },
      { day: 4, from: 780, to: 1020 },
    ]);
    expect(isDayOff(copied, 'pA', 3)).toBe(true);
    expect(workOf(s, 'pA')).toHaveLength(3);
  });

  it('copying a day off makes the others days off too', () => {
    const s = entered();
    const copied = copyWork(s, 'pA', 2, [0, 3]);
    expect(workOf(copied, 'pA')).toEqual([{ day: 1, from: 480, to: 720 }, { day: 1, from: 780, to: 1020 }]);
  });

  it('skips the day itself, a day named twice and a day the schedule does not show', () => {
    const s = entered();
    expect(copyWork(s, 'pA', 0, [0])).toBe(s);
    expect(copyWork(s, 'pA', 0, [6, 5])).toBe(s);
    expect(copyWork(s, 'pA', 0, [])).toBe(s);
    expect(copyWork(s, 'pA', 6, [0, 1])).toBe(s);
    expect(copyWork(s, 'nobody', 0, [1])).toBe(s);
    expect(workOf(copyWork(s, 'pA', 0, [3, 3, 0, 6]), 'pA').filter((stretch) => stretch.day === 3)).toEqual([{ day: 3, from: 480, to: 1020 }]);
    // Copying onto days that already hold the same hours changes nothing.
    const same = copyWork(s, 'pA', 0, [3]);
    expect(copyWork(same, 'pA', 0, [3])).toBe(same);
    expect(copyWork(base, 'pA', 0, [1, 2])).toBe(base);
  });

  it('clears a person\'s working hours and leaves their blocks alone', () => {
    const s = withBlocks(entered(), visits('a', 'pA', 0, 480, 3));
    const cleared = clearWork(s, 'pA');
    expect(workOf(cleared, 'pA')).toEqual([]);
    expect(hasWork(cleared, 'pA')).toBe(false);
    expect(cleared.blocks).toBe(s.blocks);
    expect(clearWork(cleared, 'pA')).toBe(cleared);
    expect(clearWork(s, 'pB')).toBe(s);
    expect(clearWork(s, 'nobody')).toBe(s);
  });
});

describe('Schedule Designer: reading working hours', () => {
  it('counts the minutes at work on a day and in the week, and gives nothing while none are entered', () => {
    const s = entered();
    expect(workMinutesOn(s, 'pA', 0)).toBe(540);
    expect(workMinutesOn(s, 'pA', 1)).toBe(480);
    expect(workMinutesOn(s, 'pA', 2)).toBe(0);
    expect(workMinutes(s, 'pA')).toBe(1020);
    expect(workMinutes(s, 'pB')).toBeNull();
    expect(workMinutesOn(s, 'pB', 0)).toBeNull();
    expect(workMinutes(s, 'nobody')).toBeNull();
    expect(workOn(s, 'nobody', 0)).toEqual([]);
  });

  it('counts only the days the schedule shows', () => {
    // A stretch on Saturday, written by hand, while the schedule shows Monday to Friday.
    const s = withPerson(base, 'pA', { work: [{ day: 0, from: 480, to: 1020 }, { day: 5, from: 480, to: 720 }] });
    expect(workMinutes(s, 'pA')).toBe(540);
  });

  it('says whether a stretch of time is inside working hours', () => {
    const s = entered();
    expect(insideWork(s, 'pA', 0, 480, 1020)).toBe(true);
    expect(insideWork(s, 'pA', 0, 600, 620)).toBe(true);
    expect(insideWork(s, 'pA', 0, 460, 500)).toBe(false);
    expect(insideWork(s, 'pA', 0, 1000, 1040)).toBe(false);
    // A split day: the gap between the two stretches is outside.
    expect(insideWork(s, 'pA', 1, 700, 720)).toBe(true);
    expect(insideWork(s, 'pA', 1, 700, 740)).toBe(false);
    expect(insideWork(s, 'pA', 1, 720, 780)).toBe(false);
    expect(insideWork(s, 'pA', 1, 780, 800)).toBe(true);
    // A day off: nothing is inside.
    expect(insideWork(s, 'pA', 2, 600, 620)).toBe(false);
    // While no working hours are entered there is nothing to be outside of.
    expect(insideWork(s, 'pB', 0, 0, 1440)).toBe(true);
  });

  it('gives the parts of a stretch that lie outside working hours', () => {
    const s = entered();
    expect(outsideWork(s, 'pA', 0, 420, 1080)).toEqual([{ from: 420, to: 480 }, { from: 1020, to: 1080 }]);
    expect(outsideWork(s, 'pA', 1, 700, 800)).toEqual([{ from: 720, to: 780 }]);
    expect(outsideWork(s, 'pA', 0, 600, 660)).toEqual([]);
    expect(outsideWork(s, 'pA', 2, 600, 660)).toEqual([{ from: 600, to: 660 }]);
    expect(outsideWork(s, 'pB', 0, 0, 1440)).toEqual([]);
    expect(outsideWork(s, 'pA', 0, 660, 600)).toEqual([]);
  });

  it('gives the hours to shade: the hours shown less the working hours', () => {
    const wide = deepFreeze(setHours(entered(), 420, 1080));
    expect(offHours(wide, 'pA', 0)).toEqual([{ from: 420, to: 480 }, { from: 1020, to: 1080 }]);
    expect(offHours(wide, 'pA', 1)).toEqual([{ from: 420, to: 480 }, { from: 720, to: 780 }, { from: 1020, to: 1080 }]);
    // A day off shades the whole of the hours shown.
    expect(offHours(wide, 'pA', 2)).toEqual([{ from: 420, to: 1080 }]);
    // Nothing is shaded while no working hours are entered.
    expect(offHours(wide, 'pB', 0)).toEqual([]);
    expect(offHours(entered(), 'pA', 0)).toEqual([]);
  });

  it('lists the blocks of paid time outside working hours, and never lunch', () => {
    const s = withBlocks(setHours(entered(), 420, 1080), [
      block('early', 'pA', 0, 440, 60, activity('aAdmin'), room('s1', null)),
      block('in', 'pA', 0, 600, 20, visit('v20'), room('s1', 'r1')),
      block('late', 'pA', 0, 1020, 20, visit('v20'), REMOTE),
      block('lunch', 'pA', 1, 720, 60, activity('aLunch'), room('s1', null)),
      block('gap', 'pA', 1, 700, 40, visit('v40'), room('s1', 'r1')),
      block('off', 'pA', 2, 600, 60, activity('aMeet'), room('s1', null)),
      block('offLunch', 'pA', 2, 720, 30, activity('aLunch'), room('s1', null)),
      block('other', 'pB', 0, 420, 60, visit('v60'), room('s2', 'r3')),
    ]);
    expect(blocksOutsideWork(s, 'pA', 0).map((b) => b.id)).toEqual(['early', 'late']);
    expect(blocksOutsideWork(s, 'pA', 1).map((b) => b.id)).toEqual(['gap']);
    expect(blocksOutsideWork(s, 'pA', 2).map((b) => b.id)).toEqual(['off']);
    expect(blocksOutsideWork(s, 'pA').map((b) => b.id)).toEqual(['early', 'late', 'gap', 'off']);
    // Nobody is outside working hours that were never entered.
    expect(blocksOutsideWork(s, 'pB')).toEqual([]);
  });

  it('gives the time at work with no block in it, and the unpaid time inside working hours', () => {
    const s = withBlocks(entered(), [
      ...visits('a', 'pA', 0, 480, 6),
      block('lunch', 'pA', 0, 720, 60, activity('aLunch'), room('s1', null)),
      block('admin', 'pA', 0, 900, 180, activity('aAdmin'), room('s1', null)),
      block('lunch2', 'pA', 1, 700, 80, activity('aLunch'), room('s1', null)),
    ]);
    expect(openSpans(s, 'pA', 0)).toEqual([{ from: 600, to: 720 }, { from: 780, to: 900 }]);
    expect(openSpans(s, 'pA', 1)).toEqual([{ from: 480, to: 700 }, { from: 780, to: 1020 }]);
    expect(openSpans(s, 'pA', 2)).toEqual([]);
    expect(openSpans(s, 'pB', 0)).toEqual([]);
    expect(unpaidInsideWork(s, 'pA', 0)).toBe(60);
    // Tuesday's lunch runs from 11:40 am to 1:00 pm, and only its first 20 minutes are in working hours.
    expect(unpaidInsideWork(s, 'pA', 1)).toBe(20);
    expect(unpaidInsideWork(s, 'pA', 2)).toBe(0);
  });

  it('writes a day\'s working hours in words', () => {
    const s = entered();
    expect(workText(s, 'pA', 0)).toBe('8:00 am to 5:00 pm');
    expect(workText(s, 'pA', 1)).toBe('8:00 am to 12:00 pm and 1:00 pm to 5:00 pm');
    expect(workText(s, 'pA', 3)).toBe('Day off');
    expect(workText(s, 'pB', 0)).toBe('');
    expect(workText(s, 'nobody', 0)).toBe('');
  });

  it('gives the first and last minute a day or a week holds anything: working hours or blocks', () => {
    const s = withBlocks(entered(), [block('early', 'pA', 0, 440, 20, visit('v20'), REMOTE), block('late', 'pA', 2, 1000, 60, activity('aAdmin'), room('s1', null)), block('b', 'pB', 3, 600, 30, visit('v30'), REMOTE)]);
    expect(dayExtent(s, 'pA', 0)).toEqual({ from: 440, to: 1020 });
    expect(dayExtent(s, 'pA', 1)).toEqual({ from: 480, to: 1020 });
    expect(dayExtent(s, 'pA', 2)).toEqual({ from: 1000, to: 1060 });
    expect(dayExtent(s, 'pA', 3)).toBeNull();
    expect(weekExtent(s, 'pA')).toEqual({ from: 440, to: 1060 });
    expect(dayExtent(s, 'pB', 3)).toEqual({ from: 600, to: 630 });
    expect(weekExtent(s, 'pB')).toEqual({ from: 600, to: 630 });
    expect(weekExtent(base, 'pA')).toBeNull();
    expect(weekExtent(s, 'nobody')).toBeNull();
  });
});

describe('Schedule Designer: working hours and the other edits', () => {
  it('narrowing the hours shown keeps working hours as they are, and they can be listed', () => {
    const s = setHours(entered(), 540, 960);
    expect(workOf(s, 'pA')).toEqual(workOf(entered(), 'pA'));
    expect(workOutsideHours(s)).toEqual([
      { personId: 'pA', day: 0, from: 480, to: 1020 },
      { personId: 'pA', day: 1, from: 480, to: 720 },
      { personId: 'pA', day: 1, from: 780, to: 1020 },
    ]);
    expect(workOutsideHours(s, 'pA')).toHaveLength(3);
    expect(workOutsideHours(s, 'pB')).toEqual([]);
    expect(workOutsideHours(entered())).toEqual([]);
    // Only the end is cut: the morning stretch of the split day still fits.
    const lateOnly = setHours(entered(), 480, 960);
    expect(workOutsideHours(lateOnly).map((stretch) => [stretch.day, stretch.from])).toEqual([[0, 480], [1, 780]]);
  });

  it('taking a day out of the week takes its working hours with it', () => {
    const s = entered();
    const change = setDays(s, [0, 2, 3, 4]);
    expect(workOf(change.schedule, 'pA')).toEqual([{ day: 0, from: 480, to: 1020 }]);
    expect(change.touched).toBe(0);
    // A person with no working hours on that day is the same object as before.
    expect(personOf(change.schedule, 'pB')).toBe(personOf(s, 'pB'));
  });

  it('a copy of a person has the same working hours, in a list of its own', () => {
    const s = entered();
    const copied = duplicatePerson(s, 'pA');
    const copy = copied.people[1];
    expect(copy?.name).toBe('Avery Quill (copy)');
    expect(copy?.work).toEqual(workOf(s, 'pA'));
    expect(copy?.work).not.toBe(workOf(s, 'pA'));
    expect(copy?.kind).toBe('provider');
    expect(copy?.worksWith).toEqual([]);
  });
});

describe('Schedule Designer: working hours in the tally', () => {
  it('gives nothing for hours at work while none are entered', () => {
    const tally = tallyPerson(withBlocks(base, visits('a', 'pA', 0, 480, 3)), 'pA');
    expect(tally?.workMinutes).toBeNull();
    expect(tally?.paidWorkMinutes).toBeNull();
    expect(tally?.openMinutes).toBeNull();
    expect(tally?.days.map((day) => [day.workMinutes, day.openMinutes])).toEqual([[null, null], [null, null], [null, null], [null, null], [null, null]]);
  });

  it('counts minutes at work, paid minutes at work and open minutes, day by day and for the week', () => {
    // Monday 8:00 am to 5:00 pm: 4 hours of appointments, 1 hour of lunch, 2 hours of admin.
    // Tuesday is a split day with nothing on it. Wednesday to Friday are days off.
    const s = withBlocks(entered(), [...visits('a', 'pA', 0, 480, 12), block('lunch', 'pA', 0, 720, 60, activity('aLunch'), room('s1', null)), block('admin', 'pA', 0, 780, 120, activity('aAdmin'), room('s1', null))]);
    const tally = tallyPerson(s, 'pA');
    expect(tally?.workMinutes).toBe(1020);
    // 17 hours at work less the 1 hour of lunch inside them.
    expect(tally?.paidWorkMinutes).toBe(960);
    // Monday has 2 hours open and Tuesday all 8.
    expect(tally?.openMinutes).toBe(600);
    expect(tally?.days.map((day) => [day.workMinutes, day.openMinutes])).toEqual([[540, 120], [480, 480], [0, 0], [0, 0], [0, 0]]);
    // The rest of the tally is what it is without working hours.
    const plain = tallyPerson(clearWork(s, 'pA'), 'pA');
    expect(tally?.week).toEqual(plain?.week);
    expect(tally?.slots).toEqual(plain?.slots);
  });

  it('does not take unpaid time outside working hours off the paid minutes at work', () => {
    // Lunch sits in the gap of the split day, so the 8 hours at work are all paid.
    const s = withBlocks(entered(), [block('lunch', 'pA', 1, 720, 60, activity('aLunch'), room('s1', null))]);
    const tally = tallyPerson(s, 'pA');
    expect(tally?.paidWorkMinutes).toBe(1020);
    expect(tally?.days[1]?.openMinutes).toBe(480);
  });
});
