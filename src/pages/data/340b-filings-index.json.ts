import type { APIRoute } from 'astro';
import { getFilingsCut } from '../../lib/filings-split';

/**
 * The open file /data/340b-filings-index.json: every filed record with its filer, its dates and the
 * numbers about it, but none of its lines. The assistants server reads this and then one record's file
 * at a time (/data/filings/<filing id>.json), so it never has to read the 24 MB file whole.
 */
export const GET: APIRoute = () =>
  new Response(JSON.stringify(getFilingsCut().index), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
