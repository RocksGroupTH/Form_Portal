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

/** A brand whose Interface ERP settings are complete. */
const CONFIG = {
  bankAccountNo: "K-CA6999",
  journalBatchName: "Q",
  vatInputGlAccountNo: "115020001",
  whtPayableGlAccountNo: "213040001",
};

test("a claim is ready only when EVERY line has a G/L account", () => {
  assert.deepEqual(erpReadiness([{ category: "5100-01", amount: 100 }], CONFIG), {
    ready: true,
    issues: [],
  });
});

test("a missing G/L names the line, because that is what the accountant must fix", () => {
  const r = erpReadiness(
    [
      { category: "5100-01", amount: 100 },
      { category: null, amount: 250 },
      { category: "   ", amount: 90 },
    ],
    CONFIG,
  );
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
  const r = erpReadiness([], CONFIG);
  assert.equal(r.ready, false);
  assert.equal(r.issues.length, 1);
});

/* ── the brand's own configuration, not just the lines ── */

test("no bank account and no journal batch are each named", () => {
  // Both throw inside the payload builder. Saying so on the queue is the
  // difference between an admin fixing a setting and an accountant pressing a
  // button that fails with a message nobody sees.
  const r = erpReadiness([{ category: "5100", amount: 100 }], {
    ...CONFIG,
    bankAccountNo: "",
    journalBatchName: "   ",
  });
  assert.equal(r.ready, false);
  assert.equal(r.issues.length, 2);
  assert.ok(r.issues.some((i) => /Bank Account/.test(i)));
  assert.ok(r.issues.some((i) => /Journal Batch/.test(i)));
});

test("the VAT-input account is only required by a claim that HAS VAT", () => {
  const withVat = erpReadiness([{ category: "5100", amount: 107, vatAmount: 7 }], {
    ...CONFIG,
    vatInputGlAccountNo: null,
  });
  assert.equal(withVat.ready, false);
  assert.ok(withVat.issues.some((i) => /ภาษีซื้อ/.test(i)));

  const withoutVat = erpReadiness([{ category: "5100", amount: 100, vatAmount: 0 }], {
    ...CONFIG,
    vatInputGlAccountNo: null,
  });
  assert.equal(withoutVat.ready, true);
});

test("the withholding account is only required by a claim that WITHHOLDS", () => {
  const withWht = erpReadiness([{ category: "5100", amount: 100, whtAmount: 3 }], {
    ...CONFIG,
    whtPayableGlAccountNo: null,
  });
  assert.equal(withWht.ready, false);
  assert.ok(withWht.issues.some((i) => /หัก ณ ที่จ่าย/.test(i)));

  const withoutWht = erpReadiness([{ category: "5100", amount: 100 }], {
    ...CONFIG,
    whtPayableGlAccountNo: null,
  });
  assert.equal(withoutWht.ready, true);
});

test("configuration that could not be read is reported, never assumed complete", () => {
  // `null` means the brand's Interface ERP settings did not resolve at all — an
  // unmapped brand, or a failed load. Treating that as "fine" would show a
  // green row for a claim that cannot be built.
  const r = erpReadiness([{ category: "5100", amount: 100 }], null);
  assert.equal(r.ready, false);
  assert.ok(r.issues.some((i) => /Interface ERP/.test(i)));
});

test("a claim that nets to nothing is not ready", () => {
  // The payload refuses it: a bank line of 0 posts a payment document that
  // moves no money and somebody has to find and reverse.
  const r = erpReadiness([{ category: "5100", amount: 100, whtAmount: 100 }], CONFIG);
  assert.equal(r.ready, false);
  assert.ok(r.issues.some((i) => /จ่ายสุทธิ/.test(i)));
});
