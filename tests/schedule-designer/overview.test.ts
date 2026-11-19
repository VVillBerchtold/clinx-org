import { describe, expect, it } from 'vitest';
import { setDepartmentStandards, setPerson, setTolerance } from '../../src/scripts/schedule-designer/engine/edit';
import { overview } from '../../src/scripts/schedule-designer/engine/overview';
import { NOWHERE, REMOTE, activity, block, room, small, visit, withBlocks } from './fixtures/small';

const base = small();
const EXAM1 = room('s1', 'r1');

// Avery Quill's Monday: a meeting 8:00-9:00, appointments at Elm Street 9:00-12:00, lunch 12:00-1:00,
// remote appointments 1:00-2:00, then admin at the Annex 2:00-5:00.
// Tuesday: one long admin block from 11:00 am to 2:00 pm, which sits across noon.
// Wednesday morning: equal time in appointments and in a meeting.
const s = withBlocks(base, [
  block('m1', 'pA', 0, 480, 60, activity('aMeet'), room('s1', null)),
  ...Array.from({ length: 9 }, (_, i) => block(`v${i}`, 'pA', 0, 540 + i * 20, 20, visit('v20'), EXAM1)),
  block('l1', 'pA', 0, 720, 60, activity('aLunch'), NOWHERE),
  block('r1', 'pA', 0, 780, 20, visit('v20'), REMOTE),
  block('r2', 'pA', 0, 800, 40, visit('v40'), REMOTE),
  block('d1', 'pA', 0, 840, 180, activity('aAdmin'), room('s2', 'r3')),
  block('t1', 'pA', 1, 660, 180, activity('aAdmin'), REMOTE),
  block('w1', 'pA', 2, 480, 40, visit('v40'), EXAM1),
  block('w2', 'pA', 2, 520, 40, activity('aMeet'), NOWHERE),
]);
const rows = overview(s);
const avery = rows[0];

describe('Schedule Designer: the overview', () => {
  it('has a row for each person, in order, with their hours against contract and target', () => {
    expect(rows.map((row) => row.name)).toEqual(['Avery Quill', 'Blake Rowan']);
    expect(avery).toMatchObject({ personId: 'pA', role: 'Physician', departmentName: 'Primary care', targetMinutes: 1680, contractMinutes: 2040 });
    // Care: 180 + 60 on Monday and 40 on Wednesday. Paid adds the meetings and the admin, not the lunch.
    expect(avery?.careMinutes).toBe(280);
    expect(avery?.paidMinutes).toBe(280 + 60 + 180 + 180 + 40);
    expect(avery?.days.map((d) => d.day)).toEqual([0, 1, 2, 3, 4]);
  });

  it('names the main kind of time and the main place of a morning and an afternoon', () => {
    expect(avery?.days[0]?.morning).toEqual({ kind: 'care', label: 'Patient care', place: 'Elm Street', say: 'Patient care, Elm Street', colour: 1, minutes: 180 });
    expect(avery?.days[0]?.afternoon).toEqual({ kind: 'other', label: 'Admin time', place: 'Annex', say: 'Admin time, Annex', colour: 11, minutes: 180 });
  });

  it('splits a block that sits across noon between the two halves', () => {
    expect(avery?.days[1]?.morning).toMatchObject({ label: 'Admin time', say: 'Admin time, remote', minutes: 60 });
    expect(avery?.days[1]?.afternoon).toMatchObject({ label: 'Admin time', place: 'Remote', minutes: 120 });
  });

  it('puts patient care first when two kinds take equal time, and leaves the place out when there is none', () => {
    expect(avery?.days[2]?.morning).toMatchObject({ kind: 'care', say: 'Patient care, Elm Street', colour: 2 });
    const meetingOnly = overview(withBlocks(base, [block('w2', 'pA', 2, 520, 40, activity('aMeet'), NOWHERE)]))[0];
    expect(meetingOnly?.days[2]?.morning).toMatchObject({ kind: 'other', say: 'Meeting', place: '' });
  });

  it('carries the roster of a slot tracker for each person', () => {
    // Avery: contract 34, factor 1, 6 hours set aside: 28 hours, 84 slots at 3 an hour. 280 minutes of patient care are 14 slots.
    expect(avery).toMatchObject({ contractHours: 34, careFactor: 1, setAsideHours: 6, capacityHours: 28, slotsPerHour: 3, target: 84, actual: 14, variance: -70, verdict: 'under', ramping: false });
    // Blake: contract 40, 10 set aside, 4 slots an hour, and nothing planned yet.
    expect(rows[1]).toMatchObject({ contractHours: 40, careFactor: 1, setAsideHours: 10, capacityHours: 30, slotsPerHour: 4, target: 120, actual: 0, variance: -120, verdict: 'needs-schedule', ramping: false });
  });

  it('follows the standards, a person\'s own values, the tolerance and the ramping mark', () => {
    let changed = setDepartmentStandards(s, 'd1', { careFactor: 0.8, slotsPerHour: 3 });
    // 34 x 0.8 - 6 is 21.2 hours: 63.6, so 64 slots.
    expect(overview(changed)[0]).toMatchObject({ careFactor: 0.8, capacityHours: 21.2, target: 64, actual: 14, variance: -50, verdict: 'under' });
    changed = setPerson(changed, 'pA', { careFactor: 0.3, slotsPerHour: 4 });
    // 34 x 0.3 - 6 is 4.2 hours: 16.8, so 17 slots. 280 minutes at 4 an hour are 18.7 slots.
    expect(overview(changed)[0]).toMatchObject({ careFactor: 0.3, slotsPerHour: 4, capacityHours: 4.2, target: 17, actual: 18.7, variance: 1.7, verdict: 'over' });
    expect(overview(setTolerance(changed, 2))[0]?.verdict).toBe('on-target');
    expect(overview(setPerson(changed, 'pA', { ramping: true }))[0]).toMatchObject({ verdict: 'ramping', ramping: true });
    expect(overview(setPerson(changed, 'pA', { contractHours: 0 }))[0]).toMatchObject({ contractHours: 0, capacityHours: 0, target: 0, verdict: 'needs-contract' });
  });

  it('says so when a half has nothing in it', () => {
    expect(avery?.days[2]?.afternoon).toEqual({ kind: 'empty', label: '', place: '', say: 'Nothing planned', colour: null, minutes: 0 });
    expect(rows[1]?.days.every((d) => d.morning.kind === 'empty' && d.afternoon.kind === 'empty')).toBe(true);
    expect(rows[1]).toMatchObject({ careMinutes: 0, paidMinutes: 0 });
  });
});
