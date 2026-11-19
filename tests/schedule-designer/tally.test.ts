import { describe, expect, it } from 'vitest';
import { paint, removeSetAside, setAsideHours, setDepartmentStandards, setPerson, setTolerance } from '../../src/scripts/schedule-designer/engine/edit';
import { VERDICT_NAMES, capacityHours, careTarget, slotTarget, standardsOf, tallyClinic, tallyPerson } from '../../src/scripts/schedule-designer/engine/tally';
import { hoursOf } from '../../src/scripts/schedule-designer/engine/time';
import type { Day, Schedule } from '../../src/scripts/schedule-designer/engine/types';
import { NOWHERE, REMOTE, activity, room, small, visit } from './fixtures/small';

const base = small();
const EXAM1 = room('s1', 'r1');

/** Paints `count` twenty-minute appointments for the first person from 8:00 am on one day. */
function slots(s: Schedule, day: Day, count: number, where = EXAM1): Schedule {
  return paint(s, { personId: 'pA', day, from: 480, to: 480 + count * 20, what: visit('v20'), where });
}

describe('Schedule Designer: tallies, the arithmetic of the old sheet', () => {
  // The owner's old sheet counted slots a day, hours a day as slots / 3, the week's total, the
  // contract, the hours short and the slots needed, and on-site and remote spots.
  // Here: 79 twenty-minute slots in a week, 13 of them remote, against a contract of 34 hours.
  let week = slots(base, 0, 17);
  week = slots(week, 1, 16);
  week = slots(week, 2, 16);
  week = slots(week, 3, 17);
  week = slots(week, 4, 13, REMOTE);
  const tally = tallyPerson(week, 'pA');

  it('counts 79 slots as 26.33 hours of patient care', () => {
    expect(tally?.week.appointments).toBe(79);
    expect(tally?.week.careMinutes).toBe(1580);
    expect(hoursOf(tally?.week.careMinutes ?? 0)).toBe(26.33);
    expect((tally?.week.careMinutes ?? 0) / 60).toBeCloseTo(79 / 3, 10);
  });

  it('counts each day: slots, and hours as slots / 3', () => {
    expect(tally?.days.map((day) => day.appointments)).toEqual([17, 16, 16, 17, 13]);
    expect(tally?.days.map((day) => hoursOf(day.careMinutes))).toEqual([5.67, 5.33, 5.33, 5.67, 4.33]);
    expect(tally?.days.map((day) => day.day)).toEqual([0, 1, 2, 3, 4]);
  });

  it('counts 66 on site and 13 remote', () => {
    expect(tally?.week.onSite).toBe(66);
    expect(tally?.week.remote).toBe(13);
    expect(tally?.week.noPlace).toBe(0);
    expect(tally?.days[4]).toMatchObject({ onSite: 0, remote: 13 });
  });

  it('sets the week against a contract of 34 hours and the 28 hours of patient care that leaves', () => {
    // 34 contract hours, less 4 set aside for admin and 2 for meetings: 28 hours of patient care needed.
    expect(tally?.contractMinutes).toBe(34 * 60);
    expect(tally?.setAsideMinutes).toBe(6 * 60);
    expect(tally?.targetMinutes).toBe(28 * 60);
    // 28 hours wanted, 26.33 planned: 1.67 hours short, which is 5 more twenty-minute slots.
    expect(tally?.careShortMinutes).toBe(100);
    expect(hoursOf(tally?.careShortMinutes ?? 0)).toBe(1.67);
    expect(tally?.careOverMinutes).toBe(0);
    expect(tally?.standardMinutes).toBe(20);
    expect(tally?.appointmentsNeeded).toBe(5);
    // Nothing else is planned, so the paid hours are the patient care hours: 7.67 short of the contract.
    expect(tally?.week.paidMinutes).toBe(1580);
    expect(tally?.paidShortMinutes).toBe(460);
    expect(tally?.paidOverMinutes).toBe(0);
  });

  it('rounds the appointments needed up, and needs none once the target is met', () => {
    const closer = tallyPerson(setAsideHours(week, 'pA', 'aAdmin', 5.5), 'pA');
    expect(closer?.careShortMinutes).toBe(10);
    expect(closer?.appointmentsNeeded).toBe(1);
    const met = tallyPerson(setAsideHours(week, 'pA', 'aAdmin', 12), 'pA');
    expect(met?.careShortMinutes).toBe(0);
    expect(met?.careOverMinutes).toBe(380);
    expect(met?.appointmentsNeeded).toBe(0);
  });
});

describe('Schedule Designer: tallies, a mixed week worked by hand', () => {
  // Blake Rowan, 15 minute grid, contract 40, target 30.
  // Monday:  admin 8:00-9:00 (paid 60), six 30 minute visits 9:00-12:00 in the Consult room (180),
  //          lunch 12:00-1:00 (unpaid 60), two 60 minute visits 1:00-3:00 remote (120),
  //          meeting 3:00-4:30 (paid 90).
  // Tuesday: one 60 minute visit 9:00-10:00 at the Annex with no room, one 30 minute visit with no place.
  let s = paint(base, { personId: 'pB', day: 0, from: 480, to: 540, what: activity('aAdmin'), where: NOWHERE });
  s = paint(s, { personId: 'pB', day: 0, from: 540, to: 720, what: visit('v30'), where: room('s2', 'r3') });
  s = paint(s, { personId: 'pB', day: 0, from: 720, to: 780, what: activity('aLunch'), where: NOWHERE });
  s = paint(s, { personId: 'pB', day: 0, from: 780, to: 900, what: visit('v60'), where: REMOTE });
  s = paint(s, { personId: 'pB', day: 0, from: 900, to: 990, what: activity('aMeet'), where: room('s2', null) });
  s = paint(s, { personId: 'pB', day: 1, from: 540, to: 600, what: visit('v60'), where: room('s2', null) });
  s = paint(s, { personId: 'pB', day: 1, from: 600, to: 630, what: visit('v30'), where: NOWHERE });
  // Someone else's week must not be counted.
  s = paint(s, { personId: 'pA', day: 0, from: 480, to: 600, what: visit('v20'), where: EXAM1 });
  const tally = tallyPerson(s, 'pB');

  it('adds up Monday', () => {
    // Counselling counts 4 slots in an hour, so 300 minutes of patient care are 20 slots.
    expect(tally?.days[0]).toEqual({ day: 0, appointments: 8, careMinutes: 300, otherPaidMinutes: 150, withMinutes: 0, unpaidMinutes: 60, paidMinutes: 450, onSite: 6, remote: 2, noPlace: 0, slots: 20, workMinutes: null, openMinutes: null });
  });

  it('adds up Tuesday and an empty Wednesday', () => {
    expect(tally?.days[1]).toEqual({ day: 1, appointments: 2, careMinutes: 90, otherPaidMinutes: 0, withMinutes: 0, unpaidMinutes: 0, paidMinutes: 90, onSite: 1, remote: 0, noPlace: 1, slots: 6, workMinutes: null, openMinutes: null });
    expect(tally?.days[2]).toEqual({ day: 2, appointments: 0, careMinutes: 0, otherPaidMinutes: 0, withMinutes: 0, unpaidMinutes: 0, paidMinutes: 0, onSite: 0, remote: 0, noPlace: 0, slots: 0, workMinutes: null, openMinutes: null });
  });

  it('adds up the week', () => {
    expect(tally?.week).toEqual({ appointments: 10, careMinutes: 390, otherPaidMinutes: 150, withMinutes: 0, unpaidMinutes: 60, paidMinutes: 540, onSite: 7, remote: 2, noPlace: 1 });
    expect(tally?.paidShortMinutes).toBe(40 * 60 - 540);
    expect(tally?.careShortMinutes).toBe(30 * 60 - 390);
    // The department's standard length is its 15 minute grid: 1,410 minutes short is 94 appointments.
    expect(tally?.standardMinutes).toBe(15);
    expect(tally?.appointmentsNeeded).toBe(94);
  });

  it('counts by visit type, the person\'s own department first, with zeros kept', () => {
    expect(tally?.byType).toEqual([
      { visitTypeId: 'v30', name: 'Standard', code: 'S30', minutes: 30, colour: 3, appointments: 7, careMinutes: 210 },
      { visitTypeId: 'v60', name: 'Extended', code: 'EXT', minutes: 60, colour: 4, appointments: 3, careMinutes: 180 },
    ]);
    const borrowed = paint(s, { personId: 'pB', day: 2, from: 540, to: 580, what: visit('v40'), where: REMOTE });
    expect(tallyPerson(borrowed, 'pB')?.byType.map((row) => [row.visitTypeId, row.appointments])).toEqual([['v30', 7], ['v60', 3], ['v40', 1]]);
  });

  it('says when paid time runs over the contract', () => {
    const over = tallyPerson(setPerson(s, 'pB', { contractHours: 8 }), 'pB');
    expect(over?.paidOverMinutes).toBe(60);
    expect(over?.paidShortMinutes).toBe(0);
  });

  it('sets each set-aside line against what is on the week', () => {
    // Blake is allowed 8 hours of admin and 2 of meetings. The week has 1 hour of admin and 1.5 of meetings.
    expect(tally?.setAside).toEqual([
      { activityId: 'aAdmin', name: 'Admin time', colour: 11, paid: true, allowedMinutes: 480, scheduledMinutes: 60 },
      { activityId: 'aMeet', name: 'Meeting', colour: 7, paid: true, allowedMinutes: 120, scheduledMinutes: 90 },
    ]);
    expect(tally?.setAsideMinutes).toBe(600);
    // All the other paid time on the week belongs to a set-aside line.
    expect(tally?.otherPaidNotSetAsideMinutes).toBe(0);
  });

  it('counts paid time that has no set-aside line on its own', () => {
    const loose = tallyPerson(removeSetAside(s, 'pB', 'aMeet'), 'pB');
    expect(loose?.setAside.map((line) => line.activityId)).toEqual(['aAdmin']);
    expect(loose?.otherPaidNotSetAsideMinutes).toBe(90);
    expect(loose?.targetMinutes).toBe(32 * 60);
  });

  it('shows an unpaid activity with hours set aside as unpaid, and keeps its time out of the paid count', () => {
    const lunch = tallyPerson(setAsideHours(s, 'pB', 'aLunch', 1), 'pB');
    expect(lunch?.setAside[2]).toEqual({ activityId: 'aLunch', name: 'Lunch', colour: 12, paid: false, allowedMinutes: 60, scheduledMinutes: 60 });
    expect(lunch?.otherPaidNotSetAsideMinutes).toBe(0);
    expect(lunch?.week.paidMinutes).toBe(540);
  });

  it('gives nothing for a person who is not in the schedule', () => {
    expect(tallyPerson(s, 'nobody')).toBeUndefined();
  });

  it('counts the clinic: appointments by day and by type', () => {
    const clinic = tallyClinic(s);
    expect(clinic.days).toEqual([0, 1, 2, 3, 4]);
    expect(clinic.byDay).toEqual([14, 2, 0, 0, 0]);
    expect(clinic.careMinutesByDay).toEqual([420, 90, 0, 0, 0]);
    expect(clinic.appointments).toBe(16);
    expect(clinic.careMinutes).toBe(510);
    expect(clinic.types.map((row) => [row.departmentName, row.name, row.byDay, row.week])).toEqual([
      ['Primary care', 'Standard', [6, 0, 0, 0, 0], 6],
      ['Primary care', 'New patient', [0, 0, 0, 0, 0], 0],
      ['Counselling', 'Standard', [6, 1, 0, 0, 0], 7],
      ['Counselling', 'Extended', [2, 1, 0, 0, 0], 3],
    ]);
  });
});

describe('Schedule Designer: the patient care a person needs', () => {
  it('is the contract hours less the hours set aside, in minutes, when the care factor is 1', () => {
    // Avery: 34 less 4 and 2. Blake: 40 less 8 and 2.
    expect(careTarget(base, 'pA')).toBe(28 * 60);
    expect(careTarget(base, 'pB')).toBe(30 * 60);
    expect(tallyPerson(base, 'pA')?.targetMinutes).toBe(careTarget(base, 'pA'));
  });

  it('follows the contract and each set-aside line', () => {
    expect(careTarget(setPerson(base, 'pA', { contractHours: 20 }), 'pA')).toBe(14 * 60);
    expect(careTarget(setAsideHours(base, 'pA', 'aAdmin', 4.25), 'pA')).toBe(34 * 60 - 255 - 120);
    expect(careTarget(setAsideHours(base, 'pA', 'aLunch', 1), 'pA')).toBe(27 * 60);
    expect(careTarget(removeSetAside(removeSetAside(base, 'pA', 'aAdmin'), 'pA', 'aMeet'), 'pA')).toBe(34 * 60);
  });

  it('is never below zero, and is zero for a person who is not in the schedule', () => {
    expect(careTarget(setAsideHours(base, 'pA', 'aAdmin', 100), 'pA')).toBe(0);
    expect(careTarget(setPerson(base, 'pA', { contractHours: 0 }), 'pA')).toBe(0);
    expect(careTarget(base, 'nobody')).toBe(0);
  });
});

describe('Schedule Designer: the slot tracker method', () => {
  // The method's own worked case: contract 34, factor 0.8, 1 hour set aside, 3 slots in an hour.
  let worked = setDepartmentStandards(base, 'd1', { careFactor: 0.8, slotsPerHour: 3 });
  worked = removeSetAside(removeSetAside(worked, 'pA', 'aAdmin'), 'pA', 'aMeet');
  worked = setAsideHours(worked, 'pA', 'aMeet', 1);
  /** The worked case with `count` twenty-minute appointments on Avery's week, at most 24 a day. */
  const withSlots = (count: number, s: Schedule = worked): Schedule => {
    let out = s;
    for (let day = 0, left = count; left > 0; day++, left -= 24) out = paint(out, { personId: 'pA', day: day as Day, from: 480, to: 480 + Math.min(24, left) * 20, what: visit('v20'), where: REMOTE });
    return out;
  };

  it('gives a person their own standards where they have them, else the department\'s', () => {
    expect(standardsOf(base, 'pA')).toEqual({ careFactor: 1, slotsPerHour: 3 });
    expect(standardsOf(base, 'pB')).toEqual({ careFactor: 1, slotsPerHour: 4 });
    expect(standardsOf(worked, 'pA')).toEqual({ careFactor: 0.8, slotsPerHour: 3 });
    const own = setPerson(worked, 'pA', { careFactor: 0.5, slotsPerHour: 2 });
    expect(standardsOf(own, 'pA')).toEqual({ careFactor: 0.5, slotsPerHour: 2 });
    expect(standardsOf(setPerson(own, 'pA', { careFactor: null }), 'pA')).toEqual({ careFactor: 0.8, slotsPerHour: 2 });
    expect(standardsOf(setPerson(own, 'pA', { slotsPerHour: null }), 'pA')).toEqual({ careFactor: 0.5, slotsPerHour: 3 });
    expect(standardsOf(base, 'nobody')).toEqual({ careFactor: 1, slotsPerHour: 3 });
  });

  it('works the method\'s own case: 34 x 0.8 - 1 is 26.2 hours, and at 3 an hour a target of 79 slots', () => {
    expect(capacityHours(worked, 'pA')).toBe(26.2);
    expect(careTarget(worked, 'pA')).toBe(1572);
    expect(slotTarget(worked, 'pA')).toBe(79);
    expect(tallyPerson(worked, 'pA')?.targetMinutes).toBe(1572);
    expect(tallyPerson(worked, 'pA')?.slots.target).toBe(79);
  });

  it('never lets the capacity fall below zero, and gives nothing for a person who is not there', () => {
    const buried = setAsideHours(worked, 'pA', 'aAdmin', 60);
    expect(capacityHours(buried, 'pA')).toBe(0);
    expect(careTarget(buried, 'pA')).toBe(0);
    expect(slotTarget(buried, 'pA')).toBe(0);
    expect([capacityHours(worked, 'nobody'), careTarget(worked, 'nobody'), slotTarget(worked, 'nobody')]).toEqual([0, 0, 0]);
  });

  it('rounds the target to a whole slot, a half going up', () => {
    // 34 x 0.8 - 1.2 is 26 hours: 78 slots. 34 x 0.8 - 0.7 is 26.5 hours: 79.5, so 80.
    expect(slotTarget(setAsideHours(worked, 'pA', 'aMeet', 1.2), 'pA')).toBe(78);
    expect(slotTarget(setAsideHours(worked, 'pA', 'aMeet', 0.7), 'pA')).toBe(80);
    // At 4 slots an hour 26.2 hours are 104.8, so 105.
    expect(slotTarget(setPerson(worked, 'pA', { slotsPerHour: 4 }), 'pA')).toBe(105);
  });

  it('counts the designed week in slots: patient care minutes x slots in an hour / 60, to one decimal', () => {
    // A 40 minute visit at 3 slots an hour is 2 slots.
    const one = paint(worked, { personId: 'pA', day: 0, from: 480, to: 520, what: visit('v40'), where: REMOTE });
    expect(tallyPerson(one, 'pA')?.slots.actual).toBe(2);
    expect(tallyPerson(one, 'pA')?.days.map((day) => day.slots)).toEqual([2, 0, 0, 0, 0]);
    // A 20 minute visit at 4 slots an hour is 1.3 slots, and at 2 an hour 0.7.
    const short = paint(worked, { personId: 'pA', day: 0, from: 480, to: 500, what: visit('v20'), where: REMOTE });
    expect(tallyPerson(setPerson(short, 'pA', { slotsPerHour: 4 }), 'pA')?.slots.actual).toBe(1.3);
    expect(tallyPerson(setPerson(short, 'pA', { slotsPerHour: 2 }), 'pA')?.slots.actual).toBe(0.7);
    // Other time is not patient care and adds no slots.
    const admin = paint(short, { personId: 'pA', day: 1, from: 480, to: 600, what: activity('aAdmin'), where: NOWHERE });
    expect(tallyPerson(admin, 'pA')?.slots.actual).toBe(1);
    expect(tallyPerson(admin, 'pA')?.days[1]?.slots).toBe(0);
  });

  it('sets actual against target: on target, under and over, with the variance', () => {
    expect(tallyPerson(withSlots(79), 'pA')?.slots).toEqual({ target: 79, actual: 79, variance: 0, verdict: 'on-target' });
    expect(tallyPerson(withSlots(76), 'pA')?.slots).toEqual({ target: 79, actual: 76, variance: -3, verdict: 'under' });
    expect(tallyPerson(withSlots(84), 'pA')?.slots).toEqual({ target: 79, actual: 84, variance: 5, verdict: 'over' });
    expect(tallyPerson(withSlots(79), 'pA')?.days.map((day) => day.slots)).toEqual([24, 24, 24, 7, 0]);
    // The hour fields are still there beside the slots.
    expect(tallyPerson(withSlots(76), 'pA')).toMatchObject({ contractMinutes: 2040, setAsideMinutes: 60, targetMinutes: 1572, careShortMinutes: 52 });
  });

  it('counts a week inside the tolerance as on target', () => {
    const loose = setTolerance(worked, 2);
    expect([76, 77, 79, 81, 82].map((count) => tallyPerson(withSlots(count, loose), 'pA')?.slots.verdict)).toEqual(['under', 'on-target', 'on-target', 'on-target', 'over']);
    // The variance is kept to one decimal, so a tolerance of 0.3 holds for 0.3 exactly.
    const fine = setTolerance(setPerson(worked, 'pA', { slotsPerHour: 4 }), 0.3);
    // 79 visits at 4 an hour are 105.3 slots against 105.
    expect(tallyPerson(withSlots(79, fine), 'pA')?.slots).toEqual({ target: 105, actual: 105.3, variance: 0.3, verdict: 'on-target' });
  });

  it('asks the questions in order: ramping, then no contract, then no patient care, then the numbers', () => {
    const verdict = (s: Schedule) => tallyPerson(s, 'pA')?.slots.verdict;
    expect(verdict(worked)).toBe('needs-schedule');
    // Other time alone is still a week with no patient care.
    expect(verdict(paint(worked, { personId: 'pA', day: 0, from: 480, to: 600, what: activity('aAdmin'), where: NOWHERE }))).toBe('needs-schedule');
    const noContract = setPerson(withSlots(10), 'pA', { contractHours: 0 });
    expect(verdict(noContract)).toBe('needs-contract');
    expect(verdict(setPerson(worked, 'pA', { contractHours: 0 }))).toBe('needs-contract');
    expect(verdict(setPerson(noContract, 'pA', { ramping: true }))).toBe('ramping');
    expect(verdict(setPerson(withSlots(40), 'pA', { ramping: true }))).toBe('ramping');
    expect(tallyPerson(setPerson(withSlots(40), 'pA', { ramping: true }), 'pA')?.slots).toMatchObject({ target: 79, actual: 40, variance: -39 });
  });

  it('has a name for each verdict', () => {
    expect(VERDICT_NAMES).toEqual({ 'on-target': 'On target', over: 'Over', under: 'Under', ramping: 'Ramping', 'needs-contract': 'Needs contract', 'needs-schedule': 'Needs schedule', support: 'Support staff' });
  });

  it('adds up each department: its people, those counted, and their target and actual slots', () => {
    // Avery has 76 of 79 slots. Blake (Counselling, factor 1, 4 an hour, 30 hours) has nothing planned yet.
    let s = withSlots(76);
    expect(tallyClinic(s).departments).toEqual([
      { departmentId: 'd1', name: 'Primary care', careFactor: 0.8, slotsPerHour: 3, people: 1, supportStaff: 0, peopleCounted: 1, targetSlots: 79, actualSlots: 76, variance: -3 },
      { departmentId: 'd2', name: 'Counselling', careFactor: 1, slotsPerHour: 4, people: 1, supportStaff: 0, peopleCounted: 0, targetSlots: 0, actualSlots: 0, variance: 0 },
    ]);
    // Blake's week gets six 30 minute visits: 12 slots against 120. A ramping person is left out of the sums.
    s = paint(s, { personId: 'pB', day: 0, from: 540, to: 720, what: visit('v30'), where: REMOTE });
    expect(tallyClinic(s).departments[1]).toMatchObject({ people: 1, peopleCounted: 1, targetSlots: 120, actualSlots: 12, variance: -108 });
    expect(tallyClinic(setPerson(s, 'pB', { ramping: true })).departments[1]).toMatchObject({ people: 1, peopleCounted: 0, targetSlots: 0, actualSlots: 0, variance: 0 });
    // A second person in Primary care, on target, is added to the sums.
    const two = setPerson(setPerson(s, 'pB', { departmentId: 'd1' }), 'pB', { contractHours: 5, slotsPerHour: 4 });
    expect(tallyClinic(two).departments[0]).toMatchObject({ people: 2, peopleCounted: 2, targetSlots: 79 + 0, actualSlots: 76 + 12 });
    expect(tallyClinic(two).departments[1]).toMatchObject({ people: 0, peopleCounted: 0 });
  });
});
