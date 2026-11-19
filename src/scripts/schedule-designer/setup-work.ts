// Set up, the People tab: one person's working hours. A row for each day the schedule shows, with
// the time the day starts and ends, a second stretch for a split day, and a switch for a day off.
// One button copies a day onto the others. Entering nothing is allowed, and the block says what
// that means. What each control decides is worked out in work-say.ts; the engine keeps the hours.
import { clearWork, copyWork, dayName, personOf, setWork, tallyPerson } from './engine/index';
import type { Day, Person, Schedule, Span } from './engine/index';
import { el, icon } from './dom';
import { picker } from './dropdown';
import { app, commit } from './state';
import { addButton, cur, focusNext, onLive } from './setup-parts';
import { NO_WORK_SAY, hoursLike, limitsOf, splitOf, timeChoices, usualDay, workRows, workWeekSay } from './work-say';
import type { WorkRow } from './work-say';

/** The day the copy button copies for one person, kept while they look at other things in Set up. Another person starts afresh. */
let copyDay: { personId: string; day: Day } | null = null;

/** The line under the rows: hours at work in the week beside the contract hours. */
function weekSay(s: Schedule, personId: string): string {
  const tally = tallyPerson(s, personId);
  if (!tally || tally.workMinutes === null || tally.paidWorkMinutes === null) return '';
  return workWeekSay(tally.workMinutes, tally.paidWorkMinutes, tally.contractMinutes);
}

function rowEl(person: Person, row: WorkRow): HTMLElement {
  const set = (stretches: readonly Span[], focus: string, toast: { say: string; undo: boolean } | null = null): void => {
    focusNext(focus);
    commit(setWork(cur(), person.id, row.day, stretches), toast);
  };
  // A second stretch makes a split day. The button says what it will do, and its key stays the same so the keyboard stays on it.
  let second: HTMLElement | null = null;
  const first = row.stretches[0];
  const last = row.stretches[row.stretches.length - 1];
  if (first && last && row.stretches.length === 1) {
    const split = splitOf(first);
    second = el('button', { type: 'button', class: 'cc-link sd-wh-second', 'data-k': `wh-second:${row.day}`, 'aria-label': `Split ${row.name} into two stretches`, disabled: split === null }, 'Split the day');
    second.addEventListener('click', () => {
      if (split) set(split, `wh-second:${row.day}`);
    });
  } else if (first && last) {
    second = el('button', { type: 'button', class: 'cc-link sd-wh-second', 'data-k': `wh-second:${row.day}`, 'aria-label': `Make ${row.name} one stretch` }, 'Make it one stretch');
    second.addEventListener('click', () => set([{ from: first.from, to: last.to }], `wh-second:${row.day}`));
  }

  // One line for each stretch. The button that splits or joins the day ends the last line.
  const limits = limitsOf(row.stretches);
  const lines: HTMLElement[] = [];
  row.stretches.forEach((stretch, at) => {
    const limit = limits[at];
    if (!limit) return;
    const fromLabel = at === 0 ? `${row.name} starts at` : `${row.name} starts again at`;
    const toLabel = at === 0 && row.stretches.length > 1 ? `${row.name} stops at` : `${row.name} ends at`;
    const change = (next: Span, label: string): void => set(row.stretches.map((one, i) => (i === at ? next : one)), `pick:${label}`);
    lines.push(
      el(
        'div',
        { class: 'sd-wh-line' },
        at > 0 ? el('span', { class: 'visually-hidden' }, 'and') : null,
        el(
          'span',
          { class: 'sd-wh-stretch' },
          picker(fromLabel, timeChoices(limit.from[0], limit.from[1], stretch.from), String(stretch.from), (value) => change({ from: Number(value), to: stretch.to }, fromLabel)),
          el('span', { class: 'sd-wh-to', 'aria-hidden': 'true' }, 'to'),
          picker(toLabel, timeChoices(limit.to[0], limit.to[1], stretch.to), String(stretch.to), (value) => change({ from: stretch.from, to: Number(value) }, toLabel)),
        ),
        at === row.stretches.length - 1 ? second : null,
      ),
    );
  });

  const off = el('input', { type: 'checkbox', 'data-k': `wh-off:${row.day}`, 'aria-label': `${row.name} is a day off` });
  off.checked = row.off;
  off.addEventListener('change', () => {
    const s = cur();
    if (off.checked) {
      const last = workRows(s, person.id).filter((one) => !one.off).length === 1;
      set([], last ? 'wh-enter' : `wh-off:${row.day}`, last ? { say: `${row.name} was the only working day, so ${person.name} has no working hours entered now.`, undo: true } : null);
    } else set(hoursLike(s, person.id, row.day), `wh-off:${row.day}`);
  });
  return el(
    'li',
    { class: `sd-wh-row${row.off ? ' is-off' : ''}` },
    el('span', { class: 'sd-wh-day' }, row.name),
    el('div', { class: 'sd-wh-times' }, ...lines),
    el('label', { class: 'sd-switch sd-wh-off' }, off, el('i', { 'aria-hidden': 'true' }), el('span', {}, 'Day off')),
  );
}

/** The working hours of one person, for the panel in Set up. */
export function workBlock(s: Schedule, person: Person): HTMLElement {
  const rows = workRows(s, person.id);
  const heading = el('p', { class: 'sd-field-label sd-wh-h' }, icon('clock', 16), 'Working hours');
  if (rows.length === 0) {
    const enter = addButton('Enter working hours', 'wh-enter', () => {
      let next = cur();
      const usual = usualDay(next);
      for (const day of next.days) next = setWork(next, person.id, day, [usual]);
      const firstDay = next.days[0];
      if (firstDay !== undefined) focusNext(`pick:${dayName(firstDay)} starts at`);
      commit(next);
    }, s.days.length === 0);
    return el('section', { class: 'sd-wh is-none', 'aria-label': `Working hours for ${person.name}` }, heading, el('p', { class: 'sd-field-hint sd-wh-none' }, NO_WORK_SAY), enter, el('span', { class: 'sd-field-hint' }, 'Each day starts as 8:00 am to 5:00 pm. Change any day after that.'));
  }

  const working = rows.filter((row) => !row.off);
  const from = (copyDay?.personId === person.id ? working.find((row) => row.day === copyDay?.day) : undefined) ?? working[0];
  let chosen = from?.day ?? rows[0]?.day ?? (0 as Day);
  const copySay = (day: Day): string => `Copy ${dayName(day)} to the other days`;
  const copy = el('button', { type: 'button', class: 'btn ghost sd-btn-sm', 'data-k': 'wh-copy', disabled: rows.length < 2 }, icon('copy', 16), el('span', {}, copySay(chosen)));
  copy.addEventListener('click', () => {
    const now = cur();
    focusNext('wh-copy');
    commit(copyWork(now, person.id, chosen, now.days), { say: `Copied ${dayName(chosen)} to the other days.`, undo: true });
  });
  const which = picker('Day to copy', working.map((row) => ({ value: String(row.day), say: row.name })), String(chosen), (value) => {
    chosen = Number(value) as Day;
    copyDay = { personId: person.id, day: chosen };
    const say = copy.querySelector('span');
    if (say) say.textContent = copySay(chosen);
  });

  const sum = el('p', { class: 'sd-wh-sum', role: 'status' }, weekSay(s, person.id));
  onLive(() => {
    const now = app.schedule;
    if (now && personOf(now, person.id)) sum.textContent = weekSay(now, person.id);
  });
  const clear = el('button', { type: 'button', class: 'cc-link', 'data-k': 'wh-clear' }, 'Clear working hours');
  clear.addEventListener('click', () => {
    focusNext('wh-enter');
    commit(clearWork(cur(), person.id), { say: `Cleared the working hours of ${person.name}. Their blocks stay as they are.`, undo: true });
  });

  return el(
    'section',
    { class: 'sd-wh', 'aria-label': `Working hours for ${person.name}` },
    heading,
    el('ul', { class: 'sd-wh-rows' }, ...rows.map((row) => rowEl(person, row))),
    el('div', { class: 'sd-wh-copy' }, which, copy),
    el('div', { class: 'sd-wh-foot' }, sum, clear),
  );
}
