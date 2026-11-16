// Where a report is shown on clinx.org.
//
// In plain words: every record in the filed reports table has a page on the site. A filer's own
// report has a page of its own, at an address made from its filing id. A row a state printed
// about an entity, or a state's totals, is shown on the state's page; when the state has more
// than one year of such reports, the latest year is on the state's page and each earlier year
// has a page at the state's address followed by the year. The site builds its pages from the same
// rule (it imports this file), so an address given here is the address of a real page.
//
// This file uses nothing that only one kind of computer has.

/** The part of a filing id after the state and the year: `oh-2025-cah361302` is `cah361302`. */
export function filingSlug(filing) {
  const id = String(filing.filing_id).toLowerCase();
  const prefix = `${String(filing.state).toLowerCase()}-${filing.reporting_year}-`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

/** The latest year of the state's own reports, for each state and form: records that are not a filer's own filing. */
export function latestYears(filings) {
  const latest = new Map();
  for (const f of filings) {
    if (f.record_kind === 'filing') continue;
    const key = `${f.state}|${f.form}`;
    if (!latest.has(key) || String(f.reporting_year) > latest.get(key)) latest.set(key, String(f.reporting_year));
  }
  return latest;
}

/** The address, on the site, of the page that shows this record. `latest` comes from `latestYears`. */
export function filingPath(filing, latest) {
  const state = String(filing.state).toLowerCase();
  if (filing.record_kind === 'filing') return `/scorecard/${state}/${filingSlug(filing)}/`;
  const newest = latest.get(`${filing.state}|${filing.form}`);
  return newest === undefined || String(filing.reporting_year) === newest ? `/scorecard/${state}/` : `/scorecard/${state}/${filing.reporting_year}/`;
}
