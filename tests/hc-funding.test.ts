import { describe, expect, it } from 'vitest';
import { CSV_COLUMNS, FUNDING_FILES, FUNDING_KINDS, csvShape, fundingProblems } from '../scripts/hc/funding.mjs';
import {
  BLOCKED_WORDS, DATE_NAMES, DOWNLOADS, FUNDING_HOME, KINDS, KIND_NOTES, PRINT_BLOCKED_PARAGRAPHS, agencyNote, ahead, byMonth, countText, dayText, eventTitle, eventUid, flagLabels, foundByText,
  fundingCalendarFile, getFunding, isHeldBack, isWebAddress, kindLabel, longDayText, moneyText, opportunityDates, opportunityPath, paragraphs, parseFunding, passed, programListingNumbers,
  registerNewestFirst, statusLabel,
} from '../src/lib/hc-funding';
import calendarPage from '../src/pages/health-centers/funding/index.astro?raw';
import opportunityPage from '../src/pages/health-centers/funding/[id]/index.astro?raw';
import rowsComponent from '../src/components/hc/FundingRows.astro?raw';
import libSource from '../src/lib/hc-funding.ts?raw';
import filterScript from '../src/scripts/hc-funding-filter.ts?raw';
import feedEndpoint from '../src/pages/health-centers/funding.ics.ts?raw';
import jsonEndpoint from '../src/pages/data/health-centers/funding/[name].json.ts?raw';
import csvEndpoint from '../src/pages/data/health-centers/funding/[name].csv.ts?raw';

// A stylesheet is asked for as text with ?inline.
const styles = Object.values(import.meta.glob('../src/styles/hc-funding.css', { query: '?inline', import: 'default', eager: true }) as Record<string, string>)[0]!;

/**
 * The funding and deadline calendar. What these tests hold fixed is what the pages must never do: change a value
 * the agency published, call an estimated date a deadline, add or compare amounts, print the agency's text as
 * markup, carry an email address or a phone number, or let two pages share an address.
 */
const modules = import.meta.glob('../src/data/health-centers/funding/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const files = Object.fromEntries(Object.entries(modules).map(([path, text]) => [path.split('/').pop()!, text]));
delete files['SOURCE.json'];
const data = getFunding();
const rawOpportunities = JSON.parse(files['opportunities.json']!) as Record<string, any>[];
const rawEvents = JSON.parse(files['deadlines.json']!) as Record<string, any>[];
const rawRegister = JSON.parse(files['register.json']!) as Record<string, any>[];
const index = JSON.parse(files['index.json']!);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const PHONE = /(?:\(\d{3}\)\s?|\b\d{3}[-.\s])\d{3}[-.\s]\d{4}\b/;
const OWN_WORDS = [calendarPage, opportunityPage, rowsComponent, libSource, filterScript];

describe('the copy of the funding tables', () => {
  it('is what the shape check expects, and the reader and the check agree on kinds and columns', () => {
    expect(fundingProblems(files)).toEqual([]);
    expect([...KINDS]).toEqual(FUNDING_KINDS);
    expect(csvShape(files['deadlines.csv']!).header).toEqual(CSV_COLUMNS['deadlines.csv']);
    expect(Object.keys(rawEvents[0]!).sort()).toEqual([...CSV_COLUMNS['deadlines.csv']].sort());
    expect(DOWNLOADS.map((d) => d.name).sort()).toEqual(FUNDING_FILES.filter((name) => name !== 'index.json').sort());
  });

  it('has the counts on the pages equal to the counts of rows in the files', () => {
    expect(data.opportunities).toHaveLength(index.opportunities.total);
    expect(data.opportunities.filter((o) => o.status === 'forecasted')).toHaveLength(index.opportunities.by_status.forecasted);
    expect(data.opportunities.filter((o) => o.status === 'posted')).toHaveLength(index.opportunities.by_status.posted);
    expect(data.opportunities.filter((o) => o.namesHealthCenters)).toHaveLength(index.opportunities.names_health_centers);
    expect(data.opportunities.filter((o) => o.healthCenterProgram)).toHaveLength(index.opportunities.health_center_program);
    expect(data.register).toHaveLength(index.register_documents.total);
    expect(data.events).toHaveLength(index.events.total);
    expect(data.events.filter((e) => e.estimated)).toHaveLength(index.events.estimated);
    expect(data.events.filter((e) => !e.estimated)).toHaveLength(index.events.firm);
    for (const kind of KINDS) expect(data.events.filter((e) => e.kind === kind)).toHaveLength(index.events.by_kind[kind] ?? 0);
    expect(rawOpportunities).toHaveLength(data.opportunities.length);
    expect(rawEvents).toHaveLength(data.events.length);
    expect(rawRegister).toHaveLength(data.register.length);
    expect(csvShape(files['opportunities.csv']!).records).toBe(data.opportunities.length);
    expect(csvShape(files['deadlines.csv']!).records).toBe(data.events.length);
    expect(csvShape(files['register.csv']!).records).toBe(data.register.length);
  });

  it('splits the calendar into dates ahead and dates before the day of the files, and lists every date once', () => {
    expect(ahead(data).length + passed(data).length).toBe(data.events.length);
    for (const e of ahead(data)) expect(e.day >= data.day).toBe(true);
    for (const e of passed(data)) expect(e.day < data.day).toBe(true);
    expect(byMonth(ahead(data)).reduce((n, g) => n + g.events.length, 0)).toBe(ahead(data).length);
    const days = data.events.map((e) => e.day);
    expect(days).toEqual([...days].sort());
  });

  it('refuses files it does not expect', () => {
    const change = (name: string, edit: (text: string) => string) => ({ ...files, [name]: edit(files[name]!) });
    expect(fundingProblems(change('deadlines.json', (t) => t.replace('"kind": "comments close"', '"kind": "party"'))).join('\n')).toMatch(/unknown kind/);
    expect(fundingProblems(change('deadlines.csv', (t) => t.replace('date,kind', 'day,kind'))).join('\n')).toMatch(/columns/);
    expect(fundingProblems(change('index.json', (t) => t.replace('"total": 49', '"total": 48'))).join('\n')).toMatch(/says 48 opportunities/);
    expect(fundingProblems(change('opportunities.json', (t) => t.replace('"id": "363111"', '"id": "999999"'))).join('\n')).toMatch(/Grants\.gov address|not in opportunities\.json/);
    expect(fundingProblems(change('register.json', (t) => t.replace('https://www.federalregister.gov/', 'https://example.org/'))).join('\n')).toMatch(/federalregister\.gov/);
    expect(fundingProblems({ ...files, 'register.csv': undefined } as never).join('\n')).toMatch(/missing/);
    const at = 'email' + '@' + 'example.org';
    expect(fundingProblems(change('register.json', (t) => t.replace('"type": "Rule"', `"type": "Rule ${at}"`))).join('\n')).toMatch(/email address/);
    const number = ['617', '555', '0100'].join('-');
    expect(fundingProblems(change('register.json', (t) => t.replace('"type": "Rule"', `"type": "Rule ${number}"`))).join('\n')).toMatch(/phone number/);
    expect(() => parseFunding({ index: files['index.json']!, opportunities: files['opportunities.json']!, register: files['register.json']!, deadlines: files['deadlines.json']!.replace('"kind": "comments close"', '"kind": "party"') })).toThrow(/unknown kind/);
    expect(() => parseFunding({ index: files['index.json']!, opportunities: files['opportunities.json']!.replace('"status": "posted"', '"status": "gone"'), register: files['register.json']!, deadlines: files['deadlines.json']! })).toThrow(/status gone/);
  });
});

describe('the addresses', () => {
  it('gives each opportunity one page of its own, lower case, ending with a slash, that no other page uses', () => {
    const paths = data.opportunities.map((o) => opportunityPath(o.id));
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toHaveLength(49);
    for (const path of paths) expect(path).toMatch(/^\/health-centers\/funding\/\d+\/$/);
    expect(FUNDING_HOME).toBe('/health-centers/funding/');
    expect(FUNDING_HOME).toBe(FUNDING_HOME.toLowerCase());
  });

  it('draws every opportunity address and every official address as a web address', () => {
    for (const o of data.opportunities) expect(o.grantsGovUrl).toBe(`https://www.grants.gov/search-results-detail/${o.id}`);
    for (const e of data.events) expect(e.url).toMatch(/^https:\/\/(www\.grants\.gov\/search-results-detail\/\d+|www\.federalregister\.gov\/documents\/\S+)$/);
    for (const r of data.register) expect(r.htmlUrl).toMatch(/^https:\/\/www\.federalregister\.gov\//);
    expect(isWebAddress('https://www.grants.gov/')).toBe(true);
    expect(isWebAddress('javascript:alert(1)')).toBe(false);
    expect(isWebAddress('https://a.example/ b')).toBe(false);
  });
});

describe('what a page says about a date', () => {
  it('marks every date HRSA estimates, and only those', () => {
    for (const d of DATE_NAMES) expect(d.estimated, d.name).toBe(/^(earlier_)?est_/.test(d.name));
    for (const e of data.events) {
      if (e.source === 'federal register') expect(e.estimated).toBe(false);
      if (e.kind === 'notice expected' || e.kind === 'award expected') expect(e.estimated, `${e.sourceId} ${e.kind}`).toBe(true);
      if (e.source === 'grants.gov') {
        const o = data.opportunities.find((x) => x.id === e.sourceId)!;
        expect(e.estimated).toBe(o.status === 'forecasted');
      }
    }
  });

  it('prints each date of an opportunity with the day it names and the text as published, both equal to the file', () => {
    for (const raw of rawOpportunities) {
      const o = data.opportunities.find((x) => x.id === raw.id)!;
      const rows = opportunityDates(o);
      expect(rows).toHaveLength(Object.keys(raw.dates).length);
      for (const row of rows) {
        const name = DATE_NAMES.find((d) => d.label === row.label && raw.dates[d.name] !== undefined && raw.dates[d.name].as_published === row.stamp.asPublished)!.name;
        expect(row.stamp.asPublished).toBe(raw.dates[name].as_published);
        expect(row.stamp.date).toBe(raw.dates[name].date);
        expect(dayText(row.stamp.date)).toMatch(/^\d{1,2} [A-Z][a-z]+ \d{4}$/);
      }
    }
  });

  it('says "estimated" in the title of an estimated event and in the calendar file, and never for a firm one', () => {
    const file = fundingCalendarFile(data);
    const events = file.split('BEGIN:VEVENT').slice(1);
    expect(events).toHaveLength(data.events.length);
    for (const event of data.events) {
      expect(eventTitle(event).includes('(estimated)')).toBe(event.estimated);
      expect(kindLabel(event.kind)).not.toBe('');
    }
    const unfolded = file.replaceAll('\r\n ', '');
    for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
      const summary = /SUMMARY:(.*)/.exec(block)![1]!;
      const description = /DESCRIPTION:(.*)/.exec(block)![1]!;
      expect(summary.includes('(estimated)')).toBe(description.includes('Estimated date.'));
      expect(block).toMatch(/URL:https:\/\//);
      expect(block).toContain('DTSTART;VALUE=DATE:');
      expect(description).toContain('Official page: https://');
    }
  });

  it('writes a valid, stable calendar file: unique names, all-day events, lines of 75 bytes at most', () => {
    const file = fundingCalendarFile(data);
    expect(file.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(file.endsWith('END:VCALENDAR\r\n')).toBe(true);
    const uids = data.events.map(eventUid);
    expect(new Set(uids).size).toBe(uids.length);
    for (const line of file.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(file).toBe(fundingCalendarFile(data));
    expect(file).not.toMatch(EMAIL);
    expect(file).not.toMatch(PHONE);
  });

  it('keeps the agency\'s own sentence about a date, without the sentence ClinX adds', () => {
    const estimated = data.events.find((e) => e.estimated && e.note.length > 'HRSA labels this date as estimated.'.length)!;
    expect(estimated.note.startsWith('HRSA labels this date as estimated.')).toBe(true);
    expect(agencyNote(estimated)).toBe(estimated.note.replace('HRSA labels this date as estimated.', '').trim());
    const firm = data.events.find((e) => !e.estimated)!;
    expect(agencyNote(firm)).toBe(firm.note.trim());
  });
});

describe('money and counts', () => {
  it('draws a comma and a dollar sign and changes no digit; a mark is printed as published', () => {
    for (const raw of rawOpportunities) {
      const o = data.opportunities.find((x) => x.id === raw.id)!;
      const pairs: [string, any, ReturnType<typeof moneyText>][] = [
        ['estimated_funding', raw.estimated_funding, moneyText(o.estimatedFunding)],
        ['award_ceiling', raw.award_ceiling, moneyText(o.awardCeiling)],
        ['award_floor', raw.award_floor, moneyText(o.awardFloor)],
      ];
      for (const [, value, shown] of pairs) {
        if (value === null) expect(shown).toBe('Not given');
        else if (/^\d+$/.test(value.as_published)) {
          expect(shown.startsWith('$')).toBe(true);
          expect(shown.replace(/[$,]/g, '')).toBe(value.as_published);
        } else expect(shown).toBe(value.as_published);
      }
      const awards = raw.number_of_awards;
      expect(countText(o.numberOfAwards).replace(/,/g, '')).toBe(awards === null ? 'Not given' : awards.as_published);
    }
    expect(moneyText({ asPublished: '20960000', value: 20960000 })).toBe('$20,960,000');
    expect(moneyText({ asPublished: 'None', value: null })).toBe('None');
    expect(moneyText({ asPublished: '', value: null })).toBe('Not given');
    expect(countText({ asPublished: '1200', value: 1200 })).toBe('1,200');
    expect(countText({ asPublished: 'None', value: null })).toBe('None');
  });

  it('adds nothing together: no page sums or divides an amount', () => {
    for (const source of [calendarPage, opportunityPage, rowsComponent]) {
      expect(source).not.toMatch(/\.reduce\([^)]*\b(estimatedFunding|awardCeiling|awardFloor|numberOfAwards)\b/);
      expect(source).not.toMatch(/(estimatedFunding|awardCeiling|awardFloor|numberOfAwards)[^\n]*[+\/*][^\n]*(estimatedFunding|awardCeiling|awardFloor|numberOfAwards)/);
    }
  });
});

describe('the agency\'s text', () => {
  it('keeps every paragraph of a description and of an eligibility text, with its words unchanged', () => {
    const squeeze = (t: string) => t.replace(/\s+/g, ' ').trim();
    for (const raw of rawOpportunities) {
      const o = data.opportunities.find((x) => x.id === raw.id)!;
      expect(paragraphs(o.description).join(' ')).toBe(squeeze(raw.description));
      expect(paragraphs(o.eligibility).join(' ')).toBe(squeeze(raw.eligibility));
      expect(o.title).toBe(raw.title);
      expect(o.number).toBe(raw.number);
    }
  });

  it('holds back only the paragraphs a page check would refuse, and the others hold no blocked word', () => {
    expect(PRINT_BLOCKED_PARAGRAPHS).toBe(false);
    let held = 0;
    for (const o of data.opportunities) {
      for (const p of [...paragraphs(o.description), ...paragraphs(o.eligibility), o.title, o.applicationDueNote, o.changeComment, o.recordChangeComment]) {
        if (BLOCKED_WORDS.test(p)) {
          held += 1;
          expect(isHeldBack(p)).toBe(true);
        } else expect(isHeldBack(p)).toBe(false);
      }
    }
    for (const o of data.opportunities) {
      // Only a description or an eligibility paragraph is held back; every other printed text is free of the words.
      for (const text of [o.title, o.number, ...o.applicantTypes, ...o.fundingInstruments, ...o.fundingCategories, ...o.listings.map((l) => l.programTitle), o.moreInformationText, o.applicationDueNote, o.changeComment, o.recordChangeComment]) {
        expect(BLOCKED_WORDS.test(text), `${o.id}: ${text}`).toBe(false);
      }
    }
    for (const e of data.events) expect(BLOCKED_WORDS.test(e.title + e.note), e.sourceId).toBe(false);
    for (const r of data.register) expect(BLOCKED_WORDS.test(r.title + r.agencyNames.join(' ')), r.documentNumber).toBe(false);
    expect(held).toBeGreaterThan(0);
  });

  it('carries no email address and no phone number in any file, in any text a page prints or in the calendar file', () => {
    for (const [name, text] of Object.entries(files)) {
      expect(EMAIL.test(text), name).toBe(false);
      expect(PHONE.test(text), name).toBe(false);
    }
    for (const o of data.opportunities) {
      for (const text of [o.title, o.description, o.eligibility, o.applicationDueNote, o.changeComment, o.recordChangeComment, o.moreInformationText, ...o.attachmentFileNames]) {
        expect(EMAIL.test(text), o.id).toBe(false);
        expect(PHONE.test(text), o.id).toBe(false);
      }
    }
    for (const r of data.register) {
      expect(EMAIL.test(r.title + r.dateText + r.agencyNames.join(' ')), r.documentNumber).toBe(false);
      expect(PHONE.test(r.title + r.dateText), r.documentNumber).toBe(false);
    }
  });

  it('keeps no key of a person in the opportunities: no contact, no publisher', () => {
    for (const raw of rawOpportunities) {
      for (const key of Object.keys(raw)) expect(key, key).not.toMatch(/contact|phone|publisher|email/i);
    }
  });
});

describe('the pages\' own words', () => {
  const words = [
    ...OWN_WORDS,
    ...Object.values(KIND_NOTES),
    ...DOWNLOADS.map((d) => d.what),
  ];
  const BANNED = /\b(?:highest|lowest|worst|best|simply|just|seamless|powerful|unlock|dive)\b|\btop\s/i;

  it('use no banned word and no em dash', () => {
    for (const text of words) {
      // The banned words are listed once in the library (BLOCKED_WORDS), where they are the pattern, not the page's words.
      const prose = text === libSource ? text.replace(/BLOCKED_WORDS = [^\n]*/, '') : text;
      expect(prose).not.toMatch(BANNED);
      expect(text).not.toContain('—');
    }
    expect(styles).not.toContain('—');
  });

  it('print the agency\'s text as text, never as markup, and carry no script or style of their own', () => {
    for (const source of [calendarPage, opportunityPage, rowsComponent, jsonEndpoint, csvEndpoint, feedEndpoint]) {
      expect(source).not.toMatch(/set:html|innerHTML|is:inline|outerHTML|insertAdjacentHTML|<style\b|style=/);
    }
    expect(filterScript).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|fetch\(|XMLHttpRequest|localStorage|document\.cookie/);
  });

  it('use only the site\'s colour tokens and load nothing from another site', () => {
    // Vitest drops the text of a stylesheet, so this runs on the file's text only where the text is there; scripts/check-dist.mjs checks the built stylesheet.
    if (styles.trim() === '') return;
    expect(styles.replace(/%23777/g, '')).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(styles).not.toMatch(/@import|url\(\s*['"]?https?:/);
    expect(styles).toMatch(/var\(--/);
  });

  it('say what the opportunity is before what it is not, and give no advice', () => {
    for (const text of [calendarPage, opportunityPage]) {
      expect(text).not.toMatch(/\b(you should|you must|we recommend|apply now|hurry|prepare your|make sure)\b/i);
    }
  });
});

describe('the helpers', () => {
  it('names the two words of HRSA, the kinds and the days', () => {
    expect(statusLabel('forecasted')).toBe('Forecast');
    expect(statusLabel('posted')).toBe('Posted');
    expect(kindLabel('application due')).toBe('Application due');
    expect(dayText('2027-03-09')).toBe('9 March 2027');
    expect(longDayText('2027-03-09')).toBe('Tuesday 9 March 2027');
    expect(() => dayText('soon')).toThrow();
  });

  it('keeps the paragraphs of a plain text and gathers spaces', () => {
    expect(paragraphs('One   line\r\n\r\n  Two lines \nThree')).toEqual(['One line', 'Two lines', 'Three']);
    expect(paragraphs('')).toEqual([]);
  });

  it('groups by month, lists the flags and names the listing of the Health Center Program', () => {
    expect(byMonth(data.events.slice(0, 3))[0]!.label).toBe('September 2026');
    expect(programListingNumbers(data)).toEqual(['93.224']);
    const flagged = data.opportunities.find((o) => o.healthCenterProgram)!;
    expect(flagLabels(flagged)).toContain('Health Center Program listing');
    expect(foundByText(['hrsa-health-center', 'any-agency-fqhc'])).toBe('Both questions');
    expect(foundByText(['any-agency-fqhc'])).toBe('Question 2');
    const sorted = registerNewestFirst(data).map((d) => d.publicationDate);
    expect(sorted).toEqual([...sorted].sort().reverse());
  });
});
