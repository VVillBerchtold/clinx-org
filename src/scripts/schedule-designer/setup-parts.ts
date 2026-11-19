// Parts the Set up step is built from: a text box that saves what is typed without drawing the
// form again, a number box, the swatch picker, and the line that says what a removal took with it.
import { ALL_COLOURS, COLOUR_NAMES, LIMITS, clock, setHours } from './engine/index';
import type { Change, Colour, Schedule } from './engine/index';
import { el, icon, plural } from './dom';
import { picker } from './dropdown';
import { app, commit, emit } from './state';

let quiet = false;
const live: (() => void)[] = [];
let wanted: string | null = null;
let swatchOpen: string | null = null;

/**
 * The schedule as it is this moment. A button drawn a while ago must change this one and not the
 * one it was drawn from, which may be a few typed values behind.
 */
export function cur(): Schedule {
  const s = app.schedule;
  if (!s) throw new Error('No schedule is open.');
  return s;
}

/**
 * The two pickers for the hours the week shows: the first hour and the last. Set up and the Design
 * bar both use them, so the range is set the same way in either place.
 */
export function hoursPickers(s: Schedule): { from: HTMLElement; to: HTMLElement } {
  const hours = (first: number, last: number): { value: string; say: string }[] => {
    const list: { value: string; say: string }[] = [];
    for (let minute = first; minute <= last; minute += 60) list.push({ value: String(minute), say: minute === 1440 ? 'Midnight' : clock(minute) });
    return list;
  };
  // A time that is not on the hour, from a file, stays in the list so that it can be seen.
  const withOwn = (list: { value: string; say: string }[], own: number): { value: string; say: string }[] => (list.some((item) => item.value === String(own)) ? list : [...list, { value: String(own), say: clock(own) }].sort((a, b) => Number(a.value) - Number(b.value)));
  const from = picker('The week starts at', withOwn(hours(0, s.dayEnd - 60), s.dayStart), String(s.dayStart), (value) => {
    commit(setHours(cur(), Number(value), cur().dayEnd));
  });
  const to = picker('The week ends at', withOwn(hours(Math.ceil((s.dayStart + 60) / 60) * 60, 1440), s.dayEnd), String(s.dayEnd), (value) => {
    commit(setHours(cur(), cur().dayStart, Number(value)));
  });
  return { from, to };
}

/** True while a typed value is being saved, when the form must stay as it is under the fingers. */
export const isQuiet = (): boolean => quiet;

/** Asks for a small part of the form to be brought up to date after a typed value is saved. */
export function onLive(update: () => void): void {
  live.push(update);
}
export function clearLive(): void {
  live.length = 0;
}

/** Saves a typed value. The form is not drawn again, so the keyboard stays where it is. */
export function quietly(next: Schedule): void {
  quiet = true;
  try {
    commit(next);
  } finally {
    quiet = false;
  }
  for (const update of live) update();
}

/** Asks for a control to be selected once the form is drawn again: a row just added, say. */
export function focusNext(key: string): void {
  wanted = key;
}
export function takeWanted(): string | null {
  const key = wanted;
  wanted = null;
  return key;
}

/** Asks for one part of the form to be brought into view and marked once it is drawn: a finding's "Show it". */
let shown: string | null = null;
export function showPart(name: string): void {
  shown = name;
}
export function takeShown(): string | null {
  const name = shown;
  shown = null;
  return name;
}

/**
 * Takes a change that may have removed blocks, and says so in the bar along the bottom with an
 * offer to undo. A change that could not be made says why.
 */
export function change(result: Change, done: string, took: (blocks: string) => string, one = 'block'): void {
  if (result.problem !== undefined) {
    app.toast = { say: result.problem, undo: false };
    emit('look');
    return;
  }
  const say = result.touched > 0 ? `${done} ${took(plural(result.touched, one))}` : done;
  commit(result.schedule, { say, undo: true });
}

interface TextOptions {
  label: string;
  key: string;
  value: string;
  set: (s: Schedule, value: string) => Schedule;
  read: (s: Schedule) => string;
  max?: number;
  extra?: string;
  placeholder?: string;
}

export function textBox(o: TextOptions): HTMLInputElement {
  const input = el('input', { type: 'text', class: `sd-input${o.extra ? ` ${o.extra}` : ''}`, 'aria-label': o.label, 'data-k': o.key, maxlength: String(o.max ?? LIMITS.name), value: o.value, placeholder: o.placeholder, autocomplete: 'off', spellcheck: 'false' });
  input.addEventListener('change', () => {
    const s = app.schedule;
    if (!s) return;
    quietly(o.set(s, input.value));
    const now = app.schedule;
    if (now) input.value = o.read(now);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
  });
  return input;
}

interface NumberOptions {
  label: string;
  key: string;
  value: number;
  least: number;
  most: number;
  step: number;
  /** Saves the number. Gives back the schedule to keep, or a change that may have moved blocks. */
  set: (s: Schedule, value: number) => Schedule | Change;
  read: (s: Schedule) => number;
  typing?: (value: number) => void;
  /** Says what the change did when it touched blocks. */
  took?: (blocks: string) => string;
}

export function numberBox(o: NumberOptions): HTMLInputElement {
  const input = el('input', { type: 'number', class: 'sd-input sd-input-num', 'aria-label': o.label, 'data-k': o.key, min: String(o.least), max: String(o.most), step: String(o.step), value: String(o.value), inputmode: 'decimal' });
  input.addEventListener('input', () => {
    const typed = Number(input.value);
    if (input.value !== '' && Number.isFinite(typed)) o.typing?.(typed);
  });
  input.addEventListener('change', () => {
    const s = app.schedule;
    if (!s) return;
    const typed = Number(input.value);
    if (input.value !== '' && Number.isFinite(typed)) {
      const result = o.set(s, typed);
      if ('touched' in result) {
        if (result.touched > 0 && o.took) change(result, 'Changed.', o.took, 'appointment');
        else quietly(result.schedule);
      } else quietly(result);
    }
    const now = app.schedule;
    if (now) input.value = String(o.read(now));
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
  });
  return input;
}

interface OptionalOptions {
  label: string;
  key: string;
  /** The person's own number, or null when the box is empty and the usual value applies. */
  value: number | null;
  /** The usual value, shown in grey while the box is empty. */
  usual: string;
  least: number;
  most: number;
  step: number;
  set: (s: Schedule, value: number | null) => Schedule;
  read: (s: Schedule) => number | null;
  typing?: (value: number | null) => void;
}

/** A number box that may be left empty, which means "use the usual value". */
export function optionalBox(o: OptionalOptions): HTMLInputElement {
  const input = el('input', { type: 'number', class: 'sd-input sd-input-num', 'aria-label': o.label, 'data-k': o.key, min: String(o.least), max: String(o.most), step: String(o.step), value: o.value === null ? '' : String(o.value), placeholder: o.usual, inputmode: 'decimal' });
  const typed = (): number | null | undefined => {
    if (input.value.trim() === '') return input.validity.badInput ? undefined : null;
    const value = Number(input.value);
    return Number.isFinite(value) ? value : undefined;
  };
  input.addEventListener('input', () => {
    const value = typed();
    if (value !== undefined) o.typing?.(value);
  });
  input.addEventListener('change', () => {
    const s = app.schedule;
    if (!s) return;
    const value = typed();
    if (value !== undefined) quietly(o.set(s, value));
    const now = app.schedule;
    const kept = now ? o.read(now) : null;
    input.value = kept === null ? '' : String(kept);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
  });
  return input;
}

/** A labelled part of a form. */
export function field(label: string, control: Node, hint = '', extra = ''): HTMLElement {
  return el('label', { class: `sd-field${extra ? ` ${extra}` : ''}` }, el('span', { class: 'sd-field-label' }, label), control, hint ? el('span', { class: 'sd-field-hint' }, hint) : null);
}

export function removeButton(label: string, key: string, remove: () => void): HTMLButtonElement {
  const button = el('button', { type: 'button', class: 'sd-icon-btn sd-remove', 'aria-label': label, title: label, 'data-k': key }, icon('trash', 16));
  button.addEventListener('click', remove);
  return button;
}

export function addButton(say: string, key: string, add: () => void, off = false): HTMLButtonElement {
  const button = el('button', { type: 'button', class: 'sd-add', 'data-k': key, disabled: off }, icon('plus', 16), say);
  button.addEventListener('click', add);
  return button;
}

/** A dot that opens the twelve swatches to choose from. */
export function swatchPicker(key: string, label: string, current: Colour, choose: (colour: Colour) => void): HTMLElement {
  const isOpen = swatchOpen === key;
  const button = el('button', { type: 'button', class: `sd-swatch-btn sd-sw-${current}`, 'data-k': key, 'aria-label': `${label}: ${COLOUR_NAMES[current]}. Change the colour`, title: 'Change the colour', 'aria-expanded': isOpen ? 'true' : 'false' });
  button.addEventListener('click', () => {
    swatchOpen = isOpen ? null : key;
    focusNext(isOpen ? key : `${key}:${current}`);
    emit('look');
  });
  const wrap = el('span', { class: 'sd-swatch' }, button);
  if (isOpen) {
    const list = el('span', { class: 'sd-swatches', role: 'group', 'aria-label': 'Colour' });
    for (const colour of ALL_COLOURS) {
      const option = el('button', { type: 'button', class: `sd-swatch-opt sd-sw-${colour}`, 'data-k': `${key}:${colour}`, 'aria-label': COLOUR_NAMES[colour], title: COLOUR_NAMES[colour], 'aria-pressed': colour === current ? 'true' : 'false' });
      option.addEventListener('click', () => {
        swatchOpen = null;
        focusNext(key);
        if (colour === current) emit('look');
        else choose(colour);
      });
      list.append(option);
    }
    wrap.append(list);
  }
  return wrap;
}

/** Closes the swatches when the person clicks somewhere else or presses Escape. Nothing is drawn again. */
export function closeSwatches(): boolean {
  if (swatchOpen === null) return false;
  swatchOpen = null;
  for (const list of document.querySelectorAll('.sd-swatches')) list.remove();
  for (const button of document.querySelectorAll('.sd-swatch-btn[aria-expanded="true"]')) button.setAttribute('aria-expanded', 'false');
  return true;
}
