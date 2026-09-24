/**
 * The WHERE that decides whose approval inbox a request lands in.
 *
 * Pure and pool-free on purpose, so the SQL it builds can be asserted without
 * a database (`my-work-manager-sql.test.ts`) — `@/env` validates the whole
 * environment at import, and `report-service.ts`, where this used to live,
 * reaches a pool. Asserting a generated string is not asserting what SQL
 * Server does with it; it is the layer that catches a dropped arm, a dropped
 * MANAGER pin or an appended `OR`, and running it against both live databases
 * is the other one.
 */
import {
  currentManagerIsPredicate,
  hasCurrentManagerPredicate,
} from "@/lib/acc/current-manager-sql";
import type { FormEnvironmentValue } from "@/lib/form-environment/service";
/**
 * Both tables that can hold a MANAGER approval, because AP-3 writes its own and
 * spells its assignee column differently.
 *
 * AP-1, AP-4 and AP-17 share `[dbo].[AccApproval]`; AP-3 has
 * `[dbo].[AccClearAdvanceApproval]` (its `CK_AccClearAdvanceApproval_Step`
 * permits MANAGER/ACCOUNT/HEAD). **AP-2 is in neither, and that follows rather
 * than being an oversight**: its chain is HEAD_ACC / DIRECTOR / ACC_OFFICER off
 * an amount matrix, with its own `HEAD_DEPT` retired, so a form with no manager
 * step has nothing a manager's inbox can hold.
 *
 * Kept as data rather than as two copies of each predicate below: the three
 * arms have to mean the same thing on both tables, and the way that stops being
 * true is somebody editing one copy of six.
 */
const MY_WORK_MANAGER_TABLES = [
  { table: "[dbo].[AccApproval]", alias: "a", assigned: "AssignedTo" },
  { table: "[dbo].[AccClearAdvanceApproval]", alias: "ca", assigned: "AssignedStaffId" },
] as const;

type ManagerTable = (typeof MY_WORK_MANAGER_TABLES)[number];

/** `EXISTS` over one table's MANAGER row for this request, plus whatever the arm adds. */
function managerRowExists(t: ManagerTable, extra: string): string {
  return `EXISTS (
            SELECT 1 FROM ${t.table} ${t.alias}
            WHERE ${t.alias}.RequestId = r.Id
              AND ${t.alias}.StepCode = N'MANAGER'${extra}
          )`;
}

/** The step was addressed to this viewer — by StaffId, or by the address it was sent to. */
function addressedToViewer(t: ManagerTable): string {
  return `(
                (@staffId IS NOT NULL AND ${t.alias}.${t.assigned} = @staffId)
                OR (
                  @email <> N''
                  AND LOWER(LTRIM(RTRIM(COALESCE(${t.alias}.AssignedEmail, N''))))
                    = LOWER(LTRIM(RTRIM(@email)))
                )
              )`;
}

function eachTable(build: (t: ManagerTable) => string): string {
  return MY_WORK_MANAGER_TABLES.map(build).join("\n          OR ");
}

/**
 * Requests this viewer is the manager of — their approval inbox, and nothing
 * else (the user's decision, 2026-09-24; each accounting roster has its own
 * queue page, which is the authority on that work anyway:
 *   AP-1  /request/accounting            -> คิวอนุมัติ
 *   AP-4  /request/reimburse/approvals
 *   AP-2  /request/advance               -> คิวอนุมัติ
 *   AP-3  /request/clear-advance         -> คิวอนุมัติ).
 *
 * **Since 2026-09-24 the manager is resolved LIVE.** This list used to match
 * the `AccApproval` assignee alone, which is the snapshot the submit wrote — so
 * a request stayed in the inbox of whoever managed the requester on the day it
 * was filed, for ever, including after that person moved or left, and never
 * appeared for whoever manages them now. The approve/reject/return routes had
 * the same rule, so the list and the button agreed and were wrong together.
 * Both now ask HR (`Fast_Core.UatTester`, in UAT) instead.
 *
 * **The three arms are not alternatives.** Each covers a case the others do
 * not, and dropping any one either hides a request from somebody who must act
 * on it or takes a finished one out of the history of the person who did:
 *
 *  1. **Live** — the requester reports to me *today* and the request has a
 *     manager step. This is the arm that moves a request when HR does.
 *  2. **History** — I actually actioned the manager step. Mine for ever, in the
 *     อนุมัติแล้ว / ไม่อนุมัติ / ส่งกลับแก้ไข tab, whatever HR says afterwards.
 *     `ActionedByStaffId` is the precise test; the addressed-to test beside it
 *     is for rows settled before that column was reliably written.
 *  3. **Fallback** — HR has nothing usable to say about this requester, so
 *     `mayActOnManagerStep` admits the submit-time snapshot. The list has to
 *     admit it too, or the inbox and the button disagree — the one failure this
 *     whole change must not introduce. `hasCurrentManagerPredicate` is the SQL
 *     spelling of `resolveCurrentManager` answering null, so the two conditions
 *     are the same condition.
 *
 * **History is kept, which is what makes arm 1 safe to narrow with.** A claim
 * stays visible after its manager acts and moves between tabs through
 * `getMyWorkStatusBucket` rather than vanishing — the second half of the same
 * 2026-09-24 instruction: once the manager has acted it must leave รออนุมัติ.
 */
/**
 * The WHERE deciding whose inbox a request lands in, and the extra SELECT
 * columns that go with it.
 *
 * Built by a named function rather than inline in the closure below so it can
 * be asserted without a database (`my-work-manager-where.test.ts`) and printed
 * against a real one. These three arms are an authorization rule expressed in
 * SQL; a rule nobody can read back is a rule nobody can check, and this file
 * has already learned once — see `queue-service-guard.test.ts`'s docblock —
 * that a regex over SQL text cannot verify SQL semantics.
 *
 * `environment` is a parameter because who a requester's manager is comes from
 * HR in production and from `Fast_Core.UatTester` in UAT.
 */
export function buildMyWorkManagerQuery(environment: FormEnvironmentValue): {
  where: string;
  select: string;
} {
  const isCurrentManager = currentManagerIsPredicate(environment, "r", "@staffId");
  const hasAnyCurrentManager = hasCurrentManagerPredicate(environment, "r");

  const select = `,
  (SELECT TOP 1 CASE WHEN a.Status = N'Approved' THEN 1 ELSE 0 END
   FROM [dbo].[AccApproval] a
   WHERE a.RequestId = r.Id AND a.StepCode = N'MANAGER'
     AND (
       (@staffId IS NOT NULL AND a.AssignedTo = @staffId)
       OR (
         @email <> N''
         AND LOWER(LTRIM(RTRIM(COALESCE(a.AssignedEmail, N''))))
           = LOWER(LTRIM(RTRIM(@email)))
       )
     )
  ) AS ViewerManagerApproved,
  CASE WHEN ${isCurrentManager} THEN 1 ELSE 0 END AS ViewerIsCurrentManager`;

  const where = `r.Status <> 'Draft' AND (
          /* 1. HR says I manage this requester today, and the request has a
                manager step to be managed. */
          (
            (
          ${eachTable((t) => managerRowExists(t, ""))}
            )
            AND ${isCurrentManager}
          )
          /* 2. I actioned the manager step myself — mine for ever. */
          OR (
          ${eachTable((t) =>
            managerRowExists(
              t,
              `
              AND ${t.alias}.Status <> N'Pending'
              AND (
                (@staffId IS NOT NULL AND ${t.alias}.ActionedByStaffId = @staffId)
                OR ${addressedToViewer(t)}
              )`,
            ),
          )}
          )
          /* 3. HR has nothing usable to say, so the snapshot still governs —
                and mayActOnManagerStep still admits it. */
          OR (
            NOT ${hasAnyCurrentManager}
            AND (
          ${eachTable((t) => managerRowExists(t, `\n              AND ${addressedToViewer(t)}`))}
            )
          )
        )`;

  return { where, select };
}
