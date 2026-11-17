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

  it('has its parts in order, ending with where ClinX fits', () => {
    expect(renderSections(essay).map((s) => s.title)).toEqual([
      '',
      'Why software became something to rent',
      'What has changed',
      'The tool goes to the file',
      'Anyone can check it',
      'What is still worth paying for',
      'Three things to try this year',
      'Where ClinX fits',
    ]);
  });

  it('says what is still worth paying for, and the limits of a tool made on request', () => {
    const part = essay.slice(essay.indexOf('## What is still worth paying for'), essay.indexOf('## Three things to try this year'));
    for (const said of ['A record that many people share', 'Upkeep.', 'Someone answerable.', 'It has to be tested before anyone relies on it', 'already compromised']) {
      expect(part, said).toContain(said);
    }
  });

  it('leaves the decision about review with the clinic', () => {
    expect(essay).toContain('What still needs review is a decision for whoever is responsible for that at the clinic.');
  });

  it('promises nothing about a file, and ranks nothing', () => {
    expect(essay).not.toMatch(/\b(safe|safely|secure|anonymi[sz]ed|de-identified|HIPAA|compliant|guarantee[sd]?)\b/i);
    expect(essay).not.toMatch(/\b(best|highest|lowest|worst)\b|\btop /i);
  });

  it('is written in the third person and names no company other than ClinX', () => {
    // "my" is left out of the search: the essay quotes the question a reader should ask ("does my file leave my computer?").
    expect(essay).not.toMatch(/\b(I|I'm|I've|I'd|I'll)\b/);
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
