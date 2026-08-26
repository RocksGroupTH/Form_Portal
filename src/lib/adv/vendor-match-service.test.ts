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
