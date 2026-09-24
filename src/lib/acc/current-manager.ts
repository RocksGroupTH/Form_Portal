/**
 * Who the requester's manager is **right now** — the live answer, not the one
 * stamped onto the request when it was submitted.
 *
 * ## Why this module exists
 *
 * Until 2026-09-24 the manager step was decided entirely by a snapshot.
 * `submitRequest` (and its four siblings) read HR once, wrote the answer to
 * `AccRequest.ManagerStaffId` / `ManagerEmail`, and wrote it a second time onto
 * the `MANAGER` approval row as `AssignedTo` / `AssignedEmail`. Nothing read HR
 * again. So a request filed on Monday was still addressed to Monday's manager
 * for the rest of its life: change somebody's `ManagerStaffId` in HR, or let
 * the manager leave, and every request already in flight became actionable by
 * **nobody at all** — AP-1, AP-2, AP-3 and AP-4 have no admin arm on that step,
 * and the one person the predicate admitted was gone. The only way out was to
 * have the old manager return the request so its owner could resubmit it, which
 * is circular when the reason it is stuck is that the old manager cannot act.
 *
 * The user's decision (2026-09-24): resolve the manager live, and **the current
 * manager is the only one who may act** — the previous manager loses the
 * pending action the moment HR names somebody else. They keep read access,
 * because they are in the document's history and an approval trail nobody can
 * open is not a trail.
 *
 * ## The fallback, and why it is not a second opinion
 *
 * `resolveCurrentManager` answers `null` when HR (or `UatTester`, in UAT) has
 * nothing usable to say: no active employee row for the requester, no
 * `ManagerStaffId` on it, or a `ManagerStaffId` naming somebody who is not an
 * active employee any more. A `null` means *unknown*, and every caller then
 * falls back to the snapshot — today's behaviour, unchanged.
 *
 * That asymmetry is the whole safety argument. "HR says somebody else" narrows
 * who may act; "HR says nothing" must never narrow it to nobody, because the
 * commonest cause of a blank `ManagerStaffId` is missing data rather than a
 * deliberate decision, and a request no human being can approve is a worse
 * outcome than one a departed manager can. `null` therefore never overrides —
 * it abstains.
 *
 * ## Two directions, deliberately
 *
 * Authorization asks *"given this request, who is its manager?"* — one lookup
 * per action, which is what `resolveCurrentManager` answers. A list asks the
 * inverse, *"which requests are mine to approve?"*, which cannot be answered
 * one request at a time: the predicates in `./current-manager-sql` are that
 * half, SQL fragments the caller joins into its own WHERE so the database does
 * the work. The two must agree, or a manager sees a request in their inbox
 * that refuses them when they press the button — which is why that module is
 * re-exported from here rather than imported separately, and why its own
 * header restates each environment's rule beside the code that reuses it.
 *
 * ## Environment
 *
 * In UAT the manager is not HR's at all: it is `UatTester.ManagerStaffId`, and
 * the manager must themselves be an active tester (see `uatManagerFor`, whose
 * rule this module reuses rather than restates). Both spellings of "which
 * environment" documented in `travel-booking/perdiem-uat-gate.ts` appear here,
 * for the reason given there: a caller holding a record id uses the id
 * (`resolveCurrentManagerForRequest`), and a caller holding a pool passes the
 * environment it is querying. Neither reads the UAT-mode cookie, which
 * describes the viewer rather than the record.
 */
import { findActiveEmployeeByStaffId } from "@/lib/hr/employee-lookup";
import { resolveManagerEmail } from "@/lib/acc/employee-context";
import { uatManagerFor, type UatManager } from "@/lib/uat-tester/service";
import { isUatId } from "@/lib/form-environment/uat-identity";
import type { FormEnvironmentValue } from "@/lib/form-environment/service";

/**
 * The manager a request is addressed to today.
 *
 * Same shape as `UatManager` on purpose: the two environments answer the same
 * question from different tables, and a caller must not have to know which.
 */
export type CurrentManager = UatManager;
/**
 * The requester's manager as of now, or `null` when nothing usable is on record.
 *
 * `null` is an abstention, never a refusal — see the module header.
 */
export async function resolveCurrentManager(
  requesterStaffId: number | null | undefined,
  requesterEmail: string | null | undefined,
  environment: FormEnvironmentValue,
): Promise<CurrentManager | null> {
  if (environment === "UAT") {
    // The whole UAT rule — requester is an active tester, has a manager, that
    // manager is an active tester too, and resolves to a live HR identity —
    // lives in `uatManagerFor`. Restating any part of it here would be a second
    // copy of a membership rule, which is how the two come to disagree.
    return await uatManagerFor(requesterEmail ?? null, requesterStaffId ?? null);
  }

  if (!requesterStaffId) return null;
  const employee = await findActiveEmployeeByStaffId(requesterStaffId);
  const managerStaffId = employee?.managerStaffId ?? null;
  if (!managerStaffId) return null;

  // A `ManagerStaffId` pointing at somebody who has left is not a manager. The
  // email read doubles as the liveness test — `resolveManagerEmail` pins
  // `Status = 'Active'` — so a departed manager abstains rather than locking
  // the request to a person who cannot sign in.
  const email = await resolveManagerEmail(managerStaffId);
  if (!email) return null;

  return { staffId: managerStaffId, email };
}

/**
 * The same answer for one request, with the environment taken from its id.
 *
 * The id rule (`isUatId`) rather than the resolved environment, because every
 * caller here is acting on an existing record: a UAT request must resolve its
 * UAT manager whether or not the person asking has UAT mode switched on, and a
 * production request must never resolve a tester's.
 */
export async function resolveCurrentManagerForRequest(request: {
  id: number;
  staffId: number | null;
  requesterEmail: string | null;
}): Promise<CurrentManager | null> {
  return await resolveCurrentManager(
    request.staffId,
    request.requesterEmail,
    isUatId(request.id) ? "UAT" : "Production",
  );
}

/**
 * The SQL builders live next door, in a module that reaches no pool, so the
 * string they produce can be asserted without a database. Re-exported here
 * so a caller needing both halves imports one path.
 */
export * from "./current-manager-sql";
