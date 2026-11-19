/**
 * Three small files for the server that answers assistants (worker/mcp). The server reads JSON only
 * and reads a file at most once an hour, so it needs a short list of the health centers, the
 * dictionary of report lines in a compact form, and one page of facts about the three health center
 * sets (the day each was read, and the national counts of the shortage areas). Everything here is
 * read from the same copies the pages are built from (src/data/health-centers); nothing is typed by
 * hand, no value is changed, and no count is added to another.
 */
import { AREAS_DOWNLOADS, AREAS_PATH, getIndex, rawFile as areasFile } from './hc-areas';
import { FUNDING_DATA, FUNDING_HOME, getFunding } from './hc-funding';
import { DATA_PATH, RECORDS_PATH, TABLE_LABELS, centerDownload, centerKeys, centerPath, fundingTypes, headerRows, linesOf, recordsSource } from './hc-records';
import { HC_HOME } from './site';

/** Where the three files are served. */
export const ASSISTANT_FILES = {
  sets: '/data/health-centers/index.json',
  records: `${DATA_PATH}index.json`,
  lines: `${DATA_PATH}lines.json`,
} as const;

export interface RecordsIndexCenter {
  key: string;
  grant_number: string;
  /** The name as HRSA's latest file prints it. */
  name: string;
  /** Names HRSA printed in earlier years, where they differ from the latest one. */
  earlier_names?: { year: number; name: string }[];
  city: string;
  state: string;
  years: number[];
  funding_types: { flag: string; words: string }[];
  urban_rural: string;
  /** The number of sites HRSA's latest file lists for the health center. */
  sites: number;
  page: string;
  file: string;
}

export interface RecordsIndex {
  about: string;
  years: number[];
  latest_year: number;
  states: string[];
  workbooks: Record<string, { file: string; url: string; read_on: string; hrsa_last_refreshed: string }>;
  health_centers: RecordsIndexCenter[];
}

/** /data/health-centers/records/index.json: each health center that has a records page, by key. */
export function recordsIndex(): RecordsIndex {
  const source = recordsSource();
  const rows = headerRows();
  const health_centers = centerKeys()
    .map((key) => {
      const own = rows.filter((h) => h.key === key).sort((a, b) => a.year - b.year);
      const latest = own[own.length - 1]!;
      const earlier = own.filter((h) => h.name !== latest.name).map((h) => ({ year: h.year, name: h.name }));
      const center: RecordsIndexCenter = {
        key,
        grant_number: latest.grant,
        name: latest.name,
        ...(earlier.length > 0 ? { earlier_names: earlier } : {}),
        city: latest.city,
        state: latest.state,
        years: own.map((h) => h.year),
        funding_types: fundingTypes(latest),
        urban_rural: latest.urbanRural,
        sites: latest.sites,
        page: centerPath(key, latest.year),
        file: centerDownload(key),
      };
      return center;
    })
    .sort((a, b) => a.key.localeCompare(b.key, 'en'));
  return {
    about:
      'The health centers that have a records page on ClinX, one entry for each, in the order of their keys. The name, city, funding types, urban or rural and the number of sites are as HRSA’s file for the health center’s latest year prints them. The key is the health center’s number in HRSA’s Uniform Data System files. Each health center’s own file holds every published value of every year.',
    years: [...source.years],
    latest_year: source.latest_year,
    states: [...source.states],
    workbooks: Object.fromEntries(
      Object.entries(source.workbooks).map(([year, w]) => [year, { file: w.file, url: w.url, read_on: w.retrieved_utc.slice(0, 10), hrsa_last_refreshed: w.report_last_refreshed }]),
    ),
    health_centers,
  };
}

export const LINE_COLUMNS = ['uiid', 'table', 'sheet', 'line', 'line_title', 'column', 'column_title', 'kind'] as const;
/** The columns of a row that hold a number pointing into `texts`. */
export const LINE_TEXT_COLUMNS = ['table', 'sheet', 'line_title', 'column_title', 'kind'] as const;

export interface LinesIndex {
  about: string;
  columns: readonly string[];
  text_columns: readonly string[];
  /** HRSA's table codes, each with a plain label of ClinX's own. */
  table_labels: Record<string, string>;
  texts: string[];
  years: Record<string, (string | number)[][]>;
}

/**
 * /data/health-centers/records/lines.json: the dictionary of lines for each year, in the order of
 * HRSA's sheets. A title is long and repeats on many rows, so each distinct text is written once in
 * `texts` and a row holds its place in that list.
 */
export function linesIndex(): LinesIndex {
  const texts: string[] = [];
  const at = new Map<string, number>();
  const place = (value: string): number => {
    let i = at.get(value);
    if (i === undefined) {
      i = texts.length;
      texts.push(value);
      at.set(value, i);
    }
    return i;
  };
  const years: Record<string, (string | number)[][]> = {};
  for (const year of recordsSource().years) {
    years[String(year)] = linesOf(year).map((l) => [l.uiid, place(l.table), place(l.sheet), l.line, place(l.lineTitle), l.column, place(l.columnTitle), place(l.kind)]);
  }
  return {
    about:
      'The lines and columns of each year’s Uniform Data System report, with HRSA’s own titles. Each row of a year is one cell of the report, in the order of `columns`. The columns named in `text_columns` hold a number: the place of the text in `texts`, counted from 0. A cell’s id (uiid) is the key of its value in a health center’s own file. The table codes are HRSA’s; `table_labels` gives a plain label of ClinX’s own for each.',
    columns: LINE_COLUMNS,
    text_columns: LINE_TEXT_COLUMNS,
    table_labels: { ...TABLE_LABELS },
    texts,
    years,
  };
}

export interface SetsIndex {
  about: string;
  records: Record<string, unknown>;
  funding: Record<string, unknown>;
  areas: Record<string, unknown>;
  home: string;
}

/** /data/health-centers/index.json: the three health center sets, with the day each was read. */
export function setsIndex(): SetsIndex {
  const source = recordsSource();
  const latestBook = source.workbooks[String(source.latest_year)];
  if (!latestBook) throw new Error(`No workbook facts for ${source.latest_year}`);
  const funding = getFunding();
  const areas = getIndex();
  const states = JSON.parse(areasFile('states.json')) as { notes: Record<string, string> };
  return {
    about: 'The three sets of public health center information on ClinX, with the day each was read from the agency’s files. The counts are counts of rows in those files on that day.',
    records: {
      what: 'What each health center reported to HRSA in the Uniform Data System, as HRSA publishes it in one workbook for each year.',
      source: 'HRSA, Health Center Program Uniform Data System, awardee workbooks',
      years: [...source.years],
      latest_year: source.latest_year,
      states: [...source.states],
      health_centers: source.health_centers,
      read_on: latestBook.retrieved_utc.slice(0, 10),
      hrsa_last_refreshed: latestBook.report_last_refreshed,
      page: RECORDS_PATH,
      index: ASSISTANT_FILES.records,
      lines: ASSISTANT_FILES.lines,
    },
    funding: {
      what: 'HRSA’s funding opportunities as listed on Grants.gov, the Federal Register documents that name the Health Center Program, and the dated lines both give.',
      source: 'Grants.gov and the Federal Register',
      read_on: funding.day,
      opportunities: funding.opportunities.length,
      register_documents: funding.register.length,
      dated_lines: funding.events.length,
      page: FUNDING_HOME,
      files: FUNDING_DATA,
    },
    areas: {
      what: 'HRSA’s shortage designations (primary care, dental health and mental health shortage areas, and medically underserved areas and populations) and its list of health center sites, with what changed in the last 365 days.',
      source: 'HRSA Data Warehouse download files',
      read_on: areas.snapshot_day,
      window_start: areas.window_start,
      window_end: areas.window_end,
      states_and_territories: areas.states.length,
      national_counts: areas.national_counts,
      notes: states.notes,
      page: AREAS_PATH,
      files: AREAS_DOWNLOADS,
    },
    home: HC_HOME,
  };
}
