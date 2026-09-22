import { test } from "node:test";
import assert from "node:assert/strict";
import { findDateOverlap, type OtherTrip } from "./date-overlap";

const other = (over: Partial<OtherTrip> = {}): OtherTrip => ({
  requestId: 123,
  requestNo: "TRL26-00123",
  departDate: "2026-09-20",
  returnDate: "2026-09-24",
  alive: true,
  ...over,
});

test("a return date meeting a depart date is allowed — this is the whole point", () => {
  // 20-24 then 24-26. The 24th is worked once and paid once; continuation-chain
  // drops it from the second trip. Refusing this would block the case item 4
  // exists for.
  assert.equal(findDateOverlap({ departDate: "2026-09-24", returnDate: "2026-09-26" }, [other()]), null);
});

test("a depart date meeting a return date is allowed in the other direction too", () => {
  // The new trip ENDS where the old one starts: 18-20 before an existing 20-24.
  assert.equal(findDateOverlap({ departDate: "2026-09-18", returnDate: "2026-09-20" }, [other()]), null);
});

test("a partial overlap is refused and names the first shared day", () => {
  const r = findDateOverlap({ departDate: "2026-09-22", returnDate: "2026-09-26" }, [other()]);
  assert.ok(r);
  assert.equal(r.date, "2026-09-22");
  assert.equal(r.requestNo, "TRL26-00123");
});

test("a trip contained inside another is refused", () => {
  const r = findDateOverlap({ departDate: "2026-09-21", returnDate: "2026-09-23" }, [other()]);
  assert.ok(r);
  assert.equal(r.date, "2026-09-21");
});

test("a trip that swallows another is refused", () => {
  const r = findDateOverlap({ departDate: "2026-09-18", returnDate: "2026-09-28" }, [other()]);
  assert.ok(r);
  assert.equal(r.date, "2026-09-20");
});

test("a same-day trip on an existing return date is refused, not treated as a continuation", () => {
  // 24-24 is not a depart meeting a return, it is the whole trip sitting on a
  // day already paid. The spec's table names this case explicitly.
  const r = findDateOverlap({ departDate: "2026-09-24", returnDate: "2026-09-24" }, [other()]);
  assert.ok(r);
  assert.equal(r.date, "2026-09-24");
});

test("trips that do not touch are allowed", () => {
  assert.equal(findDateOverlap({ departDate: "2026-09-26", returnDate: "2026-09-28" }, [other()]), null);
  assert.equal(findDateOverlap({ departDate: "2026-09-10", returnDate: "2026-09-12" }, [other()]), null);
});

test("an empty list of other trips allows anything", () => {
  assert.equal(findDateOverlap({ departDate: "2026-09-22", returnDate: "2026-09-26" }, []), null);
});

test("a cancelled or rejected trip blocks nothing — re-filing is the point", () => {
  // A trip that will never be paid cannot own a day. Refusing a re-file because
  // of the request it replaces is the failure this arm exists to prevent, and
  // the rule lives HERE rather than in the caller's filter so it is testable.
  const dead = [other({ alive: false })];
  assert.equal(findDateOverlap({ departDate: "2026-09-22", returnDate: "2026-09-26" }, dead), null);
  assert.equal(findDateOverlap({ departDate: "2026-09-20", returnDate: "2026-09-24" }, dead), null);
});

test("a dead trip does not mask a live one behind it", () => {
  const rows = [
    other({ requestId: 1, requestNo: "TRL26-00111", alive: false }),
    other({ requestId: 2, requestNo: "TRL26-00222", departDate: "2026-09-23", returnDate: "2026-09-27" }),
  ];
  const r = findDateOverlap({ departDate: "2026-09-22", returnDate: "2026-09-26" }, rows);
  assert.ok(r);
  assert.equal(r.requestNo, "TRL26-00222");
  assert.equal(r.date, "2026-09-23");
});

test("the message names the date AND the request, in Thai", () => {
  const r = findDateOverlap({ departDate: "2026-09-22", returnDate: "2026-09-26" }, [other()]);
  assert.ok(r);
  // A refusal a requester cannot act on is not a refusal. The request they hit
  // may be one they filed weeks ago.
  assert.ok(r.message.includes("22/09/2026"), `message lacks the date: ${r.message}`);
  assert.ok(r.message.includes("TRL26-00123"), `message lacks the running number: ${r.message}`);
  assert.ok(r.message.includes("20/09/2026"), `message lacks the other trip's range: ${r.message}`);
});

test("a request with no running number still produces a usable message", () => {
  // A Draft has no RequestNo. It should not render "null" at the reader.
  const r = findDateOverlap(
    { departDate: "2026-09-22", returnDate: "2026-09-26" },
    [other({ requestNo: null })],
  );
  assert.ok(r);
  assert.ok(!r.message.includes("null"), `message leaks null: ${r.message}`);
  assert.ok(r.message.includes("22/09/2026"));
});

test("the earliest colliding trip is reported when several collide", () => {
  const rows = [
    other({ requestId: 2, requestNo: "TRL26-00222", departDate: "2026-09-25", returnDate: "2026-09-27" }),
    other({ requestId: 1, requestNo: "TRL26-00111", departDate: "2026-09-20", returnDate: "2026-09-24" }),
  ];
  const r = findDateOverlap({ departDate: "2026-09-21", returnDate: "2026-09-26" }, rows);
  assert.ok(r);
  // Deterministic: the first shared DAY, so the reader is pointed at the start
  // of their problem rather than at whichever row the database returned first.
  assert.equal(r.date, "2026-09-21");
  assert.equal(r.requestNo, "TRL26-00111");
});
