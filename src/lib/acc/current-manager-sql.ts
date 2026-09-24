/**
 * The SQL half of "who is this requester's manager today" — pure, and
 * deliberately importing nothing that reaches a pool.
 *
 * `current-manager.ts` beside it is the half that asks the database the
 * question one request at a time; this is the half a list query embeds so the
 * database answers it for every row at once. They must agree, and the way
 * they are kept agreeing is written in that file's header.
 *
 * **It is split out so the generated SQL can be asserted without a database.**
 * `@/env` validates the whole environment at import, so anything reachable
 * from a pool drags a live configuration into the test run — the rule this
 * codebase applies to every policy module (`request-acl-policy`,
 * `approval-policy`, `per-form-config`). Asserting the string this builds is
 * not the same as asserting what SQL Server does with it, and nothing here
 * pretends otherwise; it is the layer that catches a dropped arm, a dropped
 * MANAGER pin or an appended `OR`, and the live measurement is the other one.
 *
 * The core database name is read from `process.env` rather than from `@/env`
 * for exactly that reason, with the same default `src/env.ts` declares
 * (`Fast_Core`). Repointing `MSSQL_CORE_DATABASE` moves both, so the two
 * cannot disagree about which `UatTester` answers.
 */
import { hrEmployeeTable } from "@/lib/hr/constants";
import type { FormEnvironmentValue } from "@/lib/form-environment/service";

/**
 * `[Fast_Core].[dbo].[UatTester]`, three-part, for the queries that reach it
 * from a form pool.
 *
 * Reading Fast_Core from a form pool is safe here and is **not** the loop
 * CLAUDE.md warns about: that rule is about `getFormPool()`'s own resolution
 * path, and these are list queries running long after a pool has been chosen.
 */
function coreUatTesterTable(): string {
  return `[${process.env.MSSQL_CORE_DATABASE || "Fast_Core"}].[dbo].[UatTester]`;
}
/**
 * Which alias inside the join above holds the manager's **HR** row.
 *
 * Production joins HR to HR, so it is the manager's own employee row; UAT joins
 * `UatTester` to `UatTester` and then to HR for the liveness check, so the HR
 * row is the third table. Anything selecting a manager's name or address has to
 * read the HR row — `UatTester` carries a denormalised `ManagerEmail` that
 * nothing keeps in step with HR, and a stale address on a "waiting for" line is
 * how somebody emails the wrong person.
 */
function managerHrAlias(environment: FormEnvironmentValue): string {
  return environment === "UAT" ? "live_mgr_hr" : "live_m";
}

/**
 * One builder with an optional extra condition, so the predicates below
 * cannot drift apart from each other, and none can drift from
 * `resolveCurrentManager` without this comment being wrong.
 *
 * Each arm reproduces its environment's rule **in full**, which is what makes
 * the list agree with the button:
 *
 *  - Production: the requester has an active HR row, that row names a
 *    `ManagerStaffId`, and that person is an active employee too. The second
 *    join is not decoration — it is the SQL spelling of `resolveManagerEmail`
 *    returning null for somebody who has left, which is what makes the live
 *    answer abstain there.
 *  - UAT: `uatManagerStaffIdsFor`'s self join (requester is an active tester
 *    with a manager, and the manager is an active tester), **plus** the HR
 *    liveness check `uatManagerFor` adds through `loadHrIdentity`. A list query
 *    cannot call either function row by row, so the rule is spelled out here;
 *    it is the one place in this module that restates rather than reuses, and
 *    `current-manager-guard.test.ts` is what holds the two equal.
 *
 * `alias` names the `AccRequest` alias in the caller's query. Every value is
 * either a bound parameter or a database name from the environment — nothing
 * off the wire reaches the statement.
 */
function currentManagerFromWhere(
  environment: FormEnvironmentValue,
  alias: string,
  extraCondition: string,
): string {
  if (environment === "UAT") {
    return `FROM ${coreUatTesterTable()} live_t
      INNER JOIN ${coreUatTesterTable()} live_m
        ON live_m.StaffId = live_t.ManagerStaffId AND live_m.IsActive = 1
      INNER JOIN ${hrEmployeeTable()} live_mgr_hr
        ON live_mgr_hr.StaffId = live_m.StaffId AND live_mgr_hr.Status = N'Active'
      WHERE live_t.StaffId = ${alias}.StaffId
        AND live_t.IsActive = 1
        AND live_t.ManagerStaffId IS NOT NULL${extraCondition}`;
  }
  return `FROM ${hrEmployeeTable()} live_e
      INNER JOIN ${hrEmployeeTable()} live_m
        ON live_m.StaffId = live_e.ManagerStaffId AND live_m.Status = N'Active'
      WHERE live_e.StaffId = ${alias}.StaffId
        AND live_e.Status = N'Active'${extraCondition}`;
}

/**
 * True of a request whose requester reports to `staffIdParam` **today**.
 *
 * A `NULL` parameter matches nothing, which is the right answer for a viewer
 * with no HR identity — they manage nobody.
 */
export function currentManagerIsPredicate(
  environment: FormEnvironmentValue,
  alias = "r",
  staffIdParam = "@staffId",
): string {
  return `EXISTS (
    SELECT 1 ${currentManagerFromWhere(
      environment,
      alias,
      `\n        AND live_m.StaffId = ${staffIdParam}`,
    )}
  )`;
}

/**
 * True of a request whose requester has *any* usable manager on record today —
 * the SQL spelling of `resolveCurrentManager` answering non-null.
 *
 * It exists so a list can reproduce the fallback the pure rule applies: where
 * this is **false**, `mayActOnManagerStep` admits the submit-time snapshot, so
 * the request must stay in the snapshot manager's inbox or the list and the
 * button disagree — the one failure this whole change must not introduce.
 */
export function hasCurrentManagerPredicate(
  environment: FormEnvironmentValue,
  alias = "r",
): string {
  return `EXISTS (
    SELECT 1 ${currentManagerFromWhere(environment, alias, "")}
  )`;
}

/**
 * The current manager's StaffId as a scalar, for a read that wants the answer
 * itself rather than a filter — `NULL` where `resolveCurrentManager` would
 * answer null.
 *
 * It exists so the object ACL can decide in **one** query. That guard runs on
 * every request-scoped route in the application, and resolving the manager in
 * TypeScript there would put a second round trip on the hottest path in the
 * app to answer a question the database it is already querying can answer in
 * the same statement.
 *
 * `TOP 1` is belt and braces: `Employee.StaffId` is the requester's key and
 * `UatTester` is unique on it, so at most one row can match either way — but a
 * scalar subquery that returned two would fail the whole statement rather than
 * degrade, and this one sits inside an authorization check.
 */
export function currentManagerStaffIdSql(
  environment: FormEnvironmentValue,
  alias = "r",
): string {
  return `(
    SELECT TOP 1 live_m.StaffId ${currentManagerFromWhere(environment, alias, "")}
  )`;
}

/**
 * The current manager's display name, or `NULL` — for the "รออนุมัติโดย" line
 * the requester reads.
 *
 * That line used to be the HR name behind `AccApproval.AssignedTo`, which is the
 * submit-time snapshot: once the manager step follows HR, naming the assignee
 * tells a requester their claim is waiting on somebody who can no longer act on
 * it. The projection matches the one `getRequest` and `REQUEST_ROW_SELECT`
 * already use for an approver's name, so the two cannot render the same person
 * differently.
 */
export function currentManagerNameSql(
  environment: FormEnvironmentValue,
  alias = "r",
): string {
  const m = managerHrAlias(environment);
  return `(
    SELECT TOP 1 COALESCE(
      NULLIF(LTRIM(RTRIM(CONCAT(${m}.FirstName, N' ', ${m}.LastName))), N''),
      ${m}.FullName
    ) ${currentManagerFromWhere(environment, alias, "")}
  )`;
}

/** The current manager's address, same `COALESCE(Email, EmailCompBr)` every other reader uses. */
export function currentManagerEmailSql(
  environment: FormEnvironmentValue,
  alias = "r",
): string {
  const m = managerHrAlias(environment);
  return `(
    SELECT TOP 1 COALESCE(${m}.Email, ${m}.EmailCompBr) ${currentManagerFromWhere(
      environment,
      alias,
      "",
    )}
  )`;
}
