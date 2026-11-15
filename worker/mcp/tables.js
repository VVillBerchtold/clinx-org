// Where the tables come from.
//
// In plain words: the server holds no data of its own. It reads the same open files anyone can
// download from clinx.org/data (state laws, bills, federal notices, calendar), keeps them in
// memory for an hour, and answers questions from that copy. A host can hand it another way to
// read a file (`reader`): src/disk.js reads them from a folder, which is how the tests run
// without the network, and a web host can read them from its own files.
//
// This file uses nothing that only one kind of computer has, so it runs the same under Node and
// on an edge host.

export const DATA_URL = 'https://clinx.org/data/';
export const FILES = { laws: '340b-state-laws.json', bills: '340b-bills.json', notices: '340b-notices.json', events: '340b-events.json' };
const KEEP_MS = 60 * 60 * 1000;

/**
 * Make a loader. `source` is a web address ending in a slash and `fetcher` the fetch to use; or
 * give `reader`, a function that takes a file's name and resolves to what the file holds.
 */
export function makeTables({ source = DATA_URL, fetcher, reader, now = () => Date.now() } = {}) {
  let held = null;
  let heldAt = 0;
  let loading = null;

  async function read(name) {
    if (reader) return reader(name);
    const answer = await (fetcher ?? fetch)(new URL(name, source), { headers: { accept: 'application/json' } });
    if (!answer.ok) throw new Error(`${name} answered ${answer.status}`);
    return answer.json();
  }

  async function load() {
    const [laws, bills, notices, events] = await Promise.all([read(FILES.laws), read(FILES.bills), read(FILES.notices), read(FILES.events)]);
    return shape({ laws, bills, notices, events });
  }

  /**
   * The tables, fetched at most once an hour. If a refetch fails, the copy already held is kept.
   * Each answer also carries today's date, so "coming up" and "open for comment" go by the day
   * the question is asked and not by the day the tables were last brought up to date.
   */
  return async function tables() {
    if (!held || now() - heldAt >= KEEP_MS) {
      loading ??= load().finally(() => { loading = null; });
      try {
        held = await loading;
        heldAt = now();
      } catch (error) {
        if (!held) throw error;
      }
    }
    return { ...held, today: new Date(now()).toISOString().slice(0, 10) };
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
