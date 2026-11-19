import type { APIRoute } from 'astro';
import { recordsIndex } from '../../../../lib/hc-assistant';

/**
 * /data/health-centers/records/index.json: each health center that has a records page, with its key,
 * name, place, years and page. It is written for the server that answers assistants (worker/mcp).
 */
export const GET: APIRoute = () => new Response(`${JSON.stringify(recordsIndex(), null, 1)}\n`, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
