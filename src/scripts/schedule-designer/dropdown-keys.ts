// What a key does to the page's one dropdown, worked out with no page: which choice the keyboard
// is on, when the list opens and closes, and which choice a few typed letters lead to. The
// dropdown in dropdown.ts draws what these functions decide.

/**
 * One choice in a dropdown. `note` is a second, quiet line. Choices with the same `group` sit under
 * one heading. `swatch` is the number of a colour swatch drawn before the words. `full` is what the
 * closed button says when a row under a heading would say too little by itself.
 */
export interface Choice {
  value: string;
  say: string;
  note?: string;
  group?: string;
  swatch?: number;
  full?: string;
}

/** What a key press asks for. `at` is a place in the list of choices. */
export type DropAct = { act: 'open'; at: number } | { act: 'move'; at: number } | { act: 'choose'; at: number } | { act: 'close' } | { act: 'leave' } | { act: 'none' };

/** How many choices Page Up and Page Down move by. */
export const PAGE = 8;

const clamp = (at: number, count: number): number => Math.max(0, Math.min(count - 1, at));

/**
 * What a named key does. `open` says whether the list is showing, `at` is the choice the keyboard
 * is on (the current choice while the list is closed) and `count` is how many choices there are.
 *
 * Closed: Enter, Space, Down and Up open the list on the current choice; Home and End open it on
 * the first and the last. Open: the arrows, Home, End, Page Up and Page Down move and stop at the
 * ends; Enter and Space choose; Esc closes; Tab closes and lets the keyboard move on. Nothing is
 * chosen by moving, so a person can look through a list and leave it as it was.
 */
export function dropKey(key: string, open: boolean, at: number, count: number): DropAct {
  if (count === 0) return key === 'Escape' && open ? { act: 'close' } : { act: 'none' };
  const here = clamp(at, count);
  if (!open) {
    if (key === 'Enter' || key === ' ' || key === 'ArrowDown' || key === 'ArrowUp') return { act: 'open', at: here };
    if (key === 'Home') return { act: 'open', at: 0 };
    if (key === 'End') return { act: 'open', at: count - 1 };
    return { act: 'none' };
  }
  switch (key) {
    case 'ArrowDown':
      return { act: 'move', at: clamp(here + 1, count) };
    case 'ArrowUp':
      return { act: 'move', at: clamp(here - 1, count) };
    case 'Home':
      return { act: 'move', at: 0 };
    case 'End':
      return { act: 'move', at: count - 1 };
    case 'PageDown':
      return { act: 'move', at: clamp(here + PAGE, count) };
    case 'PageUp':
      return { act: 'move', at: clamp(here - PAGE, count) };
    case 'Enter':
    case ' ':
      return { act: 'choose', at: here };
    case 'Escape':
      return { act: 'close' };
    case 'Tab':
      return { act: 'leave' };
    default:
      return { act: 'none' };
  }
}

/** True for a key that types one character, which the dropdown reads as part of a name. */
export function isTyped(key: string): boolean {
  return key.length === 1 && key !== ' ';
}

/**
 * The choice a few typed letters lead to, or -1 when no name starts with them. Capitals do not
 * matter. One letter typed again and again steps through the names that start with it, beginning
 * after the choice the keyboard is on. Several different letters find the first name that starts
 * with all of them, staying on the present choice when it already does.
 */
export function typedMatch(says: readonly string[], typed: string, at: number): number {
  const letters = typed.toLowerCase();
  if (letters === '' || says.length === 0) return -1;
  const names = says.map((say) => say.toLowerCase());
  const same = [...letters].every((letter) => letter === letters[0]);
  const from = (start: number, want: string): number => {
    for (let step = 0; step < names.length; step += 1) {
      const index = (start + step) % names.length;
      if (names[index]?.startsWith(want)) return index;
    }
    return -1;
  };
  if (same) {
    // "s", then "s" again: the next name that starts with s. A name that starts with "ss" wins when there is one.
    const whole = letters.length > 1 ? from(Math.max(0, at), letters) : -1;
    return whole !== -1 ? whole : from(at + 1, letters[0] ?? '');
  }
  return from(Math.max(0, at), letters);
}

/** The choices in the order they are drawn, cut into runs that share a heading. A run with no heading has an empty `group`. */
export function groupsOf<T extends Choice>(options: readonly T[]): { group: string; items: { option: T; index: number }[] }[] {
  const runs: { group: string; items: { option: T; index: number }[] }[] = [];
  options.forEach((option, index) => {
    const group = option.group ?? '';
    const last = runs[runs.length - 1];
    if (last && last.group === group) last.items.push({ option, index });
    else runs.push({ group, items: [{ option, index }] });
  });
  return runs;
}

/**
 * Where an open list goes beside its button, on a window wide enough for a list (a phone gets a
 * sheet along the bottom). The list opens under the button, or above it when there is more room
 * there and too little below, and it is never taller than the room it has or wider than the window.
 * `tallest` is the most height it takes when there is room: a list with headings gets more, so both show.
 * Every number is in CSS pixels from the upper left corner of the window.
 */
export function placeList(button: { left: number; top: number; bottom: number; width: number }, list: { width: number; height: number }, window: { width: number; height: number }, tallest = 352): { left: number; top: number | null; bottom: number | null; maxHeight: number; minWidth: number } {
  const EDGE = 8;
  const GAP = 6;
  const TALLEST = tallest;
  const below = window.height - button.bottom - GAP - EDGE;
  const above = button.top - GAP - EDGE;
  const want = Math.min(list.height, TALLEST);
  const up = below < Math.min(want, 180) && above > below;
  const maxHeight = Math.max(96, Math.min(TALLEST, up ? above : below));
  const minWidth = Math.min(button.width, window.width - 2 * EDGE);
  const width = Math.min(Math.max(list.width, minWidth), window.width - 2 * EDGE);
  const left = Math.max(EDGE, Math.min(button.left, window.width - EDGE - width));
  return { left, top: up ? null : button.bottom + GAP, bottom: up ? window.height - button.top + GAP : null, maxHeight, minWidth };
}
