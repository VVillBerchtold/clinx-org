// The page's one dropdown: a button that says the present choice and opens a list. Every picker on
// the page is made here, so the person, the day, the site, the hours and the pickers in Set up and
// in Check and save look and behave the same. On a phone the list is a sheet along the bottom.
//
// The keyboard stays on the button the whole time. The list is a listbox the button points at, and
// the choice the keyboard is on is named to a screen reader through aria-activedescendant. Moving
// through the list chooses nothing: only Enter, Space or a click does.
import { dot, el, icon, pointing } from './dom';
import type { Colour } from './engine/index';
import { dropKey, groupsOf, isTyped, placeList, typedMatch } from './dropdown-keys';
import type { Choice } from './dropdown-keys';

export type { Choice } from './dropdown-keys';

/** How long a pause ends a run of typed letters, in milliseconds. */
const TYPING_MS = 700;
const PHONE = '(max-width: 44rem)';

let made = 0;
/** Closes the list that is open, if one is. Only one is open at a time. */
let shut: ((focus: boolean) => void) | null = null;

/** Told each time a list opens, with the button that opened it, so the page can close any other panel. */
let opened: ((button: HTMLElement) => void) | null = null;

/** Names the one function that hears a list open. */
export function whenDropdownOpens(hear: (button: HTMLElement) => void): void {
  opened = hear;
}

const swatch = (colour: number | undefined): HTMLElement | null => (colour === undefined ? null : dot(colour as Colour, 'sd-dd-sw'));

/** Closes an open list without choosing. The page calls this before it draws itself again from a key. */
export function closeDropdown(): void {
  shut?.(false);
}

/** True when something pressed or clicked is part of an open list, so a panel that holds the button can stay open. */
export function inDropdown(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.sd-dd-pop, .sd-dd-veil') !== null;
}

/**
 * A dropdown with the site's look. `choose` gets the chosen value, and only when it differs from
 * the present one. The button keeps the hook `pick:<label>`, and each choice in the open list
 * carries its value in `data-v`.
 */
export function picker(label: string, options: readonly Choice[], current: string, choose: (value: string) => void, extra = ''): HTMLElement {
  made += 1;
  const listId = `sd-dd-${made}`;
  // The control keeps its own present choice, so it reads right even when choosing draws nothing again.
  let chosen = current;
  const now = options.find((option) => option.value === chosen);
  // With nothing chosen the button says its own label, so a list that adds something reads as "Add a provider" and no name looks chosen.
  const say = el('span', { class: 'sd-dd-say' }, now ? (now.full ?? now.say) : label);
  // The swatch of the present choice, when the choices have swatches.
  const mark = el('span', { class: 'sd-dd-mark', 'aria-hidden': 'true' }, swatch(now?.swatch));
  const button = el(
    'button',
    { type: 'button', class: 'sd-dd-btn', role: 'combobox', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': listId, 'aria-label': now ? `${label}: ${now.full ?? now.say}` : label, 'data-k': `pick:${label}` },
    options.some((option) => option.swatch !== undefined) ? mark : null,
    say,
    icon('down', 14),
  );
  const says = options.map((option) => option.say);
  let pop: HTMLElement | null = null;
  let veil: HTMLElement | null = null;
  let rows: HTMLElement[] = [];
  let at = Math.max(0, options.findIndex((option) => option.value === chosen));
  let typed = '';
  let typedAt = 0;
  /** True between Space going down on an open list and coming up, when it chooses. */
  let spaceDown = false;

  const moveTo = (index: number): void => {
    at = index;
    pop?.classList.remove('is-quiet');
    rows.forEach((row, i) => row.classList.toggle('is-at', i === index));
    const row = rows[index];
    if (!row) return;
    button.setAttribute('aria-activedescendant', row.id);
    // The list scrolls inside itself, so the page never moves.
    const list = row.closest<HTMLElement>('.sd-dd-list');
    if (!list) return;
    const top = row.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = Math.max(0, top - 4);
    else if (top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + row.offsetHeight - list.clientHeight + 4;
  };

  const place = (): void => {
    if (!pop || window.matchMedia(PHONE).matches) return;
    const box = button.getBoundingClientRect();
    pop.style.maxHeight = '';
    const spot = placeList(box, { width: pop.offsetWidth, height: pop.scrollHeight }, { width: document.documentElement.clientWidth, height: window.innerHeight }, options.some((option) => option.group) ? 608 : 352);
    pop.style.minWidth = `${spot.minWidth}px`;
    pop.style.maxHeight = `${spot.maxHeight}px`;
    pop.style.left = `${spot.left}px`;
    pop.style.top = spot.top === null ? 'auto' : `${spot.top}px`;
    pop.style.bottom = spot.bottom === null ? 'auto' : `${spot.bottom}px`;
  };

  const onScroll = (event: Event): void => {
    if (event.target instanceof Node && pop?.contains(event.target)) return;
    place();
  };
  const onResize = (): void => close(false);
  // A press anywhere else closes the list and still lands where it was aimed, so one click opens the next thing.
  const onPress = (event: Event): void => {
    const target = event.target;
    if (target instanceof Node && (pop?.contains(target) || veil?.contains(target) || button.contains(target))) return;
    close(false);
  };

  function close(focus: boolean): void {
    if (!pop) return;
    pop.remove();
    veil?.remove();
    pop = null;
    veil = null;
    rows = [];
    typed = '';
    shut = null;
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('pointerdown', onPress, true);
    button.setAttribute('aria-expanded', 'false');
    button.removeAttribute('aria-activedescendant');
    if (focus && button.isConnected) button.focus({ preventScroll: true });
  }

  const pickAt = (index: number): void => {
    const option = options[index];
    close(true);
    if (!option || option.value === chosen) return;
    chosen = option.value;
    say.textContent = option.full ?? option.say;
    mark.replaceChildren(...[swatch(option.swatch)].filter((one) => one !== null));
    button.setAttribute('aria-label', `${label}: ${option.full ?? option.say}`);
    at = index;
    choose(option.value);
  };

  function open(index: number, quiet = false): void {
    shut?.(false);
    const list = el('div', { class: 'sd-dd-list', role: 'listbox', id: listId, 'aria-label': label });
    rows = [];
    for (const run of groupsOf(options)) {
      const drawn = run.items.map(({ option, index: i }) => {
        const on = option.value === chosen;
        const row = el(
          'div',
          { class: `sd-dd-opt${on ? ' is-on' : ''}`, role: 'option', id: `${listId}-${i}`, 'aria-selected': on ? 'true' : 'false', 'data-v': option.value },
          swatch(option.swatch),
          el('span', { class: 'sd-dd-text' }, el('span', { class: 'sd-dd-opt-say' }, option.say), option.note ? el('span', { class: 'sd-dd-note' }, option.note) : null),
          on ? icon('check', 16) : null,
        );
        row.addEventListener('click', () => pickAt(i));
        // Only a mouse lights a row by moving over it. A finger that scrolls the sheet leaves the lit row where it was.
        row.addEventListener('pointermove', (event) => {
          if (event.pointerType === 'mouse' && at !== i) moveTo(i);
        });
        rows[i] = row;
        return row;
      });
      if (run.group === '') list.append(...drawn);
      else list.append(el('div', { class: 'sd-dd-run', role: 'group', 'aria-label': run.group }, el('div', { class: 'sd-dd-group', 'aria-hidden': 'true' }, run.group), ...drawn));
    }
    // On a phone the list is a sheet with a veil behind it, and a tap on the veil only closes the sheet.
    const phone = window.matchMedia(PHONE).matches;
    const shutButton = el('button', { type: 'button', class: 'sd-dd-x', 'aria-label': `Close the list: ${label}`, tabindex: '-1' }, icon('close', 16));
    shutButton.addEventListener('click', () => close(true));
    pop = el('div', { class: 'sd-dd-pop' }, el('div', { class: 'sd-dd-top' }, el('p', { class: 'sd-dd-h', 'aria-hidden': 'true' }, label), shutButton), list);
    // A press on the list must not take the keyboard off the button.
    pop.addEventListener('mousedown', (event) => event.preventDefault());
    const host = document.getElementById('sd') ?? document.body;
    if (phone) {
      veil = el('div', { class: 'sd-dd-veil' });
      veil.addEventListener('mousedown', (event) => event.preventDefault());
      veil.addEventListener('click', () => close(true));
      host.append(veil);
    }
    host.append(pop);
    button.setAttribute('aria-expanded', 'true');
    shut = close;
    opened?.(button);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    document.addEventListener('pointerdown', onPress, true);
    place();
    moveTo(index);
    // A list that adds something has no present choice. Opened by a finger it lights no row, so no name looks chosen; the keyboard lights one as soon as it moves.
    if (quiet) pop.classList.add('is-quiet');
  }

  button.addEventListener('click', (event) => {
    if (pop) close(true);
    else open(at, event.detail > 0 && pointing() === 'touch' && !options.some((option) => option.value === chosen));
  });
  button.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      // A shortcut such as Undo draws the page again, so the list goes first.
      if (pop) close(false);
      return;
    }
    if (isTyped(event.key)) {
      const nowMs = event.timeStamp;
      typed = nowMs - typedAt > TYPING_MS ? event.key : typed + event.key;
      typedAt = nowMs;
      const found = typedMatch(says, typed, at);
      event.preventDefault();
      event.stopPropagation();
      if (found === -1) return;
      if (pop) moveTo(found);
      else open(found);
      return;
    }
    // Enter and Space reach a closed button as a click, which opens the list.
    if (!pop && (event.key === 'Enter' || event.key === ' ')) return;
    // Space chooses as it comes up. Choosing draws the control again, and a Space still held down would open the new one.
    if (event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      spaceDown = true;
      return;
    }
    const does = dropKey(event.key, pop !== null, at, options.length);
    if (does.act === 'none') return;
    if (does.act === 'leave') {
      close(false);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (does.act === 'open') open(does.at);
    else if (does.act === 'move') moveTo(does.at);
    else if (does.act === 'choose') pickAt(does.at);
    else close(true);
  });
  button.addEventListener('keyup', (event) => {
    if (event.key !== ' ' || !spaceDown) return;
    spaceDown = false;
    event.preventDefault();
    if (pop) pickAt(at);
  });
  // The keyboard moved to another control: the list has no reason to stay.
  button.addEventListener('focusout', (event) => {
    if (pop && event.relatedTarget instanceof Node) close(false);
  });

  return el('span', { class: `sd-select${extra ? ` ${extra}` : ''}` }, button);
}
