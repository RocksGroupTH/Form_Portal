import { test } from "node:test";
import assert from "node:assert/strict";
import { cascadeForHostDeath, cascadeForHostDates, type GuestState } from "./room-share-cascade";

const guest = (over: Partial<GuestState> = {}): GuestState => ({
  requestId: 200,
  requestNo: "TRL26-00200",
  status: "ManagerApproved",
  departDate: "2026-10-10",
  returnDate: "2026-10-14",
  ...over,
});

// ---------------------------------------------------------------------------
// cascadeForHostDeath — the host is cancelled or rejected
// ---------------------------------------------------------------------------

test("a host with no guests produces an empty array, not a throw", () => {
  assert.deepEqual(cascadeForHostDeath([]), []);
});

test("every alive status is cancelled when the host dies, including Completed", () => {
  // Spec §7 names this explicitly: a guest at each status, Completed included.
  // A Completed guest's per diem has already been paid, and it is cancelled
  // anyway — this is the direction perdiem-window.ts exists to prevent, and
  // the user chose it knowingly (spec §2). `wasCompleted` is what lets a
  // caller (Task 8) tell accounting this happened.
  for (const status of ["Draft", "Submitted", "ManagerApproved", "Completed", "Returned"]) {
    const actions = cascadeForHostDeath([guest({ status })]);
    assert.equal(actions.length, 1);
    const action = actions[0];
    assert.equal(action.kind, "cancel");
    if (action.kind !== "cancel") throw new Error("unreachable");
    assert.equal(action.requestId, 200);
    assert.equal(action.previousStatus, status);
    assert.equal(action.wasCompleted, status === "Completed", `wasCompleted wrong for ${status}`);
  }
});

test("a Completed guest is cancelled, and wasCompleted is true — the accepted cost, not silent", () => {
  const actions = cascadeForHostDeath([guest({ status: "Completed" })]);
  assert.equal(actions.length, 1);
  const action = actions[0];
  assert.equal(action.kind, "cancel");
  if (action.kind !== "cancel") throw new Error("unreachable");
  assert.equal(action.wasCompleted, true);
  assert.equal(action.previousStatus, "Completed");
});

test("an already-Cancelled guest is skipped, not re-cancelled", () => {
  const actions = cascadeForHostDeath([guest({ status: "Cancelled" })]);
  assert.equal(actions.length, 1);
  const action = actions[0];
  assert.equal(action.kind, "skip");
  if (action.kind !== "skip") throw new Error("unreachable");
  assert.equal(action.requestId, 200);
  assert.ok(action.reason.length > 0);
});

test("an already-Rejected guest is skipped, not re-cancelled", () => {
  const actions = cascadeForHostDeath([guest({ status: "Rejected" })]);
  assert.equal(actions.length, 1);
  const action = actions[0];
  assert.equal(action.kind, "skip");
  if (action.kind !== "skip") throw new Error("unreachable");
  assert.equal(action.requestId, 200);
});

test("a mix of alive and dead guests: only the alive ones are cancelled", () => {
  const actions = cascadeForHostDeath([
    guest({ requestId: 1, status: "ManagerApproved" }),
    guest({ requestId: 2, status: "Cancelled" }),
    guest({ requestId: 3, status: "Completed" }),
    guest({ requestId: 4, status: "Rejected" }),
  ]);
  assert.equal(actions.length, 4);
  const byId = new Map<number, (typeof actions)[number]>();
  for (const a of actions) byId.set(a.requestId, a);
  assert.equal(byId.get(1)?.kind, "cancel");
  assert.equal(byId.get(2)?.kind, "skip");
  assert.equal(byId.get(3)?.kind, "cancel");
  assert.equal(byId.get(4)?.kind, "skip");
});

// ---------------------------------------------------------------------------
// cascadeForHostDates — the host's travel dates change
// ---------------------------------------------------------------------------

test("a host date change with no guests produces an empty array, not a throw", () => {
  assert.deepEqual(cascadeForHostDates([], { depart: "2026-11-01", return: "2026-11-05" }), []);
});

test("a live guest whose dates differ from the host's is re-dated to match", () => {
  const actions = cascadeForHostDates(
    [guest({ departDate: "2026-10-10", returnDate: "2026-10-14" })],
    { depart: "2026-11-01", return: "2026-11-05" },
  );
  assert.equal(actions.length, 1);
  const action = actions[0];
  assert.equal(action.kind, "redate");
  if (action.kind !== "redate") throw new Error("unreachable");
  assert.equal(action.requestId, 200);
  assert.deepEqual(action.from, { depart: "2026-10-10", return: "2026-10-14" });
  assert.deepEqual(action.to, { depart: "2026-11-01", return: "2026-11-05" });
});

test("a guest whose dates already match the host's is skipped, not a no-op redate", () => {
  // A redate here would write a pointless activity row claiming something
  // changed when nothing did — spec §7 names this case explicitly.
  const actions = cascadeForHostDates(
    [guest({ departDate: "2026-11-01", returnDate: "2026-11-05" })],
    { depart: "2026-11-01", return: "2026-11-05" },
  );
  assert.equal(actions.length, 1);
  const action = actions[0];
  assert.equal(action.kind, "skip");
  if (action.kind !== "skip") throw new Error("unreachable");
  assert.equal(action.requestId, 200);
  assert.ok(action.reason.length > 0);
});

test("a Completed guest still follows the host's new dates — status and approvals are untouched by this decision, but the dates are", () => {
  const actions = cascadeForHostDates(
    [guest({ status: "Completed", departDate: "2026-10-10", returnDate: "2026-10-14" })],
    { depart: "2026-11-01", return: "2026-11-05" },
  );
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, "redate");
});

test("an already-Cancelled or Rejected guest is skipped by a host date change too", () => {
  for (const status of ["Cancelled", "Rejected"]) {
    const actions = cascadeForHostDates(
      [guest({ status, departDate: "2026-10-10", returnDate: "2026-10-14" })],
      { depart: "2026-11-01", return: "2026-11-05" },
    );
    assert.equal(actions.length, 1);
    assert.equal(actions[0].kind, "skip", `${status} guest should be skipped`);
  }
});

test("a date change that would create an overlap in the guest's own calendar is STILL a redate, never an error", () => {
  // Spec §4: "the date-following cascade can therefore create an overlap
  // that §2 of package B would have refused at submit. That is accepted and
  // must not be made an error: the guest did not choose it, and blocking the
  // host's date change because of a collision in someone else's calendar
  // would be worse." This module is never handed the guest's other trips —
  // deliberately, since there is nothing here to check them against — so the
  // only way to assert the rule is to confirm this function has no refusal
  // outcome at all: every input either redates, skips because nothing
  // changed, or skips because the guest is already dead. There is no fourth,
  // "refused" branch to reach no matter what dates are passed in.
  const actions = cascadeForHostDates(
    [guest({ departDate: "2026-10-10", returnDate: "2026-10-14" })],
    { depart: "2026-10-13", return: "2026-10-20" }, // overlaps a hypothetical other trip of this guest's — irrelevant to this function
  );
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, "redate");
});

test("several guests, mixed: alive-and-different redates, alive-and-same skips, dead skips", () => {
  const actions = cascadeForHostDates(
    [
      guest({ requestId: 1, status: "ManagerApproved", departDate: "2026-10-10", returnDate: "2026-10-14" }),
      guest({ requestId: 2, status: "Submitted", departDate: "2026-11-01", returnDate: "2026-11-05" }),
      guest({ requestId: 3, status: "Cancelled", departDate: "2026-10-10", returnDate: "2026-10-14" }),
    ],
    { depart: "2026-11-01", return: "2026-11-05" },
  );
  assert.equal(actions.length, 3);
  const byId = new Map<number, (typeof actions)[number]>();
  for (const a of actions) byId.set(a.requestId, a);
  assert.equal(byId.get(1)?.kind, "redate");
  assert.equal(byId.get(2)?.kind, "skip"); // already matches
  assert.equal(byId.get(3)?.kind, "skip"); // already dead
});
