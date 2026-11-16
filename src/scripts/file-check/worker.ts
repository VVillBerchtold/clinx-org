// The File Check worker: it reads the file the person chose and runs the check over it.
// It runs beside the page, from this site's own file, and like the page it can open no connection.
// It keeps nothing: once the findings are handed to the page, the file's bytes are let go.
import { kindOf } from '../cleaner-copy/engine/kind.js';
import { asText, checkFile } from './engine/index.js';
import type { FromWorker, ToWorker, WorkerReady } from './protocol';
import { SAMPLE_NAME, sampleBytes } from './sample';

const scope = self as unknown as {
  postMessage(message: FromWorker | WorkerReady): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
};

function say(error: unknown): string {
  const text = error instanceof Error ? error.message : '';
  return text && text.length < 200 ? text : 'This file could not be read. It may be damaged, or protected with a password.';
}

async function check(id: number, name: string, bytes: Uint8Array): Promise<void> {
  const started = performance.now();
  const told = kindOf(name, bytes);
  if ('problem' in told) {
    scope.postMessage({ id, ok: false, problem: told.problem });
    return;
  }
  const report = await checkFile(bytes, told.kind);
  scope.postMessage({ id, ok: true, file: { name, size: bytes.length, kind: told.kind, report, text: asText(report), ms: performance.now() - started } });
}

scope.onmessage = (event) => {
  const message = event.data;
  const fail = (error: unknown) => scope.postMessage({ id: message.id, ok: false, problem: say(error) });
  if (message.type === 'sample') check(message.id, SAMPLE_NAME, sampleBytes()).catch(fail);
  else check(message.id, message.name, message.bytes).catch(fail);
};

// Tell the page this file has arrived. The page starts its count of requests after that.
scope.postMessage({ ready: true });
