// The tallies beside the week. They are worked out again from the schedule every time it changes,
// so the numbers move as the person paints.
import { coverage, dayName, personColour, personOf, roomHours, siteOf, tallyPerson } from './engine/index';
import type { PersonTally, Schedule } from './engine/index';
import { dot, el, fill, hrs, icon, num, tight } from './dom';
import { app, emit } from './state';
import { signed, slotNum, slotWords, targetSay, verdictSay } from './slots';
import { plannedOutside, workFigures } from './work-say';
import { dayOrder, nameAndRole, paidSay, teamRows } from './team-say';

function card(title: string, ...children: (Node | string | null)[]): HTMLElement {
  return el('section', { class: 'sd-card' }, el('h3', { class: 'sd-card-h' }, title), ...children);
}

/** A thin bar: how much is there, against how much is wanted. */
export function meter(have: number, want: number, extra = '', met = false): HTMLElement {
  const whole = Math.max(have, want, 1);
  // A week inside the tolerance is on target, so its bar has the colour of the heading over it.
  const state = want === 0 && have === 0 ? 'is-empty' : met ? 'is-met' : have > want ? 'is-over' : have === want ? 'is-met' : 'is-short';
  const fillBar = el('span', { class: 'sd-meter-fill' });
  fillBar.style.width = `${(Math.min(have, want) / whole) * 100}%`;
  const over = el('span', { class: 'sd-meter-over' });
  over.style.left = `${(want / whole) * 100}%`;
  over.style.width = `${(Math.max(0, have - want) / whole) * 100}%`;
  const mark = el('span', { class: 'sd-meter-mark' });
  mark.style.left = `${(want / whole) * 100}%`;
  return el('div', { class: `sd-meter ${state}${extra ? ` ${extra}` : ''}`, 'aria-hidden': 'true' }, fillBar, over, want > 0 ? mark : null);
}

function slotsCard(s: Schedule, tally: PersonTally): HTMLElement {
  const slots = tally.slots;
  const say = verdictSay(slots, s.tolerance);
  const judged = slots.verdict === 'on-target' || slots.verdict === 'over' || slots.verdict === 'under';
  return el(
    'section',
    { class: 'sd-card sd-care' },
    el('h3', { class: 'sd-card-h' }, 'Slots this week'),
    el('p', { class: `sd-verdict is-${say.state}` }, say.state === 'met' ? icon('check', 22) : null, say.head),
    el('p', { class: 'sd-big' }, el('strong', {}, slotNum(slots.actual)), el('span', {}, ` of ${slotWords(slots.target)}`)),
    meter(slots.actual, slots.target, 'is-big', judged && say.state === 'met'),
    el('p', { class: 'sd-card-note' }, say.note),
    el(
      'dl',
      { class: 'sd-sum' },
      el('div', {}, el('dt', {}, 'Target'), el('dd', {}, slotNum(slots.target))),
      el('div', {}, el('dt', {}, 'Scheduled'), el('dd', {}, slotNum(slots.actual))),
      el('div', { class: `is-total is-${judged ? say.state : 'none'}` }, el('dt', {}, 'Difference'), el('dd', {}, signed(slots.variance))),
    ),
    el('p', { class: 'sd-made' }, el('strong', {}, 'How the target is made. '), targetSay(s, tally.personId)),
  );
}

/**
 * Time at work this week as a sum the reader can check: scheduled and open add up to at work.
 * Time planned outside working hours is a figure of its own under the sum. Nothing while no
 * working hours are entered.
 */
function workCard(s: Schedule, tally: PersonTally): HTMLElement | null {
  const figures = workFigures(tally.workMinutes, tally.openMinutes);
  if (!figures) return null;
  const outside = plannedOutside(s, tally.personId);
  const unpaid = tally.paidWorkMinutes === null ? 0 : figures.work - tally.paidWorkMinutes;
  const row = (label: string, minutes: number, extra = ''): HTMLElement => el('div', { class: `sd-adds-row${extra}` }, el('dt', {}, label), el('dd', {}, hrs(minutes)));
  return el(
    'section',
    { class: 'sd-card sd-atwork' },
    el('h3', { class: 'sd-card-h' }, 'Working hours'),
    el('dl', { class: 'sd-adds' }, row('Scheduled', figures.scheduled), row('Open', figures.open), row('At work', figures.work, ' is-sum'), outside > 0 ? row('Planned outside working hours', outside, ' is-apart') : null),
    unpaid > 0 ? el('p', { class: 'sd-card-note' }, `At work has lunch and other unpaid time in it: ${hrs(unpaid)} this week.`) : null,
  );
}

/** A support person's week in place of the slot card: paid hours against contract hours, and the hours with each provider. */
function supportCard(s: Schedule, tally: PersonTally): HTMLElement {
  const rows = tally.withProviders.map((row) => el('li', { class: 'sd-line-row' }, el('div', { class: 'sd-line-say' }, el('span', { class: 'sd-line-name' }, dot(personColour(s, row.personId)), row.name), el('span', { class: 'sd-line-num' }, el('strong', {}, hrs(row.minutes))))));
  const short = tally.paidShortMinutes;
  const over = tally.paidOverMinutes;
  return el(
    'section',
    { class: 'sd-card sd-care' },
    el('h3', { class: 'sd-card-h' }, 'Hours this week'),
    el('p', { class: 'sd-big' }, el('strong', {}, hrs(tally.week.paidMinutes)), el('span', {}, ` of ${hrs(tally.contractMinutes)} paid`)),
    meter(tally.week.paidMinutes, tally.contractMinutes, 'is-big'),
    el('p', { class: 'sd-card-note' }, paidSay(tally.contractMinutes, short, over).note),
    el('h4', { class: 'sd-card-sub' }, 'With each provider'),
    rows.length > 0 ? el('ul', { class: 'sd-lines' }, ...rows) : el('p', { class: 'sd-card-note' }, 'Nobody is on the “works with” list yet. Providers are added to it in Set up.'),
    el('p', { class: 'sd-card-note' }, 'Support staff have no slot target.'),
  );
}

/** Who is with a provider this week, and how much of the provider's patient time has somebody with them. Nothing when nobody is. */
function teamCard(s: Schedule, tally: PersonTally): HTMLElement | null {
  const rows = teamRows(s, tally.personId);
  if (rows.length === 0) return null;
  let alone = 0;
  let beside = 0;
  for (const day of s.days) {
    const cover = coverage(s, tally.personId, day);
    for (const span of cover.uncovered) alone += span.to - span.from;
    for (const span of cover.covered) beside += span.to - span.from;
  }
  const say = alone > 0 ? `${hrs(alone)} of their patient time at a site has nobody with them.` : beside > 0 ? 'Somebody is with them for all their patient time at a site.' : 'They have no patient time at a site this week.';
  return card(
    'Support staff with them',
    el('ul', { class: 'sd-lines' }, ...rows.map((row) => el('li', { class: 'sd-line-row' }, el('div', { class: 'sd-line-say' }, el('span', { class: 'sd-line-name' }, dot(personColour(s, row.personId)), nameAndRole(row)), el('span', { class: 'sd-line-num' }, el('strong', {}, hrs(row.minutes))))))),
    el('p', { class: 'sd-card-note' }, say),
  );
}

function daysCard(s: Schedule, tally: PersonTally): HTMLElement {
  const rows = tally.days.map((row) => el('tr', {}, el('th', { scope: 'row' }, dayName(row.day)), el('td', {}, slotNum(row.slots)), el('td', {}, num(row.appointments)), el('td', {}, hrs(row.careMinutes))));
  return card(
    'Each day',
    el(
      'table',
      { class: 'sd-table' },
      el('caption', { class: 'visually-hidden' }, `Slots, appointments and patient care hours for each day of ${personOf(s, tally.personId)?.name ?? 'this person'}'s week`),
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Day'), el('th', { scope: 'col' }, 'Slots'), el('th', { scope: 'col' }, 'Visits'), el('th', { scope: 'col' }, 'Hours'))),
      el('tbody', {}, ...rows),
      el('tfoot', {}, el('tr', {}, el('th', { scope: 'row' }, 'Week'), el('td', {}, slotNum(tally.slots.actual)), el('td', {}, num(tally.week.appointments)), el('td', {}, hrs(tally.week.careMinutes)))),
    ),
  );
}

/** Each day for a support person: paid hours, and the hours beside a provider. */
function supportDaysCard(s: Schedule, tally: PersonTally): HTMLElement {
  const rows = tally.days.map((row) => el('tr', {}, el('th', { scope: 'row' }, dayName(row.day)), el('td', {}, hrs(row.paidMinutes)), el('td', {}, hrs(row.withMinutes))));
  return card(
    'Each day',
    el(
      'table',
      { class: 'sd-table' },
      el('caption', { class: 'visually-hidden' }, `Paid hours and hours with a provider for each day of ${personOf(s, tally.personId)?.name ?? 'this person'}'s week`),
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Day'), el('th', { scope: 'col' }, 'Paid'), el('th', { scope: 'col', title: 'Hours with a provider' }, 'With'))),
      el('tbody', {}, ...rows),
      el('tfoot', {}, el('tr', {}, el('th', { scope: 'row' }, 'Week'), el('td', {}, hrs(tally.week.paidMinutes)), el('td', {}, hrs(tally.week.withMinutes)))),
    ),
    el('p', { class: 'sd-card-note' }, 'The With column is the time beside a provider.'),
  );
}

function line(label: Node | string, have: number, want: number, lead: Node | null = null): HTMLElement {
  return el('li', { class: 'sd-line-row' }, el('div', { class: 'sd-line-say' }, el('span', { class: 'sd-line-name' }, lead, label), el('span', { class: 'sd-line-num' }, el('strong', {}, hrs(have)), ` of ${hrs(want)}`)), meter(have, want));
}

function hoursCard(tally: PersonTally): HTMLElement {
  const lines = tally.setAside.map((row) => line(row.name, row.scheduledMinutes, row.allowedMinutes, dot(row.colour)));
  const care = line('Patient care', tally.week.careMinutes, tally.targetMinutes);
  const paid = line('Paid hours', tally.week.paidMinutes, tally.contractMinutes);
  paid.classList.add('is-paid');
  return card(
    'Hours',
    el('ul', { class: 'sd-lines' }, care, paid, ...lines),
    tally.setAside.length === 0 ? el('p', { class: 'sd-card-note' }, 'No hours are set aside for other work. Set-aside lines are added in Set up.') : null,
    tally.otherPaidNotSetAsideMinutes > 0 ? el('p', { class: 'sd-card-note' }, `${hrs(tally.otherPaidNotSetAsideMinutes)} of other paid time has no set-aside line.`) : null,
  );
}

function mixCard(tally: PersonTally): HTMLElement {
  const week = tally.week;
  const tile = (label: string, value: number, extra = ''): HTMLElement => el('div', { class: `sd-tile${extra}` }, el('dt', {}, label), el('dd', {}, num(value)));
  const types = tally.byType.map((row) => el('li', {}, dot(row.colour), el('span', { class: 'sd-type-name' }, row.name), row.code ? el('span', { class: 'sd-type-code' }, row.code) : null, el('strong', {}, num(row.appointments))));
  return card(
    'Appointments',
    el('dl', { class: 'sd-tiles' }, tile('On site', week.onSite), tile('Remote', week.remote), week.noPlace > 0 ? tile('No place', week.noPlace, ' is-warn') : null),
    types.length > 0 ? el('ul', { class: 'sd-types' }, ...types) : null,
  );
}

function daySide(s: Schedule): HTMLElement[] {
  let slots = 0;
  let appointments = 0;
  let care = 0;
  // The same order as the columns. Providers have slots. Support staff have a table of their own under it, with their hours.
  const people = dayOrder(s, app.day).flatMap((id) => personOf(s, id) ?? []);
  const staff = people.filter((person) => person.kind === 'support');
  let paid = 0;
  let beside = 0;
  const staffRows = staff.map((person) => {
    const row = tallyPerson(s, person.id)?.days.find((day) => day.day === app.day);
    paid += row?.paidMinutes ?? 0;
    beside += row?.withMinutes ?? 0;
    return el('tr', {}, el('th', { scope: 'row' }, person.name), el('td', {}, tight(hrs(row?.paidMinutes ?? 0))), el('td', {}, tight(hrs(row?.withMinutes ?? 0))));
  });
  const staffCard =
    staff.length === 0
      ? null
      : card(
          'Support staff',
          el(
            'table',
            { class: 'sd-table sd-table-even sd-table-hrs' },
            el('caption', { class: 'visually-hidden' }, `Paid hours and hours with a provider for each support person on ${dayName(app.day)}`),
            el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Person'), el('th', { scope: 'col' }, 'Paid'), el('th', { scope: 'col', title: 'Hours with a provider' }, 'With'))),
            el('tbody', {}, ...staffRows),
            el('tfoot', {}, el('tr', {}, el('th', { scope: 'row' }, 'Everyone'), el('td', {}, tight(hrs(paid))), el('td', {}, tight(hrs(beside))))),
          ),
          el('p', { class: 'sd-card-note' }, 'The With column is the time beside a provider.'),
        );
  const rows = people.filter((person) => person.kind !== 'support').map((person) => {
    const row = tallyPerson(s, person.id)?.days.find((day) => day.day === app.day);
    slots += row?.slots ?? 0;
    appointments += row?.appointments ?? 0;
    care += row?.careMinutes ?? 0;
    return el('tr', {}, el('th', { scope: 'row' }, person.name), el('td', {}, slotNum(row?.slots ?? 0)), el('td', {}, num(row?.appointments ?? 0)), el('td', {}, tight(hrs(row?.careMinutes ?? 0))));
  });
  return [
    card(
      dayName(app.day),
      el(
        'table',
        { class: 'sd-table sd-table-even' },
        el('caption', { class: 'visually-hidden' }, `Slots, appointments and patient care hours for each person on ${dayName(app.day)}`),
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Person'), el('th', { scope: 'col' }, 'Slots'), el('th', { scope: 'col' }, 'Visits'), el('th', { scope: 'col' }, 'Hours'))),
        el('tbody', {}, ...rows),
        el('tfoot', {}, el('tr', {}, el('th', { scope: 'row' }, 'Everyone'), el('td', {}, slotNum(slots)), el('td', {}, num(appointments)), el('td', {}, tight(hrs(care))))),
      ),
      el('p', { class: 'sd-card-note' }, 'Adding time in a column chooses that person. The kinds of time to add become theirs.'),
    ),
    ...(staffCard ? [staffCard] : []),
  ];
}

function roomsSide(s: Schedule): HTMLElement[] {
  const site = siteOf(s, app.siteId);
  if (!site) return [];
  const rows = roomHours(s, site.id).map((room) => {
    const whole = room.usedMinutes + room.freeMinutes;
    return el(
      'li',
      { class: 'sd-line-row' },
      el('div', { class: 'sd-line-say' }, el('span', { class: 'sd-line-name' }, room.name), el('span', { class: 'sd-line-num' }, el('strong', {}, hrs(room.usedMinutes)), ` of ${hrs(whole)}`)),
      meter(room.usedMinutes, whole, 'is-plain'),
      el('span', { class: 'sd-line-free' }, room.freeMinutes > 0 ? `${hrs(room.freeMinutes)} free` : 'In use all week'),
    );
  });
  return [card(`Rooms at ${site.name}`, el('p', { class: 'sd-card-note' }, 'Hours in use across the week, against the hours the schedule shows.'), rows.length > 0 ? el('ul', { class: 'sd-lines' }, ...rows) : el('p', { class: 'sd-card-note' }, 'This site has no rooms yet.'))];
}

/** Whether the cards behind "More about this week" are showing. It is a way of looking, so it is not part of the schedule. */
let more = false;

/** Hours and Appointments wait behind one line beside the week. Under the week, on a narrower screen, they are always open. */
function moreCards(...cards: HTMLElement[]): HTMLElement {
  const toggle = el('button', { type: 'button', class: 'sd-disc-btn', 'data-k': 'side:more', 'aria-expanded': more ? 'true' : 'false' }, el('span', {}, 'More about this week'), icon('down', 16));
  toggle.addEventListener('click', () => {
    more = !more;
    emit('look');
  });
  return el('div', { class: `sd-disc${more ? ' is-open' : ''}` }, toggle, el('div', { class: 'sd-disc-body' }, ...cards));
}

export function drawSide(root: HTMLElement): void {
  const s = app.schedule;
  if (!s) return;
  if (app.view === 'day') {
    fill(root, ...daySide(s));
    return;
  }
  if (app.view === 'rooms') {
    fill(root, ...roomsSide(s));
    return;
  }
  const tally = app.view === 'person' ? tallyPerson(s, app.personId) : undefined;
  if (!tally) {
    fill(root);
    return;
  }
  if (tally.kind === 'support') {
    fill(root, supportCard(s, tally), workCard(s, tally), supportDaysCard(s, tally), moreCards(mixCard(tally)));
    return;
  }
  fill(root, slotsCard(s, tally), workCard(s, tally), teamCard(s, tally), daysCard(s, tally), moreCards(hoursCard(tally), mixCard(tally)));
}
