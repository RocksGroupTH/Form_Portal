import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAccessGridRows,
  countActiveApprovers,
  type AccessRosterRow,
} from "./access-grid-rows";
import { advClrApproverColumnsForForm } from "./approver-columns";
import type { ApproverRosterRow } from "./approver-roster";

const AP2 = advClrApproverColumnsForForm("AP-2");
const AP3 = advClrApproverColumnsForForm("AP-3");

function access(over: Partial<AccessRosterRow> = {}): AccessRosterRow {
  return {
    id: 1,
    staffId: 100,
    email: "anna@rocksgroup.com",
    displayName: "Anna",
    isActive: true,
    settingsTabs: [],
    ...over,
  };
}

function approver(over: Partial<ApproverRosterRow> = {}): ApproverRosterRow {
  return {
    id: 1,
    role: "HEAD_ACC",
    email: "anna@rocksgroup.com",
    displayName: "Anna",
    staffId: 100,
    isActive: true,
    photoUrl: null,
    ...over,
  };
}

/* ── the requirement AP-4 had to be fixed out of twice ── */

test("an approver with NO access row still appears", () => {
  const rows = buildAccessGridRows(
    [],
    [approver({ email: "bob@rocksgroup.com", displayName: "Bob" })],
    AP2,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].access, null);
  assert.equal(rows[0].email, "bob@rocksgroup.com");
});

test("an INACTIVE approver with no access row still appears", () => {
  // This is the half that reintroduced the dead end on AP-4: deactivating is
  // exactly what drops a row out of an active-only union, so the row vanished
  // under the click that deactivated it and could not be switched back.
  const rows = buildAccessGridRows(
    [],
    [approver({ email: "bob@rocksgroup.com", displayName: "Bob", isActive: false })],
    AP2,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].approverByRole.HEAD_ACC.isActive, false);
});

test("an INACTIVE access row still appears too", () => {
  const rows = buildAccessGridRows([access({ isActive: false })], [], AP2);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].access?.isActive, false);
});

/* ── joining the two rosters ── */

test("the two rosters are joined on the email, case-insensitively", () => {
  // AccAdvanceApprover.StaffId is nullable, so the join cannot be on it; Email
  // is NOT NULL on all three tables and is what the resolvers already match on.
  const rows = buildAccessGridRows(
    [access({ email: "Anna@RocksGroup.com" })],
    [approver({ email: "anna@rocksgroup.COM", role: "ACC_OFFICER" })],
    AP2,
  );
  assert.equal(rows.length, 1, "the same person was listed twice");
  assert.ok(rows[0].access);
  assert.ok(rows[0].approverByRole.ACC_OFFICER);
});

test("one person can hold several AP-2 levels on one row", () => {
  const rows = buildAccessGridRows(
    [access()],
    [
      approver({ id: 1, role: "HEAD_ACC" }),
      approver({ id: 2, role: "ACC_OFFICER" }),
    ],
    AP2,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].approverByRole.HEAD_ACC.id, 1);
  assert.equal(rows[0].approverByRole.ACC_OFFICER.id, 2);
  assert.equal(rows[0].approverByRole.DIRECTOR, undefined);
});

test("an approver row carries its StaffId onto a row that had none", () => {
  const rows = buildAccessGridRows(
    [],
    [approver({ staffId: null }), approver({ id: 2, role: "DIRECTOR", staffId: 77 })],
    AP2,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].staffId, 77);
});

/* ── roles this form does not render ── */

test("a role the grid has no column for adds no row", () => {
  // AP-3's retired HEAD rows are read by nothing, so somebody holding only one
  // would otherwise be listed with every box empty and nothing explaining why.
  const rows = buildAccessGridRows(
    [],
    [approver({ email: "old@rocksgroup.com", role: "HEAD" })],
    AP3,
  );
  assert.deepEqual(rows, []);
});

test("but it never DROPS somebody who is on the access roster", () => {
  const rows = buildAccessGridRows(
    [access({ email: "old@rocksgroup.com" })],
    [approver({ email: "old@rocksgroup.com", role: "HEAD" })],
    AP3,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].approverByRole.HEAD, undefined);
});

/* ── duplicates and junk ── */

test("a duplicate (email, role) keeps the first and never ORs the flags", () => {
  // Both tables are unique on (Email, Role), so a second sighting is a
  // duplicate rather than a second grant — ORing would report a retired row as
  // live, on a column that grants authority over money.
  const rows = buildAccessGridRows(
    [],
    [
      approver({ id: 1, isActive: false }),
      approver({ id: 2, isActive: true }),
    ],
    AP2,
  );
  assert.equal(rows[0].approverByRole.HEAD_ACC.id, 1);
  assert.equal(rows[0].approverByRole.HEAD_ACC.isActive, false);
});

test("a blank email on either side is skipped rather than collapsing rows", () => {
  const rows = buildAccessGridRows(
    [access({ email: "   " }), access({ id: 2, staffId: 2, email: "a@b.com" })],
    [approver({ email: "" })],
    AP2,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, "a@b.com");
});

test("a duplicate access row does not produce a second line", () => {
  const rows = buildAccessGridRows([access(), access({ id: 2 })], [], AP2);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].access?.id, 1);
});

test("a row with no display name falls back to the email, never to blank", () => {
  const rows = buildAccessGridRows([], [approver({ displayName: null })], AP2);
  assert.equal(rows[0].displayName, "anna@rocksgroup.com");
});

/* ── the count behind the commissioning banner ── */

test("the approver count is PEOPLE, not rows", () => {
  const rows = buildAccessGridRows(
    [],
    [approver({ id: 1, role: "HEAD_ACC" }), approver({ id: 2, role: "ACC_OFFICER" })],
    AP2,
  );
  assert.equal(countActiveApprovers(rows, AP2), 1);
});

test("an inactive approver counts for nothing", () => {
  const rows = buildAccessGridRows(
    [],
    [
      approver({ id: 1, isActive: false }),
      approver({ id: 2, email: "b@b.com", displayName: "Bee", isActive: true }),
    ],
    AP2,
  );
  assert.equal(countActiveApprovers(rows, AP2), 1);
});

test("somebody on the access roster alone is not an approver", () => {
  const rows = buildAccessGridRows([access()], [], AP2);
  assert.equal(countActiveApprovers(rows, AP2), 0);
});
