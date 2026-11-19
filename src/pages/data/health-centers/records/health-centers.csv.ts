import type { APIRoute } from 'astro';
import { rawFile } from '../../../../lib/hc-records';

/** The list of health centers, one row for each center and year, as copied: /data/health-centers/records/health-centers.csv. */
export const GET: APIRoute = () => new Response(rawFile('health-centers.csv'), { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
