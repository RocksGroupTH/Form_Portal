"use client";

import useSWR from "swr";

interface BookingAccessData {
  account: boolean;
  approver: boolean;
  admin: boolean;
  settingsTabs: string[];
  canSettings: boolean;
  bookingQueue: boolean;
  accountApproval: boolean;
  bookingReport: boolean;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(typeof json.error === "string" ? json.error : "โหลดสิทธิ์ไม่สำเร็จ");
  }
  return json as { ok: boolean; data: BookingAccessData };
};

/**
 * AP-17's access hook — the counterpart to `useAccountingAccess`, reading
 * AP-17's own roster (`AccBookingApprover`) instead of AP-1's `AccApprover`.
 * Kept separate so a change to one form's access never moves the other's.
 */
export function useBookingAccess() {
  const { data, error, isLoading } = useSWR("/api/request/travel-booking/access", fetcher);

  const access = data?.data;
  return {
    loading: isLoading,
    error,
    /** Active row in AccBookingApprover */
    isApprover: access?.approver ?? false,
    /**
     * Active row in AccBookingApprover — **not admin-inclusive**. Menu
     * visibility only: the server still authorizes with
     * `canAccessBookingArea`, which does include admins. See `isAdmin`.
     */
    canAccount: access?.account ?? false,
    /** IT Admin or System Admin. */
    isAdmin: access?.admin ?? false,
    /**
     * Grantable AP-17 settings tabs this non-admin booking approver may open;
     * `[]` for admins, who see every tab.
     */
    settingsTabs: access?.settingsTabs ?? [],
    /** admin OR at least one granted tab. */
    canSettings: access?.canSettings ?? false,
    /**
     * Menu grant for the Admin booking-fill queue — admin OR `CanQueue` on
     * this person's own roster row (`booking-areas.ts`), which is the column
     * ACC Portal writes too.
     *
     * **Since 2026-09-24 this is no longer only about which menu renders.**
     * `requireBookingMenu` refuses the actions behind it without the same
     * column, so a card drawn here without the grant would open a page whose
     * every button answers 403. It stays separate from `canAccount` — roster
     * membership is the outer gate and these three only narrow it.
     */
      bookingQueue: access?.bookingQueue ?? false,
    /** Same shape, for the HR sign-off queue this page's own gate reads. */
    accountApproval: access?.accountApproval ?? false,
    /** Same shape, for the AP-17 report. */
    bookingReport: access?.bookingReport ?? false,
  };
}
