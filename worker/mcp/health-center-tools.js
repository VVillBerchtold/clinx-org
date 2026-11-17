// The health center questions the server can answer, and how each is answered from the files.
//
// Every tool here only reads. Every answer names the page it came from and the day the agency's
// file was read. A value is given exactly as the agency published it: nothing is rounded, added up,
// estimated or filled in. Where HRSA put a mark in a cell, the answer gives the mark and what it
// means, and a withheld value is never worked out from the cells around it. No tool puts the health
// centers in the order of a figure, and none labels one health center against another.
//
// The files and their shapes are in src/health-centers.js.

import { InputError, LIMIT, SITE, clip, dayOf, echo, fitRows, holds, leftOutForSize, oneOf, said, tally, text, wholeNumber, words, yearOf, yesNo } from './inputs.js';

const unread = (what) => `${what} could not be read just now, so this question cannot be answered. The other tools still work. Try again in a minute.`;
/** What a health center tool says when a file it needs cannot be read. */
export const HC_UNREAD = {
  sets: unread('The file about the health center sets'),
  records: unread('The list of health centers'),
  lines: unread('The dictionary of report lines'),
  center: unread('The file of this health center'),
  funding: unread('The table of funding opportunities'),
  calendar: unread('The table of health center funding dates'),
  areas: unread('The table of shortage area counts'),
  area: unread('The shortage area file of this state'),
};

const RECORDS_HOME = `${SITE}/health-centers/records/`;
const FUNDING_HOME = `${SITE}/health-centers/funding/`;
const AREAS_HOME = `${SITE}/health-centers/shortage-areas/`;

/** A piece that may be unreadable: the piece, or the tool's plain answer that it cannot be read. */
async function need(get, message) {
  let got;
  try {
    got = get ? await get() : null;
  } catch {
    got = null;
  }
  if (!got?.value) throw new InputError(message);
  return got.value;
}
/** A piece an answer can do without: the piece, or null. */
async function maybe(get) {
  try {
    return get ? (await get()).value : null;
  } catch {
    return null;
  }
}

function twoLetters(args, name) {
  if (args[name] === undefined || args[name] === '') return undefined;
  const code = typeof args[name] === 'string' ? args[name].trim().toUpperCase() : '';
  if (!/^[A-Z]{2}$/.test(code)) throw new InputError(`${name} must be a two-letter code, such as RI`);
  return code;
}

// ---- Records: what each health center reported to HRSA ------------------------------------------

const RECORDS_CAUTION = 'Every value is given exactly as HRSA published it in its Uniform Data System workbook for the year. A mark is passed on with its meaning, and a withheld value is never worked out. ClinX does not rank or judge a health center.';

// HRSA's own names for the kinds of Health Center Program funding, by the flag its workbook uses.
const FUNDING_WORDS = {
  CHC: 'Community Health Center',
  MHC: 'Migrant Health Center',
  HO: 'Health Care for the Homeless',
  PH: 'Public Housing Primary Care',
  MSAW: 'Migratory and Seasonal Agricultural Workers',
  HP: 'Homeless Population',
  RPH: 'Residents of Public Housing',
};

// The three marks of HRSA's workbook. The words in quotation marks are the cover sheet's own.
const MARKS = {
  '-': { short: 'no entry', full: 'A single dash is HRSA\'s mark for "no data entry by health center".' },
  '--': { short: 'withheld by HRSA, small count', full: 'Two dashes are HRSA\'s mark for "suppressed patient counts between 1-15 to protect patient privacy". The count is not published, and it is never worked out from other cells.' },
  '---': { short: 'withheld by HRSA, confidential', full: 'Three dashes are HRSA\'s mark for "suppressed health center confidential data".' },
};
const NO_VALUE = {
  clinx: { short: 'withheld by ClinX', full: 'ClinX has a rule of its own for small counts: in a column that counts patients, a whole number from 1 to 15 is not repeated. HRSA\'s workbook prints it.' },
  typed: { short: 'typed text, not kept', full: 'The cell holds words a person typed into the report. ClinX does not keep typed text, so it is not given.' },
  empty: { short: 'empty in HRSA\'s file', full: 'The cell is empty in HRSA\'s workbook.' },
};
const SHEET_STATUS = {
  present: 'The health center has a row in this part of HRSA\'s workbook.',
  unnamed: 'HRSA\'s workbook does not name the health center in this part for this year, so its row cannot be picked out and no value is given.',
  absent: 'HRSA\'s workbook has no row for the health center in this part for this year.',
};

const isExponent = (value) => /^\d+(\.\d+)?e[+-]?\d+$/i.test(value);
// ClinX's rule for small counts, kept here as well so that it holds whatever a file says.
const isSmallPatientCount = (line, value) => line.kind === 'patients' && /^\s*(?:[1-9]|1[0-5])\s*$/.test(value);

/** What one cell of a report holds: a published value, a mark, or the reason there is no value. */
function cellOf(line, values) {
  const value = values[line.uiid];
  if (value === undefined) return { kind: 'typed' };
  if (value === null || typeof value !== 'string' || isSmallPatientCount(line, value)) return { kind: 'clinx' };
  if (value === '') return { kind: 'empty' };
  if (MARKS[value]) return { kind: 'mark', mark: value };
  return { kind: 'value', value };
}

const briefCenter = (center) => said({
  key: center.key,
  grant_number: center.grant_number,
  name: center.name,
  earlier_names: center.earlier_names,
  city: center.city,
  state: center.state,
  years: center.years,
  funding_types: (center.funding_types ?? []).map((f) => f.words ?? f.flag),
  urban_rural: center.urban_rural,
  sites_listed: center.sites,
  clinx_page: `${SITE}${center.page ?? `/health-centers/records/${center.key.toLowerCase()}/`}`,
});

const tableKey = (value) => text(value).replace(/^table\s*/, '').replace(/\s+/g, '');
const lineKey = (value) => text(value).replace(/^line\s*/, '').replace(/^l(?=\d)/, '').replace(/\s+/g, '');

/** The tables of one year's report, in the order of HRSA's workbook, each with its lines. */
function tablesOf(lines) {
  const tables = new Map();
  for (const line of lines) {
    if (!tables.has(line.table)) tables.set(line.table, []);
    tables.get(line.table).push(line);
  }
  return tables;
}

/** Whether the health center has a row in the sheets a table is printed on. */
function statusOf(tableLines, sheets) {
  const names = [...new Set(tableLines.map((l) => l.sheet))];
  const states = names.map((name) => sheets?.[name]?.status ?? 'row_absent');
  if (states.includes('row_present')) return 'present';
  return states.every((s) => s === 'row_withheld_unnamed') ? 'unnamed' : 'absent';
}
const sheetPresent = (line, sheets) => (sheets?.[line.sheet]?.status ?? 'row_absent') === 'row_present';

function howRead(year) {
  const single = Array.isArray(year.one_read_cells) ? year.one_read_cells.length : 0;
  if (year.reads === 'two_reads') return 'Two separate programs read every cell of the workbook, and they agreed.';
  if (year.reads === 'one_read') return 'The workbook was read by one program.';
  return `Two separate programs read the workbook. ${single} cells of this report were read by one program only.`;
}

const findHealthCenters = {
  name: 'find_health_centers',
  title: 'Find health centers',
  description: 'Search the federally funded health centers (community health centers that hold a Health Center Program grant from HRSA) whose yearly reports to HRSA are held by ClinX. Filter by state, by words in the name, city, key or grant number, or by a year the health center reported. Returns short rows: key, grant number, name as HRSA prints it, city, state, the years held, kinds of funding, urban or rural, the number of sites listed, and the ClinX page. The rows are in the order of the names. Use get_health_center_report for what one health center reported. The answer says which states are held so far.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      state: { type: 'string', description: 'Two-letter state code such as RI or MA.', pattern: '^[A-Za-z]{2}$' },
      text: { type: 'string', description: 'Words to look for in the name (this year\'s or an earlier one), the city, the key or the grant number.' },
      year: { type: 'integer', minimum: 1990, maximum: 2100, description: 'Only health centers with a report for this year, such as 2025.' },
      limit: LIMIT,
    },
  },
  async run(t, args) {
    const state = twoLetters(args, 'state');
    const year = yearOf(args);
    const needles = words(args);
    const records = await need(t.hc?.records, HC_UNREAD.records);
    const found = records.centers
      .filter((c) => (!state || c.state === state) && (!year || c.years.map(String).includes(year)))
      .filter((c) => holds(text(`${c.name} ${(c.earlier_names ?? []).map((n) => n.name).join(' ')} ${c.city} ${c.key} ${c.grant_number}`), needles))
      .sort((a, b) => a.name.localeCompare(b.name, 'en') || a.key.localeCompare(b.key, 'en'));
    const asked = clip(found, args.limit).map(briefCenter);
    const book = records.workbooks[String(records.latestYear)] ?? {};
    return fitRows(asked, (shown) => {
      const notes = [RECORDS_CAUTION];
      const leftOut = leftOutForSize(shown, asked, found.length, 'state, text or year');
      if (leftOut) notes.unshift(leftOut);
      else if (shown.length < found.length) notes.unshift(`Showing ${shown.length} of ${found.length}. The list is cut short: narrow it with state or text, or ask for more with limit (up to 100).`);
      if (state && !records.states.includes(state)) notes.unshift(`ClinX holds no health center records for ${state} yet. The states held are: ${records.states.join(', ')}.`);
      if (year && !records.years.map(String).includes(year)) notes.unshift(`No report for ${year} is held. The years held are: ${records.years.join(', ')}.`);
      return {
        matched: found.length,
        shown: shown.length,
        health_centers: shown,
        held: { health_centers: records.centers.length, states: records.states, years: records.years, latest_year: records.latestYear },
        source: 'HRSA (Health Resources and Services Administration), Uniform Data System: the workbook HRSA publishes for each year. The name, city, kinds of funding, urban or rural and number of sites are as the latest year\'s workbook prints them.',
        ...said({ read_on: book.read_on, hrsa_last_refreshed: book.hrsa_last_refreshed }),
        clinx_page: RECORDS_HOME,
        note: notes.join(' '),
      };
    });
  },
};

const getHealthCenterReport = {
  name: 'get_health_center_report',
  title: 'One health center\'s report to HRSA',
  description: 'What one health center reported to HRSA in the Uniform Data System for one year, by its key or grant number from find_health_centers. With no table it gives the health center\'s name and place, the tables of the report with how many lines and cells each has and how many cells carry a mark, and where the full page is. With table (for example Table 3A, patients by age) it gives that table\'s lines: the line, HRSA\'s title for it, and for each column the value exactly as HRSA published it. A cell HRSA marked is given as the mark with its meaning (no entry, withheld small count, withheld confidential data) and never as a number. A long table is given in parts: use line, text, offset and limit.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['health_center'],
    properties: {
      health_center: { type: 'string', description: 'The health center\'s key (for example 010120) or its grant number (for example H80CS00001).' },
      year: { type: 'integer', minimum: 1990, maximum: 2100, description: 'The reporting year. Default: the latest year held for the health center.' },
      table: { type: 'string', description: 'One table of the report, as the answer without a table lists them: for example Table 3A, Table 5, Table 7, Table 9D, Table HIT, ODE or WFC.' },
      line: { type: 'string', description: 'Only this line of the table, as the table lists it (for example L10 or 21a).' },
      text: { type: 'string', description: 'Only the lines whose title holds these words.' },
      offset: { type: 'integer', minimum: 0, description: 'How many lines to skip, for the next part of a long table (default 0).' },
      limit: { type: 'integer', minimum: 1, maximum: 200, description: 'How many lines to return (default 40).' },
    },
  },
  async run(t, args) {
    if (typeof args.health_center !== 'string' || !args.health_center.trim()) throw new InputError('health_center is required: a key or a grant number; find_health_centers returns both');
    const asked = args.health_center.trim().toLowerCase();
    const year = yearOf(args);
    const offset = wholeNumber(args, 'offset', 0, 1e9, 0);
    const limit = wholeNumber(args, 'limit', 1, 200, 40);
    const needles = words(args);
    for (const name of ['table', 'line']) if (args[name] !== undefined && typeof args[name] !== 'string') throw new InputError(`${name} must be text`);
    const wantedTable = args.table === undefined || args.table.trim() === '' ? undefined : tableKey(args.table);
    const wantedLine = args.line === undefined || args.line.trim() === '' ? undefined : lineKey(args.line);
    if (wantedTable === undefined && (wantedLine !== undefined || needles.length > 0 || args.offset !== undefined || args.limit !== undefined)) throw new InputError('line, text, offset and limit go with table: name one table of the report, such as Table 3A');

    const records = await need(t.hc?.records, HC_UNREAD.records);
    const center = records.byKey.get(asked) ?? records.byGrant.get(asked);
    if (!center) throw new InputError(`no health center with the key or grant number ${echo(args.health_center)}; use find_health_centers to look one up`);
    const years = center.years.map(String);
    const chosen = year ?? years[years.length - 1];
    if (!years.includes(chosen)) throw new InputError(`no ${chosen} report is held for this health center; its years are: ${years.join(', ')}`);
    const dictionary = await need(t.hc?.lines, HC_UNREAD.lines);
    const lines = dictionary.years.get(chosen);
    if (!lines) throw new InputError(HC_UNREAD.lines);
    let doc;
    try {
      doc = await t.hc.center(center.key);
    } catch {
      throw new InputError(HC_UNREAD.center);
    }
    const report = doc.years[chosen];
    if (report === null || typeof report !== 'object' || report.values === null || typeof report.values !== 'object') throw new InputError(HC_UNREAD.center);

    const header = report.health_center ?? {};
    const funding = Object.keys(header).filter((k) => k.startsWith('Funding') && header[k] === 'TRUE').map((k) => FUNDING_WORDS[k.slice(7)] ?? k.slice(7));
    const base = `/health-centers/records/${center.key.toLowerCase()}/`;
    const page = `${SITE}${chosen === String(records.latestYear) ? base : `${base}${chosen}/`}`;
    const book = records.workbooks[chosen] ?? {};
    const common = {
      health_center: said({
        key: center.key,
        grant_number: header.GrantNumber ?? center.grant_number,
        name: header.HealthCenterName ?? center.name,
        city: header.HealthCenterCity,
        state: header.HealthCenterState,
        urban_rural: header.UrbanRuralFlag,
        funding_types: funding,
        years_held: center.years,
      }),
      year: Number(chosen),
    };
    const closing = {
      clinx_page: page,
      whole_file: `${SITE}${center.file ?? `/data/health-centers/records/centers/${center.key.toLowerCase()}.json`}`,
      source: said({
        agency: 'HRSA (Health Resources and Services Administration), Uniform Data System',
        workbook: report.source?.file ?? book.file,
        workbook_address: book.url,
        hrsa_last_refreshed: report.source?.report_last_refreshed ?? book.hrsa_last_refreshed,
        read_on: book.read_on,
        how_read: howRead(report),
      }),
      note: RECORDS_CAUTION,
    };
    const tables = tablesOf(lines);

    if (wantedTable === undefined) {
      const list = [...tables].map(([name, tableLines]) => {
        const status = statusOf(tableLines, report.tables);
        const cells = status === 'present' ? tableLines.filter((l) => sheetPresent(l, report.tables)).map((l) => cellOf(l, report.values)) : [];
        const marks = tally(cells.filter((c) => c.kind === 'mark'), (c) => c.mark);
        const count = (kind) => cells.filter((c) => c.kind === kind).length;
        return said({
          table: name,
          label: dictionary.labels[name],
          status,
          lines: new Set(tableLines.map((l) => `${l.line}\u0001${l.lineTitle}`)).size,
          cells: tableLines.length,
          ...(status === 'present'
            ? {
              cells_with_a_value: count('value'),
              ...(Object.keys(marks).length ? { cells_with_a_mark: marks } : {}),
              ...(count('clinx') ? { cells_withheld_by_clinx: count('clinx') } : {}),
              ...(count('typed') ? { cells_of_typed_text_not_kept: count('typed') } : {}),
              ...(count('empty') ? { cells_empty: count('empty') } : {}),
            }
            : {}),
        });
      });
      const seen = [...new Set(list.map((row) => row.status))];
      return {
        ...common,
        tables: list,
        status_means: Object.fromEntries(seen.map((s) => [s, SHEET_STATUS[s]])),
        marks: Object.fromEntries(Object.entries(MARKS).map(([mark, m]) => [mark, m.full])),
        labels: 'The table codes are HRSA\'s. The label beside each is a plain one of ClinX\'s own.',
        sites_listed: Array.isArray(report.sites?.rows) ? report.sites.rows.length : undefined,
        also_on_the_page: 'The health center\'s sites and its patients by ZIP code are on the ClinX page and in the whole file.',
        next: 'Ask again with table to read one table, for example table "Table 3A".',
        ...closing,
      };
    }

    const match = [...tables.keys()].find((name) => tableKey(name) === wantedTable);
    if (!match) throw new InputError(`the ${chosen} report has no table ${echo(args.table)}; its tables are: ${[...tables.keys()].join(', ')}`);
    const tableLines = tables.get(match);
    const status = statusOf(tableLines, report.tables);
    const picked = tableLines.filter((l) => (wantedLine === undefined || lineKey(l.line) === wantedLine) && holds(text(l.lineTitle), needles));
    if (wantedLine !== undefined && picked.length === 0) throw new InputError(`${match} has no line ${echo(args.line)}${needles.length ? ' with those words in its title' : ''}; its lines are: ${[...new Set(tableLines.map((l) => l.line))].join(', ')}`);

    // One title for a column across the lines asked for is said once; a column whose title differs from line to line carries it on each cell.
    const titles = new Map();
    for (const l of picked) {
      if (!titles.has(l.column)) titles.set(l.column, new Set());
      titles.get(l.column).add(l.columnTitle);
    }
    const shared = Object.fromEntries([...titles].filter(([, set]) => set.size === 1).map(([column, set]) => [column, [...set][0]]));
    const rows = [];
    const byRow = new Map();
    for (const l of picked) {
      const id = `${l.line}\u0001${l.lineTitle}`;
      if (!byRow.has(id)) {
        byRow.set(id, { line: l.line, title: l.lineTitle, cells: [] });
        rows.push(byRow.get(id));
      }
      byRow.get(id).cells.push(l);
    }
    // Each line asked for, written out, with the kinds of cell it holds (a mark, or a reason there is no value).
    const linesAsked = rows.slice(offset, offset + limit).map((row) => {
      const kinds = new Set();
      const line = {
        line: row.line,
        title: row.title,
        ...(status === 'present'
          ? {
            cells: row.cells.filter((l) => sheetPresent(l, report.tables)).map((l) => {
              const cell = cellOf(l, report.values);
              kinds.add(cell.kind === 'mark' ? cell.mark : cell.kind);
              return {
                column: l.column,
                ...(shared[l.column] === undefined ? { column_title: l.columnTitle } : {}),
                ...(cell.kind === 'value'
                  ? { value: cell.value, ...(isExponent(cell.value) ? { exponent: true } : {}) }
                  : cell.kind === 'mark'
                    ? { mark: cell.mark, means: MARKS[cell.mark].short }
                    : { no_value: NO_VALUE[cell.kind].short }),
              };
            }),
          }
          : {}),
      };
      return { line, kinds };
    });
    // The lines are kept whole while the answer stays within the size one answer may have (fitRows in
    // src/inputs.js). The counts, the sentence about what is left and the meanings of the marks are
    // written from the lines that are returned.
    return fitRows(linesAsked, (kept) => {
      const returned = kept.map((row) => row.line);
      const legend = {};
      for (const kind of new Set(kept.flatMap((row) => [...row.kinds]))) {
        if (MARKS[kind]) legend[kind] = MARKS[kind].full;
        else if (NO_VALUE[kind]) legend[NO_VALUE[kind].short] = NO_VALUE[kind].full;
      }
      return {
        ...common,
        table: match,
        ...said({ label: dictionary.labels[match] }),
        status,
        status_means: SHEET_STATUS[status],
        columns: shared,
        lines: returned,
        lines_total: rows.length,
        lines_returned: returned.length,
        offset,
        ...(offset + returned.length < rows.length ? { more: `${rows.length - offset - returned.length} more lines: ask again with offset ${offset + returned.length}, or narrow with line or text.${kept.length < linesAsked.length ? ` This answer holds ${returned.length} lines: that is as many whole lines as fit in one answer.` : ''}` } : {}),
        ...(Object.keys(legend).length ? { what_the_marks_mean: legend } : {}),
        how_to_read: 'Each line has one cell for each column. value is the text HRSA published, character for character: it is never rounded and has no thousands separators or dollar sign added. A cell with exponent true is a number HRSA published in that short form (2e+05), given as published. A cell with mark or no_value has no figure, and none is worked out. columns gives each column\'s title once; a cell carries column_title when the title differs from line to line.',
        ...closing,
      };
    });
  },
};

// ---- Funding: HRSA's opportunities on Grants.gov and their dates --------------------------------

const STATUSES = ['forecasted', 'posted'];
const STATUS_MEANS = {
  forecasted: 'A forecast: HRSA says it plans to publish this notice. Every date in it is HRSA\'s estimate.',
  posted: 'Posted: HRSA has published the notice of funding opportunity, and it sets the dates.',
};
const FUNDING_CAUTION = 'Dates and amounts are given as HRSA published them on Grants.gov. A forecast is a plan and its dates are estimates that can move; a posted notice governs. Check the Grants.gov page before planning around a date. This is not advice on whether or how to apply.';
const FLAGS_MEAN = 'health_center_program is true when HRSA files the opportunity under the Health Center Program\'s own assistance listing. names_health_centers is true when the opportunity\'s text names health centers; matched_terms gives the words found.';
const DATE_NAMES_MEAN = 'In dates, a name that starts est_ is HRSA\'s estimate in a forecast, and one that starts earlier_est_ is the estimate the forecast gave before the notice was posted. Each date has the text as published and the day it names.';

const dateOf = (o, name) => (o.dates?.[name] && typeof o.dates[name].date === 'string' ? o.dates[name] : undefined);
/** The day applications are due: the day a posted notice states, else HRSA's estimate in a forecast. */
function dueOf(o) {
  const firm = dateOf(o, 'application_due');
  if (firm) return { ...firm, estimated: false };
  const estimate = dateOf(o, 'est_application_due');
  return estimate ? { ...estimate, estimated: true } : undefined;
}
/** Open on a day: the notice is posted, it was posted on or before that day, and applications are due on or after it. */
function openOn(o, day) {
  const posted = dateOf(o, 'notice_posted') ?? dateOf(o, 'search_open');
  const due = dateOf(o, 'application_due');
  return o.status === 'posted' && posted !== undefined && due !== undefined && posted.date <= day && due.date >= day;
}
const published = (amount) => (amount && typeof amount.as_published === 'string' ? amount.as_published : undefined);
const opportunityPage = (o) => `${FUNDING_HOME}${o.id}/`;

function briefOpportunity(o) {
  const due = dueOf(o);
  const notice = dateOf(o, 'notice_posted');
  const expected = dateOf(o, 'est_notice_posting');
  return said({
    id: o.id,
    number: o.number,
    title: o.title,
    status: o.status,
    health_center_program: o.health_center_program,
    names_health_centers: o.names_health_centers,
    application_due: due?.date,
    application_due_as_published: due?.as_published,
    application_due_is_estimate: due?.estimated,
    notice_posted: notice?.date,
    notice_expected: notice ? undefined : expected?.date,
    estimated_funding_as_published: published(o.estimated_funding),
    award_ceiling_as_published: published(o.award_ceiling),
    award_floor_as_published: published(o.award_floor),
    number_of_awards_as_published: published(o.number_of_awards),
    grants_gov_page: o.grants_gov_url,
    clinx_page: opportunityPage(o),
  });
}

const findFundingOpportunities = {
  name: 'find_funding_opportunities',
  title: 'Find HRSA funding opportunities for health centers',
  description: 'Search the funding opportunities HRSA (the federal agency that funds health centers) lists on Grants.gov, both forecasts and posted notices. Filter by words in the title, number or description, to the Health Center Program\'s own opportunities, by status, or to those open for applications on a day. Returns short rows with the application due date as published (and whether it is HRSA\'s estimate), amounts as published, the Grants.gov page and the ClinX page, soonest due date first. Give opportunity (a number such as HRSA-27-006) for one in full, with its description, who can apply and every date.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: 'string', description: 'Words to look for in the title, the opportunity number and the description.' },
      health_center_program: { type: 'boolean', description: 'True for only the opportunities HRSA files under the Health Center Program itself.' },
      status: { type: 'string', enum: STATUSES, description: 'forecasted: HRSA plans to publish it, dates are estimates. posted: the notice is published.' },
      open_on: { type: 'string', description: 'Only notices posted on or before this day whose applications are due on or after it, year-month-day. A forecast is not open.' },
      opportunity: { type: 'string', description: 'One opportunity in full, by its number (for example HRSA-27-006) or its Grants.gov id (for example 363419).' },
      limit: LIMIT,
    },
  },
  async run(t, args) {
    const program = yesNo(args, 'health_center_program');
    const status = oneOf(args, 'status', STATUSES);
    const day = dayOf(args, 'open_on');
    const needles = words(args);
    if (args.opportunity !== undefined && typeof args.opportunity !== 'string') throw new InputError('opportunity must be a number such as HRSA-27-006');
    const opportunities = await need(t.hc?.opportunities, HC_UNREAD.funding);
    const sets = await maybe(t.hc?.sets);
    const read = said({ read_on: sets?.funding?.read_on });
    const unknownDay = sets ? {} : { read_on_unknown: 'The day these files were read could not be read just now.' };

    if (args.opportunity !== undefined && args.opportunity.trim() !== '') {
      const wanted = text(args.opportunity).trim();
      const o = opportunities.find((x) => text(x.id) === wanted || text(x.number) === wanted);
      if (!o) throw new InputError(`no funding opportunity with the number or id ${echo(args.opportunity)}; use find_funding_opportunities without it to look one up`);
      const due = dueOf(o);
      return {
        opportunity: {
          ...o,
          ...said({ application_due: due?.date, application_due_as_published: due?.as_published, application_due_is_estimate: due?.estimated }),
          grants_gov_page: o.grants_gov_url,
          clinx_page: opportunityPage(o),
        },
        status_means: STATUS_MEANS[o.status] ?? `HRSA's status for it is ${o.status}.`,
        dates_mean: DATE_NAMES_MEAN,
        amounts: 'Each amount has the text as published and the same figure as a number. An amount the record does not give is left out.',
        flags_mean: FLAGS_MEAN,
        left_out: 'The agency\'s contact line is not repeated here. It is on the Grants.gov page.',
        source: 'Grants.gov, the federal government\'s list of funding opportunities',
        ...read,
        ...unknownDay,
        note: FUNDING_CAUTION,
      };
    }

    const sortDay = (o) => dueOf(o)?.date ?? '9999-99-99';
    const found = opportunities
      .filter((o) => (program === undefined || o.health_center_program === program) && (!status || o.status === status) && (!day || openOn(o, day)))
      .filter((o) => holds(text(`${o.title} ${o.number} ${o.id} ${o.description ?? ''} ${(o.listings ?? []).map((l) => `${l.number} ${l.program_title}`).join(' ')}`), needles))
      .sort((a, b) => sortDay(a).localeCompare(sortDay(b)) || String(a.id).localeCompare(String(b.id)));
    const asked = clip(found, args.limit).map(briefOpportunity);
    return fitRows(asked, (shown) => {
      const notes = [FUNDING_CAUTION];
      const leftOut = leftOutForSize(shown, asked, found.length, 'text, health_center_program, status or open_on');
      if (leftOut) notes.unshift(leftOut);
      else if (shown.length < found.length) notes.unshift(`Showing ${shown.length} of ${found.length}. The list is cut short: narrow it, or ask for more with limit (up to 100).`);
      return {
        matched: found.length,
        shown: shown.length,
        opportunities: shown,
        status_means: STATUS_MEANS,
        flags_mean: FLAGS_MEAN,
        ...(day ? { open_means: `Open on ${day}: the notice is posted, it was posted on or before that day, and applications are due on or after it. A forecast is not open for applications.` } : {}),
        source: 'Grants.gov, the federal government\'s list of funding opportunities',
        ...read,
        ...unknownDay,
        clinx_page: FUNDING_HOME,
        note: notes.join(' '),
      };
    });
  },
};

const DATE_KINDS = ['notice expected', 'application due', 'award expected', 'comments close', 'takes effect'];
const DATE_KIND_MEANS = {
  'notice expected': 'The day HRSA expects to post the funding notice, from a forecast.',
  'application due': 'The day applications are due: HRSA\'s estimate in a forecast, or the day stated in a posted notice.',
  'award expected': 'The day HRSA expects to make awards, from a forecast.',
  'comments close': 'The last day the Federal Register document takes comments.',
  'takes effect': 'The day the Federal Register document says its rule or notice takes effect.',
};
const DATE_SOURCES = ['grants.gov', 'federal register'];

const briefDate = (d) => said({
  day: d.date,
  kind: d.kind,
  estimated: d.estimated,
  title: d.title,
  status: d.status,
  note: d.note,
  source: d.source,
  official_page: d.url,
  clinx_page: d.source === 'grants.gov' && d.source_id ? `${FUNDING_HOME}${d.source_id}/` : FUNDING_HOME,
});

const healthCenterCalendar = {
  name: 'health_center_calendar',
  title: 'Health center funding dates',
  description: 'Dated lines for health center funding: for each HRSA funding opportunity on Grants.gov the day its notice is expected, the day applications are due and the day awards are expected, and for Federal Register documents that name the Health Center Program the day comments close and the day it takes effect. With no dates given it returns what is coming up from today, soonest first. Give from and to for another stretch. Each line says whether the date is HRSA\'s estimate. This is a separate calendar from the 340B one (the calendar tool).',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      from: { type: 'string', description: 'First day, year-month-day. Default: today.' },
      to: { type: 'string', description: 'Last day, year-month-day.' },
      kind: { type: 'string', enum: DATE_KINDS },
      source: { type: 'string', enum: DATE_SOURCES, description: 'grants.gov for funding opportunities, federal register for rules and notices.' },
      text: { type: 'string', description: 'Words to look for in the title.' },
      limit: LIMIT,
    },
  },
  async run(t, args) {
    const kind = oneOf(args, 'kind', DATE_KINDS);
    const source = oneOf(args, 'source', DATE_SOURCES);
    const to = dayOf(args, 'to');
    const from = dayOf(args, 'from') ?? (to ? undefined : t.today);
    if (from && to && from > to) throw new InputError('from must not be after to');
    const needles = words(args);
    const deadlines = await need(t.hc?.deadlines, HC_UNREAD.calendar);
    const sets = await maybe(t.hc?.sets);
    const found = deadlines
      .filter((d) => (!kind || d.kind === kind) && (!source || d.source === source) && (!from || d.date >= from) && (!to || d.date <= to))
      .filter((d) => holds(text(`${d.title} ${d.source_id ?? ''}`), needles))
      .sort((a, b) => a.date.localeCompare(b.date));
    const asked = clip(found, args.limit).map(briefDate);
    return fitRows(asked, (shown) => {
      const seen = [...new Set(shown.map((d) => d.kind))];
      const leftOut = leftOutForSize(shown, asked, found.length, 'from, to, kind, source or text');
      const cutNote = leftOut ? `${leftOut} ` : shown.length < found.length ? `Showing ${shown.length} of ${found.length}: narrow it, or ask for more with limit (up to 100). ` : '';
      return {
        matched: found.length,
        shown: shown.length,
        dates: shown,
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        kinds_mean: Object.fromEntries(seen.filter((k) => DATE_KIND_MEANS[k]).map((k) => [k, DATE_KIND_MEANS[k]])),
        sources: 'Grants.gov for funding opportunities and the Federal Register for rules and notices. Each line links to the agency\'s own page.',
        ...said({ read_on: sets?.funding?.read_on }),
        ...(sets ? {} : { read_on_unknown: 'The day these files were read could not be read just now.' }),
        clinx_page: FUNDING_HOME,
        note: `${cutNote}A line with estimated true is HRSA's own estimate and can move. Check the official page before planning around a date.`,
      };
    });
  },
};

// ---- Shortage areas: HRSA's designations and health center sites --------------------------------

const AREA_KINDS = ['hpsa-pc', 'hpsa-dh', 'hpsa-mh', 'mua'];
const AREA_KIND_MEANS = {
  'hpsa-pc': 'Primary care health professional shortage areas',
  'hpsa-dh': 'Dental health professional shortage areas',
  'hpsa-mh': 'Mental health professional shortage areas',
  mua: 'Medically underserved areas and populations',
};
const AREA_EVENTS = ['designated', 'withdrawn', 'updated'];
const SHOWS = ['counts', 'recent', 'proposed', 'sites'];
const UPDATED_MEANS = 'updated means only that HRSA\'s last update date for the designation falls in the 365 days. HRSA\'s file does not say what was updated, so a row with this event says nothing about a score, an area or a status.';
const AREAS_CAUTION = 'Counts are counts of rows in HRSA\'s files on the day read. A designation is counted in the state HRSA gives as its primary state. A score is HRSA\'s own and is passed on as published. Nothing here ranks a state or an area, and no count is added to another.';
const NO_STATE = 'XX is the code HRSA writes where a row names no state.';

const kindOfArea = (row) => (row.file === 'mua' ? 'mua' : `hpsa-${text(row.discipline)}`);
const without = (row, names) => Object.fromEntries(Object.entries(row).filter(([key]) => !names.includes(key)));

const shortageAreaChanges = {
  name: 'shortage_area_changes',
  title: 'Shortage areas and health center sites in a state',
  description: 'HRSA\'s shortage designations (primary care, dental health and mental health professional shortage areas, and medically underserved areas and populations) and its list of health center sites, for one state or territory. By default it gives the state\'s counts: designations by kind and status, what was designated, withdrawn or updated in the last 365 days, and sites. With show it lists rows: recent (designations with an event in the last 365 days), proposed (designations HRSA proposes to withdraw), or sites (health center sites added to scope in the last 365 days, and sites that are not active). With no state it gives the national counts and the codes held.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      state: { type: 'string', description: 'Two-letter code of a state or territory, such as RI, DC or PR.', pattern: '^[A-Za-z]{2}$' },
      show: { type: 'string', enum: SHOWS, description: 'counts (default), or one list of rows: recent, proposed or sites.' },
      kind: { type: 'string', enum: AREA_KINDS, description: 'For recent and proposed, one kind of designation: hpsa-pc primary care, hpsa-dh dental health, hpsa-mh mental health, mua medically underserved areas and populations.' },
      event: { type: 'string', enum: AREA_EVENTS, description: 'For recent, one kind of event. updated means only that HRSA\'s last update date falls in the 365 days.' },
      text: { type: 'string', description: 'For a list, words to look for in the name, county, city or id.' },
      limit: LIMIT,
    },
  },
  async run(t, args) {
    const state = twoLetters(args, 'state');
    const show = oneOf(args, 'show', SHOWS) ?? 'counts';
    const kind = oneOf(args, 'kind', AREA_KINDS);
    const event = oneOf(args, 'event', AREA_EVENTS);
    const needles = words(args);
    if (show === 'counts' && (kind || event || needles.length > 0 || args.limit !== undefined)) throw new InputError('kind, event, text and limit go with a list: give show as recent, proposed or sites');
    if (event && show !== 'recent') throw new InputError('event goes with show recent');
    if (kind && show === 'sites') throw new InputError('kind goes with show recent or proposed; a site has no kind of designation');
    if (!state && show !== 'counts') throw new InputError('state is required for a list: give the two-letter code of a state or territory, such as RI');

    if (!state) {
      const [sets, areas] = await Promise.all([maybe(t.hc?.sets), maybe(t.hc?.areas)]);
      if (!sets && !areas) throw new InputError(HC_UNREAD.areas);
      return {
        place: 'The United States and its territories',
        national_counts: sets?.areas?.national_counts ?? { unavailable: HC_UNREAD.sets },
        national_counts_are: 'HRSA\'s files counted once as a whole. They are not the states\' counts added together.',
        ...(areas ? { states_and_territories: Object.keys(areas.states).sort() } : { states_and_territories_unavailable: HC_UNREAD.areas }),
        kinds_mean: AREA_KIND_MEANS,
        updated_means: UPDATED_MEANS,
        notes: areas?.notes ?? sets?.areas?.notes ?? {},
        ...said({ read_on: areas?.day ?? sets?.areas?.read_on, window_start: areas?.windowStart || sets?.areas?.window_start, window_end: areas?.windowEnd || sets?.areas?.window_end }),
        source: 'HRSA Data Warehouse: the files of shortage designations and of health center sites',
        clinx_page: AREAS_HOME,
        next: 'Give state for one state\'s or territory\'s counts.',
        note: `${NO_STATE} ${AREAS_CAUTION}`,
      };
    }

    const areas = await need(t.hc?.areas, HC_UNREAD.areas);
    const counts = areas.states[state];
    if (!counts) throw new InputError(`no shortage area counts for ${state}; the codes held are: ${Object.keys(areas.states).sort().join(', ')}`);
    const closing = {
      kinds_mean: AREA_KIND_MEANS,
      read_on: areas.day,
      window_start: areas.windowStart,
      window_end: areas.windowEnd,
      source: 'HRSA Data Warehouse: the files of shortage designations and of health center sites',
      clinx_page: `${AREAS_HOME}${state.toLowerCase()}/`,
      whole_file: `${SITE}/data/health-centers/areas/states/${state.toLowerCase()}.json`,
    };
    const caution = `${state === 'XX' ? `${NO_STATE} ` : ''}${AREAS_CAUTION}`;
    if (show === 'counts') {
      return { state, counts, updated_means: UPDATED_MEANS, notes: areas.notes, ...closing, next: 'Give show as recent, proposed or sites to list the rows behind these counts.', note: caution };
    }

    let file;
    try {
      file = await t.hc.area(state);
    } catch {
      throw new InputError(HC_UNREAD.area);
    }
    // What a list says when it does not show every row: left out for size (see fitRows in src/inputs.js), or cut at the limit.
    const cutNote = (rows, asked, found, filters) => {
      const leftOut = leftOutForSize(rows, asked, found.length, filters);
      if (leftOut) return `${leftOut} `;
      return rows.length < found.length ? `Showing ${rows.length} of ${found.length}: narrow it with kind, event or text, or ask for more with limit (up to 100). ` : '';
    };
    if (show === 'sites') {
      const found = file.sites_recent.filter((s) => holds(text(`${s.site_name} ${s.health_center_name} ${s.health_center_number} ${s.city} ${s.county} ${s.key}`), needles));
      const asked = clip(found, args.limit).map((s) => said(s));
      return fitRows(asked, (rows) => ({
        state,
        show,
        matched: found.length,
        shown: rows.length,
        sites: rows,
        reasons: 'Each site says why it is listed: it was added to a health center\'s scope in the last 365 days, or its status is not Active.',
        ...closing,
        note: `${cutNote(rows, asked, found, 'text')}Site names and addresses are as HRSA's list of health center sites prints them. ${caution}`,
      }));
    }
    const source = show === 'recent' ? file.recent : file.proposed;
    const found = source
      .filter((r) => (!kind || kindOfArea(r) === kind) && (!event || r.event === event))
      .filter((r) => holds(text(`${r.name} ${r.counties} ${r.designation_type} ${r.id}`), needles));
    if (show === 'recent') found.sort((a, b) => String(b.event_date_iso ?? '').localeCompare(String(a.event_date_iso ?? '')));
    const asked = clip(found, args.limit).map((r) => said({ kind: kindOfArea(r), ...without(r, ['file', 'discipline', 'key']) }));
    return fitRows(asked, (rows) => ({
      state,
      show,
      matched: found.length,
      shown: rows.length,
      designations: rows,
      ...(show === 'recent' ? { order: 'Newest event first.', updated_means: UPDATED_MEANS } : { proposed_means: 'HRSA\'s status for these designations is Proposed For Withdrawal. HRSA\'s file gives no date for a withdrawal.' }),
      ...closing,
      note: `${cutNote(rows, asked, found, show === 'recent' ? 'kind, event or text' : 'kind or text')}${caution}`,
    }));
  },
};

export const HEALTH_CENTER_TOOLS = [findHealthCenters, getHealthCenterReport, findFundingOpportunities, healthCenterCalendar, shortageAreaChanges];

/** The part of about_the_data that describes the health center sets. */
export async function aboutHealthCenters(t) {
  const sets = await maybe(t.hc?.sets);
  if (!sets) return { unavailable: HC_UNREAD.sets };
  const { records, funding, areas } = sets;
  return {
    about: 'Three sets of public information about federally funded health centers, each read from a federal agency\'s own files and given as published.',
    records: said({
      what: records.what,
      source: records.source,
      health_centers: records.health_centers,
      states: records.states,
      years: records.years,
      read_on: records.read_on,
      hrsa_last_refreshed: records.hrsa_last_refreshed,
      marks: Object.fromEntries(Object.entries(MARKS).map(([mark, m]) => [mark, m.full])),
      other_cells_without_a_value: Object.fromEntries(Object.values(NO_VALUE).map((m) => [m.short, m.full])),
      tools: 'find_health_centers, get_health_center_report',
      page: `${SITE}${records.page ?? '/health-centers/records/'}`,
    }),
    funding: said({
      what: funding.what,
      source: funding.source,
      opportunities: funding.opportunities,
      dated_lines: funding.dated_lines,
      read_on: funding.read_on,
      tools: 'find_funding_opportunities, health_center_calendar',
      page: `${SITE}${funding.page ?? '/health-centers/funding/'}`,
    }),
    shortage_areas: said({
      what: areas.what,
      source: areas.source,
      states_and_territories: areas.states_and_territories,
      read_on: areas.read_on,
      window_start: areas.window_start,
      window_end: areas.window_end,
      tools: 'shortage_area_changes',
      page: `${SITE}${areas.page ?? '/health-centers/shortage-areas/'}`,
    }),
    what_clinx_does_not_do: 'ClinX does not rank or judge a health center, put health centers in the order of a figure, or compare one with another. It does not change, round, add up or estimate a published value, and it does not work out a value HRSA withheld. The health center tools give no name, email address or phone number of a contact person.',
    downloads: `${SITE}/data/`,
  };
}
