"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { Button } from "@/components/ui/Button";
import { Wallet, Plus, Settings, Inbox } from "lucide-react";

interface InboxRow {
  id: number;
  requestNo: string | null;
  brandCode: string | null;
  requesterFullName: string | null;
  totalAmount: number | null;
  status: string;
  stepLabel: string;
  updatedAt: string;
}

export default function AdvanceInboxPage() {
  const router = useRouter();
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/request/advance/inbox")
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: InboxRow[] }) => setRows(j.ok && j.data ? j.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0 flex flex-col gap-4">
      <PageHeaderBar
        icon={Wallet}
        title="เบิกเงินทดรองจ่าย (AP-2)"
        subtitle="รายการที่รอคุณอนุมัติ"
        backHref="/request/advance/admin"
        right={
          <div className="flex items-center gap-2">
            <Link href="/request/advance">
              <Button variant="primary" icon={<Plus size={15} />}>คำขอใหม่</Button>
            </Link>
            <Link href="/request/advance/settings">
              <Button variant="secondary" icon={<Settings size={15} />}>ตั้งค่า</Button>
            </Link>
          </div>
        }
      />

      <div className="rounded-2xl p-4" style={{ background: "var(--bg-card)", boxShadow: "var(--shadow-card)" }}>
        <div className="flex items-center gap-2 mb-3">
          <Inbox size={16} style={{ color: "var(--nav-active-text)" }} />
          <h2 className="text-[14px] font-bold" style={{ color: "var(--text-heading)" }}>รอฉันอนุมัติ</h2>
          {!loading && <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>{rows.length} รายการ</span>}
        </div>

        {loading ? (
          <p className="text-[12px] py-8 text-center" style={{ color: "var(--text-muted)" }}>กำลังโหลด...</p>
        ) : rows.length === 0 ? (
          <p className="text-[12px] py-8 text-center" style={{ color: "var(--text-muted)" }}>
            ไม่มีรายการรออนุมัติ (แสดงเฉพาะขั้นที่คุณเป็นผู้อนุมัติ)
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((r) => (
              <button
                key={r.id}
                onClick={() => router.push(`/request/advance/${r.id}`)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer border text-left"
                style={{ background: "var(--bg-card-alt)", borderColor: "var(--border-card)" }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold truncate" style={{ color: "var(--text-primary)" }}>
                    {r.requestNo ?? `#${r.id}`}
                    <span className="ml-2 text-[11px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}>
                      {r.stepLabel}
                    </span>
                  </p>
                  <p className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                    {r.requesterFullName ?? "-"}{r.brandCode ? ` · ${r.brandCode}` : ""}
                  </p>
                </div>
                <span className="text-[13px] font-bold shrink-0" style={{ color: "var(--text-heading)" }}>
                  {(r.totalAmount ?? 0).toLocaleString()} ฿
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </PageContainer>
  );
}
