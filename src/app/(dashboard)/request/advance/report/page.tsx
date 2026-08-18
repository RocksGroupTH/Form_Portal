"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { FileBarChart } from "lucide-react";

interface Row {
  id: number;
  submittedAt: string | null;
  requestNo: string | null;
  staffId: number | null;
  requesterName: string | null;
  position: string | null;
  department: string | null;
  payeeType: string | null;
  payeeName: string | null;
  bankAccount: string | null;
  bankName: string | null;
  needByDate: string | null;
  expectedClearDate: string | null;
  purpose: string | null;
  currency: string | null;
  amount: number | null;
  exchangeRate: number | null;
  baseAmount: number | null;
  approvedName: string | null;
  approvedDate: string | null;
  approvedRemark: string | null;
  actionedByName: string | null;
  actionedDate: string | null;
  actionedRemark: string | null;
  paymentDate: string | null;
  clearAdvanceNo: string | null;
  advanceStatus: string | null;
  pendingOn: string | null;
  overallStatus: string;
}

const dt = (s: string | null) => (s ? new Date(s).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "");
const d = (s: string | null) => (s ? new Date(s).toLocaleDateString("th-TH", { dateStyle: "short" }) : "");
const n = (v: number | null) => (v == null ? "" : v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }));

// [header, accessor, align]
type Col = { h: string; get: (r: Row) => string; num?: boolean };
const COLS: Col[] = [
  { h: "Submitted", get: (r) => dt(r.submittedAt) },
  { h: "เลขที่ Request", get: (r) => r.requestNo ?? "" },
  { h: "รหัสพนักงาน", get: (r) => String(r.staffId ?? "") },
  { h: "ชื่อ-นามสกุล", get: (r) => r.requesterName ?? "" },
  { h: "ตำแหน่ง", get: (r) => r.position ?? "" },
  { h: "แผนก", get: (r) => r.department ?? "" },
  { h: "โอนให้", get: (r) => r.payeeType ?? "" },
  { h: "ชื่อคู่ค้า/พนักงาน", get: (r) => r.payeeName ?? "" },
  { h: "เลขที่บัญชี", get: (r) => r.bankAccount ?? "" },
  { h: "ธนาคาร", get: (r) => r.bankName ?? "" },
  { h: "วันที่เริ่มใช้เงิน", get: (r) => d(r.needByDate) },
  { h: "วันที่คาดเคลียร์", get: (r) => d(r.expectedClearDate) },
  { h: "รายละเอียด", get: (r) => r.purpose ?? "" },
  { h: "สกุลเงิน", get: (r) => r.currency ?? "" },
  { h: "จำนวนเงิน", get: (r) => n(r.amount), num: true },
  { h: "อัตราแลกเปลี่ยน", get: (r) => n(r.exchangeRate), num: true },
  { h: "เบิก Advance (THB)", get: (r) => n(r.baseAmount), num: true },
  { h: "Approved Name", get: (r) => r.approvedName ?? "" },
  { h: "Approved Date", get: (r) => dt(r.approvedDate) },
  { h: "Approved Remark", get: (r) => r.approvedRemark ?? "" },
  { h: "Actioned By", get: (r) => r.actionedByName ?? "" },
  { h: "Actioned Date", get: (r) => dt(r.actionedDate) },
  { h: "Actioned Remark", get: (r) => r.actionedRemark ?? "" },
  { h: "Payment Date", get: (r) => d(r.paymentDate) },
  { h: "Clear Advance no.", get: (r) => r.clearAdvanceNo ?? "" },
  { h: "Advance status", get: (r) => r.advanceStatus ?? "" },
  { h: "Pending on", get: (r) => r.pendingOn ?? "" },
  { h: "Overall Status", get: (r) => r.overallStatus },
];

export default function AdvanceReportPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/request/advance/report")
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: Row[] }) => setRows(j.ok && j.data ? j.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => load(), [load]);

  const th: React.CSSProperties = {
    background: "var(--bg-card-alt)", color: "var(--text-secondary)",
    padding: "8px 10px", textAlign: "left", whiteSpace: "nowrap",
    borderBottom: "1px solid var(--border-card)", position: "sticky", top: 0, fontWeight: 700,
  };
  const td: React.CSSProperties = {
    padding: "7px 10px", whiteSpace: "nowrap", borderBottom: "1px solid var(--border-card)",
    color: "var(--text-primary)", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis",
  };

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0 flex flex-col gap-4">
      <PageHeaderBar
        icon={FileBarChart}
        title="รายงาน AP-2 (Control)"
        subtitle="คำขอเบิกเงินทดรองจ่ายทั้งหมด · คอลัมน์ตาม AP-2-Control"
        backHref="/request/advance/admin"
      />
      <div className="rounded-2xl overflow-hidden" style={{ background: "var(--bg-card)", boxShadow: "var(--shadow-card)" }}>
        {loading ? (
          <p className="text-[13px] py-16 text-center" style={{ color: "var(--text-muted)" }}>กำลังโหลด...</p>
        ) : rows.length === 0 ? (
          <p className="text-[13px] py-16 text-center" style={{ color: "var(--text-muted)" }}>ยังไม่มีคำขอ</p>
        ) : (
          <div className="overflow-auto" style={{ maxHeight: "72vh" }}>
            <table className="text-[12px]" style={{ borderCollapse: "collapse", width: "max-content", minWidth: "100%" }}>
              <thead>
                <tr>{COLS.map((c) => <th key={c.h} style={th}>{c.h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:brightness-95"
                    onClick={() => router.push(`/request/advance/${r.id}`)}
                    style={{ background: "var(--bg-card)" }}>
                    {COLS.map((c) => (
                      <td key={c.h} style={{ ...td, textAlign: c.num ? "right" : "left", fontWeight: c.h === "เลขที่ Request" ? 700 : 400 }}
                        title={c.get(r)}>
                        {c.get(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>
        {loading ? "" : `${rows.length} รายการ`} · คลิกแถวเพื่อเปิดคำขอ · Clear Advance / Advance status รอเชื่อม AP-3 (การเคลียร์)
      </p>
    </PageContainer>
  );
}
