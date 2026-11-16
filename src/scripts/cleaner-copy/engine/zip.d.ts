// What zip.js gives, described for the type check.

/** One part of a zip file as it was read: its name, how it is packed, and its packed bytes. */
export interface ZipPart {
  name: string;
  method: number;
  crc: number;
  size: number;
  packed: Uint8Array;
}

/** A part to write: one that was read (copied across as it is), or a new one given as text or as bytes. */
export type NewPart = ZipPart | { name: string; text: string } | { name: string; data: Uint8Array };

/** Lists the parts of a zip. Nothing is unpacked until asked. */
export function readZip(bytes: Uint8Array): ZipPart[];

/** The unpacked bytes of one part. */
export function unpack(part: ZipPart): Promise<Uint8Array>;

/** One part as text. */
export function text(part: ZipPart): Promise<string>;

/** Writes a zip from the parts given. */
export function writeZip(parts: NewPart[]): Promise<Uint8Array>;

/** Writes a small zip at once, each part stored as it is, not packed. */
export function storeZip(parts: ({ name: string; text: string } | { name: string; data: Uint8Array })[]): Uint8Array;
