import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * AP-3's account step no longer asks for a hand-typed PV/PPEX number, and
 * nothing may write `AccClearAdvance.PvDocNo` again.
 *
 * The column is not dead data. Claims approved before this change carry a
 * number a person typed, and the detail card, the Control report and
 * `reportPv` all deliberately still show it. What changed is that nothing
 * writes it — so a `PvDocNo` with a recent `UpdatedAt` means something outside
 * these two applications wrote it, which is worth looking at rather than
 * assuming.
 *
 * This reads the source rather than driving the code. `clear-advance-request-
 * service.ts` cannot be imported from a test in this repo: `@/env` validates at
 * import and throws, which is why no test file here imports it. ACC Portal has
 * a real harness and pins the same statement by its recorded SQL; this is the
 * half of the pair that can run on this side, in the style of
 * `src/lib/acc/*-guard.test.ts`.
 *
 * **The `PaymentDate` half matters as much as the `PvDocNo` half.** One
 * `UPDATE` set both columns, and `PaymentDate` is the วันจ่าย the account step
 * still writes — required when the company pays the employee extra. An edit
 * that removed the wrong assignment would lose it silently, with no type error
 * and no other test failing, so both halves are asserted here together.
 */

const SRC = path.join(process.cwd(), "src");

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), "utf8");
}

/** The statement `setAccountAction` issues, flattened to one line. */
function accountActionStatement(): string {
  const src = read("lib/clr/clear-advance-request-service.ts");
  const at = src.indexOf("export async function setAccountAction(");
  assert.notEqual(at, -1, "setAccountAction is gone — this guard needs rewriting, not deleting");
  const body = src.slice(at, at + 1200);
  const q = body.indexOf("UPDATE [dbo].[AccClearAdvance]");
  assert.notEqual(q, -1, "setAccountAction no longer issues an AccClearAdvance UPDATE");
  return body.slice(q, body.indexOf("`", q)).replace(/\s+/g, " ");
}

test("the account step's write still sets PaymentDate", () => {
  assert.match(accountActionStatement(), /SET PaymentDate=@pd/);
});

test("the account step's write no longer sets PvDocNo", () => {
  assert.doesNotMatch(accountActionStatement(), /PvDocNo/i);
});

test("setAccountAction no longer takes a PV number to write", () => {
  const src = read("lib/clr/clear-advance-request-service.ts");
  const at = src.indexOf("export async function setAccountAction(");
  const signature = src.slice(at, src.indexOf(")", at));
  assert.doesNotMatch(signature, /pvDocNo/i);
});

/* A write path with no screen behind it is how the column would keep taking
   values nobody could trace back to a person: a stale tab or a hand-made
   request reaches the route untouched. The screen going is not enough. */
test("the approve API does not accept or forward a pvDocNo", () => {
  const route = read("app/api/request/clear-advance/requests/[id]/approve/route.ts");
  assert.doesNotMatch(route, /pvDocNo/i);
});

test("the approval engine does not carry a pvDocNo through to the writer", () => {
  const engine = read("lib/clr/clear-advance-approval-engine.ts");
  assert.doesNotMatch(engine, /pvDocNo/i);
});

/* The readers are the point of keeping the column. Losing one of these would
   make old claims look as if the number had never been typed. */
test("the detail card still renders a stored PV number", () => {
  const detail = read("features/clear-advance/components/ClearAdvanceDetail.tsx");
  assert.match(detail, /clear\?\.pvDocNo && <DetailRow label="เลขที่ PV \/ PPEX"/);
});

test("the report still selects the column and still resolves it through reportPv", () => {
  assert.match(read("lib/clr/clear-advance-report-service.ts"), /c\.PvDocNo/);
  assert.match(read("features/clear-advance/components/report/ClrControlReport.tsx"), /reportPv\(r\)/);
});
