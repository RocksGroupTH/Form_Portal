import { test } from "node:test";
import assert from "node:assert/strict";
// From `queue-policy.ts`, not `./queue-service` — `queue-service.ts` imports
// `getAccPool`, which reaches `@/lib/db/mssql` → `@/env`, and `@/env`
// validates the whole environment AT IMPORT: any test that imports anything
// from that file crashes before its first assertion runs, on a machine with
// no database configured. `erp-queue-service.test.ts` documents the identical
// constraint for `erp-queue-service.ts` vs. `erp-queue-policy.ts` — this file
// is named `queue-service.test.ts` because it is the behavioural test FOR
// `listReimburseAccountQueue`'s row-mapping logic, even though the function
// under test physically lives in the import-free module that logic had to
// move to.
import { accumulateAccountQueueRows } from "./queue-policy";
import type { ReimburseQueueRow } from "./queue-policy";

/**
 * `accumulateAccountQueueRows` is the layer with teeth — see
 * `queue-service-guard.test.ts`'s docblock for the full history of why a SQL-
 * text regex cannot be the whole defence. This file hands it plain
 * recordset-shaped rows and checks what comes back, which is the one thing a
 * regex cannot be talked out of: it does not matter how the row check is
 * SHAPED if the value it is fed is simply wrong.
 *
 * A minimal row carries only the columns `accumulateAccountQueueRows`
 * actually reads. `Id`/`FormCode`/`Status`/`CurrentStepCode` are required by
 * every case; the rest default to values that produce an unsurprising
 * `ReimburseQueueRow` so each test only has to state what it is actually
 * checking.
 */
function row(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    Id: 1,
    RequestNo: "RBM26-00001",
    BrandCode: "PCTH",
    RequesterFullName: "Somchai Jaidee",
    FormCode: "AP-4",
    Status: "ManagerApproved",
    CurrentStepCode: "ACCOUNT",
    SubmittedAt: new Date("2026-09-01T03:00:00Z"),
    TotalAmount: 1000,
    PaymentDate: null,
    ItemCount: 2,
    ...overrides,
  };
}

test("an AP-1 claim at the identical (ManagerApproved, ACCOUNT) tuple is dropped", () => {
  const out = accumulateAccountQueueRows([row({ Id: 1, FormCode: "AP-1" })]);
  assert.deepEqual(out, []);
});

test("an AP-4 claim already past ACCOUNT — Status='Approved', no step — is dropped", () => {
  const out = accumulateAccountQueueRows([
    row({ Id: 1, FormCode: "AP-4", Status: "Approved", CurrentStepCode: null }),
  ]);
  assert.deepEqual(out, []);
});

test("an AP-4 claim at ACCOUNT_FINAL — the same status, the other step — is dropped", () => {
  // ACCOUNT and ACCOUNT_FINAL both sit at ManagerApproved; a status-only check
  // would put this claim in the wrong queue.
  const out = accumulateAccountQueueRows([
    row({ Id: 1, FormCode: "AP-4", Status: "ManagerApproved", CurrentStepCode: "ACCOUNT_FINAL" }),
  ]);
  assert.deepEqual(out, []);
});

test("an AP-4 claim at (ManagerApproved, ACCOUNT) survives", () => {
  const out = accumulateAccountQueueRows([
    row({ Id: 1, FormCode: "AP-4", Status: "ManagerApproved", CurrentStepCode: "ACCOUNT" }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 1);
});

test("id, brand, requester, item count and payment date are read off the row", () => {
  const out = accumulateAccountQueueRows([
    row({
      Id: 42,
      RequestNo: "RBM26-00042",
      BrandCode: "KSI",
      RequesterFullName: "Preecha Sukjai",
      TotalAmount: "2500.50",
      PaymentDate: new Date("2026-09-25T00:00:00Z"),
      ItemCount: 3,
    }),
  ]);
  const r: ReimburseQueueRow = out[0];
  assert.equal(r.id, 42);
  assert.equal(r.requestNo, "RBM26-00042");
  assert.equal(r.brandCode, "KSI");
  assert.equal(r.requesterName, "Preecha Sukjai");
  assert.equal(r.totalAmount, 2500.5);
  assert.equal(r.paymentDate, "2026-09-25");
  assert.equal(r.itemCount, 3);
  // `submittedAt` was the one rendered field no test named, and the re-review
  // measured what that cost: hardcoding it to null left the whole suite green
  // while `ReimburseApprovalQueue` printed `ส่งเมื่อ —` on every row. It is an
  // ISO string rather than `toYmd`'s date, because the queue shows a time.
  assert.equal(r.submittedAt, new Date("2026-09-01T03:00:00Z").toISOString());
});

test("a claim at ACCOUNT with the WRONG status is dropped — status is not decoration", () => {
  // The guard file used to say the status rebinding was caught by "the
  // behavioural layer, not this file". Measured in round five: it was caught by
  // the regex ALONE, because every behavioural case here happened to pair a
  // wrong status with a wrong step, and `belongsInAccountQueue` refuses on
  // either. So the comment pointed a reader at the layer that was NOT doing the
  // work, and deleting the assertion it called a "cheaper tripwire" would have
  // opened the hole silently. This case is what makes that comment true: the
  // step is exactly right and only the status is wrong.
  assert.deepEqual(
    accumulateAccountQueueRows([row({ Status: "Submitted", CurrentStepCode: "ACCOUNT" })]),
    [],
  );
});

test("a null PaymentDate stays null — the ACCOUNT step is where one gets set", () => {
  const out = accumulateAccountQueueRows([row({ Id: 1, PaymentDate: null })]);
  assert.equal(out[0].paymentDate, null);
});

test("order is preserved across multiple rows", () => {
  const out = accumulateAccountQueueRows([
    row({ Id: 5 }),
    row({ Id: 3 }),
    row({ Id: 7 }),
  ]);
  assert.deepEqual(
    out.map((r) => r.id),
    [5, 3, 7],
  );
});
