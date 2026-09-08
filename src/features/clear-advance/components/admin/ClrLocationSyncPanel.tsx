"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";
import { ERP_INTERFACE_BRANDS } from "@/lib/acc/erp-interface-brands";
import type { BuSpreadEntry } from "@/lib/erp/location-admin-core";
import { EmptyRow, LoadingRow, fmtDateTime } from "./shared";

interface Row {
  code: string;
  displayName: string | null;
  branchCode: string | null;
  buCode: string | null;
  departmentCode: string | null;
  isBranchBlocked: boolean;
  syncedAt: string | null;
}
interface LastSync {
  status: string;
  rowsUpserted: number;
  finishedAt: string | null;
  errorMessage: string | null;
}
interface Payload {
  rows: Row[];
  buSpread: BuSpreadEntry[];
  lastSync: LastSync | null;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function BuSpread({ spread }: { spread: BuSpreadEntry[] }) {
  if (spread.length === 0) return null;
  return (
    <p className="text-[12px] m-0" style={{ color: "var(--text-secondary)" }}>
      {spread.map((e, i) => (
        <span key={e.buCode ?? "__none"}>
          {i > 0 && <span style={{ color: "var(--text-faint)" }}> · </span>}
          <b style={{ color: e.buCode === null ? "var(--text-muted)" : "var(--text-primary)" }}>
            {e.buCode ?? "ไม่มี BU"}
          </b>{" "}
          {e.count}
        </span>
      ))}
    </p>
  );
}

export function ClrLocationSyncPanel() {
  const [brand, setBrand] = useState(ERP_INTERFACE_BRANDS[0]?.id ?? "PCTH");
  const [busy, setBusy] = useState(false);

  const { data, isLoading, mutate } = useSWR<{ ok: boolean; error?: string; data?: Payload }>(
    `/api/request/clear-advance/settings/locations?brand=${encodeURIComponent(brand)}`,
    fetcher,
  );

  const rows = data?.data?.rows ?? [];
  const spread = data?.data?.buSpread ?? [];
  const last = data?.data?.lastSync ?? null;
  const blocked = rows.filter((r) => r.isBranchBlocked).length;

  async function sync() {
    setBusy(true);
    try {
      const res = await fetch("/api/request/clear-advance/settings/locations/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandCode: brand }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; error?: string; data?: { locationRows: number } }
        | null;
      if (!json?.ok) throw new Error(json?.error ?? "Sync ไม่สำเร็จ");
      toast.success(`Sync ${brand} สำเร็จ — ${json.data?.locationRows ?? 0} Location`);
      await mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>
        Location จาก Business Central พร้อม <b>BU</b> ที่ผูกอยู่ — ใช้กำหนด Business Unit
        ของแต่ละบรรทัดตอนส่ง Interface แทนค่าคงที่ COCO เดิม
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {ERP_INTERFACE_BRANDS.map((b) => {
            const active = b.id === brand;
            return (
              <button
                key={b.id}
                onClick={() => setBrand(b.id)}
                className="px-3 py-1.5 text-[12px] font-semibold rounded-lg cursor-pointer transition-colors"
                style={{
                  background: active ? "var(--nav-active-text)" : "var(--bg-badge)",
                  color: active ? "#fff" : "var(--text-secondary)",
                  border: "none",
                }}
              >
                {b.id}
              </button>
            );
          })}
        </div>
        <div className="grow" />
        <Button
          variant="primary"
          size="sm"
          icon={<RefreshCw size={14} />}
          onClick={sync}
          loading={busy}
          disabled={busy}
        >
          Sync Location
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <BuSpread spread={spread} />
        <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
          {rows.length} Location
          {last
            ? ` · sync ล่าสุด ${fmtDateTime(last.finishedAt)}${last.status === "success" ? "" : ` (${last.status})`}`
            : " · ยังไม่เคย sync"}
        </p>
        {last?.status !== "success" && last?.errorMessage && (
          <p className="text-[11px] m-0" style={{ color: "var(--text-danger)" }}>
            {last.errorMessage}
          </p>
        )}
        {/* Blocked branches are shown but never stop anything: BC may still accept
            the line, and refusing on an untested assumption would block work that
            actually posts. */}
        {blocked > 0 && (
          <p className="text-[11px] m-0 flex items-center gap-1" style={{ color: "var(--text-warning)" }}>
            <AlertTriangle size={12} />
            {blocked} Location ผูกกับสาขาที่ถูก Block ใน BC — ส่งได้ แต่ BC อาจไม่รับบรรทัดนั้น
          </p>
        )}
      </div>

      {isLoading ? (
        <LoadingRow />
      ) : rows.length === 0 ? (
        <EmptyRow label="— ยังไม่มีข้อมูล กด Sync Location เพื่อดึงจาก BC —" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-card)" }}>
                {["Code", "ชื่อ", "สาขา", "BU", "แผนก"].map((h) => (
                  <th
                    key={h}
                    className="text-left font-bold py-2 px-2 text-[10px] uppercase tracking-wide"
                    style={{ color: "var(--text-faint)" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code} style={{ borderBottom: "1px solid var(--border-card)" }}>
                  <td className="py-1.5 px-2 font-medium" style={{ color: "var(--text-primary)" }}>
                    {r.code}
                  </td>
                  <td className="py-1.5 px-2" style={{ color: "var(--text-secondary)" }}>
                    {r.displayName ?? "—"}
                  </td>
                  <td className="py-1.5 px-2" style={{ color: "var(--text-secondary)" }}>
                    <span className="inline-flex items-center gap-1">
                      {r.branchCode ?? "—"}
                      {r.isBranchBlocked && (
                        <span
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                          style={{ background: "var(--bg-badge)", color: "var(--text-warning)" }}
                          title="สาขานี้ถูก Block ใน BC"
                        >
                          BLOCKED
                        </span>
                      )}
                    </span>
                  </td>
                  <td
                    className="py-1.5 px-2 font-medium"
                    style={{ color: r.buCode ? "var(--text-primary)" : "var(--text-muted)" }}
                  >
                    {r.buCode ?? "—"}
                  </td>
                  <td className="py-1.5 px-2" style={{ color: "var(--text-secondary)" }}>
                    {r.departmentCode ?? "—"}
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
