import type { APIRoute } from 'astro';
import { DOWNLOADS, fundingFile } from '../../../../lib/hc-funding';

/**
 * The JSON downloads of the funding calendar: /data/health-centers/funding/opportunities.json,
 * deadlines.json and register.json. They are the copies in src/data, written at build time into dist
 * and not kept in public/, so no file is stored twice.
 */
export function getStaticPaths() {
  return DOWNLOADS.filter((d) => d.name.endsWith('.json')).map((d) => ({ params: { name: d.name.replace(/\.json$/, '') } }));
}

export const GET: APIRoute = ({ params }) => new Response(fundingFile(`${params['name']}.json`), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
