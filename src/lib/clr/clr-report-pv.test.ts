import assert from "node:assert/strict";
import { test } from "node:test";
import { reportPv } from "./clr-report-pv";

/* Two fields have always been able to answer "which PV is this". The one the
   report read was the box an accountant types into by hand, from the days
   before the interface existed. The one the interface fills was not read at
   all — so a clearing posted to BC under PVA2609-0030 showed "—" and looked
   unpaid (found in the full-loop test, 2026-09-14). */

test("the number BC gave is the answer", () => {
  assert.deepEqual(
    reportPv({ erpDocumentNo: "PVA2609-0030", pvDocNo: null }),
    { text: "PVA2609-0030", source: "erp" },
  );
});

test("a hand-typed number still answers when nothing was sent", () => {
  assert.deepEqual(
    reportPv({ erpDocumentNo: null, pvDocNo: "PV2601-0001" }),
    { text: "PV2601-0001", source: "manual" },
  );
});

/* BC wins. Not because the typing is careless, but because the send is the
   event that created the document — a hand-typed number beside a different
   sent one is a note about something else, or a typo, and either way the
   posting is what the accounts will reconcile against. */
test("when both exist, the one BC issued wins", () => {
  assert.deepEqual(
    reportPv({ erpDocumentNo: "PVA2609-0030", pvDocNo: "PV2601-0001" }),
    { text: "PVA2609-0030", source: "erp" },
  );
});

test("neither is neither, and says so as nothing rather than a guess", () => {
  assert.deepEqual(reportPv({ erpDocumentNo: null, pvDocNo: null }), { text: null, source: null });
  assert.deepEqual(reportPv({ erpDocumentNo: "  ", pvDocNo: "" }), { text: null, source: null });
  assert.deepEqual(reportPv({}), { text: null, source: null });
});

test("surrounding space is not part of a document number", () => {
  assert.deepEqual(
    reportPv({ erpDocumentNo: " PVA2609-0030 ", pvDocNo: null }),
    { text: "PVA2609-0030", source: "erp" },
  );
});
