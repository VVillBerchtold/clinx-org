import type { APIRoute } from 'astro';
import { setsIndex } from '../../../lib/hc-assistant';

/**
 * /data/health-centers/index.json: the three health center sets and the day each was read. It is
 * written for the server that answers assistants (worker/mcp), which reads JSON only.
 */
export const GET: APIRoute = () => new Response(`${JSON.stringify(setsIndex(), null, 1)}\n`, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
