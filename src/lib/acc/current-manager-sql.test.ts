import { test } from "node:test";
import assert from "node:assert/strict";
import {
  currentManagerEmailSql,
  currentManagerIsPredicate,
  currentManagerNameSql,
  currentManagerStaffIdSql,
  hasCurrentManagerPredicate,
} from "./current-manager-sql";

/**
 * The SQL spelling of "who is this requester's manager today".
 *
 * Five builders, one shared core, and the thing that must stay true of all of
 * them is that they answer the **same question** — a list that admits somebody
 * the button then refuses, or a "รออนุมัติโดย" line naming a third person, is
 * worse than not having resolved anything live at all.
 *
 * This asserts the generated string. It cannot assert what SQL Server does with
 * it: both predicates were run against `Rocks_Portal_Form` and
 * `Rocks_Portal_Form_UAT` when this landed, and the drift they found (80 of 174
 * UAT requests whose live manager differs from the stamped one) is the measured
 * half of the evidence. This is the half that catches an edit.
 */

const ENVIRONMENTS = ["Production", "UAT"] as const;

const HR = "[Rocks_Portal_HR].[dbo].[Employee]";
const TESTER = "[dbo].[UatTester]";

/* ── each environment reads its own source ── */

test("production resolves the manager from HR, and never from UatTester", () => {
  const sql = currentManagerIsPredicate("Production", "r", "@staffId");
  assert.ok(sql.includes(HR));
  assert.equal(sql.includes("UatTester"), false);
});

test("UAT resolves it from UatTester, and still proves the manager is a live employee", () => {
  const sql = currentManagerIsPredicate("UAT", "r", "@staffId");
  assert.ok(sql.includes(TESTER), "the UAT arm no longer reads UatTester");
  // `uatManagerFor` resolves the manager through `loadHrIdentity`, so a tester
  // whose manager has left HR has no usable manager. Dropping this join would
  // make the list admit somebody the service's own resolver refuses.
  assert.ok(sql.includes(HR), "the UAT arm no longer checks the manager's HR liveness");
});

/* ── the rule each one enforces ── */

test("both environments require the REQUESTER to be active, not merely present", () => {
  assert.ok(currentManagerIsPredicate("Production").includes("live_e.Status = N'Active'"));
  assert.ok(currentManagerIsPredicate("UAT").includes("live_t.IsActive = 1"));
});

test("both environments require the MANAGER to be active too", () => {
  // Production: the second HR join is the SQL spelling of `resolveManagerEmail`
  // answering null for somebody who has left — the thing that makes the live
  // answer abstain rather than lock the request to a departed person.
  assert.ok(
    currentManagerIsPredicate("Production").includes("live_m.Status = N'Active'"),
    "production no longer checks the manager is an active employee",
  );
  assert.ok(
    currentManagerIsPredicate("UAT").includes("live_m.IsActive = 1"),
    "UAT no longer checks the manager is an active tester",
  );
});

test("UAT refuses a tester with no manager set rather than joining on NULL", () => {
  assert.ok(currentManagerIsPredicate("UAT").includes("live_t.ManagerStaffId IS NOT NULL"));
});

/* ── the two predicates differ by exactly one condition ── */

test("hasCurrentManagerPredicate is currentManagerIsPredicate minus the viewer", () => {
  // The fallback arm of My Work asks "does this requester have ANY manager
  // today", and it must be the same question as "is it me" with the viewer
  // dropped — otherwise the list can fall back where the rule does not, or
  // refuse to fall back where it does.
  for (const environment of ENVIRONMENTS) {
    const is = currentManagerIsPredicate(environment, "r", "@staffId");
    const has = hasCurrentManagerPredicate(environment, "r");
    assert.equal(
      is.replace(/\s*AND live_m\.StaffId = @staffId/, ""),
      has,
      `${environment}: the two predicates have drifted apart`,
    );
  }
});

test("the viewer reaches the predicate as a bound parameter, never interpolated", () => {
  for (const environment of ENVIRONMENTS) {
    assert.ok(currentManagerIsPredicate(environment, "r", "@staffId").includes("@staffId"));
    assert.equal(hasCurrentManagerPredicate(environment, "r").includes("@staffId"), false);
  }
});

/* ── the scalar reads agree with the predicates ── */

test("every builder correlates on the SAME requester column", () => {
  for (const environment of ENVIRONMENTS) {
    const requester = environment === "UAT" ? "live_t.StaffId = r.StaffId" : "live_e.StaffId = r.StaffId";
    for (const sql of [
      currentManagerIsPredicate(environment, "r"),
      hasCurrentManagerPredicate(environment, "r"),
      currentManagerStaffIdSql(environment, "r"),
      currentManagerNameSql(environment, "r"),
      currentManagerEmailSql(environment, "r"),
    ]) {
      assert.ok(sql.includes(requester), `${environment}: a builder no longer keys on ${requester}`);
    }
  }
});

test("the alias is honoured, so a caller with its own AccRequest alias is not silently ignored", () => {
  const sql = currentManagerStaffIdSql("Production", "req");
  assert.ok(sql.includes("live_e.StaffId = req.StaffId"));
  assert.equal(sql.includes("= r.StaffId"), false);
});

test("the staff-id read returns the MANAGER's id, not the requester's", () => {
  // Reading `live_e.StaffId` here would hand the ACL the requester's own id and
  // make every requester their own manager — silently, on an authorization path.
  for (const environment of ENVIRONMENTS) {
    assert.ok(
      currentManagerStaffIdSql(environment, "r").includes("SELECT TOP 1 live_m.StaffId"),
      `${environment}: the scalar read no longer selects the manager's StaffId`,
    );
  }
});

test("name and address come from the manager's HR row in BOTH environments", () => {
  // UAT carries a denormalised `UatTester.ManagerEmail` that nothing keeps in
  // step with HR; reading it would put a stale address on a "waiting for" line.
  assert.ok(currentManagerEmailSql("UAT").includes("live_mgr_hr.Email"));
  assert.ok(currentManagerNameSql("UAT").includes("live_mgr_hr.FullName"));
  assert.equal(currentManagerEmailSql("UAT").includes("live_m.ManagerEmail"), false);

  assert.ok(currentManagerEmailSql("Production").includes("live_m.Email"));
  assert.ok(currentManagerNameSql("Production").includes("live_m.FullName"));
});

test("the name projection matches the one every other approver name uses", () => {
  // `getRequest` and `requestRowSelect` both render an approver as
  // first+last falling back to FullName. A different shape here would render
  // the same person differently depending on which surface asked.
  for (const environment of ENVIRONMENTS) {
    const sql = currentManagerNameSql(environment);
    assert.ok(/NULLIF\(LTRIM\(RTRIM\(CONCAT\(/.test(sql));
    assert.ok(sql.includes(".FullName"));
  }
});

/* ── shape ── */

test("the predicates are EXISTS and the reads are scalar subqueries", () => {
  for (const environment of ENVIRONMENTS) {
    assert.ok(currentManagerIsPredicate(environment).trimStart().startsWith("EXISTS ("));
    assert.ok(hasCurrentManagerPredicate(environment).trimStart().startsWith("EXISTS ("));
    for (const read of [currentManagerStaffIdSql, currentManagerNameSql, currentManagerEmailSql]) {
      const sql = read(environment, "r");
      assert.ok(sql.trimStart().startsWith("("), `${environment}: a scalar read is not parenthesised`);
      assert.ok(sql.includes("SELECT TOP 1 "), `${environment}: a scalar read could return two rows`);
    }
  }
});
