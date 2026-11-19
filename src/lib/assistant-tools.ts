/**
 * The lookups an AI assistant can make, for the page that explains them (/data/assistants/).
 *
 * The list is read from the server's own definitions in worker/mcp, so a lookup that is added,
 * renamed or removed there changes the page at the next build. Each lookup's name and title come
 * from its definition. Its one line for a reader is written here, because the definition's own
 * description is written for the assistant and names inputs a reader never sees. The build stops
 * when a lookup has no line here, when a line here names a lookup that no longer exists, or when
 * no lookup is read at all.
 */
import { HEALTH_CENTER_TOOLS } from '../../worker/mcp/health-center-tools.js';
import { TOOLS } from '../../worker/mcp/tools.js';

export interface AssistantTool {
  /** The name the assistant calls it by, such as find_bills. */
  name: string;
  /** The title from the definition, such as "Find 340B bills". */
  title: string;
  /** One line for a reader. */
  line: string;
}

export interface AssistantToolGroup {
  id: '340b' | 'health-centers' | 'all';
  label: string;
  tools: AssistantTool[];
}

/** One line for a reader, by the lookup's name. */
export const TOOL_LINES: Readonly<Record<string, string>> = {
  find_bills: 'Bills in Congress and the state legislatures that name 340B, by state, by how far they have gone, or by words in the title.',
  get_bill: 'One bill: its sponsor, how far it has gone, each dated step and the passage that names 340B.',
  find_laws: 'State laws on the books that name 340B, by state or by what the law does, such as contract pharmacy or reporting.',
  get_law: 'One law: who it binds, what it limits, how it is enforced, its dates and the link to the official text.',
  find_notices: 'Federal rules, proposed rules and notices since January 2025 that name 340B, and which of them are open for comment.',
  get_notice: 'One rule or notice: the agency, what it does about 340B, the days it sets and its Federal Register page.',
  calendar: 'The dated steps of bills, the days a state report is due, hearings, session dates and federal dates, for a state or a stretch of days.',
  reporting_states: 'The states whose law requires 340B reports, grouped by what the public can see of them.',
  find_filings: 'The reports that covered entities and states have filed, by state, year, name or 340B ID.',
  get_filing: 'One filed report, line by line as filed, with the official file it was read from.',
  state_overview: 'The laws, bills, filed reports and next dates for one state, for Congress or for the federal agencies.',
  find_health_centers: 'The health centers whose yearly reports to HRSA are held, by state, name, city or year, in the order of their names.',
  get_health_center_report: 'One health center’s report for a year, one table at a time, each value as HRSA published it.',
  find_funding_opportunities: 'HRSA’s funding opportunities on Grants.gov, forecast and posted, with each due date as published.',
  health_center_calendar: 'The days a funding notice is expected, applications are due and awards are expected, and the Federal Register dates for the Health Center Program.',
  shortage_area_changes: 'Shortage designations and health center sites in a state: the counts, what changed in the last 365 days, and designations proposed for withdrawal.',
  about_the_data: 'What the data holds, where each part comes from, when each part was last read, and the licence.',
};

/** The one lookup that is about every table, so it sits in neither group. */
const ABOUT = 'about_the_data';

interface Definition {
  name: string;
  title: string;
}

/**
 * The lookups in the order the server lists them, in three groups. The two arguments are the
 * server's definitions; a test passes its own to prove the build stops when the lists disagree.
 */
export function assistantToolGroups(all: readonly Definition[] = TOOLS, healthCenters: readonly Definition[] = HEALTH_CENTER_TOOLS, lines: Readonly<Record<string, string>> = TOOL_LINES): AssistantToolGroup[] {
  if (all.length === 0) throw new Error('No lookups were read from worker/mcp/tools.js, so the assistants page would list none');
  const names = new Set(all.map((t) => t.name));
  const stale = Object.keys(lines).filter((name) => !names.has(name));
  if (stale.length > 0) throw new Error(`src/lib/assistant-tools.ts has a line for ${stale.join(', ')}, which the server no longer lists`);
  const hc = new Set(healthCenters.map((t) => t.name));
  const groups: AssistantToolGroup[] = [
    { id: '340b', label: '340B', tools: [] },
    { id: 'health-centers', label: 'Health centers', tools: [] },
    { id: 'all', label: 'Across both', tools: [] },
  ];
  for (const t of all) {
    const line = lines[t.name];
    if (!line) throw new Error(`The lookup ${t.name} has no line in src/lib/assistant-tools.ts; add one sentence that says what it answers`);
    if (!t.title) throw new Error(`The lookup ${t.name} has no title in worker/mcp`);
    const group = t.name === ABOUT ? groups[2]! : hc.has(t.name) ? groups[1]! : groups[0]!;
    group.tools.push({ name: t.name, title: t.title, line });
  }
  return groups.filter((g) => g.tools.length > 0);
}

/** How many lookups there are. */
export function assistantToolCount(): number {
  return TOOLS.length;
}

/** The server's address, as a person gives it to an assistant. */
export const ASSISTANTS_ADDRESS = 'https://clinx.org/mcp';

/** The link that opens Claude's own "add a connector" box with the name and address filled in. */
export const CLAUDE_ADD_LINK = `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=ClinX&connectorUrl=${encodeURIComponent(ASSISTANTS_ADDRESS)}`;

/** What VS Code keeps in its mcp.json file for this server. */
export const VSCODE_SETTINGS = JSON.stringify({ servers: { clinx: { type: 'http', url: ASSISTANTS_ADDRESS } } }, null, 2);

/** The link VS Code opens to add the server itself. */
export const VSCODE_ADD_LINK = `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: 'clinx', type: 'http', url: ASSISTANTS_ADDRESS }))}`;
