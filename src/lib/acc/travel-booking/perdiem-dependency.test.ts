import { test } from "node:test";
import assert from "node:assert/strict";
import { perDiemDependency, type DependencyTrip } from "./perdiem-dependency";

const trip = (
  requestId: number,
  sortOrder: number,
  departDate: string,
  returnDate: string,
  status: string,
): DependencyTrip => ({
  requestId,
  requestNo: `TRL26-0900${requestId}`,
  sortOrder,
  departDate,
  returnDate,
  status,
});

/**
 * A trip that departs the day the one before it returned drops that day, so its
 * figure is only final once the earlier trip's fate is. While the earlier trip
 * still sits with its manager it may yet be rejected, and the day would come
 * back — accounting must not sign a number that can still move.
 */

test("no predecessor, no dependency", () => {
  const t = trip(1, 0, "2026-08-04", "2026-08-06", "ManagerApproved");
  assert.equal(perDiemDependency(t, [t]), null);
});

test("a predecessor whose dates do not touch is not a dependency", () => {
  const a = trip(1, 0, "2026-08-01", "2026-08-02", "Submitted");
  const b = trip(2, 1, "2026-08-10", "2026-08-11", "ManagerApproved");
  assert.equal(perDiemDependency(b, [a, b]), null);
});

test("a touching predecessor still with its manager blocks", () => {
  const a = trip(1, 0, "2026-08-04", "2026-08-06", "Submitted");
  const b = trip(2, 1, "2026-08-06", "2026-08-07", "ManagerApproved");
  const dep = perDiemDependency(b, [a, b]);
  assert.equal(dep?.requestId, 1);
  assert.equal(dep?.requestNo, "TRL26-09001");
  assert.equal(dep?.settled, false);
});

test("a decided predecessor is named but does not block", () => {
  const a = trip(1, 0, "2026-08-04", "2026-08-06", "ManagerApproved");
  const b = trip(2, 1, "2026-08-06", "2026-08-07", "ManagerApproved");
  assert.equal(perDiemDependency(b, [a, b])?.settled, true);
});

test("Returned is not settled — it can come back and be approved", () => {
  const a = trip(1, 0, "2026-08-04", "2026-08-06", "Returned");
  const b = trip(2, 1, "2026-08-06", "2026-08-07", "ManagerApproved");
  assert.equal(perDiemDependency(b, [a, b])?.settled, false);
});

test("a dead predecessor is settled, and the search moves past it", () => {
  // 1 is rejected, so 2's day already came back; 2 now touches nothing before it.
  const a = trip(1, 0, "2026-08-04", "2026-08-06", "Rejected");
  const b = trip(2, 1, "2026-08-06", "2026-08-07", "ManagerApproved");
  assert.equal(perDiemDependency(b, [a, b]), null);
});

test("the search skips a dead trip to reach a live one that still touches", () => {
  const a = trip(1, 0, "2026-08-04", "2026-08-06", "Submitted");
  const dead = trip(2, 1, "2026-08-20", "2026-08-21", "Cancelled");
  const c = trip(3, 2, "2026-08-06", "2026-08-07", "ManagerApproved");
  const dep = perDiemDependency(c, [a, dead, c]);
  assert.equal(dep?.requestId, 1);
  assert.equal(dep?.settled, false);
});

test("only the nearest live predecessor counts", () => {
  // 1 returns on the 6th and 3 departs on the 6th, but live 2 sits between them.
  const a = trip(1, 0, "2026-08-04", "2026-08-06", "Submitted");
  const b = trip(2, 1, "2026-08-10", "2026-08-11", "ManagerApproved");
  const c = trip(3, 2, "2026-08-06", "2026-08-07", "ManagerApproved");
  assert.equal(perDiemDependency(c, [a, b, c]), null);
});

test("a missing date means no dependency can be established", () => {
  const a = trip(1, 0, "2026-08-04", "2026-08-06", "Submitted");
  const b: DependencyTrip = {
    requestId: 2, requestNo: "TRL26-09002", sortOrder: 1,
    departDate: null, returnDate: "2026-08-07", status: "ManagerApproved",
  };
  assert.equal(perDiemDependency(b, [a, b]), null);
});
