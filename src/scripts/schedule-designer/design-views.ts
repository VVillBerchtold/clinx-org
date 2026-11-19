// Two views that are for reading and not for painting: Rooms (one day at one site, a column for
// each room) and the Overview (every person's mornings and afternoons at a glance).
import { capacityHours, clockRange, dayName, dayShort, overview, personOf, roomHours, roomUse, siteOf, tallyPerson } from './engine/index';
import type { Day, Half, OverviewRow, RoomUse, Schedule, Stay } from './engine/index';
import { byId, el, fill, hrs, icon, iconButton, keepFocus, plural, tight } from './dom';
import { app, emit, go, showPerson } from './state';
import { hourSpan, signed, slotNum, verdictSay } from './slots';
import { KIND_GROUP } from './people-say';
import { overviewMore, paidSay } from './team-say';
import { column, gutter, put, viewRange } from './week-draw';
import { keepHours } from './design-week';
import type { Geo } from './week-draw';

const GUTTER = 52;
let first = 0;
let drawnFor = '';

function open(personId: string, flash: { day?: Day; start?: number } = {}): void {
  const s = app.schedule;
  if (!s) return;
  showPerson(personId);
  app.view = 'person';
  app.flash = { personId, ...(flash.day !== undefined ? { day: flash.day } : {}), ...(flash.start !== undefined ? { start: flash.start } : {}) };
  emit('look');
}

/** Puts overlapping stays side by side: gives each a lane, and says how many lanes there are. */
function lanesOf(stays: readonly Stay[]): { lane: number[]; count: number } {
  const ends: number[] = [];
  const lane = stays.map((stay) => {
    let at = ends.findIndex((end) => end <= stay.from);
    if (at < 0) at = ends.length;
    ends[at] = stay.to;
    return at;
  });
  return { lane, count: Math.max(1, ends.length) };
}

function stayEl(s: Schedule, stay: Stay, geo: Geo, lane: number, lanes: number): HTMLElement {
  const person = personOf(s, stay.personId);
  const at = s.people.findIndex((item) => item.id === stay.personId);
  const name = person?.name ?? 'Someone';
  const say = `${name}, ${clockRange(stay.from, stay.to)}${stay.clash ? '. Somebody else is in this room for part of that time.' : ''}`;
  // A stay shorter than half an hour has room for one line, so it shows the name. The times are in its hover and its spoken name.
  const brief = stay.to - stay.from < 30;
  const node = el(
    'button',
    { type: 'button', class: `sd-stay sd-sw-${(Math.max(0, at) % 12) + 1}${stay.clash ? ' is-clash' : ''}${brief ? ' is-brief' : ''}`, 'data-k': `stay:${stay.personId}:${stay.from}`, title: say, 'aria-label': `${say} Open their week.` },
    el('span', { class: 'sd-b-name' }, name),
    brief ? null : el('span', { class: 'sd-b-time' }, clockRange(stay.from, stay.to)),
    stay.clash ? el('span', { class: 'sd-b-clash', 'aria-hidden': 'true' }, '!') : null,
  );
  put(node, stay.from, stay.to, geo);
  if (lanes > 1) {
    node.style.left = `calc(${(lane / lanes) * 100}% + 2px)`;
    node.style.width = `calc(${100 / lanes}% - 4px)`;
  }
  node.addEventListener('click', () => open(stay.personId, { day: app.day, start: stay.from }));
  return node;
}

/** The day and site the Rooms frame was last drawn for, so drawing them again keeps the place the times were scrolled to. */
let roomsFor = '';

/**
 * Gives the Rooms frame its height: what is left of the window above the bar along the bottom. The
 * times scroll inside it, as the week's do, so the day never runs under the bar. On a phone the
 * room is counted from the line above the rooms, which the page can scroll to.
 */
function fitRooms(): void {
  const root = byId('sd-view');
  const scroller = root.querySelector<HTMLElement>('.sd-cv-scroll');
  const frame = scroller?.parentElement;
  if (!scroller || !frame || root.hidden) return;
  const px = (value: string): number => parseFloat(value) || 0;
  const phone = window.matchMedia('(max-width: 44rem)').matches;
  const design = byId('sd-design');
  const foot = app.full ? 0 : byId('sd-foot').offsetHeight;
  const lead = phone || app.full ? 0 : Math.max(0, px(getComputedStyle(document.documentElement).scrollPaddingTop) + px(getComputedStyle(design).scrollMarginTop));
  const above = scroller.getBoundingClientRect().top - (phone ? root : design).getBoundingClientRect().top;
  const room = window.innerHeight - foot - lead - above - byId('sd-under').offsetHeight - 18;
  frame.style.setProperty('--sd-week-h', `${Math.max(200, Math.round(room))}px`);
  // A scroll bar that takes room narrows the columns, so the headings give up the same room.
  const head = frame.querySelector<HTMLElement>('.sd-cv-head');
  const bar = scroller.offsetWidth - scroller.clientWidth;
  if (head) head.style.paddingRight = bar > 0 ? `${bar}px` : '';
}

export function drawRooms(root: HTMLElement): void {
  const s = app.schedule;
  if (!s) return;
  const site = siteOf(s, app.siteId);
  const rooms: RoomUse[] = site ? roomUse(s, app.day, site.id) : [];
  if (!site || rooms.length === 0) {
    drawnFor = '';
    fill(root, el('div', { class: 'sd-empty' }, el('span', { class: 'cc-badge' }, icon('room', 22)), el('p', {}, site ? `${site.name} has no rooms yet. Add rooms in Set up.` : 'Add a site in Set up to see its rooms.')));
    return;
  }
  const perPage = Math.max(1, Math.min(rooms.length, Math.floor((root.clientWidth - GUTTER) / 112) || rooms.length));
  const flashAt = app.flash?.roomId ? rooms.findIndex((room) => room.roomId === app.flash?.roomId) : -1;
  if (flashAt >= 0 && (flashAt < first || flashAt >= first + perPage)) first = flashAt;
  first = Math.max(0, Math.min(first, rooms.length - perPage));
  drawnFor = `${perPage}`;
  const shown = rooms.slice(first, first + perPage);
  const range = viewRange(s);
  const geo: Geo = { from: range.from, to: range.to, ppm: 1.2 };
  const template = `${GUTTER}px repeat(${shown.length}, minmax(0, 1fr))`;
  const hours = new Map(roomHours(s, site.id).map((room) => [room.roomId, room.days.find((day) => day.day === app.day)?.usedMinutes ?? 0]));

  let pager: HTMLElement | null = null;
  if (perPage < rooms.length) {
    const last = first + perPage;
    const prev = iconButton('prev', 'Earlier rooms', { disabled: first === 0 });
    const next = iconButton('next', 'More rooms', { disabled: last >= rooms.length });
    prev.addEventListener('click', () => {
      first = Math.max(0, first - perPage);
      keepFocus(root, () => drawRooms(root));
    });
    next.addEventListener('click', () => {
      first = Math.min(rooms.length - perPage, first + perPage);
      keepFocus(root, () => drawRooms(root));
    });
    pager = el('div', { class: 'sd-pager' }, prev, el('span', {}, `Rooms ${first + 1} to ${last} of ${rooms.length}`), next);
  }

  const head = el(
    'div',
    { class: 'sd-cv-head' },
    el('span', { class: 'sd-cv-corner', 'aria-hidden': 'true' }),
    ...shown.map((room) =>
      el(
        'div',
        { class: `sd-ch${room.clashes.length > 0 ? ' is-clash' : ''}${app.flash?.roomId === room.roomId ? ' is-flash' : ''}` },
        el('div', { class: 'sd-ch-say' }, el('span', { class: 'sd-ch-name', title: room.name }, room.name), el('span', { class: 'sd-ch-sub' }, room.clashes.length > 0 ? plural(room.clashes.length, 'clash', 'clashes') : (hours.get(room.roomId) ?? 0) > 0 ? `${hrs(hours.get(room.roomId) ?? 0)} in use` : 'Free all day')),
      ),
    ),
  );
  head.style.gridTemplateColumns = template;
  const body = el('div', { class: 'sd-cv-body' }, gutter(geo));
  body.style.gridTemplateColumns = template;
  for (const room of shown) {
    const node = column(s, geo, 20, {});
    node.classList.add('is-read');
    const placed = lanesOf(room.stays);
    room.stays.forEach((stay, i) => node.append(stayEl(s, stay, geo, placed.lane[i] ?? 0, stay.clash ? placed.count : 1)));
    body.append(node);
  }
  // The times scroll inside a frame that ends above the bar along the bottom. It opens an hour above the first stay in the rooms shown, or at
  // the clash a finding asked to see, and keeps its place when the same day is drawn again.
  const key = `${site.id}:${app.day}`;
  const was = roomsFor === key ? root.querySelector<HTMLElement>('.sd-cv-scroll')?.scrollTop : undefined;
  const flashed = flashAt >= 0 ? rooms[flashAt]?.stays.find((stay) => stay.clash)?.from : undefined;
  const firstStay = Math.min(...shown.flatMap((room) => room.stays.map((stay) => stay.from)));
  const openAt = flashed ?? (Number.isFinite(firstStay) ? firstStay : 540);
  roomsFor = key;
  app.flash = null;
  const scroller = el('div', { class: 'sd-cv-scroll' }, body);
  fill(root, el('p', { class: 'sd-view-say' }, `${site.name} on ${dayName(app.day)}. Each column is a room. Choose a name to open that person's week.`), pager, el('div', { class: 'sd-canvas-host is-read' }, head, scroller));
  fitRooms();
  scroller.scrollTop = flashed === undefined && was !== undefined ? was : Math.max(0, (Math.max(geo.from, openAt - 60) - geo.from) * geo.ppm);
  // An hour's label at an edge of the frame stays whole, as in the week.
  keepHours(scroller);
  scroller.addEventListener('scroll', () => keepHours(scroller), { passive: true });
}

/** What the Design step shows when nobody is in the schedule: what to do, and a button that goes there. */
export function nobodyCard(): HTMLElement {
  const add = el('button', { type: 'button', class: 'btn accent sd-btn-sm', 'data-k': 'nobody-add' }, 'Add a person', icon('right', 16));
  add.addEventListener('click', () => {
    app.setupTab = 'people';
    go(2);
  });
  return el('div', { class: 'sd-empty' }, el('span', { class: 'cc-badge' }, icon('person', 22)), el('p', {}, el('strong', {}, 'Nobody is in this schedule yet.'), ' Add a person in Set up, then come back here to build their week.'), add);
}

/** A morning or an afternoon as a chip. Patient care names the place, and other time names itself. */
function halfEl(half: Half, when: string): HTMLElement {
  if (half.kind === 'empty') return el('span', { class: 'sd-half is-empty', 'aria-label': `${when}: ${half.say || 'nothing'}` }, el('span', { class: 'sd-half-when', 'aria-hidden': 'true' }, when));
  return el(
    'span',
    { class: `sd-half is-${half.kind}${half.colour ? ` sd-sw-${half.colour}` : ''}`, title: half.say, 'aria-label': `${when}: ${half.say}` },
    el('span', { class: 'sd-half-when', 'aria-hidden': 'true' }, when),
    el('span', { class: 'sd-half-label', 'aria-hidden': 'true' }, half.kind === 'care' ? half.place || half.label : half.label),
  );
}

/** A figure in the roster. On a narrow screen the row becomes a card and the label shows above the figure. */
const figure = (label: string, value: string, extra = ''): HTMLElement => el('td', { class: `sd-ov-num${extra ? ` ${extra}` : ''}`, 'data-label': label }, value);

export function drawOverview(root: HTMLElement): void {
  const s = app.schedule;
  if (!s) return;
  drawnFor = '';
  const rows = overview(s);
  if (rows.length === 0) {
    fill(root, nobodyCard());
    return;
  }
  const rowEl = (row: OverviewRow): HTMLElement => {
    const tally = tallyPerson(s, row.personId);
    const slots = tally?.slots ?? { target: 0, actual: 0, variance: 0, verdict: 'needs-contract' as const };
    const support = row.kind === 'support';
    // A support person's chip is about paid hours against the contract. The heading above the rows already says their kind.
    const say = support && tally ? paidSay(tally.contractMinutes, tally.paidShortMinutes, tally.paidOverMinutes) : verdictSay(slots, s.tolerance);
    // Under the name: the role, then the working hours in the week and who the person works with.
    const more = overviewMore(row);
    const role = [row.role, row.departmentName].filter(Boolean).join(', ');
    const name = el('button', { type: 'button', class: 'sd-ov-name', 'data-k': `ov:${row.personId}` }, el('strong', {}, row.name), el('span', { class: 'sd-ov-role', title: role }, role), more ? el('span', { class: 'sd-ov-more', title: more }, more) : null);
    name.addEventListener('click', () => open(row.personId));
    return el(
      'tr',
      support ? { class: 'is-support' } : {},
      el('th', { scope: 'row' }, name),
      ...row.days.map((day) => el('td', { class: 'sd-ov-day', 'data-day': dayShort(day.day) }, el('div', { class: 'sd-halves' }, halfEl(day.morning, 'am'), halfEl(day.afternoon, 'pm')))),
      figure('Contract', tight(hrs(tally?.contractMinutes ?? 0))),
      // Support staff have no capacity in slots and no target, so their row gives the paid hours on the week in that place.
      ...(support
        ? [el('td', { class: 'sd-ov-paid', colspan: '4' }, el('strong', {}, tight(hrs(tally?.week.paidMinutes ?? 0))), ' paid on the week')]
        : [figure('Capacity', tight(hourSpan(capacityHours(s, row.personId))), 'is-span'), figure('Target', slotNum(slots.target)), figure('Scheduled', slotNum(slots.actual), 'is-strong is-wide'), figure('Diff.', signed(slots.variance), 'is-diff')]),
      el('td', { class: 'sd-ov-verdict' }, el('span', { class: `sd-state is-${say.state}`, title: say.note }, say.chip)),
    );
  };
  // Providers first, then support staff, each under a heading when the schedule has both.
  const providers = rows.filter((row) => row.kind !== 'support');
  const staff = rows.filter((row) => row.kind === 'support');
  const span = String(s.days.length + 7);
  const heading = (say: string): HTMLElement => el('tr', { class: 'sd-ov-group' }, el('th', { scope: 'colgroup', colspan: span }, say));
  const body = staff.length === 0 ? rows.map(rowEl) : [...(providers.length > 0 ? [heading(KIND_GROUP.provider)] : []), ...providers.map(rowEl), heading(KIND_GROUP.support), ...staff.map(rowEl)];
  fill(
    root,
    el('p', { class: 'sd-view-say' }, 'Each day shows the morning first, then the afternoon. A solid chip is patient care and names the place. Choose a name to open that person’s week.'),
    el(
      'table',
      { class: 'sd-ov' },
      el('caption', { class: 'visually-hidden' }, 'Each person by day, with what fills the morning and the afternoon, then contract hours, capacity hours, target slots, scheduled slots, the difference and the status against the target'),
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { scope: 'col' }, 'Person'),
          ...s.days.map((day) => el('th', { scope: 'col', class: 'sd-ov-day' }, el('span', { class: 'sd-ch-long' }, dayName(day)), el('span', { class: 'sd-ch-short', 'aria-hidden': 'true' }, dayShort(day)))),
          el('th', { scope: 'col', class: 'sd-ov-num', title: 'Contract hours a week' }, 'Contract'),
          el('th', { scope: 'col', class: 'sd-ov-num is-span', title: 'Hours of patient care a week: contract hours times the clinical factor, less the hours set aside' }, 'Capacity'),
          el('th', { scope: 'col', class: 'sd-ov-num', title: 'Target slots a week' }, 'Target'),
          el('th', { scope: 'col', class: 'sd-ov-num is-wide', title: 'Slots on the designed week' }, 'Scheduled'),
          el('th', { scope: 'col', class: 'sd-ov-num', title: 'Scheduled slots less the target' }, 'Diff.'),
          el('th', { scope: 'col', class: 'sd-ov-verdict', title: 'How the scheduled slots stand against the target' }, 'Status'),
        ),
      ),
      el('tbody', {}, ...body),
    ),
    el('p', { class: 'sd-ov-key' }, `Contract and capacity are hours a week. Capacity is contract hours times the clinical factor, less the hours set aside. Target, scheduled and difference are slots.${rows.some((row) => row.workMinutes !== null || row.worksWith.length > 0) ? ' The line under a name gives the hours at work in the week and who the person works with.' : ''}`),
  );
}

/** Draws the Rooms view again when the width now fits a different number of rooms, and fits its frame again when the window's height changes. */
export function initViews(): void {
  window.addEventListener('resize', () => {
    if (app.step === 3 && app.view === 'rooms') fitRooms();
  });
  if (typeof ResizeObserver !== 'function') return;
  const root = byId('sd-view');
  new ResizeObserver(() => {
    if (app.step !== 3 || app.view !== 'rooms' || drawnFor === '') return;
    const s = app.schedule;
    const count = s ? (siteOf(s, app.siteId)?.rooms.length ?? 0) : 0;
    const fits = Math.max(1, Math.min(count, Math.floor((root.clientWidth - GUTTER) / 112) || count));
    if (`${fits}` !== drawnFor) drawRooms(root);
  }).observe(root);
}
