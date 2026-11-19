// The remembered file: the one thing this page may keep in the browser, and only when the person
// ticks "Remember this file on this computer".
//
// In plain words: the saved workbook is the memory. What is kept here is a pointer to that file,
// so the next visit can open it with one click. The record has three fields and no others:
//   handle  the browser's own pointer to the file on the person's computer
//   name    the file's name, to show on the Start step
//   when    the time the file was last used here, as a number
// The schedule itself, the names of people and every setting stay in the workbook and are never
// written here. Forgetting deletes the record and the whole database.
//
// This is the only file on the page that may name the browser's database. A test reads the page's
// source and fails if any other file does, or if this one writes anything but the three fields.
import type { FileHandle } from './state';

/** A file handle with the questions a browser lets a page ask about it. Older browsers have none of them. */
export interface KeptHandle extends FileHandle {
  queryPermission?(options: { mode: 'read' | 'readwrite' }): Promise<string>;
  requestPermission?(options: { mode: 'read' | 'readwrite' }): Promise<string>;
  isSameEntry?(other: unknown): Promise<boolean>;
}

/** The one record. */
export interface Kept {
  handle: KeptHandle;
  name: string;
  when: number;
}

/**
 * Where the record lives. The page uses the browser's database (`browserStore`). The tests use a
 * stand-in, so every path can be tried without a browser.
 */
export interface Store {
  /** The record as it was kept, or undefined when there is none. Must not create anything. */
  read(): Promise<unknown>;
  write(record: Kept): Promise<void>;
  /** Deletes the record and the database it was in. */
  clear(): Promise<void>;
}

/** What opening the remembered file again came to. */
export type Reopened = { file: File; handle: KeptHandle } | { problem: 'refused' | 'missing' };

/** True where a page can open and save files in place and has a database: the two things remembering needs. */
export function canRemember(scope: object = window): boolean {
  const has = (name: string): boolean => typeof (scope as Record<string, unknown>)[name] === 'function';
  return has('showOpenFilePicker') && has('showSaveFilePicker') && 'indexedDB' in scope && (scope as Record<string, unknown>)['indexedDB'] != null;
}

/** Checks a value read from the store is a record this page wrote. */
function asKept(value: unknown): Kept | null {
  if (typeof value !== 'object' || value === null) return null;
  const { handle, name, when } = value as Record<string, unknown>;
  if (typeof name !== 'string' || typeof when !== 'number' || !Number.isFinite(when)) return null;
  if (typeof handle !== 'object' || handle === null || typeof (handle as Record<string, unknown>)['getFile'] !== 'function') return null;
  return { handle: handle as KeptHandle, name, when };
}

/**
 * Keeps a pointer to this file. Gives back the record, or null when the browser would not keep it.
 * Only the three fields are written, whatever else the handle carries.
 */
export async function remember(store: Store, handle: KeptHandle, now: number): Promise<Kept | null> {
  const record: Kept = { handle, name: String(handle.name), when: now };
  try {
    await store.write(record);
    return record;
  } catch {
    return null;
  }
}

/** The remembered file, or null. A record that is not in the form this page writes is forgotten. */
export async function recall(store: Store): Promise<Kept | null> {
  let value: unknown;
  try {
    value = await store.read();
  } catch {
    return null;
  }
  if (value === undefined) return null;
  const kept = asKept(value);
  if (!kept) await forget(store);
  return kept;
}

/** Forgets the file: the record and the database go. Never throws. */
export async function forget(store: Store): Promise<void> {
  try {
    await store.clear();
  } catch {
    // There is nothing more the page can do. The next visit tries again.
  }
}

/** Asks the browser, and through it the person, whether the page may use the file. */
async function allowed(handle: KeptHandle): Promise<boolean> {
  if (typeof handle.queryPermission !== 'function') return true;
  // Opening and saving back are asked for together, so the person is asked once.
  if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  if (typeof handle.requestPermission === 'function' && (await handle.requestPermission({ mode: 'readwrite' })) === 'granted') return true;
  // Reading alone is enough to open it. Saving back asks again when the time comes.
  return (await handle.queryPermission({ mode: 'read' })) === 'granted';
}

/**
 * Opens the remembered file again. Call it straight from a click, because a browser only asks the
 * person for permission while it is handling one. A file that was refused, moved or deleted is
 * forgotten, and the answer says which it was.
 */
export async function reopen(store: Store, kept: Kept, now: number): Promise<Reopened> {
  let problem: 'refused' | 'missing' = 'refused';
  try {
    if (await allowed(kept.handle)) {
      const file = await kept.handle.getFile();
      // The time it was last used moves on. If that cannot be written the file is still open.
      await remember(store, kept.handle, now);
      return { file, handle: kept.handle };
    }
  } catch (error) {
    const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
    problem = name === 'NotAllowedError' || name === 'SecurityError' ? 'refused' : 'missing';
  }
  await forget(store);
  return { problem };
}

/** True when two handles point at one file. With no way to ask the browser, only the very same handle counts. */
export async function sameFile(a: KeptHandle, b: KeptHandle): Promise<boolean> {
  if (a === b) return true;
  if (typeof a.isSameEntry !== 'function') return false;
  try {
    return await a.isSameEntry(b);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// The browser's database: one database, one box in it, one record in the box.

const DATABASE = 'clinx-schedule-designer';
const BOX = 'file';
const KEY = 'remembered';

/** Waits for one request to the database. */
function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('The database did not answer.'));
  });
}

/**
 * Opens the database. With `create` false it never makes one: a database that is not there yet is
 * left that way and the answer is null, so a visit where nothing is remembered keeps nothing.
 */
function open(create: boolean): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    let made = false;
    request.onupgradeneeded = () => {
      if (create) {
        request.result.createObjectStore(BOX);
        return;
      }
      // Stopping here undoes the making of the database.
      made = true;
      request.transaction?.abort();
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = (event) => {
      if (made) {
        event.preventDefault();
        resolve(null);
      } else reject(request.error ?? new Error('The database did not open.'));
    };
    request.onblocked = () => reject(new Error('The database is busy.'));
  });
}

/** True when the database is already there. Asked without opening it, where the browser can say. */
async function exists(): Promise<boolean> {
  if (typeof indexedDB.databases !== 'function') return true;
  return (await indexedDB.databases()).some((found) => found.name === DATABASE);
}

/** The store the page uses: the browser's own database on this computer. */
export function browserStore(): Store {
  return {
    async read(): Promise<unknown> {
      if (!(await exists())) return undefined;
      const db = await open(false);
      if (!db) return undefined;
      try {
        if (!db.objectStoreNames.contains(BOX)) return undefined;
        return await done(db.transaction(BOX, 'readonly').objectStore(BOX).get(KEY));
      } finally {
        db.close();
      }
    },
    async write(record: Kept): Promise<void> {
      const db = await open(true);
      if (!db) throw new Error('The database did not open.');
      try {
        const writing = db.transaction(BOX, 'readwrite');
        const written = new Promise<void>((resolve, reject) => {
          writing.oncomplete = () => resolve();
          writing.onabort = () => reject(writing.error ?? new Error('The record was not written.'));
        });
        await done(writing.objectStore(BOX).put({ handle: record.handle, name: record.name, when: record.when }, KEY));
        await written;
      } finally {
        db.close();
      }
    },
    clear(): Promise<void> {
      return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(DATABASE);
        request.onsuccess = () => resolve();
        // Another tab still has it open. The browser deletes it as soon as that tab lets go.
        request.onblocked = () => resolve();
        request.onerror = () => reject(request.error ?? new Error('The database could not be deleted.'));
      });
    },
  };
}
