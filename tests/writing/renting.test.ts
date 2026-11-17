import { describe, expect, it } from 'vitest';
import essay from '../../src/content/what-are-we-renting.md?raw';
import page from '../../src/pages/writing/what-are-we-renting/index.astro?raw';
import { renderSections } from '../../src/lib/markdown';
import { CHECKING_ARTICLE_TITLE, RENTING_ARTICLE_PUBLISHED, RENTING_ARTICLE_TITLE } from '../../src/lib/site';

// The essay makes an argument, so these checks hold it to the rules the rest of the site keeps:
// it is fair about what a subscription is still for, it promises nothing about a file, and it
// names no company.
const words = essay.match(/[A-Za-z0-9'’-]+/g) ?? [];

describe('The essay "What are we renting?"', () => {
  it('carries the title the Writing page shows, and a day it went public', () => {
    expect(essay.startsWith(`# ${RENTING_ARTICLE_TITLE}\n`)).toBe(true);
    expect(RENTING_ARTICLE_PUBLISHED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('has its parts in order, ending with one working example', () => {
    expect(renderSections(essay).map((s) => s.title)).toEqual([
      '',
      'Why software became something to rent',
      'What has changed',
      'The tool goes to the file',
      'Anyone can check it',
      'What is still worth paying for',
      'Three things to try this year',
      'One working example',
    ]);
  });

  it('says what is still worth paying for, and the limits of a tool made on request', () => {
    const part = essay.slice(essay.indexOf('## What is still worth paying for'), essay.indexOf('## Three things to try this year'));
    for (const said of ['Data that many users share and edit at the same time', 'Upkeep.', 'Accountability.', 'Test files with known answers need to be run with each change', 'Owners and maintainers need to be named, by role', 'already compromised', 'the size of a file that has been tested']) {
      expect(part, said).toContain(said);
    }
  });

  it('leaves the decision about review with the clinic', () => {
    expect(essay).toContain('What still needs review is a decision for whoever is responsible for that data at the clinic');
    expect(essay).toContain("Each clinic's policy will decide who can run new tools and who signs off on them");
  });

  it('says which jobs the claim covers, and what the checks do not show', () => {
    expect(essay).toContain('It covers processes that start with a file and end with a file');
    expect(essay).toContain('they will not show that the totals are correct');
    // Two claims are kept modest: how much of what a clinic looks up is public, and how many clinics the change in policy is large for.
    expect(essay).toContain('Much of what clinics look up is public record.');
    expect(essay).toContain('for many clinics this change is as large as the technical one');
    expect(essay).toContain('A check also counts only for the version being examined.');
  });

  it('promises nothing about a file, and ranks nothing', () => {
    expect(essay).not.toMatch(/\b(safe|safely|secure|anonymi[sz]ed|de-identified|HIPAA|compliant|guarantee[sd]?)\b/i);
    expect(essay).not.toMatch(/\b(best|highest|lowest|worst)\b|\btop /i);
  });

  it('is written in the third person and names no company other than ClinX', () => {
    // "me" is left out of the search: the essay quotes a request typed to an assistant ("give me the totals ...").
    // The title asks its question with "we", so the search starts after the title.
    expect(essay.slice(essay.indexOf('\n'))).not.toMatch(/\b(I|I'm|I've|I'd|I'll|My|my|We|we|Our|our)\b/);
    expect(essay).not.toMatch(/\b(Anthropic|OpenAI|Microsoft|Google|Epic|Cerner|Oracle|athena\w*|eClinicalWorks|NextGen|Salesforce)\b/i);
    expect(essay).not.toContain('@');
  });

  it('names the guide by the title that guide carries', () => {
    expect(essay).toContain(`The guide "${CHECKING_ARTICLE_TITLE}" walks through them.`);
    expect(page).toContain('href="/writing/check-a-page/"');
  });

  it('takes about as long to read as its page says', () => {
    const minutes = Number(page.match(/(\d+) minute read/)?.[1]);
    expect(Math.abs(words.length / 230 - minutes)).toBeLessThan(1);
  });
});
