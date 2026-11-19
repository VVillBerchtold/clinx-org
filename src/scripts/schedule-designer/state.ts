// What the page remembers while it is open: the schedule, the list of earlier schedules for undo,
// and what the person is looking at. All of it lives in this tab's memory and is gone when the tab
// closes. Nothing here is written to the browser. The one thing the page can keep, a pointer to
// the person's file when they ask for it, is in remember.ts.
import { activityOf, blocksOf, departmentOf, personOf, roomOf, siteOf, visitTypeOf } from './engine/index';
import { sameSchedule } from './same';
import type { Day, Room, Schedule, What, Where } from './engine/index';
import type { Mode } from './intent';
import { withChoices } from './team-say';
import { openRoom } from './add-say';

export type View = 'person' | 'day' | 'rooms' | 'overview';
/** The kind of time Add puts on the week. 'none' only when the schedule has no kind of time at all. */
export type Tool = What | { kind: 'none' };
export type { Mode } from './intent';
export type SetupTab = 'clinic' | 'places' | 'kinds' | 'people';
export type StepNumber = 1 | 2 | 3 | 4;

/** A handle to a file on the person's computer, where the browser offers one. */
export interface FileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
}

/** Said beside the week when time was painted into a room somebody else is in. */
export interface RoomNotice {
  personId: string;
  day: Day;
  from: number;
  to: number;
  siteId: string;
  roomId: string;
  /** The rooms at that site with nobody in them for the whole stretch. */
  free: Room[];
}

/** A place in the week to show and flash, set by "Show it" on a finding. */
export interface Flash {
  personId?: string;
  day?: Day;
  start?: number;
  roomId?: string;
}

export const app = {
  schedule: null as Schedule | null,
  past: [] as Schedule[],
  future: [] as Schedule[],
  /** The schedule as it was last saved or opened. The work is unsaved when `schedule` is a different one. */
  saved: null as Schedule | null,
  /** The name of the file this schedule was opened from or saved to. Empty for a new one. */
  fileName: '',
  handle: null as FileHandle | null,
  /** The name of the workbook a new schedule took its set-up from, while the line that says so is showing. */
  setupFrom: '',
  step: 1 as StepNumber,
  done: new Set<number>(),
  view: 'person' as View,
  /** What a click or a drag on the week does. A way of working: never saved, and 'look' whenever a schedule is opened. */
  mode: 'look' as Mode,
  /** Counts the schedules put on the page, so the week knows to show its first rows again. */
  opened: 0,
  personId: '',
  day: 0 as Day,
  siteId: '',
  tool: { kind: 'none' } as Tool,
  where: { kind: 'none' } as Where,
  /** The place set aside while an unpaid kind of time, such as lunch, is chosen. */
  parked: null as Where | null,
  setupTab: 'clinic' as SetupTab,
  setupPersonId: '',
  /** The person last changed in Set up during this stay there, so Design can open on their week. */
  setupEdited: '',
  full: false,
  /** How visits are drawn in the week: each one by itself, or touching ones of a kind as one band. A way of looking, never saved. */
  visits: 'each' as 'each' | 'grouped',
  notice: null as RoomNotice | null,
  flash: null as Flash | null,
  /** A line for the bar along the bottom, with an offer to undo. */
  toast: null as { say: string; undo: boolean } | null,
  /** A line under the week in Design saying what just happened. */
  status: '',
};

export type Why = 'schedule' | 'look' | 'step';
type Listener = (why: Why, focus: boolean) => void;
const listeners: Listener[] = [];

/** Asks to be told when something changed, so the page can be drawn again. */
export function subscribe(listener: Listener): void {
  listeners.push(listener);
}

/** Tells the page something changed. */
export function emit(why: Why = 'look', focus = false): void {
  for (const listener of listeners) listener(why, focus);
}

const UNDO_LIMIT = 300;

/**
 * True when there is work that has not been saved to a file. The schedule is compared with what
 * was last saved or opened, so a change that is taken back, by Undo or by hand, leaves nothing to save.
 */
export function dirty(): boolean {
  return app.schedule !== null && !sameSchedule(app.schedule, app.saved);
}

/**
 * The first kind of time to add for a person. For a provider it is their department's first visit
 * type. For support staff it is time with the first provider they work with, and another kind of
 * time when they work with nobody yet.
 */
export function firstTool(s: Schedule, personId: string): Tool {
  const person = personOf(s, personId);
  const type = person ? departmentOf(s, person.departmentId)?.visitTypes[0] : undefined;
  const activity = s.activities[0];
  if (person?.kind === 'support') {
    const provider = withChoices(s, personId)[0];
    if (provider) return { kind: 'with', personId: provider.personId };
    if (activity) return { kind: 'activity', activityId: activity.id };
  }
  if (type) return { kind: 'visit', visitTypeId: type.id };
  return activity ? { kind: 'activity', activityId: activity.id } : { kind: 'none' };
}

/**
 * The place a person's appointments are in most often, to start the Where choice from. A provider
 * with no appointments yet starts in the first room of the site that nobody else uses this week,
 * so a first week is not built with no room. Support staff start at the site with no room, since
 * their time with a provider goes where the provider is.
 */
export function usualWhere(s: Schedule, personId: string): Where {
  const counts = new Map<string, { where: Where; minutes: number }>();
  for (const block of blocksOf(s, personId)) {
    if (block.what.kind !== 'visit' || block.where.kind === 'none') continue;
    const key = block.where.kind === 'remote' ? 'remote' : `${block.where.siteId} ${block.where.roomId ?? ''}`;
    const row = counts.get(key) ?? { where: block.where, minutes: 0 };
    row.minutes += block.minutes;
    counts.set(key, row);
  }
  let chosen: { where: Where; minutes: number } | undefined;
  for (const row of counts.values()) if (!chosen || row.minutes > chosen.minutes) chosen = row;
  if (chosen) return chosen.where;
  const site = siteOf(s, app.siteId) ?? s.sites[0];
  if (!site) return { kind: 'none' };
  const provider = personOf(s, personId)?.kind === 'provider';
  return { kind: 'site', siteId: site.id, roomId: provider ? openRoom(s, site.id, personId) : null };
}

/**
 * The kind of time to paint for a person when the chosen one belongs to another department:
 * their own type with the same code or name, or their first one.
 */
export function toolFor(s: Schedule, personId: string, tool: Tool): Tool {
  // Time with a provider belongs to a support person who can have it with that provider. For anybody else it becomes their first kind of time.
  if (tool.kind === 'with') return withChoices(s, personId).some((choice) => choice.personId === tool.personId) ? tool : firstTool(s, personId);
  if (tool.kind !== 'visit') return tool;
  const person = personOf(s, personId);
  const own = person ? (departmentOf(s, person.departmentId)?.visitTypes ?? []) : [];
  if (own.some((type) => type.id === tool.visitTypeId)) return tool;
  const chosen = visitTypeOf(s, tool.visitTypeId);
  const match = own.find((type) => chosen && ((type.code !== '' && type.code === chosen.code) || type.name === chosen.name)) ?? own[0];
  return match ? { kind: 'visit', visitTypeId: match.id } : tool;
}

/** True when two tools add the same kind of time: the same visit type, the same activity, or time with the same provider. */
export function sameTool(a: Tool, b: Tool): boolean {
  if (a.kind === 'visit' && b.kind === 'visit') return a.visitTypeId === b.visitTypeId;
  if (a.kind === 'activity' && b.kind === 'activity') return a.activityId === b.activityId;
  return a.kind === 'with' && b.kind === 'with' && a.personId === b.personId;
}

/** Makes sure everything chosen on the page still exists in the schedule. */
export function settle(): void {
  const s = app.schedule;
  if (!s) return;
  if (!personOf(s, app.personId)) {
    app.personId = s.people[0]?.id ?? '';
    app.tool = firstTool(s, app.personId);
    app.where = usualWhere(s, app.personId);
  }
  if (!personOf(s, app.setupPersonId)) app.setupPersonId = s.people[0]?.id ?? '';
  if (!s.days.includes(app.day)) app.day = s.days[0] ?? 0;
  if (!siteOf(s, app.siteId)) app.siteId = s.sites[0]?.id ?? '';
  if (app.tool.kind === 'visit' && !visitTypeOf(s, app.tool.visitTypeId)) app.tool = firstTool(s, app.personId);
  if (app.tool.kind === 'activity' && !activityOf(s, app.tool.activityId)) app.tool = firstTool(s, app.personId);
  // The provider left, changed kind, or came off the list: time with them can no longer be added.
  if (app.tool.kind === 'with') app.tool = toolFor(s, app.personId, app.tool);
  if (app.where.kind === 'site') {
    if (!siteOf(s, app.where.siteId)) app.where = { kind: 'none' };
    else if (app.where.roomId !== null && !roomOf(s, app.where.roomId)) app.where = { kind: 'site', siteId: app.where.siteId, roomId: null };
  }
  if (app.parked?.kind === 'site' && (!siteOf(s, app.parked.siteId) || (app.parked.roomId !== null && !roomOf(s, app.parked.roomId)))) app.parked = null;
  if (app.notice && (!personOf(s, app.notice.personId) || !roomOf(s, app.notice.roomId))) app.notice = null;
}

/** Puts a schedule on the page: the sample, a new one, or one read from a file. */
export function load(schedule: Schedule, from: { fileName?: string; handle?: FileHandle | null } = {}): void {
  app.schedule = schedule;
  app.saved = schedule;
  app.past = [];
  app.future = [];
  app.fileName = from.fileName ?? '';
  app.handle = from.handle ?? null;
  app.setupFrom = '';
  app.view = 'person';
  app.mode = 'look';
  app.opened++;
  app.personId = schedule.people[0]?.id ?? '';
  app.setupPersonId = app.personId;
  app.setupEdited = '';
  app.day = schedule.days[0] ?? 0;
  app.siteId = schedule.sites[0]?.id ?? '';
  app.tool = firstTool(schedule, app.personId);
  app.where = usualWhere(schedule, app.personId);
  app.parked = null;
  app.setupTab = 'clinic';
  app.notice = null;
  app.flash = null;
  app.toast = null;
  app.status = '';
  settle();
}

/**
 * Takes a changed schedule. The one before it goes on the undo list. Gives back false when
 * nothing changed, which is how every edit in the engine says "there was nothing to do".
 */
export function commit(next: Schedule, toast: { say: string; undo: boolean } | null = null): boolean {
  const before = app.schedule;
  if (!before || next === before) return false;
  if (app.step === 2) {
    // One person is a different object after the change: that is the person who was edited or added.
    const changed = next.people.filter((person) => !before.people.includes(person));
    if (changed.length === 1 && changed[0]) app.setupEdited = changed[0].id;
  }
  app.past.push(before);
  if (app.past.length > UNDO_LIMIT) app.past.shift();
  app.future = [];
  app.schedule = next;
  app.toast = toast;
  settle();
  emit('schedule');
  return true;
}

export function canUndo(): boolean {
  return app.past.length > 0;
}

export function canRedo(): boolean {
  return app.future.length > 0;
}

/** Goes back one change. Gives back false when there is nothing to undo. */
export function undo(): boolean {
  const before = app.past.pop();
  if (!before || !app.schedule) return false;
  app.future.push(app.schedule);
  app.schedule = before;
  app.toast = null;
  app.notice = null;
  app.status = 'Undone.';
  settle();
  emit('schedule');
  return true;
}

/** Puts back the change that was undone. */
export function redo(): boolean {
  const next = app.future.pop();
  if (!next || !app.schedule) return false;
  app.past.push(app.schedule);
  app.schedule = next;
  app.toast = null;
  app.notice = null;
  app.status = 'Done again.';
  settle();
  emit('schedule');
  return true;
}

/** Opens one of the four steps. */
export function go(step: StepNumber, focus = true): void {
  if (step > 1 && !app.schedule) return;
  if (app.step !== step && app.step >= 2) app.done.add(app.step);
  // Coming to Design from another step, the week only looks. Nothing is armed until the person chooses Add or Erase.
  if (step === 3 && app.step !== 3) app.mode = 'look';
  if (step !== 2) app.setupEdited = '';
  app.step = step;
  app.toast = null;
  if (step !== 3 && app.full) app.full = false;
  emit('step', focus);
}

/**
 * Going on from Set up to Design: when a person was changed in Set up, Design opens on that
 * person's week. Call it before the step changes.
 */
export function showEdited(): void {
  const s = app.schedule;
  if (app.step !== 2 || !s || !personOf(s, app.setupEdited)) return;
  showPerson(app.setupEdited);
  app.view = 'person';
}

/**
 * Shows one person in Design, with the kind of time and the place that fit them. Coming to a
 * support person with an appointment chosen, the kind of time becomes time with the first provider
 * they work with. `keep` leaves an appointment chosen, for a drag across columns in the Day view.
 */
export function showPerson(personId: string, keep = false): void {
  const s = app.schedule;
  const person = s ? personOf(s, personId) : undefined;
  if (!s || !person) return;
  if (app.personId !== personId) {
    app.personId = personId;
    app.tool = !keep && person.kind === 'support' && app.tool.kind === 'visit' ? firstTool(s, personId) : toolFor(s, personId, app.tool);
    if (app.where.kind !== 'none' || !app.parked) app.where = usualWhere(s, personId);
    else app.parked = usualWhere(s, personId);
    app.notice = null;
    // The line under the week spoke of the person who was on screen, and its Undo would act there.
    app.status = '';
  }
}

/** Chooses what Add puts on the week. An unpaid kind of time, such as lunch, is added with no place. */
export function chooseTool(tool: Tool): void {
  const s = app.schedule;
  if (!s) return;
  const unpaid = tool.kind === 'activity' && activityOf(s, tool.activityId)?.paid === false;
  if (unpaid && app.where.kind !== 'none') {
    app.parked = app.where;
    app.where = { kind: 'none' };
  } else if (!unpaid && tool.kind !== 'none' && app.parked && app.where.kind === 'none') {
    app.where = app.parked;
    app.parked = null;
  }
  app.tool = tool;
}

/** Switches between looking, adding and erasing. Add always has a kind of time chosen when the schedule has one. */
export function setMode(mode: Mode): void {
  const s = app.schedule;
  app.mode = mode;
  app.notice = null;
  app.status = '';
  if (mode === 'add' && s && app.tool.kind === 'none') app.tool = firstTool(s, app.personId);
}

/** Chooses where added time is spent. */
export function chooseWhere(where: Where): void {
  app.where = where;
  app.parked = null;
  if (where.kind === 'site') app.siteId = where.siteId;
}
