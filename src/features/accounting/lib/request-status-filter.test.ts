import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MINE_STATUS_OPTIONS,
  WORK_STATUS_OPTIONS,
  isSummaryBoxActive,
  statusFilterKey,
  statusFilterOptions,
  statusSummaryBoxes,
  sumTotalAmount,
} from "./request-status-filter";

/**
 * My Requests' status filter, which since 2026-09-24 is driven by two controls
 * over one value: the summary boxes at the top and the สถานะ dropdown beside
 * the form filter. The failure this file exists to catch is the two disagreeing
 * — a box highlighted over a selection it does not stand for, or a row the
 * dropdown admits and the box does not.
 */

/* ── the two vocabularies ── */

test("My Requests offers the six words its own chips print", () => {
  assert.deepEqual(
    MINE_STATUS_OPTIONS.map((o) => o.label),
    ["Submitted", "Pending", "Complete", "Revise", "Rejected", "Cancelled"],
  );
});

test("My Work offers five, and Submitted is not one of them", () => {
  // A submitted request sitting on your own manager step is precisely one that
  // is pending YOU, so `getMyWorkStatusBucket` has no `Submitted` member and
  // offering it here would be a filter that matches nothing, for ever.
  assert.equal(WORK_STATUS_OPTIONS.some((o) => o.id === "Submitted"), false);
  assert.deepEqual(
    WORK_STATUS_OPTIONS.map((o) => o.id),
    ["pending", "Approved", "Returned", "Rejected", "Cancelled"],
  );
});

test("statusFilterOptions answers the list for the kind it was asked about", () => {
  assert.equal(statusFilterOptions("mine"), MINE_STATUS_OPTIONS);
  assert.equal(statusFilterOptions("work"), WORK_STATUS_OPTIONS);
});

/* ── which option a row belongs to ── */

test("Completed folds into Approved on My Requests", () => {
  // AP-17 writes `Completed`; without this it matches no option at all and is
  // filtered out by every selection, including the one whose chip it wears.
  assert.equal(statusFilterKey("mine", "Completed"), "Approved");
  assert.equal(statusFilterKey("mine", "Approved"), "Approved");
});

test("every other status is its own key", () => {
  for (const s of ["Submitted", "ManagerApproved", "Rejected", "Returned", "Cancelled"]) {
    assert.equal(statusFilterKey("mine", s), s);
  }
});

test("a status this app did not write keeps its own name", () => {
  // Measured 2026-09-24: `AccRequest` holds `Ready` and `Received` rows on a
  // form code this app does not serve. Returning a catch-all would sweep them
  // into somebody's filter; returning themselves leaves them visible under
  // ทั้งหมด and matched by nothing, which is the honest answer.
  assert.equal(statusFilterKey("mine", "Ready"), "Ready");
  assert.equal(statusFilterKey("mine", ""), "");
});

test("My Work's key is the bucket it was handed", () => {
  // The caller has already computed it; this exists so both sides of the panel
  // call one function rather than one calling none.
  for (const b of ["pending", "Approved", "Rejected", "Returned", "Cancelled"]) {
    assert.equal(statusFilterKey("work", b), b);
  }
  // And it must NOT fold, or a work row bucketed `Approved` and one bucketed
  // `Completed` — which cannot happen — would be conflated silently.
  assert.equal(statusFilterKey("work", "Completed"), "Completed");
});

/* ── the boxes ── */

test("there are four boxes and the first is ทั้งหมด", () => {
  for (const kind of ["mine", "work"] as const) {
    const boxes = statusSummaryBoxes(kind);
    assert.equal(boxes.length, 4);
    assert.equal(boxes[0].id, "all");
    assert.deepEqual([...boxes[0].ids], []);
  }
});

test("กำลังดำเนินการ includes Revise — a returned request is still in flight", () => {
  const mine = statusSummaryBoxes("mine").find((b) => b.id === "inProcess")!;
  assert.deepEqual([...mine.ids], ["Submitted", "ManagerApproved", "Returned"]);
  const work = statusSummaryBoxes("work").find((b) => b.id === "inProcess")!;
  assert.deepEqual([...work.ids], ["pending", "Returned"]);
});

test("every box names only ids its own kind offers", () => {
  // A box standing for an id the dropdown cannot produce could be highlighted
  // and never reproduced by hand — or, worse, never highlighted at all.
  for (const kind of ["mine", "work"] as const) {
    const known = statusFilterOptions(kind).map((o) => o.id);
    for (const box of statusSummaryBoxes(kind)) {
      for (const id of box.ids) {
        assert.ok(known.includes(id), `${kind}: box ${box.id} names unknown id ${id}`);
      }
    }
  }
});

/* ── the highlight ── */

test("a box lights when the selection is exactly its set, in any order", () => {
  const box = statusSummaryBoxes("mine").find((b) => b.id === "inProcess")!;
  assert.equal(isSummaryBoxActive(["Submitted", "ManagerApproved", "Returned"], box), true);
  assert.equal(isSummaryBoxActive(["Returned", "Submitted", "ManagerApproved"], box), true);
});

test("a box goes out the moment one of its statuses is removed", () => {
  // Picking กำลังดำเนินการ's three one at a time in the dropdown lights it;
  // dropping any one puts it out. That two-way agreement is the whole reason
  // both controls can exist over one value.
  const box = statusSummaryBoxes("mine").find((b) => b.id === "inProcess")!;
  assert.equal(isSummaryBoxActive(["Submitted", "ManagerApproved"], box), false);
});

test("a superset does not light a box either", () => {
  const box = statusSummaryBoxes("mine").find((b) => b.id === "approved")!;
  assert.equal(isSummaryBoxActive(["Approved"], box), true);
  assert.equal(isSummaryBoxActive(["Approved", "Rejected"], box), false);
});

test("an empty selection lights ทั้งหมด and nothing else", () => {
  const boxes = statusSummaryBoxes("mine");
  const lit = boxes.filter((b) => isSummaryBoxActive([], b));
  assert.deepEqual(lit.map((b) => b.id), ["all"]);
});

test('"nothing selected" does not light ทั้งหมด', () => {
  // `MULTI_SELECT_NONE` is a one-element selection meaning deliberately
  // nothing — the opposite of "no filter". The length test keeps them apart.
  const all = statusSummaryBoxes("mine")[0];
  assert.equal(isSummaryBoxActive(["__MULTI_SELECT_NONE__"], all), false);
});

test("at most one box is ever lit, for every box's own set", () => {
  for (const kind of ["mine", "work"] as const) {
    const boxes = statusSummaryBoxes(kind);
    for (const box of boxes) {
      const lit = boxes.filter((b) => isSummaryBoxActive([...box.ids], b));
      assert.equal(lit.length, 1, `${kind}: ${box.id} lights ${lit.length} boxes`);
      assert.equal(lit[0].id, box.id);
    }
  }
});

/* ── the total ── */

test("the total adds the amounts and ignores the rows without one", () => {
  assert.equal(
    sumTotalAmount([
      { totalAmount: 1200.5 },
      { totalAmount: null },
      { totalAmount: 99.5 },
      {},
    ]),
    1300,
  );
});

test("an empty set totals zero rather than blank", () => {
  assert.equal(sumTotalAmount([]), 0);
});

test("a non-finite amount cannot poison the sum", () => {
  // One NaN would turn the whole figure into NaN and print "—" over a filter
  // that matched real money.
  assert.equal(
    sumTotalAmount([{ totalAmount: 100 }, { totalAmount: NaN }, { totalAmount: Infinity }]),
    100,
  );
});

test("a negative amount is added, not dropped", () => {
  assert.equal(sumTotalAmount([{ totalAmount: 500 }, { totalAmount: -200 }]), 300);
});
