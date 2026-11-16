// The messages that pass between the Cleaner Copy page and its worker. The worker is a second
// script from this site that does the reading and writing, so the page stays quick to use.
import type { Check, Choices, DescribedSheet, Kind, LegendGroup, Report } from './engine/index.js';

export type ToWorker =
  | { id: number; type: 'load'; name: string; bytes: Uint8Array }
  | { id: number; type: 'sample' }
  | { id: number; type: 'copy'; choices: Choices }
  | { id: number; type: 'forget' };

export interface LoadedFile {
  name: string;
  size: number;
  kind: Kind;
  report: Report;
  /** How long the look took, in milliseconds. */
  ms: number;
}

export interface MadeCopy {
  bytes: Uint8Array;
  report: Report;
  check: Check;
  described: DescribedSheet[];
  /** Each code beside the real value it stands for. Empty when no column was coded. */
  legend: LegendGroup[];
  /** The legend as a small workbook for the person to save, or null when there is none. */
  legendBytes: Uint8Array | null;
  ms: number;
}

export type FromWorker =
  | { id: number; ok: true; type: 'loaded'; file: LoadedFile }
  | { id: number; ok: true; type: 'copied'; copy: MadeCopy }
  | { id: number; ok: true; type: 'forgotten' }
  | { id: number; ok: false; problem: string };

/** The worker's first message: its own file has arrived and it is ready for a question. */
export type WorkerReady = { ready: true };
