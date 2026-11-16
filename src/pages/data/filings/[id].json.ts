import type { APIRoute } from 'astro';
import { getFilingsCut } from '../../../lib/filings-split';

/**
 * One file for each filed record: /data/filings/<filing id>.json holds that record's lines and its
 * differences. They are written at build time into dist and are not kept in public/.
 */
export function getStaticPaths() {
  return Object.keys(getFilingsCut().reports).map((id) => ({ params: { id: id.toLowerCase() }, props: { filingId: id } }));
}

export const GET: APIRoute = ({ props }) => {
  const { filingId } = props as { filingId: string };
  return new Response(JSON.stringify(getFilingsCut().reports[filingId]), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
