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
export type Visibility = 'posted' | 'named' | 'partial' | 'planned' | 'totals' | 'unconfirmed';

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
  partial: 'Some figures by filer',
  planned: 'Posting set by law',
  totals: 'State totals only',
  unconfirmed: 'Not yet confirmed',
};

/**
 * Only states that are in the dataset, or whose reporting law was read at its source.
 * Each "law" entry was checked against the pages in `sources` on 11 November 2026.
 */
export const STATE_REGISTRY: Readonly<Record<string, StateEntry>> = {
  RI: { status: 'live', href: '/scorecard/ri/', summary: 'Calendar year 2025' },
  CO: {
    status: 'law',
    visibility: 'unconfirmed',
    stands: 'Hospitals add 340B figures to the yearly report they send the state, under a law passed in 2025. Whether the figures are published for each hospital is not yet confirmed.',
    sources: [{ label: 'Senate Bill 25-071', href: 'https://content.leg.colorado.gov/sites/default/files/2025a_071_signed.pdf' }],
  },
  ID: {
    status: 'law',
    visibility: 'totals',
    stands: 'Covered entities report by April 1 each year. The filings are confidential. The State Controller publishes the figures added together by November 15.',
    sources: [{ label: 'Idaho Code 41-351', href: 'https://legislature.idaho.gov/statutesrules/idstat/Title41/T41CH3/SECT41-351/' }],
  },
  IN: {
    status: 'law',
    visibility: 'totals',
    stands: 'Reports are due to the Department of Health by April 1 each year. The department says the figures are added together in a yearly public report.',
    sources: [{ label: "The department's page", href: 'https://www.in.gov/health/cshcr/reports-on-healthcare-facilities/' }],
  },
  ME: {
    status: 'law',
    visibility: 'planned',
    stands: 'Hospitals report each year to the Maine Health Data Organization. The law tells the organization to post each report on its website.',
    sources: [{ label: '22 M.R.S. 1728', href: 'https://legislature.maine.gov/statutes/22/title22sec1728.html' }],
  },
  MN: {
    status: 'live',
    href: '/scorecard/mn/',
    summary: "2024 data · one figure per entity, from the state's report",
    visibility: 'named',
    stands: "Minnesota's law has the Department of Health collect data from covered entities and report on it each year to the legislature. The entities' own reports to the department are not public. What is public is the department's report, which prints one net 340B revenue figure for each entity it names.",
    sources: [
      { label: 'Minn. Stat. 62J.461', href: 'https://www.revisor.mn.gov/statutes/cite/62J.461' },
      { label: "The department's report (PDF)", href: 'https://www.health.mn.gov/data/340b/docs/2025report.pdf' },
    ],
  },
  OH: {
    status: 'law',
    visibility: 'planned',
    stands: 'Covered entities report to the Department of Health by July 1 each year, starting in 2026. The law tells the department to post what is reported on its website.',
    sources: [{ label: 'Ohio Revised Code 3701.88', href: 'https://codes.ohio.gov/ohio-revised-code/section-3701.88' }],
  },
  VT: {
    status: 'live',
    href: '/scorecard/vt/',
    summary: 'Fiscal year 2025 · marked draft by the state',
    visibility: 'posted',
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
    visibility: 'partial',
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
