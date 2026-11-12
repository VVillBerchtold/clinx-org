import type { APIRoute } from 'astro';
import { PREVIEW, SITE_URL } from '../lib/site';

/**
 * robots.txt follows the go-live switch. While the site is a private preview it turns every
 * crawler away. Once public it opens the pages, keeps crawlers off the form's address, and
 * points to the page list.
 */
export const GET: APIRoute = () => {
  const text = PREVIEW
    ? 'User-agent: *\nDisallow: /\n'
    : `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
