import type { ReportRow } from "@/lib/acc/report-service";
import { isPendingApprovalStatus } from "@/features/accounting/constants";

export interface ReportKpiStats {
  rowCount: number;
  totalAmount: number;
  approvedCount: number;
  approvedAmount: number;
  pendingCount: number;
  pendingAmount: number;
  closedCount: number;
  closedAmount: number;
  paidCount: number;
  paidAmount: number;
}

export function computeReportKpi(rows: ReportRow[]): ReportKpiStats {
  let totalAmount = 0;
  let approvedAmount = 0;
  let pendingAmount = 0;
  let closedAmount = 0;
  let paidAmount = 0;
  let approvedCount = 0;
  let pendingCount = 0;
  let closedCount = 0;
  let paidCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const amt = r.totalAmount ?? 0;
    totalAmount += amt;

    if (r.status === "Approved") {
      approvedCount++;
      approvedAmount += amt;
      if (r.paymentDate) {
        paidCount++;
        paidAmount += amt;
      }
    } else if (isPendingApprovalStatus(r.status) || r.status === "Returned") {
      pendingCount++;
      pendingAmount += amt;
    } else if (r.status === "Rejected" || r.status === "Cancelled") {
      closedCount++;
      closedAmount += amt;
    }
  }

  return {
    rowCount: rows.length,
    totalAmount,
    approvedCount,
    approvedAmount,
    pendingCount,
    pendingAmount,
    closedCount,
    closedAmount,
    paidCount,
    paidAmount,
  };
}
