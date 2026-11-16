// The few Node functions the health center records test uses; the project carries no Node type package.
declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isDirectory(): boolean; size: number };
}
declare module 'node:path' {
  export function dirname(path: string): string;
  export function join(...parts: string[]): string;
}
declare module 'node:url' {
  export function fileURLToPath(url: string): string;
}
