"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { fmtBaht } from "./shared";

interface Entry {
  effectiveDate: string; // 'YYYY-MM-DD'
  amount: number;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Read-only per-diem allowance history for the current requester
 * (Rocks_Portal_HR.dbo.EmployeeAllowanceLog). No edit — this is the authoritative HR log,
 * changed only in the HR system.
 */
export function AllowanceHistoryModal({ open, onClose, requesterStaffId }: { open: boolean; onClose: () => void; requesterStaffId?: number | null }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setEntries(null);
    fetch(`/api/request/travel-booking/allowance-log?requesterStaffId=${requesterStaffId ?? ""}`)
      .then((r) => r.json())
      .then((j) => setEntries(j.ok ? ((j.data?.entries as Entry[]) ?? []) : []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [open, requesterStaffId]);

  const asc = (entries ?? []).slice().sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  const newestFirst = asc.slice().reverse();

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }} title="ประวัติเบี้ยเลี้ยง" uniformSurface>
      <div className="flex flex-col gap-5">
        {/* History — timeline */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide mb-3" style={{ color: "var(--text-muted)" }}>
            รายการเปลี่ยนแปลง
          </p>
          {loading ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => <div key={i} className="h-10 rounded-xl animate-pulse" style={{ background: "var(--bg-card-alt)" }} />)}
            </div>
          ) : newestFirst.length === 0 ? (
            <p className="text-[13px] py-2" style={{ color: "var(--text-muted)" }}>ยังไม่มีรายการ</p>
          ) : (
            <div className="relative">
              {/* vertical connector aligned to the dot centers */}
              <div className="absolute left-2 top-1.5 bottom-1.5 w-px" style={{ background: "var(--border-card)" }} />
              <div className="flex flex-col gap-5">
                {newestFirst.map((e, i) => {
                  const isCurrent = i === 0;
                  return (
                    <div key={`${e.effectiveDate}-${i}`} className="relative flex gap-3.5">
                      <div className="w-4 shrink-0 flex justify-center pt-0.5">
                        <span
                          className="rounded-full"
                          style={
                            isCurrent
                              ? { width: 14, height: 14, background: "var(--nav-active-text)", boxShadow: "0 0 0 3px var(--nav-active-bg)" }
                              : { width: 10, height: 10, background: "var(--bg-card)", border: "2px solid var(--border-card)" }
                          }
                        />
                      </div>
                      <div className="min-w-0 -mt-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className="text-[15px] font-bold tabular-nums"
                            style={{ color: isCurrent ? "var(--nav-active-text)" : "var(--text-primary)" }}
                          >
                            ฿{fmtBaht(e.amount)}
                          </span>
                          <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>/ วัน</span>
                          {isCurrent && (
                            <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "#e4f4ea", color: "#4fa37a" }}>
                              ใช้อยู่ตอนนี้
                            </span>
                          )}
                        </div>
                        <div className="text-[12px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                          มีผลตั้งแต่ {fmtDate(e.effectiveDate)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <p className="text-[11px] flex items-center gap-1.5" style={{ color: "var(--text-faint)" }}>
          <History size={12} className="shrink-0" /> ข้อมูลจากระบบ HR — แก้ไขได้ที่ระบบต้นทางเท่านั้น
        </p>
      </div>
    </Dialog>
  );
}
