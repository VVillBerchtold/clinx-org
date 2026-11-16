/**
 * The front page of the health centers section, and the pages that mention it. Every number here is read
 * from the copies of the three parts (the records, the funding calendar and the shortage areas) when the
 * site is built; none is typed by hand. A count is a count of rows in the agencies' files on the day shown.
 */
import { AREAS_PATH, AREAS_DOWNLOADS, day as areasDay, getIndex, num, rawFile as areasFile, stateCodes, SERIES, SERIES_INFO } from './hc-areas';
import { FUNDING_FEED, FUNDING_HOME, DOWNLOADS as FUNDING_DOWNLOADS, ahead, dayText, downloadPath, fundingFile, getFunding } from './hc-funding';
import { DATA_PATH, DOWNLOADS as RECORDS_DOWNLOADS, RECORDS_PATH, headerRows, listRows, rawFile as recordsFile, recordsSource, refreshDay } from './hc-records';
import { stateName } from './states';

export { HC_HOME, HC_NAME } from './site';

export interface Fact {
  label: string;
  value: string;
}

export interface PartCard {
  id: 'records' | 'funding' | 'areas';
  label: string;
  title: string;
  say: string;
  facts: Fact[];
  href: string;
  go: string;
}

/** One downloadable file: its name, address, plain sentence, and the text served at that address. */
export interface HcFile {
  name: string;
  href: string;
  what: string;
  text: string;
}
export interface HcFileGroup {
  id: 'records' | 'funding' | 'areas';
  title: string;
  page: string;
  day: string;
  files: HcFile[];
  /** Said once under the group's list. */
  note: string;
}

/** The three cards of the front page. */
export function partCards(): PartCard[] {
  const source = recordsSource();
  const rows = listRows();
  const byState = [...new Set(rows.map((r) => r.state))].sort((a, b) => stateName(a).localeCompare(stateName(b), 'en'));
  const inState = byState.map((code) => `${num(rows.filter((r) => r.state === code).length)} in ${stateName(code)}`);
  const funding = getFunding();
  const forecasts = funding.opportunities.filter((o) => o.status === 'forecasted').length;
  const posted = funding.opportunities.length - forecasts;
  const index = getIndex();
  const primary = index.national_counts.designations['hpsa-pc'];
  return [
    {
      id: 'records',
      label: 'Public records',
      title: 'What each health center reported',
      say: 'Each health center’s yearly report to HRSA, line by line in HRSA’s own words: patients, services, staff, costs and revenue.',
      facts: [
        { label: 'Health centers', value: `${num(rows.length)} (${inState.join(', ')})` },
        { label: 'Report years', value: `${source.years[0]} to ${source.latest_year}` },
        { label: 'HRSA refreshed the latest file', value: refreshDay(source.workbooks[String(source.latest_year)]!.report_last_refreshed) },
      ],
      href: RECORDS_PATH,
      go: 'Open the records',
    },
    {
      id: 'funding',
      label: 'Funding and deadlines',
      title: 'HRSA opportunities on one calendar',
      say: 'The dates of HRSA’s funding opportunities and of the Federal Register documents that name health centers, in date order, with a calendar file.',
      facts: [
        { label: 'Opportunities', value: `${num(funding.opportunities.length)} (${num(forecasts)} forecast, ${num(posted)} posted)` },
        { label: 'Dated events from the day of the files on', value: num(ahead(funding).length) },
        { label: 'Federal Register documents', value: num(funding.register.length) },
      ],
      href: FUNDING_HOME,
      go: 'Open the calendar',
    },
    {
      id: 'areas',
      label: 'Shortage areas',
      title: 'What HRSA designates, state by state',
      say: 'Shortage areas and underserved areas that HRSA has designated, the designations it proposes to withdraw, what changed in the last year, and the health center sites it lists.',
      facts: [
        { label: 'States and territories', value: num(stateCodes().filter((c) => c !== 'XX').length) },
        { label: `${SERIES_INFO[SERIES[0]].short} designations with the status Designated`, value: num(primary.Designated.designations) },
        { label: `${SERIES_INFO[SERIES[0]].short} designations with the status Proposed For Withdrawal`, value: num(primary['Proposed For Withdrawal'].designations) },
      ],
      href: AREAS_PATH,
      go: 'Open the shortage areas',
    },
  ];
}

/** The day of each part's files, for the line under the cards. */
export function partDays(): { records: string; funding: string; areas: string } {
  const source = recordsSource();
  const latest = source.workbooks[String(source.latest_year)]!;
  return {
    records: refreshDay(latest.report_last_refreshed),
    funding: dayText(getFunding().day),
    areas: areasDay(getIndex().snapshot_day),
  };
}

/** The files the three parts offer, grouped by part, as the Data page and the front page list them. */
export function fileGroups(): HcFileGroup[] {
  const funding = getFunding();
  const index = getIndex();
  return [
    {
      id: 'records',
      title: 'Public records',
      page: RECORDS_PATH,
      day: `HRSA’s latest file was refreshed on ${refreshDay(recordsSource().workbooks[String(recordsSource().latest_year)]!.report_last_refreshed)}`,
      files: [
        { name: 'health-centers.csv', href: RECORDS_DOWNLOADS.centers, what: 'One row for each health center and year: name, address, funding flags and the number of sites, as HRSA published them', text: recordsFile('health-centers.csv') },
        { name: 'lines.csv', href: RECORDS_DOWNLOADS.lines, what: 'The lines and columns of the reports: HRSA’s table, line and column titles, and the kind of value each holds', text: recordsFile('lines.csv') },
      ],
      note: `One file for each health center, with all its years and every cell address, is linked from that health center’s pages. There are ${num(new Set(headerRows().map((h) => h.key)).size)}, at ${DATA_PATH}centers/ followed by the center’s number and .json.`,
    },
    {
      id: 'funding',
      title: 'Funding and deadlines',
      page: FUNDING_HOME,
      day: `Files of ${dayText(funding.day)}`,
      files: FUNDING_DOWNLOADS.map((d) => ({ name: d.name, href: downloadPath(d.name), what: d.what.replace(/\.$/, ''), text: fundingFile(d.name) })),
      note: `The calendar file, ${FUNDING_FEED}, holds the ${num(funding.events.length)} dated events as all-day events that a calendar app can open or subscribe to.`,
    },
    {
      id: 'areas',
      title: 'Shortage areas',
      page: AREAS_PATH,
      day: `Files of ${areasDay(index.snapshot_day)}`,
      files: [
        { name: 'states.json', href: `${AREAS_DOWNLOADS}states.json`, what: 'Counts for every state and territory', text: areasFile('states.json') },
        { name: 'recent.csv', href: `${AREAS_DOWNLOADS}recent.csv`, what: 'Every designated, withdrawn and updated event of the last 365 days, all states', text: areasFile('recent.csv') },
        { name: 'proposed.csv', href: `${AREAS_DOWNLOADS}proposed.csv`, what: 'Every designation HRSA marks Proposed For Withdrawal, all states', text: areasFile('proposed.csv') },
        { name: 'sites-recent.csv', href: `${AREAS_DOWNLOADS}sites-recent.csv`, what: 'Health center sites added to scope in the last 365 days, all states', text: areasFile('sites-recent.csv') },
        { name: 'changes.csv', href: `${AREAS_DOWNLOADS}changes.csv`, what: 'Changes between ClinX’s copies, all states', text: areasFile('changes.csv') },
      ],
      note: `One file for each state or territory is at ${AREAS_DOWNLOADS}states/ followed by the state code and .json. There are ${num(stateCodes().length)}.`,
    },
  ];
}

/** A file's size in plain units. */
export function sizeOf(text: string): string {
  const bytes = new TextEncoder().encode(text).length;
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The SHA-256 of a text, in hexadecimal. */
export async function sha256Of(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
