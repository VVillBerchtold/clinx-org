// The shapes of the page-address rule (see pages.js).

type Rec = { filing_id: string; state: string; reporting_year: string; record_kind: string; form: string };

/** The part of a filing id after the state and the year. */
export declare function filingSlug(filing: Pick<Rec, 'filing_id' | 'state' | 'reporting_year'>): string;
/** The latest year of the state's own reports, for each state and form. */
export declare function latestYears(filings: Array<Pick<Rec, 'state' | 'form' | 'reporting_year' | 'record_kind'>>): Map<string, string>;
/** The address on the site, starting with a slash, of the page that shows this record. */
export declare function filingPath(filing: Pick<Rec, 'filing_id' | 'state' | 'reporting_year' | 'record_kind' | 'form'>, latest: Map<string, string>): string;
