import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeLocationRow } from "./location-sync-core";

/* The row shape RPCCodexStore_CodexGetLocations returns, e.g.
 * { code: "PC1001", name: "CTW-เซ็นทรัลเวิลด์", branch: "PC1001", bu: "COCO", department: "BR" } */

test("a full row maps straight across", () => {
  const n = normalizeLocationRow({
    code: "PC1001", name: "CTW-เซ็นทรัลเวิลด์", branch: "PC1001", bu: "COCO", department: "BR",
  })!;
  assert.equal(n.code, "PC1001");
  assert.equal(n.displayName, "CTW-เซ็นทรัลเวิลด์");
  assert.equal(n.branchCode, "PC1001");
  assert.equal(n.buCode, "COCO");
  assert.equal(n.departmentCode, "BR");
});

/* A Location with no code identifies nothing — there is no key to merge it on,
 * so it is dropped rather than written under an empty one. */
test("a row with no code is dropped", () => {
  assert.equal(normalizeLocationRow({ code: "", bu: "COCO" }), null);
  assert.equal(normalizeLocationRow({ code: "   ", bu: "COCO" }), null);
  assert.equal(normalizeLocationRow({ bu: "COCO" }), null);
});

/* Blank is stored as NULL, never as "". The BU lookup treats a missing BU as
 * "no answer" and falls through to the codeunit's default; an empty string
 * would read as an answer. */
test("blank fields become null, not empty strings", () => {
  const n = normalizeLocationRow({ code: "W001", name: "", branch: "  ", bu: "", department: null })!;
  assert.equal(n.displayName, null);
  assert.equal(n.branchCode, null);
  assert.equal(n.buCode, null);
  assert.equal(n.departmentCode, null);
});

test("surrounding whitespace is trimmed off every field", () => {
  const n = normalizeLocationRow({ code: " PC2024 ", branch: " PC2024 ", bu: " DOCO " })!;
  assert.equal(n.code, "PC2024");
  assert.equal(n.branchCode, "PC2024");
  assert.equal(n.buCode, "DOCO");
});

/* The raw answer is kept so a field BC starts returning later can be read back
 * out of history instead of needing a re-sync to discover. */
test("the original row is kept as JSON", () => {
  const n = normalizeLocationRow({ code: "HQ01", bu: "COCO" })!;
  assert.deepEqual(JSON.parse(n.rawJson), { code: "HQ01", bu: "COCO" });
});
