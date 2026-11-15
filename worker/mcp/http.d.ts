import type { Asked, Tables } from './index.js';

/**
 * Answer one web request. `origins` is 'any' for a public host and 'local' on a person's own
 * computer. `counted`, when given, is handed a description of each request by kind.
 */
export declare function respond(request: Request, options: { tables: Tables; origins?: 'any' | 'local'; counted?: (asked: Asked) => void }): Promise<Response>;
