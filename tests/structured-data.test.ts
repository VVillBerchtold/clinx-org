import { describe, expect, it } from 'vitest';
import { getDataset } from '../src/lib/data';
import { REPOSITORIES, SITE_URL } from '../src/lib/site';
import { DATASET_ID, FOUNDER_ID, ORG_ID, SITE_ID, aboutPageNode, organizationNode, articleNode, creatorNode, datasetNode, founderNode, hcDatasetId, healthCenterDatasetNodes, siteNode, toBlock, trailNode } from '../src/lib/structured-data';
import { fileGroups } from '../src/lib/hc-hub';
import { rawFile as recordsFile, recordsSource } from '../src/lib/hc-records';
import dataPage from '../src/pages/data/index.astro?raw';

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
  it('names the site ClinX and points to ClinX as its publisher', () => {
    const site = siteNode();
    expect(site['@id']).toBe(SITE_ID);
    expect(site.name).toBe('ClinX');
    expect(site.publisher).toEqual({ '@id': ORG_ID });
  });

  it('describes ClinX as an organization, founded by Will Berchtold, with its public code as sameAs', () => {
    const org = organizationNode();
    expect(org['@type']).toBe('Organization');
    expect(org['@id']).toBe(ORG_ID);
    expect(org.name).toBe('ClinX');
    expect(org.url).toBe(`${SITE_URL}/`);
    expect(org.founder).toEqual({ '@id': FOUNDER_ID });
    expect(org.sameAs).toEqual([REPOSITORIES.site]);
  });

  it('makes the About page the page about ClinX', () => {
    const about = aboutPageNode();
    expect(about.mainEntity).toEqual({ '@id': ORG_ID });
    expect(about.about).toEqual({ '@id': ORG_ID });
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
    const text = toBlock([siteNode(), organizationNode(), founderNode(), aboutPageNode(), articleNode('x')]);
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
    for (const state of ['Idaho', 'Maine', 'Minnesota', 'Ohio', 'Rhode Island', 'Vermont']) expect(description).toContain(state);
    expect((node.spatialCoverage as { name: string }[]).map((p) => p.name)).toEqual(['Idaho, United States', 'Maine, United States', 'Minnesota, United States', 'Ohio, United States', 'Rhode Island, United States', 'Vermont, United States']);
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

describe('the health centers files, as dataset search engines read them', () => {
  const groups = fileGroups();
  const nodes = healthCenterDatasetNodes(
    groups.map((g) => ({ ...g, files: g.files.map((f) => ({ ...f, sha256: `hash-of-${f.name}` })) })),
    recordsSource().years,
  );
  type File = { name: string; description: string; contentUrl: string; encodingFormat: string; sha256?: string };

  it('is one dataset for each part, each with its own name and a place on the Data page', () => {
    expect(nodes.map((n) => n['@id'])).toEqual([hcDatasetId('records'), hcDatasetId('funding'), hcDatasetId('areas')]);
    expect(new Set([...nodes.map((n) => n['@id']), DATASET_ID]).size).toBe(4);
    expect(new Set(nodes.map((n) => n.name)).size).toBe(3);
    for (const [i, node] of nodes.entries()) {
      expect(node['@type']).toBe('Dataset');
      // The address is the heading of the group on the Data page, where the files are offered.
      expect(node.url).toBe(`${SITE_URL}/data/#health-centers-${groups[i]!.id}`);
      expect(dataPage).toContain('<h3 id={`health-centers-${g.id}`}>');
    }
    expect(dataPage).toContain('...healthCenterDatasetNodes(hcGroups, recordsSource().years)');
  });

  it('carries the licence the site states for its data, and the same creator as the 340B dataset', () => {
    const first = datasetNode(data);
    for (const node of nodes) {
      expect(node.license).toBe('https://creativecommons.org/licenses/by/4.0/');
      expect(node.license).toBe(first.license);
      expect(node.creator).toEqual(first.creator);
      // A person by name, with the About page as his address, and the same thing the About page describes in full.
      expect(node.creator).toEqual({ '@type': 'Person', '@id': FOUNDER_ID, name: 'Will Berchtold', url: `${SITE_URL}/about/` });
      expect(node.creator).toEqual(creatorNode());
      expect(node.isPartOf).toEqual({ '@id': SITE_ID });
      expect(node.isAccessibleForFree).toBe(true);
    }
    expect(dataPage).toContain('Data: Creative Commons Attribution 4.0 (CC BY 4.0)');
  });

  it('describes each in 50 to 5000 characters, with none of the words the site never uses', () => {
    for (const node of nodes) {
      const description = String(node.description);
      expect(description.length).toBeGreaterThanOrEqual(50);
      expect(description.length).toBeLessThanOrEqual(5000);
      expect(description).not.toMatch(/\b(?:highest|lowest|worst|best)\b|\btop\s|[—–]/i);
    }
  });

  it('lists exactly the files the Data page offers for the part, each a real file under /data/health-centers/', () => {
    for (const [i, node] of nodes.entries()) {
      const files = node.distribution as File[];
      const offered = groups[i]!.files;
      expect(files.map((f) => f.name)).toEqual(offered.map((f) => f.name));
      expect(files.length).toBeGreaterThan(0);
      for (const [j, f] of files.entries()) {
        expect(f.contentUrl).toBe(SITE_URL + offered[j]!.href);
        expect(f.contentUrl.startsWith(`${SITE_URL}/data/health-centers/`)).toBe(true);
        expect(f.encodingFormat).toBe(f.name.endsWith('.json') ? 'application/json' : 'text/csv');
        expect(f.description).toBe(offered[j]!.what);
        expect(f.sha256).toBe(`hash-of-${f.name}`);
        // The file has something in it: the page serves this text.
        expect(offered[j]!.text.length).toBeGreaterThan(0);
      }
    }
  });

  it('gives years for the records only, and they are the years the records file holds', () => {
    const [records, funding, areas] = nodes;
    const lines = recordsFile('health-centers.csv').trim().split('\n');
    const column = lines[0]!.split(',').indexOf('year');
    expect(column).toBeGreaterThanOrEqual(0);
    const years = [...new Set(lines.slice(1).map((line) => line.split(',')[column]!))].sort();
    expect(years.every((y) => /^\d{4}$/.test(y))).toBe(true);
    expect(records!.temporalCoverage).toBe(`${years[0]}/${years[years.length - 1]}`);
    expect(funding!.temporalCoverage).toBeUndefined();
    expect(areas!.temporalCoverage).toBeUndefined();
  });

  it('states no size, no version and no date the files do not state', () => {
    for (const node of nodes) {
      for (const key of ['version', 'dateModified', 'datePublished', 'dateCreated', 'sameAs', 'identifier']) expect(node[key]).toBeUndefined();
      for (const f of node.distribution as Record<string, unknown>[]) expect(f.contentSize).toBeUndefined();
    }
  });

  it('makes one block with the 340B dataset that names every dataset once', () => {
    const doc = JSON.parse(toBlock([datasetNode(data), ...nodes]));
    expect(doc['@graph'].filter((n: { '@type': string }) => n['@type'] === 'Dataset')).toHaveLength(4);
  });
});
