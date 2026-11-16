/**
 * The states, and where each stands on this site.
 * A state is "live" only when its filings are in the dataset. A live state may still carry the facts about its law and its posting page. Nothing here is typed from memory
 * about a state's law: "watch" entries carry the state's own page as their source.
 */

/**
 * live: its filings are in the dataset.
 * law:  the state has a 340B reporting law in force, read from the law itself.
 * none: neither.
 */
export type StateStatus = 'live' | 'law' | 'none';

/** What the public can see of a state's filings, as far as the law or the state's own page says. */
export type Visibility = 'posted' | 'named' | 'partial' | 'planned' | 'totals' | 'unconfirmed' | 'none';

/**
 * The kind of reporting a state has, by what the state itself makes public.
 * own-reports:            each filer's own report is posted.
 * named-in-state-report:  one state report with a figure for each named entity.
 * state-totals:           one state report with totals only (or, by the law, one to come).
 * not-posted-yet:         reports are required and none is public yet.
 */
export type ReportingGroup = 'own-reports' | 'named-in-state-report' | 'state-totals' | 'not-posted-yet';

export interface GroupInfo {
  id: ReportingGroup;
  label: string;
  /** What this kind of source can and cannot tell a reader. */
  description: string;
}

/** The four kinds, in the order the pages show them: from the most a reader can see to nothing yet. */
export const REPORTING_GROUPS: readonly GroupInfo[] = [
  {
    id: 'own-reports',
    label: "Each filer's own report is posted",
    description:
      'The state posts the report each covered entity sent in. A reader can see every line a filer reported, and the page it is on. Each state has its own form, so figures from two states are shown side by side only as each state printed them.',
  },
  {
    id: 'named-in-state-report',
    label: 'One state report with a figure for each named entity',
    description:
      "The state puts the figures in one report of its own and names the entities in it. A reader can see one figure for each entity named. The entities' own reports are not public, so the detail behind a figure is out of reach.",
  },
  {
    id: 'state-totals',
    label: 'One state report with totals only',
    description:
      'The state publishes figures added together for the whole state. A reader can see the state totals and nothing about any one hospital or health center. Where a law sets this up and no report has been posted yet, the entry says so.',
  },
  {
    id: 'not-posted-yet',
    label: 'Reports are required, none is public yet',
    description:
      'A reporting law is in force or about to be, and covered entities must report. The state has not made a report public, so there is nothing to copy yet. Each entry names the official source where one will appear.',
  },
];

export const GROUP_IDS: readonly ReportingGroup[] = REPORTING_GROUPS.map((g) => g.id);

export interface StateTile {
  code: string;
  name: string;
  /** Column and row in the tile map (the familiar grid layout of the United States). */
  col: number;
  row: number;
}

const GRID: readonly (readonly [string, string, number, number])[] = [
  ['AK', 'Alaska', 0, 0], ['ME', 'Maine', 10, 0],
  ['VT', 'Vermont', 9, 1], ['NH', 'New Hampshire', 10, 1],
  ['WA', 'Washington', 0, 2], ['ID', 'Idaho', 1, 2], ['MT', 'Montana', 2, 2], ['ND', 'North Dakota', 3, 2], ['MN', 'Minnesota', 4, 2],
  ['IL', 'Illinois', 5, 2], ['WI', 'Wisconsin', 6, 2], ['MI', 'Michigan', 7, 2], ['NY', 'New York', 8, 2], ['RI', 'Rhode Island', 9, 2], ['MA', 'Massachusetts', 10, 2],
  ['OR', 'Oregon', 0, 3], ['NV', 'Nevada', 1, 3], ['WY', 'Wyoming', 2, 3], ['SD', 'South Dakota', 3, 3], ['IA', 'Iowa', 4, 3],
  ['IN', 'Indiana', 5, 3], ['OH', 'Ohio', 6, 3], ['PA', 'Pennsylvania', 7, 3], ['NJ', 'New Jersey', 8, 3], ['CT', 'Connecticut', 9, 3],
  ['CA', 'California', 0, 4], ['UT', 'Utah', 1, 4], ['CO', 'Colorado', 2, 4], ['NE', 'Nebraska', 3, 4], ['MO', 'Missouri', 4, 4],
  ['KY', 'Kentucky', 5, 4], ['WV', 'West Virginia', 6, 4], ['VA', 'Virginia', 7, 4], ['MD', 'Maryland', 8, 4], ['DE', 'Delaware', 9, 4],
  ['AZ', 'Arizona', 1, 5], ['NM', 'New Mexico', 2, 5], ['KS', 'Kansas', 3, 5], ['AR', 'Arkansas', 4, 5], ['TN', 'Tennessee', 5, 5],
  ['NC', 'North Carolina', 6, 5], ['SC', 'South Carolina', 7, 5], ['DC', 'District of Columbia', 8, 5],
  ['OK', 'Oklahoma', 3, 6], ['LA', 'Louisiana', 4, 6], ['MS', 'Mississippi', 5, 6], ['AL', 'Alabama', 6, 6], ['GA', 'Georgia', 7, 6],
  ['HI', 'Hawaii', 0, 7], ['TX', 'Texas', 3, 7], ['FL', 'Florida', 8, 7],
];

export const STATES: readonly StateTile[] = GRID.map(([code, name, col, row]) => ({ code, name, col, row }));

export interface StateSource {
  label: string;
  href: string;
}

export interface StateEntry {
  status: StateStatus;
  /** The kind of reporting the state has. Every state with a reporting law has one. */
  group: ReportingGroup;
  /** What a reader can get from the state today, in a sentence or two. */
  publicNow: string;
  /** For a live state: its page on this site. */
  href?: string;
  /** For a live state: what is in the scorecard, in a few words. */
  summary?: string;
  /** For a state with a reporting law: what the public can see. */
  visibility?: Visibility;
  /** For a state with a reporting law: who reports, to whom, and what is published. Facts from the sources only. */
  stands?: string;
  /** The law, and the state's own page where one was read. */
  sources?: readonly StateSource[];
  /** For a live state: a line the state's own page prints about a filer that is not in the scorecard, quoted exactly. */
  listingNote?: { quote: string; label: string; href: string };
}

export const VISIBILITY_LABEL: Readonly<Record<Visibility, string>> = {
  posted: 'Each report posted',
  named: 'Some filers named',
  partial: 'Some figures by filer, set by law',
  planned: 'Posting set by law',
  totals: 'State totals only',
  unconfirmed: 'Not yet confirmed',
  none: 'None public yet',
};

/**
 * Only states that are in the dataset, or whose reporting law was read at its source.
 * Each "law" entry was checked against the pages in `sources` between 11 and 16 November 2026;
 * Hawaii and Illinois were added from the dataset's laws table on 15 November 2026, and Illinois,
 * Indiana, Maine, Ohio and Washington were read again on 16 November 2026.
 * This is the one place these facts are typed: the pages, the home page's map note and the open file
 * 340b-reporting-states.json are all written from it.
 */
export const STATE_REGISTRY: Readonly<Record<string, StateEntry>> = {
  RI: {
    status: 'live',
    group: 'own-reports',
    href: '/scorecard/ri/',
    summary: 'Calendar year 2025',
    visibility: 'posted',
    publicNow: "Each covered entity's own report for calendar year 2025, as a PDF on the state's Form RIOAG-340B, with every schedule.",
    stands: "Rhode Island's law has each covered entity report by April 1 each year to the Governor, the Speaker of the House, the Senate President and the Auditor General. The Auditor General posts each report on its website.",
    sources: [{ label: 'R.I. Gen. Laws 5-19.3', href: 'https://webserver.rilegislature.gov/PublicLaws/law25/law25288.htm' }],
  },
  CO: {
    status: 'law',
    group: 'not-posted-yet',
    visibility: 'unconfirmed',
    publicNow: 'No 340B figure is known to be public. The first figures were due to the state on July 1, 2026, for fiscal year 2024. Whether the state will print them for each hospital has not been confirmed.',
    stands: "Hospitals add 340B figures to the community benefit report they send the Department of Health Care Policy and Financing each year, under a law passed in 2025. The figures are the hospital's 340B costs at market rates, its 340B purchase costs, its savings, and a description of how the savings are used. The department publishes a report on community benefit each year. Whether that report will show the 340B figures for each hospital is not yet confirmed.",
    sources: [
      { label: 'Senate Bill 25-071', href: 'https://content.leg.colorado.gov/sites/default/files/2025a_071_signed.pdf' },
      { label: "The department's page", href: 'https://hcpf.colorado.gov/hospital-community-benefit-accountability' },
    ],
  },
  HI: {
    status: 'law',
    group: 'state-totals',
    visibility: 'planned',
    publicNow: 'Nothing yet. The first yearly report of the figures added together is due no later than October 1, 2027.',
    stands: "From July 1, 2026, covered entities report each year to the state's hospital trade association on their use of contract pharmacies. The law has the association post a yearly report of the figures added together, the first no later than October 1, 2027.",
    sources: [{ label: 'HRS 481N-6', href: 'https://data.capitol.hawaii.gov/hrscurrent/Vol11_Ch0476-0490/HRS0481N/HRS_0481N-0006.htm' }],
  },
  ID: {
    status: 'live',
    group: 'state-totals',
    href: '/scorecard/id/',
    summary: "2025 data · statewide totals, from the state's report",
    visibility: 'totals',
    publicNow: "The State Controller's report for 2025, with the figures of all covered entities added together. It gives no figure for any one entity.",
    stands: "Idaho's law has covered entities report by April 1 each year and keeps those filings confidential. Before November 15 each year the State Controller publishes a report of the figures added together. What is public is that report.",
    sources: [
      { label: 'Idaho Code 41-351', href: 'https://legislature.idaho.gov/statutesrules/idstat/Title41/T41CH3/SECT41-351/' },
      { label: "The State Controller's report (PDF)", href: 'https://idaho-sco-central-registry-documents.s3.us-gov-west-1.amazonaws.com/340B+Program+Reports/CY2025+340B+Program+Report.pdf' },
      { label: 'Where the state lists it', href: 'https://transparent.idaho.gov/featured-resources' },
    ],
  },
  IL: {
    status: 'law',
    group: 'not-posted-yet',
    visibility: 'none',
    publicNow: 'Nothing is public yet. The first reports to the General Assembly can be expected by August 1, 2027.',
    stands:
      'Covered entities report to the General Assembly "On or before August 1, 2026 and each August 1 thereafter", under Section 20 of the act. The act was signed on August 7, 2026, after that first date, so the first reports can be expected by August 1, 2027. That is a reading of the dates; the act does not say it. Hospitals with fewer than 100 beds, critical access hospitals, safety-net hospitals and grantees start in 2029. Section 25 adds a report on 340B in Medicaid, which the Medicaid department makes by January 1, 2028.',
    sources: [{ label: 'Public Act 104-0758', href: 'https://www.ilga.gov/Legislation/PublicActs/View/104-0758' }],
  },
  IN: {
    status: 'law',
    group: 'state-totals',
    visibility: 'planned',
    publicNow: 'Nothing yet. On the Department of Health\'s page, the part for these reports says "Coming soon!" and holds no file. It was read on November 16, 2026.',
    stands: 'Reports are due to the Department of Health by April 1 each year. The law has the department publish a yearly report of the figures added together. None has been posted so far.',
    sources: [
      { label: 'IC 16-40-6 (Senate Bill 118, 2025)', href: 'https://iga.in.gov/pdf-documents/124/2025/senate/bills/SB0118/SB0118.05.ENRH.pdf' },
      { label: "The department's page", href: 'https://www.in.gov/health/cshcr/reports-on-healthcare-facilities/' },
    ],
  },
  ME: {
    status: 'live',
    group: 'state-totals',
    href: '/scorecard/me/',
    summary: "Fiscal year 2024 · statewide totals and drug lists, from the state's report",
    visibility: 'totals',
    publicNow:
      "The Maine Health Data Organization's first annual 340B report, dated April 2, 2026, for fiscal year 2024. It gives four totals for the 27 hospitals added together, a list of the most costly drugs and a list of the most frequently dispensed drugs, and each hospital's own description of how it uses the program. It has no dollar figure for a single hospital. ClinX shows the totals and both lists, and lists the hospitals' descriptions without copying them.",
    stands: 'Hospitals report each year to the Maine Health Data Organization. The law has the organization post a summary report. It does not have the organization post each hospital\'s report.',
    sources: [
      { label: '22 M.R.S. 1728', href: 'https://legislature.maine.gov/statutes/22/title22sec1728.html' },
      { label: "The organization's first annual report (PDF)", href: 'https://mhdo.maine.gov/_pdf/340B_Annual_Report_260402.pdf' },
    ],
  },
  MN: {
    status: 'live',
    group: 'named-in-state-report',
    href: '/scorecard/mn/',
    summary: "2024 data and 2023 data · one figure per entity, from the state's reports",
    visibility: 'named',
    publicNow: "The Department of Health's report to the legislature, with one net 340B revenue figure for each entity it names, and a table of statewide totals. ClinX shows two years: the report for 2024 data and the earlier one, of November 25, 2024, for 2023 data.",
    stands: "Minnesota's law has the Department of Health collect data from covered entities and report on it each year to the legislature. The entities' own reports to the department are not public. What is public is the department's report, which prints one net 340B revenue figure for each entity it names.",
    sources: [
      { label: 'Minn. Stat. 62J.461', href: 'https://www.revisor.mn.gov/statutes/cite/62J.461' },
      { label: "The department's report, 2024 data (PDF)", href: 'https://www.health.mn.gov/data/340b/docs/2025report.pdf' },
      { label: "The department's earlier report, 2023 data (PDF)", href: 'https://www.health.mn.gov/data/340b/docs/2024report.pdf' },
    ],
  },
  OH: {
    status: 'live',
    group: 'own-reports',
    href: '/scorecard/oh/',
    summary: 'Calendar year 2025 · 241 workbooks',
    visibility: 'posted',
    publicNow:
      "Since October 1, 2026 the Department of Health has posted each covered entity's report: 241 Excel workbooks for calendar year 2025, on the department's template. A workbook prints a 340B ID and no name, so ClinX names each filer as HRSA does.",
    stands: 'Covered entities report to the Department of Health by July 1 each year, starting in 2026. The law tells the department to post what is reported on its website, and it has.',
    sources: [
      { label: 'Ohio Revised Code 3701.88', href: 'https://codes.ohio.gov/ohio-revised-code/section-3701.88' },
      { label: "The department's collection of the reports", href: 'https://collection.cloudinary.com/stateofohio/c28ef875c34349e6d43fb68257a0d06d' },
    ],
  },
  VT: {
    status: 'live',
    group: 'own-reports',
    href: '/scorecard/vt/',
    summary: 'Fiscal year 2025 · marked draft by the state',
    visibility: 'posted',
    publicNow: "Each hospital's one-page financial detail for fiscal year 2025, marked draft by the state, and a free-text narrative beside it.",
    stands: "Vermont's law asks hospitals to report. Health centers and other clinics in the 340B program are not covered by it. Hospitals report to the Green Mountain Care Board by January 31 each year, and the Board posts each hospital's report.",
    sources: [
      { label: '18 V.S.A. 9406', href: 'https://legislature.vermont.gov/statutes/section/18/221/09406' },
      { label: "The Board's list of the reports", href: 'https://gmcboard.vermont.gov/node/24841' },
      { label: "The Board's page", href: 'https://gmcboard.vermont.gov/prescription-drug-affordability' },
    ],
    listingNote: {
      quote: 'Brattleboro Memorial Hospital - did not report in 2026 for FY 2025',
      label: "The Board's list of the reports",
      href: 'https://gmcboard.vermont.gov/node/24841',
    },
  },
  WA: {
    status: 'law',
    group: 'not-posted-yet',
    visibility: 'partial',
    publicNow:
      "No report under the law yet. In December 2024 the Health Care Authority published a survey report by type of provider, from 109 answers out of 500. It is a sample, so it gives no state totals, and it was not a report under this law.",
    stands: "Federally qualified health centers and hospitals report to the Health Care Authority by April 1 after each fiscal year, under a law that took effect on June 11, 2026. The authority's yearly report is to show some items for each filer and the rest by type of filer.",
    sources: [{ label: 'Chapter 227, Laws of 2026', href: 'https://lawfilesext.leg.wa.gov/biennium/2025-26/Pdf/Bills/Session%20Laws/Senate/5981-S2.SL.pdf' }],
  },
};

export function stateStatus(code: string): StateStatus {
  return STATE_REGISTRY[code]?.status ?? 'none';
}

export function stateName(code: string): string {
  const s = STATES.find((x) => x.code === code.toUpperCase());
  if (!s) throw new Error(`Unknown state: ${code}`);
  return s.name;
}

/** The states of one kind of reporting, A to Z. Only states with a reporting law have one. */
export function statesInGroup(group: ReportingGroup): StateTile[] {
  return STATES.filter((s) => STATE_REGISTRY[s.code]?.group === group).sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/** The day the facts in the registry were last read at their sources. */
export const REGISTRY_READ_ON = '2026-11-16';

export interface StatesFile {
  about: string;
  updated: string;
  groups: { id: ReportingGroup; label: string; description: string }[];
  states: {
    state: string;
    name: string;
    group: ReportingGroup;
    on_clinx: boolean;
    what_is_public: string;
    where_it_stands: string;
    scorecard_url: string | null;
    sources: { label: string; url: string }[];
  }[];
}

/**
 * The open file /data/340b-reporting-states.json, written from the registry so the facts are typed once.
 * Only states with a reporting law are listed, in the order of their kind of reporting and then A to Z.
 */
export function statesFile(siteUrl: string): StatesFile {
  return {
    about: 'The states with a 340B reporting law, grouped by what each state makes public, with what is public today and where to read it.',
    updated: REGISTRY_READ_ON,
    groups: REPORTING_GROUPS.map((g) => ({ id: g.id, label: g.label, description: g.description })),
    states: REPORTING_GROUPS.flatMap((g) =>
      statesInGroup(g.id).map((tile) => {
        const e = STATE_REGISTRY[tile.code]!;
        const onClinx = e.status === 'live' && e.href !== undefined;
        return {
          state: tile.code,
          name: tile.name,
          group: g.id,
          on_clinx: onClinx,
          what_is_public: e.publicNow,
          where_it_stands: e.stands ?? '',
          scorecard_url: onClinx ? `${siteUrl}${e.href}` : null,
          sources: (e.sources ?? []).map((src) => ({ label: src.label, url: src.href })),
        };
      }),
    ),
  };
}

/** The file exactly as it is served, so the page can print its SHA-256. */
export function statesFileText(siteUrl: string): string {
  return `${JSON.stringify(statesFile(siteUrl), null, 2)}\n`;
}

export function statesWith(status: StateStatus): StateTile[] {
  return STATES.filter((s) => stateStatus(s.code) === status).sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/** Tile map geometry in SVG units. */
export const TILE = { size: 40, gap: 6, cols: 11, rows: 8, radius: 9 } as const;

const esc = (t: string): string => t.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/**
 * The map as inline SVG. Live states are links. The same information is given as a list
 * next to the map, so the picture itself is one labelled image.
 */
export function tileMapSvg(id: string): string {
  const step = TILE.size + TILE.gap;
  const pad = 10; // room for the ring around a live tile
  const width = TILE.cols * step - TILE.gap + pad * 2;
  const height = TILE.rows * step - TILE.gap + pad * 2;
  const live = statesWith('live').map((s) => s.name);
  const law = statesWith('law').map((s) => s.name);
  const desc =
    `A grid of the 50 states and the District of Columbia. In the scorecard: ${live.join(', ') || 'none yet'}.` +
    (law.length > 0 ? ` With a 340B reporting law, not in the scorecard yet: ${law.join(', ')}.` : '');

  const parts: string[] = [
    `<svg class="tilemap" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="group" aria-labelledby="${id}-t ${id}-d">`,
    `<title id="${id}-t">States in the 340B Scorecard</title>`,
    `<desc id="${id}-d">${esc(desc)}</desc>`,
  ];
  for (const s of STATES) {
    const x = pad + s.col * step;
    const y = pad + s.row * step;
    const entry = STATE_REGISTRY[s.code];
    const status = entry?.status ?? 'none';
    const rect = `<rect class="tile" x="${x}" y="${y}" width="${TILE.size}" height="${TILE.size}" rx="${TILE.radius}"/>`;
    const text = `<text class="abbr" x="${x + TILE.size / 2}" y="${y + TILE.size / 2 + 4.5}" text-anchor="middle">${s.code}</text>`;
    if (status === 'live' && entry?.href) {
      const ring = `<rect class="ring" x="${x}" y="${y}" width="${TILE.size}" height="${TILE.size}" rx="${TILE.radius}"/>`;
      parts.push(`<a class="tile-g live r${s.row}" href="${esc(entry.href)}" aria-label="${s.code}, ${esc(s.name)}: open the scorecard">${ring}${rect}${text}</a>`);
    } else {
      parts.push(`<g class="tile-g ${status} r${s.row}">${rect}${text}</g>`);
    }
  }
  parts.push('</svg>');
  return parts.join('');
}
