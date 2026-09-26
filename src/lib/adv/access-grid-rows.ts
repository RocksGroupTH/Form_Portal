/**
 * The union AP-2's and AP-3's สิทธิ์เข้าถึง grid renders: the access roster,
 * plus **every approver who has no access row — inactive ones included**.
 *
 * The two rosters are different tables (`AccAdvClrAccess` on one side,
 * `AccAdvanceApprover` / `AccClearAdvanceApprover` on the other), so somebody
 * can be an AP-2 approver with no `AccAdvClrAccess` row at all. Listing the
 * access roster alone would hide a real approval grant on the one screen whose
 * job is showing who holds what — and, since the grid's approver column is a
 * control, would leave that grant with no way to switch it off from here.
 *
 * **`IsActive` is read, never filtered on.** AP-4's equivalent had to be fixed
 * out of this twice, and CLAUDE.md records the rule the second fix produced:
 *
 * > A filter whose predicate is the value a button on that row changes will
 * > always do this.
 *
 * Deactivating somebody is exactly what drops them out of an active-only
 * union, so the row would vanish under the click that deactivated it and could
 * not be switched back.
 *
 * Kept out of the component file so it can be unit-tested: a `"use client"`
 * module drags `useSWR`, `sonner` and the AD search modal in with it, and this
 * is the one part of the grid whose correctness is not visible on screen.
 * The module imports nothing at runtime — the two imports are types.
 */

import type { AdvClrApproverColumn } from "@/lib/adv/approver-columns";
import type { ApproverRosterRow } from "@/lib/adv/approver-roster";

/** One `AccAdvClrAccess` row as `/settings/access` answers it. */
export interface AccessRosterRow {
  id: number;
  staffId: number;
  email: string;
  displayName: string;
  isActive: boolean;
  /** Both forms' keys — see `AdvClrAccessRow.settingsTabs`' own comment. */
  settingsTabs: string[];
  /** `AccAdvClrAccess.CanAdvanceMessage` (migration 166) — AP-2's Message tab. */
  canAdvanceMessage: boolean;
  /** `AccAdvClrAccess.CanClearMessage` (migration 166) — AP-3's Message tab. */
  canClearMessage: boolean;
}

/**
 * One line of the grid: at most one `AccAdvClrAccess` row and at most one
 * approver row per role, for the same person.
 *
 * **Keyed on the lowercased email, not on StaffId.** AP-4's grid keys on
 * StaffId because both of its rosters carry one; here
 * `AccAdvanceApprover.StaffId` and `AccClearAdvanceApprover.StaffId` are
 * **nullable** (migration 081, and `upsertClrApprover` fills it from HR
 * best-effort), so an approver row can arrive with none. `Email` is `NOT NULL`
 * on all three tables and is what `resolveAdvClrTabsByEmail`,
 * `isAnyAdvanceApprover` and `isAnyClrApprover` already match on, so it is the
 * only identifier every row is guaranteed to have.
 */
export interface AccessGridRow {
  /** Lowercased email — see the interface comment. */
  key: string;
  email: string;
  displayName: string;
  staffId: number | null;
  /** `null` for an approver-only row — somebody on the approval pool with no
   *  `AccAdvClrAccess` row at all. */
  access: AccessRosterRow | null;
  /** This person's approver rows for THIS form, by role. */
  approverByRole: Record<string, ApproverRosterRow>;
}

/**
 * Build the grid's rows.
 *
 * **A role this form's grid does not render is not a reason to add a row.**
 * AP-3's retired `HEAD` rows are kept in the table and read by nothing (see
 * `approver-columns.ts`), so a person holding only one of those would otherwise
 * appear here with every box empty and no explanation of why they are listed.
 * They are equally not a reason to DROP a person who is on the access roster,
 * which is why the filter applies to the approver pass alone.
 */
export function buildAccessGridRows(
  access: readonly AccessRosterRow[],
  approvers: readonly ApproverRosterRow[],
  columns: readonly AdvClrApproverColumn[],
): AccessGridRow[] {
  const known: Record<string, true> = {};
  for (const c of columns) known[c.role] = true;

  const byKey: Record<string, AccessGridRow> = {};
  const order: string[] = [];
  const push = (row: AccessGridRow) => {
    byKey[row.key] = row;
    order.push(row.key);
  };

  for (const a of access) {
    const key = String(a.email ?? "").trim().toLowerCase();
    if (!key || byKey[key]) continue;
    push({
      key,
      email: a.email,
      displayName: a.displayName || a.email,
      staffId: a.staffId,
      access: a,
      approverByRole: {},
    });
  }

  for (const ap of approvers) {
    if (!known[ap.role]) continue;
    const key = String(ap.email ?? "").trim().toLowerCase();
    if (!key) continue;
    let row = byKey[key];
    if (!row) {
      row = {
        key,
        email: ap.email,
        displayName: ap.displayName || ap.email,
        staffId: ap.staffId,
        access: null,
        approverByRole: {},
      };
      push(row);
    }
    // One row per (Email, Role) by unique index on both tables, so a second
    // sighting is a duplicate rather than a second grant; keep the first and
    // never OR the flags together — that would report a retired row as live.
    if (!row.approverByRole[ap.role]) row.approverByRole[ap.role] = ap;
    if (row.staffId == null && ap.staffId != null) row.staffId = ap.staffId;
  }

  const rows = order.map((k) => byKey[k]);
  rows.sort((a, b) => {
    const n = a.displayName.localeCompare(b.displayName, "th");
    return n !== 0 ? n : a.email.localeCompare(b.email);
  });
  return rows;
}

/**
 * How many DISTINCT PEOPLE can approve anything on this form today.
 *
 * People, not rows: one person holding two of AP-2's three levels is one
 * approver, and this number is read as "is there anybody who can approve at
 * all" — the question the commissioning banner asks.
 */
export function countActiveApprovers(
  rows: readonly AccessGridRow[],
  columns: readonly AdvClrApproverColumn[],
): number {
  let n = 0;
  for (const r of rows) {
    for (const c of columns) {
      const ap = r.approverByRole[c.role];
      if (ap && ap.isActive) {
        n += 1;
        break;
      }
    }
  }
  return n;
}
