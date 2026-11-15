/**
 * The only program that runs on the server for ClinX.org. The host serves every page and file by
 * itself and sends this program only the paths under /api/ and the door for assistants, /mcp
 * (see wrangler.jsonc).
 */
import { handleAssistants, type AssistantsEnv } from './assistants';
import { handleContact, type ContactEnv } from './contact';

/** Everything the host hands the program. The door for assistants needs the site's files to answer from. */
export type SiteEnv = ContactEnv & Partial<Pick<AssistantsEnv, 'ASSETS' | 'MCP_LIMIT' | 'MCP_USAGE'>>;

export default {
  async fetch(request: Request, env: SiteEnv): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/contact') return handleContact(request, env);
    if (pathname === '/mcp' && env.ASSETS) return handleAssistants(request, { ...env, ASSETS: env.ASSETS });
    return new Response('Not found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  },
};
