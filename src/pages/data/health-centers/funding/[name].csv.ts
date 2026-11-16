import type { APIRoute } from 'astro';
import { DOWNLOADS, fundingFile } from '../../../../lib/hc-funding';

/** The CSV downloads of the funding calendar: opportunities.csv, deadlines.csv and register.csv, from the copies in src/data. */
export function getStaticPaths() {
  return DOWNLOADS.filter((d) => d.name.endsWith('.csv')).map((d) => ({ params: { name: d.name.replace(/\.csv$/, '') } }));
}

export const GET: APIRoute = ({ params }) => new Response(fundingFile(`${params['name']}.csv`), { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
