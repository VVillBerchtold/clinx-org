import type { APIRoute } from 'astro';
import { rawFile } from '../../../../lib/hc-areas';

/** /data/health-centers/areas/sites-recent.csv: the copied table, byte for byte. */
export const GET: APIRoute = () => new Response(rawFile('sites-recent.csv'), { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
