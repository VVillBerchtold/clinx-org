import { split } from '../../worker/mcp/split.js';
import { FILES, reportFile } from '../../worker/mcp/tables.js';

/**
 * The filed reports file cut in two, for the open files the assistants server reads: an index of
 * the reports and one small file for each report. The cut is made by the server's own function,
 * `split`, so the site and the server cannot disagree about it. Nothing here changes a figure.
 */
const modules = import.meta.glob('../data/dataset/340b-state-filings.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

type Cut = ReturnType<typeof split>;
let cached: Cut | undefined;

export function getFilingsCut(): Cut {
  if (cached) return cached;
  const text = Object.values(modules)[0];
  if (text === undefined) throw new Error('the filed reports file is not in src/data/dataset');
  cached = split(JSON.parse(text));
  return cached;
}

/** The index file's name, and the name of one report's file (both written once, in the server's tables.js). */
export const INDEX_FILE: string = FILES.filingsIndex;
export const reportFileName = (filingId: string): string => reportFile(filingId);
