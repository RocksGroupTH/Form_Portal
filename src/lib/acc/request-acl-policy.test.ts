import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideRequestMutate,
  decideRequestRead,
  type AccAclViewer,
  type AccRequestAclRow,
} from "./request-acl-policy";

/* ── Fixtures ── */

/**
 * An ordinary AP-1 claim: user 41 filed it for themself, staff 5001, whose HR
 * manager is staff 7001. Submitted, so past the editable window.
 */
const submitted: AccRequestAclRow = {
  id: 1234,
  formCode: "AP-1",
  status: "Submitted",
  createdBy: 41,
  submittedBy: 41,
  staffId: 5001,
  managerStaffId: 7001,
};

const draft: AccRequestAclRow = { ...submitted, id: 1235, status: "Draft", submittedBy: null };
const returned: AccRequestAclRow = { ...draft, id: 1236, status: "Returned" };

/** The same claim filed on behalf of staff 5001 by user 42 (staff 5002). */
const onBehalf: AccRequestAclRow = { ...submitted, id: 1237, createdBy: 42, submittedBy: 42 };

/** A UAT record — id above the 900000 identity floor migration 061 installed. */
const uatRecord: AccRequestAclRow = { ...submitted, id: 900123 };

function viewer(over: Partial<AccAclViewer> = {}): AccAclViewer {
  return {
    userId: 41,
    email: "owner@rocksgroup.com",
    staffId: 5001,
    role: "Staff",
    isAccountArea: false,
    environment: "Production",
    isActiveUatTester: false,
    ...over,
  };
}

const owner = viewer();
const assignedManager = viewer({ userId: 77, email: "manager@rocksgroup.com", staffId: 7001 });
const accountant = viewer({ userId: 88, email: "acc@rocksgroup.com", staffId: 8001, isAccountArea: true });
const admin = viewer({ userId: 99, email: "it@rocksgroup.com", staffId: null, role: "IT Admin", isAccountArea: true });
const stranger = viewer({ userId: 55, email: "other@rocksgroup.com", staffId: 6001 });
/** A session with no TeamMember id — the degraded token `auth()` issues. */
const noInternalId = viewer({ userId: 0, email: "ghost@rocksgroup.com", staffId: null });

/* ── Read ── */

test("the creator can read their own request", () => {
  assert.equal(decideRequestRead(submitted, owner).ok, true);
});

test("the assigned manager can read it", () => {
  assert.equal(decideRequestRead(submitted, assignedManager).ok, true);
});

test("the accounting area can read it", () => {
  assert.equal(decideRequestRead(submitted, accountant).ok, true);
  assert.equal(decideRequestRead(submitted, admin).ok, true);
});

test("an unrelated member of staff cannot, even knowing the id", () => {
  // The whole finding: these ids are small sequential integers and the old
  // route returned the record to any authenticated session.
  const verdict = decideRequestRead(submitted, stranger);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.status, 403);
});

test("the requester of an on-behalf claim can read it though they did not create it", () => {
  // Their name, department, per-diem and possibly their ID-card scan are on it.
  assert.equal(decideRequestRead(onBehalf, owner).ok, true);
});

test("a session with no internal user id matches nothing by ownership", () => {
  // `userId` 0 is what `Number("")` yields from a degraded token. It must not
  // collide with rows whose CreatedBy is NULL or 0.
  const orphan: AccRequestAclRow = { ...submitted, createdBy: null, submittedBy: null, staffId: null };
  assert.equal(decideRequestRead(orphan, noInternalId).ok, false);
});

/* ── The UAT clause ── */

test("a non-tester accountant cannot read a UAT request, and is not told it exists", () => {
  const verdict = decideRequestRead(uatRecord, { ...accountant, environment: "UAT" });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.status, 404);
});

test("a non-tester manager assigned to a UAT request is refused too", () => {
  // CLAUDE.md used to describe this as allowed. The design spec is the other
  // way round — the whole chain stays inside the tester group — and a UAT
  // manager is required to be an active tester, so nothing legitimate is lost.
  const verdict = decideRequestRead(uatRecord, { ...assignedManager, environment: "UAT" });
  assert.equal(verdict.ok === false && verdict.status, 404);
});

test("an active tester can act on a UAT request whatever their UAT-mode cookie says", () => {
  // Membership, not the cookie: the id already named the database, and a
  // tester following a link with UAT mode off must still reach their own work.
  const tester = { ...assignedManager, environment: "UAT" as const, isActiveUatTester: true };
  assert.equal(decideRequestRead(uatRecord, tester).ok, true);
});

test("being a tester grants nothing extra on a production request", () => {
  const testerOutsider = { ...stranger, isActiveUatTester: true };
  assert.equal(decideRequestRead(submitted, testerOutsider).ok, false);
});

/* ── Mutate ── */

test("the creator may change their own draft, and a returned request", () => {
  assert.equal(decideRequestMutate(draft, owner).ok, true);
  assert.equal(decideRequestMutate(returned, owner).ok, true);
});

test("the creator may not change it once submitted", () => {
  const verdict = decideRequestMutate(submitted, owner);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.status, 403);
});

test("nobody else may change a draft — not the manager, the accountant or an admin", () => {
  for (const v of [assignedManager, accountant, admin, stranger]) {
    assert.equal(decideRequestMutate(draft, v).ok, false);
  }
});

test("the on-behalf requester may read but not edit the draft filed for them", () => {
  const behalfDraft: AccRequestAclRow = { ...onBehalf, status: "Draft" };
  assert.equal(decideRequestRead(behalfDraft, owner).ok, true);
  assert.equal(decideRequestMutate(behalfDraft, owner).ok, false);
});

test("a non-tester cannot mutate a UAT draft either, and gets the same 404", () => {
  const uatDraft: AccRequestAclRow = { ...uatRecord, status: "Draft" };
  const verdict = decideRequestMutate(uatDraft, { ...owner, environment: "UAT" });
  assert.equal(verdict.ok === false && verdict.status, 404);
});
