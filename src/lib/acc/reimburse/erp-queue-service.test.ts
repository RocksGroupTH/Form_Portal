import { test } from "node:test";
import assert from "node:assert/strict";
// From `erp-queue-policy.ts`, not `./erp-queue-service` — `erp-queue-service.ts`
// imports `getAccPool`, which reaches `@/lib/db/mssql` → `@/env`, and `@/env`
// validates the whole environment AT IMPORT: any test that imports anything
// from that file crashes before its first assertion runs, on a machine with no
// database configured. `team-member/service.test.ts` documents the identical
// constraint for `service.ts` vs. `mapping.ts` — this file is named
// `erp-queue-service.test.ts` because it is the behavioural test FOR
// `listReimburseErpQueue`'s row-mapping logic, even though the function under
// test physically lives in the import-free module that logic had to move to.
import { accumulateErpQueueRows } from "./erp-queue-policy";
import type { ReimburseErpQueueRow } from "./erp-queue-policy";

/**
 * `accumulateErpQueueRows` is the layer with teeth — see
 * `erp-queue-service-guard.test.ts`'s docblock for the full history of why a
 * SQL-text regex cannot be the whole defence. This file hands it plain
 * recordset-shaped rows and checks what comes back, which is the one thing a
 * regex cannot be talked out of: it does not matter how the row check is
 * SHAPED if the value it is fed is simply wrong.
 *
 * A minimal row carries only the columns `accumulateErpQueueRows` actually
 * reads. `Id`/`FormCode`/`Status` are required by every case; the rest default
 * to values that produce an unsurprising `ReimburseErpQueueRow` so each test
 * only has to state what it is actually checking.
 */
function row(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    Id: 1,
    RequestNo: "RBM26-00001",
    BrandCode: "PCTH",
    RequesterFullName: "Somchai Jaidee",
    FormCode: "AP-4",
    Status: "Approved",
    SubmittedAt: new Date("2026-09-01T03:00:00Z"),
    PaymentDate: new Date("2026-09-30T00:00:00Z"),
    TotalAmount: 1000,
    ErpInterfaceStatus: null,
    ErpDocumentNo: null,
    ErpInterfaceEnvironment: null,
    ErpInterfaceSentAt: null,
    ErpInterfaceError: null,
    ItemId: null,
    ItemCategory: null,
    ItemAmount: null,
    ...overrides,
  };
}

test("an AP-1 claim at the identical Status='Approved' is dropped", () => {
  const out = accumulateErpQueueRows([row({ Id: 1, FormCode: "AP-1", Status: "Approved" })]);
  assert.deepEqual(out, []);
});

test("an AP-4 claim not yet past ACCOUNT_FINAL — ManagerApproved — is dropped", () => {
  // This is the exact shape a widened WHERE clause (`... OR
  // req.CurrentStepCode = 'ACCOUNT'`) would hand the accumulator, and the
  // exact case a `const status = "Approved";` rebinding defeats — drilled
  // below.
  const out = accumulateErpQueueRows([row({ Id: 1, FormCode: "AP-4", Status: "ManagerApproved" })]);
  assert.deepEqual(out, []);
});

test("an AP-4 claim at Status='Approved' survives", () => {
  const out = accumulateErpQueueRows([row({ Id: 1, FormCode: "AP-4", Status: "Approved" })]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 1);
  assert.equal(out[0].formCode, "AP-4");
  assert.equal(out[0].status, "Approved");
});

test("a claim with no lines gets itemCount 0 and erpReadiness([])'s message — not a phantom line 1", () => {
  // ItemId is null (no row joined), which must not be read as "one item with
  // a null category" — see erp-queue-policy.ts's own comment on the join.
  const out = accumulateErpQueueRows([row({ Id: 1, ItemId: null, ItemCategory: null, ItemAmount: null })]);
  assert.equal(out.length, 1);
  assert.equal(out[0].itemCount, 0);
  assert.equal(out[0].readiness.ready, false);
  assert.deepEqual(out[0].readiness.issues, ["ไม่มีรายการที่จะบันทึก"]);
});

test("a claim with one item missing its category gets itemCount 1 and a line-1 issue, not the empty-claim message", () => {
  const out = accumulateErpQueueRows([
    row({ Id: 1, ItemId: 10, ItemCategory: null, ItemAmount: 500 }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].itemCount, 1);
  assert.equal(out[0].readiness.ready, false);
  assert.deepEqual(out[0].readiness.issues, ["บรรทัดที่ 1 ยังไม่ได้เลือกผังบัญชี"]);
});

test("a claim whose every line has a category is ready", () => {
  const out = accumulateErpQueueRows([
    row({ Id: 1, ItemId: 10, ItemCategory: "5100-01", ItemAmount: 500 }),
  ]);
  assert.equal(out[0].readiness.ready, true);
  assert.deepEqual(out[0].readiness.issues, []);
});

test("a claim with several joined item rows fans back into one row with the right item count", () => {
  const out = accumulateErpQueueRows([
    row({ Id: 1, ItemId: 10, ItemCategory: "5100-01", ItemAmount: 300 }),
    row({ Id: 1, ItemId: 11, ItemCategory: null, ItemAmount: 200 }),
    row({ Id: 1, ItemId: 12, ItemCategory: "5100-02", ItemAmount: 100 }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].itemCount, 3);
  assert.deepEqual(out[0].readiness.issues, ["บรรทัดที่ 2 ยังไม่ได้เลือกผังบัญชี"]);
});

test("req.Id DESC order survives the item-row fan-out flatten", () => {
  // Two claims, the second one's items interleaved with the first's in the
  // recordset — a LEFT JOIN with more than one claim does not guarantee every
  // one claim's rows are contiguous, and the Map+order flatten must not
  // depend on them being so.
  const out = accumulateErpQueueRows([
    row({ Id: 5, ItemId: 50, ItemCategory: "5100-01", ItemAmount: 100 }),
    row({ Id: 3, ItemId: 30, ItemCategory: "5100-01", ItemAmount: 200 }),
    row({ Id: 5, ItemId: 51, ItemCategory: "5100-01", ItemAmount: 150 }),
  ]);
  assert.deepEqual(
    out.map((r: ReimburseErpQueueRow) => r.id),
    [5, 3],
  );
  assert.equal(out[0].itemCount, 2);
  assert.equal(out[1].itemCount, 1);
});

test("a leaked AP-3 row contributes no phantom item to a real AP-4 claim's count", () => {
  // Same Id space is not realistic across forms (AccRequest.Id is one
  // sequence), but the accumulator must not assume that — a row
  // belongsInErpQueue refuses is dropped before its item columns are ever
  // read, so it cannot inflate another claim's itemCount even by accident of
  // id collision.
  const out = accumulateErpQueueRows([
    row({ Id: 1, FormCode: "AP-4", Status: "Approved", ItemId: 10, ItemCategory: "5100-01", ItemAmount: 100 }),
    row({ Id: 1, FormCode: "AP-3", Status: "Approved", ItemId: 999, ItemCategory: "9999-99", ItemAmount: 999 }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].itemCount, 1);
});
