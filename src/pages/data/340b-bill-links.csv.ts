import type { APIRoute } from 'astro';
import { linksCsv } from '../../lib/bill-family';

/** Every link of the bill family tree, one row each, from src/data/bill-family/340b-bill-family.json. */
export const GET: APIRoute = () => new Response(linksCsv(), { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
