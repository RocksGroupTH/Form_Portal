import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claimReadiness,
  type ReadinessClaim,
} from "./queue-readiness";

const line = (over: Partial<ReadinessClaim["items"][number]> = {}) => ({
  id: 1,
  category: "5310",
  vendorNo: "V00042",
  ...over,
});

const claim = (over: Partial<ReadinessClaim> = {}): ReadinessClaim => ({
  items: [line()],
  paymentDate: "2026-09-25",
  ...over,
});

test("everything filled is ready, and says nothing is missing", () => {
  const r = claimReadiness(claim());
  assert.equal(r.ready, true);
  assert.deepEqual(r.missing, []);
  assert.equal(r.reason, null);
});

test("a line with no G/L is not ready, and the reason names the line", () => {
  const r = claimReadiness(claim({ items: [line({ category: null })] }));
  assert.equal(r.ready, false);
  assert.deepEqual(r.missing, ["gl"]);
  assert.match(r.reason ?? "", /G\/L/);
});

test("a line with no vendor is not ready", () => {
  const r = claimReadiness(claim({ items: [line({ vendorNo: null })] }));
  assert.equal(r.ready, false);
  assert.deepEqual(r.missing, ["vendor"]);
  assert.match(r.reason ?? "", /Vendor/);
});

test("no payment date is not ready", () => {
  const r = claimReadiness(claim({ paymentDate: "" }));
  assert.equal(r.ready, false);
  assert.deepEqual(r.missing, ["paymentDate"]);
  assert.match(r.reason ?? "", /วันจ่าย/);
});

test("blank strings count as missing, not as filled", () => {
  // A cleared picker stores null, but a value trimmed to nothing has reached
  // this column before -- `parseItemAccountEdits` turns "  " into null on the
  // way in, and rows written before that did not.
  const r = claimReadiness(claim({ items: [line({ category: "   ", vendorNo: "" })] }));
  assert.equal(r.ready, false);
  assert.deepEqual(r.missing.sort(), ["gl", "vendor"]);
});

test("one bad line among good ones still blocks the claim", () => {
  // Approval is per claim, so readiness is too: a claim half-filled cannot be
  // half-approved.
  const r = claimReadiness(
    claim({ items: [line({ id: 1 }), line({ id: 2, vendorNo: null }), line({ id: 3 })] }),
  );
  assert.equal(r.ready, false);
  assert.deepEqual(r.missing, ["vendor"]);
});

test("every missing kind is reported, not just the first", () => {
  // The tooltip tells an approver what to do next; naming one of three sends
  // them back twice more.
  const r = claimReadiness(claim({ items: [line({ category: null, vendorNo: null })], paymentDate: "" }));
  assert.deepEqual(r.missing.sort(), ["gl", "paymentDate", "vendor"]);
});

test("a claim with no lines is not ready", () => {
  // Vacuously every line is filled. Approving a claim with nothing on it would
  // post an empty journal, so the empty case is refused rather than allowed by
  // an `every` that answers true.
  const r = claimReadiness(claim({ items: [] }));
  assert.equal(r.ready, false);
  assert.deepEqual(r.missing, ["items"]);
  assert.match(r.reason ?? "", /รายการ/);
});

test("the reason is one sentence naming every gap, for a tooltip", () => {
  const r = claimReadiness(claim({ items: [line({ category: null })], paymentDate: "" }));
  assert.equal(typeof r.reason, "string");
  assert.match(r.reason ?? "", /G\/L/);
  assert.match(r.reason ?? "", /วันจ่าย/);
});
