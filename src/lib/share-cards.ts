/**
 * The pictures a link to a page shows when it is shared (1200 by 630), one for each section of the
 * site. The list is scripts/brand/share-cards.json, which also draws them; a page uses the card of
 * its section unless it names another. Pages outside every section use the home page's card.
 */
import list from '../../scripts/brand/share-cards.json';

export interface ShareCard {
  id: string;
  /** The address of the picture, for example /brand/share/home.png. */
  path: string;
  width: number;
  height: number;
  alt: string;
}

const entries = list.cards as { id: string; alt: string; paths: string[] }[];

export const SHARE_CARDS: readonly ShareCard[] = entries.map((c) => ({ id: c.id, path: `/brand/share/${c.id}.png`, width: list.width, height: list.height, alt: c.alt }));

/** The card with this id. */
export function shareCard(id: string): ShareCard {
  const card = SHARE_CARDS.find((c) => c.id === id);
  if (!card) throw new Error(`No share card named ${id}`);
  return card;
}

/** The card of the section a page is in: "/bills/ri/" uses the bills card. */
export function shareCardFor(pathname: string): ShareCard {
  for (const c of entries) {
    for (const p of c.paths) {
      if (p === '/' ? pathname === '/' : pathname.startsWith(p)) return shareCard(c.id);
    }
  }
  return shareCard('home');
}
