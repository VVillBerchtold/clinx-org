// The remembered file as the page shows it: what is known about it while the page is open, the
// switch that turns remembering on and off, and the two things the Start step can do with it.
// The record itself is kept by remember.ts, the only file that touches the browser's database.
import { announce, el } from './dom';
import { app, emit, subscribe } from './state';
import type { FileHandle } from './state';
import { browserStore, canRemember, forget, recall, remember, reopen, sameFile } from './remember';
import type { Kept, Reopened, Store } from './remember';

export const memory = {
  /** True where the browser can remember a file. Elsewhere nothing about it is shown. */
  can: false,
  /** The remembered file, or null. */
  kept: null as Kept | null,
  /** True when the file that is open is the remembered one. */
  current: false,
  /** One sentence when the browser would not keep the file. */
  problem: '',
};

let store: Store | null = null;
/** The open file that `current` was last worked out for. */
let seen: FileHandle | null = null;

/** Works out again whether the open file is the remembered one, when another file has been opened. */
function track(): void {
  if (app.handle === seen) return;
  const handle = app.handle;
  seen = handle;
  memory.problem = '';
  memory.current = false;
  const kept = memory.kept;
  if (!handle || !kept) return;
  if (kept.handle === handle) {
    memory.current = true;
    return;
  }
  void sameFile(kept.handle, handle).then((same) => {
    if (!same || seen !== handle || memory.kept !== kept) return;
    memory.current = true;
    emit('look');
  });
}

/** Reads what was remembered on an earlier visit. Does nothing where the browser cannot remember a file. */
export function initKept(): void {
  memory.can = canRemember();
  if (!memory.can) return;
  store = browserStore();
  subscribe(track);
  void recall(store).then((kept) => {
    if (!kept) return;
    memory.kept = kept;
    seen = null;
    emit('look');
  });
}

/** The day a file was last used, in words: "today" or "on 14 November 2026". */
export function whenSay(when: number, now: number): string {
  const day = (time: number): string => new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return day(when) === day(now) ? 'today' : `on ${day(when)}`;
}

async function turn(on: boolean): Promise<void> {
  const handle = app.handle;
  if (!store || !handle) return;
  memory.problem = '';
  if (on) {
    const kept = await remember(store, handle, Date.now());
    memory.kept = kept ?? memory.kept;
    memory.current = kept !== null;
    if (kept) announce(`This computer will remember ${kept.name}.`);
    else {
      memory.problem = 'Your browser did not let this page remember the file. Next time, choose it with Open a saved schedule.';
      announce(memory.problem);
    }
  } else {
    await forget(store);
    memory.kept = null;
    memory.current = false;
    announce('The file is forgotten. Nothing is kept on this computer.');
  }
  emit('look');
}

/**
 * The switch "Remember this file on this computer", with the line under it. It is given only
 * where the browser can remember a file and a file is open that the page can write back into.
 */
export function rememberSwitch(key: string): HTMLElement | null {
  if (!memory.can || !app.handle) return null;
  const hint = `sd-remember-hint-${key}`;
  const box = el('input', { type: 'checkbox', role: 'switch', 'data-k': `remember:${key}`, 'aria-describedby': hint });
  box.checked = memory.current;
  box.addEventListener('change', () => void turn(box.checked));
  return el(
    'div',
    { class: 'sd-remember' },
    el('label', { class: 'sd-switch sd-switch-wrap' }, box, el('i', { 'aria-hidden': 'true' }), el('span', {}, 'Remember this file on this computer')),
    el('span', { class: 'sd-field-hint', id: hint }, 'The page keeps the file’s name, where it is and the date you last used it here.'),
    memory.problem ? el('p', { class: 'sd-remember-problem', role: 'alert' }, memory.problem) : null,
  );
}

/**
 * The schedule is moving into another file ("Save somewhere else", or the first save into a
 * chosen place). Call it before `app.handle` changes. When the file it is leaving is the
 * remembered one, the record moves with it, so the switch and the next visit both name the file
 * the schedule is now in. Gives back true when the record moved.
 */
export async function followFile(to: FileHandle): Promise<boolean> {
  if (!store || !memory.current) return false;
  const kept = await remember(store, to, Date.now());
  // Whatever happened, what is known now is about the new file.
  seen = to;
  memory.problem = '';
  if (kept) {
    memory.kept = kept;
    return true;
  }
  // The earlier file is still the remembered one. The switch for the new file shows off, and says why.
  memory.current = false;
  memory.problem = 'Your browser did not let this page remember the new file. The earlier file is still the remembered one.';
  return false;
}

/** Opens the remembered file again. Call it straight from a click. A file that cannot be opened is forgotten. */
export async function reopenKept(): Promise<Reopened | null> {
  const kept = memory.kept;
  if (!store || !kept) return null;
  const now = Date.now();
  const again = await reopen(store, kept, now);
  if ('problem' in again) {
    memory.kept = null;
    memory.current = false;
  } else memory.kept = { handle: kept.handle, name: kept.name, when: now };
  return again;
}

/** Forgets the remembered file: the record and the database go. */
export async function forgetKept(): Promise<void> {
  if (store) await forget(store);
  memory.kept = null;
  memory.current = false;
  memory.problem = '';
  emit('look');
}
