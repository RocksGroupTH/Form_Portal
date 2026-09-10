import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceBcDocLabel } from "./advance-bc-doc";

/* What the account officer is told about the BC document behind the advance
   they are clearing. Its absence has meanings that are worth telling apart:
   three AP-3 clearings were cancelled in September because the advance behind
   them had already gone to BC in a state nothing on our side could fix. */

test("a document number is simply the document number", () => {
  assert.deepEqual(advanceBcDocLabel("PVA2608-0005", "Sent"), { text: "PVA2608-0005", muted: false });
});

test("an advance that never went to BC says so, rather than a dash", () => {
  assert.deepEqual(advanceBcDocLabel(null, null), { text: "ยังไม่ได้ส่ง BC", muted: true });
});

test("an advance whose send failed is not the same as one never sent", () => {
  assert.deepEqual(advanceBcDocLabel(null, "Failed"), { text: "ส่ง BC ไม่สำเร็จ", muted: true });
});

test("still in flight says in flight", () => {
  assert.deepEqual(advanceBcDocLabel(null, "Pending"), { text: "กำลังส่ง BC", muted: true });
});

test("sent but with no number recorded is not claimed as unsent", () => {
  // Reachable on a record that predates the document number being stored.
  assert.deepEqual(advanceBcDocLabel(null, "Sent"), { text: "ส่ง BC แล้ว (ไม่มีเลขที่)", muted: true });
});

test("blank and whitespace are absence, not a number", () => {
  assert.equal(advanceBcDocLabel("", "Sent").muted, true);
  assert.equal(advanceBcDocLabel("   ", "Sent").muted, true);
});

test("a number wins over any status, because the document exists", () => {
  assert.deepEqual(advanceBcDocLabel("PVA2608-0005", "Failed"), { text: "PVA2608-0005", muted: false });
});

test("no advance linked at all is nothing to say", () => {
  assert.deepEqual(advanceBcDocLabel(undefined, undefined), { text: "ยังไม่ได้ส่ง BC", muted: true });
});
