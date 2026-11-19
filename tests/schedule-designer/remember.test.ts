import { describe, expect, it } from 'vitest';
import { canRemember, forget, recall, remember, reopen, sameFile } from '../../src/scripts/schedule-designer/remember';
import type { Kept, KeptHandle, Store } from '../../src/scripts/schedule-designer/remember';

// The page may keep one thing in the browser, and only when the person ticks the box: where their
// file is, its name, and when it was last used. These tests run the logic against a stand-in for
// the browser's database, so every path is tried without a browser: remember, read back, forget,
// a refused permission and a file that has gone.

/** A stand-in for the browser's database. It notes everything it is handed. */
function fakeStore(start: unknown = undefined): Store & { held: unknown; writes: unknown[]; clears: number; broken: boolean } {
  const store = {
    held: start,
    writes: [] as unknown[],
    clears: 0,
    broken: false,
    async read(): Promise<unknown> {
      if (store.broken) throw new Error('the database is closed to this page');
      return store.held;
    },
    async write(record: Kept): Promise<void> {
      if (store.broken) throw new Error('the database is closed to this page');
      store.writes.push(record);
      store.held = record;
    },
    async clear(): Promise<void> {
      store.clears += 1;
      store.held = undefined;
      if (store.broken) throw new Error('the database is closed to this page');
    },
  };
  return store;
}

interface FakeOptions {
  /** What the browser says when asked whether the page may use the file. */
  permission?: 'granted' | 'prompt' | 'denied';
  /** What the person answers when the browser asks them. */
  answer?: 'granted' | 'denied' | 'prompt';
  /** The file is no longer where it was. */
  gone?: boolean;
  /** The browser has no way to ask about permission. */
  plain?: boolean;
}

/** A stand-in for a file handle. It notes each question the page puts to it. */
function fakeHandle(name: string, options: FakeOptions = {}): KeptHandle & { asked: string[] } {
  let state = options.permission ?? 'granted';
  const asked: string[] = [];
  const handle: KeptHandle & { asked: string[] } = {
    name,
    asked,
    async getFile(): Promise<File> {
      asked.push('getFile');
      if (options.gone) throw new DOMException('A requested file or directory could not be found.', 'NotFoundError');
      if (state !== 'granted' && !options.plain) throw new DOMException('The request is not allowed.', 'NotAllowedError');
      return new File([new Uint8Array([1, 2, 3])], name);
    },
    async createWritable() {
      return { write: async () => {}, close: async () => {} };
    },
  };
  if (!options.plain) {
    handle.queryPermission = async ({ mode }) => {
      asked.push(`query ${mode}`);
      return state;
    };
    handle.requestPermission = async ({ mode }) => {
      asked.push(`request ${mode}`);
      state = options.answer ?? 'granted';
      return state;
    };
  }
  return handle;
}

const MONDAY = Date.UTC(2026, 10, 16, 15, 0);
const TUESDAY = Date.UTC(2026, 10, 17, 15, 0);

describe('Schedule Designer: the remembered file', () => {
  it('remembers a file and reads it back', async () => {
    const store = fakeStore();
    const handle = fakeHandle('spring-template.xlsx');
    expect(await remember(store, handle, MONDAY)).toEqual({ handle, name: 'spring-template.xlsx', when: MONDAY });
    const kept = await recall(store);
    expect(kept?.name).toBe('spring-template.xlsx');
    expect(kept?.when).toBe(MONDAY);
    expect(kept?.handle).toBe(handle);
  });

  it('writes exactly three fields: the handle, the name and the time', async () => {
    const store = fakeStore();
    // A handle that carries more than a handle should: nothing extra may reach the record.
    const handle = Object.assign(fakeHandle('week.xlsx'), { schedule: { people: ['a name'] } });
    await remember(store, handle, MONDAY);
    expect(store.writes.length).toBe(1);
    const record = store.writes[0] as Record<string, unknown>;
    expect(Object.keys(record).sort()).toEqual(['handle', 'name', 'when']);
    expect(typeof record['name']).toBe('string');
    expect(typeof record['when']).toBe('number');
  });

  it('keeps one record: remembering another file replaces the first', async () => {
    const store = fakeStore();
    await remember(store, fakeHandle('one.xlsx'), MONDAY);
    await remember(store, fakeHandle('two.xlsx'), TUESDAY);
    expect((await recall(store))?.name).toBe('two.xlsx');
  });

  it('forgets: the record goes and the database is cleared', async () => {
    const store = fakeStore();
    await remember(store, fakeHandle('week.xlsx'), MONDAY);
    await forget(store);
    expect(store.clears).toBe(1);
    expect(await recall(store)).toBeNull();
  });

  it('has nothing to read back when nothing was remembered', async () => {
    const store = fakeStore();
    expect(await recall(store)).toBeNull();
    expect(store.clears).toBe(0);
    expect(store.writes.length).toBe(0);
  });

  it('says so, and keeps nothing, when the browser will not keep the file', async () => {
    const store = fakeStore();
    store.broken = true;
    expect(await remember(store, fakeHandle('week.xlsx'), MONDAY)).toBeNull();
    expect(await recall(store)).toBeNull();
    // Forgetting never throws, also when the database is closed to the page.
    await expect(forget(store)).resolves.toBeUndefined();
  });

  it('forgets a record that is not in the form this page writes', async () => {
    for (const damaged of [{ name: 'week.xlsx', when: MONDAY }, { handle: fakeHandle('week.xlsx'), name: 7, when: MONDAY }, { handle: fakeHandle('week.xlsx'), name: 'week.xlsx', when: 'yesterday' }, 'text', null, { handle: {}, name: 'week.xlsx', when: MONDAY }]) {
      const store = fakeStore(damaged);
      expect(await recall(store)).toBeNull();
      expect(store.clears).toBe(1);
    }
  });

  it('opens the remembered file again when the browser already allows it', async () => {
    const store = fakeStore();
    const handle = fakeHandle('week.xlsx', { permission: 'granted' });
    const kept = await remember(store, handle, MONDAY);
    if (!kept) throw new Error('not kept');
    const again = await reopen(store, kept, TUESDAY);
    expect('file' in again && again.file.name).toBe('week.xlsx');
    expect('file' in again && again.handle).toBe(handle);
    expect(handle.asked).toEqual(['query readwrite', 'getFile']);
    // The time it was last used moves on, and the record still has three fields.
    expect((await recall(store))?.when).toBe(TUESDAY);
    expect(Object.keys(store.held as object).sort()).toEqual(['handle', 'name', 'when']);
  });

  it('asks the person when the browser wants to ask, and opens the file on a yes', async () => {
    const store = fakeStore();
    const handle = fakeHandle('week.xlsx', { permission: 'prompt', answer: 'granted' });
    const kept = await remember(store, handle, MONDAY);
    if (!kept) throw new Error('not kept');
    const again = await reopen(store, kept, TUESDAY);
    expect('file' in again).toBe(true);
    expect(handle.asked).toEqual(['query readwrite', 'request readwrite', 'getFile']);
  });

  it('a refused permission: says refused, and forgets the file', async () => {
    for (const answer of ['denied', 'prompt'] as const) {
      const store = fakeStore();
      const handle = fakeHandle('week.xlsx', { permission: 'prompt', answer });
      const kept = await remember(store, handle, MONDAY);
      if (!kept) throw new Error('not kept');
      const again = await reopen(store, kept, TUESDAY);
      expect(again).toEqual({ problem: 'refused' });
      expect(handle.asked).not.toContain('getFile');
      expect(await recall(store)).toBeNull();
      expect(store.clears).toBe(1);
    }
  });

  it('a permission to read alone is enough to open the file', async () => {
    const store = fakeStore();
    const handle = fakeHandle('week.xlsx');
    // The person lets the page read the file and not change it.
    handle.queryPermission = async ({ mode }) => (mode === 'read' ? 'granted' : 'prompt');
    handle.requestPermission = async () => 'denied';
    const kept = await remember(store, handle, MONDAY);
    if (!kept) throw new Error('not kept');
    const again = await reopen(store, kept, TUESDAY);
    expect('file' in again).toBe(true);
  });

  it('a file that has moved or been deleted: says missing, and forgets the file', async () => {
    const store = fakeStore();
    const handle = fakeHandle('week.xlsx', { gone: true });
    const kept = await remember(store, handle, MONDAY);
    if (!kept) throw new Error('not kept');
    const again = await reopen(store, kept, TUESDAY);
    expect(again).toEqual({ problem: 'missing' });
    expect(await recall(store)).toBeNull();
    expect(store.clears).toBe(1);
  });

  it('a file the browser will not hand over after saying yes: says refused, and forgets the file', async () => {
    const store = fakeStore();
    const handle = fakeHandle('week.xlsx');
    handle.getFile = async () => {
      throw new DOMException('The request is not allowed.', 'NotAllowedError');
    };
    const kept = await remember(store, handle, MONDAY);
    if (!kept) throw new Error('not kept');
    expect(await reopen(store, kept, TUESDAY)).toEqual({ problem: 'refused' });
    expect(await recall(store)).toBeNull();
  });

  it('a browser with no way to ask about permission: the file is simply read', async () => {
    const store = fakeStore();
    const handle = fakeHandle('week.xlsx', { plain: true });
    const kept = await remember(store, handle, MONDAY);
    if (!kept) throw new Error('not kept');
    const again = await reopen(store, kept, TUESDAY);
    expect('file' in again).toBe(true);
    expect(handle.asked).toEqual(['getFile']);
  });

  it('opening still works when the new time cannot be written', async () => {
    const store = fakeStore();
    const handle = fakeHandle('week.xlsx');
    const kept = await remember(store, handle, MONDAY);
    if (!kept) throw new Error('not kept');
    store.broken = true;
    const again = await reopen(store, kept, TUESDAY);
    expect('file' in again).toBe(true);
  });

  it('tells two handles to one file from two files', async () => {
    const one = fakeHandle('week.xlsx');
    const two = fakeHandle('week.xlsx');
    expect(await sameFile(one, one)).toBe(true);
    // With no way to ask the browser, two different handles count as two files.
    expect(await sameFile(one, two)).toBe(false);
    one.isSameEntry = async (other) => other === two;
    expect(await sameFile(one, two)).toBe(true);
    one.isSameEntry = async () => {
      throw new Error('no answer');
    };
    expect(await sameFile(one, two)).toBe(false);
  });

  it('is offered only where the file windows and the database both exist', () => {
    const open = (): void => {};
    expect(canRemember({ showOpenFilePicker: open, showSaveFilePicker: open, indexedDB: {} })).toBe(true);
    expect(canRemember({ showOpenFilePicker: open, showSaveFilePicker: open })).toBe(false);
    expect(canRemember({ showOpenFilePicker: open, indexedDB: {} })).toBe(false);
    expect(canRemember({ showSaveFilePicker: open, indexedDB: {} })).toBe(false);
    expect(canRemember({ indexedDB: {} })).toBe(false);
    expect(canRemember({})).toBe(false);
  });
});
