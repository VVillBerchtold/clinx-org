// What kind.js gives, described for the type check.

export type Kind = 'workbook' | 'csv';

/** Says what kind of file this is, or why it cannot be read, in a sentence for the person. */
export function kindOf(name: string, bytes: Uint8Array): { kind: Kind } | { problem: string };
