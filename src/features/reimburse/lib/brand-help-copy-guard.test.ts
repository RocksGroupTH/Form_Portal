import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * What the brand picker says underneath itself.
 *
 * Two sentences shared one `<p>` and only one of them was ever needed. The
 * neutral caption — "รายการแบรนด์ที่อนุญาตให้เบิกในแบบฟอร์ม AP-4 (ตั้งค่าโดย
 * ผู้ดูแลระบบ)" — restated what the picker above it already shows, on every
 * render, for every requester; the user asked for it gone on 2026-09-10.
 *
 * The other must stay, and is the reason this file exists rather than a plain
 * deletion: a resumed claim can hold a `BrandCode` the allowlist has since
 * dropped, `POST .../submit` validates against `AccFormBrand` and refuses it,
 * and this line is the only thing on screen that says so. Deleting it as
 * collateral while removing its neighbour leaves a requester with a claim that
 * will not submit and no reason given.
 *
 * There is no DOM harness here, so this reads the source, the way
 * `currency-surface-guard.test.ts` already does.
 */

const ROOT = path.resolve(process.cwd(), "src");
const FORM = "features/reimburse/components/ReimburseForm.tsx";

const NEUTRAL_CAPTION = "รายการแบรนด์ที่อนุญาตให้เบิกในแบบฟอร์ม AP-4";
const STALE_BRAND_WARNING = "ปัจจุบันไม่อยู่ในรายการที่อนุญาตแล้ว";

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("the brand picker no longer captions itself on every render", () => {
  assert.equal(
    read(FORM).indexOf(NEUTRAL_CAPTION),
    -1,
    "the neutral caption is back. It restates the picker directly above it; it was removed " +
      "deliberately, so restoring it is a product decision rather than a fix",
  );
});

test("the stale-brand warning survives, because nothing else on screen says it", () => {
  assert.notEqual(
    read(FORM).indexOf(STALE_BRAND_WARNING),
    -1,
    "the warning is gone. A resumed claim whose BrandCode has since left AccFormBrand is " +
      "refused by the submit route, and this line is the only thing that tells the requester why",
  );
});
