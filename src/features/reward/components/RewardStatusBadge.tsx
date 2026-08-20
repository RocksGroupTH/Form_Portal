"use client";

import { STATUS_LABEL_TH } from "@/features/reward/constants";
import type { RewardRequestStatus } from "@/features/reward/types";

/**
 * Status pill, using the shared `--status-*` tokens.
 *
 * AP-11 has six live statuses where AP-1 has four, so the mapping is worth
 * stating rather than guessing at each call site: the three "in flight" stages
 * are all pending-coloured, and only `Received` is a success.
 */
const TONE: Record<RewardRequestStatus, "pending" | "ok" | "draft" | "bad"> = {
  Draft: "draft",
  Submitted: "pending",
  ManagerApproved: "pending",
  Approved: "pending",
  Ready: "pending",
  Received: "ok",
  Rejected: "bad",
  Returned: "bad",
};

export function RewardStatusBadge({
  status,
  className = "",
}: {
  status: RewardRequestStatus | string;
  className?: string;
}) {
  const tone = TONE[status as RewardRequestStatus] ?? "draft";
  const label = STATUS_LABEL_TH[status as RewardRequestStatus] ?? status;

  return (
    <span
      className={`inline-flex items-center text-[10.5px] font-bold px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap ${className}`}
      style={{
        background: `var(--status-${tone}-bg)`,
        color: `var(--status-${tone}-text)`,
      }}
    >
      {label}
    </span>
  );
}
