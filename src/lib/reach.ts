/**
 * Contract pharmacy reach on one day (/registry/reach/ and one page per state).
 *
 * The figures come from src/data/registry/reach.json, written by tools/reach.py in the registry
 * repository from the national registry copy of the day it names. Each active arrangement is put in
 * one band by comparing the pharmacy's state with the entity's street address: the same state, a
 * neighbouring state (the two share a stretch of border) or farther. Nothing here is estimated.
 */
import raw from '../data/registry/reach.json';
import { MAP_PLACES, stateMapSvg, type MapCard, type MapTile, type StateTile } from './state-map';

export const REACH_HOME = '/registry/reach/';
export const BANDS = ['same', 'neighbor', 'farther'] as const;
export type Band = (typeof BANDS)[number];
export const BAND_LABEL: Record<Band, string> = { same: 'Same state', neighbor: 'Neighbouring state', farther: 'Farther away' };
export const GROUPS = ['CVS', 'Walgreens', 'Walmart', 'Mail-order and specialty', 'Other'] as const;
export const TYPES = ['Health centers', 'Hospitals', 'Other federal grantees'] as const;

export type Bands = Record<Band, number>;
export interface PlaceReach {
  entities: number;
  holders: number;
  arrangements: number;
  pharmacies: number;
  bands: Bands;
  states_reached: number;
  to: [string, number][];
  chains: Record<string, number>;
  in_arrangements: number;
  in_entities: number;
  in_states: number;
  from: [string, number][];
}
export interface Reach {
  taken_on: string;
  source: { file: string; sha256: string };
  rules: { neighbors: Record<string, string[]> };
  national: { entities: number; holders: number; arrangements: number; bands: Bands; no_pharmacy_state: number };
  chains: Record<string, Bands>;
  types: Record<string, Bands>;
  states: Record<string, PlaceReach>;
}

export const R = raw as unknown as Reach;

export const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
/** A share as a whole percent; a share above 0 that rounds to 0 is printed as "under 1%". */
export const pct = (part: number, whole: number): string => {
  if (whole <= 0) return '–';
  const p = (part / whole) * 100;
  return p > 0 && p < 0.5 ? 'under 1%' : `${Math.round(p)}%`;
};
export const share = (part: number, whole: number): number => (whole > 0 ? part / whole : 0);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** The registry copy's day, the way the site writes dates: 23 November 2026. */
export const dayLong = (iso: string = R.taken_on): string => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

export const placeName = (code: string): string => MAP_PLACES.find((p) => p.code === code)?.name ?? code;
/** The places with a page: every state, DC and territory the registry lists an entity in, A to Z by name. */
export const reachPlaces = (): string[] => Object.keys(R.states).sort((a, b) => placeName(a).localeCompare(placeName(b), 'en'));
export const reachPath = (code: string): string => `${REACH_HOME}${code.toLowerCase()}/`;
export const neighborsOf = (code: string): string[] => R.rules.neighbors[code] ?? [];

/** The bands of a place with each one's share of the total, in band order. */
export function bandShares(b: Bands): { band: Band; n: number; share: number }[] {
  const total = BANDS.reduce((s, k) => s + b[k], 0);
  return BANDS.map((band) => ({ band, n: b[band], share: share(b[band], total) }));
}

/** How the main map draws a place: filled when most of its arrangements are with a pharmacy outside it. */
export function hubTone(code: string): MapTile['tone'] {
  const p = R.states[code];
  if (!p || p.arrangements === 0) return 'none';
  return p.bands.same < p.arrangements / 2 ? 'has' : 'next';
}

/** The main map; on a state's page the same map marks that state and serves as the way to the others. */
export function hubMapSvg(id: string, current?: string): string {
  return stateMapSvg({
    id,
    title: 'Contract pharmacy reach, by state',
    desc: `Filled: most of the state's contract pharmacy arrangements are with a pharmacy in another state. Outlined: half or more are with a pharmacy in the same state. Each state leads to its page. Registry of ${dayLong()}.`,
    territories: true,
    tile: (place: StateTile) => {
      const p = R.states[place.code];
      if (!p) return { tone: 'none' };
      return {
        tone: hubTone(place.code),
        href: reachPath(place.code),
        label: p.arrangements ? `${pct(p.bands.same, p.arrangements)} in the same state` : 'no contract pharmacies',
        card: true,
        current: place.code === current,
      };
    },
  });
}

/** The panel cards of the main map: the same three shares the table gives. */
export function hubCards(): MapCard[] {
  return reachPlaces().map((code) => {
    const p = R.states[code]!;
    return {
      code,
      name: placeName(code),
      kicker: `${fmt(p.arrangements)} arrangements`,
      rows: p.arrangements ? bandShares(p.bands).map((s) => ({ label: BAND_LABEL[s.band], values: [pct(s.n, p.arrangements)] })) : [],
      ...(p.in_arrangements ? { note: `${fmt(p.in_arrangements)} more are held here by entities in other states.` } : {}),
      go: `Select to open ${placeName(code)}`,
    };
  });
}

/** A state's own map: the state filled, and outlined the states its entities' pharmacies are in. */
export function toMapSvg(code: string, id: string): string {
  const p = R.states[code]!;
  const listed = new Map(p.to);
  return stateMapSvg({
    id,
    title: `Where ${placeName(code)}'s contract pharmacies are`,
    desc: `${placeName(code)} is filled. Outlined: the states with the most of its entities' contract pharmacies, as listed beside the map.`,
    territories: true,
    tile: (place: StateTile) => {
      const here = place.code === code;
      const n = listed.get(place.code);
      const link = R.states[place.code] && !here ? { href: reachPath(place.code) } : {};
      if (!here && !n) return { tone: 'none', ...link };
      return {
        tone: here ? 'has' : 'next',
        current: here,
        ...link,
        label: here ? `${fmt(p.bands.same)} in the same state` : `${fmt(n!)} arrangements`,
      };
    },
  });
}

/** The width of a bar, in whole percent of the longest bar, at least 1 so a small count still shows. */
export const barWidth = (n: number, max: number): number => (max > 0 && n > 0 ? Math.max(1, Math.round((n / max) * 100)) : 0);

/** One row per place for the download. */
export const STATE_COLUMNS = ['state', 'name', 'entities', 'entities_holding', 'arrangements', 'pharmacies', 'same_state', 'neighbouring_state', 'farther', 'states_reached', 'held_by_other_states', 'entities_from_other_states', 'other_states_holding'] as const;
export function statesCsv(): string {
  const cell = (v: string | number): string => {
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const lines = reachPlaces().map((code) => {
    const p = R.states[code]!;
    return [code, placeName(code), p.entities, p.holders, p.arrangements, p.pharmacies, p.bands.same, p.bands.neighbor, p.bands.farther, p.states_reached, p.in_arrangements, p.in_entities, p.in_states].map(cell).join(',');
  });
  return [STATE_COLUMNS.join(','), ...lines].join('\n') + '\n';
}

/** A bar split into the three bands, as SVG (no inline style, so the content policy needs no exception). */
export function stackSvg(b: Bands): string {
  let x = 0;
  const parts = bandShares(b).map((s) => {
    const w = s.share * 100;
    const r = `<rect class="b-${s.band}" x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="10"/>`;
    x += w;
    return r;
  });
  return `<svg class="rc-bar" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true" focusable="false">${parts.join('')}</svg>`;
}

/** A single bar of `n` against `max`, as SVG. */
export function barSvg(n: number, max: number, cls = 'b-one'): string {
  return `<svg class="rc-one" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect class="${cls}" x="0" y="0" width="${barWidth(n, max)}" height="10"/></svg>`;
}
