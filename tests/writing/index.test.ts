import { describe, expect, it } from 'vitest';
import page from '../../src/pages/writing/index.astro?raw';
import layout from '../../src/layouts/Base.astro?raw';

// The Writing page lists every piece by hand. This scan makes sure none is left off, and that
// each link on the page leads to a page that exists.
const pieces = Object.keys(import.meta.glob('../../src/pages/writing/*/index.astro')).map((path) => `/writing/${path.split('/').at(-2)}/`);
const pages = new Set(
  Object.keys(import.meta.glob('../../src/pages/**/*.astro')).map((path) =>
    path
      .replace('../../src/pages', '')
      .replace(/index\.astro$/, '')
      .replace(/\.astro$/, '/'),
  ),
);

describe('Writing: the list of pieces', () => {
  it('finds the pieces', () => {
    expect(pieces.length).toBeGreaterThanOrEqual(4);
  });

  it('lists every piece', () => {
    for (const href of pieces) expect(page.includes(`href: '${href}'`), `the Writing page does not list ${href}`).toBe(true);
  });

  it('links only to pages that exist', () => {
    const hrefs = [...page.matchAll(/href(?:=|: )["']([^"']+)["']/g)].map((m) => m[1] ?? '');
    // Each piece, the tool and the demo the pieces end at, and the Tools page
    expect(hrefs.length).toBeGreaterThanOrEqual(pieces.length + 3);
    for (const href of hrefs) expect(pages.has(href), `${href} is not a page`).toBe(true);
  });

  it('says what each piece ends at', () => {
    expect(page.split('goesWith: ').length - 1).toBe(pieces.length);
  });
});

describe('The phone menu', () => {
  it('keeps a section with pages of its own behind one row that opens', () => {
    expect(layout).toContain("class:list={['nav-fold', { on: item.items.some(here) }]} open={item.items.some(here)}");
  });
});
