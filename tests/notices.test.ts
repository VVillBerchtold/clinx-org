import { describe, expect, it } from 'vitest';
import { NOTICE_COLUMNS, NOTICE_TYPES as SHAPE_TYPES, billsProblems } from '../scripts/bills-shape.mjs';
import { BILL_ROLES } from '../src/lib/bills';
import { parseEvents } from '../src/lib/calendar';
import { AGENCIES, NOTICE_TYPES, PILOT_NOTICE, TYPE_NOTES, namedInWords, noticeHref, openForComment, parseNotices, pilotStart, rankOf, typeLabel, writerOf, type Notice } from '../src/lib/notices';
import { CLAIM_FIELDS, DRUG_LIST, SELECTED_DRUGS } from '../src/lib/pilot';

// The notices table is read from the copy this site was built from, so these tests follow the real table.
const modules = import.meta.glob('../src/data/bills/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const files = Object.fromEntries(Object.entries(modules).map(([path, text]) => [path.split('/').pop()!, text]));
delete files['SOURCE.json'];
const data = parseNotices(files['340b-notices.json']!);
const calendar = parseEvents(files['340b-events.json']!);

describe('the notices table', () => {
  it('is what the shape check expects, and the reader and the check agree on types, roles and columns', () => {
    expect(billsProblems(files)).toEqual([]);
    expect([...NOTICE_TYPES]).toEqual(SHAPE_TYPES);
    expect([...data.roleLabels.keys()]).toEqual([...BILL_ROLES]);
    expect(files['notices.csv']!.split('\n', 1)[0]).toBe(NOTICE_COLUMNS.join(','));
    expect(Object.keys(JSON.parse(files['340b-notices.json']!).notices[0])).toEqual([...NOTICE_COLUMNS, 'dates_read']);
  });

  it('gives every document a name, a citation, a title, an agency, a day and a Federal Register page, newest first', () => {
    expect(data.notices.length).toBeGreaterThan(0);
    for (const notice of data.notices) {
      expect(notice.noticeId).toBe(`fr-${notice.documentNumber}`);
      expect(notice.citation).toMatch(/^\d+ FR \d+$/);
      expect(notice.title).not.toBe('');
      expect(writerOf(notice)).not.toBe('');
      expect(notice.noticeUrl).toMatch(/^https:\/\/www\.federalregister\.gov\/\S+$/);
      expect(notice.namedIn.length).toBeGreaterThan(0);
      // What a person adds comes together or not at all.
      expect(notice.role === '').toBe(notice.summary === '');
      expect(typeLabel(notice.type)).not.toBe('');
      expect(namedInWords(notice)).not.toBe('');
      expect(noticeHref(notice.noticeId)).toBe(`/notices/#${notice.noticeId}`);
    }
    expect(new Set(data.notices.map((n) => n.noticeId)).size).toBe(data.notices.length);
    const days = data.notices.map((n) => n.published);
    expect(days).toEqual([...days].sort().reverse());
    expect(Object.keys(TYPE_NOTES)).toEqual([...NOTICE_TYPES]);
  });

  it('puts every document in exactly one of the three groups of the page', () => {
    const groups = [0, 1, 2].map((rank) => data.notices.filter((n) => rankOf(n) === rank));
    expect(groups.reduce((sum, g) => sum + g.length, 0)).toBe(data.notices.length);
    expect(groups[2]!.every((n) => n.role === 'mention')).toBe(true);
    const unread: Notice = { ...data.notices[0]!, role: '', summary: '', namedIn: ['text'], textMentions: 3 };
    expect(rankOf(unread)).toBe(1);
    expect(rankOf({ ...unread, namedIn: ['title', 'text'] })).toBe(0);
    expect(namedInWords(unread)).toBe('Names 340B 3 times');
    expect(namedInWords({ ...unread, namedIn: ['title', 'text'] })).toBe('340B in the title');
  });

  it('says a document is open for comment up to and on its last day, and not after', () => {
    const notice: Notice = { ...data.notices[0]!, commentsClose: '2026-11-23' };
    expect(openForComment(notice, '2026-11-15')).toBe(true);
    expect(openForComment(notice, '2026-11-23')).toBe(true);
    expect(openForComment(notice, '2026-11-24')).toBe(false);
    expect(openForComment({ ...notice, commentsClose: '' }, '2026-11-15')).toBe(false);
  });

  it('refuses a file it does not expect', () => {
    const document = JSON.parse(files['340b-notices.json']!);
    const broken = (change: (notice: Record<string, unknown>) => void): string => {
      const copy = structuredClone(document);
      // A document that has been read: the newest one may not be yet.
      change(copy.notices.find((n: Record<string, unknown>) => n['summary'] !== '')!);
      return JSON.stringify(copy);
    };
    expect(() => parseNotices(broken((n) => (n['type'] = 'Memo')))).toThrow(/unknown type/);
    expect(() => parseNotices(broken((n) => (n['role'] = 'sponsor')))).toThrow(/unknown role/);
    expect(() => parseNotices(broken((n) => (n['effective'] = 'soon')))).toThrow(/not a date/);
    expect(() => parseNotices(broken((n) => (n['notice_url'] = 'somewhere')))).toThrow(/official page/);
    const problems = (change: (notice: Record<string, unknown>) => void): string => billsProblems({ ...files, '340b-notices.json': broken(change) }).join('\n');
    expect(problems((n) => (n['type'] = 'Memo'))).toMatch(/unknown type Memo/);
    expect(problems((n) => (n['summary'] = ''))).toMatch(/read, but no sentence|a sentence, but no role/);
    expect(problems((n) => (n['notice_url'] = 'https://example.com/x'))).toMatch(/no Federal Register page/);
    expect(problems((n) => (n['notice_id'] = 'fr-1'))).toMatch(/its name is not/);
    expect(billsProblems({ ...files, 'notices.csv': files['notices.csv']!.replace('notice_id,', 'id,') }).join('\n')).toMatch(/columns/);
  });
});

describe('federal dates on the calendar', () => {
  const federal = calendar.events.filter((e) => e.place === AGENCIES);
  const byId = new Map(data.notices.map((n) => [n.noticeId, n]));

  it('carries each official day of a document about 340B, or with a part on it, and no day of one that only mentions it', () => {
    expect(federal.length).toBeGreaterThan(0);
    for (const event of federal) {
      const notice = byId.get(event.noticeId)!;
      expect(notice).toBeDefined();
      expect(rankOf(notice)).not.toBe(2);
      if (event.kind === 'notice published') expect(event.day).toBe(notice.published);
      if (event.kind === 'comments close') expect(event.day).toBe(notice.commentsClose);
      if (event.kind === 'takes effect') expect(event.day).toBe(notice.effective);
      if (event.kind === 'date set by a notice') expect(notice.datesRead.some((d) => d.day === event.day && d.what === event.what)).toBe(true);
      else expect(event.what).toBe(notice.title);
      expect(event.link).toBe(notice.noticeUrl);
    }
    // A document nobody has read yet is on the calendar only when its title names the program.
    const onCalendar = (n: (typeof data.notices)[number]): boolean => (n.role === 'main' || n.role === 'part' || (n.role === '' && n.namedIn.includes('title')));
    for (const notice of data.notices.filter(onCalendar)) {
      expect(federal.some((e) => e.noticeId === notice.noticeId && e.kind === 'notice published')).toBe(true);
    }
  });
});

describe('the rebate pilot page', () => {
  it('finds its notice, with the day it takes effect', () => {
    const notice = byIdOrFail(PILOT_NOTICE);
    expect(notice.role).toBe('main');
    expect(pilotStart(data)).toBe(notice.effective);
    expect(pilotStart(data)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(byIdOrFail('fr-2025-14619').citation).not.toBe('');
    expect(byIdOrFail('fr-2026-03042').citation).not.toBe('');
  });

  it('lists each selected drug once, with its ingredient, and the claim fields as two lists', () => {
    const drugs = SELECTED_DRUGS.flatMap((group) => group.drugs);
    expect(SELECTED_DRUGS.map((group) => group.year)).toEqual([2026, 2027]);
    expect(SELECTED_DRUGS.map((group) => group.drugs.length)).toEqual([10, 15]);
    expect(new Set(drugs.map((d) => d.name)).size).toBe(drugs.length);
    expect(drugs.every((d) => d.name !== '' && d.ingredient !== '')).toBe(true);
    for (const group of SELECTED_DRUGS) expect(group.drugs.map((d) => d.name)).toEqual([...group.drugs.map((d) => d.name)].sort((a, b) => a.localeCompare(b, 'en')));
    expect(DRUG_LIST.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(DRUG_LIST.url).toMatch(/^https:\/\/www\.cms\.gov\//);
    expect(CLAIM_FIELDS.pharmacy).toHaveLength(11);
    expect(CLAIM_FIELDS.medical).toHaveLength(12);
  });
});

function byIdOrFail(id: string): Notice {
  const found = data.notices.find((n) => n.noticeId === id);
  if (!found) throw new Error(`${id} is not in the notices table`);
  return found;
}
