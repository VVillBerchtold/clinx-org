import type { APIRoute } from 'astro';
import { statesCsv } from '../../lib/reach';

/** Contract pharmacy reach, one row per place, from src/data/registry/reach.json. */
export const GET: APIRoute = () => new Response(statesCsv(), { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
