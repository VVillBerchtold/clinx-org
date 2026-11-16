import type { APIRoute } from 'astro';
import { linesIndex } from '../../../../lib/hc-assistant';

/**
 * /data/health-centers/records/lines.json: the dictionary of report lines for each year, in a compact
 * form (see src/lib/hc-assistant.ts). The same rows are in lines.csv, which is the file for people.
 */
export const GET: APIRoute = () => new Response(`${JSON.stringify(linesIndex())}\n`, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
