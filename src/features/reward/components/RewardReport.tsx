"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Download, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui";
import { RewardStatusBadge } from "@/features/reward/components/RewardStatusBadge";
import { REPORT_STATUS_FILTER_GROUPS } from "@/features/reward/constants";
import { fmtDay as stamp } from "@/features/reward/lib/format-stamp";
import type { RewardListRow } from "@/features/reward/types";

/**
 * The AP-11 report (brief §"หน้า Report แสดงข้อมูลการขอทั้งหมดพร้อม filter").
 *
 * The filter state is serialised once and used for both the table and the Excel
 * download, so the file can never contain rows the screen excluded — the usual
 * way an export and its view drift apart is two separate parameter builders.
 */

async function fetcher(url: string): Promise<RewardListRow[]> {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(typeof json.error === "string" ? json.error : "โหลดข้อมูลไม่สำเร็จ");
  return json.data as RewardListRow[];
}

function money(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function RewardReport() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState(0);

  /** One query string, used by the table and the export alike. */
  const queryString = useMemo(() => {
    const sp = new URLSearchParams();
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    if (search.trim()) sp.set("q", search.trim());
    // Group ids expand to the statuses they stand for; "pending" is two.
    for (const id of statuses) {
      const group = REPORT_STATUS_FILTER_GROUPS.find((g) => g.id === id);
      if (!group) continue;
      if (group.id === "pending") {
        sp.append("status", "Submitted");
        sp.append("status", "ManagerApproved");
      } else {
        sp.append("status", group.id);
      }
    }
    return sp.toString();
    // `applied` forces a new key when the user presses ค้นหา, so typing in the
    // search box does not refetch on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied]);

  const { data, error, isLoading } = useSWR(
    `/api/request/reward/report${queryString ? `?${queryString}` : ""}`,
    fetcher,
  );

  const rows = data ?? [];
  const totals = useMemo(
    () => ({
      count: rows.length,
      qty: rows.reduce((s, r) => s + r.qty, 0),
      value: rows.reduce((s, r) => s + (r.totalActualValue ?? 0), 0),
    }),
    [rows],
  );

  function toggleStatus(id: string) {
    setStatuses((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  const exportHref = `/api/request/reward/report/export${queryString ? `?${queryString}` : ""}`;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <section
        className="rounded-[14px] p-4"
        style={{ background: "var(--bg-card)", boxShadow: "var(--shadow-card)" }}
      >
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="text-[11px] block mb-1" style={{ color: "var(--text-muted)" }}>
              ตั้งแต่วันที่
            </label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full text-[13px] rounded-lg px-3 py-2 outline-none"
              style={{
                background: "var(--bg-subtle)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-card)",
              }}
            />
          </div>
          <div>
            <label className="text-[11px] block mb-1" style={{ color: "var(--text-muted)" }}>
              ถึงวันที่
            </label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full text-[13px] rounded-lg px-3 py-2 outline-none"
              style={{
                background: "var(--bg-subtle)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-card)",
              }}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-[11px] block mb-1" style={{ color: "var(--text-muted)" }}>
              ค้นหา (เลขที่คำขอ / ชื่อผู้ขอ / ชื่อของรางวัล)
            </label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setApplied((n) => n + 1);
              }}
              className="w-full text-[13px] rounded-lg px-3 py-2 outline-none"
              style={{
                background: "var(--bg-subtle)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-card)",
              }}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-3">
          {REPORT_STATUS_FILTER_GROUPS.map((g) => {
            const on = statuses.includes(g.id);
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => toggleStatus(g.id)}
                className="text-[11.5px] font-bold px-2.5 py-1 rounded-full transition-colors"
                style={{
                  background: on ? "var(--action)" : "var(--bg-subtle)",
                  color: on ? "#fff" : "var(--text-secondary)",
                }}
              >
                {g.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-3.5">
          <Button
            variant="primary"
            size="md"
            icon={<Search size={14} />}
            onClick={() => setApplied((n) => n + 1)}
          >
            ค้นหา
          </Button>
          <a href={exportHref}>
            <Button variant="secondary" size="md" icon={<Download size={14} />}>
              ดาวน์โหลด Excel
            </Button>
          </a>
        </div>
      </section>

      {/* Totals — the three numbers anyone reading this report is after. */}
      <div className="grid gap-3 grid-cols-3">
        {[
          { label: "จำนวนคำขอ", value: totals.count.toLocaleString("th-TH") },
          { label: "จำนวนของรางวัล", value: `${totals.qty.toLocaleString("th-TH")} ชิ้น` },
          { label: "มูลค่ารวม", value: `${money(totals.value)} บาท` },
        ].map((t) => (
          <div
            key={t.label}
            className="rounded-[12px] px-3.5 py-3"
            style={{ background: "var(--bg-card)", boxShadow: "var(--shadow-card)" }}
          >
            <p className="text-[10.5px]" style={{ color: "var(--text-muted)" }}>
              {t.label}
            </p>
            <p
              className="text-[16px] font-extrabold mt-0.5"
              style={{ color: "var(--text-primary)" }}
            >
              {t.value}
            </p>
          </div>
        ))}
      </div>

      {/* Table */}
      <section
        className="rounded-[14px] overflow-hidden"
        style={{ background: "var(--bg-card)", boxShadow: "var(--shadow-card)" }}
      >
        {isLoading ? (
          <div
            className="p-6 flex items-center gap-2 text-[13px]"
            style={{ color: "var(--text-muted)" }}
          >
            <Loader2 size={15} className="animate-spin" />
            กำลังโหลด...
          </div>
        ) : error ? (
          <p className="p-6 text-[13px]" style={{ color: "var(--text-danger)" }}>
            {error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ"}
          </p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-[13px]" style={{ color: "var(--text-muted)" }}>
            ไม่พบข้อมูลตามเงื่อนไขที่เลือก
          </p>
        ) : (
          <div className="overflow-x-auto acc-scroll-x">
            <table className="w-full min-w-max text-[12.5px]" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--bg-subtle)" }}>
                  {[
                    "เลขที่",
                    "ผู้ขอเบิก",
                    "แผนก",
                    "ของรางวัล",
                    "จำนวน",
                    "มูลค่ารวม",
                    "ส่งคำขอ",
                    "รับของ",
                    "สถานะ",
                  ].map((h) => (
                    <th
                      key={h}
                      className="text-left font-bold px-3 py-2 whitespace-nowrap"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border-light)" }}>
                    <td className="px-3 py-2 font-bold whitespace-nowrap">
                      <a
                        href={`/request/reward/${r.id}`}
                        style={{ color: "var(--action)" }}
                      >
                        {r.requestNo ?? `#${r.id}`}
                      </a>
                    </td>
                    <td className="px-3 py-2" style={{ color: "var(--text-primary)" }}>
                      {r.requesterFullName ?? "—"}
                    </td>
                    <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>
                      {r.requesterDepartmentName ?? "—"}
                    </td>
                    <td className="px-3 py-2" style={{ color: "var(--text-primary)" }}>
                      {r.rewardName ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.qty}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money(r.totalActualValue)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                      {stamp(r.submittedAt)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                      {stamp(r.receivedAt)}
                    </td>
                    <td className="px-3 py-2">
                      <RewardStatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
