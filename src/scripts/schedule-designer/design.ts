// Step 3, Design: the bar across the top, the four views, the short guide, the note about a taken
// room, and the keys that work anywhere on the step. The week itself is drawn in design-week.ts.
import { allClashes, clock, clockRange, dayName, hasWork, isDayOff, personOf, roomOf, setPlace, setStep, siteOf, tallyPerson } from './engine/index';
import type { Day, Schedule, Step } from './engine/index';
import { announce, byId, calm, el, fill, hrs, icon, iconButton, keepFocus, pointing, segmented } from './dom';
import { closeDropdown, inDropdown, picker, whenDropdownOpens } from './dropdown';
import { app, canRedo, canUndo, commit, emit, redo, showPerson, undo } from './state';
import type { View, Why } from './state';
import { answerOffered, drawPicked, drawWeek, escapeWeek, flipWhy, initWeek, markCues, offerUndo, resetWeek, seatView, showAnswer, showFirstRows, sitWeek, undoOffered } from './design-week';
import type { Column } from './design-week';
import { chooseKind, drawPalette, switchMode } from './design-palette';
import { hoursPickers } from './setup-parts';
import { peopleInOrder, personChoices } from './people-say';
import { drawSide } from './design-tally';
import { slotWords } from './slots';
import { dayOrder, howMore, withChoices } from './team-say';
import { drawOverview, drawRooms, initViews, nobodyCard } from './design-views';

const VIEWS: readonly { value: View; say: string; icon: string }[] = [
  { value: 'person', say: 'Person', icon: 'person' },
  { value: 'day', say: 'Day', icon: 'day' },
  { value: 'rooms', say: 'Rooms', icon: 'room' },
  { value: 'overview', say: 'Overview', icon: 'grid' },
];

/** Keys that change what a click does. They work while the week, or the switch above it, has the keyboard. */
const KEYS_MODE: readonly [string, string][] = [
  ['L', 'Look'],
  ['A', 'Add'],
  ['E', 'Erase'],
  ['1 to 9', 'In Add, choose that kind of time'],
];

/** Keys that work anywhere on the step, whatever has the keyboard, except while typing in a box. */
const KEYS_STEP: readonly [string, string][] = [
  ['Esc', 'Back to Look'],
  ['Ctrl or Cmd and Z', 'Undo'],
  ['Shift, Ctrl or Cmd and Z', 'Do again'],
  ['Ctrl or Cmd and S', 'Save the workbook'],
];

/** Keys for the week itself. They follow the switch above the week, so the list is for the mode that is on. */
const KEYS_WEEK: Record<'look' | 'add' | 'erase', readonly [string, string][]> = {
  look: [
    ['Arrow keys', 'Move around the week'],
    ['Enter or Space', 'Show the block you are on'],
  ],
  add: [
    ['Arrow keys', 'Move around the week'],
    ['Enter or Space', 'Add where you are'],
    ['Shift and Down', 'Add and move on'],
    ['Backspace', 'Clear where you are'],
  ],
  erase: [
    ['Arrow keys', 'Move around the week'],
    ['Enter or Space', 'Clear where you are'],
    ['Shift and Down', 'Clear and move on'],
  ],
};

const MODE_NAME = { look: 'Look', add: 'Add', erase: 'Erase' } as const;

let keysOpen = false;
let hoursOpen = false;
/** The short guide shows on the first arrival in Design after the page loads. Nothing is stored, so it shows again next time. */
/**
 * The guide above the strip. It starts as one line, so the first view keeps its week. The whole of
 * it opens from that line or from the button in the bar, and "Got it" puts it away for the tab.
 */
let how: 'line' | 'open' | 'off' = 'line';

function setView(view: View): void {
  if (app.view === view) return;
  app.view = view;
  app.notice = null;
  moved();
  // On a phone the new view starts at the upper edge of the screen, as the step does on arriving.
  seatView();
}

/** After a change of view, person or day: the week starts afresh and the line under it is not about the old one. */
function moved(): void {
  app.status = '';
  resetWeek();
  emit('look');
}

/** "6 am to 9 pm": the hours the week shows, for the button in the bar. */
function hoursSay(s: Schedule): string {
  const hour = (minute: number): string => (minute === 1440 ? 'midnight' : clock(minute).replace(':00', ''));
  return `${hour(s.dayStart)} to ${hour(s.dayEnd)}`;
}

/** How many blocks lie outside the hours chosen, in a sentence. Empty when none do. */
function outsideSay(s: Schedule): string {
  const out = s.blocks.filter((block) => block.start < s.dayStart || block.start + block.minutes > s.dayEnd);
  if (out.length === 0) return '';
  const people = new Set(out.map((block) => block.personId)).size;
  const whose = people === 1 ? `on the week of ${personOf(s, out[0]?.personId ?? '')?.name ?? 'one person'}` : `across ${people} people`;
  return `${out.length === 1 ? '1 block sits' : `${out.length} blocks sit`} outside these hours, ${whose}. The week keeps showing ${out.length === 1 ? 'it' : 'them'}, in the shaded rows.`;
}

function stepBy<T>(list: readonly T[], current: T, by: number): T | undefined {
  const at = list.indexOf(current);
  return list[(at + by + list.length) % list.length];
}

function subject(s: Schedule): HTMLElement | null {
  const days = s.days.map((day) => ({ value: String(day), say: dayName(day) }));
  const dayPicker = (): HTMLElement =>
    picker('Day', days, String(app.day), (value) => {
      app.day = Number(value) as Day;
      moved();
    });
  if (app.view === 'person') {
    if (s.people.length === 0) return null;
    const ids = peopleInOrder(s).map((person) => person.id);
    const move = (by: number) => (): void => {
      const next = stepBy(ids, app.personId, by);
      if (next === undefined) return;
      showPerson(next);
      moved();
    };
    const prev = iconButton('prev', 'The person before', { disabled: ids.length < 2 });
    const next = iconButton('next', 'The next person', { disabled: ids.length < 2 });
    prev.addEventListener('click', move(-1));
    next.addEventListener('click', move(1));
    const choose = picker(
      'Person',
      personChoices(s),
      app.personId,
      (value) => {
        showPerson(value);
        moved();
      },
      'sd-select-wide',
    );
    return el('div', { class: 'sd-subject' }, prev, choose, next);
  }
  if (app.view === 'day') {
    const move = (by: number) => (): void => {
      const next = stepBy(s.days, app.day, by);
      if (next === undefined) return;
      app.day = next;
      moved();
    };
    const prev = iconButton('prev', 'The day before');
    const next = iconButton('next', 'The next day');
    prev.addEventListener('click', move(-1));
    next.addEventListener('click', move(1));
    return el('div', { class: 'sd-subject' }, prev, dayPicker(), next);
  }
  if (app.view === 'rooms') {
    const site = picker(
      'Site',
      s.sites.map((item) => ({ value: item.id, say: item.name })),
      app.siteId,
      (value) => {
        app.siteId = value;
        emit('look');
      },
      'sd-select-wide',
    );
    return el('div', { class: 'sd-subject' }, dayPicker(), s.sites.length > 1 ? site : null);
  }
  return null;
}

function drawBar(s: Schedule): void {
  const bar = byId('sd-bar');
  const views = el('div', { class: 'sd-seg sd-views', role: 'group', 'aria-label': 'View' });
  for (const view of VIEWS) {
    const button = el('button', { type: 'button', class: 'sd-seg-btn', 'data-k': `view:${view.value}`, 'aria-pressed': app.view === view.value ? 'true' : 'false' }, icon(view.icon, 16), el('span', {}, view.say));
    button.addEventListener('click', () => setView(view.value));
    views.append(button);
  }

  const person = personOf(s, app.personId);
  const grid =
    app.view === 'person' && person
      ? el(
          'div',
          { class: 'sd-gridpick' },
          el('span', { class: 'sd-bar-label', id: 'sd-grid-label' }, 'Grid'),
          segmented<Step>(
            `Grid for ${person.name}`,
            [
              { value: 15, say: '15 min' },
              { value: 20, say: '20 min' },
            ],
            person.step,
            (step) => {
              app.status = `The grid for ${person.name} is now ${step} min. The blocks kept their times. Undo puts the grid back.`;
              offerUndo();
              announce(app.status);
              resetWeek();
              commit(setStep(s, person.id, step));
            },
          ),
        )
      : null;

  // How visits are drawn. It changes the picture and nothing else, so it is not part of the schedule or its file.
  const looks =
    s.people.length > 0 && (app.view === 'person' || app.view === 'day')
      ? el(
          'div',
          { class: 'sd-gridpick sd-lookpick' },
          el('span', { class: 'sd-bar-label' }, 'Visits'),
          segmented<'each' | 'grouped'>(
            'Visits',
            [
              { value: 'each', say: 'Each one' },
              { value: 'grouped', say: 'Grouped' },
            ],
            app.visits,
            (look) => {
              app.visits = look;
              announce(look === 'grouped' ? 'Visits that touch are drawn as one band. The schedule is the same.' : 'Each visit is drawn by itself.');
              emit('look');
            },
            'sd-looks',
          ),
        )
      : null;

  const undoButton = iconButton('undo', 'Undo', { disabled: !canUndo() });
  const redoButton = iconButton('redo', 'Do again', { disabled: !canRedo() });
  // The words go to the live region as well as the line under the week, so a screen reader hears them.
  undoButton.addEventListener('click', () => {
    if (undo()) announce(app.status);
  });
  redoButton.addEventListener('click', () => {
    if (redo()) announce(app.status);
  });
  const keysButton = iconButton('keys', 'Keyboard', { 'aria-expanded': keysOpen ? 'true' : 'false', class: 'sd-icon-btn sd-keys-btn' });
  keysButton.addEventListener('click', () => {
    keysOpen = !keysOpen;
    hoursOpen = false;
    closeDropdown();
    drawBar(s);
    byId('sd-bar').querySelector<HTMLElement>('.sd-keys-btn')?.focus();
  });

  // The hours the week shows. The same two pickers as Set up, where the range is easy to miss.
  const hoursButton = el('button', { type: 'button', class: 'sd-dd-btn sd-hrs-btn', 'data-k': 'hours', 'aria-haspopup': 'true', 'aria-expanded': hoursOpen ? 'true' : 'false', 'aria-label': `Hours shown: ${hoursSay(s)}`, title: 'Change the hours the week shows' }, icon('clock', 16), el('span', { class: 'sd-dd-say' }, hoursSay(s)), icon('down', 14));
  hoursButton.addEventListener('click', () => {
    hoursOpen = !hoursOpen;
    keysOpen = false;
    closeDropdown();
    drawBar(s);
    byId('sd-bar').querySelector<HTMLElement>(hoursOpen ? '.sd-hrs-pop .sd-dd-btn' : '.sd-hrs-btn')?.focus();
  });
  let hoursPop: HTMLElement | null = null;
  if (hoursOpen) {
    const { from, to } = hoursPickers(s);
    hoursPop = el(
      'div',
      { class: 'sd-hrs-pop', role: 'dialog', 'aria-label': 'Hours shown' },
      el('p', { class: 'sd-menu-h' }, 'Hours shown'),
      el('div', { class: 'sd-hours' }, from, el('span', {}, 'to'), to),
      el('p', { class: 'sd-menu-note' }, 'Every person’s week shows these hours, and they are saved with the schedule.'),
      outsideSay(s) ? el('p', { class: 'sd-menu-note sd-hrs-out' }, icon('alert', 16), el('span', {}, outsideSay(s))) : null,
    );
  }
  const hours = s.people.length > 0 && app.view !== 'overview' ? el('div', { class: 'sd-gridpick sd-hrs' }, el('span', { class: 'sd-bar-label' }, 'Hours'), hoursButton, hoursPop) : null;

  const painting = s.people.length > 0 && (app.view === 'person' || app.view === 'day');
  const howButton = painting ? el('button', { type: 'button', class: 'sd-full-btn sd-how-btn', 'data-k': 'how', 'aria-expanded': how === 'open' ? 'true' : 'false', title: 'How this works' }, icon('info', 16), el('span', {}, 'How this works')) : null;
  howButton?.addEventListener('click', () => {
    how = how === 'open' ? 'off' : 'open';
    emit('look');
    if (how === 'open') byId('sd-how').querySelector<HTMLElement>('button')?.focus();
    sitWeek();
  });
  const fullButton = el('button', { type: 'button', class: 'sd-full-btn', 'data-k': 'full', 'aria-pressed': app.full ? 'true' : 'false', title: app.full ? 'Leave full window' : 'Full window' }, icon(app.full ? 'shrink' : 'expand', 16), el('span', {}, app.full ? 'Leave full window' : 'Full window'));
  fullButton.addEventListener('click', () => setFull(!app.full));

  const list = (rows: readonly [string, string][]): HTMLElement => el('dl', {}, ...rows.flatMap(([key, does]) => [el('dt', {}, key), el('dd', {}, does)]));
  const keys = keysOpen
    ? el(
        'div',
        { class: 'sd-keys', role: 'dialog', 'aria-label': 'Keyboard' },
        el('p', { class: 'sd-menu-h' }, 'Anywhere in Design'),
        list(KEYS_STEP),
        el('p', { class: 'sd-menu-h' }, 'With the keyboard on the week, or on Look, Add or Erase'),
        list(KEYS_MODE),
        el('p', { class: 'sd-menu-h' }, `With the keyboard on the week, in ${MODE_NAME[app.mode]}`),
        list(KEYS_WEEK[app.mode]),
      )
    : null;

  fill(bar, views, subject(s), grid, looks, hours, el('div', { class: 'sd-bar-tools' }, undoButton, redoButton, keysButton, howButton, fullButton), keys);
}

/** The short guide above the strip: one line at first, then one line each for Look, Add, Erase and Undo, and a button to put it away. */
function drawHow(s: Schedule): void {
  const box = byId('sd-how');
  const on = how !== 'off' && s.people.length > 0 && (app.view === 'person' || app.view === 'day');
  box.hidden = !on;
  if (!on) {
    fill(box);
    return;
  }
  const finger = pointing() === 'touch';
  const more = howMore(s.people.some((person) => hasWork(s, person.id)), s.people.some((person) => person.kind === 'support'));
  const line = (name: string, sign: string, say: string): HTMLElement => el('li', {}, el('span', { class: 'sd-how-sign' }, icon(sign, 16)), el('span', {}, el('strong', {}, name), ` ${say}`));
  const got = el('button', { type: 'button', class: 'btn accent sd-btn-sm', 'data-k': 'how-got' }, 'Got it');
  got.addEventListener('click', () => {
    how = 'off';
    emit('look');
    byId('sd-bar').querySelector<HTMLElement>('.sd-how-btn')?.focus({ preventScroll: true });
    sitWeek();
  });
  if (how === 'line') {
    const whole = el('button', { type: 'button', class: 'cc-link sd-how-open', 'data-k': 'how-open' }, 'How this works');
    whole.addEventListener('click', () => {
      how = 'open';
      emit('look');
      byId('sd-how').querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
      sitWeek();
    });
    fill(
      box,
      el(
        'section',
        { class: 'sd-how-panel is-line', 'aria-label': 'How this works, in one line' },
        el('span', { class: 'sd-how-sign' }, icon('info', 16)),
        el('p', { class: 'sd-how-say' }, el('strong', {}, 'Look'), ' is where you start. Add and Erase change the week, and Undo takes back a change.'),
        whole,
        got,
      ),
    );
    return;
  }
  fill(
    box,
    el(
      'section',
      { class: 'sd-how-panel', 'aria-label': 'How this works' },
      el('h3', { class: 'sd-how-h' }, 'How this works'),
      el(
        'ul',
        { class: 'sd-how-list' },
        line('Look', 'look', finger ? 'is where you start. Tap a block to see it. No block changes.' : 'is where you start. Click a block to see it. No block changes.'),
        line('Add', 'plus', finger ? 'puts time on the week. A tap adds one. Press and hold, then drag, for more.' : 'puts time on the week. Choose what and where, then drag.'),
        line('Erase', 'eraser', finger ? 'clears a block at a tap. Press and hold, then drag, to clear more.' : 'clears the times you drag over.'),
        line('Undo', 'undo', 'takes back your last change.'),
      ),
      more === '' ? null : el('p', { class: 'sd-how-more' }, more),
      got,
    ),
  );
}

function setFull(on: boolean): void {
  app.full = on;
  emit('look');
  byId('sd-bar').querySelector<HTMLElement>('.sd-full-btn')?.focus();
  announce(on ? 'The week fills the window. Press Escape to leave.' : 'Back in the page.');
}

function drawNotice(s: Schedule): void {
  const box = byId('sd-notice');
  const notice = app.notice;
  box.hidden = notice === null;
  if (!notice) {
    fill(box);
    return;
  }
  const room = roomOf(s, notice.roomId)?.name ?? 'That room';
  const site = siteOf(s, notice.siteId)?.name ?? 'this site';
  const others = new Set<string>();
  for (const clash of allClashes(s)) {
    if (clash.roomId !== notice.roomId || clash.day !== notice.day || clash.from >= notice.to || clash.to <= notice.from) continue;
    for (const id of clash.personIds) if (id !== notice.personId) others.add(personOf(s, id)?.name ?? 'someone else');
  }
  if (others.size === 0) {
    app.notice = null;
    box.hidden = true;
    fill(box);
    return;
  }
  const say = `${room} is already taken by ${[...others].join(' and ')} on ${dayName(notice.day)}, ${clockRange(notice.from, notice.to)}.`;
  const keep = el('button', { type: 'button', class: 'cc-link', 'data-k': 'notice-keep' }, 'Keep it here');
  keep.addEventListener('click', () => {
    app.notice = null;
    emit('look');
  });
  const rooms = notice.free.slice(0, 8).map((free) => {
    const button = el('button', { type: 'button', class: 'sd-chip-btn', 'data-k': `free:${free.id}` }, free.name);
    button.addEventListener('click', () => {
      const next = setPlace(s, { personId: notice.personId, day: notice.day, from: notice.from, to: notice.to, where: { kind: 'site', siteId: notice.siteId, roomId: free.id } });
      app.notice = null;
      app.where = { kind: 'site', siteId: notice.siteId, roomId: free.id };
      app.status = `Moved to ${free.name}.`;
      announce(app.status);
      if (!commit(next)) emit('look');
    });
    return button;
  });
  // The note floats over the foot of the week and takes no room of its own, so the week does not
  // jump under the pointer while someone is adding time.
  fill(
    box,
    el(
      'div',
      { class: 'sd-notice' },
      icon('alert', 20),
      el(
        'div',
        { class: 'sd-notice-say' },
        el('p', {}, el('strong', {}, say)),
        rooms.length > 0 ? el('p', {}, `Free at ${site} for that whole time:`) : el('p', {}, `No other room at ${site} is free for that whole time.`),
        rooms.length > 0 ? el('div', { class: 'sd-chip-row' }, ...rooms) : null,
      ),
      keep,
    ),
  );
}

// ---------- A side panel taller than the window ----------

/**
 * The strip and the tallies stay beside the week while the page scrolls. When one of them is
 * taller than the window it scrolls by itself, and this button says so and moves it.
 */
function moreButton(panel: HTMLElement, key: string): HTMLElement {
  const button = el('button', { type: 'button', class: 'sd-more-btn', 'data-k': `more:${key}` }, el('span', {}, 'More'), icon('down', 14));
  button.addEventListener('click', () => {
    const below = panel.hasAttribute('data-below');
    panel.scrollTo({ top: below ? panel.scrollTop + Math.round(panel.clientHeight * 0.7) : 0, behavior: calm() ? 'auto' : 'smooth' });
  });
  return el('div', { class: 'sd-more' }, button);
}

/** The least height the tallies keep beside the week in a very short window. */
const LEAST_SIDE = 320;

/**
 * Beside the week the tallies get the height the window leaves under the Design bar and above the
 * bar along the bottom, so the page has no empty stretch under the week. A taller column scrolls
 * by itself. The style sheet uses the height only where the tallies stand beside the week.
 */
function fitSide(): void {
  const px = (value: string): number => parseFloat(value) || 0;
  const design = byId('sd-design');
  const foot = app.full ? 0 : byId('sd-foot').offsetHeight;
  const lead = app.full ? 0 : Math.max(0, px(getComputedStyle(document.documentElement).scrollPaddingTop) + px(getComputedStyle(design).scrollMarginTop));
  const above = byId('sd-work').getBoundingClientRect().top - design.getBoundingClientRect().top;
  byId('sd').style.setProperty('--sd-side-h', `${Math.max(LEAST_SIDE, Math.round(window.innerHeight - foot - lead - above - 9))}px`);
}

function markMore(panel: HTMLElement): void {
  const more = panel.querySelector<HTMLElement>(':scope > .sd-more');
  // The room the button stands in at the foot of the panel is not counted as something to scroll to.
  const style = getComputedStyle(panel);
  const scrolls = style.overflowY === 'auto' && panel.scrollHeight - (parseFloat(style.paddingBottom) || 0) - panel.clientHeight > 8;
  const below = scrolls && panel.scrollHeight - panel.clientHeight - panel.scrollTop > 12;
  panel.toggleAttribute('data-scroll', scrolls);
  panel.toggleAttribute('data-below', below);
  const say = more?.querySelector('span');
  if (say) say.textContent = below ? 'More' : 'Back up';
  more?.querySelector('button')?.setAttribute('aria-label', below ? 'Show more of this panel' : 'Back to the start of this panel');
}

/**
 * The quiet line under a column's heading: the day's slots, and "Day off" on a day off. Support
 * staff have no slots, so their line gives the paid hours planned that day.
 */
function daySub(s: Schedule, personId: string, day: Day): string {
  const tally = tallyPerson(s, personId);
  const row = tally?.days.find((one) => one.day === day);
  const off = isDayOff(s, personId, day);
  if (tally?.kind === 'support') {
    const paid = row?.paidMinutes ?? 0;
    if (off) return paid > 0 ? `Day off, ${hrs(paid)}` : 'Day off';
    return paid > 0 ? hrs(paid) : 'Nothing yet';
  }
  const slots = row?.slots ?? 0;
  if (!off) return slotWords(slots);
  return slots > 0 ? `Day off, ${slotWords(slots)}` : 'Day off';
}

function columns(s: Schedule): Column[] {
  if (app.view === 'person') {
    const person = personOf(s, app.personId);
    if (!person) return [];
    return s.days.map((day) => ({
      key: `${person.id}|${day}`,
      personId: person.id,
      day,
      step: person.step,
      title: dayName(day),
      short: dayName(day).slice(0, 3),
      sub: daySub(s, person.id, day),
    }));
  }
  // In the Day view each provider is followed by the support staff who are with them that day.
  const people = dayOrder(s, app.day).flatMap((id) => personOf(s, id) ?? []);
  return people.map((person) => ({
    key: `${person.id}|${app.day}`,
    personId: person.id,
    day: app.day,
    step: person.step,
    title: person.name,
    short: person.name,
    sub: daySub(s, person.id, app.day),
  }));
}

function drawCanvas(): void {
  const s = app.schedule;
  if (!s) return;
  const canvas = byId('sd-canvas');
  const other = byId('sd-view');
  const painting = app.view === 'person' || app.view === 'day';
  // With nobody in the schedule there is no week to build, so the step says what to do next.
  if (s.people.length === 0 && app.view !== 'rooms') {
    canvas.hidden = true;
    other.hidden = false;
    keepFocus(other, () => fill(other, nobodyCard()));
    return;
  }
  canvas.hidden = !painting;
  other.hidden = painting;
  if (painting) keepFocus(canvas, () => drawWeek(columns(s), app.view === 'day' ? 'day' : 'person'));
  else keepFocus(other, () => (app.view === 'rooms' ? drawRooms(other) : drawOverview(other)));
  markCues();
}

/**
 * The line under the week when nothing has just happened: what else there is to know in this mode,
 * said for the way this person points at the page. A finger presses and holds first, so that a swipe still scrolls.
 */
function modeHint(): string {
  const how = pointing();
  if (app.mode === 'look') {
    // A support person's week can be filled from a provider's patient time, and Add is where that is offered.
    const s = app.schedule;
    const fills = s !== null && app.view === 'person' && personOf(s, app.personId)?.kind === 'support' && withChoices(s, app.personId).length > 0;
    return fills ? 'Choose Add to add time or fill the week. Choose Erase to clear some.' : 'Choose Add to add time. Choose Erase to clear some.';
  }
  if (app.mode === 'add') {
    if (how === 'touch') return 'A tap adds one block. To add more, hold, then drag down.';
    if (how === 'both') return 'A click adds one block. With a finger, press and hold first. Esc goes back to Look.';
    return 'A click adds one block. Esc goes back to Look.';
  }
  if (how === 'touch') return 'A tap clears one block. To clear more, hold, then drag down.';
  if (how === 'both') return 'A click clears what is under the pointer. With a finger, press and hold first. Esc goes back to Look.';
  return 'A click clears what is under the pointer. Esc goes back to Look.';
}

/** Draws the whole Design step from what the page remembers. `why` is 'step' on arriving here from another step. */
export function drawDesign(why: Why = 'look'): void {
  const s = app.schedule;
  if (!s) return;
  if (why === 'step') showFirstRows();
  byId('sd-design').classList.toggle('is-full', app.full);
  document.documentElement.classList.toggle('sd-lock', app.full);
  const nobody = s.people.length === 0;
  const work = byId('sd-work');
  work.dataset['view'] = app.view;
  work.classList.toggle('is-nobody', nobody && app.view !== 'rooms');
  keepFocus(byId('sd-bar'), () => drawBar(s));
  keepFocus(byId('sd-how'), () => drawHow(s));
  const palette = byId('sd-palette');
  keepFocus(palette, () => {
    drawPalette(palette);
    palette.append(moreButton(palette, 'palette'));
  });
  // The line under the week is written before the week is drawn, because the week takes the height that is left.
  const line = byId('sd-status');
  const lineSay = app.status || (!nobody && (app.view === 'person' || app.view === 'day') ? modeHint() : '');
  // With a finger the Undo button in the bar is off the screen, so the line that reports a change carries one.
  const undoButton = (): HTMLElement => el('button', { type: 'button', class: 'cc-link sd-status-undo', 'data-k': 'status-undo' }, 'Undo');
  // The answer to a fill is drawn plainly, with Undo for every pointer, and its reasons wait behind "Why".
  const answer = answerOffered();
  const answered = app.status !== '' && app.status === answer.line;
  line.classList.toggle('is-answer', answered);
  if (answered) {
    const why = answer.why === '' ? null : el('button', { type: 'button', class: 'cc-link sd-status-why', 'data-k': 'status-why', 'aria-expanded': answer.open ? 'true' : 'false' }, 'Why');
    fill(line, el('span', { class: 'sd-status-say' }, lineSay), answer.undo && canUndo() ? undoButton() : null, why, why && answer.open ? el('span', { class: 'sd-status-more' }, answer.why) : null);
  } else if (app.status !== '' && pointing() === 'touch' && canUndo() && (app.status === undoOffered() || app.status === 'Undone.')) fill(line, lineSay, ' ', undoButton());
  else line.textContent = lineSay;
  drawCanvas();
  const side = byId('sd-side');
  keepFocus(side, () => {
    drawSide(side);
    side.append(moreButton(side, 'side'));
    // The side was drawn again, so the details of a selected block are put back at its head.
    drawPicked();
  });
  keepFocus(byId('sd-notice'), () => drawNotice(s));
  fitSide();
  markMore(palette);
  markMore(side);
}

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.matches('input, select, textarea') || target.isContentEditable);
}

export function initDesign(): void {
  initWeek(drawCanvas);
  byId('sd-status').addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('[data-k="status-undo"]') && undo()) announce(app.status);
    else if (event.target.closest('[data-k="status-why"]')) {
      flipWhy();
      const answer = answerOffered();
      if (answer.open) announce(answer.why);
      emit('look');
      showAnswer();
    }
  });
  initViews();
  window.addEventListener('resize', fitSide);
  for (const id of ['sd-palette', 'sd-side']) {
    const panel = byId(id);
    panel.addEventListener('scroll', () => markMore(panel), { passive: true });
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => markMore(panel)).observe(panel);
  }

  document.addEventListener('keydown', (event) => {
    const s = app.schedule;
    if (!s || app.step !== 3) return;
    const week = app.view === 'person' || app.view === 'day';
    // Esc closes what is open, one thing at a time: a list or a panel first, then the mode, then the full window.
    if (event.key === 'Escape') {
      if (keysOpen) {
        keysOpen = false;
        drawBar(s);
        byId('sd-bar').querySelector<HTMLElement>('.sd-keys-btn')?.focus();
      } else if (hoursOpen) {
        hoursOpen = false;
        drawBar(s);
        byId('sd-bar').querySelector<HTMLElement>('.sd-hrs-btn')?.focus();
      } else if (week && escapeWeek()) {
        // The small menu or the details closed.
      } else if (week && app.mode !== 'look' && !typing(event.target)) switchMode('look');
      else if (app.full) setFull(false);
      return;
    }
    if (typing(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (!week || s.people.length === 0) return;
    // A letter or a digit changes the mode only from the week or from the switch, never from a stray key somewhere else.
    if (!(event.target instanceof Element) || !event.target.closest('.sd-cv-body, .sd-mode-seg')) return;
    const key = event.key.toLowerCase();
    if (key === 'l') {
      if (app.mode !== 'look') switchMode('look');
      return;
    }
    if (key === 'e') {
      if (app.mode !== 'erase') switchMode('erase');
      return;
    }
    if (key === 'a') {
      if (app.mode !== 'add') switchMode('add');
      return;
    }
    // A digit chooses a kind of time, and only while adding. In Look and in Erase it does nothing.
    if (/^[1-9]$/.test(event.key) && app.mode === 'add') chooseKind(Number(event.key) - 1);
  });

  // One rule for the list of keys, the hours and every dropdown: only one is open. Nothing is drawn again, so a click still lands.
  const shutKeys = (): void => {
    if (!keysOpen) return;
    keysOpen = false;
    byId('sd-bar').querySelector('.sd-keys')?.remove();
    byId('sd-bar').querySelector('.sd-keys-btn')?.setAttribute('aria-expanded', 'false');
  };
  const shutHours = (): void => {
    if (!hoursOpen) return;
    hoursOpen = false;
    byId('sd-bar').querySelector('.sd-hrs-pop')?.remove();
    byId('sd-bar').querySelector('.sd-hrs-btn')?.setAttribute('aria-expanded', 'false');
  };
  // A click somewhere else closes the list of keys and the hours.
  document.addEventListener('pointerdown', (event) => {
    const target = event.target as Element;
    if (!target.closest('.sd-keys, .sd-keys-btn')) shutKeys();
    if (!target.closest('.sd-hrs') && !inDropdown(target)) shutHours();
  });
  // A dropdown that opens, by mouse, touch or keyboard, closes them too. The two lists inside the hours leave the hours open.
  whenDropdownOpens((button) => {
    shutKeys();
    if (!button.closest('.sd-hrs-pop')) shutHours();
  });
}
