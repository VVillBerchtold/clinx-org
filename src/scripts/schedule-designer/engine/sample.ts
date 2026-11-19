// The sample clinic: a made-up week to try the tool with.
//
// In plain words: everything here is invented. There is no such clinic, and the eleven people are
// not real people. Eight are providers and three are support staff. The week is built to look like a community health clinic's template: two sites,
// three departments, lunch at noon, a team meeting on Wednesday afternoon. The week shows 6:00 am to
// 9:00 pm. Most people work 8:00 to 5:00. Sunniva Kell starts at 7:00 am on Monday, and Kofi Brantwood
// has a late Tuesday that ends at 7:00 pm, so the wider hours are seen in use. Each department has its
// standards: the share of contract hours that is patient care, and the slots in an hour. A
// person's contract hours times that share, less the hours set aside for named work such as the
// team meeting, is their capacity, and the capacity counted in slots is the target their week is
// filled to. Yusra Hollin is the method's own worked case: contract 34, factor 0.8, 1 hour set
// aside, so 26.2 hours and, at 3 slots an hour, a target of 79 slots. A few things are left wrong
// on purpose, so the checks have something to show:
// - Tobin Achterberg and Linnea Farrowby are both in Exam 2 on Tuesday morning (a room clash).
// - Tobin Achterberg has an empty hour on Thursday afternoon, so he is 3 slots under his target.
// - Dalia Pemberthy has an hour set aside for training that is not on her week. The hour went to
//   patients, so she is 3 slots over her target.
// - Linnea Farrowby is new and marked as ramping: her lighter week gets a note and no verdict.
// - The Group visit type in Behavioral health is not used.
// - Yusra Hollin sees patients on Friday afternoon with no support staff with her.
// Everyone has working hours that hold all their time. The three support staff have no
// appointments: two medical assistants and a nurse care manager, each with time with the
// providers they work with, a huddle, the team meeting and some admin time.
// The ids are fixed words, not random, so the sample is the same every time it is opened.

import type { Block, Day, Person, PersonKind, Schedule, What, Where, WorkStretch } from './types';

const TANNERY = 'site-tannery';
const COLDBROOK = 'site-coldbrook';

const at = (siteId: string, roomId: string | null): Where => ({ kind: 'site', siteId, roomId });
const REMOTE: Where = { kind: 'remote' };
const NOWHERE: Where = { kind: 'none' };

/** Clock times as minutes: h(13) is 1:00 pm, h(8, 20) is 8:20 am. */
const h = (hour: number, minute = 0): number => hour * 60 + minute;

/** The sample clinic. A new copy is made each time, so nothing done to one copy reaches another. */
export function sampleSchedule(): Schedule {
  const blocks: Block[] = [];
  const add = (personId: string, day: Day, start: number, minutes: number, what: What, where: Where): void => {
    blocks.push({ id: `b${blocks.length + 1}`, personId, day, start, minutes, what, where });
  };
  /** Appointments of one type laid end to end. Gives back the minute they end. */
  const visits = (personId: string, day: Day, from: number, to: number, visitTypeId: string, minutes: number, where: Where): number => {
    let start = from;
    for (; start + minutes <= to; start += minutes) add(personId, day, start, minutes, { kind: 'visit', visitTypeId }, where);
    return start;
  };
  const other = (personId: string, day: Day, from: number, to: number, activityId: string, where: Where): void => {
    add(personId, day, from, to - from, { kind: 'activity', activityId }, where);
  };
  const lunch = (personId: string, day: Day): void => other(personId, day, h(12), h(13), 'act-lunch', NOWHERE);

  // A stretch of primary care: a new patient first when there is room for one, same-day
  // appointments in the last 40 minutes, standard ones between. `careTeam` swaps the same-day ones for care team visits.
  const primaryCare = (personId: string, day: Day, from: number, to: number, where: Where, careTeam = false): void => {
    let start = from;
    if (to - from >= 200) start = visits(personId, day, start, start + 40, 'vt-pc-new', 40, where);
    start = visits(personId, day, start, to - 40, 'vt-pc-std', 20, where);
    visits(personId, day, start, to, careTeam ? 'vt-pc-team' : 'vt-pc-same', 20, where);
  };
  // A stretch of pediatrics: two new patients first in a long stretch, two same-day appointments last.
  const pediatrics = (personId: string, day: Day, from: number, to: number, where: Where): void => {
    let start = from;
    if (to - from >= 180) start = visits(personId, day, start, start + 60, 'vt-peds-new', 30, where);
    start = visits(personId, day, start, to - 30, 'vt-peds-std', 15, where);
    visits(personId, day, start, to, 'vt-peds-same', 15, where);
  };
  // A stretch of behavioral health: one extended visit first in a full morning, then standard ones.
  const behavioral = (personId: string, day: Day, from: number, to: number, where: Where): void => {
    let start = from;
    if (to - from >= 240) start = visits(personId, day, start, start + 60, 'vt-bh-ext', 60, where);
    visits(personId, day, start, to, 'vt-bh-std', 30, where);
  };

  const HUDDLE = at(TANNERY, null);
  const MEETING = at(TANNERY, 'room-t-group');

  // Maren Castellane, physician. 40 contract hours x 0.8, less 1 set aside, is 31 hours: 93 slots, all planned.
  {
    const p = 'p-maren';
    const room = at(TANNERY, 'room-t-exam1');
    other(p, 0, h(8), h(8, 20), 'act-huddle', HUDDLE);
    primaryCare(p, 0, h(8, 20), h(12), room);
    primaryCare(p, 0, h(13), h(16), room);
    other(p, 0, h(16), h(17), 'act-admin', room);
    primaryCare(p, 1, h(8), h(12), room);
    primaryCare(p, 1, h(13), h(16), room);
    other(p, 1, h(16), h(17), 'act-admin', room);
    other(p, 2, h(8), h(8, 20), 'act-huddle', HUDDLE);
    primaryCare(p, 2, h(8, 20), h(12), room);
    other(p, 2, h(13), h(14), 'act-meeting', MEETING);
    other(p, 2, h(14), h(17), 'act-admin', room);
    primaryCare(p, 3, h(8), h(12), room);
    primaryCare(p, 3, h(13), h(16), room);
    other(p, 3, h(16), h(17), 'act-admin', room);
    other(p, 4, h(8), h(8, 20), 'act-huddle', HUDDLE);
    primaryCare(p, 4, h(8, 20), h(12), room);
    primaryCare(p, 4, h(13), h(16), REMOTE);
    other(p, 4, h(16), h(17), 'act-admin', REMOTE);
    for (const day of [0, 1, 2, 3, 4] as const) lunch(p, day);
  }

  // Tobin Achterberg, nurse practitioner. 36 contract hours x 0.8, less 1 set aside, is 27.8 hours: 83 slots.
  // Thursday from 3:00 to 4:00 pm is left empty on purpose: he has 80 slots, 3 under.
  {
    const p = 'p-tobin';
    const room = at(TANNERY, 'room-t-exam2');
    other(p, 0, h(8), h(8, 20), 'act-huddle', HUDDLE);
    primaryCare(p, 0, h(8, 20), h(12), room);
    primaryCare(p, 0, h(13), h(16), room);
    other(p, 0, h(16), h(17), 'act-admin', room);
    primaryCare(p, 1, h(8), h(12), room);
    primaryCare(p, 1, h(13), h(16), room);
    other(p, 1, h(16), h(17), 'act-admin', room);
    other(p, 2, h(8), h(8, 20), 'act-huddle', HUDDLE);
    primaryCare(p, 2, h(8, 20), h(12), room);
    other(p, 2, h(13), h(14), 'act-meeting', MEETING);
    other(p, 2, h(14), h(17), 'act-admin', room);
    primaryCare(p, 3, h(8), h(12), room);
    primaryCare(p, 3, h(13), h(15), room);
    other(p, 3, h(16), h(17), 'act-admin', room);
    other(p, 4, h(8), h(8, 20), 'act-huddle', HUDDLE);
    primaryCare(p, 4, h(8, 20), h(11, 40), room);
    other(p, 4, h(11, 40), h(12), 'act-admin', room);
    for (const day of [0, 1, 2, 3] as const) lunch(p, day);
  }

  // Yusra Hollin, physician at the annex, four days and the team meeting from home.
  // The worked case: 34 contract hours x 0.8, less 1 set aside, is 26.2 hours: 79 slots, all planned.
  {
    const p = 'p-yusra';
    const room = at(COLDBROOK, 'room-c-exam1');
    const huddle = at(COLDBROOK, null);
    other(p, 0, h(8), h(8, 20), 'act-huddle', huddle);
    primaryCare(p, 0, h(8, 20), h(12), room);
    primaryCare(p, 0, h(13), h(16), room);
    other(p, 0, h(16), h(17), 'act-admin', room);
    primaryCare(p, 1, h(8), h(12), room);
    primaryCare(p, 1, h(13), h(16), room);
    other(p, 1, h(16), h(17), 'act-admin', room);
    other(p, 2, h(13), h(14), 'act-meeting', REMOTE);
    other(p, 2, h(14), h(15), 'act-admin', REMOTE);
    other(p, 3, h(8), h(8, 20), 'act-huddle', huddle);
    primaryCare(p, 3, h(8, 20), h(12), room);
    primaryCare(p, 3, h(13), h(15, 40), room);
    other(p, 3, h(15, 40), h(17), 'act-admin', room);
    other(p, 4, h(8), h(8, 20), 'act-huddle', huddle);
    primaryCare(p, 4, h(8, 20), h(12), room);
    primaryCare(p, 4, h(13), h(15, 40), room);
    other(p, 4, h(15, 40), h(17), 'act-admin', room);
    for (const day of [0, 1, 3, 4] as const) lunch(p, day);
  }

  // Dalia Pemberthy, physician assistant. 40 contract hours x 0.8, less 2 set aside, is 30 hours: 90 slots.
  // The hour set aside for training is not on her week, on purpose: it went to patients, so she has 93 slots, 3 over.
  {
    const p = 'p-dalia';
    const room = at(TANNERY, 'room-t-exam3');
    const annex = at(COLDBROOK, 'room-c-exam2');
    other(p, 0, h(8), h(8, 20), 'act-huddle', HUDDLE);
    primaryCare(p, 0, h(8, 20), h(12), room);
    primaryCare(p, 0, h(13), h(16), room);
    other(p, 0, h(16), h(17), 'act-admin', room);
    primaryCare(p, 1, h(8), h(12), annex, true);
    primaryCare(p, 1, h(13), h(16), annex, true);
    other(p, 1, h(16), h(17), 'act-admin', annex);
    other(p, 2, h(8), h(8, 20), 'act-huddle', REMOTE);
    primaryCare(p, 2, h(8, 20), h(12), REMOTE);
    other(p, 2, h(13), h(14), 'act-meeting', REMOTE);
    primaryCare(p, 2, h(14), h(15), REMOTE);
    other(p, 2, h(15), h(17), 'act-admin', REMOTE);
    primaryCare(p, 3, h(8), h(12), room);
    primaryCare(p, 3, h(13), h(15), room);
    other(p, 3, h(15), h(17), 'act-admin', room);
    other(p, 4, h(8), h(8, 20), 'act-huddle', HUDDLE);
    primaryCare(p, 4, h(8, 20), h(12), room);
    primaryCare(p, 4, h(13), h(16), room);
    other(p, 4, h(16), h(17), 'act-admin', room);
    for (const day of [0, 1, 2, 3, 4] as const) lunch(p, day);
  }

  // Osric Vandermeer, pediatrician. 40 contract hours x 0.85, less 1 set aside, is 33 hours: 132 slots, all planned.
  {
    const p = 'p-osric';
    const room = at(TANNERY, 'room-t-exam4');
    for (const day of [0, 1, 2, 3] as const) {
      other(p, day, h(8), h(8, 15), 'act-huddle', HUDDLE);
      pediatrics(p, day, h(8, 15), h(12), room);
    }
    pediatrics(p, 0, h(13), h(17), room);
    pediatrics(p, 1, h(13), h(17), room);
    other(p, 2, h(13), h(14), 'act-meeting', MEETING);
    other(p, 2, h(14), h(17), 'act-admin', room);
    pediatrics(p, 3, h(13), h(16), room);
    other(p, 3, h(16), h(17), 'act-admin', room);
    pediatrics(p, 4, h(8), h(12), room);
    pediatrics(p, 4, h(13), h(16), room);
    other(p, 4, h(16), h(17), 'act-admin', room);
    for (const day of [0, 1, 2, 3, 4] as const) lunch(p, day);
  }

  // Linnea Farrowby, nurse practitioner in pediatrics, three days, new and still ramping.
  // 24 contract hours x 0.85, less 1 set aside, is 19.4 hours: 78 slots. Her week has 65 while she builds up.
  // On Tuesday morning she is in Exam 2, where Tobin Achterberg already is: the clash is on purpose.
  {
    const p = 'p-linnea';
    const room = at(TANNERY, 'room-t-exam5');
    for (const day of [1, 2, 3] as const) other(p, day, h(8), h(8, 15), 'act-huddle', HUDDLE);
    pediatrics(p, 1, h(8, 15), h(12), at(TANNERY, 'room-t-exam2'));
    other(p, 1, h(13), h(15), 'act-training', room);
    pediatrics(p, 1, h(15), h(17), room);
    pediatrics(p, 2, h(8, 15), h(12), room);
    other(p, 2, h(13), h(14), 'act-meeting', MEETING);
    other(p, 2, h(14), h(16), 'act-admin', room);
    pediatrics(p, 2, h(16), h(17), room);
    pediatrics(p, 3, h(8, 15), h(12), room);
    pediatrics(p, 3, h(13), h(15), room);
    other(p, 3, h(15), h(17), 'act-admin', room);
    for (const day of [1, 2, 3] as const) lunch(p, day);
  }

  // Kofi Brantwood, therapist. 40 contract hours x 0.85, less 2 set aside, is 32 hours: 64 slots at 2 an hour, all planned.
  {
    const p = 'p-kofi';
    const room = at(TANNERY, 'room-t-consult');
    for (const day of [0, 2, 3, 4] as const) {
      behavioral(p, day, h(8), h(12), room);
      lunch(p, day);
    }
    behavioral(p, 0, h(13), h(16), room);
    other(p, 0, h(16), h(17), 'act-admin', room);
    // Tuesday is his late day: the same stretches as an ordinary day, from 10:00 am to 7:00 pm.
    other(p, 1, h(10), h(11, 30), 'act-admin', room);
    behavioral(p, 1, h(11, 30), h(14), room);
    other(p, 1, h(14), h(15), 'act-lunch', NOWHERE);
    behavioral(p, 1, h(15), h(19), room);
    other(p, 2, h(13), h(14), 'act-meeting', MEETING);
    other(p, 2, h(14), h(15), 'act-training', room);
    behavioral(p, 2, h(15), h(16), room);
    other(p, 2, h(16), h(17), 'act-admin', room);
    behavioral(p, 3, h(13), h(15, 30), room);
    other(p, 3, h(15, 30), h(17), 'act-admin', room);
    behavioral(p, 4, h(13), h(16), room);
    other(p, 4, h(16), h(17), 'act-admin', room);
  }

  // Sunniva Kell, clinical social worker, half time. 20 contract hours x 0.85, less 1 set aside, is 16 hours: 32 slots, all planned.
  {
    const p = 'p-sunniva';
    const room = at(COLDBROOK, 'room-c-consult');
    // Monday starts at 7:00 am, an hour before the others: the same stretches as before, each an hour earlier.
    behavioral(p, 0, h(7), h(11), room);
    other(p, 0, h(11), h(12), 'act-lunch', NOWHERE);
    behavioral(p, 0, h(12), h(15), room);
    other(p, 0, h(15), h(16), 'act-admin', room);
    behavioral(p, 2, h(8), h(12), room);
    lunch(p, 2);
    other(p, 2, h(13), h(14), 'act-meeting', REMOTE);
    behavioral(p, 2, h(14), h(16), room);
    other(p, 2, h(16), h(17), 'act-admin', room);
    behavioral(p, 4, h(8), h(11), REMOTE);
    other(p, 4, h(11), h(12), 'act-admin', REMOTE);
  }

  // The three support staff. None of them has appointments. Time with a provider is at the
  // provider's site with no room, over the provider's appointments there.
  const withProvider = (personId: string, day: Day, from: number, to: number, providerId: string, siteId: string): void => {
    add(personId, day, from, to - from, { kind: 'with', personId: providerId }, at(siteId, null));
  };

  // Briony Halvard, medical assistant, with Maren Castellane all week. 40 contract hours, 28 of them with her.
  // On Friday afternoon Maren Castellane sees patients from home, so that time is admin time.
  {
    const p = 'p-briony';
    const desk = at(TANNERY, null);
    for (const day of [0, 2, 4] as const) {
      other(p, day, h(8), h(8, 20), 'act-huddle', HUDDLE);
      withProvider(p, day, h(8, 20), h(12), 'p-maren', TANNERY);
    }
    for (const day of [1, 3] as const) withProvider(p, day, h(8), h(12), 'p-maren', TANNERY);
    for (const day of [0, 1, 3] as const) {
      withProvider(p, day, h(13), h(16), 'p-maren', TANNERY);
      other(p, day, h(16), h(17), 'act-admin', desk);
    }
    other(p, 2, h(13), h(14), 'act-meeting', MEETING);
    other(p, 2, h(14), h(17), 'act-admin', desk);
    other(p, 4, h(13), h(17), 'act-admin', desk);
    for (const day of [0, 1, 2, 3, 4] as const) lunch(p, day);
  }

  // Emrys Tolliver, medical assistant, with two providers on different days: Yusra Hollin at the
  // annex on Monday and on Friday morning, Linnea Farrowby at Tannery Row from Tuesday to Thursday.
  // 36 contract hours. His time with Linnea Farrowby follows her 15 minute grid.
  {
    const p = 'p-emrys';
    const annex = at(COLDBROOK, null);
    const desk = at(TANNERY, null);
    other(p, 0, h(8), h(8, 20), 'act-huddle', annex);
    withProvider(p, 0, h(8, 20), h(12), 'p-yusra', COLDBROOK);
    withProvider(p, 0, h(13), h(16), 'p-yusra', COLDBROOK);
    other(p, 0, h(16), h(17), 'act-admin', annex);
    for (const day of [1, 2, 3] as const) {
      other(p, day, h(8), h(8, 15), 'act-huddle', HUDDLE);
      withProvider(p, day, h(8, 15), h(12), 'p-linnea', TANNERY);
    }
    other(p, 1, h(13), h(15), 'act-admin', desk);
    withProvider(p, 1, h(15), h(17), 'p-linnea', TANNERY);
    other(p, 2, h(13), h(14), 'act-meeting', MEETING);
    other(p, 2, h(14), h(16), 'act-admin', desk);
    withProvider(p, 2, h(16), h(17), 'p-linnea', TANNERY);
    withProvider(p, 3, h(13), h(15), 'p-linnea', TANNERY);
    other(p, 3, h(15), h(17), 'act-admin', desk);
    other(p, 4, h(8), h(8, 20), 'act-huddle', annex);
    withProvider(p, 4, h(8, 20), h(12), 'p-yusra', COLDBROOK);
    for (const day of [0, 1, 2, 3] as const) lunch(p, day);
  }

  // Odalys Wren, nurse care manager, three days at the annex. With Yusra Hollin on Tuesday and
  // Thursday, and a Wednesday of admin time and the team meeting. 24 contract hours.
  // Nobody is with Yusra Hollin on Friday afternoon, on purpose.
  {
    const p = 'p-odalys';
    const annex = at(COLDBROOK, null);
    withProvider(p, 1, h(8), h(12), 'p-yusra', COLDBROOK);
    withProvider(p, 1, h(13), h(16), 'p-yusra', COLDBROOK);
    other(p, 1, h(16), h(17), 'act-admin', annex);
    other(p, 2, h(8), h(12), 'act-admin', annex);
    other(p, 2, h(13), h(14), 'act-meeting', REMOTE);
    other(p, 2, h(14), h(17), 'act-admin', annex);
    other(p, 3, h(8), h(8, 20), 'act-huddle', annex);
    withProvider(p, 3, h(8, 20), h(12), 'p-yusra', COLDBROOK);
    withProvider(p, 3, h(13), h(15, 40), 'p-yusra', COLDBROOK);
    other(p, 3, h(15, 40), h(17), 'act-admin', annex);
    for (const day of [1, 2, 3] as const) lunch(p, day);
  }

  /** Working hours: the same stretch on each of the days given, 8:00 am to 5:00 pm unless said. */
  const hoursOn = (days: readonly Day[], from = h(8), to = h(17)): WorkStretch[] => days.map((day) => ({ day, from, to }));
  /** Stretches from several calls, in the order the engine keeps them: by day, then by start. */
  const working = (...parts: WorkStretch[][]): WorkStretch[] => parts.flat().sort((a, b) => a.day - b.day || a.from - b.from);
  const WEEK = [0, 1, 2, 3, 4] as const;

  const person = (
    id: string,
    name: string,
    role: string,
    departmentId: string,
    contractHours: number,
    setAside: Person['setAside'],
    work: WorkStretch[],
    more: { ramping?: boolean; kind?: PersonKind; worksWith?: string[] } = {},
  ): Person => ({
    id,
    name,
    role,
    kind: more.kind ?? 'provider',
    departmentId,
    step: departmentId === 'dept-pc' ? 20 : 15,
    contractHours,
    setAside: setAside.map((line) => ({ ...line })),
    careFactor: null,
    slotsPerHour: null,
    ramping: more.ramping ?? false,
    worksWith: [...(more.worksWith ?? [])],
    work,
  });
  const meeting = { activityId: 'act-meeting', hours: 1 };
  const training = { activityId: 'act-training', hours: 1 };

  return {
    format: 'clinx-schedule',
    version: 1,
    name: 'Sample week',
    clinic: 'Alderwick Community Health (a made-up sample)',
    days: [0, 1, 2, 3, 4],
    dayStart: h(6),
    dayEnd: h(21),
    sites: [
      {
        id: TANNERY,
        name: 'Tannery Row',
        rooms: [
          { id: 'room-t-exam1', name: 'Exam 1' },
          { id: 'room-t-exam2', name: 'Exam 2' },
          { id: 'room-t-exam3', name: 'Exam 3' },
          { id: 'room-t-exam4', name: 'Exam 4' },
          { id: 'room-t-exam5', name: 'Exam 5' },
          { id: 'room-t-consult', name: 'Consult A' },
          { id: 'room-t-group', name: 'Group room' },
        ],
      },
      {
        id: COLDBROOK,
        name: 'Coldbrook Annex',
        rooms: [
          { id: 'room-c-exam1', name: 'Exam 1' },
          { id: 'room-c-exam2', name: 'Exam 2' },
          { id: 'room-c-consult', name: 'Consult B' },
        ],
      },
    ],
    departments: [
      {
        id: 'dept-pc',
        name: 'Primary care',
        step: 20,
        careFactor: 0.8,
        slotsPerHour: 3,
        visitTypes: [
          { id: 'vt-pc-std', name: 'Standard', code: 'STD', minutes: 20, colour: 1 },
          { id: 'vt-pc-new', name: 'New patient', code: 'NEW', minutes: 40, colour: 2 },
          { id: 'vt-pc-same', name: 'Same day', code: 'SAME', minutes: 20, colour: 7 },
          { id: 'vt-pc-team', name: 'Care team', code: 'TEAM', minutes: 20, colour: 3 },
        ],
      },
      {
        id: 'dept-peds',
        name: 'Pediatrics',
        step: 15,
        careFactor: 0.85,
        slotsPerHour: 4,
        visitTypes: [
          { id: 'vt-peds-std', name: 'Standard', code: 'STD', minutes: 15, colour: 4 },
          { id: 'vt-peds-new', name: 'New patient', code: 'NEW', minutes: 30, colour: 2 },
          { id: 'vt-peds-same', name: 'Same day', code: 'SAME', minutes: 15, colour: 7 },
        ],
      },
      {
        id: 'dept-bh',
        name: 'Behavioral health',
        step: 15,
        careFactor: 0.85,
        slotsPerHour: 2,
        visitTypes: [
          { id: 'vt-bh-std', name: 'Standard', code: 'STD', minutes: 30, colour: 9 },
          { id: 'vt-bh-ext', name: 'Extended', code: 'EXT', minutes: 60, colour: 8 },
          { id: 'vt-bh-group', name: 'Group', code: 'GRP', minutes: 60, colour: 5 },
        ],
      },
    ],
    activities: [
      { id: 'act-huddle', name: 'Huddle', colour: 6, paid: true },
      { id: 'act-meeting', name: 'Team meeting', colour: 10, paid: true },
      { id: 'act-admin', name: 'Admin time', colour: 11, paid: true },
      { id: 'act-training', name: 'Training', colour: 3, paid: true },
      { id: 'act-lunch', name: 'Lunch', colour: 12, paid: false },
    ],
    people: [
      person('p-maren', 'Maren Castellane', 'Physician', 'dept-pc', 40, [meeting], hoursOn(WEEK)),
      person('p-tobin', 'Tobin Achterberg', 'Nurse practitioner', 'dept-pc', 36, [meeting], working(hoursOn([0, 1, 2, 3]), hoursOn([4], h(8), h(12)))),
      person('p-yusra', 'Yusra Hollin', 'Physician', 'dept-pc', 34, [meeting], working(hoursOn([0, 1, 3, 4]), hoursOn([2], h(13), h(15)))),
      person('p-dalia', 'Dalia Pemberthy', 'Physician assistant', 'dept-pc', 40, [meeting, training], hoursOn(WEEK)),
      person('p-osric', 'Osric Vandermeer', 'Pediatrician', 'dept-peds', 40, [meeting], hoursOn(WEEK)),
      person('p-linnea', 'Linnea Farrowby', 'Nurse practitioner', 'dept-peds', 24, [meeting], hoursOn([1, 2, 3]), { ramping: true }),
      person('p-kofi', 'Kofi Brantwood', 'Therapist', 'dept-bh', 40, [meeting, training], working(hoursOn([0, 2, 3, 4]), hoursOn([1], h(10), h(19)))),
      person('p-sunniva', 'Sunniva Kell', 'Clinical social worker', 'dept-bh', 20, [meeting], working(hoursOn([0], h(7), h(16)), hoursOn([2]), hoursOn([4], h(8), h(12)))),
      person('p-briony', 'Briony Halvard', 'Medical assistant', 'dept-pc', 40, [], hoursOn(WEEK), { kind: 'support', worksWith: ['p-maren'] }),
      person('p-emrys', 'Emrys Tolliver', 'Medical assistant', 'dept-pc', 36, [], working(hoursOn([0, 1, 2, 3]), hoursOn([4], h(8), h(12))), { kind: 'support', worksWith: ['p-yusra', 'p-linnea'] }),
      person('p-odalys', 'Odalys Wren', 'Nurse care manager', 'dept-pc', 24, [], hoursOn([1, 2, 3]), { kind: 'support', worksWith: ['p-yusra'] }),
    ],
    blocks,
    // A week within 2 slots of its target counts as on target.
    tolerance: 2,
  };
}
