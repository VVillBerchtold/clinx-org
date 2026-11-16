/**
 * The one map of states that every section of the site draws: a grid of tiles, one for each state
 * and the District of Columbia, in the familiar layout of the United States.
 *
 * In plain words: a section says, for each state, how its tile is drawn (filled, outlined or plain),
 * where it leads and what a screen reader should say. This file turns that into one inline picture.
 * A section can also ask for a row of territories under the states. Each tile carries a short class
 * with its own code (t-ri), which the panel beside the map uses to show that state's figures while
 * the pointer or the keyboard is on the tile (src/components/StateMap.astro, src/styles/state-map.css).
 * No script is involved, and every figure a panel shows is also in the page's table.
 */
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

/** Tile map geometry in SVG units. */
export const TILE = { size: 40, gap: 6, cols: 11, rows: 8, radius: 9 } as const;

/** How a tile is drawn. `has` is filled, `next` is outlined, `none` is plain. */
export type TileTone = 'has' | 'next' | 'none';

export interface MapTile {
  tone: TileTone;
  /** Where the tile leads. A tile with no address is not a link. */
  href?: string;
  /** What a screen reader says after the state's code and name, for example "37 health centers". */
  label?: string;
  /** True for the state whose page the map is on. */
  current?: boolean;
  /** True when the panel beside the map has a card for this tile. */
  card?: boolean;
  /** True for a tile that should carry the slow ring the Scorecard draws around a state it shows. */
  ring?: boolean;
}

/**
 * The places HRSA's files list beside the states: five territories and the three freely associated
 * states. They sit in one row under the map when a section asks for them.
 */
export const TERRITORIES: readonly StateTile[] = (
  [
    ['AS', 'American Samoa'],
    ['GU', 'Guam'],
    ['MP', 'Northern Mariana Islands'],
    ['PR', 'Puerto Rico'],
    ['VI', 'U.S. Virgin Islands'],
    ['FM', 'Federated States of Micronesia'],
    ['MH', 'Marshall Islands'],
    ['PW', 'Palau'],
  ] as const
).map(([code, name], i) => ({ code, name, col: 1.5 + i, row: TILE.rows }));

export const TERRITORY_ROW_LABEL = 'Territories and freely associated states';

/** Every place a map can show: the states, then the territories. */
export const MAP_PLACES: readonly StateTile[] = [...STATES, ...TERRITORIES];

const esc = (t: string): string => t.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export interface StateMapOptions {
  /** A unique id on the page, for the picture's title and description. */
  id: string;
  /** The picture's name, for a screen reader. */
  title: string;
  /** One or two sentences that say what the picture shows, for a screen reader. */
  desc: string;
  /** How each tile is drawn. Called once for each place on the map. */
  tile: (place: StateTile) => MapTile;
  /** True to add the row of territories under the states. */
  territories?: boolean;
  /** Extra class names on the picture, for a section's own colours. */
  class?: string;
}

/** Room around the grid, so a ring or a thick outline is never cut off. */
const PAD = 10;
/** The space between the last row of states and the row of territories, with its label. */
const TERRITORY_GAP = 34;

/** The map as inline SVG. */
export function stateMapSvg(options: StateMapOptions): string {
  const { id, title, desc, tile, territories = false } = options;
  const step = TILE.size + TILE.gap;
  const width = TILE.cols * step - TILE.gap + PAD * 2;
  const statesHeight = TILE.rows * step - TILE.gap + PAD * 2;
  const height = territories ? statesHeight + TERRITORY_GAP + TILE.size : statesHeight;
  const classes = ['tilemap', 'statemap-svg', options.class].filter(Boolean).join(' ');

  const parts: string[] = [
    `<svg class="${classes}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="group" aria-labelledby="${id}-t ${id}-d">`,
    `<title id="${id}-t">${esc(title)}</title>`,
    `<desc id="${id}-d">${esc(desc)}</desc>`,
  ];
  if (territories) {
    parts.push(`<text class="row-label" x="${PAD}" y="${statesHeight + TERRITORY_GAP - 22}">${esc(TERRITORY_ROW_LABEL)}</text>`);
  }
  for (const place of territories ? MAP_PLACES : STATES) {
    const outside = place.row >= TILE.rows;
    const x = PAD + place.col * step;
    const y = outside ? statesHeight + TERRITORY_GAP - PAD : PAD + place.row * step;
    const t = tile(place);
    const half = TILE.gap / 2;
    // A clear square a little larger than the tile, so the pointer never falls between two tiles.
    const reach = `<rect class="reach" x="${x - half}" y="${y - half}" width="${step}" height="${step}"/>`;
    const ring = t.ring ? `<rect class="ring" x="${x}" y="${y}" width="${TILE.size}" height="${TILE.size}" rx="${TILE.radius}"/>` : '';
    const rect = `<rect class="tile" x="${x}" y="${y}" width="${TILE.size}" height="${TILE.size}" rx="${TILE.radius}"/>`;
    const abbr = `<text class="abbr" x="${x + TILE.size / 2}" y="${y + TILE.size / 2 + 4.5}" text-anchor="middle">${place.code}</text>`;
    const names = ['tile-g', t.tone, t.current ? 'here' : '', t.card ? 'tip' : '', `t-${place.code.toLowerCase()}`, `r${Math.min(place.row, TILE.rows)}`].filter(Boolean).join(' ');
    const inside = `${reach}${ring}${rect}${abbr}`;
    if (t.href) {
      const label = `${place.code}, ${esc(place.name)}${t.label ? `: ${esc(t.label)}` : ''}`;
      parts.push(`<a class="${names}" href="${esc(t.href)}" aria-label="${label}"${t.current ? ' aria-current="page"' : ''}>${inside}</a>`);
    } else {
      parts.push(`<g class="${names}">${inside}</g>`);
    }
  }
  parts.push('</svg>');
  return parts.join('');
}

/** The names of the places with a tone, A to Z, for a picture's description. */
export function placesWith(tone: TileTone, tile: (place: StateTile) => MapTile, territories = false): string[] {
  return (territories ? MAP_PLACES : STATES)
    .filter((p) => tile(p).tone === tone)
    .map((p) => p.name)
    .sort((a, b) => a.localeCompare(b, 'en'));
}

/** One card of the panel beside a map: a state's figures, shown while its tile is pointed at. */
export interface MapCard {
  code: string;
  name: string;
  /** A short line over the name, for example "Reports shown". */
  kicker?: string;
  /** Headings of the figure columns, when the rows have more than one figure. */
  columns?: readonly string[];
  /** The figures: a label and one value for each column (or a single value). */
  rows?: readonly { label: string; values: readonly string[] }[];
  /** A sentence under the figures. */
  note?: string;
  /** What selecting the tile does, for example "Select the tile to open Rhode Island". */
  go?: string;
}

/** What a panel shows before a tile is pointed at. */
export type RestCard = Omit<MapCard, 'code' | 'name'> & { name?: string };
