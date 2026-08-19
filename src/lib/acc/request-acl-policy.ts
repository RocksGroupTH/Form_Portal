/**
 * One object ACL for an Accounting request, used by every route that reaches a
 * request by id.
 *
 * ## Why this exists
 *
 * Authorization for AP-1 used to be per-route and, on the direct-by-id routes,
 * absent: `GET /api/request/accounting/requests/[id]` returned the full record —
 * requester name, department, travel detail, amounts, approval chain, attachment
 * ids — to any authenticated session; `GET .../files/[fileId]` streamed any
 * numeric file id with no join to its parent; `POST .../requests/[id]/files`
 * attached to any existing request; and `POST .../submit` submitted one. The
 * list endpoints were scoped, so the data was only reachable by guessing a small
 * integer, which is not a control.
 *
 * The service layer already guarded the paths that go through `saveDraft`,
 * `deleteDraft` and `deleteItem` — `CreatedBy !== userId` throws there. This
 * module is the same decision, in one place, for the routes that never called
 * them.
 *
 * ## Shape
 *
 * The two `decide*` functions are pure: a row, a viewer, a verdict. Everything
 * that needs a pool or a request scope is in the `load`/`build`/`assert`
 * wrappers below, so the policy itself is testable without a database.
 *
 * ## The UAT clause
 *
 * `docs/superpowers/specs/2026-08-18-parallel-uat-design.md` states the rule the
 * id-routing was built around: *the whole approval chain of a UAT request stays
 * inside the tester group — a production user must never see or act on test
 * data.* That was enforced at the two ends (a tester's UAT manager must be a
 * tester; on-behalf writes refuse a non-tester requester) but not in the middle:
 * an id ≥ 900000 selects the UAT database on its own, so any active
 * `AccApprover` — a real accountant, not on the tester list — could open and
 * approve a test document by typing its number, and `canAccessAccountArea` was
 * the only gate in the way.
 *
 * So the environment the request resolved to is part of the verdict here, and a
 * non-tester is refused on a UAT record. The refusal is a 404, not a 403:
 * telling someone outside the test group that request 900123 exists is itself
 * the leak.
 *
 * Note this is deliberately *not* the UAT-mode cookie. A tester with UAT mode
 * switched off still resolves UAT for a UAT id — that is what makes their own
 * test requests openable from a link — and they stay authorized. The cookie
 * decides which database a *new* request goes to; membership decides who may
 * touch one that already exists.
 */


/** The columns any request-scoped decision needs. Both forms share the header. */
export interface AccRequestAclRow {
  id: number;
  formCode: string;
  status: string;
  createdBy: number | null;
  submittedBy: number | null;
  /** HR StaffId of the requester (ผู้ขอเบิก) — differs from the creator on an on-behalf request. */
  staffId: number | null;
  managerStaffId: number | null;
}

/** Mirrors `FormEnvironmentValue`; redeclared so this module imports nothing. */
export type AclEnvironment = "Production" | "UAT";

export interface AccAclViewer {
  userId: number;
  email: string | null;
  /** HR StaffId, or null when the viewer has no HR employee row. */
  staffId: number | null;
  role: string | null;
  /** Active `AccApprover`, or an admin role. */
  isAccountArea: boolean;
  /** Environment the current request resolved to — id first, then mode, then switches. */
  environment: AclEnvironment;
  /** Active row in `UatTester`. Membership, never the cookie. */
  isActiveUatTester: boolean;
}

export type AclVerdict = { ok: true } | { ok: false; status: 403 | 404; error: string };

export const ACL_NOT_FOUND: AclVerdict = { ok: false, status: 404, error: "not found" };
export const ACL_FORBIDDEN: AclVerdict = {
  ok: false,
  status: 403,
  error: "ไม่มีสิทธิ์เข้าถึงคำขอนี้",
};
export const ACL_NOT_EDITABLE: AclVerdict = {
  ok: false,
  status: 403,
  error: "แก้ไขได้เฉพาะคำขอที่เป็นฉบับร่างของคุณเท่านั้น",
};

/** Statuses in which the creator may still change the request. Mirrors `saveDraft`. */
export const EDITABLE_STATUSES: readonly string[] = ["Draft", "Returned"];

function isOwner(row: AccRequestAclRow, viewer: AccAclViewer): boolean {
  if (!Number.isFinite(viewer.userId) || viewer.userId <= 0) return false;
  return row.createdBy === viewer.userId || row.submittedBy === viewer.userId;
}

/**
 * The person the request was filed *for*. On an on-behalf request the colleague
 * named as requester can read their own claim even though somebody else created
 * it — they are the data subject, and their national-ID scan may be attached.
 */
function isRequestSubject(row: AccRequestAclRow, viewer: AccAclViewer): boolean {
  return viewer.staffId != null && row.staffId != null && row.staffId === viewer.staffId;
}

function isAssignedManager(row: AccRequestAclRow, viewer: AccAclViewer): boolean {
  return (
    viewer.staffId != null && row.managerStaffId != null && row.managerStaffId === viewer.staffId
  );
}

/** A UAT record is invisible to anyone outside the tester group — see the header. */
function uatBarrier(viewer: AccAclViewer): AclVerdict | null {
  if (viewer.environment !== "UAT") return null;
  return viewer.isActiveUatTester ? null : ACL_NOT_FOUND;
}

/** May this viewer see the request and everything hanging off it? */
export function decideRequestRead(row: AccRequestAclRow, viewer: AccAclViewer): AclVerdict {
  const barrier = uatBarrier(viewer);
  if (barrier) return barrier;

  if (isOwner(row, viewer)) return { ok: true };
  if (isRequestSubject(row, viewer)) return { ok: true };
  if (isAssignedManager(row, viewer)) return { ok: true };
  if (viewer.isAccountArea) return { ok: true };
  return ACL_FORBIDDEN;
}

/**
 * May this viewer change the request — attach or remove a file, save, submit?
 *
 * Creator only, and only while it is still a draft. Deliberately narrower than
 * the read rule: the assigned manager and the accounting team act through the
 * approval routes, which carry their own step checks, not by editing the record.
 */
export function decideRequestMutate(row: AccRequestAclRow, viewer: AccAclViewer): AclVerdict {
  const barrier = uatBarrier(viewer);
  if (barrier) return barrier;

  if (!isOwner(row, viewer)) {
    // 403 rather than 404: read already succeeded for anyone who gets this far
    // in practice, and a bare 404 on a request they can see is confusing.
    return decideRequestRead(row, viewer).ok ? ACL_NOT_EDITABLE : ACL_FORBIDDEN;
  }
  if (!EDITABLE_STATUSES.includes(row.status)) return ACL_NOT_EDITABLE;
  return { ok: true };
}
