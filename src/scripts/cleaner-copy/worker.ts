// The Cleaner Copy worker: it holds the file the person chose and does the reading and writing.
// It runs beside the page, from this site's own file, and like the page it can open no connection.
import { inspect, kindOf, legendWorkbook, makeCopy, sampleBytes, SAMPLE_NAME, type Kind } from './engine/index.js';
import type { FromWorker, ToWorker } from './protocol';

const scope = self as unknown as {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
};

/** The file being worked on. It lives only here, in memory, until the page is closed or another file is chosen. */
let held: { name: string; bytes: Uint8Array; kind: Kind } | null = null;

function say(error: unknown): string {
  const text = error instanceof Error ? error.message : '';
  return text && text.length < 200 ? text : 'This file could not be read. It may be damaged, or protected with a password.';
}

async function load(id: number, name: string, bytes: Uint8Array): Promise<void> {
  const started = performance.now();
  const told = kindOf(name, bytes);
  if ('problem' in told) {
    scope.postMessage({ id, ok: false, problem: told.problem });
    return;
  }
  const report = await inspect(bytes, told.kind);
  held = { name, bytes, kind: told.kind };
  scope.postMessage({ id, ok: true, type: 'loaded', file: { name, size: bytes.length, kind: told.kind, report, ms: performance.now() - started } });
}

scope.onmessage = (event) => {
  const message = event.data;
  const fail = (error: unknown) => scope.postMessage({ id: message.id, ok: false, problem: say(error) });
  if (message.type === 'load') {
    load(message.id, message.name, message.bytes).catch(fail);
  } else if (message.type === 'sample') {
    load(message.id, SAMPLE_NAME, sampleBytes()).catch(fail);
  } else if (message.type === 'forget') {
    held = null;
    scope.postMessage({ id: message.id, ok: true, type: 'forgotten' });
  } else {
    const file = held;
    if (!file) {
      fail(new Error('Choose a file first.'));
      return;
    }
    const started = performance.now();
    makeCopy(file.bytes, file.kind, message.choices)
      .then((made) => {
        const legendBytes = made.legend.length ? legendWorkbook(made.legend) : null;
        const copy = { bytes: made.bytes, report: made.report, check: made.check, described: made.described, legend: made.legend, legendBytes, ms: performance.now() - started };
        scope.postMessage({ id: message.id, ok: true, type: 'copied', copy }, [made.bytes.buffer as ArrayBuffer]);
      })
      .catch(fail);
  }
};
