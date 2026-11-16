import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { BANNED, RECORDS_TITLES, fundingParagraphs, namesWithBannedWord, printedHcWords, recordsNames, withoutPrintedHcWords } from '../scripts/hc/printed-words.mjs';
import { AREAS_PATH, getIndex, stateCodes } from '../src/lib/hc-areas';
import { FUNDING_HOME, ahead, getFunding, paragraphs } from '../src/lib/hc-funding';
import { fileGroups, partCards, partDays } from '../src/lib/hc-hub';
import { RECORDS_PATH, listRows, recordsSource } from '../src/lib/hc-records';
import { HC_HOME, HC_NAME, NAV, type NavGroup } from '../src/lib/site';
import hubPage from '../src/pages/health-centers/index.astro?raw';
import hubLib from '../src/lib/hc-hub.ts?raw';
import hubStyles from '../src/styles/hc-hub.css?raw';
import homePage from '../src/pages/index.astro?raw';
import dataPage from '../src/pages/data/index.astro?raw';
import methodsPage from '../src/pages/methods/index.astro?raw';
import recordsList from '../src/components/hc/RecordsListPage.astro?raw';
import recordsCenter from '../src/components/hc/RecordsCenterPage.astro?raw';
import areasState from '../src/components/hc/AreasStatePage.astro?raw';
import areasFront from '../src/pages/health-centers/shortage-areas/index.astro?raw';
import areasCare from '../src/components/hc/AreasCare.astro?raw';
import fundingFront from '../src/pages/health-centers/funding/index.astro?raw';
import fundingOne from '../src/pages/health-centers/funding/[id]/index.astro?raw';
import checkDist from '../scripts/check-dist.mjs?raw';

// These tests read every published cell of every health center; a hosted runner needs more than the default five seconds.
vi.setConfig({ testTimeout: 60_000 });

/**
 * The front page of the health centers section, its place in the menu and the trail of its pages, and the one
 * allowance in scripts/check-dist.mjs for the agencies' own published words. What these tests hold fixed: every
 * number on the front page is read from the copies, the menu names the three pages, every trail links to the
 * front page, and the allowance covers the agencies' words only, never the site's own sentences.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cards = partCards();
const funding = getFunding();
const source = recordsSource();
const words = printedHcWords(root);

describe('the front page numbers', () => {
  it('are the counts in the copied files', () => {
    const [records, fund, areas] = cards;
    expect(records!.facts[0]!.value).toBe(String(listRows().length));
    expect(records!.facts[1]!.value).toBe(`${source.years[0]} to ${source.latest_year}`);
    expect(fund!.facts[0]!.value).toBe(`${funding.opportunities.length} (${funding.opportunities.filter((o) => o.status === 'forecasted').length} forecast, ${funding.opportunities.filter((o) => o.status !== 'forecasted').length} posted)`);
    expect(fund!.facts[1]!.value).toBe(String(ahead(funding).length));
    expect(fund!.facts[2]!.value).toBe(String(funding.register.length));
    const pc = getIndex().national_counts.designations['hpsa-pc'];
    expect(areas!.facts[0]!.value).toBe(String(stateCodes().filter((c) => c !== 'XX').length));
    expect(areas!.facts[1]!.value).toBe(pc.Designated.designations.toLocaleString('en-US'));
    expect(areas!.facts[2]!.value).toBe(pc['Proposed For Withdrawal'].designations.toLocaleString('en-US'));
  });

  it('name the day of each part\'s files, and the three cards link to the three parts', () => {
    expect(cards.map((c) => c.href)).toEqual([RECORDS_PATH, FUNDING_HOME, AREAS_PATH]);
    const days = partDays();
    expect(days.funding).toMatch(/^\d{1,2} [A-Z][a-z]+ \d{4}$/);
    expect(days.areas).toMatch(/^\d{1,2} [A-Z][a-z]+ \d{4}$/);
    expect(days.records).toMatch(/^\d{1,2} [A-Z][a-z]+ \d{4}$/);
  });

  it('list every download with its address and its text, and the addresses are unique and lower case', () => {
    const hrefs = fileGroups().flatMap((g) => g.files.map((f) => f.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs.length).toBe(3 + 6 + 5);
    for (const h of hrefs) expect(h).toMatch(/^\/data\/health-centers\/[a-z]+\/[a-z-]+\.(csv|json)$/);
    for (const g of fileGroups()) for (const f of g.files) expect(f.text.length).toBeGreaterThan(10);
  });

  it('hold no text typed by hand that goes out of date: no digit in the page or the cards\' sentences', () => {
    const page = hubPage.replace(/---[\s\S]*?---/, '').replace(/<style[\s\S]*?<\/style>/g, '');
    expect(page.replace(/\{[^}]*\}/g, '')).not.toMatch(/\b\d{2,}\b/);
    for (const c of cards) expect(`${c.label} ${c.title} ${c.say}`).not.toMatch(/\d/);
  });
});

describe('the menu', () => {
  const group = NAV.find((item): item is NavGroup => 'items' in item && item.label === HC_NAME);
  it('has the Health centers group after the 340B group, with the three pages and a note for each', () => {
    const labels = NAV.map((item) => item.label);
    expect(labels.indexOf('340B')).toBe(0);
    expect(labels.indexOf(HC_NAME)).toBe(1);
    expect(group!.items.map((i) => i.href)).toEqual([RECORDS_PATH, FUNDING_HOME, AREAS_PATH]);
    expect(group!.home).toBe(HC_HOME);
    for (const item of group!.items) expect(item.note!.length).toBeGreaterThan(10);
  });
  it('has notes that keep the site\'s words', () => {
    for (const item of group!.items) {
      expect(BANNED.test(item.note!)).toBe(false);
      expect(item.note).not.toContain('—');
    }
  });
});

describe('the trail', () => {
  const pages: Record<string, string> = { recordsList, recordsCenter, areasState, areasFront, fundingFront, fundingOne };
  it('links "Health centers" to the front page and puts it in the trail of search engines on every page of the three parts', () => {
    for (const [name, text] of Object.entries(pages)) {
      expect(text, name).toContain('{ label: HC_NAME, href: HC_HOME }');
      expect(text, name).toContain('{ name: HC_NAME, path: HC_HOME }');
      expect(text, name).not.toContain("{ label: 'Health centers' }");
    }
    expect(HC_HOME).toBe('/health-centers/');
  });
  it('gives the three parts the same names for the same things', () => {
    for (const [name, text] of Object.entries({ ...pages, areasCare })) {
      expect(text, name).not.toMatch(/Read it with care/);
    }
    expect(areasCare).toContain('Read with care');
    expect(fundingFront).toContain('Read with care');
    expect(recordsCenter).toContain('Read with care');
    for (const text of [recordsList, areasFront, fundingFront]) expect(text).toContain('Source');
  });
});

describe('the mentions', () => {
  it('put the section on the home page beside 340B, with no new badge', () => {
    expect(homePage).toContain('work-hc');
    expect(homePage).toContain('HC_HOME');
    expect(homePage.toLowerCase()).not.toMatch(/\bnew\b/);
  });
  it('put the downloads on the Data page, grouped by part, and the three parts on the Methods page', () => {
    expect(dataPage).toContain('id="health-centers"');
    expect(dataPage).toContain('fileGroups()');
    expect(methodsPage).toContain('id="health-centers"');
    for (const id of ['health-centers-records', 'health-centers-funding', 'health-centers-areas']) expect(methodsPage).toContain(`id="${id}"`);
  });
});

describe('the page and its words', () => {
  it('keep the site\'s rules', () => {
    for (const [name, text] of Object.entries({ hubPage, hubLib, homePage, methodsPage })) {
      const own = text.replace(/\bBANNED\b/g, '');
      expect(own, name).not.toContain('—');
    }
    for (const [name, text] of Object.entries({ hubPage, hubLib })) {
      expect(BANNED.test(text.replace(/\/\*[\s\S]*?\*\//g, '')), name).toBe(false);
      expect(text, name).not.toMatch(/\b(?:simply|just|seamless|powerful|unlock|dive)\b/i);
      expect(text, name).not.toContain('innerHTML');
      expect(text, name).not.toContain('set:html');
      expect(text, name).not.toContain('<script is:inline');
    }
  });
  it('uses only tokens for colour', () => {
    expect(hubStyles).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(hubStyles).not.toMatch(/rgba?\(/);
  });
});

describe('the allowance in check-dist for the agencies\' own words', () => {
  const recordsPage = '/health-centers/records/010030/2024/index.html';
  const fundingPage = '/health-centers/funding/363532/index.html';

  it('is read from one place, shared with the check', () => {
    expect(checkDist).toContain("from './hc/printed-words.mjs'");
    expect(checkDist).toContain('withoutPrintedHcWords(page, checked, PRINTED_HC_WORDS)');
  });

  it('covers exactly the two titles HRSA prints, and both are in the copied lines.csv', () => {
    const lines = readFileSync(join(root, 'src', 'data', 'health-centers', 'records', 'lines.csv'), 'utf8');
    expect(RECORDS_TITLES.length).toBe(2);
    for (const title of RECORDS_TITLES) {
      expect(BANNED.test(title)).toBe(true);
      expect(lines, title).toContain(title);
    }
    // No other published title in the copy holds a banned word.
    const rest = RECORDS_TITLES.reduce((text, title) => text.replaceAll(title, ' '), lines);
    expect(BANNED.exec(rest)).toBeNull();
  });

  it('lets the two titles through on a records page and nowhere else', () => {
    for (const title of RECORDS_TITLES) {
      expect(BANNED.test(withoutPrintedHcWords(recordsPage, `<td>${title}</td>`, words))).toBe(false);
      expect(BANNED.test(withoutPrintedHcWords('/health-centers/funding/index.html', title, words))).toBe(true);
      expect(BANNED.test(withoutPrintedHcWords('/scorecard/ri/index.html', title, words))).toBe(true);
      expect(BANNED.test(withoutPrintedHcWords('/health-centers/index.html', title, words))).toBe(true);
    }
  });

  it('lets a name or place HRSA prints for a health center or a site through on the records pages, and nowhere else', () => {
    const csv = 'health_center,name_as_published,street,address_line_2,city\n1,BROAD TOP AREA MEDICAL CENTER,1 Main St,-,Broad Top\n2,PLAIN HEALTH CENTER,2 Top St,-,Plainville\n';
    const docs = [{ years: { '2025': { sites: { columns: ['site_name', 'city'], rows: [['BEST Health Center', 'Hempstead'], ['A Plain Site', 'Plainville']] } } } }];
    expect(namesWithBannedWord(csv, docs).sort()).toEqual(['2 Top St', 'BEST Health Center', 'BROAD TOP AREA MEDICAL CENTER', 'Broad Top']);
    const names = recordsNames(root);
    expect(names.length).toBeGreaterThan(0);
    expect(names.length).toBeLessThan(40);
    for (const name of names) {
      expect(BANNED.test(`${name} `), name).toBe(true);
      expect(BANNED.test(withoutPrintedHcWords(recordsPage, `Previous health center ${name} Next`, words)), name).toBe(false);
      expect(BANNED.test(withoutPrintedHcWords('/health-centers/index.html', `${name} `, words)), name).toBe(true);
    }
  });

  it('still holds the site\'s own words on a records page to the rule', () => {
    const [title] = RECORDS_TITLES as [string];
    const own = ['These are the best results on the page.', 'The highest total is shown first.', 'See the top rows.'];
    for (const sentence of own) {
      expect(BANNED.test(withoutPrintedHcWords(recordsPage, sentence, words)), sentence).toBe(true);
      // Next to the allowed title the sentence still fails.
      expect(BANNED.test(withoutPrintedHcWords(recordsPage, `${title} ${sentence}`, words)), sentence).toBe(true);
    }
    // A phrase that only resembles a published title is not let through.
    expect(BANNED.test(withoutPrintedHcWords(recordsPage, 'Patients best served in a language other than English', words))).toBe(true);
  });

  it('covers the funding paragraphs that hold a banned word, as the agency wrote them, and no other text', () => {
    const blocked = [...new Set(funding.opportunities.flatMap((o) => [...paragraphs(o.description), ...paragraphs(o.eligibility)]).filter((p) => BANNED.test(p)))];
    expect(blocked.length).toBeGreaterThan(0);
    expect(fundingParagraphs(root).sort()).toEqual([...blocked].sort());
    for (const p of blocked) {
      expect(BANNED.test(withoutPrintedHcWords(fundingPage, `<p>${p}</p>`, words))).toBe(false);
      // The same paragraph on another page, or a changed paragraph on a funding page, fails.
      expect(BANNED.test(withoutPrintedHcWords('/health-centers/records/index.html', p, words))).toBe(true);
      expect(BANNED.test(withoutPrintedHcWords('/bills/index.html', p, words))).toBe(true);
      expect(BANNED.test(withoutPrintedHcWords(fundingPage, `${p} It is the best calendar.`, words))).toBe(true);
      expect(BANNED.test(withoutPrintedHcWords(fundingPage, p.replace(/\b(best|highest|lowest|worst)\b/i, (m) => `${m} of all`).replace(/^/, 'ClinX says: '), words))).toBe(true);
    }
  });

  it('holds the site\'s own sentences on the funding pages to the rule', () => {
    for (const sentence of ['The best opportunity is shown first.', 'This is the highest amount.', 'Look at the top rows']) {
      expect(BANNED.test(withoutPrintedHcWords(fundingPage, sentence, words)), sentence).toBe(true);
    }
  });
});
