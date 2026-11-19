import { describe, expect, it } from 'vitest';
import { CITE_DATA, CITE_SITE, MAKER_CITED_AS, MAKER_NAME, SITE_URL, citeLine } from '../src/lib/site';
import aboutPage from '../src/pages/about/index.astro?raw';
import dataPage from '../src/pages/data/index.astro?raw';
import homePage from '../src/pages/index.astro?raw';

/** The line a reader copies to cite the site or its data, and the two pages that show it. */
describe('the line to cite ClinX', () => {
  it('gives the name, what is cited, the site, a place for the day, and the page address last', () => {
    expect(citeLine(CITE_DATA, '/data/')).toBe('Berchtold, W. ClinX open data: 340B and health centers. clinx.org. Read [day month year]. https://clinx.org/data/');
    expect(citeLine(CITE_SITE, '/')).toBe('Berchtold, W. ClinX: open healthcare data and tools for clinics. clinx.org. Read [day month year]. https://clinx.org/');
  });

  it('ends with the address and no full stop, so a copied address still opens', () => {
    for (const line of [citeLine(CITE_DATA, '/data/'), citeLine(CITE_SITE, '/')]) {
      expect(line.startsWith(`${MAKER_CITED_AS} `)).toBe(true);
      expect(line).toMatch(new RegExp(`${SITE_URL}/[a-z/]*$`));
    }
  });

  it('names what the pages themselves are called', () => {
    // The Data page's title and the home page's title, so the citation and the page agree.
    expect(dataPage).toContain(`title="${CITE_DATA} downloads"`);
    expect(homePage).toContain(`title="${CITE_SITE}"`);
  });
});

describe('the pages that show it', () => {
  it('About says who builds and maintains ClinX and gives the line for the site', () => {
    expect(MAKER_NAME).toBe('Will Berchtold');
    expect(aboutPage).toContain('<h2 id="cite">How to cite</h2>');
    expect(aboutPage).toContain('ClinX is built and maintained by {MAKER_NAME}.');
    expect(aboutPage).toContain("{citeLine(CITE_SITE, '/')}");
    expect(aboutPage).toContain('href="/data/#cite"');
  });

  it('Data gives the line for the data, with the licence the page already states', () => {
    expect(dataPage).toContain('<h2 id="cite">How to cite</h2>');
    expect(dataPage).toContain("{ id: 'cite', label: 'How to cite' }");
    expect(dataPage).toContain("{citeLine(CITE_DATA, '/data/')}");
    expect(dataPage).toContain('It is under Creative Commons Attribution 4.0 (CC BY 4.0)');
    expect(dataPage).toContain('Data: Creative Commons Attribution 4.0 (CC BY 4.0)');
  });

  it('names no company and no employer in either block', () => {
    for (const page of [aboutPage, dataPage]) {
      const block = page.slice(page.indexOf('<h2 id="cite">'), page.indexOf('</section>', page.indexOf('<h2 id="cite">')));
      expect(block).not.toMatch(/\b(?:LLC|Inc\.?|company|employer|ReferralFinderX)\b/i);
      expect(block).not.toMatch(/@/);
    }
  });
});
