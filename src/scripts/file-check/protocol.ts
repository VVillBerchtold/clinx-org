// The messages that pass between the File Check page and its worker. The worker is a second
// script from this site that reads the file, so the page stays quick to use.
import type { CheckReport, Kind } from './engine/index.js';

export type ToWorker = { id: number; type: 'check'; name: string; bytes: Uint8Array } | { id: number; type: 'sample' };

export interface CheckedFile {
  name: string;
  size: number;
  kind: Kind;
  report: CheckReport;
  /** The findings as plain text for pasting: counts, places, headings and sheet names, no value from a cell. */
  text: string;
  /** How long the check took, in milliseconds. */
  ms: number;
}

export type FromWorker = { id: number; ok: true; file: CheckedFile } | { id: number; ok: false; problem: string };
