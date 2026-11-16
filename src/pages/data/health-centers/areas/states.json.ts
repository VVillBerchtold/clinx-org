import type { APIRoute } from 'astro';
import { rawFile } from '../../../../lib/hc-areas';

/** /data/health-centers/areas/states.json: counts for every state and territory, as copied. */
export const GET: APIRoute = () => new Response(rawFile('states.json'), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
