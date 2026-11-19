import { describe, expect, it } from 'vitest';
import { changes, does, keyStart } from '../../src/scripts/schedule-designer/intent';
import { onGrid } from '../../src/scripts/schedule-designer/engine/time';
import type { Act, Does, Mode, Under } from '../../src/scripts/schedule-designer/intent';

const UNDER: readonly Under[] = ['block', 'empty'];

/** Every action the week knows, over a block and over empty time. */
function everyAct(): Act[] {
  const acts: Act[] = [{ by: 'swipe' }];
  for (const on of UNDER) {
    acts.push({ by: 'click', on }, { by: 'drag', on }, { by: 'hold', on }, { by: 'enter', on });
    acts.push({ by: 'arrow', shift: false, on }, { by: 'arrow', shift: true, on });
    acts.push({ by: 'delete', on });
  }
  return acts;
}

const name = (act: Act): string => JSON.stringify(act);

describe('what an action on the week does', () => {
  it('knows fifteen actions', () => {
    expect(everyAct()).toHaveLength(15);
  });

  it('changes nothing in Look, whatever the pointer or the keys do, with no exception', () => {
    for (const act of everyAct()) expect(changes(does('look', act)), name(act)).toBe(false);
    expect(everyAct().filter((act) => changes(does('look', act)))).toEqual([]);
  });

  it('does nothing in Look for Backspace or Delete, on a block and on empty time', () => {
    expect(does('look', { by: 'delete', on: 'block' })).toBe('nothing');
    expect(does('look', { by: 'delete', on: 'empty' })).toBe('nothing');
  });

  it('shows in Look: a click or Enter on a block opens its details', () => {
    expect(does('look', { by: 'click', on: 'block' })).toBe('details');
    expect(does('look', { by: 'enter', on: 'block' })).toBe('details');
  });

  it('moves the cursor in Look on a click on empty time, and says so on Enter there', () => {
    expect(does('look', { by: 'click', on: 'empty' })).toBe('cursor');
    expect(does('look', { by: 'enter', on: 'empty' })).toBe('say-empty');
  });

  it('does nothing in Look for a drag or a press and hold, over blocks or over empty time', () => {
    for (const on of UNDER) {
      expect(does('look', { by: 'drag', on })).toBe('nothing');
      expect(does('look', { by: 'hold', on })).toBe('nothing');
    }
  });

  it('paints nothing in Look with Shift and an arrow: the cursor only moves', () => {
    for (const on of UNDER) expect(does('look', { by: 'arrow', shift: true, on })).toBe('cursor');
  });

  it('adds in Add with a click, a drag, a press and hold, Enter, and Shift with an arrow', () => {
    for (const on of UNDER) {
      const adding: Act[] = [{ by: 'click', on }, { by: 'drag', on }, { by: 'hold', on }, { by: 'enter', on }, { by: 'arrow', shift: true, on }];
      for (const act of adding) expect(does('add', act), name(act)).toBe('add');
    }
  });

  it('clears in Erase with the same gestures', () => {
    for (const on of UNDER) {
      const clearing: Act[] = [{ by: 'click', on }, { by: 'drag', on }, { by: 'hold', on }, { by: 'enter', on }, { by: 'arrow', shift: true, on }, { by: 'delete', on }];
      for (const act of clearing) expect(does('erase', act), name(act)).toBe('clear');
    }
  });

  it('clears where the cursor is with Backspace in Add, as it always has', () => {
    expect(does('add', { by: 'delete', on: 'block' })).toBe('clear');
  });

  it('lets a swipe scroll and a plain arrow move in every mode', () => {
    for (const mode of ['look', 'add', 'erase'] as Mode[]) {
      expect(does(mode, { by: 'swipe' })).toBe('scroll');
      for (const on of UNDER) expect(does(mode, { by: 'arrow', shift: false, on })).toBe('cursor');
    }
  });

  it('counts only adding and clearing as a change', () => {
    const all: Does[] = ['nothing', 'scroll', 'cursor', 'details', 'say-empty', 'add', 'clear'];
    expect(all.filter(changes)).toEqual(['add', 'clear']);
  });
});

describe('Schedule Designer: the cell the keyboard starts on', () => {
  // The week draws 6:00 am to 9:00 pm, and the day starts at 8:00 am.
  const FROM = 360;
  const TO = 1260;
  const DAY = 480;

  it('is the first line of the grid at or after the minute in view', () => {
    // The page once took 6:52 am from the scroll position and added a visit there.
    expect(keyStart(412, FROM, TO, 20, DAY)).toBe(420);
    expect(keyStart(414, FROM, TO, 15, DAY)).toBe(420);
    // After one turn of the wheel: 8:41 am becomes 9:00 am on a 20 min grid and 8:45 am on a 15 min grid.
    expect(keyStart(521, FROM, TO, 20, DAY)).toBe(540);
    expect(keyStart(521, FROM, TO, 15, DAY)).toBe(525);
    expect(keyStart(540, FROM, TO, 20, DAY)).toBe(540);
    expect(keyStart(540.4, FROM, TO, 20, DAY)).toBe(560);
  });

  it('is on a line of the grid for every minute the week can be scrolled to', () => {
    for (const step of [15, 20] as const) {
      for (const dayStart of [420, 450, 480, 490]) {
        for (let minute = FROM; minute <= TO; minute += 0.5) expect(onGrid(keyStart(minute, FROM, TO, step, dayStart), step, dayStart), `${step} ${dayStart} ${minute}`).toBe(true);
      }
    }
  });

  it('stays inside the hours the week draws', () => {
    expect(keyStart(0, FROM, TO, 20, DAY)).toBe(360);
    expect(keyStart(359.5, FROM, TO, 15, DAY)).toBe(360);
    // The last cell of the day, never the line after it.
    expect(keyStart(1259, FROM, TO, 20, DAY)).toBe(1240);
    expect(keyStart(5000, FROM, TO, 15, DAY)).toBe(1245);
    // A grid that does not start on the first hour drawn: the first line inside it.
    expect(keyStart(360, FROM, TO, 20, 490)).toBe(370);
  });
});
