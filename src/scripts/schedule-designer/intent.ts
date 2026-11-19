// What a pointer or a key does on the week, by mode. This one small function is the whole rule,
// and it touches nothing: it is given the mode and what the person did, and it names what happens.
// The week asks it before it does anything, so "Look changes nothing" is proven here, in one place.
// The cell the keyboard starts on is worked out here too, so a key never acts between two lines of the grid.
import { snapDown, snapUp } from './engine/index';
import type { Step } from './engine/index';

/** Look shows, Add puts time on the week, Erase clears it. */
export type Mode = 'look' | 'add' | 'erase';

/** What is under the pointer or the keyboard cursor: a block, or empty time. */
export type Under = 'block' | 'empty';

/** Something the person did on the week. */
export type Act =
  /** A mouse click, or a finger tap that did not move. */
  | { by: 'click'; on: Under }
  /** The mouse held down and moved over the times. */
  | { by: 'drag'; on: Under }
  /** A finger pressed and held, then moved or lifted. */
  | { by: 'hold'; on: Under }
  /** A finger that moves straight away: the browser scrolls. */
  | { by: 'swipe' }
  /** Enter or Space where the keyboard cursor is. */
  | { by: 'enter'; on: Under }
  /** An arrow key. With Shift held, Add and Erase act where the cursor is and move on. */
  | { by: 'arrow'; shift: boolean; on: Under }
  /** Backspace or Delete. */
  | { by: 'delete'; on: Under };

/** What happens. Only the last two change the schedule. */
export type Does =
  /** Nothing at all. */
  | 'nothing'
  /** The browser scrolls the week. */
  | 'scroll'
  /** The keyboard cursor moves there and the time is said. */
  | 'cursor'
  /** The block is selected and its details are shown. */
  | 'details'
  /** The page says there is nothing here and how to add time. */
  | 'say-empty'
  /** Time of the chosen kind is put on the week. */
  | 'add'
  /** The time there is cleared. */
  | 'clear';

/** What an action on the week does in a mode. */
export function does(mode: Mode, act: Act): Does {
  if (act.by === 'swipe') return 'scroll';
  if (mode === 'look') {
    switch (act.by) {
      case 'click':
        return act.on === 'block' ? 'details' : 'cursor';
      case 'drag':
      case 'hold':
        return 'nothing';
      case 'enter':
        return act.on === 'block' ? 'details' : 'say-empty';
      case 'arrow':
        return 'cursor';
      case 'delete':
        // Look removes nothing, whether or not a block's details are open. Erase is the way to remove.
        return 'nothing';
    }
  }
  if (act.by === 'arrow') return act.shift ? (mode === 'add' ? 'add' : 'clear') : 'cursor';
  if (act.by === 'delete') return 'clear';
  return mode === 'add' ? 'add' : 'clear';
}

/** True when what happens changes the schedule. */
export function changes(what: Does): boolean {
  return what === 'add' || what === 'clear';
}

/**
 * The cell the keyboard starts on when no cell has been chosen yet: the first line of the person's
 * grid at or after the minute at the upper edge of the week in view. It is never before the first
 * line the week draws and never after its last cell. Every key then acts on a line of the grid.
 */
export function keyStart(inView: number, from: number, to: number, step: Step, dayStart: number): number {
  const first = snapUp(from, step, dayStart);
  const last = Math.max(first, snapDown(to - 1, step, dayStart));
  return Math.min(Math.max(first, snapUp(inView, step, dayStart)), last);
}
