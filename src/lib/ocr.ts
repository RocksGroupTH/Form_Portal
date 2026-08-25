import { createWorker, type Worker } from "tesseract.js";

/**
 * Free, self-hosted OCR via Tesseract.js — runs in the Node server, no external
 * API and no per-call cost. The uploaded image never leaves the server (only the
 * English language model is fetched once from a CDN and cached).
 *
 * A single worker is reused across requests, and calls are serialized (Tesseract
 * processes one image at a time) so concurrent uploads don't collide.
 */
let workerPromise: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    // eng + tha so Thai slip dates ("18 ส.ค.2569") are read too. If the Thai model
    // can't be fetched (e.g. CDN blocked), fall back to English-only so amounts and
    // numeric dates still work.
    workerPromise = createWorker(["eng", "tha"])
      .catch(() => createWorker("eng"))
      .catch((e) => {
        workerPromise = null; // allow retry on a later request
        throw e;
      });
  }
  return workerPromise;
}

/** OCR an image buffer → recognized text. Serialized on a shared worker. */
export async function readImageText(buffer: Buffer): Promise<string> {
  const run = queue.then(async () => {
    const worker = await getWorker();
    const { data } = await worker.recognize(buffer);
    return data.text ?? "";
  });
  // Keep the chain alive even if this run rejects, so the next call still proceeds.
  queue = run.catch(() => undefined);
  return run;
}
