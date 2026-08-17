import { test } from "node:test";
import assert from "node:assert/strict";
import { isUatMailExempt, type UatMailExemptRecord } from "./uat-mail-exempt";

const testers: UatMailExemptRecord[] = [
  { email: "tester@rocksgroup.com", managerEmail: "manager@rocksgroup.com" },
  { email: "second.tester@rocksgroup.com", managerEmail: null },
];

test("an active tester is exempt from the redirect", () => {
  assert.equal(isUatMailExempt("tester@rocksgroup.com", testers), true);
});

test("a configured UAT manager is exempt from the redirect", () => {
  assert.equal(isUatMailExempt("manager@rocksgroup.com", testers), true);
});

test("matching is case- and whitespace-insensitive, same rule as UatTester's own lookups", () => {
  assert.equal(isUatMailExempt("  Tester@RocksGroup.com ", testers), true);
  assert.equal(isUatMailExempt("MANAGER@rocksgroup.com", testers), true);
});

test("an unrelated recipient is not exempt and keeps the rewrite", () => {
  assert.equal(isUatMailExempt("real.manager@rocksgroup.com", testers), false);
});

test("fails closed: a blank or missing recipient is never exempt", () => {
  assert.equal(isUatMailExempt("", testers), false);
  assert.equal(isUatMailExempt(null, testers), false);
  assert.equal(isUatMailExempt(undefined, testers), false);
});

test("fails closed: an empty tester list exempts nobody", () => {
  assert.equal(isUatMailExempt("tester@rocksgroup.com", []), false);
});

test("a tester with no manager email set does not make a blank recipient exempt", () => {
  assert.equal(
    isUatMailExempt("", [{ email: "x@rocksgroup.com", managerEmail: null }]),
    false,
  );
});
