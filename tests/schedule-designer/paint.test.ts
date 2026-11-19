import { describe, expect, it } from 'vitest';
import { clearDay, copyDay, erase, newId, newSchedule, paint, setPlace, setStep } from '../../src/scripts/schedule-designer/engine/edit';
import { validate } from '../../src/scripts/schedule-designer/engine/validate';
import { NOWHERE, REMOTE, activity, block, dayOf, noOverlaps, room, small, visit, withBlocks } from './fixtures/small';

// Every test here starts from a frozen schedule, so an edit that tried to change its input would throw.
const base = small();
const EXAM1 = room('s1', 'r1');
const EXAM2 = room('s1', 'r2');

describe('Schedule Designer: painting appointments', () => {
  it('tiles whole appointments from the start of the range', () => {
    const s = paint(base, { personId: 'pA', day: 0, from: 540, to: 600, what: visit('v20'), where: EXAM1 });
    expect(dayOf(s, 'pA', 0)).toEqual(['540-560 Standard @ Exam 1, Elm Street', '560-580 Standard @ Exam 1, Elm Street', '580-600 Standard @ Exam 1, Elm Street']);
    expect(new Set(s.blocks.map((b) => b.id)).size).toBe(3);
    expect(base.blocks).toEqual([]);
  });

  it('leaves a remainder too short for one more appointment empty', () => {
    const s = paint(base, { personId: 'pA', day: 0, from: 540, to: 640, what: visit('v40'), where: EXAM1 });
    expect(dayOf(s, 'pA', 0)).toEqual(['540-580 New patient @ Exam 1, Elm Street', '580-620 New patient @ Exam 1, Elm Street']);
  });

  it('places one whole appointment when the range is shorter than one, so a click on one cell still paints', () => {
    const s = paint(base, { personId: 'pB', day: 1, from: 540, to: 555, what: visit('v60'), where: REMOTE });
    expect(dayOf(s, 'pB', 1)).toEqual(['540-600 Extended @ Remote']);
  });

  it('gives back the same schedule when the very same appointments are added over themselves, so nothing is marked changed', () => {
    const before = paint(base, { personId: 'pA', day: 0, from: 540, to: 600, what: visit('v20'), where: EXAM1 });
    expect(paint(before, { personId: 'pA', day: 0, from: 560, to: 580, what: visit('v20'), where: EXAM1 })).toBe(before);
    expect(paint(before, { personId: 'pA', day: 0, from: 540, to: 600, what: visit('v20'), where: EXAM1 })).toBe(before);
    // Another room, another kind or another start is a change.
    expect(paint(before, { personId: 'pA', day: 0, from: 560, to: 580, what: visit('v20'), where: EXAM2 })).not.toBe(before);
    expect(paint(before, { personId: 'pA', day: 0, from: 560, to: 580, what: visit('v40'), where: EXAM1 })).not.toBe(before);
    expect(paint(before, { personId: 'pA', day: 0, from: 550, to: 570, what: visit('v20'), where: EXAM1 })).not.toBe(before);
  });

  it('places nothing when one appointment would run past midnight', () => {
    expect(paint(base, { personId: 'pB', day: 1, from: 1410, to: 1425, what: visit('v60'), where: REMOTE })).toBe(base);
  });

  it('replaces the appointments it covers and removes one it only partly covers', () => {
    const before = paint(base, { personId: 'pA', day: 0, from: 540, to: 660, what: visit('v40'), where: EXAM1 });
    // 540-580, 580-620, 620-660. Painting 600-640 covers the end of the second and the start of the third.
    const s = paint(before, { personId: 'pA', day: 0, from: 600, to: 640, what: visit('v20'), where: EXAM2 });
    expect(dayOf(s, 'pA', 0)).toEqual(['540-580 New patient @ Exam 1, Elm Street', '600-620 Standard @ Exam 2, Elm Street', '620-640 Standard @ Exam 2, Elm Street']);
    expect(noOverlaps(s)).toBe(true);
  });

  it('trims an activity it overlaps and keeps the rest of it', () => {
    const before = paint(base, { personId: 'pA', day: 0, from: 480, to: 600, what: activity('aAdmin'), where: NOWHERE });
    const s = paint(before, { personId: 'pA', day: 0, from: 520, to: 560, what: visit('v20'), where: EXAM1 });
    expect(dayOf(s, 'pA', 0)).toEqual(['480-520 Admin time', '520-540 Standard @ Exam 1, Elm Street', '540-560 Standard @ Exam 1, Elm Street', '560-600 Admin time']);
    // The first piece keeps the old block's id; the second piece is a new block.
    const admin = s.blocks.filter((b) => b.what.kind === 'activity');
    expect(admin.map((b) => b.id).includes(before.blocks[0]?.id ?? '')).toBe(true);
    expect(new Set(s.blocks.map((b) => b.id)).size).toBe(4);
  });

  it('keeps true minutes: an appointment may start off the person\'s grid', () => {
    const s = paint(base, { personId: 'pA', day: 0, from: 545, to: 585, what: visit('v20'), where: EXAM1 });
    expect(dayOf(s, 'pA', 0)).toEqual(['545-565 Standard @ Exam 1, Elm Street', '565-585 Standard @ Exam 1, Elm Street']);
  });

  it('lets a person be given a visit type from another department', () => {
    const s = paint(base, { personId: 'pA', day: 0, from: 540, to: 570, what: visit('v30'), where: EXAM1 });
    expect(dayOf(s, 'pA', 0)).toEqual(['540-570 Standard @ Exam 1, Elm Street']);
  });

  it('changes nothing, and gives back the very same schedule, when the request makes no sense', () => {
    const ok = { personId: 'pA', day: 0 as const, from: 540, to: 600, what: visit('v20'), where: EXAM1 };
    expect(paint(base, { ...ok, personId: 'nobody' })).toBe(base);
    expect(paint(base, { ...ok, what: visit('no-such-type') })).toBe(base);
    expect(paint(base, { ...ok, what: activity('no-such-activity') })).toBe(base);
    expect(paint(base, { ...ok, where: room('s1', 'r3') })).toBe(base); // that room is at the other site
    expect(paint(base, { ...ok, where: room('nowhere', null) })).toBe(base);
    expect(paint(base, { ...ok, from: 600, to: 600 })).toBe(base);
    expect(paint(base, { ...ok, from: 600, to: 540 })).toBe(base);
    expect(paint(base, { ...ok, day: 6 })).toBe(base); // Sunday is not one of the days shown
    expect(paint(base, { ...ok, from: Number.NaN })).toBe(base);
  });

  it('keeps the range inside the day', () => {
    const s = paint(base, { personId: 'pA', day: 0, from: -30, to: 40, what: visit('v20'), where: REMOTE });
    expect(dayOf(s, 'pA', 0)).toEqual(['0-20 Standard @ Remote', '20-40 Standard @ Remote']);
  });
});

describe('Schedule Designer: painting other time', () => {
  it('makes one block for the whole range', () => {
    const s = paint(base, { personId: 'pA', day: 2, from: 780, to: 900, what: activity('aMeet'), where: EXAM1 });
    expect(dayOf(s, 'pA', 2)).toEqual(['780-900 Meeting @ Exam 1, Elm Street']);
  });

  it('merges with a touching block of the same activity and place, before and after', () => {
    let s = paint(base, { personId: 'pA', day: 2, from: 780, to: 840, what: activity('aMeet'), where: EXAM1 });
    const firstId = s.blocks[0]?.id;
    s = paint(s, { personId: 'pA', day: 2, from: 900, to: 960, what: activity('aMeet'), where: EXAM1 });
    s = paint(s, { personId: 'pA', day: 2, from: 840, to: 900, what: activity('aMeet'), where: EXAM1 });
    expect(dayOf(s, 'pA', 2)).toEqual(['780-960 Meeting @ Exam 1, Elm Street']);
    // The merged block keeps the id of the earliest block.
    expect(s.blocks[0]?.id).toBe(firstId);
  });

  it('does not merge when the place or the activity differs', () => {
    let s = paint(base, { personId: 'pA', day: 2, from: 780, to: 840, what: activity('aMeet'), where: EXAM1 });
    s = paint(s, { personId: 'pA', day: 2, from: 840, to: 900, what: activity('aMeet'), where: EXAM2 });
    s = paint(s, { personId: 'pA', day: 2, from: 900, to: 960, what: activity('aAdmin'), where: EXAM2 });
    expect(dayOf(s, 'pA', 2)).toEqual(['780-840 Meeting @ Exam 1, Elm Street', '840-900 Meeting @ Exam 2, Elm Street', '900-960 Admin time @ Exam 2, Elm Street']);
  });

  it('does not merge across a gap, or with another person or day', () => {
    let s = paint(base, { personId: 'pA', day: 2, from: 780, to: 840, what: activity('aMeet'), where: NOWHERE });
    s = paint(s, { personId: 'pA', day: 2, from: 860, to: 900, what: activity('aMeet'), where: NOWHERE });
    s = paint(s, { personId: 'pB', day: 2, from: 840, to: 860, what: activity('aMeet'), where: NOWHERE });
    s = paint(s, { personId: 'pA', day: 3, from: 840, to: 860, what: activity('aMeet'), where: NOWHERE });
    expect(dayOf(s, 'pA', 2)).toEqual(['780-840 Meeting', '860-900 Meeting']);
    expect(s.blocks.length).toBe(4);
  });

  it('painted over the middle of the same activity, it stays one block', () => {
    let s = paint(base, { personId: 'pA', day: 2, from: 780, to: 900, what: activity('aMeet'), where: NOWHERE });
    s = paint(s, { personId: 'pA', day: 2, from: 800, to: 840, what: activity('aMeet'), where: NOWHERE });
    expect(dayOf(s, 'pA', 2)).toEqual(['780-900 Meeting']);
  });

  it('removes an appointment it covers only in part, because half an appointment makes no sense', () => {
    let s = paint(base, { personId: 'pA', day: 2, from: 540, to: 600, what: visit('v20'), where: EXAM1 });
    s = paint(s, { personId: 'pA', day: 2, from: 550, to: 570, what: activity('aAdmin'), where: NOWHERE });
    expect(dayOf(s, 'pA', 2)).toEqual(['550-570 Admin time', '580-600 Standard @ Exam 1, Elm Street']);
  });

  it('splits a different activity around itself', () => {
    let s = paint(base, { personId: 'pA', day: 2, from: 480, to: 720, what: activity('aAdmin'), where: NOWHERE });
    s = paint(s, { personId: 'pA', day: 2, from: 540, to: 600, what: activity('aMeet'), where: NOWHERE });
    expect(dayOf(s, 'pA', 2)).toEqual(['480-540 Admin time', '540-600 Meeting', '600-720 Admin time']);
    expect(noOverlaps(s)).toBe(true);
  });
});

describe('Schedule Designer: erasing', () => {
  const day = withBlocks(base, [
    block('b1', 'pA', 0, 480, 60, activity('aAdmin'), NOWHERE),
    block('b2', 'pA', 0, 540, 20, visit('v20'), EXAM1),
    block('b3', 'pA', 0, 560, 20, visit('v20'), EXAM1),
    block('b4', 'pA', 0, 580, 40, visit('v40'), EXAM1),
    block('b5', 'pA', 1, 540, 20, visit('v20'), EXAM1),
    block('b6', 'pB', 0, 540, 30, visit('v30'), REMOTE),
  ]);

  it('trims the end of an activity', () => {
    expect(dayOf(erase(day, { personId: 'pA', day: 0, from: 520, to: 540 }), 'pA', 0)[0]).toBe('480-520 Admin time');
  });

  it('trims the start of an activity and keeps its id', () => {
    const s = erase(day, { personId: 'pA', day: 0, from: 470, to: 500 });
    expect(dayOf(s, 'pA', 0)[0]).toBe('500-540 Admin time');
    expect(s.blocks.find((b) => b.start === 500)?.id).toBe('b1');
  });

  it('splits an activity in two when the middle is erased', () => {
    const s = erase(day, { personId: 'pA', day: 0, from: 500, to: 520 });
    expect(dayOf(s, 'pA', 0).slice(0, 2)).toEqual(['480-500 Admin time', '520-540 Admin time']);
    expect(s.blocks.find((b) => b.start === 480)?.id).toBe('b1');
    expect(s.blocks.find((b) => b.start === 520)?.id).not.toBe('b1');
  });

  it('removes an activity it covers whole', () => {
    expect(dayOf(erase(day, { personId: 'pA', day: 0, from: 480, to: 540 }), 'pA', 0)).toEqual(['540-560 Standard @ Exam 1, Elm Street', '560-580 Standard @ Exam 1, Elm Street', '580-620 New patient @ Exam 1, Elm Street']);
  });

  it('removes every appointment it touches, even in part', () => {
    const s = erase(day, { personId: 'pA', day: 0, from: 570, to: 590 });
    expect(dayOf(s, 'pA', 0)).toEqual(['480-540 Admin time', '540-560 Standard @ Exam 1, Elm Street']);
  });

  it('leaves a block that only touches the edge of the range', () => {
    const s = erase(day, { personId: 'pA', day: 0, from: 560, to: 580 });
    expect(dayOf(s, 'pA', 0)).toEqual(['480-540 Admin time', '540-560 Standard @ Exam 1, Elm Street', '580-620 New patient @ Exam 1, Elm Street']);
  });

  it('touches only that person and that day', () => {
    const s = erase(day, { personId: 'pA', day: 0, from: 0, to: 1440 });
    expect(s.blocks.map((b) => b.id)).toEqual(['b5', 'b6']);
  });

  it('gives back the very same schedule when there is nothing to erase', () => {
    expect(erase(day, { personId: 'pA', day: 0, from: 700, to: 800 })).toBe(day);
    expect(erase(day, { personId: 'pA', day: 2, from: 0, to: 1440 })).toBe(day);
    expect(erase(day, { personId: 'nobody', day: 0, from: 0, to: 1440 })).toBe(day);
    expect(erase(day, { personId: 'pA', day: 0, from: 600, to: 500 })).toBe(day);
  });
});

describe('Schedule Designer: changing the place of time already painted', () => {
  const day = withBlocks(base, [
    block('b1', 'pA', 0, 480, 60, activity('aAdmin'), EXAM1),
    block('b2', 'pA', 0, 540, 60, activity('aAdmin'), EXAM2),
    block('b3', 'pA', 0, 600, 20, visit('v20'), room('s1', null)),
    block('b4', 'pA', 0, 620, 20, visit('v20'), room('s1', null)),
  ]);

  it('sets the place of every block the range touches, whole blocks', () => {
    const s = setPlace(day, { personId: 'pA', day: 0, from: 610, to: 630, where: EXAM2 });
    expect(dayOf(s, 'pA', 0).slice(1)).toEqual(['540-600 Admin time @ Exam 2, Elm Street', '600-620 Standard @ Exam 2, Elm Street', '620-640 Standard @ Exam 2, Elm Street']);
  });

  it('merges activity blocks that now touch in the same place', () => {
    const s = setPlace(day, { personId: 'pA', day: 0, from: 480, to: 500, where: EXAM2 });
    expect(dayOf(s, 'pA', 0)[0]).toBe('480-600 Admin time @ Exam 2, Elm Street');
    expect(s.blocks.length).toBe(3);
  });

  it('gives back the same schedule when nothing changes', () => {
    expect(setPlace(day, { personId: 'pA', day: 0, from: 480, to: 500, where: EXAM1 })).toBe(day);
    expect(setPlace(day, { personId: 'pA', day: 0, from: 700, to: 800, where: REMOTE })).toBe(day);
    expect(setPlace(day, { personId: 'pA', day: 0, from: 480, to: 500, where: room('s2', 'r1') })).toBe(day);
  });
});

describe('Schedule Designer: whole days', () => {
  let week = paint(base, { personId: 'pA', day: 0, from: 540, to: 600, what: visit('v20'), where: EXAM1 });
  week = paint(week, { personId: 'pA', day: 0, from: 720, to: 780, what: activity('aLunch'), where: NOWHERE });
  week = paint(week, { personId: 'pA', day: 2, from: 480, to: 1020, what: activity('aAdmin'), where: REMOTE });
  week = paint(week, { personId: 'pB', day: 2, from: 540, to: 600, what: visit('v60'), where: REMOTE });

  it('copies a day onto other days, replacing what was there', () => {
    const s = copyDay(week, 'pA', 0, [1, 2]);
    expect(dayOf(s, 'pA', 1)).toEqual(dayOf(week, 'pA', 0));
    expect(dayOf(s, 'pA', 2)).toEqual(dayOf(week, 'pA', 0));
    expect(dayOf(s, 'pA', 0)).toEqual(dayOf(week, 'pA', 0));
    // The copies are new blocks, and another person's day is left alone.
    expect(new Set(s.blocks.map((b) => b.id)).size).toBe(s.blocks.length);
    expect(dayOf(s, 'pB', 2)).toEqual(['540-600 Extended @ Remote']);
  });

  it('ignores the day itself, a day twice, and days that are not shown', () => {
    const s = copyDay(week, 'pA', 0, [0, 1, 1, 6]);
    expect(s.blocks.filter((b) => b.personId === 'pA' && b.day === 1).length).toBe(4);
    expect(s.blocks.some((b) => b.day === 6)).toBe(false);
    expect(copyDay(week, 'pA', 0, [0])).toBe(week);
    expect(copyDay(week, 'pA', 0, [])).toBe(week);
    expect(copyDay(week, 'nobody', 0, [1])).toBe(week);
  });

  it('copying an empty day clears the days it is copied onto', () => {
    expect(dayOf(copyDay(week, 'pA', 1, [2]), 'pA', 2)).toEqual([]);
  });

  it('clears one day for one person', () => {
    const s = clearDay(week, 'pA', 0);
    expect(dayOf(s, 'pA', 0)).toEqual([]);
    expect(s.blocks.length).toBe(2);
    expect(clearDay(week, 'pA', 1)).toBe(week);
  });
});

describe('Schedule Designer: the grid switch', () => {
  it('changes the person\'s grid and nothing else', () => {
    const painted = paint(base, { personId: 'pA', day: 0, from: 540, to: 600, what: visit('v20'), where: EXAM1 });
    const s = setStep(painted, 'pA', 15);
    expect(s.people.find((p) => p.id === 'pA')?.step).toBe(15);
    expect(s.blocks).toEqual(painted.blocks);
    expect(s.people.find((p) => p.id === 'pB')).toEqual(painted.people.find((p) => p.id === 'pB'));
    expect(setStep(painted, 'pA', 20)).toBe(painted);
    expect(setStep(painted, 'nobody', 15)).toBe(painted);
  });
});

describe('Schedule Designer: a new schedule and its ids', () => {
  it('starts a schedule the tool itself accepts', () => {
    const s = newSchedule();
    expect(validate(s)).toEqual({ schedule: s });
    expect(s.people).toEqual([]);
    expect(s.blocks).toEqual([]);
    expect(s.sites.length).toBe(1);
    expect(s.departments[0]?.visitTypes.length).toBeGreaterThan(0);
    expect(s.activities.some((a) => !a.paid)).toBe(true);
  });

  it('makes short ids that do not repeat', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{8}$/);
    const taken = new Set(['a']);
    expect(newId(taken)).not.toBe('a');
  });
});
