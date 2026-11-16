/**
 * The shortage area tracker, read from the copy of the tables in src/data/health-centers/areas/
 * (written by scripts/hc/areas.mjs, made in clinx-health-centers).
 *
 * In plain words: HRSA lists the areas it designates as short of health workers (primary care,
 * dental health, mental health) and the areas and populations it calls medically underserved, and
 * every health center site. This file reads ClinX's dated copy of those lists for the pages: the
 * counts of one state, the designations HRSA proposes to withdraw, what HRSA's own dates say
 * happened in the 365 days before the copy, the sites added in the same window, and the changes
 * between ClinX's copies. A score, a status and a date are HRSA's text and are printed as published.
 * Nothing here ranks a state, adds one count to another or says why something changed.
 */

export const AREAS_PATH = '/health-centers/shortage-areas/';
export const AREAS_DOWNLOADS = '/data/health-centers/areas/';
/** HRSA's folder of data files; each of the five files is downloaded from here. */
export const HRSA_FILES_ADDRESS = 'https://data.hrsa.gov/DataDownload/DD_Files/';

export const SERIES = ['hpsa-pc', 'hpsa-dh', 'hpsa-mh', 'mua'] as const;
export type Series = (typeof SERIES)[number];
export const STATUSES = ['Designated', 'Proposed For Withdrawal', 'Withdrawn'] as const;
export type Status = (typeof STATUSES)[number];
export const EVENTS = ['designated', 'withdrawn', 'updated'] as const;
export type AreaEvent = (typeof EVENTS)[number];

/** The four kinds of area, in the order the pages show them. */
export const SERIES_INFO: Readonly<Record<Series, { label: string; short: string; plural: string; file: string }>> = {
  'hpsa-pc': { label: 'Primary care shortage areas', short: 'Primary care', plural: 'primary care shortage areas', file: 'BCD_HPSA_FCT_DET_PC.csv' },
  'hpsa-dh': { label: 'Dental health shortage areas', short: 'Dental health', plural: 'dental health shortage areas', file: 'BCD_HPSA_FCT_DET_DH.csv' },
  'hpsa-mh': { label: 'Mental health shortage areas', short: 'Mental health', plural: 'mental health shortage areas', file: 'BCD_HPSA_FCT_DET_MH.csv' },
  mua: { label: 'Medically underserved areas and populations', short: 'Underserved areas', plural: 'medically underserved areas and populations', file: 'MUA_DET.csv' },
};

/** The states and territories of HRSA's files, and the code HRSA writes where no state is given. */
export const AREA_NAMES: Readonly<Record<string, string>> = {
  AK: 'Alaska', AL: 'Alabama', AR: 'Arkansas', AS: 'American Samoa', AZ: 'Arizona', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DC: 'District of Columbia', DE: 'Delaware', FL: 'Florida', FM: 'Federated States of Micronesia', GA: 'Georgia', GU: 'Guam', HI: 'Hawaii',
  IA: 'Iowa', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', MA: 'Massachusetts', MD: 'Maryland',
  ME: 'Maine', MH: 'Marshall Islands', MI: 'Michigan', MN: 'Minnesota', MO: 'Missouri', MP: 'Northern Mariana Islands', MS: 'Mississippi',
  MT: 'Montana', NC: 'North Carolina', ND: 'North Dakota', NE: 'Nebraska', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NV: 'Nevada', NY: 'New York', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', PR: 'Puerto Rico', PW: 'Palau',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VA: 'Virginia',
  VI: 'U.S. Virgin Islands', VT: 'Vermont', WA: 'Washington', WI: 'Wisconsin', WV: 'West Virginia', WY: 'Wyoming',
  XX: 'No state given in HRSA’s file',
};
/** The code HRSA writes where a row has no state. It has a page of its own so that every count reconciles with the file. */
export const NO_STATE = 'XX';

export interface Cell {
  designations: number;
  file_rows: number;
}
export type StatusCounts = Record<Status, Cell>;
export interface Counts {
  change_rows: number;
  designations: Record<Series, StatusCounts>;
  designations_from_other_primary_states_with_components_here: number;
  designations_with_components_in_other_states: number;
  recent_events: Record<Series, Record<AreaEvent, number>>;
  sites: Record<string, number>;
  sites_added_to_scope_in_window: number;
  sites_not_active: number;
}
export interface Notes {
  counts: string;
  state: string;
  updated: string;
  window: string;
}
export interface RecentRow {
  event_date_iso: string;
  event_date_as_published: string;
  event: AreaEvent;
  file: 'hpsa' | 'mua';
  discipline: string;
  key: string;
  id: string;
  name: string;
  designation_type: string;
  state: string;
  states: string;
  counties: string;
  score: string;
  status: Status;
}
export interface ProposedRow {
  file: 'hpsa' | 'mua';
  discipline: string;
  key: string;
  id: string;
  name: string;
  designation_type: string;
  state: string;
  states: string;
  counties: string;
  score: string;
  status: Status;
  designation_date_as_published: string;
  designation_date_iso: string;
  last_update_date_as_published: string;
  last_update_date_iso: string;
}
export interface SiteRow {
  reason: string;
  state: string;
  key: string;
  site_name: string;
  health_center_number: string;
  health_center_name: string;
  site_status: string;
  added_to_scope_as_published: string;
  added_to_scope_iso: string;
  address: string;
  city: string;
  postal_code: string;
  county: string;
}
export interface ChangeRow {
  from_day: string;
  to_day: string;
  file: string;
  key: string;
  state: string;
  name: string;
  kind: string;
  field: string;
  before: string;
  after: string;
}
export interface StateFile {
  state: string;
  snapshot_day: string;
  window_start: string;
  window_end: string;
  counts: Counts;
  notes: Notes;
  recent: RecentRow[];
  proposed: ProposedRow[];
  sites_recent: SiteRow[];
  changes: ChangeRow[];
}
export interface SourceFile {
  file: string;
  retrieved_utc: string;
  sha256: string;
}
export interface AreasIndex {
  snapshot_day: string;
  window_start: string;
  window_end: string;
  sources: SourceFile[];
  states: string[];
  change_rows_so_far: number;
  file_bytes: Record<string, number>;
  national_counts: {
    designations: Record<Series, StatusCounts>;
    recent_events: Record<Series, Record<AreaEvent, number>>;
    sites: Record<string, number>;
  };
}

const FILES = import.meta.glob('../data/health-centers/areas/**/*.{json,csv}', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const PREFIX = '../data/health-centers/areas/';

/** The text of one copied file (for example "recent.csv" or "states/RI.json"), exactly as copied. */
export function rawFile(name: string): string {
  const text = FILES[PREFIX + name];
  if (text === undefined) throw new Error(`no copied file ${name}`);
  return text;
}

let cache: { index: AreasIndex; states: Map<string, StateFile> } | null = null;
function load(): { index: AreasIndex; states: Map<string, StateFile> } {
  if (cache) return cache;
  const index = JSON.parse(rawFile('index.json')) as AreasIndex;
  const states = new Map<string, StateFile>();
  for (const code of index.states) states.set(code, JSON.parse(rawFile(`states/${code}.json`)) as StateFile);
  cache = { index, states };
  return cache;
}

export const getIndex = (): AreasIndex => load().index;
export function getState(code: string): StateFile {
  const s = load().states.get(code.toUpperCase());
  if (!s) throw new Error(`no shortage area file for ${code}`);
  return s;
}
/** The state codes in the files, in the order of the name shown for each: A to Z, with the rows that name no state last. */
export function stateCodes(): string[] {
  const codes = getIndex().states.filter((c) => c !== NO_STATE);
  codes.sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'en'));
  return getIndex().states.includes(NO_STATE) ? [...codes, NO_STATE] : codes;
}
export function nameOf(code: string): string {
  const name = AREA_NAMES[code];
  if (!name) throw new Error(`no name for the state code ${code}`);
  return name;
}

export const areaPath = (code: string): string => `${AREAS_PATH}${code.toLowerCase()}/`;
export const stateDownload = (code: string): string => `${AREAS_DOWNLOADS}states/${code.toLowerCase()}.json`;
export const tableDownload = (file: string): string => `${AREAS_DOWNLOADS}${file}`;
export const sourceAddress = (file: string): string => HRSA_FILES_ADDRESS + file;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "2026-11-16" as "16 November 2026". */
export function day(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
/** A whole number with thousands separators. */
export const num = (n: number): string => n.toLocaleString('en-US');
/** A byte count in plain units. */
export function size(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/** Which of the four kinds a row belongs to. */
export function seriesOf(row: { file: string; discipline: string }): Series {
  if (row.file === 'mua') return 'mua';
  const id = `hpsa-${row.discipline.toLowerCase()}`;
  if (!(SERIES as readonly string[]).includes(id)) throw new Error(`unknown discipline ${row.discipline}`);
  return id as Series;
}
const seriesRank = (row: { file: string; discipline: string }): number => SERIES.indexOf(seriesOf(row));

/** Counties as HRSA writes them, one list, with a space after each semicolon. Empty when HRSA gives none. */
export const countiesText = (counties: string): string => counties.split(';').filter((c) => c !== '').join('; ');
export const EMPTY_COUNTIES = 'No county in HRSA’s file';
/** A score as published. A blank cell is said in words; NA and Not Applicable stay as HRSA wrote them. */
export const scoreText = (score: string): string => (score === '' ? 'Blank in HRSA’s file' : score);
/** A date as HRSA published it; a blank is said in words. */
export const dateText = (published: string): string => (published === '' ? 'Blank in HRSA’s file' : published);

/** A site's street, city and postal code as HRSA gives them; blank cells are left out and said in words when all are blank. */
export function siteAddress(site: Pick<SiteRow, 'address' | 'city' | 'postal_code'>): string {
  const parts = [site.address, site.city, site.postal_code].filter((p) => p !== '');
  return parts.length === 0 ? 'No address in HRSA’s file' : parts.join(', ');
}

/** The designations HRSA marks Proposed For Withdrawal, by kind and then by name. Never shortened. */
export function proposedRows(state: StateFile): ProposedRow[] {
  return [...state.proposed].sort((a, b) => seriesRank(a) - seriesRank(b) || a.name.localeCompare(b.name, 'en') || a.key.localeCompare(b.key, 'en'));
}
/** The rows of one event in the window, newest date first, then by kind and name. */
export function eventRows(state: StateFile, event: AreaEvent): RecentRow[] {
  return state.recent
    .filter((r) => r.event === event)
    .sort((a, b) => b.event_date_iso.localeCompare(a.event_date_iso) || seriesRank(a) - seriesRank(b) || a.name.localeCompare(b.name, 'en') || a.key.localeCompare(b.key, 'en'));
}
/** The count of rows of an event for each kind of area. */
export function eventCountsByKind(rows: readonly RecentRow[]): Record<Series, number> {
  const out = { 'hpsa-pc': 0, 'hpsa-dh': 0, 'hpsa-mh': 0, mua: 0 } as Record<Series, number>;
  for (const r of rows) out[seriesOf(r)] += 1;
  return out;
}
/** Sites added to scope in the window (newest first), and sites whose status is not Active. */
export function siteLists(state: StateFile): { added: SiteRow[]; notActive: SiteRow[] } {
  const byDate = (a: SiteRow, b: SiteRow): number => b.added_to_scope_iso.localeCompare(a.added_to_scope_iso) || a.site_name.localeCompare(b.site_name, 'en') || a.key.localeCompare(b.key, 'en');
  return {
    added: state.sites_recent.filter((s) => s.reason === 'added to scope in the last 365 days').sort(byDate),
    notActive: state.sites_recent.filter((s) => s.reason === 'status is not Active').sort(byDate),
  };
}

export interface ChangeView {
  name: string;
  /** The file and key of the designation or site, as in changes.csv. */
  ref: string;
  fromIso: string;
  toIso: string;
  from: string;
  to: string;
  kind: string;
  field: string;
  before: string;
  after: string;
  /** True where a value is empty in the file and the page says so in words. */
  beforeEmpty: boolean;
  afterEmpty: boolean;
}
/** The rows of the changes table of a state as the page shows them: newest copy first, values as in the file. */
export function changeViews(rows: readonly ChangeRow[]): ChangeView[] {
  return [...rows]
    .sort((a, b) => b.to_day.localeCompare(a.to_day) || a.kind.localeCompare(b.kind, 'en') || a.name.localeCompare(b.name, 'en') || a.key.localeCompare(b.key, 'en') || a.field.localeCompare(b.field, 'en'))
    .map((r) => ({
      name: r.name,
      ref: `${r.file} ${r.key}`,
      fromIso: r.from_day,
      toIso: r.to_day,
      from: day(r.from_day),
      to: day(r.to_day),
      kind: r.kind,
      field: r.field,
      before: r.before === '' ? 'Empty in the earlier copy' : r.before,
      after: r.after === '' ? 'Empty in the later copy' : r.after,
      beforeEmpty: r.before === '',
      afterEmpty: r.after === '',
    }));
}

/** The day ClinX took its first copy of HRSA's files. */
export const FIRST_COPY_DAY = '2026-11-16';
/** The sentence that opens the section on changes between copies: says the truth for the rows the state file holds. */
export function changesSentence(snapshotDay: string, rows: number): string {
  if (rows > 0) return `${num(rows)} ${rows === 1 ? 'change' : 'changes'} between ClinX’s copies of HRSA’s files, as listed in the file of ${day(snapshotDay)}.`;
  if (snapshotDay === FIRST_COPY_DAY) return `ClinX took its first copy of HRSA’s files on ${day(FIRST_COPY_DAY)}. Changes between copies will be listed here from the next copy on.`;
  return `ClinX compared its copies of HRSA’s files up to ${day(snapshotDay)} and lists no change for this state.`;
}

/** The sentence that says what "updated" means. */
export const UPDATED_MEANS =
  'Updated means only that HRSA’s last update date for the designation falls in these 365 days. HRSA’s file does not say what was updated, so a row with this event says nothing about a score, an area or a status.';

/** The columns of HRSA's files that a reader filters to get a count. */
export const COUNT_COLUMNS =
  'A count of designations is the number of distinct designations in the rows of HRSA’s file that have the state in the column Primary State Abbreviation and the status in the column HPSA Status (the underserved areas file calls its status column MUA/P Status Description). A count of rows is the number of those rows. HRSA publishes one row for each county, county subdivision or census tract of a designation, so the two counts differ.';
