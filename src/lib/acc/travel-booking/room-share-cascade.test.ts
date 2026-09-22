import { test } from "node:test";
import assert from "node:assert/strict";
import { cascadeForHostDeath, cascadeForHostDates, type GuestState } from "./room-share-cascade";
import { EDITABLE_STATUSES } from "@/lib/acc/request-acl-policy";

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

test("every alive FILED status is cancelled when the host dies, including Completed", () => {
  // Spec §7 names this explicitly: a guest at each status, Completed included.
  // A Completed guest's per diem has already been paid, and it is cancelled
  // anyway — this is the direction perdiem-window.ts exists to prevent, and
  // the user chose it knowingly (spec §2). `wasCompleted` is what lets a
  // caller (Task 8) tell accounting this happened.
  //
  // `Draft` and `Returned` left this list at final review C1 and have their
  // own cases below: they are DETACHED, not cancelled, because cancelling
  // them bricked the guest's whole booking group.
  for (const status of ["Submitted", "ManagerApproved", "Completed"]) {
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

/**
 * **Final review C1, and the case that made this branch unshippable.**
 *
 * `saveTravelBookingDraft`, `deleteTravelBookingDraft` and
 * `submitTravelBookingGroup` each loop every tab sharing the guest's
 * `GroupKey` and throw on any whose status is not `Draft` or `Returned`. A
 * cascade-cancelled tab therefore made the whole group unsavable,
 * unsubmittable AND undeletable, with no in-app remedy — and it was the
 * ORDINARY path, because the attach control refuses to open until the draft
 * is saved, so a guest is normally `Draft` when it attaches.
 */
test("a Draft guest is DETACHED when the host dies, never cancelled", () => {
  const actions = cascadeForHostDeath([guest({ status: "Draft" })]);
  assert.equal(actions.length, 1);
  const action = actions[0];
  assert.equal(action.kind, "detach");
  if (action.kind !== "detach") throw new Error("unreachable");
  assert.equal(action.requestId, 200);
  assert.equal(action.previousStatus, "Draft");
});

/**
 * `Returned` was the one to decide deliberately rather than assume: unlike a
 * draft it HAS been filed, so spec §2's "cancelled in every case" looks like
 * it should reach it. It is detached all the same, and for two reasons that
 * both point the same way — it carries the identical brick (the three group
 * guards admit `Returned` exactly as they admit `Draft`), and a returned
 * request is one its owner has been asked to change, so it holds no approved
 * or paid position for the cancellation to protect. What it loses is
 * recoverable by the person themselves; what cancelling costs is not.
 */
test("a Returned guest is DETACHED too — filed, but still its owner's to edit", () => {
  const actions = cascadeForHostDeath([guest({ status: "Returned" })]);
  assert.equal(actions.length, 1);
  const action = actions[0];
  assert.equal(action.kind, "detach");
  if (action.kind !== "detach") throw new Error("unreachable");
  assert.equal(action.previousStatus, "Returned");
});

/**
 * **The correspondence, pinned in BOTH directions.** The brick lives exactly
 * where the detach set and the group guards' admitted set disagree: a status
 * those guards admit but this function cancels strands a group, and a status
 * they refuse but this function detaches leaves a filed guest holding a room
 * that no longer exists. `EDITABLE_STATUSES` is the constant those guards are
 * the hardcoded expression of, so asserting equality against it is what keeps
 * the two from drifting — `room-share-cascade-guard.test.ts` asserts the
 * other half, that `request-service.ts` still spells that same pair.
 */
test("the detach set is EXACTLY EDITABLE_STATUSES — nothing more, nothing less", () => {
  const everyStatus = [
    "Draft",
    "Submitted",
    "ManagerApproved",
    "Completed",
    "Returned",
    "Cancelled",
    "Rejected",
  ];
  const detached: string[] = [];
  for (const status of everyStatus) {
    const action = cascadeForHostDeath([guest({ status })])[0];
    if (action.kind === "detach") detached.push(status);
  }
  assert.deepEqual(detached.slice().sort(), EDITABLE_STATUSES.slice().sort());
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
