import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isAssignedManager,
  mayActOnManagerStep,
  type ManagerStepAssignment,
} from "./manager-auth";

/**
 * The rule deciding who may approve, reject or return at the MANAGER step.
 *
 * It was untested until 2026-09-24, when it stopped being "does the actor match
 * the snapshot" and became "does the actor match whoever HR names today, with
 * the snapshot as a fallback". The two halves compose in a way that is easy to
 * state and easy to get backwards, so every branch is pinned here:
 *
 *  - a **live** answer decides ALONE — the previous manager is refused;
 *  - a **null** live answer abstains, and the snapshot answers exactly as it
 *    did before;
 *  - a settled approval row refuses everybody, live or not.
 *
 * `mayActOnManagerStepApi` is the same function with the dev-host bypass folded
 * in; it is not exercised here because `isManagerDevBypassHost` reads
 * `process.env` at module load and is off by construction in a test run. The
 * bypass itself is passed straight through as `opts.devHostBypass`, which is.
 */

const ACTOR = { staffId: 7001, email: "manager@rocksgroup.com" };
const NEW_MANAGER = { staffId: 7002, email: "new.manager@rocksgroup.com" };

/** The ordinary case: HR still agrees with the snapshot. */
function assignment(over: Partial<ManagerStepAssignment> = {}): ManagerStepAssignment {
  return {
    current: { staffId: 7001, email: "manager@rocksgroup.com" },
    snapshotStaffId: 7001,
    approval: { assignedTo: 7001, assignedEmail: "manager@rocksgroup.com", status: "Pending" },
    ...over,
  };
}

/* ── the live answer decides alone ── */

test("the manager HR names today may act", () => {
  assert.equal(mayActOnManagerStep(ACTOR, assignment()), true);
});

test("HR naming somebody else refuses the manager the submit stamped", () => {
  // The whole point of the change: staff 7001 was the manager when this was
  // filed and is still on both snapshot columns, but HR now says 7002.
  const moved = assignment({ current: { staffId: 7002, email: NEW_MANAGER.email } });
  assert.equal(mayActOnManagerStep(ACTOR, moved), false);
  assert.equal(mayActOnManagerStep(NEW_MANAGER, moved), true);
});

test("the new manager is admitted even though no snapshot column names them", () => {
  const moved: ManagerStepAssignment = {
    current: { staffId: 7002, email: NEW_MANAGER.email },
    snapshotStaffId: 7001,
    approval: { assignedTo: 7001, assignedEmail: "manager@rocksgroup.com", status: "Pending" },
  };
  assert.equal(mayActOnManagerStep(NEW_MANAGER, moved), true);
});

test("an actor with no HR StaffId is matched on the live manager's address", () => {
  // `buildAccActor` answers a null StaffId when HR has no row for the login;
  // they still sign in as somebody, and that somebody may be the manager.
  const noStaffId = { staffId: null, email: "  NEW.Manager@RocksGroup.com " };
  const moved = assignment({ current: { staffId: 7002, email: NEW_MANAGER.email } });
  assert.equal(mayActOnManagerStep(noStaffId, moved), true);
});

test("a live manager with no address on file is matched by StaffId alone", () => {
  const moved = assignment({ current: { staffId: 7002, email: null } });
  assert.equal(mayActOnManagerStep(NEW_MANAGER, moved), true);
  assert.equal(mayActOnManagerStep({ staffId: null, email: NEW_MANAGER.email }, moved), false);
});

test("a stranger is refused whoever the live manager is", () => {
  const stranger = { staffId: 6001, email: "other@rocksgroup.com" };
  assert.equal(mayActOnManagerStep(stranger, assignment()), false);
  assert.equal(
    mayActOnManagerStep(stranger, assignment({ current: { staffId: 7002, email: null } })),
    false,
  );
});

/* ── a null live answer abstains, it does not refuse ── */

test("with no live answer the snapshot still admits its manager", () => {
  const silent = assignment({ current: null });
  assert.equal(mayActOnManagerStep(ACTOR, silent), true);
});

test("with no live answer the approval row's own assignee still counts", () => {
  // The two snapshot columns can disagree on a row written before the submit
  // wrote both; the pre-2026-09-24 rule accepted either, and the fallback has
  // to keep accepting either or it is not a fallback.
  const silent: ManagerStepAssignment = {
    current: null,
    snapshotStaffId: null,
    approval: { assignedTo: 7001, assignedEmail: null, status: "Pending" },
  };
  assert.equal(mayActOnManagerStep(ACTOR, silent), true);
});

test("with no live answer the assigned address still counts, case-folded and trimmed", () => {
  const silent: ManagerStepAssignment = {
    current: null,
    snapshotStaffId: null,
    approval: { assignedTo: null, assignedEmail: "  Manager@RocksGroup.COM ", status: "Pending" },
  };
  assert.equal(mayActOnManagerStep(ACTOR, silent), true);
});

test("undefined is treated as absent, not as a live answer", () => {
  // The three fields are `| null | undefined` because three different callers
  // build them from three different payloads. An `undefined` current must take
  // the fallback branch, not the live one.
  const silent: ManagerStepAssignment = {
    current: undefined,
    snapshotStaffId: 7001,
    approval: undefined,
  };
  assert.equal(mayActOnManagerStep(ACTOR, silent), true);
});

test("nobody at all on record admits nobody", () => {
  const nothing: ManagerStepAssignment = {
    current: null,
    snapshotStaffId: null,
    approval: { assignedTo: null, assignedEmail: null, status: "Pending" },
  };
  assert.equal(mayActOnManagerStep(ACTOR, nothing), false);
  // Three nulls must not compare equal to each other.
  assert.equal(mayActOnManagerStep({ staffId: null, email: null }, nothing), false);
});

/* ── a settled step refuses everybody ── */

test("an approval row that is no longer Pending refuses even the live manager", () => {
  for (const status of ["Approved", "Rejected", "Returned"]) {
    const settled = assignment({
      approval: { assignedTo: 7001, assignedEmail: null, status },
    });
    assert.equal(mayActOnManagerStep(ACTOR, settled), false, status);
  }
});

test("the settled check runs before the dev bypass, so a bypass cannot re-open a signed step", () => {
  const settled = assignment({
    approval: { assignedTo: 7001, assignedEmail: null, status: "Approved" },
  });
  assert.equal(mayActOnManagerStep(ACTOR, settled, { devHostBypass: true }), false);
});

test("the dev bypass admits anybody while the step is still pending", () => {
  const stranger = { staffId: 6001, email: "other@rocksgroup.com" };
  assert.equal(mayActOnManagerStep(stranger, assignment(), { devHostBypass: true }), true);
});

test("a missing approval row is not a settled one", () => {
  // AP-17's routes pass whatever `find(...)` returned, which is null when the
  // request is past the manager step — and also null on a row shape that has
  // simply not been loaded. Treating null as settled would refuse a legitimate
  // approval; the caller gates on the step separately.
  assert.equal(mayActOnManagerStep(ACTOR, assignment({ approval: null })), true);
});

/* ── the helper the display layer shares ── */

test("isAssignedManager needs both sides present", () => {
  assert.equal(isAssignedManager(7001, 7001), true);
  assert.equal(isAssignedManager(7001, 7002), false);
  assert.equal(isAssignedManager(null, 7001), false);
  assert.equal(isAssignedManager(7001, null), false);
  assert.equal(isAssignedManager(null, null), false);
  // StaffId 0 is a present id, not a missing one — the same case
  // `finalStepRefusal` guards with `== null` rather than truthiness.
  assert.equal(isAssignedManager(0, 0), true);
});
