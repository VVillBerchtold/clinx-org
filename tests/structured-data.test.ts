import { describe, expect, it } from 'vitest';
import { getDataset } from '../src/lib/data';
import { REPOSITORIES, SITE_URL } from '../src/lib/site';
import { DATASET_ID, FOUNDER_ID, SITE_ID, aboutPageNode, articleNode, datasetNode, founderNode, siteNode, toBlock, trailNode } from '../src/lib/structured-data';

const data = getDataset();

describe('the block of data a page gives search engines', () => {
  it('is valid JSON in the schema.org vocabulary', () => {
    const doc = JSON.parse(toBlock([siteNode(), founderNode()]));
    expect(doc['@context']).toBe('https://schema.org');
    expect(doc['@graph']).toHaveLength(2);
  });

  it('can never close its own block or open a tag, whatever a name contains', () => {
    const text = toBlock([trailNode([{ name: 'A </script><script>alert(1)</script> & Sons', path: '/x/' }])]);
    expect(text).not.toMatch(/[<>&]/);
    expect(JSON.parse(text)['@graph'][0].itemListElement[1].name).toBe('A </script><script>alert(1)</script> & Sons');
  });
});

describe('the site and the person who builds it', () => {
  it('names the site ClinX and points to its builder', () => {
    const site = siteNode();
    expect(site['@id']).toBe(SITE_ID);
    expect(site.name).toBe('ClinX');
    expect(site.publisher).toEqual({ '@id': FOUNDER_ID });
  });

  it('ties Will Berchtold to his other public pages, ReferralFinderX first', () => {
    const person = founderNode();
    expect(person.name).toBe('Will Berchtold');
    expect(person.sameAs).toEqual([
      'https://referralfinderx.com/founder.html',
      'https://www.linkedin.com/in/will-berchtold',
      'https://x.com/willberch',
      'https://github.com/VVillBerchtold',
    ]);
    expect(String(person.description)).toContain('ReferralFinderX');
  });

  it('never writes a middle name or the short product name', () => {
    const text = toBlock([siteNode(), founderNode(), aboutPageNode(), articleNode('x')]);
    expect(text).not.toMatch(/\bRFX\b/);
    expect(text).not.toMatch(/William/);
  });
});

describe('the trail of pages', () => {
  it('starts at the home page and numbers each step', () => {
    const trail = trailNode([
      { name: 'Scorecard', path: '/scorecard/' },
      { name: 'Rhode Island', path: '/scorecard/ri/' },
    ]);
    expect(trail.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'ClinX', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'Scorecard', item: `${SITE_URL}/scorecard/` },
      { '@type': 'ListItem', position: 3, name: 'Rhode Island', item: `${SITE_URL}/scorecard/ri/` },
    ]);
  });
});

describe('the dataset, as dataset search engines read it', () => {
  const node = datasetNode(data, [{ name: 'drug-rows-ri-2025.csv', path: '/data/drug-rows-ri-2025.csv', sha256: 'abc' }]);
  const files = node.distribution as { name: string; contentUrl: string; encodingFormat: string; sha256?: string }[];

  it('carries the version the site was built from, the licence and the repository', () => {
    expect(node['@id']).toBe(DATASET_ID);
    expect(node.version).toBe(data.version);
    expect(node.license).toBe('https://creativecommons.org/licenses/by/4.0/');
    expect(node.sameAs).toBe(REPOSITORIES.dataset);
    expect(node.isAccessibleForFree).toBe(true);
  });

  it('describes itself in 50 to 5000 characters and names every state it covers', () => {
    const description = String(node.description);
    expect(description.length).toBeGreaterThanOrEqual(50);
    expect(description.length).toBeLessThanOrEqual(5000);
    for (const state of ['Minnesota', 'Rhode Island', 'Vermont']) expect(description).toContain(state);
    expect((node.spatialCoverage as { name: string }[]).map((p) => p.name)).toEqual(['Minnesota, United States', 'Rhode Island, United States', 'Vermont, United States']);
  });

  it('lists every download on the Data page, each with its type and fingerprint', () => {
    expect(files.map((f) => f.name)).toEqual([...data.downloads, 'drug-rows-ri-2025.csv']);
    for (const f of files) {
      expect(f.contentUrl).toBe(`${SITE_URL}/data/${f.name}`);
      expect(f.encodingFormat).toBe(f.name.endsWith('.json') ? 'application/json' : 'text/csv');
      expect(f.sha256).toBeTruthy();
    }
  });

  it('gives the years covered as one span', () => {
    const years = [...new Set(data.filings.map((f) => f.reportingYear))].sort();
    expect(node.temporalCoverage).toBe(years.length > 1 ? `${years[0]}/${years[years.length - 1]}` : years[0]);
  });
});
