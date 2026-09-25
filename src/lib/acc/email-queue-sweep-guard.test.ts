import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EMAIL_SWEEP_BATCH, EMAIL_SWEEP_MIN_INTERVAL_MS } from "./email-sweep-schedule";
import { OPPORTUNISTIC_SWEEP_MIN_INTERVAL_MS } from "./stale-sweep-schedule";

/**
 * **The mail sweep is awaited, and that is the entire fix.**
 *
 * Every route that queues mail ends with `void processQueue().catch(() => {})`.
 * When that unawaited promise does not finish — or runs after the request scope
 * is gone, where `resolveFormEnvironment` answers Production and a UAT row is
 * invisible — the row stays `Queued` with `AttemptCount = 0` and no error, which
 * looks exactly like a row created a second ago. Nothing retried it: no cron,
 * and the sweep endpoint `processQueueOn`'s docblock refers to did not exist.
 * Measured 2026-09-25: an AP-3 approval mail sat unsent for 53 minutes.
 *
 * So the recovery path must not be written in the shape that caused it. A
 * `void sweepEmailQueueOnLoad()` on a queue page would be the same bug wearing
 * the same clothes, it would pass every other test, and it would fail only when
 * it mattered — which is why this is pinned in source rather than left to
 * review.
 *
 * The rest of `shouldRunSweep` is already unit-tested in
 * `stale-sweep-schedule.test.ts`; this file only pins what is new.
 */

const SRC = path.join(process.cwd(), "src");

/** The queue pages that carry the recovery. */
const SWEEPERS = [
  "app/api/request/clear-advance/approvals/route.ts",
  "app/api/request/advance/approvals/queue/route.ts",
];

/** Line endings are the machine's, not the repo's -- see adc-link-guard.test.ts. */
function code(relative: string): string {
  return fs
    .readFileSync(path.join(SRC, relative), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

for (const file of SWEEPERS) {
  test(`${file} sweeps the mail queue`, () => {
    assert.ok(
      code(file).indexOf("sweepEmailQueueOnLoad(") !== -1,
      `${file} no longer recovers stranded mail. These two pages are the only ` +
        "thing standing between a dropped drain and a message nobody ever receives",
    );
  });

  test(`${file} AWAITS the sweep rather than firing and forgetting`, () => {
    const src = code(file);
    assert.ok(
      /await\s+sweepEmailQueueOnLoad\(/.test(src),
      `${file} calls sweepEmailQueueOnLoad without awaiting it. That is the exact ` +
        "shape of the defect it exists to repair — an unawaited drain is why a mail " +
        "sat unsent for 53 minutes with no error anywhere",
    );
    assert.equal(
      /void\s+sweepEmailQueueOnLoad\(/.test(src),
      false,
      `${file} fires the sweep and forgets it`,
    );
  });
}

test("the mail sweep runs far more often than the stale-request sweep", () => {
  // Ten minutes is right for auto-cancelling a request that has waited a month.
  // It is not right for somebody refreshing a queue waiting on an approval mail.
  assert.ok(
    EMAIL_SWEEP_MIN_INTERVAL_MS < OPPORTUNISTIC_SWEEP_MIN_INTERVAL_MS,
    "the mail drain is throttled as slowly as the stale sweep — a person waiting " +
      "for an approval mail is not a request that can wait another ten minutes",
  );
  assert.ok(EMAIL_SWEEP_MIN_INTERVAL_MS > 0, "an unthrottled drain on a read path");
});

test("the batch is small, because this is recovery and it blocks a page load", () => {
  assert.ok(
    EMAIL_SWEEP_BATCH > 0 && EMAIL_SWEEP_BATCH <= 5,
    `batch of ${EMAIL_SWEEP_BATCH}: awaited on a read path, so each one is a mail ` +
      "server round trip somebody's queue page is waiting for",
  );
});
