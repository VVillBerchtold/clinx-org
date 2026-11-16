import type { APIRoute } from 'astro';
import { SITE_URL } from '../../lib/site';
import { statesFileText } from '../../lib/states';

/**
 * The open file /data/340b-reporting-states.json: the states with a 340B reporting law, grouped by
 * what each state makes public. It is written at build time from the registry in src/lib/states.ts,
 * the one place those facts are typed, so the file and the pages always say the same thing.
 */
export const GET: APIRoute = () =>
  new Response(statesFileText(SITE_URL), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
