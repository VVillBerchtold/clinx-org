// The few Node functions the health center records library (src/lib/hc-records.ts) and its test use; the
// project carries no Node type package.
declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  /** 'hex' gives a file's bytes as hex digits, two for each byte: enough to read the size a PNG states (tests/assistant-icon.test.ts). */
  export function readFileSync(path: string, encoding: 'utf8' | 'hex'): string;
  /** With no encoding, the file's bytes: enough to work out a file's fingerprint (tests/file-check/saved-copy.test.ts). */
  export function readFileSync(path: string): Uint8Array;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isDirectory(): boolean; size: number };
}
declare module 'node:crypto' {
  /** The SHA-256 of some text or bytes, as hex digits or in base64. */
  export function createHash(kind: 'sha256'): { update(data: string | Uint8Array): { digest(how: 'hex' | 'base64'): string } };
}
declare module 'node:path' {
  export function dirname(path: string): string;
  export function join(...parts: string[]): string;
}
declare module 'node:url' {
  export function fileURLToPath(url: string): string;
}
declare module 'node:process' {
  export function cwd(): string;
}
