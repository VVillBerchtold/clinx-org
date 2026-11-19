// Step 2, Set up: the clinic, its places, the kinds of time and the people. Four short tabs.
// Typed values are saved when the person leaves a box. Everything here can be undone.
import { ALL_DAYS, LIMITS, addRoom, addSite, dayName, dayShort, removeRoom, removeSite, renameRoom, renameSite, setDays, setDetails, setTolerance } from './engine/index';
import type { Schedule } from './engine/index';
import { announce, byId, el, fill, icon, iconButton, keepFocus, plural, segmented } from './dom';
import { app, canRedo, canUndo, commit, emit, redo, undo } from './state';
import type { SetupTab, Why } from './state';
import { addButton, change, clearLive, closeSwatches, cur, field, focusNext, hoursPickers, isQuiet, numberBox, removeButton, takeShown, takeWanted, textBox } from './setup-parts';
import { drawKinds } from './setup-kinds';
import { drawPeople } from './setup-people';

const TABS: readonly { value: SetupTab; say: string }[] = [
  { value: 'clinic', say: 'Clinic' },
  { value: 'places', say: 'Places' },
  { value: 'kinds', say: 'Kinds of time' },
  { value: 'people', say: 'People' },
];

function clinicTab(s: Schedule): HTMLElement {
  const days = el('div', { class: 'sd-days', role: 'group', 'aria-label': 'Days in the week' });
  for (const day of ALL_DAYS) {
    const on = s.days.includes(day);
    const button = el('button', { type: 'button', class: 'sd-day-btn', 'data-k': `day:${day}`, 'aria-pressed': on ? 'true' : 'false', 'aria-label': dayName(day) }, dayShort(day));
    button.addEventListener('click', () => {
      const next = on ? s.days.filter((item) => item !== day) : [...s.days, day];
      change(setDays(cur(), next), on ? `${dayName(day)} is out of the week.` : `${dayName(day)} is in the week.`, (blocks) => `${blocks} on that day went with it.`);
    });
    days.append(button);
  }

  const { from, to } = hoursPickers(s);

  return el(
    'div',
    { class: 'sd-form' },
    el(
      'div',
      { class: 'sd-panel sd-form-two' },
      field('Schedule name', textBox({ label: 'Schedule name', key: 'name', value: s.name, set: (now, value) => setDetails(now, { name: value }), read: (now) => now.name }), 'The saved file takes this name.'),
      field('Clinic', textBox({ label: 'Clinic', key: 'clinic', value: s.clinic, set: (now, value) => setDetails(now, { clinic: value }), read: (now) => now.clinic, placeholder: 'The clinic’s name' }), 'Printed on each person’s page.'),
    ),
    el(
      'div',
      { class: 'sd-panel sd-form-two' },
      el('div', { class: 'sd-field' }, el('span', { class: 'sd-field-label' }, 'Days in the week'), days, el('span', { class: 'sd-field-hint' }, 'Taking a day out removes the time scheduled on it. Undo brings it back.')),
      el('div', { class: 'sd-field' }, el('span', { class: 'sd-field-label' }, 'Hours shown'), el('div', { class: 'sd-hours' }, from, el('span', {}, 'to'), to), el('span', { class: 'sd-field-hint' }, 'Each person’s grid counts from the first hour shown.')),
    ),
    el(
      'div',
      { class: 'sd-panel' },
      el(
        'label',
        { class: 'sd-field' },
        el('span', { class: 'sd-field-label' }, 'On target'),
        el(
          'span',
          { class: 'sd-kind-len' },
          numberBox({ label: 'Within this many slots of target counts as on target', key: 'tolerance', value: s.tolerance, least: 0, most: LIMITS.tolerance, step: 1, set: (now, value) => setTolerance(now, value), read: (now) => now.tolerance }),
          el('span', { 'aria-hidden': 'true' }, 'slots'),
        ),
        el('span', { class: 'sd-field-hint' }, 'Within this many slots of target counts as on target. With 0, a week has to match its target exactly.'),
      ),
    ),
  );
}

function placesTab(s: Schedule): HTMLElement {
  const sites = s.sites.map((site) => {
    const rooms = site.rooms.map((room) =>
      el(
        'li',
        { class: 'sd-chip-edit' },
        textBox({ label: `Room name, ${room.name}`, key: `room:${room.id}`, value: room.name, set: (now, value) => renameRoom(now, room.id, value), read: (now) => now.sites.flatMap((item) => item.rooms).find((item) => item.id === room.id)?.name ?? '' }),
        removeButton(`Remove ${room.name}`, `room-x:${room.id}`, () => {
          focusNext(`room-add:${site.id}`);
          change(removeRoom(cur(), room.id), `Removed ${room.name}.`, (blocks) => `${blocks} that were in it now have no room.`);
        }),
      ),
    );
    return el(
      'section',
      { class: 'sd-panel sd-site' },
      el(
        'div',
        { class: 'sd-panel-head' },
        el('span', { class: 'cc-badge' }, icon('home', 20)),
        textBox({ label: 'Site name', key: `site:${site.id}`, value: site.name, extra: 'is-title', set: (now, value) => renameSite(now, site.id, value), read: (now) => now.sites.find((item) => item.id === site.id)?.name ?? '' }),
        removeButton(`Remove ${site.name}`, `site-x:${site.id}`, () => {
          focusNext('site-add');
          change(removeSite(cur(), site.id), `Removed ${site.name}.`, (blocks) => `${blocks} that were there now have no place.`);
        }),
      ),
      el('p', { class: 'sd-panel-say' }, site.rooms.length === 0 ? 'No rooms yet.' : plural(site.rooms.length, 'room')),
      el(
        'ul',
        { class: 'sd-chip-list' },
        ...rooms,
        el(
          'li',
          {},
          addButton('Add a room', `room-add:${site.id}`, () => {
            const next = addRoom(cur(), site.id, `Room ${site.rooms.length + 1}`);
            const added = next.sites.find((item) => item.id === site.id)?.rooms.at(-1);
            if (added) focusNext(`room:${added.id}`);
            commit(next);
          }, site.rooms.length >= LIMITS.roomsPerSite),
        ),
      ),
    );
  });
  return el(
    'div',
    { class: 'sd-form' },
    ...sites,
    s.sites.length === 0 ? el('p', { class: 'sd-panel sd-panel-none' }, 'There are no sites yet. A site is a building or a floor, and it holds rooms.') : null,
    addButton('Add a site', 'site-add', () => {
      const next = addSite(cur(), `Site ${s.sites.length + 1}`);
      const added = next.sites.at(-1);
      if (added && next !== s) focusNext(`site:${added.id}`);
      commit(next);
    }, s.sites.length >= LIMITS.sites),
  );
}

/** Draws the Set up step. A typed value saved a moment ago leaves the form as it is. */
export function drawSetup(why: Why): void {
  const s = app.schedule;
  if (!s || isQuiet()) return;
  void why;
  clearLive();
  const root = byId('sd-setup');
  const tabs = segmented('Part of the set-up', TABS, app.setupTab, (value) => {
    app.setupTab = value;
    closeSwatches();
    emit('look');
  }, 'sd-tabs');
  const undoButton = iconButton('undo', 'Undo', { disabled: !canUndo() });
  const redoButton = iconButton('redo', 'Do again', { disabled: !canRedo() });
  undoButton.addEventListener('click', () => {
    if (undo()) announce(app.status);
  });
  redoButton.addEventListener('click', () => {
    if (redo()) announce(app.status);
  });
  const body = app.setupTab === 'clinic' ? clinicTab(s) : app.setupTab === 'places' ? placesTab(s) : app.setupTab === 'kinds' ? drawKinds(s) : drawPeople(s);
  keepFocus(root, () => fill(root, el('div', { class: 'sd-setup-bar' }, tabs, el('div', { class: 'sd-bar-tools' }, undoButton, redoButton)), body));
  const want = takeWanted();
  if (want !== null) {
    const control = root.querySelector<HTMLElement>(`[data-k="${CSS.escape(want)}"]`);
    control?.focus();
    if (control instanceof HTMLInputElement && control.type === 'text') control.select();
    // A question that has just opened is brought wholly into view, clear of the bar along the bottom.
    control?.closest('.sd-ask')?.scrollIntoView({ block: 'nearest' });
  }
  const part = takeShown();
  const shown = part === null ? null : root.querySelector<HTMLElement>(`.${part}`);
  if (shown) {
    // The part a finding points at takes the keyboard, comes to the middle of the window and is marked for a moment.
    shown.tabIndex = -1;
    shown.classList.add('is-shown');
    shown.focus({ preventScroll: true });
    shown.scrollIntoView({ block: 'center' });
  }
}

export function initSetup(): void {
  const root = byId('sd-setup');
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const open = root.querySelector<HTMLElement>('.sd-swatch-btn[aria-expanded="true"]');
    if (closeSwatches()) open?.focus();
  });
  document.addEventListener('pointerdown', (event) => {
    if (app.step === 2 && !(event.target as Element).closest('.sd-swatch')) closeSwatches();
  });
}
