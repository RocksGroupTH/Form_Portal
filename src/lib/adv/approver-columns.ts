/**
 * The approver columns AP-2's and AP-3's สิทธิ์เข้าถึง grid renders, and the
 * body a tick posts.
 *
 * **AP-4's shape needed one correction to transfer, and this module is it.**
 * AP-4's grid carries four brand ticks because `AccReimburseApproverBrand` is
 * its approver switch — ≥1 brand ticked means an active approver. Neither form
 * here has brands, and the obvious reading — "so it is one tick per person" —
 * is right for AP-3 and **wrong for AP-2**:
 *
 * - `AccClearAdvanceApprover` has a `Role` column with one live value,
 *   `ACCOUNT` (the `HEAD` rows are retired and `listAllClrApprovers` filters
 *   them out), so one person is one row and one tick says everything.
 * - `AccAdvanceApprover` is unique on **(Email, ApproverRole)** — migration 083,
 *   whose own header says *"One person may serve at both levels"* — over three
 *   roles (082 added two, 086 added `DIRECTOR`). Which roles a request actually
 *   visits is decided by `AccAdvanceApprovalTier.Steps`, the amount matrix. So a
 *   single tick could not say which level it meant, and would have had to guess
 *   one — on the roster that decides who approves money.
 *
 * Hence: **one column per role**, three for AP-2 and one for AP-3. The lists
 * live here rather than inside the grid for the reason `settings-tabs.ts` gives
 * for its own: a vocabulary retyped beside the markup is a vocabulary that can
 * drift from the service that stores it.
 *
 * **This module imports nothing at runtime** (the `AdvClrForm` import is a type
 * and is erased), so it is unit-tested without a database — anything reachable
 * from a pool drags `@/env` in, which validates the whole environment at import
 * time and throws in the test runner.
 */

import type { AdvClrForm } from "@/lib/adv/settings-tabs";

export interface AdvClrApproverColumn {
  /** The value stored in the roster's own role column. */
  role: string;
  /** The column header — short enough to sit above a checkbox. */
  short: string;
  /** The full name the approver panel below this grid uses for the same level. */
  label: string;
  /** What this level does, shown on the header's `title`. */
  hint: string;
}

/**
 * AP-2's three levels, in the order its own approver panel lists them.
 *
 * `HEAD_DEPT` is deliberately absent and is not an omission: it resolves to the
 * requester's line manager at submit and has never been a configured row — see
 * migration 086's header, which says so.
 */
const ADVANCE_APPROVER_COLUMNS: readonly AdvClrApproverColumn[] = [
  {
    role: "HEAD_ACC",
    short: "Head Acc.",
    label: "Head Accounting",
    hint: "ผู้อนุมัติระดับบัญชี",
  },
  {
    role: "DIRECTOR",
    short: "ผู้บริหาร",
    label: "ผู้บริหาร",
    hint: "ผู้บริหาร (สำหรับยอดสูง)",
  },
  {
    role: "ACC_OFFICER",
    short: "Acc. Officer",
    label: "Accounting Officer",
    hint: "เลือกวันจ่าย + ตรวจสอบ (ขั้นสุดท้าย)",
  },
];

/**
 * AP-3's single live level.
 *
 * The table's CHECK still admits `HEAD` and the rows of that era are kept —
 * they record who was configured when those requests were approved — but
 * nothing reads them, so listing the role here would put a column on the grid
 * that approves nothing.
 */
const CLEAR_APPROVER_COLUMNS: readonly AdvClrApproverColumn[] = [
  {
    role: "ACCOUNT",
    short: "บัญชี",
    label: "บัญชี (Account Office)",
    hint: "ขั้นอนุมัติที่ 2 · ขั้นสุดท้าย · ตรวจเอกสาร/บัญชี",
  },
];

/** The approver columns this form's grid renders, in the panel's own order. */
export function advClrApproverColumnsForForm(
  form: AdvClrForm,
): readonly AdvClrApproverColumn[] {
  return form === "AP-2" ? ADVANCE_APPROVER_COLUMNS : CLEAR_APPROVER_COLUMNS;
}

/**
 * Where this form's approver roster is read and written.
 *
 * Two endpoints, not one, because there are two tables — and both are already
 * `requireRole(["IT Admin", "System Admin"])`, the same gate the สิทธิ์เข้าถึง
 * route carries, so the grid reading one opens no new door.
 */
export function advClrApproverEndpoint(form: AdvClrForm): string {
  return form === "AP-2"
    ? "/api/request/advance/settings/approvers"
    : "/api/request/clear-advance/settings/approvers";
}

/** Is this a role this form's grid knows about? */
export function isAdvClrApproverRole(form: AdvClrForm, role: string): boolean {
  const wanted = String(role).trim();
  for (const c of advClrApproverColumnsForForm(form)) if (c.role === wanted) return true;
  return false;
}

/**
 * The POST body for one approver tick, or **`null` when there is nothing to
 * do**.
 *
 * Three properties, and each is a decision rather than a shape:
 *
 * 1. **Unticking a row that does not exist returns `null`.** Without it the
 *    caller would fall through to the create branch and write a brand-new
 *    approver row with `IsActive = 0` — a roster entry nobody asked for, from
 *    the gesture that means "no". Unreachable from the grid, which renders an
 *    unticked box for exactly that state; total here so it cannot become
 *    reachable.
 * 2. **An existing row is switched by `id`, never re-created by email.** AP-2's
 *    route only runs its candidate check (บัญชี · ผู้บริหาร · IT) when the body
 *    carries no `id`, so switching somebody back on keeps working after they
 *    have moved department — which is what the panel below has always done, and
 *    is the behaviour a soft delete is for.
 * 3. **Creating still goes through each route's own rules, unweakened.** AP-2
 *    refuses an email outside the candidate list with its own Thai message; the
 *    grid surfaces that rather than working around it. Nothing here bypasses a
 *    restriction: this function only chooses the body shape the existing route
 *    already documents.
 *
 * The shapes differ per form because the two routes do. AP-2's edit is a
 * COALESCE-preserving update that needs nothing but `{ id, isActive }`; AP-3's
 * rewrites the row, so its API contract asks for `role` and `email` beside the
 * id — the same body its own panel has always sent.
 */
export function advClrApproverWriteBody(
  form: AdvClrForm,
  input: { id: number | null; email: string; role: string; isActive: boolean },
): Record<string, unknown> | null {
  if (!isAdvClrApproverRole(form, input.role)) return null;
  const email = String(input.email ?? "").trim();
  if (input.id == null) {
    // Nothing exists and nothing is being granted — see property 1 above.
    if (!input.isActive) return null;
    if (!email) return null;
    return form === "AP-2"
      ? { email, approverRole: input.role, isActive: true }
      : { role: input.role, email, isActive: true };
  }
  return form === "AP-2"
    ? { id: input.id, isActive: input.isActive }
    : { id: input.id, role: input.role, email, isActive: input.isActive };
}
