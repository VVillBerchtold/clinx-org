import { describe, expect, it } from 'vitest';
import {
  addActivity,
  addDepartment,
  addPerson,
  addRoom,
  addSite,
  addVisitType,
  duplicatePerson,
  removeActivity,
  removeDepartment,
  removePerson,
  removeRoom,
  removeSetAside,
  removeSite,
  removeVisitType,
  renameDepartment,
  renameRoom,
  renameSite,
  setActivity,
  setAsideHours,
  newSchedule,
  setDays,
  setDepartmentStandards,
  setDepartmentStep,
  setDetails,
  setHours,
  setPerson,
  setTolerance,
  setVisitType,
} from '../../src/scripts/schedule-designer/engine/edit';
import { validate } from '../../src/scripts/schedule-designer/engine/validate';
import { NOWHERE, REMOTE, activity, block, dayOf, noOverlaps, room, small, visit, withBlocks } from './fixtures/small';

const base = small();
const EXAM1 = room('s1', 'r1');
const EXAM2 = room('s1', 'r2');

// A week with something pointing at every kind of thing, so a removal has blocks to touch.
const busy = withBlocks(base, [
  block('b1', 'pA', 0, 480, 60, activity('aAdmin'), EXAM1),
  block('b2', 'pA', 0, 540, 60, activity('aAdmin'), EXAM2),
  block('b3', 'pA', 0, 600, 20, visit('v20'), EXAM1),
  block('b4', 'pA', 0, 620, 20, visit('v20'), EXAM1),
  block('b5', 'pA', 0, 640, 20, visit('v20'), EXAM1),
  block('b6', 'pA', 0, 660, 40, visit('v40'), EXAM2),
  block('b7', 'pA', 4, 720, 60, activity('aLunch'), NOWHERE),
  block('b8', 'pB', 0, 540, 30, visit('v30'), room('s2', 'r3')),
  block('b9', 'pB', 0, 570, 60, visit('v60'), REMOTE),
  block('b10', 'pB', 4, 540, 60, activity('aMeet'), room('s2', null)),
]);

const valid = (s: unknown): boolean => 'schedule' in validate(s);

describe('Schedule Designer: the clinic\'s details', () => {
  it('sets the name and the clinic, trimmed', () => {
    const s = setDetails(base, { name: '  Autumn template ', clinic: ' ' });
    expect(s.name).toBe('Autumn template');
    expect(s.clinic).toBe('');
    expect(setDetails(base, { name: '   ' })).toBe(base);
    expect(setDetails(base, { name: 'Test week' })).toBe(base);
    expect(setDetails(base, { name: 'x'.repeat(200) }).name.length).toBe(80);
  });

  it('a new schedule shows 6:00 am to 9:00 pm, so early and evening sessions have room', () => {
    const s = newSchedule();
    expect([s.dayStart, s.dayEnd]).toEqual([360, 1260]);
    expect(valid(s)).toBe(true);
  });

  it('sets the hours the grid shows, in steps of five minutes', () => {
    const s = setHours(base, 452, 1081);
    expect([s.dayStart, s.dayEnd]).toEqual([450, 1080]);
    expect(setHours(base, 600, 600)).toBe(base);
    expect(setHours(base, 600, 630)).toBe(base); // less than an hour
    expect(setHours(base, -10, 2000)).toBe(base);
    expect(setHours(base, 480, 1020)).toBe(base);
  });

  it('sets the days, in week order, and removes the blocks on a day taken away', () => {
    const change = setDays(busy, [4, 5, 0, 0]);
    expect(change.schedule.days).toEqual([0, 4, 5]);
    expect(change.touched).toBe(0);
    const fewer = setDays(busy, [0, 1, 2, 3]);
    expect(fewer.touched).toBe(2);
    expect(fewer.schedule.blocks.some((b) => b.day === 4)).toBe(false);
    expect(valid(fewer.schedule)).toBe(true);
    const none = setDays(busy, []);
    expect(none.schedule).toBe(busy);
    expect(none.problem).toBeTruthy();
  });
});

describe('Schedule Designer: sites and rooms', () => {
  it('adds a site and a room at the end of their lists', () => {
    const s = addRoom(addSite(base, 'Harbour Road'), 's1', 'Exam 3');
    expect(s.sites.map((site) => site.name)).toEqual(['Elm Street', 'Annex', 'Harbour Road']);
    expect(s.sites[2]?.rooms).toEqual([]);
    expect(s.sites[0]?.rooms.map((r) => r.name)).toEqual(['Exam 1', 'Exam 2', 'Exam 3']);
    expect(addSite(base).sites[2]?.name).toBe('New site');
    expect(addRoom(base, 's2').sites[1]?.rooms[1]?.name).toBe('New room');
    expect(addRoom(base, 'no-such-site')).toBe(base);
    expect(valid(s)).toBe(true);
  });

  it('renames them, and refuses an empty name', () => {
    expect(renameSite(base, 's1', 'Elm St').sites[0]?.name).toBe('Elm St');
    expect(renameRoom(base, 'r3', 'Consult A').sites[1]?.rooms[0]?.name).toBe('Consult A');
    expect(renameSite(base, 's1', '  ')).toBe(base);
    expect(renameRoom(base, 'nope', 'X')).toBe(base);
  });

  it('removing a room keeps the time at the site with no room, and says how many blocks', () => {
    const change = removeRoom(busy, 'r1');
    expect(change.touched).toBe(4);
    expect(change.schedule.sites[0]?.rooms.map((r) => r.id)).toEqual(['r2']);
    expect(dayOf(change.schedule, 'pA', 0)).toEqual([
      '480-540 Admin time @ Elm Street',
      '540-600 Admin time @ Exam 2, Elm Street',
      '600-620 Standard @ Elm Street',
      '620-640 Standard @ Elm Street',
      '640-660 Standard @ Elm Street',
      '660-700 New patient @ Exam 2, Elm Street',
    ]);
    expect(valid(change.schedule)).toBe(true);
    expect(removeRoom(busy, 'nope')).toEqual({ schedule: busy, touched: 0 });
  });

  it('removing rooms merges activity blocks that end up touching in the same place', () => {
    const change = removeRoom(removeRoom(busy, 'r1').schedule, 'r2');
    expect(dayOf(change.schedule, 'pA', 0)[0]).toBe('480-600 Admin time @ Elm Street');
  });

  it('removing a site clears the place of the time that was there', () => {
    const change = removeSite(busy, 's2');
    expect(change.touched).toBe(2);
    expect(dayOf(change.schedule, 'pB', 0)).toEqual(['540-570 Standard', '570-630 Extended @ Remote']);
    expect(dayOf(change.schedule, 'pB', 4)).toEqual(['540-600 Meeting']);
    expect(valid(change.schedule)).toBe(true);
  });
});

describe('Schedule Designer: departments and visit types', () => {
  it('adds and renames a department and sets its grid for new people', () => {
    let s = addDepartment(base, 'Dental', 15);
    expect(s.departments[2]).toMatchObject({ name: 'Dental', step: 15, visitTypes: [] });
    s = renameDepartment(s, 'd1', 'Family medicine');
    s = setDepartmentStep(s, 'd1', 15);
    expect(s.departments[0]).toMatchObject({ name: 'Family medicine', step: 15 });
    // People already there keep their own grid.
    expect(s.people[0]?.step).toBe(20);
    expect(addDepartment(base).departments[2]).toMatchObject({ name: 'New department', step: 20 });
  });

  it('starts a department with a care factor of 1 and one slot for each line of its grid', () => {
    expect(addDepartment(base).departments[2]).toMatchObject({ careFactor: 1, slotsPerHour: 3 });
    expect(addDepartment(base, 'Dental', 15).departments[2]).toMatchObject({ careFactor: 1, slotsPerHour: 4 });
    expect(newSchedule().departments[0]).toMatchObject({ step: 20, careFactor: 1, slotsPerHour: 3 });
    expect(newSchedule().tolerance).toBe(0);
    expect(valid(addDepartment(newSchedule(), 'Dental', 15))).toBe(true);
  });

  it('sets a department\'s care factor and slots in an hour, kept inside their limits', () => {
    const s = setDepartmentStandards(base, 'd1', { careFactor: 0.8, slotsPerHour: 3.5 });
    expect(s.departments[0]).toMatchObject({ careFactor: 0.8, slotsPerHour: 3.5, step: 20 });
    expect(s.departments[1]).toBe(base.departments[1]);
    expect(setDepartmentStandards(base, 'd1', { careFactor: 0.85 }).departments[0]).toMatchObject({ careFactor: 0.85, slotsPerHour: 3 });
    expect(setDepartmentStandards(base, 'd1', { slotsPerHour: 2 }).departments[0]).toMatchObject({ careFactor: 1, slotsPerHour: 2 });
    // Out of range values are brought to the nearest one allowed.
    expect(setDepartmentStandards(base, 'd1', { careFactor: 1.4, slotsPerHour: 40 }).departments[0]).toMatchObject({ careFactor: 1, slotsPerHour: 12 });
    expect(setDepartmentStandards(base, 'd1', { careFactor: 0, slotsPerHour: 0 }).departments[0]).toMatchObject({ careFactor: 0.01, slotsPerHour: 1 });
    expect(setDepartmentStandards(base, 'd1', { careFactor: -2 }).departments[0]?.careFactor).toBe(0.01);
    expect(setDepartmentStandards(base, 'd1', { careFactor: 0.82549 }).departments[0]?.careFactor).toBe(0.825);
    // Nothing to do, or nothing usable, hands back the same schedule.
    expect(setDepartmentStandards(base, 'd1', {})).toBe(base);
    expect(setDepartmentStandards(base, 'd1', { careFactor: 1, slotsPerHour: 3 })).toBe(base);
    expect(setDepartmentStandards(base, 'd1', { careFactor: Number.NaN })).toBe(base);
    expect(setDepartmentStandards(base, 'd1', { slotsPerHour: Number.POSITIVE_INFINITY })).toBe(base);
    expect(setDepartmentStandards(base, 'nope', { careFactor: 0.5 })).toBe(base);
    expect(valid(s)).toBe(true);
  });

  it('moves the slots in an hour with the grid only while they still match it', () => {
    expect(setDepartmentStep(base, 'd1', 15).departments[0]).toMatchObject({ step: 15, slotsPerHour: 4 });
    expect(setDepartmentStep(base, 'd2', 20).departments[1]).toMatchObject({ step: 20, slotsPerHour: 3 });
    const set = setDepartmentStandards(base, 'd1', { slotsPerHour: 2 });
    expect(setDepartmentStep(set, 'd1', 15).departments[0]).toMatchObject({ step: 15, slotsPerHour: 2 });
  });

  it('sets the tolerance in slots, from 0 to 100', () => {
    expect(setTolerance(base, 2).tolerance).toBe(2);
    expect(setTolerance(base, 1.26).tolerance).toBe(1.3);
    expect(setTolerance(base, -4)).toBe(base);
    expect(setTolerance(setTolerance(base, 2), -4).tolerance).toBe(0);
    expect(setTolerance(base, 500).tolerance).toBe(100);
    expect(setTolerance(base, 0)).toBe(base);
    expect(setTolerance(base, Number.NaN)).toBe(base);
    expect(valid(setTolerance(base, 2))).toBe(true);
  });

  it('adds a visit type with the department\'s length and a colour not yet used', () => {
    const s = addVisitType(base, 'd2');
    const added = s.departments[1]?.visitTypes[2];
    expect(added).toMatchObject({ name: 'New visit type', code: '', minutes: 15 });
    expect([1, 2, 3, 4, 7, 11, 12]).not.toContain(added?.colour);
    expect(addVisitType(base, 'd1', { name: 'Same day', code: 'toolongcode', minutes: 22, colour: 9 }).departments[0]?.visitTypes[2]).toMatchObject({ name: 'Same day', code: 'toolongc', minutes: 20, colour: 9 });
    expect(addVisitType(base, 'nope')).toBe(base);
  });

  it('changes a visit type\'s name, code and colour without touching blocks', () => {
    const change = setVisitType(busy, 'v20', { name: 'Routine', code: 'RTN', colour: 5 });
    expect(change.touched).toBe(0);
    expect(change.schedule.blocks).toEqual(busy.blocks);
    expect(change.schedule.departments[0]?.visitTypes[0]).toEqual({ id: 'v20', name: 'Routine', code: 'RTN', minutes: 20, colour: 5 });
  });

  it('a new length lays the appointments out again inside the time they filled', () => {
    // Three 20 minute appointments from 600 to 660 become two of 30 minutes.
    const longer = setVisitType(busy, 'v20', { minutes: 30 });
    expect(longer.touched).toBe(3);
    expect(dayOf(longer.schedule, 'pA', 0).slice(2, 5)).toEqual(['600-630 Standard @ Exam 1, Elm Street', '630-660 Standard @ Exam 1, Elm Street', '660-700 New patient @ Exam 2, Elm Street']);
    // And six of 10 minutes.
    const shorter = setVisitType(busy, 'v20', { minutes: 10 });
    expect(shorter.schedule.blocks.filter((b) => b.what.kind === 'visit' && b.what.visitTypeId === 'v20').length).toBe(6);
    // A run too short for even one of the new length is removed.
    const gone = setVisitType(busy, 'v20', { minutes: 90 });
    expect(gone.schedule.blocks.some((b) => b.what.kind === 'visit' && b.what.visitTypeId === 'v20')).toBe(false);
    for (const change of [longer, shorter, gone]) {
      expect(noOverlaps(change.schedule)).toBe(true);
      expect(valid(change.schedule)).toBe(true);
    }
  });

  it('removing a visit type removes its appointments', () => {
    const change = removeVisitType(busy, 'v20');
    expect(change.touched).toBe(3);
    expect(change.schedule.departments[0]?.visitTypes.map((t) => t.id)).toEqual(['v40']);
    expect(valid(change.schedule)).toBe(true);
  });

  it('removing a department removes its visit types and their appointments and moves its people', () => {
    const change = removeDepartment(busy, 'd2');
    expect(change.touched).toBe(2);
    expect(change.schedule.departments.map((d) => d.id)).toEqual(['d1']);
    expect(change.schedule.people[1]?.departmentId).toBe('d1');
    expect(dayOf(change.schedule, 'pB', 4)).toEqual(['540-600 Meeting @ Annex']);
    expect(valid(change.schedule)).toBe(true);
  });

  it('refuses to remove the only department while people belong to it', () => {
    const one = removeDepartment(busy, 'd2').schedule;
    const refused = removeDepartment(one, 'd1');
    expect(refused.schedule).toBe(one);
    expect(refused.problem).toBeTruthy();
    const empty = removePerson(removePerson(one, 'pA').schedule, 'pB').schedule;
    expect(removeDepartment(empty, 'd1').schedule.departments).toEqual([]);
  });
});

describe('Schedule Designer: activities', () => {
  it('adds, changes and removes an activity', () => {
    const added = addActivity(base, { name: 'Huddle' });
    expect(added.activities[3]).toMatchObject({ name: 'Huddle', paid: true });
    expect(addActivity(base).activities[3]?.name).toBe('New activity');
    const changed = setActivity(base, 'aLunch', { paid: true, colour: 6, name: 'Break' });
    expect(changed.activities[2]).toEqual({ id: 'aLunch', name: 'Break', colour: 6, paid: true });
    const change = removeActivity(busy, 'aAdmin');
    expect(change.touched).toBe(2);
    expect(change.schedule.activities.map((a) => a.id)).toEqual(['aMeet', 'aLunch']);
    expect(valid(change.schedule)).toBe(true);
  });

  it('removing an activity also takes it out of every person\'s set-aside hours', () => {
    const change = removeActivity(busy, 'aAdmin');
    expect(change.schedule.people.map((p) => p.setAside)).toEqual([[{ activityId: 'aMeet', hours: 2 }], [{ activityId: 'aMeet', hours: 2 }]]);
    // An activity nobody has hours set aside for leaves the people as they were.
    const lunch = removeActivity(busy, 'aLunch');
    expect(lunch.schedule.people).toEqual(busy.people);
    expect(lunch.touched).toBe(1);
  });
});

describe('Schedule Designer: people', () => {
  it('adds a person with their department\'s grid', () => {
    const s = addPerson(base, { name: 'Casey Lund', departmentId: 'd2', role: 'Counsellor' });
    expect(s.people[2]).toMatchObject({ name: 'Casey Lund', role: 'Counsellor', departmentId: 'd2', step: 15, contractHours: 40, setAside: [], careFactor: null, slotsPerHour: null, ramping: false });
    expect(addPerson(base, { careFactor: 0.9, slotsPerHour: 20, ramping: true }).people[2]).toMatchObject({ careFactor: 0.9, slotsPerHour: 12, ramping: true });
    expect(addPerson(base).people[2]).toMatchObject({ name: 'New person', departmentId: 'd1', step: 20 });
    expect(addPerson(base, { departmentId: 'nope' })).toBe(base);
    expect(valid(s)).toBe(true);
  });

  it('changes a person\'s details and keeps the hours sensible', () => {
    const s = setPerson(base, 'pA', { name: 'Avery Q.', contractHours: 36.456, departmentId: 'd2' });
    expect(s.people[0]).toEqual({ id: 'pA', name: 'Avery Q.', role: 'Physician', kind: 'provider', departmentId: 'd2', step: 20, contractHours: 36.46, setAside: base.people[0]?.setAside, careFactor: null, slotsPerHour: null, ramping: false, worksWith: [], work: [] });
    expect(setPerson(base, 'pA', { contractHours: 500 }).people[0]?.contractHours).toBe(168);
    expect(setPerson(base, 'pA', { contractHours: -3 }).people[0]?.contractHours).toBe(0);
    expect(setPerson(base, 'pA', { contractHours: Number.NaN })).toBe(base);
    expect(setPerson(base, 'pA', { departmentId: 'nope' })).toBe(base);
    expect(setPerson(base, 'pA', { name: 'Avery Quill' })).toBe(base);
  });

  it('gives a person their own care factor and slots in an hour, takes them away again, and marks them ramping', () => {
    const own = setPerson(base, 'pA', { careFactor: 0.75, slotsPerHour: 2.5, ramping: true });
    expect(own.people[0]).toMatchObject({ careFactor: 0.75, slotsPerHour: 2.5, ramping: true, contractHours: 34 });
    expect(own.people[1]).toBe(base.people[1]);
    expect(valid(own)).toBe(true);
    const back = setPerson(own, 'pA', { careFactor: null, slotsPerHour: null, ramping: false });
    expect(back.people[0]).toEqual(base.people[0]);
    // Out of range values are brought to the nearest one allowed.
    expect(setPerson(base, 'pA', { careFactor: 3, slotsPerHour: 0.2 }).people[0]).toMatchObject({ careFactor: 1, slotsPerHour: 1 });
    expect(setPerson(base, 'pA', { careFactor: -1 }).people[0]?.careFactor).toBe(0.01);
    // Nothing to do, or nothing usable, hands back the same schedule.
    expect(setPerson(base, 'pA', { careFactor: null, slotsPerHour: null, ramping: false })).toBe(base);
    expect(setPerson(own, 'pA', { careFactor: 0.75, ramping: true })).toBe(own);
    expect(setPerson(base, 'pA', { careFactor: Number.NaN })).toBe(base);
    expect(setPerson(base, 'pA', { slotsPerHour: Number.NaN })).toBe(base);
  });

  it('sets, changes and removes the hours set aside for an activity', () => {
    let s = setAsideHours(base, 'pA', 'aAdmin', 6.5);
    expect(s.people[0]?.setAside).toEqual([{ activityId: 'aAdmin', hours: 6.5 }, { activityId: 'aMeet', hours: 2 }]);
    s = setAsideHours(s, 'pA', 'aLunch', 1);
    expect(s.people[0]?.setAside[2]).toEqual({ activityId: 'aLunch', hours: 1 });
    expect(s.people[1]).toBe(base.people[1]);
    s = removeSetAside(s, 'pA', 'aMeet');
    expect(s.people[0]?.setAside.map((line) => line.activityId)).toEqual(['aAdmin', 'aLunch']);
    expect(valid(s)).toBe(true);
    // Hours stay from 0 to 168, and a request that makes no sense changes nothing.
    expect(setAsideHours(base, 'pA', 'aAdmin', -2).people[0]?.setAside[0]?.hours).toBe(0);
    expect(setAsideHours(base, 'pA', 'aAdmin', 4)).toBe(base);
    expect(setAsideHours(base, 'pA', 'no-such-activity', 4)).toBe(base);
    expect(setAsideHours(base, 'nobody', 'aAdmin', 4)).toBe(base);
    expect(setAsideHours(base, 'pA', 'aAdmin', Number.NaN)).toBe(base);
    expect(removeSetAside(base, 'pA', 'aLunch')).toBe(base);
  });

  it('removing a person removes their week', () => {
    const change = removePerson(busy, 'pA');
    expect(change.touched).toBe(7);
    expect(change.schedule.people.map((p) => p.id)).toEqual(['pB']);
    expect(change.schedule.blocks.every((b) => b.personId === 'pB')).toBe(true);
  });

  it('a copy of a person comes right after them, with the same week and no rooms', () => {
    const s = duplicatePerson(busy, 'pA');
    expect(s.people.map((p) => p.name)).toEqual(['Avery Quill', 'Avery Quill (copy)', 'Blake Rowan']);
    const copy = s.people[1];
    expect(copy).toMatchObject({ role: 'Physician', departmentId: 'd1', step: 20, contractHours: 34, setAside: busy.people[0]?.setAside });
    expect(copy?.id).not.toBe('pA');
    // Two people cannot share a room at one time, so the copy keeps the site and drops the room.
    expect(dayOf(s, copy?.id ?? '', 0)).toEqual(['480-600 Admin time @ Elm Street', '600-620 Standard @ Elm Street', '620-640 Standard @ Elm Street', '640-660 Standard @ Elm Street', '660-700 New patient @ Elm Street']);
    expect(dayOf(s, 'pA', 0)).toEqual(dayOf(busy, 'pA', 0));
    expect(new Set(s.blocks.map((b) => b.id)).size).toBe(s.blocks.length);
    expect(valid(s)).toBe(true);
    expect(duplicatePerson(busy, 'nope')).toBe(busy);
    // The copy keeps the person's own standards and whether they are ramping.
    const own = setPerson(busy, 'pA', { careFactor: 0.6, slotsPerHour: 2, ramping: true });
    expect(duplicatePerson(own, 'pA').people[1]).toMatchObject({ careFactor: 0.6, slotsPerHour: 2, ramping: true });
  });
});

describe('Schedule Designer: no edit changes the schedule it was given', () => {
  it('leaves the frozen input as it was', () => {
    const before = JSON.stringify(busy);
    setDays(busy, [0]);
    removeSite(busy, 's1');
    removeRoom(busy, 'r1');
    removeDepartment(busy, 'd1');
    removeVisitType(busy, 'v40');
    setVisitType(busy, 'v20', { minutes: 40 });
    removeActivity(busy, 'aMeet');
    removePerson(busy, 'pB');
    duplicatePerson(busy, 'pB');
    setPerson(busy, 'pB', { role: 'Therapist' });
    setAsideHours(busy, 'pB', 'aAdmin', 1);
    removeSetAside(busy, 'pB', 'aAdmin');
    setHours(busy, 420, 1080);
    setDepartmentStandards(busy, 'd1', { careFactor: 0.8, slotsPerHour: 4 });
    setDepartmentStep(busy, 'd1', 15);
    setTolerance(busy, 3);
    setPerson(busy, 'pB', { careFactor: 0.5, slotsPerHour: 2, ramping: true });
    expect(JSON.stringify(busy)).toBe(before);
  });
});
