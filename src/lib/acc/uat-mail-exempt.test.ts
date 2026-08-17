import { test } from "node:test";
import assert from "node:assert/strict";
import { isUatMailExempt, type UatMailExemptRecord } from "./uat-mail-exempt";

/**
 * What a drain cycle actually passes in: the *active* rows of `UatTester`.
 * `manager@` is here because a UAT manager must themself be an active tester —
 * `/api/settings/uat-users` refuses to store a manager who is not one.
 */
const activeTesters: UatMailExemptRecord[] = [
  { email: "tester@rocksgroup.com" },
  { email: "manager@rocksgroup.com" },
  { email: "second.tester@rocksgroup.com" },
];

test("an active tester is exempt from the redirect", () => {
  assert.equal(isUatMailExempt("tester@rocksgroup.com", activeTesters), true);
});

test("a configured UAT manager is exempt — they hold an active tester row of their own", () => {
  assert.equal(isUatMailExempt("manager@rocksgroup.com", activeTesters), true);
});

test("a UAT manager who has been deactivated is no longer exempt", () => {
  // The dependants' stored ManagerEmail still names them, but their own
  // UatTester row is gone from the active set — so the mail is redirected.
  const afterDeactivation = activeTesters.filter(
    (t) => t.email !== "manager@rocksgroup.com",
  );
  assert.equal(isUatMailExempt("manager@rocksgroup.com", afterDeactivation), false);
});

test("matching is case- and whitespace-insensitive, same rule as UatTester's own lookups", () => {
  assert.equal(isUatMailExempt("  Tester@RocksGroup.com ", activeTesters), true);
  assert.equal(isUatMailExempt("MANAGER@rocksgroup.com", activeTesters), true);
});

test("an unrelated recipient is not exempt and keeps the rewrite", () => {
  assert.equal(isUatMailExempt("real.manager@rocksgroup.com", activeTesters), false);
});

test("fails closed: a blank or missing recipient is never exempt", () => {
  assert.equal(isUatMailExempt("", activeTesters), false);
  assert.equal(isUatMailExempt(null, activeTesters), false);
  assert.equal(isUatMailExempt(undefined, activeTesters), false);
});

test("fails closed: an empty tester list exempts nobody", () => {
  assert.equal(isUatMailExempt("tester@rocksgroup.com", []), false);
});

test("fails closed: a blank stored tester email does not exempt a blank recipient", () => {
  assert.equal(isUatMailExempt("", [{ email: "" }]), false);
  assert.equal(isUatMailExempt("   ", [{ email: "   " }]), false);
});

/* ── HR spelling: the address the queue actually carries ── */

/**
 * The realistic shape a drain cycle now passes in. `hrEmail` is HR's
 * `COALESCE(Email, EmailCompBr)` for the same StaffId — the address
 * `resolveManagerEmail`, `AccRequest.RequesterEmail` and `loadHrIdentity` all
 * produce. `somchai@` signs in as one address and is in HR under another.
 */
const testersWithHrAddresses: UatMailExemptRecord[] = [
  { email: "somchai.j@rocksgroup.com", hrEmail: "somchai@rocks.co.th" },
  { email: "manager@rocksgroup.com", hrEmail: "manager@rocksgroup.com" },
  { email: "no.hr.row@rocksgroup.com", hrEmail: null },
];

test("a tester is exempt at their HR address, not only their login address", () => {
  // The whole point: the queue holds somchai@rocks.co.th, UatTester holds
  // somchai.j@rocksgroup.com. Before this, their [UAT] mail went to the
  // redirect and their UAT request sat at MANAGER.
  assert.equal(isUatMailExempt("somchai@rocks.co.th", testersWithHrAddresses), true);
  assert.equal(isUatMailExempt("somchai.j@rocksgroup.com", testersWithHrAddresses), true);
});

test("the HR spelling matches case- and whitespace-insensitively too", () => {
  assert.equal(isUatMailExempt(" Somchai@Rocks.CO.TH ", testersWithHrAddresses), true);
});

test("a tester with no active HR row is still exempt at their login address", () => {
  assert.equal(isUatMailExempt("no.hr.row@rocksgroup.com", testersWithHrAddresses), true);
});

test("fails closed: a blank or absent hrEmail exempts nothing", () => {
  assert.equal(isUatMailExempt("", [{ email: "a@x.com", hrEmail: "" }]), false);
  assert.equal(isUatMailExempt("   ", [{ email: "a@x.com", hrEmail: "   " }]), false);
  assert.equal(isUatMailExempt("b@x.com", [{ email: "a@x.com", hrEmail: null }]), false);
  assert.equal(isUatMailExempt("b@x.com", [{ email: "a@x.com" }]), false);
});

test("an HR address belonging to nobody on the list is still redirected", () => {
  // A real manager's HR address must never match — that is the outcome the
  // redirect exists to prevent.
  assert.equal(
    isUatMailExempt("real.manager@rocks.co.th", testersWithHrAddresses),
    false,
  );
});
