// Where the health center files come from, and the shape each is kept in.
//
// In plain words: ClinX publishes three sets of public information about health centers, each read
// from a federal agency's own files:
//
//   - the records: what each health center reported to HRSA in the Uniform Data System, year by year;
//   - the funding calendar: HRSA's funding opportunities on Grants.gov and the dated lines they and
//     the Federal Register give;
//   - the shortage areas: HRSA's shortage designations and its list of health center sites, with
//     what changed in the last 365 days.
//
// The server reads them the way it reads the 340B tables (src/tables.js): small files are read
// at most once an hour, and a big file (one health center's records, one state's shortage areas) is
// read only when someone asks about that health center or that state, a few kept for an hour.
//
// Every piece here is optional. A health center file is read only when a health center question is
// asked, so the 340B tools never wait for one, and when one cannot be read the tool that needs it
// says so plainly while every other tool goes on answering.
//
// Nothing here changes a published value. A file is checked for its shape and kept as it is.
//
// This file uses nothing that only one kind of computer has.

/** The files, by the names they have under clinx.org/data/. */
export const HC_FILES = {
  sets: 'health-centers/index.json',
  records: 'health-centers/records/index.json',
  lines: 'health-centers/records/lines.json',
  opportunities: 'health-centers/funding/opportunities.json',
  deadlines: 'health-centers/funding/deadlines.json',
  areas: 'health-centers/areas/states.json',
};
/** The file of one health center's records, from its key. The site writes the names in lower case. */
export const centerFile = (key) => `health-centers/records/centers/${String(key).toLowerCase()}.json`;
/** The file of one state's or territory's shortage areas, from its two letters. */
export const areaFile = (code) => `health-centers/areas/states/${String(code).toLowerCase()}.json`;

// How many of the big files are kept in memory after they are read. Each is read again after an hour.
const KEEP_BIG = 4;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const wrong = (what) => new Error(`${what} is not in the shape expected`);

/** The three sets at a glance: the day each was read, and the national counts of the shortage areas. */
export function shapeSets(file) {
  if (!isObject(file) || !isObject(file.records) || !isObject(file.funding) || !isObject(file.areas)) throw wrong('the file about the health center sets');
  return file;
}

/** The list of health centers that have records, with ways to find one by its key or its grant number. */
export function shapeRecords(file) {
  if (!isObject(file) || !Array.isArray(file.health_centers) || file.health_centers.some((c) => !isObject(c) || typeof c.key !== 'string' || typeof c.name !== 'string' || !Array.isArray(c.years))) {
    throw wrong('the list of health centers');
  }
  const centers = file.health_centers;
  return {
    about: file.about ?? '',
    years: file.years ?? [],
    latestYear: file.latest_year,
    states: file.states ?? [],
    workbooks: isObject(file.workbooks) ? file.workbooks : {},
    centers,
    byKey: new Map(centers.map((c) => [c.key.toLowerCase(), c])),
    byGrant: new Map(centers.filter((c) => typeof c.grant_number === 'string' && c.grant_number).map((c) => [c.grant_number.toLowerCase(), c])),
  };
}

/**
 * The dictionary of report lines: for each year, every cell of the report with its table, line and
 * column and HRSA's titles. The file writes each distinct title once and points at it by number
 * (see src/lib/hc-assistant.ts on the site); here each row is opened into plain names.
 */
export function shapeLines(file) {
  if (!isObject(file) || !Array.isArray(file.columns) || !Array.isArray(file.texts) || !isObject(file.years)) throw wrong('the dictionary of report lines');
  const pointers = new Set(file.text_columns ?? []);
  const at = Object.fromEntries(file.columns.map((name, i) => [name, i]));
  for (const name of ['uiid', 'table', 'sheet', 'line', 'line_title', 'column', 'column_title', 'kind']) if (at[name] === undefined) throw wrong('the dictionary of report lines');
  const read = (row, name) => {
    const value = row[at[name]];
    const word = pointers.has(name) ? file.texts[value] : value;
    if (typeof word !== 'string') throw wrong('the dictionary of report lines');
    return word;
  };
  const years = new Map();
  for (const [year, rows] of Object.entries(file.years)) {
    if (!Array.isArray(rows)) throw wrong('the dictionary of report lines');
    years.set(year, rows.map((row) => ({
      uiid: read(row, 'uiid'),
      table: read(row, 'table'),
      sheet: read(row, 'sheet'),
      line: read(row, 'line'),
      lineTitle: read(row, 'line_title'),
      column: read(row, 'column'),
      columnTitle: read(row, 'column_title'),
      kind: read(row, 'kind'),
    })));
  }
  return { years, labels: isObject(file.table_labels) ? file.table_labels : {} };
}

// The fields of an opportunity that are kept. Anything else in the file is left where it is: in
// particular the agency's "more information" text, which is where a notice names a person to write
// to, is never read into memory, so no tool can give it out.
const OPPORTUNITY_FIELDS = [
  'id', 'number', 'title', 'status', 'document_kind', 'agency_name', 'fiscal_year', 'category', 'health_center_program', 'names_health_centers', 'matched_terms',
  'dates', 'date_conflicts', 'application_due_note', 'award_ceiling', 'award_floor', 'estimated_funding', 'number_of_awards', 'cost_sharing',
  'funding_instruments', 'funding_categories', 'applicant_types', 'eligibility', 'description', 'listings', 'change_comment', 'revision', 'grants_gov_url',
];

/** HRSA's funding opportunities as Grants.gov lists them. */
export function shapeOpportunities(file) {
  if (!Array.isArray(file) || file.some((o) => !isObject(o) || typeof o.id !== 'string' || typeof o.title !== 'string' || !isObject(o.dates))) throw wrong('the table of funding opportunities');
  return file.map((o) => Object.fromEntries(OPPORTUNITY_FIELDS.filter((name) => o[name] !== undefined).map((name) => [name, o[name]])));
}

/** The dated lines of the funding calendar. */
export function shapeDeadlines(file) {
  if (!Array.isArray(file) || file.some((d) => !isObject(d) || typeof d.date !== 'string' || typeof d.kind !== 'string')) throw wrong('the table of health center funding dates');
  return file;
}

/** The shortage area counts of every state and territory. */
export function shapeAreas(file) {
  if (!isObject(file) || !isObject(file.states) || typeof file.snapshot_day !== 'string') throw wrong('the table of shortage area counts');
  return { states: file.states, notes: isObject(file.notes) ? file.notes : {}, day: file.snapshot_day, windowStart: file.window_start ?? '', windowEnd: file.window_end ?? '' };
}

/** One health center's records. */
export function shapeCenter(file) {
  if (!isObject(file) || typeof file.key !== 'string' || !isObject(file.years)) throw wrong('a health center\'s file');
  return file;
}

/** One state's or territory's shortage areas. */
export function shapeArea(file) {
  if (!isObject(file) || typeof file.state !== 'string' || !Array.isArray(file.recent) || !Array.isArray(file.proposed) || !Array.isArray(file.sites_recent)) throw wrong('a state\'s shortage area file');
  return file;
}

/**
 * The health center pieces. `read` reads one file by name, `keeper` makes something fetched at
 * most once an hour (both come from src/tables.js), and `now` tells the time.
 *
 * Each of `sets`, `records`, `lines`, `opportunities`, `deadlines` and `areas` is a function that
 * resolves to `{ value, problem }`: the piece, or `null` and the reason when it cannot be read.
 * `center(key)` and `area(code)` read one big file and throw when it cannot be read.
 */
export function healthCenters({ read, keeper, now, keepMs }) {
  const piece = (name, shape) => keeper(async () => shape(await read(name)), { required: false });
  const big = (nameOf, shape) => {
    const recent = new Map();
    return async (id) => {
      const name = nameOf(id);
      const held = recent.get(name);
      if (held && now() - held.at < keepMs) return held.doc;
      const doc = shape(await read(name));
      recent.delete(name);
      recent.set(name, { at: now(), doc });
      while (recent.size > KEEP_BIG) recent.delete(recent.keys().next().value);
      return doc;
    };
  };
  return {
    sets: piece(HC_FILES.sets, shapeSets),
    records: piece(HC_FILES.records, shapeRecords),
    lines: piece(HC_FILES.lines, shapeLines),
    opportunities: piece(HC_FILES.opportunities, shapeOpportunities),
    deadlines: piece(HC_FILES.deadlines, shapeDeadlines),
    areas: piece(HC_FILES.areas, shapeAreas),
    center: big(centerFile, shapeCenter),
    area: big(areaFile, shapeArea),
  };
}
