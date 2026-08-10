"use client";

import { Badge } from "@/components/ui";
import { SUBMISSION_STATUS_COLORS } from "../constants";
import type { SubmissionStatus } from "../types";

const LABELS: Record<SubmissionStatus, string> = {
  Draft: "Draft",
  Submitted: "Submitted",
  InReview: "In Review",
  Approved: "Approved",
  Rejected: "Rejected",
  Returned: "Returned",
  Cancelled: "Cancelled",
};

export function StatusBadge({ status, small }: { status: SubmissionStatus; small?: boolean }) {
  const colors = SUBMISSION_STATUS_COLORS[status] ?? SUBMISSION_STATUS_COLORS.Draft;
  return <Badge label={LABELS[status] ?? status} color={colors.color} bg={colors.bg} small={small} />;
}
