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
