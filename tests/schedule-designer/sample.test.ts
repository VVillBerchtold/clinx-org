import { describe, expect, it } from 'vitest';
import { check } from '../../src/scripts/schedule-designer/engine/check';
import { erase, paint } from '../../src/scripts/schedule-designer/engine/edit';
import { endOf } from '../../src/scripts/schedule-designer/engine/find';
import { overview } from '../../src/scripts/schedule-designer/engine/overview';
import { roomHours } from '../../src/scripts/schedule-designer/engine/rooms';
import { sampleSchedule } from '../../src/scripts/schedule-designer/engine/sample';
import { tallyClinic, tallyPerson } from '../../src/scripts/schedule-designer/engine/tally';
import { coverage, planWith, teamHours } from '../../src/scripts/schedule-designer/engine/team';
import { onGrid } from '../../src/scripts/schedule-designer/engine/time';
import { validate } from '../../src/scripts/schedule-designer/engine/validate';
import { blocksOutsideWork, workOutsideHours, workText } from '../../src/scripts/schedule-designer/engine/work';

const s = sampleSchedule();
const findings = check(s);
const person = (name: string) => s.people.find((p) => p.name === name);
const tallyOf = (name: string) => tallyPerson(s, person(name)?.id ?? '');

describe('Schedule Designer: the sample clinic', () => {
  it('is a schedule the tool accepts, and the same every time', () => {
    expect(validate(s)).toEqual({ schedule: s });
    expect(sampleSchedule()).toEqual(s);
    expect(sampleSchedule()).not.toBe(s);
  });

  it('has two sites with rooms, three departments, eight providers and three support staff', () => {
    expect(s.sites.map((site) => site.rooms.length)).toEqual([7, 3]);
    expect(s.departments.map((d) => [d.name, d.step])).toEqual([['Primary care', 20], ['Pediatrics', 15], ['Behavioral health', 15]]);
    expect(s.departments.map((d) => [d.careFactor, d.slotsPerHour])).toEqual([[0.8, 3], [0.85, 4], [0.85, 2]]);
    expect(s.tolerance).toBe(2);
    expect(s.people.filter((p) => p.ramping).map((p) => p.name)).toEqual(['Linnea Farrowby']);
    expect(s.people.every((p) => p.careFactor === null && p.slotsPerHour === null)).toBe(true);
    expect(s.departments[2]?.visitTypes.map((t) => t.minutes).sort()).toEqual([30, 60, 60]);
    expect(s.people.length).toBe(11);
    expect(s.people.map((p) => p.kind)).toEqual(['provider', 'provider', 'provider', 'provider', 'provider', 'provider', 'provider', 'provider', 'support', 'support', 'support']);
    expect(s.people.filter((p) => p.kind === 'support').map((p) => [p.name, p.role, p.contractHours, p.worksWith])).toEqual([
      ['Briony Halvard', 'Medical assistant', 40, ['p-maren']],
      ['Emrys Tolliver', 'Medical assistant', 36, ['p-yusra', 'p-linnea']],
      ['Odalys Wren', 'Nurse care manager', 24, ['p-yusra']],
    ]);
    expect(s.people.every((p) => p.step === s.departments.find((d) => d.id === p.departmentId)?.step)).toBe(true);
    expect(s.days).toEqual([0, 1, 2, 3, 4]);
  });

  it('gives every person a full, believable week that sits on their grid', () => {
    for (const p of s.people) {
      const tally = tallyPerson(s, p.id);
      // Providers see patients and have hours set aside. The support staff have no appointments and nothing set aside.
      if (p.kind === 'provider') {
        expect(tally?.week.appointments, p.name).toBeGreaterThan(20);
        expect(p.setAside.length, p.name).toBeGreaterThanOrEqual(1);
      } else {
        expect(tally?.week.appointments, p.name).toBe(0);
        expect(p.setAside, p.name).toEqual([]);
        expect(tally?.week.withMinutes, p.name).toBeGreaterThan(10 * 60);
      }
      expect(tally?.days.filter((day) => day.paidMinutes > 0).length, p.name).toBeGreaterThanOrEqual(3);
      expect(tally?.paidOverMinutes, p.name).toBe(0);
      expect(tally?.week.paidMinutes, p.name).toBeGreaterThan((tally?.contractMinutes ?? 0) - 61);
    }
    for (const block of s.blocks) {
      const owner = s.people.find((p) => p.id === block.personId);
      // Time with a provider follows the provider's appointments, so it may start between the lines of the support person's own grid.
      if (block.what.kind !== 'with') expect(onGrid(block.start, owner?.step ?? 20, s.dayStart), block.id).toBe(true);
      expect(block.start >= s.dayStart && endOf(block) <= s.dayEnd, block.id).toBe(true);
    }
  });

  it('gives everyone working hours that hold all their time, and that match their contract', () => {
    for (const p of s.people) {
      const tally = tallyPerson(s, p.id);
      expect(p.work.length, p.name).toBeGreaterThan(0);
      expect(blocksOutsideWork(s, p.id), p.name).toEqual([]);
      // Hours at work less the unpaid lunches are the contract hours, so no note about them is written.
      expect(tally?.paidWorkMinutes, p.name).toBe(tally?.contractMinutes);
      for (const stretch of p.work) expect(stretch.from >= s.dayStart && stretch.to <= s.dayEnd, p.name).toBe(true);
    }
    expect(workOutsideHours(s)).toEqual([]);
    // The early starter and the late day keep their shapes, and a day off is a day off.
    expect(workText(s, 'p-sunniva', 0)).toBe('7:00 am to 4:00 pm');
    expect(workText(s, 'p-kofi', 1)).toBe('10:00 am to 7:00 pm');
    expect(workText(s, 'p-sunniva', 1)).toBe('Day off');
    expect(workText(s, 'p-yusra', 2)).toBe('1:00 pm to 3:00 pm');
    expect(s.people.map((p) => (tallyPerson(s, p.id)?.workMinutes ?? 0) / 60)).toEqual([45, 40, 38, 45, 45, 27, 45, 22, 45, 40, 27]);
    // Only Tobin Achterberg has time at work with nothing planned: his empty Thursday hour.
    expect(s.people.map((p) => tallyPerson(s, p.id)?.openMinutes)).toEqual([0, 60, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('has three support staff with time with their providers, and one half day left uncovered on purpose', () => {
    const hoursWith = (id: string) => tallyPerson(s, id)?.withProviders.map((line) => [line.name, line.listed, line.minutes / 60]);
    // Briony Halvard: 28 h with Maren Castellane. Emrys Tolliver: two providers on different days. Odalys Wren: some time with a provider, the rest admin.
    expect(hoursWith('p-briony')).toEqual([['Maren Castellane', true, 28]]);
    expect(tallyPerson(s, 'p-emrys')?.withProviders.map((line) => [line.name, line.byDay])).toEqual([['Yusra Hollin', [400, 0, 0, 0, 220]], ['Linnea Farrowby', [0, 345, 285, 345, 0]]]);
    expect(tallyPerson(s, 'p-odalys')?.withProviders.map((line) => [line.name, line.byDay])).toEqual([['Yusra Hollin', [0, 420, 0, 380, 0]]]);
    expect(['p-briony', 'p-emrys', 'p-odalys'].map((id) => tallyPerson(s, id)?.slots.verdict)).toEqual(['support', 'support', 'support']);
    expect(teamHours(s, 'p-yusra').map((line) => [line.name, line.role, line.minutes])).toEqual([['Emrys Tolliver', 'Medical assistant', 620], ['Odalys Wren', 'Nurse care manager', 800]]);
    // Their time is where a fill would put it: a fill has nothing left to add for any of them.
    for (const [support, provider] of [['p-briony', 'p-maren'], ['p-emrys', 'p-linnea'], ['p-emrys', 'p-yusra'], ['p-odalys', 'p-yusra']] as const) {
      expect(planWith(s, support, provider).addMinutes, `${support} with ${provider}`).toBe(0);
    }
    // Every provider with support staff is covered all week, but for Yusra Hollin's Friday afternoon.
    const uncovered = ['p-maren', 'p-yusra', 'p-linnea'].flatMap((id) => s.days.flatMap((day) => coverage(s, id, day).uncovered.map((span) => [id, day, span.from, span.to])));
    expect(uncovered).toEqual([['p-yusra', 4, 780, 940]]);
  });

  it('keeps its hand-worked totals: 588 appointments and 212.25 hours of patient care, all of them the providers\'', () => {
    const clinic = tallyClinic(s);
    expect([clinic.appointments, clinic.careMinutes]).toEqual([588, 12735]);
    expect(s.blocks.filter((b) => b.what.kind === 'visit').every((b) => s.people.find((p) => p.id === b.personId)?.kind === 'provider')).toBe(true);
    expect(s.blocks.filter((b) => b.what.kind === 'visit').length).toBe(588);
    // The figures the notes quote, 587 appointments and 211.58 h, are those of the round 3 walk through the page:
    // Maren Castellane's Monday cleared from 8:00 to 10:00 am, then three Standard appointments added from 8:00 to 9:00 am.
    const cleared = erase(s, { personId: 'p-maren', day: 0, from: 480, to: 600 });
    const after = tallyClinic(paint(cleared, { personId: 'p-maren', day: 0, from: 480, to: 540, what: { kind: 'visit', visitTypeId: 'vt-pc-std' }, where: { kind: 'site', siteId: 'site-tannery', roomId: 'room-t-exam1' } }));
    expect([after.appointments, after.careMinutes, Math.round((after.careMinutes / 60) * 100) / 100]).toEqual([587, 12695, 211.58]);
  });

  it('shows 6:00 am to 9:00 pm, with one early start and one late finish inside it', () => {
    expect([s.dayStart, s.dayEnd]).toEqual([360, 1260]);
    const span = (name: string, day: number): [number, number] => {
      const own = s.blocks.filter((b) => b.personId === person(name)?.id && b.day === day);
      return [Math.min(...own.map((b) => b.start)), Math.max(...own.map((b) => endOf(b)))];
    };
    // Sunniva Kell's Monday runs 7:00 am to 4:00 pm. Kofi Brantwood's Tuesday runs 10:00 am to 7:00 pm.
    expect(span('Sunniva Kell', 0)).toEqual([420, 960]);
    expect(span('Kofi Brantwood', 1)).toEqual([600, 1140]);
    expect(Math.min(...s.blocks.map((b) => b.start))).toBe(420);
    expect(Math.max(...s.blocks.map((b) => endOf(b)))).toBe(1140);
  });

  it('joins touching blocks of the same activity and place, as painting would', () => {
    for (const a of s.blocks) {
      for (const b of s.blocks) {
        if (a.personId !== b.personId || a.day !== b.day || endOf(a) !== b.start || a.what.kind !== 'activity' || b.what.kind !== 'activity') continue;
        expect(a.what.activityId === b.what.activityId && JSON.stringify(a.where) === JSON.stringify(b.where), `${a.id} and ${b.id}`).toBe(false);
      }
    }
  });

  it('has the deliberate findings and no others', () => {
    expect(findings.map((f) => [f.level, f.say])).toEqual([
      ['fix', 'Tobin Achterberg and Linnea Farrowby are both in Exam 2 at Tannery Row on Tuesday from 8:15 am to 12:00 pm. Give one of them another room. In Design, choose Add, pick the room in Where and add their time there again.'],
      ['look', 'Tobin Achterberg has 80 slots planned and the target is 83. Add 3 slots, or change their contract hours or clinical factor in Set up. A week within 2 slots of its target counts as on target.'],
      ['look', 'Dalia Pemberthy has 93 slots planned and the target is 90. Take out 3 slots, or change their contract hours or clinical factor in Set up. A week within 2 slots of its target counts as on target.'],
      ['look', 'Dalia Pemberthy has no Training scheduled and 1 h set aside for it. Add 1 h, or change the hours set aside in Set up.'],
      ['look', "Yusra Hollin sees patients at Coldbrook Annex on Friday from 1:00 pm to 3:40 pm with no support staff with them. Add time with Yusra Hollin to a support person's week in Design, or leave it if this is meant."],
      ['note', 'Linnea Farrowby is marked as ramping, so their 65 slots planned are not held to the target of 78. Take the mark off in Set up once they carry a whole week.'],
      ['note', 'Group in Behavioral health is not used this week. Add some in Design, or remove it in Set up.'],
    ]);
  });

  it('adds up as planned: contract, factor, hours set aside, capacity, and slots against target', () => {
    const all = overview(s);
    const rows = all.filter((row) => row.kind === 'provider').map((row) => [row.name, row.contractHours, row.careFactor, row.setAsideHours, row.capacityHours, row.slotsPerHour, row.target, row.actual, row.variance, row.verdict]);
    // A support person has no slot target: no capacity, no target, no slots, and a verdict that says so.
    expect(all.filter((row) => row.kind === 'support').map((row) => [row.name, row.contractHours, row.setAsideHours, row.capacityHours, row.target, row.actual, row.variance, row.verdict, row.workMinutes, row.worksWith])).toEqual([
      ['Briony Halvard', 40, 0, 0, 0, 0, 0, 'support', 2700, ['Maren Castellane']],
      ['Emrys Tolliver', 36, 0, 0, 0, 0, 0, 'support', 2400, ['Yusra Hollin', 'Linnea Farrowby']],
      ['Odalys Wren', 24, 0, 0, 0, 0, 0, 'support', 1620, ['Yusra Hollin']],
    ]);
    // A provider's row names the support staff who have time with them.
    expect(all.filter((row) => row.kind === 'provider').map((row) => row.worksWith)).toEqual([['Briony Halvard'], [], ['Emrys Tolliver', 'Odalys Wren'], [], [], ['Emrys Tolliver'], [], []]);
    expect(rows).toEqual([
      ['Maren Castellane', 40, 0.8, 1, 31, 3, 93, 93, 0, 'on-target'],
      ['Tobin Achterberg', 36, 0.8, 1, 27.8, 3, 83, 80, -3, 'under'],
      // The method's own worked case: 34 x 0.8 - 1 is 26.2 h, 79 slots at 3 an hour.
      ['Yusra Hollin', 34, 0.8, 1, 26.2, 3, 79, 79, 0, 'on-target'],
      ['Dalia Pemberthy', 40, 0.8, 2, 30, 3, 90, 93, 3, 'over'],
      ['Osric Vandermeer', 40, 0.85, 1, 33, 4, 132, 132, 0, 'on-target'],
      ['Linnea Farrowby', 24, 0.85, 1, 19.4, 4, 78, 65, -13, 'ramping'],
      ['Kofi Brantwood', 40, 0.85, 2, 32, 2, 64, 64, 0, 'on-target'],
      ['Sunniva Kell', 20, 0.85, 1, 16, 2, 32, 32, 0, 'on-target'],
    ]);
    expect(s.people.map((p) => (tallyPerson(s, p.id)?.week.paidMinutes ?? 0) / 60)).toEqual([40, 35, 34, 40, 40, 24, 40, 20, 40, 36, 24]);
    expect(tallyClinic(s).departments.map((d) => [d.name, d.people, d.peopleCounted, d.targetSlots, d.actualSlots, d.variance])).toEqual([
      ['Primary care', 4, 4, 345, 345, 0],
      ['Pediatrics', 2, 1, 132, 132, 0],
      ['Behavioral health', 2, 2, 96, 96, 0],
    ]);
    // The three support staff belong to Primary care and are counted by themselves, in no slot total.
    expect(tallyClinic(s).departments.map((d) => d.supportStaff)).toEqual([3, 0, 0]);
    expect(tallyOf('Dalia Pemberthy')?.setAside.map((line) => [line.name, line.allowedMinutes, line.scheduledMinutes])).toEqual([['Team meeting', 60, 60], ['Training', 60, 0]]);
    expect(tallyOf('Maren Castellane')?.week.remote).toBeGreaterThan(0);
  });

  it('uses every room, shows the week in the overview, and counts the clinic', () => {
    for (const site of s.sites) for (const room of roomHours(s, site.id)) expect(room.usedMinutes, room.name).toBeGreaterThan(0);
    const rows = overview(s);
    expect(rows[0]?.days[0]?.morning.say).toBe('Patient care, Tannery Row');
    expect(rows[0]?.days[4]?.afternoon.say).toBe('Patient care, remote');
    expect(rows[7]?.days[1]?.morning.kind).toBe('empty');
    expect(rows[8]?.days[0]?.morning).toMatchObject({ kind: 'other', label: 'With Maren Castellane', place: 'Tannery Row', say: 'With Maren Castellane, Tannery Row', minutes: 220 });
    expect(rows[9]?.days[1]?.afternoon.say).toBe('Admin time, Tannery Row');
    const clinic = tallyClinic(s);
    expect(clinic.appointments).toBe(s.blocks.filter((b) => b.what.kind === 'visit').length);
    expect(clinic.byDay.every((count) => count > 50)).toBe(true);
  });

  it('holds only plain invented text', () => {
    const text = JSON.stringify(s);
    expect(/^[\x20-\x7e]*$/.test(text)).toBe(true);
    expect(s.clinic).toContain('sample');
  });
});
