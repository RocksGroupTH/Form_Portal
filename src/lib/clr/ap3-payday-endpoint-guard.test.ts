import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * AP-3's screens must ask AP-3's payday route.
 *
 * They asked AP-2's until 2026-09-24, which was invisible while the two forms
 * paid on the same Fridays. AP-2 is weekly now and AP-3 is not, so the old
 * endpoint answers with dates AP-3 does not pay on — and returns 200 while it
 * does, which is why this is read out of the source rather than left to review.
 */

const FILES = [
  "src/features/clear-advance/components/ClearAdvanceDetail.tsx",
  "src/features/clear-advance/components/admin/ClrErpInterfaceQueue.tsx",
];

test("no AP-3 screen fetches AP-2's payday route", () => {
  for (const rel of FILES) {
    const src = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
    assert.doesNotMatch(src, /request\/advance\/payment-dates/, rel);
    assert.match(src, /request\/clear-advance\/payment-dates/, rel);
  }
});
