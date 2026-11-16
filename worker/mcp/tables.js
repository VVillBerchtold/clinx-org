// Where the tables come from.
//
// In plain words: the server holds no data of its own. It reads the same open files anyone can
// download from clinx.org/data (state laws, bills, federal notices, calendar, the filed reports
// and the list of reporting states), keeps them in memory for an hour, and answers questions
// from that copy. A host can hand it another way to read a file (`reader`): src/disk.js reads
// them from a folder, which is how the tests run without the network, and a web host can read
// them from its own files.
//
// The first four files are needed by every tool. The last two (the filed reports and the list of
// states with a reporting law) are read on their own: if either cannot be read, the other tools
// go on answering and the tools that need it say so plainly.
//
// The filed reports are too big to read as one file (24 MB). The site publishes a small index of
// them (340b-filings-index.json) and one small file for each report (filings/<filing id>.json).
// The server reads the index once an hour and a report's file only when that report is asked for,
// keeping a few recent ones for an hour. The whole file (340b-state-filings.json) stays on the
// site as a download, and is read, and cut with the same function (src/split.js), only when the
// index cannot be read.
//
// This file uses nothing that only one kind of computer has, so it runs the same under Node and
// on an edge host.

import { readReport, split } from './split.js';

export const DATA_URL = 'https://clinx.org/data/';
export const FILES = {
  laws: '340b-state-laws.json',
  bills: '340b-bills.json',
  notices: '340b-notices.json',
  events: '340b-events.json',
  filings: '340b-state-filings.json',
  filingsIndex: '340b-filings-index.json',
  reporting: '340b-reporting-states.json',
};
/** The name of the file that holds one report's lines, from its filing id. The site writes the files under these names. */
export const reportFile = (filingId) => `filings/${String(filingId).toLowerCase()}.json`;
// How many reports are kept in memory after they are read. A report is read again after an hour.
const KEEP_REPORTS = 8;
const KEEP_MS = 60 * 60 * 1000;
// A file that could not be read at all is tried again after this long, not on every question.
const RETRY_MS = 60 * 1000;

/**
 * Make a loader. `source` is a web address ending in a slash and `fetcher` the fetch to use; or
 * give `reader`, a function that takes a file's name and resolves to what the file holds.
 */
export function makeTables({ source = DATA_URL, fetcher, reader, now = () => Date.now() } = {}) {
  async function read(name) {
    if (reader) return reader(name);
    const answer = await (fetcher ?? fetch)(new URL(name, source), { headers: { accept: 'application/json' } });
    if (!answer.ok) throw new Error(`${name} answered ${answer.status}`);
    return answer.json();
  }

  /**
   * Something fetched at most once an hour. If a refetch fails, the copy already held is kept.
   * A `required` piece fails the question when nothing is held; an optional one answers with
   * `null` and the reason, so the rest of the server is not affected.
   */
  function keeper(load, { required }) {
    let held = null;
    let heldAt = 0;
    let loading = null;
    let failedAt = null;
    let problem = '';
    return async function get() {
      const stale = !held || now() - heldAt >= KEEP_MS;
      const waiting = !held && failedAt !== null && now() - failedAt < RETRY_MS && !required;
      if (stale && !waiting) {
        loading ??= load().finally(() => { loading = null; });
        try {
          held = await loading;
          heldAt = now();
          failedAt = null;
          problem = '';
        } catch (error) {
          if (!held && required) throw error;
          if (!held) {
            failedAt = now();
            problem = error instanceof Error ? error.message : 'could not be read';
          }
        }
      }
      return { value: held, problem };
    };
  }

  const core = keeper(async () => {
    const [laws, bills, notices, events] = await Promise.all([read(FILES.laws), read(FILES.bills), read(FILES.notices), read(FILES.events)]);
    return shape({ laws, bills, notices, events });
  }, { required: true });
  // The index is read first. Only if it cannot be read is the whole file read and cut (the fallback).
  const filings = keeper(async () => {
    let index;
    try {
      index = await read(FILES.filingsIndex);
      // A file that is not the index at all counts as unreadable, so the fallback is tried.
      shapeIndex(index, null);
    } catch {
      return shapeFilings(await read(FILES.filings));
    }
    return shapeIndex(index, reports.read);
  }, { required: false });

  // Reports read one at a time from the site, a few kept for an hour. A report that cannot be read is an error for that question only.
  const recent = new Map();
  const reports = {
    async read(filingId) {
      const name = reportFile(filingId);
      const held = recent.get(name);
      if (held && now() - held.at < KEEP_MS) return held.report;
      const report = readReport(await read(name));
      recent.delete(name);
      recent.set(name, { at: now(), report });
      while (recent.size > KEEP_REPORTS) recent.delete(recent.keys().next().value);
      return report;
    },
  };
  const reporting = keeper(async () => shapeReportingStates(await read(FILES.reporting)), { required: false });

  /**
   * The tables, each fetched at most once an hour. Each answer also carries today's date, so
   * "coming up" and "open for comment" go by the day the question is asked and not by the day the
   * tables were last brought up to date. `filings` and `reporting` are null when that file could
   * not be read, with the reason in `filingsProblem` and `reportingProblem`.
   */
  return async function tables() {
    const [c, f, r] = await Promise.all([core(), filings(), reporting()]);
    return {
      ...c.value,
      filings: f.value,
      filingsProblem: f.problem,
      reporting: r.value,
      reportingProblem: r.problem,
      today: new Date(now()).toISOString().slice(0, 10),
    };
  };
}

const list = (value) => (Array.isArray(value) ? value : String(value ?? '').split(';').map((s) => s.trim()).filter(Boolean));

/** One tidy shape for the four files, whatever small differences they have between them. */
export function shape({ laws, bills, notices, events }) {
  return {
    laws: (laws.laws ?? []).map((law) => ({ ...law, kinds: list(law.kinds) })),
    lawKinds: laws.kinds ?? [],
    lawsVersion: laws.dataset_version ?? '',
    licence: laws.license ?? 'CC BY 4.0',
    bills: (bills.bills ?? []).map((bill) => ({ ...bill, kinds: list(bill.kinds) })),
    billKinds: bills.kinds ?? [],
    billsRetrieved: bills.retrieved ?? '',
    notices: (notices.notices ?? []).map((notice) => ({ ...notice, agencies: list(notice.agencies), names_program_in: list(notice.names_program_in), dates_read: notice.dates_read ?? [] })),
    noticeRoles: notices.roles ?? [],
    noticeTypes: notices.types ?? [],
    noticesRetrieved: notices.retrieved ?? '',
    events: events.events ?? [],
    eventKinds: events.kinds ?? {},
    eventsRetrieved: events.retrieved ?? '',
  };
}

/**
 * The filed reports, shaped for lookup, from the index (see src/split.js): each report with its
 * filer, the number of its lines and discrepancies, its calculated measures and its attached
 * documents, and no lines. `report` reads one report's lines and discrepancies when they are asked
 * for. Nothing is general to today's states or forms: whatever forms, record kinds and entity
 * types the file holds are kept as they are. Throws when the file is not the index at all.
 */
export function shapeIndex(index, report) {
  if (index === null || typeof index !== 'object' || !Array.isArray(index.filings) || index.filings.some((f) => f === null || typeof f !== 'object' || typeof f.filing_id !== 'string' || typeof f.entity !== 'object' || f.entity === null)) {
    throw new Error('the index of filed reports is not in the shape expected');
  }
  const filings = index.filings.map((f) => ({ ...f, discrepancy_count: f.discrepancy_count ?? 0, measures: f.measures ?? [], attachments: f.attachments ?? [] }));
  const days = filings.map((f) => String(f.retrieved_at ?? '').slice(0, 10)).filter(Boolean).sort();
  const byId = new Map(filings.map((f) => [String(f.filing_id).toLowerCase(), f]));
  return {
    filings,
    byId,
    report,
    version: index.dataset_version ?? '',
    licence: index.license ?? 'CC-BY-4.0',
    retrieved: days[days.length - 1] ?? '',
  };
}

/**
 * The filed reports from the whole file, cut with the same function the site uses to write the
 * index and the report files. This is the fallback for a host that cannot read the index (the
 * program on a person's own computer, and an older host): every report is then held in memory,
 * as text, and read back only when that one report is asked for.
 */
export function shapeFilings(file) {
  const { index, reports } = split(file);
  const held = new Map(Object.entries(reports).map(([id, doc]) => [id.toLowerCase(), JSON.stringify(doc)]));
  return shapeIndex(index, async (filingId) => {
    const text = held.get(String(filingId).toLowerCase());
    if (text === undefined) throw new Error(`no report ${filingId}`);
    return readReport(JSON.parse(text));
  });
}

/** The states with a 340B reporting law, in groups by what the public can see. */
export function shapeReportingStates(file) {
  if (file === null || typeof file !== 'object' || !Array.isArray(file.states) || !Array.isArray(file.groups)) {
    throw new Error('the reporting states file is not in the shape expected');
  }
  return {
    about: file.about ?? '',
    updated: file.updated ?? '',
    groups: file.groups,
    states: file.states,
  };
}
