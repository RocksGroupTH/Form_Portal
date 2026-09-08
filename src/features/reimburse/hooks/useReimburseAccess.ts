"use client";

import useSWR from "swr";

interface ReimburseAccessData {
  admin: boolean;
  settingsTabs: string[];
  canSettings: boolean;
  /**
   * Sight of `/request/reimburse/approvals` — the `approvalQueue` menu grant
   * from `AccReimburseAccessTab`, or true for an admin. The route already
   * answered this field (`/api/request/reimburse/access`); nothing here read
   * it until the Request hub needed it to decide whether to show the queue's
   * own card. `clearance` is on the same response and is left off this type
   * until something needs it, for the same reason `menus` was — the field
   * existing on the wire is not a reason to widen every consumer of it early.
   */
  approvalQueue: boolean;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(typeof json.error === "string" ? json.error : "โหลดสิทธิ์ไม่สำเร็จ");
  }
  return json as { ok: boolean; data: ReimburseAccessData };
};

/**
 * AP-4's access hook — the counterpart to `useAccountingAccess` and
 * `useBookingAccess`, reading AP-4's own roster (`AccReimburseAccess`). Kept
 * separate so a change to one form's access never moves another's.
 *
 * Narrower than either sibling, because AP-4's roster is narrower: it answers
 * settings-tab visibility and nothing else. There is no `canAccount` here —
 * whether somebody may take the ACCOUNT or ACCOUNT_FINAL step comes from
 * `AccReimburseApprover`, a different table, checked server-side where the
 * money moves. Being on this list confers no approval right, which is the
 * reason the two lists are separate.
 */
export function useReimburseAccess() {
  const { data, error, isLoading } = useSWR("/api/request/reimburse/access", fetcher);

  const access = data?.data;
  return {
    loading: isLoading,
    error,
    /** IT Admin or System Admin. */
    isAdmin: access?.admin ?? false,
    /**
     * Grantable AP-4 settings tabs this non-admin may open; `[]` for admins,
     * who see every tab.
     */
    settingsTabs: access?.settingsTabs ?? [],
    /**
     * admin OR at least one granted tab. **Membership alone is false** — an
     * `AccReimburseAccess` row with no ticks opens nothing, so adding somebody
     * and then walking away leaves them exactly where they were.
     */
    canSettings: access?.canSettings ?? false,
    /**
     * Sight of the AP-4 accounting queue (`/request/reimburse/approvals`) —
     * admin OR the `approvalQueue` menu grant. Defaults `false` while loading
     * or on a failed read, unlike the availability flags elsewhere in this
     * app that default to visible: this one gates a live link into an
     * authorization surface, not whether a form is open, so the safer default
     * while the answer is unknown is to show nothing rather than a card that
     * might disappear once the real answer arrives.
     */
    approvalQueue: access?.approvalQueue ?? false,
  };
}
