/**
 * Every page the site has for one state, across its sections, so each state page can link to the others.
 * The list is read from the same data that builds the pages: a state gets a link only where its page is built.
 */
import { billsPath, getBills, statesWithBills } from './bills';
import { calendarPath, getCalendar, placesWithEvents } from './calendar';
import { areaPath, getIndex as getAreasIndex } from './hc-areas';
import { listByState, statePath as recordsStatePath } from './hc-records';
import { getLaws, lawsOf, lawsPath } from './laws';
import { STATE_REGISTRY } from './states';

export interface StatePage {
  href: string;
  label: string;
}

/**
 * The title of a state's 340B report page in the Scorecard: "Minnesota 340B hospital report". The page's
 * title and its heading both start with it, and every state added to the Scorecard is given it by its page's layout.
 */
export function stateReportTitle(name: string): string {
  return `${name} 340B hospital report`;
}

/** A state's pages, in the order of the main menu: the 340B section first, then health centers. */
export function statePages(code: string): StatePage[] {
  const entry = STATE_REGISTRY[code];
  const pages: (StatePage | false)[] = [
    entry?.status === 'live' && !!entry.href && { href: entry.href, label: '340B hospital report' },
    lawsOf(getLaws(), code).length > 0 && { href: lawsPath(code), label: '340B laws' },
    statesWithBills(getBills()).some((s) => s.code === code) && { href: billsPath(code), label: '340B bills' },
    placesWithEvents(getCalendar()).includes(code) && { href: calendarPath(code), label: '340B calendar' },
    listByState().some((g) => g.code === code) && { href: recordsStatePath(code), label: 'Health center records' },
    getAreasIndex().states.includes(code) && { href: areaPath(code), label: 'Shortage areas' },
  ];
  return pages.filter((p): p is StatePage => p !== false);
}
