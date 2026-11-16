import type { APIRoute } from 'astro';
import { rawFile } from '../../../../lib/hc-areas';

/** /data/health-centers/areas/proposed.csv: the copied table, byte for byte. */
export const GET: APIRoute = () => new Response(rawFile('proposed.csv'), { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
