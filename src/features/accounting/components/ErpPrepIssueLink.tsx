"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import {
  resolveErpPrepIssueLink,
  type ErpPrepIssueLinkContext,
} from "@/features/accounting/lib/erp-prep-issue-links";

export function ErpPrepIssueLink({
  issue,
  context,
  className = "text-[11px]",
}: {
  issue: string;
  context?: ErpPrepIssueLinkContext;
  className?: string;
}) {
  const href = resolveErpPrepIssueLink(issue, context);

  if (!href) {
    return <span className={className} style={{ color: "var(--text-secondary)" }}>{issue}</span>;
  }

  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1 font-medium no-underline hover:underline ${className}`}
      style={{ color: "var(--nav-active-text)" }}
    >
      {issue}
      <ExternalLink size={11} className="shrink-0 opacity-70" />
    </Link>
  );
}
