"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { clearAdvanceDetailHref } from "@/features/clear-advance/lib/navigation";
import {
  fetchList,
  ForbiddenState,
  LoadingRow,
  EmptyRow,
  fmtDateTime,
  fmtMoney,
} from "./shared";

type StepFilter = "ALL" | "ACCOUNT" | "HEAD";

const STEP_FILTERS: { key: StepFilter; label: string }[] = [
  { key: "ALL", label: "ทั้งหมด" },
  { key: "ACCOUNT", label: "บัญชี" },
  { key: "HEAD", label: "หัวหน้าบัญชี" },
];

const STEP_COLOR: Record<string, string> = {
  MANAGER: "#6366f1",
  ACCOUNT: "#0ea5a4",
  HEAD: "#d97706",
};

interface ClrQueueRow {
  id: number;
  requestNo: string | null;
  submittedAt: string | null;
  currentStepCode: string | null;
  stepLabel: string;
  requesterFullName: string | null;
  requesterDepartmentName: string | null;
  brandCode: string | null;
  advanceRequestNo: string | null;
  actualTotal: number | null;
  refundToCompany: number | null;
}

export function ClrApprovalsQueue({ from }: { from: string | null }) {
  const [rows, setRows] = useState<ClrQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [step, setStep] = useState<StepFilter>("ALL");

  const load = useCallback(async (s: StepFilter) => {
    setLoading(true);
    const url =
      s === "ALL"
        ? "/api/request/clear-advance/approvals"
        : `/api/request/clear-advance/approvals?step=${s}`;
    const { data, forbidden } = await fetchList<ClrQueueRow>(url);
    setForbidden(forbidden);
    setRows(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load(step);
  }, [step, load]);

  const detailHref = useCallback(
    (id: number) => {
      const href = clearAdvanceDetailHref(id);
      return from ? `${href}${href.includes("?") ? "&" : "?"}from=${from}` : href;
    },
    [from],
  );

  const total = useMemo(
    () => rows.reduce((s, r) => s + (r.actualTotal ?? 0), 0),
    [rows],
  );

  if (forbidden) {
    return (
      <ForbiddenState message="รออนุมัติ AP-3 สำหรับทีมบัญชีและผู้อนุมัติเท่านั้น" />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Filter chips */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          {STEP_FILTERS.map((f) => {
            const active = step === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setStep(f.key)}
                className="text-[12px] font-semibold px-3 py-1.5 rounded-lg cursor-pointer border-none transition-colors"
                style={{
                  background: active ? "var(--nav-active-bg)" : "var(--bg-badge)",
                  color: active ? "var(--nav-active-text)" : "var(--text-muted)",
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
          {rows.length} รายการ · รวม {fmtMoney(total)} บาท
        </p>
      </div>

      {loading ? (
        <LoadingRow />
      ) : rows.length === 0 ? (
        <EmptyRow label="— ไม่มีคำขอรออนุมัติ —" />
      ) : (
        <div
          className="rounded-xl overflow-x-auto"
          style={{ border: "1px solid var(--border-card)" }}
        >
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr style={{ background: "var(--bg-badge)" }}>
                <th className="text-left font-bold px-3 py-2.5" style={{ color: "var(--text-secondary)" }}>
                  เลขที่คำขอ
                </th>
                <th className="text-left font-bold px-3 py-2.5" style={{ color: "var(--text-secondary)" }}>
                  ขั้น
                </th>
                <th className="text-left font-bold px-3 py-2.5" style={{ color: "var(--text-secondary)" }}>
                  ผู้ขอ
                </th>
                <th className="text-left font-bold px-3 py-2.5" style={{ color: "var(--text-secondary)" }}>
                  แผนก
                </th>
                <th className="text-left font-bold px-3 py-2.5" style={{ color: "var(--text-secondary)" }}>
                  แบรนด์
                </th>
                <th className="text-left font-bold px-3 py-2.5" style={{ color: "var(--text-secondary)" }}>
                  เลขที่ทดรอง
                </th>
                <th className="text-right font-bold px-3 py-2.5" style={{ color: "var(--text-secondary)" }}>
                  ยอดจริง
                </th>
                <th className="text-right font-bold px-3 py-2.5" style={{ color: "var(--text-secondary)" }}>
                  คืนบริษัท
                </th>
                <th className="text-left font-bold px-3 py-2.5" style={{ color: "var(--text-secondary)" }}>
                  ส่งเมื่อ
                </th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--border-card)" }}>
                  <td
                    className="px-3 py-2.5 font-bold whitespace-nowrap"
                    style={{ color: "var(--text-heading)" }}
                  >
                    {r.requestNo ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <Badge
                      label={r.stepLabel}
                      color={
                        r.currentStepCode
                          ? STEP_COLOR[r.currentStepCode] ?? "var(--nav-active-text)"
                          : "var(--text-muted)"
                      }
                      small
                    />
                  </td>
                  <td className="px-3 py-2.5" style={{ color: "var(--text-primary)" }}>
                    {r.requesterFullName ?? "—"}
                  </td>
                  <td className="px-3 py-2.5" style={{ color: "var(--text-muted)" }}>
                    {r.requesterDepartmentName ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                    {r.brandCode ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                    {r.advanceRequestNo ?? "—"}
                  </td>
                  <td
                    className="px-3 py-2.5 text-right whitespace-nowrap font-semibold"
                    style={{ color: "var(--text-heading)" }}
                  >
                    {fmtMoney(r.actualTotal)}
                  </td>
                  <td
                    className="px-3 py-2.5 text-right whitespace-nowrap"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {fmtMoney(r.refundToCompany)}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                    {fmtDateTime(r.submittedAt)}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <Link
                      href={detailHref(r.id)}
                      className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg no-underline"
                      style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
                    >
                      เปิด <ArrowUpRight size={12} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
