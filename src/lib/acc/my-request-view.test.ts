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
  isSettled,
  managerTurnaroundDays,
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

test("รออนุมัติโดย names the step AND the person, and neither alone is enough", () => {
  /* Both accounting steps are assigned to a pool rather than a person, so the
     name is often absent and the step is what remains; a bare name would not
     say what they are being asked to do. */
  assert.equal(
    cellText(row({ pendingStepCode: "MANAGER", pendingApproverName: "Somchai" }), "pendingBy", NOW),
    "ผู้จัดการ · Somchai",
  );
  assert.equal(cellText(row({ pendingStepCode: "ACCOUNT" }), "pendingBy", NOW), "บัญชี");
  assert.equal(
    cellText(row({ pendingApproverEmail: "a@b.com" }), "pendingBy", NOW),
    "a@b.com",
  );
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
