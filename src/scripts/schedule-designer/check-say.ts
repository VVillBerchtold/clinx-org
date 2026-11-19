// What Check and save says about a week, worked out apart from the page so that it can be tested:
// the findings in the order they are listed, the sentence above them, and each department's word
// on its people. The count in the sentence is made from the same list the page draws.
import { clock, dayName, personOf, roomOf, siteOfRoom, tallyPerson } from './engine/index';
import type { Finding, Level, Schedule } from './engine/index';
import { plural } from './dom';

export const LEVELS: readonly { level: Level; title: string; icon: string; words: string }[] = [
  { level: 'fix', title: 'Fix these', icon: 'alert', words: 'to fix' },
  { level: 'look', title: 'Worth a look', icon: 'info', words: 'worth a look' },
  { level: 'note', title: 'Good to know', icon: 'check', words: 'good to know' },
];

export interface FindingSection {
  level: Level;
  title: string;
  icon: string;
  words: string;
  /** Every finding of this level, in the order it is listed. */
  count: number;
  groups: { name: string; items: Finding[] }[];
}

/** The findings as the page lists them: a section for each level that has any, and groups inside it. */
export function sectionsOf(found: readonly Finding[]): FindingSection[] {
  const sections: FindingSection[] = [];
  for (const { level, title, icon, words } of LEVELS) {
    const mine = found.filter((finding) => finding.level === level);
    if (mine.length === 0) continue;
    const groups: { name: string; items: Finding[] }[] = [];
    for (const finding of mine) {
      const group = groups.find((item) => item.name === finding.group);
      if (group) group.items.push(finding);
      else groups.push({ name: finding.group, items: [finding] });
    }
    sections.push({ level, title, icon, words, count: mine.length, groups });
  }
  return sections;
}

/** How many findings the sections list, counted item by item. */
export const listedIn = (sections: readonly FindingSection[]): number => sections.reduce((sum, section) => sum + section.groups.reduce((inner, group) => inner + group.items.length, 0), 0);

function joined(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] ?? ''}`;
}

export interface CheckSay {
  /** 'empty' when nobody has any time painted, 'ready' when nothing needs fixing or a look, else 'listed'. */
  state: 'empty' | 'ready' | 'listed';
  /** The sentence under the heading of the step. */
  say: string;
  /** A few words for the bar along the bottom. */
  short: string;
  /** How many findings are listed under the sentence. */
  listed: number;
  fixes: number;
  looks: number;
  sections: FindingSection[];
}

/** What the step says above its findings. Before anyone has painted time there is nothing to check. */
export function checkSay(s: Schedule, found: readonly Finding[]): CheckSay {
  const fixes = found.filter((finding) => finding.level === 'fix').length;
  const looks = found.filter((finding) => finding.level === 'look').length;
  if (s.blocks.length === 0) {
    const say = s.people.length === 0 ? 'There is nothing to check yet. Add a person in Set up, then build their week in Design.' : 'There is nothing to check yet. Add time to a week in Design, then come back here.';
    return { state: 'empty', say, short: 'Nothing to check yet', listed: 0, fixes: 0, looks: 0, sections: [] };
  }
  const sections = sectionsOf(found);
  const listed = listedIn(sections);
  const parts = sections.map((section) => `${section.count} ${section.words}`);
  const say =
    listed === 0
      ? 'The page read the whole week and found nothing to list.'
      : sections.length === 1
        ? `The page read the whole week and lists ${plural(listed, 'thing')}${listed === 1 ? '' : ', all'} ${sections[0]?.words ?? ''}.`
        : `The page read the whole week and lists ${plural(listed, 'thing')}: ${joined(parts)}.`;
  const short = fixes > 0 ? `${plural(fixes, 'thing')} to fix` : looks > 0 ? `${plural(looks, 'thing')} worth a look` : 'Nothing needs fixing';
  return { state: fixes + looks === 0 ? 'ready' : 'listed', say, short, listed, fixes, looks, sections };
}

export interface DepartmentSay {
  /** 'met' only when every counted person is on target. */
  state: 'met' | 'short' | 'over' | 'mixed' | 'none';
  say: string;
  onTarget: number;
  under: number;
  over: number;
}

/**
 * A department's word on its people. Two people who are off in opposite ways add up to no
 * difference in slots, so the word comes from each person's own verdict and never from the sum.
 */
export function departmentSay(s: Schedule, departmentId: string): DepartmentSay {
  let onTarget = 0;
  let under = 0;
  let over = 0;
  for (const person of s.people) {
    if (person.departmentId !== departmentId) continue;
    const verdict = tallyPerson(s, person.id)?.slots.verdict;
    if (verdict === 'on-target') onTarget++;
    else if (verdict === 'under') under++;
    else if (verdict === 'over') over++;
  }
  const counted = onTarget + under + over;
  if (counted === 0) return { state: 'none', say: 'Nobody counted yet', onTarget, under, over };
  if (under === 0 && over === 0) return { state: 'met', say: counted === 1 ? 'On target' : `All ${counted} on target`, onTarget, under, over };
  const parts = [under > 0 ? `${under} under` : '', over > 0 ? `${over} over` : ''].filter(Boolean);
  return { state: under > 0 && over > 0 ? 'mixed' : under > 0 ? 'short' : 'over', say: parts.join(', '), onTarget, under, over };
}

/** One sentence that names what "Show it" is showing, for the line under the week and for a screen reader. */
export function showSay(s: Schedule, finding: Finding): string {
  const person = finding.personId === undefined ? undefined : personOf(s, finding.personId);
  if (person) {
    if (finding.day === undefined) return `Showing the week of ${person.name}.`;
    return `Showing ${person.name} on ${dayName(finding.day)}${finding.start === undefined ? '' : ` at ${clock(finding.start)}`}.`;
  }
  const room = finding.roomId === undefined ? undefined : roomOf(s, finding.roomId);
  if (room) return `Showing ${room.name} at ${siteOfRoom(s, room.id)?.name ?? 'its site'}${finding.day === undefined ? '' : ` on ${dayName(finding.day)}`}.`;
  return '';
}
