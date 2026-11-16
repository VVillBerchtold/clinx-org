import type { APIRoute } from 'astro';
import { getIndex, rawFile } from '../../../../../lib/hc-areas';

/** /data/health-centers/areas/states/<st>.json: everything the page of one state shows, as copied. */
export function getStaticPaths() {
  return getIndex().states.map((code) => ({ params: { st: code.toLowerCase() }, props: { code } }));
}

export const GET: APIRoute = ({ props }) => {
  const { code } = props as { code: string };
  return new Response(rawFile(`states/${code}.json`), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
