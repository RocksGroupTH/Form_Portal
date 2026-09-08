import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBulkMessage } from "./bulk-result-message";

/**
 * The bug these cover: a bulk call where every item was refused used to be
 * reported as a success with the per-item reasons thrown away.
 */

test("all succeeded → success with the count", () => {
  const m = buildBulkMessage("อนุมัติ", [{ id: 1, ok: true }, { id: 2, ok: true }], 2);
  assert.equal(m.kind, "success");
  assert.match(m.title, /2 รายการ/);
  assert.equal(m.description, undefined);
});

test("everything failed is an error, never a success", () => {
  const m = buildBulkMessage("อนุมัติ", [
    { id: 900137, ok: false, error: "ต้องยืนยัน Vendor ก่อนอนุมัติ" },
  ], 0);
  assert.equal(m.kind, "error");
  assert.doesNotMatch(m.title, /สำเร็จ 0/, "must not lead with a count of zero");
});

test("the reason reaches the message, labelled by request number", () => {
  const m = buildBulkMessage("อนุมัติ", [
    { id: 900137, ok: false, error: "ต้องยืนยัน Vendor ก่อนอนุมัติ" },
  ], 0, (id) => (id === 900137 ? "ADV26-00031" : `#${id}`));
  assert.match(m.description ?? "", /ADV26-00031/);
  assert.match(m.description ?? "", /ต้องยืนยัน Vendor/);
});

test("a partial failure keeps both counts", () => {
  const m = buildBulkMessage("ส่ง", [
    { id: 1, ok: true },
    { id: 2, ok: false, error: "BC journal API 404" },
  ], 1);
  assert.equal(m.kind, "error");
  assert.match(m.title, /สำเร็จ 1/);
  assert.match(m.title, /ไม่สำเร็จ 1/);
  assert.match(m.description ?? "", /404/);
});

test("one line per failure, then a count for the overflow", () => {
  const results = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, ok: false, error: `e${i + 1}` }));
  const m = buildBulkMessage("ส่ง", results, 0);
  const lines = (m.description ?? "").split("\n");
  assert.equal(lines.length, 5, "four reasons plus one summary line");
  assert.match(lines[4], /และอีก 3 รายการ/);
});

test("a failure with no error text still explains itself", () => {
  const m = buildBulkMessage("ส่ง", [{ id: 5, ok: false }], 0);
  assert.match(m.description ?? "", /ไม่ทราบสาเหตุ/);
});

test("okCount is derived when the server omits it", () => {
  const m = buildBulkMessage("อนุมัติ", [{ id: 1, ok: true }, { id: 2, ok: false, error: "x" }]);
  assert.match(m.title, /สำเร็จ 1/);
});
