import { describe, expect, it } from 'vitest';
import { addPerson, duplicatePerson, erase, paint, removePerson, setPerson, setPlace } from '../../src/scripts/schedule-designer/engine/edit';
import { blocksOf, blocksOn, factsOf, initialsOf, personColour, personOf } from '../../src/scripts/schedule-designer/engine/find';
import { overview } from '../../src/scripts/schedule-designer/engine/overview';
import { VERDICT_NAMES, capacityHours, careTarget, slotTarget, tallyClinic, tallyPerson } from '../../src/scripts/schedule-designer/engine/tally';
import {
  TEAM_GAP,
  addWorksWith,
  coverage,
  fillWith,
  kindChange,
  patientStretches,
  patientTime,
  planWith,
  providersIn,
  removeWorksWith,
  setKind,
  supportFor,
  supportStaffIn,
  teamHours,
  teamOf,
} from '../../src/scripts/schedule-designer/engine/team';
import type { Block, Schedule } from '../../src/scripts/schedule-designer/engine/types';
import { setWork } from '../../src/scripts/schedule-designer/engine/work';
import { NOWHERE, REMOTE, activity, block, dayOf, deepFreeze, noOverlaps, room, visit, withBlocks, withTime } from './fixtures/small';
import { team, visits, withPerson } from './fixtures/team';

const base = team();
const ELM = room('s1', null);
const ANNEX = room('s2', null);
const EXAM1 = room('s1', 'r1');
const CONSULT = room('s2', 'r3');

const BANNED = /\b(?:highest|lowest|worst|best)\b|\btop\s/i;
const DASHES = /[—–]| - /;

const listOf = (s: Schedule, personId: string): string[] => personOf(s, personId)?.worksWith ?? [];
const withBlock = (id: string, supportId: string, day: Block['day'], start: number, minutes: number, providerId: string, where: Block['where'] = ELM): Block => block(id, supportId, day, start, minutes, withTime(providerId), where);

/**
 * Avery's Monday: appointments at Elm Street from 8:00 am to 10:00 am, lunch from 12:00 pm to
 * 1:00 pm, and appointments at the Annex from 1:00 pm to 3:00 pm. Four hours of patient time.
 */
function averyMonday(): Block[] {
  return [...visits('m', 'pA', 0, 480, 6), block('lunch', 'pA', 0, 720, 60, activity('aLunch'), ELM), ...visits('n', 'pA', 0, 780, 6, CONSULT)];
}

describe('Schedule Designer: providers and support staff', () => {
  it('lists each kind in the order of the people list', () => {
    expect(providersIn(base).map((person) => person.id)).toEqual(['pA', 'pB']);
    expect(supportStaffIn(base).map((person) => person.id)).toEqual(['pS', 'pT']);
    expect(supportFor(base, 'pA')).toEqual([]);
    const s = addWorksWith(addWorksWith(base, 'pT', 'pA'), 'pS', 'pA');
    expect(supportFor(s, 'pA').map((person) => person.id)).toEqual(['pS', 'pT']);
    expect(supportFor(s, 'pB')).toEqual([]);
  });

  it('a new person is a provider unless told otherwise, and support staff start with no providers', () => {
    const one = addPerson(base, { name: 'Wren Abel' });
    const added = one.people[one.people.length - 1];
    expect([added?.kind, added?.worksWith, added?.work]).toEqual(['provider', [], []]);
    const two = addPerson(base, { name: 'Wren Abel', kind: 'support' });
    expect(two.people[two.people.length - 1]?.kind).toBe('support');
  });

  it('gives each person a steady swatch from their place among the people of their kind', () => {
    expect(personColour(base, 'pA')).not.toBe(personColour(base, 'pB'));
    expect(personColour(base, 'pS')).not.toBe(personColour(base, 'pT'));
    // The first provider and the first support person both get the first swatch.
    expect(personColour(base, 'pS')).toBe(personColour(base, 'pA'));
    expect(personColour(base, 'nobody')).toBe(12);
    // A provider keeps their swatch when support staff are added before them in the list.
    const moved = deepFreeze({ ...base, people: [base.people[2]!, base.people[0]!, base.people[3]!, base.people[1]!] });
    expect(personColour(moved, 'pA')).toBe(personColour(base, 'pA'));
    expect(personColour(moved, 'pB')).toBe(personColour(base, 'pB'));
  });

  it('makes initials from the first and the last word of a name', () => {
    expect(initialsOf('Maren Castellane')).toBe('MC');
    expect(initialsOf('  anna  maria  lopez ')).toBe('AL');
    expect(initialsOf('Cher')).toBe('C');
    expect(initialsOf('')).toBe('');
    expect(initialsOf('   ')).toBe('');
  });
});

describe('Schedule Designer: adding time with a provider', () => {
  it('adds a block at the provider\'s site with no room, and puts the provider on the "works with" list', () => {
    const s = withBlocks(base, averyMonday());
    const next = paint(s, { personId: 'pS', day: 0, from: 480, to: 600, what: withTime('pA'), where: CONSULT });
    const mine = blocksOf(next, 'pS');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ personId: 'pS', day: 0, start: 480, minutes: 120, what: { kind: 'with', personId: 'pA' }, where: { kind: 'site', siteId: 's1', roomId: null } });
    expect(listOf(next, 'pS')).toEqual(['pA']);
    expect(listOf(next, 'pT')).toEqual([]);
    expect(dayOf(next, 'pS', 0)).toEqual(['480-600 With Avery Quill @ Elm Street']);
    // The provider's own week is untouched, and the schedule handed in was not changed.
    expect(blocksOf(next, 'pA')).toEqual(blocksOf(s, 'pA'));
    expect(blocksOf(s, 'pS')).toEqual([]);
  });

  it('takes the site where the provider has the most time in that stretch', () => {
    // 9:40 am to 1:40 pm holds 20 min of Avery at Elm Street and 40 at the Annex, and an hour of lunch at Elm Street.
    const s = withBlocks(base, [...visits('m', 'pA', 0, 480, 6), ...visits('n', 'pA', 0, 780, 6, CONSULT)]);
    const next = paint(s, { personId: 'pS', day: 0, from: 580, to: 820, what: withTime('pA'), where: NOWHERE });
    expect(blocksOf(next, 'pS')[0]?.where).toEqual({ kind: 'site', siteId: 's2', roomId: null });
  });

  it('when the provider has nothing then, takes the site asked for, or the provider\'s site that day, or no place', () => {
    const s = withBlocks(base, visits('m', 'pA', 0, 480, 6));
    const asked = paint(s, { personId: 'pS', day: 0, from: 900, to: 960, what: withTime('pA'), where: CONSULT });
    expect(blocksOf(asked, 'pS')[0]?.where).toEqual({ kind: 'site', siteId: 's2', roomId: null });
    const theirs = paint(s, { personId: 'pS', day: 0, from: 900, to: 960, what: withTime('pA'), where: NOWHERE });
    expect(blocksOf(theirs, 'pS')[0]?.where).toEqual({ kind: 'site', siteId: 's1', roomId: null });
    const remote = paint(s, { personId: 'pS', day: 0, from: 900, to: 960, what: withTime('pA'), where: REMOTE });
    expect(blocksOf(remote, 'pS')[0]?.where).toEqual({ kind: 'site', siteId: 's1', roomId: null });
    const nowhere = paint(s, { personId: 'pS', day: 1, from: 900, to: 960, what: withTime('pA'), where: NOWHERE });
    expect(blocksOf(nowhere, 'pS')[0]?.where).toEqual({ kind: 'none' });
    expect(dayOf(nowhere, 'pS', 1)).toEqual(['900-960 With Avery Quill']);
  });

  it('only a support person holds it, and only with a provider', () => {
    expect(paint(base, { personId: 'pB', day: 0, from: 480, to: 600, what: withTime('pA'), where: ELM })).toBe(base);
    expect(paint(base, { personId: 'pS', day: 0, from: 480, to: 600, what: withTime('pT'), where: ELM })).toBe(base);
    expect(paint(base, { personId: 'pS', day: 0, from: 480, to: 600, what: withTime('pS'), where: ELM })).toBe(base);
    expect(paint(base, { personId: 'pS', day: 0, from: 480, to: 600, what: withTime('nobody'), where: ELM })).toBe(base);
    expect(paint(base, { personId: 'pS', day: 6, from: 480, to: 600, what: withTime('pA'), where: ELM })).toBe(base);
  });

  it('may be any length, joins time that touches with the same provider, and keeps two providers apart', () => {
    let s = paint(base, { personId: 'pS', day: 0, from: 485, to: 532, what: withTime('pA'), where: ELM });
    expect(dayOf(s, 'pS', 0)).toEqual(['485-532 With Avery Quill @ Elm Street']);
    s = paint(s, { personId: 'pS', day: 0, from: 532, to: 600, what: withTime('pA'), where: ELM });
    expect(dayOf(s, 'pS', 0)).toEqual(['485-600 With Avery Quill @ Elm Street']);
    s = paint(s, { personId: 'pS', day: 0, from: 600, to: 660, what: withTime('pB'), where: ELM });
    expect(dayOf(s, 'pS', 0)).toEqual(['485-600 With Avery Quill @ Elm Street', '600-660 With Blake Rowan @ Elm Street']);
    expect(listOf(s, 'pS')).toEqual(['pA', 'pB']);
    // Time with the same provider at another site is its own block.
    s = paint(s, { personId: 'pS', day: 0, from: 660, to: 700, what: withTime('pB'), where: ANNEX });
    expect(dayOf(s, 'pS', 0)).toEqual(['485-600 With Avery Quill @ Elm Street', '600-660 With Blake Rowan @ Elm Street', '660-700 With Blake Rowan @ Annex']);
    expect(noOverlaps(s)).toBe(true);
  });

  it('adding the same time again gives back the very same schedule', () => {
    const s = paint(base, { personId: 'pS', day: 0, from: 480, to: 600, what: withTime('pA'), where: ELM });
    expect(paint(s, { personId: 'pS', day: 0, from: 480, to: 600, what: withTime('pA'), where: ELM })).toBe(s);
    expect(paint(s, { personId: 'pS', day: 0, from: 500, to: 560, what: withTime('pA'), where: ELM })).toBe(s);
  });

  it('is trimmed or split like other time when something is added over it or part is erased', () => {
    let s = paint(base, { personId: 'pS', day: 0, from: 480, to: 720, what: withTime('pA'), where: ELM });
    s = paint(s, { personId: 'pS', day: 0, from: 540, to: 600, what: activity('aMeet'), where: ELM });
    expect(dayOf(s, 'pS', 0)).toEqual(['480-540 With Avery Quill @ Elm Street', '540-600 Meeting @ Elm Street', '600-720 With Avery Quill @ Elm Street']);
    s = erase(s, { personId: 'pS', day: 0, from: 660, to: 720 });
    expect(dayOf(s, 'pS', 0)).toEqual(['480-540 With Avery Quill @ Elm Street', '540-600 Meeting @ Elm Street', '600-660 With Avery Quill @ Elm Street']);
    // Erasing every block of time with a provider leaves them on the list: the list is who they usually work with.
    s = erase(s, { personId: 'pS', day: 0, from: 0, to: 1440 });
    expect(blocksOf(s, 'pS')).toEqual([]);
    expect(listOf(s, 'pS')).toEqual(['pA']);
  });

  it('never takes a room and is never remote when its place is changed', () => {
    const s = paint(base, { personId: 'pS', day: 0, from: 480, to: 600, what: withTime('pA'), where: ELM });
    const moved = setPlace(s, { personId: 'pS', day: 0, from: 480, to: 600, where: CONSULT });
    expect(blocksOf(moved, 'pS')[0]?.where).toEqual({ kind: 'site', siteId: 's2', roomId: null });
    expect(setPlace(s, { personId: 'pS', day: 0, from: 480, to: 600, where: REMOTE })).toBe(s);
    expect(setPlace(s, { personId: 'pS', day: 0, from: 480, to: 600, where: EXAM1 })).toBe(s);
    const nowhere = setPlace(s, { personId: 'pS', day: 0, from: 480, to: 600, where: NOWHERE });
    expect(blocksOf(nowhere, 'pS')[0]?.where).toEqual({ kind: 'none' });
  });

  it('is drawn with the provider\'s name, initials and swatch, and counts as paid time that is not patient care', () => {
    const s = paint(base, { personId: 'pS', day: 0, from: 480, to: 600, what: withTime('pB'), where: ANNEX });
    const facts = factsOf(s, blocksOf(s, 'pS')[0]!);
    expect(facts).toEqual({ kind: 'with', name: 'With Blake Rowan', code: 'BR', colour: personColour(s, 'pB'), care: false, paid: true, place: 'Annex', placeShort: 'Annex', from: 480, to: 600 });
    // A block whose provider is gone still draws.
    const orphan = factsOf(s, withBlock('x', 'pS', 0, 480, 60, 'gone'));
    expect([orphan.name, orphan.code, orphan.colour]).toEqual(['With a provider', '', 12]);
  });
});

describe('Schedule Designer: a provider\'s patient time', () => {
  it('joins appointments that touch, and for a care team those less than 30 minutes apart', () => {
    expect(TEAM_GAP).toBe(30);
    // 8:00 to 9:00, then 9:20 to 10:00 (a gap of 20 min), then 10:30 to 10:50 (a gap of exactly 30).
    const s = withBlocks(base, [...visits('a', 'pA', 0, 480, 3), ...visits('b', 'pA', 0, 560, 2), ...visits('c', 'pA', 0, 630, 1)]);
    expect(patientTime(s, 'pA', 0)).toEqual([{ from: 480, to: 540, siteId: 's1' }, { from: 560, to: 600, siteId: 's1' }, { from: 630, to: 650, siteId: 's1' }]);
    expect(patientStretches(s, 'pA', 0)).toEqual([{ from: 480, to: 600, siteId: 's1' }, { from: 630, to: 650, siteId: 's1' }]);
    expect(patientTime(s, 'pA', 1)).toEqual([]);
  });

  it('starts a new stretch where the site changes, even when the appointments touch', () => {
    const s = withBlocks(base, [...visits('a', 'pA', 0, 480, 3), ...visits('b', 'pA', 0, 540, 3, CONSULT), ...visits('c', 'pA', 0, 600, 1, ELM)]);
    const expected = [{ from: 480, to: 540, siteId: 's1' }, { from: 540, to: 600, siteId: 's2' }, { from: 600, to: 620, siteId: 's1' }];
    expect(patientTime(s, 'pA', 0)).toEqual(expected);
    expect(patientStretches(s, 'pA', 0)).toEqual(expected);
  });

  it('leaves out remote appointments, appointments with no place and other kinds of time', () => {
    const s = withBlocks(base, [
      ...visits('a', 'pA', 0, 480, 2, REMOTE),
      ...visits('b', 'pA', 0, 520, 2, NOWHERE),
      block('admin', 'pA', 0, 560, 60, activity('aAdmin'), ELM),
      // An appointment at a site with no room still counts: the provider is there.
      ...visits('c', 'pA', 0, 620, 2, ELM),
    ]);
    expect(patientTime(s, 'pA', 0)).toEqual([{ from: 620, to: 660, siteId: 's1' }]);
  });
});

describe('Schedule Designer: who is with a provider, and when', () => {
  // Sage is with Avery on Monday morning and Tuesday. Teal is with Avery on Monday from 9:00 am, at the Annex.
  const s = withBlocks(withPerson(withPerson(base, 'pS', { worksWith: ['pA'] }), 'pT', { worksWith: ['pA'] }), [
    ...averyMonday(),
    withBlock('s1', 'pS', 0, 480, 60, 'pA'),
    withBlock('s2', 'pS', 0, 800, 40, 'pA', ANNEX),
    withBlock('s3', 'pS', 1, 480, 120, 'pA'),
    withBlock('t1', 'pT', 0, 540, 30, 'pA', ANNEX),
    withBlock('t2', 'pT', 0, 480, 20, 'pB'),
    withBlock('t3', 'pT', 0, 660, 60, 'pA', NOWHERE),
  ]);

  it('lists every stretch by day, then by time, then in the order of the people list', () => {
    expect(teamOf(s, 'pA')).toEqual([
      { personId: 'pS', day: 0, from: 480, to: 540, siteId: 's1' },
      { personId: 'pT', day: 0, from: 540, to: 570, siteId: 's2' },
      { personId: 'pT', day: 0, from: 660, to: 720, siteId: null },
      { personId: 'pS', day: 0, from: 800, to: 840, siteId: 's2' },
      { personId: 'pS', day: 1, from: 480, to: 600, siteId: 's1' },
    ]);
    expect(teamOf(s, 'pA', 1)).toEqual([{ personId: 'pS', day: 1, from: 480, to: 600, siteId: 's1' }]);
    expect(teamOf(s, 'pA', 2)).toEqual([]);
    expect(teamOf(s, 'pB')).toEqual([{ personId: 'pT', day: 0, from: 480, to: 500, siteId: 's1' }]);
    expect(teamOf(s, 'pS')).toEqual([]);
  });

  it('adds up each support person\'s time with the provider, day by day', () => {
    expect(teamHours(s, 'pA')).toEqual([
      { personId: 'pS', name: 'Sage Marlow', role: 'Medical assistant', byDay: [100, 120, 0, 0, 0], minutes: 220 },
      { personId: 'pT', name: 'Teal Ostrander', role: 'Nurse', byDay: [90, 0, 0, 0, 0], minutes: 90 },
    ]);
    expect(teamHours(s, 'pB')).toEqual([{ personId: 'pT', name: 'Teal Ostrander', role: 'Nurse', byDay: [20, 0, 0, 0, 0], minutes: 20 }]);
    expect(teamHours(base, 'pA')).toEqual([]);
  });

  it('splits the provider\'s patient time into the time someone is with them and the time nobody is', () => {
    // Avery sees patients 8:00 to 10:00 at Elm Street and 1:00 to 3:00 at the Annex.
    // Someone is with them 8:00 to 9:30 and 1:20 to 2:00, whichever site that time says.
    expect(coverage(s, 'pA', 0)).toEqual({
      covered: [{ from: 480, to: 570, siteId: 's1' }, { from: 800, to: 840, siteId: 's2' }],
      uncovered: [{ from: 570, to: 600, siteId: 's1' }, { from: 780, to: 800, siteId: 's2' }, { from: 840, to: 900, siteId: 's2' }],
    });
    // Tuesday has time with Avery and no patients, and Wednesday has neither.
    expect(coverage(s, 'pA', 1)).toEqual({ covered: [], uncovered: [] });
    expect(coverage(s, 'pA', 2)).toEqual({ covered: [], uncovered: [] });
  });

  it('counts a provider\'s whole patient time as uncovered when nobody has time with them', () => {
    const alone = withBlocks(base, averyMonday());
    expect(coverage(alone, 'pA', 0)).toEqual({ covered: [], uncovered: [{ from: 480, to: 600, siteId: 's1' }, { from: 780, to: 900, siteId: 's2' }] });
  });
});

describe('Schedule Designer: filling a support person\'s week from a provider\'s patient time', () => {
  const s = withBlocks(base, averyMonday());

  it('plans one block for each stretch of patient time and changes nothing', () => {
    const plan = planWith(s, 'pS', 'pA');
    expect(plan).toEqual({
      supportId: 'pS',
      providerId: 'pA',
      day: null,
      pieces: [{ day: 0, from: 480, to: 600, siteId: 's1' }, { day: 0, from: 780, to: 900, siteId: 's2' }],
      foundMinutes: 240,
      addMinutes: 240,
      alreadyMinutes: 0,
      busyMinutes: 0,
      offMinutes: 0,
      say: 'Added 4 h with Avery Quill this week.',
      why: '',
    });
    expect(blocksOf(s, 'pS')).toEqual([]);
  });

  it('fills the week: the blocks are at the provider\'s sites with no room, and the provider joins the list', () => {
    const { schedule, plan } = fillWith(s, 'pS', 'pA');
    expect(plan).toEqual(planWith(s, 'pS', 'pA'));
    expect(dayOf(schedule, 'pS', 0)).toEqual(['480-600 With Avery Quill @ Elm Street', '780-900 With Avery Quill @ Annex']);
    expect(blocksOf(schedule, 'pS').every((b) => b.where.kind === 'site' && b.where.roomId === null)).toBe(true);
    expect(listOf(schedule, 'pS')).toEqual(['pA']);
    expect(blocksOf(schedule, 'pA')).toEqual(blocksOf(s, 'pA'));
    expect(coverage(schedule, 'pA', 0).uncovered).toEqual([]);
  });

  it('filling a second time adds nothing and gives back the very same schedule', () => {
    const once = fillWith(s, 'pS', 'pA').schedule;
    const twice = fillWith(once, 'pS', 'pA');
    expect(twice.schedule).toBe(once);
    expect(twice.plan.pieces).toEqual([]);
    expect([twice.plan.foundMinutes, twice.plan.addMinutes, twice.plan.alreadyMinutes, twice.plan.busyMinutes, twice.plan.offMinutes]).toEqual([240, 0, 240, 0, 0]);
    expect(twice.plan.say).toBe('Nothing was added with Avery Quill this week.');
    expect(twice.plan.why).toBe('4 h was already there.');
  });

  it('clips to the support person\'s working hours when they are entered', () => {
    // Sage works Monday 9:00 am to 2:00 pm.
    const hours = deepFreeze(setWork(s, 'pS', 0, [{ from: 540, to: 840 }]));
    const { schedule, plan } = fillWith(hours, 'pS', 'pA');
    expect(plan.pieces).toEqual([{ day: 0, from: 540, to: 600, siteId: 's1' }, { day: 0, from: 780, to: 840, siteId: 's2' }]);
    expect([plan.foundMinutes, plan.addMinutes, plan.alreadyMinutes, plan.busyMinutes, plan.offMinutes]).toEqual([240, 120, 0, 0, 120]);
    expect(plan.say).toBe('Added 2 h with Avery Quill this week.');
    expect(plan.why).toBe('2 h was left out because that time is outside their working hours.');
    expect(dayOf(schedule, 'pS', 0)).toEqual(['540-600 With Avery Quill @ Elm Street', '780-840 With Avery Quill @ Annex']);
  });

  it('clips to both stretches of a split day', () => {
    // Sage works Monday 8:30 am to 9:30 am and 1:30 pm to 4:00 pm.
    const hours = deepFreeze(setWork(s, 'pS', 0, [{ from: 510, to: 570 }, { from: 810, to: 960 }]));
    expect(planWith(hours, 'pS', 'pA').pieces).toEqual([{ day: 0, from: 510, to: 570, siteId: 's1' }, { day: 0, from: 810, to: 900, siteId: 's2' }]);
  });

  it('adds nothing on the support person\'s day off', () => {
    // Sage works Tuesday only, so Monday is a day off.
    const hours = deepFreeze(setWork(s, 'pS', 1, [{ from: 480, to: 1020 }]));
    const { schedule, plan } = fillWith(hours, 'pS', 'pA');
    expect(schedule).toBe(hours);
    expect(plan.pieces).toEqual([]);
    expect([plan.foundMinutes, plan.addMinutes, plan.offMinutes]).toEqual([240, 0, 240]);
    expect(plan.say).toBe('Nothing was added with Avery Quill this week.');
    expect(plan.why).toBe('4 h was left out because that time is outside their working hours.');
  });

  it('never overwrites: time the support person already has is left out and left as it was', () => {
    // Sage has admin time 8:20 to 9:00, time with Avery 9:20 to 10:00, time with Blake 1:00 to 1:30 and lunch 2:00 to 2:20.
    const busy = withBlocks(withPerson(base, 'pS', { worksWith: ['pA', 'pB'] }), [
      ...averyMonday(),
      block('admin', 'pS', 0, 500, 40, activity('aAdmin'), ELM),
      withBlock('have', 'pS', 0, 560, 40, 'pA'),
      withBlock('blake', 'pS', 0, 780, 30, 'pB', ANNEX),
      block('eat', 'pS', 0, 840, 20, activity('aLunch'), ANNEX),
    ]);
    const { schedule, plan } = fillWith(busy, 'pS', 'pA');
    expect(plan.pieces).toEqual([
      { day: 0, from: 480, to: 500, siteId: 's1' },
      { day: 0, from: 540, to: 560, siteId: 's1' },
      { day: 0, from: 810, to: 840, siteId: 's2' },
      { day: 0, from: 860, to: 900, siteId: 's2' },
    ]);
    expect([plan.foundMinutes, plan.addMinutes, plan.alreadyMinutes, plan.busyMinutes, plan.offMinutes]).toEqual([240, 110, 40, 90, 0]);
    expect(plan.say).toBe('Added 1 h 50 min with Avery Quill this week.');
    expect(plan.why).toBe('40 min was already there. 1 h 30 min was left out because Sage Marlow has other time then.');
    expect(dayOf(schedule, 'pS', 0)).toEqual([
      '480-500 With Avery Quill @ Elm Street',
      '500-540 Admin time @ Elm Street',
      // The new piece from 9:00 joins the time that was already there from 9:20.
      '540-600 With Avery Quill @ Elm Street',
      '780-810 With Blake Rowan @ Annex',
      '810-840 With Avery Quill @ Annex',
      '840-860 Lunch @ Annex',
      '860-900 With Avery Quill @ Annex',
    ]);
    // Every other block that was there is still there, the same in every part. The time with Avery
    // that was there is now the later part of a longer block, which has the id of its earlier part.
    for (const before of blocksOf(busy, 'pS')) {
      if (before.id !== 'have') expect(schedule.blocks.find((b) => b.id === before.id)).toEqual(before);
    }
    expect(schedule.blocks.some((b) => b.id === 'have')).toBe(false);
    expect(noOverlaps(schedule)).toBe(true);
    expect(blocksOf(busy, 'pS')).toHaveLength(4);
  });

  it('a change of site breaks a stretch, so each block is at the site the provider is at', () => {
    const moving = withBlocks(base, [...visits('a', 'pA', 0, 480, 3), ...visits('b', 'pA', 0, 540, 3, CONSULT)]);
    const { schedule, plan } = fillWith(moving, 'pS', 'pA');
    expect(plan.pieces).toEqual([{ day: 0, from: 480, to: 540, siteId: 's1' }, { day: 0, from: 540, to: 600, siteId: 's2' }]);
    expect(dayOf(schedule, 'pS', 0)).toEqual(['480-540 With Avery Quill @ Elm Street', '540-600 With Avery Quill @ Annex']);
  });

  it('covers a gap of less than 30 minutes between two appointments, and not a gap of 30', () => {
    const gaps = withBlocks(base, [...visits('a', 'pA', 0, 480, 3), ...visits('b', 'pA', 0, 560, 2), ...visits('c', 'pA', 0, 630, 1)]);
    const { schedule, plan } = fillWith(gaps, 'pS', 'pA');
    expect(plan.pieces).toEqual([{ day: 0, from: 480, to: 600, siteId: 's1' }, { day: 0, from: 630, to: 650, siteId: 's1' }]);
    // The short gap is counted in what was found: 2 h and then 20 min.
    expect([plan.foundMinutes, plan.addMinutes]).toEqual([140, 140]);
    expect(dayOf(schedule, 'pS', 0)).toEqual(['480-600 With Avery Quill @ Elm Street', '630-650 With Avery Quill @ Elm Street']);
  });

  it('never fills from remote appointments, and says so when there is nothing to fill from', () => {
    const remote = withBlocks(base, [...averyMonday(), ...visits('r', 'pA', 1, 480, 6, REMOTE)]);
    const tuesday = fillWith(remote, 'pS', 'pA', 1);
    expect(tuesday.schedule).toBe(remote);
    expect(tuesday.plan.day).toBe(1);
    expect(tuesday.plan.foundMinutes).toBe(0);
    expect(tuesday.plan.say).toBe('Avery Quill has no appointments at a site on Tuesday, so there was nothing to fill from.');
    expect(planWith(base, 'pS', 'pA').say).toBe('Avery Quill has no appointments at a site this week, so there was nothing to fill from.');
    // The whole week fills from Monday only.
    expect(blocksOf(fillWith(remote, 'pS', 'pA').schedule, 'pS').map((b) => b.day)).toEqual([0, 0]);
  });

  it('fills one day when a day is named', () => {
    const two = withBlocks(base, [...averyMonday(), ...visits('w', 'pA', 2, 540, 3)]);
    const { schedule, plan } = fillWith(two, 'pS', 'pA', 2);
    expect(plan.day).toBe(2);
    expect(plan.pieces).toEqual([{ day: 2, from: 540, to: 600, siteId: 's1' }]);
    expect(plan.say).toBe('Added 1 h with Avery Quill on Wednesday.');
    expect(blocksOn(schedule, 'pS', 0)).toEqual([]);
    expect(dayOf(schedule, 'pS', 2)).toEqual(['540-600 With Avery Quill @ Elm Street']);
    // The whole week takes both days, in day order.
    expect(planWith(two, 'pS', 'pA').pieces.map((piece) => piece.day)).toEqual([0, 0, 2]);
    // A day the schedule does not show has nothing to fill from.
    expect(planWith(two, 'pS', 'pA', 6).pieces).toEqual([]);
  });

  it('plans nothing for a person who is not support staff, or with a person who is not a provider', () => {
    const wrongOwner = fillWith(s, 'pB', 'pA');
    expect(wrongOwner.schedule).toBe(s);
    expect(wrongOwner.plan).toEqual({ supportId: 'pB', providerId: 'pA', day: null, pieces: [], foundMinutes: 0, addMinutes: 0, alreadyMinutes: 0, busyMinutes: 0, offMinutes: 0, say: 'Only support staff can have time with a provider.', why: '' });
    expect(planWith(s, 'nobody', 'pA').say).toBe('Only support staff can have time with a provider.');
    const wrongTarget = fillWith(s, 'pS', 'pT', 0);
    expect(wrongTarget.schedule).toBe(s);
    expect(wrongTarget.plan.say).toBe('Time like this is spent with a provider. Choose a provider.');
    expect(wrongTarget.plan.day).toBe(0);
    expect(planWith(s, 'pS', 'nobody').say).toBe('Time like this is spent with a provider. Choose a provider.');
  });

  it('writes every sentence in plain words', () => {
    const says = [
      planWith(s, 'pS', 'pA').say,
      planWith(s, 'pS', 'pA', 3).say,
      planWith(s, 'pB', 'pA').say,
      planWith(s, 'pS', 'pT').say,
      fillWith(fillWith(s, 'pS', 'pA').schedule, 'pS', 'pA').plan.say,
      planWith(setWork(s, 'pS', 1, [{ from: 480, to: 1020 }]), 'pS', 'pA').say,
    ];
    for (const say of says) {
      expect(say).not.toMatch(BANNED);
      expect(say).not.toMatch(DASHES);
      expect(say).toMatch(/^[A-Z].*\.$/);
    }
  });
});

describe('Schedule Designer: the "works with" list', () => {
  it('adds a provider at the end, once', () => {
    const one = addWorksWith(base, 'pS', 'pB');
    const two = addWorksWith(one, 'pS', 'pA');
    expect(listOf(two, 'pS')).toEqual(['pB', 'pA']);
    expect(addWorksWith(two, 'pS', 'pA')).toBe(two);
    expect(listOf(base, 'pS')).toEqual([]);
  });

  it('changes nothing for a person who is not support staff or a second person who is not a provider', () => {
    expect(addWorksWith(base, 'pA', 'pB')).toBe(base);
    expect(addWorksWith(base, 'pS', 'pT')).toBe(base);
    expect(addWorksWith(base, 'pS', 'pS')).toBe(base);
    expect(addWorksWith(base, 'pS', 'nobody')).toBe(base);
    expect(addWorksWith(base, 'nobody', 'pA')).toBe(base);
  });

  it('taking a provider off the list removes the time with them, and says how many blocks went', () => {
    let s = paint(base, { personId: 'pS', day: 0, from: 480, to: 600, what: withTime('pA'), where: ELM });
    s = paint(s, { personId: 'pS', day: 1, from: 480, to: 600, what: withTime('pA'), where: ELM });
    s = paint(s, { personId: 'pS', day: 1, from: 600, to: 660, what: withTime('pB'), where: ELM });
    s = paint(s, { personId: 'pS', day: 2, from: 480, to: 540, what: activity('aAdmin'), where: ELM });
    s = paint(s, { personId: 'pT', day: 0, from: 480, to: 600, what: withTime('pA'), where: ELM });
    const change = removeWorksWith(deepFreeze(s), 'pS', 'pA');
    expect(change.touched).toBe(2);
    expect(listOf(change.schedule, 'pS')).toEqual(['pB']);
    expect(dayOf(change.schedule, 'pS', 0)).toEqual([]);
    expect(dayOf(change.schedule, 'pS', 1)).toEqual(['600-660 With Blake Rowan @ Elm Street']);
    expect(dayOf(change.schedule, 'pS', 2)).toEqual(['480-540 Admin time @ Elm Street']);
    // Another support person's time with the same provider stays.
    expect(listOf(change.schedule, 'pT')).toEqual(['pA']);
    expect(dayOf(change.schedule, 'pT', 0)).toEqual(['480-600 With Avery Quill @ Elm Street']);
  });

  it('taking off a provider who is on the list with no time, or who is not on it, behaves', () => {
    const listed = addWorksWith(base, 'pS', 'pA');
    const change = removeWorksWith(listed, 'pS', 'pA');
    expect(change.touched).toBe(0);
    expect(listOf(change.schedule, 'pS')).toEqual([]);
    expect(removeWorksWith(base, 'pS', 'pA')).toEqual({ schedule: base, touched: 0 });
    expect(removeWorksWith(base, 'pS', 'pA').schedule).toBe(base);
    expect(removeWorksWith(base, 'nobody', 'pA').schedule).toBe(base);
  });
});

describe('Schedule Designer: removing and copying people in a care team', () => {
  /** Sage with Avery on Monday and with Blake on Tuesday, Teal with Avery on Monday, and Avery's own Monday. */
  function teamWeek(): Schedule {
    let s: Schedule = withBlocks(base, averyMonday());
    s = paint(s, { personId: 'pS', day: 0, from: 480, to: 600, what: withTime('pA'), where: ELM });
    s = paint(s, { personId: 'pS', day: 0, from: 780, to: 900, what: withTime('pA'), where: ANNEX });
    s = paint(s, { personId: 'pS', day: 1, from: 480, to: 600, what: withTime('pB'), where: ELM });
    s = paint(s, { personId: 'pS', day: 2, from: 480, to: 540, what: activity('aAdmin'), where: ELM });
    s = paint(s, { personId: 'pT', day: 0, from: 480, to: 540, what: withTime('pA'), where: ELM });
    return deepFreeze(s);
  }

  it('removing a provider removes the time support staff had with them, and takes them off every list', () => {
    const s = teamWeek();
    expect(listOf(s, 'pS')).toEqual(['pA', 'pB']);
    const change = removePerson(s, 'pA');
    // Avery's own 13 blocks, Sage's 2 with Avery and Teal's 1.
    expect(change.touched).toBe(16);
    expect(change.schedule.people.map((person) => person.id)).toEqual(['pB', 'pS', 'pT']);
    expect(listOf(change.schedule, 'pS')).toEqual(['pB']);
    expect(listOf(change.schedule, 'pT')).toEqual([]);
    expect(change.schedule.blocks.some((b) => b.what.kind === 'with' && b.what.personId === 'pA')).toBe(false);
    expect(dayOf(change.schedule, 'pS', 0)).toEqual([]);
    expect(dayOf(change.schedule, 'pS', 1)).toEqual(['480-600 With Blake Rowan @ Elm Street']);
    expect(dayOf(change.schedule, 'pS', 2)).toEqual(['480-540 Admin time @ Elm Street']);
    // The schedule handed in was not changed.
    expect(s.people).toHaveLength(4);
    expect(blocksOf(s, 'pS')).toHaveLength(4);
  });

  it('removing a support person removes their week and leaves the providers as they were', () => {
    const s = teamWeek();
    const change = removePerson(s, 'pS');
    expect(change.touched).toBe(4);
    expect(change.schedule.people.map((person) => person.id)).toEqual(['pA', 'pB', 'pT']);
    expect(blocksOf(change.schedule, 'pA')).toEqual(blocksOf(s, 'pA'));
    expect(teamOf(change.schedule, 'pA')).toEqual([{ personId: 'pT', day: 0, from: 480, to: 540, siteId: 's1' }]);
    expect(teamOf(change.schedule, 'pB')).toEqual([]);
  });

  it('a copy of a support person works with the same providers and has the same time with them', () => {
    const s = teamWeek();
    const copied = duplicatePerson(s, 'pS');
    const copy = copied.people[3];
    expect(copy?.name).toBe('Sage Marlow (copy)');
    expect([copy?.kind, copy?.worksWith]).toEqual(['support', ['pA', 'pB']]);
    expect(copy?.worksWith).not.toBe(personOf(s, 'pS')?.worksWith);
    expect(dayOf(copied, copy?.id ?? '', 0)).toEqual(dayOf(s, 'pS', 0));
    expect(dayOf(copied, copy?.id ?? '', 1)).toEqual(dayOf(s, 'pS', 1));
    // A copy of a provider is on nobody's list and nobody has time with it.
    const provider = duplicatePerson(s, 'pA');
    const twin = provider.people[1];
    expect([twin?.kind, twin?.worksWith]).toEqual(['provider', []]);
    expect(supportFor(provider, twin?.id ?? '')).toEqual([]);
    expect(teamOf(provider, twin?.id ?? '')).toEqual([]);
  });
});

describe('Schedule Designer: changing a person from one kind to the other', () => {
  /** Avery with two set-aside lines, Sage with two blocks with Avery and one with Blake, and Teal listing Avery with no time. */
  function before(): Schedule {
    let s: Schedule = withBlocks(base, averyMonday());
    s = paint(s, { personId: 'pS', day: 0, from: 480, to: 600, what: withTime('pA'), where: ELM });
    s = paint(s, { personId: 'pS', day: 0, from: 780, to: 900, what: withTime('pA'), where: ANNEX });
    s = paint(s, { personId: 'pS', day: 1, from: 480, to: 600, what: withTime('pB'), where: ELM });
    s = paint(s, { personId: 'pS', day: 2, from: 480, to: 540, what: activity('aAdmin'), where: ELM });
    s = addWorksWith(s, 'pT', 'pA');
    return deepFreeze(s);
  }

  it('says what making a provider support staff would remove, and changes nothing', () => {
    const s = before();
    expect(kindChange(s, 'pA', 'support')).toEqual({
      changes: true,
      withBlocks: 2,
      listEntries: 2,
      setAsideLines: 2,
      ownStandards: false,
      ramping: false,
      removes: true,
      say: 'Changing Avery Quill to support staff removes 2 blocks of time that support staff have with them, their place on the “works with” list of 2 people and their 2 set-aside lines. Their appointments stay on their week.',
    });
    expect(personOf(s, 'pA')?.kind).toBe('provider');
  });

  it('makes a provider support staff: the time with them, their place on lists, set-aside lines and own standards go, and their appointments stay', () => {
    const s = withPerson(before(), 'pA', { careFactor: 0.8, slotsPerHour: 2.5, ramping: true });
    const preview = kindChange(s, 'pA', 'support');
    expect([preview.ownStandards, preview.ramping]).toEqual([true, true]);
    expect(preview.say).toBe(
      'Changing Avery Quill to support staff removes 2 blocks of time that support staff have with them, their place on the “works with” list of 2 people, their 2 set-aside lines, their own clinical factor and slots an hour and their ramping mark. Their appointments stay on their week.',
    );
    const change = setKind(s, 'pA', 'support');
    expect(change.touched).toBe(preview.withBlocks);
    const avery = personOf(change.schedule, 'pA');
    expect(avery).toMatchObject({ kind: 'support', setAside: [], careFactor: null, slotsPerHour: null, ramping: false, worksWith: [], contractHours: 34, name: 'Avery Quill' });
    expect(listOf(change.schedule, 'pS')).toEqual(['pB']);
    expect(listOf(change.schedule, 'pT')).toEqual([]);
    expect(dayOf(change.schedule, 'pS', 0)).toEqual([]);
    expect(dayOf(change.schedule, 'pS', 1)).toEqual(['480-600 With Blake Rowan @ Elm Street']);
    expect(dayOf(change.schedule, 'pS', 2)).toEqual(['480-540 Admin time @ Elm Street']);
    expect(blocksOf(change.schedule, 'pA')).toEqual(blocksOf(s, 'pA'));
    // The preview of the change back has nothing left to remove.
    expect(kindChange(change.schedule, 'pA', 'provider')).toMatchObject({ changes: true, removes: false, say: '' });
  });

  it('says what making a support person a provider would remove, then does it', () => {
    const s = before();
    expect(kindChange(s, 'pS', 'provider')).toEqual({
      changes: true,
      withBlocks: 3,
      listEntries: 2,
      setAsideLines: 0,
      ownStandards: false,
      ramping: false,
      removes: true,
      say: 'Changing Sage Marlow to a provider removes 3 blocks of time they have with providers and their “works with” list of 2 providers.',
    });
    const change = setKind(s, 'pS', 'provider');
    expect(change.touched).toBe(3);
    expect(personOf(change.schedule, 'pS')).toMatchObject({ kind: 'provider', worksWith: [] });
    expect(blocksOf(change.schedule, 'pS').map((b) => b.what)).toEqual([activity('aAdmin')]);
    // Other support staff and the providers are the same objects as before.
    expect(personOf(change.schedule, 'pT')).toBe(personOf(s, 'pT'));
    expect(blocksOf(change.schedule, 'pA')).toEqual(blocksOf(s, 'pA'));
    // The new provider can now be someone a support person works with.
    expect(listOf(addWorksWith(change.schedule, 'pT', 'pS'), 'pT')).toEqual(['pA', 'pS']);
  });

  it('writes one block and one provider in the singular', () => {
    const s = paint(base, { personId: 'pT', day: 0, from: 480, to: 600, what: withTime('pA'), where: ELM });
    expect(kindChange(s, 'pT', 'provider').say).toBe('Changing Teal Ostrander to a provider removes 1 block of time they have with providers and their “works with” list of 1 provider.');
    const lean = withPerson(s, 'pA', { setAside: [{ activityId: 'aAdmin', hours: 4 }] });
    expect(kindChange(lean, 'pA', 'support').say).toBe(
      'Changing Avery Quill to support staff removes 1 block of time that support staff have with them, their place on the “works with” list of 1 person and their 1 set-aside line. Their appointments stay on their week.',
    );
  });

  it('a change that removes nothing says nothing, and is still made', () => {
    const bare = withPerson(base, 'pB', { setAside: [] });
    expect(kindChange(bare, 'pB', 'support')).toEqual({ changes: true, withBlocks: 0, listEntries: 0, setAsideLines: 0, ownStandards: false, ramping: false, removes: false, say: '' });
    const change = setKind(bare, 'pB', 'support');
    expect(change.touched).toBe(0);
    expect(personOf(change.schedule, 'pB')?.kind).toBe('support');
    expect(kindChange(base, 'pT', 'provider')).toMatchObject({ changes: true, removes: false, say: '' });
    expect(personOf(setKind(base, 'pT', 'provider').schedule, 'pT')?.kind).toBe('provider');
  });

  it('changes nothing when the person already is of that kind, or is not in the schedule', () => {
    const nothing = { changes: false, withBlocks: 0, listEntries: 0, setAsideLines: 0, ownStandards: false, ramping: false, removes: false, say: '' };
    expect(kindChange(base, 'pA', 'provider')).toEqual(nothing);
    expect(kindChange(base, 'pS', 'support')).toEqual(nothing);
    expect(kindChange(base, 'nobody', 'support')).toEqual(nothing);
    expect(setKind(base, 'pA', 'provider')).toEqual({ schedule: base, touched: 0 });
    expect(setKind(base, 'pA', 'provider').schedule).toBe(base);
    expect(setKind(base, 'pS', 'support').schedule).toBe(base);
    expect(setKind(base, 'nobody', 'support').schedule).toBe(base);
  });

  it('keeps working hours through a change of kind', () => {
    const s = setWork(base, 'pA', 0, [{ from: 480, to: 1020 }]);
    expect(personOf(setKind(s, 'pA', 'support').schedule, 'pA')?.work).toEqual([{ day: 0, from: 480, to: 1020 }]);
  });

  it('writes the sentences in plain words', () => {
    for (const say of [kindChange(before(), 'pA', 'support').say, kindChange(before(), 'pS', 'provider').say]) {
      expect(say).not.toMatch(BANNED);
      expect(say).not.toMatch(DASHES);
    }
  });

  it('setPerson does not change a person\'s kind behind the back of setKind\'s clean-up', () => {
    // The kind is changed with setKind, which removes what no longer fits. setPerson with the same kind changes nothing.
    expect(setPerson(base, 'pS', { kind: 'support' })).toBe(base);
    expect(setPerson(base, 'pS', { kind: 'provider' })).toBe(base);
    expect(personOf(setPerson(base, 'pA', { kind: 'support', role: 'Nurse' }), 'pA')).toMatchObject({ kind: 'provider', role: 'Nurse' });
  });
});

describe('Schedule Designer: support staff in the tally', () => {
  /** Sage: 2 h with Avery, 1 h with Blake, 1 h of admin, lunch, and two nurse visits. */
  function week(): Schedule {
    let s: Schedule = withBlocks(base, averyMonday());
    s = paint(s, { personId: 'pS', day: 0, from: 480, to: 600, what: withTime('pA'), where: ELM });
    s = paint(s, { personId: 'pS', day: 1, from: 480, to: 540, what: withTime('pB'), where: ELM });
    s = paint(s, { personId: 'pS', day: 0, from: 600, to: 660, what: activity('aAdmin'), where: ELM });
    s = paint(s, { personId: 'pS', day: 0, from: 720, to: 780, what: activity('aLunch'), where: ELM });
    s = paint(s, { personId: 'pS', day: 2, from: 480, to: 520, what: visit('v20'), where: room('s1', 'r2') });
    return deepFreeze(s);
  }

  it('gives a support person no slot target and their own verdict', () => {
    const tally = tallyPerson(week(), 'pS');
    expect(tally?.kind).toBe('support');
    expect(tally?.slots).toMatchObject({ target: 0, actual: 0, variance: 0, verdict: 'support' });
    expect(VERDICT_NAMES.support).toBe('Support staff');
    expect([tally?.targetMinutes, tally?.setAsideMinutes, tally?.careShortMinutes, tally?.appointmentsNeeded]).toEqual([0, 0, 0, 0]);
    expect(tally?.days.map((day) => day.slots)).toEqual([0, 0, 0, 0, 0]);
    expect([capacityHours(week(), 'pS'), careTarget(week(), 'pS'), slotTarget(week(), 'pS')]).toEqual([0, 0, 0]);
    expect(tallyPerson(week(), 'pA')?.kind).toBe('provider');
  });

  it('counts time with providers as paid time that is not patient care, and by provider', () => {
    const tally = tallyPerson(week(), 'pS');
    // 3 h with providers, 1 of admin and 40 min of nurse visits are paid. Lunch is not.
    expect(tally?.week).toMatchObject({ appointments: 2, careMinutes: 40, withMinutes: 180, otherPaidMinutes: 240, unpaidMinutes: 60, paidMinutes: 280 });
    expect(tally?.days.map((day) => day.withMinutes)).toEqual([120, 60, 0, 0, 0]);
    expect(tally?.contractMinutes).toBe(2400);
    expect(tally?.paidShortMinutes).toBe(2120);
    // Admin is the paid time that is neither patient care, nor time with a provider, nor set aside.
    expect(tally?.otherPaidNotSetAsideMinutes).toBe(60);
    expect(tally?.withProviders).toEqual([
      { personId: 'pA', name: 'Avery Quill', listed: true, byDay: [120, 0, 0, 0, 0], minutes: 120 },
      { personId: 'pB', name: 'Blake Rowan', listed: true, byDay: [0, 60, 0, 0, 0], minutes: 60 },
    ]);
  });

  it('keeps a listed provider with no time as a row of zeros, and a provider has no such rows', () => {
    const s = addWorksWith(base, 'pS', 'pB');
    expect(tallyPerson(s, 'pS')?.withProviders).toEqual([{ personId: 'pB', name: 'Blake Rowan', listed: true, byDay: [0, 0, 0, 0, 0], minutes: 0 }]);
    expect(tallyPerson(week(), 'pA')?.withProviders).toEqual([]);
    expect(tallyPerson(week(), 'pA')?.week.withMinutes).toBe(0);
  });

  it('counts a support person\'s appointments in the clinic\'s counts and in no slot target', () => {
    const s = week();
    const without = removePerson(s, 'pS').schedule;
    const clinic = tallyClinic(s);
    // Avery's 12 appointments and Sage's 2 nurse visits.
    expect(clinic.appointments).toBe(14);
    expect(clinic.careMinutes).toBe(280);
    expect(clinic.byDay).toEqual([12, 0, 2, 0, 0]);
    expect(tallyClinic(without).appointments).toBe(12);
    const [primary, counselling] = clinic.departments;
    expect([primary?.people, primary?.supportStaff, counselling?.people, counselling?.supportStaff]).toEqual([1, 2, 1, 0]);
    // The slot sums are the providers' alone: the same with and without the support person.
    const [primaryWithout] = tallyClinic(without).departments;
    expect([primary?.peopleCounted, primary?.targetSlots, primary?.actualSlots, primary?.variance]).toEqual([primaryWithout?.peopleCounted, primaryWithout?.targetSlots, primaryWithout?.actualSlots, primaryWithout?.variance]);
    expect(primaryWithout?.supportStaff).toBe(1);
  });

  it('leaves a provider\'s tally as it is when support staff have time with them', () => {
    const s = week();
    const alone = withBlocks(base, averyMonday());
    expect(tallyPerson(s, 'pA')).toEqual(tallyPerson(alone, 'pA'));
  });
});

describe('Schedule Designer: care teams on the Overview', () => {
  it('carries the kind, the hours at work in the week and the names a person works with', () => {
    let s: Schedule = withBlocks(base, averyMonday());
    s = paint(s, { personId: 'pS', day: 0, from: 480, to: 600, what: withTime('pA'), where: ELM });
    s = addWorksWith(s, 'pS', 'pB');
    s = addWorksWith(s, 'pT', 'pA');
    s = setWork(s, 'pS', 0, [{ from: 480, to: 1020 }]);
    const rows = overview(s);
    expect(rows.map((row) => [row.personId, row.kind, row.workMinutes, row.worksWith])).toEqual([
      // A provider: the support staff who have time with them. Teal lists Avery and has no time with them.
      ['pA', 'provider', null, ['Sage Marlow']],
      ['pB', 'provider', null, []],
      // Support staff: the providers on their list, in the list's order.
      ['pS', 'support', 540, ['Avery Quill', 'Blake Rowan']],
      ['pT', 'support', null, ['Avery Quill']],
    ]);
    const monday = rows[2]?.days[0];
    expect(monday?.morning).toMatchObject({ kind: 'other', label: 'With Avery Quill', place: 'Elm Street', colour: personColour(s, 'pA'), minutes: 120 });
    expect(monday?.afternoon.kind).toBe('empty');
  });
});
