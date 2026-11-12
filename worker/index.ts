/**
 * The only program that runs on the server for ClinX.org. The host serves every page and file by
 * itself and sends this program only the paths under /api/ (see wrangler.jsonc).
 */
import { handleContact, type ContactEnv } from './contact';

export default {
  async fetch(request: Request, env: ContactEnv): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/contact') return handleContact(request, env);
    return new Response('Not found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  },
};
