import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizePayeeName, rankCandidates, decideMatch } from "./vendor-match-normalize";

test("normalize strips company suffixes, punctuation, case and spacing", () => {
  assert.equal(normalizePayeeName("  บริษัท  ทดสอบ  จำกัด "), "ทดสอบ");
  assert.equal(normalizePayeeName("ACME Co., Ltd."), "acme");
  assert.equal(normalizePayeeName("A.C.M.E"), "acme");
});

test("rankCandidates returns exact normalized match first", () => {
  const ranked = rankCandidates("acme", [
    { vendorNo: "V2", displayName: "Beta" },
    { vendorNo: "V1", displayName: "ACME Co., Ltd." },
  ]);
  assert.equal(ranked[0].vendorNo, "V1");
});

test("decideMatch: zero candidates => none", () => {
  assert.deepEqual(decideMatch("acme", []), { mode: "none" });
});

test("decideMatch: single normalized-equal candidate => exact (no LLM)", () => {
  assert.deepEqual(
    decideMatch("acme", [{ vendorNo: "V1", displayName: "ACME Co., Ltd." }]),
    { mode: "exact", vendorNo: "V1", displayName: "ACME Co., Ltd." },
  );
});

test("decideMatch: several candidates => ambiguous (LLM needed)", () => {
  const d = decideMatch("acme", [
    { vendorNo: "V1", displayName: "ACME Bangkok" },
    { vendorNo: "V2", displayName: "ACME Chiang Mai" },
  ]);
  assert.equal(d.mode, "ambiguous");
});

test("decideMatch: one candidate but not equal => ambiguous (let LLM judge)", () => {
  const d = decideMatch("acme", [{ vendorNo: "V1", displayName: "ACME Bangkok" }]);
  assert.equal(d.mode, "ambiguous");
});
