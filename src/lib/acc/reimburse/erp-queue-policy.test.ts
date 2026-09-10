import { strict as assert } from "assert";
import { test } from "node:test";
import { belongsInErpQueue, erpReadiness } from "./erp-queue-policy";

test("only an APPROVED AP-4 claim is in the ERP queue", () => {
  assert.equal(belongsInErpQueue("AP-4", "Approved"), true);
});

test("another form at the same status is OUT — FormCode is the only discriminator", () => {
  // AP-1 and AP-3 park approved claims at exactly this status on the same
  // shared AccRequest table. AP-1's own erp-prep-service comment spells out
  // what happens if one leaks in: an empty day count and a journal built from
  // nothing, posted to Business Central.
  assert.equal(belongsInErpQueue("AP-1", "Approved"), false);
  assert.equal(belongsInErpQueue("AP-3", "Approved"), false);
});

test("an AP-4 claim not yet approved is OUT", () => {
  for (const s of ["Draft", "Submitted", "ManagerApproved", "Returned", "Rejected", "Cancelled"]) {
    assert.equal(belongsInErpQueue("AP-4", s), false, s);
  }
});

test("an unknown status is OUT — an allow-list", () => {
  assert.equal(belongsInErpQueue("AP-4", "SomethingNew"), false);
});

test("a claim is ready only when EVERY line has a G/L account", () => {
  assert.deepEqual(erpReadiness([{ category: "5100-01", amount: 100 }]), {
    ready: true,
    issues: [],
  });
});

test("a missing G/L names the line, because that is what the accountant must fix", () => {
  const r = erpReadiness([
    { category: "5100-01", amount: 100 },
    { category: null, amount: 250 },
    { category: "   ", amount: 90 },
  ]);
  assert.equal(r.ready, false);
  // Lines are numbered as a human counts them, and BOTH bad lines are named —
  // reporting only the first means a second round trip to discover the second.
  assert.deepEqual(r.issues, [
    "บรรทัดที่ 2 ยังไม่ได้เลือกผังบัญชี",
    "บรรทัดที่ 3 ยังไม่ได้เลือกผังบัญชี",
  ]);
});

test("a claim with no lines at all is not ready", () => {
  // Not "ready with nothing to post" — an empty claim reaching a journal
  // builder is the AP-1 failure quoted above, in its purest form.
  const r = erpReadiness([]);
  assert.equal(r.ready, false);
  assert.equal(r.issues.length, 1);
});
