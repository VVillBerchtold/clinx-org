import type { APIRoute } from 'astro';
import { rawFile } from '../../../../lib/hc-records';

/** The lines and columns of each year's report, with HRSA's titles, as copied: /data/health-centers/records/lines.csv. */
export const GET: APIRoute = () => new Response(rawFile('lines.csv'), { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
