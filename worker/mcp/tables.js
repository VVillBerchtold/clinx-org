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
// This file uses nothing that only one kind of computer has, so it runs the same under Node and
// on an edge host.

export const DATA_URL = 'https://clinx.org/data/';
export const FILES = {
  laws: '340b-state-laws.json',
  bills: '340b-bills.json',
  notices: '340b-notices.json',
  events: '340b-events.json',
  filings: '340b-state-filings.json',
  reporting: '340b-reporting-states.json',
};
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
  const filings = keeper(async () => shapeFilings(await read(FILES.filings)), { required: false });
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

// A cell in the filings file is text. A cell with nothing in it is left out of the held copy: the
// file has about twenty columns on every line and most are empty on most lines, so leaving them
// out keeps what the server holds much smaller. Nothing else about a cell is changed.
const filled = (row, leave = []) => {
  const kept = {};
  for (const [key, value] of Object.entries(row)) {
    if (leave.includes(key) || value === '' || value === undefined || value === null) continue;
    kept[key] = value;
  }
  return kept;
};

/** The claim counts that the published files leave out are 1 to 5. A whole number in that range is never held. */
const isSmallCount = (value) => /^\s*[1-5]\s*$/.test(String(value ?? '').replace(/,/g, ''));

/** Lines grouped by report. A claim count of 1 to 5 never gets past this point, whatever the file says. */
function keepLine(row) {
  const line = filled(row, ['filing_id']);
  const small = line.claims !== undefined && isSmallCount(line.claims);
  if (line.claims_withheld !== undefined || small) {
    delete line.claims;
    delete line.claims_as_filed;
    line.claims_withheld ??= 'fewer_than_6';
  } else if (line.claims_as_filed !== undefined && isSmallCount(line.claims_as_filed)) {
    delete line.claims;
    delete line.claims_as_filed;
    line.claims_withheld = 'fewer_than_6';
  }
  return line;
}

const groupBy = (rows, key, keep) => {
  const groups = new Map();
  for (const row of rows) {
    const id = row[key];
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(keep(row));
  }
  return groups;
};

/**
 * The filed reports, shaped for lookup: each report with its filer, its lines (as text, in the order the
 * file has them: see `lines_json`), its recorded discrepancies, its calculated measures and its attached documents.
 * Nothing is general to today's states or forms: whatever forms, record kinds and entity types
 * the file holds are kept as they are. Throws when the file is not the filings file at all.
 */
export function shapeFilings(file) {
  if (file === null || typeof file !== 'object' || !Array.isArray(file.filings) || !Array.isArray(file.entities) || !Array.isArray(file.line_items)) {
    throw new Error('the filed reports file is not in the shape expected');
  }
  const entities = new Map(file.entities.map((entity) => [entity.entity_id, filled(entity)]));
  // A report's lines are the bulk of the file. They are held as one line of text for each report
  // and read back into rows only when that one report is asked for, which keeps what the server
  // holds to about the size of the file itself.
  const lines = groupBy(file.line_items, 'filing_id', keepLine);
  const discrepancies = groupBy(file.discrepancies ?? [], 'filing_id', (row) => filled(row, ['filing_id']));
  const measures = groupBy(file.measures ?? [], 'filing_id', (row) => filled(row, ['filing_id']));
  const attachments = groupBy(file.attachments ?? [], 'filing_id', (row) => filled(row, ['filing_id']));
  const filings = file.filings.map((row) => {
    const filing = filled(row);
    const entity = entities.get(row.entity_id) ?? { entity_id: row.entity_id, state: row.state };
    const own = lines.get(row.filing_id) ?? [];
    return {
      ...filing,
      entity,
      line_count: own.length,
      lines_json: JSON.stringify(own),
      discrepancies: discrepancies.get(row.filing_id) ?? [],
      measures: measures.get(row.filing_id) ?? [],
      attachments: attachments.get(row.filing_id) ?? [],
    };
  });
  const days = filings.map((f) => String(f.retrieved_at ?? '').slice(0, 10)).filter(Boolean).sort();
  const byId = new Map(filings.map((f) => [String(f.filing_id).toLowerCase(), f]));
  return {
    filings,
    byId,
    version: file.dataset_version ?? '',
    licence: file.license ?? 'CC-BY-4.0',
    retrieved: days[days.length - 1] ?? '',
  };
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
