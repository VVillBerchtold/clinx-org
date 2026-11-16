import type { APIRoute } from 'astro';
import { centerKeys, rawFile, slugOf } from '../../../../../lib/hc-records';

/**
 * One file for each health center: /data/health-centers/records/centers/<key>.json holds that center's
 * reports for every year. It is the copied file, byte for byte, written into dist at build time.
 */
export function getStaticPaths() {
  return centerKeys().map((key) => ({ params: { key: slugOf(key) }, props: { centerKey: key } }));
}

export const GET: APIRoute = ({ props }) => {
  const { centerKey } = props as { centerKey: string };
  return new Response(rawFile(`centers/${centerKey}.json`), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
