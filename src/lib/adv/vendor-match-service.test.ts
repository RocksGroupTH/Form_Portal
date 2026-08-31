import assert from "node:assert/strict";
import { test } from "node:test";
import { runVendorMatch } from "./vendor-match-core";

const cands = [
  { vendorNo: "V1", displayName: "ACME Bangkok" },
  { vendorNo: "V2", displayName: "ACME Chiang Mai" },
];
const failLlm = async () => { throw new Error("LLM must not be called"); };

test("zero candidates → none, no LLM", async () => {
  const r = await runVendorMatch("ACME", async () => [], failLlm);
  assert.deepEqual(r, { status: "none", vendorNo: null, vendorName: null, confidence: null, reason: null });
});

test("single exact candidate → suggested high, no LLM", async () => {
  const r = await runVendorMatch("ACME Co., Ltd.", async () => [{ vendorNo: "V1", displayName: "ACME Co., Ltd." }], failLlm);
  assert.equal(r.status, "suggested");
  assert.equal(r.vendorNo, "V1");
  assert.equal(r.confidence, "high");
});

test("ambiguous → LLM picks", async () => {
  const r = await runVendorMatch("ACME BKK", async () => cands,
    async () => ({ vendorNo: "V1", confidence: "medium", reason: "bangkok" }));
  assert.equal(r.status, "suggested");
  assert.equal(r.vendorNo, "V1");
  assert.equal(r.confidence, "medium");
});

test("ambiguous but LLM returns unknown vendorNo → none", async () => {
  const r = await runVendorMatch("ACME BKK", async () => cands,
    async () => ({ vendorNo: "V9", confidence: "high", reason: "x" }));
  assert.equal(r.status, "none");
});

test("LLM throws → pending (officer picks manually)", async () => {
  const r = await runVendorMatch("ACME BKK", async () => cands, failLlm);
  assert.equal(r.status, "pending");
});

// Employee-code matching (matchAdvanceVendor in vendor-match-service.ts) is not
// exercised here: it is DB-bound (findVendorByEmployeeCode, getRequest) and this
// repo's tests don't mock modules, so it isn't unit-testable at this level. What
// IS testable, and what that new branch depends on, is the fallback contract
// below: when an employee's staff code has no Home Page match, the branch falls
// through to this same runVendorMatch with the employee's (Thai) name — so a
// zero-candidate result for a Thai name must resolve to "none" without ever
// throwing, exactly as it already does for an English name above.
test("employee-code miss falls through to name match: zero candidates for a Thai name → none, no LLM", async () => {
  const r = await runVendorMatch("สมชาย ใจดี", async () => [], failLlm);
  assert.deepEqual(r, { status: "none", vendorNo: null, vendorName: null, confidence: null, reason: null });
});
