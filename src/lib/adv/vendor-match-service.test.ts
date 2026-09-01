import assert from "node:assert/strict";
import { test } from "node:test";
import { runVendorMatch, runEmployeeCodeMatch } from "./vendor-match-core";

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

test("employee code: a คู่ค้า payee never uses the code path", async () => {
  const r = await runEmployeeCodeMatch("vendor", 10177, async () => { throw new Error("must not be called"); });
  assert.equal(r, null);
});

test("employee code: no staff id falls through", async () => {
  const r = await runEmployeeCodeMatch("employee", null, async () => { throw new Error("must not be called"); });
  assert.equal(r, null);
});

test("employee code: a hit is suggested, never confirmed", async () => {
  const r = await runEmployeeCodeMatch("employee", 10177, async () =>
    ({ kind: "found", vendor: { vendorNo: "ADV0004", displayName: "นาย ทดสอบ" } }));
  assert.equal(r?.status, "suggested");
  assert.equal(r?.vendorNo, "ADV0004");
  assert.equal(r?.confidence, "high");
  assert.match(r?.reason ?? "", /10177/);
});

test("employee code: a miss falls through to the name matcher", async () => {
  const r = await runEmployeeCodeMatch("employee", 10177, async () => ({ kind: "none" }));
  assert.equal(r, null);
});

test("employee code: two vendors on one code refuses instead of guessing", async () => {
  const r = await runEmployeeCodeMatch("employee", 10177, async () => ({ kind: "ambiguous" }));
  // Not null — null would hand the payee name to the LLM and hide the data error.
  assert.notEqual(r, null);
  assert.equal(r?.status, "none");
  assert.equal(r?.vendorNo, null);
  assert.match(r?.reason ?? "", /10177/);
});
