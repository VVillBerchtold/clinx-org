import type { APIRoute } from 'astro';
import { rawFile } from '../../../../lib/hc-records';

/** How many health centers HRSA lists in each state each year, and whether ClinX shows their reports: /data/health-centers/records/coverage.csv. */
export const GET: APIRoute = () => new Response(rawFile('coverage.csv'), { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
