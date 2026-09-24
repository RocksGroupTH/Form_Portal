import { test } from "node:test";
import assert from "node:assert/strict";
import type { ReportRow } from "@/lib/acc/report-service";
import {
  MY_REQUEST_COLUMNS,
  cellExportValue,
  cellText,
  columnsForKind,
  daysBetween,
  daysPending,
  daysUntilPayment,
  defaultVisibleKeys,
  departmentLabel,
  isSettled,
  managerTurnaroundDays,
  DEFAULT_PAGE_SIZE,
  MY_REQUEST_PAGE_SIZES,
  clampPage,
  pageCount,
  pageSlice,
  pageWindow,
  statusDisplay,
  statusDisplayForBucket,
  stepLabel,
  type MyRequestColKey,
} from "@/lib/acc/my-request-view";

/**
 * The table view of My Requests and My Work.
 *
 * Unit-testable because `my-request-view.ts` imports nothing but a type —
 * `report-service.ts` itself reaches `@/env` through a pool and throws at
 * import, which is why the rules live in their own module at all.
 */

const NOW = "2026-09-24T09:00:00";

function row(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: 1,
    requestNo: "TOF26-00001",
    formCode: "AP-1",
    formName: "แบบฟอร์มเบิกค่าเดินทาง",
    staffId: 10,
    requesterFullName: "Sattawat Jaiyen",
    requesterDepartmentName: "IT",
    brandCode: "PCTH",
    travelDate: null,
    vehicleName: null,
    workDetail: null,
    totalDistanceKm: null,
    totalAmount: 1200,
    status: "Submitted",
    paymentDate: null,
    submittedAt: "2026-09-20T10:00:00",
    ...over,
  };
}

/* ---------------------------------------------------------------- *
 * Columns
 * ---------------------------------------------------------------- */

test("every column key is declared exactly once", () => {
  const seen = new Set<string>();
  for (const c of MY_REQUEST_COLUMNS) {
    assert.equal(seen.has(c.key), false, `${c.key} is declared twice`);
    seen.add(c.key);
  }
});

test("the requester columns are งานของฉัน's alone", () => {
  /* On คำขอของฉัน every row is the reader's own, so offering "ผู้ขอเบิก" would
     be offering a column of one name repeated — and a picker entry that can
     only disappoint. The list view hides it for the same reason. */
  const mine = columnsForKind("mine").map((c) => c.key);
  const work = columnsForKind("work").map((c) => c.key);
  assert.equal(mine.indexOf("requesterName"), -1);
  assert.equal(mine.indexOf("requesterDepartment"), -1);
  assert.ok(work.indexOf("requesterName") !== -1);
  assert.ok(work.indexOf("requesterDepartment") !== -1);
});

test("every default is a column that page actually offers", () => {
  /* A default naming a column the picker does not list is a column nobody can
     switch back on once they have switched it off. */
  for (const kind of ["mine", "work"] as const) {
    const offered = columnsForKind(kind).map((c) => c.key);
    for (const key of defaultVisibleKeys(kind)) {
      assert.ok(
        offered.indexOf(key) !== -1,
        `${kind}: default column ${key} is not offered on that page`,
      );
    }
  }
});

test("the defaults are short enough to read", () => {
  // Not a style rule: the table scrolls horizontally, and a first render wider
  // than the screen hides the columns the page exists to show.
  for (const kind of ["mine", "work"] as const) {
    assert.ok(defaultVisibleKeys(kind).length <= 10, `${kind} opens with too many columns`);
  }
});

/* ---------------------------------------------------------------- *
 * Day counts
 * ---------------------------------------------------------------- */

test("days are counted by CALENDAR date, not by 24-hour blocks", () => {
  /* Filed at 23:00 and read at 01:00 is "1 day ago" to anybody reading the
     column. An elapsed-hours count answers 0 and then flips in the middle of
     the following night. */
  assert.equal(daysBetween("2026-09-23T23:00:00", "2026-09-24T01:00:00"), 1);
  assert.equal(daysBetween("2026-09-24T00:05:00", "2026-09-24T23:55:00"), 0);
});

test("daysBetween is signed, and refuses what it cannot parse", () => {
  assert.equal(daysBetween("2026-09-24T09:00:00", "2026-09-20T09:00:00"), -4);
  assert.equal(daysBetween(null, NOW), null);
  assert.equal(daysBetween("not a date", NOW), null);
});

test("a settled request has no age", () => {
  /* The column answers "how long has this been waiting", and a finished claim
     is not waiting. Left running it would climb forever and sort every closed
     row to the top of a list ordered by what needs attention. */
  for (const status of ["Approved", "Rejected", "Cancelled", "Completed"]) {
    assert.equal(daysPending(row({ status }), NOW), null, status);
  }
  assert.equal(daysPending(row({ status: "Submitted" }), NOW), 4);
  assert.equal(daysPending(row({ status: "ManagerApproved" }), NOW), 4);
});

test("a status this module has never heard of counts as LIVE", () => {
  /* The terminal list is the allow-list, deliberately the opposite way round
     from perdiem-window.ts: a new status is far more likely to be a new stage
     than a new ending, and counting a live claim's age is harmless where
     counting a finished one's is a number that never stops. */
  assert.equal(isSettled("SomeFutureStatus"), false);
  assert.equal(daysPending(row({ status: "SomeFutureStatus" }), NOW), 4);
});

test("manager turnaround is submit to approval, and null until it happens", () => {
  assert.equal(managerTurnaroundDays(row()), null);
  assert.equal(
    managerTurnaroundDays(row({ managerApprovedAt: "2026-09-22T14:00:00" })),
    2,
  );
});

test("a payment date already gone reads NEGATIVE", () => {
  /* The sign is the whole information: a payment three days overdue and one
     due in three days are opposite situations. */
  assert.equal(daysUntilPayment(row({ paymentDate: "2026-09-30" }), NOW), 6);
  assert.equal(daysUntilPayment(row({ paymentDate: "2026-09-21" }), NOW), -3);
  assert.equal(daysUntilPayment(row({ paymentDate: "2026-09-24" }), NOW), 0);
  assert.equal(daysUntilPayment(row(), NOW), null);
});

/* ---------------------------------------------------------------- *
 * Cells
 * ---------------------------------------------------------------- */

test("a payment date is spelled out rather than signed on screen", () => {
  /* "-3" sitting beside "3" in a column of numbers is a minus sign somebody
     misses, and the two mean opposite things to whoever is chasing a payment. */
  assert.equal(cellText(row({ paymentDate: "2026-09-30" }), "daysUntilPayment", NOW), "อีก 6");
  assert.equal(cellText(row({ paymentDate: "2026-09-21" }), "daysUntilPayment", NOW), "เลยมา 3");
  assert.equal(cellText(row({ paymentDate: "2026-09-24" }), "daysUntilPayment", NOW), "วันนี้");
});

test("the EXPORT keeps the sign, because a spreadsheet sorts on it", () => {
  assert.equal(cellExportValue(row({ paymentDate: "2026-09-21" }), "daysUntilPayment", NOW), -3);
  assert.equal(cellExportValue(row({ paymentDate: "2026-09-30" }), "daysUntilPayment", NOW), 6);
});

test("money reaches the export as a NUMBER, so the column can be summed", () => {
  /* The first thing anybody does with ยอดรวม in Excel is total it, which text
     cannot do. Dates go the other way — see the module docblock. */
  assert.equal(cellExportValue(row({ totalAmount: 1234.5 }), "totalAmount", NOW), 1234.5);
  assert.equal(cellText(row({ totalAmount: 1234.5 }), "totalAmount", NOW), "1,234.50");
  assert.equal(cellExportValue(row({ submittedAt: "2026-09-20T10:00:00" }), "submittedAt", NOW), "20/09/2026");
});

test("an empty cell exports as empty, never as a dash", () => {
  /* "—" in a spreadsheet is a value: it defeats a blank filter and breaks any
     column somebody tries to total. */
  assert.equal(cellText(row({ paymentDate: null }), "paymentDate", NOW), "—");
  assert.equal(cellExportValue(row({ paymentDate: null }), "paymentDate", NOW), "");
  assert.equal(cellExportValue(row({ totalAmount: null }), "totalAmount", NOW), "");
});

test("a baht claim says THB rather than a dash", () => {
  /* Null and "THB" both mean baht, and a baht claim leaves it null — so a dash
     would read as "nobody recorded what this is denominated in", which is the
     opposite of what the absence means. */
  assert.equal(cellText(row({ currency: null }), "currency", NOW), "THB");
  assert.equal(cellText(row({ currency: "MYR" }), "currency", NOW), "MYR");
});

test("รออนุมัติโดย is a NAME, or failing that a department — never both", () => {
  /* The user's rule, 2026-09-24: "ให้ใส่เป็นชื่อ ถ้าไม่มีใส่แค่แผนก". The step
     prefix used to sit in front of the name, which is the one case where it
     adds nothing: a named person IS the answer to "who is this with". */
  assert.equal(
    cellText(row({ pendingStepCode: "MANAGER", pendingApproverName: "Somchai" }), "pendingBy", NOW),
    "Somchai",
  );
  assert.equal(cellText(row({ pendingStepCode: "ACCOUNT" }), "pendingBy", NOW), "บัญชี");
  assert.equal(cellText(row({ pendingStepCode: "ADMIN" }), "pendingBy", NOW), "Admin");
});

test("an email is NOT a third fallback for รออนุมัติโดย", () => {
  /* It was reaching the column raw — "บัญชี · sattawat.c@rocksgroup.com" — which
     is noise in a column being scanned. A missing name means that approver has
     no active HR row, which AP-4 explicitly allows; the address survives as the
     cell's tooltip rather than as its text. */
  assert.equal(
    cellText(row({ pendingStepCode: "ACCOUNT", pendingApproverEmail: "a@b.com" }), "pendingBy", NOW),
    "บัญชี",
  );
  // With no step either, there is genuinely nothing to say.
  assert.equal(cellText(row({ pendingApproverEmail: "a@b.com" }), "pendingBy", NOW), "—");
});

test("AP-4's two accounting steps are ONE department and TWO steps", () => {
  /* `รออนุมัติโดย` answers "who is this with" and both are บัญชี;
     `ขั้นตอนปัจจุบัน` answers "which step" and they are different events. The
     two labels are separate functions for exactly this reason. */
  assert.equal(departmentLabel("ACCOUNT"), "บัญชี");
  assert.equal(departmentLabel("ACCOUNT_FINAL"), "บัญชี");
  assert.equal(stepLabel("ACCOUNT_FINAL"), "บัญชี (ขั้นสุดท้าย)");
});

/* ---------------------------------------------------------------- *
 * Status
 * ---------------------------------------------------------------- */

test("Submitted and ManagerApproved are told APART", () => {
  /* The whole reason for a display vocabulary of its own:
     `statusLabelDisplay` collapses both to "รออนุมัติ", which is right for a
     chip in a list and wrong for a column somebody scans to find what is
     stuck — those are two different desks. */
  assert.deepEqual(statusDisplay("Submitted"), { label: "Submitted", tone: "submitted" });
  assert.deepEqual(statusDisplay("ManagerApproved"), { label: "Pending", tone: "pending" });
});

test("Returned is Revise, and not a kind of pending", () => {
  /* The requester has to act on it. A label saying "waiting" tells them the
     opposite of what is true. */
  assert.deepEqual(statusDisplay("Returned"), { label: "Revise", tone: "revise" });
});

test("Approved and Completed are one label, Cancelled is its own", () => {
  // Two forms' terminal statuses, one outcome — AP-17 ends at Completed where
  // AP-1 ends at Approved. Cancelled stays separate at the user's instruction:
  // folding it into Rejected would say somebody refused it.
  assert.equal(statusDisplay("Approved").label, "Complete");
  assert.equal(statusDisplay("Completed").label, "Complete");
  assert.deepEqual(statusDisplay("Cancelled"), { label: "Cancelled", tone: "cancelled" });
  assert.deepEqual(statusDisplay("Rejected"), { label: "Rejected", tone: "rejected" });
});

test("every tone is used by exactly one status, so no two look alike", () => {
  /* "ปรับสีให้แตกต่างกัน" is only true if the tones are distinct — two statuses
     sharing one would render identically and defeat the column. */
  const tones = ["Submitted", "ManagerApproved", "Approved", "Rejected", "Returned", "Cancelled"].map(
    (s) => statusDisplay(s).tone,
  );
  assert.equal(new Set(tones).size, tones.length, "two statuses share a tone");
});

test("an unrecognised status renders ITSELF rather than a catch-all", () => {
  /* `AccRequest.Status`'s CHECK permits ten values and this maps seven; `Ready`
     and `Received` belong to AP-11, a retired form still holding one row of
     each. Showing the raw value keeps them visible, and a status added later
     appears instead of silently reading as something else. */
  assert.deepEqual(statusDisplay("Received"), { label: "Received", tone: "other" });
  assert.deepEqual(statusDisplay("Ready"), { label: "Ready", tone: "other" });
  assert.equal(statusDisplay("").label, "—");
});

test("a settled request is waiting for nobody", () => {
  /* The pending columns are read from AccApproval rows that outlive the
     decision, so a closed claim can still carry one. Printing it would name an
     approver who has already acted as the person holding it up. */
  const done = row({ status: "Approved", pendingStepCode: "ACCOUNT", pendingApproverName: "X" });
  assert.equal(cellText(done, "pendingBy", NOW), "—");
});

test("an unknown step code renders itself rather than vanishing", () => {
  /* Five forms write four different step vocabularies into one column. An
     unmapped code is information — a blank cell is not. */
  assert.equal(stepLabel("ACC_OFFICER"), "เจ้าหน้าที่บัญชี");
  assert.equal(stepLabel("SOMETHING_NEW"), "SOMETHING_NEW");
  assert.equal(stepLabel(null), "—");
});

test("a travel range collapses to one date when it is one day", () => {
  assert.equal(
    cellText(row({ travelDate: "2026-09-20", travelDateTo: "2026-09-22" }), "travelDate", NOW),
    "20/09/2026 – 22/09/2026",
  );
  assert.equal(
    cellText(row({ travelDate: "2026-09-20", travelDateTo: "2026-09-20" }), "travelDate", NOW),
    "20/09/2026",
  );
  // A form with no journey prints nothing rather than labelling a dash as one.
  assert.equal(cellText(row({ travelDate: null }), "travelDate", NOW), "—");
});

test("every column produces a string for every row, including an empty one", () => {
  /* A missing switch arm is a compile error on the union, but a thrown
     exception inside one would take the whole table down — and these rows span
     five forms, so most columns are null on most rows. */
  const empty = {
    id: 1,
    requestNo: null,
    formCode: "",
    formName: null,
    staffId: null,
    requesterFullName: null,
    requesterDepartmentName: null,
    brandCode: null,
    travelDate: null,
    vehicleName: null,
    workDetail: null,
    totalDistanceKm: null,
    totalAmount: null,
    status: "",
    paymentDate: null,
    submittedAt: null,
  } satisfies ReportRow;
  for (const col of MY_REQUEST_COLUMNS) {
    const text = cellText(empty, col.key as MyRequestColKey, NOW);
    assert.equal(typeof text, "string", `${col.key} did not answer a string`);
    assert.notEqual(text, "", `${col.key} answered an empty string rather than a dash`);
  }
});

test("dates are formatted from LOCAL parts, never re-serialised through UTC", () => {
  /* Every timestamp in these databases is a Thai wall clock and the driver runs
     useUTC: false, so the parts are already right. Going back through
     toISOString() is the seven-hour shift CLAUDE.md's Dates section records
     having fixed once already — and it shows up exactly here, late at night. */
  assert.equal(cellText(row({ submittedAt: "2026-09-20T23:30:00" }), "submittedAt", NOW), "20/09/2026");
  assert.equal(cellText(row({ submittedAt: "2026-09-20T00:30:00" }), "submittedAt", NOW), "20/09/2026");
});

test("งานของฉัน's buckets speak the SAME six words", () => {
  /* The two pages ask different questions — My Work labels a row by what it
     means to the viewer, My Requests by the request's own status — and the
     user's rule is that the WORDS are shared, not the question. A bucket
     answering its own vocabulary is how the list and the table came to
     disagree when the table was added. */
  assert.deepEqual(statusDisplayForBucket("pending"), { label: "Pending", tone: "pending" });
  assert.deepEqual(statusDisplayForBucket("Approved"), { label: "Complete", tone: "complete" });
  assert.deepEqual(statusDisplayForBucket("Returned"), { label: "Revise", tone: "revise" });
  assert.deepEqual(statusDisplayForBucket("Rejected"), { label: "Rejected", tone: "rejected" });
  assert.deepEqual(statusDisplayForBucket("Cancelled"), { label: "Cancelled", tone: "cancelled" });
});

test("every bucket label is one the raw-status map also produces", () => {
  /* The point of the shared vocabulary: a reader must never meet a word on one
     page that does not exist on the other. `Submitted` is the one asymmetry and
     it is deliberate — the bucket has no such member, because a submitted
     request sitting on your own manager step is pending YOU. */
  const fromStatus = new Set(
    ["Submitted", "ManagerApproved", "Approved", "Rejected", "Returned", "Cancelled"].map(
      (s) => statusDisplay(s).label,
    ),
  );
  for (const b of ["pending", "Approved", "Rejected", "Returned", "Cancelled"]) {
    const { label } = statusDisplayForBucket(b);
    assert.ok(fromStatus.has(label), `bucket ${b} says "${label}", which no status produces`);
  }
});

test("a request waiting to reach Business Central is already Complete", () => {
  /* The user's rule, 2026-09-24: "ถ้ารอ Interface ERP คือ Complete แล้ว".
     Measured the same day — every row that has finished its approvals carries
     Status='Approved' with CurrentStepCode NULL, whatever ErpInterfaceStatus
     says, and no CurrentStepCode anywhere names an ERP step. So the rule is a
     property of the mapping rather than a branch: the status is read and the
     ERP state is not consulted at all. Pinned because a later reader might
     reasonably try to add an "awaiting ERP" label, which would take these rows
     back out of Complete. */
  for (const erp of ["Pending", "Sent", "Failed", null]) {
    const r = row({ status: "Approved", currentStepCode: null, paymentDate: "2026-09-30" });
    void erp;
    assert.equal(cellText(r, "status", NOW), "Complete");
  }
  // Still Complete when the send has failed: the approval finished, and the
  // posting is accounting's problem rather than a stage of this request.
  assert.equal(statusDisplay("Approved").label, "Complete");
});

test("statusDisplay takes a STATUS and nothing else", () => {
  /* It took a step for a few hours on 2026-09-24, to promote AP-4 rows at
     ACCOUNT_FINAL to Complete for their requester. Measuring the database
     killed that: those rows were not waiting for Business Central, they were
     stuck — one approver, who had signed both earlier steps himself, and
     canActFinalStep refuses the same person. Complete would have told the
     requester their money was settled on a claim that could never be approved.

     The step was retired instead (STATE_AFTER_APPROVE), so accounting's
     approval lands on Approved and reaches Complete through the ordinary
     mapping. Pinned as an arity so the shortcut cannot come back quietly. */
  assert.equal(statusDisplay.length, 1, "statusDisplay must not start reading a step again");
  assert.equal(statusDisplay("ManagerApproved").label, "Pending");
  assert.equal(statusDisplay("Approved").label, "Complete");
});

/* ---------------------------------------------------------------- *
 * Paging
 * ---------------------------------------------------------------- */

test("the default page size is 10 and the choices include it", () => {
  assert.equal(DEFAULT_PAGE_SIZE, 10);
  assert.ok(MY_REQUEST_PAGE_SIZES.indexOf(DEFAULT_PAGE_SIZE) !== -1);
});

test("an empty result is one page, not zero", () => {
  /* Zero pages makes the pager render nothing and `clampPage` answer 0, which
     then slices from index -10. One empty page is the honest shape. */
  assert.equal(pageCount(0, 10), 1);
  assert.equal(clampPage(1, 0, 10), 1);
  assert.deepEqual(pageSlice([], 1, 10), []);
});

test("page counts round UP, because a remainder is still a page", () => {
  assert.equal(pageCount(10, 10), 1);
  assert.equal(pageCount(11, 10), 2);
  assert.equal(pageCount(57, 10), 6);
  assert.equal(pageCount(57, 100), 1);
});

test("filtering while deep in the pages lands on the LAST page, not an empty one", () => {
  /* The case this exists for: 57 rows, reader on page 6, they type a search
     that leaves 12. Page 6 of 2 slices nothing, which reads as "no results"
     over a filter that matched plenty. */
  assert.equal(clampPage(6, 12, 10), 2);
  assert.equal(clampPage(6, 57, 10), 6);
  // And nonsense clamps forward rather than throwing.
  assert.equal(clampPage(0, 57, 10), 1);
  assert.equal(clampPage(-3, 57, 10), 1);
  assert.equal(clampPage(Number.NaN, 57, 10), 1);
});

test("the slice is the page a reader would count to", () => {
  const rows = Array.from({ length: 25 }, (_, i) => i + 1);
  assert.deepEqual(pageSlice(rows, 1, 10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(pageSlice(rows, 2, 10), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  assert.deepEqual(pageSlice(rows, 3, 10), [21, 22, 23, 24, 25]);
  // Past the end is the last page, never empty — the clamp above, applied.
  assert.deepEqual(pageSlice(rows, 9, 10), [21, 22, 23, 24, 25]);
});

test("a short pager lists every page with no ellipsis", () => {
  assert.deepEqual(pageWindow(1, 1), [1]);
  assert.deepEqual(pageWindow(2, 4), [1, 2, 3, 4]);
  assert.deepEqual(pageWindow(3, 7), [1, 2, 3, 4, 5, 6, 7]);
});

test("a long pager keeps the first and last page reachable", () => {
  /* "Back to the start" is the one jump a windowed pager otherwise makes
     impossible, so page 1 and the last page are always offered. */
  const w = pageWindow(10, 20);
  assert.equal(w[0], 1);
  assert.equal(w[w.length - 1], 20);
  assert.ok(w.indexOf(10) !== -1, "the current page is not in its own window");
});

test("the pager does not change width as the reader moves through it", () => {
  /* A row of buttons that grows and shrinks slides Next sideways under the
     cursor, which is a misclick waiting to happen. */
  const widths = new Set<number>();
  for (let p = 1; p <= 20; p++) widths.add(pageWindow(p, 20).length);
  assert.equal(widths.size, 1, `pager width varies: ${Array.from(widths).join(", ")}`);
});

test("an ellipsis appears only where pages are actually skipped", () => {
  /* A gap drawn between 1 and 2 claims something is hidden when nothing is,
     which teaches the reader to distrust the other one. */
  const first = pageWindow(1, 20);
  assert.equal(first[1], 2, "a gap sits between page 1 and page 2");
  const last = pageWindow(20, 20);
  assert.equal(last[last.length - 2], 19, "a gap sits between the last two pages");
  const middle = pageWindow(10, 20);
  assert.equal(middle[1], "gap");
  assert.equal(middle[middle.length - 2], "gap");
});
